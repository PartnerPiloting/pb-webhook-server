# Post Harvesting Cost Optimization Guide

## Overview

This document explains how to optimize Apify credit usage in the LinkedIn post harvesting process. It addresses situations where too many posts are being harvested, leading to excessive credit consumption.

## Current Settings Analysis

The system uses a multi-layered approach to control post harvesting volume:

1. **Client-level settings in Airtable**:
   - `Posts Daily Target`: Maximum total posts to collect per day (default: varies by client)
   - `Leads Batch Size for Post Collection`: Number of profiles to process in each batch (default: 20)
   - `Max Post Batches Per Day Guardrail`: Maximum batches to process per day (default: 10)

2. **Environment variables**:
   - `APIFY_MAX_POSTS`: Maximum posts to collect per LinkedIn profile (default: 2)
   - `APIFY_POSTED_LIMIT`: Time window for post collection (default: 'year')
   - `IGNORE_POST_HARVESTING_LIMITS`: Whether to ignore daily post target limits (default: false)

## Recommended Solution

To reduce Apify credit usage while preserving the ability to collect relevant posts, we recommend the following approach:

### 1. Primary Solution: Configure `APIFY_MAX_POSTS`

Set this environment variable to control how many of the most recent posts are collected per LinkedIn profile.

```
APIFY_MAX_POSTS=1
```

This configuration will dramatically reduce credit usage by limiting collection to only the single most recent post from each profile. This is the most efficient solution as it prevents collecting (and paying for) posts that won't be used.

### 2. Secondary Solutions

If further optimization is needed:

- **Update client settings** in the Clients base:
  - Reduce `Posts Daily Target`
  - Lower `Max Post Batches Per Day Guardrail`
  - Decrease `Leads Batch Size for Post Collection`

- **Set `IGNORE_POST_HARVESTING_LIMITS=false`** (default) to ensure the system respects the daily post target

## Implementation Notes

1. **Set the environment variable** in your hosting environment (e.g., Render):
   ```
   APIFY_MAX_POSTS=1  # or 2, depending on needs
   ```

2. **Restart the application** for the change to take effect

3. **Monitor results** by checking:
   - Apify dashboard for reduced post counts per run
   - Airtable "Posts Harvested Last Run" metric
   - Client Run Results table for reduced API costs

## Technical Details

The `APIFY_MAX_POSTS` variable is implemented in multiple locations:

- `routes/apifyControlRoutes.js`: Controls the actor input configuration
- `routes/apifyProcessRoutes.js`: Used in batch processing configurations

The default value is 2 posts per profile if not specified.