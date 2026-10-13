import { groupThousands, plainDecimal } from "@/lib/numbers";

export type ProductRow = {
  id: string;
  code: string;
  description: string;
  purchasePrice: string;
  salesPrice: string;
  purchaseGlCodeId: string;
  purchaseGlCode: string;
  salesGlCodeId: string;
  salesGlCode: string;
  purchaseVatCodeId: string;
  purchaseVatCode: string;
  salesVatCodeId: string;
  salesVatCode: string;
};

export function parseProductCode(value: string) {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,30}$/.test(code)) return null;
  return code;
}

export function parseProductPrice(value: string) {
  const trimmed = plainDecimal(value);
  if (!/^\d{1,12}(?:\.\d{1,4})?$/.test(trimmed)) return null;
  return trimmed;
}

export function formatProductPrice(value: string | number | null) {
  if (value == null || value === "") return "";
  const text = plainDecimal(value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) return String(value);
  const [whole, fraction = ""] = text.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  const shown = trimmed.length <= 2 ? trimmed.padEnd(2, "0") : trimmed;
  return groupThousands(`${whole}.${shown}`);
}
