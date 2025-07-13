# Airtable Field Reference - Single Source of Truth

## Scoring Attributes Table Structure

**Table Name:** `Scoring Attributes`  
**Base ID:** `appXySOLo6V9PfMfa`  
**Total Records:** 23  
**Last Updated:** 2025-07-13

---

## Field Definitions

### 1. Attribute Id (Primary Key)
- **Type:** Text (String)
- **Required:** Yes
- **Editable:** No (Read-only identifier)
- **Sample Values:** "A", "B", "C", "STEP-A", "N1", "GEN-001"
- **Usage:** Unique identifier for each scoring attribute

### 2. Category 
- **Type:** Single Select
- **Required:** Yes
- **Editable:** Yes
- **Options:** 
  - `Positive` (11 records)
  - `Negative` (6 records) 
  - `Step` (4 records)
  - `Global Rule` (1 record)
  - `Meta` (1 record)
- **Usage:** Groups attributes by scoring type

### 3. Heading
- **Type:** Text (String)
- **Required:** Yes
- **Editable:** Yes
- **Sample Values:** "Emerging Tech / AI Enthusiasm", "Financial Ability via Income/Career"
- **Usage:** Human-readable name for the attribute

### 4. Instructions
- **Type:** Long Text (Textarea)
- **Required:** Yes
- **Editable:** Yes
- **Contains:** Detailed scoring guidelines, ranges, criteria
- **Usage:** Core rubric content - main editing target

### 5. Max Points
- **Type:** Number
- **Required:** For Positive attributes only
- **Editable:** Yes
- **Range:** 3-20 points
- **Unique Values:** 3, 5, 10, 15, 20
- **Records with data:** 11/23

### 6. Min To Qualify
- **Type:** Number
- **Required:** Optional
- **Editable:** Yes
- **Usage:** Minimum threshold for qualification
- **Records with data:** 11/23

### 7. Penalty
- **Type:** Number
- **Required:** For Negative attributes only
- **Editable:** Yes
- **Sample Values:** 5, 10
- **Records with data:** 6/23

### 8. Disqualifying
- **Type:** Checkbox (Boolean)
- **Required:** Optional
- **Editable:** Yes
- **Usage:** Marks attributes that cause immediate disqualification
- **Records with data:** 3/23 (all true)

### 9. Signals
- **Type:** Long Text
- **Required:** Optional
- **Editable:** Yes
- **Usage:** Keywords/phrases that trigger this attribute
- **Records with data:** 17/23

### 10. Examples
- **Type:** Long Text
- **Required:** Optional
- **Editable:** Yes
- **Usage:** Detailed examples with sample scores
- **Records with data:** 1/23

### 11. Last Updated
- **Type:** Date/Time
- **Required:** Yes
- **Editable:** Auto-managed
- **Format:** ISO 8601 (e.g., "2025-04-26T06:35:18.000Z")
- **Usage:** Audit trail for changes

---

## Record Distribution by Category

| Category | Count | Purpose |
|----------|-------|---------|
| **Positive** | 11 | Scoring attributes that award points |
| **Negative** | 6 | Penalty attributes that deduct points |
| **Step** | 4 | Process/workflow instructions |
| **Global Rule** | 1 | Final score computation |
| **Meta** | 1 | System narrative/purpose |

---

## Key Insights for AI Editing System

### Editable Fields (Primary Targets)
1. **Heading** - Short descriptive names
2. **Instructions** - Main rubric content (most important)
3. **Max Points** - Scoring ranges
4. **Min To Qualify** - Threshold values
5. **Penalty** - Deduction amounts
6. **Signals** - Trigger keywords
7. **Examples** - Sample scenarios

### System Constraints
- **Attribute Id** is immutable (primary key)
- **Category** should rarely change (affects scoring logic)
- **Last Updated** auto-managed by system
- **Disqualifying** has major impact (use carefully)

### Natural Language Editing Targets
Users will want to edit:
- "Change max points for attribute A to 25"
- "Rewrite the instructions for leadership scoring to be clearer"
- "Add more signal keywords for AI enthusiasm"
- "Update the penalty for negative energy to 8 points"
- "Make the qualification threshold higher for this attribute"

---

## API Implementation Notes

- **Primary Key Field:** `Attribute Id`
- **Record IDs:** Available for direct updates (rec1dyLYXREwmsP9a format)
- **Multi-tenant Ready:** Existing Airtable client supports ?client= parameter
- **Field Types:** All compatible with web form inputs
- **Validation:** Number fields need min/max constraints
- **Relationships:** None - flat table structure

---

*Generated from live Airtable data on 2025-07-13*
