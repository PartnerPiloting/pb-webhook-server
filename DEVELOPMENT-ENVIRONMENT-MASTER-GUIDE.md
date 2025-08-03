# DEVELOPMENT ENVIRONMENT MASTER GUIDE
## Complete Reference for Multi-Environment Development Workflow

**Last Updated**: August 3, 2025  
**Project**: pb-webhook-server (Node.js + Next.js)  
**Deployment**: Render (backend) + Vercel (frontend)  
**Database**: Airtable (multi-environment bases)  

---

## 🎯 QUICK REFERENCE - SAY THESE PHRASES

### **Environment Switching (Zero Manual Work)**
- `"Switch to development mode"` → Safe testing with dev database
- `"Switch to staging mode"` → Major features with staging database  
- `"Switch to production mode"` → Live data (careful!)
- `"Switch to hotfix mode"` → Emergency fixes with production data

### **Server Management**
- `"Start the front and back end for my full stack development"` → Both servers running
- `"Restart my development environment"` → After computer restart
- `"Can you restart my local dev environment?"` → Alternative phrasing

### **Deployment & Git Management**
- `"Prepare staging for deployment"` → Merge hotfixes, set up testing
- `"Deploy to production"` → After testing passes
- `"Show me what hotfixes you found"` → Review before applying

---

## 🏗️ COMPLETE ENVIRONMENT ARCHITECTURE

### **Environment Structure**
```
🔴 PRODUCTION   → main branch → Live client data (appXySOLo6V9PfMfa)
🟡 STAGING      → staging branch → Major features (appSTG123example456)
🟢 DEVELOPMENT  → development branch → Daily dev work (appDEV123example456)
🔥 HOTFIX       → hotfix/* branches → Emergency fixes (appXySOLo6V9PfMfa)
```

### **Detailed Environment Modes**

#### **🟢 DEVELOPMENT MODE**
**Purpose**: Daily coding and experimentation
- **Safety Level**: 🟢 **SAFE** - Break things freely
- **Data**: Test/fake data only
- **Database**: `appDEV123example456` (development Airtable base)
- **Branch**: `development` branch
- **Chrome Profile**: Development (green theme)

**When to Use:**
- Monday morning coding sessions
- Building new features from scratch
- Bug fixing and testing solutions
- Experimenting with new libraries/approaches
- Learning and trying "what if" scenarios

**Example Workflow:**
```
🟢 Development Session:
1. "Switch to development mode"
2. Build new lead scoring algorithm
3. Create test leads in dev database
4. Break things, fix them, iterate quickly
5. Test with fake data - no risk to real clients
6. Commit frequently to development branch
```

**Real-World Example:**
*You want to add a new scoring feature that analyzes LinkedIn profiles. You switch to development mode, create fake LinkedIn profiles in your dev database, code the feature, test it thoroughly, and iterate until it works perfectly.*

#### **🟡 STAGING MODE**
**Purpose**: Final testing before production deployment
- **Safety Level**: 🟡 **CAUTION** - Near-production testing
- **Data**: Production-like data (safe copy)
- **Database**: `appSTG123example456` (staging Airtable base)
- **Branch**: `staging` branch
- **Chrome Profile**: Staging (yellow theme)

**When to Use:**
- Feature is complete and ready for final testing
- Integration testing with multiple features
- Client preview and approval sessions
- Pre-deployment validation
- Testing with realistic data volumes

**Example Workflow:**
```
🟡 Staging Session:
1. "Switch to staging mode"
2. Test completed lead scoring algorithm
3. Use production-like data for realistic testing
4. Full integration testing with other features
5. Client review: "Here's the next release"
6. Final approval before production deployment
```

**Real-World Example:**
*Your LinkedIn scoring feature is complete. You switch to staging mode, copy some real (but anonymized) LinkedIn profiles to staging database, test the complete user flow, show it to your client for approval, and verify it works with realistic data volumes.*

#### **🔴 PRODUCTION MODE**
**Purpose**: Live environment with real client data
- **Safety Level**: 🔴 **DANGEROUS** - Real users affected
- **Data**: Live client data
- **Database**: `appXySOLo6V9PfMfa` (production Airtable base)
- **Branch**: `main` branch
- **Chrome Profile**: Production (red theme)

**When to Use:**
- Monitoring live system performance
- Investigating production issues
- Testing hotfixes against real data (very carefully)
- Production maintenance and monitoring

**Example Workflow:**
```
🔴 Production Monitoring:
1. "Switch to production mode"
2. Monitor live lead scoring performance
3. Check real client data quality
4. Investigate any production issues
5. ⚠️ EXTREME CAUTION - every action affects real users
```

