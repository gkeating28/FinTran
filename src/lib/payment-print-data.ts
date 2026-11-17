import { formatPostalAddress } from "@/lib/address";
import { getWorkspace } from "@/lib/data";
import { formatIban } from "@/lib/bank-accounts";
import { organisationDetails } from "@/lib/form-data";
import { numberValue } from "@/lib/numbers";
import { loadPaymentRows } from "@/lib/payment-data";
import { buildPaymentPrint, samplePaymentSource, type PaymentPrintSource, type PaymentPrintView } from "@/lib/payment-print";
import { defaultPaymentLayout, parsePaymentLayout, type PaymentFormLayout } from "@/lib/payment-form-layout";
import { createClient } from "@/lib/supabase/server";
import { isPaymentKind, parseTransactionTypeKind, type PaymentKind, type TransactionTypeKind } from "@/lib/transaction-types";

type Loose = Record<string, unknown>;

function text(value: unknown) {
  return value == null ? "" : String(value);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export type PaymentFormType = {
  id: string;
  code: string;
  description: string;
  direction: TransactionTypeKind;
  kind: PaymentKind;
};

/** The form saved for a payment type, or the standard one. A saved form that no longer reads is replaced by the standard one. */
export async function savedPaymentLayout(organisationId: string, type: PaymentFormType): Promise<{ layout: PaymentFormLayout; custom: boolean; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transaction_forms")
    .select("layout")
    .eq("organisation_id", organisationId)
    .eq("transaction_type_id", type.id)
    .maybeSingle();
  if (error) return { layout: defaultPaymentLayout(type.kind), custom: false, error: "The form layout could not be loaded." };
  if (!data) return { layout: defaultPaymentLayout(type.kind), custom: false, error: null };
  return { layout: parsePaymentLayout(data.layout, type.kind), custom: true, error: null };
}

/** The payment type with this code, if there is one. A system type is never offered. */
export async function getPaymentFormType(code: string): Promise<{ type: PaymentFormType | null; error: string | null }> {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return { type: null, error: null };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transaction_types")
    .select("id, code, description, type, document_kind")
    .eq("organisation_id", workspace.current.organisationId)
    .eq("code", code.trim().toUpperCase())
    .eq("is_system", false)
    .maybeSingle();
  if (error) return { type: null, error: "That form could not be loaded." };
  const direction = data ? parseTransactionTypeKind(data.type) : null;
  if (!data || !direction || !isPaymentKind(data.document_kind)) return { type: null, error: null };
  return { type: { id: data.id, code: data.code, description: data.description, direction, kind: data.document_kind }, error: null };
}

/**
 * The payment of this type and id as it prints, with what it needs to be laid out. Without an id it is the latest payment
 * of the type, or a sample when there is none, which is what the form designer previews. A payment prints with the
 * organisation's details as they are now: unlike an invoice it keeps no copy of them when it is posted.
 */
export async function loadPaymentPrintSource(
  code: string,
  id: string | null,
): Promise<{ isPaymentType: boolean; type: PaymentFormType | null; source: PaymentPrintSource | null; sample: boolean; error: string | null }> {
  const none = { isPaymentType: false, type: null, source: null, sample: false, error: null };
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return none;
  const organisationId = workspace.current.organisationId;
  const supabase = await createClient();

  const typeResult = await getPaymentFormType(code);
  if (typeResult.error) return { ...none, error: "That payment could not be printed." };
  if (!typeResult.type) return none;
  const { direction, kind } = typeResult.type;
  const found = { isPaymentType: true, type: typeResult.type };

  const loaded = await loadPaymentRows(supabase, organisationId, id ? { paymentId: id } : { typeId: typeResult.type.id });
  if (loaded.error) return { ...found, source: null, sample: false, error: "That payment could not be printed." };
  const payment = loaded.rows[0];
  if (!payment && id) return { ...found, source: null, sample: false, error: null };
  if (payment && payment.transactionTypeId !== typeResult.type.id) return { ...found, source: null, sample: false, error: null };
  if (!payment) {
    const details = await organisationDetails(organisationId, workspace.current.organisationName);
    return { ...found, source: samplePaymentSource(kind, direction, details.organisation, details.currencyCode), sample: true, error: null };
  }

  // The allocations a payment shows depend on where it stands: what it has planned while a draft, what it settles once
  // posted, and what it settled before it was voided (removed with the reason it was voided for).
  const shown = payment.allocations.filter((line) =>
    payment.status === "draft"
      ? line.pending && !line.removedAt
      : payment.status === "posted"
        ? !line.pending && !line.removedAt
        : Boolean(line.removedAt) && line.removalReason === payment.voidReason,
  );

  const partyTable = direction === "Sales" ? "customers" : "suppliers";
  const documentIds = [...new Set(shown.map((line) => line.documentId))];
  const [details, party, means, bank, totals] = await Promise.all([
    organisationDetails(organisationId, workspace.current.organisationName),
    supabase
      .from(partyTable)
      .select("name, address_line1, address_line2, address_line3, city, post_code, county, country_code, vat_number, ref_countries(name)")
      .eq("id", payment.partyId)
      .eq("organisation_id", organisationId)
      .maybeSingle(),
    supabase.from("ref_payment_means").select("code, name").eq("code", payment.paymentMeansCode).maybeSingle(),
    payment.bankAccountId
      ? supabase.from("bank_accounts").select("code, name, iban").eq("id", payment.bankAccountId).eq("organisation_id", organisationId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    documentIds.length
      ? supabase.from("transaction_headers").select("id, foreign_total_amount, rounding_amount").eq("organisation_id", organisationId).in("id", documentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (party.error || means.error || bank.error || totals.error) return { ...found, source: null, sample: false, error: "That payment could not be printed." };

  const partyRow = (party.data ?? {}) as Loose;
  const country = one(partyRow.ref_countries as { name?: string } | { name?: string }[] | null);
  const partyAddressLines = formatPostalAddress({
      line1: text(partyRow.address_line1),
      line2: text(partyRow.address_line2),
      line3: text(partyRow.address_line3),
      city: text(partyRow.city),
      county: text(partyRow.county),
      postCode: text(partyRow.post_code),
      countryName: text(country?.name) || text(partyRow.country_code),
    }).split("\n").filter(Boolean);

  const documentTotal = new Map((totals.data ?? []).map((row) => [row.id, numberValue(row.foreign_total_amount) + numberValue(row.rounding_amount)]));
  const bankRow = bank.data as { code: string; name: string; iban: string } | null;
  const source: PaymentPrintSource = {
    kind,
    direction,
    status: payment.status,
    documentNumber: payment.documentNumber,
    paymentDate: payment.paymentDate,
    organisation: details.organisation,
    partyName: payment.partyName,
    partyAddressLines,
    partyVatNumber: text(partyRow.vat_number),
    currencyCode: payment.currencyCode,
    amount: numberValue(payment.amount),
    meansLabel: means.data ? `${means.data.code} ${means.data.name}` : "",
    bankReference: payment.bankReference,
    bankAccount: bankRow ? `${bankRow.code} ${bankRow.name}${bankRow.iban ? `, ${formatIban(bankRow.iban)}` : ""}` : "",
    notes: payment.notes,
    voidReason: payment.voidReason,
    allocations: shown.map((line) => ({
      documentNumber: line.documentNumber,
      date: line.documentDate,
      total: documentTotal.get(line.documentId) ?? 0,
      applied: numberValue(line.amount),
    })),
  };
  return { ...found, source, sample: false, error: null };
}

/** The payment of this type and id, as it prints from the form saved for its type. */
export async function loadPrintedPayment(
  code: string,
  id: string,
): Promise<{ isPaymentType: boolean; typeCode: string; view: PaymentPrintView | null; error: string | null }> {
  const loaded = await loadPaymentPrintSource(code, id);
  const typeCode = loaded.type?.code ?? code;
  if (loaded.error || !loaded.type || !loaded.source) return { isPaymentType: loaded.isPaymentType, typeCode, view: null, error: loaded.error };
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return { isPaymentType: true, typeCode, view: null, error: null };
  const stored = await savedPaymentLayout(workspace.current.organisationId, loaded.type);
  if (stored.error) return { isPaymentType: true, typeCode, view: null, error: "That payment could not be printed." };
  return { isPaymentType: true, typeCode, view: buildPaymentPrint(loaded.source, stored.layout), error: null };
}
