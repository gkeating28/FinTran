import type { SupabaseClient } from "@supabase/supabase-js";
import { signEnvelope, signingKey, sha256Hex, type Envelope } from "./envelope";
import { generateUbl, parseUbl } from "./ubl";
import { validateXml } from "./validate";
import type { Database, Json } from "@/lib/database.types";

type Client = SupabaseClient<Database>;
type Semantic = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" && value ? value : "";
}

function nested(value: unknown, ...path: string[]) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return "";
    current = (current as Record<string, unknown>)[key];
  }
  return text(current);
}

function endpoint(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { scheme: "", id: "" };
  const node = (value as Record<string, unknown>)[key];
  if (!node || typeof node !== "object" || Array.isArray(node)) return { scheme: "", id: "" };
  const record = node as Record<string, unknown>;
  return { scheme: text(record.scheme), id: text(record.value) };
}

export function summaryFromSemantic(semantic: Semantic, root: "Invoice" | "CreditNote") {
  const seller = endpoint(semantic["BG-4"], "BT-34");
  const buyer = endpoint(semantic["BG-7"], "BT-49");
  const totals = semantic["BG-22"];
  const total = totals && typeof totals === "object" && !Array.isArray(totals) ? (totals as Record<string, unknown>) : {};
  return {
    ublRoot: root,
    customizationId: text(semantic["BT-24"]),
    profileId: text(semantic["BT-23"]),
    documentNumber: text(semantic["BT-1"]),
    issueDate: text(semantic["BT-2"]),
    currencyCode: text(semantic["BT-5"]),
    totalAmount: text(total["BT-112"]),
    amountDue: text(total["BT-115"]),
    senderScheme: seller.scheme,
    senderId: seller.id,
    receiverScheme: buyer.scheme,
    receiverId: buyer.id,
    sellerName: nested(semantic, "BG-4", "BT-27"),
    sellerVat: nested(semantic, "BG-4", "BT-31"),
    buyerName: nested(semantic, "BG-7", "BT-44"),
    buyerVat: nested(semantic, "BG-7", "BT-48"),
  };
}

async function store(supabase: Client, envelope: Envelope, xml: string) {
  const { key } = signingKey();
  const signature = signEnvelope(envelope, key);
  const { data, error } = await supabase.rpc("store_e_document", {
    p_envelope: envelope as unknown as Json,
    p_signature: signature,
    p_xml: xml,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function createOutbound(supabase: Client, headerId: string, organisationId: string) {
  const { data: semantic, error } = await supabase.rpc("en16931_document", { p_header_id: headerId });
  if (error) throw new Error(error.message);
  if (!semantic || typeof semantic !== "object" || Array.isArray(semantic)) {
    throw new Error("This document cannot be exported.");
  }
  const record = semantic as Semantic;
  if (record["BT-3"] !== "380" && record["BT-3"] !== "381") {
    throw new Error("Only a sales invoice or credit note can generate an e-invoice.");
  }
  const xml = generateUbl(record as Parameters<typeof generateUbl>[0]);
  const validation = validateXml(xml);
  const { keyId } = signingKey();
  const envelope: Envelope = {
    keyId,
    issuedAt: new Date().toISOString(),
    organisationId,
    direction: "outbound",
    source: "generated",
    headerId,
    sha256: sha256Hex(xml),
    byteSize: Buffer.byteLength(xml, "utf8"),
    summary: summaryFromSemantic(record, validation.root),
    semantic: record,
    validation: {
      validatorVersion: validation.validatorVersion,
      rulesVersion: validation.rulesVersion,
      results: validation.results,
    },
  };
  return store(supabase, envelope, xml);
}

export async function receiveInbound(supabase: Client, organisationId: string, xml: string) {
  const validation = validateXml(xml);
  const semantic = parseUbl(xml);
  const { keyId } = signingKey();
  const envelope: Envelope = {
    keyId,
    issuedAt: new Date().toISOString(),
    organisationId,
    direction: "inbound",
    source: "manual_upload",
    headerId: null,
    sha256: sha256Hex(xml),
    byteSize: Buffer.byteLength(xml, "utf8"),
    summary: summaryFromSemantic(semantic, validation.root),
    semantic,
    validation: {
      validatorVersion: validation.validatorVersion,
      rulesVersion: validation.rulesVersion,
      results: validation.results,
    },
  };
  return store(supabase, envelope, xml);
}
