# Airtable Field Reference - Single Source of Truth

## Master Clients Table Structure

**Table Name:** `Clients`  
**Base ID:** `appuOdh6wnILkr1L5` (Master Clients Base)  
**Last Updated:** 2025-07-26

### Client Configuration Fields

#### 1. Client ID (Primary Key)
- **Type:** Text (String)
- **Required:** Yes
- **Editable:** No (Read-only identifier)
- **Sample Values:** "Guy-Wilson"
- **Usage:** Unique identifier for each client
- **Backend Implementation:** 
  - Used by `getClientById()` to locate client records
  - Primary key for client lookup in multi-tenant operations
  - Referenced in `?client=` API parameters
  - Cache key for client data storage

#### 2. Client Name
- **Type:** Text (String)
- **Required:** Yes
- **Editable:** Yes
- **Sample Values:** "Guy Wilson"
- **Usage:** Human-readable display name for the client
- **Backend Implementation:**
  - Displayed in logs and client identification messages
  - Used for user-friendly client identification in admin interfaces
  - Returned in client lookup operations for display purposes

#### 3. Status
- **Type:** Single Select (Dropdown)
- **Required:** Yes
- **Editable:** Yes
- **Sample Values:** "Active"
- **Options:** Active, Inactive, Suspended, etc.
- **Usage:** Current operational status of the client account
- **Backend Implementation:**
  - `validateClient()` checks if status === 'Active' before allowing operations
  - `getAllActiveClients()` filters by Active status only
  - Prevents inactive clients from using scoring services
  - Used in authentication and authorization logic

#### 4. Airtable Base ID
- **Type:** Text (String)
- **Required:** Yes
- **Editable:** Yes
- **Sample Values:** "appXySOLo6V9PfMfa"
- **Usage:** Links client to their specific Airtable base for scoring operations
- **Backend Implementation:**
  - `getClientBase()` uses this field to create client-specific base connections
  - Multi-tenant architecture: each client has their own Airtable base
  - Base instance caching uses this ID as cache key
  - Critical for data isolation between clients

#### 5. Execution Log
- **Type:** Long Text (Textarea)
- **Required:** No
- **Editable:** Auto-managed
- **Sample Values:** "=== EXECUTION: 2025-07-26T02:31:54.303\nSTATUS: success\nLEADS PROCESSED: 0/0 successful\nPOST SCORING: 18/76 successful"
- **Usage:** Tracks execution history, status, and performance metrics for client operations
- **Backend Implementation:**
  - `updateExecutionLog()` appends new entries (newest first)
  - `formatExecutionLog()` creates standardized log format
  - `logExecution()` handles both lead scoring and post scoring operations
  - Tracks: status, leads processed, posts scored, duration, tokens used, errors
  - Automatically timestamped with ISO format
  - Cache invalidation occurs after log updates

#### 6. WordPress User ID
- **Type:** Number
- **Required:** Yes
- **Editable:** Yes
- **Sample Values:** 1
- **Usage:** Links client to WordPress user account for authentication and access control
- **Backend Implementation:**
  - `getClientByWpUserId()` enables WordPress-based client lookup
  - Authentication bridge between WordPress and Airtable systems
  - Used for user session validation and authorization
  - Enables WordPress-driven client identification

#### 7. Service Level
- **Type:** Single Select (Dropdown)
- **Required:** Yes
- **Editable:** Yes
- **Sample Values:** "2-Lead Scoring + Post Scoring"
- **Options:** (Multiple service tiers available)
- **Usage:** Defines which services/features are available to the client
- **Backend Implementation:**
  - Currently stored but not actively used in service restrictions
  - Intended for feature access control and billing tiers
  - Future implementation for service-based permissions

#### 8. Profile Scoring Token Limit
- **Type:** Number
- **Required:** Yes
- **Editable:** Yes
- **Sample Values:** 5,000
- **Usage:** Maximum number of tokens allowed for Profile scoring operations per client
- **Backend Implementation:** 
  - **NOT YET IMPLEMENTED** - Awaiting token limit enforcement feature
  - Intended for AI token consumption control in profile analysis
  - Will be used to prevent clients from exceeding token budgets

