/****************************************************************
  queueDispatcher.js   (router version – mounts on existing app)
  • POST /enqueue stores jobs in RAM
  • 30-s heartbeat launches Phantom 1-at-a-time with 2-try retry
****************************************************************/
require("dotenv").config();
const express = require("express");
const fetch   = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

module.exports = function mountDispatcher(app) {
  /* -------------------------------------------------------------
     1) Airtable helpers
  ------------------------------------------------------------- */
  const AT_BASE  = process.env.AT_BASE_ID;
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

  async function markStatus(id, status, err = "") {
    await AT(AT_TABLE, {
      method: "PATCH",
      body: JSON.stringify({
        records: [{
          id,
          fields: {
            "Message Status": status,
            "PB Error Message": err
          }
        }]
      })
    });
  }

  /* -------------------------------------------------------------
     2) In-memory queue & /enqueue endpoint
  ------------------------------------------------------------- */
  const queue = [];   // [{recordId,…, tries}]  -- tries defaults to 0

  app.post("/enqueue", express.json({ limit: "2mb" }), (req, res) => {
    queue.push({ ...req.body, tries: 0 });
    return res.json({ queued: true, size: queue.length });
  });

  /* -------------------------------------------------------------
     3) Phantom helpers
  ------------------------------------------------------------- */
  async function safeJson(res) {
    const txt = await res.text();
    try   { return JSON.parse(txt); }
    catch { return { error: { message: `PB non-JSON: ${txt.slice(0,120)}…` } }; }
  }

  async function phantomBusy(agentId, pbKey) {
    const info = await fetch(
      `https://api.phantombuster.com/api/v2/agents/fetch?id=${agentId}`,
      { headers: { "X-Phantombuster-Key-1": pbKey } }
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

  /* -------------------------------------------------------------
     4) Heartbeat – single-launch, 2-try retry logic
  ------------------------------------------------------------- */
  const MAX_TRIES = 2;

  setInterval(async () => {
    if (!queue.length) return;                       // nothing waiting

    const job = queue[0];                            // peek
    if (await phantomBusy(job.agentId, job.pbKey)) return; // PB still running

    queue.shift();                                   // take job off
    job.tries += 1;

    const res = await launchPhantom(job);

    if (res?.containerId) {                          // SUCCESS
      await markStatus(job.recordId, "Sent", "");
    } else if (job.tries < MAX_TRIES) {              // RETRY
      queue.push(job);
      console.log(`Retry ${job.tries}/${MAX_TRIES} — ${res?.error?.message || "unknown PB error"}`);
    } else {                                         // FAIL after retries
      const msg = res?.error?.message || "Launch failed";
      await markStatus(job.recordId, "Error", msg);
      console.log(`Final failure for record ${job.recordId}: ${msg}`);
    }
  }, 30_000);   // 30-second tick
};