# Airtable Field Master List - "Leads" Table

## Standard Fields (Visible to All Clients)

### **Basic Lead Information**
| Field Name | Type | Editable | Required | Validation | Description |
|------------|------|----------|----------|------------|-------------|
| `LinkedIn Profile URL` | URL | Yes | Yes | LinkedIn URL format | Primary identifier, clickable link |
| `Profile Key` | Formula | No | No | Auto-generated | Unique identifier |
| `First Name` | Text | Yes | Yes | None | No character limits |
| `Last Name` | Text | Yes | Yes | None | No character limits |
| `View In Sales Navigator` | URL | Yes | No | None | Manual entry from address bar |
| `Email` | Email | Yes | No | Email format | Can be empty |
| `Phone` | Text | Yes | No | None | Phone number, any format |
| `ASH Workshop Email` | Checkbox | Yes | No | Boolean | Workshop invitation tracking |

### **Profile Key Formula**
```
LOWER(
  SUBSTITUTE(
    SUBSTITUTE(
      IF(
        RIGHT({LinkedIn Profile URL}, 1) = "/",
        LEFT({LinkedIn Profile URL}, LEN({LinkedIn Profile URL}) - 1),
        {LinkedIn Profile URL}
      ),
      "https://",
      ""
    ),
    "http://",
    ""
  )
)
```

### **AI Scoring & Analytics**
| Field Name | Type | Editable | Scale/Format | Description |
|------------|------|----------|--------------|-------------|
| `AI Score` | Number | No | 0-100, no decimals | System-generated lead relevance |
| `AI Profile Assessment` | Long Text | No | Rich text | AI-generated profile analysis and insights |
| `AI Attribute Breakdown` | Long Text | No | Rich text | Detailed attribute analysis and scoring breakdown |
| `Scoring Status` | Single Select | No | System status | "To Be Scored", "Scored", "Skipped - Profile Too Thin", etc. |
| `Posts Relevance Score` | Number | No | System value | Raw scoring value |
| `Posts Relevance Percentage` | Formula | No | 0-100% | Calculated as `{Posts Relevance Score}/80*100` |
| `Posts Relevance Status` | Formula | No | "Relevant"/"Irrelevant" | Calculated as `IF({Posts Relevance Percentage} >= 50, "Relevant", "Irrelevant")` |
| `Posts Actioned` | Checkbox | Yes | Boolean | Whether posts have been acted upon |
| `Top Scoring Post` | Long Text | No | Rich text | Best post for engagement context |

### **Messaging & Follow-Up**
| Field Name | Type | Editable | Format | Description |
|------------|------|----------|--------|-------------|
| `Notes` | Long Text | Yes | Rich text | Manual + auto-captured conversations |
| `Follow-Up Date` | Date | Yes | Local timezone | Next contact scheduling |

### **Status Tracking**
| Field Name | Type | Options | Description |
|------------|------|---------|-------------|
| `Source` | Single Select | "SalesNav + LH Scrape", "Manually selected from my ASH Followers", "2nd level leads from PB", "Follow-Up Personally", "Existing Connection Added by PB", "SalesNav + LH Scrape" | Lead origin tracking |
| `Status` | Single Select | "On The Radar", "In Process", "Archive", "Not Interested" | Lead processing status |
| `Priority` | Single Select | "One", "Two", "Three" | Priority ranking (1=highest) |
| `LinkedIn Connection Status` | Single Select | "Connected", "Invitation Sent", "Withdrawn", "To Be Sent", "Candidate", "Ignore", "Queued Connection Request" | Connection workflow tracking |

## New Fields for LinkedIn Messaging Extension

### **Message History**
| Field Name | Type | Editable | Description |
|------------|------|----------|-------------|
| `LinkedIn Messages` | Long Text (JSON) | No | JSON array of message history |
| `Last Message Date` | Date | No | System-updated timestamp |
| `Extension Last Sync` | DateTime | No | Chrome extension sync tracking |

