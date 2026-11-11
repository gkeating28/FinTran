import type { PartyKind } from "@/lib/parties";

/** What an e-invoice needs to know about a customer or supplier, checked from the form as it is typed. */
export type PartyCheck = {
  id: string;
  label: string;
  ok: boolean;
  /** A required gap stops a sales e-invoice. An advisory one does not. */
  required: boolean;
  hint: string;
};

export type PartyReadinessInput = {
  name: string;
  addressLine1: string;
  city: string;
  countryCode: string;
  vatNumber: string;
  peppolScheme: string;
  peppolId: string;
};

/**
 * A sales e-invoice is refused without the buyer's name, postal address and electronic address, so those are
 * required for a customer. A supplier sends the e-invoice, so for a supplier every item is advisory.
 */
export function partyChecks(kind: PartyKind, input: PartyReadinessInput): PartyCheck[] {
  const customer = kind === "customers";
  const has = (value: string) => value.trim().length > 0;
  return [
    { id: "name", label: "Name", ok: has(input.name), required: customer, hint: "Enter the legal name." },
    {
      id: "address",
      label: "Postal address",
      ok: has(input.addressLine1) && has(input.city) && has(input.countryCode),
      required: customer,
      hint: "Needs address line 1, a city and a country.",
    },
    {
      id: "peppol",
      label: "Peppol ID",
      ok: has(input.peppolScheme) && has(input.peppolId),
      required: customer,
      hint: customer ? "Needs a Peppol scheme and ID to deliver an e-invoice." : "Helps match the e-invoices they send to this supplier.",
    },
    {
      id: "vat",
      label: "VAT number",
      ok: has(input.vatNumber),
      required: false,
      hint: customer ? "Needed for reverse charge and intra-Community sales." : "Helps match the e-invoices they send to this supplier.",
    },
  ];
}

export function partyReadiness(checks: PartyCheck[]): "ready" | "warning" | "error" {
  if (checks.some((check) => check.required && !check.ok)) return "error";
  if (checks.some((check) => !check.ok)) return "warning";
  return "ready";
}
