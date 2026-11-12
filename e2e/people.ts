/** The three test people the seed creates. All belong to the organisation "Qula Test One". */
export const PEOPLE = {
  owner: { email: "owner@qula.test", password: "Owner-pass-2026", name: "Olive Owner", role: "owner" },
  admin: { email: "admin@qula.test", password: "Admin-pass-2026", name: "Adam Admin", role: "admin" },
  member: { email: "member@qula.test", password: "Member-pass-2026", name: "Mary Member", role: "member" },
} as const;

export type Role = keyof typeof PEOPLE;
