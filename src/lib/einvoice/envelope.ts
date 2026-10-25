import { createHash, createHmac } from "node:crypto";
import { canonicalJson } from "./canonical";
import type { ValidationResult } from "./validate";

export type Envelope = {
  keyId: string;
  issuedAt: string;
  organisationId: string;
  direction: "inbound" | "outbound";
  source: "generated" | "manual_upload";
  headerId: string | null;
  sha256: string;
  byteSize: number;
  summary: Record<string, string>;
  semantic: unknown;
  validation: {
    validatorVersion: string;
    rulesVersion: string;
    results: ValidationResult["results"];
  };
};

export function sha256Hex(xml: string) {
  return createHash("sha256").update(xml, "utf8").digest("hex");
}

export function signEnvelope(envelope: Envelope, keyBase64: string) {
  const key = Buffer.from(keyBase64, "base64");
  return createHmac("sha256", key).update(canonicalJson(envelope), "utf8").digest("hex");
}

export function signingKey() {
  const key = process.env.EINVOICE_HMAC_KEY;
  const keyId = process.env.EINVOICE_HMAC_KEY_ID;
  if (!key || !keyId) throw new Error("The e-invoice signing key is not configured.");
  return { key, keyId };
}
