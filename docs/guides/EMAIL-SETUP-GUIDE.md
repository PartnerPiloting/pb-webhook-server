# Email Reporting Setup Guide

## Current Status ✅
- `ALERT_EMAIL=guyralphwilson@gmail.com` is configured in `.env`
- Email reporting service is implemented and integrated
- Smart resume script ready for email reporting

## Required SMTP Configuration

Add these environment variables to your `.env` file and Render deployment:

```bash
# Gmail SMTP Configuration (recommended)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-specific-password

# Alternative: SendGrid
# SMTP_HOST=smtp.sendgrid.net
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=apikey
# SMTP_PASS=your-sendgrid-api-key
```

## Gmail Setup Instructions

### 1. Generate App-Specific Password
1. Go to your Google Account settings
2. Navigate to Security → 2-Step Verification
3. At the bottom, select "App passwords"
4. Generate a new app password for "Mail"
5. Use this password as `SMTP_PASS`

### 2. Add to Environment Files

**Local (.env file):**
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=guyralphwilson@gmail.com
SMTP_PASS=your-16-character-app-password
```

**Render Deployment:**
- Go to your Render service
- Navigate to Environment tab
- Add the same SMTP variables

## Email Reports Include

### 📧 Success Reports
- Execution summary with timing
- Clients processed vs skipped
- Job IDs for tracking
- Success rates and metrics
- Data impact summary

### 🚨 Failure Alerts
- Immediate failure notifications
- Error details and context
- Failed operations breakdown
- Troubleshooting guidance

## Testing Email Setup

Once configured, test with:
```bash
# Test email reporting
API_PUBLIC_BASE_URL=https://pb-webhook-server-staging.onrender.com \
BATCH_PROCESSING_STREAM=1 \
LEAD_SCORING_LIMIT=2 \
POST_SCORING_LIMIT=2 \
node scripts/smart-resume-client-by-client.js
```

## Production Deployment

Your cron job is already configured to run at 12 PM AEST daily:
```bash
# Cron command (already set up)
node scripts/smart-resume-client-by-client.js
```

## Troubleshooting

### Common Issues
1. **"Authentication failed"**: Check app-specific password
2. **"Connection timeout"**: Verify SMTP_HOST and SMTP_PORT
3. **"Email not configured"**: Ensure all SMTP variables are set

### Debug Email Service
Check email configuration in logs:
- ✅ "Email service configured successfully"
- ⚠️ "Email service not configured (missing SMTP credentials)"

## Next Steps

1. ✅ Add SMTP credentials to `.env` and Render
2. ✅ Test email functionality locally
3. ✅ Verify production email delivery
4. ✅ Monitor daily cron job emails

The email reporting system is fully implemented and ready to go once SMTP credentials are configured!