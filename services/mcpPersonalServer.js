/**
 * ChatGPT Apps (regular chat): MCP server mounted on the main Express app.
 * - Streamable HTTP: POST /mcp-personal/mcp
 * - Legacy SSE (ChatGPT "MCP Server URL" often ends in /sse): GET /mcp-personal/sse + POST /mcp-personal/messages
 *
 * Auth: Authorization: Bearer <PB_WEBHOOK_SECRET> (same as other private routes).
 */

const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { lookupLeadContactByName } = require('./coachingClientLookupService');

const BASE = '/mcp-personal';

function mcpBearerSecret() {
  return process.env.PB_WEBHOOK_SECRET || process.env.DEBUG_API_KEY || process.env.MCP_BEARER_TOKEN || '';
}

function mcpAuthMiddleware(req, res, next) {
  const secret = mcpBearerSecret();
  const auth = req.headers.authorization || '';
  const apiKey = String(req.headers['x-mcp-key'] || req.headers['x-api-key'] || '').trim();
  const ok =
    secret && (auth.includes(secret) || apiKey === secret);
  if (!ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

function createPersonalMcpServer() {
  const server = new McpServer({
    name: 'pb-webhook-personal',
    version: '1.0.0'
  });

  server.registerTool(
    'lookup_lead_contact',
    {
      title: 'Lead contact lookup',
      description:
        'Look up email, phone, LinkedIn profile URL, location, and company for a lead by name in the owner Airtable Leads table. Uses the server OWNER_CLIENT_ID (or COACHING_LEADS_CLIENT_ID) unless clientId is provided.',
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe('Lead first and last name as in Airtable, e.g. Matthew Bulat.'),
        company: z
          .string()
          .optional()
          .describe('Optional company to disambiguate duplicate names.'),
        clientId: z
          .string()
          .optional()
          .describe('Optional Master Clients Client ID; overrides OWNER_CLIENT_ID for this call.')
      }
    },
    async ({ name, company, clientId }) => {
      try {
        const out = await lookupLeadContactByName(name, {
          clientId: (clientId || '').trim(),
          clientName: '',
          company: (company || '').trim()
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(out, null, 2) }]
        };
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: msg, code: e.code }) }],
          isError: true
        };
      }
    }
  );

  return server;
}

/**
 * @param {import('express').Express} app
 * @param {{ info?: (m: string) => void }} [log]
 */
function mountPersonalMcp(app, log = console) {
  const secret = mcpBearerSecret();
  if (!secret) {
    log.info &&
      log.info('mcpPersonalServer: skipping mount (no PB_WEBHOOK_SECRET / DEBUG_API_KEY / MCP_BEARER_TOKEN)');
    return;
  }

  const sseTransports = {};

  // --- Legacy HTTP+SSE (URL often https://host/.../sse) ---
  app.get(`${BASE}/sse`, mcpAuthMiddleware, async (req, res) => {
    try {
      const transport = new SSEServerTransport(`${BASE}/messages`, res);
      sseTransports[transport.sessionId] = transport;
      res.on('close', () => {
        delete sseTransports[transport.sessionId];
      });
      const server = createPersonalMcpServer();
      await server.connect(transport);
    } catch (err) {
      log.error && log.error('mcpPersonalServer SSE error:', err.message);
      if (!res.headersSent) {
        res.status(500).end('MCP SSE error');
      }
    }
  });

  app.post(`${BASE}/messages`, mcpAuthMiddleware, async (req, res) => {
    try {
      const sessionId = req.query.sessionId;
      const transport = sseTransports[sessionId];
      if (!transport || !(transport instanceof SSEServerTransport)) {
        return res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'No valid SSE session' },
          id: null
        });
      }
      await transport.handlePostMessage(req, res, req.body);
    } catch (err) {
      log.error && log.error('mcpPersonalServer messages error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: err.message },
          id: null
        });
      }
    }
  });

  // --- Streamable HTTP (stateless POST) ---
  const streamableHandler = async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed. Use POST for stateless MCP.' },
        id: null
      });
      return;
    }
    const server = createPersonalMcpServer();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        transport.close();
        server.close();
      });
    } catch (err) {
      log.error && log.error('mcpPersonalServer streamable error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null
        });
      }
    }
  };

  app.post(`${BASE}/mcp`, mcpAuthMiddleware, streamableHandler);
  app.get(`${BASE}/mcp`, mcpAuthMiddleware, (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null
    });
  });
  app.delete(`${BASE}/mcp`, mcpAuthMiddleware, (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null
    });
  });

  log.info &&
    log.info(
      `mcpPersonalServer: mounted ${BASE}/sse + ${BASE}/messages (legacy SSE), ${BASE}/mcp (streamable POST)`
    );
}

module.exports = { mountPersonalMcp, BASE };
