# LinkedIn Follow-Up System - Quick Reference

## 🚀 Live System Access
- **Portal URL**: https://pb-webhook-server.vercel.app (Next.js frontend)
- **API Test**: https://pb-webhook-server.onrender.com/api/linkedin/test (Express backend)
- **Debug Info**: https://pb-webhook-server.onrender.com/api/linkedin/debug (Express backend)

## 📁 Key Files
- **Main Server**: `index.js` (contains `/portal` route, lines 255-400)
- **API Routes**: `LinkedIn-Messaging-FollowUp/backend-extensions/routes/linkedinRoutes.js`
- **Documentation**: `LinkedIn-Messaging-FollowUp/README.md`
- **Client Service**: `services/clientService.js` (multi-tenant support)
- **Airtable Config**: `config/airtableClient.js`

## 🔧 Development Commands
```bash
# Local development
npm start
# or
node index.js

# Test locally
http://localhost:3000/portal
http://localhost:3000/api/linkedin/test
```

## 🌐 API Endpoints
- `GET /api/linkedin/test` - Connection test
- `GET /api/linkedin/leads/search?q=query&client=Guy-Wilson` - Search leads
- `GET /api/linkedin/leads/:id?client=Guy-Wilson` - Get lead details
- `POST /api/linkedin/leads/:id/update?client=Guy-Wilson` - Update lead

## ⚡ Quick Fixes
1. **Portal not loading**: Check Vercel deployment at pb-webhook-server.vercel.app
2. **API errors**: Verify `?client=Guy-Wilson` parameter and Render backend
3. **Search issues**: Test API connection first (green checkmark)
4. **Frontend Deployment**: Push to main branch auto-deploys to Vercel
5. **Backend Deployment**: Push to main branch auto-deploys to Render

## ✅ Current Status (January 2025)
- ✅ Web portal fully functional
- ✅ API layer complete and tested
- ✅ Multi-tenant support working
- ✅ Deployed and live on Render
- ✅ Documentation updated
- 🚧 Chrome extension (next phase)

## 🔍 Testing
- **Portal Features**: Search, API test, responsive UI
- **Client Testing**: Use `Guy-Wilson` as test client
- **Error Handling**: All routes have proper error responses
- **Multi-tenant**: Client switching ready for production

## 📈 Next Development Phase
1. Chrome extension for LinkedIn integration
2. WordPress authentication
3. Advanced reporting features
4. Bulk operations interface
