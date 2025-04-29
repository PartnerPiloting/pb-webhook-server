/****************************************************************
  queueDispatcher.js  – mounts on existing Express app
  • /enqueue stores jobs in RAM
  • 30-s heartbeat launches PB one-at-a-time (2-try retry)
****************************************************************/
require("dotenv").config();
const express = require("express");
const fetch   = (...a) => import("node-fetch").then(({ default: f }) => f(...a));

module.exports = function mountDispatcher(app) {
  /* ── Airtable helpers ─────────────────────────────────────── */
  const AT_BASE  = process.env.AIRTABLE_BASE_ID || process.env.AT_BASE_ID;
  const AT_KEY   = process.env.AT_API_KEY;
  const AT_TABLE = "Leads";

  const AT = (path, opt = {}) =>
    fetch(`https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(path)}`, {
      headers: {
        Authorization: `Bearer ${AT_KEY}`,
        "Content-Type": "application/json"
      },
      ...opt
    }).then(r => r.json());

  async function markStatus(id, status, err = "", runId = null) {
    const fields = {
      "Message Status": { name: status },          // single-select
      "PB Error Message": err
    };
    if (runId)               fields["PB Run ID"]            = runId;
    if (status === "Sent")   fields["Time PB Message Sent"] = new Date().toISOString();

    const result = await AT(AT_TABLE, {
      method: "PATCH",
      body: JSON.stringify({
        records: [{ id, fields }],
        typecast: true                           // allow select-by-name
      })
    });

    console.log("Airtable PATCH result:", JSON.stringify(result)); // debug
    return result;
  }

  /* ── Queue & /enqueue endpoint ────────────────────────────── */
  const queue = [];
  app.post("/enqueue", express.json({ limit: "2mb" }), (req, res) => {
    queue.push({ ...req.body, tries: 0 });
    res.json({ queued: true, size: queue.length });
  });

  /* ── Phantom helpers ──────────────────────────────────────── */
  async function safeJson(res) {
    const txt = await res.text();
    try { return JSON.parse(txt); }
    catch { return { error: { message: `PB non-JSON: ${txt.slice(0,120)}…` } }; }
  }

  async function phantomBusy(agentId, key) {
    const info = await fetch(
      `https://api.phantombuster.com/api/v2/agents/fetch?id=${agentId}`,
      { headers: { "X-Phantombuster-Key-1": key } }
    ).then(safeJson);
    return info?.agent?.lastExec?.status === "running";
  }

  async function launchPhantom(job) {
    const payload = {
      id: job.agentId,
      argument: {
        sessionCookie: job.sessionCookie,
        userAgent:     job.userAgent,
        profilesPerLaunch: 10,
        message:       job.message,
        spreadsheetUrl: job.profileUrl,
        spreadsheetUrlExclusionList: []
      }
    };
    return fetch(
      "https://api.phantombuster.com/api/v2/agents/launch",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Phantombuster-Key-1": job.pbKey
        },
        body: JSON.stringify(payload)
      }
    ).then(safeJson);
  }

  /* ── Heartbeat loop (single-launch, 2-try retry) ──────────── */
  const MAX_TRIES = 2;
  setInterval(async () => {
    if (!queue.length) return;

    const job = queue[0];
    if (await phantomBusy(job.agentId, job.pbKey)) return;

    queue.shift();
    job.tries += 1;

    const res = await launchPhantom(job);

    if (res?.containerId) {                              // SUCCESS
      await markStatus(job.recordId, "Sent", "", res.containerId);
    } else if (job.tries < MAX_TRIES) {                  // RETRY
      queue.push(job);
      console.log(`Retry ${job.tries}/${MAX_TRIES} — ${res?.error?.message || "PB error"}`);
    } else {                                             // FAIL
      const msg = res?.error?.message || "Launch failed";
      await markStatus(job.recordId, "Error", msg);
      console.log(`Final failure for record ${job.recordId}: ${msg}`);
    }
  }, 30_000);   // 30-second tick
};