#### 9. Post Scoring Token Limit
- **Type:** Number
- **Required:** Yes
- **Editable:** Yes
- **Sample Values:** 3,000
- **Usage:** Maximum number of tokens allowed for Post scoring operations per client
- **Backend Implementation:**
  - **NOT YET IMPLEMENTED** - Awaiting token limit enforcement feature
  - Intended for AI token consumption control in post analysis
  - Will be used to prevent clients from exceeding token budgets

---

## Scoring Attributes Table Structure

**Table Name:** `Scoring Attributes`  
**Base ID:** `appXySOLo6V9PfMfa`  
**Total Records:** 23  
**Last Updated:** 2025-07-23

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

### 8. Bonus Points
- **Type:** Checkbox (Boolean)
- **Required:** Optional
- **Editable:** Yes
- **Default Value:** False (unchecked)
- **Usage:** Identifies attributes that award bonus points beyond the standard scoring framework
- **Impact:** When checked (Yes), this attribute provides bonus points that enhance a candidate's score above the normal 100% ceiling
- **Scoring Logic:** Bonus point attributes contribute 25% of their total possible points to the denominator calculation
- **Examples:** Exceptional qualifications, nice-to-have skills, achievements that indicate exceptional potential
- **Implementation:** Phase 1 (Frontend UX), Phase 2 (Backend scoring integration)

### 9. Disqualifying
- **Type:** Checkbox (Boolean)
- **Required:** Optional
- **Editable:** Yes
- **Usage:** Marks attributes that cause immediate disqualification
- **Records with data:** 3/23 (all true)

### 10. Signals
- **Type:** Long Text
- **Required:** Optional
- **Editable:** Yes
- **Usage:** Keywords/phrases that trigger this attribute
- **Records with data:** 17/23

### 11. Examples
- **Type:** Long Text
- **Required:** Optional
- **Editable:** Yes
- **Usage:** Detailed examples with sample scores
- **Records with data:** 1/23

### 12. Last Updated
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
6. **Bonus Points** - Exceptional scoring flag
7. **Signals** - Trigger keywords
8. **Examples** - Sample scenarios

### System Constraints
- **Attribute Id** is immutable (primary key)
- **Category** should rarely change (affects scoring logic)
- **Last Updated** auto-managed by system
- **Disqualifying** has major impact (use carefully)
- **Bonus Points** affects denominator calculation (25% contribution)

### Natural Language Editing Targets
Users will want to edit:
- "Change max points for attribute A to 25"
- "Rewrite the instructions for leadership scoring to be clearer"
- "Add more signal keywords for AI enthusiasm"
- "Update the penalty for negative energy to 8 points"
- "Make the qualification threshold higher for this attribute"
- "Set this attribute as bonus points for exceptional candidates"
- "Turn off bonus points for this attribute and make it regular scoring"

---

## API Implementation Notes

### Master Clients Base
- **Base ID:** `appuOdh6wnILkr1L5`
- **Primary Key Field:** `Client ID`
- **Environment Variable:** `MASTER_CLIENTS_BASE_ID`
- **Display Name:** `Client Name`
- **Status Management:** `Status`
- **Base Configuration:** `Airtable Base ID`
- **Audit Trail:** `Execution Log`
- **Authentication Field:** `WordPress User ID`
- **Service Configuration:** `Service Level`
- **Token Limit Fields:** `Profile Scoring Token Limit`, `Post Scoring Token Limit`
- **Usage:** Complete client configuration, authentication, service tiers, base linking, execution tracking, and token budget management

### Scoring Attributes Base
- **Base ID:** `appXySOLo6V9PfMfa`
- **Primary Key Field:** `Attribute Id`
- **Record IDs:** Available for direct updates (rec1dyLYXREwmsP9a format)
- **Multi-tenant Ready:** Existing Airtable client supports ?client= parameter
- **Field Types:** All compatible with web form inputs
- **Validation:** Number fields need min/max constraints
- **Relationships:** None - flat table structure
- **Bonus Points Logic:** Requires frontend UX implementation before backend integration

---

## Leads Table Structure

**Table Name:** `Leads`  
**Base ID:** Variable (Client-specific - see Master Clients Table)  
**Purpose:** Core lead/prospect management and scoring data  
**Last Updated:** 2025-07-30

### Core Identity Fields

