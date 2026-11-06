import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getWorkspace, ORGANISATION_COOKIE } from "@/lib/data";
import { isRole, type Membership, type Role } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { readClaims } from "@/lib/supabase/claims";

export class OrganisationAccessError extends Error {
  readonly status = 403;
  digest = "NEXT_HTTP_ERROR_FALLBACK;403";

  constructor(message = "You cannot open that organisation.") {
    super(message);
    this.name = "OrganisationAccessError";
  }
}

export function membershipAllows(
  memberships: { organisationId: string; role: Role }[],
  organisationId: string,
  roles?: Role[],
) {
  const membership = memberships.find((item) => item.organisationId === organisationId);
  if (!membership) return false;
  if (roles && !roles.includes(membership.role)) return false;
  return true;
}

export function requestWithTamperedOrganisation(url: string, organisationId: string) {
  return new Request(url, {
    headers: { cookie: `${ORGANISATION_COOKIE}=${organisationId}` },
  });
}

export async function requireOrganisationMember(organisationId: string, roles?: Role[]) {
  const supabase = await createClient();
  const { data } = await readClaims(supabase);
  const userId = data?.claims?.sub;
  if (!userId) throw new OrganisationAccessError("Sign in first.");

  const { data: access, error } = await supabase
    .from("organisation_access")
    .select("role")
    .eq("user_id", userId)
    .eq("organisation_id", organisationId)
    .maybeSingle();

  if (error || !access || !isRole(access.role) || (roles && !roles.includes(access.role))) {
    const denied = new OrganisationAccessError(
      roles ? "You cannot change that organisation." : "You cannot open that organisation.",
    );
    denied.digest = "NEXT_HTTP_ERROR_FALLBACK;403";
    throw denied;
  }
  return access.role;
}

export async function requireCurrentOrganisation(roles?: Role[]): Promise<Membership> {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const cookieStore = await cookies();
  const selected = cookieStore.get(ORGANISATION_COOKIE)?.value;
  if (selected && !membershipAllows(workspace.memberships, selected, roles)) {
    const denied = new OrganisationAccessError(
      roles ? "You cannot change that organisation." : "You cannot open that organisation.",
    );
    denied.digest = "NEXT_HTTP_ERROR_FALLBACK;403";
    throw denied;
  }

  const current = selected
    ? workspace.memberships.find((membership) => membership.organisationId === selected) ?? workspace.current
    : workspace.current;

  if (roles && !roles.includes(current.role)) {
    throw new OrganisationAccessError("You cannot change that organisation.");
  }

  if (!selected) {
    cookieStore.set(ORGANISATION_COOKIE, current.organisationId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return current;
}

export function accessErrorResponse(error: unknown) {
  if (error instanceof OrganisationAccessError) {
    return { status: error.status, message: error.message };
  }
  return null;
}
