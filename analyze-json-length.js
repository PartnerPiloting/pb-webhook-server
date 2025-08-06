#!/usr/bin/env node

require('dotenv').config();
const airtableClient = require('./config/airtableClient');

async function analyzeJSONLength() {
    console.log('🔍 ANALYZING JSON LENGTH VS AI MODEL LIMITS');
    console.log('='.repeat(80));
    console.log('Hypothesis: AI scoring is truncating JSON due to length limits');
    
    try {
        const base = airtableClient;
        
        console.log('\n1. 📊 Fetching the target lead...');
        const record = await base('Leads').find('recHkqPSMfdQWyqus');
        
        const profileJSON = record.get('Profile Full JSON');
        const name = record.get('Name') || 'Unknown';
        const company = record.get('Company') || 'Unknown';
        
        console.log(`   ✅ Lead: ${name} (${company})`);
        console.log(`   📏 JSON Length: ${profileJSON.length} characters`);
        
        console.log('\n2. 🤖 AI Model Limits Analysis:');
        
        // Common AI model limits
        const modelLimits = {
            'GPT-4': { tokens: 8192, chars: ~32000 },
            'GPT-4 Turbo': { tokens: 128000, chars: ~512000 },
            'Gemini Pro': { tokens: 32768, chars: ~131000 },
            'Gemini Flash': { tokens: 1000000, chars: ~4000000 },
            'Claude 3': { tokens: 200000, chars: ~800000 }
        };
        
        console.log('   📋 Model Context Limits:');
        Object.entries(modelLimits).forEach(([model, limits]) => {
            const status = profileJSON.length > limits.chars ? '❌ EXCEEDS' : '✅ Within';
            console.log(`      ${model}: ${limits.chars.toLocaleString()} chars - ${status}`);
        });
        
        // Check current model being used
        const currentModel = process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash';
        console.log(`\n   🎯 Current Model: ${currentModel}`);
        
        if (currentModel.includes('flash')) {
            console.log('   ✅ Gemini Flash should handle this JSON size easily');
        } else if (currentModel.includes('pro')) {
            if (profileJSON.length > 131000) {
                console.log('   🚨 JSON might be too long for Gemini Pro!');
            } else {
                console.log('   ✅ JSON should fit in Gemini Pro context');
            }
        }
        
        console.log('\n3. 📄 JSON Structure Analysis:');
        
        try {
            const parsed = JSON.parse(profileJSON);
            console.log('   ✅ JSON is currently valid');
            
            // Analyze structure
            const keys = Object.keys(parsed);
            console.log(`   📋 Top-level keys: ${keys.join(', ')}`);
            
            // Check for large sections
            keys.forEach(key => {
                const value = parsed[key];
                if (typeof value === 'string') {
                    console.log(`   📏 ${key}: ${value.length} characters`);
                } else if (Array.isArray(value)) {
                    console.log(`   📏 ${key}: ${value.length} items`);
                } else if (typeof value === 'object') {
                    const jsonStr = JSON.stringify(value);
                    console.log(`   📏 ${key}: ${jsonStr.length} characters (object)`);
                }
            });
            
        } catch (parseError) {
            console.log('   ❌ JSON is corrupted - analyzing raw structure');
        }
        
        console.log('\n4. 🔍 Position 2486 Analysis:');
        console.log('   (Where the production error occurred)');
        
        if (profileJSON.length >= 2486) {
            const contextSize = 50;
            const beforePos = profileJSON.substring(Math.max(0, 2486 - contextSize), 2486);
            const atPos = profileJSON.charAt(2486);
            const afterPos = profileJSON.substring(2486 + 1, Math.min(profileJSON.length, 2486 + contextSize));
            
            console.log(`   📄 Before position 2486: "${beforePos}"`);
            console.log(`   🎯 Character at 2486: "${atPos}" (ASCII: ${atPos.charCodeAt(0)})`);
            console.log(`   📄 After position 2486: "${afterPos}"`);
            
            // Check if this area looks like it could be truncated/corrupted
            if (atPos === '' || atPos.charCodeAt(0) < 32) {
                console.log('   🚨 Suspicious character at position 2486!');
            }
        } else {
            console.log('   ❌ JSON is shorter than 2486 characters');
        }
        
        console.log('\n5. 💡 Truncation Analysis:');
        
        // Check if JSON ends abruptly
        const lastChars = profileJSON.slice(-100);
        console.log(`   📄 Last 100 characters: "${lastChars}"`);
        
        // Look for signs of truncation
        const truncationSigns = [
            { pattern: /[^}\]]\s*$/, desc: 'Ends without proper closing' },
            { pattern: /,\s*$/, desc: 'Ends with comma (incomplete)' },
            { pattern: /:\s*$/, desc: 'Ends with colon (incomplete value)' },
            { pattern: /"\s*$/, desc: 'Ends with unterminated string' }
        ];
        
        let foundTruncation = false;
        truncationSigns.forEach(sign => {
            if (sign.pattern.test(profileJSON)) {
                console.log(`   🚨 TRUNCATION SIGN: ${sign.desc}`);
                foundTruncation = true;
            }
        });
        
        if (!foundTruncation) {
            console.log('   ✅ No obvious truncation signs detected');
        }
        
        console.log('\n6. 🛠️ Potential Solutions:');
        
        if (profileJSON.length > 100000) {
            console.log('   💡 JSON is quite large. Potential solutions:');
            console.log('      • Compress/minify the JSON before AI processing');
            console.log('      • Split JSON into smaller chunks for processing');
            console.log('      • Remove unnecessary fields before AI analysis');
            console.log('      • Use a model with larger context window');
        }
        
        if (foundTruncation) {
            console.log('   💡 Truncation detected. Potential solutions:');
            console.log('      • Repair the truncated JSON');
            console.log('      • Re-fetch the complete profile data');
            console.log('      • Implement retry logic for incomplete data');
        }
        
        console.log('\n7. 🧪 Next Steps:');
        console.log('   📋 Test Recommendations:');
        console.log('      1. Check other failing leads for similar length patterns');
        console.log('      2. Test AI scoring with a shortened version of this JSON');
        console.log('      3. Monitor AI model response truncation during scoring');
        console.log('      4. Implement JSON compression if length is the issue');
        
    } catch (error) {
        console.error('❌ Error analyzing JSON length:', error.message);
    }
}

analyzeJSONLength();
