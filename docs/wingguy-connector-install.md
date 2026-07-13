# Wingguy connector - install handover

The **one** thing that lives outside Wingguy: how a client adds the Wingguy MCP connector to
their Claude. Everything else (what it does, setup, rules) Wingguy delivers itself once this is done.

Reusable for any client. For a specific client you only need their **Portal Token** (from their row
in the Master Clients Base → "Portal Token" field).

---

## 1. Guy's pre-flight (do these before sending)

1. **Multi-tenant flag ON in prod** - `WINGGUY_CONNECTOR_MULTITENANT=1` on the prod service
   (`srv-cvqgq53e5dus73fa45ag`). One-time, not per client. **Until this is on, every client's URL
   returns "unauthorized".** (Guy's own shared-token URL is unaffected either way.)
2. **The client is set up** - Active status + a Portal Token on their Master Clients row. (No
   `WINGGUY_ENABLED_CLIENTS` entry needed - that allow-list gates the *extension*, not the connector.)
3. **Build their URL** - `https://pb-webhook-server.onrender.com/mcp2/<their-Portal-Token>`
4. **Send it privately** - the URL contains their secret token; treat it like a password (DM / direct
   email, not a shared doc or channel). To revoke later: regenerate their Portal Token - the old URL
   dies instantly.

---

## 2. The message to send the client (copy-paste; fill in the URL)

> **Getting Wingguy into your Claude - 2 minutes**
>
> Wingguy lives inside your own Claude as a "connector". Here's how to add it:
>
> **First, a quick check:** you'll need a Claude plan that supports custom connectors (Pro, Max,
> Team or Enterprise - the free tier doesn't). If you're on one of those, you're good.
>
> **Add the connector:**
> 1. Open **claude.ai** → **Settings** → **Connectors**.
> 2. Click **Add custom connector**.
> 3. Name it **Wingguy**, and paste this as the URL:
>    `https://pb-webhook-server.onrender.com/mcp2/<YOUR-URL-HERE>`
> 4. Click **Add / Connect**.
>
> That's it. Start a new chat and just type: **"what can I do with Wingguy?"** - Wingguy will take
> it from there and walk you through everything.
>
> Keep that link private - it's your personal key, so don't share it around.

---

## 3. If it doesn't connect

- **"Unauthorized" / connector shows as failed** → either the prod flag isn't on (Guy's pre-flight
  step 1), or the token in the URL doesn't match an **Active** client with that Portal Token.
- **No "Add custom connector" option** → the client's Claude plan doesn't support connectors
  (needs Pro/Max/Team/Enterprise).
- **Connected but no tools appear** → have them start a fresh chat; some clients only surface a new
  connector's tools in a new conversation.
