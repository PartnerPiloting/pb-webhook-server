# Network Accelerator - LinkedIn Quick Update Extension

Chrome extension for quickly saving LinkedIn conversations to your Network Accelerator portal.

## Features

- **One-click save**: Button appears on LinkedIn conversation pages
- **Auto-authentication**: Syncs credentials from your open portal tab
- **Smart parsing**: Automatically formats messages for the Notes field
- **Multi-tenant safe**: Uses your portal session credentials

## Installation (Developer Mode)

1. Add icon images to the `icons/` folder:
   - `icon16.png` (16x16)
   - `icon48.png` (48x48)
   - `icon128.png` (128x128)

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" (toggle in top-right)

4. Click "Load unpacked" and select this `chrome-extension` folder

5. The extension icon should appear in your toolbar

## Usage

1. **Connect**: Open your Network Accelerator portal in any Chrome tab. The extension will automatically detect your login.

2. **Save conversations**: 
   - Go to LinkedIn and open a messaging conversation
   - Click the "Save to Portal" button (bottom-right corner)
   - The extension will:
     - Find the lead by their LinkedIn profile URL
     - Scrape all visible messages
     - Save them to the lead's Notes field

3. **Check status**: Click the extension icon to see connection status

## How It Works

### Authentication
- When you open your portal, the content script reads your credentials from `localStorage`
- These are broadcast to the extension's background worker
- Stored in `chrome.storage.local` for API calls
- No passwords are stored—only session tokens

### API Calls
1. `GET /api/linkedin/leads/lookup?query={profileUrl}` - Find lead by URL
2. `PATCH /api/linkedin/leads/{id}/quick-update` - Save conversation

### DOM Selectors
The extension uses selectors to find messages on LinkedIn. If LinkedIn changes their markup, update the `SELECTORS` object in `content-linkedin.js`.

## Troubleshooting

### "Not Connected" message
- Make sure your Network Accelerator portal is open in a tab
- Refresh the portal page
- Check that you're logged in (not seeing a login prompt)

### Button doesn't appear
- Make sure you're on a LinkedIn messaging page (`linkedin.com/messaging/*`)
- Try refreshing the LinkedIn page
- Check the browser console for errors

### "No matching lead found"
- The lead must already exist in your portal
- The LinkedIn profile URL must match exactly
- Try the quick update in the portal directly to verify the lookup works

## Files

```
chrome-extension/
├── manifest.json        # Extension configuration
├── background.js        # Service worker (API calls, auth management)
├── content-linkedin.js  # LinkedIn page script (button, scraping)
├── content-portal.js    # Portal page script (auth broadcast)
├── popup.html          # Extension popup UI
├── popup.js            # Popup logic
├── styles.css          # Button and toast styles
└── icons/              # Extension icons
```

## Development

To modify selectors when LinkedIn changes their DOM:

1. Open LinkedIn messaging in Chrome
2. Right-click on a message → Inspect
3. Find the new class names/structure
4. Update the `SELECTORS` object in `content-linkedin.js`

Future improvement: Move selectors to a server-side config fetched on load for hot-updates without reinstalling.
