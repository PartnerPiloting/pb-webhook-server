// Fix for JSON structure confusion in Gemini AI processing
// This addresses the core issue with leads like recHkqPSMfdQWyqus

/**
 * PROBLEM: Massive nested JSON fields confuse Gemini AI's response formatting
 * - Raw Profile Data: 25,152 characters of nested JSON
 * - Profile Full JSON: 7,664 characters of structured JSON  
 * - Posts Content: JSON arrays within fields
 * 
 * SOLUTION: Flatten and simplify JSON structure before sending to AI
 */

function flattenNestedJson(leadData) {
    console.log('🔧 FLATTENING NESTED JSON STRUCTURE...');
    
    const flattened = { ...leadData };
    const problematicFields = ['Raw Profile Data', 'Profile Full JSON', 'Posts Content'];
    
    problematicFields.forEach(fieldName => {
        if (flattened[fieldName] && typeof flattened[fieldName] === 'string') {
            console.log(`   📋 Processing ${fieldName} (${flattened[fieldName].length} chars)`);
            
            try {
                // Parse the nested JSON
                const parsedJson = JSON.parse(flattened[fieldName]);
                
                // Extract key information instead of including raw JSON
                const simplified = simplifyJsonContent(parsedJson, fieldName);
                
                // Replace the massive JSON with simplified text
                flattened[fieldName] = simplified;
                
                console.log(`   ✅ ${fieldName}: Reduced from ${leadData[fieldName].length} to ${simplified.length} chars`);
                
            } catch (parseError) {
                console.log(`   ⚠️  ${fieldName}: Could not parse as JSON, treating as text`);
                
                // If it's not valid JSON, truncate and clean it
                flattened[fieldName] = cleanTextContent(flattened[fieldName]);
            }
        }
    });
    
    return flattened;
}

function simplifyJsonContent(jsonData, fieldType) {
    switch (fieldType) {
        case 'Raw Profile Data':
            return extractProfileSummary(jsonData);
            
        case 'Profile Full JSON':
            return extractProfileDetails(jsonData);
            
        case 'Posts Content':
            return extractPostsSummary(jsonData);
            
        default:
            return JSON.stringify(jsonData).substring(0, 500) + '...';
    }
}

function extractProfileSummary(profileData) {
    const summary = [];
    
    // Extract key profile information without nested JSON
    if (profileData.headline) {
        summary.push(`Headline: ${profileData.headline}`);
    }
    
    if (profileData.about) {
        // Truncate about section to avoid overwhelming AI
        const aboutText = profileData.about.substring(0, 300).replace(/[\r\n]+/g, ' ');
        summary.push(`About: ${aboutText}${profileData.about.length > 300 ? '...' : ''}`);
    }
    
    if (profileData.location) {
        summary.push(`Location: ${profileData.location}`);
    }
    
    if (profileData.industry) {
        summary.push(`Industry: ${profileData.industry}`);
    }
    
    if (profileData.experience && Array.isArray(profileData.experience)) {
        const recentExperience = profileData.experience.slice(0, 3).map(exp => 
            `${exp.title} at ${exp.company} (${exp.duration || 'Duration not specified'})`
        );
        summary.push(`Recent Experience: ${recentExperience.join('; ')}`);
    }
    
    if (profileData.education && Array.isArray(profileData.education)) {
        const education = profileData.education.slice(0, 2).map(edu => 
            `${edu.degree || 'Degree'} at ${edu.school}`
        );
        summary.push(`Education: ${education.join('; ')}`);
    }
    
    if (profileData.skills && Array.isArray(profileData.skills)) {
        const topSkills = profileData.skills.slice(0, 10).join(', ');
        summary.push(`Key Skills: ${topSkills}`);
    }
    
    return summary.join('\n');
}

function extractProfileDetails(profileJson) {
    const details = [];
    
    if (profileJson.headline) {
        details.push(`Professional Headline: ${profileJson.headline}`);
    }
    
    if (profileJson.about) {
        // Clean and truncate about section
        const cleanAbout = profileJson.about
            .replace(/[\r\n]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 400);
        details.push(`Professional Summary: ${cleanAbout}${profileJson.about.length > 400 ? '...' : ''}`);
    }
    
    // Add other relevant fields without nested JSON complexity
    ['location', 'industry', 'current_company'].forEach(field => {
        if (profileJson[field]) {
            details.push(`${field.replace('_', ' ').toUpperCase()}: ${profileJson[field]}`);
        }
    });
    
    return details.join('\n');
}

function extractPostsSummary(postsData) {
    if (!Array.isArray(postsData)) {
        return 'No posts data available';
    }
    
    const summary = [];
    const recentPosts = postsData.slice(0, 5); // Only analyze recent posts
    
    summary.push(`Total Posts Analyzed: ${postsData.length}`);
    
    recentPosts.forEach((post, index) => {
        if (post.postContent) {
            const cleanContent = post.postContent
                .replace(/[\r\n]+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 100);
            
            const postDate = post.postDate ? new Date(post.postDate).toLocaleDateString() : 'Unknown date';
            summary.push(`Post ${index + 1} (${postDate}): ${cleanContent}${post.postContent.length > 100 ? '...' : ''}`);
        }
    });
    
    return summary.join('\n');
}

