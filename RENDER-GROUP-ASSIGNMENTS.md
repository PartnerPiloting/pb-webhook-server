# Render Environment Group Assignments

This document shows which Render Environment Group each variable should be assigned to.

---

## 🤖 AI Service Configuration
**Env Group ID:** `evg-d3o7ur9r0fne73bvo4kg`

- `GCP_LOCATION`
- `GCP_PROJECT_ID`
- `GEMINI_MODEL_ID`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `GPT_CHAT_URL`
- `OPENAI_API_KEY`

**Total: 6 variables**

---

## ⚡ Performance & Optimization
**Env Group ID:** `evg-d3c6unail9vc73ben7g`

- `BATCH_CHUNK_SIZE`

**Total: 1 variable**

---

## 🔌 Third-Party Integrations
**Env Group ID:** `evg-d3c6q463jplc73bnkk40`

- `APIFY_ACTOR_ID`
- `APIFY_API_TOKEN`
- `APIFY_MAX_POSTS`
- `APIFY_POSTED_LIMIT`
- `APIFY_WEBHOOK_TOKEN`

**Total: 5 variables**

---

## 📧 Email & Notifications
**Env Group ID:** `evg-d3o6mls9c44c73cndu0`

- `ALERT_EMAIL`
- `FROM_EMAIL`
- `MAILGUN_API_KEY`
- `MAILGUN_DOMAIN`

**Total: 4 variables**

---

## 🔥 Fire and Forget Config
**Env Group ID:** `evg-d370arjubre73f38k4bv0`

- `FIRE_AND_FORGET`
- `MAX_CLIENT_PROCESSING_MINUTES`
- `MAX_JOB_PROCESSING_HOURS`
- `SMART_RESUME_LOCK_TIMEOUT_HOURS`

**Total: 4 variables**

---

## ⚙️ Service Configuration
**Env Group ID:** `evg-d3o5crbe5due73aeq6ag`

- `ENABLE_TOP_SCORING_LEADS`
- `NODE_ENV`
- `NEXT_PUBLIC_API_BASE_URL`
- `PORT`
- `RENDER_EXTERNAL_URL`

**Total: 5 variables**

---

## 🔑 Authentication & API Keys
**Env Group ID:** `evg-d3c594qi9vc73brb4cg`

- `AIRTABLE_API_KEY`
- `AIRTABLE_BASE_ID`
- `AIRTABLE_HELP_BASE_ID`
- `MASTER_CLIENTS_BASE_ID`
- `PB_WEBHOOK_SECRET`

**Total: 5 variables**

---

## 🧪 Testing (Limits etc)
**Env Group ID:** `evg-d39jmb7dees73f4jeq0`

- `IGNORE_POST_HARVESTING_LIMITS`
- `LEAD_SCORING_LIMIT`
- `POST_SCORING_LIMIT`
- `VERBOSE_POST_SCORING`

**Total: 4 variables**

---

## 📝 Logging Controls
**Env Group ID:** `evg-d3970l6m97s738aqq8g`

- `DEBUG_LEAD_SCORING`
- `DEBUG_POST_HARVESTING`
- `DEBUG_POST_SCORING`
- `DEBUG_RAW_GEMINI`
- `FIRE_AND_FORGET_BATCH_PROCESS_TESTING`

**Total: 5 variables**

---

## 🖥️ Render-Logging-Variables
**Env Group ID:** `evg-d38jkmhi0fns7382ar20`

- `RENDER_API_KEY`
- `RENDER_OWNER_ID`
- `RENDER_SERVICE_ID`
- `RENDER_GIT_BRANCH`
- `RENDER_GIT_COMMIT`

**Total: 5 variables**

---

## 📊 Summary

| Group | Variables | Purpose |
|-------|-----------|---------|
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

**Total: 44 environment variables across 10 groups**
