require('dotenv').config();

const PROBLEMATIC_LEAD_ID = 'recHkqPSMfdQWyqus';

async function fetchLeadData() {
    const baseId = process.env.AIRTABLE_BASE_ID;
    const apiKey = process.env.AIRTABLE_API_KEY;
    
    if (!baseId || !apiKey) {
        console.error('❌ Missing AIRTABLE_BASE_ID or AIRTABLE_API_KEY in environment variables');
        return;
    }

    try {
        console.log(`🔍 ANALYZING LEAD DATA FOR: ${PROBLEMATIC_LEAD_ID}`);
        console.log('='.repeat(80));

        const response = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${PROBLEMATIC_LEAD_ID}`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        if (!response.ok) {
            console.error(`❌ Failed to fetch lead: ${response.status} ${response.statusText}`);
            const errorText = await response.text();
            console.error('Error details:', errorText);
            return;
        }

        const data = await response.json();
        const fields = data.fields;

        console.log('📋 LEAD RECORD FOUND');
        console.log('📊 Record ID:', data.id);
        console.log('⏰ Created Time:', data.createdTime);
        console.log('\n📄 FIELD ANALYSIS:');
        console.log('─'.repeat(60));

        // Analyze each field for potential issues
        Object.entries(fields).forEach(([fieldName, value]) => {
            console.log(`\n🏷️  Field: ${fieldName}`);
            console.log(`   📝 Type: ${typeof value}`);
            console.log(`   📏 Length: ${typeof value === 'string' ? value.length : 'N/A'}`);
            
            if (typeof value === 'string') {
                // Check for potential JSON-breaking characters
                const problematicChars = [];
                if (value.includes('"')) problematicChars.push('double quotes');
                if (value.includes("'")) problematicChars.push('single quotes');
                if (value.includes('\n')) problematicChars.push('newlines');
                if (value.includes('\r')) problematicChars.push('carriage returns');
                if (value.includes('\t')) problematicChars.push('tabs');
                if (value.includes('\\')) problematicChars.push('backslashes');
                if (/[\x00-\x1F\x7F]/.test(value)) problematicChars.push('control characters');
                if (/[^\x00-\x7F]/.test(value)) problematicChars.push('non-ASCII characters');
                
                if (problematicChars.length > 0) {
                    console.log(`   ⚠️  POTENTIAL ISSUES: ${problematicChars.join(', ')}`);
                }
                
                // Show first 200 characters with special characters visible
                const preview = value.substring(0, 200)
                    .replace(/\n/g, '\\n')
                    .replace(/\r/g, '\\r')
                    .replace(/\t/g, '\\t')
                    .replace(/"/g, '\\"');
                console.log(`   👁️  Preview: "${preview}${value.length > 200 ? '...' : ''}"`);
                
                // Check for extremely long content
                if (value.length > 5000) {
                    console.log(`   🚨 VERY LONG CONTENT: ${value.length} characters - may cause processing issues`);
                }
                
                // Check for specific patterns that might confuse AI
                if (value.includes('JSON') || value.includes('{') || value.includes('}')) {
                    console.log(`   🤖 CONTAINS JSON-LIKE CONTENT: May confuse AI response formatting`);
                }
                
            } else {
                console.log(`   📄 Value: ${JSON.stringify(value)}`);
            }
        });

        // Check for missing critical fields
        console.log('\n🔍 CRITICAL FIELD CHECK:');
        console.log('─'.repeat(40));
        
        const criticalFields = ['Profile URL', 'LinkedIn URL', 'Company', 'Title', 'First Name', 'Last Name'];
        criticalFields.forEach(field => {
            if (fields[field]) {
                console.log(`   ✅ ${field}: Present`);
            } else {
                console.log(`   ❌ ${field}: Missing`);
            }
        });

        // Look for the specific field content that might be causing the issue
        console.log('\n🎯 DETAILED ANALYSIS OF KEY FIELDS:');
        console.log('─'.repeat(50));

        const keyFields = ['Profile URL', 'LinkedIn URL', 'Company', 'Title', 'Experience', 'Skills', 'Industry'];
        keyFields.forEach(fieldName => {
            if (fields[fieldName] && typeof fields[fieldName] === 'string') {
                const value = fields[fieldName];
                console.log(`\n📋 ${fieldName}:`);
                
                // Character-by-character analysis for problematic content
                const charCounts = {};
                for (let char of value) {
                    const code = char.charCodeAt(0);
                    if (code < 32 || code > 126) { // Non-printable or non-ASCII
                        const key = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
                        charCounts[key] = (charCounts[key] || 0) + 1;
                    }
                }
                
                if (Object.keys(charCounts).length > 0) {
                    console.log(`   🚨 SPECIAL CHARACTERS FOUND:`);
                    Object.entries(charCounts).forEach(([unicode, count]) => {
                        console.log(`      ${unicode}: ${count} occurrences`);
                    });
                }
                
                // Check for patterns that might break JSON parsing
                const jsonBreakers = [
                    { pattern: /\\"/, name: 'Escaped quotes' },
                    { pattern: /\\n/, name: 'Escaped newlines' },
                    { pattern: /\\r/, name: 'Escaped carriage returns' },
                    { pattern: /\\t/, name: 'Escaped tabs' },
                    { pattern: /\\\\/g, name: 'Escaped backslashes' },
                    { pattern: /[""'']/g, name: 'Smart quotes' },
                    { pattern: /[\u2013\u2014]/g, name: 'Em/En dashes' }
                ];
                
                jsonBreakers.forEach(({ pattern, name }) => {
                    const matches = value.match(pattern);
                    if (matches) {
                        console.log(`   ⚠️  ${name}: ${matches.length} found`);
                    }
                });
            }
        });

        console.log('\n' + '='.repeat(80));
        console.log('🎯 SUMMARY & RECOMMENDATIONS');
        console.log('='.repeat(80));
        
        // Provide specific recommendations based on the analysis
        console.log('Based on the analysis above, potential fixes:');
        console.log('1. Remove or escape special characters in text fields');
        console.log('2. Truncate extremely long content');
        console.log('3. Handle missing critical fields gracefully');
        console.log('4. Add better JSON escaping in the AI prompt builder');

    } catch (error) {
        console.error('❌ Error analyzing lead data:', error.message);
    }
}

fetchLeadData();
