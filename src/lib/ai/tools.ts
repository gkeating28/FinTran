import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient;
type Row = Record<string, unknown>;

function text(value: unknown) {
  return value == null ? "" : String(value);
}

function money(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

function rowsOf(value: unknown) {
  return Array.isArray(value) ? (value as Row[]).slice(0, 25) : [];
}

export function agingBands(documents: Row[], asOf = new Date().toISOString().slice(0, 10)) {
  const today = Date.parse(asOf);
  const parties = new Map<string, { current: number; d30: number; d60: number; d90: number; over: number }>();
  for (const document of documents) {
    const name = text(document.party_name) || "Unknown";
    const due = Date.parse(text(document.due_date));
    const amount = Number(document.amount_due ?? 0);
    if (!Number.isFinite(amount)) continue;
    const days = Number.isNaN(due) ? 0 : Math.floor((today - due) / 86_400_000);
    const band = parties.get(name) ?? { current: 0, d30: 0, d60: 0, d90: 0, over: 0 };
    if (days <= 0) band.current += amount;
    else if (days <= 30) band.d30 += amount;
    else if (days <= 60) band.d60 += amount;
    else if (days <= 90) band.d90 += amount;
    else band.over += amount;
    parties.set(name, band);
  }
  return [...parties.entries()].slice(0, 25).map(([party, band]) => ({
    party,
    current: band.current.toFixed(2),
    days0to30: band.d30.toFixed(2),
    days31to60: band.d60.toFixed(2),
    days61to90: band.d90.toFixed(2),
    over90: band.over.toFixed(2),
  }));
}

export function periodTotals(documents: Row[], grain: "month" | "quarter" = "month") {
  const groups = new Map<string, { nett: number; vat: number; total: number }>();
  for (const document of documents) {
    const date = text(document.transaction_date);
    const key = grain === "quarter" && date.length >= 7
      ? `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`
      : date.slice(0, 7);
    const group = groups.get(key) ?? { nett: 0, vat: 0, total: 0 };
    group.nett += Number(document.foreign_nett_amount ?? 0);
    group.vat += Number(document.foreign_vat_amount ?? 0);
    group.total += Number(document.foreign_total_amount ?? 0);
    groups.set(key, group);
  }
  return [...groups.entries()].slice(0, 25).map(([period, group]) => ({
    period,
    nett: group.nett.toFixed(2),
    vat: group.vat.toFixed(2),
    total: group.total.toFixed(2),
  }));
}

function typeName(document: Row) {
  const type = document.transaction_types;
  if (Array.isArray(type)) return text((type[0] as Row | undefined)?.type);
  return text((type as Row | undefined)?.type);
}

function matchesDirection(document: Row, direction: unknown) {
  if (!direction) return true;
  return typeName(document).toLowerCase() === String(direction).toLowerCase();
}

function within(document: Row, input: Record<string, unknown>) {
  const date = text(document.transaction_date || document.issue_date);
  if (input.from && date < String(input.from)) return false;
  if (input.to && date > String(input.to)) return false;
  const amount = Number(document.amount_due ?? document.foreign_total_amount ?? document.total_amount ?? 0);
  if (input.minAmount != null && amount < Number(input.minAmount)) return false;
  if (input.maxAmount != null && amount > Number(input.maxAmount)) return false;
  return true;
}

export async function runAskTool(supabase: Client, organisationId: string, name: string, input: Record<string, unknown>) {
  if (name === "search_parties") {
    const term = String(input.name ?? input.code ?? input.vat ?? input.peppol ?? "").trim();
    const pattern = `%${term}%`;
    const [customers, suppliers] = await Promise.all([
      supabase.from("customers").select("id, code, name, vat_number, peppol_scheme, peppol_id").eq("organisation_id", organisationId).or(`name.ilike.${pattern},code.ilike.${pattern},vat_number.ilike.${pattern},peppol_id.ilike.${pattern}`).limit(25),
      supabase.from("suppliers").select("id, code, name, vat_number, peppol_scheme, peppol_id").eq("organisation_id", organisationId).or(`name.ilike.${pattern},code.ilike.${pattern},vat_number.ilike.${pattern},peppol_id.ilike.${pattern}`).limit(25),
    ]);
    return { customers: rowsOf(customers.data), suppliers: rowsOf(suppliers.data) };
  }

  if (name === "search_transactions" || name === "get_transaction") {
    let query = supabase.from("transaction_headers").select("id, document_number, status, party_name, transaction_date, due_date, amount_due, foreign_nett_amount, foreign_vat_amount, foreign_total_amount, transaction_types(type, code)").eq("organisation_id", organisationId).limit(25);
    if (input.id) query = query.eq("id", String(input.id));
    if (input.number) query = query.ilike("document_number", `%${String(input.number)}%`);
    if (input.party) query = query.ilike("party_name", `%${String(input.party)}%`);
    if (input.status) query = query.eq("status", String(input.status));
    const { data } = await query;
    let documents = rowsOf(data).filter((document) => within(document, input) && matchesDirection(document, input.direction));
    if (input.overdue) {
      const asOf = String(input.asOf ?? new Date().toISOString().slice(0, 10));
      documents = documents.filter((document) => text(document.due_date) && text(document.due_date) < asOf && Number(document.amount_due ?? 0) > 0);
    }
    if (name === "get_transaction" && documents[0]?.id) {
      const lines = await supabase.from("transaction_lines").select("line_number, description, quantity, price, nett_amount, vat_amount").eq("organisation_id", organisationId).eq("header_id", String(documents[0].id)).limit(25);
      return {
        document: { ...documents[0], amount_due: money(documents[0].amount_due), foreign_total_amount: money(documents[0].foreign_total_amount) },
        lines: rowsOf(lines.data).map((line) => ({ ...line, nett_amount: money(line.nett_amount), vat_amount: money(line.vat_amount), price: money(line.price) })),
      };
    }
    return { documents: documents.slice(0, 25).map((document) => ({ ...document, amount_due: money(document.amount_due), foreign_total_amount: money(document.foreign_total_amount) })) };
  }

  if (name === "aging_summary") {
    const { data } = await supabase.from("transaction_headers").select("party_name, due_date, amount_due, status, transaction_types(type)").eq("organisation_id", organisationId).eq("status", "posted").limit(25);
    const documents = rowsOf(data).filter((document) => matchesDirection(document, input.direction));
    return { parties: agingBands(documents, String(input.asOf ?? new Date().toISOString().slice(0, 10))) };
  }

  if (name === "totals_by_period") {
    const { data } = await supabase.from("transaction_headers").select("transaction_date, foreign_nett_amount, foreign_vat_amount, foreign_total_amount, party_name, status").eq("organisation_id", organisationId).limit(25);
    let documents = rowsOf(data).filter((document) => within(document, input));
    if (input.party) documents = documents.filter((document) => text(document.party_name).toLowerCase().includes(String(input.party).toLowerCase()));
    return { periods: periodTotals(documents, input.grain === "quarter" ? "quarter" : "month") };
  }

  if (name === "search_e_documents" || name === "get_e_document") {
    let query = supabase.from("e_documents").select("id, direction, status, document_number, seller_name, buyer_name, issue_date, total_amount").eq("organisation_id", organisationId).limit(25);
    if (input.id) query = query.eq("id", String(input.id));
    if (input.direction) query = query.eq("direction", String(input.direction));
    if (input.status) query = query.eq("status", String(input.status));
    if (input.number) query = query.ilike("document_number", `%${String(input.number)}%`);
    const { data } = await query;
    const documents = rowsOf(data).filter((document) => within(document, input) && (!input.party || `${text(document.seller_name)} ${text(document.buyer_name)}`.toLowerCase().includes(String(input.party).toLowerCase())));
    if (name === "get_e_document" && documents[0]?.id) {
      const [results, events] = await Promise.all([
        supabase.from("e_document_validation_results").select("layer, rule_id, severity, message").eq("e_document_id", String(documents[0].id)).limit(25),
        supabase.from("e_document_events").select("from_status, to_status, detail").eq("e_document_id", String(documents[0].id)).limit(25),
      ]);
      return { document: { ...documents[0], total_amount: money(documents[0].total_amount) }, results: rowsOf(results.data), events: rowsOf(events.data) };
    }
    return { documents: documents.slice(0, 25).map((document) => ({ ...document, total_amount: money(document.total_amount) })) };
  }

  if (name === "readiness_issues") {
    const { data } = await supabase.from("transaction_headers").select("id, document_number").eq("organisation_id", organisationId).eq("status", "draft").limit(25);
    const issues = [];
    for (const header of rowsOf(data)) {
      const result = await supabase.rpc("en16931_readiness", { p_header_id: String(header.id) });
      issues.push({ document: header.document_number, issues: rowsOf(result.data) });
    }
    return { drafts: issues };
  }

  if (name === "help_search") {
    const directory = path.join(process.cwd(), "docs/help");
    const query = String(input.query ?? "").toLowerCase();
    const passages = readdirSync(directory).filter((file) => file.endsWith(".md")).map((file) => readFileSync(path.join(directory, file), "utf8"));
    const matched = passages.filter((passage) => !query || passage.toLowerCase().includes(query)).slice(0, 3);
    return { passages: matched };
  }

  return { error: "That tool is not available." };
}
