/***************************************************************
  Pointer API – updates Credentials → Record ID for Chat
  then redirects the browser to your Custom GPT
***************************************************************/
module.exports = function pointerApi(app, base, gptUrl) {
    app.get("/pointer", async (req, res) => {
      const { recordId } = req.query;
      if (!recordId) return res.status(400).send("Missing recordId");
  
      try {
        // single-row “Credentials” table
        const credsTbl = base("Credentials");
        const credsRow = (await credsTbl.select({ maxRecords: 1 }).firstPage())[0];
        if (!credsRow) throw new Error("No Credentials row found");
  
        await credsTbl.update(credsRow.id, { "Record ID for Chat": recordId });
        return res.redirect(302, gptUrl);      // jump to Custom GPT
      } catch (err) {
        console.error(err);
        return res.status(500).send("Server error: " + err.message);
      }
    });
  };