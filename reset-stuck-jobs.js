// Quick script to reset stuck post scoring job for Guy Wilson
require('dotenv').config();
const clientService = require('./services/clientService');

async function resetStuckJobs() {
    console.log('🔄 Attempting to reset stuck post scoring jobs...');
    
    try {
        // Reset Guy Wilson
        console.log('🔄 Resetting Guy Wilson post scoring job status...');
        await clientService.setJobStatus('Guy-Wilson', 'post_scoring', 'COMPLETED', `manual_reset_${Date.now()}`);
        console.log('✅ Successfully reset Guy Wilson job status');
        
        // Also reset Dean Hobin
        console.log('🔄 Resetting Dean Hobin post scoring job status...');
        await clientService.setJobStatus('Dean-Hobin', 'post_scoring', 'COMPLETED', `manual_reset_${Date.now()}`);
        console.log('✅ Successfully reset Dean Hobin job status');
        
        console.log('✅ All job statuses reset successfully');
    } catch (error) {
        console.error('❌ Error resetting job status:', error);
    }
    
    // Also clear in-memory locks by restarting the server if needed
    console.log('\nNOTE: In-memory locks will be cleared when you restart the server.');
    console.log('If you\'re running locally, restart your server after running this script.');
}

resetStuckJobs();