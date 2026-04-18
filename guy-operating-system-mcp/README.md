# Guy's Operating System — Notion MCP

This MCP server runs **locally on your PC** and connects **Claude Desktop** to your Notion workspace using the official Model Context Protocol (“MCP”). It is **plumbing only**: it reads and writes Notion pages as requested. **Claude** decides what to fetch, how to interpret it, and what to update — this server does **not** add routing, caching, hidden state, or “smart” behavior beyond calling the Notion API and converting blocks to/from Markdown.

## Prerequisites

- **Node.js 20+** (`node -v` should show v20 or newer).
- A **Notion integration** with its secret token (`NOTION_TOKEN`).
- Your **Master Brief** page shared with that integration.

## Setup

1. Copy `.env.example` to `.env` in this folder (same folder as `package.json`).
2. Fill in:
   - `NOTION_TOKEN` — your Notion integration secret (often starts with `secret_` or `ntn_`).
   - `MASTER_BRIEF_ID` — the Notion page id for **Master Brief** (with or without dashes).
   - Optional: `WRITE_LOG_PATH` — where JSONL write-audit lines are appended (default `./write-log.jsonl`).

## Install and build

```bash
npm install
npm run build
```

This produces `build/index.js`, which Claude Desktop will launch.

## Test locally

```bash
npm start
```

**Expected behavior:** the process starts and **waits on stdin** (no HTTP server). That is normal — MCP speaks JSON-RPC over stdio. Press `Ctrl+C` to stop.

For a quick compile check without running:

```bash
npm run typecheck
```

## Connect to Claude Desktop on Windows

1. Quit Claude Desktop completely.
2. Open (or create) the config file:

`%APPDATA%\Claude\claude_desktop_config.json`

3. Add an `mcpServers` entry (merge with any existing JSON — keep valid JSON commas).

Use **your real absolute path** to `build\index.js` on disk. Example:

```json
{
  "mcpServers": {
    "guy-operating-system": {
      "command": "node",
      "args": ["C:\\ABSOLUTE\\PATH\\TO\\guy-operating-system-mcp\\build\\index.js"],
      "env": {
        "NOTION_TOKEN": "ntn_xxx",
        "MASTER_BRIEF_ID": "34647cb5130581bfbfa5c2bb7daeeddb",
        "WRITE_LOG_PATH": "./write-log.jsonl"
      }
    }
  }
}
```

Notes:

- **`args`** must point at the **built** file `build\index.js`, not `src\index.ts`.
- Putting secrets in this file is convenient for local use; treat the file like a password.

## Development (optional)

Run from TypeScript without building:

```bash
npm run dev
```

## How to verify it works

1. Restart **Claude Desktop**.
2. Start a **new conversation**.
3. Type: **`grab my brief`**
4. Ask Claude to use the **`get_brief`** tool (or rely on tool suggestions). You should see **Master Brief** content (Markdown converted from Notion blocks).

## Tools (what Claude can call)

| Tool | Purpose |
|------|---------|
| `get_brief` | Full Master Brief page (recursive blocks → Markdown). |
| `get_mode` | Reads the **Manifest** table under Master Brief, finds the row for `mode_name`, loads each linked page by title. |
| `get_page` | Load one page by **title** (search) or **page id** (UUID). |
| `search` | Workspace search; returns top 10 `{ title, page_id, url, snippet }`. |
| `update_page` | Writes Markdown back: `replace`, `append`, or `insert_after` (anchor substring). Writes append-only JSONL audit lines to `WRITE_LOG_PATH`. |

## Troubleshooting

| Problem | What it usually means |
|---------|------------------------|
| “object_not_found” / 404 on `get_brief` | Wrong `MASTER_BRIEF_ID`, or the page isn’t shared with the integration. Open the page in Notion → **⋯** → **Connections** → add your integration. |
| “unauthorized” / 401 | Wrong `NOTION_TOKEN`, or token revoked. Regenerate in Notion integrations settings. |
| Empty search / missing pages | The integration can only see pages explicitly shared with it (or descendants of linked parents). Share parent pages/databases as needed. |
| Writes fail | Confirm the page allows edits for your integration and `page_id` is correct (copy from Notion “Copy link” and extract the id). |
| Claude never calls tools | Restart Claude Desktop after editing `claude_desktop_config.json`; confirm `args` path is valid. |

## Project layout

- `src/index.ts` — MCP entry; registers tools.
- `src/notion-client.ts` — singleton Notion client + id helpers.
- `src/markdown-converter.ts` — Notion blocks ↔ Markdown (read + write).
- `src/manifest-parser.ts` — parses the **Manifest** markdown table from Master Brief.
- `src/write-log.ts` — append-only JSONL audit log for writes.
- `src/tools/*` — one file per tool.
