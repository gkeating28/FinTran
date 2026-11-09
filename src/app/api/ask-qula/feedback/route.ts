import { NextResponse } from "next/server";
import { getWorkspace } from "@/lib/data";
import { accessErrorResponse, requireCurrentOrganisation } from "@/lib/organisation-guard";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clip(value: unknown, length: number) {
  return typeof value === "string" ? value.slice(0, length) : "";
}

/** A thumbs up or down on an answer. The question and answer are kept only if the organisation has opted in. */
export async function POST(request: Request) {
  try {
    await requireCurrentOrganisation();
  } catch (error) {
    const denied = accessErrorResponse(error);
    if (denied) return NextResponse.json({ error: denied.message }, { status: denied.status });
    throw error;
  }
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let body: { organisationId?: unknown; rating?: unknown; question?: unknown; answer?: unknown; comment?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That could not be read." }, { status: 400 });
  }
  const organisationId = clip(body.organisationId, 40);
  if (!UUID.test(organisationId) || !workspace.memberships.some((membership) => membership.organisationId === organisationId)) {
    return NextResponse.json({ error: "You cannot open that organisation." }, { status: 403 });
  }
  const rating = body.rating === 1 || body.rating === -1 ? body.rating : null;
  if (rating === null) return NextResponse.json({ error: "Choose thumbs up or thumbs down." }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_ai_feedback", {
    p_organisation_id: organisationId,
    p_rating: rating,
    p_question: clip(body.question, 1000),
    p_answer: clip(body.answer, 4000),
    p_comment: clip(body.comment, 500),
  });
  if (error) return NextResponse.json({ error: "Your feedback could not be saved." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
