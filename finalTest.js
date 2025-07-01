// Check if your sample actually works or fails

const fs = require('fs');

// Let me save your exact sample to a file and test it
const yourExactSample = `[
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

console.log("Final test of your sample:");
console.log("Length:", yourExactSample.length);

// Basic structure check
console.log("Starts with [:", yourExactSample.trim().startsWith('['));
console.log("Ends with ]:", yourExactSample.trim().endsWith(']'));

// Try parsing
try {
    const parsed = JSON.parse(yourExactSample);
    console.log("✅ SUCCESS: Your sample actually WORKS!");
    console.log("Parsed successfully, array length:", parsed.length);
    console.log("Post content preview:", parsed[0].postContent.substring(0, 100));
} catch (error) {
    console.log("❌ FAILED: Your sample fails");
    console.log("Error:", error.message);
    
    // Show the exact character that's causing the issue
    const match = error.message.match(/position (\\d+)/);
    if (match) {
        const pos = parseInt(match[1]);
        console.log("Problem at position:", pos);
        console.log("Context:", yourExactSample.substring(pos-20, pos+20));
        console.log("Problem character:", yourExactSample[pos], "Code:", yourExactSample.charCodeAt(pos));
    }
}
