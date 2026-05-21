# Airtable Environment Variables Table Setup Guide

## Table Details

**Table Name:** `Environment Variables`  
**Base:** Master Clients (`appJ9XAZeJeK5x55r`)  
**Purpose:** Centralized documentation and management of all environment variables

---

## Field Configurations

### 1. Variable Name
- **Field Type:** Single line text
- **Description:** The exact environment variable name (e.g., AIRTABLE_API_KEY)
- **Primary Field:** ✅ Yes
- **Required:** Yes
- **Example:** `AIRTABLE_API_KEY`

### 2. AI Description
- **Field Type:** Long text
- **Description:** Auto-generated plain English explanation from Google Gemini
- **Enable Rich Text:** No
- **Auto-populated by:** `npm run doc-env-vars scan`
- **Example:** "Personal access token for authenticating with the Airtable API. This allows the application to read and write data to Airtable bases."

### 3. Business Purpose
- **Field Type:** Long text
- **Description:** Plain English business context (can customize after AI generation)
- **Enable Rich Text:** No
- **Auto-populated by:** System (initially), then manual edits
- **Example:** "API & Integration - Allows the application to read and write data to Airtable bases. Without this, all database operations will fail."

### 4. Category
- **Field Type:** Single select
- **Description:** Functional category for grouping variables
- **Options:**
  - `Data & Storage`
  - `API & Integration`
  - `Authentication`
  - `Performance`
  - `Feature Flags`
  - `Debugging`
  - `Email`
  - `AI Services`
  - `Deployment`
  - `Other`
- **Auto-populated by:** AI categorization
- **Color coding:** Optional (assign colors in Airtable)

### 5. Staging Value
- **Field Type:** Single line text
- **Description:** Current value from staging environment
- **Auto-populated by:** `npm run doc-env-vars scan` (reads from process.env)
- **Example:** `pat89slmRS6muX8YZ.fc47...`
- **Note:** Sensitive values are fine here - control access via Airtable permissions

### 6. Production Value
- **Field Type:** Single line text
- **Description:** Value from production Render service
- **Auto-populated by:** ❌ Manual entry only
- **Example:** `pat123456789abcdef...`
- **Workflow:** Copy from Render production dashboard

### 7. Render Group
- **Field Type:** Single select
- **Description:** Which Render Global Environment Group this variable belongs to
- **Options:**
  - `Core Services`
  - `AI & Scoring`
  - `Email & Notifications`
  - `Debugging`
  - `Feature Flags`
  - `Deployment`
  - `Development`
  - `Not Assigned`
- **Auto-populated by:** ❌ Manual assignment
- **Purpose:** Organize variables for Render's Global Environment Groups feature
- **Color coding:** Recommended for visual organization

### 8. Used In Files
- **Field Type:** Long text
- **Description:** Comma-separated list of file paths where this variable is used
- **Auto-populated by:** `npm run doc-env-vars scan`
- **Example:** `config/airtableClient.js:33, services/airtableService.js:77, airtableFieldExtractor.js:20`
- **Note:** Truncated to first 10 locations if more exist

### 9. Status
- **Field Type:** Single select
- **Description:** Current status of the variable
- **Options:**
  - `Active` (in use and set)
  - `Not Set` (found in code but no value)
  - `Obsolete` (no longer used in code)
  - `Deprecated` (being phased out)
- **Auto-populated by:** System sets to Active/Not Set, manual override for Obsolete/Deprecated
- **Color coding:**
  - Active: Green
  - Not Set: Yellow
  - Obsolete: Red
  - Deprecated: Orange

### 10. Last Synced
- **Field Type:** Date & time
- **Description:** When this record was last updated by the scanner
- **Include time:** ✅ Yes
- **Time zone:** Use GMT
- **Auto-populated by:** `npm run doc-env-vars scan`
- **Example:** `2025-10-16 10:30:45`
- **Note:** Updates every scan, helps track freshness

---

## Quick Setup Steps

### Option 1: Create Manually in Airtable

1. Go to Master Clients base
2. Click "Add table" → Name it "Environment Variables"
3. Add each field above following the specifications
4. Set "Variable Name" as primary field
5. Configure single-select options for Category, Render Group, Status

### Option 2: Copy from Template (if available)

1. If you have an existing Environment Variables table in another base
2. Duplicate it to Master Clients base
3. Verify field types match specifications above

### Option 3: Import from CSV (after first scan)

1. Run `npm run doc-env-vars scan` (creates data in code)
2. Export results to CSV
3. Import CSV to create table with data

---

## View Configurations

### Recommended Views

#### 1. All Variables (Default)
- **Type:** Grid view
- **Grouping:** None
- **Sorting:** Variable Name (A → Z)
- **Filters:** None
- **Purpose:** See everything

#### 2. By Render Group
- **Type:** Grid view
- **Grouping:** Render Group
- **Sorting:** Variable Name (A → Z) within groups
- **Filters:** Status is "Active" or "Not Set"
- **Purpose:** Organize for Render Global Groups setup

