import { NextResponse } from "next/server";
import { readAction, runAction } from "@/lib/ai/actions";
import { getWorkspace } from "@/lib/data";
import { accessErrorResponse, requireCurrentOrganisation } from "@/lib/organisation-guard";
import { readClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Carries out an action the person confirmed. The token was signed when Ask Qula proposed it. It is only accepted for
 * the same person, in the same organisation, within ten minutes, and the checks run again before anything changes.
 */
export async function POST(request: Request) {
  let current;
  try {
    current = await requireCurrentOrganisation();
  } catch (error) {
    const denied = accessErrorResponse(error);
    if (denied) return NextResponse.json({ ok: false, error: denied.message }, { status: denied.status });
    throw error;
  }
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  let token = "";
  try {
    const body = (await request.json()) as { token?: unknown };
    token = typeof body.token === "string" ? body.token.slice(0, 4000) : "";
  } catch {
    return NextResponse.json({ ok: false, error: "That could not be read." }, { status: 400 });
  }

  const supabase = await createClient();
  const claims = await readClaims(supabase);
  const userId = typeof claims.data?.claims?.sub === "string" ? claims.data.claims.sub : "";
  const proposed = readAction(token);
  if (!proposed || !userId || proposed.userId !== userId) {
    return NextResponse.json({ ok: false, error: "That confirmation has expired. Ask again." }, { status: 400 });
  }
  if (proposed.organisationId !== current.organisationId || !workspace.memberships.some((membership) => membership.organisationId === proposed.organisationId)) {
    return NextResponse.json({ ok: false, error: "Open the organisation this was proposed in, then ask again." }, { status: 409 });
  }

  let result: Awaited<ReturnType<typeof runAction>>;
  try {
    result = await runAction(supabase, proposed.organisationId, proposed.action);
  } catch (error) {
    result = { ok: false, message: error instanceof Error ? error.message : "That could not be done.", summary: proposed.action.kind === "post_draft" ? "Post a draft" : "Add a supplier or customer" };
  }
  await supabase.rpc("record_ai_action", {
    p_organisation_id: proposed.organisationId,
    p_action: proposed.action.kind,
    p_summary: result.summary,
    p_outcome: result.ok ? "done" : "failed",
    p_detail: result.ok ? "" : result.message,
  });
  return NextResponse.json(result.ok ? { ok: true, message: result.message, href: result.href ?? null } : { ok: false, error: result.message });
}
