#!/usr/bin/env bash

set -euo pipefail

repository="${1:-}"
jira_base_url="${JIRA_BASE_URL:-}"
jira_project_key="${JIRA_PROJECT_KEY:-}"

if [[ -z "${repository}" || -z "${jira_base_url}" || -z "${jira_project_key}" ]]; then
  echo "Usage: JIRA_BASE_URL=https://example.atlassian.net JIRA_PROJECT_KEY=ABC $0 OWNER/REPOSITORY" >&2
  exit 2
fi

key_prefix="${jira_project_key}-"
url_template="${jira_base_url%/}/browse/${key_prefix}<num>"

existing_url="$(
  gh api "repos/${repository}/autolinks" \
    --jq ".[] | select(.key_prefix == \"${key_prefix}\") | .url_template" |
    head -n 1
)"

if [[ "${existing_url}" == "${url_template}" ]]; then
  echo "Autolink ${key_prefix} already points to ${url_template}"
  exit 0
fi

if [[ -n "${existing_url}" ]]; then
  echo "Autolink ${key_prefix} already exists with a different URL: ${existing_url}" >&2
  exit 1
fi

gh api --method POST "repos/${repository}/autolinks" \
  -f key_prefix="${key_prefix}" \
  -f url_template="${url_template}" \
  -F is_alphanumeric=false \
  --jq '"Created autolink \(.key_prefix) -> \(.url_template)"'
