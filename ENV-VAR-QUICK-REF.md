# Environment Variables Quick Reference

**TL;DR:** Automated system to document all your environment variables with AI-generated plain English descriptions.

## 🚀 Quick Commands

```bash
# Full scan and sync to Airtable (5-10 min)
npm run doc-env-vars scan

# Export docs to markdown file
npm run doc-env-vars export

# Find variables to remove
npm run doc-env-vars obsolete

# Find variables to combine
npm run doc-env-vars consolidate

# Test the system
node scripts/test-env-var-documenter.js
```

## 📋 First-Time Setup Checklist

- [ ] Create "Environment Variables" table in Airtable Master Clients base
- [ ] Add fields: Variable Name, AI Description, Business Purpose, Category, Staging Value, Production Value, Render Group, Used In Files, Status, Last Synced
- [ ] Set up field types per ENV-VAR-MANAGEMENT-SYSTEM.md
- [ ] Run: `node scripts/test-env-var-documenter.js` (verify system works)
- [ ] Run: `npm run doc-env-vars scan` (first full scan)
- [ ] Fill in Production Values from Render dashboard
- [ ] Assign Render Groups in Airtable
- [ ] Run: `npm run doc-env-vars export`
- [ ] Share ENV-VARIABLES-DOCS.md with team

## 🎯 What It Does

1. **Scans** all `.js` files for `process.env.VARIABLE_NAME`
2. **Generates** AI descriptions using Google Gemini
3. **Syncs** to Airtable Environment Variables table
4. **Identifies** obsolete variables (in Airtable but not in code)
5. **Suggests** consolidation opportunities (similar variables)
6. **Exports** markdown documentation with masked secrets

## 📊 Airtable Schema

| Field | Type | Purpose |
|-------|------|---------|
| Variable Name | Text | The actual env var name (e.g., AIRTABLE_API_KEY) |
| AI Description | Long Text | Auto-generated plain English explanation |
| Business Purpose | Long Text | Your custom business context |
| Category | Select | Data & Storage, API & Integration, etc. |
| Staging Value | Text | Current value from staging environment |
| Production Value | Text | Value from production (fill manually) |
| Render Group | Select | Which Render group this belongs to |
| Used In Files | Long Text | Comma-separated list of files |
| Status | Select | Active, Not Set, Obsolete, Deprecated |
| Last Synced | DateTime | When was this last updated |

## 💡 Common Workflows

### New Variable Added to Code

```bash
# After adding process.env.NEW_VAR to code
npm run doc-env-vars scan
# Check Airtable - NEW_VAR is now documented
```

### Pre-Deployment Cleanup

```bash
npm run doc-env-vars obsolete
# Review list
# Remove obsolete vars from code
# Delete from Render environment
```

### Team Documentation

```bash
npm run doc-env-vars export
# Share ENV-VARIABLES-DOCS.md with team
# New developers now have complete reference
```

### Render Groups Organization

```bash
npm run doc-env-vars scan
# Open Airtable
# Assign Render Group to each variable
# Create matching groups in Render dashboard
# Link groups to services
```

## 🔒 Security

**Auto-masked in exports:**
- Variables with: KEY, SECRET, TOKEN, PASSWORD, CREDENTIALS, PRIVATE, AUTH
- Format: `pat8...ffdc` (first 4 + last 4 characters)

**Safe to share:**
- Exported markdown docs (sensitive values masked)
- Airtable table (control access via Airtable permissions)

## ⚠️ Important Notes

1. **Staging values only:** Scanner only captures current environment values (staging). Fill Production Values manually from Render.

2. **Manual fields preserved:** Scanner never overwrites:
   - Production Value
   - Render Group
   - Business Purpose (after you customize it)
   - Status (if manually set to Obsolete/Deprecated)

3. **Rate limits:** Processes 5 variables per batch with 2-second delays. Large scans (100+ vars) take 5-10 minutes.

4. **Dynamic variables:** Scanner can't detect: `process.env[variableName]`. Add these manually.

5. **Render-set variables:** Platform variables (RENDER_GIT_COMMIT, NODE_ENV, etc.) won't have staging values - fill manually.

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| "Gemini not initialized" | Check GCP_PROJECT_ID and GCP_LOCATION env vars |
| "Table not found" | Create Environment Variables table in Airtable |
| "No AI descriptions" | Check Gemini API quota in GCP console |
| "Some vars missing" | Check for dynamic env var access in code |

## 📈 Benefits

✅ **Never guess** what an env var does  
✅ **Onboard faster** - complete reference in one place  
✅ **Deploy confidently** - know what each value controls  
✅ **Clean up easily** - spot obsolete vars instantly  
✅ **Organize better** - ready for Render Global Groups  
✅ **Document automatically** - always up-to-date  

## 📚 Full Documentation

See [ENV-VAR-MANAGEMENT-SYSTEM.md](./ENV-VAR-MANAGEMENT-SYSTEM.md) for:
- Detailed architecture
- Complete field mappings
- Advanced use cases
- Troubleshooting guide
- Best practices

## 🎯 Your Render Global Groups Workflow

1. Run `npm run doc-env-vars scan`
2. Open Airtable Environment Variables table
3. Assign "Render Group" to each variable:
   - **Core Services:** AIRTABLE_API_KEY, MASTER_CLIENTS_BASE_ID, etc.
   - **AI & Scoring:** GCP_PROJECT_ID, GEMINI_MODEL_ID, OPENAI_API_KEY, etc.
   - **Email & Notifications:** MAILGUN_API_KEY, MAILGUN_DOMAIN, etc.
   - **Debugging:** DEBUG_*, VERBOSE_*, etc.
   - **Feature Flags:** ENABLE_*, FIRE_AND_FORGET, etc.
   - **Deployment:** PORT, NODE_ENV, RENDER_*, etc.
4. Create Global Environment Groups in Render dashboard (same names)
5. Copy variables from Airtable to matching Render groups
6. Link groups to staging service
7. Do same for production and hotfix services
8. Now all services share same variable groups ✅

---

**Created:** October 2025  
**Last Updated:** Auto-updates with each scan  
**Maintained by:** AI-powered automation ✨
