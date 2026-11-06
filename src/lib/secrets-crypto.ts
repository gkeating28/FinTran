import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type SecretKind = "ai_api_key" | "ap_api_key" | "ap_webhook_secret";

type KeyRing = { current: string; keys: Record<string, Buffer> };

function keyRing(): KeyRing {
  const raw = process.env.QULA_SECRETS_KEYS;
  const current = process.env.QULA_SECRETS_KEY_ID ?? "";
  if (!raw || !current) throw new Error("The secret key is not configured.");
  const parsed = JSON.parse(raw) as Record<string, string>;
  const keys = Object.fromEntries(Object.entries(parsed).map(([id, value]) => [id, Buffer.from(value, "base64")]));
  const key = keys[current];
  if (!key || key.length !== 32) throw new Error("The secret key is not configured.");
  return { current, keys };
}

export function encryptSecret(value: string, organisationId: string, kind: SecretKind) {
  const { current, keys } = keyRing();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys[current], nonce);
  cipher.setAAD(Buffer.from(`${organisationId}:${kind}`));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const packed = Buffer.concat([ciphertext, cipher.getAuthTag()]);
  return `${current}:${nonce.toString("base64")}:${packed.toString("base64")}`;
}

export function decryptSecret(stored: string, organisationId: string, kind: SecretKind) {
  const { keys } = keyRing();
  const [keyId, nonceText, packedText] = stored.split(":");
  const key = keys[keyId];
  if (!key || key.length !== 32 || !nonceText || !packedText) throw new Error("The secret could not be read.");
  const packed = Buffer.from(packedText, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonceText, "base64"));
  decipher.setAAD(Buffer.from(`${organisationId}:${kind}`));
  decipher.setAuthTag(packed.subarray(packed.length - 16));
  return Buffer.concat([decipher.update(packed.subarray(0, packed.length - 16)), decipher.final()]).toString("utf8");
}

export function secretHint(value: string) {
  return value.slice(-4);
}
