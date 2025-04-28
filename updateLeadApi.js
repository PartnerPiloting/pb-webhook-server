/****************************************************************
  POST /update-lead
  Body: { nextMessage: string, sendAt?: string }
  - Reads the record ID stored in Credentials → Record ID for Chat
  - Updates “Message To Be Sent” and (optionally) “Send At”
*****************************************************************/
const { DateTime } = require("luxon");   // already in Render image

module.exports = function updateLeadApi(app, base) {
  app.post("/update-lead", async (req, res) => {
    try {
      const { nextMessage, sendAt } = req.body || {};

      if (typeof nextMessage !== "string" || !nextMessage.trim()) {
        return res.status(400).json({ error: "nextMessage required" });
      }

      // 1️⃣ get the pointer row
      const credsRow = (await base("Credentials")
        .select({ maxRecords: 1 }).firstPage())[0];
      if (!credsRow) throw new Error("No Credentials row found");

      const recordId = credsRow.get("Record ID for Chat");
      if (!recordId) throw new Error("Record ID for Chat is empty");

      // 2️⃣ build update payload
      const fields = { "Message To Be Sent": nextMessage.trim() };

      if (sendAt) {
        // accept natural ISO or RFC-2822; store as JS Date (UTC)
        const iso = DateTime.fromISO(sendAt) || DateTime.fromRFC2822(sendAt);
        if (!iso.isValid) throw new Error("Invalid sendAt date-time");
        fields["Send At"] = iso.toJSDate();
      }

      // 3️⃣ update the Lead
      await base("Leads").update(recordId, fields);

      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
};