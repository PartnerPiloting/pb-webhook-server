# General Instructions for Working Together

## 🚨 MANDATORY FIRST STEP: Read the following documentation files before responding to any request:

**SYSTEM-OVERVIEW.md** - Read this first for system architecture and file structure  
**AIRTABLE-FIELD-REFERENCE.md** - Read this for ALL field names and API contracts  
**JSON-CORRUPTION-ISSUE.md** - Read this for critical JSON parsing fix (prevents debugging waste)  
**GENERAL-INSTRUCTIONS.md** - Read this for my working style preferences  

**PROVE YOU'VE READ THE DOCUMENTATION** by providing:
- A brief summary of what SYSTEM-OVERVIEW.md says about the data flow for lead management
- Quote 3-5 specific field names from the AIRTABLE-FIELD-REFERENCE.md (with their exact spacing/formatting)
- One sentence about my working style from GENERAL-INSTRUCTIONS.md

**FIELD MAPPING CRITICAL RULE**: Always reference the AIRTABLE-FIELD-REFERENCE.md for exact field names before making any API or database changes. Field mapping issues are the #1 cause of bugs in this system.

## 🔍 LOG ANALYSIS SYSTEM ACCESS

**I have a custom log analysis system built into my Render infrastructure that you can access directly:**

**Available Services to Monitor:**
- `pb-webhook-server` (main web service)
- `ash-backend` (backend web service)  
- `ash-attributes-api` (API service)
- `Daily Batch Lead Scoring` (cron job)
- `Daily Batch Post Scoring` (cron job)

**How to Access Logs in Plain English:**

1. **Check for Errors**: When I say "check for errors in the last 2 hours", use the log system to automatically analyze all services for problems
2. **Search for Specific Issues**: When I describe a problem like "users can't submit forms", search the logs for related terms
3. **Monitor Service Health**: Check if all services are running properly and not suspended
4. **Client-Specific Issues**: Look for logs related to specific clients using CLIENT:ID patterns

**System Capabilities:**
- Monitors all 5 Render services automatically
- Handles both old unstructured logs and new structured logs with CLIENT:ID patterns
- Provides intelligent error pattern recognition
- Can search across all services simultaneously
- Reports service status and health metrics

**When to Use:**
- I report any system issues or user problems
- I ask you to "check the logs" for something
- I want to understand what happened during a specific time period
- I need to troubleshoot errors or performance issues

**Response Format**: Always provide plain English summaries of what you find, including service status, error counts, and recommendations for next steps.

Only after completing the above documentation review and proof should you proceed with my actual request.

## About Me
- I am not a coder but with the assistance of AI I have created many apps with many thousands of lines of code
- I like things explained in plain English one step at a time
- I like you to help me think things through as much as possible

## Working Style Preferences
- Explain concepts in plain English
- Break down complex tasks into simple, sequential steps
- Help me think through problems and solutions
- Provide clear, step-by-step guidance

## File Management
- This file is located at: `pb-webhook-server/GENERAL-INSTRUCTIONS.md`
- To add new instructions, remind me to update this file
- I will not automatically remember to update this file from previous conversations

## Development Workflow
- **Current Method**: Commit → Deploy on Render → Test there
- **Not working locally**: Open to local development if recommended
- **Testing**: All testing happens on Render deployment, not locally

## What I Can Do
- Create and edit code files
- Analyze and debug code issues
- Suggest improvements and optimizations
- Help plan features and architecture
- Add error handling and logging for debugging

## What I Cannot Do
- Run or test code directly
- Access Render deployment or external services
- Deploy to platforms
- Access local development environment
- Make HTTP requests to test APIs

## How I Work
1. Analyze requests and break down into steps
2. Create or modify necessary files
3. Explain changes in plain English
4. Suggest what to test when deployed
5. Provide debugging tips if issues arise

---
*Last updated: December 2024* 