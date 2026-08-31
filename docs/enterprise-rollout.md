# Enterprise rollout guide

This guide scales the repository pattern without introducing a custom GitHub App or service.

## Recommended target architecture

Use three independent layers:

1. **Discoverability:** Configure GitHub autolinks for every Jira project key.
2. **Behavior shaping:** Start branch-name rulesets in Evaluate mode.
3. **Enforcement:** Run a repository-owned PR metadata workflow on title edits and require its stable `Jira ticket` status check.

Install the [official GitHub for Atlassian integration](https://github.com/marketplace/github-for-jira) separately when Jira users need GitHub development data in Jira. Autolinks remain useful because they solve the opposite direction: finding Jira from GitHub.

## Rollout sequence

1. Inventory Jira sites and project-key prefixes.
2. Confirm which projects allow anonymous Browse Projects access and which require a service identity.
3. Configure `JIRA_BASE_URL` and `JIRA_API_VERSION` as repository or organization variables.
4. For private Jira, create least-privilege credentials and expose secrets only to selected repositories.
5. Add autolinks and verify a real issue in every configured prefix.
6. Add the repository workflow in report-only mode or without a required check.
7. Observe missing keys, Jira permissions, automation accounts, and outage behavior.
8. Add the `Jira ticket` required status check.
9. Keep branch naming in Evaluate mode until known automation and bypass cases are understood.

## Distribution options

### Copy the workflow into each repository

This repository's [`jira-ticket.yml`](../.github/workflows/jira-ticket.yml) is the simplest and most transparent option. Each repository owns dispatch, including the critical `pull_request_target.edited` activity type.

Use automation or a workflow template in the organization's `.github` repository to keep copies synchronized.

### Call a reusable workflow

Keep a small caller workflow in each repository so title edits still dispatch:

```yaml
name: Jira ticket

on:
  pull_request_target:
    types: [opened, edited, synchronize, reopened, ready_for_review]

permissions:
  contents: read

jobs:
  validate:
    name: Jira ticket
    uses: octo-org/automation/.github/workflows/jira-ticket.yml@FULL_COMMIT_SHA
    with:
      jira-base-url: ${{ vars.JIRA_BASE_URL }}
      jira-api-version: ${{ vars.JIRA_API_VERSION }}
      pr-title: ${{ github.event.pull_request.title }}
    secrets:
      jira-email: ${{ secrets.JIRA_EMAIL }}
      jira-api-token: ${{ secrets.JIRA_API_TOKEN }}
```

Pin the reusable workflow to a full commit SHA. The called workflow must treat `pr-title` as untrusted data, must not check out the PR head, and cannot elevate the caller's `GITHUB_TOKEN` permissions.

Public caller repositories can call public reusable workflows. Access to private or internal reusable workflows must be explicitly enabled by the called repository and permitted by the caller's Actions policy. See [GitHub's reusable workflow reference](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations).

### Do not use an organization required workflow for title edits

Ruleset-required workflows ignore the source workflow's `pull_request` activity filters. They do not provide a reliable fresh run when only a title is edited.

Use the repository caller above for dispatch. Use a ruleset required status check for enforcement.

## Variables and secrets

| Name | Type | Required | Example |
| --- | --- | --- | --- |
| `JIRA_BASE_URL` | Variable | Yes | `https://example.atlassian.net` |
| `JIRA_API_VERSION` | Variable | No, defaults to `3` outside this demo | `3` |
| `JIRA_EMAIL` | Secret | Private Jira only | Service account email |
| `JIRA_API_TOKEN` | Secret | Private Jira only | Jira API token |

For organization secrets, choose **selected repositories** instead of all repositories. Rotate the Jira API token, audit access, and give the Jira identity only Browse Projects permission for the intended projects.

Organization variables are appropriate for non-sensitive site URLs and API versions. Repository variables can override them when a repository maps to a different Jira site.

## Fork pull requests

Private Jira credentials are unavailable to normal `pull_request` workflows from forks. A metadata-only `pull_request_target` workflow can use base-repository secrets for ordinary fork PRs, but this event has a privileged security context.

The safe boundary is strict:

- Read the PR title from the event payload.
- Check out only a pinned trusted ref from the base repository, if any checkout is needed.
- Never check out `github.event.pull_request.head.sha`.
- Never run a PR-provided script, action, package manager, build, test, or configuration file.
- Keep `GITHUB_TOKEN` read-only.
- Do not pass secrets to another command through command-line arguments.

See [GitHub's secure use reference](https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-guides/security-hardening-for-github-actions) and the [GitHub Security Lab pwn-request guidance](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/).

## Dependabot

GitHub applies additional restrictions when Dependabot triggers workflows:

- For `pull_request` and several related events, the token is read-only and only Dependabot secrets are available.
- For `pull_request_target`, when Dependabot authored the PR, the token is read-only and secrets are unavailable.

That means a private Jira lookup will fail for a Dependabot PR unless policy explicitly exempts the bot or the Jira issue is publicly visible. Recommended options:

1. Allow Dependabot PR titles to bypass Jira validation with an explicit, narrow actor condition.
2. Route Dependabot through a separate required check.
3. Use a public Jira project for dependency work.

Do not weaken the workflow by broadly treating missing credentials as success. Document the bot exception in the ruleset and audit it.

See [Dependabot on GitHub Actions](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions).

## Merge queue

Required checks must report on the merge queue's synthetic commit. A workflow required on a branch should listen for `merge_group` as well as its PR event.

The demo workflow emits the same `Jira ticket` check for `merge_group` and succeeds because each PR title was already validated before queue entry. The `merge_group` payload does not provide the same single-PR title contract as `pull_request_target`.

If policy requires revalidating every queued PR title, use the GitHub API to enumerate the merge group's pull requests and validate each title. Keep that lookup read-only and do not execute PR code.

See [Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue).

## Bypasses

Start with no bypass actors in the example payloads, then add only documented operational identities:

- Release automation that cannot attach a Jira issue.
- Emergency responders using a break-glass role.
- Dependabot, if dependency changes are tracked through another process.

Prefer `pull_request`-only bypass mode where available so emergency work remains visible in a PR. Review bypass use in ruleset insights and audit logs.

## Failure-mode policy

The demo fails closed for invalid keys, authentication failures, permission failures, rate limiting, and Jira outages.

| Failure | Default policy | Operator action |
| --- | --- | --- |
| Missing or malformed key | Block | Fix the PR title |
| `404` invalid or hidden issue | Block | Verify the key and Browse Projects permission |
| `401` authentication | Block | Rotate or repair credentials |
| `403` permission | Block | Correct Jira project permissions |
| `429` rate limit | Block and retry | Respect `Retry-After`; reduce duplicate runs |
| Jira `5xx` or network outage | Block temporarily | Retry, then use documented break-glass bypass if impact exceeds the outage budget |

For high-availability programs, define an outage budget and a named bypass owner. Do not silently convert outages into success because that makes a broken integration indistinguishable from valid policy.

## Ruleset details

Use [`jira-branch-name.evaluate.json`](../rulesets/jira-branch-name.evaluate.json) to measure branch convention adoption. Keep `main` excluded.

Use [`jira-ticket-required.active.json`](../rulesets/jira-ticket-required.active.json) only after:

- The `Jira ticket` check has run successfully.
- Fork and bot behavior is understood.
- The merge queue path is tested if enabled.
- Bypass actors and outage policy are approved.

Do not enforce Jira keys in every commit by default. The pull request is the consistent unit that survives squash merges, bots, cherry-picks, and backports.
