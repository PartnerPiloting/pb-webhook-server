// check-smart-resume-debug-logs.js
// A simple script to check for our enhanced logging markers

async function checkDebugLogs() {
  const { default: fetch } = await import('node-fetch');
  
  console.log('Fetching logs from Render to check our debug markers...');
  
  try {
    const response = await fetch('https://pb-webhook-server-staging.onrender.com/debug-logs?lines=500', {
      headers: {
        'x-webhook-secret': 'Diamond9753!!@@pb'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch logs: ${response.status} ${response.statusText}`);
    }
    
    const logs = await response.text();
    const lines = logs.split('\n');
    
    // Look for our debug markers
    const unscoredCheckLines = lines.filter(line => line.includes('🚨 UNSCORED CHECK'));
    const postDecisionLines = lines.filter(line => line.includes('🚨 POST SCORING DECISION'));
    const overrideLines = lines.filter(line => line.includes('🚨 POST SCORING OVERRIDE'));
    const guyWilsonLines = lines.filter(line => line.includes('Guy-Wilson'));
    
    console.log(`\n=== Found ${unscoredCheckLines.length} UNSCORED CHECK logs ===`);
    unscoredCheckLines.forEach(line => console.log(line));
    
    console.log(`\n=== Found ${postDecisionLines.length} POST SCORING DECISION logs ===`);
    postDecisionLines.forEach(line => console.log(line));
    
    console.log(`\n=== Found ${overrideLines.length} POST SCORING OVERRIDE logs ===`);
    overrideLines.forEach(line => console.log(line));
    
    console.log(`\n=== Found ${guyWilsonLines.length} Guy-Wilson specific logs ===`);
    guyWilsonLines.forEach(line => console.log(line));
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkDebugLogs();