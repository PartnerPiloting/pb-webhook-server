// utils/pbPostsSync.js - MULTI-TENANT SUPPORT: Updated to use client-specific Airtable bases

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
    
    // Use client-specific base; filter on normalized URL to avoid full scans
    const normalizedFormula = `LOWER(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE({${AIRTABLE_LINKEDIN_URL_FIELD}}, "https://", ""), "http://", ""), "www.", ""))`;
    const formula = `OR(${normalizedFormula} = "${normUrl}", ${normalizedFormula} = "${normUrl}/")`;
    
    try {
        const records = await clientBase(AIRTABLE_LEADS_TABLE_NAME)
            .select({ 
                filterByFormula: formula, 
                maxRecords: 1,
                // Only fetch the fields we need to minimize memory usage
                fields: [AIRTABLE_LINKEDIN_URL_FIELD, AIRTABLE_POSTS_FIELD]
            })
            .firstPage();
            
        if (records && records.length > 0) {
            return records[0];
        } else {
            return null;
        }
    } catch (e) {
        console.error(`[getAirtableRecord] Filtered lookup failed: ${e.message}`);
        // DO NOT fallback to .all() - this was causing memory crashes
        // Return null instead of risking memory overflow
        return null;
    }
}

// Multi-tenant client identification for PB posts
// Identifies which client base contains the LinkedIn profiles from the posts
async function identifyClientForPosts(pbPostsArr) {
    if (!pbPostsArr || pbPostsArr.length === 0) {
        console.warn('PB Posts: No posts provided for client identification');
        return null;
    }

    try {
        // Extract unique profile URLs from posts
        const profileUrls = [...new Set(pbPostsArr
            .filter(post => post.profileUrl)
            .map(post => normalizeLinkedInUrl(post.profileUrl))
        )];

        if (profileUrls.length === 0) {
            console.warn('PB Posts: No valid profile URLs found in posts');
            return null;
        }

        // Get all active clients
        const activeClients = await getClientBase('master').getAllClients();
        
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
                    console.log(`PB Posts: Identified client ${client.id} based on ${foundCount}/${sampleUrls.length} profile URL matches`);
                    return { clientId: client.id, clientBase };
                }
            } catch (clientError) {
                console.warn(`Error checking client ${client.id}: ${clientError.message}`);
                continue;
            }
        }
        
        return null;
        
    } catch (error) {
        console.error('Error identifying client for PB posts:', error.message);
        return null;
    }
}

