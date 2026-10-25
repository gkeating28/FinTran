import { NextResponse } from "next/server";
import { createOutbound } from "@/lib/einvoice/store";
import { getWorkspace } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, { params }: { params: Promise<{ headerId: string }> }) {
  const { headerId } = await params;
  if (!ID.test(headerId)) return NextResponse.json({ error: "That document was not found." }, { status: 404 });
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  try {
    const id = await createOutbound(await createClient(), headerId, workspace.current.organisationId);
    return NextResponse.json({ id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The e-invoice could not be generated.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
