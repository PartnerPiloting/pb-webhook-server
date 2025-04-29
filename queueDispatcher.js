/***************************************************************
  Queue-based Dispatcher for PhantomBuster LinkedIn Message Sender
  --------------------------------------------------------------
  • POST /enqueue  –  Airtable hands a job {recordId, agentId, pbKey, …}
  • Worker loop    –  single-launch feeding; 30-second heartbeat
***************************************************************/
require("dotenv").config();
const express = require("express");
const fetch   = (...args) => import("node-fetch").then(({default: f}) => f(...args));
const app     = express();
app.use(express.json({ limit: "2mb" }));

/* ---------- Airtable helpers ---------- */
const AT_BASE   = process.env.AT_BASE_ID;
const AT_KEY    = process.env.AT_API_KEY;
const AT_TABLE  = "Leads";                         // adjust if different
const AT        = (path, opt = {}) =>
  fetch(`https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(path)}`, {
    headers: { Authorization: `Bearer ${AT_KEY}`, "Content-Type": "application/json" },
    ...opt
  }).then(r => r.json());

async function markSent(id) {
  return AT(AT_TABLE, {
    method: "PATCH",
    body: JSON.stringify({
      records: [{ id, fields: { "Message Status": "Sent", "PB Error Message": "" } }]
    })
  });
}

/* ---------- in-memory queue ---------- */
const queue = [];   // [{recordId, agentId, pbKey, sessionCookie, userAgent, message, profileUrl}, …]

app.post("/enqueue", (req, res) => {
  try {
    queue.push(req.body);
    return res.json({ queued: true, size: queue.length });
  } catch (e) {
    return res.status(400).json({ queued: false, error: e.message });
  }
});

/* ---------- Phantom helpers ---------- */
async function phantomBusy(agentId, pbKey) {
  const info = await fetch(`https://api.phantombuster.com/api/v2/agents/fetch?id=${agentId}`, {
    headers: { "X-Phantombuster-Key-1": pbKey }
  }).then(r => r.json());
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

  return fetch("https://api.phantombuster.com/api/v2/agents/launch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Phantombuster-Key-1": job.pbKey
    },
    body: JSON.stringify(payload)
  }).then(r => r.json());
}

/* ---------- worker loop ---------- */
setInterval(async () => {
  if (!queue.length) return;                     // nothing waiting

  const job = queue[0];                          // peek oldest job
  if (await phantomBusy(job.agentId, job.pbKey)) return; // PB still running → skip

  queue.shift();                                 // actually take the job
  const result = await launchPhantom(job);

  if (result?.containerId) {
    await markSent(job.recordId);                // optimistic success
  } else {
    // optional: write "Error" back to Airtable
    await AT(AT_TABLE, {
      method: "PATCH",
      body: JSON.stringify({
        records: [{
          id: job.recordId,
          fields: {
            "Message Status": "Error",
            "PB Error Message": result?.error?.message || "Launch failed"
          }
        }]
      })
    });
  }
}, 30_000);   // heartbeat every 30 s

/* ---------- fire it up ---------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Dispatcher queue running on ${PORT}`));