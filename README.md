# claude-usage-mcp

Ask Claude *"spend at most 20% of my weekly limit on this project"* — and have it actually do it.

Claude Code can't see its own plan usage. The `/usage` screen shows you your session and weekly
percentages, but the model has no way to read them, so it can't budget. This MCP server gives it
that view: the same numbers `/usage` shows, as tools the AI can call.

Zero dependencies. One file. Works with Claude Pro / Max logins.

## Install (Claude Code)

```bash
git clone https://github.com/<you>/claude-usage-mcp ~/claude-usage-mcp
claude mcp add -s user claude-usage -- node ~/claude-usage-mcp/server.mjs
```

Restart Claude Code. Then just say: *"check my usage"* or *"budget 20% of my weekly on the website rebuild"*.

## Tools

| Tool | What it does |
|---|---|
| `get_usage` | Session (5-hour) %, weekly %, per-model weekly caps, time until each resets |
| `budget_start` | Start a budget: project name + max % of the weekly limit. Snapshots the current weekly % |
| `budget_check` | Used / remaining for a budget. Returns `OK`, `LOW`, or `OVER_BUDGET` |
| `budget_end` | Delete a budget |

Budgets survive the weekly reset (what was spent before the reset is carried over) and are stored
in `~/.claude/usage-budgets.json`.

To make Claude check in on its own, add to your `CLAUDE.md`:

```
When a usage budget is active for the current project, call budget_check between major steps
and stop to tell me when it says LOW or OVER_BUDGET.
```

## From the terminal

```bash
node server.mjs      # prints usage + all budgets as JSON
```

## How it works

It reads your Claude Code login (`~/.claude/.credentials.json`, or the macOS Keychain) and calls
the same usage endpoint `/usage` uses. The token never leaves your machine except to go to
`api.anthropic.com`. Responses are cached for 60 seconds.

## Limits — read this

- **Budgets are account-wide.** A budget measures how much your weekly % went up since it started.
  If you run other Claude sessions at the same time, their usage counts against the budget too.
- **Unofficial endpoint.** Anthropic doesn't document it; it could change. If it breaks, open an issue.
- **Token refresh.** If the login token expires, run any `claude` command once and retry.
- Env overrides: `CLAUDE_CONFIG_DIR`, `CLAUDE_OAUTH_TOKEN`, `CLAUDE_USAGE_BUDGETS`.

## License

MIT
