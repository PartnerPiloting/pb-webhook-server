# Memory Crash Warning - Airtable .all() Pattern

## ⚠️ CRITICAL PATTERN TO AVOID

**Never use `airtableBase.select().all()` as a fallback in production code.**

## What Happened (September 2025)

- Both PhantomBuster and Apify integrations had memory crashes
- Root cause: When filtered Airtable queries failed, code fell back to fetching ALL records
- This caused "JavaScript heap out of memory" errors when processing large client databases
- Crash occurred during JSON parsing of massive Airtable API responses

## The Dangerous Pattern

```javascript
// ❌ DANGEROUS - Can crash with large databases
try {
    const records = await base.select({ filterByFormula: formula }).firstPage();
    return records[0];
} catch (e) {
    // This fallback can download thousands of records and crash the server
    const all = await base.select().all(); 
    return all.find(record => /* manual search */);
}
```

## Safe Alternative

```javascript
// ✅ SAFE - Fails gracefully instead of crashing
try {
    const records = await base.select({ 
        filterByFormula: formula,
        maxRecords: 1,
        fields: ['needed_field_1', 'needed_field_2'] // Only fetch what you need
    }).firstPage();
    return records[0] || null;
} catch (e) {
    console.error(`Query failed: ${e.message}`);
    return null; // Fail gracefully instead of risking memory crash
}
```

## Why This Pattern Existed

The original logic was:
1. Try smart filtered search first
2. If that fails, assume there might be formatting issues and manually search all records

**Reality**: If the filtered search fails, there's usually no matching record anyway. The "fetch all" fallback was almost never useful and extremely dangerous.

## Impact

- Apify integration: Fixed September 12, 2025
- PhantomBuster integration: Likely had same issue (now deprecated)
- Any future Airtable integrations: Must avoid this pattern

## Memory Safety Guidelines

1. Always set `maxRecords` limits
2. Use `fields` parameter to only fetch needed columns
3. Never use `.all()` unless you're certain the table is small
4. Prefer graceful failure over risky fallbacks
5. Monitor memory usage in production

## Detection

Watch for these warning signs:
- "JavaScript heap out of memory" errors
- Crashes ~20-30 seconds after Airtable operations
- Stack traces showing `JsonParser` failures
- Memory spikes during record processing

---
*Generated: September 13, 2025*
*Context: Apify webhook integration memory crash investigation*
