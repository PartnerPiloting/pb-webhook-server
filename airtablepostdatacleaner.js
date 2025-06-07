// airtablepostdatacleaner.js
// A standalone script to clean and repair corrupted "Posts Content" JSON in Airtable.

// --- CONFIGURATION ---
// Set the mode:
// 'SINGLE' - Cleans the data in the 'singleRecordData' variable below.
// 'BATCH'  - Scans your Airtable base and cleans all unscored records with post content.
const MODE = 'SINGLE'; 

const AIRTABLE_LEADS_TABLE_NAME = "Leads";
const POSTS_CONTENT_FIELD = "Posts Content";
const DATE_SCORED_FIELD = "Date Posts Scored";
// --------------------

// --- DEPENDENCIES ---
// This script needs to be in the root of your project to access these files.
require("dotenv").config();
const airtableBase = require("./config/airtableClient.js");
// --------------------


/**
 * Takes a corrupted JSON string, extracts the core data for each post,
 * and rebuilds it into a clean, valid JSON string.
 * @param {string} badJsonString The corrupted string from the Airtable field.
 * @returns {string} A clean, stringified JSON array.
 */
function cleanAndRebuildJson(badJsonString) {
    if (!badJsonString || typeof badJsonString !== 'string') {
        console.warn("Warning: Received empty or non-string input to cleanAndRebuildJson. Returning empty array.");
        return "[]";
    }

    console.log("Attempting to clean and rebuild data...");

    // This regex finds all content between { and } braces, non-greedily.
    const postObjectsRegex = /\{(.*?)\}/gs;
    const objects = [...badJsonString.matchAll(postObjectsRegex)];
    
    const rebuiltPosts = [];

    for (const objectMatch of objects) {
        const objectContent = objectMatch[1]; // The content inside the braces

        // Use regex to extract each value. This is safer than parsing.
        const postUrlMatch = objectContent.match(/"postUrl"\s*:\s*"(.*?)"/);
        const postContentMatch = objectContent.match(/"postContent"\s*:\s*"((?:.|\n)*?)"/);
        const postDateMatch = objectContent.match(/"postDate"\s*:\s*"(.*?)"/);

        // This post object is a candidate only if it has content.
        if (postContentMatch && postContentMatch[1]) {
            const newPostObject = {
                postUrl: postUrlMatch ? postUrlMatch[1] : "",
                postContent: postContentMatch[1].replace(/\\n/g, '\n'), // Ensure newlines are correct
                postDate: postDateMatch ? postDateMatch[1] : "",
                // We will ignore pbMeta for now to ensure a clean result, as it's not used by the scoring service.
            };
            rebuiltPosts.push(newPostObject);
            console.log(`  -> Successfully extracted data for post: ${newPostObject.postUrl.slice(0, 50)}...`);
        } else {
             console.log("  -> Skipping an object that was missing 'postContent'.");
        }
    }

    if (rebuiltPosts.length > 0) {
         console.log(`Successfully rebuilt ${rebuiltPosts.length} valid posts.`);
    } else {
        console.warn("Warning: Could not rebuild any valid posts from the provided data.");
    }
    
    // Stringify the new, clean array of objects. This is guaranteed to be valid JSON.
    return JSON.stringify(rebuiltPosts, null, 2);
}


async function runBatchUpdate() {
    console.log(`--- RUNNING IN BATCH MODE ---`);
    if (!airtableBase) {
        console.error("Airtable client is not configured. Cannot run batch mode.");
        return;
    }

    try {
        console.log("Fetching unscored records with post content from Airtable...");
        const recordsToProcess = await airtableBase(AIRTABLE_LEADS_TABLE_NAME)
            .select({
                filterByFormula: `AND({${POSTS_CONTENT_FIELD}} != BLANK(), {${DATE_SCORED_FIELD}} = BLANK())`,
                fields: [POSTS_CONTENT_FIELD],
            })
            .all();

        console.log(`Found ${recordsToProcess.length} records to process.`);

        if (recordsToProcess.length === 0) return;

        const updates = [];
        for (const record of recordsToProcess) {
            const recordId = record.id;
            const badJson = record.get(POSTS_CONTENT_FIELD);

            if (badJson) {
                console.log(`\n--- Processing Record: ${recordId} ---`);
                const cleanJson = cleanAndRebuildJson(badJson);
                
                // We only create an update if the cleaning process produced a valid array with content.
                if (cleanJson && cleanJson.length > 2) { // Greater than 2 checks for more than just '[]'
                    updates.push({
                        id: recordId,
                        fields: {
                            [POSTS_CONTENT_FIELD]: cleanJson,
                        },
                    });
                     console.log(`  -> Staging update for record ${recordId}.`);
                } else {
                    console.warn(`  -> Skipping update for ${recordId} as no data could be rebuilt.`);
                }
            }
        }
        
        // Airtable's API allows updating up to 10 records at a time. We'll send them in chunks.
        if (updates.length > 0) {
            console.log(`\nReady to push ${updates.length} updates to Airtable...`);
            for (let i = 0; i < updates.length; i += 10) {
                const chunk = updates.slice(i, i + 10);
                console.log(`  -> Sending chunk of ${chunk.length} updates...`);
                await airtableBase(AIRTABLE_LEADS_TABLE_NAME).update(chunk);
            }
            console.log("--- BATCH MODE COMPLETE ---");
        } else {
            console.log("No records required updating.");
            console.log("--- BATCH MODE COMPLETE ---");
        }

    } catch (error) {
        console.error("An error occurred during the batch update process:", error);
    }
}


