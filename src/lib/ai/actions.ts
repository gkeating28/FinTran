import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import type { AskProposal } from "@/lib/ask-qula";
import { formatDate } from "@/lib/dates";
import { signingKey } from "@/lib/einvoice/envelope";
import { parseParty, PARTY_META, type PartyKind } from "@/lib/parties";
import { createParty } from "@/lib/party-actions";
import { postDocumentNow } from "@/lib/post-document";
import { readinessMessages } from "./readiness";

/**
 * Things Ask Qula can do for a person, and only after they press Confirm.
 *
 * The model can only propose. A proposal is checked against the data here, written up from the database by this code,
 * and signed. The person sees that card and presses Confirm, which sends the signed token back. Nothing the model writes
 * decides what happens or what the card says: the token carries ids and checked fields, and it is tied to one person and
 * one organisation.
 *
 * A proposal is also written to `ai_actions` before its token is handed out, with the SHA-256 of the token and not the
 * token. The database lets a token be used once, for ten minutes, and only while the document it names is unchanged.
 * Actions are off until an owner or admin switches them on for the organisation.
 */
export type ActionPayload =
  | { kind: "post_draft"; id: string }
  | { kind: "add_party"; party: PartyKind; code: string; name: string; countryCode: string; vatNumber: string; email: string; phone: string; line1: string; city: string; postCode: string };

type Token = { v: 1; o: string; u: string; e: number; n: string; a: ActionPayload };

export const PROPOSAL_LABEL = "Proposed by Ask Qula";

const LIFETIME_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function keyBytes() {
  return Buffer.from(signingKey().key, "base64");
}

function mac(body: string) {
  // The prefix keeps this signature apart from the e-invoice signatures made with the same key.
  return createHmac("sha256", keyBytes()).update(`ask-qula-action:${body}`, "utf8").digest("base64url");
}

/** What is stored for a token: its SHA-256 in hex. The token itself is never stored. */
export function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A signed token. The random part makes every token different, even for the same action in the same moment. */
export function signAction(organisationId: string, userId: string, action: ActionPayload, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ v: 1, o: organisationId, u: userId, e: now + LIFETIME_MS, n: randomBytes(16).toString("base64url"), a: action } satisfies Token), "utf8").toString("base64url");
  return `${body}.${mac(body)}`;
}

/** The action a token names, or null if it was not signed here, has been changed, or has run out. */
export function readAction(token: string, now = Date.now()): { organisationId: string; userId: string; action: ActionPayload } | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  let expected: string;
  try {
    expected = mac(body);
  } catch {
    return null;
  }
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Token;
    if (parsed.v !== 1 || typeof parsed.e !== "number" || parsed.e < now) return null;
    if (!UUID.test(parsed.o) || !UUID.test(parsed.u) || !parsed.a || typeof parsed.a !== "object") return null;
    return { organisationId: parsed.o, userId: parsed.u, action: parsed.a };
  } catch {
    return null;
  }
}

type Row = Record<string, unknown>;

function one(value: unknown) {
  return (Array.isArray(value) ? value[0] : value) as Row | undefined;
}

function str(value: unknown, length = 200) {
  return typeof value === "string" ? value.trim().slice(0, length) : "";
}

