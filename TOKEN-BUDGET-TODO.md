# Token Budget System Implementation TODO

## ✅ Phase 1: Testing Implementation (COMPLETED)
- [x] Hardcoded 15K token limit for testing
- [x] Token counting function (`calculateAttributeTokens()`)
- [x] Current usage calculation (`getCurrentTokenUsage()`)
- [x] Budget validation before save (`validateTokenBudget()`)
- [x] API endpoints:
  - [x] `GET /api/token-usage` - Current usage status
  - [x] `POST /api/attributes/:id/validate-budget` - Check if save would exceed budget
- [x] Modified save endpoint to prevent activation when over budget

## 🚧 Phase 2: Client Master Table Integration (PENDING)

### A. Add Fields to Clients Table in Airtable
```javascript
// New fields to add to existing Clients table:
{
  "Token Budget": 5000,           // Total tokens this client can use  
  "Token Usage": 1250,            // Current token usage (real-time)
  "Budget Reset Date": "2025-01-01", // When usage resets
  "Last Token Update": "2025-01-22T10:30:00Z" // Last update timestamp
}
```

### B. Service Level Tiers Configuration
```javascript
const TOKEN_BUDGETS_BY_LEVEL = {
  1: 3000,   // Basic tier - 3,000 tokens
  2: 6000,   // Professional tier - 6,000 tokens  
  3: 12000,  // Enterprise tier - 12,000 tokens
  4: 25000   // Unlimited tier - 25,000 tokens
};
```

### C. Update Client Service
- [ ] Modify `clientService.js` to read new token fields
- [ ] Add function `getClientTokenBudget(clientId)`
- [ ] Add function `updateClientTokenUsage(clientId, newUsage)`
- [ ] Add function `resetClientTokenUsage(clientId)`

### D. Multi-Tenant Token Tracking
- [ ] Modify token functions to be client-aware
- [ ] Update `getCurrentTokenUsage(clientId)` 
- [ ] Update `validateTokenBudget(clientId, attributeId, updatedData)`
- [ ] Track usage per client in real-time

## 🎯 Phase 3: Frontend Integration (PENDING)

### A. Settings Page Token Display
```javascript
// Component to show in Settings:
"Token Usage: 1,250 / 5,000 tokens (25% used)"
"⚠️ Warning: Only 750 tokens remaining" 
"❌ Budget exceeded. Please deactivate attributes or upgrade plan."
```

### B. Real-time Budget Validation
- [ ] Call validation endpoint before showing save button
- [ ] Show token count for each attribute in library
- [ ] Preview token impact when editing attributes
- [ ] Progress bar or visual indicator of budget usage

### C. Error Handling & UX
- [ ] User-friendly error messages when budget exceeded
- [ ] Suggestions for reducing token usage
- [ ] Link to upgrade service level
- [ ] Show which attributes are using most tokens

## 🔧 Phase 4: Admin Features (PENDING)

### A. Admin Dashboard
- [ ] View all client token usage
- [ ] Manually reset client budgets
- [ ] Adjust service level limits
- [ ] Token usage analytics and reporting

### B. Automated Budget Management
- [ ] Monthly/quarterly budget resets
- [ ] Email notifications when clients approach limits
- [ ] Automatic deactivation of attributes when over budget
- [ ] Usage trend analysis and recommendations

## 📊 Phase 5: Analytics & Optimization (FUTURE)

### A. Token Usage Analytics
- [ ] Track which attributes use most tokens
- [ ] Identify clients approaching limits
- [ ] Usage patterns and optimization suggestions
- [ ] ROI analysis per token spent

### B. Smart Recommendations
- [ ] AI-powered suggestions for reducing token usage
- [ ] Automatic text optimization while preserving effectiveness
- [ ] Batch editing for similar attributes across clients

## 🧪 Testing Plan

### Current Testing (Phase 1)
1. Check token usage: `GET /api/token-usage`
2. Test budget validation: Edit attribute with lots of text and try to activate
3. Verify save prevention when over 15K tokens
4. Test deactivation reduces token count

### Full System Testing (Phase 2+)
1. Multi-client token isolation
2. Service level tier switching
3. Budget reset functionality
4. Edge cases (negative tokens, invalid data, etc.)

## 📝 Implementation Notes

### Token Calculation Method
- Current: `Math.ceil(text.length / 4)` (4 chars per token approximation)
- Future: Consider more accurate tokenization library if needed
- Only count Instructions, Examples, and Signals fields
- Only active attributes count toward budget

### Budget Enforcement Points
1. **Attribute Save** - Prevent activation if over budget
2. **Bulk Operations** - Check budget for batch activations  
3. **API Integrations** - Validate budget in all attribute modification endpoints

### Performance Considerations
- Cache token calculations to avoid repeated computation
- Batch token updates for better performance
- Async budget checking where possible

---

## 🎯 Current Status: Phase 1 Complete ✅

The testing implementation is ready! You can now:
1. See current token usage for all active attributes
2. Get budget validation before saving changes  
3. Experience budget limits in action with the 15K hardcoded limit

Next step: Test the system and gather real usage data, then move to Phase 2 for full client integration.