### **JSON Structure for LinkedIn Messages**
```javascript
{
  "messages": [
    {
      "date": "2025-01-15T10:30:00Z",
      "content": "Hi John, I saw your post about AI automation...",
      "direction": "sent", // sent/received
      "platform": "linkedin", // linkedin/sales_navigator
      "message_id": "unique_linkedin_id",
      "thread_id": "conversation_thread_id"
    }
  ],
  "last_updated": "2025-01-15T10:30:00Z",
  "total_messages": 1
}
```

## Owner-Specific Fields (Hidden from Client Interfaces)

### **Guy-Specific Functionality**
| Field Name | Type | Editable | Visibility | Description |
|------------|------|----------|------------|-------------|
| `ASH Workshop Email` | Checkbox | Yes | Owner-only | Workshop invitation tracking |

## Existing Fields (Reference Only)

### **Profile Data**
| Field Name | Type | Source | Description |
|------------|------|--------|-------------|
| `Headline` | Text | LinkedIn | Professional summary |
| `Job Title` | Text | LinkedIn | Current position |
| `Company Name` | Text | LinkedIn | Current employer |
| `About` | Long Text | LinkedIn | LinkedIn About section |
| `Job History` | Long Text | LinkedIn | Employment history |
| `Date Connected` | Date | LinkedIn | Connection timestamp |
| `Scoring Status` | Single Select | System | "To Be Scored/Scored/Excluded" |
| `Profile Full JSON` | Long Text | System | Complete LinkedIn profile data |
| `Posts Content` | Long Text (JSON) | PhantomBuster | LinkedIn posts array |
| `Top Scoring Post` | Text | AI System | Best post analysis |

## Field Visibility Configuration

### **Web Portal Display Logic**
```javascript
const fieldVisibility = {
  // Editable fields
  "LinkedIn Profile URL": { visible: true, editable: true },
  "First Name": { visible: true, editable: true },
  "Last Name": { visible: true, editable: true },
  "View In Sales Navigator": { visible: true, editable: true },
  "Email": { visible: true, editable: true },
  "Phone": { visible: true, editable: true },
  "ASH Workshop Email": { visible: true, editable: true },
  "Notes": { visible: true, editable: true },
  "Follow-Up Date": { visible: true, editable: true },
  
  // Read-only fields
  "Profile Key": { visible: true, editable: false },
  "AI Score": { visible: true, editable: false },
  "Posts Relevance Percentage": { visible: true, editable: false },
  "Top Scoring Post": { visible: true, editable: false },
  "Last Message Date": { visible: true, editable: false },
  
  // Post scoring fields (level 2 service only)
  "Posts Actioned": { visible: true, editable: true, serviceLevel: 2 },
};
```

## Chrome Extension Field Interactions

### **Primary Fields Used**
- `LinkedIn Profile URL` - Lead identification
- `Notes` - Conversation capture
- `Follow-Up Date` - Follow-up scheduling
- `LinkedIn Messages` - Message history (JSON)
- `Last Message Date` - Timeline tracking
- `Extension Last Sync` - Sync status

### **Read-Only Reference Fields**
- `Profile Key` - Unique identification
- `First Name` / `Last Name` - Display purposes
- `AI Score` - Lead prioritization context

## Notes Field Integration Strategy

Based on our documented conversation capture strategy:

### **Content Structure**
```
📝 Manual Notes

2025-01-15
[Manual note content]

---

🔄 LinkedIn Conversations

2025-01-14
[Frank Heibel] Hi there, thanks for connecting...
[You] Thanks Frank! I saw your recent post about...
```

### **Timestamp-Based Deduplication**
- Extract timestamps from captured conversations
- Compare against existing Notes content
- Only append new conversation content
- Maintain chronological order with section headers

This master list serves as the single source of truth for all Airtable field names, types, and configurations across the LinkedIn Messaging Follow-Up system.

## Verification Complete
This master list is the single source of truth for all field names, types, and configurations across the LinkedIn Follow-Up system. All other documentation references this file for consistency.

