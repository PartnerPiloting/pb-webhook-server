/**
 * routes/templateCleanupRoutes.js
 * 
 * API endpoints for cleaning template bases
 * Allows running the template cleanup script via HTTP requests
 */

const express = require('express');
const router = express.Router();
const Airtable = require('airtable');

// Security: Only allow if authenticated with webhook secret
const PB_WEBHOOK_SECRET = process.env.PB_WEBHOOK_SECRET;

/**
 * POST /api/template-cleanup/clean-base
 * 
 * Clean a duplicated template base by removing records and deleting legacy tables
 * 
 * Body: {
 *   "baseId": "appXXXXXXXXXXXX",
 *   "deepClean": true,  // optional, default false
 *   "dryRun": false     // optional, default false (shows what would be done without doing it)
 * }
 * 
 * Headers: {
 *   "Authorization": "Bearer YOUR_PB_WEBHOOK_SECRET"
 * }
 */
router.post('/clean-base', async (req, res) => {
  try {
    // Authentication
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${PB_WEBHOOK_SECRET}`) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - Invalid or missing Authorization header'
      });
    }

    const { baseId, deepClean = false, dryRun = false } = req.body;

    // Validation
    if (!baseId || !baseId.startsWith('app')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid baseId - must start with "app"'
      });
    }

    if (!process.env.AIRTABLE_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'AIRTABLE_API_KEY not configured on server'
      });
    }

    // Start cleanup process
    const results = {
      baseId,
      deepClean,
      dryRun,
      startTime: new Date().toISOString(),
      operations: [],
      summary: {}
    };

    const base = new Airtable({ 
      apiKey: process.env.AIRTABLE_API_KEY 
    }).base(baseId);

    // Tables configuration
    const TABLES_TO_CLEAR = [
      'Leads',
      'LinkedIn Posts',
      'Connection Request Parameters'
    ];

    const TABLES_TO_KEEP = [
      'Scoring Attributes',
      'Post Scoring Attributes',
      'Post Scoring Instructions'
    ];

    const TABLES_TO_DELETE = [
      'Connections',
      'Boolean Searches',
      'Concept Dictionary',
      'Name Parsing Rules',
      'Project Tasks',
      'Attributes Blob',
      'Campaigns',
      'Instructions + Thoughts',
      'Test Post Scoring',
      'Scoring Attributes 06 08 25'
    ];

    // Step 1: Validate tables
    results.operations.push({ step: 'validation', status: 'started' });
    const allRequiredTables = [...TABLES_TO_CLEAR, 'Credentials', ...TABLES_TO_KEEP];
    
    for (const tableName of allRequiredTables) {
      try {
        await base(tableName).select({ maxRecords: 1 }).firstPage();
        results.operations.push({ 
          step: 'validation', 
          table: tableName, 
          status: 'exists' 
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: `Required table not found: ${tableName}`,
          details: error.message
        });
      }
    }

    // Step 2: Clear data tables
    results.operations.push({ step: 'clearing', status: 'started' });
    let totalRecordsDeleted = 0;

    for (const tableName of TABLES_TO_CLEAR) {
      const records = await base(tableName).select().all();
      
      if (records.length === 0) {
        results.operations.push({ 
          step: 'clearing', 
          table: tableName, 
          status: 'already_empty',
          recordsDeleted: 0
        });
        continue;
      }

      if (dryRun) {
        results.operations.push({ 
          step: 'clearing', 
          table: tableName, 
          status: 'dry_run',
          recordsFound: records.length,
          action: 'would delete'
        });
        continue;
      }

      // Delete in batches of 10
      const BATCH_SIZE = 10;
      let deleted = 0;

      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const recordIds = batch.map(r => r.id);
        await base(tableName).destroy(recordIds);
        deleted += recordIds.length;
      }

      totalRecordsDeleted += deleted;
      results.operations.push({ 
        step: 'clearing', 
        table: tableName, 
        status: 'cleared',
        recordsDeleted: deleted
      });
    }

    // Step 3: Update Credentials
    results.operations.push({ step: 'updating_credentials', status: 'started' });
    
    const credRecords = await base('Credentials').select().all();
    
    if (dryRun) {
      results.operations.push({ 
        step: 'updating_credentials', 
        status: 'dry_run',
        recordsFound: credRecords.length,
        action: 'would update with defaults'
      });
    } else {
      if (credRecords.length === 0) {
        await base('Credentials').create({
          'AI Score Threshold Input': 50,
          'Posts Threshold Percentage': 30,
          'Last LH Leads Export': null,
          'Top Leads Last Export At': null
        });
        results.operations.push({ 
          step: 'updating_credentials', 
          status: 'created',
          action: 'created new record with defaults'
        });
      } else {
        // Delete extras, update first
        if (credRecords.length > 1) {
          const toDelete = credRecords.slice(1).map(r => r.id);
          for (let i = 0; i < toDelete.length; i += 10) {
            await base('Credentials').destroy(toDelete.slice(i, i + 10));
          }
        }
        
        await base('Credentials').update(credRecords[0].id, {
          'AI Score Threshold Input': 50,
          'Posts Threshold Percentage': 30,
          'Last LH Leads Export': null,
          'Top Leads Last Export At': null
        });
        
        results.operations.push({ 
          step: 'updating_credentials', 
          status: 'updated',
          action: 'updated with defaults',
          extrasDeleted: credRecords.length - 1
        });
      }
    }

    // Step 4: Verify seed data preserved
    results.operations.push({ step: 'verification', status: 'started' });
    
    for (const tableName of TABLES_TO_KEEP) {
      const records = await base(tableName).select().all();
      results.operations.push({ 
        step: 'verification', 
        table: tableName, 
        status: 'preserved',
        recordCount: records.length
      });
    }

    // Step 5: Deep clean (delete legacy tables)
    let tablesDeleted = 0;
    
    if (deepClean) {
      results.operations.push({ step: 'deep_clean', status: 'started' });
      
      // Get table metadata for deletion
      const metadataUrl = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;
      const headers = {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      };
      
      let tableMetadata = [];
      try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(metadataUrl, { headers });
        if (response.ok) {
          const data = await response.json();
          tableMetadata = data.tables || [];
        }
      } catch (error) {
        results.operations.push({ 
          step: 'deep_clean', 
          status: 'metadata_fetch_failed',
          error: error.message,
          fallback: 'will clear records only'
        });
      }
      
      for (const tableName of TABLES_TO_DELETE) {
        try {
          // Check if table exists
          try {
            await base(tableName).select({ maxRecords: 1 }).firstPage();
          } catch (error) {
            results.operations.push({ 
              step: 'deep_clean', 
              table: tableName, 
              status: 'not_found'
            });
            continue;
          }
          
          if (dryRun) {
            results.operations.push({ 
              step: 'deep_clean', 
              table: tableName, 
              status: 'dry_run',
              action: 'would delete table'
            });
            continue;
          }
          
          // Try to delete via API
          const tableInfo = tableMetadata.find(t => t.name === tableName);
          if (tableInfo && tableInfo.id) {
            try {
              const fetch = (await import('node-fetch')).default;
              const deleteUrl = `https://api.airtable.com/v0/meta/bases/${baseId}/tables/${tableInfo.id}`;
              const deleteResponse = await fetch(deleteUrl, {
                method: 'DELETE',
                headers
              });
              
              if (deleteResponse.ok) {
                tablesDeleted++;
                results.operations.push({ 
                  step: 'deep_clean', 
                  table: tableName, 
                  status: 'deleted',
                  method: 'api'
                });
                continue;
              }
            } catch (deleteError) {
              // Fall through to record clearing
            }
          }
          
          // Fallback: Clear all records
          const records = await base(tableName).select().all();
          if (records.length > 0) {
            const BATCH_SIZE = 10;
            for (let i = 0; i < records.length; i += BATCH_SIZE) {
              const batch = records.slice(i, i + BATCH_SIZE);
              await base(tableName).destroy(batch.map(r => r.id));
            }
            results.operations.push({ 
              step: 'deep_clean', 
              table: tableName, 
              status: 'cleared',
              method: 'records_only',
              recordsDeleted: records.length
            });
          }
          
        } catch (error) {
          results.operations.push({ 
            step: 'deep_clean', 
            table: tableName, 
            status: 'error',
            error: error.message
          });
        }
      }
    }

    // Summary
    results.summary = {
      totalRecordsDeleted,
      tablesCleared: TABLES_TO_CLEAR.length,
      tablesPreserved: TABLES_TO_KEEP.length,
      tablesDeleted: deepClean ? tablesDeleted : 0,
      credentialsUpdated: !dryRun,
      dryRun
    };

    results.endTime = new Date().toISOString();
    results.duration = `${Math.round((new Date(results.endTime) - new Date(results.startTime)) / 1000)}s`;

    return res.json({
      success: true,
      message: dryRun ? 'Dry run completed - no changes made' : 'Template base cleaned successfully',
      results
    });

  } catch (error) {
    console.error('Template cleanup error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/template-cleanup/help
 * 
 * Show help information for the cleanup endpoint
 */
router.get('/help', (req, res) => {
  res.json({
    endpoint: 'POST /api/template-cleanup/clean-base',
    description: 'Clean a duplicated Airtable base to create a client template',
    authentication: {
      header: 'Authorization',
      format: 'Bearer YOUR_PB_WEBHOOK_SECRET',
      secret: 'Use PB_WEBHOOK_SECRET environment variable'
    },
    body: {
      baseId: {
        type: 'string',
        required: true,
        description: 'Airtable base ID (starts with "app")',
        example: 'appXySOLo6V9PfMfa'
      },
      deepClean: {
        type: 'boolean',
        required: false,
        default: false,
        description: 'Delete legacy tables permanently'
      },
      dryRun: {
        type: 'boolean',
        required: false,
        default: false,
        description: 'Show what would be done without making changes'
      }
    },
    examples: {
      curl: `curl -X POST https://pb-webhook-server-staging.onrender.com/api/template-cleanup/clean-base \\
  -H "Authorization: Bearer YOUR_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"baseId":"appXXXXXXXXXXXX","deepClean":true}'`,
      postman: {
        method: 'POST',
        url: 'https://pb-webhook-server-staging.onrender.com/api/template-cleanup/clean-base',
        headers: {
          'Authorization': 'Bearer YOUR_PB_WEBHOOK_SECRET',
          'Content-Type': 'application/json'
        },
        body: {
          baseId: 'appXXXXXXXXXXXX',
          deepClean: true,
          dryRun: false
        }
      }
    },
    workflow: [
      '1. Duplicate Guy Wilson base in Airtable (with records)',
      '2. Copy the new base ID from URL',
      '3. (Optional) Test with dryRun: true to see what would happen',
      '4. Run with deepClean: true to create template',
      '5. Rename base to "Template - Client Leads"',
      '6. Use this template for future client onboarding'
    ]
  });
});

module.exports = router;
