// debug_index.js - For testing the full queueDispatcher.js
console.log("<<<<< STARTING debug_index.js - Will attempt to load FULL queueDispatcher - Version G >>>>>");

// Minimal requires needed if queueDispatcher itself needs them at top level
require("dotenv").config(); // queueDispatcher.js uses this
const express = require("express"); // queueDispatcher.js requires this (for app.post, though not used by mount function directly)
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args)); // queueDispatcher.js uses this for Airtable/PB

const app = express(); // Create an app instance to pass
const port = process.env.PORT || 3001; // Use a different port

console.log("Express app created in debug_index.js.");

let mountTheRealQueueDispatcher; 
try {
    console.log("Attempting to require('./queueDispatcher') [the FULL original version]...");
    // This will try to load your actual queueDispatcher.js file
    mountTheRealQueueDispatcher = require("./queueDispatcher"); 
    console.log("Successfully required './queueDispatcher' [the FULL original version].");
    console.log("Type of mountTheRealQueueDispatcher is:", typeof mountTheRealQueueDispatcher);
} catch (e) {
    console.error("ERROR during require('./queueDispatcher') [the FULL original version]:", e.message);
    console.error("Stack trace for require error:", e.stack); // More detailed error
    // We will let the server attempt to start to see all logs from Render
}

if (typeof mountTheRealQueueDispatcher === 'function') {
    try {
        console.log("Attempting to call mountTheRealQueueDispatcher(app)...");
        mountTheRealQueueDispatcher(app); 
        console.log("Successfully called mountTheRealQueueDispatcher(app).");
    } catch (e) {
        console.error("ERROR calling mountTheRealQueueDispatcher(app):", e.message);
        console.error("Stack trace for call error:", e.stack);
    }
} else {
    console.error("mountTheRealQueueDispatcher is NOT a function. Actual value received:", mountTheRealQueueDispatcher);
    console.error("This means require('./queueDispatcher') [the FULL version] did not return the expected function.");
}

app.get("/debug-health", (req, res) => { // Changed endpoint for clarity
    console.log("/debug-health endpoint hit");
    res.send("Debug server (testing full queueDispatcher) is healthy!");
});

app.listen(port, () => {
    console.log(`Debug server (testing full queueDispatcher) running on port ${port}. Startup complete.`);
    console.log("Review logs above for success or failure of loading and calling the FULL queueDispatcher.");
    console.log("If 'Type of mountTheRealQueueDispatcher' was 'function' and no errors, it loaded!");
    console.log("If 'Type of mountTheRealQueueDispatcher' was 'undefined' or an error occurred during require, the problem is with queueDispatcher.js loading.");
});