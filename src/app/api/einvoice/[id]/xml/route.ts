import { NextResponse } from "next/server";
import { getWorkspace } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID.test(id)) return new NextResponse("That e-document was not found.", { status: 404 });
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return new NextResponse("Sign in first.", { status: 401 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("e_document_xml", { p_id: id });
  if (error) return new NextResponse(error.message, { status: 400 });
  if (!data) return new NextResponse("That e-document was not found.", { status: 404 });
  return new NextResponse(data, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${id}.xml"`,
    },
  });
}
