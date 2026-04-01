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
/**
 * Minimal OAuth2 metadata + client_credentials token endpoint so ChatGPT (Mixed auth)
 * can exchange OAuth Client Secret for a Bearer token used on MCP routes.
 */
function mountMcpOAuthForChatGPT(app, log = console) {
  const secret = mcpBearerSecret();
  if (!secret) return;

  const publicBase = (
    process.env.API_PUBLIC_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    'https://pb-webhook-server.onrender.com'
  ).replace(/\/$/, '');

  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      issuer: publicBase,
      authorization_endpoint: `${publicBase}${BASE}/oauth/authorize`,
      token_endpoint: `${publicBase}${BASE}/oauth/token`,
      grant_types_supported: ['client_credentials'],
      token_endpoint_auth_methods_supported: [
        'client_secret_post',
        'client_secret_basic',
        'none'
      ],
      response_types_supported: ['code']
    });
  });

  app.get(`${BASE}/oauth/authorize`, (_req, res) => {
    res.status(400).json({
      error: 'unsupported_response_type',
      error_description:
        'Use client_credentials at the token endpoint. In ChatGPT: OAuth Client ID = chatgpt, Client Secret = same value as PB_WEBHOOK_SECRET on Render.'
    });
  });

  app.post(`${BASE}/oauth/token`, (req, res) => {
    try {
      let grant = req.body && req.body.grant_type;
      let clientId = (req.body && req.body.client_id) || '';
      let clientSecret = (req.body && req.body.client_secret) || '';

      const authz = req.headers.authorization || '';
      if (authz.startsWith('Basic ')) {
        const decoded = Buffer.from(authz.slice(6), 'base64').toString('utf8');
        const idx = decoded.indexOf(':');
        if (idx >= 0) {
          clientId = decoded.slice(0, idx);
          clientSecret = decoded.slice(idx + 1);
        }
      }

      if (grant !== 'client_credentials') {
        return res.status(400).json({ error: 'unsupported_grant_type' });
      }
      if (!clientSecret || clientSecret !== secret) {
        return res.status(401).json({ error: 'invalid_client' });
      }
      const requiredClientId = process.env.MCP_OAUTH_CLIENT_ID;
      if (requiredClientId && clientId !== requiredClientId) {
        return res
          .status(401)
          .json({ error: 'invalid_client', error_description: 'invalid client_id' });
      }

      return res.json({
        access_token: secret,
        token_type: 'Bearer',
        expires_in: 86400
      });
    } catch (e) {
      if (log.error) log.error('mcpPersonalServer oauth/token:', e.message);
      return res.status(500).json({ error: 'server_error' });
    }
  });

  if (log.info) {
    log.info(
      'mcpPersonalServer: OAuth GET /.well-known/oauth-authorization-server + POST /mcp-personal/oauth/token'
    );
  }
}

function mountPersonalMcp(app, log = console) {
  const secret = mcpBearerSecret();
  if (!secret) {
    log.info &&
      log.info('mcpPersonalServer: skipping mount (no PB_WEBHOOK_SECRET / DEBUG_API_KEY / MCP_BEARER_TOKEN)');
    return;
  }

  mountMcpOAuthForChatGPT(app, log);

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
