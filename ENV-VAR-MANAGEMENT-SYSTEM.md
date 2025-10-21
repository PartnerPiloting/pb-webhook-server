# Environment Variables Management System

**Comprehensive documentation and management tool for all environment variables across the PB-Webhook-Server project.**

## 🎯 Overview

This system automatically:
- ✅ **Scans** all `.js` files for `process.env` references
- 🤖 **Generates** AI-powered plain English descriptions
- 📊 **Syncs** to Airtable "Environment Variables" table
- 🔍 **Identifies** obsolete variables that can be removed
- 💡 **Suggests** consolidation opportunities
- 📝 **Exports** comprehensive markdown documentation

## 🚀 Quick Start

### 1. Initial Setup (One Time)

Create the "Environment Variables" table in your **Master Clients** Airtable base with these fields:

| Field Name | Type | Options |
|-----------|------|---------|
| Variable Name | Single line text | PRIMARY FIELD |
| AI Description | Long text | AI-generated description |
| Business Purpose | Long text | Plain English explanation |
| Category | Single select | Data & Storage, API & Integration, Authentication, Performance, Feature Flags, Debugging, Email, AI Services, Deployment, Other |
| Staging Value | Single line text | Current value from staging |
| Production Value | Single line text | Value from production Render |
| Render Group | Single select | Core Services, AI & Scoring, Email & Notifications, Debugging, Feature Flags, Deployment, Development |
| Used In Files | Long text | List of files where variable is used |
| Status | Single select | Active, Not Set, Obsolete, Deprecated |
| Last Synced | Date & time | Auto-populated |

### 2. Run the Scanner

```bash
# Scan codebase and sync to Airtable (recommended first run)
npm run doc-env-vars scan

# Export documentation to markdown
npm run doc-env-vars export

# Find variables that can be removed
npm run doc-env-vars obsolete

# Find consolidation opportunities
npm run doc-env-vars consolidate

# Show help
npm run doc-env-vars help
```

### 3. Review Results

After running `scan`:
1. Check the **Environment Variables** table in Airtable
2. Fill in **Production Value** column with values from Render production
3. Assign **Render Group** for better organization
4. Review **AI Description** and add business context if needed
5. Mark obsolete variables with Status = "Obsolete"

## 📖 Command Reference

### `scan` - Full Codebase Analysis

```bash
npm run doc-env-vars scan
```

**What it does:**
- Scans all `.js` files for `process.env.VARIABLE_NAME` patterns
- Generates AI descriptions using Google Gemini
- Creates/updates records in Airtable
- Identifies obsolete variables

**Duration:** 5-10 minutes (depends on number of variables and API rate limits)

**Output:**
```
✅ Created: 15 new records
🔄 Updated: 42 existing records
⏭️  Unchanged: 35 records
⚠️  Obsolete: 3 variables no longer in code
```

### `export` - Generate Documentation

```bash
# Export to default file
npm run doc-env-vars export

# Export to custom file
npm run doc-env-vars export ./docs/ENV-VARS.md
```

**What it does:**
- Generates comprehensive markdown documentation
- Groups variables by category
- Masks sensitive values (API keys, secrets)
- Includes usage locations and recommendations

**Output:** `ENV-VARIABLES-DOCS.md`

### `obsolete` - Find Removable Variables

```bash
npm run doc-env-vars obsolete
```

**What it does:**
- Finds variables not set in any environment
- Identifies variables only used in backup/deprecated code
- Suggests safe removal candidates

**Example Output:**
```
Found 3 potential removal candidates:

1. ADMIN_EMAIL
   Reason: Not set in any environment
   Usage Count: 1
   Backup Code Only: Yes
   Locations:
      - Backup Prior to using Gemini/batchScorer.js:34
```

### `consolidate` - Find Merging Opportunities

```bash
npm run doc-env-vars consolidate
```

**What it does:**
- Groups variables by similar names
- Identifies variables with duplicate purposes
- Suggests consolidation strategies

**Example Output:**
```
Found 2 potential consolidation opportunities:

1. Variables with prefix "DEBUG"
   Variables (4):
      - DEBUG
      - DEBUG_MODE
      - DEBUG_LEVEL
      - DEBUG_RAW_GEMINI
   💡 Consider consolidating into single DEBUG_CONFIG variable
```

## 🏗️ Architecture

### Component Overview

```
services/
├── envVarAnalyzer.js       # Core scanning & analysis engine
└── envVarDocumenter.js     # Airtable sync & documentation

scripts/
└── document-env-vars.js    # CLI interface
```

### How It Works

1. **Scanner** (`EnvVarAnalyzer`):
   - Recursively walks project directory
   - Finds all `.js` files (excludes node_modules, .git)
   - Uses regex to match `process.env.VARIABLE_NAME` patterns
   - Tracks usage locations (file + line number)

