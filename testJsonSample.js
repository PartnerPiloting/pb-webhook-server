// Test script to analyze the exact JSON sample from Airtable

const dirtyJSON = require('dirty-json');

// Your exact JSON sample from Airtable
const jsonSample = `[
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
  },
  {
    "postUrl": "https://www.linkedin.com/feed/update/urn:li:activity:7332302607572488192",
    "postContent": "AI Model Behaviour Test",
    "postDate": "2025-05-25T07:12:49.240Z",
    "pbMeta": {
      "timestamp": "2025-05-31T05:10:23.775Z",
      "type": "Poll",
      "imgUrl": "",
      "author": "Ankita Sharma🧏🏽‍♀️",
      "authorUrl": "https://www.linkedin.com/in/ankitasha",
      "likeCount": 0,
      "commentCount": 0,
      "repostCount": 0,
      "action": "Post"
    }
  },
  {
    "postUrl": "https://www.linkedin.com/feed/update/urn:li:activity:7331984770287001600",
    "postContent": ""You Won't Get It"—Or Maybe I Don't Get It Enough?\\n\\nToday, I was deep in my ML study zone, watching some videos on machine learning, when my dad casually asked,\\n"What's an LLM? And what's unsupervised learning? I hear about this a lot on "my" internet."\\n\\nMy quick response: "Ahh, Dad… you won't get it, it's complicated."\\n\\nBut then I paused for a sec.\\n\\nI've been learning these concepts for a while now. If I can't explain to someone 'simply' then maybe I haven't really learned them at all?\\n\\nIn tech (and life), clarity is a superpower. It's not just about what you know—it's about how well you can communicate it. If our knowledge can't travel across contexts, ages, or backgrounds, then it's still stuck in your head, not out in the world where it matters.\\n\\nThe truth is, we don't brush off certain questions because they're "too simple."\\nWe do it because, deep down, we assume the other person won't get it—and that says more about our learning & communication skills than their ability to understand.\\n\\nI gave Dad a full explainer (in Hindi yea funny!)\\nHe nodded throughtout, took it all in, and then said, "So… it's like WiFi? It can do anything"\\n\\nClose enough, Dad. Close enough.... I tried.",
    "postDate": "2025-05-24T10:09:50.926Z",
    "pbMeta": {
      "timestamp": "2025-05-31T05:10:23.776Z",
      "type": "Text",
      "imgUrl": "",
      "author": "Ankita Sharma🧏🏽‍♀️",
      "authorUrl": "https://www.linkedin.com/in/ankitasha",
      "likeCount": 8,
      "commentCount": 0,
      "repostCount": 0,
      "action": "Post"
    }
  },
  {
    "postUrl": "https://www.linkedin.com/pulse/business-intelligence-role-ankita-sharma?trackingId=8fQAh%2Fa2SL6dh%2BPcpiig%2Fg%3D%3D",
    "postDate": "",
    "pbMeta": {
      "timestamp": "2025-05-31T05:10:30.582Z",
      "type": "Article",
      "author": "Ankita Sharma🧏🏽‍♀️"
    }
  }
]`;

console.log("=== TESTING JSON SAMPLE FROM AIRTABLE ===");
console.log("JSON Length:", jsonSample.length);
console.log("First 200 chars:", jsonSample.substring(0, 200));
console.log("Last 200 chars:", jsonSample.substring(jsonSample.length - 200));

// Find the arrow characters that might be causing issues
const arrowMatches = jsonSample.match(/[→←↑↓]/g);
if (arrowMatches) {
    console.log("Found arrow characters:", arrowMatches.length, arrowMatches.slice(0, 5));
}

// Test 1: Standard JSON.parse
console.log("\n=== TEST 1: Standard JSON.parse ===");
try {
    const parsed = JSON.parse(jsonSample);
    console.log("✅ SUCCESS: JSON.parse worked!");
    console.log("Parsed array length:", parsed.length);
} catch (error) {
    console.log("❌ FAILED: JSON.parse failed");
    console.log("Error:", error.message);
    console.log("Error position:", error.message.match(/position (\d+)/)?.[1] || "unknown");
}

// Test 2: Clean and try again
console.log("\n=== TEST 2: Clean and JSON.parse ===");
const cleaned = jsonSample
    .trim()
    .replace(/\u0000/g, '') // Remove null characters
    .replace(/\r\n/g, '\n') // Normalize line endings
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ''); // Remove control characters

try {
    const parsed = JSON.parse(cleaned);
    console.log("✅ SUCCESS: Cleaned JSON.parse worked!");
    console.log("Parsed array length:", parsed.length);
} catch (error) {
    console.log("❌ FAILED: Cleaned JSON.parse failed");
    console.log("Error:", error.message);
    console.log("Error position:", error.message.match(/position (\d+)/)?.[1] || "unknown");
}

// Test 3: dirty-json
console.log("\n=== TEST 3: dirty-json ===");
try {
    const parsed = dirtyJSON.parse(jsonSample);
    console.log("✅ SUCCESS: dirty-json worked!");
    console.log("Parsed array length:", parsed.length);
} catch (error) {
    console.log("❌ FAILED: dirty-json failed");
    console.log("Error:", error.message);
}

// Test 4: dirty-json on cleaned
console.log("\n=== TEST 4: dirty-json on cleaned ===");
try {
    const parsed = dirtyJSON.parse(cleaned);
    console.log("✅ SUCCESS: dirty-json on cleaned worked!");
    console.log("Parsed array length:", parsed.length);
} catch (error) {
    console.log("❌ FAILED: dirty-json on cleaned failed");
    console.log("Error:", error.message);
}

// Character analysis
console.log("\n=== CHARACTER ANALYSIS ===");
const chars = jsonSample.split('');
const specialChars = chars.filter(char => {
    const code = char.charCodeAt(0);
    return code < 32 || code > 126;
});
console.log("Special characters found:", specialChars.length);
if (specialChars.length > 0) {
    console.log("First 10 special chars:", specialChars.slice(0, 10).map(c => `${c} (${c.charCodeAt(0)})`));
}

// Quote analysis
console.log("\n=== QUOTE ANALYSIS ===");
const quotes = jsonSample.match(/"/g) || [];
console.log("Total quotes:", quotes.length);
console.log("Is even?", quotes.length % 2 === 0);

// Look for obvious issues
console.log("\n=== STRUCTURE ANALYSIS ===");
console.log("Starts with [?", jsonSample.trim().startsWith('['));
console.log("Ends with ]?", jsonSample.trim().endsWith(']'));
console.log("Open brackets:", (jsonSample.match(/\[/g) || []).length);
console.log("Close brackets:", (jsonSample.match(/\]/g) || []).length);
console.log("Open braces:", (jsonSample.match(/\{/g) || []).length);
console.log("Close braces:", (jsonSample.match(/\}/g) || []).length);
