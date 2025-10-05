# Field Name Standardization - Remaining Tasks

## High Priority Areas to Check

1. **Routes Directory**
   - [ ] `routes/apiAndJobRoutes.js` - Check for field name literals in API endpoints
   - [ ] `routes/webhookHandlers.js` - Check field mappings with Airtable
   - [ ] `routes/apifyWebhookRoutes.js` - Check for post data field mappings

2. **Core Services**
   - [ ] `services/leadService.js` - Verify all field references are standardized
   - [ ] `services/postService.js` - Check for LinkedIn post field references
   - [ ] `services/costGovernanceService.js` - Check client run tracking fields

3. **Additional Files**
   - [ ] `promptBuilder.js` - Check for field references in prompt construction
   - [ ] `batchScorer.js` - Verify scoring field references
   - [ ] `singleScorer.js` - Check for field name string literals

## Pattern Types to Look For

1. **String Literals in Field References**
   - Direct string literals: `'Status'`, `'Run ID'`, `'Client ID'`
   - In record access: `record.get('Field Name')`

2. **Airtable Formula References**
   - Filter formulas: `filterByFormula: \`{Field Name} = '${value}'\``
   - Sort formulas: `sort: [{field: 'Field Name', direction: 'desc'}]`

3. **Field Updates**
   - Direct field assignments: `fields: {'Field Name': value}`
   - In create operations: `base('Table').create({'Field Name': value})`

## Search Commands for Next Session

```bash
# Find filterByFormula references
find . -name "*.js" -not -path "*/node_modules/*" -not -path "*/.git/*" -type f -exec grep -l "filterByFormula.*{.*}" {} \; | sort

# Find record.get() patterns
find . -name "*.js" -not -path "*/node_modules/*" -not -path "*/.git/*" -type f -exec grep -l "\.get(" {} \; | sort

# Find direct field string literals
find . -name "*.js" -not -path "*/node_modules/*" -not -path "*/.git/*" -type f -exec grep -l "'[A-Z].*':" {} \; | sort
```

## Next Steps

1. Review high-priority files in routes directory
2. Check for any missed references in service files
3. Create standardized constants for any missing field references
4. Update all string literals with constants from `airtableUnifiedConstants.js`
5. Test API endpoints to ensure field references work correctly