# Airtable Field Master List - All Tables

## "Leads" Table Fields

### **Basic Lead Information**
| Field Name | Type | Editable | Required | Validation | Description |
|------------|------|----------|----------|------------|-------------|
| `LinkedIn Profile URL` | URL | Yes | Yes | LinkedIn URL format | Primary identifier, clickable link |
| `Profile Key` | Formula | No | No | Auto-generated | Unique identifier |
| `First Name` | Text | Yes | Yes | None | No character limits |
| `Last Name` | Text | Yes | Yes | None | No character limits |
| `View In Sales Navigator` | URL | Yes | No | None | Manual entry from address bar |
| `Email` | Email | Yes | No | Email format | Can be empty |
| `Phone` | Text | Yes | No | None | Phone number, any format |
| `ASH Workshop Email` | Checkbox | Yes | No | Boolean | Workshop invitation tracking |

### **Profile Key Formula**
```
LOWER(
  SUBSTITUTE(
    SUBSTITUTE(
      IF(
        RIGHT({LinkedIn Profile URL}, 1) = "/",
        LEFT({LinkedIn Profile URL}, LEN({LinkedIn Profile URL}) - 1),
        {LinkedIn Profile URL}
      ),
      "https://",
      ""
    ),
    "http://",
    ""
  )
)
```

### **AI Scoring & Analytics**
| Field Name | Type | Editable | Scale/Format | Description |
|------------|------|----------|--------------|-------------|
| `AI Score` | Number | No | 0-100, no decimals | System-generated lead relevance |
| `AI Profile Assessment` | Long Text | No | Rich text | AI-generated profile analysis and insights |
| `AI Attribute Breakdown` | Long Text | No | Rich text | Detailed attribute analysis and scoring breakdown |
| `Scoring Status` | Single Select | No | System status | "To Be Scored", "Scored", "Skipped - Profile Too Thin", etc. |
| `Posts Relevance Score` | Number | No | System value | Raw scoring value |
| `Posts Relevance Percentage` | Formula | No | 0-100% | Calculated as `{Posts Relevance Score}/80*100` |
| `Posts Relevance Status` | Formula | No | "Relevant"/"Irrelevant" | Calculated as `IF({Posts Relevance Percentage} >= 50, "Relevant", "Irrelevant")` |
| `Posts Actioned` | Checkbox | Yes | Boolean | Whether posts have been acted upon |
| `Top Scoring Post` | Long Text | No | Rich text | Best post for engagement context |

### **Messaging & Follow-Up**
| Field Name | Type | Editable | Format | Description |
|------------|------|----------|--------|-------------|
| `Notes` | Long Text | Yes | Rich text | Manual + auto-captured conversations |
| `Follow-Up Date` | Date | Yes | Local timezone | Next contact scheduling |

### **Status Tracking**
| Field Name | Type | Options | Description |
|------------|------|---------|-------------|
| `Source` | Single Select | "SalesNav + LH Scrape", "Manually selected from my ASH Followers", "2nd level leads from PB", "Follow-Up Personally", "Existing Connection Added by PB", "SalesNav + LH Scrape" | Lead origin tracking |
| `Status` | Single Select | "On The Radar", "In Process", "Archive", "Not Interested" | Lead processing status |
| `Priority` | Single Select | "One", "Two", "Three" | Priority ranking (1=highest) |
| `LinkedIn Connection Status` | Single Select | "Connected", "Invitation Sent", "Withdrawn", "To Be Sent", "Candidate", "Ignore", "Queued Connection Request" | Connection workflow tracking |

## New Fields for LinkedIn Messaging Extension

### **Message History**
| Field Name | Type | Editable | Description |
|------------|------|----------|-------------|
| `LinkedIn Messages` | Long Text (JSON) | No | JSON array of message history |
| `Last Message Date` | Date | No | System-updated timestamp |
| `Extension Last Sync` | DateTime | No | Chrome extension sync tracking |

