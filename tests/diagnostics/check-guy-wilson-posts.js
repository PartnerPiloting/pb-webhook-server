// check-guy-wilson-posts.js
// Script to directly check Guy-Wilson client's post data and view configuration

require('dotenv').config();
const { getClientBase } = require('./config/airtableClient');
const clientService = require('./services/clientService');

async function checkGuyWilsonPostData() {
  try {
    console.log('📊 Checking Guy-Wilson client post data...');
    
    // Get client info
    const clients = await clientService.getActiveClients('Guy-Wilson');
    if (clients.length === 0) {
      console.error('❌ Guy-Wilson client not found!');
      return;
    }
    
    const client = clients[0];
    console.log(`✅ Found client: ${client.clientName} (${client.clientId})`);
    
    // Get client base
    const clientBase = await getClientBase(client.clientId);
    if (!clientBase) {
      console.error('❌ Could not get client base!');
      return;
    }
    
    // Check if the view exists
    console.log('📋 Checking view "Leads with Posts not yet scored"...');
    try {
      // Try to list views
      const table = await clientBase('Leads').table();
      console.log('Available views:');
      table.views.forEach(view => {
        console.log(`- ${view.name}`);
      });
      
      // Check if our view exists
      const viewExists = table.views.some(v => v.name === 'Leads with Posts not yet scored');
      console.log(`View "Leads with Posts not yet scored" exists: ${viewExists ? 'YES' : 'NO'}`);
    } catch (viewError) {
      console.error('❌ Error checking views:', viewError.message);
    }
    
    // Method 1: Use the view directly
    console.log('\n🔍 METHOD 1: Using view "Leads with Posts not yet scored"');
    try {
      const viewRecords = await clientBase('Leads').select({
        view: 'Leads with Posts not yet scored'
      }).firstPage();
      
      console.log(`Found ${viewRecords.length} records using the view`);
      
      if (viewRecords.length > 0) {
        // Show sample record details
        console.log('\nSample record details:');
        const sample = viewRecords[0];
        console.log(`ID: ${sample.id}`);
        console.log(`Name: ${sample.fields['Full Name'] || 'N/A'}`);
        console.log(`Posts content available: ${sample.fields['Posts Content'] ? 'YES' : 'NO'}`);
        console.log(`Date Posts Scored: ${sample.fields['Date Posts Scored'] || 'N/A'}`);
        
        // Check post content structure
        if (sample.fields['Posts Content']) {
          const postsContent = sample.fields['Posts Content'];
          console.log(`Posts content type: ${typeof postsContent}`);
          if (typeof postsContent === 'string') {
            console.log(`Posts content length: ${postsContent.length} chars`);
          } else if (Array.isArray(postsContent)) {
            console.log(`Posts content array length: ${postsContent.length} items`);
          }
        }
      }
    } catch (viewError) {
      console.error(`❌ Error using view: ${viewError.message}`);
    }
    
    // Method 2: Use filterByFormula (fallback method)
    console.log('\n🔍 METHOD 2: Using filterByFormula');
    try {
      const formulaRecords = await clientBase('Leads').select({
        filterByFormula: "AND({Posts Content} != '', {Date Posts Scored} = BLANK())"
      }).firstPage();
      
      console.log(`Found ${formulaRecords.length} records using the formula`);
      
      if (formulaRecords.length > 0) {
        // List all record IDs
        console.log('\nAll record IDs:');
        formulaRecords.forEach(record => {
          console.log(`- ${record.id}: ${record.fields['Full Name'] || 'N/A'}`);
          
          // Check if the post content is parseable JSON
          if (record.fields['Posts Content']) {
            try {
              let content = record.fields['Posts Content'];
              if (typeof content === 'string') {
                JSON.parse(content);
                console.log(`  Posts content is valid JSON: YES`);
              } else {
                console.log(`  Posts content is not a string: ${typeof content}`);
              }
            } catch (e) {
              console.log(`  Posts content is valid JSON: NO (${e.message})`);
            }
          }
        });
      }
    } catch (formulaError) {
      console.error(`❌ Error using formula: ${formulaError.message}`);
    }
    
    console.log('\n✅ Check completed');
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkGuyWilsonPostData().catch(console.error);