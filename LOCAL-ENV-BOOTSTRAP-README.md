# Local Environment Bootstrap System

## Problem Solved

This system solves two critical problems:

1. **❌ Env vars out of sync** - Local .env file gets outdated as Render env vars change
2. **❌ Secrets accidentally committed** - .env file gets committed to Git, exposing secrets

## Solution

**Render Staging = Master Source of Truth**

Every time you run local code, it automatically:
1. ✅ Fetches latest env vars from Render staging
2. ✅ Saves to `.env` file
3. ✅ Ensures `.gitignore` protects secrets
4. ✅ Runs your code with fresh env vars

## Usage

### Quick Start

```bash
# Fetch latest env vars and run a script
npm run local my-script.js

# Just fetch env vars (no script)
npm run env:fetch

# Check how many env vars are loaded
npm run env:check
```

### Examples

```bash
# Run a test script with latest env vars
npm run local test-something.js

# Run the daily log analyzer with fresh env vars
npm run local daily-log-analyzer.js

# Check Production Issues with latest credentials
npm run local check-execution-log-errors.js
```

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│ 1. You run: npm run local my-script.js                     │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Bootstrap calls: https://render.com/export-env-vars     │
│    (Protected by PB_WEBHOOK_SECRET)                         │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Render endpoint returns all env vars (running on        │
│    Render's server, has access to process.env)             │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Bootstrap saves to .env file                             │
│    (Overwrites old values with latest from Render)          │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Bootstrap verifies .gitignore protects .env              │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Bootstrap loads env vars into memory                     │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Your script runs with fresh env vars!                    │
└─────────────────────────────────────────────────────────────┘
```

## Security

### Endpoint Protection

The `/export-env-vars` endpoint is protected by:
- ✅ Same `PB_WEBHOOK_SECRET` used for other admin endpoints
- ✅ Requires `Authorization: Bearer Diamond9753!!@@pb` header
- ✅ Returns 401 Unauthorized if secret is wrong

### .gitignore Protection

The system automatically ensures `.gitignore` includes:
```
.env
.env.*
!.env.example
*.env
.env.local
.env.staging
.env.production
```

**This means .env files can NEVER be committed to Git.**

## Files Created

| File | Purpose | Committed? |
|------|---------|-----------|
| `bootstrap-local-env.js` | Fetch env vars from Render | ✅ Yes |
| `.env` | Local environment variables | ❌ No (protected) |
| `.gitignore` | Protect secrets from Git | ✅ Yes |

## Troubleshooting

### "Authentication failed"

The `PB_WEBHOOK_SECRET` in the bootstrap script doesn't match Render.

**Fix**: Check the secret in `bootstrap-local-env.js` line 15.

### "Network error"

Can't reach Render staging.

**Fix**: 
1. Check Render is deployed and running
2. Check your internet connection
3. Try: `curl https://pb-webhook-server-staging.onrender.com/health`

### "No env vars loaded"

The `.env` file exists but is empty.

**Fix**: Delete `.env` and run `npm run env:fetch` again.

### "Script not found"

You ran `npm run local nonexistent.js`

**Fix**: Check the script path is correct relative to project root.

## Advanced Usage

### Specify Different Render Environment

Edit `bootstrap-local-env.js` line 13:

```javascript
// Use staging (default)
const RENDER_STAGING_URL = 'pb-webhook-server-staging.onrender.com';

// Or use production
const RENDER_STAGING_URL = 'pb-webhook-server.onrender.com';
```

### Manual Env Var Fetch (Without Running Script)

```bash
npm run env:fetch
```

This fetches and saves env vars but doesn't run any script.

### Check Env Vars Are Loaded

```bash
npm run env:check
```

Shows how many environment variables are loaded.

## Integration with Existing Scripts

**Your scripts don't need to change!**

They already use env vars normally:

```javascript
// my-script.js
require('dotenv').config();  // Still here, but bootstrap already loaded them

const apiKey = process.env.AIRTABLE_API_KEY;  // Works!
// ... rest of your code
```

Just run them with `npm run local` instead of `node`:

```bash
# Old way (might have outdated env vars)
node my-script.js

# New way (always has latest env vars)
npm run local my-script.js
```

## Benefits

✅ **Never out of sync** - Always uses latest env vars from Render
✅ **Never commit secrets** - Bulletproof .gitignore protection  
✅ **Zero manual work** - Automated fetch and save
✅ **Works with any script** - No code changes needed
✅ **Secure** - Protected by PB_WEBHOOK_SECRET

## Created

- **Date**: October 13, 2025
- **Branch**: feature/comprehensive-field-standardization
- **Purpose**: Solve env var sync and security issues for local development
