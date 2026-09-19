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
2. **The client is set up** - Active status + a Portal Token on their Master Clients row. (The
   connector needs nothing else - the separate **"Wingguy Enabled"** field gates the *Chrome
   extension*, not the connector, so leave it as-is for a chat-only client.)
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
> **First, a quick check:** any current Claude plan works - the free tier allows **one** active
> custom connector (which is all you need for Wingguy), and paid plans (Pro, Max, Team, Enterprise)
> allow several. If you already have another custom connector on free, you'd remove it to add this.
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
> **Then one more minute - tell Claude to ask Wingguy first.** Your Claude has a memory of its own,
> and it answers from that before it thinks to ask Wingguy. Left alone, one day it gives you a
> confident answer that's a month out of date, and you can't tell. Three quick things fix it:
>
> 1. Open **Settings** → **Customize** and find the preferences box. Paste this at the **end** of
>    whatever is already there:
>
>    I use Wingguy - Guy Wilson's I Know A Guy system - through the Wingguy connector. For
>    anything about Wingguy, my Linked Helper machine, Linked Helper, my LinkedIn outreach,
>    follow-ups, meetings booked through it, or how any of it works or is set up: call the
>    Wingguy tools first, before answering - even if you think you already know the answer.
>    Wingguy has the current version; anything you remember may be out of date. If Wingguy
>    doesn't cover it, say so and suggest I ask Guy.
>
>    If the box is full, use this shorter line instead:
>
>    For anything about Wingguy or my Linked Helper machine, call the Wingguy tools first, even
>    if you think you know the answer.
>
> 2. Back in your chat, type this word for word and wait for Claude to say it will remember:
>
>    Remember this: for anything about Wingguy or my Linked Helper machine, always call the
>    Wingguy tools first.
>
> 3. Open a **new** chat and type: **Help me set up my Linked Helper machine**. Look at the first line of the
>    reply - it should say **"Loaded tools"**. Send me a screenshot of that line. If it says
>    "Recalled memory" instead, tell me and we'll sort it on our call.
>
> And one habit from here: start every Wingguy chat with **"where are we up to?"**. Only Wingguy can
> answer it, so it makes sure Wingguy is in the room for the rest of that chat.
>
> Keep that link private - it's your personal key, so don't share it around.

---

## 3. If it doesn't connect

- **"Unauthorized" / connector shows as failed** → either the prod flag isn't on (Guy's pre-flight
  step 1), or the token in the URL doesn't match an **Active** client with that Portal Token.
- **No "Add custom connector" option** → their Claude may not surface connectors in their
  version/region yet, or (on free) they're at the one-connector limit — remove another to add Wingguy.
- **Connected but no tools appear** → have them start a fresh chat; some clients only surface a new
  connector's tools in a new conversation.