### **JSON Structure for LinkedIn Messages**
```javascript
{
  "messages": [
    {
      "date": "2025-01-15T10:30:00Z",
      "content": "Hi John, I saw your post about AI automation...",
      "direction": "sent", // sent/received
      "platform": "linkedin", // linkedin/sales_navigator
      "message_id": "unique_linkedin_id",
      "thread_id": "conversation_thread_id"
    }
  ],
  "last_updated": "2025-01-15T10:30:00Z",
  "total_messages": 1
}
```

## Owner-Specific Fields (Hidden from Client Interfaces)

### **Guy-Specific Functionality**
| Field Name | Type | Editable | Visibility | Description |
|------------|------|----------|------------|-------------|
| `ASH Workshop Email` | Checkbox | Yes | Owner-only | Workshop invitation tracking |

## Existing Fields (Reference Only)

### **Profile Data**
| Field Name | Type | Source | Description |
|------------|------|--------|-------------|
| `Headline` | Text | LinkedIn | Professional summary |
| `Job Title` | Text | LinkedIn | Current position |
| `Company Name` | Text | LinkedIn | Current employer |
| `About` | Long Text | LinkedIn | LinkedIn About section |
| `Job History` | Long Text | LinkedIn | Employment history |
| `Date Connected` | Date | LinkedIn | Connection timestamp |
| `Scoring Status` | Single Select | System | "To Be Scored/Scored/Excluded" |
| `Profile Full JSON` | Long Text | System | Complete LinkedIn profile data |
| `Posts Content` | Long Text (JSON) | PhantomBuster | LinkedIn posts array |
| `Top Scoring Post` | Text | AI System | Best post analysis |

## Field Visibility Configuration

### **Web Portal Display Logic**
```javascript
const fieldVisibility = {
  // Editable fields
  "LinkedIn Profile URL": { visible: true, editable: true },
  "First Name": { visible: true, editable: true },
  "Last Name": { visible: true, editable: true },
  "View In Sales Navigator": { visible: true, editable: true },
  "Email": { visible: true, editable: true },
  "Phone": { visible: true, editable: true },
  "ASH Workshop Email": { visible: true, editable: true },
  "Notes": { visible: true, editable: true },
  "Follow-Up Date": { visible: true, editable: true },
  
  // Read-only fields
  "Profile Key": { visible: true, editable: false },
  "AI Score": { visible: true, editable: false },
  "Posts Relevance Percentage": { visible: true, editable: false },
  "Top Scoring Post": { visible: true, editable: false },
  "Last Message Date": { visible: true, editable: false },
  
  // Post scoring fields (level 2 service only)
  "Posts Actioned": { visible: true, editable: true, serviceLevel: 2 },
};
```

## Chrome Extension Field Interactions

### **Primary Fields Used**
- `LinkedIn Profile URL` - Lead identification
- `Notes` - Conversation capture
- `Follow-Up Date` - Follow-up scheduling
- `LinkedIn Messages` - Message history (JSON)
- `Last Message Date` - Timeline tracking
- `Extension Last Sync` - Sync status

### **Read-Only Reference Fields**
- `Profile Key` - Unique identification
- `First Name` / `Last Name` - Display purposes
- `AI Score` - Lead prioritization context

## Notes Field Integration Strategy

Based on our documented conversation capture strategy:

### **Content Structure**
```
📝 Manual Notes

2025-01-15
[Manual note content]

---

🔄 LinkedIn Conversations

2025-01-14
[Frank Heibel] Hi there, thanks for connecting...
[You] Thanks Frank! I saw your recent post about...
```

### **Timestamp-Based Deduplication**
- Extract timestamps from captured conversations
- Compare against existing Notes content
- Only append new conversation content
- Maintain chronological order with section headers

This master list serves as the single source of truth for all Airtable field names, types, and configurations across the LinkedIn Messaging Follow-Up system.

