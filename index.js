const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

// Simple test route: no Airtable logic, just log what we receive
app.post("/pb-webhook/scrapeLeads", (req, res) => {
  console.log("Test data received:", req.body);
  // Respond with a simple success message
  res.status(200).json({ message: "Test received successfully" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});