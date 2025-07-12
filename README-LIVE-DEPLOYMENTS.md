# PB Webhook Server

## Live Deployments

### Frontend (Vercel)
- **Live URL**: https://pb-webhook-server.vercel.app
- **Source Code**: `linkedin-messaging-followup-next/`
- **DO NOT EDIT**: `LinkedIn-Messaging-FollowUp/web-portal/` (old version)

### Backend (Render)
- **Live URL**: https://pb-webhook-server.onrender.com
- **Source Code**: Root directory

## Quick Fix Checklist
1. Always edit files in `linkedin-messaging-followup-next/` for frontend changes
2. Test changes locally before committing
3. Check console for actual deployed file paths
4. Verify Vercel deployment completes before testing

## File Structure
```
/linkedin-messaging-followup-next/     ← EDIT THIS (Live Frontend)
/LinkedIn-Messaging-FollowUp/          ← DON'T EDIT (Old)
/routes/                               ← Backend API routes
/config/                               ← Backend config
```

## Emergency Debug
If frontend not updating:
1. Check `linkedin-messaging-followup-next/components/[ComponentName].js`
2. Verify git commits pushed
3. Check Vercel deployment logs
