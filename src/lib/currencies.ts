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
  if (!/^[A-Z0-9]{1,20}$/.test(code)) return null;
  return code;
}

export function parseCurrencyName(value: string) {
  const name = value.trim();
  if (name.length < 1 || name.length > 80) return null;
  return name;
}

export function parseCurrencyRate(value: string) {
  const trimmed = value.trim();
  if (!/^\d{1,8}(?:\.\d{1,8})?$/.test(trimmed)) return null;
  if (!(Number(trimmed) > 0)) return null;
  return trimmed;
}

export function formatCurrencyRate(value: string | number | null) {
  if (value == null || value === "") return "";
  const text = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) return text;
  return text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export function currencyLabel(currency: { code: string; name: string }) {
  return `${currency.code} — ${currency.name}`;
}
