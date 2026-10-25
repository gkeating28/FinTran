import { NextResponse } from "next/server";
import { receiveInbound } from "@/lib/einvoice/store";
import { getWorkspace } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a UBL file." }, { status: 400 });
  const xml = await file.text();

  try {
    const id = await receiveInbound(await createClient(), workspace.current.organisationId, xml);
    return NextResponse.json({ id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The e-invoice could not be received.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