2. **AI Analyzer**:
   - Sends code context to Google Gemini
   - Generates plain English descriptions
   - Categorizes variables (database, API, auth, etc.)
   - Suggests recommended values
   - Rate-limited with exponential backoff

3. **Airtable Sync** (`EnvVarDocumenter`):
   - Creates new records for discovered variables
   - Updates existing records with latest usage info
   - Preserves manually-entered fields (Production Value, Render Group)
   - Identifies obsolete variables

4. **Markdown Exporter**:
   - Groups variables by category
   - Generates table of contents
   - Masks sensitive values
   - Includes usage examples

## 🔒 Security

**Sensitive Value Masking:**
Variables containing these keywords are automatically masked in exports:
- `KEY`
- `SECRET`
- `TOKEN`
- `PASSWORD`
- `CREDENTIALS`
- `PRIVATE`
- `AUTH`

**Example:**
```
AIRTABLE_API_KEY: pat8...ffdc  (first 4 + last 4 chars)
PB_WEBHOOK_SECRET: Diam...!!@@pb
```

## 📊 Airtable Integration

### Field Mapping

| Airtable Field | Source | Auto-Updated |
|---------------|--------|--------------|
| Variable Name | Code scan | Yes |
| AI Description | Gemini AI | Yes |
| Business Purpose | Generated from AI | Yes |
| Category | AI categorization | Yes |
| Staging Value | process.env | Yes |
| Production Value | Manual entry | No |
| Render Group | Manual assignment | No |
| Used In Files | Code scan | Yes |
| Status | Auto (Active/Not Set) | Partial* |
| Last Synced | Current timestamp | Yes |

\* *Status is auto-set to "Active" or "Not Set" but never changes manually-set values like "Obsolete"*

### Workflow

1. **Initial Sync:** Run `npm run doc-env-vars scan`
2. **Manual Review:** Fill in Production Values and Render Groups in Airtable
3. **Ongoing Maintenance:** Re-run scan after adding new env vars
4. **Documentation:** Export markdown whenever values change

## 🎯 Use Cases

### Use Case 1: New Developer Onboarding

```bash
# Generate fresh documentation
npm run doc-env-vars export ./docs/ENV-SETUP.md

# Share ENV-SETUP.md with new team member
# They now have complete, plain-English guide to all variables
```

### Use Case 2: Pre-Production Deployment

```bash
# Find obsolete variables before deploying
npm run doc-env-vars obsolete

# Review output and clean up unused variables
# Reduces environment clutter and deployment complexity
```

### Use Case 3: Render Variable Group Management

1. Run `npm run doc-env-vars scan`
2. Open Airtable Environment Variables table
3. Assign "Render Group" to each variable:
   - Core Services
   - AI & Scoring
   - Email & Notifications
   - etc.
4. Create matching Environment Groups in Render dashboard
5. Link groups to services (staging, production, hotfix)

### Use Case 4: Audit & Compliance

```bash
# Export full documentation
npm run doc-env-vars export

# ENV-VARIABLES-DOCS.md now contains:
# - Complete list of all env vars
# - Current values (masked if sensitive)
# - Usage locations
# - Business purposes
```

## 🔧 Configuration

### Required Environment Variables

The documenter itself requires these variables:

```bash
# Airtable Access
MASTER_CLIENTS_BASE_ID=appJ9XAZeJeK5x55r
AIRTABLE_API_KEY=pat_xxxxxxxxxx

# Google Gemini (for AI descriptions)
GCP_PROJECT_ID=your-project-id
GCP_LOCATION=us-central1
GEMINI_MODEL_ID=gemini-2.5-flash  # or gemini-2.5-pro-preview-05-06
```

### Rate Limiting

**Gemini API:**
- Processes variables in batches of 5
- 2-second delay between batches
- 3 retry attempts with exponential backoff

**Airtable API:**
- Standard Airtable rate limits apply
- No special throttling needed (sync is sequential)

## 📈 Best Practices

### 1. Regular Syncs

Run scans after:
- Adding new environment variables
- Merging feature branches
- Major refactoring
- Before production deployments

```bash
# Add to pre-deploy checklist
npm run doc-env-vars scan
npm run doc-env-vars obsolete
```

### 2. Keep Production Values Updated

The scanner only captures **staging** values. To keep production values current:

1. Open Render production service dashboard
2. Copy variable values from Environment tab
3. Paste into Airtable "Production Value" column
4. Or: Script this with Render API (future enhancement)

### 3. Use Render Groups

Organize variables into logical groups in Airtable:

**Core Services:**
- AIRTABLE_API_KEY
- AIRTABLE_BASE_ID
- MASTER_CLIENTS_BASE_ID

**AI & Scoring:**
- GCP_PROJECT_ID
- GCP_LOCATION
- GEMINI_MODEL_ID
- OPENAI_API_KEY
- BATCH_CHUNK_SIZE

**Email & Notifications:**
- MAILGUN_API_KEY
- MAILGUN_DOMAIN
- FROM_EMAIL
- ALERT_EMAIL

