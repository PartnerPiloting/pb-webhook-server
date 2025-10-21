# Logging Configuration Guide

## Process-Specific Logging Controls

The system now supports granular logging controls for each major process. Set these environment variables to enable detailed logs for specific processes while keeping other logs at a minimal level.

```
# Set to 'debug', 'info', 'warn', or 'error'
DEBUG_LEAD_SCORING=debug      # Detailed logs for lead scoring process
DEBUG_POST_HARVESTING=info    # Standard logs for post harvesting
DEBUG_POST_SCORING=info       # Standard logs for post scoring
```

### How Process-Specific Logging Works

The `utils/structuredLogger.js` implementation checks these environment variables when deciding whether to display logs:

```javascript
function shouldLog(level, process) {
    // Log levels in order of verbosity
    const levels = ['debug', 'info', 'warn', 'error'];
    
    // Get the process-specific log level, or fall back to general level
    let envLevel;
    if (process === 'lead_scoring') {
        envLevel = (process.env.DEBUG_LEAD_SCORING || process.env.DEBUG_LEVEL || 'info').toLowerCase();
    } else if (process === 'post_harvesting') {
        envLevel = (process.env.DEBUG_POST_HARVESTING || process.env.DEBUG_LEVEL || 'info').toLowerCase();
    } else if (process === 'post_scoring') {
        envLevel = (process.env.DEBUG_POST_SCORING || process.env.DEBUG_LEVEL || 'info').toLowerCase();
    } else {
        envLevel = (process.env.DEBUG_LEVEL || 'info').toLowerCase();
    }
    
    // Show the message if its level is equally or more important than the configured level
    return levels.indexOf(level.toLowerCase()) >= levels.indexOf(envLevel);
}
```

## Testing Mode

When testing batch processes, you can bypass certain restrictions:

```
# Set to 'true' to enable testing mode
FIRE_AND_FORGET_BATCH_PROCESS_TESTING=true
```

Testing mode effects:
- Bypasses client service level requirements
- Bypasses 24-hour scoring restrictions (allows rescoring of leads from past 2 days)
- Limits batch sizes for safety
- Shows visual indicator in email reports (red "TESTING MODE" text)

## General Debug Controls

```
# General debug level ('debug', 'info', 'warn', 'error')
DEBUG_LEVEL=info

# Enable more detailed logging in specific areas
DEBUG_AI_CALLS=true          # Log AI prompt details and responses
DEBUG_AIRTABLE_OPERATIONS=true  # Log Airtable API calls
```

## Configuring Logging for Development

For development environments, we recommend:
```
DEBUG_LEVEL=info
DEBUG_LEAD_SCORING=debug
DEBUG_POST_HARVESTING=debug
DEBUG_POST_SCORING=debug
FIRE_AND_FORGET_BATCH_PROCESS_TESTING=true
```

For production environments:
```
DEBUG_LEVEL=warn
DEBUG_LEAD_SCORING=info
DEBUG_POST_HARVESTING=info
DEBUG_POST_SCORING=info
FIRE_AND_FORGET_BATCH_PROCESS_TESTING=false
```