#### 1. First Name
- **Type:** Text (String)
- **Required:** Yes
- **Editable:** Yes
- **Sample Values:** "John", "Sarah", "Michael"
- **Usage:** Primary identification and display purposes
- **Backend Implementation:** 
  - Used in sorting: `sort: [{ field: 'First Name' }]`
  - Search functionality across LinkedIn routes
  - Display in admin interfaces and client dashboards

#### 2. Last Name
- **Type:** Text (String)
- **Required:** Yes
- **Editable:** Yes
- **Sample Values:** "Smith", "Johnson", "Williams"
- **Usage:** Secondary identification and display purposes
- **Backend Implementation:**
  - Combined with First Name for full name display
  - Part of search and filtering operations
  - Used in sorting as secondary field

#### 3. LinkedIn Profile URL
- **Type:** URL (String)
- **Required:** Yes
- **Editable:** Yes
- **Sample Values:** "https://linkedin.com/in/john-smith-marketing"
- **Usage:** Primary unique identifier for lead lookup and verification
- **Backend Implementation:**
  - Primary search field: `filterByFormula: {LinkedIn Profile URL} = "${url}"`
  - Used for duplicate detection and lead matching
  - Integration with LinkedIn API and extensions

### Contact Information Fields

#### 4. Email
- **Type:** Email (String)
- **Required:** No
- **Editable:** Yes
- **Sample Values:** "john.smith@company.com"
- **Usage:** Direct communication and marketing campaigns
- **Backend Implementation:** Returned in lead detail views

#### 5. Phone
- **Type:** Phone Number (String)
- **Required:** No
- **Editable:** Yes
- **Sample Values:** "+1-555-123-4567"
- **Usage:** Direct contact and follow-up communications
- **Backend Implementation:** Available in detailed lead responses

#### 6. Company
- **Type:** Text (String)
- **Required:** No
- **Editable:** Yes
- **Sample Values:** "Tech Innovations Inc"
- **Usage:** Lead qualification and targeting context
- **Backend Implementation:** Used in search by company name

#### 7. Job Title
- **Type:** Text (String)
- **Required:** No
- **Editable:** Yes
- **Sample Values:** "Senior Marketing Manager", "VP of Sales"
- **Usage:** Lead qualification and personalization
- **Backend Implementation:** Part of detailed lead profile data

#### 8. Industry
- **Type:** Text (String)
- **Required:** No
- **Editable:** Yes
- **Sample Values:** "Technology", "Healthcare", "Finance"
- **Usage:** Lead segmentation and targeting
- **Backend Implementation:** Available for filtering and search

#### 9. Location
- **Type:** Text (String)
- **Required:** No
- **Editable:** Yes
- **Sample Values:** "San Francisco, CA", "New York, NY"
- **Usage:** Geographic targeting and timezone considerations
- **Backend Implementation:** Returned in lead search results

### Scoring and AI Fields

#### 10. AI Score
- **Type:** Number (Percentage)
- **Required:** No
- **Editable:** Auto-calculated
- **Sample Values:** 75, 82, 91
- **Usage:** Primary lead qualification metric from AI scoring
- **Backend Implementation:**
  - Central to lead ranking and prioritization
  - Used in scoring algorithms and reporting
  - Returned in all lead list endpoints

#### 11. AI Profile Assessment
- **Type:** Long Text (Textarea)
- **Required:** No
- **Editable:** Auto-generated
- **Usage:** Detailed AI analysis of lead's profile and qualifications
- **Backend Implementation:** Available in detailed lead view endpoints

#### 12. AI Attribute Breakdown
- **Type:** Long Text (Textarea)
- **Required:** No
- **Editable:** Auto-generated
- **Usage:** Detailed breakdown of scoring attributes and reasoning
- **Backend Implementation:** Returned in full lead detail responses

#### 13. Scoring Status
- **Type:** Single Select
- **Required:** No
- **Editable:** Auto-managed
- **Options:** "To Be Scored", "Scored", "Scoring Failed"
- **Usage:** Tracks AI scoring workflow status
- **Backend Implementation:** Used to filter leads ready for scoring

#### 14. Date Scored
- **Type:** Date/Time
- **Required:** No
- **Editable:** Auto-managed
- **Usage:** Audit trail for when AI scoring was completed
- **Backend Implementation:** Timestamp management in scoring workflows

