import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "./secrets-crypto";

test("a secret cannot be decrypted for another organisation", () => {
  process.env.QULA_SECRETS_KEY_ID = "k1";
  process.env.QULA_SECRETS_KEYS = JSON.stringify({ k1: randomBytes(32).toString("base64") });
  const stored = encryptSecret("sk-test-value", "org-a", "ai_api_key");
  assert.equal(decryptSecret(stored, "org-a", "ai_api_key"), "sk-test-value");
  assert.throws(() => decryptSecret(stored, "org-b", "ai_api_key"));
  assert.throws(() => decryptSecret(stored, "org-a", "ap_api_key"));
});
