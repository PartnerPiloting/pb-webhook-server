# Environment Variable Analysis System

AI-powered utility to document and manage environment variables across your codebase.

## Features

- 🔍 **Automatic Discovery**: Scans codebase to find all `process.env` references
- 🤖 **AI Descriptions**: Uses Gemini to generate practical explanations of what each variable does
- 📊 **Branch Comparison**: Compare env vars between branches to find differences
- 🔐 **Current Values**: See what's actually set in runtime (with masking for secrets)
- 📦 **Multi-format**: API endpoints + CLI tool + chat integration

## API Endpoints

All endpoints available at: `https://pb-webhook-server-staging.onrender.com/api/env-vars/`

### List All Variables

```bash
GET /api/env-vars/list?branch=staging
```

Returns all environment variables found in code.

**Response:**
```json
{
  "success": true,
  "branch": "staging",
  "count": 25,
  "variables": [
    {
      "name": "AIRTABLE_API_KEY",
      "currentValue": "pat_xxxxx",
      "isSet": true
    }
  ]
}
```

### Analyze Variables with AI

```bash
GET /api/env-vars/analyze?branch=staging
GET /api/env-vars/analyze?var=BATCH_CHUNK_SIZE
```

Generate AI descriptions for one or all variables.

**Response:**
```json
{
  "success": true,
  "variable": {
    "name": "BATCH_CHUNK_SIZE",
    "currentValue": "10",
    "description": "Controls how many leads are sent to AI in one request",
    "effect": "Higher values = faster but more memory. Lower = slower but safer.",
    "recommended": "10 for production, 5 for testing",
    "category": "performance",
    "usage": [
      "batchScorer.js:245",
      "config/geminiClient.js:89"
    ]
  }
}
```

### Compare Branches

```bash
GET /api/env-vars/compare?from=staging&to=main
```

Find differences between branches.

**Response:**
```json
{
  "success": true,
  "comparison": {
    "branch1": "staging",
    "branch2": "main",
    "same": ["AIRTABLE_API_KEY", "GEMINI_MODEL_ID"],
    "onlyInBranch1": ["DEBUG_MODE"],
    "onlyInBranch2": ["LEGACY_SUPPORT"],
    "summary": {
      "total": 25,
      "same": 23,
      "different": 2
    }
  }
}
```

### Current Runtime Values

```bash
GET /api/env-vars/current
```

See what's actually set on the running server (secrets masked).

## CLI Usage

Run from project root:

```bash
# List all variables
node scripts/analyze-env-vars.js list

# List variables from specific branch
node scripts/analyze-env-vars.js list staging

# Analyze specific variable
node scripts/analyze-env-vars.js analyze BATCH_CHUNK_SIZE

# Compare branches
node scripts/analyze-env-vars.js compare staging main

# Analyze all variables (generates full report)
node scripts/analyze-env-vars.js all
```

## Chat Integration

You can ask GitHub Copilot to run these commands for you:

```
You: "Show me env var differences between staging and main"

Copilot: [Calls API, shows formatted results]
📊 Environment Variables Comparison

⚠️ DIFFERENT (2 vars):
- DEBUG_MODE: only in staging
- LEGACY_SUPPORT: only in main

✅ SAME (23 vars): AIRTABLE_API_KEY, GEMINI_MODEL_ID, ...
```

```
You: "What does BATCH_CHUNK_SIZE do?"

Copilot: [Calls analyze endpoint]
BATCH_CHUNK_SIZE = 10

Controls how many leads are sent to AI in one request.

Effect: Higher values = faster processing but more memory usage.
If too high, may cause timeouts or memory crashes.

Recommended: 10 for production, 5 for testing

Used in:
- batchScorer.js:245 (chunks lead array)
- config/geminiClient.js:89 (sets request size)
```

## How It Works

1. **Code Scanning**: Searches all `.js` files for `process.env.VARIABLE_NAME` patterns
2. **Context Extraction**: Gets code around each usage to understand purpose
3. **AI Analysis**: Sends context to Gemini with prompt asking for practical explanation
4. **Caching**: Results cached for 24 hours to avoid repeated AI calls
5. **Branch Support**: Can checkout different branches to compare codebases

## Categories

Variables are automatically categorized:

- `database` - Database connection strings, credentials
- `api` - External API keys, endpoints
- `auth` - Authentication secrets, tokens
- `performance` - Timeouts, batch sizes, limits
- `feature-flag` - Feature toggles, experimental flags
- `debug` - Debug modes, verbose logging
- `other` - Everything else

## Security

- Secrets are masked in `/current` endpoint (anything with SECRET, KEY, PASSWORD in name)
- API calls require same auth as other debug endpoints
- No values are stored, only analyzed
- Cache is in-memory only, cleared on restart

## Architecture

**Files:**
- `services/envVarAnalyzer.js` - Core analysis engine
- `routes/envVarRoutes.js` - API endpoints
- `scripts/analyze-env-vars.js` - CLI tool

**Dependencies:**
- Gemini AI (via existing `config/geminiClient.js`)
- Git (for branch switching)
- File system access (to scan code)

## Use Cases

**Before merging branches:**
```bash
node scripts/analyze-env-vars.js compare feature/new-thing main
```

**Setting up new environment:**
```bash
# See what vars are needed
GET /api/env-vars/list?branch=main

# Get descriptions for setup
GET /api/env-vars/analyze?branch=main
```

**Troubleshooting "works in staging but not production":**
```bash
# Compare what's different
GET /api/env-vars/compare?from=staging&to=main

# Check current values
GET /api/env-vars/current  # on staging
GET /api/env-vars/current  # on production
```

**Documentation:**
```bash
# Generate full documentation
node scripts/analyze-env-vars.js all > ENV_VARS_DOCUMENTATION.txt
```

## Render Environment Groups

This system is **independent** of Render env groups:

- **This utility**: Discovers what vars exist, explains what they do
- **Render env groups**: Stores actual values, deploys them to servers

**Workflow:**
1. Use utility to discover: "What vars does staging need?"
2. See AI descriptions: "What does each one do?"
3. Compare branches: "What's different between staging and main?"
4. Then manually configure Render env groups with correct values

## Future Enhancements

- [ ] Suggest default values based on code analysis
- [ ] Detect unused env vars
- [ ] Validate env var formats (URLs, numbers, etc.)
- [ ] Generate `.env.example` automatically
- [ ] Integration with Render API to sync actual values
- [ ] Diff detection: "This var changed meaning between branches"
