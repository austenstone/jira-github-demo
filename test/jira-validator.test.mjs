import assert from "node:assert/strict";
import test from "node:test";

import { extractJiraKey, inspectTitle, validateJiraIssue } from "../scripts/jira-validator.mjs";

const response = (status, body = {}, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

test("extracts a Jira key from common pull request title styles", () => {
  assert.equal(extractJiraKey("JRASERVER-1 Demonstrate Jira validation"), "JRASERVER-1");
  assert.equal(extractJiraKey("feat(OPS2-7): validate Jira"), "OPS2-7");
  assert.equal(extractJiraKey("[TEAM_X-42] Add integration"), "TEAM_X-42");
});

test("rejects missing and malformed Jira keys", () => {
  assert.equal(inspectTitle("Add integration").category, "missing-key");
  assert.equal(inspectTitle("abc-123 Add integration").category, "malformed-key");
  assert.equal(inspectTitle("ABC-0 Add integration").category, "malformed-key");
  assert.equal(inspectTitle("ABCDEFGHIJK-1 Add integration").category, "malformed-key");
});

test("accepts a public Jira issue without credentials", async () => {
  let request;
  const result = await validateJiraIssue({
    jiraKey: "ABC-123",
    baseUrl: "https://jira.example.com",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response(200, { key: "ABC-123" });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(request.url, "https://jira.example.com/rest/api/3/issue/ABC-123?fields=key");
  assert.equal(request.options.headers.Authorization, undefined);
});

test("uses basic authentication only when both private Jira secrets are present", async () => {
  let authorization;
  const result = await validateJiraIssue({
    jiraKey: "ABC-123",
    baseUrl: "https://jira.example.com",
    email: "bot@example.com",
    apiToken: "not-a-real-token",
    fetchImpl: async (_url, options) => {
      authorization = options.headers.Authorization;
      return response(200, { key: "ABC-123" });
    },
  });

  assert.equal(result.ok, true);
  assert.match(authorization, /^Basic /);
});

test("rejects an incomplete credential configuration before calling Jira", async () => {
  let called = false;
  const result = await validateJiraIssue({
    jiraKey: "ABC-123",
    baseUrl: "https://jira.example.com",
    email: "bot@example.com",
    fetchImpl: async () => {
      called = true;
      return response(200, { key: "ABC-123" });
    },
  });

  assert.equal(result.category, "configuration");
  assert.equal(called, false);
});

const errorCases = [
  [400, "request-rejected"],
  [401, "authentication"],
  [403, "permission"],
  [404, "invalid-ticket"],
  [429, "rate-limited"],
  [500, "service-unavailable"],
  [503, "service-unavailable"],
];

for (const [status, category] of errorCases) {
  test(`maps Jira HTTP ${status} to ${category}`, async () => {
    const result = await validateJiraIssue({
      jiraKey: "ABC-123",
      baseUrl: "https://jira.example.com",
      fetchImpl: async () => response(status, {}, { "retry-after": "30" }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.category, category);
  });
}

test("maps network errors to service unavailable", async () => {
  const result = await validateJiraIssue({
    jiraKey: "ABC-123",
    baseUrl: "https://jira.example.com",
    fetchImpl: async () => {
      throw new Error("network unavailable");
    },
  });

  assert.equal(result.category, "service-unavailable");
});

test("rejects an invalid success payload", async () => {
  const result = await validateJiraIssue({
    jiraKey: "ABC-123",
    baseUrl: "https://jira.example.com",
    fetchImpl: async () => response(200, { id: "10000" }),
  });

  assert.equal(result.category, "unexpected-response");
});
