# DEVELOPMENT ENVIRONMENT COMPLETE GUIDE
*Master Reference for Multi-Environment Development Workflow with Git Worktrees*

**Last Updated**: August 7, 2025  
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

### **Documentation Commands**
- `"Create a working doc in the temp folder for [task]"` → Temporary documentation
- `"Update the permanent documentation for [topic]"` → Permanent guide updates

### **Deployment & Git Management**
- `"Prepare staging for deployment"` → Merge hotfixes, set up testing
- `"Deploy to production"` → After testing passes
- `"Show me what hotfixes you found"` → Review before applying

---

## 🏗️ COMPLETE ARCHITECTURE OVERVIEW

### **Git Worktrees + Port-Based Environment Separation**

| Environment | Folder | Port | Branch | Chrome Profile | Database | Purpose |
|-------------|--------|------|--------|----------------|----------|---------|
| 🟢 **Development** | `pb-webhook-server-dev/` | 3000 | `dev` | Dev (Green) | Test data | Daily coding |
| 🟡 **Staging** | `pb-webhook-server-staging/` | 3001 | `staging` | Staging (Yellow) | Prod-like data | Pre-deployment testing |
| 🔥 **Hotfix** | `pb-webhook-server-hotfix/` | 3002 | `hotfix/*` | Hotfix (Orange) | **Live prod data** | Emergency fixes |
| 🔴 **Production** | `pb-webhook-server-prod/` | 3003 | `main` | Prod (Red) | **Live prod data** | Monitoring only |

### **Key Architecture Benefits**
✅ **No manual git switching** - each environment runs simultaneously  
✅ **Visual safety** - color-coded Chrome profiles prevent mistakes  
✅ **Port isolation** - all environments can run at the same time  
✅ **Branch safety** - impossible to work in wrong environment  
✅ **Instant switching** - click taskbar shortcuts to change environments  

---

## 🟢 DEVELOPMENT MODE

### **Purpose & Safety**
- **Use for**: Daily coding, feature development, experimentation
- **Safety Level**: 🟢 **COMPLETELY SAFE** - Break things freely
- **Data**: Test/fake data only
- **Database**: `appDEV123example456` (development Airtable base)
- **Port**: 3000 (default npm start)
- **Chrome Profile**: Development (green theme)

### **When to Use Development Mode**
- Monday morning coding sessions
- Building new features from scratch
- Bug fixing and testing solutions
- Experimenting with new libraries/approaches
- Learning and trying "what if" scenarios

### **Example Development Workflow**
```
🟢 Development Session:
1. "Switch to development mode"
2. cd ../pb-webhook-server-dev && npm start
3. Build new lead scoring algorithm
4. Create test leads in dev database
5. Break things, fix them, iterate quickly
6. Test with fake data - no risk to real clients
7. Commit frequently to development branch
```

### **Real-World Example**
*You want to add a new scoring feature that analyzes LinkedIn profiles. You switch to development mode, create fake LinkedIn profiles in your dev database, code the feature, test it thoroughly, and iterate until it works perfectly.*

---

## 🟡 STAGING MODE

### **Purpose & Safety**
- **Use for**: Final testing before production deployment
- **Safety Level**: 🟡 **CAUTION** - Near-production testing
- **Data**: Production-like data (safe copy)
- **Database**: `appSTG123example456` (staging Airtable base)
- **Port**: 3001 (PORT=3001 npm start)
- **Chrome Profile**: Staging (yellow theme)

### **When to Use Staging Mode**
- Feature is complete and ready for final testing
- Integration testing with multiple features
- Client preview and approval sessions
- Pre-deployment validation
- Testing with realistic data volumes

### **Example Staging Workflow**
```
🟡 Staging Session:
1. "Switch to staging mode"
2. cd ../pb-webhook-server-staging && PORT=3001 npm start
3. Test completed lead scoring algorithm
4. Use production-like data for realistic testing
5. Full integration testing with other features
6. Client review: "Here's the next release"
7. Final approval before production deployment
```

---

## 🔥 HOTFIX MODE

