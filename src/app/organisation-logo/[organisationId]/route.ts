import { NextResponse } from "next/server";
import { getWorkspace } from "@/lib/data";
import { logoContentType, ORGANISATION_LOGO_BUCKET, organisationLogoPath } from "@/lib/organisation-logo";
import { createClient } from "@/lib/supabase/server";

const ORGANISATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SNAPSHOT_OBJECT = /^snapshots\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organisationId: string }> },
) {
  const { organisationId } = await params;
  if (!ORGANISATION_ID.test(organisationId)) return new NextResponse(null, { status: 404 });

  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return new NextResponse(null, { status: 404 });
  if (!workspace.memberships.some((membership) => membership.organisationId === organisationId)) {
    return new NextResponse(null, { status: 404 });
  }

  const supabase = await createClient();
  const object = new URL(request.url).searchParams.get("object");
  let storagePath = organisationLogoPath(organisationId);
  if (object) {
    if (!SNAPSHOT_OBJECT.test(object)) return new NextResponse(null, { status: 404 });
    storagePath = `${organisationId}/${object}`;
  } else {
    const { data, error } = await supabase
      .from("organisation_defaults")
      .select("logo_path")
      .eq("organisation_id", organisationId)
      .maybeSingle();
    if (error || data?.logo_path !== storagePath) return new NextResponse(null, { status: 404 });
  }

  const downloaded = await supabase.storage.from(ORGANISATION_LOGO_BUCKET).download(storagePath);
  if (downloaded.error || !downloaded.data) return new NextResponse(null, { status: 404 });
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const type = logoContentType(bytes);
  if (!type) return new NextResponse(null, { status: 404 });

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
