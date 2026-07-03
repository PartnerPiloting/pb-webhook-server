/**
 * Hello-world MCP server — minimal reproduction case for the claude.ai custom-connector bug.
 *
 * 2026-07-03: claude.ai chats fail to surface tools from our real connector despite clean
 * SDK transport + verified handshakes, while a reference connector (Cloudflare docs) works.
 * This is the smallest possible discriminating experiment: ONE trivial tool, NO auth, NO
 * secrets, same host. If chats can't surface even this, the cause is the domain/account,
 * not anything about the real connector. Safe to remove once the mystery is solved.
 *
 * URL: https://<host>/mcp-hello   (streamable POST + legacy SSE GET, no token)
 */

const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const express = require('express');

const BASE = '/mcp-hello';

function createHelloServer() {
  const server = new McpServer({ name: 'hello-world-test', version: '1.0.0' });
  server.registerTool(
    'say_hello',
    {
      title: 'Say hello',
      description: 'A trivial test tool. Returns a friendly greeting. Use it whenever asked to say hello via the hello world test connector.',
      inputSchema: {
        name: z.string().optional().describe('Optional name to greet'),
      },
    },
    async ({ name }) => ({
      content: [{ type: 'text', text: `G'day ${name || 'mate'}! The hello-world MCP connector is alive and reachable.` }],
    }),
  );
  return server;
}

function mountHelloMcp(app, log = console) {
  const hit = (req, note) => {
    console.log(`MCP-HELLO ${req.method} rpc=${req.body?.method || 'n/a'} ${note || ''} ua="${String(req.headers['user-agent'] || '').slice(0, 60)}"`);
  };

  app.post(BASE, express.json({ limit: '1mb' }), async (req, res) => {
    hit(req);
    const server = createHelloServer();
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => { transport.close(); server.close(); });
    } catch (err) {
      log.error && log.error('mcpHelloServer streamable error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  });

  const sseTransports = {};
  app.get(BASE, async (req, res) => {
    hit(req, 'GET-sse');
    try {
      const transport = new SSEServerTransport(`${BASE}/messages`, res);
      sseTransports[transport.sessionId] = transport;
      res.on('close', () => { delete sseTransports[transport.sessionId]; });
      const server = createHelloServer();
      await server.connect(transport);
    } catch (err) {
      log.error && log.error('mcpHelloServer SSE error:', err.message);
      if (!res.headersSent) res.status(500).end('MCP SSE error');
    }
  });
  app.post(`${BASE}/messages`, express.json({ limit: '1mb' }), async (req, res) => {
    hit(req, 'sse-message');
    try {
      const transport = sseTransports[req.query.sessionId];
      if (!transport) {
        return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'No valid SSE session' } });
      }
      await transport.handlePostMessage(req, res, req.body);
    } catch (err) {
      log.error && log.error('mcpHelloServer sse-message error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: err.message } });
      }
    }
  });

  log.info && log.info(`mcpHelloServer: mounted ${BASE} (hello-world repro case, no auth)`);
}

module.exports = { mountHelloMcp, BASE };