### **Purpose & Safety**
- **Use for**: Emergency fixes with production data for testing
- **Safety Level**: 🔥 **EXTREME CAUTION** - Live data, urgent fixes
- **Data**: **Production data (same as live!)**
- **Database**: `appXySOLo6V9PfMfa` (production database)
- **Port**: 3002 (PORT=3002 npm start)
- **Chrome Profile**: Hotfix (red/orange warning theme)

### **When to Use Hotfix Mode**
- Production is broken and needs immediate fix
- Emergency patches that can't wait for normal deployment
- Critical bug fixes affecting live users
- Time-sensitive security patches

### **Example Emergency Hotfix Workflow**
```
🔥 Emergency Hotfix:
1. "Switch to hotfix mode" 
2. cd ../pb-webhook-server-hotfix && PORT=3002 npm start
3. Create hotfix branch from main
4. Make minimal, targeted fix
5. Test against real production data (extremely carefully!)
6. Deploy immediately to fix live issue
7. Later: merge hotfix into staging for future releases
```

**⚠️ EXTREME CAUTION**: Every action affects real user data!

---

## 🔴 PRODUCTION MODE

### **Purpose & Safety**
- **Use for**: Live environment monitoring and investigation
- **Safety Level**: 🔴 **DANGEROUS** - Real users affected
- **Data**: **Live client data**
- **Database**: `appXySOLo6V9PfMfa` (production Airtable base)
- **Port**: 3003 (PORT=3003 npm start) 
- **Chrome Profile**: Production (red theme)

### **When to Use Production Mode**
- Monitoring live system performance
- Investigating production issues
- Testing hotfixes against real data (very carefully)
- Production maintenance and monitoring

### **Example Production Monitoring**
```
🔴 Production Monitoring:
1. "Switch to production mode"
2. cd ../pb-webhook-server-prod && PORT=3003 npm start
3. Monitor live lead scoring performance
4. Check real client data quality
5. Investigate any production issues
6. ⚠️ EXTREME CAUTION - every action affects real users
```

**Important**: DO NOT fix issues in production mode. Reproduce in development and create proper fixes.

---

## 🚀 COMPLETE SETUP GUIDE

### **Step 1: Create Git Worktrees**

From your main repo folder, create worktrees for each environment:

```bash
# Create separate folders for each branch
git worktree add ../pb-webhook-server-dev       dev
git worktree add ../pb-webhook-server-staging   staging  
git worktree add ../pb-webhook-server-hotfix    hotfix
git worktree add ../pb-webhook-server-prod      main
```

**Result**: Four sibling folders, each locked to its specific branch.

### **Step 2: Create Chrome Profiles**

1. **Open Chrome** → Click profile avatar → **Manage profiles** → **Add**
2. **Create 4 profiles** with these exact names:
   - `Dev` (choose green avatar/theme)
   - `Staging` (choose yellow avatar/theme) 
   - `Hotfix` (choose red/orange avatar/theme)
   - `Prod` (choose red avatar/theme)

### **Step 3: Create Desktop Shortcuts**

For each profile, create **2 shortcuts** (Local + Online):

#### **🟢 Dev Profile Shortcuts**:
**Dev - Local:**
1. In Chrome Manage profiles → hover "Dev" → three-dots → **Create shortcut** → check "Open as window"
2. Right-click desktop shortcut → **Properties** → Target field, append:
   ```
   --profile-directory="Dev" http://localhost:3000/?testClient=Test-Client&level=1
   ```
3. Rename to "**🟢 Dev - Local**" → Pin to Taskbar

**Dev - Online:**  
1. Create another shortcut with:
   ```
   --profile-directory="Dev" https://pb-webhook-server.vercel.app/?testClient=Test-Client&level=1
   ```
2. Rename to "**🟢 Dev - Online**" → Pin to Taskbar

#### **🟡 Staging Profile Shortcuts**:
**Staging - Local:**
```
--profile-directory="Staging" http://localhost:3001/?testClient=Test-Client&level=1
```
Rename: "**🟡 Staging - Local**"

**Staging - Online:**
```
--profile-directory="Staging" https://pb-webhook-server-staging.vercel.app/?testClient=Test-Client&level=1
```
Rename: "**🟡 Staging - Online**"

