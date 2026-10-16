export const ROLES = ["owner", "admin", "member"] as const;

export type Role = (typeof ROLES)[number];

export type Profile = {
  displayName: string;
  email: string;
};

export type Membership = {
  organisationId: string;
  organisationName: string;
  organisationSlug: string;
  tenantId: string;
  tenantName: string;
  role: Role;
};

export type OrganisationMember = {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
};

export type ActionState = {
  error?: string;
  message?: string;
};

export function isRole(value: string): value is Role {
  return ROLES.some((role) => role === value);
}

export function roleLabel(role: Role) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Member";
}

export function canManage(role: Role) {
  return role === "owner" || role === "admin";
}
