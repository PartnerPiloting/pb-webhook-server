// Simple test to isolate the Gemini issue
const geminiConfig = require("./config/geminiClient.js");

console.log("Testing Gemini configuration:");
console.log("- vertexAIClient:", !!geminiConfig.vertexAIClient);
console.log("- geminiModelId:", geminiConfig.geminiModelId);

if (geminiConfig.vertexAIClient && geminiConfig.geminiModelId) {
    console.log("\nTesting simple Gemini call...");
    
    (async () => {
        try {
            const model = geminiConfig.vertexAIClient.getGenerativeModel({ 
                model: geminiConfig.geminiModelId 
            });
            
            console.log("Model created successfully");
            
            const result = await model.generateContent("Say hello");
            console.log("Response:", result.response.text());
            
        } catch (error) {
            console.error("Error:", error.message);
        }
    })();
} else {
    console.error("Gemini client not properly configured");
}