#### **🔥 Hotfix Profile Shortcuts**:
**Hotfix - Local:**
```
--profile-directory="Hotfix" http://localhost:3002/?testClient=Test-Client&level=1
```
Rename: "**🔥 Hotfix - Local**"

**Hotfix - Online:**
```
--profile-directory="Hotfix" https://pb-webhook-server-hotfix.vercel.app/?testClient=Test-Client&level=1
```
Rename: "**🔥 Hotfix - Online**"

#### **🔴 Prod Profile Shortcuts**:
**Prod - Local:**
```
--profile-directory="Prod" http://localhost:3003/?testClient=Test-Client&level=1
```
Rename: "**🔴 Prod - Local**"

**Prod - Online:**
```
--profile-directory="Prod" https://pb-webhook-server.vercel.app/?testClient=Test-Client&level=1
```
Rename: "**🔴 Prod - Online**"

### **Step 4: VS Code Integration**

Create workspace files in each worktree folder:

#### **pb-webhook-server-dev/.vscode/settings.json**:
```json
{
  "workbench.colorTheme": "Default Dark+",
  "workbench.colorCustomizations": {
    "statusBar.background": "#28a745",
    "statusBar.foreground": "#ffffff",
    "titleBar.activeBackground": "#28a745"
  },
  "window.title": "🟢 DEV - ${activeEditorShort}${separator}${rootName}"
}
```

#### **pb-webhook-server-staging/.vscode/settings.json**:
```json
{
  "workbench.colorTheme": "Default Dark+", 
  "workbench.colorCustomizations": {
    "statusBar.background": "#ffc107",
    "statusBar.foreground": "#000000",
    "titleBar.activeBackground": "#ffc107"
  },
  "window.title": "🟡 STAGING - ${activeEditorShort}${separator}${rootName}"
}
```

#### **pb-webhook-server-hotfix/.vscode/settings.json**:
```json
{
  "workbench.colorTheme": "Default Dark+",
  "workbench.colorCustomizations": {
    "statusBar.background": "#ff8c00", 
    "statusBar.foreground": "#ffffff",
    "titleBar.activeBackground": "#ff8c00"
  },
  "window.title": "🔥 HOTFIX - ${activeEditorShort}${separator}${rootName}"
}
```

#### **pb-webhook-server-prod/.vscode/settings.json**:
```json
{
  "workbench.colorTheme": "Default Dark+",
  "workbench.colorCustomizations": {
    "statusBar.background": "#dc3545",
    "statusBar.foreground": "#ffffff", 
    "titleBar.activeBackground": "#dc3545"
  },
  "window.title": "🔴 PROD - ${activeEditorShort}${separator}${rootName}"
}
```

---

## 🏗️ DAILY DEVELOPMENT WORKFLOW

### **Starting Your Workday**

1. **Start all local environments** (run these commands in separate terminals):
   ```bash
   # Terminal 1: Dev
   cd ../pb-webhook-server-dev
   npm start  # Runs on localhost:3000

   # Terminal 2: Staging  
   cd ../pb-webhook-server-staging
   PORT=3001 npm start

   # Terminal 3: Hotfix
   cd ../pb-webhook-server-hotfix  
   PORT=3002 npm start

   # Terminal 4: Prod
   cd ../pb-webhook-server-prod
   PORT=3003 npm start
   ```

2. **Open your work environment** by clicking the appropriate shortcuts on your taskbar

### **Development Session Types**

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

---

## 🔖 BOOKMARK STRUCTURE

### **Test-Client Alias System**

Create a "Test-Client" record in your Master Clients table that points to any real client (e.g., Guy-Wilson). All bookmarks use `?testClient=Test-Client` so you can switch which client you're testing by simply updating one Airtable record.

### **Essential Bookmarks for Each Profile**

#### **🟢 Dev Profile Bookmarks**:
```
📁 🟢 Development
├── Local App (L1) → http://localhost:3000/?testClient=Test-Client&level=1
├── Local App (L2) → http://localhost:3000/?testClient=Test-Client&level=2  
├── Backend Health → http://localhost:3000/basic-test
├── Environment Status → http://localhost:3000/api/environment/status
└── API Test → http://localhost:3000/api/test/minimal-json
```

