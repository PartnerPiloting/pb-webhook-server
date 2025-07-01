// Test to see exactly why your sample fails and if our fixes work

const dirtyJSON = require('dirty-json');
const { repairAndParseJson } = require('./utils/jsonRepair');

// Your exact sample from Airtable
const yourSample = `[
  {
    "postUrl": "https://www.linkedin.com/feed/update/urn:li:activity:7334417981734572032",
    "postContent": "So... I Built My First AI Agent today!!\\n\\nThis was not planned. Best things are those that are never pre planned!\\n\\nI had like... 25% battery left on my laptop (no charger in sight), had not seen an AI agent interface before, and somehow decided today's the day I build one. Why? No idea. Chaos energy, I guess?\\n\\n\\"Agent memory\\"? \\"Tools\\"? \\"Call the API\\"?? How do I get that!?? Felt like I was trying to assemble IKEA furniture (wait but thsts even harder.. I rather build AI Agents)..\\n\\nI clicked. I prayed. Every time I broke something, I just broke it differently the next time 🤣\\n\\nMeanwhile, my battery percentage was : \\n25% → 17% → 9% (No charger)\\n\\nAnd then—somehow—miracle of miracles…\\nMy agent ran!!! what! no... yes... 😍  Not once. But SIX times. Successfully!\\n\\nI screamed. Mum stormed in. She asked if I was Ok!?? I responded \\"I just built my first AI Agent\\". She said \\"ok, whatever now get ready to go for groceries\\"! Argghh wish my AI Agent could do that 😒\\n\\nAnd then—poof.\\nBlack screen. Battery gone.\\n\\nNOTE: \\"My Agent\\" may have sent a few strange emails 😌 To some innocent people. \\numm... Multiple times.\\nThey didn't ask for that. But… maybe they needed it. 🤪\\n\\nSo… Will I Be Doing This Again?\\n\\nOh Absobloodylutely.\\n\\nThere's no high like your first agent sprint 🥳🤓\\n#firstaiagent\\n#aiagent",
    "postDate": "2025-05-31T03:18:33.742Z",
    "pbMeta": {
      "timestamp": "2025-05-31T05:10:23.775Z",
      "type": "Text",
      "imgUrl": "",
      "author": "Ankita Sharma🧏🏽‍♀️",
      "authorUrl": "https://www.linkedin.com/in/ankitasha",
      "likeCount": 0,
      "commentCount": 0,
      "repostCount": 0,
      "action": "Post"
    }
  }
]`;

console.log("=== TESTING YOUR EXACT SAMPLE ===");

// Test 1: What your current code does
console.log("\\n=== CURRENT CODE SIMULATION ===");
console.log("Step 1: Standard JSON.parse()");
try {
    const result1 = JSON.parse(yourSample);
    console.log("✅ SUCCESS: Standard JSON.parse worked!");
} catch (error) {
    console.log("❌ FAILED: Standard JSON.parse failed");
    console.log("Error:", error.message);
    
    // Step 2: Clean and try again (what your current code does)
    console.log("\\nStep 2: Clean and try JSON.parse again");
    const cleaned = yourSample
        .trim()
        .replace(/\\u0000/g, '')
        .replace(/\\r\\n/g, '\\n')
        .replace(/[\\u0000-\\u001F\\u007F-\\u009F]/g, '');
    
    try {
        const result2 = JSON.parse(cleaned);
        console.log("✅ SUCCESS: Cleaned JSON.parse worked!");
    } catch (error2) {
        console.log("❌ FAILED: Cleaned JSON.parse failed");
        console.log("Error:", error2.message);
        
        // Step 3: dirty-json (what your current code does)
        console.log("\\nStep 3: dirty-json");
        try {
            const result3 = dirtyJSON.parse(cleaned);
            console.log("✅ SUCCESS: dirty-json worked!");
        } catch (error3) {
            console.log("❌ FAILED: dirty-json failed");
            console.log("Error:", error3.message);
            console.log("\\n🔥 THIS IS WHERE YOUR CURRENT CODE FAILS 🔥");
        }
    }
}

// Test 2: What our proposed fix does
console.log("\\n\\n=== PROPOSED FIX TEST ===");
try {
    const repairResult = repairAndParseJson(yourSample);
    if (repairResult.success) {
        console.log("✅ SUCCESS: Enhanced repair worked!");
        console.log("Method used:", repairResult.method);
        console.log("Array length:", repairResult.data.length);
        console.log("\\n🎉 OUR FIX WOULD WORK! 🎉");
    } else {
        console.log("❌ FAILED: Enhanced repair failed");
        console.log("Error:", repairResult.error);
        console.log("\\n😞 Our fix wouldn't work either");
    }
} catch (error) {
    console.log("❌ FAILED: Enhanced repair threw error");
    console.log("Error:", error.message);
}

// Let's also check if the issue is the specific quote patterns
console.log("\\n=== QUOTE ANALYSIS ===");
const problematicQuotes = yourSample.match(/\\\\"[^\\\\]*\\\\"\\?/g) || [];
console.log("Found escaped quote patterns:", problematicQuotes.length);
if (problematicQuotes.length > 0) {
    console.log("Examples:", problematicQuotes.slice(0, 3));
}
