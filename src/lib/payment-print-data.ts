import { formatPostalAddress } from "@/lib/address";
import { getWorkspace } from "@/lib/data";
import { formatIban } from "@/lib/bank-accounts";
import { organisationDetails } from "@/lib/form-data";
import { numberValue } from "@/lib/numbers";
import { loadPaymentRows } from "@/lib/payment-data";
import { buildPaymentPrint, type PaymentPrintSource, type PaymentPrintView } from "@/lib/payment-print";
import { createClient } from "@/lib/supabase/server";
import { isPaymentKind, parseTransactionTypeKind } from "@/lib/transaction-types";

type Loose = Record<string, unknown>;

function text(value: unknown) {
  return value == null ? "" : String(value);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * The payment or receipt of this type and id, as it prints. `isPaymentType` tells the print page whether the address
 * is for a payment at all, so it can leave anything else to the document printer. A payment prints with the
 * organisation's details as they are now: unlike an invoice it keeps no copy of them when it is posted.
 */
export async function loadPrintedPayment(
  code: string,
  id: string,
): Promise<{ isPaymentType: boolean; typeCode: string; view: PaymentPrintView | null; error: string | null }> {
  const none = { isPaymentType: false, typeCode: code, view: null, error: null };
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return none;
  const organisationId = workspace.current.organisationId;
  const supabase = await createClient();

  const typeResult = await supabase
    .from("transaction_types")
    .select("id, code, type, document_kind")
    .eq("organisation_id", organisationId)
    .eq("code", code.trim().toUpperCase())
    .eq("is_system", false)
    .maybeSingle();
  if (typeResult.error) return { ...none, error: "That payment could not be printed." };
  const direction = typeResult.data ? parseTransactionTypeKind(typeResult.data.type) : null;
  const kind = typeResult.data?.document_kind;
  if (!typeResult.data || !direction || !isPaymentKind(kind)) return none;
  const found = { isPaymentType: true, typeCode: typeResult.data.code };

  const loaded = await loadPaymentRows(supabase, organisationId, { paymentId: id });
  if (loaded.error) return { ...found, view: null, error: "That payment could not be printed." };
  const payment = loaded.rows[0];
  if (!payment || payment.transactionTypeId !== typeResult.data.id) return { ...found, view: null, error: null };

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
  if (party.error || means.error || bank.error || totals.error) return { ...found, view: null, error: "That payment could not be printed." };

  const partyRow = (party.data ?? {}) as Loose;
  const country = one(partyRow.ref_countries as { name?: string } | { name?: string }[] | null);
  const partyLines = [
    ...formatPostalAddress({
      line1: text(partyRow.address_line1),
      line2: text(partyRow.address_line2),
      line3: text(partyRow.address_line3),
      city: text(partyRow.city),
      county: text(partyRow.county),
      postCode: text(partyRow.post_code),
      countryName: text(country?.name) || text(partyRow.country_code),
    }).split("\n"),
    partyRow.vat_number ? `VAT ID: ${text(partyRow.vat_number)}` : "",
  ].filter(Boolean);

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
    partyLines,
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
  return { ...found, view: buildPaymentPrint(source), error: null };
}
