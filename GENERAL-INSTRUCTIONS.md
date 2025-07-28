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