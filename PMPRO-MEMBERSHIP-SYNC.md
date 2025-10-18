# PMPro Membership Sync System

## Overview

Automatically syncs client statuses in the Master Clients base based on their WordPress PMPro (Paid Memberships Pro) membership status on australiansidehustles.com.au.

## How It Works

The system checks each client in the Clients table and:

1. **Looks up their WordPress User ID** in the WordPress database
2. **Checks their PMPro membership level**
3. **Validates against "Valid PMPro Levels" table** in Airtable
4. **Updates Status field** to either "Active" or "Paused"

### Rules

| Condition | Status | Action |
|-----------|--------|--------|
| No WordPress User ID | Paused | Error logged to Render |
| WordPress User ID not found in WP | Paused | Error logged to Render |
| No PMPro membership | Paused | Error logged to Render |
| PMPro membership not in valid levels | Paused | Error logged to Render |
| Valid PMPro membership | Active | Status updated |

## Environment Setup

Add these variables to your Render environment (already configured):

```bash
WP_BASE_URL=https://australiansidehustles.com.au
WP_ADMIN_USERNAME=your_admin_username
WP_ADMIN_PASSWORD=your_application_password  # WordPress Application Password
MASTER_CLIENTS_BASE_ID=appJ9XAZeJeK5x55r
```

### Creating WordPress Application Password

