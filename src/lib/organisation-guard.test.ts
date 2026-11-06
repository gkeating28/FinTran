import assert from "node:assert/strict";
import { createServer } from "node:http";
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

test("a tampered organisation cookie request returns 403", async () => {
  const server = createServer((incoming, response) => {
    const cookie = incoming.headers.cookie ?? "";
    const organisationId = cookie.split("=")[1] ?? "";
    const allowed = membershipAllows(memberships, organisationId);
    response.writeHead(allowed ? 200 : 403, { "content-type": "text/plain" });
    response.end(allowed ? "ok" : "You cannot open that organisation.");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const response = await fetch(requestWithTamperedOrganisation(`http://127.0.0.1:${port}/api/ask-qula`, "org-other"));
  assert.equal(response.status, 403);
  server.close();
});
