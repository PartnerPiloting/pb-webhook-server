// utils/pbPostsSync.js - MULTasync function getAirtableRecordByProfileUrl(profileUrl, clientBase) {
    const normUrl = normalizeLinkedInUrl(profileUrl);
    console.log(`[getAirtableRecord] Original URL: ${profileUrl}`);
    console.log(`[getAirtableRecord] Normalized URL: ${normUrl}`);
    
    // Use client-specific base; filter on normalized URL to avoid full scans
    const normalizedFormula = `LOWER(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE({${AIRTABLE_LINKEDIN_URL_FIELD}}, "https://", ""), "http://", ""), "www.", ""))`;
    const formula = `OR(${normalizedFormula} = "${normUrl}", ${normalizedFormula} = "${normUrl}/")`;
    console.log(`[getAirtableRecord] Airtable formula: ${formula}`);T SUPPORT: Updated to use client-specific Airtable bases

require("dotenv").config();
const { getClientBase } = require('../config/airtableClient');
const base = require('../config/airtableClient'); // Fallback for backward compatibility
const dirtyJSON = require('dirty-json'); // Add dirty-json for safe parsing

const AIRTABLE_LEADS_TABLE_NAME = "Leads";
const AIRTABLE_LINKEDIN_URL_FIELD = "LinkedIn Profile URL";
const AIRTABLE_POSTS_FIELD = "Posts Content";
const AIRTABLE_DATE_ADDED_FIELD = "Time Posts Added";
// New optional timestamp fields (added manually per base)
const AIRTABLE_LAST_POST_CHECK_AT_FIELD = "Last Post Check At";
const AIRTABLE_LAST_POST_PROCESSED_AT_FIELD = "Last Post Processed At";

// Normalize LinkedIn URLs so any version matches (removes protocol, www, trailing slash, parameters, lowercases)
function normalizeLinkedInUrl(url) {
    if (!url) return '';
    return url
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/$/, '')
        .split('?')[0]  // Remove query parameters like ?miniprofileurn=...
        .split('#')[0]  // Remove hash fragments
        .trim();
}

// Fetch leads by normalized LinkedIn Profile URL (MEMORY-SAFE VERSION)
// MULTI-TENANT: Now accepts clientBase parameter
async function getAirtableRecordByProfileUrl(profileUrl, clientBase) {
    const normUrl = normalizeLinkedInUrl(profileUrl);
    console.log(`[getAirtableRecord] Looking up: ${normUrl}`);
    
    // Use client-specific base; filter on normalized URL to avoid full scans
    const normalizedFormula = `LOWER(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE({${AIRTABLE_LINKEDIN_URL_FIELD}}, "https://", ""), "http://", ""), "www.", ""))`;
    const formula = `OR(${normalizedFormula} = "${normUrl}", ${normalizedFormula} = "${normUrl}/")`;
    
    try {
        console.log(`[getAirtableRecord] Executing filtered query with maxRecords=1`);
        const records = await clientBase(AIRTABLE_LEADS_TABLE_NAME)
            .select({ 
                filterByFormula: formula, 
                maxRecords: 1,
                // Only fetch the fields we need to minimize memory usage
                fields: [AIRTABLE_LINKEDIN_URL_FIELD, AIRTABLE_POSTS_FIELD]
            })
            .firstPage();
            
        if (records && records.length > 0) {
            console.log(`[getAirtableRecord] Found record: ${records[0].id}`);
            return records[0];
        } else {
            console.log(`[getAirtableRecord] No record found for: ${normUrl}`);
            return null;
        }
    } catch (e) {
        console.error(`[getAirtableRecord] Filtered lookup failed: ${e.message}`);
        // DO NOT fallback to .all() - this was causing memory crashes
        // Return null instead of risking memory overflow
        return null;
    }
}

function isPostAlreadyStored(existingPostsArr, postObj) {
    if (!Array.isArray(existingPostsArr)) return false;
    return existingPostsArr.some(p => p.postUrl && postObj.postUrl && p.postUrl === postObj.postUrl);
}

