# 📚 Documentation Standards & Maintenance Guide

> **Guidelines for maintaining organized, up-to-date project documentation**

---

## **📋 DOCUMENTATION HIERARCHY**

### **Tier 1: Essential Daily Operations**
- `QUICK-REFERENCE.md` ← **You are here** - Most accessed
- `MASTER-TASKS.md` - Single source of truth for all tasks
- `DOCS-INDEX.md` - Navigation hub for all documents

### **Tier 2: Technical Implementation**
- `APIFY-INTEGRATION-GUIDE.md` - Phase 4 roadmap
- `MULTI-TENANT-IMPLEMENTATION-SUMMARY.md` - Architecture guide
- `routes/apiAndJobRoutes.js` - Main codebase documentation

### **Tier 3: Historical & Reference**
- `docs/archive/` - Deprecated files (do not edit)
- Analysis files (`analyze-*.js`, `*.txt`)
- Environment audits (`ENVIRONMENT-*.md`)

---

## **✍️ DOCUMENTATION STANDARDS**

### **File Naming Convention**
```
PURPOSE-SCOPE-TYPE.md

Examples:
✅ QUICK-REFERENCE.md
✅ MULTI-TENANT-IMPLEMENTATION-SUMMARY.md  
✅ APIFY-INTEGRATION-GUIDE.md
❌ random-notes.md
❌ TODO-stuff.md
```

### **Required Document Structure**
```markdown
# 📋 [Document Title]

> **Brief purpose statement in italics**

---

## **📊 STATUS** (for task/implementation docs)
✅ Complete | 🔄 In Progress | 📋 Planned | 🚫 Blocked

## **🎯 PURPOSE** (for all docs)
What this document accomplishes...

## **[MAIN CONTENT SECTIONS]**
Organized with clear headers...

---

*Last Updated: YYYY-MM-DD*
*Maintained by: [Team/Person]*
```

### **Status Icons System**
```
🔥 Critical/Urgent
✅ Complete  
🔄 In Progress
📋 Planned
🚫 Blocked
🎯 Target/Goal
📊 Status/Metrics
💡 Ideas/Notes
🚀 Quick Access
⚠️ Warning/Issue
```

---

## **📁 FILE ORGANIZATION RULES**

### **Current Active Files** (Root Directory)
- Must be actively maintained
- Regular review every 2 weeks
- Clear ownership assigned

### **Archive Directory** (`docs/archive/`)
- Move files here when superseded
- Never edit archived files
- Include archive reason in git commit

### **Specialized Directories**
```
analysis/           - Data analysis outputs
scripts/           - Utility scripts
deprecated/        - Old implementations (to be removed)
```

---

## **🔄 MAINTENANCE SCHEDULE**

### **Weekly (Every Monday)**
1. Update `MASTER-TASKS.md` with current priorities
2. Review `QUICK-REFERENCE.md` for outdated info
3. Update status indicators across key documents

### **Monthly (First Tuesday)**
1. Review `DOCS-INDEX.md` for new files to categorize
2. Archive obsolete documentation
3. Update `APIFY-INTEGRATION-GUIDE.md` progress
4. Validate all external links

### **Quarterly (Project Milestones)**
1. Complete documentation audit
2. Update this standards guide
3. Review and consolidate related documents
4. Archive completed project phases

---

## **✅ QUALITY CHECKLIST**

### **Before Creating New Documentation**
- [ ] Does this information belong in existing document?
- [ ] Does filename follow naming convention?
- [ ] Is purpose clearly stated at the top?
- [ ] Are all external links functional?
- [ ] Is there a clear maintenance owner?

### **Before Archiving Documents**
- [ ] Is information preserved elsewhere?
- [ ] Are there any references to update?
- [ ] Is archive reason documented in git commit?
- [ ] Have stakeholders been notified?

### **During Regular Maintenance**
- [ ] Status indicators reflect current state
- [ ] No broken internal/external links
- [ ] Content is technically accurate
- [ ] Examples are working and up-to-date

---

## **⚠️ COMMON PITFALLS TO AVOID**

### **Documentation Fragmentation**
```
❌ Multiple task lists (TASK-LIST-1.md, TASK-LIST-2.md)
✅ Single source of truth (MASTER-TASKS.md)
```

### **Outdated Information**
```
❌ "TODO: Implement this next month" (from 6 months ago)
✅ Specific dates and regular review schedule
```

### **Unclear Ownership**
```
❌ Documents with no clear maintainer
✅ Clear ownership noted in document header
```

### **Link Rot**
```
❌ Links to temporary development URLs
✅ Stable production URLs with backup references
```

---

## **🔄 CONSOLIDATION WORKFLOW**

### **When to Consolidate**
- Multiple documents covering same topic
- Frequent cross-references between related files
- Difficulty finding authoritative information
- Team reports documentation confusion

### **Consolidation Process**
1. **Analyze** - Map content overlap and dependencies
2. **Plan** - Design new document structure
3. **Create** - Build consolidated document with all information
4. **Validate** - Ensure no information loss
5. **Archive** - Move old documents with clear references
6. **Communicate** - Update team on new organization

---

## **💡 BEST PRACTICES**

### **Writing Style**
- Start with purpose, not implementation details
- Use bullet points for scannable content
- Include practical examples and code snippets
- Date all information with review cycles

### **Cross-References**
- Link to related documents by filename
- Use consistent terminology across documents  
- Maintain bidirectional links where relevant
- Update all references when renaming files

### **Version Control**
- Commit documentation changes with clear messages
- Tag major reorganizations in git
- Keep documentation changes in separate commits from code
- Document breaking changes in commit messages

---

## **📞 ESCALATION**

### **When Documentation Issues Arise**
1. **Individual confusion** → Check DOCS-INDEX.md
2. **Outdated information** → Update and note in MASTER-TASKS.md  
3. **Missing documentation** → Create new document following standards
4. **Systemic issues** → Review and update this guide

---

## **🎯 SUCCESS METRICS**

### **Good Documentation Health**
- Team can find information in <30 seconds
- New team members can get started independently
- No duplicate or conflicting information
- Regular maintenance happens without reminders

### **Warning Signs**
- Multiple people asking same questions
- Documents haven't been updated in 3+ months
- Confusion about which document is authoritative
- People creating personal notes instead of updating docs

---

*This guide should be reviewed and updated quarterly or after major project changes.*

**Maintained by**: Technical Lead  
**Last Review**: Documentation Consolidation Phase (Current)  
**Next Review**: After Multi-Tenant Phase 2 completion
