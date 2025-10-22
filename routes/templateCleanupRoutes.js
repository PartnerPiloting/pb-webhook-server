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
      'Connection Request Parameters'
    ];

    const TABLES_TO_KEEP = [
      'Scoring Attributes',
      'Post Scoring Attributes',
      'Post Scoring Instructions'
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

    // Step 2: Clear data tables (with memory-safe pagination)
    results.operations.push({ step: 'clearing', status: 'started' });
    let totalRecordsDeleted = 0;

    for (const tableName of TABLES_TO_CLEAR) {
      let tableRecordsDeleted = 0;
      let hasMore = true;
      
      results.operations.push({ 
        step: 'clearing', 
        table: tableName, 
        status: 'processing'
      });

      // Process in small batches to avoid memory issues
      while (hasMore) {
        try {
          // Fetch only 100 records at a time
          const batch = await base(tableName).select({
            maxRecords: 100
          }).firstPage();
          
          if (batch.length === 0) {
            hasMore = false;
            break;
          }

          if (dryRun) {
            tableRecordsDeleted += batch.length;
            hasMore = false; // In dry run, just count first page
          } else {
            // Delete in chunks of 10 (Airtable API limit)
            const BATCH_SIZE = 10;
            for (let i = 0; i < batch.length; i += BATCH_SIZE) {
              const chunk = batch.slice(i, i + BATCH_SIZE);
              const recordIds = chunk.map(r => r.id);
              await base(tableName).destroy(recordIds);
              tableRecordsDeleted += recordIds.length;
            }
            
            // Check if there are more records
            const remaining = await base(tableName).select({ maxRecords: 1 }).firstPage();
            hasMore = remaining.length > 0;
          }
        } catch (error) {
          results.operations.push({ 
            step: 'clearing', 
            table: tableName, 
            status: 'error',
            error: error.message,
            recordsDeletedBeforeError: tableRecordsDeleted
          });
          hasMore = false;
        }
      }

      totalRecordsDeleted += tableRecordsDeleted;
      results.operations.push({ 
        step: 'clearing', 
        table: tableName, 
        status: dryRun ? 'dry_run' : 'cleared',
        recordsDeleted: tableRecordsDeleted,
        action: dryRun ? `would delete ~${tableRecordsDeleted} records` : 'deleted'
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
          'Last LH Leads Export': null
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
          'Last LH Leads Export': null
        });
        
        results.operations.push({ 
          step: 'updating_credentials', 
          status: 'updated',
          action: 'updated with defaults',
          extrasDeleted: credRecords.length - 1
        });
      }
    }

    // Step 4: Verify seed data preserved (with memory-safe count)
    results.operations.push({ step: 'verification', status: 'started' });
    
    for (const tableName of TABLES_TO_KEEP) {
      try {
        // Just count records, don't load them all
        let recordCount = 0;
        let hasMore = true;
        
        while (hasMore) {
          const batch = await base(tableName).select({ maxRecords: 100 }).firstPage();
          recordCount += batch.length;
          
          if (batch.length < 100) {
            hasMore = false;
          } else {
            // Check if there are more
            const offset = batch[batch.length - 1].id;
            const next = await base(tableName).select({ 
              maxRecords: 1,
              filterByFormula: `RECORD_ID() != '${offset}'`
            }).firstPage();
            hasMore = next.length > 0;
          }
        }
        
        results.operations.push({ 
          step: 'verification', 
          table: tableName, 
          status: 'preserved',
          recordCount: recordCount
        });
      } catch (error) {
        results.operations.push({ 
          step: 'verification', 
          table: tableName, 
          status: 'error',
          error: error.message
        });
      }
    }

    // Step 5: Deep clean (delete all tables except core required ones)
    let tablesDeleted = 0;
    
    if (deepClean) {
      results.operations.push({ step: 'deep_clean', status: 'started' });
      
      // Define tables to keep (everything else gets deleted)
      const TABLES_TO_PRESERVE = [
        ...TABLES_TO_CLEAR,
        'Credentials',
        ...TABLES_TO_KEEP
      ];
      
      results.operations.push({ 
        step: 'deep_clean', 
        status: 'info',
        message: `Will preserve ${TABLES_TO_PRESERVE.length} core tables: ${TABLES_TO_PRESERVE.join(', ')}`,
        preservedTables: TABLES_TO_PRESERVE
      });
      
      // Get all tables from metadata API
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
          
          results.operations.push({ 
            step: 'deep_clean', 
            status: 'metadata_fetched',
            totalTables: tableMetadata.length,
            tableNames: tableMetadata.map(t => t.name)
          });
        }
      } catch (error) {
        results.operations.push({ 
          step: 'deep_clean', 
          status: 'metadata_fetch_failed',
          error: error.message
        });
        // Can't proceed with deep clean without metadata
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch table metadata for deep clean',
          details: error.message,
          results
        });
      }
      
      // Find tables to delete (all tables NOT in TABLES_TO_PRESERVE)
      const tablesToDelete = tableMetadata.filter(table => 
        !TABLES_TO_PRESERVE.includes(table.name)
      );
      
      results.operations.push({ 
        step: 'deep_clean', 
        status: 'identified_for_deletion',
        count: tablesToDelete.length,
        tables: tablesToDelete.map(t => t.name)
      });
      
      // Delete each unwanted table
      for (const tableInfo of tablesToDelete) {
        if (dryRun) {
          results.operations.push({ 
            step: 'deep_clean', 
            table: tableInfo.name, 
            status: 'dry_run',
            action: 'would delete table'
          });
          continue;
        }
        
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
              table: tableInfo.name, 
              tableId: tableInfo.id,
              status: 'deleted',
              method: 'api'
            });
          } else {
            const errorText = await deleteResponse.text();
            results.operations.push({ 
              step: 'deep_clean', 
              table: tableInfo.name, 
              status: 'delete_failed',
              statusCode: deleteResponse.status,
              error: errorText
            });
          }
        } catch (deleteError) {
          results.operations.push({ 
            step: 'deep_clean', 
            table: tableInfo.name, 
            status: 'error',
            error: deleteError.message
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
