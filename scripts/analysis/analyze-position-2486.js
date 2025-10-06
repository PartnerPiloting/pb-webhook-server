#!/usr/bin/env node

require('dotenv').config();
const airtableClient = require('./config/airtableClient');

async function analyzePosition2486() {
    console.log('🔍 ANALYZING JSON AT POSITION 2486');
    console.log('='.repeat(80));
    console.log('Target: recHkqPSMfdQWyqus - Position 2486, Line 43, Column 29');
    
    try {
        const base = airtableClient;
        
        console.log('\n1. 📊 Fetching lead data...');
        const record = await base('Leads').find('recHkqPSMfdQWyqus');
        
        const profileJSON = record.get('Profile Full JSON');
        console.log(`   📏 JSON Length: ${profileJSON.length} characters`);
        
        if (profileJSON.length < 2486) {
            console.log(`   ❌ JSON is shorter than position 2486!`);
            return;
        }
        
        console.log('\n2. 🎯 Character Analysis at Position 2486:');
        
        // Get characters around position 2486
        const targetPos = 2486;
        const context = 30; // characters before/after
        
        const startPos = Math.max(0, targetPos - context);
        const endPos = Math.min(profileJSON.length, targetPos + context);
        
        const beforeTarget = profileJSON.substring(startPos, targetPos);
        const targetChar = profileJSON.charAt(targetPos);
        const afterTarget = profileJSON.substring(targetPos + 1, endPos);
        
        console.log(`   📄 Context (±${context} chars):`);
        console.log(`   Before: "${beforeTarget}"`);
        console.log(`   Target char: "${targetChar}" (ASCII: ${targetChar.charCodeAt(0)})`);
        console.log(`   After: "${afterTarget}"`);
        
        // Check for invisible/problematic characters
        console.log('\n3. 🔍 Character Analysis:');
        const charCode = targetChar.charCodeAt(0);
        
        if (charCode < 32) {
            console.log(`   🚨 Control character detected! (ASCII ${charCode})`);
        } else if (charCode > 127) {
            console.log(`   🚨 Non-ASCII character detected! (ASCII ${charCode})`);
        } else {
            console.log(`   ✅ Normal ASCII character: "${targetChar}"`);
        }
        
        // Analyze the problematic line (line 43)
        console.log('\n4. 📍 Line 43 Analysis:');
        const lines = profileJSON.split('\n');
        console.log(`   📊 Total lines: ${lines.length}`);
        
        if (lines.length >= 43) {
            const line43 = lines[42]; // 0-indexed
            console.log(`   📄 Line 43: "${line43}"`);
            console.log(`   📏 Line length: ${line43.length} characters`);
            
            // Check column 29
            if (line43.length >= 29) {
                const col29Char = line43.charAt(28); // 0-indexed
                console.log(`   🎯 Column 29 character: "${col29Char}" (ASCII: ${col29Char.charCodeAt(0)})`);
                
                // Show context around column 29
                const beforeCol = line43.substring(0, 28);
                const afterCol = line43.substring(29);
                console.log(`   📄 Before column 29: "${beforeCol}"`);
                console.log(`   📄 After column 29: "${afterCol}"`);
            } else {
                console.log(`   ❌ Line 43 is shorter than 29 characters!`);
            }
        } else {
            console.log(`   ❌ JSON has fewer than 43 lines!`);
        }
        
        // Try to identify the JSON structure issue
        console.log('\n5. 🛠️ JSON Structure Analysis:');
        
        // Look for common JSON corruption patterns around position 2486
        const nearbyText = profileJSON.substring(Math.max(0, targetPos - 100), Math.min(profileJSON.length, targetPos + 100));
        
        if (nearbyText.includes('""')) {
            console.log('   🚨 Found empty quoted strings that might be malformed');
        }
        if (nearbyText.includes(',}') || nearbyText.includes(',]')) {
            console.log('   🚨 Found trailing commas before closing brackets');
        }
        if (nearbyText.match(/[a-zA-Z_]+\s*:/)) {
            console.log('   🚨 Found unquoted property names');
        }
        if (nearbyText.includes('\\"')) {
            console.log('   🚨 Found escaped quotes that might be malformed');
        }
        
        // Create a potential fix
        console.log('\n6. 🔧 Repair Strategy:');
        console.log('   📋 Based on "Expected double-quoted property name" error:');
        console.log('   💡 Likely issue: Unquoted property name in JSON');
        console.log('   🛠️ Solution: Add quotes around the property name');
        
        console.log('\n7. 🧪 Ready for Repair Script Creation');
        
    } catch (error) {
        console.error('❌ Error analyzing position:', error.message);
    }
}

analyzePosition2486();
