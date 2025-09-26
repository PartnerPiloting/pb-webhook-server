// tests/validators.test.js
// Tests for the validators module

const { ValidationError, ...validators } = require('../src/domain/models/validators');
const { STATUS, LIMITS } = require('../src/domain/models/constants');

// Helper to mock console.warn to avoid cluttering test output
const originalConsoleWarn = console.warn;
let consoleWarnMock;

beforeEach(() => {
  consoleWarnMock = jest.fn();
  console.warn = consoleWarnMock;
});

afterAll(() => {
  console.warn = originalConsoleWarn;
});

describe('validators', () => {
  describe('validateClient', () => {
    test('should validate client with required fields', () => {
      const client = {
        clientId: 'test-client',
        clientName: 'Test Client',
        serviceLevel: 2,
        status: 'Active'
      };
      
      expect(() => validators.validateClient(client)).not.toThrow();
    });
    
    test('should throw for missing client ID', () => {
      const client = {
        clientName: 'Test Client'
      };
      
      expect(() => validators.validateClient(client))
        .toThrow(new ValidationError('Client ID is required', 'clientId'));
    });
    
    test('should throw for invalid status', () => {
      const client = {
        clientId: 'test-client',
        clientName: 'Test Client',
        status: 'Invalid'
      };
      
      expect(() => validators.validateClient(client))
        .toThrow(ValidationError);
    });
  });
  
  describe('isProcessingStuck', () => {
    test('should handle null date correctly', () => {
      expect(validators.isProcessingStuck(null)).toBe(false);
    });
    
    test('should handle invalid date string', () => {
      const result = validators.isProcessingStuck('not-a-date');
      expect(result).toBe(false);
      expect(consoleWarnMock).toHaveBeenCalledWith(expect.stringContaining('Invalid date format'));
    });
    
    test('should detect future date as stuck', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1); // Tomorrow
      
      const result = validators.isProcessingStuck(futureDate.toISOString());
      expect(result).toBe(true);
      expect(consoleWarnMock).toHaveBeenCalledWith(expect.stringContaining('Future date detected'));
    });
    
    test('should detect stuck processing', () => {
      const stuckDate = new Date();
      stuckDate.setMinutes(stuckDate.getMinutes() - (LIMITS.PROCESSING_STATUS_TIMEOUT_MINUTES + 5));
      
      expect(validators.isProcessingStuck(stuckDate.toISOString())).toBe(true);
    });
    
    test('should not flag recent processing as stuck', () => {
      const recentDate = new Date();
      recentDate.setMinutes(recentDate.getMinutes() - 5); // 5 minutes ago
      
      expect(validators.isProcessingStuck(recentDate.toISOString())).toBe(false);
    });
  });
  
  describe('validateStatusTransition', () => {
    test('should allow valid transitions for RUN_RECORD', () => {
      expect(() => 
        validators.validateStatusTransition(
          STATUS.RUN_RECORD.RUNNING, 
          STATUS.RUN_RECORD.COMPLETED, 
          'RUN_RECORD'
        )
      ).not.toThrow();
    });
    
    test('should reject invalid transitions for RUN_RECORD', () => {
      expect(() => 
        validators.validateStatusTransition(
          STATUS.RUN_RECORD.COMPLETED, 
          STATUS.RUN_RECORD.RUNNING, 
          'RUN_RECORD'
        )
      ).toThrow(ValidationError);
    });
    
    test('should allow valid transitions for POST_HARVESTING', () => {
      expect(() => 
        validators.validateStatusTransition(
          STATUS.POST_HARVESTING.PENDING, 
          STATUS.POST_HARVESTING.PROCESSING, 
          'POST_HARVESTING'
        )
      ).not.toThrow();
    });
    
    test('should reject invalid transitions for POST_HARVESTING', () => {
      expect(() => 
        validators.validateStatusTransition(
          STATUS.POST_HARVESTING.DONE, 
          STATUS.POST_HARVESTING.PENDING, 
          'POST_HARVESTING'
        )
      ).toThrow(ValidationError);
    });
    
    test('should handle unknown process type', () => {
      expect(() => 
        validators.validateStatusTransition('Active', 'Inactive', 'UNKNOWN_TYPE')
      ).toThrow(ValidationError);
    });
  });
  
  describe('validateBatchSize', () => {
    test('should validate acceptable batch size', () => {
      expect(() => validators.validateBatchSize(50, 'LEAD_SCORING')).not.toThrow();
    });
    
    test('should reject batch size that exceeds limit', () => {
      const maxSize = LIMITS.LEAD_SCORING_BATCH_SIZE + 10;
      expect(() => validators.validateBatchSize(maxSize, 'LEAD_SCORING')).toThrow(ValidationError);
    });
    
    test('should reject zero batch size', () => {
      expect(() => validators.validateBatchSize(0, 'LEAD_SCORING')).toThrow(ValidationError);
    });
  });
});