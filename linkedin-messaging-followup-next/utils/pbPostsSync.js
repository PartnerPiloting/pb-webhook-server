// utils/pbPostsSync.js

require("dotenv").config();
const base = require('../config/airtableClient');

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
async function getAirtableRecordByProfileUrl(profileUrl) {
    const normUrl = normalizeLinkedInUrl(profileUrl);
    // Fetch all leads (fine for moderate dataset; for large datasets, use paginated queries)
    const records = await base(AIRTABLE_LEADS_TABLE_NAME).select().all();
    return records.find(record => {
        const atUrl = record.get(AIRTABLE_LINKEDIN_URL_FIELD);
        return atUrl && normalizeLinkedInUrl(atUrl) === normUrl;
    }) || null;
}

function isPostAlreadyStored(existingPostsArr, postObj) {
    if (!Array.isArray(existingPostsArr)) return false;
    return existingPostsArr.some(p => p.postUrl && postObj.postUrl && p.postUrl === postObj.postUrl);
}

// Main sync function. Accepts EITHER an array of posts (webhook) or a JSON string (legacy/manual mode)
async function syncPBPostsToAirtable(postsInput) {
    let pbPostsArr;
    if (Array.isArray(postsInput)) {
        pbPostsArr = postsInput;
    } else if (typeof postsInput === 'string') {
        pbPostsArr = JSON.parse(postsInput);
    } else {
        throw new Error('PB Posts input must be an array of posts!');
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
        const record = await getAirtableRecordByProfileUrl(normProfileUrl);
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

module.exports = syncPBPostsToAirtable;