## Verification Complete
This master list is the single source of truth for all field names, types, and configurations across the LinkedIn Follow-Up system. All other documentation references this file for consistency.

## "Scoring Attributes" Table Fields

### **Table Information**
- **Table Name:** `Scoring Attributes`
- **Base ID:** `appXySOLo6V9PfMfa`
- **Total Records:** 23
- **Purpose:** AI scoring rubric definitions and configuration

### **Primary Fields**
| Field Name | Type | Editable | Required | Description |
|------------|------|----------|----------|-------------|
| `Attribute Id` | Text | No | Yes | Unique identifier (A, B, C, STEP-A, N1, etc.) |
| `Category` | Single Select | Yes | Yes | Attribute grouping (Positive, Negative, Step, Global Rule, Meta) |
| `Heading` | Text | Yes | Yes | Human-readable attribute name |
| `Instructions` | Long Text | Yes | Yes | Detailed scoring guidelines and rubric content |

### **Scoring Configuration**
| Field Name | Type | Editable | Required | Range | Description |
|------------|------|----------|----------|-------|-------------|
| `Max Points` | Number | Yes | For Positive only | 3-20 | Maximum points awardable |
| `Min To Qualify` | Number | Yes | Optional | 0+ | Minimum threshold for qualification |
| `Penalty` | Number | Yes | For Negative only | 5-10 | Points deducted when triggered |
| `Disqualifying` | Checkbox | Yes | Optional | Boolean | Causes immediate disqualification |

### **Supporting Data**
| Field Name | Type | Editable | Required | Description |
|------------|------|----------|----------|-------------|
| `Signals` | Long Text | Yes | Optional | Keywords/phrases that trigger this attribute |
| `Examples` | Long Text | Yes | Optional | Detailed examples with sample scores |
| `Last Updated` | DateTime | No | Yes | Auto-managed audit trail |

### **Category Distribution**
| Category | Count | Purpose |
|----------|-------|---------|
| **Positive** | 11 | Award points for desirable traits |
| **Negative** | 6 | Deduct points for undesirable traits |
| **Step** | 4 | Process/workflow instructions |
| **Global Rule** | 1 | Final score computation |
| **Meta** | 1 | System narrative/purpose |

### **AI Editing Target Fields**
Primary fields for natural language editing:
- `Heading` - Attribute display names
- `Instructions` - Core rubric content (most important)
- `Max Points` - Scoring ranges and limits
- `Min To Qualify` - Threshold requirements
- `Penalty` - Deduction amounts
- `Signals` - Trigger keyword lists
- `Examples` - Sample scenarios and cases

### **Field Constraints**
- **Immutable:** `Attribute Id` (primary key)
- **System Managed:** `Last Updated`
- **Category-Dependent:** `Max Points` (Positive only), `Penalty` (Negative only)
- **High Impact:** `Disqualifying` (affects scoring logic)

### **API Implementation Notes**
- **Primary Key:** `Attribute Id`
- **Record IDs:** Available for direct updates (rec1dyLYXREwmsP9a format)
- **Multi-tenant:** Compatible with existing ?client= parameter system
- **Validation:** Number fields need min/max constraints
- **Structure:** Flat table, no relationships

*Scoring Attributes data exported: 2025-07-13*

## "Post Scoring Attributes" Table Fields

### **Table Information**
- **Table Name:** `Post Scoring Attributes`
- **Base ID:** `appXySOLo6V9PfMfa`
- **Total Records:** 5
- **Purpose:** AI scoring rubric definitions for LinkedIn post content analysis

