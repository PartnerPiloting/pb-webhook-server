# Airtable Field Name Validation Guide

This guide explains how to use the Airtable field validation tools to prevent errors in your Airtable interactions.

## Why Field Validation Matters

Airtable has strict requirements for field names:

1. **Case Sensitivity**: Field names must exactly match the case in Airtable (`status` vs `Status`)
2. **Exact Matching**: No extra spaces or characters are allowed
3. **Schema Consistency**: Field names must exist in the Airtable base

If field names don't match exactly, you'll get errors like:
- `Unknown field name: status` (should be `Status`) 
- `Unknown field name: Posts_Processed` (should be `Posts Processed`)

## Using the Validation Tools

We've created tools to help prevent these errors:

### 1. Using Field Name Constants

Always use the `FIELD_NAMES` constants instead of hardcoding field names:

```javascript
const { FIELD_NAMES } = require('./utils/airtableFieldValidator');

// GOOD: Uses constant for correct capitalization
const updates = {
  [FIELD_NAMES.STATUS]: 'Completed',
  [FIELD_NAMES.SYSTEM_NOTES]: 'Process completed successfully'
};

// BAD: Hardcoded field names prone to typos and case errors
const badUpdates = {
  'status': 'Completed',  // Wrong case!
  'System Notes': 'Process completed successfully'
};
```

### 2. Validating Objects

Always validate objects before sending them to Airtable:

```javascript
const { validateFieldNames } = require('./utils/airtableFieldValidator');

// Check if all field names are valid
const metrics = {
  'Profiles Examined': 100,
  'Profiles Scored': 90,
  'status': 'Completed'  // Wrong case!
};

const validation = validateFieldNames(metrics);
if (!validation.success) {
  console.warn('Field validation warnings:', validation.errors);
}
```

### 3. Automatically Correcting Field Names

Use the `createValidatedObject` function to automatically fix common case issues:

```javascript
const { createValidatedObject } = require('./utils/airtableFieldValidator');

// Object with wrong case field names
const rawMetrics = {
  'profiles examined for scoring': 100,  // Wrong case
  'profiles successfully scored': 90,    // Wrong case
  'status': 'Completed'                  // Wrong case
};

// This fixes the case automatically
const validMetrics = createValidatedObject(rawMetrics);
// Result:
// {
//   'Profiles Examined for Scoring': 100,
//   'Profiles Successfully Scored': 90,
//   'Status': 'Completed'
// }
```

### 4. Handling Validation Errors

Use our specialized error classes for better error handling:

```javascript
const { FieldNameError } = require('./utils/airtableErrors');

try {
  // Use strict mode to throw errors on unknown fields
  const validData = createValidatedObject(data, { strict: true });
  await airtableBase('Table').update(recordId, validData);
} catch (error) {
  if (error instanceof FieldNameError) {
    console.error(`Field name error: ${error.message}`);
    if (error.correctFieldName) {
      console.error(`Should be: ${error.correctFieldName}`);
    }
  } else {
    console.error(`Other error: ${error.message}`);
  }
}
```

## Best Practices

1. **Always use constants**: Use `FIELD_NAMES` instead of string literals
2. **Validate before sending**: Call `validateFieldNames()` before sending data to Airtable
3. **Use automatic correction**: Use `createValidatedObject()` to fix common issues
4. **Add validation to key services**: Update core services to validate all data

## Common Field Name Errors

| Incorrect | Correct | Issue |
|-----------|---------|-------|
| `status` | `Status` | Wrong case |
| `system notes` | `System Notes` | Wrong case |
| `Profiles-Scored` | `Profiles Successfully Scored` | Wrong field name |
| `posts_processed` | `Posts Examined for Scoring` | Wrong name format |

## Integration with Error Handling

The validation system integrates with our error handling framework:

- `FieldNameError`: For field name validation issues
- `RecordNotFoundError`: For 404 errors from Airtable
- `AirtableLimitError`: For rate limit issues

Use the `handleAirtableError()` function for consistent error responses.