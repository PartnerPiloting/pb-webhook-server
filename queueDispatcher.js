// queueDispatcher.js - UPDATED to use passed-in 'base' for Airtable operations

require("dotenv").config();
const express = require("express");
const fetch = (...a) => import("node-fetch").then(({ default: f }) => f(...a)); // Still needed for Phantombuster API calls

// 'base' (Airtable client instance) will be passed into mountDispatcher

module.exports = function mountDispatcher(app, base) { // <-- Now accepts 'base'

  if (!base) {
    console.error("queueDispatcher.js: Airtable 'base' instance was not provided. Airtable operations will fail.");
    // Not starting the interval if base is missing, as markStatus would fail.
    return;
  }

  const AT_TABLE = "Leads"; // Table name can remain a constant

  async function markStatus(id, status, err = "", runId = null) {
    console.log(`queueDispatcher.js: Marking status for ID ${id} to "${status}"`);
    const fieldsToUpdate = {
      "Message Status": status,
      "PB Error Message": String(err).substring(0, 1000) // Ensure error message is a string and not excessively long
    };
    if (runId) fieldsToUpdate["PB Run ID"] = runId;
    if (status === "Sent") fieldsToUpdate["Time PB Message Sent"] = new Date().toISOString();

    try {
      // Use the passed-in 'base' object provided by the airtable npm package
      const recordsToUpdate = [{ id, fields: fieldsToUpdate }];
      const updatedRecords = await base(AT_TABLE).update(recordsToUpdate, { typecast: true }); // typecast as an option
      
      console.log(`queueDispatcher.js: Airtable PATCH result for ID ${id}:`, updatedRecords.length > 0 ? "Success" : "No records updated (or empty response)");
      if (updatedRecords.length === 0) {
          console.warn(`queueDispatcher.js: Airtable update for ${id} might not have succeeded or returned an empty array.`);
      }
      return updatedRecords;
    } catch (airtableError) {
      console.error(`queueDispatcher.js: Airtable update error in markStatus for ID ${id}:`, airtableError.message, airtableError.stack);
      // Consider if an admin alert is needed here too if markStatus fails critically
      throw airtableError; // Re-throw to be caught by the interval loop if necessary
    }
  }

  /* ── Queue & /enqueue endpoint ────────────────────────────── */
  const queue = [];
  app.post("/enqueue", express.json({ limit: "2mb" }), (req, res) => {
    console.log("queueDispatcher.js: /enqueue hit, body:", req.body);
    queue.push({ ...req.body, tries: 0 });
    res.json({ queued: true, size: queue.length });
  });

  /* ── Phantom helpers (Phantombuster API interaction logic remains the same) ─── */
  async function safeJson(res) {
    const txt = await res.text();
    try { return JSON.parse(txt); }
    catch { return { error: { message: `PB non-JSON: ${txt.slice(0,120)}…` } }; }
  }

  async function phantomBusy(agentId, key) {
    // ... (phantomBusy logic remains the same, using fetch)
    const info = await fetch(
      `https://api.phantombuster.com/api/v2/agents/fetch?id=${agentId}`,
      { headers: { "X-Phantombuster-Key-1": key } }
    ).then(safeJson);
    const state = info?.agent?.lastExec?.status;
    return state && state !== "success";
  }

  async function launchPhantom(job) {
    // ... (launchPhantom logic remains the same, using fetch)
    const payload = { /* ... */ }; // Same payload as before
     payload.id = job.agentId;
     payload.argument = {
         sessionCookie: job.sessionCookie,
         userAgent:     job.userAgent,
         profilesPerLaunch: 10,
         message:       job.message,
         spreadsheetUrl: job.profileUrl,
         spreadsheetUrlExclusionList: []
     };
    return fetch( /* ... */ ); // Same fetch call as before
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

  /* ── Heartbeat loop (single-launch, retry with back-off) ─── */
  const MAX_TRIES     = 5;
  const TICK_INTERVAL = 60_000;

  console.log("queueDispatcher.js: Starting heartbeat interval...");
  setInterval(async () => {
    if (!queue.length) return;
    console.log(`queueDispatcher.js: Heartbeat - Queue size: ${queue.length}`);
    const job = queue[0]; // Peek at the job

    try {
      if (await phantomBusy(job.agentId, job.pbKey)) {
        console.log(`queueDispatcher.js: Phantom ${job.agentId} is busy. Job for record ${job.recordId} waits.`);
        return;
      }

      queue.shift(); // Actually remove job from queue
      job.tries += 1;
      console.log(`queueDispatcher.js: Attempting job for record ${job.recordId}, try ${job.tries}/${MAX_TRIES}`);

      const res = await launchPhantom(job);

      if (res?.containerId) {
        console.log(`queueDispatcher.js: Phantom launched successfully for record ${job.recordId}. Container: ${res.containerId}`);
        await markStatus(job.recordId, "Sent", "", res.containerId);
      } else if (job.tries < MAX_TRIES) {
        console.warn(`queueDispatcher.js: Phantom launch attempt ${job.tries}/${MAX_TRIES} failed for record ${job.recordId}. Re-queuing. Error: ${res?.error?.message || "PB error"}`);
        queue.push(job); // Re-add to the end of the queue
      } else {
        const msg = res?.error?.message || "Launch failed after max tries";
        console.error(`queueDispatcher.js: Final failure for record ${job.recordId} after ${MAX_TRIES} tries: ${msg}`);
        await markStatus(job.recordId, "Error", msg);
      }
    } catch (loopError) {
      console.error(`queueDispatcher.js: Error in heartbeat processing job for record ${job.recordId} (try ${job.tries}):`, loopError.message, loopError.stack);
      // Decide if the job should be re-queued or marked as failed if an unexpected error occurs here
      if (job.tries < MAX_TRIES) {
          console.warn(`queueDispatcher.js: Re-queuing job for record ${job.recordId} due to unexpected error in loop.`);
          queue.push(job);
      } else {
          await markStatus(job.recordId, "Error", `Loop error: ${loopError.message}`);
      }
    }
  }, TICK_INTERVAL);
  console.log("queueDispatcher.js: Heartbeat interval set up.");
};