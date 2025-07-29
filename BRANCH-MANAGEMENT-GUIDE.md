# Branch Management Guide
*Your Complete Git Workflow for Production & Development*

## Branch Structure

### Main Branches
- **`main`** - Production branch (what clients see)
- **`development`** - Development branch (your ongoing work)

### Temporary Branches
- **`feature/feature-name`** - For specific features (like Load More pagination)
- **`hotfix/bug-name`** - For urgent production fixes

## Setting Up Your Branches

### 1. Create Development Branch
```bash
# Make sure you're on main (production)
git checkout main
git pull origin main

# Create and switch to development branch
git checkout -b development
git push -u origin development
```

### 2. Set Up Environment Variables for Each Branch
- **Production (main branch)**: Uses production Airtable base, WordPress site
- **Development (development branch)**: Uses development/staging Airtable base, test WordPress

### 3. Set Up Environment Indicator Header
After creating branches, implement the portal header system to show:
- **Production**: `LinkedIn Follow-Up Portal for [Client Name]`
- **Development**: `LinkedIn Follow-Up Portal for [Client Name] (Development)`
- **Test Mode**: `LinkedIn Follow-Up Portal for [Client Name] (Test Mode)`

This prevents confusion about which environment you're working in and protects against accidental changes to the wrong client's data.

## Daily Workflow Commands

### Starting New Feature Work
```bash
# Switch to development branch
git checkout development
git pull origin development

# Create feature branch from development
git checkout -b feature/load-more-pagination
# Work on your feature...
git add .
git commit -m "Add Load More pagination functionality"
git push origin feature/load-more-pagination
```

### Merging Completed Features
```bash
# Switch back to development
git checkout development

# Merge your feature
git merge feature/load-more-pagination

# Push updated development
git push origin development

# Delete the feature branch (cleanup)
git branch -d feature/load-more-pagination
git push origin --delete feature/load-more-pagination
```

### Deploying to Production
```bash
# When development is stable and ready for clients
git checkout main
git pull origin main

# Merge development into main
git merge development

# Tag the release
git tag v1.1.0
git push origin main
git push origin v1.1.0

# Deploy main branch to production environment
```

## Emergency Hotfix Process

### 1. Create Hotfix from Production
```bash
# Start from current production state
git checkout main
git pull origin main

# Create hotfix branch
git checkout -b hotfix/auth-error-fix
```

### 2. Fix the Bug
```bash
# Make minimal changes to fix the issue
git add .
git commit -m "Hotfix: Fix authentication error handling"
git push origin hotfix/auth-error-fix
```

### 3. Deploy Hotfix to Production
```bash
# Merge hotfix to main
git checkout main
git merge hotfix/auth-error-fix
git tag v1.0.1-hotfix
git push origin main
git push origin v1.0.1-hotfix

# Deploy main branch to production
```

### 4. Update Development Branch
```bash
# Make sure development also gets the fix
git checkout development
git merge main
git push origin development

# Cleanup hotfix branch
git branch -d hotfix/auth-error-fix
git push origin --delete hotfix/auth-error-fix
```

## Branch Status Commands

### Check Current Branch
```bash
git branch
# Shows all branches, * indicates current branch
```

### See Branch Differences
```bash
# Compare development with main
git log main..development --oneline

# See what's in development but not in main
git diff main..development
```

### See Remote Branches
```bash
git branch -r
# Shows all remote branches
```

## Environment Management

### Production Environment (main branch)
- Airtable Base: Production base ID
- WordPress: australiansidehustles.com.au
- Environment: `NODE_ENV=production`
- Deployment: Vercel production deployment
- Header: `LinkedIn Follow-Up Portal for [Client Name]`

### Development Environment (development branch)
- Airtable Base: Development/staging base ID
- WordPress: staging.australiansidehustles.com.au or test instance
- Environment: `NODE_ENV=development`
- Deployment: Vercel preview deployment
- Header: `LinkedIn Follow-Up Portal for [Client Name] (Development)`

### Test Mode (any environment)
- Access via: `?testClient=ClientId` query parameter
- Bypasses WordPress authentication
- Uses any client's data for testing/demos
- Header: `LinkedIn Follow-Up Portal for [Client Name] (Test Mode)`

## Safety Rules

### ✅ Safe Operations
- Work on `development` branch for new features
- Create `feature/` branches for major work
- Test thoroughly before merging to `main`
- Always tag production releases
- Use hotfix branches for urgent fixes
- Verify header shows correct environment before making changes

### ❌ Dangerous Operations (Never Do These)
- Never push directly to `main` (except hotfixes)
- Never delete `main` or `development` branches
- Never force push to shared branches
- Never merge untested code to `main`
- Never work on client data without checking the environment header

## Visual Environment Indicators

### Header System Implementation
```javascript
// Example implementation in React components
const getEnvironmentInfo = (req) => {
  const isTestMode = req.testMode || req.query.testClient;
  const branch = process.env.VERCEL_GIT_COMMIT_REF;
  
  if (isTestMode) {
    return { label: 'Test Mode', color: 'blue' };
  }
  
  if (branch === 'development') {
    return { label: 'Development', color: 'orange' };
  }
  
  return null; // Production - no badge
};
```

### CSS Styling
```css
.env-badge {
  background: #ff6b35;
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.8em;
  margin-left: 10px;
}

.test-mode .env-badge {
  background: #007acc;
}
```

## Recovery Commands

### If You Accidentally Commit to Wrong Branch
```bash
# If you committed to main instead of development
git log --oneline -5  # Find the commit hash
git reset --hard HEAD~1  # Remove last commit from main
git checkout development
git cherry-pick [commit-hash]  # Add it to development
```

### If You Need to Rollback Production
```bash
# Emergency rollback to previous version
git checkout main
git reset --hard v1.0.0-stable  # or whatever tag
git push --force-with-lease origin main
# Redeploy immediately
```

### If Branches Get Out of Sync
```bash
# Sync development with main
git checkout development
git fetch origin
git rebase origin/main
git push origin development
```

## Quick Reference

| Task | Command | Expected Header |
|------|---------|----------------|
| Switch to development | `git checkout development` | `Portal for [Client] (Development)` |
| Switch to production | `git checkout main` | `Portal for [Client]` |
| Create new feature | `git checkout -b feature/name` | `Portal for [Client] (Development)` |
| Test mode access | `?testClient=ClientId` | `Portal for [Client] (Test Mode)` |
| See current branch | `git branch` | - |
| See branch differences | `git log main..development` | - |
| Emergency hotfix | `git checkout -b hotfix/name` | `Portal for [Client]` |
| Deploy to production | Merge development → main | `Portal for [Client]` |

## Getting Help

When in doubt:
1. Check current branch: `git status`
2. Check portal header: Look for environment indicator
3. See what's different: `git log --oneline -10`
4. Ask me! I'll help you with any git commands or workflow questions.

Remember: **development** = your playground, **main** = what clients see. Keep them separate and you'll never break production!
