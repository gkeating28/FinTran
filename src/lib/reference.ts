import { groupThousands, plainDecimal } from "@/lib/numbers";

export const REFERENCE_KINDS = ["gl_codes", "departments", "cost_centres", "vat_rates"] as const;

export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

/** The eight account types, in the order of the report sections they belong to (QULAPLUS_LEDGER_SPEC.md). */
export const ACCOUNT_TYPES = [
  "Fixed Asset",
  "Current Asset",
  "Current Liability",
  "Non-current Liability",
  "Equity",
  "Income",
  "Cost of Sales",
  "Expense",
] as const;

/** The job a GL code does for the ledger, as the person reads it. */
export const SYSTEM_ROLE_LABELS: Record<string, string> = {
  debtors_control: "Debtors control",
  creditors_control: "Creditors control",
  vat_output: "VAT on sales",
  vat_input: "VAT on purchases",
  retained_earnings: "Retained earnings",
  fx_difference: "Exchange differences",
  rounding: "Rounding",
  suspense: "Suspense",
};

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const VAT_TYPES = ["Sales", "Expense"] as const;

export type VatType = (typeof VAT_TYPES)[number];

export type ReferenceRow = {
  id: string;
  code: string;
  description: string;
  accountType: AccountType | null;
  systemRole: string | null;
  rate: string | null;
  vatType: VatType | null;
  vatCategory: string | null;
  exemptionCode: string | null;
  exemptionReason: string | null;
};

export type VatCategoryChoice = {
  code: string;
  name: string;
  requiresExemptionReason: boolean;
  rateMustBeZero: boolean;
};

export type VatexChoice = {
  code: string;
  name: string;
};

export const REFERENCE_META: Record<
  ReferenceKind,
  { path: string; title: string; singular: string; intro: string }
> = {
  gl_codes: {
    path: "/gl-codes",
    title: "GL codes",
    singular: "GL code",
    intro: "General ledger codes",
  },
  departments: {
    path: "/departments",
    title: "Departments",
    singular: "department",
    intro: "Departments",
  },
  cost_centres: {
    path: "/cost-centres",
    title: "Cost centres",
    singular: "cost centre",
    intro: "Cost centres",
  },
  vat_rates: {
    path: "/vat-rates",
    title: "VAT rates",
    singular: "VAT rate",
    intro: "VAT rates",
  },
};

export function isReferenceKind(value: string): value is ReferenceKind {
  return REFERENCE_KINDS.some((kind) => kind === value);
}

export function parseReferenceCode(value: string) {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(code)) return null;
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

export function parseVatType(value: string): VatType | null {
  return VAT_TYPES.find((type) => type === value) ?? null;
}

export function parseRate(value: string): string | null {
  const trimmed = plainDecimal(value);
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const rate = Number(trimmed);
  if (rate < 0 || rate > 100) return null;
  return String(rate);
}

export function formatRate(value: string | null) {
  if (!value) return "";
  return `${groupThousands(value)}%`;
}