#### **🟡 Staging Profile Bookmarks**:
```
📁 🟡 Staging
├── Staging App (L1) → https://pb-webhook-server-staging.vercel.app/?testClient=Test-Client&level=1
├── Staging App (L2) → https://pb-webhook-server-staging.vercel.app/?testClient=Test-Client&level=2
├── Backend Health → https://pb-webhook-server-staging.onrender.com/basic-test
└── Environment Status → https://pb-webhook-server-staging.onrender.com/api/environment/status
```

#### **🔥 Hotfix Profile Bookmarks**:
```
📁 🔥 Hotfix Testing
├── Local Hotfix (L1) → http://localhost:3002/?testClient=Test-Client&level=1
├── Local Hotfix (L2) → http://localhost:3002/?testClient=Test-Client&level=2
├── Deployed Hotfix (L1) → https://pb-webhook-server-hotfix.vercel.app/?testClient=Test-Client&level=1
├── Compare Prod (L1) → https://pb-webhook-server.vercel.app/?testClient=Test-Client&level=1
└── Backend Health → http://localhost:3002/basic-test
```

#### **🔴 Prod Profile Bookmarks**:
```
📁 🔴 Production Monitoring
├── Live App (L1) → https://pb-webhook-server.vercel.app/?testClient=Test-Client&level=1
├── Live App (L2) → https://pb-webhook-server.vercel.app/?testClient=Test-Client&level=2
├── Backend Health → https://pb-webhook-server.onrender.com/basic-test
├── Render Dashboard → https://dashboard.render.com/web/srv-cvqgq53e5dus73fa45ag
├── Vercel Dashboard → https://vercel.com/dashboard
├── Production Database → https://airtable.com/appXySOLo6V9PfMfa
└── Master Clients → https://airtable.com/appJ9XAZeJeK5x55r
```

---

## 📝 DOCUMENTATION WORKFLOW

### **Two-Tier Documentation System**

#### **🗂️ Temporary Documentation** (`docs/temp/` folder)
- **Purpose**: Working notes, debugging thoughts, hotfix analysis
- **Location**: `docs/temp/` in each worktree branch
- **Lifecycle**: Preserved in branch for reference, excluded from merges
- **Naming**: `HOTFIX-YYYY-MM-DD-description.md`, `debugging-session.md`, `client-analysis.md`

#### **📋 Permanent Documentation** (Root folder)
- **Purpose**: Setup guides, API docs, architecture decisions
- **Location**: Root-level `.md` files (like this guide)
- **Lifecycle**: Shared across all environments, included in merges
- **Naming**: `[PURPOSE]-[SCOPE]-GUIDE.md`, `[COMPONENT]-DOCUMENTATION.md`

### **Creating Working Documents**

**Simple Command**: *"Create a working doc in the temp folder for [your task]"*

**What Happens**:
1. ✅ Checks if `docs/temp/` exists - creates if needed
2. ✅ Creates appropriately named temp file
3. ✅ Includes template structure for immediate use

**Example Structure**:
```
pb-webhook-server-hotfix/
├── docs/
│   └── temp/
│       ├── HOTFIX-2025-08-07-guy-wilson-scoring.md
│       ├── debugging-gemini-responses.md
│       └── testing-checklist.md
├── DEVELOPMENT-ENVIRONMENT-COMPLETE-GUIDE.md  # Permanent
├── DEBUGGING-GUIDE.md                         # Permanent
└── API-DOCUMENTATION.md                       # Permanent
```

### **Documentation Workflow During Development**

#### **While Working on a Hotfix**:
1. **Create temp docs**: Document problem, debugging steps, solution
2. **Update permanent docs**: If discoveries should be preserved for future reference
3. **Both types exist in the hotfix branch**

#### **When Ready to Deploy**:
1. **Merge permanent documentation changes** → Goes to production
2. **Keep temp files in hotfix branch** → Preserved for reference
3. **Other environments sync permanent docs** when they pull from main

**Example Merge Strategy**:
```bash
# Selective merge - exclude temp files
git checkout main
git merge hotfix-branch --no-commit
git reset docs/temp/              # Exclude temp documentation
git commit -m "Merge hotfix: include permanent doc updates"
```

