// tests/runIdService.test.js
// Tests for the Run ID Service

// Updated to use unified run ID service
const runIdService = require('../services/unifiedRunIdService');

// Helper to mock console.log to avoid cluttering test output
const originalConsoleLog = console.log;
console.log = jest.fn();

// Reset mocks after tests
afterAll(() => {
  console.log = originalConsoleLog;
});

describe('runIdService', () => {
  beforeEach(() => {
    // Clear cache before each test to ensure clean state
    runIdService.clearCache();
  });

  describe('generateRunId', () => {
    test('should generate run ID with correct format', () => {
      const clientId = 'test-client';
      const runId = runIdService.generateRunId(clientId);

      // Should match pattern SR-YYMMDD-NNN-Cclient-id
      const now = new Date();
      const year = now.getFullYear().toString().slice(2);
      const month = (now.getMonth() + 1).toString().padStart(2, '0');
      const day = now.getDate().toString().padStart(2, '0');
      
      // Create regex for pattern matching SR-YYMMDD-NNN-Cclient-id
      const pattern = new RegExp(`^SR-${year}${month}${day}-\\d{3}-C${clientId}$`);
      
      expect(runId).toMatch(pattern);
    });

    test('should include task and step IDs when provided', () => {
      const clientId = 'test-client';
      const taskId = '123';
      const stepId = '456';
      const runId = runIdService.generateRunId(clientId, taskId, stepId);

      // Should include task and step identifiers
      expect(runId).toContain('-T123');
      expect(runId).toContain('-S456');
    });

    test('should increment sequence numbers', () => {
      const clientId = 'test-client';
      const runId1 = runIdService.generateRunId(clientId);
      const runId2 = runIdService.generateRunId(clientId);
      
      // Extract sequence numbers
      const seq1 = runId1.split('-')[2];
      const seq2 = runId2.split('-')[2];
      
      // Should be different, and seq2 should be one more than seq1
      // or reset to 001 if seq1 was 999
      if (seq1 === '999') {
        expect(seq2).toBe('001');
      } else {
        expect(parseInt(seq2)).toBe(parseInt(seq1) + 1);
      }
    });
  });

  describe('normalizeRunId', () => {
    test('should normalize run ID with client suffix', () => {
      const runId = 'SR-250924-001-T123-S1';
      const clientId = 'test-client';
      const normalizedId = runIdService.normalizeRunId(runId, clientId);
      
      expect(normalizedId).toBe(`${runId}-C${clientId}`);
    });
    
    test('should handle run ID that already has client suffix', () => {
      const baseRunId = 'SR-250924-001-T123-S1';
      const clientId = 'test-client';
      const runIdWithSuffix = `${baseRunId}-C${clientId}`;
      
      const normalizedId = runIdService.normalizeRunId(runIdWithSuffix, clientId);
      
      // Should not add the suffix twice
      expect(normalizedId).toBe(runIdWithSuffix);
    });
    
    test('should handle run ID with different client suffix', () => {
      const baseRunId = 'SR-250924-001-T123-S1';
      const oldClientId = 'old-client';
      const newClientId = 'new-client';
      const runIdWithOldSuffix = `${baseRunId}-C${oldClientId}`;
      
      const normalizedId = runIdService.normalizeRunId(runIdWithOldSuffix, newClientId);
      
      // Should replace the old suffix with the new one
      expect(normalizedId).toBe(`${baseRunId}-C${newClientId}`);
    });

    test('should return null for null runId', () => {
      const normalizedId = runIdService.normalizeRunId(null, 'test-client');
      expect(normalizedId).toBeNull();
    });
    
    test('should return runId unchanged when clientId is missing', () => {
      const runId = 'SR-250924-001-T123-S1';
      const normalizedId = runIdService.normalizeRunId(runId, null);
      expect(normalizedId).toBe(runId);
    });
  });

  describe('registerRunRecord and getRunRecordId', () => {
    test('should register and retrieve run record', () => {
      const runId = 'SR-250924-001-T123-S1';
      const clientId = 'test-client';
      const recordId = 'rec123456';
      
      // Register the record
      runIdService.registerRunRecord(runId, clientId, recordId);
      
      // Retrieve the record
      const retrievedId = runIdService.getRunRecordId(runId, clientId);
      
      expect(retrievedId).toBe(recordId);
    });
    
    test('should normalize run ID when registering', () => {
      const runId = 'SR-250924-001-T123-S1';
      const clientId = 'test-client';
      const recordId = 'rec123456';
      
      // Register with base run ID
      runIdService.registerRunRecord(runId, clientId, recordId);
      
      // Retrieve with suffixed run ID
      const retrievedId = runIdService.getRunRecordId(`${runId}-C${clientId}`, clientId);
      
      expect(retrievedId).toBe(recordId);
    });

    test('should return null for unknown run record', () => {
      const runId = 'SR-250924-001-T999-S9';
      const clientId = 'unknown-client';
      
      const retrievedId = runIdService.getRunRecordId(runId, clientId);
      
      expect(retrievedId).toBeNull();
    });
  });

  describe('clearCache', () => {
    test('should clear all cache entries', () => {
      // Register some records
      runIdService.registerRunRecord('SR-250924-001-T1-S1', 'client1', 'rec1');
      runIdService.registerRunRecord('SR-250924-002-T2-S2', 'client2', 'rec2');
      
      // Clear all cache
      runIdService.clearCache();
      
      // Try to retrieve
      const id1 = runIdService.getRunRecordId('SR-250924-001-T1-S1', 'client1');
      const id2 = runIdService.getRunRecordId('SR-250924-002-T2-S2', 'client2');
      
      expect(id1).toBeNull();
      expect(id2).toBeNull();
    });
    
    test('should clear specific cache entry', () => {
      // Register some records
      runIdService.registerRunRecord('SR-250924-001-T1-S1', 'client1', 'rec1');
      runIdService.registerRunRecord('SR-250924-002-T2-S2', 'client2', 'rec2');
      
      // Clear specific cache
      runIdService.clearCache('SR-250924-001-T1-S1', 'client1');
      
      // Try to retrieve
      const id1 = runIdService.getRunRecordId('SR-250924-001-T1-S1', 'client1');
      const id2 = runIdService.getRunRecordId('SR-250924-002-T2-S2', 'client2');
      
      expect(id1).toBeNull();  // Should be cleared
      expect(id2).toBe('rec2'); // Should remain
    });
    
    test('should clear all entries for a client', () => {
      // Register some records
      runIdService.registerRunRecord('SR-250924-001-T1-S1', 'client1', 'rec1');
      runIdService.registerRunRecord('SR-250924-002-T2-S2', 'client1', 'rec2');
      runIdService.registerRunRecord('SR-250924-003-T3-S3', 'client2', 'rec3');
      
      // Clear all for client1
      runIdService.clearCache(null, 'client1');
      
      // Try to retrieve
      const id1 = runIdService.getRunRecordId('SR-250924-001-T1-S1', 'client1');
      const id2 = runIdService.getRunRecordId('SR-250924-002-T2-S2', 'client1');
      const id3 = runIdService.getRunRecordId('SR-250924-003-T3-S3', 'client2');
      
      expect(id1).toBeNull();  // Should be cleared
      expect(id2).toBeNull();  // Should be cleared
      expect(id3).toBe('rec3'); // Should remain
    });
  });
  
  describe('registerApifyRunId', () => {
    test('should normalize Apify run ID with client suffix', () => {
      const apifyRunId = 'apify-run-12345';
      const clientId = 'test-client';
      const normalizedId = runIdService.registerApifyRunId(apifyRunId, clientId);
      
      expect(normalizedId).toBe(`${apifyRunId}-C${clientId}`);
    });
  });
});