#!/usr/bin/env node

require('dotenv').config();
const airtableClient = require('./config/airtableClient');

async function examineCorruptedLead() {
    console.log('🔍 EXAMINING SPECIFIC CORRUPTED LEAD');
    console.log('='.repeat(80));
    console.log('Target: recHkqPSMfdQWyqus (corrected record ID)');
    
    try {
        const base = airtableClient; // airtableClient is already the base instance
        
        console.log('\n1. 📊 Fetching the corrupted lead...');
        
        // Get the specific record
        const record = await base('Leads').find('recHkqPSMfdQWyqus');
        
        console.log(`   ✅ Found: ${record.get('Name')} (${record.get('Company')})`);
        console.log(`   📈 Status: "${record.get('Scoring Status')}"`);
        console.log(`   📊 Score: ${record.get('Lead Score') || 'None'}`);
        
        console.log('\n2. 🧬 Analyzing Profile Full JSON...');
        
        const profileJSON = record.get('Profile Full JSON');
        
        if (!profileJSON) {
            console.log('   ❌ No Profile Full JSON found!');
            return;
        }
        
        console.log(`   📏 JSON Length: ${profileJSON.length} characters`);
        
        // Try to parse and catch the exact error
        try {
            const parsed = JSON.parse(profileJSON);
            console.log('   ✅ JSON is valid! (This is unexpected...)');
            console.log(`   📋 Parsed object has ${Object.keys(parsed).length} top-level keys`);
        } catch (parseError) {
            console.log('   ❌ JSON CORRUPTION CONFIRMED!');
            console.log(`   📍 Error: ${parseError.message}`);
            
            // Extract position information
            const positionMatch = parseError.message.match(/position (\d+)/);
            const lineMatch = parseError.message.match(/line (\d+)/);
            const columnMatch = parseError.message.match(/column (\d+)/);
            
            if (positionMatch) {
                const position = parseInt(positionMatch[1]);
                console.log(`   🎯 Error Position: ${position}`);
                
                // Show context around the error
                const start = Math.max(0, position - 50);
                const end = Math.min(profileJSON.length, position + 50);
                const context = profileJSON.substring(start, end);
                
                console.log('\n3. 🔍 CORRUPTION CONTEXT:');
                console.log('   📄 Text around error position:');
                console.log(`   "${context}"`);
                
                // Highlight the exact problem character
                const relativePos = position - start;
                const beforeChar = context.substring(0, relativePos);
                const problemChar = context.charAt(relativePos);
                const afterChar = context.substring(relativePos + 1);
                
                console.log(`\n   🚨 EXACT PROBLEM:`);
                console.log(`   Before: "${beforeChar}"`);
                console.log(`   Problem char: "${problemChar}" (ASCII: ${problemChar.charCodeAt(0)})`);
                console.log(`   After: "${afterChar}"`);
            }
            
            if (lineMatch && columnMatch) {
                const lineNum = parseInt(lineMatch[1]);
                const colNum = parseInt(columnMatch[1]);
                
                console.log(`\n4. 📍 LINE/COLUMN ANALYSIS:`);
                console.log(`   🎯 Line ${lineNum}, Column ${colNum}`);
                
                // Split into lines and show the problematic line
                const lines = profileJSON.split('\n');
                if (lines.length >= lineNum) {
                    const problemLine = lines[lineNum - 1];
                    console.log(`   📄 Problem line: "${problemLine}"`);
                    
                    if (problemLine.length >= colNum) {
                        const beforeCol = problemLine.substring(0, colNum - 1);
                        const problemCol = problemLine.charAt(colNum - 1);
                        const afterCol = problemLine.substring(colNum);
                        
                        console.log(`   🔍 Line breakdown:`);
                        console.log(`      Before column: "${beforeCol}"`);
                        console.log(`      Problem char: "${problemCol}" (ASCII: ${problemCol.charCodeAt(0)})`);
                        console.log(`      After column: "${afterCol}"`);
                    }
                }
            }
            
            console.log('\n5. 🛠️ REPAIR STRATEGY:');
            
            // Analyze the type of corruption
            if (parseError.message.includes('double-quoted property name')) {
                console.log('   🎯 Issue: Missing quotes around property name');
                console.log('   💡 Solution: Add quotes around the unquoted property');
            } else if (parseError.message.includes('Unexpected token')) {
                console.log('   🎯 Issue: Invalid character in JSON');
                console.log('   💡 Solution: Remove or escape the invalid character');
            } else if (parseError.message.includes('Unexpected end')) {
                console.log('   🎯 Issue: Incomplete JSON (missing closing bracket/brace)');
                console.log('   💡 Solution: Add missing closing syntax');
            } else {
                console.log('   🎯 Issue: General JSON syntax error');
                console.log('   💡 Solution: Manual analysis and correction needed');
            }
        }
        
        console.log('\n6. 🧪 READY FOR REPAIR:');
        console.log('   ✅ Record ID: recHkqPSMfdQWyqus');
        console.log('   ✅ Corruption identified and analyzed');
        console.log('   ✅ Ready to create repair script');
        
    } catch (error) {
        console.error('❌ Error examining lead:', error.message);
    }
}

examineCorruptedLead();
