/**
 * tests/jobMetricsService.test.js
 * 
 * Tests for the job metrics service to ensure proper validation,
 * normalization, and aggregation of metrics.
 */

const jobMetricsService = require('../services/jobMetricsService');
const unifiedJobTrackingRepository = require('../services/unifiedJobTrackingRepository');
const unifiedRunIdService = require('../services/unifiedRunIdService');
const { StructuredLogger } = require('../utils/structuredLogger');

// Mock dependencies for isolated testing
jest.mock('../services/unifiedJobTrackingRepository');
jest.mock('../services/unifiedRunIdService');
jest.mock('../utils/structuredLogger');

describe('Job Metrics Service', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    // Set up logger mock
    StructuredLogger.mockImplementation(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }));
    
    // Set up repository mocks
    unifiedJobTrackingRepository.updateClientRunRecord = jest.fn().mockResolvedValue({ id: 'rec123' });
    unifiedJobTrackingRepository.createClientRunRecord = jest.fn().mockResolvedValue({ id: 'rec456' });
    unifiedJobTrackingRepository.completeClientRunRecord = jest.fn().mockResolvedValue({ id: 'rec123' });
    unifiedJobTrackingRepository.updateAggregateMetrics = jest.fn().mockResolvedValue({ id: 'rec789' });
    unifiedJobTrackingRepository.completeJobTrackingRecord = jest.fn().mockResolvedValue({ id: 'rec789' });
    
    // Set up run ID service mocks
    unifiedRunIdService.convertToStandardFormat = jest.fn().mockImplementation(id => id);
  });
  
  describe('Metric Validation', () => {
    test('should validate and normalize metrics properly', () => {
      const testMetrics = {
        'Leads Processed': '42', // String that should convert to number
        'Posts Processed': 55,
        'Invalid Field': 'some value',
        'Profiles Examined for Scoring': 'not-a-number',
        'Start Time': '2023-06-15T12:00:00Z'
      };
      
      const { validMetrics, invalidMetrics } = jobMetricsService.validateMetrics(testMetrics);
      
      // Check valid metrics
      expect(validMetrics['Leads Processed']).toBe(42);
      expect(validMetrics['Posts Processed']).toBe(55);
      expect(validMetrics['Invalid Field']).toBe('some value');
      expect(validMetrics['Start Time']).toBe('2023-06-15T12:00:00Z');
      
      // Check invalid metrics
      expect(invalidMetrics['Profiles Examined for Scoring']).toBeDefined();
      expect(validMetrics['Profiles Examined for Scoring']).toBe(0); // Default value
    });
  });
  
  describe('Metrics Aggregation', () => {
    test('should aggregate metrics correctly from multiple records', () => {
      const records = [
        {
          get: field => {
            const data = {
              'Leads Processed': 10,
              'Posts Processed': 5,
              'Start Time': '2023-06-15T12:00:00Z',
              'Status': 'Completed'
            };
            return data[field];
          }
        },
        {
          get: field => {
            const data = {
              'Leads Processed': 20,
              'Posts Processed': 15,
              'Start Time': '2023-06-15T12:30:00Z',
              'Status': 'Completed'
            };
            return data[field];
          }
        },
        {
          get: field => {
            const data = {
              'Leads Processed': 5,
              'Posts Processed': 0,
              'Start Time': '2023-06-15T11:45:00Z',
              'Status': 'Failed'
            };
            return data[field];
          }
        }
      ];
      
      const aggregated = jobMetricsService.aggregateMetrics(records);
      
      expect(aggregated['Leads Processed']).toBe(35);
      expect(aggregated['Posts Processed']).toBe(20);
      expect(aggregated['Start Time']).toBe('2023-06-15T11:45:00Z');
      expect(aggregated['Status']).toBe('Failed');
      expect(aggregated['Clients Processed']).toBe(3);
      expect(aggregated['Clients With Errors']).toBe(1);
    });
    
    test('should handle empty records array', () => {
      const aggregated = jobMetricsService.aggregateMetrics([]);
      expect(aggregated).toEqual({});
    });
  });
  
  describe('Client Metrics Operations', () => {
    test('should update client metrics successfully', async () => {
      const result = await jobMetricsService.updateClientMetrics({
        runId: '230615-120000',
        clientId: 'client123',
        metrics: {
          'Leads Processed': 10,
          'Posts Processed': 5
        }
      });
      
      expect(result).toEqual({ id: 'rec123' });
      expect(unifiedJobTrackingRepository.updateClientRunRecord).toHaveBeenCalled();
    });
    
    test('should complete client metrics successfully', async () => {
      const result = await jobMetricsService.completeClientMetrics({
        runId: '230615-120000',
        clientId: 'client123',
        metrics: {
          'Leads Processed': 10,
          'Posts Processed': 5
        },
        success: true
      });
      
      expect(result).toEqual({ id: 'rec123' });
      expect(unifiedJobTrackingRepository.completeClientRunRecord).toHaveBeenCalled();
      
      // Check that status and end time were added
      const call = unifiedJobTrackingRepository.completeClientRunRecord.mock.calls[0][0];
      expect(call.metrics['Status']).toBe('Completed');
      expect(call.metrics['End Time']).toBeDefined();
    });
    
    test('should throw error if runId or clientId is missing', async () => {
      await expect(jobMetricsService.updateClientMetrics({
        runId: '',
        clientId: 'client123',
        metrics: {}
      })).rejects.toThrow();
      
      await expect(jobMetricsService.updateClientMetrics({
        runId: '230615-120000',
        clientId: '',
        metrics: {}
      })).rejects.toThrow();
    });
  });
  
  describe('Job Metrics Operations', () => {
    test('should update job aggregate metrics successfully', async () => {
      const result = await jobMetricsService.updateJobAggregateMetrics({
        runId: '230615-120000'
      });
      
      expect(result).toEqual({ id: 'rec789' });
      expect(unifiedJobTrackingRepository.updateAggregateMetrics).toHaveBeenCalled();
    });
    
    test('should complete job metrics successfully', async () => {
      const result = await jobMetricsService.completeJobMetrics({
        runId: '230615-120000',
        success: true,
        notes: 'Job completed successfully'
      });
      
      expect(result).toEqual({ id: 'rec789' });
      expect(unifiedJobTrackingRepository.updateAggregateMetrics).toHaveBeenCalled();
      expect(unifiedJobTrackingRepository.completeJobTrackingRecord).toHaveBeenCalled();
      
      // Check that correct parameters were passed
      const call = unifiedJobTrackingRepository.completeJobTrackingRecord.mock.calls[0][0];
      expect(call.status).toBe('Completed');
      expect(call.metrics['System Notes']).toBe('Job completed successfully');
    });
    
    test('should handle failed job completion', async () => {
      const result = await jobMetricsService.completeJobMetrics({
        runId: '230615-120000',
        success: false,
        notes: 'Job failed due to error'
      });
      
      expect(result).toEqual({ id: 'rec789' });
      
      // Check that failed status was passed
      const call = unifiedJobTrackingRepository.completeJobTrackingRecord.mock.calls[0][0];
      expect(call.status).toBe('Failed');
    });
  });
});