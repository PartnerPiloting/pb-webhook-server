/**
 * tests/runIdSystem.test.js
 * 
 * Comprehensive test suite for the runIdSystem.js service.
 * Tests all core functionality and edge cases.
 */

const { expect } = require('chai');
const sinon = require('sinon');
const { format } = require('date-fns');
const runIdSystem = require('../services/runIdSystem');

describe('Run ID System', () => {
  // Reset date/time before each test to have predictable output
  let clock;
  
  before(() => {
    // Use a fixed date for all tests to have predictable IDs
    const fixedDate = new Date('2023-10-05T14:25:32.000Z');
    clock = sinon.useFakeTimers(fixedDate);
  });
  
  after(() => {
    clock.restore();
  });
  
  describe('Core ID functions', () => {
    describe('generateRunId()', () => {
      it('should generate a run ID in the correct format (YYMMDD-HHMMSS)', () => {
        const runId = runIdSystem.generateRunId();
        expect(runId).to.equal('231005-142532');
        expect(runId).to.match(/^\d{6}-\d{6}$/);
      });
    });
    
    describe('createClientRunId()', () => {
      it('should create a client run ID by combining base ID and client ID', () => {
        const clientRunId = runIdSystem.createClientRunId('231005-142532', 'GuyWilson');
        expect(clientRunId).to.equal('231005-142532-GuyWilson');
      });
      
      it('should throw an error if baseRunId is missing', () => {
        expect(() => runIdSystem.createClientRunId(null, 'GuyWilson')).to.throw(/baseRunId is required/);
      });
      
      it('should throw an error if clientId is missing', () => {
        expect(() => runIdSystem.createClientRunId('231005-142532', null)).to.throw(/clientId is required/);
      });
      
      it('should handle client IDs containing hyphens', () => {
        const clientRunId = runIdSystem.createClientRunId('231005-142532', 'Guy-Wilson');
        expect(clientRunId).to.equal('231005-142532-Guy-Wilson');
      });
    });
    
    describe('getBaseRunId()', () => {
      it('should extract the base run ID from a client run ID', () => {
        const baseRunId = runIdSystem.getBaseRunId('231005-142532-GuyWilson');
        expect(baseRunId).to.equal('231005-142532');
      });
      
      it('should return null for null/undefined input', () => {
        expect(runIdSystem.getBaseRunId(null)).to.be.null;
        expect(runIdSystem.getBaseRunId(undefined)).to.be.null;
      });
      
      it('should return the original ID if it does not match the expected format', () => {
        const weirdFormat = 'weird-format-id';
        expect(runIdSystem.getBaseRunId(weirdFormat)).to.equal(weirdFormat);
      });
      
      it('should handle client IDs containing hyphens', () => {
        const baseRunId = runIdSystem.getBaseRunId('231005-142532-Guy-Wilson');
        expect(baseRunId).to.equal('231005-142532');
      });
    });
    
    describe('getClientId()', () => {
      it('should extract the client ID from a client run ID', () => {
        const clientId = runIdSystem.getClientId('231005-142532-GuyWilson');
        expect(clientId).to.equal('GuyWilson');
      });
      
      it('should return null for null/undefined input', () => {
        expect(runIdSystem.getClientId(null)).to.be.null;
        expect(runIdSystem.getClientId(undefined)).to.be.null;
      });
      
      it('should return null if the ID does not contain a client part', () => {
        expect(runIdSystem.getClientId('231005-142532')).to.be.null;
      });
      
      it('should handle client IDs containing hyphens', () => {
        const clientId = runIdSystem.getClientId('231005-142532-Guy-Wilson');
        expect(clientId).to.equal('Guy-Wilson');
      });
    });
    
    describe('validateRunId()', () => {
      it('should return true for valid run IDs', () => {
        expect(runIdSystem.validateRunId('231005-142532')).to.be.true;
        expect(runIdSystem.validateRunId('231005-142532-GuyWilson')).to.be.true;
      });
      
      it('should throw an error for null/undefined run IDs', () => {
        expect(() => runIdSystem.validateRunId(null)).to.throw(/cannot be null or undefined/);
        expect(() => runIdSystem.validateRunId(undefined)).to.throw(/cannot be null or undefined/);
      });
      
      it('should throw an error for non-string run IDs', () => {
        expect(() => runIdSystem.validateRunId(123)).to.throw(/must be a string/);
        expect(() => runIdSystem.validateRunId({})).to.throw(/must be a string/);
      });
    });
  });
  
  describe('Job tracking record operations', () => {
    let mockJobTrackingTable;
    let mockRecord;
    
    beforeEach(() => {
      mockRecord = {
        id: 'recXXXXXXXXXXXXX',
        fields: {
          'Run ID': '231005-142532',
          'Status': 'pending',
          'Created At': '2023-10-05T14:25:32.000Z'
        }
      };
      
      mockJobTrackingTable = {
        create: sinon.stub().resolves(mockRecord),
        find: sinon.stub().resolves(mockRecord),
        select: sinon.stub().returns({
          firstPage: sinon.stub().resolves([mockRecord])
        }),
        update: sinon.stub().resolves({
          ...mockRecord,
          fields: {
            ...mockRecord.fields,
            'Status': 'completed',
            'Last Updated': '2023-10-05T14:30:00.000Z'
          }
        })
      };
      
      // Clear cache before each test
      runIdSystem.clearCache();
    });
    
    describe('createJobTrackingRecord()', () => {
      it('should create a job tracking record with the correct run ID', async () => {
        const runId = '231005-142532';
        const data = { status: 'pending' };
        
        const result = await runIdSystem.createJobTrackingRecord(runId, mockJobTrackingTable, data);
        
        expect(result).to.equal(mockRecord);
        expect(mockJobTrackingTable.create.calledOnce).to.be.true;
        expect(mockJobTrackingTable.create.firstCall.args[0]).to.include({
          'Run ID': runId,
          'Status': 'pending'
        });
      });
      
      it('should extract base run ID from client run ID when creating record', async () => {
        const clientRunId = '231005-142532-GuyWilson';
        
        await runIdSystem.createJobTrackingRecord(clientRunId, mockJobTrackingTable);
        
        expect(mockJobTrackingTable.create.firstCall.args[0]['Run ID']).to.equal('231005-142532');
      });
      
      it('should throw an error if job tracking table is not provided', async () => {
        const runId = '231005-142532';
        
        await expect(runIdSystem.createJobTrackingRecord(runId)).to.be.rejectedWith(/table is required/);
      });
    });
    
    describe('findJobTrackingRecord()', () => {
      it('should find a job tracking record by run ID', async () => {
        const runId = '231005-142532';
        
        const result = await runIdSystem.findJobTrackingRecord(runId, mockJobTrackingTable);
        
        expect(result).to.equal(mockRecord);
        expect(mockJobTrackingTable.select.calledOnce).to.be.true;
        expect(mockJobTrackingTable.select.firstCall.args[0].filterByFormula).to.include(runId);
      });
      
      it('should extract base run ID from client run ID when finding record', async () => {
        const clientRunId = '231005-142532-GuyWilson';
        
        await runIdSystem.findJobTrackingRecord(clientRunId, mockJobTrackingTable);
        
        expect(mockJobTrackingTable.select.firstCall.args[0].filterByFormula).to.include('231005-142532');
      });
      
      it('should use cached record ID if available', async () => {
        const runId = '231005-142532';
        
        // First find to cache the record ID
        await runIdSystem.findJobTrackingRecord(runId, mockJobTrackingTable);
        
        // Reset the select stub
        mockJobTrackingTable.select = sinon.stub();
        
        // Second find should use cache
        await runIdSystem.findJobTrackingRecord(runId, mockJobTrackingTable);
        
        expect(mockJobTrackingTable.find.calledOnce).to.be.true;
        expect(mockJobTrackingTable.find.firstCall.args[0]).to.equal(mockRecord.id);
        expect(mockJobTrackingTable.select.called).to.be.false;
      });
      
      it('should return null if no record is found', async () => {
        const runId = '231005-142532';
        
        mockJobTrackingTable.select = sinon.stub().returns({
          firstPage: sinon.stub().resolves([])
        });
        
        const result = await runIdSystem.findJobTrackingRecord(runId, mockJobTrackingTable);
        
        expect(result).to.be.null;
      });
    });
    
    describe('updateJobTrackingRecord()', () => {
      it('should update a job tracking record with new data', async () => {
        const runId = '231005-142532';
        const data = { 'Status': 'completed' };
        
        const result = await runIdSystem.updateJobTrackingRecord(runId, mockJobTrackingTable, data);
        
        expect(result).to.deep.include({
          fields: {
            'Run ID': '231005-142532',
            'Status': 'completed',
            'Last Updated': '2023-10-05T14:30:00.000Z'
          }
        });
        
        expect(mockJobTrackingTable.update.calledOnce).to.be.true;
        expect(mockJobTrackingTable.update.firstCall.args[0]).to.equal(mockRecord.id);
        expect(mockJobTrackingTable.update.firstCall.args[1]).to.deep.include({
          'Status': 'completed'
        });
      });
      
      it('should return null if record is not found', async () => {
        const runId = '231005-142532';
        
        // Set up to not find a record
        mockJobTrackingTable.select = sinon.stub().returns({
          firstPage: sinon.stub().resolves([])
        });
        
        const result = await runIdSystem.updateJobTrackingRecord(runId, mockJobTrackingTable, { 'Status': 'completed' });
        
        expect(result).to.be.null;
        expect(mockJobTrackingTable.update.called).to.be.false;
      });
    });
    
    describe('clearCache()', () => {
      it('should clear the cache for a specific run ID', async () => {
        const runId = '231005-142532';
        
        // First find to cache the record ID
        await runIdSystem.findJobTrackingRecord(runId, mockJobTrackingTable);
        
        // Clear cache for this run ID
        runIdSystem.clearCache(runId);
        
        // Reset stubs
        mockJobTrackingTable.find = sinon.stub();
        
        // Should not use cache now
        await runIdSystem.findJobTrackingRecord(runId, mockJobTrackingTable);
        
        expect(mockJobTrackingTable.find.called).to.be.false;
        expect(mockJobTrackingTable.select.called).to.be.true;
      });
      
      it('should clear all cache entries when no run ID is provided', async () => {
        const runId1 = '231005-142532';
        const runId2 = '231005-143000';
        
        // Cache two different run IDs
        mockJobTrackingTable.select = sinon.stub().returns({
          firstPage: sinon.stub().resolves([mockRecord])
        });
        
        await runIdSystem.findJobTrackingRecord(runId1, mockJobTrackingTable);
        await runIdSystem.findJobTrackingRecord(runId2, mockJobTrackingTable);
        
        // Clear all cache
        runIdSystem.clearCache();
        
        // Reset stubs
        mockJobTrackingTable.find = sinon.stub();
        mockJobTrackingTable.select = sinon.stub().returns({
          firstPage: sinon.stub().resolves([mockRecord])
        });
        
        // Should not use cache for either
        await runIdSystem.findJobTrackingRecord(runId1, mockJobTrackingTable);
        await runIdSystem.findJobTrackingRecord(runId2, mockJobTrackingTable);
        
        expect(mockJobTrackingTable.find.called).to.be.false;
        expect(mockJobTrackingTable.select.calledTwice).to.be.true;
      });
    });
  });
});