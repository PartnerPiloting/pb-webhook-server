# Smart Resume Run ID System Documentation

## Overview
The new run ID system generates structured, filterable identifiers for better log organization and search capabilities. This document explains how to use and configure the system.

## Run ID Format
The structured format is: `SR-YYMMDD-NNN-SSTREAM-CCLIENT-ISSUE`

Where:
- `SR`: Smart Resume prefix (constant)
- `YYMMDD`: Current date in YY/MM/DD format
- `NNN`: Sequential run number for the day (automatically incremented)
- `SSTREAM`: Stream identifier (e.g., S1, S2) - configurable
- `CCLIENT`: Client identifier (e.g., CABC) - configurable
- `ISSUE`: Issue or operation type (e.g., LEADS, POSTS) - configurable

Example: `SR-250922-001-S2-CABC-POSTS`

## Environment Variables

The run ID generator uses the following environment variables to customize the run ID:

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `DEBUG_STREAM` | Stream identifier to include in the run ID | Stream number from `BATCH_PROCESSING_STREAM` | `2` (becomes `S2`) |
| `DEBUG_CLIENT` | Client identifier to include in the run ID | `ALL` | `ABC` (becomes `CABC`) |
| `DEBUG_ISSUE` | Issue or operation type to include in the run ID | `BATCH` | `POSTS`, `LEADS`, `SCORE` |

## Usage in Scripts

The run ID system is integrated into the Smart Resume batch processing script automatically. At script startup, it:

1. Generates a structured run ID using the format above
2. Creates a logger function that includes the run ID in all log messages
3. Uses the run ID for all log messages throughout execution

## Filtering Logs in Render

You can now filter logs in Render more effectively using parts of the run ID:

- Filter by date: Search for `SR-250922` to see all runs on September 25, 2022
- Filter by stream: Search for `S2` to see all runs for stream 2
- Filter by client: Search for `CABC` to see all runs for client ABC
- Filter by issue: Search for `POSTS` to see all runs related to post processing

## Command Line Usage Examples

### Process Stream 2 with Run ID for Posts Issue
```bash
DEBUG_STREAM=2 DEBUG_ISSUE=POSTS node scripts/smart-resume-client-by-client.js
```

### Process Client ABC's Lead Data
```bash
DEBUG_CLIENT=ABC DEBUG_ISSUE=LEADS node scripts/smart-resume-client-by-client.js
```

### Run with All Default Values
```bash
node scripts/smart-resume-client-by-client.js
```