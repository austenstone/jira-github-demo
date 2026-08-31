# Live pull request demo

This file exists only to keep the demonstration pull request open.

The pull request shows three GitHub-native behaviors:

1. `JRASERVER-1` in the title links directly to Atlassian's public Jira issue.
2. The `Jira ticket` check proves that the issue exists through Jira's public REST API.
3. Editing the title immediately runs validation again without executing pull request code.

Try the failure path by removing or corrupting the Jira key in the title, then restore `JRASERVER-1`.