function runSingleUpdate() {
    console.log(`--- RUNNING IN SINGLE MODE ---`);
    
    // ** YOUR CORRUPTED JSON DATA HAS BEEN PASTED IN FOR YOU **
    const singleRecordData = `
[
  {
    "postUrl": "https://www.linkedin.com/feed/update/urn:li:activity:7332222034980048897",
    "postContent": "I recently had the privilege of being interviewed on the \"What Does It Feel Like, Being You Today?\" radio show and podcast with the brilliant Rae Bonney OAM.\\n\\nThis wasn’t your usual AI chat.\\n\\nYes, we talked AI, but we also went to places that rarely get airtime in the media.\\n\\nWe explored how AI is already reshaping the way we:\\n- 𝗟𝗲𝗮𝗿𝗻 (spoiler: your AI study coach might be better than your old uni lecturer)\\n- 𝗪𝗼𝗿𝗸 (AI can triple your output, if you know how to wield it)\\n- 𝗙𝗲𝗲𝗹 (yes, AI can validate, support and even help heal, when used right)\\n\\nWe also got very real:\\n- I shared the story behind the book I'm co-authoring with my wife on our experience navigating postnatal depression and psychosis.\\n- We explored what it taught us about ourselves and taking meaning from suffering.\\n\\n💡 If you're interested in what the future of mental health might look like with AI in the mix - or the topic of postnatal mental health - then you can listen to the full interview here: \\n\\n👉 https://lnkd.in/dBs2y2Wa\\n\\nWhether you're a technologist, an AI user (or not), a parent or just human, I hope this one resonates.\\n\\nLet me know what you think.",
    "postDate": "2025-05-25T01:52:39.237Z",
    "pbMeta": {
      "timestamp": "2025-06-06T17:41:21.350Z",
      "type": "Article",
      "imgUrl": "",
      "author": "Jonas Christensen",
      "authorUrl": "https://www.linkedin.com/in/jonas-christensen-2235313",
      "likeCount": 12,
      "commentCount": 1,
      "repostCount": 0,
      "action": "Post"
    }
  },
  {
    "postUrl": "https://www.linkedin.com/feed/update/urn:li:activity:7328920924500475904",
    "postContent": "AI isn’t the destination. It’s the engine that will get you there faster.\\n\\nThat was one of the key messages I shared on Informatica’s “Bringing Data to Life” podcast with the excellent Nick Dobbins.\\n\\nUnfortunately, too many businesses think of AI and clean data as an end goal.\\n\\nWhile effective use of AI and data are relevant goals, they are only useful if they amount to something and create real business value.\\n\\nIt sounds obvious, but unfortunately it's something most organisations struggle to achieve.\\n\\nIn our conversation, Nick and I dive into the elements needed to create real business value with AI and data:\\n\\n- How to apply decision-driven analytics to drive outcomes that matter\\n- Why business acumen, not technical depth, is the missing piece in many AI strategies\\n- The “internal startup” model that helps teams move fast without breaking trust\\n- The Impact–Feasibility Matrix I use to guide AI adoption across enterprises\\n- And why clean data starts with clean business processes, not just dashboards and data lakes\\n\\nCheck out this short clip 👇 for a quick taste. \\n\\nAnd if it sparks something, you can isten to the full conversation here: https://lnkd.in/dkFxQqxP",
    "postDate": "2025-05-15T23:15:13.167Z",
    "pbMeta": {
      "timestamp": "2025-06-06T17:41:21.351Z",
      "type": "Video (LinkedIn Source)",
      "imgUrl": "https://media.licdn.com/dms/image/v2/D4D05AQGl6SLbIUNOhA/videocover-high/B4DZbWOoW5HsBw-/0/1747350901748?e=1749837600&v=beta&t=PPP-_89iIRgRsntr3vIlO8y8EY8K0jeiBu5sV20dbgg",
      "author": "Jonas Christensen",
      "authorUrl": "https://www.linkedin.com/in/jonas-christensen-2235313",
      "likeCount": 18,
      "commentCount": 0,
      "repostCount": 0,
      "action": "Post"
    }
  },
  {
    "postUrl": "https://www.linkedin.com/pulse/how-become-corona-super-spreader-jonas-christensen?trackingId=m3n5bcyzRE%2B87lF5IcV6uA%3D%3D",
    "postDate": "",
    "pbMeta": {
      "timestamp": "2025-06-06T17:41:30.481Z",
      "type": "Article",
      "author": "Jonas Christensen"
    }
  }
]
`;

    if (singleRecordData.trim().includes("PASTE YOUR DATA HERE") || singleRecordData.trim() === "") {
        console.error("Please paste the corrupted JSON data into the 'singleRecordData' variable before running.");
        return;
    }

    const cleanJson = cleanAndRebuildJson(singleRecordData);
    console.log("\\n--- CLEANED JSON OUTPUT ---");
    console.log(cleanJson);
    console.log("--- COPY THE TEXT ABOVE ---");
}

// Main execution logic
if (MODE === 'SINGLE') {
    runSingleUpdate();
} else if (MODE === 'BATCH') {
    runBatchUpdate();
} else {
    console.error(`Invalid MODE selected. Please choose 'SINGLE' or 'BATCH'.`);
}