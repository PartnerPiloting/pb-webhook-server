const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

// Example route for receiving data from a PB phantom like LinkedIn Search Export
app.post("/pb-webhook/scrapeLeads", (req, res) => {
  console.log("Received data:", req.body);

  // TODO: Insert logic here to:
  // 1) Save data to Airtable
  // 2) Call GPT if desired
  // For now, we'll just log the data and respond.

  res.status(200).json({ message: "Received successfully" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});