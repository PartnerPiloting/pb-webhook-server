# Run ID Simplification - Clean Slate Approach

## Summary of Changes

We've completely simplified the run ID system to use a clean, consistent timestamp-based format:

```
YYMMDD-HHMMSS-ClientID
```

Example: `250924-152230-Dean-Hobin`

This format is:
- **Simple**: Easy to understand and implement
- **Unique**: Guaranteed unique per client per timestamp
- **Readable**: Shows when the run happened and for which client
- **Consistent**: One standard format across all systems

## Key Changes

1. **Clean Slate Run ID Generation**:
   - Completely abandoned the complex format with task IDs, step IDs, etc.
   - Now using just timestamp + client ID
   - Always generate a new ID for each operation

2. **Client-First Lookup**:
   - Always check for a "Running" record by client ID first
   - Create a new record only if no Running record exists

3. **No Backward Compatibility**:
   - We're not trying to handle old formats anymore
   - Each operation gets a fresh timestamp-based ID
   - All records will be standardized going forward

## Benefits

1. **Prevents Duplicate Records**: By prioritizing client status over run ID
2. **Eliminates Complex Logic**: Removed ALL special case handling
3. **Self-Documenting**: The timestamp format is immediately understandable
4. **Incredibly Simple**: No more format conversion or compatibility code
5. **Zero Maintenance Overhead**: Clean design with minimal moving parts

## Implementation

- Updated `runIdService.js` to always generate fresh timestamp IDs
- Simplified `runIdUtils.js` to only handle the new format
- Modified `airtableService.js` to only look for Running records by client ID
- Ensured all new records use the standardized format

## Testing Recommendations

1. Verify new records are created with the timestamp format
2. Test that different processes (lead scoring, post harvesting, etc.) find the same client record
3. Confirm the client-first lookup prevents duplicates
4. Monitor logs to ensure no records are being duplicated