// Main sync function - Updated to support multi-tenant operation
// If clientBase is not provided, will attempt to auto-detect the correct client base
async function syncPBPostsToAirtable(pbPostsArr, clientBase = null) {
    if (!pbPostsArr || pbPostsArr.length === 0) {
        return { success: true, message: 'No posts to sync' };
    }

    let airtableBase = clientBase;
    let clientId = null;
    
    // If no client base provided, try to auto-detect the correct client
    if (!airtableBase) {
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
    
    pbPostsArr.forEach((post, index) => {
        if (!post.profileUrl || !post.postUrl) {
            return;
        }
        const normProfile = normalizeLinkedInUrl(post.profileUrl);
        if (!postsByProfile[normProfile]) postsByProfile[normProfile] = [];
        // Carry through pbMeta so downstream (and Airtable) can show ORIGINAL/REPOST labels
        const meta = {
            ...(post.pbMeta || {}),
            authorUrl: post.authorUrl || (post.pbMeta && post.pbMeta.authorUrl) || '',
            authorName: post.author || (post.pbMeta && post.pbMeta.authorName) || ''
            // originLabel should come from the Apify mappers; we don't recompute here because
            // it requires knowing the Lead profile URL which isn't available in this function
        };
        postsByProfile[normProfile].push({
            postUrl: post.postUrl,
            postContent: post.postContent,
            postedAt: post.postedAt,
            postImages: post.postImages,
            article: post.article,
            socialContent: post.socialContent,
            // New: persist author metadata for repost/original detection
            authorUrl: meta.authorUrl,
            author: meta.authorName,
            // Preserve original action for backward-compat and store inside pbMeta as well
            action: post.action || (post.pbMeta && post.pbMeta.action) || '',
            pbMeta: meta
        });
    });

    console.log(`[PBPostsSync] Processing ${Object.keys(postsByProfile).length} unique profiles`);

    let processedCount = 0;
    
    for (const [normProfileUrl, postsList] of Object.entries(postsByProfile)) {
        processedCount++;
        
        const record = await getAirtableRecordByProfileUrl(normProfileUrl, airtableBase);
        if (!record) {
            console.warn(`No Airtable lead found for: ${normProfileUrl}`);
            continue;
        }

        let existingPosts = [];
        try {
            const postsFieldValue = record.get(AIRTABLE_POSTS_FIELD) || "[]";
            
            // Check if the field is extremely large (could cause memory issues)
            if (postsFieldValue.length > 1000000) { // 1MB limit
                console.warn(`[PBPostsSync] Existing posts field too large (${postsFieldValue.length} chars), truncating to avoid memory crash`);
                existingPosts = []; // Start fresh to avoid memory crash
            } else {
                // Use dirty-json for safer parsing of existing posts (same as webhook parsing)
                try {
                    existingPosts = JSON.parse(postsFieldValue);
                } catch (jsonError) {
                    console.warn(`Standard JSON.parse failed for existing posts, trying dirty-json: ${jsonError.message}`);
                    existingPosts = dirtyJSON.parse(postsFieldValue);
                }
            }
        } catch (parseError) {
            console.error(`Both JSON.parse and dirty-json failed for existing posts: ${parseError.message}`);
            existingPosts = []; // Fallback to empty array
        }

        let newPostsAdded = 0;
        let postsUpdated = 0;
        postsList.forEach(p => {
            const idx = existingPosts.findIndex(ep => ep.postUrl === p.postUrl);
            if (idx === -1) {
                existingPosts.push(p);
                newPostsAdded++;
            } else {
                // Upsert: merge new fields (e.g., authorUrl) into existing entry
                const current = existingPosts[idx] || {};
                // Deep-merge pbMeta to avoid losing existing flags
                const merged = {
                    ...current,
                    ...p,
                    pbMeta: {
                        ...(current.pbMeta || {}),
                        ...(p.pbMeta || {})
                    }
                };
                const before = JSON.stringify(existingPosts[idx]);
                const after = JSON.stringify(merged);
                if (before !== after) {
                    existingPosts[idx] = merged;
                    postsUpdated++;
                }
            }
        });

    if (newPostsAdded > 0 || postsUpdated > 0) {
            try {
                const updateData = {
                    [AIRTABLE_POSTS_FIELD]: JSON.stringify(existingPosts, null, 2),
                    [AIRTABLE_DATE_ADDED_FIELD]: new Date().toISOString()
                };

                console.log(`[DEBUG] PBPostsSync: Updating record ${record.id} with ${newPostsAdded} new, ${postsUpdated} updated posts`);
                console.log(`[DEBUG] PBPostsSync: Final posts array length: ${existingPosts.length}, JSON size: ${updateData[AIRTABLE_POSTS_FIELD].length} chars`);

                // Add optional timestamp fields if they exist in the base
                try {
                    updateData[AIRTABLE_LAST_POST_CHECK_AT_FIELD] = new Date().toISOString();
                    updateData[AIRTABLE_LAST_POST_PROCESSED_AT_FIELD] = new Date().toISOString();
                } catch (fieldError) {
                    // These fields might not exist in all bases - that's OK
                }

                await airtableBase(AIRTABLE_LEADS_TABLE_NAME).update(record.id, updateData);
                console.log(`[DEBUG] PBPostsSync: Successfully updated Airtable record ${record.id}`);
                console.log(`Updated ${normProfileUrl}: Added ${newPostsAdded}, Updated ${postsUpdated} posts (total: ${existingPosts.length})`);
            } catch (updateError) {
                console.error(`[DEBUG] PBPostsSync: Failed to update ${normProfileUrl}:`, updateError.message);
                console.error(`Failed to update ${normProfileUrl}:`, updateError.message);
            }
        } else {
            console.log(`[DEBUG] PBPostsSync: No updates needed for ${normProfileUrl} (no new or updated posts)`);
        }
    }

    const totalProfiles = Object.keys(postsByProfile).length;
    console.log(`PB Posts sync completed: ${processedCount}/${totalProfiles} profiles processed`);
    
    return {
        success: true,
        processed: processedCount,
        total: totalProfiles,
        clientId: clientId || 'default'
    };
}

// Export the main function as default, with helper functions as properties
module.exports = syncPBPostsToAirtable;
module.exports.syncPBPostsToAirtable = syncPBPostsToAirtable;
module.exports.getAirtableRecordByProfileUrl = getAirtableRecordByProfileUrl;
module.exports.normalizeLinkedInUrl = normalizeLinkedInUrl;
module.exports.identifyClientForPosts = identifyClientForPosts;
