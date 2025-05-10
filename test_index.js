// test_index.js
console.log("<<<<< STARTING test_index.js - Minimal Test - Version D >>>>>");

const express = require("express"); // We still need express to create an 'app' object
const app = express();
const port = process.env.PORT || 3001; // Use a different port for safety if your main app might run

console.log("Express app created in test_index.js.");

let mountTestQueueFunction;
try {
    console.log("Attempting to require('./test_queue_dispatcher')...");
    mountTestQueueFunction = require("./test_queue_dispatcher"); // Note the variable name change for clarity
    console.log("Successfully required './test_queue_dispatcher'.");
    console.log("Type of mountTestQueueFunction:", typeof mountTestQueueFunction);
} catch (e) {
    console.error("ERROR during require('./test_queue_dispatcher'):", e.message, e.stack);
    // Even if require fails, we'll let the server try to start to see more logs if possible,
    // but this log will be crucial.
}

if (typeof mountTestQueueFunction === 'function') {
    try {
        console.log("Attempting to call mountTestQueueFunction(app)...");
        mountTestQueueFunction(app); // Call the imported function
        console.log("Successfully called mountTestQueueFunction(app).");
    } catch (e) {
        console.error("ERROR calling mountTestQueueFunction(app):", e.message, e.stack);
    }
} else {
    console.error("mountTestQueueFunction is NOT a function. Value is:", mountTestQueueFunction);
    // This is where we'd hit if require('./test_queue_dispatcher') returned undefined
}

app.get("/test-health", (req, res) => {
    console.log("/test-health endpoint hit");
    res.send("Minimal test server is healthy!");
});

app.listen(port, () => {
    console.log(`Minimal test server running on port ${port}. Startup complete.`);
    console.log("If you saw 'mountTestQueueFunction is NOT a function' above, the require failed.");
    console.log("If you saw an error during 'require', that's the primary issue.");
    console.log("If you saw it called successfully, the basic require mechanism works.");
});