# Contributing

Keep the demo small, secure, and GitHub-native.

1. Put a valid Jira key in the pull request title.
2. Do not add a custom service when a repository setting, workflow, or ruleset solves the problem.
3. Never execute pull request code in the `pull_request_target` workflow.
4. Add tests for validator behavior changes.
5. Run:

```bash
npm test
npm run check
zizmor .github/workflows
shellcheck scripts/configure-autolink.sh
```

Use the [security policy in the README](README.md#security-model) when changing workflow permissions, events, checkout behavior, or secret handling.