#### 15. Date Added
- **Type:** Date/Time
- **Required:** No
- **Editable:** Auto-managed
- **Usage:** Lead creation timestamp for analytics and reporting
- **Backend Implementation:** Used in lead lifecycle tracking

### Post Scoring Fields

#### 16. Posts Relevance Score
- **Type:** Number
- **Required:** No
- **Editable:** Auto-calculated
- **Usage:** AI assessment of LinkedIn post content quality
- **Backend Implementation:** Part of comprehensive lead scoring system

#### 17. Posts Relevance Percentage
- **Type:** Number (Percentage)
- **Required:** No
- **Editable:** Auto-calculated
- **Usage:** Percentage-based posts relevance scoring
- **Backend Implementation:** Used in post scoring analytics

#### 18. Posts Relevance Status
- **Type:** Single Select
- **Required:** No
- **Editable:** Auto-managed
- **Options:** "Relevant", "Not Relevant", "Pending"
- **Usage:** Classification of post content relevance
- **Backend Implementation:**
  - Key filter in top-scoring-posts endpoint
  - Used to identify leads ready for post-based outreach

#### 19. Posts Actioned
- **Type:** Text (String)
- **Required:** No
- **Editable:** Yes
- **Usage:** Tracks which posts have been used for outreach
- **Backend Implementation:**
  - Filter criteria: `OR({Posts Actioned} = "", {Posts Actioned} = BLANK())`
  - Prevents duplicate post-based outreach

#### 20. Top Scoring Post
- **Type:** Long Text (Textarea)
- **Required:** No
- **Editable:** Auto-generated
- **Usage:** Best LinkedIn post content for engagement/outreach
- **Backend Implementation:** Returned in top-scoring-posts endpoint responses

### Lead Management Fields

#### 21. Status
- **Type:** Single Select
- **Required:** Yes
- **Editable:** Yes
- **Options:** "On The Radar", "Contacted", "Responded", "Qualified", "Closed"
- **Usage:** Lead lifecycle stage tracking
- **Backend Implementation:**
  - Default value: "On The Radar" for new leads
  - Used in filtering and reporting across all endpoints

#### 22. Priority
- **Type:** Single Select
- **Required:** No
- **Editable:** Yes
- **Options:** "High", "Medium", "Low"
- **Usage:** Lead prioritization for sales team focus
- **Backend Implementation:**
  - Filter parameter in search endpoints
  - Used in lead list sorting and prioritization

#### 23. Source
- **Type:** Text (String)
- **Required:** No
- **Editable:** Yes
- **Sample Values:** "LinkedIn Search", "Referral", "Website"
- **Usage:** Lead origin tracking for attribution analysis
- **Backend Implementation:** Available in lead detail responses

#### 24. Tags
- **Type:** Text (String)
- **Required:** No
- **Editable:** Yes
- **Sample Values:** "decision-maker,tech-savvy,high-budget"
- **Usage:** Custom categorization and filtering
- **Backend Implementation:** Used in search and filtering operations

### Communication Fields

#### 25. Notes
- **Type:** Long Text (Textarea)
- **Required:** No
- **Editable:** Yes
- **Usage:** Free-form notes and observations about the lead
- **Backend Implementation:**
  - Returned in all detailed lead responses
  - Editable through update endpoints

#### 26. LinkedIn Messages
- **Type:** Long Text (Textarea)
- **Required:** No
- **Editable:** Yes
- **Usage:** Transcript of LinkedIn communications
- **Backend Implementation:** Available in detailed lead views

#### 27. LinkedIn Connection Status
- **Type:** Single Select
- **Required:** No
- **Editable:** Yes
- **Options:** "Not Connected", "Invitation Sent", "Connected"
- **Usage:** Tracks LinkedIn relationship status
- **Backend Implementation:** Used in outreach workflow management

#### 28. Last Message Date
- **Type:** Date
- **Required:** No
- **Editable:** Yes
- **Usage:** Timestamp of most recent communication
- **Backend Implementation:**
  - Used in follow-up scheduling
  - Returned in follow-ups and search endpoints

#### 29. Last Contact Date
- **Type:** Date
- **Required:** No
- **Editable:** Yes
- **Usage:** Broader contact tracking beyond LinkedIn messages
- **Backend Implementation:** Used in communication timeline tracking

### Follow-Up Management Fields

