import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import type { AskProposal } from "@/lib/ask-qula";
import { signingKey } from "@/lib/einvoice/envelope";
import { parseParty, PARTY_META, type PartyKind } from "@/lib/parties";
import { createParty } from "@/lib/party-actions";
import { postDocumentNow } from "@/lib/post-document";
import { readinessMessages } from "./readiness";

/**
 * Things Ask Qula can do for a person, and only after they press Confirm.
 *
 * The model can only propose. A proposal is checked against the data here, written up in words by this code, and signed.
 * The person sees that text and presses Confirm, which sends the signed token back. Nothing the model writes decides what
 * happens: the token carries ids and checked fields, it is tied to one person and one organisation, and it runs out.
 */
export type ActionPayload =
  | { kind: "post_draft"; id: string }
  | { kind: "add_party"; party: PartyKind; code: string; name: string; countryCode: string; vatNumber: string; email: string; phone: string; line1: string; city: string; postCode: string };

type Token = { v: 1; o: string; u: string; e: number; a: ActionPayload };

const LIFETIME_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function keyBytes() {
  return Buffer.from(signingKey().key, "base64");
}

function mac(body: string) {
  // The prefix keeps this signature apart from the e-invoice signatures made with the same key.
  return createHmac("sha256", keyBytes()).update(`ask-qula-action:${body}`, "utf8").digest("base64url");
}

export function signAction(organisationId: string, userId: string, action: ActionPayload, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ v: 1, o: organisationId, u: userId, e: now + LIFETIME_MS, a: action } satisfies Token), "utf8").toString("base64url");
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

type Checked = { ok: true; action: ActionPayload; title: string; lines: string[]; confirmLabel: string } | { ok: false; error: string };

async function checkPost(supabase: SupabaseClient, organisationId: string, id: string): Promise<Checked> {
  if (!UUID.test(id)) return { ok: false, error: "Say which draft to post, by its id or number." };
  const { data } = await supabase
    .from("transaction_headers")
    .select("id, document_number, status, party_name, transaction_date, foreign_total_amount, currencies(code), transaction_types(type, description)")
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
  const issues = await readinessMessages(supabase, id);
  if (sales && issues.errors.length > 0) {
    return { ok: false, error: `This sales document is not ready to post. ${issues.errors.join(" ")}` };
  }
  const currency = str(one(header.currencies)?.code, 5);
  return {
    ok: true,
    action: { kind: "post_draft", id },
    title: `Post this ${sales ? "sales" : "purchase"} document?`,
    lines: [
      `${str(type?.description) || (sales ? "Sales document" : "Purchase document")}${header.document_number ? ` ${str(header.document_number, 30)}` : " (new draft)"}`,
      `${sales ? "To" : "From"} ${str(header.party_name)}`,
      `Total ${euro(header.foreign_total_amount, currency)}`,
      ...(issues.warnings.length > 0 ? [`${issues.warnings.length} warning${issues.warnings.length === 1 ? "" : "s"} about the e-invoice, which does not stop posting`] : []),
      sales ? "Posting locks the document. A posted sales document is corrected with a credit note." : "Posting locks the document. A posted purchase document can still be voided by an owner or admin.",
    ],
    confirmLabel: "Post it",
  };
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
  return {
    ok: true,
    action: { kind: "add_party", party, ...fields, code: parsed.code },
    title: `Add this ${PARTY_META[party].singular.toLowerCase()}?`,
    lines: [
      `Code ${parsed.code}, name ${parsed.name}`,
      ...(fields.line1 || fields.city ? [[fields.line1, fields.city, fields.postCode, fields.countryCode].filter(Boolean).join(", ")] : []),
      ...(fields.vatNumber ? [`VAT number ${fields.vatNumber}`] : []),
      ...(fields.email ? [`Email ${fields.email}`] : []),
      "The currency is the organisation's home currency. The code cannot be changed once it is saved.",
    ],
    confirmLabel: "Add it",
  };
}

/** Checks what the model asked for against the data. Returns a signed proposal for the person to confirm, or a reason it cannot be done. */
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
  try {
    return { proposal: { token: signAction(organisationId, userId, checked.action), title: checked.title, lines: checked.lines, confirmLabel: checked.confirmLabel } };
  } catch {
    return { error: "Actions are not available because the signing key is not set up." };
  }
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
    const result = await postDocumentNow(supabase, organisationId, action.id);
    revalidatePath("/transactions");
    revalidatePath("/transactions/[code]", "page");
    revalidatePath("/");
    const summary = checked.lines.slice(0, 2).join(", ");
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