// Multi-tenant helper: Identify which client base contains the LinkedIn profiles
async function identifyClientForPosts(postsArray) {
    const { getAllActiveClients } = require('../services/clientService');
    const { getClientBase } = require('../config/airtableClient');
    
    // Extract unique profile URLs from posts
    const profileUrls = [...new Set(
        postsArray
            .filter(post => post.profileUrl)
            .map(post => normalizeLinkedInUrl(post.profileUrl))
    )];
    
    if (profileUrls.length === 0) {
        console.warn('No profile URLs found in posts for client identification');
        return null;
    }
    
    try {
        const activeClients = await getAllActiveClients();
        
        // Check each client base to see which contains these profile URLs
        for (const client of activeClients) {
            const clientBase = getClientBase(client.id);
            if (!clientBase) continue;
            
            try {
                // Sample a few profile URLs to check if they exist in this client's base
                const sampleUrls = profileUrls.slice(0, 3); // Check first 3 URLs
                let foundCount = 0;
                
                for (const normUrl of sampleUrls) {
                    const records = await clientBase(AIRTABLE_LEADS_TABLE_NAME)
                        .select({ 
                            filterByFormula: `LOWER(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE({${AIRTABLE_LINKEDIN_URL_FIELD}}, "https://", ""), "http://", ""), "www.", "")) = "${normUrl}"`,
                            maxRecords: 1 
                        })
                        .firstPage();
                    
                    if (records.length > 0) {
                        foundCount++;
                    }
                }
                
                // If we found matches for most sample URLs, this is likely the correct client
                if (foundCount > 0) {
                    console.log(`PB Posts: Identified client ${client.id} (${client.name || 'Unnamed'}) based on ${foundCount}/${sampleUrls.length} profile URL matches`);
                    return { clientId: client.id, clientBase };
                }
            } catch (clientError) {
                console.warn(`Error checking client ${client.id}: ${clientError.message}`);
                continue;
            }
        }
        
        console.warn('No client base found containing the profile URLs from PB posts');
        return null;
        
    } catch (error) {
        console.error('Error identifying client for PB posts:', error.message);
        return null;
    }
}

