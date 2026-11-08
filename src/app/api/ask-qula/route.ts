import { NextResponse } from "next/server";
import { answerAsk } from "@/lib/ai/route";
import type { AiMessage } from "@/lib/ai/adapter";
import { parseContext } from "@/lib/ai/context";
import type { AskEvent } from "@/lib/ask-qula";
import { getWorkspace } from "@/lib/data";
import { accessErrorResponse, requireCurrentOrganisation } from "@/lib/organisation-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    await requireCurrentOrganisation();
  } catch (error) {
    const denied = accessErrorResponse(error);
    if (denied) return NextResponse.json({ error: denied.message }, { status: denied.status });
    throw error;
  }
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ask a question." }, { status: 400 });
  }

  const record = body && typeof body === "object" ? (body as { question?: unknown; organisationId?: unknown; history?: unknown; context?: unknown; stream?: unknown }) : {};
  const context = parseContext(record.context);
  const question = typeof record.question === "string" ? record.question.trim() : "";
  const organisationId = typeof record.organisationId === "string" ? record.organisationId.trim() : "";
  const history = Array.isArray(record.history)
    ? record.history.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const message = item as { role?: unknown; text?: unknown };
        if ((message.role !== "user" && message.role !== "assistant") || typeof message.text !== "string") return [];
        const turn: AiMessage = { role: message.role, text: message.text.slice(0, 1000) };
        return [turn];
      }).slice(-6)
    : [];
  if (!question) return NextResponse.json({ error: "Ask a question." }, { status: 400 });
  if (question.length > 1000) return NextResponse.json({ error: "Ask a shorter question." }, { status: 400 });
  if (!UUID.test(organisationId)) {
    return NextResponse.json({ error: "Choose an organisation you can open." }, { status: 403 });
  }
  // The workspace already lists the organisations this person can open, so no second lookup is needed.
  if (!workspace.memberships.some((membership) => membership.organisationId === organisationId)) {
    return NextResponse.json({ error: "You cannot open that organisation." }, { status: 403 });
  }

  if (record.stream === true) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const emit = (event: AskEvent) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            closed = true;
          }
        };
        try {
          await answerAsk(organisationId, question, history, context, emit);
        } catch (error) {
          emit({ type: "error", text: error instanceof Error ? error.message : "That could not be answered." });
        } finally {
          closed = true;
          try {
            controller.close();
          } catch {
            // The reader has already gone.
          }
        }
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
    });
  }

  try {
    return NextResponse.json(await answerAsk(organisationId, question, history, context));
  } catch (error) {
    const message = error instanceof Error ? error.message : "That could not be answered.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
