# Smart FUP Sweep - Test Harness

Proves the backend can complete a small batch of leads **synchronously** (no async, no background).

## Option 1: API Test (against production)

After deploying to Render:

```bash
PB_WEBHOOK_SECRET=your_secret node scripts/smart-fup-sweep-test/run-api-test.js
```

Or with `.env` containing `PB_WEBHOOK_SECRET`:

```bash
node scripts/smart-fup-sweep-test/run-api-test.js
```

Uses `GET /api/smart-followup/sweep-test?limit=2&clientId=Guy-Wilson` (auth: Bearer PB_WEBHOOK_SECRET).

## Option 2: API Test (against local server)

With the backend running locally (`npm start` in another terminal):

```bash
API_BASE=http://localhost:3001 PB_WEBHOOK_SECRET=your_secret node scripts/smart-fup-sweep-test/run-api-test.js
```

Requires `.env` with MASTER_CLIENTS_BASE_ID, AIRTABLE_API_KEY, GCP_*, etc.

## Option 3: Direct service call (local only)

Runs the service directly (no HTTP). Requires full `.env`:

```bash
node scripts/smart-fup-sweep-test/index.js
```

## Success

- **PASS**: Backend processed 2 leads synchronously and returned.
- **FAIL**: Error message or no leads processed.