#### 3. By Category
- **Type:** Grid view
- **Grouping:** Category
- **Sorting:** Variable Name (A → Z) within groups
- **Filters:** Status is "Active"
- **Purpose:** Understand variable distribution

#### 4. Needs Attention
- **Type:** Grid view
- **Filters:**
  - Status is "Not Set" OR
  - Production Value is empty OR
  - Render Group is "Not Assigned"
- **Sorting:** Last Synced (newest first)
- **Purpose:** Find variables that need configuration

#### 5. Obsolete & Deprecated
- **Type:** Grid view
- **Filters:** Status is "Obsolete" or "Deprecated"
- **Sorting:** Last Synced (oldest first)
- **Purpose:** Cleanup candidates

---

## Field Usage Matrix

| Field | Auto-Populated | Manual Entry | Updated on Scan |
|-------|----------------|--------------|-----------------|
| Variable Name | ✅ | ❌ | Only creates new |
| AI Description | ✅ | ✅ (can edit) | Yes, if changed |
| Business Purpose | ✅ (initial) | ✅ (customize) | No (preserved) |
| Category | ✅ | ✅ (can override) | Yes, if changed |
| Staging Value | ✅ | ❌ | Yes, always |
| Production Value | ❌ | ✅ | No (never) |
| Render Group | ❌ | ✅ | No (never) |
| Used In Files | ✅ | ❌ | Yes, always |
| Status | ✅ (Active/Not Set) | ✅ (Obsolete/Deprecated) | Respects manual |
| Last Synced | ✅ | ❌ | Yes, always |

---

## Workflow Integration

### Initial Setup Flow

1. **Create table** with all fields above
2. **Run scan**: `npm run doc-env-vars scan`
3. **Review in Airtable**: Check AI descriptions
4. **Fill Production Values**: Copy from Render production
5. **Assign Render Groups**: Organize for Global Groups
6. **Customize descriptions**: Add business context where needed

### Ongoing Maintenance Flow

1. **Add new variable to code**
2. **Run scan**: `npm run doc-env-vars scan`
3. **Check Airtable**: New variable appears
4. **Fill details**: Production Value + Render Group
5. **Export docs**: `npm run doc-env-vars export`

---

## Permissions & Sharing

### Recommended Airtable Permissions

- **Admins (You)**: Owner access - full control
- **Developers**: Editor access - can update descriptions and values
- **DevOps/Deploy**: Editor access - manage Production Values
- **Managers/Non-technical**: Read-only - view documentation

### Security Notes

- **Sensitive values**: This table contains API keys and secrets
- **Access control**: Use Airtable's sharing settings carefully
- **Backup**: Airtable auto-saves, but export monthly backups
- **Audit trail**: Last Synced field tracks changes

---

## Automation Ideas (Future Enhancements)

### Possible Airtable Automations

1. **Slack notification** when new variables detected
2. **Email alert** when Production Value is empty for Active variables
3. **Auto-tag** variables needing review (empty Production Value)
4. **Weekly summary** of variable changes

### Script Enhancements

1. **Render API integration** to auto-fetch Production Values
2. **GitHub Actions** to auto-scan on each commit
3. **Deployment checklist** generation from Active variables
4. **Variable comparison** between environments

---

## Troubleshooting

### "Field type mismatch" error
- Ensure field types exactly match specifications above
- Single select options must be created before scanning

### "Cannot create record" error
- Check if Variable Name field is set as primary
- Verify table name is exactly "Environment Variables"

### "Values not updating" error
- Check Last Synced timestamp
- Verify scanner has write access to Airtable
- Look for error messages in scan output

---

## Example Data

Here's what a few example records look like:

| Variable Name | AI Description | Category | Staging Value | Production Value | Render Group | Status |
|--------------|----------------|----------|---------------|------------------|--------------|--------|
| AIRTABLE_API_KEY | Personal access token for Airtable API | Data & Storage | pat8...ffdc | pat9...xyz123 | Core Services | Active |
| GEMINI_MODEL_ID | Google Gemini AI model identifier | AI Services | gemini-2.5-flash | gemini-2.5-pro | AI & Scoring | Active |
| DEBUG_MODE | Enable verbose debug logging | Debugging | *(not set)* | false | Debugging | Not Set |
| ADMIN_EMAIL | Admin email for notifications | Email | *(not set)* | *(not set)* | Email & Notifications | Obsolete |

---

## Summary

This Airtable table becomes your **single source of truth** for all environment variables:

✅ Complete inventory  
✅ AI-generated descriptions  
✅ Business context  
✅ Current values (both environments)  
✅ Render Group organization  
✅ Usage tracking  
✅ Status management  

**Setup time:** 10-15 minutes  
**Maintenance:** 5 minutes per month  
**Value:** Infinite (never wonder what a variable does again!)  

---

**Ready to start?** Create the table now, then run:
```bash
npm run doc-env-vars scan
```
