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
| `Posts Relevance Score` | Number | No | System value | Raw scoring value |
| `Posts Relevance Percentage` | Formula | No | 0-100% | Calculated as `{Posts Relevance Score}/80*100` |

### **Messaging & Follow-Up**
| Field Name | Type | Editable | Format | Description |
|------------|------|----------|--------|-------------|
| `Notes` | Long Text | Yes | Rich text | Manual + auto-captured conversations |
| `Follow Up Date` | Date | Yes | Local timezone | Next contact scheduling |
| `Follow Up Notes` | Text | Yes | Plain text | Context for next interaction |

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
| `Add to Workshop Invite List` | Checkbox | Yes | Owner-only | Workshop invitation tracking |

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
  "Notes": { visible: true, editable: true },
  "Follow Up Date": { visible: true, editable: true },
  "Follow Up Notes": { visible: true, editable: true },
  
  // Read-only fields
  "Profile Key": { visible: true, editable: false },
  "AI Score": { visible: true, editable: false },
  "Posts Relevance Percentage": { visible: true, editable: false },
  "Last Message Date": { visible: true, editable: false },
  
  // Hidden fields
  "Add to Workshop Invite List": { visible: false, editable: false },
  "LinkedIn Messages": { visible: false, editable: false }, // Handled via special interface
  "Extension Last Sync": { visible: false, editable: false }
};
```

## Chrome Extension Field Interactions

### **Primary Fields Used**
- `LinkedIn Profile URL` - Lead identification
- `Notes` - Conversation capture
- `Follow Up Date` - Follow-up scheduling
- `Follow Up Notes` - Follow-up context
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
