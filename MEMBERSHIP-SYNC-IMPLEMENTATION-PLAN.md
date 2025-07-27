# LinkedIn Portal Membership Sync Implementation Plan

## Overview
Automated daily sync between WordPress PMPro memberships and LinkedIn Portal Client Master database to handle payment failures and membership changes.

## Implementation Approach: WordPress REST API + Daily Cron

### Phase 1: WordPress REST API Endpoint (WPCode Snippet)
- Create secure API endpoint: `/wp-json/ash/v1/membership-sync`
- Accepts POST request with client data from backend
- Returns membership status for each WordPress User ID
- Includes security token authentication

### Phase 2: Backend Cron Job (Express/Node.js)
- Runs daily at 3 AM
- Fetches all clients with WordPress IDs from Client Master
- Calls WordPress API with client list
- Updates Client Master `active` field based on PMPro membership status

### Phase 3: Multiple Membership Level Support
- Add `allowedMembershipLevels` field to Client Master
- Map PMPro membership levels to portal service levels
- Support multiple membership tiers (Basic, Premium, VIP)

## Business Logic
- **24-hour grace period** - not instant revocation
- **PMPro auto-removes expired memberships** after 21 days (source of truth)
- **Payment failures** → membership removed → portal access revoked next sync

## Files to Create/Modify
1. **WPCode Snippet**: WordPress REST API endpoint
2. **Backend**: Daily cron job for membership sync
3. **Client Master**: Add membership tracking fields

## Code Examples
- WordPress REST API endpoint with PMPro integration
- Node.js cron job with fetch to WordPress
- Client Master schema updates

## Benefits
- Automated membership sync
- Handles payment failures gracefully
- Supports multiple membership levels
- 24-hour business-friendly grace period
- Secure and scalable

---
*Created: July 28, 2025*
*Status: Deferred for future implementation*
*Search Terms: membership sync, pmpro integration, wordpress api, cron job*