### **Documentation Decision Framework**

| If the documentation... | Then it's... | Goes in... |
|-------------------------|--------------|------------|
| Relates to one specific issue/fix | **Temp** | `docs/temp/` |
| Will help with future similar issues | **Permanent** | Root folder |
| Is debugging notes for right now | **Temp** | `docs/temp/` |
| Is a process others should follow | **Permanent** | Root folder |
| Will be obsolete when fix is done | **Temp** | `docs/temp/` |
| Should be referenced months from now | **Permanent** | Root folder |

---

## 🔧 TECHNICAL IMPLEMENTATION

### **Environment Files Structure**
```
📁 pb-webhook-server-*/
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
PORT=3000|3001|3002|3003

# Database (Changes per environment)
AIRTABLE_API_KEY=pat89slmRS6muX8YZ...          # Same for all
AIRTABLE_BASE_ID=app[ENVIRONMENT]              # Different per env
MASTER_CLIENTS_BASE_ID=appJ9XAZeJeK5x55r       # Shared

# API Keys (Same for all environments)
GEMINI_API_KEY=AIzaSy...
OPENAI_API_KEY=sk-...
```

### **Port Management**

Each environment runs on a dedicated port to prevent conflicts:
- **Dev**: 3000 (default npm start)
- **Staging**: 3001 (PORT=3001 npm start)  
- **Hotfix**: 3002 (PORT=3002 npm start)
- **Prod**: 3003 (PORT=3003 npm start)

### **Quick Start Script**

Create `start-all-envs.bat` to launch all environments:

```batch
@echo off
echo Starting all pb-webhook-server environments...

start "Dev" cmd /k "cd /d ..\pb-webhook-server-dev && npm start"
timeout /t 2
start "Staging" cmd /k "cd /d ..\pb-webhook-server-staging && set PORT=3001 && npm start"  
timeout /t 2
start "Hotfix" cmd /k "cd /d ..\pb-webhook-server-hotfix && set PORT=3002 && npm start"
timeout /t 2
start "Prod" cmd /k "cd /d ..\pb-webhook-server-prod && set PORT=3003 && npm start"

echo All environments starting...
pause
```

---

## 🆘 TROUBLESHOOTING & REFERENCE

### **Git Worktree Commands**

```bash
# List all worktrees
git worktree list

# Remove a worktree (if needed)
git worktree remove ../pb-webhook-server-dev

# Create new worktree from existing branch
git worktree add ../pb-webhook-server-feature feature-branch
```

### **Common Issues**

**Port Already in Use:**
```bash
# Windows: Kill process on port
netstat -ano | findstr :3000
taskkill /PID <process_id> /F
```

**Worktree Issues:**
```bash
# If worktree folder exists but git doesn't recognize it
git worktree repair

# Force remove corrupted worktree
git worktree remove --force ../pb-webhook-server-dev
```

**Chrome Profile Issues:**
- Profiles not appearing: Restart Chrome completely
- Shortcuts not working: Check profile directory names match exactly
- Bookmarks missing: Re-import or manually recreate

---

## 📋 GIT BRANCH MANAGEMENT & WORKFLOW

### **Branch Structure & Strategy**

#### **Main Branches**
- **`main`** - Production branch (what clients see) - 🔴 **LIVE DATA**
- **`dev`** - Development branch (your ongoing work) - 🟢 **SAFE DATA**
- **`staging`** - Pre-production testing - 🟡 **PROD-LIKE DATA**

#### **Temporary Branches**
- **`feature/feature-name`** - For specific features (like Load More pagination)
- **`hotfix/bug-name`** - For urgent production fixes
- **`hotfix/YYYY-MM-DD-description`** - Hotfix naming convention

### **Environment-Specific Branch Operations**

#### **Development Environment Workflow**
```bash
# Daily development work (safe experimentation)
cd ../pb-webhook-server-dev
git status                 # Always on 'dev' branch
git add .
git commit -m "Add lead scoring feature"
git push origin dev

# Create feature branch for major work
git checkout -b feature/enhanced-scoring
git push -u origin feature/enhanced-scoring
```

