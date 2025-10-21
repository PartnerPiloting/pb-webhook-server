# PMPro Membership Sync - Quick Start Guide

## What Was Built

A complete system that automatically keeps your client statuses in sync with their WordPress PMPro memberships on australiansidehustles.com.au.

## How to Use It

### 1. Test WordPress Connection (First Time)

Make sure your WordPress credentials work:

```bash
# On Render
curl https://pb-webhook-server-staging.onrender.com/api/test-wordpress-connection
```

You should see:
```json
{
  "success": true,
  "message": "WordPress connection successful"
}
```

### 2. Test a Single Client (Optional)

Before running on all clients, test one:

```bash
# Via API
curl -X POST https://pb-webhook-server-staging.onrender.com/api/check-client-membership/CLIENT_ID

# Or locally
node test-client-membership.js CLIENT_ID
```

### 3. Run Full Sync

Update all client statuses at once:

```bash
# Via API (from anywhere)
curl -X POST https://pb-webhook-server-staging.onrender.com/api/sync-client-statuses

# Or via script (on Render)
npm run sync-memberships
```

### 4. Set Up Daily Automatic Sync (Recommended)

In Render Dashboard:
1. Go to your service → **Settings**
2. Scroll to **Cron Jobs**
3. Add new:
   - **Command**: `node sync-client-memberships.js`
   - **Schedule**: `0 2 * * *` (daily at 2 AM)
4. Save

Done! Your clients will automatically sync every day.

## What It Does

For each client:
1. ✅ Checks if they have a WordPress User ID
2. ✅ Looks up that user in WordPress
3. ✅ Checks their PMPro membership level
4. ✅ Validates against "Valid PMPro Levels" table in Airtable
5. ✅ Sets Status to "Active" or "Paused"
6. ✅ Logs any errors to Render

## When Clients Get Paused

A client is set to "Paused" if:
- ❌ No WordPress User ID in Clients table
- ❌ WordPress User ID doesn't exist in WordPress
- ❌ No active PMPro membership
- ❌ PMPro membership level not in "Valid PMPro Levels" table

Errors are logged with `[MEMBERSHIP_SYNC_ERROR]` prefix in Render logs.

## Files Created

1. **`services/pmproMembershipService.js`** - Checks WordPress memberships
2. **`sync-client-memberships.js`** - CLI script for manual/cron runs
3. **`test-client-membership.js`** - Test single client
4. **`PMPRO-MEMBERSHIP-SYNC.md`** - Full documentation
5. **API Endpoints** in `routes/apiAndJobRoutes.js`:
   - `POST /api/sync-client-statuses` - Sync all clients
   - `POST /api/check-client-membership/:clientId` - Check one client
   - `GET /api/test-wordpress-connection` - Test WordPress

## Environment Variables (Already Set)

These are already in your Render environment:
- ✅ `WP_BASE_URL` - australiansidehustles.com.au
- ✅ `WP_ADMIN_USERNAME` - Your WordPress admin username
- ✅ `WP_ADMIN_PASSWORD` - Your WordPress application password
- ✅ `MASTER_CLIENTS_BASE_ID` - Your Airtable base ID

## Troubleshooting

**Problem: "WordPress connection failed"**
- Check WP_ADMIN_USERNAME and WP_ADMIN_PASSWORD in Render
- Make sure you're using Application Password, not regular password

**Problem: "Client has no WordPress User ID"**
- Add WordPress User ID to that client's record in Clients table

**Problem: "Invalid PMPro level X"**
- Add that level to "Valid PMPro Levels" table in Airtable

**Problem: Want to see detailed logs**
- Check Render Logs tab
- Filter by: `[MEMBERSHIP_SYNC]` or `[MEMBERSHIP_SYNC_ERROR]`

## Next Steps

1. ✅ Test the API endpoint to make sure it works
2. ✅ Check Render logs to see results
3. ✅ Review which clients were activated/paused
4. ✅ Set up daily cron job for automatic sync

## Need Help?

Full documentation: See `PMPRO-MEMBERSHIP-SYNC.md`

Questions? Check the logs first, they're very detailed!
