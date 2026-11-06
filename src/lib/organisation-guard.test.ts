import assert from "node:assert/strict";
import test from "node:test";
import { ORGANISATION_COOKIE } from "./data";
import { membershipAllows, requestWithTamperedOrganisation } from "./organisation-guard";

const memberships = [{ organisationId: "org-a", role: "member" as const }];

test("a tampered organisation cookie is not a membership", () => {
  const request = requestWithTamperedOrganisation("http://localhost/api/ask-qula", "org-other");
  assert.equal(request.headers.get("cookie"), `${ORGANISATION_COOKIE}=org-other`);
  assert.equal(membershipAllows(memberships, "org-other"), false);
  assert.equal(membershipAllows(memberships, "org-a"), true);
  assert.equal(membershipAllows(memberships, "org-a", ["owner", "admin"]), false);
});