#### **Staging Environment Workflow**
```bash
# Prepare for deployment testing
cd ../pb-webhook-server-staging
git checkout staging
git merge dev             # Bring in completed development work
git push origin staging
npm start                 # Test on port 3001 with staging data
```

#### **Hotfix Environment Workflow**
```bash
# Emergency fix process (CAREFUL - production data!)
cd ../pb-webhook-server-hotfix
git checkout main
git pull origin main      # Get latest production state
git checkout -b hotfix/2025-08-07-auth-fix
# Make critical fix
git add .
git commit -m "Fix: Authentication timeout issue"
git push origin hotfix/2025-08-07-auth-fix
# Create PR for immediate review/merge
```

#### **Production Monitoring Workflow**
```bash
# Monitor production (READ-ONLY)
cd ../pb-webhook-server-prod
git checkout main
git pull origin main      # Get latest deployed code
npm start                 # Monitor on port 3003 (read-only)
```

### **Branch Management Best Practices**

#### **Development Branch Safety**
- ✅ **Never work directly on main** - Always use dev branch for daily work
- ✅ **Commit frequently** - Small commits with clear messages
- ✅ **Merge dev → staging** - Before deployment testing
- ✅ **Create feature branches** - For significant new features

#### **Production Branch Protection**  
- 🚨 **main branch = production** - What clients see and use
- 🚨 **Only merge through staging** - Never direct commits to main
- 🚨 **Hotfix exception only** - Emergency fixes can bypass staging
- 🚨 **Always test in staging first** - Unless it's a critical hotfix

### **Two-Environment Philosophy (Simple Version)**

Think of it like McDonald's:
- **Customers** eat from the **clean, working kitchen** (Production/Main)
- **Chefs** experiment with new recipes in a **separate test kitchen** (Development/Dev)
- **Customers never see** the failed experiments

### **Two URLs for Client Safety**
- **Production** (for your client): `https://pb-webhook-server.vercel.app` 
- **Development** (for you): `https://pb-webhook-server-dev.vercel.app`

### **Daily Workflow Pattern**

#### **When Developing New Features:**
```bash
# 1. Start in development mode
cd ../pb-webhook-server-dev
git checkout dev
npm start                 # Runs on port 3000

# 2. Build and test feature
# Code, test, iterate with safe test data

# 3. When feature is complete, merge to staging
cd ../pb-webhook-server-staging  
git checkout staging
git merge dev
npm start                 # Test on port 3001

# 4. After staging testing passes, merge to production
git checkout main
git merge staging
git push origin main      # Triggers production deployment
```

#### **When Fixing Bugs:**
```bash
# Small bugs: use development workflow above
# Emergency bugs: use hotfix workflow

# Hotfix process:
cd ../pb-webhook-server-hotfix
git checkout main
git checkout -b hotfix/urgent-fix
# Fix the bug
git push origin hotfix/urgent-fix
# Create PR and merge immediately
```

---

## ✅ COMPLETION CHECKLIST

### **Setup Tasks**
- [ ] Git worktrees created for all 4 environments
- [ ] Chrome profiles created with color themes
- [ ] Desktop shortcuts created and pinned to taskbar  
- [ ] VS Code workspace settings configured
- [ ] Test-Client record created in Master Clients
- [ ] Essential bookmarks added to each profile
- [ ] All environments tested and running on correct ports
- [ ] Documentation workflow understood (temp vs permanent)
- [ ] `docs/temp/` folder structure created (when first needed)
- [ ] Quick start batch script created (optional)

### **Validation Tests**
- [ ] Can switch between environments without manual git commands
- [ ] Each environment runs on correct port simultaneously  
- [ ] Chrome profiles visually distinct and functional
- [ ] VS Code shows correct environment in title/colors
- [ ] Test-Client alias working for dynamic client switching
- [ ] Can create temp documentation in hotfix branches
- [ ] Permanent documentation updates merge correctly

**🎉 Result**: Complete environment automation with zero manual git switching and comprehensive documentation workflow!

---

*This guide serves as the single source of truth for all development environment setup, workflow, and documentation practices.*
