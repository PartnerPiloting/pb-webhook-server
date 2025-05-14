// queueDispatcher.js - UPDATED with more logging

require("dotenv").config();
const express = require("express");
const fetch = (...a) => import("node-fetch").then(({ default: f }) => f(...a));

module.exports = function mountDispatcher(app, base) {

    if (!base) {
        console.error("queueDispatcher.js: Airtable 'base' instance was not provided. Airtable operations will fail.");
        return;
    }

    const AT_TABLE = "Leads";

    async function markStatus(id, status, err = "", runId = null) {
        // ... (markStatus function remains the same as you provided)
        console.log(`queueDispatcher.js: Marking status for ID <span class="math-inline">\{id\} to "</span>{status}"`);
        const fieldsToUpdate = {
            "Message Status": status,
            "PB Error Message": String(err).substring(0, 1000) 
        };
        if (runId) fieldsToUpdate["PB Run ID"] = runId;
        if (status === "Sent") fieldsToUpdate["Time PB Message Sent"] = new Date().toISOString();

        try {
            const recordsToUpdate = [{ id, fields: fieldsToUpdate }];
            const updatedRecords = await base(AT_TABLE).update(recordsToUpdate, { typecast: true });
            console.log(`queueDispatcher.js: Airtable PATCH result for ID ${id}:`, updatedRecords.length > 0 ? "Success" : "No records updated (or empty response)");
            if (updatedRecords.length === 0) {
                console.warn(`queueDispatcher.js: Airtable update for ${id} might not have succeeded or returned an empty array.`);
            }
            return updatedRecords;
        } catch (airtableError) {
            console.error(`queueDispatcher.js: Airtable update error in markStatus for ID ${id}:`, airtableError.message, airtableError.stack);
            throw airtableError;
        }
    }

    const queue = [];
    app.post("/enqueue", express.json({ limit: "2mb" }), (req, res) => {
        console.log("queueDispatcher.js: /enqueue hit, body:", JSON.stringify(req.body, null, 2)); // Log the full body
        queue.push({ ...req.body, tries: 0 });
        res.json({ queued: true, size: queue.length });
    });

    async function safeJson(res) {
        const txt = await res.text();
        try { return JSON.parse(txt); }
        catch { return { error: { message: `PB non-JSON: ${txt.slice(0,120)}…` } }; }
    }

    async function phantomBusy(agentId, key) {
        const fetchUrl = `https://api.phantombuster.com/api/v2/agents/fetch?id=${agentId}`;
        // *** ADD THIS LOGGING ***
        console.log(`queueDispatcher.js: phantomBusy - Attempting to fetch URL: "<span class="math-inline">\{fetchUrl\}" with key\: "</span>{key ? 'Provided' : 'NOT Provided'}"`);
        if (!agentId || typeof agentId !== 'string' || agentId.trim() === '') {
            console.error("queueDispatcher.js: phantomBusy - Invalid agentId:", agentId);
            throw new Error("Invalid agentId for phantomBusy"); // Force an error if agentId is bad
        }
        try {
            const info = await fetch(
                fetchUrl,
                { headers: { "X-Phantombuster-Key-1": key } }
            ).then(safeJson);
            const state = info?.agent?.lastExec?.status;
            return state && state !== "success";
        } catch (err) {
            console.error(`queueDispatcher.js: phantomBusy - ERROR making fetch to ${fetchUrl}:`, err.message, err.stack);
            throw err; // Re-throw
        }
    }

    async function launchPhantom(job) {
        const launchUrl = "https://api.phantombuster.com/api/v2/agents/launch";
         // *** ADD THIS LOGGING ***
        console.log(`queueDispatcher.js: launchPhantom - Attempting to POST to URL: "<span class="math-inline">\{launchUrl\}" with pbKey\: "</span>{job.pbKey ? 'Provided' : 'NOT Provided'}"`);
        console.log(`queueDispatcher.js: launchPhantom - Agent ID for payload: "${job.agentId}"`);

        if (!job.agentId || typeof job.agentId !== 'string' || job.agentId.trim() === '') {
            console.error("queueDispatcher.js: launchPhantom - Invalid job.agentId:", job.agentId);
            throw new Error("Invalid agentId for launchPhantom payload"); // Force an error if agentId is bad
        }
        if (!job.profileUrl || typeof job.profileUrl !== 'string' || !job.profileUrl.startsWith('http')) {
             console.error("queueDispatcher.js: launchPhantom - Invalid job.profileUrl:", job.profileUrl);
            throw new Error("Invalid profileUrl for launchPhantom payload"); 
        }


        const payload = {
            id: job.agentId,
            argument: {
                sessionCookie: job.sessionCookie,
                userAgent: job.userAgent,
                profilesPerLaunch: 10,
                message: job.message,
                spreadsheetUrl: job.profileUrl,
                spreadsheetUrlExclusionList: []
            }
        };
        try {
            return fetch(
                launchUrl,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Phantombuster-Key-1": job.pbKey
                    },
                    body: JSON.stringify(payload)
                }
            ).then(safeJson);
        } catch (err) {
            console.error(`queueDispatcher.js: launchPhantom - ERROR making fetch to ${launchUrl}:`, err.message, err.stack);
            throw err; 
        }
    }

    const MAX_TRIES = 5;
    const TICK_INTERVAL = 60_000;

    console.log("queueDispatcher.js: Starting heartbeat interval...");
    setInterval(async () => {
        if (!queue.length) return;
        // console.log(`queueDispatcher.js: Heartbeat - Queue size: ${queue.length}`); // Already have this
        const job = queue[0]; 

        // *** ADD THIS LOGGING ***
        console.log("queueDispatcher.js: Heartbeat - Current job object from queue:", JSON.stringify(job, null, 2));

        try {
            if (await phantomBusy(job.agentId, job.pbKey)) {
                console.log(`queueDispatcher.js: Phantom ${job.agentId} is busy. Job for record ${job.recordId} waits.`);
                return;
            }

            queue.shift(); 
            job.tries += 1;
            console.log(`queueDispatcher.js: Attempting job for record ${job.recordId}, try <span class="math-inline">\{job\.tries\}/</span>{MAX_TRIES}`);

            const res = await launchPhantom(job);

            if (res?.containerId) {
                console.log(`queueDispatcher.js: Phantom launched successfully for record ${job.recordId}. Container: ${res.containerId}`);
                await markStatus(job.recordId, "Sent", "", res.containerId);
            } else if (job.tries < MAX_TRIES) {
                console.warn(`queueDispatcher.js: Phantom launch attempt <span class="math-inline">\{job\.tries\}/</span>{MAX_TRIES} failed for record ${job.recordId}. Re-queuing. Error: ${res?.error?.message || "PB error"}`);
                queue.push(job); 
            } else {
                const msg = res?.error?.message || "Launch failed after max tries";
                console.error(`queueDispatcher.js: Final failure for record ${job.recordId} after ${MAX_TRIES} tries: ${msg}`);
                await markStatus(job.recordId, "Error", msg);
            }
        } catch (loopError) {
            console.error(`queueDispatcher.js: Error in heartbeat processing job for record ${job.recordId} (try ${job.tries}):`, loopError.message, loopError.stack);
            if (job.tries < MAX_TRIES) {
                console.warn(`queueDispatcher.js: Re-queuing job for record ${job.recordId} due to unexpected error in loop.`);
                // To prevent infinite loops if the job object itself is problematic, 
                // you might consider if re-queuing immediately is always safe here
                // or if certain errors from phantomBusy/launchPhantom should prevent re-queue even if tries < MAX_TRIES.
                // For now, keeping existing logic:
                queue.push(job);
            } else {
                await markStatus(job.recordId, "Error", `Loop error: ${loopError.message}`);
            }
        }
    }, TICK_INTERVAL);
    console.log("queueDispatcher.js: Heartbeat interval set up.");
};