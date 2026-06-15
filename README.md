# FastBound MCP

An [MCP](https://modelcontextprotocol.io) server for the [FastBound](https://www.fastbound.com) firearms **Acquisition & Disposition (A&D)** API — the electronic bound book used by US Federal Firearms Licensees (FFLs). It lets an MCP client (Claude Desktop, Claude Code, Codex CLI, Codex Desktop, etc.) search inventory, record acquisitions and dispositions, manage contacts, and pull reports through natural language.

> ⚠️ **Compliance disclaimer.** This tool writes to ATF-regulated records (27 CFR Part 478). You — the FFL/operator — are solely responsible for the accuracy and legality of every record. Test against a FastBound **TEST account** before touching production data. Writes are **disabled by default** (see Write safety).

## Features

- **51 tools** covering account/reference, items, acquisitions, dispositions, contacts, reports, webhooks, and inventory — comprehensive coverage of the FastBound v1 Account API.
- **Guarded writes with dry-run preview.** Writes are off unless you opt in; committing/destructive operations preview exactly what they will send and require an explicit `confirm:true`.
- **Rate-limit aware** (60 req/min token bucket + 429 backoff) and surfaces FastBound's side-effect headers (multiple-sale reports, auto-acquisitions on FFL transfers, contact dedupe).

## Install

The server runs over stdio and is configured entirely through environment variables.

### Claude Code

```bash
claude mcp add fastbound \
  -e FASTBOUND_ACCOUNT_NUMBER=12345 \
  -e FASTBOUND_API_KEY=your-api-key \
  -e FASTBOUND_AUDIT_USER=you@ffl.com \
  -e FASTBOUND_ALLOW_WRITES=false \
  -- npx -y fastbound-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "fastbound": {
      "command": "npx",
      "args": ["-y", "fastbound-mcp"],
      "env": {
        "FASTBOUND_ACCOUNT_NUMBER": "12345",
        "FASTBOUND_API_KEY": "your-api-key",
        "FASTBOUND_AUDIT_USER": "you@ffl.com",
        "FASTBOUND_ALLOW_WRITES": "false"
      }
    }
  }
}
```

### Codex (CLI & Desktop)

Codex loads MCP servers over stdio, and both the **Codex CLI** and the **Codex desktop / IDE app** read the same config file: `~/.codex/config.toml`. This is a standard stdio MCP server, so a single entry works for both:

```toml
[mcp_servers.fastbound]
command = "node"
args = ["/absolute/path/to/fastbound-mcp/dist/index.js"]
env = { FASTBOUND_ACCOUNT_NUMBER = "12345", FASTBOUND_API_KEY = "your-api-key", FASTBOUND_AUDIT_USER = "you@ffl.com", FASTBOUND_ALLOW_WRITES = "false" }
```

- **Codex CLI** — run `npm run build` first so `dist/` exists, then start `codex`; the `/mcp` command lists the connected `fastbound` server and its tools.
- **Codex Desktop / IDE extension** — shares the same `~/.codex/config.toml`. Add the block above (or use the app's MCP settings panel), then restart the app to load it.

If you `npm i -g .` (or publish the package), replace the `node` + absolute-path form with `command = "fastbound-mcp"`.

**Compatibility is verified end-to-end:** all 51 tool schemas are standard JSON Schema (draft-07, `additionalProperties: false`, no `$ref`/`anyOf`); tool names stay within OpenAI's function-name limits; the server emits only clean newline-delimited JSON-RPC on stdout (no log pollution) and negotiates MCP protocol `2025-06-18`. Codex's client accepts the tools without modification.

## Configuration

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `FASTBOUND_ACCOUNT_NUMBER` | yes | — | Account number (the numeric id in your cloud.fastbound.com URL). Used as the Basic-auth username. |
| `FASTBOUND_API_KEY` | yes | — | API key from Settings → Account. Basic-auth password. |
| `FASTBOUND_AUDIT_USER` | recommended | — | Email recorded as `X-AuditUser` on writes (ATF audit trail). Must be an active account user. Per-call `auditUser` overrides it. |
| `FASTBOUND_ALLOW_WRITES` | no | `false` | Master write switch. When false, every write tool refuses and sends nothing. |
| `FASTBOUND_BASE_URL` | no | `https://cloud.fastbound.com` | API root override. |
| `FASTBOUND_API_VERSION` | no | — | Optional `x-api-version` header. |

Get a free **TEST account** at fastbound.com to build and validate integrations without affecting real records. Generate the API key in Settings → Account, and find the account number in your dashboard URL.

## Write safety

This server treats writes as dangerous by default:

1. **Off by default.** With `FASTBOUND_ALLOW_WRITES` unset/false, every write tool returns `BLOCKED` and sends nothing.
2. **Audit user required.** Writes need a valid `X-AuditUser` email (from `FASTBOUND_AUDIT_USER` or a per-call `auditUser`).
3. **Dry-run by default for the dangerous ones.** Committing or destructive tools (`acquire`, `dispose`, `commit_*`, `delete_item`, `undispose_item`, `merge_contacts`, `update_*`, theft-loss/destroyed/NFA, …) return a `DRY RUN` preview showing the exact method, path, and request body. Re-call with `confirm:true` to execute. The preview is built from the same code that sends the live request, so it can't drift.
4. **Staging tools execute directly.** Creating *pending* (uncommitted) records or adding items to them carries no ATF effect, so those run without a confirm step (but still require the write switch + audit user).

Tool results are tagged `OK` / `DRY RUN` / `BLOCKED` / `ERROR` on the first line.

## Tools

- **Reference:** `get_account`, `list_smartlists`, `list_users`
- **Items:** `search_items`, `get_item`, `update_item`, `set_item_external_id`, `set_item_acquisition_contact`, `delete_item`, `undispose_item`
- **Acquisitions:** `search_acquisitions`, `get_acquisition`, `get_acquisition_item`, `acquire`, `create_pending_acquisition`, `add_acquisition_items`, `update_acquisition`, `update_acquisition_item`, `attach_acquisition_contact`, `commit_acquisition`, `delete_acquisition`, `delete_acquisition_item`
- **Dispositions:** `search_dispositions`, `get_disposition`, `list_disposition_items`, `list_4473_dispositions`, `dispose`, `create_pending_disposition`, `add_disposition_items`, `update_disposition`, `edit_disposition_item_price`, `attach_disposition_contact`, `remove_disposition_items`, `commit_disposition`, `lock_disposition`, `dispose_theft_loss`, `dispose_destroyed`, `dispose_nfa`, `delete_disposition`
- **Contacts:** `search_contacts`, `get_contact`, `create_contact`, `update_contact`, `manage_contact_licenses`, `merge_contacts`
- **Reports:** `download_bound_book`, `download_4473`, `download_attachment`, `download_multiple_sale_report`
- **Webhooks / Inventory:** `manage_webhooks`, `bulk_verify_inventory`

Firearm classification fields (caliber, manufacturer, type, condition, location) are account-configurable — use `list_smartlists` to discover valid values before writing.

## Development

```bash
npm install
npm run build        # tsc → dist/
npm test             # vitest (offline unit tests)
npm run typecheck
```

The unit tests are fully mocked and offline. An opt-in live smoke test (`test/smoke.account.test.ts`) runs read-only `get_account` against a real account when `FASTBOUND_ACCOUNT_NUMBER`/`FASTBOUND_API_KEY` are set, and skips otherwise:

```bash
FASTBOUND_ACCOUNT_NUMBER=... FASTBOUND_API_KEY=... npx vitest run test/smoke.account.test.ts
```

## License

MIT
