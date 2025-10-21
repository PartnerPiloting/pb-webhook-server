# Fire-and-Forget Architecture Plan

## SUPER SIMPLE PLAIN ENGLISH VERSION

### The Problem
- Cron jobs crash after 5 minutes because they try to process too many clients at once
- Network kills long HTTP requests, causing "fetch failed" errors
- No way to resume where we left off when jobs get killed

### The Solution
**Fire-and-Forget Pattern:**
1. Cron job calls API → API says "Job started!" immediately (no waiting)
2. Background process does the actual work (profile scoring, post harvesting, post scoring)
3. If work takes too long, process kills itself safely and saves where it stopped
4. Next cron job continues exactly where the previous one left off

### Multiple Streams for Scale
- Split clients into streams (Stream 1, Stream 2, Stream 3, etc.)
- Each stream runs independently at the same time
- Stream 1 processes clients 1,4,7,10... Stream 2 processes clients 2,5,8,11...
- More streams = handle more clients per day

### One Process Does Everything Per Client
For each client, do ALL tasks before moving to next client:
1. Score their leads (profile scoring)
2. Harvest their posts 
3. Score their posts
4. Move to next client

### Safety Features
- Each client gets maximum 10 minutes (configurable)
- Entire job gets maximum 2 hours (configurable) 
- If either limit hit, save progress and restart cleanly
- Always know exactly which client caused problems
- **Custom email alerts** when timeouts occur (Render won't email for planned exits)

### Result
✅ No more crashes - jobs never fail
✅ Handle unlimited clients - just add more streams  
✅ Perfect recovery - never lose progress
✅ Easy debugging - clear logs showing exactly what happened
✅ Professional system - same pattern Netflix/Google use

---

## DETAILED TECHNICAL VERSION

### Architecture Components

#### 1. Environment Variables (Render Dashboard)
```
FIRE_AND_FORGET = true
MAX_CLIENT_PROCESSING_MINUTES = 10
MAX_JOB_PROCESSING_HOURS = 2
HEARTBEAT_INTERVAL_MINUTES = 1
ALERT_EMAIL = your-email@example.com
SENDGRID_API_KEY = sg.xxxx (or similar email service)
```

#### 2. New Airtable Fields (Clients Table)
**Processing Management:**
- Processing Stream: 1, 2, 3, 4, 5... (number field)

**Lead Scoring Tracking:**
- Lead Scoring Job Status: STARTED/RUNNING/COMPLETED/CLIENT_TIMEOUT_KILLED/JOB_TIMEOUT_KILLED/FAILED
- Lead Scoring Job ID: job_lead_stream1_20250920_143022
- Lead Scoring Last Run Date: timestamp
- Lead Scoring Last Run Time: duration like "2.5 minutes"  
- Leads Scored Last Run: count like "23"

**Post Harvesting Tracking:**
- Post Harvesting Job Status: STARTED/RUNNING/COMPLETED/CLIENT_TIMEOUT_KILLED/JOB_TIMEOUT_KILLED/FAILED
- Post Harvesting Job ID: job_harvest_stream2_20250920_143525
- Post Harvesting Last Run Date: timestamp
- Post Harvesting Last Run Time: duration like "45 seconds"
- Posts Harvested Last Run: count like "15"

**Post Scoring Tracking:**
- Post Scoring Job Status: STARTED/RUNNING/COMPLETED/CLIENT_TIMEOUT_KILLED/JOB_TIMEOUT_KILLED/FAILED
- Post Scoring Job ID: job_postscore_stream3_20250920_144012
- Post Scoring Last Run Date: timestamp  
- Post Scoring Last Run Time: duration like "1.2 minutes"
- Posts Scored Last Run: count like "12"

#### 3. API Endpoints
```
POST /api/batch-process-v2?type=lead_scoring&stream=1
POST /api/batch-process-v2?type=post_harvesting&stream=2
POST /api/batch-process-v2?type=post_scoring&stream=3

Response: 202 Accepted { jobId: "job_lead_stream1_20250920_143022", message: "Job started" }
```

#### 4. Processing Flow
```javascript
async function processStreamInBackground(streamId, jobType) {
    // 1. Check for previous incomplete jobs and resume
    const lastJob = await getLastJobStatus(streamId, jobType);
    const startFromClient = getResumePoint(lastJob);
    
    // 2. Set ultimate job timeout (2 hours)
    setTimeout(async () => {
        await sendTimeoutAlert(null, jobType, 'JOB_TIMEOUT');
        process.exit(1);
    }, MAX_JOB_HOURS * 60 * 60 * 1000);
    
    // 3. Get clients for this stream
    const clients = await getClientsForStream(streamId);
    const remainingClients = clients.slice(startFromClient);
    
    // 4. Process each client with timeout protection
    for (const client of remainingClients) {
        const clientStartTime = Date.now();
        
        try {
            // Per-client timeout wrapper
            await processClientWithTimeout(client, MAX_CLIENT_PROCESSING_MINUTES);
            
        } catch (timeoutError) {
            await logClientTimeout(client, jobType);
            await sendTimeoutAlert(client, jobType, 'CLIENT_TIMEOUT');
            continue; // Move to next client
        }
    }
}

async function processClientWithTimeout(client, maxMinutes) {
    // Existing working functions wrapped in timeout
    if (jobType === 'lead_scoring') {
        await scoreClientLeads(client);
    } else if (jobType === 'post_harvesting') {
        await harvestClientPosts(client);  
    } else if (jobType === 'post_scoring') {
        await scoreClientPosts(client);
    }
}
```

#### 5. Multi-Stream Cron Setup
```
Cron Job 1 (hourly): curl -X POST "https://your-app.com/api/batch-process-v2?type=lead_scoring&stream=1"
Cron Job 2 (hourly): curl -X POST "https://your-app.com/api/batch-process-v2?type=lead_scoring&stream=2"  
Cron Job 3 (hourly): curl -X POST "https://your-app.com/api/batch-process-v2?type=lead_scoring&stream=3"

Cron Job 4 (daily): curl -X POST "https://your-app.com/api/batch-process-v2?type=post_harvesting&stream=1"
Cron Job 5 (daily): curl -X POST "https://your-app.com/api/batch-process-v2?type=post_scoring&stream=1"
```

#### 6. Scalability
- 1 stream: ~800 clients/day
- 3 streams: ~2,400 clients/day
- 5 streams: ~4,000 clients/day  
- 10 streams: ~8,000 clients/day
- Linear scaling by adding more streams

#### 7. Implementation Strategy
1. **Phase 1**: Fire-and-forget wrapper around existing working components
2. **Phase 2**: Add stream filtering to existing functions
3. **Phase 3**: Enhanced logging and timeout protection
4. **Phase 4**: Gradual migration from old endpoints to new v2 endpoints
5. **Phase 5**: Full production rollout

#### 8. Custom Alert System
```javascript
async function sendTimeoutAlert(client, jobType, timeoutType) {
    const alertData = {
        timestamp: new Date().toISOString(),
        jobType: jobType,
        timeoutType: timeoutType, // CLIENT_TIMEOUT or JOB_TIMEOUT
        clientName: client?.name || 'N/A',
        message: timeoutType === 'CLIENT_TIMEOUT' 
            ? `Client ${client.name} exceeded ${MAX_CLIENT_PROCESSING_MINUTES} minute limit during ${jobType}`
            : `Job ${jobType} exceeded ${MAX_JOB_PROCESSING_HOURS} hour limit - killing entire process`,
        nextAction: 'Job will resume from this point on next cron run'
    };
    
    // Send email alert
    await sendEmail({
        to: process.env.ALERT_EMAIL,
        subject: `🚨 Timeout Alert: ${jobType} - ${timeoutType}`,
        body: JSON.stringify(alertData, null, 2)
    });
    
    // Also log to Airtable for dashboard visibility
    await updateClientStatus(client?.id, {
        lastAlertType: timeoutType,
        lastAlertTime: new Date().toISOString()
    });
}

async function sendEmail(emailData) {
    // Using SendGrid as example - can use any email service
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    
    await sgMail.send({
        to: emailData.to,
        from: 'alerts@your-domain.com',
        subject: emailData.subject,
        text: emailData.body
    });
}
```

#### 9. Safety & Recovery
- Per-client timeouts prevent problematic clients from blocking streams
- Ultimate job timeout prevents runaway processes
- Resume logic ensures zero work duplication
- Enhanced logging provides clear audit trail
- Alerts notify of timeout situations
- Graceful exits preserve system stability

#### 9. Backward Compatibility
- Existing endpoints continue working during transition
- Existing cron jobs keep running (with timeouts) during development
- New fields added alongside existing ones
- Easy rollback by disabling new endpoints