// Main sync function. Accepts EITHER an array of posts (webhook) or a JSON string (legacy/manual mode)
// MULTI-TENANT: Now accepts optional clientBase parameter for client-specific operations
async function syncPBPostsToAirtable(postsInput, clientBase = null) {
    let pbPostsArr;
    if (Array.isArray(postsInput)) {
        pbPostsArr = postsInput;
    } else if (typeof postsInput === 'string') {
        // Use dirty-json for safer parsing of input string
        try {
            pbPostsArr = JSON.parse(postsInput);
        } catch (jsonError) {
            console.warn(`Standard JSON.parse failed for posts input, trying dirty-json: ${jsonError.message}`);
            pbPostsArr = dirtyJSON.parse(postsInput);
            console.log(`dirty-json successfully parsed posts input`);
        }
    } else {
        throw new Error('PB Posts input must be an array of posts!');
    }

    let airtableBase = clientBase;
    let clientId = null;
    
    // If no client base provided, try to auto-detect the correct client
    if (!airtableBase) {
        console.log('PB Posts: No client base provided, attempting auto-detection...');
        const clientInfo = await identifyClientForPosts(pbPostsArr);
        
        if (clientInfo) {
            airtableBase = clientInfo.clientBase;
            clientId = clientInfo.clientId;
        } else {
            // Fallback to global base for backward compatibility
            console.warn('PB Posts: Client auto-detection failed, falling back to global base');
            airtableBase = base;
        }
    }
    
    if (!airtableBase) {
        throw new Error('No Airtable base available for PB posts sync');
    }

    console.log(`[PBPostsSync] Starting sync with ${pbPostsArr.length} posts`);

    // Index posts by normalized profile URL
    const postsByProfile = {};
    console.log(`[PBPostsSync] Starting to index posts by profile URL...`);
    
    pbPostsArr.forEach((post, index) => {
        console.log(`[PBPostsSync] Processing post ${index + 1}/${pbPostsArr.length}: ${post.postUrl || 'no URL'}`);
        if (!post.profileUrl || !post.postUrl) {
            console.log(`[PBPostsSync] Skipping post ${index + 1} - missing profile or post URL`);
            return;
        }
        const normProfile = normalizeLinkedInUrl(post.profileUrl);
        console.log(`[PBPostsSync] Normalized profile URL: ${normProfile}`);
        if (!postsByProfile[normProfile]) postsByProfile[normProfile] = [];
        postsByProfile[normProfile].push({
            postUrl: post.postUrl,
            postContent: post.postContent,
            postDate: post.postTimestamp || post.postDate || "",
            pbMeta: {
                timestamp: post.timestamp,
                type: post.type,
                imgUrl: post.imgUrl,
                author: post.author,
                authorUrl: post.authorUrl,
                likeCount: post.likeCount,
                commentCount: post.commentCount,
                repostCount: post.repostCount,
                action: post.action
            }
        });
    });
    
    console.log(`[PBPostsSync] Finished indexing. Found ${Object.keys(postsByProfile).length} unique profiles`);
    console.log(`[PBPostsSync] Profile URLs: ${Object.keys(postsByProfile).join(', ')}`);

    let processedCount = 0, updatedCount = 0, skippedCount = 0;
    console.log(`[PBPostsSync] Starting to process profiles...`);
    
    for (const [normProfileUrl, postsList] of Object.entries(postsByProfile)) {
        processedCount++;
        console.log(`[PBPostsSync] Processing profile ${processedCount}: ${normProfileUrl} with ${postsList.length} posts`);
        
        console.log(`[PBPostsSync] Looking up Airtable record for: ${normProfileUrl}`);
        const record = await getAirtableRecordByProfileUrl(normProfileUrl, airtableBase);
        if (!record) {
            console.warn(`No Airtable lead found for: ${normProfileUrl}`);
            continue;
        }
        console.log(`[PBPostsSync] Found Airtable record: ${record.id}`);

        let existingPosts = [];
        try {
            const postsFieldValue = record.get(AIRTABLE_POSTS_FIELD) || "[]";
            console.log(`[PBPostsSync] Existing posts field length: ${postsFieldValue.length} characters for ${normProfileUrl}`);
            
            // Check if the field is extremely large (could cause memory issues)
            if (postsFieldValue.length > 1000000) { // 1MB limit
                console.warn(`[PBPostsSync] Existing posts field too large (${postsFieldValue.length} chars), truncating to avoid memory crash`);
                existingPosts = []; // Start fresh to avoid memory crash
            } else {
                // Use dirty-json for safer parsing of existing posts (same as webhook parsing)
                try {
                    existingPosts = JSON.parse(postsFieldValue);
                    console.log(`[PBPostsSync] Successfully parsed ${existingPosts.length} existing posts`);
                } catch (jsonError) {
                    console.warn(`Standard JSON.parse failed for existing posts, trying dirty-json: ${jsonError.message}`);
                    existingPosts = dirtyJSON.parse(postsFieldValue);
                    console.log(`dirty-json successfully parsed existing posts for ${normProfileUrl}`);
                }
            }
        } catch (parseError) {
            console.error(`Both JSON.parse and dirty-json failed for existing posts: ${parseError.message}`);
            existingPosts = []; // Fallback to empty array
        }

        let newPostsAdded = 0;
        postsList.forEach(p => {
            if (!isPostAlreadyStored(existingPosts, p)) {
                existingPosts.push(p);
                newPostsAdded++;
            }
        });

        if (newPostsAdded > 0) {
            const nowIso = new Date().toISOString();
            const fieldsToUpdate = {
                [AIRTABLE_POSTS_FIELD]: JSON.stringify(existingPosts, null, 2),
                [AIRTABLE_DATE_ADDED_FIELD]: nowIso,
            };
            // Best-effort: write-if-exists for optional fields
            fieldsToUpdate[AIRTABLE_LAST_POST_CHECK_AT_FIELD] = nowIso;
            fieldsToUpdate[AIRTABLE_LAST_POST_PROCESSED_AT_FIELD] = nowIso;

            try {
                await airtableBase(AIRTABLE_LEADS_TABLE_NAME).update([
                    {
                        id: record.id,
                        fields: fieldsToUpdate
                    }
                ]);
            } catch (e) {
                // If optional fields are missing in this base, retry without them
                console.warn(`Update with optional fields failed for ${normProfileUrl}: ${e.message}. Retrying without optional fields.`);
                await airtableBase(AIRTABLE_LEADS_TABLE_NAME).update([
                    {
                        id: record.id,
                        fields: {
                            [AIRTABLE_POSTS_FIELD]: JSON.stringify(existingPosts, null, 2),
                            [AIRTABLE_DATE_ADDED_FIELD]: nowIso
                        }
                    }
                ]);
            }
            updatedCount++;
            console.log(`Updated lead ${normProfileUrl} with ${newPostsAdded} new posts.`);
        } else {
            skippedCount++;
            console.log(`No new posts for ${normProfileUrl} (already up to date).`);
            // Record that we checked even if nothing new was added
            const nowIso = new Date().toISOString();
            try {
                await airtableBase(AIRTABLE_LEADS_TABLE_NAME).update([
                    {
                        id: record.id,
                        fields: {
                            [AIRTABLE_LAST_POST_CHECK_AT_FIELD]: nowIso
                        }
                    }
                ]);
            } catch (e) {
                // Ignore if optional field not present
                console.warn(`Optional check timestamp update failed for ${normProfileUrl}: ${e.message}`);
            }
        }
    }

    return { processed: processedCount, updated: updatedCount, skipped: skippedCount };
}

module.exports = syncPBPostsToAirtable;