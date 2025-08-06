#!/usr/bin/env node

// JSON Response Cleaner - Extracts JSON from AI responses wrapped in markdown

function cleanAIResponse(rawResponse) {
    console.log('🧹 Cleaning AI response...');
    console.log(`📏 Raw response length: ${rawResponse.length} characters`);
    
    let cleaned = rawResponse.trim();
    
    // Remove markdown code block formatting
    if (cleaned.startsWith('```json')) {
        console.log('🔍 Detected markdown JSON code block');
        cleaned = cleaned.replace(/^```json\s*/, '');
        cleaned = cleaned.replace(/\s*```$/, '');
        console.log('✅ Removed markdown formatting');
    } else if (cleaned.startsWith('```')) {
        console.log('🔍 Detected generic markdown code block');
        cleaned = cleaned.replace(/^```\s*/, '');
        cleaned = cleaned.replace(/\s*```$/, '');
        console.log('✅ Removed markdown formatting');
    }
    
    // Clean up any remaining formatting issues
    cleaned = cleaned.trim();
    
    console.log(`📏 Cleaned response length: ${cleaned.length} characters`);
    console.log(`📄 Cleaned response preview: "${cleaned.substring(0, 100)}..."`);
    
    return cleaned;
}

// Test with the problematic response
const problematicResponse = `\`\`\`json
{
  "score": 92,
  "reasoning": "This is an exceptionally strong LinkedIn profile..."
}
\`\`\``;

console.log('🔍 TESTING JSON RESPONSE CLEANER');
console.log('='.repeat(60));

console.log('\n1. 📊 Testing with problematic response...');
const cleaned = cleanAIResponse(problematicResponse);

console.log('\n2. 🧪 Testing JSON parsing...');
try {
    const parsed = JSON.parse(cleaned);
    console.log('✅ Successfully parsed cleaned JSON!');
    console.log(`📊 Score: ${parsed.score}`);
    console.log(`💭 Reasoning: ${parsed.reasoning.substring(0, 100)}...`);
} catch (parseError) {
    console.log('❌ Still failed to parse:', parseError.message);
}

console.log('\n3. 🛠️ IMPLEMENTATION PLAN:');
console.log('   📋 Steps to fix the production issue:');
console.log('      1. Add this cleaning function to the scoring pipeline');
console.log('      2. Apply it before JSON.parse() in singleScorer.js');
console.log('      3. Test with the failing leads');
console.log('      4. Deploy the fix to production');

console.log('\n4. 🎯 ROOT CAUSE IDENTIFIED:');
console.log('   🚨 AI model (Gemini Flash) returns JSON wrapped in markdown');
console.log('   💡 Scoring system expects raw JSON');
console.log('   🔧 Solution: Strip markdown formatting before parsing');

module.exports = { cleanAIResponse };
