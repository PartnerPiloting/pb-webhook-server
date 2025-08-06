// utils/pbPostsSync.js - MULTI-TENANT SUPPORT: Updated to use client-specific Airtable bases

require("dotenv").config();
const { getClientBase } = require('../config/airtableClient');
const base = require('../config/airtableClient'); // Fallback for backward compatibility

const AIRTABLE_LEADS_TABLE_NAME = "Leads";
const AIRTABLE_LINKEDIN_URL_FIELD = "LinkedIn Profile URL";
const AIRTABLE_POSTS_FIELD = "Posts Content";
const AIRTABLE_DATE_ADDED_FIELD = "Time Posts Added";

// Normalize LinkedIn URLs so any version matches (removes protocol, www, trailing slash, lowercases)
function normalizeLinkedInUrl(url) {
    if (!url) return '';
    return url
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/$/, '')
        .trim();
}

// Fetch ALL leads and match by normalized LinkedIn Profile URL
// MULTI-TENANT: Now accepts clientBase parameter
async function getAirtableRecordByProfileUrl(profileUrl, clientBase) {
    const normUrl = normalizeLinkedInUrl(profileUrl);
    // Use client-specific base instead of global base
    const records = await clientBase(AIRTABLE_LEADS_TABLE_NAME).select().all();
    return records.find(record => {
        const atUrl = record.get(AIRTABLE_LINKEDIN_URL_FIELD);
        return atUrl && normalizeLinkedInUrl(atUrl) === normUrl;
    }) || null;
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
        pbPostsArr = JSON.parse(postsInput);
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

    // Index posts by normalized profile URL
    const postsByProfile = {};
    pbPostsArr.forEach(post => {
        if (!post.profileUrl || !post.postUrl) return;
        const normProfile = normalizeLinkedInUrl(post.profileUrl);
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

    let processedCount = 0, updatedCount = 0, skippedCount = 0;
    for (const [normProfileUrl, postsList] of Object.entries(postsByProfile)) {
        processedCount++;
        const record = await getAirtableRecordByProfileUrl(normProfileUrl, airtableBase);
        if (!record) {
            console.warn(`No Airtable lead found for: ${normProfileUrl}`);
            continue;
        }

        let existingPosts = [];
        try {
            existingPosts = JSON.parse(record.get(AIRTABLE_POSTS_FIELD) || "[]");
        } catch {
            existingPosts = [];
        }

        let newPostsAdded = 0;
        postsList.forEach(p => {
            if (!isPostAlreadyStored(existingPosts, p)) {
                existingPosts.push(p);
                newPostsAdded++;
            }
        });

        if (newPostsAdded > 0) {
            await airtableBase(AIRTABLE_LEADS_TABLE_NAME).update([
                {
                    id: record.id,
                    fields: {
                        [AIRTABLE_POSTS_FIELD]: JSON.stringify(existingPosts, null, 2),
                        [AIRTABLE_DATE_ADDED_FIELD]: new Date().toISOString()
                    }
                }
            ]);
            updatedCount++;
            console.log(`Updated lead ${normProfileUrl} with ${newPostsAdded} new posts.`);
        } else {
            skippedCount++;
            console.log(`No new posts for ${normProfileUrl} (already up to date).`);
        }
    }

    return { processed: processedCount, updated: updatedCount, skipped: skippedCount };
}

module.exports = syncPBPostsToAirtable;