#### 30. Follow-Up Date
- **Type:** Date
- **Required:** No
- **Editable:** Yes
- **Usage:** Scheduled date for next follow-up contact
- **Backend Implementation:**
  - Primary filter for follow-ups endpoint: `{Follow-Up Date} <= TODAY()`
  - Used in automated follow-up scheduling

#### 31. Follow Up Notes
- **Type:** Long Text (Textarea)
- **Required:** No
- **Editable:** Yes
- **Usage:** Specific notes for next follow-up action
- **Backend Implementation:** Returned in follow-up management endpoints

### Technical Integration Fields

#### 32. View In Sales Navigator
- **Type:** URL (String)
- **Required:** No
- **Editable:** Auto-generated
- **Usage:** Direct link to LinkedIn Sales Navigator profile
- **Backend Implementation:** Generated during profile processing

#### 33. Extension Last Sync
- **Type:** Date/Time
- **Required:** No
- **Editable:** Auto-managed
- **Usage:** Last synchronization with LinkedIn browser extension
- **Backend Implementation:** Used for data freshness tracking

#### 34. Profile Full JSON
- **Type:** Long Text (JSON)
- **Required:** No
- **Editable:** Auto-managed
- **Usage:** Complete LinkedIn profile data for AI processing
- **Backend Implementation:** Source data for AI scoring algorithms

#### 35. Headline
- **Type:** Text (String)
- **Required:** No
- **Editable:** Auto-imported
- **Sample Values:** "Senior Marketing Manager at Tech Innovations"
- **Usage:** LinkedIn profile headline for context
- **Backend Implementation:** Part of detailed lead profile data

#### 36. About
- **Type:** Long Text (Textarea)
- **Required:** No
- **Editable:** Auto-imported
- **Usage:** LinkedIn "About" section content for AI analysis
- **Backend Implementation:** Used in profile assessment algorithms

#### 37. Company Name
- **Type:** Text (String)
- **Required:** No
- **Editable:** Auto-imported
- **Usage:** Current company from LinkedIn profile
- **Backend Implementation:** May differ from manually entered Company field

### Legacy/Compatibility Fields

#### 38. Score
- **Type:** Number
- **Required:** No
- **Editable:** Legacy
- **Usage:** Previous scoring system (replaced by AI Score)
- **Backend Implementation:** Maintained for backward compatibility

#### 39. ASH Workshop Email
- **Type:** Email (String)
- **Required:** No
- **Editable:** Yes
- **Usage:** Specific to ASH workshop participants
- **Backend Implementation:** Client-specific field for workshop management

---

## Field Usage Patterns

### Search and Filtering
- **Primary Search Fields:** First Name, Last Name, LinkedIn Profile URL
- **Filter Fields:** Priority, Status, Posts Relevance Status
- **Date Range Fields:** Follow-Up Date, Date Added, Date Scored

### Multi-tenant Considerations
- All fields are client-specific (separate Airtable bases)
- Field naming must be consistent across client bases
- Authentication required for all field access

### API Endpoint Mapping
- **List Views:** Core fields (name, LinkedIn URL, AI Score, Status, Priority)
- **Detail Views:** All fields including extended profile data
- **Update Operations:** User-editable fields only
- **Search Operations:** Name and LinkedIn URL fields with text matching

---

*Generated from live codebase analysis on 2025-07-30*
*Includes all fields currently used across authentication systems*

---

## Post Scoring Attributes Table Structure

**Table Name:** `Post Scoring Attributes`  
**Base ID:** `appXySOLo6V9PfMfa`  
**Total Records:** 5  
**Purpose:** AI scoring rubric definitions for LinkedIn post content analysis  
**Last Updated:** 2025-07-26

### Primary Fields

#### 1. Attribute ID (Primary Key)
- **Type:** Text (String)
- **Required:** Yes
- **Editable:** No (Read-only identifier)
- **Sample Values:** "POST_AI_SENTIMENT", "POST_AI_INSIGHTFULNESS"
- **Usage:** Unique identifier for each post scoring attribute
- **Backend Implementation:** Primary key for `attributesById` object mapping

#### 2. Active
- **Type:** Checkbox (Boolean)
- **Required:** No
- **Editable:** Yes
- **Usage:** Controls whether attribute is included in scoring pipeline
- **Backend Implementation:** Boolean flag to enable/disable individual scoring criteria - Filtered during attribute loading

