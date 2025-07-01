// Simple test of the problematic JSON
const dirtyJSON = require('dirty-json');

// Your exact JSON - let me test just the problematic parts
const problematicJson = `{
  "postContent": "25% → 17% → 9% (No charger)"
}`;

console.log("Testing arrow characters in JSON...");

try {
    const result = JSON.parse(problematicJson);
    console.log("✅ Standard JSON.parse worked with arrows!");
} catch (e) {
    console.log("❌ Standard JSON.parse failed:", e.message);
}

try {
    const result = dirtyJSON.parse(problematicJson);
    console.log("✅ dirty-json worked with arrows!");
} catch (e) {
    console.log("❌ dirty-json failed:", e.message);
}

// Test the actual string from your sample
const fullTestString = `"25% → 17% → 9% (No charger)"`;
console.log("\nTesting if the arrow character itself is the issue...");
console.log("Arrow character code:", '→'.charCodeAt(0));
console.log("Is valid JSON string?", fullTestString.length > 0);