1. Log into WordPress as admin
2. Go to **Users → Your Profile**
3. Scroll to **Application Passwords**
4. Enter name: "PB Webhook Server Membership Sync"
5. Click **Add New Application Password**
6. Copy the generated password (you can't see it again!)
7. Add to Render environment as `WP_ADMIN_PASSWORD`

## Usage

### Option 1: API Endpoint (Manual Sync)

Call the API endpoint to trigger a sync:

```bash
# On Render (production)
curl -X POST https://pb-webhook-server.onrender.com/api/sync-client-statuses

# On Render (staging)
curl -X POST https://pb-webhook-server-staging.onrender.com/api/sync-client-statuses

# Locally
curl -X POST http://localhost:3001/api/sync-client-statuses
```

**Response:**
```json
{
  "success": true,
  "message": "Client status sync completed",
  "results": {
    "total": 10,
    "processed": 10,
    "activated": 7,
    "paused": 2,
    "errors": 1,
    "skipped": 0,
    "details": [...]
  }
}
```

### Option 2: Standalone Script

Run the script directly (great for cron jobs):

```bash
# Via npm
npm run sync-memberships

# Or directly
node sync-client-memberships.js
```

**Output:**
```
========================================
🔄 PMPro Membership Sync
========================================

✅ Environment validated
🔍 Testing WordPress connection...
✅ WordPress connection successful
   - Base URL: https://australiansidehustles.com.au
   - PMPro API: Available

📋 Fetching all clients from Master Clients base...
✅ Found 10 clients

[1/10] John Smith (client-001)
────────────────────────────────────────────────────────
   WP User ID: 123
   ✅ Valid membership: Level 2 (Premium Member)
   ✓ Status unchanged: Active

[2/10] Jane Doe (client-002)
────────────────────────────────────────────────────────
   WP User ID: 456
   ⚠️ Invalid or no membership
   → No active PMPro membership found
   🔄 Updating status: Active → Paused
   ⏸️ Status updated to Paused

...

========================================
✅ Membership Sync Complete!
========================================

📊 Summary:
   Total clients: 10
   Processed: 10
   Activated: 7
   Paused: 2
   Unchanged: 1
   Errors: 0
```

### Option 3: Test Individual Client

Check membership status for a single client (for debugging):

```bash
curl -X POST https://pb-webhook-server-staging.onrender.com/api/check-client-membership/client-001
```

**Response:**
```json
{
  "success": true,
  "client": {
    "clientId": "client-001",
    "clientName": "John Smith",
    "wpUserId": 123,
    "currentStatus": "Active"
  },
  "membership": {
    "hasValidMembership": true,
    "levelId": 2,
    "levelName": "Premium Member",
    "error": null
  },
  "recommendation": "Active"
}
```

## Testing WordPress Connection

Test if WordPress credentials are working:

```bash
# API endpoint
curl https://pb-webhook-server-staging.onrender.com/api/test-wordpress-connection

# Expected response
{
  "success": true,
  "message": "WordPress connection successful",
  "details": {
    "success": true,
    "wpApiAvailable": true,
    "pmproApiAvailable": true,
    "baseUrl": "https://australiansidehustles.com.au"
  }
}
```

## Scheduling (Cron Job)

### Render Cron Job Setup

1. Go to Render Dashboard → Your Service
2. Click **Settings**
3. Scroll to **Cron Jobs**
4. Add new cron job:
   - **Command**: `node sync-client-memberships.js`
   - **Schedule**: `0 2 * * *` (daily at 2 AM UTC)
   - **Name**: "Daily PMPro Membership Sync"
5. Save changes

### Cron Schedule Examples

```bash
# Every day at 2 AM UTC
0 2 * * *

# Every 6 hours
0 */6 * * *

# Every Monday at 9 AM UTC
0 9 * * 1

# Twice daily (6 AM and 6 PM UTC)
0 6,18 * * *
```

## Error Handling

### Error Logging

All errors are logged to Render logs with prefix `[MEMBERSHIP_SYNC_ERROR]`:

```
[MEMBERSHIP_SYNC_ERROR] Client "John Smith" (client-001) has no WordPress User ID - setting Status to Paused
[MEMBERSHIP_SYNC_ERROR] Client "Jane Doe" (client-002) - No active PMPro membership found - setting Status to Paused
[MEMBERSHIP_SYNC_ERROR] Fatal error during client status sync: WordPress API timeout
```

### Status Field Updates

When a client is paused due to an error, the **Comment field** is updated with details:

```
[2025-10-18T12:00:00.000Z] Membership sync: No WordPress User ID configured
[2025-10-18T12:00:00.000Z] Membership sync: WordPress User ID 123 not found
[2025-10-18T12:00:00.000Z] Membership sync: No active PMPro membership found
[2025-10-18T12:00:00.000Z] Membership sync: Invalid PMPro level 5
```

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "WordPress User ID not found" | User doesn't exist in WordPress | Verify correct WP User ID in Clients table |
| "No active PMPro membership" | User has no membership | User needs to purchase membership on ASH |
| "Invalid PMPro level X" | Membership level not in valid list | Add level to "Valid PMPro Levels" table |
| "WordPress connection failed" | Bad credentials or API down | Check WP_ADMIN_USERNAME and WP_ADMIN_PASSWORD |
| "No WordPress User ID configured" | Client record missing WP User ID | Add WordPress User ID to Clients table |

## Airtable Tables

### Clients Table (Master Clients Base)

Required fields:
- **WordPress User ID** (Number) - Links to WordPress user
- **Status** (Single Select) - "Active" or "Paused"
- **Comment** (Long Text) - Sync notes and timestamps

### Valid PMPro Levels Table (Master Clients Base)

Contains numeric PMPro level IDs that are considered valid memberships.

Example records:
- Level ID: 1 (Basic Member)
- Level ID: 2 (Premium Member)
- Level ID: 3 (Gold Member)

**Note:** The script checks if a user's PMPro membership level exists in this table. If not, they're set to Paused.

## WordPress PMPro Integration

### How PMPro Membership is Checked

The system tries two methods (in order):

#### Method 1: PMPro REST API (preferred)
If PMPro REST API is available:
```
GET /wp-json/pmpro/v1/get_membership_level_for_user?user_id=123
```

#### Method 2: User Meta Fields (fallback)
If PMPro API not available:
```
GET /wp-json/wp/v2/users/123?context=edit
```
Checks `meta.membership_level` or `meta.pmpro_membership_level`

### PMPro Automatic Expiration

PMPro automatically removes expired memberships, so:
- If a membership exists, it's assumed to be active/valid
- No need to check expiration dates manually
- If PMPro deletes the membership, next sync will catch it

## Troubleshooting

### Test Locally

1. Set up environment variables in `.env`:
```bash
WP_BASE_URL=https://australiansidehustles.com.au
WP_ADMIN_USERNAME=your_username
WP_ADMIN_PASSWORD=your_app_password
MASTER_CLIENTS_BASE_ID=appJ9XAZeJeK5x55r
AIRTABLE_API_KEY=pat_your_key
```

2. Test WordPress connection:
```bash
curl http://localhost:3001/api/test-wordpress-connection
```

3. Test single client:
```bash
curl -X POST http://localhost:3001/api/check-client-membership/client-001
```

4. Run full sync:
```bash
npm run sync-memberships
```

### Debug Mode

Enable detailed logging by setting:
```bash
DEBUG=true
```

Then check logs for:
- WordPress API responses
- PMPro membership checks
- Airtable updates

### Check Render Logs

View logs on Render:
1. Go to Render Dashboard → Your Service
2. Click **Logs** tab
3. Filter by: `[MEMBERSHIP_SYNC]`

## Files Created

- **`services/pmproMembershipService.js`** - Core membership checking logic
- **`sync-client-memberships.js`** - Standalone CLI script
- **`routes/apiAndJobRoutes.js`** - API endpoints (added at end)
- **`constants/airtableUnifiedConstants.js`** - Added VALID_PMPRO_LEVELS table constant

## API Endpoints Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/sync-client-statuses` | POST | Sync all client statuses |
| `/api/check-client-membership/:clientId` | POST | Check single client membership |
| `/api/test-wordpress-connection` | GET | Test WordPress API connection |

## Next Steps

1. ✅ Add WordPress credentials to Render environment (already done)
2. ✅ Test API endpoint manually first
3. ✅ Verify correct clients are activated/paused
4. ✅ Add cron job for daily automatic sync
5. ✅ Monitor Render logs for errors

## Support

If you encounter issues:
1. Check Render logs for `[MEMBERSHIP_SYNC_ERROR]`
2. Test WordPress connection endpoint
3. Verify WordPress User IDs in Clients table
4. Check Valid PMPro Levels table has correct level IDs
