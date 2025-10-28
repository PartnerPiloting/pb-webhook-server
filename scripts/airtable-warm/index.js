#!/usr/bin/env node
/**
 * Airtable Warm Pinger via Client Master
 * - Runs on a cron schedule (Render)
 * - Reads active clients from Master Clients base via existing clientService
 * - Pings each client's base with a lightweight select (maxRecords=1)
 */

require('dotenv').config();
const Airtable = require('airtable');
const { getAllActiveClients } = require('../../services/clientService');

const REQUIRED_ENV = ['AIRTABLE_API_KEY', 'MASTER_CLIENTS_BASE_ID', 'AIRTABLE_TABLE_NAME'];

function assertEnv() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

// No internal interval gating — rely on cron schedule entirely

async function pingBase(baseId, tableName) {
  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(baseId);
  const table = base(tableName);
  return new Promise((resolve, reject) => {
    try {
      const sel = table.select({ maxRecords: 1, pageSize: 1, fields: [] });
      sel.firstPage((err, records) => {
        if (err) return reject(err);
        resolve(records?.length || 0);
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function main() {
  assertEnv();

  // Runs every time cron triggers it

  console.log('[warm] Starting Airtable warm ping via Client Master');
  const tableName = process.env.AIRTABLE_TABLE_NAME;

  try {
    const clients = await getAllActiveClients();
    const baseIds = Array.from(
      new Set(
        clients
          .map((c) => c.airtableBaseId)
          .filter((id) => id && String(id).trim().length > 0)
      )
    );

    console.log(`[warm] Active clients: ${clients.length}, unique base IDs: ${baseIds.length}`);

    // Ping all bases in parallel for faster execution
    const pingPromises = baseIds.map(async (baseId) => {
      const start = Date.now();
      try {
        const count = await pingBase(baseId, tableName);
        const ms = Date.now() - start;
        console.log(`[warm] Ping success base=${baseId} table=${tableName} records=${count} timeMs=${ms}`);
        return { baseId, success: true, records: count, timeMs: ms };
      } catch (e) {
        console.error(`[warm] Ping failed base=${baseId} table=${tableName} error=${e.message}`);
        return { baseId, success: false, error: e.message };
      }
    });

    // Wait for all pings to complete
    await Promise.allSettled(pingPromises);

    console.log('[warm] Done');
  } catch (e) {
    console.error('[warm] Fatal error initializing warm pinger:', e.message);
    process.exitCode = 1;
  }
}

main();
