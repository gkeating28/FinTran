

export type Supplier = {
  id: string;
  name: string;
  code: string;
  vat_number: string | null;
  peppol_scheme: string | null;
  peppol_id: string | null;
  currency_id: string;
};
export type Vat = { id: string; code: string; description: string; vat_category: string | null; rate: number; vat_type: string };
export type Named = { id: string; code: string; description: string };
export type Currency = { id: string; code: string; iso_code: string | null; rate: number };
export type Means = { code: string; name: string; common: boolean };
export type LineChoice = { vatRateId: string; glCodeId: string; departmentId: string; costCentreId: string };
export type Memory = Record<string, { glCodeId: string; departmentId: string; costCentreId: string }>;
export type RuleFailure = { ruleId: string; severity: string; message: string };
export type HeaderTab = "document" | "notes" | "payment";
export type FlexLabels = [string, string, string, string, string];
export type PurchaseType = {
  id: string;
  code: string;
  description: string;
  document_kind: string;
  flex1_label: string | null;
  flex2_label: string | null;
  flex3_label: string | null;
  flex4_label: string | null;
  flex5_label: string | null;
};

export type OpenLine = LineChoice & {
  number: string;
  sellerItem: string;
  source: Record<string, unknown>;
};
