# Environment Variables Reference Guide

This document provides a comprehensive reference for all environment variables used in the PB Webhook Server.

## Core Environment Variables

| Variable | Purpose | Possible Values | Default |
|----------|---------|-----------------|---------|
| `AIRTABLE_API_KEY` | Authentication for Airtable API | `pat_xxx` | N/A (Required) |
| `AIRTABLE_BASE_ID` | Base ID for primary data | `appXXX` | N/A (Required) |
| `MASTER_CLIENTS_BASE_ID` | Base ID for client registry | `appXXX` | N/A (Required) |
| `PB_WEBHOOK_SECRET` | Authentication for webhooks | Any secure string | N/A (Required) |

## AI Configuration

| Variable | Purpose | Possible Values | Default |
|----------|---------|-----------------|---------|
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to GCP service account | `/path/to/file.json` | N/A (Required) |
| `GCP_PROJECT_ID` | Google Cloud project ID | Project ID string | N/A (Required) |
| `GCP_LOCATION` | Google Cloud region | `us-central1` | N/A (Required) |
| `GEMINI_MODEL_ID` | Model ID for Gemini API | `gemini-2.5-pro-preview-05-06` | N/A (Required) |
| `OPENAI_API_KEY` | OpenAI API key for fallback | `sk-xxx` | N/A (Optional) |
| `GEMINI_TIMEOUT_MS` | Timeout for Gemini API calls | Number (milliseconds) | `900000` (15 minutes) |

## Testing Mode

| Variable | Purpose | Possible Values | Default |
|----------|---------|-----------------|---------|
| `FIRE_AND_FORGET_BATCH_PROCESS_TESTING` | Enable testing mode for batch processing | `true`, `false` | `false` |

When set to `true`, testing mode:
- Shows a red "TESTING MODE" indicator in email reports
- Re-scores leads that were scored in the past 2 days
- Bypasses service level requirements
- Limits batch sizes for safety

## Logging Controls

### General Logging

| Variable | Purpose | Possible Values | Default |
|----------|---------|-----------------|---------|
| `DEBUG_LEVEL` | Default log level for all processes | `debug`, `info`, `warn`, `error` | `info` |

### Process-Specific Logging

These variables override the `DEBUG_LEVEL` for specific processes:

| Variable | Purpose | Possible Values | Default |
|----------|---------|-----------------|---------|
| `DEBUG_LEAD_SCORING` | Control log verbosity for lead scoring | `debug`, `info`, `warn`, `error` | Inherits `DEBUG_LEVEL` |
| `DEBUG_POST_HARVESTING` | Control log verbosity for post harvesting | `debug`, `info`, `warn`, `error` | Inherits `DEBUG_LEVEL` |
| `DEBUG_POST_SCORING` | Control log verbosity for post scoring | `debug`, `info`, `warn`, `error` | Inherits `DEBUG_LEVEL` |

### Log Levels Explanation

- `debug`: Most verbose, includes all details about operations
- `info`: Standard operational information
- `warn`: Only warnings and more severe issues
- `error`: Only error messages

## Batch Processing Configuration

| Variable | Purpose | Possible Values | Default |
|----------|---------|-----------------|---------|
| `BATCH_CHUNK_SIZE` | Number of items to process in a batch | Number | `40` |
| `LEAD_SCORING_LIMIT` | Maximum leads to score in one run | Number | `1000` |

## Development Settings

| Variable | Purpose | Possible Values | Default |
|----------|---------|-----------------|---------|
| `PORT` | Port for the API server | Number | `3001` |
| `NODE_ENV` | Environment type | `development`, `production`, `test` | `development` |
| `DEBUG_API_KEY` | Key for accessing debug endpoints | Any secure string | N/A |

## Common Environment Configurations

### Local Development

```
DEBUG_LEVEL=debug
PORT=3001
```

### Debugging Lead Scoring Issues

```
DEBUG_LEAD_SCORING=debug
DEBUG_POST_HARVESTING=warn
DEBUG_POST_SCORING=warn
FIRE_AND_FORGET_BATCH_PROCESS_TESTING=true
```

### Production Settings

```
DEBUG_LEVEL=info
FIRE_AND_FORGET_BATCH_PROCESS_TESTING=false
NODE_ENV=production
```