**Real-World Example:**
*Your client reports that lead scores seem off. You switch to production mode, carefully examine real lead data, identify the issue, but DO NOT fix it in production mode. Instead, you reproduce the issue in development mode and create a proper fix.*

#### **🔥 HOTFIX MODE**
**Purpose**: Emergency fixes with production data for testing
- **Safety Level**: 🔥 **EXTREME CAUTION** - Live data, urgent fixes
- **Data**: Production data (same as live!)
- **Database**: `appXySOLo6V9PfMfa` (production database)
- **Branch**: `hotfix/*` branches
- **Chrome Profile**: Hotfix (red/orange warning theme)

**When to Use:**
- Production is broken and needs immediate fix
- Emergency patches that can't wait for normal deployment
- Critical bug fixes affecting live users
- Time-sensitive security patches

**Example Workflow:**
```
🔥 Emergency Hotfix:
1. "Switch to hotfix mode"
2. Create hotfix branch from main
3. Make minimal, targeted fix
4. Test against real production data (carefully!)
5. Deploy immediately to fix live issue
6. Later: merge hotfix into staging for future releases
```

**Real-World Example:**
*At 2 PM on Friday, your lead scoring system crashes and your client can't process new leads. You switch to hotfix mode, quickly identify it's a timeout issue, apply a minimal fix, test it against real data (being extremely careful), deploy the fix, and restore service within 30 minutes.*

### **Environment Comparison Table**

| Aspect | Development 🟢 | Staging 🟡 | Production 🔴 | Hotfix 🔥 |
|--------|---------------|-------------|---------------|-----------|
| **Purpose** | Build features | Test completed features | Live system | Emergency fixes |
| **Data Quality** | Fake/test data | Production-like | Real client data | Real client data |
| **Stability** | Unstable, changing | Stable, release candidate | Stable, live | Broken, needs fixing |
| **Risk Level** | Zero risk | Low risk | High risk | Extreme risk |
| **Changes** | Frequent, experimental | Infrequent, deliberate | Monitoring only | Minimal, urgent |
| **Client Access** | Never | Sometimes (preview) | Always | Emergency only |
| **Testing Type** | Unit/feature testing | Integration testing | Performance monitoring | Fix validation |

### **Real-World Scenarios**

#### **Scenario 1: New Feature Development**
```
Week 1: 🟢 Development → Build LinkedIn integration
Week 2: 🟢 Development → Add scoring algorithms  
Week 3: 🟡 Staging → Integration testing
Week 4: 🟡 Staging → Client review and approval
Week 5: 🔴 Production → Deploy to live system
```

#### **Scenario 2: Emergency Response**
```
Friday 2 PM: 🔴 Production → System crash detected
Friday 2:05 PM: 🔥 Hotfix → Emergency fix mode activated
Friday 2:30 PM: 🔴 Production → Service restored
Monday: 🟡 Staging → Proper fix integration
Tuesday: 🔴 Production → Full solution deployed
```

#### **Scenario 3: Bug Investigation**
```
Client reports issue: 🔴 Production → Investigate real data
Reproduce bug: 🟢 Development → Safe testing environment
Create fix: 🟢 Development → Code and test solution
Validate fix: 🟡 Staging → Final testing
Deploy fix: 🔴 Production → Live deployment
```

### **Chrome Profile Strategy**
```
🔴 Production Profile (Red Theme)
   ├── Live Frontend: https://pb-webhook-server.vercel.app
   ├── Live Backend: https://pb-webhook-server.onrender.com
   ├── Live Database: https://airtable.com/appXySOLo6V9PfMfa
   └── Dashboards: Render + Vercel production

🟡 Staging Profile (Yellow Theme)  
   ├── Staging Frontend: https://pb-webhook-server-git-staging.vercel.app
   ├── Staging Backend: https://pb-webhook-server-staging.onrender.com
   ├── Staging Database: https://airtable.com/appSTG123example456
   └── Pre-production testing

🟢 Development Profile (Green Theme)
   ├── Local Frontend: http://localhost:3001
   ├── Local Backend: http://localhost:3000
   ├── Dev Database: https://airtable.com/appDEV123example456
   └── Safe experimentation

🔥 Hotfix Profile (Red/Orange Theme)
   ├── Local Frontend: http://localhost:3001
   ├── Local Backend: http://localhost:3000  
   ├── PRODUCTION Database: https://airtable.com/appXySOLo6V9PfMfa
   └── ⚠️ EXTREME CAUTION - Live data!
```

---

## 🔧 TECHNICAL IMPLEMENTATION