### **Primary Fields**
| Field Name | Type | Editable | Required | Usage in Backend | Description |
|------------|------|----------|----------|------------------|-------------|
| `Attribute ID` | Text | No | Yes | Primary key for `attributesById` object mapping | Unique identifier (POST_AI_SENTIMENT, POST_AI_INSIGHTFULNESS, etc.) - Used as key in scoring logic |
| `Category` | Text | Yes | Yes | Separates positive vs negative attributes in prompt building | Scoring factor type ("Positive Scoring Factor", "Negative Scoring Factor") - Controls rubric sections |
| `Criterion Name` | Text | Yes | Yes | `criterionName` property in attribute objects, displayed in AI prompt | Human-readable attribute name shown in scoring rubric for AI |
| `Detailed Instructions for AI (Scoring Rubric)` | Long Text | Yes | Yes | `detailedInstructions` - Core content fed to Gemini for scoring logic | Complete scoring guidelines with Low/Medium/High point ranges - Primary field that teaches AI how to score |

### **Scoring Configuration**
| Field Name | Type | Editable | Required | Range | Usage in Backend | Description |
|------------|------|----------|----------|-------|------------------|-------------|
| `Max Score / Point Value` | Number | Yes | Yes | Positive/Negative values | `maxScorePointValue` - Used in prompt to show AI max points available | Points awarded (e.g., 20) or penalty (e.g., -20) - Defines scoring scale limits |
| `Scoring Type` | Text | Yes | Yes | "Scale" or "Fixed Penalty" | `scoringType` - Informs AI whether to use graduated scoring or binary penalty | Determines scoring methodology - "Scale" for 0-20 range, "Fixed Penalty" for binary application |

### **Example Data & Keywords**
| Field Name | Type | Editable | Required | Usage in Backend | Description |
|------------|------|----------|----------|------------------|-------------|
| `Example - High Score / Applies` | Long Text | Yes | Optional | `exampleHigh` - Training examples shown to AI in prompt | Sample posts that demonstrate high scoring criteria - Guides AI consistency |
| `Example - Low Score / Does Not Apply` | Long Text | Yes | Optional | `exampleLow` - Training examples shown to AI in prompt | Sample posts that demonstrate low scoring or non-applicable criteria - Guides AI consistency |
| `Keywords/Positive Indicators` | Long Text | Yes | Optional | `positiveKeywords` - Displayed in AI prompt as pattern matching guidance | Keywords/phrases that indicate high scores for this attribute - Helps AI identify relevant content |
| `Keywords/Negative Indicators` | Long Text | Yes | Optional | `negativeKeywords` - Displayed in AI prompt as pattern matching guidance | Keywords/phrases that indicate low scores or penalties - Helps AI identify problematic content |

### **Sample Attributes**
| Attribute ID | Category | Criterion Name | Max Score | Scoring Type |
|-------------|----------|----------------|-----------|--------------|
| `POST_AI_SENTIMENT` | Positive Scoring Factor | Positive Sentiment Towards AI | 20 | Scale |
| `POST_AI_INSIGHTFULNESS` | Positive Scoring Factor | Demonstrates Open-Mindedness/Insightful Discussion about AI | 20 | Scale |
| `POST_PROMOTIONAL_PENALTY` | Negative Scoring Factor | Primarily Self-Promotional Content (Penalty) | -20 | Fixed Penalty |

### **Backend Integration & AI Usage Flow**

#### **1. Data Loading (postAttributeLoader.js)**
- All fields loaded into `attributesById` object with `Attribute ID` as key
- Field mapping: `Criterion Name` → `criterionName`, `Category` → `Category`, etc.
- Used by: `postPromptBuilder.js` and scoring pipeline

#### **2. AI Prompt Building (postPromptBuilder.js)**
The system dynamically builds Gemini prompts using these fields:
- **`Category`**: Separates attributes into "Positive Scoring Attributes" and "Negative Scoring Attributes (Penalties)" sections
- **`Attribute ID`**: Used as section headers (e.g., "### Attribute ID: POST_AI_SENTIMENT")
- **`Criterion Name`**: Displayed as human-readable attribute name for AI
- **`Scoring Type`**: Shows AI whether to use scale or binary penalty
- **`Max Score / Point Value`**: Tells AI the point range (e.g., 0-20 for positive, -20 for penalties)
- **`Detailed Instructions for AI (Scoring Rubric)`**: **CORE FIELD** - Complete scoring instructions with Low/Medium/High breakdowns
- **`Keywords/Positive Indicators`**: Pattern matching guidance for high scores
- **`Keywords/Negative Indicators`**: Pattern matching guidance for low scores/penalties  
- **`Example - High Score / Applies`**: Training examples for high scoring posts
- **`Example - Low Score / Does Not Apply`**: Training examples for low scoring posts

