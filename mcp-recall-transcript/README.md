# Recall transcript MCP server

Fetches the latest Recall meeting transcript for a lead (by email, or by full name as a fallback) from your deployed `pb-webhook-server` and saves it as a `.txt` file on this computer. Cursor / Claude can call it so you do not paste long transcripts by hand.

## Setup

1. In this folder run:

   ```bash
   npm install
   ```

2. Set environment variables (see below). For Cursor MCP, put them in the MCP server `env` block — **do not commit secrets.**

3. Add the server in **Cursor Settings → MCP** (or edit `mcp.json`), for example:

   ```json
   {
     "mcpServers": {
       "recall-transcript": {
         "command": "node",
         "args": ["C:/Users/YOU/Desktop/pb-webhook-server-dev/mcp-recall-transcript/src/index.js"],
         "env": {
           "PB_WEBHOOK_SECRET": "your-secret-from-render",
           "RECALL_TRANSCRIPT_API_BASE": "https://pb-webhook-server.onrender.com",
           "RECALL_TRANSCRIPT_OUTPUT_DIR": "C:/Users/YOU/Documents/RecallTranscripts"
         }
       }
     }
   }
   ```

   Use your real paths. `RECALL_TRANSCRIPT_OUTPUT_DIR` is optional (defaults to `Documents/RecallTranscripts`).

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `PB_WEBHOOK_SECRET` | Yes | Same secret as Render `PB_WEBHOOK_SECRET` (Bearer auth for recall-review API). |
| `RECALL_TRANSCRIPT_API_BASE` | No | Default `https://pb-webhook-server.onrender.com` |
| `RECALL_TRANSCRIPT_OUTPUT_DIR` | No | Folder for saved files. Default: `~/Documents/RecallTranscripts` (Windows: `%USERPROFILE%\\Documents\\RecallTranscripts`) |

## Tool

**`recall_latest_transcript`** — arguments (at least one of `email` or `name` is required):

- `email` (optional): lead email in Airtable (preferred when known)
- `name` (optional): lead full name, e.g. `"Jane Doe"`. Used when no email is given, or when the email lookup finds nothing.
- `after` (optional): ISO 8601 time; only meetings on or after this instant
- `outputDir` (optional): override output folder for this call only

Returns the absolute path to the saved file and a short summary for the assistant.

If the name matches more than one lead, the tool returns the list of matches (name, email, company, id) so the assistant can ask the user which person they meant, and then retry using that lead's email.

## Test without Cursor

```bash
set PB_WEBHOOK_SECRET=your-secret
node src/index.js
```

(It will wait on stdio; use MCP Inspector instead:)

```bash
npx @modelcontextprotocol/inspector node src/index.js
```
