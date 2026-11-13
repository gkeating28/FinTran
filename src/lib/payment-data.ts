import { getOrganisationScope, getWorkspace } from "@/lib/data";
import { formatMoney } from "@/lib/documents";
import { formatCurrencyRate } from "@/lib/currencies";
import { numberValue } from "@/lib/numbers";
import {
  targetKindFor,
  type AllocationLine,
  type DocumentAllocation,
  type DocumentPayments,
  type OpenItem,
  type PaymentChoices,
  type PaymentRow,
  type PaymentStatus,
  type TargetKind,
} from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";
import { canManage } from "@/lib/types";
import { isPaymentKind, parseTransactionTypeKind, type TransactionTypeKind } from "@/lib/transaction-types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const READ_ERROR = "Payments could not be loaded.";

function status(value: string): PaymentStatus {
  return value === "posted" || value === "void" ? value : "draft";
}

/** The posted documents of one party that still have something due, oldest due date first. */
export async function listOpenItems(
  supabase: Supabase,
  organisationId: string,
  query: { direction: TransactionTypeKind; targetKind: TargetKind; partyId: string },
): Promise<{ items: OpenItem[]; error: string | null }> {
  const partyTable = query.direction === "Sales" ? "customers" : "suppliers";
  const partyColumn = query.direction === "Sales" ? "customer_id" : "supplier_id";
  const [party, types] = await Promise.all([
    supabase.from(partyTable).select("currency_id").eq("id", query.partyId).eq("organisation_id", organisationId).maybeSingle(),
    supabase
      .from("transaction_types")
      .select("id")
      .eq("organisation_id", organisationId)
      .eq("type", query.direction)
      .eq("document_kind", query.targetKind),
  ]);
  if (party.error || types.error) return { items: [], error: READ_ERROR };
  if (!party.data) return { items: [], error: null };
  const typeIds = (types.data ?? []).map((row) => row.id);
  if (typeIds.length === 0) return { items: [], error: null };

  const { data, error } = await supabase
    .from("transaction_headers")
    .select("id, document_number, reference, transaction_date, due_date, foreign_total_amount, rounding_amount, paid_amount")
    .eq("organisation_id", organisationId)
    .eq("status", "posted")
    .eq(partyColumn, query.partyId)
    .eq("currency_id", party.data.currency_id)
    .in("transaction_type_id", typeIds);
  if (error) return { items: [], error: READ_ERROR };

  const items = (data ?? [])
    .map((row) => {
      const open = Math.round((numberValue(row.foreign_total_amount) + numberValue(row.rounding_amount) - numberValue(row.paid_amount)) * 100) / 100;
      return {
        id: row.id,
        documentNumber: row.document_number ?? String(row.reference ?? ""),
        date: row.transaction_date,
        dueDate: row.due_date ?? "",
        total: formatMoney(row.foreign_total_amount),
        open: open.toFixed(2),
        kind: query.targetKind,
      } satisfies OpenItem;
    })
    .filter((item) => Number(item.open) > 0)
    .sort((left, right) => (left.dueDate || "9999-12-31").localeCompare(right.dueDate || "9999-12-31") || left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  return { items, error: null };
}

/** The allocations of the given payments, with the document each settles and who made or removed them. */
async function loadAllocations(supabase: Supabase, organisationId: string, paymentIds: string[]) {
  const byPayment = new Map<string, AllocationLine[]>();
  if (paymentIds.length === 0) return { byPayment, error: null as string | null };
  const { data, error } = await supabase
    .from("allocations")
    .select("id, source_payment_id, target_header_id, amount, allocation_date, exchange_difference, pending, removed_at, removal_reason, removed_by, created_by, created_at")
    .eq("organisation_id", organisationId)
    .in("source_payment_id", paymentIds)
    .order("created_at");
  if (error) return { byPayment, error: READ_ERROR };

  const targetIds = [...new Set((data ?? []).map((row) => row.target_header_id))];
  const personIds = [...new Set((data ?? []).flatMap((row) => [row.created_by, row.removed_by]).filter((id): id is string => Boolean(id)))];
  const [targets, people] = await Promise.all([
    targetIds.length
      ? supabase.from("transaction_headers").select("id, document_number, reference, transaction_date").in("id", targetIds)
      : Promise.resolve({ data: [], error: null }),
    personIds.length
      ? supabase.from("profiles").select("id, display_name").in("id", personIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (targets.error) return { byPayment, error: READ_ERROR };
  const document = new Map((targets.data ?? []).map((row) => [row.id, row]));
  const person = new Map((people.data ?? []).map((row) => [row.id, row.display_name]));

  for (const row of data ?? []) {
    if (!row.source_payment_id) continue;
    const target = document.get(row.target_header_id);
    const line: AllocationLine = {
      id: row.id,
      documentId: row.target_header_id,
      documentNumber: target?.document_number ?? String(target?.reference ?? ""),
      documentDate: target?.transaction_date ?? "",
      date: row.allocation_date,
      amount: formatMoney(row.amount),
      exchangeDifference: formatMoney(row.exchange_difference),
      pending: row.pending,
      removedAt: row.removed_at ?? "",
      removalReason: row.removal_reason ?? "",
      removedByName: row.removed_by ? (person.get(row.removed_by) ?? "") : "",
      byName: row.created_by ? (person.get(row.created_by) ?? "") : "",
    };
    byPayment.set(row.source_payment_id, [...(byPayment.get(row.source_payment_id) ?? []), line]);
  }
  return { byPayment, error: null as string | null };
}

/** One payment as the list and the open form show it, with its allocations. */
export async function loadPaymentRows(
  supabase: Supabase,
  organisationId: string,
  filter: { typeId?: string; paymentId?: string },
): Promise<{ rows: PaymentRow[]; error: string | null }> {
  let query = supabase
    .from("payments")
    .select(
      "id, transaction_type_id, status, source, document_number, payment_date, customer_id, supplier_id, party_name, bank_account_id, currency_id, exchange_rate, amount, allocated_amount, unallocated_amount, payment_means_code, bank_reference, notes, void_reason, created_at",
    )
    .eq("organisation_id", organisationId)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (filter.typeId) query = query.eq("transaction_type_id", filter.typeId);
  if (filter.paymentId) query = query.eq("id", filter.paymentId);

  const [payments, accounts, currencies] = await Promise.all([
    query,
    supabase.from("bank_accounts").select("id, code, name").eq("organisation_id", organisationId),
    supabase.from("currencies").select("id, code").eq("organisation_id", organisationId),
  ]);
  if (payments.error || accounts.error || currencies.error) return { rows: [], error: READ_ERROR };

  const ids = (payments.data ?? []).map((row) => row.id);
  const allocations = await loadAllocations(supabase, organisationId, ids);
  if (allocations.error) return { rows: [], error: allocations.error };
  const bank = new Map((accounts.data ?? []).map((row) => [row.id, `${row.code} ${row.name}`]));
  const currency = new Map((currencies.data ?? []).map((row) => [row.id, row.code]));

  return {
    rows: (payments.data ?? []).map((row) => ({
      id: row.id,
      transactionTypeId: row.transaction_type_id,
      status: status(row.status),
      source: row.source === "migrated" ? "migrated" : "manual",
      documentNumber: row.document_number ?? "",
      paymentDate: row.payment_date,
      partyId: row.customer_id ?? row.supplier_id ?? "",
      partyName: row.party_name,
      bankAccountId: row.bank_account_id ?? "",
      bankAccountLabel: row.bank_account_id ? (bank.get(row.bank_account_id) ?? "") : "",
      currencyId: row.currency_id,
      currencyCode: currency.get(row.currency_id) ?? "",
      exchangeRate: formatCurrencyRate(row.exchange_rate),
      amount: formatMoney(row.amount),
      allocatedAmount: formatMoney(row.allocated_amount),
      unallocatedAmount: formatMoney(row.unallocated_amount),
      paymentMeansCode: row.payment_means_code,
      bankReference: row.bank_reference ?? "",
      notes: row.notes ?? "",
      voidReason: row.void_reason ?? "",
      allocations: allocations.byPayment.get(row.id) ?? [],
    })),
    error: null,
  };
}

/** The page of one payment or receipt type: its payments, and what the form needs to enter one. */
export async function listPayments(typeCode: string): Promise<{
  rows: PaymentRow[];
  choices: PaymentChoices | null;
  error: string | null;
}> {
  const organisationId = await getOrganisationScope();
  if (!organisationId) return { rows: [], choices: null, error: null };
  const workspace = await getWorkspace();
  const supabase = await createClient();

  const typeResult = await supabase
    .from("transaction_types")
    .select("id, code, description, type, document_kind")
    .eq("organisation_id", organisationId)
    .eq("code", typeCode.trim().toUpperCase())
    .eq("is_system", false)
    .maybeSingle();
  if (typeResult.error) return { rows: [], choices: null, error: READ_ERROR };
  const direction = typeResult.data ? parseTransactionTypeKind(typeResult.data.type) : null;
  const kind = typeResult.data?.document_kind;
  if (!typeResult.data || !direction || !isPaymentKind(kind)) return { rows: [], choices: null, error: null };

  const partyTable = direction === "Sales" ? "customers" : "suppliers";
  const [parties, accounts, currencies, defaults, means, loaded] = await Promise.all([
    supabase.from(partyTable).select("id, code, name, currency_id").eq("organisation_id", organisationId).order("code"),
    supabase.from("bank_accounts").select("id, code, name, currency_id, active, is_default").eq("organisation_id", organisationId).order("code"),
    supabase.from("currencies").select("id, code, rate").eq("organisation_id", organisationId).order("code"),
    supabase.from("organisation_defaults").select("home_currency_id").eq("organisation_id", organisationId).maybeSingle(),
    supabase.from("ref_payment_means").select("code, name, common").order("common", { ascending: false }).order("code"),
    loadPaymentRows(supabase, organisationId, { typeId: typeResult.data.id }),
  ]);
  if (parties.error || accounts.error || currencies.error || defaults.error || means.error) {
    return { rows: [], choices: null, error: READ_ERROR };
  }
  if (loaded.error) return { rows: [], choices: null, error: loaded.error };

  return {
    rows: loaded.rows,
    choices: {
      type: {
        id: typeResult.data.id,
        code: typeResult.data.code,
        description: typeResult.data.description,
        direction,
        kind,
      },
      parties: (parties.data ?? []).map((row) => ({ id: row.id, code: row.code, name: row.name, currencyId: row.currency_id })),
      bankAccounts: (accounts.data ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        currencyId: row.currency_id,
        active: row.active,
        isDefault: row.is_default,
      })),
      currencies: (currencies.data ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        rate: formatCurrencyRate(row.rate),
        home: row.id === defaults.data?.home_currency_id,
      })),
      paymentMeans: (means.data ?? []).map((row) => ({ code: row.code, name: row.name, common: row.common })),
      canVoid: workspace.status === "ready" && canManage(workspace.current.role),
    },
    error: null,
  };
}

