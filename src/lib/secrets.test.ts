import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, reencryptSecret } from "./secrets-crypto";

test("a secret cannot be decrypted for another organisation", () => {
  process.env.QULA_SECRETS_KEY_ID = "k1";
  process.env.QULA_SECRETS_KEYS = JSON.stringify({ k1: randomBytes(32).toString("base64") });
  const stored = encryptSecret("sk-test-value", "org-a", "ai_api_key");
  assert.equal(decryptSecret(stored, "org-a", "ai_api_key"), "sk-test-value");
  assert.throws(() => decryptSecret(stored, "org-b", "ai_api_key"));
  assert.throws(() => decryptSecret(stored, "org-a", "ap_api_key"));
});

test("rotation re-encrypts with the current key and still decrypts", () => {
  const first = randomBytes(32).toString("base64");
  const second = randomBytes(32).toString("base64");
  process.env.QULA_SECRETS_KEY_ID = "k1";
  process.env.QULA_SECRETS_KEYS = JSON.stringify({ k1: first, k2: second });
  const stored = encryptSecret("sk-live-value", "org-a", "ai_api_key");
  process.env.QULA_SECRETS_KEY_ID = "k2";
  const rotated = reencryptSecret(stored, "org-a", "ai_api_key");
  assert.equal(rotated.startsWith("k2:"), true);
  assert.equal(decryptSecret(rotated, "org-a", "ai_api_key"), "sk-live-value");
});
