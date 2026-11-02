import { NextResponse } from "next/server";
import { answerQuestion } from "@/lib/ask-qula-data";
import { getWorkspace } from "@/lib/data";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
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

  const record = body && typeof body === "object" ? (body as { question?: unknown; organisationId?: unknown }) : {};
  const question = typeof record.question === "string" ? record.question.trim() : "";
  const organisationId = typeof record.organisationId === "string" ? record.organisationId.trim() : "";
  if (!question) return NextResponse.json({ error: "Ask a question." }, { status: 400 });
  if (question.length > 300) return NextResponse.json({ error: "Ask a shorter question." }, { status: 400 });
  if (!UUID.test(organisationId) || !workspace.memberships.some((membership) => membership.organisationId === organisationId)) {
    return NextResponse.json({ error: "Choose an organisation you can open." }, { status: 403 });
  }

  try {
    return NextResponse.json(await answerQuestion(organisationId, question));
  } catch (error) {
    const message = error instanceof Error ? error.message : "That could not be answered.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
