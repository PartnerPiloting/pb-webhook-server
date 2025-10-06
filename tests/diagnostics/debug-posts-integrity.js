const { getClientBase } = require('./config/airtableClient');

async function checkPostsIntegrity() {
  try {
    console.log('🔍 Checking Posts Content integrity for Dean Hobin...');
    
    const clientBase = await getClientBase('Dean-Hobin');
    if (!clientBase) {
      console.log('❌ Could not connect to Dean Hobin base');
      return;
    }
    
    console.log('✅ Connected to Dean Hobin base');
    
    // Get all records with Posts Harvest Status = "Done"
    const doneRecords = await clientBase('Leads').select({
      filterByFormula: `{Posts Harvest Status} = 'Done'`,
      fields: [
        'First Name',
        'Last Name', 
        'Posts Harvest Status',
        'Posts Content',
        'LinkedIn Profile URL',
        'Date Posts Scored'
      ]
    }).all();
    
    console.log(`\n📊 Found ${doneRecords.length} records with Posts Harvest Status = "Done"`);
    
    let withContent = 0;
    let emptyContent = 0;
    const problematicRecords = [];
    
    doneRecords.forEach((record, index) => {
      const firstName = record.get('First Name') || 'Unknown';
      const lastName = record.get('Last Name') || 'Unknown';
      const postsContent = record.get('Posts Content');
      const linkedinUrl = record.get('LinkedIn Profile URL') || 'No URL';
      const dateScored = record.get('Date Posts Scored');
      
      const hasContent = postsContent && String(postsContent).trim().length > 0;
      
      if (hasContent) {
        withContent++;
        console.log(`  ${index + 1}. ✅ ${firstName} ${lastName}: Has content (${String(postsContent).length} chars) ${dateScored ? '- ALREADY SCORED' : '- READY FOR SCORING'}`);
      } else {
        emptyContent++;
        problematicRecords.push({
          name: `${firstName} ${lastName}`,
          url: linkedinUrl,
          recordId: record.id
        });
        console.log(`  ${index + 1}. ❌ ${firstName} ${lastName}: EMPTY Posts Content (${linkedinUrl})`);
      }
    });
    
    console.log(`\n📈 SUMMARY:`);
    console.log(`  - Records with "Done" status: ${doneRecords.length}`);
    console.log(`  - With Posts Content: ${withContent} ✅`);
    console.log(`  - Empty Posts Content: ${emptyContent} ❌`);
    console.log(`  - Data integrity: ${emptyContent === 0 ? 'GOOD' : 'BROKEN'}`);
    
    if (emptyContent > 0) {
      console.log(`\n🚨 DATA INTEGRITY ISSUE DETECTED:`);
      console.log(`${emptyContent} records marked as "Done" have empty Posts Content!`);
      console.log(`This explains why scoring finds 0 posts - they're harvested but not synchronized.`);
      
      console.log(`\nProblematic records:`);
      problematicRecords.forEach((record, i) => {
        console.log(`  ${i + 1}. ${record.name} (${record.recordId})`);
        console.log(`     URL: ${record.url}`);
      });
    }
    
    // Also check if any records have Posts Content but are NOT marked as Done
    console.log(`\n🔄 Checking reverse integrity: Records with content but not marked "Done"...`);
    
    const contentRecords = await clientBase('Leads').select({
      filterByFormula: `AND({Posts Content} != '', {Posts Harvest Status} != 'Done')`,
      fields: [
        'First Name',
        'Last Name', 
        'Posts Harvest Status',
        'Posts Content'
      ]
    }).all();
    
    console.log(`Found ${contentRecords.length} records with Posts Content but status ≠ "Done"`);
    contentRecords.forEach((record, index) => {
      const firstName = record.get('First Name') || 'Unknown';
      const lastName = record.get('Last Name') || 'Unknown';
      const status = record.get('Posts Harvest Status') || 'No status';
      const contentLength = String(record.get('Posts Content') || '').length;
      console.log(`  ${index + 1}. ${firstName} ${lastName}: Status="${status}", Content=${contentLength} chars`);
    });
    
  } catch (error) {
    console.error('❌ Error checking posts integrity:', error.message);
  }
}

checkPostsIntegrity();