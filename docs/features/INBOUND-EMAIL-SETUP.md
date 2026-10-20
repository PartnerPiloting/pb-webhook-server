# Inbound Email (BCC-to-CRM) Setup Guide

## Overview

This feature allows clients to automatically log email conversations with leads by BCCing a special email address. When they BCC an email, the system:

1. Identifies the client by their sender email
2. Finds the lead by the recipient's email
3. Logs the email content to the lead's Notes (Email section)
4. Sets a follow-up date 14 days out

## Architecture

```
Client sends email to lead@company.com
        ↓
BCCs: track@mail.australiansidehustles.com.au
        ↓
Mailgun receives email
        ↓
Mailgun POSTs to /api/webhooks/inbound-email
        ↓
System identifies client (from sender email)
        ↓
System finds lead (from TO email)
        ↓
Updates lead Notes + Follow-up Date
```

## Setup Steps

### 1. Create Mailgun Account

1. Go to https://www.mailgun.com and sign up
2. Free tier includes 5,000 emails/month
3. Note your API key from Settings → API Keys

### 2. Add Domain in Mailgun

1. In Mailgun dashboard → **Sending** → **Domains** → **Add New Domain**
2. Add subdomain: `mail.australiansidehustles.com.au`
3. Follow verification steps

### 3. Add DNS Records

Add these records in your domain registrar (where australiansidehustles.com.au is managed):

**MX Records** (for receiving emails):
```
Host: mail
Type: MX
Priority: 10
Value: mxa.mailgun.org

Host: mail
Type: MX
Priority: 10
Value: mxb.mailgun.org
```

**SPF Record**:
```
Host: mail
Type: TXT
Value: v=spf1 include:mailgun.org ~all
```

**DKIM Record** (Mailgun will provide the exact values):
```
Host: (Mailgun provides this - usually something like smtp._domainkey.mail)
Type: TXT
Value: (Mailgun provides this long key)
```

### 4. Create Inbound Route in Mailgun

1. Go to **Receiving** → **Create Route**
2. Configure:
   - **Expression Type**: Match Recipient
   - **Recipient Pattern**: `.*@mail.australiansidehustles.com.au` (catch-all)
   - **Actions**: 
     - ✅ Forward: `https://pb-webhook-server.onrender.com/api/webhooks/inbound-email`
     - ✅ Store and notify
3. Save the route

### 5. Add Environment Variables

Add to Render environment:

```bash
MAILGUN_API_KEY=key-xxxxxxxxxxxxxxxx
MAILGUN_DOMAIN=mg.knowaguy.com.au
FROM_EMAIL=guy@knowaguy.com.au
MAILGUN_WEBHOOK_SIGNING_KEY=xxxxxxxxxxxxxxxx
```

The signing key is found in Mailgun → Settings → Webhooks → Webhook signing key

**Sending and receiving are two different Mailgun domains.** `MAILGUN_DOMAIN` is the SENDING
domain, the one the error replies and every other system email go out through
(`services/mailgunCreds.js` is the one place that reads it - since 19 Oct 2026 that is
`mg.knowaguy.com.au`, the I Know A Guy domain). RECEIVING - the `track@` BCC address and the
inbound route above - is `mail.australiansidehustles.com.au`, configured in Mailgun's Receiving
section, not in an env var. Moving the sending domain does not touch it.

### 6. Create Airtable Field

In the **Master Clients** base → **Clients** table, add:

| Field Name | Type | Description |
|------------|------|-------------|
| Alternative Email Addresses | Long Text | Semicolon-separated list of additional client emails |

Example value: `john.work@company.com;john@gmail.com;jsmith@outlook.com`

## Usage

### For Clients

Tell clients to BCC this email on ALL emails they send to leads:
```
track@mail.australiansidehustles.com.au
```

**Pro tip**: Set up an email rule/filter to auto-BCC this address.

### Multi-lead meeting notes (Fathom back-to-back meetings)

When you forward a Fathom recap to track@ and want it saved to **multiple leads** (e.g. back-to-back meetings), add an "Add to:" line before the forwarded content or in the subject:

**In the body** (before the forwarded message):
```
Add to: james@hotmail.com, olivier@example.com
```

**In the subject** (optional):
```
Fwd: Recap... [add to: james@hotmail.com, olivier@example.com]
```

**Flexible separators:** Comma, semicolon, or "and" all work:
- `james@x.com; olivier@y.com`
- `James McGuire and Olivier Reuland`
- `james@x.com, olivier@y.com and guy@z.com`

You can use emails or names. The full meeting notes are saved to each matching lead, with a "👥 Multi-attendee meeting" header. Duplicates are skipped per lead (same meeting link = already saved).

### Email Flow Example

**Client sends:**
```
To: sarah@acmecorp.com
From: john@clientcompany.com
BCC: track@mail.australiansidehustles.com.au
Subject: Great connecting on LinkedIn!

Hi Sarah,

Great connecting with you on LinkedIn...
```

**System automatically:**
1. Matches john@clientcompany.com → Client "John Smith"
2. Finds sarah@acmecorp.com in John's leads
3. Adds email to Sarah's Notes under "📧 EMAIL" section
4. Sets follow-up date to 14 days from now

### Reply Threading

When clients reply to lead responses and BCC us, the email typically contains:
- Their new reply (top)
- The lead's previous message (quoted below)

The parser extracts both, giving you the full conversation thread!

## Testing

### Test Endpoint

Use the test endpoint to verify everything is connected:

```bash
curl -X POST https://pb-webhook-server.onrender.com/api/webhooks/inbound-email/test \
  -H "Authorization: Bearer YOUR_DEBUG_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "senderEmail": "client@example.com",
    "recipientEmail": "lead@company.com",
    "subject": "Test Email",
    "body": "This is a test"
  }'
```

### Health Check

```bash
curl https://pb-webhook-server.onrender.com/api/webhooks/inbound-email/health
```

### Clear Cache

After adding Alternative Email Addresses, clear the cache:

```bash
curl -X POST https://pb-webhook-server.onrender.com/api/webhooks/inbound-email/clear-cache \
  -H "Authorization: Bearer YOUR_DEBUG_KEY"
```

## Troubleshooting

### "Client not found" error

1. Check the sender email is in "Client Email Address" field
2. Or add it to "Alternative Email Addresses" (semicolon-separated)
3. Clear cache after changes

### "Lead not found" error

1. Verify the lead exists in client's Airtable base
2. Check the lead has an email address saved
3. Email must match exactly (case-insensitive)

### Emails not arriving

1. Check Mailgun dashboard → Logs
2. Verify MX records are correct (use MX lookup tool)
3. Check inbound route is configured correctly
4. Verify webhook URL is correct

## Files

- [services/inboundEmailService.js](services/inboundEmailService.js) - Core business logic
- [routes/inboundEmailRoutes.js](routes/inboundEmailRoutes.js) - Webhook endpoints
- [constants/airtableUnifiedConstants.js](constants/airtableUnifiedConstants.js) - ALTERNATIVE_EMAIL_ADDRESSES field

## Future Enhancements

- [ ] Multiple BCC addresses for different actions (meeting booked, proposal sent, etc.)
- [ ] Configurable follow-up days per action type
- [ ] Success confirmation emails (optional)
- [ ] Attachment handling
