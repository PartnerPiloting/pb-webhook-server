// Simple test to see exactly where JSON parsing fails

const sample = `[
  {
    "postContent": "Agent memory"? "Tools"? "Call the API"??"
  }
]`;

console.log("=== SIMPLE QUOTE TEST ===");
console.log("Sample:", sample);

try {
    const result = JSON.parse(sample);
    console.log("✅ Worked!");
} catch (error) {
    console.log("❌ Failed:", error.message);
    console.log("Position:", error.message.match(/position (\d+)/)?.[1]);
}

// Now test the actual pattern from your sample
const actualPattern = `{
  "postContent": "So... \\"Agent memory\\"? \\"Tools\\"? \\"Call the API\\"??"
}`;

console.log("\\n=== ACTUAL PATTERN TEST ===");
console.log("Pattern:", actualPattern);

try {
    const result = JSON.parse(actualPattern);
    console.log("✅ Actual pattern worked!");
} catch (error) {
    console.log("❌ Actual pattern failed:", error.message);
}
