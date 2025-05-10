// test_index.js - MODIFIED TO TEST THE FULL, ORIGINAL queueDispatcher.js
console.log("<<<<< STARTING test_index.js - Attempting to load FULL queueDispatcher - Version F >>>>>");

const express = require("express");
const app = express();
const port = process.env.PORT || 3001;

console.log("Express app created in test_index.js (for full queueDispatcher test).");

// We also need dotenv and node-fetch if the full queueDispatcher uses them at the top level
// (queueDispatcher.js does require them)
require("dotenv").config(); // queueDispatcher.js uses this
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args)); // queueDispatcher.js uses this


let actualMountQueueFunction; 
try {
    console.log("Attempting to require('./queueDispatcher') [the FULL version]...");
    actualMountQueueFunction = require("./queueDispatcher"); 
    console.log("Successfully required './queueDispatcher' [the FULL version].");
    console.log("Type of actualMountQueueFunction:", typeof actualMountQueueFunction);
} catch (e) {
    console.error("ERROR during require('./queueDispatcher') [the FULL version]:", e.message, e.stack);
    // Log the error but let server attempt to start
}

if (typeof actualMountQueueFunction === 'function') {
    try {
        console.log("Attempting to call actualMountQueueFunction(app)...");
        actualMountQueueFunction(app); // Call the imported function
        console.log("Successfully called actualMountQueueFunction(app).");
    } catch (e) {
        console.error("ERROR calling actualMountQueueFunction(app):", e.message, e.stack);
    }
} else {
    console.error("actualMountQueueFunction is NOT a function. Value is:", actualMountQueueFunction);
    console.error("This means require('./queueDispatcher') [the FULL version] did not return the expected function.");
}

app.get("/test-health", (req, res) => {
    console.log("/test-health endpoint hit (full queueDispatcher test)");
    res.send("Minimal test server (for full queueDispatcher) is healthy!");
});

app.listen(port, () => {
    console.log(`Minimal test server (for full queueDispatcher) running on port ${port}. Startup complete.`);
    console.log("Review logs above for success or failure of loading and calling the FULL queueDispatcher.");
});