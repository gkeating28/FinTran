import { getOrganisationScope } from "@/lib/data";
import type { PaymentRunRow, RunChoices, RunInvoice, RunPayment, RunStatus, RunnableInvoice } from "@/lib/payment-runs";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

function embedded(value: unknown) {
  return (Array.isArray(value) ? value[0] : value) as Row | undefined;
}

function money(value: unknown) {
  return Number(value ?? 0).toFixed(2);
}

/** The payment runs of the open organisation with their payments and what each pays, newest first. */
export async function listPaymentRuns(): Promise<{ rows: PaymentRunRow[]; choices: RunChoices; error: string | null }> {
  const empty = { rows: [], choices: { types: [], bankAccounts: [], canCreate: false }, error: null };
  const organisationId = await getOrganisationScope();
  if (!organisationId) return empty;

  const supabase = await createClient();
  const [runs, types, banks] = await Promise.all([
    supabase
      .from("payment_runs")
      .select("id, document_number, status, payment_date, transaction_type_id, bank_account_id, notes, transaction_types(code), bank_accounts(code, name), currencies(code)")
      .eq("organisation_id", organisationId)
      .order("reference", { ascending: false })
      .limit(200),
    supabase
      .from("transaction_types")
      .select("id, code, description")
      .eq("organisation_id", organisationId)
      .eq("type", "Purchases")
      .eq("document_kind", "payment")
      .order("code"),
    supabase
      .from("bank_accounts")
      .select("id, code, name, is_default, currencies(code)")
      .eq("organisation_id", organisationId)
      .eq("active", true)
      .order("code"),
  ]);
  if (runs.error || types.error || banks.error) return { ...empty, error: "Payment runs could not be loaded." };

  const runIds = (runs.data ?? []).map((run) => String(run.id));
  const payments = runIds.length
    ? await supabase
        .from("payments")
        .select("id, payment_run_id, supplier_id, party_name, amount, document_number, status")
        .eq("organisation_id", organisationId)
        .in("payment_run_id", runIds)
        .order("party_name")
    : { data: [] as Row[], error: null };
  if (payments.error) return { ...empty, error: "Payment runs could not be loaded." };
  const paymentIds = ((payments.data ?? []) as Row[]).map((payment) => String(payment.id));
  const supplierIds = [...new Set(((payments.data ?? []) as Row[]).map((payment) => String(payment.supplier_id ?? "")).filter(Boolean))];
  const [allocations, suppliers] = await Promise.all([
    paymentIds.length
      ? supabase
          .from("allocations")
          .select("source_payment_id, target_header_id, amount")
          .eq("organisation_id", organisationId)
          .in("source_payment_id", paymentIds)
          .is("removed_at", null)
      : Promise.resolve({ data: [] as Row[], error: null }),
    supplierIds.length
      ? supabase.from("suppliers").select("id, iban, bic, bank_account_name").eq("organisation_id", organisationId).in("id", supplierIds)
      : Promise.resolve({ data: [] as Row[], error: null }),
  ]);
  if (allocations.error || suppliers.error) return { ...empty, error: "Payment runs could not be loaded." };
  const targetIds = [...new Set(((allocations.data ?? []) as Row[]).map((line) => String(line.target_header_id)))];
  const headers = targetIds.length
    ? await supabase
        .from("transaction_headers")
        .select("id, document_number, reference, transaction_types(code)")
        .eq("organisation_id", organisationId)
        .in("id", targetIds)
    : { data: [] as Row[], error: null };
  if (headers.error) return { ...empty, error: "Payment runs could not be loaded." };
  const headerById = new Map(((headers.data ?? []) as Row[]).map((header) => [String(header.id), header]));
  const supplierById = new Map(((suppliers.data ?? []) as Row[]).map((supplier) => [String(supplier.id), supplier]));

  const invoicesOf = new Map<string, RunInvoice[]>();
  for (const line of (allocations.data ?? []) as Row[]) {
    const header = headerById.get(String(line.target_header_id));
    const list = invoicesOf.get(String(line.source_payment_id)) ?? [];
    list.push({
      id: String(line.target_header_id),
      number: String(header?.document_number ?? header?.reference ?? "Invoice"),
      typeCode: String(embedded(header?.transaction_types)?.code ?? ""),
      amount: money(line.amount),
    });
    invoicesOf.set(String(line.source_payment_id), list);
  }
  const paymentsOf = new Map<string, RunPayment[]>();
  for (const payment of (payments.data ?? []) as Row[]) {
    const supplier = supplierById.get(String(payment.supplier_id));
    const list = paymentsOf.get(String(payment.payment_run_id)) ?? [];
    list.push({
      id: String(payment.id),
      supplierId: String(payment.supplier_id ?? ""),
      supplierName: String(payment.party_name ?? ""),
      amount: money(payment.amount),
      documentNumber: String(payment.document_number ?? ""),
      status: payment.status === "posted" || payment.status === "void" ? payment.status : "draft",
      iban: String(supplier?.iban ?? ""),
      bic: String(supplier?.bic ?? ""),
      bankAccountName: String(supplier?.bank_account_name ?? ""),
      invoices: invoicesOf.get(String(payment.id)) ?? [],
    });
    paymentsOf.set(String(payment.payment_run_id), list);
  }

  const rows: PaymentRunRow[] = ((runs.data ?? []) as Row[]).map((run) => {
    const list = paymentsOf.get(String(run.id)) ?? [];
    const bank = embedded(run.bank_accounts);
    return {
      id: String(run.id),
      documentNumber: String(run.document_number),
      status: (["draft", "posted", "cancelled"] as const).find((item): item is RunStatus => item === run.status) ?? "draft",
      paymentDate: String(run.payment_date),
      typeId: String(run.transaction_type_id),
      typeCode: String(embedded(run.transaction_types)?.code ?? ""),
      bankAccountId: String(run.bank_account_id),
      bankAccountLabel: `${String(bank?.code ?? "")} ${String(bank?.name ?? "")}`.trim(),
      currencyCode: String(embedded(run.currencies)?.code ?? ""),
      notes: String(run.notes ?? ""),
      total: (list.reduce((sum, payment) => sum + Math.round(Number(payment.amount) * 100), 0) / 100).toFixed(2),
      payments: list,
    };
  });

  const choices: RunChoices = {
    types: ((types.data ?? []) as Row[]).map((type) => ({ id: String(type.id), code: String(type.code), description: String(type.description) })),
    bankAccounts: ((banks.data ?? []) as Row[]).map((bank) => ({
      id: String(bank.id),
      code: String(bank.code),
      name: String(bank.name),
      currencyCode: String(embedded(bank.currencies)?.code ?? ""),
      isDefault: Boolean(bank.is_default),
    })),
    canCreate: true,
  };
  return { rows, choices, error: null };
}

