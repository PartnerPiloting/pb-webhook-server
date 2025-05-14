// queueDispatcher.js - UPDATED with corrected logging & specific error status

require("dotenv").config();
const express = require("express");
const fetch = (...a) => import("node-fetch").then(({ default: f }) => f(...a)); // Still needed for Phantombuster API calls

// 'base' (Airtable client instance) will be passed into mountDispatcher

module.exports = function mountDispatcher(app, base) { 

    if (!base) {
        console.error("queueDispatcher.js: Airtable 'base' instance was not provided. Airtable operations will fail.");
        return;
    }

    const AT_TABLE = "Leads"; 

    async function markStatus(id, status, err = "", runId = null) {
        console.log(`queueDispatcher.js: Marking status for ID ${id} to "${status}"`); 
        const fieldsToUpdate = {
            "Message Status": status,
            "PB Error Message": String(err).substring(0, 1000) 
        };
        if (runId) fieldsToUpdate["PB Run ID"] = runId;
        if (status === "Sent") fieldsToUpdate["Time PB Message Sent"] = new Date().toISOString();

        try {
            const recordsToUpdate = [{ id, fields: fieldsToUpdate }];
            const updatedRecords = await base(AT_TABLE).update(recordsToUpdate, { typecast: true });
            
            console.log(`queueDispatcher.js: Airtable PATCH result for ID ${id}: ${updatedRecords.length > 0 ? "Success" : "No records updated (or empty response)"}`);
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
        console.log("queueDispatcher.js: /enqueue hit, body:", JSON.stringify(req.body, null, 2));
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
        console.log(`queueDispatcher.js: phantomBusy - Attempting to fetch URL: ${fetchUrl} with key: ${key ? 'Provided' : 'NOT Provided'}`);
        if (!agentId || typeof agentId !== 'string' || agentId.trim() === '') {
            console.error("queueDispatcher.js: phantomBusy - Invalid agentId:", agentId);
            throw new Error("Invalid agentId for phantomBusy"); 
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
            throw err; 
        }
    }

    async function launchPhantom(job) {
        const launchUrl = "https://api.phantombuster.com/api/v2/agents/launch";
        console.log(`queueDispatcher.js: launchPhantom - Attempting to POST to URL: ${launchUrl} with pbKey: ${job.pbKey ? 'Provided' : 'NOT Provided'}`);
        console.log(`queueDispatcher.js: launchPhantom - Agent ID for payload: ${job.agentId}`);

        if (!job.agentId || typeof job.agentId !== 'string' || job.agentId.trim() === '') {
            console.error("queueDispatcher.js: launchPhantom - Invalid job.agentId:", job.agentId);
            throw new Error("Invalid agentId for launchPhantom payload"); 
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
                profilesPerLaunch: 10, // This is a PB default, actual profiles sent is 1 per job from your setup
                message: job.message,
                spreadsheetUrl: job.profileUrl, // PB typically expects a sheet, but some Phantoms can take a single profile URL here
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
        const job = queue[0]; 

        console.log("queueDispatcher.js: Heartbeat - Current job object from queue:", JSON.stringify(job, null, 2));

        try {
            if (await phantomBusy(job.agentId, job.pbKey)) {
                console.log(`queueDispatcher.js: Phantom ${job.agentId} is busy. Job for record ${job.recordId} waits.`);
                return;
            }

            queue.shift(); 
            job.tries += 1;
            console.log(`queueDispatcher.js: Attempting job for record ${job.recordId}, try ${job.tries}/${MAX_TRIES}`);

            const res = await launchPhantom(job);

            if (res?.containerId) {
                console.log(`queueDispatcher.js: Phantom launched successfully for record ${job.recordId}. Container: ${res.containerId}`);
                await markStatus(job.recordId, "Sent", "", res.containerId);
            } else if (job.tries < MAX_TRIES) {
                console.warn(`queueDispatcher.js: Phantom launch attempt ${job.tries}/${MAX_TRIES} failed for record ${job.recordId}. Re-queuing. Error: ${res?.error?.message || "PB error"}`);
                queue.push(job); 
            } else {
                const msg = res?.error?.message || "Launch failed after max tries";
                console.error(`queueDispatcher.js: Final failure for record ${job.recordId} after ${MAX_TRIES} tries: ${msg}`);
                // *** Use new specific error status ***
                await markStatus(job.recordId, "Error from queueDispatcher", msg); 
            }
        } catch (loopError) {
            console.error(`queueDispatcher.js: Error in heartbeat processing job for record ${job.recordId} (try ${job.tries}):`, loopError.message, loopError.stack);
            if (job.tries < MAX_TRIES) { // Check if job object exists before trying to access job.tries
                job.tries = job.tries || 0; // Initialize tries if it's undefined in this error path
                console.warn(`queueDispatcher.js: Re-queuing job for record ${job.recordId} due to unexpected error in loop.`);
                queue.push(job);
            } else {
                 // *** Use new specific error status ***
                await markStatus(job.recordId, "Error from queueDispatcher", `Loop error: ${loopError.message}`);
            }
        }
    }, TICK_INTERVAL);
    console.log("queueDispatcher.js: Heartbeat interval set up.");
};