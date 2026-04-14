/**
 * MCP server: fetch latest Recall transcript by lead email, save to disk.
 * Logs only to stderr (stdout is reserved for MCP JSON-RPC).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

function defaultOutputDir() {
  const fromEnv = process.env.RECALL_TRANSCRIPT_OUTPUT_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), 'Documents', 'RecallTranscripts');
}

function safeFilePart(s) {
  return String(s).replace(/[^a-zA-Z0-9._@-]+/g, '_').slice(0, 80);
}

async function fetchLatestJson(baseUrl, secret, email, after) {
  const base = baseUrl.replace(/\/$/, '');
  const u = new URL(`${base}/recall-review/api/latest-transcript-by-email`);
  u.searchParams.set('email', email);
  if (after) u.searchParams.set('after', after);

  const res = await fetch(u.toString(), {
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: 'application/json',
    },
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { parseError: true, raw: text.slice(0, 500) };
  }

  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

const server = new McpServer({
  name: 'recall-transcript',
  version: '1.0.0',
});

server.tool(
  'recall_latest_transcript',
  'Fetches the latest Recall meeting transcript for a lead from pb-webhook-server (by Airtable email), saves it as a .txt file under Documents/RecallTranscripts (or RECALL_TRANSCRIPT_OUTPUT_DIR), and returns the full path. Use when the user asks for a transcript by email.',
  {
    email: z.string().email().describe('Lead email in Airtable'),
    after: z
      .string()
      .optional()
      .describe('ISO 8601 datetime — only meetings on or after this instant (optional)'),
    outputDir: z
      .string()
      .optional()
      .describe('Folder to save the file (optional; overrides default for this call only)'),
  },
  async ({ email, after, outputDir }) => {
    const secret = (process.env.PB_WEBHOOK_SECRET || process.env.RECALL_TRANSCRIPT_SECRET || '').trim();
    if (!secret) {
      return {
        content: [
          {
            type: 'text',
            text: 'Configure PB_WEBHOOK_SECRET (or RECALL_TRANSCRIPT_SECRET) in the MCP server env in Cursor settings.',
          },
        ],
        isError: true,
      };
    }

    const base =
      (process.env.RECALL_TRANSCRIPT_API_BASE || 'https://pb-webhook-server.onrender.com').trim();

    let data;
    try {
      data = await fetchLatestJson(base, secret, email, after);
    } catch (e) {
      const detail = e.body ? `\n${JSON.stringify(e.body, null, 2)}` : '';
      return {
        content: [{ type: 'text', text: `Request failed: ${e.message}${detail}` }],
        isError: true,
      };
    }

    if (!data.ok || typeof data.transcript !== 'string') {
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        isError: true,
      };
    }

    const dir = outputDir ? path.resolve(outputDir) : defaultOutputDir();
    await fs.mkdir(dir, { recursive: true });

    const mid = data.meeting?.id ?? 'unknown';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fname = `recall-meeting-${mid}-${safeFilePart(email)}-${stamp}.txt`;
    const filePath = path.join(dir, fname);

    const header = [
      `Title: ${data.meeting?.title || ''}`,
      `Meeting id: ${mid}`,
      `Lead: ${data.leadName || ''} (${data.leadId || ''})`,
      `Email: ${data.email}`,
      `Saved: ${new Date().toISOString()}`,
      '---',
      '',
    ].join('\n');

    await fs.writeFile(filePath, header + data.transcript, 'utf8');

    const msg = [
      `Saved transcript to:\n${filePath}`,
      '',
      `Meeting: ${data.meeting?.title || '?'} (#${mid})`,
      `Transcript length: ${data.transcript.length} characters`,
      '',
      'Open or @-mention this file in Cursor to work with the full text.',
    ].join('\n');

    return { content: [{ type: 'text', text: msg }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
