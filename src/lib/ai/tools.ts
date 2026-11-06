import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient;

function rows<T>(value: T[] | null) {
  return (value ?? []).slice(0, 25);
}

export async function runAskTool(supabase: Client, organisationId: string, name: string, input: Record<string, unknown>) {
  if (name === "search_parties") {
    const term = String(input.name ?? "").trim();
    const [customers, suppliers] = await Promise.all([
      supabase.from("customers").select("id, code, name, vat_number").eq("organisation_id", organisationId).ilike("name", `%${term}%`).limit(25),
      supabase.from("suppliers").select("id, code, name, vat_number").eq("organisation_id", organisationId).ilike("name", `%${term}%`).limit(25),
    ]);
    return { customers: rows(customers.data), suppliers: rows(suppliers.data) };
  }
  if (name === "search_transactions" || name === "get_transaction") {
    let query = supabase.from("transaction_headers").select("id, document_number, status, party_name, transaction_date, due_date, amount_due, foreign_total_amount").eq("organisation_id", organisationId).limit(25);
    if (input.status) query = query.eq("status", String(input.status));
    if (input.number) query = query.ilike("document_number", `%${String(input.number)}%`);
    if (input.party) query = query.ilike("party_name", `%${String(input.party)}%`);
    if (input.id) query = query.eq("id", String(input.id));
    const { data } = await query;
    return { documents: rows(data) };
  }
  if (name === "search_e_documents" || name === "get_e_document") {
    let query = supabase.from("e_documents").select("id, direction, status, document_number, seller_name, buyer_name, issue_date").eq("organisation_id", organisationId).limit(25);
    if (input.id) query = query.eq("id", String(input.id));
    if (input.direction) query = query.eq("direction", String(input.direction));
    if (input.status) query = query.eq("status", String(input.status));
    if (input.number) query = query.ilike("document_number", `%${String(input.number)}%`);
    const { data } = await query;
    return { documents: rows(data) };
  }
  if (name === "aging_summary") {
    const { data } = await supabase.from("transaction_headers").select("party_name, due_date, amount_due, status").eq("organisation_id", organisationId).eq("status", "posted").limit(25);
    return { documents: rows(data) };
  }
  if (name === "totals_by_period") {
    const { data } = await supabase.from("transaction_headers").select("transaction_date, foreign_nett_amount, foreign_vat_amount, foreign_total_amount, status").eq("organisation_id", organisationId).limit(25);
    return { documents: rows(data) };
  }
  if (name === "readiness_issues") {
    const { data } = await supabase.from("transaction_headers").select("id, document_number, status").eq("organisation_id", organisationId).eq("status", "draft").limit(25);
    return { drafts: rows(data) };
  }
  if (name === "help_search") {
    const directory = path.join(process.cwd(), "docs/help");
    const query = String(input.query ?? "").toLowerCase();
    const passages = readdirSync(directory).filter((file) => file.endsWith(".md")).map((file) => readFileSync(path.join(directory, file), "utf8"));
    return { passages: passages.filter((text) => text.toLowerCase().includes(query) || !query).slice(0, 3) };
  }
  return { error: "That tool is not available." };
}
