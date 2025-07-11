# API Route Debugging Guide

## When API Routes Fail - Debug in This Order

### 1. **Check Route Order First** ⚡ (5 minutes)
- **Specific routes** (e.g., `/leads/follow-ups`) MUST come before **parameterized routes** (e.g., `/leads/:leadId`)
- **Quick Test**: Add a simple test route like `/leads/test-route` before the parameterized route
- **Common Issue**: Express matches routes in order, so `/leads/:leadId` will catch `/leads/follow-ups` if it comes first

### 2. **Verify Route is Being Called** ⚡ (5 minutes)
- Add `console.log('🔍 ROUTE CALLED:', req.path)` at the start of the route
- Check if the route is being called at all or if it's going to the wrong route
- Look for the log message in Render logs

### 3. **Check Frontend API Call** ⚡ (5 minutes)
- Verify the frontend is calling the correct URL
- Check browser Network tab for the actual HTTP request
- Look for 404 errors or wrong endpoints

### 4. **Test with Minimal Route** ⚡ (10 minutes)
- Create a simple test route that just returns `{ message: 'success' }`
- If this works, the issue is in the route logic, not routing
- If this fails, the issue is routing/middleware

### 5. **Check Field Names & Filters** (15 minutes)
- Only after confirming the route is being called correctly
- Add debug logs for filter formulas and field names
- Test with no filters first, then add filters back

## Common Issues & Quick Fixes

### Route Order Issues
```javascript
// ❌ WRONG ORDER
router.get('/leads/:leadId', ...)        // This catches everything
router.get('/leads/follow-ups', ...)     // This never gets called

// ✅ CORRECT ORDER  
router.get('/leads/follow-ups', ...)     // Specific routes first
router.get('/leads/:leadId', ...)        // Parameterized routes last
```

### Quick Test Routes
```javascript
// Add these for quick testing
router.get('/leads/test', (req, res) => res.json({ message: 'Route works!' }));
router.get('/test-basic', (req, res) => res.json({ message: 'Basic routing works!' }));
```

### Frontend URL Issues
```javascript
// Check the actual URL being called
console.log('API URL:', `/api/linkedin/leads/follow-ups?client=${clientId}`);
```

## Time-Saving Rules

1. **Never assume field names are correct** - always verify against working routes
2. **Test routing before testing data** - simple route first, then add complexity
3. **Use browser Network tab** - see exactly what HTTP requests are being made
4. **Check Render logs immediately** - don't wait for complex debugging
5. **Route order is the #1 cause** of "route not found" errors

## Debug Log Template

```javascript
// ADD THIS TO EVERY ROUTE BY DEFAULT - saves hours of debugging
console.log('🔍 ROUTE CALLED:', req.method, req.path, 'with params:', req.params, 'query:', req.query);
```

**Why this one line saves so much time:**
- Immediately shows if wrong route is being called
- Shows exactly what parameters Express is seeing
- Catches route order issues in seconds instead of hours
- Should be standard practice, not just for debugging

## Standard Practice: Route Logging

**Always add route logging to new routes:**
```javascript
router.get('/any-new-route', (req, res) => {
    console.log('🔍 ROUTE CALLED:', req.method, req.path, 'with params:', req.params, 'query:', req.query);
    // ... rest of route logic
});
```

**This single line would have saved us 2+ hours in this session.**

## PowerShell Command Issues

### Problem: `&&` operator not supported
```powershell
# ❌ FAILS in PowerShell
cd linkedin-messaging-followup-next && npm run dev
# Error: The token '&&' is not a valid statement separator

# ✅ WORKS in PowerShell - run commands separately
cd linkedin-messaging-followup-next
npm run dev
```

### Alternative: Use semicolon in PowerShell
```powershell
# ✅ WORKS in PowerShell
cd linkedin-messaging-followup-next; npm run dev
```

### Or switch to Command Prompt
```cmd
# ✅ WORKS in cmd
cd linkedin-messaging-followup-next && npm run dev
```

## Session Learning: Route Order Debugging

This debugging session taught us that **route order issues** are the #1 cause of mysterious "NOT_FOUND" errors. The problem wasn't:
- ❌ Field names (we spent time checking these)
- ❌ Filter formulas (we tried multiple approaches)  
- ❌ Database permissions (we verified these work)
- ❌ Deployment issues (we tried redeploying)

The problem was:
- ✅ **Route order** - `/leads/:leadId` was catching `/leads/follow-ups` before it could reach the specific route

**Time spent**: 2+ hours
**Time it should have taken**: 5 minutes with proper debugging order

This guide could have saved us 2+ hours on this debugging session! 