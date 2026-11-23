import { getWorkspace } from "@/lib/data";
import { OrganisationAccessError, requireOrganisationMember } from "@/lib/organisation-guard";

/** The sections of the organisation edit screen that hold settings. */
export type SettingsTab = "ask-qula" | "access-point" | "accounting";

/** Where a settings action sends the person: the same organisation, on the same tab, with an error or a message. */
export function settingsUrl(organisationId: string, tab: SettingsTab, key?: "error" | "message", value?: string) {
  const base = `/organisations?edit=${organisationId}&tab=${tab}`;
  return key && value ? `${base}&${key}=${encodeURIComponent(value)}` : base;
}

/**
 * The organisation a settings form is for. It is named by the form, so settings can be changed for any organisation the
 * person owns or administers, not only the one they are working in. The role is checked for that organisation.
 */
export async function settingsOrganisation(formData: FormData) {
  const organisationId = String(formData.get("organisation_id") ?? "").trim();
  if (!organisationId) throw new OrganisationAccessError("Choose an organisation.");
  await requireOrganisationMember(organisationId, ["owner", "admin"]);
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") throw new OrganisationAccessError("Sign in first.");
  const membership = workspace.memberships.find((item) => item.organisationId === organisationId);
  if (!membership) throw new OrganisationAccessError("You cannot change that organisation.");
  return membership;
}
