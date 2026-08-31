import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const jiraKeyPattern = /^[A-Z][A-Z0-9_]{1,9}-[1-9]\d*$/;
const jiraCandidatePattern = /(?<![A-Za-z0-9_])([A-Za-z][A-Za-z0-9_]*-[^\s:()[\]{}]+)/;
const jiraKeyInTitlePattern = /(?<![A-Z0-9_])([A-Z][A-Z0-9_]{1,9}-[1-9]\d*)(?![A-Z0-9_-])/;

export const extractJiraKey = (title) => title.match(jiraKeyInTitlePattern)?.[1] ?? null;

export const inspectTitle = (title) => {
  const jiraKey = extractJiraKey(title);

  if (jiraKey) {
    return { ok: true, jiraKey };
  }

  const candidate = title.match(jiraCandidatePattern)?.[1];
  if (candidate) {
    return {
      ok: false,
      category: "malformed-key",
      message: `"${candidate}" is not a valid Jira key. Use an uppercase key such as ABC-123.`,
    };
  }

  return {
    ok: false,
    category: "missing-key",
    message: "The pull request title must contain a Jira key such as ABC-123.",
  };
};

const buildUrls = ({ baseUrl, apiVersion, jiraKey }) => {
  if (!["2", "3"].includes(apiVersion)) {
    throw new Error('JIRA_API_VERSION must be "2" or "3".');
  }

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const issueUrl = new URL(`${normalizedBaseUrl}/browse/${jiraKey}`).toString();
  const apiUrl = new URL(
    `${normalizedBaseUrl}/rest/api/${apiVersion}/issue/${encodeURIComponent(jiraKey)}?fields=key`,
  ).toString();

  return { apiUrl, issueUrl };
};

const failure = (category, message, jiraKey) => ({
  ok: false,
  category,
  message,
  jiraKey,
});

export const validateJiraIssue = async ({
  jiraKey,
  baseUrl,
  apiVersion = "3",
  email = "",
  apiToken = "",
  fetchImpl = fetch,
  timeoutMs = 15_000,
}) => {
  if (!jiraKeyPattern.test(jiraKey)) {
    return failure("malformed-key", `"${jiraKey}" is not a valid Jira key.`, jiraKey);
  }

  if (!baseUrl) {
    return failure("configuration", "JIRA_BASE_URL is required.", jiraKey);
  }

  if (Boolean(email) !== Boolean(apiToken)) {
    return failure(
      "configuration",
      "Configure both JIRA_EMAIL and JIRA_API_TOKEN, or neither for public Jira.",
      jiraKey,
    );
  }

  let urls;
  try {
    urls = buildUrls({ baseUrl, apiVersion, jiraKey });
  } catch (error) {
    return failure("configuration", error.message, jiraKey);
  }

  const headers = {
    Accept: "application/json",
    "User-Agent": "jira-github-demo",
  };

  if (email && apiToken) {
    headers.Authorization = `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
  }

  let response;
  try {
    response = await fetchImpl(urls.apiUrl, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return failure(
      "service-unavailable",
      "Jira could not be reached. Retry the check or follow the outage policy.",
      jiraKey,
    );
  }

  if (response.status === 401) {
    return failure(
      "authentication",
      "Jira rejected the credentials. Verify JIRA_EMAIL and JIRA_API_TOKEN.",
      jiraKey,
    );
  }

  if (response.status === 403) {
    return failure(
      "permission",
      `Jira authenticated the request but denied access to ${jiraKey}. Grant Browse Projects permission.`,
      jiraKey,
    );
  }

  if (response.status === 404) {
    return failure(
      "invalid-ticket",
      `${jiraKey} does not exist or is hidden from this Jira identity.`,
      jiraKey,
    );
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    const retryMessage = retryAfter ? ` Retry after ${retryAfter} seconds.` : "";
    return failure("rate-limited", `Jira rate limited the validation request.${retryMessage}`, jiraKey);
  }

  if (response.status >= 500) {
    return failure(
      "service-unavailable",
      `Jira returned HTTP ${response.status}. Retry the check or follow the outage policy.`,
      jiraKey,
    );
  }

  if (!response.ok) {
    return failure(
      "request-rejected",
      `Jira rejected the issue lookup with HTTP ${response.status}.`,
      jiraKey,
    );
  }

  try {
    const payload = await response.json();
    if (!jiraKeyPattern.test(payload.key ?? "")) {
      return failure(
        "unexpected-response",
        "Jira returned success without a valid issue key.",
        jiraKey,
      );
    }

    return {
      ok: true,
      category: "valid",
      jiraKey: payload.key,
      issueUrl: urls.issueUrl,
      message: `${payload.key} exists and is visible to the configured Jira identity.`,
    };
  } catch {
    return failure("unexpected-response", "Jira returned an unreadable success response.", jiraKey);
  }
};

const writeSummary = async (result) => {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  const status = result.ok ? "Passed" : "Failed";
  const issueLine = result.ok ? `\n\nIssue: [${result.jiraKey}](${result.issueUrl})` : "";
  await appendFile(
    summaryPath,
    `## Jira ticket validation: ${status}\n\n${result.message}${issueLine}\n`,
  );
};

export const run = async (environment = process.env) => {
  const titleResult = inspectTitle(environment.PR_TITLE ?? "");
  if (!titleResult.ok) {
    await writeSummary(titleResult);
    console.error(`::error title=Jira ticket validation::${titleResult.message}`);
    return 1;
  }

  const result = await validateJiraIssue({
    jiraKey: titleResult.jiraKey,
    baseUrl: environment.JIRA_BASE_URL ?? "",
    apiVersion: environment.JIRA_API_VERSION || "3",
    email: environment.JIRA_EMAIL ?? "",
    apiToken: environment.JIRA_API_TOKEN ?? "",
  });

  await writeSummary(result);

  if (!result.ok) {
    console.error(`::error title=Jira ticket validation::${result.message}`);
    return 1;
  }

  console.log(`Validated ${result.jiraKey}: ${result.issueUrl}`);
  return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run();
}