function cleanTextContent(textContent) {
    // Remove or escape problematic characters that confuse JSON parsing
    return textContent
        .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
        .replace(/\\/g, '\\\\') // Escape backslashes
        .replace(/"/g, '\\"') // Escape quotes
        .substring(0, 1000) // Truncate to reasonable length
        + (textContent.length > 1000 ? '...' : '');
}

function validateJsonStructure(data) {
    console.log('🔍 VALIDATING JSON STRUCTURE...');
    
    const issues = [];
    
    Object.entries(data).forEach(([key, value]) => {
        if (typeof value === 'string') {
            // Check for nested JSON patterns
            if (value.includes('{"') || value.includes('"}')) {
                issues.push(`Field "${key}" contains nested JSON patterns`);
            }
            
            // Check for excessive length
            if (value.length > 5000) {
                issues.push(`Field "${key}" is extremely long (${value.length} chars)`);
            }
            
            // Check for problematic characters
            const problematicChars = (value.match(/["\\\n\r\t]/g) || []).length;
            if (problematicChars > 50) {
                issues.push(`Field "${key}" has many problematic characters (${problematicChars})`);
            }
        }
    });
    
    if (issues.length > 0) {
        console.log('   ⚠️  POTENTIAL ISSUES FOUND:');
        issues.forEach(issue => console.log(`      • ${issue}`));
        return false;
    } else {
        console.log('   ✅ JSON structure looks clean');
        return true;
    }
}

// Main processing function
async function processLeadForAI(leadData) {
    console.log('🚀 PROCESSING LEAD FOR AI COMPATIBILITY...');
    console.log('='.repeat(60));
    
    // Step 1: Validate original structure
    console.log('📊 Original data size analysis:');
    Object.entries(leadData).forEach(([key, value]) => {
        if (typeof value === 'string' && value.length > 1000) {
            console.log(`   ${key}: ${value.length} characters`);
        }
    });
    
    // Step 2: Flatten nested JSON
    const flattenedData = flattenNestedJson(leadData);
    
    // Step 3: Validate cleaned structure
    const isClean = validateJsonStructure(flattenedData);
    
    // Step 4: Show size reduction
    console.log('\n📉 SIZE REDUCTION ANALYSIS:');
    Object.entries(leadData).forEach(([key, value]) => {
        if (typeof value === 'string' && typeof flattenedData[key] === 'string') {
            const originalSize = value.length;
            const newSize = flattenedData[key].length;
            if (originalSize !== newSize) {
                const reduction = ((originalSize - newSize) / originalSize * 100).toFixed(1);
                console.log(`   ${key}: ${originalSize} → ${newSize} chars (${reduction}% reduction)`);
            }
        }
    });
    
    console.log('\n' + '='.repeat(60));
    console.log(isClean ? '✅ LEAD DATA READY FOR AI PROCESSING' : '⚠️  LEAD DATA MAY STILL HAVE ISSUES');
    
    return {
        processedData: flattenedData,
        isOptimized: isClean,
        originalSize: JSON.stringify(leadData).length,
        optimizedSize: JSON.stringify(flattenedData).length
    };
}

// Integration function for existing scoring system
function integrateWithExistingScoring(originalScoringFunction) {
    return async function enhancedScoring(leadData, ...args) {
        console.log('🔧 ENHANCED SCORING WITH JSON STRUCTURE FIX');
        
        // Process the lead data to fix JSON structure issues
        const processed = await processLeadForAI(leadData);
        
        if (!processed.isOptimized) {
            console.log('⚠️  WARNING: Lead data may still cause AI confusion');
        }
        
        console.log(`📊 Data size reduced by ${((processed.originalSize - processed.optimizedSize) / processed.originalSize * 100).toFixed(1)}%`);
        
        // Call the original scoring function with cleaned data
        return await originalScoringFunction(processed.processedData, ...args);
    };
}

// Test with the problematic lead
async function testWithProblematicLead() {
    console.log('🧪 TESTING WITH PROBLEMATIC LEAD recHkqPSMfdQWyqus...');
    
    // Simulated problematic lead data (would normally come from Airtable)
    const problematicLead = {
        'First Name': 'Pavan',
        'Last Name': 'Peteti',
        'Company Name': 'Fonterra',
        'Headline': 'Principal SAP SCM(TM/BN4L/EWM/SD/LE/MM) Consultant | Solution Architect',
        'Raw Profile Data': '{"id":"venkatapavankumarpeteti","member_id":"23606579","headline":"Principal SAP SCM..."}', // Truncated for example
        'Profile Full JSON': '{"headline":"Principal SAP SCM...","about":"I am an SAP transformation..."}', // Truncated for example
        'Posts Content': '[{"postUrl":"https://linkedin.com/...","postContent":"Reposting for visibility",...}]' // Truncated for example
    };
    
    const result = await processLeadForAI(problematicLead);
    
    console.log('\n📋 PROCESSED RESULT PREVIEW:');
    Object.entries(result.processedData).forEach(([key, value]) => {
        if (typeof value === 'string') {
            const preview = value.substring(0, 100).replace(/\n/g, ' ');
            console.log(`   ${key}: ${preview}${value.length > 100 ? '...' : ''}`);
        }
    });
    
    return result;
}

// Export functions for integration
module.exports = {
    processLeadForAI,
    flattenNestedJson,
    validateJsonStructure,
    integrateWithExistingScoring,
    testWithProblematicLead
};

// Run test if called directly
if (require.main === module) {
    testWithProblematicLead()
        .then(result => {
            console.log('\n🎉 TEST COMPLETED SUCCESSFULLY');
            console.log(`Original size: ${result.originalSize} bytes`);
            console.log(`Optimized size: ${result.optimizedSize} bytes`);
            console.log(`Reduction: ${((result.originalSize - result.optimizedSize) / result.originalSize * 100).toFixed(1)}%`);
        })
        .catch(error => {
            console.error('❌ TEST FAILED:', error.message);
        });
}
