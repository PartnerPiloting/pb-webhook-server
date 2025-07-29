# Development & Production Workflow Guide
*Simple English Guide for Managing Client vs Development Versions*

## The Problem We Solved

You're about to get your first client, but you also need to keep developing new features. If you work on the same version your client uses, they'll experience:
- Broken features while you're coding
- Half-finished buttons that don't work  
- App crashes when you make mistakes

## The Solution: Two Separate Versions

Think of it like McDonald's:
- **Customers** eat from the **clean, working kitchen** (Production)
- **Chefs** experiment with new recipes in a **separate test kitchen** (Development)
- Customers never see the failed experiments

## How It Works

### Two URLs:
- **Production** (for your client): `https://pb-webhook-server.vercel.app` 
- **Development** (for you): `https://pb-webhook-server-dev.vercel.app`

### Two Git Branches:
- **main branch** = Production (stable, never breaks)
- **development branch** = Development (where you experiment)

## Your Daily Workflow

### When Developing New Features:
1. **Work on the development branch**
2. **Test on the development URL** 
3. **Break things freely** - your client never sees it
4. **Only when perfect** → Move to production

### When Ready to Release:
1. **Test everything thoroughly** on development
2. **Merge development → main branch**
3. **Production automatically updates**
4. **Tell your client**: "New feature is live!"

## The Commands You Need

### Create Development Branch (One-time setup):
```bash
git checkout -b development
git push origin development
```

### Daily Work Commands:
```bash
# Switch to development to work
git checkout development

# Make your changes, test them

# When ready to release:
git checkout main
git merge development  
git push origin main
```

## Platform Setup

### On Vercel Dashboard You'll See:
- **pb-webhook-server** (Production) → Connected to `main` branch
- **pb-webhook-server-dev** (Development) → Connected to `development` branch

### Auto-Deploy Magic:
- Push to `development` branch → Development site updates
- Push to `main` branch → Production site updates (your client sees this)

## Safety Rules

### ✅ Always Do:
- Test thoroughly on development before releasing
- Only give your client the production URL
- Keep the development URL to yourself
- Check production works after each release

### ❌ Never Do:
- Work directly on the main branch once you have a client
- Give your client the development URL
- Push broken code to main branch
- Skip testing on development

## Emergency Procedures

### If Production Breaks:
1. **Don't panic** - you have the stable tag: `v1.0.0-stable`
2. **Quick fix**: `git reset --hard v1.0.0-stable`
3. **Push fix**: `git push --force origin main`
4. **Production restored** to last working version

### If Development Breaks:
- **No problem!** Your client is unaffected
- Fix it or start over - only you see the development version

## The Big Picture

### Before (Dangerous):
```
You work → Client sees broken stuff → Client unhappy
```

### After (Safe):
```
You work on DEV → Test → Perfect? → Release to PROD → Client happy
```

## Key Phrases to Remember

- **"Development"** = Your playground, can break
- **"Production"** = Client's version, must never break  
- **"Main branch"** = What production uses
- **"Development branch"** = What you work on
- **"Merge"** = Copy your tested work to production

## Your Backup Plan

You already created a safety bookmark: `v1.0.0-stable`

**To return to this working version anytime:**
```bash
git checkout v1.0.0-stable
```

## Next Steps

1. **Set up development branch** (we'll do this together)
2. **Create second deployment** for development
3. **Test the workflow** with a small change
4. **Give client the production URL only**
5. **Start developing the Load More feature safely**

---

*This guide was created on July 28, 2025. Keep this handy for reference!*
