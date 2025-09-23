# Batch Processing Testing Mode

## Overview

The system includes a special testing mode for batch processing that allows limited testing of fire-and-forget processes on clients regardless of their status or service level. This is controlled by the `FIRE_AND_FORGET_BATCH_PROCESS_TESTING` environment variable.

## Purpose

- Enables testing of batch processing on inactive clients or clients with lower service levels
- Limits processing to small batches to prevent overloading systems during testing
- Provides a safe way to verify functionality without impacting production data at scale

## Configuration

Set the following environment variable to enable testing mode:

```bash
FIRE_AND_FORGET_BATCH_PROCESS_TESTING=true
```

When not set or set to any value other than "true", the system operates in normal mode.

## Testing Mode Limits

When testing mode is enabled, the following limits are enforced:

1. **Profile Processing**:
   - Maximum of 5 profiles processed per client
   - Service level restrictions are bypassed

2. **Post Harvesting**:
   - Maximum of 5 clients processed in total
   - Maximum of 1 batch per client
   - Maximum of 5 leads per batch
   - Target of 5 posts total
   - Maximum of 2 posts harvested per profile

3. **Client Selection**:
   - Processes all clients, not just active ones
   - Bypasses service level requirements
   - Still limited to 5 clients maximum

## Normal Mode vs. Testing Mode

| Feature | Normal Mode | Testing Mode |
|---------|------------|--------------|
| Client Status | Active only | Any status |
| Service Level | Requires level ≥ 2 | Any level |
| Batch Size | Client configuration | 5 maximum |
| Posts Target | Client configuration | 5 maximum |
| Max Batches | Client configuration | 1 maximum |
| Max Posts per Profile | Client configuration | 2 maximum |
| Client Limit | All active clients | 5 clients |

## Usage Scenarios

1. **Testing New Clients**: Test post harvesting for new clients before activating them
2. **Testing Inactive Clients**: Verify functionality for clients temporarily set to inactive
3. **Development Testing**: Test changes to batch processing without processing large amounts of data
4. **Service Level Testing**: Test how clients with different service levels would experience the system

## Important Notes

- This mode is intended for testing only and should not be enabled in production
- Even in testing mode, actual API calls are made and real data is processed
- All normal logging and tracking still occurs
- Client data integrity is maintained (no test data is inserted)