#### **3. AI Scoring Process (postGeminiScorer.js)**
- Gemini receives the built prompt with all field data
- Returns JSON array with `post_url`, `post_score`, and `scoring_rationale`
- Score range typically 0-100 (sum of all positive attributes minus penalties)

#### **4. Results Processing (postAnalysisService.js)**
- Finds highest scoring post from AI response array
- Updates Airtable lead record with final score and top scoring post details
- Stores full AI response for debugging and analysis

#### **5. Field Impact on User Experience**
- **`Detailed Instructions for AI (Scoring Rubric)`**: Primary field that determines scoring accuracy - most important for editing
- **`Max Score / Point Value`**: Directly affects final lead scores - changes impact lead ranking
- **`Keywords/Positive Indicators` & `Keywords/Negative Indicators`**: Guide AI pattern recognition - improve scoring consistency
- **`Example - High Score / Applies` & `Example - Low Score / Does Not Apply`**: Training data for AI - improve scoring accuracy over time
- **`Criterion Name`**: User-facing field in UI - should be clear and descriptive
- **`Scoring Type`**: Affects how AI applies scoring logic - "Scale" for nuanced scoring, "Fixed Penalty" for binary decisions

### **AI Editing Target Fields**
Primary fields for natural language editing with impact levels:

#### **Critical Impact Fields (Changes Affect All Future Scoring)**
- **`Detailed Instructions for AI (Scoring Rubric)`** - **HIGHEST IMPACT** - Core scoring logic, affects how AI evaluates all posts
- **`Max Score / Point Value`** - **HIGH IMPACT** - Changes point values, directly affects lead ranking and final scores

#### **Moderate Impact Fields (Improve Scoring Accuracy)**  
- **`Keywords/Positive Indicators`** - Helps AI identify high-scoring content patterns
- **`Keywords/Negative Indicators`** - Helps AI identify problematic content patterns
- **`Example - High Score / Applies`** - Training data for AI consistency
- **`Example - Low Score / Does Not Apply`** - Training data for AI consistency

#### **Low Impact Fields (UI and Organization)**
- **`Criterion Name`** - User-facing display name, doesn't affect AI scoring logic
- **`Scoring Type`** - Rarely changed, affects AI methodology (Scale vs Fixed Penalty)

#### **Field Editing Guidelines**
- **When editing `Detailed Instructions for AI (Scoring Rubric)`**: Be specific about point ranges (Low: 0-5, Medium: 6-14, High: 15-20), provide clear criteria, include edge cases
- **When editing `Max Score / Point Value`**: Consider impact on overall lead scoring balance, positive attributes typically 5-20 points, penalties typically -5 to -20
- **When editing Keywords**: Use comma-separated phrases, include variations and plurals, focus on content indicators not just word matching
- **When editing Examples**: Use real LinkedIn post examples, show clear contrast between high/low scoring content, include rationale

### **Field Constraints**
- **Immutable:** `Attribute ID` (primary key)
- **Scoring Logic:** Positive factors use 0-20 scale, Negative factors use penalty values
- **Content Focus:** Specifically designed for LinkedIn post content analysis
- **AI Training:** Examples and keywords guide AI scoring consistency

### **API Implementation Notes**
- **Primary Key:** `Attribute ID`
- **Table Focus:** LinkedIn post content scoring (vs. profile scoring)
- **Multi-tenant:** Compatible with existing ?client= parameter system
- **Integration:** Works with postAttributeLoader.js and post scoring pipeline
- **Structure:** Flat table, no relationships

*Post Scoring Attributes data extracted: 2025-07-25*
