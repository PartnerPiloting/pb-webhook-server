const express = require("express");
const bodyParser = require("body-parser");

const app = express();

// Increase the JSON body size limit to 10 MB
app.use(bodyParser.json({ limit: "10mb" }));

app.post("/pb-webhook/scrapeLeads", (req, res) => {
  console.log("Data received:", req.body);
  res.status(200).json({ message: "Received successfully" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});