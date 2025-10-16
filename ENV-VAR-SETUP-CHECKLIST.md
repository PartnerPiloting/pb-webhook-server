# Environment Variable System - Getting Started Checklist

## ✅ Step-by-Step Setup Guide

Use this checklist to set up the environment variable documentation system from scratch.

---

## Phase 1: Preparation (5 minutes)

### Verify Prerequisites

- [ ] **Node.js installed** (already done - you're running the project)
- [ ] **.env file configured** with required variables:
  - [ ] `MASTER_CLIENTS_BASE_ID=appJ9XAZeJeK5x55r`
  - [ ] `AIRTABLE_API_KEY=pat_...`
  - [ ] `GCP_PROJECT_ID=leads-scoring-459307`
  - [ ] `GCP_LOCATION=us-central1`
- [ ] **Airtable access** to Master Clients base
- [ ] **Google Cloud credentials** configured for Gemini

### Test Your Setup

```bash
# Run the test script
node scripts/test-env-var-documenter.js
```

**Expected output:**
```
✅ All tests passed! System is ready to use.
```

If you see errors, fix them before proceeding.

---

## Phase 2: Create Airtable Table (10 minutes)

### Create the Table

- [ ] Open Airtable: https://airtable.com
- [ ] Navigate to **Master Clients** base (appJ9XAZeJeK5x55r)
- [ ] Click **"Add table"**
- [ ] Name it: **Environment Variables**

### Add Fields (follow AIRTABLE-ENV-VAR-SCHEMA.md)

- [ ] **Variable Name** (Single line text) - Set as PRIMARY FIELD
- [ ] **AI Description** (Long text)
- [ ] **Business Purpose** (Long text)
- [ ] **Category** (Single select)
  - [ ] Add options: Data & Storage, API & Integration, Authentication, Performance, Feature Flags, Debugging, Email, AI Services, Deployment, Other
- [ ] **Staging Value** (Single line text)
- [ ] **Production Value** (Single line text)
- [ ] **Render Group** (Single select)
  - [ ] Add options: Core Services, AI & Scoring, Email & Notifications, Debugging, Feature Flags, Deployment, Development, Not Assigned
- [ ] **Used In Files** (Long text)
- [ ] **Status** (Single select)
  - [ ] Add options: Active, Not Set, Obsolete, Deprecated
  - [ ] Set colors: Active=Green, Not Set=Yellow, Obsolete=Red, Deprecated=Orange
- [ ] **Last Synced** (Date & time, include time)

### Create Views

- [ ] **All Variables** (default view - no filters)
- [ ] **By Render Group** (grouped by Render Group)
- [ ] **Needs Attention** (filter: Status="Not Set" OR Production Value is empty)
- [ ] **Obsolete** (filter: Status="Obsolete" or "Deprecated")

---

## Phase 3: Initial Scan (10 minutes)

### Run the Scanner

```bash
# This will take 5-10 minutes
npm run doc-env-vars scan
```

### What to Expect

- [ ] **Progress messages** showing batches processing
- [ ] **Created** count (new variables found)
- [ ] **Updated** count (existing variables refreshed)
- [ ] **Obsolete** count (variables in Airtable but not in code)

**Example output:**
```
✅ Created: 122 new records
🔄 Updated: 0 existing records
⏭️  Unchanged: 0 records
⚠️  Obsolete: 0 variables
```

### Verify in Airtable

- [ ] Open Environment Variables table
- [ ] Check that ~120+ records were created
- [ ] Verify AI Description field has content
- [ ] Check that Staging Value shows current values
- [ ] Confirm Used In Files lists file paths

---

## Phase 4: Fill Production Values (15 minutes)

### Get Values from Render Production

- [ ] Open Render dashboard: https://dashboard.render.com
- [ ] Navigate to **Production service** (pb-webhook-server)
- [ ] Click **Environment** tab
- [ ] For each variable in the list:
  - [ ] Copy value from Render
  - [ ] Paste into Airtable **Production Value** column

**Pro tip:** Open both Render and Airtable side-by-side for efficiency.

### Priority Variables to Fill First

Start with these critical variables:

- [ ] `AIRTABLE_API_KEY`
- [ ] `AIRTABLE_BASE_ID`
- [ ] `MASTER_CLIENTS_BASE_ID`
- [ ] `GCP_PROJECT_ID`
- [ ] `GCP_LOCATION`
- [ ] `GEMINI_MODEL_ID`
- [ ] `OPENAI_API_KEY`
- [ ] `MAILGUN_API_KEY`
- [ ] `MAILGUN_DOMAIN`
- [ ] `PB_WEBHOOK_SECRET`

---

## Phase 5: Assign Render Groups (20 minutes)

### Group Variables by Function

In Airtable, assign **Render Group** to each variable:

#### Core Services
- [ ] `AIRTABLE_API_KEY`
- [ ] `AIRTABLE_BASE_ID`
- [ ] `MASTER_CLIENTS_BASE_ID`
- [ ] `AIRTABLE_TABLE_NAME`

#### AI & Scoring
- [ ] `GCP_PROJECT_ID`
- [ ] `GCP_LOCATION`
- [ ] `GEMINI_MODEL_ID`
- [ ] `OPENAI_API_KEY`
- [ ] `BATCH_CHUNK_SIZE`
- [ ] `GEMINI_TIMEOUT_MS`

#### Email & Notifications
- [ ] `MAILGUN_API_KEY`
- [ ] `MAILGUN_DOMAIN`
- [ ] `FROM_EMAIL`
- [ ] `ALERT_EMAIL`

#### Authentication & Security
- [ ] `PB_WEBHOOK_SECRET`
- [ ] `BOOTSTRAP_SECRET`
- [ ] `BATCH_API_SECRET`

#### Debugging
- [ ] `DEBUG`
- [ ] `DEBUG_MODE`
- [ ] `DEBUG_LEVEL`
- [ ] `DEBUG_RAW_GEMINI`
- [ ] `DEBUG_RAW_PROMPT`
- [ ] `VERBOSE_SCORING`
- [ ] `VERBOSE_POST_SCORING`

#### Feature Flags
- [ ] `FIRE_AND_FORGET`
- [ ] `ENABLE_TOP_SCORING_LEADS`
- [ ] `IGNORE_POST_HARVESTING_LIMITS`

#### Deployment
- [ ] `PORT`
- [ ] `NODE_ENV`
- [ ] `RENDER_SERVICE_ID`
- [ ] `RENDER_GIT_COMMIT`
- [ ] `RENDER_GIT_BRANCH`
- [ ] `RENDER_OWNER_ID`
- [ ] `RENDER_API_KEY`

**Note:** Not all variables need a group immediately. Focus on the most important ones first.

---

## Phase 6: Create Render Global Groups (15 minutes)

### In Render Dashboard

- [ ] Go to https://dashboard.render.com
- [ ] Navigate to **Environment** → **Global Environment Groups**
- [ ] Create new groups matching your Airtable organization:

#### Group: Core Services
- [ ] Create group "Core Services"
- [ ] Add variables from Airtable where Render Group = "Core Services"
- [ ] Link to: Staging, Production, Hotfix services

#### Group: AI & Scoring
- [ ] Create group "AI & Scoring"
- [ ] Add AI-related variables
- [ ] Link to: Staging, Production services

#### Group: Email & Notifications
- [ ] Create group "Email & Notifications"
- [ ] Add email variables
- [ ] Link to: All services

**Repeat for other groups as needed**

---

## Phase 7: Export Documentation (2 minutes)

### Generate Markdown Documentation

```bash
# Export to default file
npm run doc-env-vars export
```

### Verify Output

- [ ] File created: `ENV-VARIABLES-DOCS.md`
- [ ] Open file and review
- [ ] Check that sensitive values are masked
- [ ] Verify variables are grouped by category
- [ ] Confirm usage locations are listed

### Share with Team

- [ ] Add ENV-VARIABLES-DOCS.md to git repository
- [ ] Share with developers for onboarding
- [ ] Add link to project README

---

## Phase 8: Cleanup (Optional - 10 minutes)

### Find Obsolete Variables

```bash
npm run doc-env-vars obsolete
```

- [ ] Review the list of removal candidates
- [ ] For each candidate:
  - [ ] Verify it's truly not needed
  - [ ] Remove from code if confirmed
  - [ ] Delete from Render environment
  - [ ] Mark as "Obsolete" in Airtable

### Find Consolidation Opportunities

```bash
npm run doc-env-vars consolidate
```

- [ ] Review suggestions
- [ ] Identify variables that can be merged
- [ ] Plan refactoring (future work)

---

## Phase 9: Ongoing Maintenance Setup

### Add to Your Workflow

- [ ] **Weekly**: Quick check for new variables
  ```bash
  npm run show-env-vars
  ```

- [ ] **After adding variables**: Scan and sync
  ```bash
  npm run doc-env-vars scan
  ```

- [ ] **Before deployments**: Check for obsolete vars
  ```bash
  npm run doc-env-vars obsolete
  ```

- [ ] **Monthly**: Full scan and export
  ```bash
  npm run doc-env-vars scan
  npm run doc-env-vars export
  ```

### Set Reminders

- [ ] Add calendar reminder: Monthly env var review
- [ ] Add deployment checklist: Run env var scan
- [ ] Add onboarding checklist: Share ENV-VARIABLES-DOCS.md

---

## Verification Checklist

### System Health Check

- [ ] Run test script passes: `node scripts/test-env-var-documenter.js`
- [ ] Airtable table exists with all fields
- [ ] At least 100+ variables documented
- [ ] AI descriptions are populated (not all "Analysis failed")
- [ ] Staging values match current .env file
- [ ] Production values filled for critical variables
- [ ] Render Groups assigned to key variables
- [ ] Documentation exports successfully

### Quality Check

- [ ] Open Airtable Environment Variables table
- [ ] Verify Variable Name field is primary
- [ ] Check that Status colors are set (Green, Yellow, Red, Orange)
- [ ] Confirm Category and Render Group single-selects work
- [ ] Test filtering by Status = "Active"
- [ ] Test grouping by Render Group

### Documentation Check

- [ ] ENV-VARIABLES-DOCS.md exists
- [ ] Sensitive values are masked (pat8...ffdc format)
- [ ] Variables are organized by category
- [ ] Usage locations are listed
- [ ] Table of contents works (clickable links)

---

## Troubleshooting

### If Tests Fail

**Issue:** `MASTER_CLIENTS_BASE_ID not found`
- **Fix:** Add to .env file: `MASTER_CLIENTS_BASE_ID=appJ9XAZeJeK5x55r`

**Issue:** `Gemini not initialized`
- **Fix:** Verify GCP credentials are configured
- Check: `GCP_PROJECT_ID` and `GCP_LOCATION` in .env

**Issue:** `Environment Variables table not found`
- **Fix:** Create the table in Airtable (see Phase 2)

### If Scan Takes Too Long

- Normal duration: 5-10 minutes for 120 variables
- Processes in batches of 5 with 2-second delays
- If stuck, press Ctrl+C and retry

### If No AI Descriptions

- Check Gemini API quota in GCP console
- Verify service account has Vertex AI permissions
- Try running with DEBUG=1 for detailed logs

---

## Success Criteria

You're done when:

✅ Airtable table created with all fields  
✅ 100+ variables documented with AI descriptions  
✅ Production values filled for critical variables  
✅ Render Groups assigned  
✅ Documentation exported successfully  
✅ Test script passes  
✅ Team has access to ENV-VARIABLES-DOCS.md  

---

## Next Steps After Setup

### Immediate
- [ ] Share ENV-VARIABLES-DOCS.md with team
- [ ] Update project README with link to env var docs
- [ ] Add npm scripts to deployment checklist

### Short-term
- [ ] Train team on using `npm run doc-env-vars scan`
- [ ] Set up monthly review process
- [ ] Create Render Global Groups from Airtable organization

### Long-term
- [ ] Automate production value sync (Render API)
- [ ] Add GitHub Actions to scan on each commit
- [ ] Create Slack alerts for new variables

---

## Questions?

- **Quick help:** `npm run doc-env-vars help`
- **Full guide:** [ENV-VAR-MANAGEMENT-SYSTEM.md](./ENV-VAR-MANAGEMENT-SYSTEM.md)
- **Quick ref:** [ENV-VAR-QUICK-REF.md](./ENV-VAR-QUICK-REF.md)
- **Schema:** [AIRTABLE-ENV-VAR-SCHEMA.md](./AIRTABLE-ENV-VAR-SCHEMA.md)

---

**Estimated total time:** 60-90 minutes for complete setup  
**Ongoing maintenance:** 5-10 minutes per month  
**ROI:** Infinite (never wonder about env vars again!)  

🎉 **Ready? Start with Phase 1!**