function euro(value: unknown, code: string) {
  const number = Number(value ?? 0);
  return `${code === "EUR" || !code ? "€" : `${code} `}${number.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type Card = Omit<AskProposal, "token">;

type Checked = { ok: true; action: ActionPayload; card: Card; summary: string; targetId: string | null } | { ok: false; error: string };

/** The number a draft will get. A type numbered on posting has none yet, so the next one is shown as a forecast. */
function numberRow(header: Row, type: Row | undefined) {
  const existing = str(header.document_number, 30);
  if (existing) return { label: "Number", value: existing };
  if (type?.numbering !== "on_post") return { label: "Number", value: "" };
  const next = String(Number(type.last_reference ?? 0) + 1);
  const padded = next.padStart(Math.max(Number(type.reference_padding ?? 0), next.length), "0");
  return { label: "Next number", value: `${str(type.reference_prefix, 10)}${padded} (may change if another document posts first)` };
}

function percent(value: unknown) {
  return `${Number(value ?? 0).toLocaleString("en-IE", { maximumFractionDigits: 2 })}%`;
}

async function checkPost(supabase: SupabaseClient, organisationId: string, id: string): Promise<Checked> {
  if (!UUID.test(id)) return { ok: false, error: "Say which draft to post, by its id or number." };
  const { data } = await supabase
    .from("transaction_headers")
    .select(
      "id, document_number, status, party_name, transaction_date, due_date, foreign_nett_amount, foreign_vat_amount, foreign_total_amount, currencies(code), transaction_types(type, description, numbering, last_reference, reference_prefix, reference_padding)",
    )
    .eq("organisation_id", organisationId)
    .eq("id", id)
    .maybeSingle();
  const header = data as Row | null;
  if (!header) return { ok: false, error: "That document could not be found." };
  if (header.status !== "draft") return { ok: false, error: `That document is ${String(header.status)}, so it cannot be posted.` };
  const lines = await supabase.from("transaction_lines").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).eq("header_id", id);
  if ((lines.count ?? 0) < 1) return { ok: false, error: "That draft has no lines yet, so it cannot be posted." };
  const type = one(header.transaction_types);
  const sales = type?.type === "Sales";
  const [issues, breakdown] = await Promise.all([
    readinessMessages(supabase, id),
    supabase.from("transaction_vat_breakdown").select("vat_category, vat_percentage, taxable_amount, vat_amount").eq("organisation_id", organisationId).eq("header_id", id).order("vat_percentage", { ascending: false }),
  ]);
  const currency = str(one(header.currencies)?.code, 5);
  const description = str(type?.description) || (sales ? "Sales document" : "Purchase document");
  const vatRows = ((breakdown.data ?? []) as Row[]).map((row) => ({
    label: `VAT ${str(row.vat_category, 3)} ${percent(row.vat_percentage)}`.replace(/\s+/g, " "),
    value: `${euro(row.vat_amount, currency)} on ${euro(row.taxable_amount, currency)}`,
  }));
  const number = numberRow(header, type);
  const card: Card = {
    label: PROPOSAL_LABEL,
    title: `Post this ${sales ? "sales" : "purchase"} document?`,
    rows: [
      { label: "Type", value: description },
      { label: sales ? "Customer" : "Supplier", value: str(header.party_name) },
      { label: "Date", value: formatDate(str(header.transaction_date, 10)) },
      { label: "Due date", value: formatDate(str(header.due_date, 10)) },
      number,
      { label: "Nett", value: euro(header.foreign_nett_amount, currency) },
      { label: "VAT", value: euro(header.foreign_vat_amount, currency) },
      { label: "Total", value: euro(header.foreign_total_amount, currency) },
      ...vatRows,
    ],
    issues: [
      ...issues.errors.map((message) => ({ severity: "error" as const, message })),
      ...issues.warnings.map((message) => ({ severity: "warning" as const, message })),
    ],
    lines: [
      issues.errors.length > 0
        ? "This document is not ready to post. Fix what is listed, then ask again."
        : sales
          ? "Posting locks the document. A posted sales document is corrected with a credit note."
          : "Posting locks the document. A posted purchase document can still be voided by an owner or admin.",
    ],
    confirmLabel: "Post it",
  };
  return {
    ok: true,
    action: { kind: "post_draft", id },
    card,
    summary: `${description}${number.label === "Number" && number.value ? ` ${number.value}` : " (new draft)"}, ${sales ? "to" : "from"} ${str(header.party_name)}`,
    targetId: id,
  };
}

/** True when the card says the document cannot be posted, so there is nothing to confirm. */
function blocked(card: Card) {
  return card.issues.some((issue) => issue.severity === "error");
}

async function checkParty(supabase: SupabaseClient, organisationId: string, input: Record<string, unknown>): Promise<Checked> {
  const party: PartyKind | null = input.party === "customers" || input.party === "customer" ? "customers" : input.party === "suppliers" || input.party === "supplier" ? "suppliers" : null;
  if (!party) return { ok: false, error: "Say whether this is a supplier or a customer." };
  const defaults = await supabase.from("organisation_defaults").select("home_currency_id").eq("organisation_id", organisationId).maybeSingle();
  const currencyId = str((defaults.data as Row | null)?.home_currency_id, 40);
  const fields = {
    code: str(input.code, 20),
    name: str(input.name, 200),
    countryCode: str(input.countryCode, 2).toUpperCase(),
    vatNumber: str(input.vatNumber, 20),
    email: str(input.email, 200),
    phone: str(input.phone, 40),
    line1: str(input.line1, 100),
    city: str(input.city, 100),
    postCode: str(input.postCode, 20),
  };
  const parsed = parseParty({
    code: fields.code,
    name: fields.name,
    currencyId,
    phone: fields.phone,
    email: fields.email,
    website: "",
    address: { line1: fields.line1, line2: "", line3: "", city: fields.city, postCode: fields.postCode, county: "", countryCode: fields.countryCode },
    contactDetails: "",
    notes: "",
    vatNumber: fields.vatNumber,
    companyNumber: "",
    peppolScheme: "",
    peppolId: "",
    paymentTermsDays: "",
    defaultBuyerReference: "",
  });
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const existing = await supabase.from(party).select("id, name").eq("organisation_id", organisationId).or(`code.eq.${parsed.code},name.ilike.${parsed.name.replace(/[,()%]/g, " ")}`).limit(1);
  if ((existing.data ?? []).length > 0) {
    return { ok: false, error: `A ${PARTY_META[party].singular.toLowerCase()} with that code or name already exists: ${str(((existing.data ?? [])[0] as Row).name)}.` };
  }
  const singular = PARTY_META[party].singular;
  const currency = await supabase.from("currencies").select("code").eq("organisation_id", organisationId).eq("id", currencyId).maybeSingle();
  return {
    ok: true,
    action: { kind: "add_party", party, ...fields, code: parsed.code },
    card: {
      label: PROPOSAL_LABEL,
      title: `Add this ${singular.toLowerCase()}?`,
      // Every field that will be saved, including the ones left blank.
      rows: [
        { label: "Kind", value: `${singular.charAt(0).toUpperCase()}${singular.slice(1)}` },
        { label: "Code", value: parsed.code },
        { label: "Name", value: parsed.name },
        { label: "Address", value: fields.line1 },
        { label: "City", value: fields.city },
        { label: "Post code", value: fields.postCode },
        { label: "Country", value: fields.countryCode },
        { label: "VAT number", value: fields.vatNumber },
        { label: "Email", value: fields.email },
        { label: "Phone", value: fields.phone },
        { label: "Currency", value: str((currency.data as Row | null)?.code, 5) },
      ],
      issues: [],
      lines: ["The currency is the organisation's home currency. The code cannot be changed once it is saved."],
      confirmLabel: "Add it",
    },
    summary: `Add ${singular.toLowerCase()} ${parsed.code}, ${parsed.name}`,
    targetId: null,
  };
}

/**
 * Checks what the model asked for against the data and builds the card from the database. The proposal is written to
 * `ai_actions` before its token is returned. A draft that is not ready comes back as a card with no token, so there is
 * nothing to confirm.
 */
export async function proposeAction(
  supabase: SupabaseClient,
  organisationId: string,
  userId: string,
  input: Record<string, unknown>,
): Promise<{ proposal: AskProposal } | { error: string }> {
  let checked: Checked;
  try {
    checked = input.action === "post_draft" ? await checkPost(supabase, organisationId, str(input.id, 40)) : input.action === "add_party" ? await checkParty(supabase, organisationId, input) : { ok: false, error: "That action is not available. Ask Qula can post a draft or add a supplier or customer." };
  } catch {
    return { error: "That could not be checked just now." };
  }
  if (!checked.ok) return { error: checked.error };
  if (blocked(checked.card)) return { proposal: { ...checked.card, token: null } };
  let token: string;
  try {
    token = signAction(organisationId, userId, checked.action);
  } catch {
    return { error: "Actions are not available because the signing key is not set up." };
  }
  const stored = await supabase.rpc("propose_ai_action", {
    p_organisation_id: organisationId,
    p_action: checked.action.kind,
    p_token_hash: hashToken(token),
    p_target_id: checked.targetId,
    p_summary: checked.summary,
    p_proposal: checked.card,
  });
  if (stored.error) {
    return { error: /switched off/.test(stored.error.message) ? "Ask Qula actions are switched off for this organisation." : "That could not be proposed just now." };
  }
  return { proposal: { ...checked.card, token } };
}

/** Does what a confirmed token says. The checks run again, because the data may have changed since it was proposed. */
export async function runAction(
  supabase: SupabaseClient,
  organisationId: string,
  action: ActionPayload,
): Promise<{ ok: boolean; message: string; summary: string; href?: string }> {
  if (action.kind === "post_draft") {
    const checked = await checkPost(supabase, organisationId, action.id);
    if (!checked.ok) return { ok: false, message: checked.error, summary: "Post a draft" };
    if (blocked(checked.card)) return { ok: false, message: `This document is not ready to post. ${checked.card.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join(" ")}`, summary: checked.summary };
    const result = await postDocumentNow(supabase, organisationId, action.id);
    revalidatePath("/transactions");
    revalidatePath("/transactions/[code]", "page");
    revalidatePath("/");
    const summary = checked.summary;
    if (result.error) return { ok: false, message: result.error, summary };
    return { ok: true, message: result.warning ? `Posted. ${result.warning}` : "Posted.", summary };
  }
  const form = new FormData();
  const fields: Record<string, string> = { code: action.code, name: action.name, country_code: action.countryCode, vat_number: action.vatNumber, email: action.email, phone: action.phone, address_line1: action.line1, city: action.city, post_code: action.postCode };
  const defaults = await supabase.from("organisation_defaults").select("home_currency_id").eq("organisation_id", organisationId).maybeSingle();
  fields.currency_id = str((defaults.data as Row | null)?.home_currency_id, 40);
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  const summary = `Add ${PARTY_META[action.party].singular.toLowerCase()} ${action.code}, ${action.name}`;
  const result = await createParty(action.party, {}, form);
  if (result.error) return { ok: false, message: result.error, summary };
  return { ok: true, message: "Added.", summary, href: PARTY_META[action.party].path };
}
