# Fix Posts Skip Reason Field Errors

## Problem
We're seeing errors like `Unknown field name: "Posts Skip Reason"` in the logs because this field doesn't exist in all client bases.

## Solution
Added a check to detect if the field exists in each client base before trying to update it:

1. When loading client config, we now check if the "Posts Skip Reason" field exists
2. If it doesn't exist, we set `config.fields.skipReason = null` to indicate it's not available
3. All code that uses the skipReason field now checks if it exists before adding it to update operations
4. This keeps the DatePostsScored updates working even when the field is missing

## Implementation
- Added field existence check at the start of processing each client
- Modified all places that update the skipReason field to check if it exists first
- Enhanced logging to show field availability status

This fix maintains backward compatibility with client bases that do have the field while preventing errors on bases that don't.