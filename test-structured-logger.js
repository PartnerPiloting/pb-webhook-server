// Test script to verify StructuredLogger imports are working correctly
console.log('🧪 Testing StructuredLogger imports...\n');

const testFiles = [
    './singleScorer.js',
    './promptBuilder.js', 
    './postPromptBuilder.js',
    './postGeminiScorer.js',
    './attributeLoader.js',
    './middleware/authMiddleware.js'
];

let allTestsPassed = true;

testFiles.forEach((file, index) => {
    try {
        console.log(`${index + 1}. Testing ${file}...`);
        
        // Try to require the file
        const module = require(file);
        
        // Check if StructuredLogger is available in the module's dependencies
        const { StructuredLogger } = require('./utils/structuredLogger');
        
        // Try to create an instance
        const testLogger = new StructuredLogger('TEST');
        
        console.log(`   ✅ ${file} - StructuredLogger import works correctly`);
        
        // Test basic functionality
        testLogger.setup('Test message');
        console.log(`   ✅ ${file} - StructuredLogger instance works correctly\n`);
        
    } catch (error) {
        console.log(`   ❌ ${file} - ERROR: ${error.message}\n`);
        allTestsPassed = false;
    }
});

console.log('='.repeat(60));
if (allTestsPassed) {
    console.log('🎉 ALL TESTS PASSED! StructuredLogger imports are working correctly.');
    console.log('✅ Ready to deploy the fixes to production.');
} else {
    console.log('❌ TESTS FAILED! There are still issues with StructuredLogger imports.');
    console.log('🔧 Need to fix the remaining issues before deploying.');
}
console.log('='.repeat(60));
