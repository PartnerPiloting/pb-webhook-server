/****************************************************************
  queueDispatcher.js   (router version — mounts on existing app)
****************************************************************/
require("dotenv").config();
const express = require("express");
const fetch   = (...args) => import("node-fetch").then(({default: f}) => f(...args));

/**
 * Mounts /enqueue and starts the single-launch heartbeat.
 * @param {import('express').Express} app
 */
module.exports = function mountDispatcher(app) {
  /* -----------------------------------------------------------
     1) Airtable helpers
  ----------------------------------------------------------- */
  const AT_BASE  = process.env.AT_BASE_ID;
  const AT_KEY   = process.env.AT_API_KEY;
  const AT_TABLE = "Leads";                      // change if your table differs
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

  /* -----------------------------------------------------------
     2) In-memory queue & /enqueue endpoint
  ----------------------------------------------------------- */
  const queue = [];          // [{recordId, agentId, pbKey, sessionCookie, userAgent, message, profileUrl}, …]

  app.post("/enqueue", express.json({ limit: "2mb" }), (req, res) => {
    try {
      queue.push(req.body);
      return res.json({ queued: true, size: queue.length });
    } catch (e) {
      return res.status(400).json({ queued: false, error: e.message });
    }
  });

  /* -----------------------------------------------------------
     3) Phantom helpers
  ----------------------------------------------------------- */
  async function phantomBusy(agentId, pbKey) {
    const info = await fetch(
      `https://api.phantombuster.com/api/v2/agents/fetch?id=${agentId}`,
      { headers: { "X-Phantombuster-Key-1": pbKey } }
    ).then(r => r.json());
    return info?.agent?.lastExec?.status === "running";
  }

  async function launchPhantom(job) {
    const payload = {
      id: job.agentId,
      argument: {
        sessionCookie:           job.sessionCookie,
        userAgent:               job.userAgent,
        profilesPerLaunch:       10,
        message:                 job.message,
        spreadsheetUrl:          job.profileUrl,
        spreadsheetUrlExclusionList: []
      }
    };
    return fetch(
      "https://api.phantombuster.com/api/v2/agents/launch",
      {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Phantombuster-Key-1": job.pbKey
        },
        body: JSON.stringify(payload)
      }
    ).then(r => r.json());
  }

  /* -----------------------------------------------------------
     4) Heartbeat loop — one launch at a time
  ----------------------------------------------------------- */
  setInterval(async () => {
    if (!queue.length) return;             // nothing waiting

    const job = queue[0];                  // peek first job
    if (await phantomBusy(job.agentId, job.pbKey)) return;  // PB still running

    queue.shift();                         // take the job off the queue
    const res = await launchPhantom(job);

    if (res?.containerId) {
      await markStatus(job.recordId, "Sent", "");
    } else {
      const msg = res?.error?.message || "Launch failed";
      await markStatus(job.recordId, "Error", msg);
    }
  }, 30_000);   // 30-second tick
};