### **Environment Files Structure**
```
📁 pb-webhook-server/
├── .env                    ← Active file (what app uses)
├── .env.minimal           ← Setup template & instructions
├── .env.development       ← Development database settings
├── .env.staging          ← Staging database settings  
├── .env.production       ← Production database settings
├── .env.hotfix           ← Hotfix settings (same as production)
└── .env.example          ← Public template (no secrets)
```

### **Key Environment Variables**
```bash
# Core Application
NODE_ENV=development|staging|production
PORT=3000

# Database (Changes per environment)
AIRTABLE_API_KEY=pat-REDACTED-TOKEN-ID...          # Same for all
AIRTABLE_BASE_ID=app[ENVIRONMENT]              # Different per env
MASTER_CLIENTS_BASE_ID=appJ9XAZeJeK5x55r       # Shared

# Frontend Integration
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000  # Dev/hotfix
NEXT_PUBLIC_API_BASE_URL=https://pb-webhook-server-staging.onrender.com  # Staging
NEXT_PUBLIC_API_BASE_URL=https://pb-webhook-server.onrender.com  # Production
```

### **Directory Structure**
```
📁 Desktop/
├── pb-webhook-server/              ← Backend (Node.js/Express)
│   ├── index.js                   ← Main server file
│   ├── .env                      ← Active environment
│   ├── .env.*                    ← Environment templates
│   └── package.json              ← "dev": "nodemon index.js"
└── linkedin-messaging-followup-next/ ← Frontend (Next.js)
    ├── .env.local                ← Frontend environment
    └── package.json              ← "dev": "next dev"
```

---

## 🚀 COMPLETE WORKFLOW EXAMPLES

### **Daily Development Workflow**
1. **Start Day**: `"Switch to development mode"`
   - AI copies `.env.development` → `.env`
   - Starts localhost:3000 (backend) + localhost:3001 (frontend)
   - Reminds to use Development Chrome profile (green)
   - Connected to dev database (safe to break)

2. **Make Changes**: Edit code, auto-restart via nodemon
3. **Test Locally**: localhost:3001 → localhost:3000 → dev database
4. **Commit & Push**: `git push origin development`

### **Major Feature Deployment Workflow**
1. **Prepare**: `"Prepare staging for deployment"`
   - AI discovers hotfixes in production
   - Merges hotfixes into staging
   - Sets up test environment with staging + hotfixes
   - Provides testing checklist

2. **Test Combined**: Test new features + hotfixes work together
3. **Deploy**: `"Deploy to production"`
   - AI merges staging → main
   - Both new features and hotfixes go live

### **Emergency Hotfix Workflow**
1. **Emergency**: `"Switch to hotfix mode"`
   - AI creates hotfix branch from main
   - Connects to production database (live data!)
   - Reminds to use Hotfix Chrome profile (red warnings)

2. **Fix & Test**: Minimal changes, test against real data
3. **Deploy**: Push hotfix branch → auto-deploys to production
4. **Return**: `"Switch back to development mode"`

---

## 📋 IMPLEMENTATION TODO LIST

### **Phase 1: Basic Environment Setup** ✅ DONE
- [x] Created `.env.minimal` template
- [x] Updated with current production values
- [x] Configured localhost development
- [x] Both frontend and backend running locally

### **Phase 2: Multi-Environment Files** 🔄 NEXT
- [ ] Create `.env.development` (dev database)
- [ ] Create `.env.staging` (staging database)  
- [ ] Create `.env.production` (live database)
- [ ] Create `.env.hotfix` (production database copy)
- [ ] Test environment switching commands

### **Phase 3: Database Environment Setup** 🔄 NEXT
- [ ] Create development Airtable base (duplicate production)
- [ ] Create staging Airtable base (duplicate production)
- [ ] Set up test data in development base
- [ ] Configure database access for each environment

### **Phase 4: Chrome Profile Setup** 🔄 PENDING
- [ ] Create Production Chrome profile (red theme)
- [ ] Create Staging Chrome profile (yellow theme)
- [ ] Create Development Chrome profile (green theme)  
- [ ] Create Hotfix Chrome profile (red/orange theme)
- [ ] Generate bookmark export files for each profile

### **Phase 5: Git Branch Setup** 🔄 PENDING
- [ ] Create `development` branch
- [ ] Create `staging` branch
- [ ] Set up branch protection rules
- [ ] Configure auto-deployment triggers

### **Phase 6: Deployment Pipeline** 🔄 PENDING
- [ ] Configure Render staging environment
- [ ] Configure Vercel preview deployments
- [ ] Set up automatic branch deployments
- [ ] Test complete deployment workflow

---