/** The kind of document a payment of this type settles, for the open items panel. */
export function targetKindOfType(kind: "payment" | "receipt", direction: TransactionTypeKind) {
  return targetKindFor(kind, direction);
}

/** The Payments tab of one posted invoice or credit note: what settled it, what is open, and what can be raised from it. */
export async function loadDocumentPayments(
  supabase: Supabase,
  organisationId: string,
  headerId: string,
): Promise<{ data: DocumentPayments | null; error: string | null }> {
  const header = await supabase
    .from("transaction_headers")
    .select("id, status, transaction_type_id, customer_id, supplier_id, currency_id, foreign_total_amount, rounding_amount, paid_amount, amount_due")
    .eq("organisation_id", organisationId)
    .eq("id", headerId)
    .maybeSingle();
  if (header.error) return { data: null, error: READ_ERROR };
  if (!header.data || header.data.status !== "posted") return { data: null, error: null };

  const [type, currency] = await Promise.all([
    supabase.from("transaction_types").select("type, document_kind").eq("id", header.data.transaction_type_id).maybeSingle(),
    supabase.from("currencies").select("code").eq("id", header.data.currency_id).maybeSingle(),
  ]);
  const direction = type.data ? parseTransactionTypeKind(type.data.type) : null;
  const kind = type.data?.document_kind;
  if (type.error || currency.error || !direction || (kind !== "invoice" && kind !== "credit_note")) return { data: null, error: null };
  const partyId = (direction === "Sales" ? header.data.customer_id : header.data.supplier_id) ?? "";

  const [rows, types] = await Promise.all([
    supabase
      .from("allocations")
      .select("id, source_payment_id, source_header_id, target_header_id, amount, allocation_date, exchange_difference, pending, removed_at, removal_reason, removed_by, created_by, created_at")
      .eq("organisation_id", organisationId)
      .eq("pending", false)
      .or(`target_header_id.eq.${headerId},source_header_id.eq.${headerId}`)
      .order("created_at"),
    supabase
      .from("transaction_types")
      .select("id, code, description, type, document_kind")
      .eq("organisation_id", organisationId)
      .eq("type", direction)
      .eq("is_system", false)
      .order("code"),
  ]);
  if (rows.error || types.error) return { data: null, error: READ_ERROR };

  const paymentIds = [...new Set((rows.data ?? []).flatMap((row) => (row.source_payment_id ? [row.source_payment_id] : [])))];
  const headerIds = [...new Set((rows.data ?? []).flatMap((row) => [row.source_header_id, row.target_header_id]).filter((id): id is string => Boolean(id) && id !== headerId))];
  const personIds = [...new Set((rows.data ?? []).flatMap((row) => [row.created_by, row.removed_by]).filter((id): id is string => Boolean(id)))];
  const [payments, others, people] = await Promise.all([
    paymentIds.length ? supabase.from("payments").select("id, document_number").in("id", paymentIds) : Promise.resolve({ data: [], error: null }),
    headerIds.length ? supabase.from("transaction_headers").select("id, document_number, reference").in("id", headerIds) : Promise.resolve({ data: [], error: null }),
    personIds.length ? supabase.from("profiles").select("id, display_name").in("id", personIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (payments.error || others.error || people.error) return { data: null, error: READ_ERROR };
  const paymentNumber = new Map((payments.data ?? []).map((row) => [row.id, row.document_number ?? ""]));
  const headerNumber = new Map((others.data ?? []).map((row) => [row.id, row.document_number ?? String(row.reference ?? "")]));
  const person = new Map((people.data ?? []).map((row) => [row.id, row.display_name]));

  const allocations = (rows.data ?? []).map((row): DocumentAllocation => {
    const settledBy = row.target_header_id === headerId;
    const otherId = settledBy ? (row.source_payment_id ?? row.source_header_id ?? "") : row.target_header_id;
    const otherKind = settledBy ? (row.source_payment_id ? "payment" : "credit_note") : "invoice";
    return {
      id: row.id,
      role: settledBy ? "settled-by" : "applied-to",
      otherKind,
      otherId,
      otherNumber: (row.source_payment_id && settledBy ? paymentNumber.get(row.source_payment_id) : headerNumber.get(otherId)) ?? "",
      date: row.allocation_date,
      amount: formatMoney(row.amount),
      exchangeDifference: formatMoney(row.exchange_difference),
      removedAt: row.removed_at ?? "",
      removalReason: row.removal_reason ?? "",
      removedByName: row.removed_by ? (person.get(row.removed_by) ?? "") : "",
      byName: row.created_by ? (person.get(row.created_by) ?? "") : "",
      createdAt: row.created_at,
    };
  });

  const open = Math.round(numberValue(header.data.amount_due) * 100) / 100;
  const recordTypes = (types.data ?? []).flatMap((row) =>
    isPaymentKind(row.document_kind) && targetKindFor(row.document_kind, direction) === kind
      ? [{ id: row.id, code: row.code, description: row.description, kind: row.document_kind }]
      : [],
  );
  const openInvoices =
    kind === "credit_note" && open > 0 && partyId
      ? (await listOpenItems(supabase, organisationId, { direction, targetKind: "invoice", partyId })).items
      : [];

  return {
    data: {
      documentId: headerId,
      kind,
      direction,
      partyId,
      currencyCode: currency.data?.code ?? "",
      total: formatMoney(numberValue(header.data.foreign_total_amount) + numberValue(header.data.rounding_amount)),
      paid: formatMoney(header.data.paid_amount),
      open: open.toFixed(2),
      allocations,
      recordTypes,
      openInvoices,
    },
    error: null,
  };
}
