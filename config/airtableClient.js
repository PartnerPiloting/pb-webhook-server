// config/airtableClient.js
// Ensure environment variables are loaded. index.js should also do this,
// but it's good practice for config files.
require('dotenv').config();

const Airtable = require('airtable');

let airtableBaseInstance = null; // This will hold our initialized Airtable base

try {
    // Check for essential environment variables
    if (!process.env.AIRTABLE_API_KEY) {
        throw new Error("Airtable Client Config: AIRTABLE_API_KEY environment variable is not set.");
    }
    if (!process.env.AIRTABLE_BASE_ID) {
        throw new Error("Airtable Client Config: AIRTABLE_BASE_ID environment variable is not set.");
    }

    // Configure the Airtable client with your API key
    Airtable.configure({
        // endpointURL: 'https://api.airtable.com', // Usually not needed to specify
        apiKey: process.env.AIRTABLE_API_KEY
    });

    // Get the specific base you want to use with your Base ID
    airtableBaseInstance = Airtable.base(process.env.AIRTABLE_BASE_ID);

    console.log("Airtable Client Initialized successfully in config/airtableClient.js.");

} catch (error) {
    console.error("CRITICAL ERROR: Failed to initialize Airtable Client in config/airtableClient.js:", error.message);
    // airtableBaseInstance will remain null if an error occurs
    // The main application (index.js) will need to handle this possibility.
}

// Export the initialized base instance (it will be null if initialization failed)
module.exports = airtableBaseInstance;