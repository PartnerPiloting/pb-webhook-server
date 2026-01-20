/**
 * Generate Portal Tokens for Existing Clients
 * 
 * This script generates unique portal tokens for all clients
 * and updates their records in Airtable.
 * 
 * Usage:
 *   node generate-portal-tokens.js           # Generate for all clients without tokens
 *   node generate-portal-tokens.js --force   # Regenerate ALL tokens (even existing)
 *   node generate-portal-tokens.js --dry-run # Show what would happen without updating
 * 
 * Requirements:
 *   - AIRTABLE_API_KEY environment variable
 *   - MASTER_CLIENTS_BASE_ID environment variable
 *   - "Portal Token" field must exist in Clients table
 */

require('dotenv').config();
const Airtable = require('airtable');
const crypto = require('crypto');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const MASTER_CLIENTS_BASE_ID = process.env.MASTER_CLIENTS_BASE_ID;

if (!AIRTABLE_API_KEY || !MASTER_CLIENTS_BASE_ID) {
    console.error('❌ Missing required environment variables:');
    if (!AIRTABLE_API_KEY) console.error('   - AIRTABLE_API_KEY');
    if (!MASTER_CLIENTS_BASE_ID) console.error('   - MASTER_CLIENTS_BASE_ID');
    process.exit(1);
}

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(MASTER_CLIENTS_BASE_ID);

// Parse command line arguments
const args = process.argv.slice(2);
const forceRegenerate = args.includes('--force');
const dryRun = args.includes('--dry-run');

/**
 * Generate a secure random token
 * Format: 24 character alphanumeric (URL-safe)
 */
function generateToken() {
    return crypto.randomBytes(18).toString('base64url');
}

async function main() {
    console.log('🔐 Portal Token Generator\n');
    console.log('Mode:', dryRun ? 'DRY RUN (no changes)' : (forceRegenerate ? 'FORCE (regenerate all)' : 'NORMAL (new tokens only)'));
    console.log('');

    try {
        // Fetch all clients
        const clients = [];
        await base('Clients').select({
            fields: ['Client ID', 'Client Name', 'Client Email Address', 'Status', 'Portal Token']
        }).eachPage((records, fetchNextPage) => {
            records.forEach(record => {
                clients.push({
                    id: record.id,
                    clientId: record.get('Client ID'),
                    clientName: record.get('Client Name'),
                    email: record.get('Client Email Address'),
                    status: record.get('Status'),
                    existingToken: record.get('Portal Token')
                });
            });
            fetchNextPage();
        });

        console.log(`📋 Found ${clients.length} clients\n`);

        // Filter to clients that need tokens
        const clientsNeedingTokens = forceRegenerate 
            ? clients.filter(c => c.status === 'Active')
            : clients.filter(c => c.status === 'Active' && !c.existingToken);

        if (clientsNeedingTokens.length === 0) {
            console.log('✅ All active clients already have portal tokens!');
            console.log('\nTo regenerate all tokens, run: node generate-portal-tokens.js --force');
            return;
        }

        console.log(`🔑 Generating tokens for ${clientsNeedingTokens.length} client(s):\n`);

        const results = [];

        for (const client of clientsNeedingTokens) {
            const newToken = generateToken();
            const portalUrl = `https://ashportal.com.au/quick-update?token=${newToken}`;

            console.log(`  ${client.clientName} (${client.clientId})`);
            console.log(`    Email: ${client.email || 'N/A'}`);
            console.log(`    Token: ${newToken}`);
            console.log(`    URL:   ${portalUrl}`);
            console.log('');

            if (!dryRun) {
                // Update Airtable
                await base('Clients').update(client.id, {
                    'Portal Token': newToken
                });
                console.log(`    ✅ Updated in Airtable\n`);
            }

            results.push({
                clientId: client.clientId,
                clientName: client.clientName,
                email: client.email,
                token: newToken,
                url: portalUrl
            });

            // Rate limiting - Airtable allows 5 requests/second
            await new Promise(resolve => setTimeout(resolve, 250));
        }

        // Summary
        console.log('═'.repeat(60));
        console.log('\n📊 SUMMARY\n');
        console.log(`Total clients processed: ${results.length}`);
        
        if (dryRun) {
            console.log('\n⚠️  DRY RUN - No changes were made to Airtable');
            console.log('   Run without --dry-run to apply changes');
        } else {
            console.log('\n✅ All tokens have been saved to Airtable');
        }

        // Output as CSV for easy sharing with coaches
        console.log('\n📧 CLIENT LINKS (copy this for distribution):\n');
        console.log('Client Name,Email,Portal URL');
        results.forEach(r => {
            console.log(`${r.clientName},${r.email || ''},${r.url}`);
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main();
