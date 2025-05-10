// test_index.js
console.log("<<<<< STARTING test_index.js - Minimal Test - Version D >>>>>");

const express = require("express"); // We still need express to create an 'app' object
const app = express();
const port = process.env.PORT || 3001; // Use a different port for safety

console.log("Express app created in test_index.js.");

let mountTestQueueFunction;
try {
    console.log("Attempting to require('./test_queue_dispatcher')...");
    mountTestQueueFunction = require("./test_queue_dispatcher"); 
    console.log("Successfully required './test_queue_dispatcher'.");
    console.log("Type of mountTestQueueFunction:", typeof mountTestQueueFunction);
} catch (e) {
    console.error("ERROR during require('./test_queue_dispatcher'):", e.message, e.stack);
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
    console.error("This means require('./test_queue_dispatcher') likely did not return the expected function.");
}

app.get("/test-health", (req, res) => {
    console.log("/test-health endpoint hit");
    res.send("Minimal test server is healthy!");
});

app.listen(port, () => {
    console.log(`Minimal test server running on port ${port}. Startup complete.`);
    console.log("Review logs above for success or failure of loading and calling test_queue_dispatcher.");
});