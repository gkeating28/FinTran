export const REFERENCE_KINDS = ["gl_codes", "departments", "cost_centres"] as const;

export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

export const ACCOUNT_TYPES = [
  "Fixed Asset",
  "Current Liability",
  "Current Asset",
  "Income",
  "Expense",
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type ReferenceRow = {
  id: string;
  code: string;
  description: string;
  accountType: AccountType | null;
};

export const REFERENCE_META: Record<
  ReferenceKind,
  { path: string; title: string; singular: string; lede: string }
> = {
  gl_codes: {
    path: "/gl-codes",
    title: "GL codes",
    singular: "GL code",
    lede: "General ledger codes for this organisation. Each code is letters and numbers, with a description and a required account type.",
  },
  departments: {
    path: "/departments",
    title: "Departments",
    singular: "department",
    lede: "Departments for this organisation. Each one has a code and a description, and belongs only to the organisation you have open.",
  },
  cost_centres: {
    path: "/cost-centres",
    title: "Cost centres",
    singular: "cost centre",
    lede: "Cost centres for this organisation. Each one has a code and a description, and belongs only to the organisation you have open.",
  },
};

export function isReferenceKind(value: string): value is ReferenceKind {
  return REFERENCE_KINDS.some((kind) => kind === value);
}

export function parseReferenceCode(value: string) {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(code)) return null;
  return code;
}

export function parseDescription(value: string) {
  const description = value.trim();
  if (description.length < 1 || description.length > 200) return null;
  return description;
}

export function parseAccountType(value: string): AccountType | null {
  return ACCOUNT_TYPES.find((type) => type === value) ?? null;
}
