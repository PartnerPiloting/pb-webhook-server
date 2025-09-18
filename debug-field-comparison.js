const { getClientBase } = require('./config/airtableClient');

async function compareBaseStructures() {
  try {
    console.log('🔍 Comparing field structures between Guy Wilson and Dean Hobin bases...');
    
    // Connect to both bases
    const guyBase = await getClientBase('Guy-Wilson');
    const deanBase = await getClientBase('Dean-Hobin');
    
    if (!guyBase || !deanBase) {
      console.log('❌ Could not connect to one or both bases');
      return;
    }
    
    console.log('✅ Connected to both bases');
    
    // Get field names from Guy Wilson's Leads table
    console.log('\n📋 Getting Guy Wilson field structure...');
    const guyRecords = await guyBase('Leads').select({ maxRecords: 1 }).firstPage();
    const guyFields = guyRecords.length > 0 ? Object.keys(guyRecords[0].fields) : [];
    
    // Get field names from Dean Hobin's Leads table  
    console.log('📋 Getting Dean Hobin field structure...');
    const deanRecords = await deanBase('Leads').select({ maxRecords: 1 }).firstPage();
    const deanFields = deanRecords.length > 0 ? Object.keys(deanRecords[0].fields) : [];
    
    console.log(`\n📊 FIELD COMPARISON:`);
    console.log(`Guy Wilson fields: ${guyFields.length}`);
    console.log(`Dean Hobin fields: ${deanFields.length}`);
    
    // Check for critical post-related fields
    const criticalFields = [
      'Posts Content',
      'Posts Harvest Status', 
      'Date Posts Scored',
      'Posts Relevance Score',
      'LinkedIn Profile URL'
    ];
    
    console.log(`\n🔍 CRITICAL FIELD CHECK:`);
    criticalFields.forEach(field => {
      const inGuy = guyFields.includes(field);
      const inDean = deanFields.includes(field);
      const status = inGuy && inDean ? '✅ BOTH' : 
                     inGuy && !inDean ? '⚠️  GUY ONLY' :
                     !inGuy && inDean ? '⚠️  DEAN ONLY' :
                     '❌ NEITHER';
      console.log(`  ${field}: ${status}`);
    });
    
    // Find fields in Guy but not Dean
    const missingInDean = guyFields.filter(f => !deanFields.includes(f));
    if (missingInDean.length > 0) {
      console.log(`\n⚠️  FIELDS IN GUY WILSON BUT MISSING IN DEAN HOBIN (${missingInDean.length}):`);
      missingInDean.forEach(field => console.log(`  - ${field}`));
    }
    
    // Find fields in Dean but not Guy
    const missingInGuy = deanFields.filter(f => !guyFields.includes(f));
    if (missingInGuy.length > 0) {
      console.log(`\n⚠️  FIELDS IN DEAN HOBIN BUT MISSING IN GUY WILSON (${missingInGuy.length}):`);
      missingInGuy.forEach(field => console.log(`  - ${field}`));
    }
    
    // Look for similar field names that might be variants
    console.log(`\n🔍 LOOKING FOR SIMILAR POST-RELATED FIELDS:`);
    const postRelatedPatterns = ['post', 'content', 'harvest', 'score', 'linkedin'];
    
    postRelatedPatterns.forEach(pattern => {
      const guyMatches = guyFields.filter(f => f.toLowerCase().includes(pattern));
      const deanMatches = deanFields.filter(f => f.toLowerCase().includes(pattern));
      
      if (guyMatches.length > 0 || deanMatches.length > 0) {
        console.log(`\n  Fields containing "${pattern}":`);
        console.log(`    Guy Wilson: ${guyMatches.join(', ') || 'none'}`);
        console.log(`    Dean Hobin: ${deanMatches.join(', ') || 'none'}`);
      }
    });
    
    // Check if Guy Wilson has Posts Content with actual data
    console.log(`\n📊 CHECKING GUY WILSON POSTS CONTENT SAMPLE:`);
    try {
      const guyWithPosts = await guyBase('Leads').select({
        filterByFormula: `{Posts Content} != ''`,
        fields: ['First Name', 'Last Name', 'Posts Content', 'Posts Harvest Status'],
        maxRecords: 3
      }).firstPage();
      
      console.log(`Found ${guyWithPosts.length} Guy Wilson records with Posts Content`);
      guyWithPosts.forEach((record, i) => {
        const firstName = record.get('First Name') || 'Unknown';
        const lastName = record.get('Last Name') || 'Unknown';
        const content = record.get('Posts Content') || '';
        const status = record.get('Posts Harvest Status') || 'No status';
        console.log(`  ${i + 1}. ${firstName} ${lastName}: Status="${status}", Content=${content.length} chars`);
      });
    } catch (error) {
      console.log(`Error checking Guy Wilson posts: ${error.message}`);
    }
    
  } catch (error) {
    console.error('❌ Error comparing base structures:', error.message);
  }
}

compareBaseStructures();