import { NextResponse } from "next/server";
import { getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const { id } = await params;
  if (!ID.test(id)) return new NextResponse("That document was not found.", { status: 404 });

  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return new NextResponse("Sign in before downloading a document.", { status: 401 });
  if (!canManage(workspace.current.role)) {
    return new NextResponse("Only an owner or admin can download the EN 16931 file.", { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("en16931_document", { p_header_id: id });
  if (error) return new NextResponse(error.message, { status: 400 });
  if (!data) return new NextResponse("That document was not found.", { status: 404 });

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="en16931-${id}.json"`,
    },
  });
}
