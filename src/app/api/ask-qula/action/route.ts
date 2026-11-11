import { NextResponse } from "next/server";
import { hashToken, readAction, runAction } from "@/lib/ai/actions";
import { getWorkspace } from "@/lib/data";
import { accessErrorResponse, requireCurrentOrganisation } from "@/lib/organisation-guard";
import { readClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Carries out an action the person confirmed. The token was signed when Ask Qula proposed it, and the proposal was
 * written down then. The token is accepted once, for the same person in the same organisation, within ten minutes, while
 * actions are switched on and the document it names has not changed. The checks run again before anything changes.
 *
 * 400 for a token that is unknown or has run out, 403 when actions are switched off, and 409 for a token that has
 * already been used, a document that changed, or the wrong open organisation.
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

  // One statement in the database moves the proposal from proposed to confirmed, so a token cannot be used twice.
  const tokenHash = hashToken(token);
  const confirmed = await supabase.rpc("confirm_ai_action", { p_organisation_id: proposed.organisationId, p_token_hash: tokenHash });
  const state = confirmed.error ? "error" : String(confirmed.data ?? "unknown");
  if (state !== "confirmed") {
    const refusal: Record<string, { status: number; error: string }> = {
      used: { status: 409, error: "That confirmation has already been used. Nothing was done twice." },
      changed: { status: 409, error: "This document changed after Ask Qula proposed posting it. Ask again." },
      disabled: { status: 403, error: "Ask Qula actions are switched off for this organisation." },
      expired: { status: 400, error: "That confirmation has expired. Ask again." },
      unknown: { status: 400, error: "That confirmation has expired. Ask again." },
      error: { status: 500, error: "That could not be checked just now. Nothing was changed." },
    };
    const refused = refusal[state] ?? refusal.unknown;
    return NextResponse.json({ ok: false, error: refused.error }, { status: refused.status });
  }

  let result: Awaited<ReturnType<typeof runAction>>;
  try {
    result = await runAction(supabase, proposed.organisationId, proposed.action);
  } catch (error) {
    result = { ok: false, message: error instanceof Error ? error.message : "That could not be done.", summary: proposed.action.kind === "post_draft" ? "Post a draft" : "Add a supplier or customer" };
  }
  await supabase.rpc("finish_ai_action", {
    p_token_hash: tokenHash,
    p_ok: result.ok,
    p_summary: result.summary,
    p_detail: result.ok ? "" : result.message,
  });
  return NextResponse.json(result.ok ? { ok: true, message: result.message, href: result.href ?? null } : { ok: false, error: result.message });
}
