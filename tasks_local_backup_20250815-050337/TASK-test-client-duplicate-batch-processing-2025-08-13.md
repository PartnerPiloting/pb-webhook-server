# TASK: Test-Client Duplicate Batch Processing (from HOTFIX-BACKLOG.md)

## Description
Test-Client points to Guy-Wilson base, causing duplicate scoring in batch operations. Need to add a Status field with "Test Exclude Batch" value and update batch logic to skip non-Active clients.

## Checklist
- [ ] Add Status field with "Test Exclude Batch" value to Test-Client
- [ ] Update batch logic to skip non-Active clients
- [ ] Test batch processing to confirm duplicates are prevented
- [ ] Update documentation and HOTFIX-BACKLOG.md status

## Status
- Current status: Not started

## Notes
- Source: docs/temp/HOTFIX-BACKLOG.md
- Last updated: August 8, 2025
