# Vercel Environment Variables Configuration

## Required Environment Variables for Hotfix Frontend Deployment

These environment variables need to be configured in the Vercel dashboard for the hotfix deployment to work properly:

### 1. Backend API Configuration
```
NEXT_PUBLIC_API_BASE_URL=https://pb-webhook-server.onrender.com
```

### 2. Environment Identifier
```
NEXT_PUBLIC_ENVIRONMENT=hotfix
```

### 3. WordPress Integration (if needed)
```
NEXT_PUBLIC_WP_BASE_URL=
```

## How to Configure in Vercel:

1. Go to Vercel Dashboard
2. Select the `pb-webhook-server` project
3. Go to Settings → Environment Variables
4. Add each variable above for:
   - Production
   - Preview 
   - Development (if testing)

## Branch-Specific Deployment:

Make sure the hotfix branch is properly configured to deploy to the hotfix environment with these specific environment variables.

## Verification:

After setting these variables, the next deployment should be able to:
- Connect to the backend API
- Display "Hotfix - " in the title
- Load all frontend functionality properly

## Current Issue:

The deployment likely failed because `NEXT_PUBLIC_API_BASE_URL` was not configured in Vercel, causing the frontend to not know where to make API calls to the backend.
