// utils/pbPostsSync.js

require("dotenv").config();
const base = require('../config/airtableClient');

const AIRTABLE_LEADS_TABLE_NAME = "Leads";
const AIRTABLE_LINKEDIN_URL_FIELD = "LinkedIn Profile URL";
const AIRTABLE_POSTS_FIELD = "Posts Content";
const AIRTABLE_DATE_ADDED_FIELD = "Time Posts Added";

// Allow this function to process EITHER a supplied array (from webhook), OR fall back to fetching a file if no arg
async function syncPBPostsToAirtable(postsInput) {
    // 1. Get array of posts to process
    let pbPostsArr;
    if (Array.isArray(postsInput)) {
        pbPostsArr = postsInput;
    } else if (typeof postsInput === 'string') {
        pbPostsArr = JSON.parse(postsInput);
    } else {
        throw new Error('PB Posts input must be an array of posts!');
    }

    // 2. Index by LinkedIn profile URL
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

    // 3. For each profile in PB file, update corresponding Airtable record
    let processedCount = 0, updatedCount = 0, skippedCount = 0;
    for (const [normProfileUrl, postsList] of Object.entries(postsByProfile)) {
        processedCount++;
        const record = await getAirtableRecordByProfileUrl(normProfileUrl);
        if (!record) {
            console.warn(`No Airtable lead found for: ${normProfileUrl}`);
            continue;
        }

        // Get current posts from Airtable (as parsed JSON array), or empty
        let existingPosts = [];
        try {
            existingPosts = JSON.parse(record.get(AIRTABLE_POSTS_FIELD) || "[]");
        } catch {
            existingPosts = [];
        }

        // Add only new posts (by postUrl)
        let newPostsAdded = 0;
        postsList.forEach(p => {
            if (!isPostAlreadyStored(existingPosts, p)) {
                existingPosts.push(p);
                newPostsAdded++;
            }
        });

        if (newPostsAdded > 0) {
            await base(AIRTABLE_LEADS_TABLE_NAME).update([
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

// --- Helper functions from previous code below ---
function normalizeLinkedInUrl(url) {
    return url
        ? url.replace(/^https?:\/\/(www\.)?linkedin\.com\//, 'linkedin.com/').replace(/\/$/, '').trim().toLowerCase()
        : '';
}

async function getAirtableRecordByProfileUrl(profileUrl) {
    const normUrl = normalizeLinkedInUrl(profileUrl);
    const records = await base(AIRTABLE_LEADS_TABLE_NAME).select({
        maxRecords: 1,
        filterByFormula: `{${AIRTABLE_LINKEDIN_URL_FIELD}} = '${normUrl}'`
    }).firstPage();
    return records.length ? records[0] : null;
}

function isPostAlreadyStored(existingPostsArr, postObj) {
    if (!Array.isArray(existingPostsArr)) return false;
    return existingPostsArr.some(p => p.postUrl && postObj.postUrl && p.postUrl === postObj.postUrl);
}

module.exports = syncPBPostsToAirtable;