#### 3. Category
- **Type:** Text (String)
- **Required:** Yes
- **Editable:** Yes
- **Sample Values:** "Positive Scoring Factor", "Negative Scoring Factor"
- **Usage:** Separates positive vs negative attributes in prompt building
- **Backend Implementation:** Controls rubric sections in AI prompt

#### 4. Criterion Name
- **Type:** Text (String)
- **Required:** Yes
- **Editable:** Yes
- **Usage:** Human-readable attribute name shown in scoring rubric for AI
- **Backend Implementation:** `criterionName` property in attribute objects, displayed in AI prompt

#### 5. Detailed Instructions for AI (Scoring Rubric)
- **Type:** Long Text (Textarea)
- **Required:** Yes
- **Editable:** Yes
- **Usage:** Complete scoring guidelines with Low/Medium/High point ranges - Primary field that teaches AI how to score
- **Backend Implementation:** `detailedInstructions` - Core content fed to Gemini for scoring logic

#### 6. Max Score / Point Value
- **Type:** Number
- **Required:** Yes
- **Editable:** Yes
- **Sample Values:** 20, -20
- **Usage:** Points awarded (e.g., 20) or penalty (e.g., -20) - Defines scoring scale limits
- **Backend Implementation:** `maxScorePointValue` - Used in prompt to show AI max points available

#### 7. Scoring Type
- **Type:** Text (String)
- **Required:** Yes
- **Editable:** Yes
- **Sample Values:** "Scale", "Fixed Penalty"
- **Usage:** Determines scoring methodology - "Scale" for 0-20 range, "Fixed Penalty" for binary application
- **Backend Implementation:** `scoringType` - Informs AI whether to use graduated scoring or binary penalty

#### 8. Example - High Score / Applies
- **Type:** Long Text (Textarea)
- **Required:** No
- **Editable:** Yes
- **Usage:** Sample posts that demonstrate high scoring criteria - Guides AI consistency
- **Backend Implementation:** `exampleHigh` - Training examples shown to AI in prompt

#### 9. Example - Low Score / Does Not Apply
- **Type:** Long Text (Textarea)
- **Required:** No
- **Editable:** Yes
- **Usage:** Sample posts that demonstrate low scoring or non-applicable criteria - Guides AI consistency
- **Backend Implementation:** `exampleLow` - Training examples shown to AI in prompt

#### 10. Keywords/Positive Indicators
- **Type:** Long Text (Textarea)
- **Required:** No
- **Editable:** Yes
- **Usage:** Keywords/phrases that indicate high scores for this attribute - Helps AI identify relevant content
- **Backend Implementation:** `positiveKeywords` - Displayed in AI prompt as pattern matching guidance

#### 11. Keywords/Negative Indicators
- **Type:** Long Text (Textarea)
- **Required:** No
- **Editable:** Yes
- **Usage:** Keywords/phrases that indicate low scores or penalties - Helps AI identify problematic content
- **Backend Implementation:** `negativeKeywords` - Displayed in AI prompt as pattern matching guidance

### Sample Attributes
| Attribute ID | Category | Criterion Name | Max Score | Scoring Type |
|-------------|----------|----------------|-----------|--------------|
| `POST_AI_SENTIMENT` | Positive Scoring Factor | Positive Sentiment Towards AI | 20 | Scale |
| `POST_AI_INSIGHTFULNESS` | Positive Scoring Factor | Demonstrates Open-Mindedness/Insightful Discussion about AI | 20 | Scale |
| `POST_PROMOTIONAL_PENALTY` | Negative Scoring Factor | Primarily Self-Promotional Content (Penalty) | -20 | Fixed Penalty |

---

*Generated from live Airtable data on 2025-07-23*
*Updated with Bonus Points field for enhanced scoring capabilities*
*Consolidated Post Scoring Attributes documentation on 2025-07-26*
*Added comprehensive Leads Table documentation on 2025-07-30*

---

## Additional Resources

### Field Export Files
- `scoring-attributes-fields-2025-07-25.txt` - Raw field analysis export from Scoring Attributes table
- `post-scoring-attributes-fields-2025-07-25.txt` - Raw field analysis export from Post Scoring Attributes table

*These .txt files are data exports for analysis purposes and are NOT the single source of truth for field definitions*
