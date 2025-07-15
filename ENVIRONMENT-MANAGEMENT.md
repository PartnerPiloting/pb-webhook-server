# Environment Variables Management Guide

## Overview
This document provides a comprehensive guide for managing environment variables across all deployment environments.

## Environment Structure
- **Local Development**: `.env` files (gitignored)
- **Render (Backend)**: Environment variables in Render dashboard
- **Vercel (Frontend)**: Environment variables in Vercel dashboard

## Required Variables by Service

### Backend Service (Render + Local)
```bash
# Airtable Configuration
AIRTABLE_API_KEY=pat_xxxxxxxxxxxxxxxxxx
AIRTABLE_BASE_ID=appXXXXXXXXXXXXXX

# AI Services - OpenAI
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxx

# AI Services - Google Cloud (Gemini)
GCP_PROJECT_ID=your-project-id
GCP_LOCATION=us-central1
GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON={"type":"service_account",...}

# Optional Configuration
GEMINI_MODEL_ID=gemini-2.5-pro-preview-05-06
GEMINI_EDITING_MODEL_ID=gemini-2.5-pro
PB_WEBHOOK_SECRET=your-webhook-secret
PORT=3000
BATCH_CHUNK_SIZE=55
GEMINI_TIMEOUT_MS=900000
DEBUG_RAW_GEMINI=0
```

### Frontend Service (Vercel + Local)
```bash
# API Configuration
NEXT_PUBLIC_API_BASE_URL=https://pb-webhook-server.onrender.com/api/linkedin

# Optional Features
NEXT_PUBLIC_WP_BASE_URL=https://yoursite.com/wp-json/wp/v2
```

## Environment-Specific Values

### Production (Render Backend)
- `NEXT_PUBLIC_API_BASE_URL`: `https://pb-webhook-server.onrender.com/api/linkedin`

### Development (Local)
- `NEXT_PUBLIC_API_BASE_URL`: `http://localhost:3000/api/linkedin` (if running backend locally)
- `NEXT_PUBLIC_API_BASE_URL`: `https://pb-webhook-server.onrender.com/api/linkedin` (if using Render backend)

## Security Best Practices

### Sensitive Variables (Never commit to Git)
- `AIRTABLE_API_KEY`
- `OPENAI_API_KEY`
- `GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON`
- `PB_WEBHOOK_SECRET`

### Public Variables (Safe to expose)
- `NEXT_PUBLIC_API_BASE_URL` (prefixed with NEXT_PUBLIC_)
- `NEXT_PUBLIC_WP_BASE_URL` (prefixed with NEXT_PUBLIC_)

## Deployment Checklist

### Before Deploying Backend (Render)
- [ ] Verify all required backend variables are set in Render dashboard
- [ ] Test that GCP credentials JSON is properly formatted
- [ ] Confirm Airtable connection works

### Before Deploying Frontend (Vercel)
- [ ] Set NEXT_PUBLIC_API_BASE_URL in Vercel dashboard
- [ ] Verify API URL points to correct backend environment
- [ ] Test frontend can connect to backend

### Local Development Setup
- [ ] Copy `.env.example` to `.env`
- [ ] Fill in all required variables
- [ ] Test both frontend and backend locally
- [ ] Verify API connections work

## Troubleshooting

### Common Issues
1. **"Airtable API Key not set"**: Check AIRTABLE_API_KEY in backend environment
2. **"Failed to connect to API"**: Verify NEXT_PUBLIC_API_BASE_URL in frontend
3. **GCP Authentication errors**: Check GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON formatting
4. **CORS errors**: Ensure API URL matches exactly between environments

### Environment Validation
The frontend includes environment validation that will show warnings for missing optional variables and errors for missing required variables.

## Maintenance

### Regular Tasks
- [ ] Rotate API keys quarterly
- [ ] Review and clean up unused variables
- [ ] Update documentation when adding new variables
- [ ] Sync variables across environments when values change

### When Adding New Variables
1. Update this documentation
2. Add to appropriate `.env.example` file
3. Update environment validation (if frontend variable)
4. Deploy to all environments
5. Test in all environments

## Environment URLs
- **Backend Production**: https://pb-webhook-server.onrender.com
- **Frontend Production**: https://your-vercel-app.vercel.app
- **Local Development**: http://localhost:3000 (frontend), http://localhost:3000 (backend)
