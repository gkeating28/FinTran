import { groupThousands, plainDecimal } from "@/lib/numbers";

export type CurrencyRow = {
  id: string;
  code: string;
  name: string;
  rate: string;
  home: boolean;
};

export type CurrencyChoice = {
  id: string;
  code: string;
  name: string;
};

export function parseCurrencyCode(value: string) {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(code)) return null;
  return code;
}

export function parseCurrencyName(value: string) {
  const name = value.trim();
  if (name.length < 1 || name.length > 80) return null;
  return name;
}

export function parseCurrencyRate(value: string) {
  const trimmed = plainDecimal(value);
  if (!/^\d{1,8}(?:\.\d{1,8})?$/.test(trimmed)) return null;
  if (!(Number(trimmed) > 0)) return null;
  return trimmed;
}

export function formatCurrencyRate(value: string | number | null) {
  if (value == null || value === "") return "";
  const text = plainDecimal(value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) return String(value);
  const plain = text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return groupThousands(plain);
}

export function formatExchangeRate(value: string | number | null) {
  if (value == null || value === "") return "";
  const text = plainDecimal(value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) return String(value);
  const [whole, fraction = ""] = text.split(".");
  const padded = (fraction + "00000").slice(0, 5);
  let frac = padded.slice(0, 4);
  let carry = padded[4] >= "5" ? 1 : 0;
  const digits = (whole + frac).split("");
  for (let index = digits.length - 1; index >= 0 && carry; index -= 1) {
    const sum = Number(digits[index]) + carry;
    digits[index] = String(sum % 10);
    carry = sum >= 10 ? 1 : 0;
  }
  const joined = (carry ? "1" : "") + digits.join("");
  return groupThousands(`${joined.slice(0, joined.length - 4)}.${joined.slice(joined.length - 4)}`);
}

export function currencyLabel(currency: { code: string; name: string }) {
  return `${currency.code} — ${currency.name}`;
}
