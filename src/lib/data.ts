import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { readClaims } from "@/lib/supabase/claims";
import {
  isRole,
  type Membership,
  type OrganisationMember,
  type Profile,
  type Role,
} from "@/lib/types";

export const ORGANISATION_COOKIE = "fintran-organisation";

type AccessRow = {
  role: string;
  tenant_id: string;
  organisation_id: string;
  tenants: { name: string } | { name: string }[] | null;
  organisations: { name: string; slug: string } | { name: string; slug: string }[] | null;
};

type MemberRow = {
  role: string;
  user_id: string;
  profiles: { email: string; display_name: string } | { email: string; display_name: string }[] | null;
};

export type Workspace =
  | { status: "signed-out" }
  | { status: "error"; message: string }
  | { status: "needs-tenant"; profile: Profile }
  | {
      status: "ready";
      profile: Profile;
      memberships: Membership[];
      current: Membership;
    };

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function toMembership(row: AccessRow): Membership | null {
  const tenant = one(row.tenants);
  const organisation = one(row.organisations);
  if (!tenant || !organisation || !isRole(row.role)) return null;

  return {
    organisationId: row.organisation_id,
    organisationName: organisation.name,
    organisationSlug: organisation.slug,
    tenantId: row.tenant_id,
    tenantName: tenant.name,
    role: row.role,
  };
}

export const getWorkspace = cache(async (): Promise<Workspace> => {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await readClaims(supabase);
  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId) return { status: "signed-out" };

  const [profileResult, accessResult] = await Promise.all([
    supabase.from("profiles").select("display_name, email").eq("id", userId).maybeSingle(),
    supabase
      .from("organisation_access")
      .select("role, tenant_id, organisation_id, tenants(name), organisations(name, slug)")
      .eq("user_id", userId),
  ]);

  if (profileResult.error || accessResult.error || !profileResult.data) {
    return {
      status: "error",
      message: "Your account could not be loaded. Refresh the page and try again.",
    };
  }

  const profile: Profile = {
    displayName: profileResult.data.display_name,
    email: profileResult.data.email,
  };

  const memberships = ((accessResult.data ?? []) as AccessRow[])
    .map(toMembership)
    .filter((membership): membership is Membership => membership !== null)
    .sort((a, b) =>
      `${a.tenantName} ${a.organisationName}`.localeCompare(
        `${b.tenantName} ${b.organisationName}`,
      ),
    );

  if (memberships.length === 0) return { status: "needs-tenant", profile };

  const cookieStore = await cookies();
  const selected = cookieStore.get(ORGANISATION_COOKIE)?.value;
  const current = memberships.find((membership) => membership.organisationId === selected) ?? memberships[0];

  return { status: "ready", profile, memberships, current };
});

/**
 * The organisation a page reads for, without waiting for the whole workspace.
 *
 * The workspace load (profile and access) and the page data are two database round trips. When the
 * page data waits for the workspace they run one after the other. The organisation cookie already
 * names the organisation, so the data query can start at the same time. Row level security still
 * limits every query to organisations the signed in person can open, so a stale cookie reads
 * nothing rather than somebody else's rows. With no cookie it falls back to the workspace.
 *
 * Standard for every page that lists rows: start the data function first, then await the workspace
 * to check the person is signed in, so the two run together.
 */
export const getOrganisationScope = cache(async (): Promise<string | null> => {
  const cookieStore = await cookies();
  const selected = cookieStore.get(ORGANISATION_COOKIE)?.value;
  if (selected) return selected;
  const workspace = await getWorkspace();
  return workspace.status === "ready" ? workspace.current.organisationId : null;
});

/** Runs a read for the current organisation as soon as the organisation is known. Null when there is none. */
export function forOrganisation<T>(load: (organisationId: string) => Promise<T>): Promise<T | null> {
  return getOrganisationScope().then((organisationId) => (organisationId ? load(organisationId) : null));
}

export async function listOrganisationMembers(
  organisationId: string,
): Promise<{ members: OrganisationMember[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organisation_access")
    .select("role, user_id, profiles!organisation_access_user_id_fkey(email, display_name)")
    .eq("organisation_id", organisationId);

  if (error) {
    return { members: [], error: "People with access to this organisation could not be loaded." };
  }

  const members = ((data ?? []) as MemberRow[])
    .flatMap((row) => {
      const profile = one(row.profiles);
      if (!profile || !isRole(row.role)) return [];
      const member: OrganisationMember = {
        userId: row.user_id,
        email: profile.email,
        displayName: profile.display_name,
        role: row.role as Role,
      };
      return [member];
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return { members, error: null };
}
