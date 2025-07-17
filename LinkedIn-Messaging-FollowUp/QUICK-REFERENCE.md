# LinkedIn Follow-Up System - Quick Reference

## 🔥 Most Common Issues & Solutions

### Priority Filtering Problems
**Issue**: Leads don't disappear when priority changes  
**File**: `../linkedin-messaging-followup-next/components/LeadSearchUpdate.js`  
**Function**: `handleLeadUpdate()` (lines 137-170)  
**Solution**: Check filtering logic in `setLeads()` callback

### Search Not Working
**Issue**: Search results not updating  
**File**: `../linkedin-messaging-followup-next/components/LeadSearchUpdate.js`  
**Function**: `performSearch()` and debounced search  
**Solution**: Check race condition handling with `currentSearchRef`

### Data Not Saving
**Issue**: Lead updates not persisting  
**File**: `../linkedin-messaging-followup-next/services/api.js`  
**Backend**: `../index.js` API routes  
**Solution**: Check Airtable field mapping and API endpoints

## 🎯 Key Component Locations

### Frontend (Next.js)
```
linkedin-messaging-followup-next/
├── components/
│   ├── LeadSearchUpdate.js     # 🔥 MAIN INTERFACE
│   ├── LeadDetailForm.js       # Lead editing form
│   ├── FollowUpManager.js      # Follow-up scheduling
│   └── NewLeadForm.js          # Manual lead creation
├── services/
│   └── api.js                  # Backend API calls
└── app/
    └── page.tsx                # Main page component
```

### Backend API Endpoints
```
/api/leads/search              # Search leads with filters
/api/leads/update              # Update lead data
/api/leads/create              # Create new leads
/api/leads/delete              # Delete leads
/lh-webhook/upsertLeadOnly     # LinkedHelper webhook
/api/pb-webhook                # PhantomBuster webhook
```

## 💡 Quick Debugging Steps

### 1. UI Issues
- Check `LeadSearchUpdate.js` state management
- Verify props passed to `LeadDetailForm.js`
- Check API calls in `services/api.js`

### 2. Backend Issues
- Check `index.js` route handlers
- Verify Airtable connection in `config/airtableClient.js`
- Review service logic in `services/leadService.js`

### 3. Data Issues
- Check Airtable field names and mapping
- Verify webhook endpoints are working
- Check AI scoring in `batchScorer.js`

## 🚀 Development Workflow

### For New AI Sessions
1. **Always read** `../SYSTEM-OVERVIEW.md` first
2. **Understand** user needs plain English explanations
3. **Focus** on specific component mentioned
4. **Test** suggestions on deployed environments

### For Common Requests
- **"LinkedIn portal issue"** → `LeadSearchUpdate.js`
- **"API not working"** → `index.js` and `services/`
- **"Data sync problem"** → Airtable client and webhooks
- **"AI scoring issue"** → `batchScorer.js` and AI config

## 📋 Code Patterns

### State Management (React)
```javascript
const [leads, setLeads] = useState([]);
const [selectedLead, setSelectedLead] = useState(null);
const [priority, setPriority] = useState('all');
```

### API Calls (Frontend)
```javascript
const updated = await updateLead(leadId, updatedData);
const results = await searchLeads(query, priority);
```

### Airtable Updates (Backend)
```javascript
await base('Leads').update(leadId, {
  'Priority': newPriority,
  'Status': newStatus
});
```

## 🔧 Testing & Deployment

### Frontend (Vercel)
- Deploy automatically on git push
- Test on deployed URL
- Check browser console for errors

### Backend (Render)
- Deploy on git push to main
- Test API endpoints directly
- Check server logs for errors

---

*For complete system context, always reference `../SYSTEM-OVERVIEW.md`*
