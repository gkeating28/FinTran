import { parseBic, parseIban } from "@/lib/address";

export type BankAccountRow = {
  id: string;
  code: string;
  name: string;
  /** Stored form, no spaces. */
  iban: string;
  bic: string;
  currencyId: string;
  currencyCode: string;
  glCodeId: string;
  glCodeLabel: string;
  active: boolean;
  isDefault: boolean;
};

export type BankAccountChoice = {
  id: string;
  label: string;
};

export function parseBankAccountCode(value: string) {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(code)) return null;
  return code;
}

export function parseBankAccountName(value: string) {
  const name = value.trim();
  if (name.length < 1 || name.length > 100) return null;
  return name;
}

/** An IBAN as people read it: groups of four. */
export function formatIban(value: string) {
  return value.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}

export type BankAccountFields = {
  code: string;
  name: string;
  iban: string;
  bic: string | null;
  currency_id: string;
  gl_code_id: string | null;
  active: boolean;
  is_default: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the form. The database checks the IBAN check digits, so this only catches the shape of each field. */
export function parseBankAccountForm(input: {
  code: string;
  name: string;
  iban: string;
  bic: string;
  currencyId: string;
  glCodeId: string;
  active: boolean;
  isDefault: boolean;
}): { fields: BankAccountFields } | { error: string } {
  const code = parseBankAccountCode(input.code);
  const name = parseBankAccountName(input.name);
  if (!code || !name) {
    return {
      error:
        "Start the code with a letter or number. Then use letters, numbers, dots, or hyphens, up to 20 characters, and a name up to 100 characters.",
    };
  }
  const iban = parseIban(input.iban);
  if (!iban) return { error: "Enter a valid IBAN." };
  const bic = parseBic(input.bic);
  if (bic === undefined) return { error: "Enter a BIC of 8 or 11 characters." };
  if (!UUID.test(input.currencyId)) return { error: "Choose a currency." };
  const glCodeId = input.glCodeId.trim();
  if (glCodeId && !UUID.test(glCodeId)) return { error: "Choose a Current Asset GL code, or leave it blank." };
  if (input.isDefault && !input.active) return { error: "An inactive account cannot be the default." };
  return {
    fields: {
      code,
      name,
      iban,
      bic,
      currency_id: input.currencyId,
      gl_code_id: glCodeId || null,
      active: input.active,
      is_default: input.isDefault,
    },
  };
}
