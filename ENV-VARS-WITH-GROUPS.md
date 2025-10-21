# Environment Variables with Render Group Assignments

## Complete List (Alphabetical with Group Assignments)

| Variable Name | Render Group |
|--------------|--------------|
| AIRTABLE_API_KEY | Authentication & API Keys |
| AIRTABLE_BASE_ID | Authentication & API Keys |
| AIRTABLE_HELP_BASE_ID | Authentication & API Keys |
| ALERT_EMAIL | Email & Notifications |
| APIFY_ACTOR_ID | Third-Party Integrations |
| APIFY_API_TOKEN | Third-Party Integrations |
| APIFY_MAX_POSTS | Third-Party Integrations |
| APIFY_POSTED_LIMIT | Third-Party Integrations |
| APIFY_WEBHOOK_TOKEN | Third-Party Integrations |
| BATCH_CHUNK_SIZE | Performance & Optimization |
| DEBUG_LEAD_SCORING | Logging Controls |
| DEBUG_POST_HARVESTING | Logging Controls |
| DEBUG_POST_SCORING | Logging Controls |
| DEBUG_RAW_GEMINI | Logging Controls |
| ENABLE_TOP_SCORING_LEADS | Service Configuration |
| FIRE_AND_FORGET | Fire and Forget Config |
| FIRE_AND_FORGET_BATCH_PROCESS_TESTING | Logging Controls |
| FROM_EMAIL | Email & Notifications |
| GCP_LOCATION | AI Service Configuration |
| GCP_PROJECT_ID | AI Service Configuration |
| GEMINI_MODEL_ID | AI Service Configuration |
| GOOGLE_APPLICATION_CREDENTIALS | AI Service Configuration |
| GPT_CHAT_URL | AI Service Configuration |
| IGNORE_POST_HARVESTING_LIMITS | Testing (Limits etc) |
| LEAD_SCORING_LIMIT | Testing (Limits etc) |
| MAILGUN_API_KEY | Email & Notifications |
| MAILGUN_DOMAIN | Email & Notifications |
| MASTER_CLIENTS_BASE_ID | Authentication & API Keys |
| MAX_CLIENT_PROCESSING_MINUTES | Fire and Forget Config |
| MAX_JOB_PROCESSING_HOURS | Fire and Forget Config |
| NEXT_PUBLIC_API_BASE_URL | Service Configuration |
| NODE_ENV | Service Configuration |
| OPENAI_API_KEY | AI Service Configuration |
| PB_WEBHOOK_SECRET | Authentication & API Keys |
| PORT | Service Configuration |
| POST_SCORING_LIMIT | Testing (Limits etc) |
| RENDER_API_KEY | Render-Logging-Variables |
| RENDER_EXTERNAL_URL | Service Configuration |
| RENDER_GIT_BRANCH | Render-Logging-Variables |
| RENDER_GIT_COMMIT | Render-Logging-Variables |
| RENDER_OWNER_ID | Render-Logging-Variables |
| RENDER_SERVICE_ID | Render-Logging-Variables |
| SMART_RESUME_LOCK_TIMEOUT_HOURS | Fire and Forget Config |
| VERBOSE_SCORING | Testing (Limits etc) |

---

## Grouped View

### 🤖 AI Service Configuration (6 variables)
- GCP_LOCATION
- GCP_PROJECT_ID
- GEMINI_MODEL_ID
- GOOGLE_APPLICATION_CREDENTIALS
- GPT_CHAT_URL
- OPENAI_API_KEY

### ⚡ Performance & Optimization (1 variable)
- BATCH_CHUNK_SIZE

### 🔌 Third-Party Integrations (5 variables)
- APIFY_ACTOR_ID
- APIFY_API_TOKEN
- APIFY_MAX_POSTS
- APIFY_POSTED_LIMIT
- APIFY_WEBHOOK_TOKEN

### 📧 Email & Notifications (4 variables)
- ALERT_EMAIL
- FROM_EMAIL
- MAILGUN_API_KEY
- MAILGUN_DOMAIN

### 🔥 Fire and Forget Config (4 variables)
- FIRE_AND_FORGET
- MAX_CLIENT_PROCESSING_MINUTES
- MAX_JOB_PROCESSING_HOURS
- SMART_RESUME_LOCK_TIMEOUT_HOURS

### ⚙️ Service Configuration (5 variables)
- ENABLE_TOP_SCORING_LEADS
- NEXT_PUBLIC_API_BASE_URL
- NODE_ENV
- PORT
- RENDER_EXTERNAL_URL

### 🔑 Authentication & API Keys (5 variables)
- AIRTABLE_API_KEY
- AIRTABLE_BASE_ID
- AIRTABLE_HELP_BASE_ID
- MASTER_CLIENTS_BASE_ID
- PB_WEBHOOK_SECRET

### 🧪 Testing (Limits etc) (4 variables)
- IGNORE_POST_HARVESTING_LIMITS
- LEAD_SCORING_LIMIT
- POST_SCORING_LIMIT
- VERBOSE_SCORING

### 📝 Logging Controls (5 variables)
- DEBUG_LEAD_SCORING
- DEBUG_POST_HARVESTING
- DEBUG_POST_SCORING
- DEBUG_RAW_GEMINI
- FIRE_AND_FORGET_BATCH_PROCESS_TESTING

### 🖥️ Render-Logging-Variables (5 variables)
- RENDER_API_KEY
- RENDER_GIT_BRANCH
- RENDER_GIT_COMMIT
- RENDER_OWNER_ID
- RENDER_SERVICE_ID

---

## Summary

**Total: 44 environment variables across 10 Render groups**

| Group | Count | Purpose |
|-------|-------|---------|
| AI Service Configuration | 6 | Google Cloud, Gemini, OpenAI settings |
| Performance & Optimization | 1 | Batch processing configuration |
| Third-Party Integrations | 5 | Apify integration settings |
| Email & Notifications | 4 | Mailgun email configuration |
| Fire and Forget Config | 4 | Background job timeouts & limits |
| Service Configuration | 5 | Core service settings (Node, ports, URLs) |
| Authentication & API Keys | 5 | Airtable and webhook authentication |
| Testing (Limits etc) | 4 | Testing mode limits and overrides |
| Logging Controls | 5 | Debug flags and logging verbosity |
| Render-Logging-Variables | 5 | Render platform metadata |
