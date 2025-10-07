// Simple script to get Error 17 details
require('dotenv').config();

async function getError17Details() {
  try {
    // Import after env is loaded
    const errorLogger = require('./utils/errorLogger');
    
    console.log('\n🔍 Querying Error Log for new errors...\n');
    
    const errors = await errorLogger.getNewErrors({ maxRecords: 50 });
    
    console.log(`Found ${errors.length} NEW errors\n`);
    
    // Find the specific one from the logs (timestamp ~4:18 AM)
    const targetTime = new Date('2025-10-07T04:18:00Z');
    const targetError = errors.find(e => {
      const errorTime = new Date(e.timestamp);
      const timeDiff = Math.abs(errorTime - targetTime);
      return timeDiff < 5 * 60 * 1000; // Within 5 minutes
    });
    
    if (targetError) {
      console.log('📋 ERROR 17 DETAILS (from ~4:18 AM):');
      console.log('=====================================');
      console.log(JSON.stringify(targetError, null, 2));
      console.log('\n=====================================\n');
    } else {
      console.log('⚠️  Error from 4:18 AM not found in NEW errors');
      console.log('\nShowing all NEW errors:');
      errors.forEach((err, idx) => {
        console.log(`\n--- Error ${idx + 1} ---`);
        console.log(`Timestamp: ${err.timestamp}`);
        console.log(`Type: ${err.errorType}`);
        console.log(`Message: ${err.message}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Failed:', error.message);
    console.error(error.stack);
  }
}

getError17Details().then(() => process.exit(0));