### 4. Document Business Purpose

While AI generates technical descriptions, add business context manually:

**AI Description:**
> "Configures the Google Cloud location for Vertex AI API calls"

**Business Purpose:**
> "Controls which Google datacenter processes our AI scoring. US Central ensures low latency for North American clients and compliance with data residency requirements."

### 5. Clean Up Regularly

Every quarter:
1. Run `npm run doc-env-vars obsolete`
2. Review obsolete variables
3. Remove from codebase if confirmed unused
4. Delete from Render environment groups
5. Mark as "Obsolete" in Airtable (for historical record)

## 🐛 Troubleshooting

### "Gemini Model failed to initialize"

**Solution:** Check GCP credentials:
```bash
# Verify env vars are set
echo $GCP_PROJECT_ID
echo $GCP_LOCATION

# Check credentials file (if using file-based auth)
cat /etc/secrets/gcp_service_account_key.json
```

### "MASTER_CLIENTS_BASE_ID not found"

**Solution:** Ensure Master Clients base ID is set:
```bash
# Add to .env file
MASTER_CLIENTS_BASE_ID=appJ9XAZeJeK5x55r
```

### "Environment Variables table not found"

**Solution:** Create the table in Airtable using the schema from Quick Start section.

### Scan runs but no AI descriptions

**Possible causes:**
1. Gemini API quota exceeded (check GCP console)
2. Invalid GCP credentials
3. Rate limiting (retry after delay)

**Solution:**
```bash
# Run with debug logging
DEBUG=1 npm run doc-env-vars scan
```

### Some variables not detected

**Possible causes:**
1. Dynamic variable names: `process.env[varName]`
2. Variables in non-JS files (.env, .sh, etc.)
3. Variables set by Render (not in code)

**Solution:**
- Add dynamic variables manually to Airtable
- Document platform-set variables separately
- Review Render dashboard for complete list

## 📚 Related Documentation

- [ENVIRONMENT-MANAGEMENT.md](./ENVIRONMENT-MANAGEMENT.md) - Original env var guide
- [BACKEND-DEEP-DIVE.md](./BACKEND-DEEP-DIVE.md) - Architecture overview
- [DEV-RUNBOOK.md](./DEV-RUNBOOK.md) - Development workflows

## 🤝 Contributing

When adding new environment variables:

1. Add variable to code
2. Run `npm run doc-env-vars scan`
3. Review AI description in Airtable
4. Add business context if needed
5. Assign to appropriate Render Group
6. Update exported documentation
7. Commit both code changes and ENV-VARIABLES-DOCS.md

## 📊 Example Output

### Scan Output

```
🔍 Starting comprehensive environment variable scan...

Found 122 environment variables in code
Found 98 existing records in Airtable

🤖 Generating AI descriptions (this may take several minutes)...

Processing batch 1/25...
Processing batch 2/25...
...

✅ Updated: BATCH_CHUNK_SIZE
✅ Updated: GEMINI_MODEL_ID
➕ Created: NEW_FEATURE_FLAG
✅ Updated: AIRTABLE_API_KEY

📊 Sync Summary:
   Created: 3
   Updated: 89
   Unchanged: 6
   Obsolete: 2

⚠️  Found 2 obsolete variables in Airtable:
   - ADMIN_EMAIL (last used in: Backup Prior to using Gemini/batchScorer.js:34)
   - GPT_MODEL (last used in: Backup Prior to using Gemini/batchScorer.js:30)
```

### Export Output

```markdown
# Environment Variables Documentation

**Last Updated:** 2025-10-16T10:30:45.000Z
**Total Variables:** 122

## Table of Contents

- [Database](#database)
- [API & Integration](#api--integration)
- [Authentication](#authentication)
...

## Database

### AIRTABLE_API_KEY

**Description:** Personal access token for authenticating with the Airtable API

**Current Value (Staging):** `pat8...ffdc`

**What it does:** Allows the application to read and write data to Airtable bases. Without this, all database operations will fail.

**Recommended:** Create a dedicated service account token with minimal required permissions

**Used in 75 location(s):**
- `config/airtableClient.js:33`
- `services/airtableService.js:77`
- `airtableFieldExtractor.js:20`
...
```

## 🎉 Benefits

✅ **No more mystery variables** - Every env var has a plain English explanation  
✅ **Onboarding speedup** - New developers understand config in minutes  
✅ **Deployment confidence** - Know exactly what each variable does  
✅ **Clean environment** - Easy to spot and remove obsolete variables  
✅ **Render Groups ready** - Organized variables ready for Render's new feature  
✅ **Documentation automation** - Generated docs always stay up-to-date  
✅ **Audit compliance** - Complete record of all environment configuration  

---

**Questions?** Check the [troubleshooting section](#-troubleshooting) or review the source code in `services/envVarDocumenter.js`