/** Posted purchase invoices that still have something open, in the currency of the bank account, and are not in a draft run. */
export async function listRunnableInvoices(organisationId: string, bankAccountId: string): Promise<{ invoices: RunnableInvoice[]; error: string | null }> {
  const supabase = await createClient();
  const bank = await supabase.from("bank_accounts").select("currency_id").eq("id", bankAccountId).eq("organisation_id", organisationId).maybeSingle();
  if (bank.error) return { invoices: [], error: "Invoices could not be loaded." };
  if (!bank.data) return { invoices: [], error: null };

  const [headers, reserved] = await Promise.all([
    supabase
      .from("transaction_headers")
      .select("id, document_number, reference, party_name, supplier_id, transaction_date, due_date, foreign_total_amount, rounding_amount, paid_amount, transaction_types!inner(code, type, document_kind)")
      .eq("organisation_id", organisationId)
      .eq("status", "posted")
      .eq("currency_id", bank.data.currency_id)
      .eq("transaction_types.type", "Purchases")
      .eq("transaction_types.document_kind", "invoice")
      .not("supplier_id", "is", null)
      .order("due_date", { ascending: true })
      .limit(1000),
    supabase
      .from("allocations")
      .select("target_header_id, payments!allocations_source_payment_fkey!inner(payment_run_id, status)")
      .eq("organisation_id", organisationId)
      .eq("pending", true)
      .not("payments.payment_run_id", "is", null)
      .eq("payments.status", "draft"),
  ]);
  if (headers.error) return { invoices: [], error: "Invoices could not be loaded." };
  const inRun = new Set(((reserved.error ? [] : reserved.data) as Row[]).map((line) => String(line.target_header_id)));

  const invoices: RunnableInvoice[] = [];
  for (const row of (headers.data ?? []) as Row[]) {
    const open = Math.round((Number(row.foreign_total_amount ?? 0) + Number(row.rounding_amount ?? 0) - Number(row.paid_amount ?? 0)) * 100) / 100;
    if (!(open > 0) || inRun.has(String(row.id))) continue;
    invoices.push({
      id: String(row.id),
      number: String(row.document_number ?? row.reference ?? "Invoice"),
      typeCode: String(embedded(row.transaction_types)?.code ?? ""),
      supplierId: String(row.supplier_id),
      supplierName: String(row.party_name ?? ""),
      date: String(row.transaction_date ?? ""),
      dueDate: String(row.due_date ?? ""),
      open: open.toFixed(2),
    });
  }
  return { invoices, error: null };
}