## 🔍 ENDPOINT EXAMPLES

### **Development Environment (localhost:3000)**
```
🟢 SAFE TESTING ENDPOINTS:
├── Basic Test: http://localhost:3000/basic-test
├── Environment Status: http://localhost:3000/api/environment/status
├── JSON Test: http://localhost:3000/api/test/minimal-json
├── Lead Creation: http://localhost:3000/api/leads/create
└── Frontend: http://localhost:3001

Environment Response Example:
{
  "environment": "development",
  "chromeProfile": "Development", 
  "visualIndicator": "🟢 DEVELOPMENT",
  "safetyLevel": "SAFE",
  "instructions": {
    "currentLocation": "localhost:3000",
    "recommendedProfile": "Development",
    "nextSteps": ["Safe to experiment", "Changes won't affect live users"]
  }
}
```

### **Production Environment (pb-webhook-server.onrender.com)**
```
🔴 LIVE PRODUCTION ENDPOINTS:
├── Live Status: https://pb-webhook-server.onrender.com/api/environment/status
├── Live Health: https://pb-webhook-server.onrender.com/basic-test
├── Live API: https://pb-webhook-server.onrender.com/api/*
└── Live Frontend: https://pb-webhook-server.vercel.app

Environment Response Example:
{
  "environment": "production",
  "chromeProfile": "Production",
  "visualIndicator": "🔴 PRODUCTION", 
  "safetyLevel": "DANGEROUS",
  "instructions": {
    "currentLocation": "pb-webhook-server.onrender.com",
    "recommendedProfile": "Production",
    "warning": "⚠️ LIVE DATA - Real users affected!"
  }
}
```

---

## 🛡️ SAFETY FEATURES

### **Automatic Protections**
- **Environment Detection**: AI always confirms which database you're using
- **Chrome Profile Reminders**: Visual safety through browser profiles
- **Hotfix Discovery**: AI finds and lists all production hotfixes before deployment
- **Conflict Resolution**: AI helps resolve merge conflicts between environments
- **Test Requirements**: AI requires testing before production deployment

### **Visual Safety Indicators**
- **Green**: Development (safe to experiment)
- **Yellow**: Staging (final testing)  
- **Red**: Production (live users affected)
- **Red/Orange**: Hotfix (extreme caution with live data)

### **Command Safety**
- All destructive operations require confirmation
- AI explains what it found before making changes
- Clear testing checklists before deployment
- Automatic backup of current state before switches

---

## 💬 CONVERSATION EXAMPLES

### **After Computer Restart**
**You**: `"Start the front and back end for my full stack development"`
**AI**: 
```
✅ Starting full-stack development environment...
🔄 Backend: Starting localhost:3000 (npm run dev)
🔄 Frontend: Starting localhost:3001 (npm run dev) 
✅ Servers ready!
🌐 Use Development Chrome profile (🟢 green theme)
📍 Frontend: http://localhost:3001
📍 Backend: http://localhost:3000
```

### **Environment Switching**
**You**: `"Switch to staging mode"`
**AI**:
```
🔄 Switching to STAGING environment...
📁 Copying .env.staging → .env
🗄️ Database: appSTG123example456 (staging data)
🔄 Restarting servers...
✅ Staging mode active!
🌐 Use Staging Chrome profile (🟡 yellow theme)
⚠️ This affects pre-production data
```

### **Pre-Deployment**
**You**: `"Prepare staging for deployment"`
**AI**:
```
🔍 Analyzing branches...
📊 Staging has: New scoring algorithm, Dashboard improvements
🚨 Found 2 hotfixes in production missing from staging:
   • API timeout fix (Wednesday)
   • Database patch (Thursday)
🔄 Applying hotfixes to staging...
✅ Ready for testing!
📋 Test: New features + hotfixes work together
💡 Say "Deploy to production" when satisfied
```

---

## 🎯 HOW TO USE THIS DOCUMENT

### **In Future Conversations, Say:**
`"Look at DEVELOPMENT-ENVIRONMENT-MASTER-GUIDE.md and give me a high-level explanation of my development environment"`

### **For Specific Sections:**
- `"Explain my Chrome profile strategy from the master guide"`
- `"Show me the environment switching commands from the guide"`
- `"What's my deployment workflow according to the master guide"`
- `"Give me the endpoint examples from the guide"`

### **For Implementation:**
- `"What's next on my TODO list from the master guide"`
- `"Help me implement Phase 2 from the master guide"`
- `"Set up the Chrome profiles according to the master guide"`

---

**This document is your complete reference. Point me to it anytime, and I'll give you exactly the explanation or help you need!** 🚀✨
