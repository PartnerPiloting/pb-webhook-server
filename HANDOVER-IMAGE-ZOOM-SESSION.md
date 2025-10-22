# Handover Document: Image Zoom Feature Implementation

**Date:** October 22, 2025  
**Session Summary:** Implementing click-to-zoom functionality for diagram images in help system

---

## 🎯 Current Status

### What We're Trying to Achieve
Display a Mermaid diagram (System Architecture Diagram) in the help system with:
- ✅ Clear, readable text at initial display
- ✅ Click-to-zoom functionality (toggle between two sizes)
- ✅ Zoom indicator showing current size
- ✅ Auto-centering when zoomed
- ✅ Smooth transitions
- ✅ High-quality rendering (no blur)

### Current Problem
**Zoom doesn't work in production.** When user clicks the diagram image on the live site, nothing happens. No zoom, no indicator update.

---

## 📁 Key Files

### Production Code
**File:** `linkedin-messaging-followup-next/components/HelpHtmlRenderer.js`  
**Location:** Lines 28-60  
**Latest Commits:**
- `0a34f5a` - Moved zoom handler to `<script>` block (should fix issue)
- `bcab0d7` - Changed starting size from 100% to 120%
- Current HEAD on `main`: `0f7f4a7`

### Test Files Created
1. **`test-image-rendering.html`** - Comprehensive test with 4 rendering modes
   - Tests different CSS `image-rendering` values
   - Winner: Test 4 (high-quality rendering)
   - Location: Project root
   
2. **`zoom-test.html`** - Standalone test on Desktop
   - Uses EXACT production code
   - Fetches from live API
   - Can open without local server
   - Location: `C:\Users\guyra\Desktop\zoom-test.html`

---

## 🔧 Technical Implementation

### Current Code Structure
```javascript
// HelpHtmlRenderer.js - Lines 28-60
safe = safe.replace(/<img([^>]*)>/gi, (match, attrs) => {
  const uniqueId = Math.random().toString(36).substr(2, 9);
  
  return `<div class="my-4 space-y-2">
    <div class="border rounded-lg overflow-auto bg-gray-50 p-4" 
         style="max-height:1200px;" id="container-${uniqueId}">
      <img${attrs} id="img-${uniqueId}" 
           style="display:block;width:120%;height:auto;cursor:zoom-in;
                  image-rendering:high-quality;transition:width 0.3s ease;" />
    </div>
    <div class="text-xs text-gray-500 italic text-center">
      <span class="text-gray-400">(click to zoom, scroll to view) </span>
      <span id="indicator-${uniqueId}" class="font-semibold text-blue-600">120%</span>
    </div>
    <script>
      (function() {
        const img = document.getElementById('img-${uniqueId}');
        const container = document.getElementById('container-${uniqueId}');
        const indicator = document.getElementById('indicator-${uniqueId}');
        
        img.onclick = function() {
          const isZoomed = this.style.width === '150%';
          this.style.width = isZoomed ? '120%' : '150%';
          this.style.cursor = isZoomed ? 'zoom-in' : 'zoom-out';
          indicator.textContent = isZoomed ? '120%' : '150%';
          
          if (!isZoomed) {
            setTimeout(function() {
              container.scrollLeft = (container.scrollWidth - container.clientWidth) / 2;
            }, 50);
          }
        };
      })();
    </script>
  </div>`;
});
```

### Key Features
- **Starting size:** 120% width (makes text readable immediately)
- **Zoom toggle:** 120% ↔ 150%
- **Rendering:** `image-rendering: high-quality` (prevents blur)
- **Auto-center:** Scrolls to horizontal center when zooming in
- **Indicator:** Blue text shows current zoom level
- **Unique IDs:** Each image gets unique container/img/indicator IDs

---

## 🐛 Debugging Status

### What We've Tried
1. ❌ Inline `onclick` attribute - Got mangled/escaped
2. ✅ Moved to `<script>` block - Should work but needs verification
3. ✅ Changed from percentage scaling to high-quality rendering
4. ✅ Increased default size from 100% to 120%

### Suspected Issue
**React/Next.js may be stripping the `<script>` tags** when rendering HTML from `dangerouslySetInnerHTML`.

This is common in React because:
- React sanitizes HTML for security
- `<script>` tags in `dangerouslySetInnerHTML` often don't execute
- Need to use proper React event handlers instead

### Next Steps to Debug

1. **Verify if script tags are present:**
   - Open production site: https://pb-webhook-server.vercel.app/start-here
   - Navigate to "The Moving Parts" help topic
   - Right-click diagram → Inspect Element
   - Check if `<script>` tag exists after `<img>` tag
   
2. **Test standalone file:**
   - Open `C:\Users\guyra\Desktop\zoom-test.html`
   - Click the image
   - If zoom works here → React is the issue
   - If zoom doesn't work → JavaScript logic is the issue

3. **Check browser console:**
   - Press F12 on production site
   - Click Console tab
   - Click the image
   - Look for JavaScript errors

---

## 🔄 Possible Solutions

### If React is Stripping Scripts (Most Likely)

**Option A: Use useEffect Hook**
```javascript
// In the React component that renders help HTML
useEffect(() => {
  const images = document.querySelectorAll('.help-image');
  images.forEach(img => {
    img.onclick = function() {
      // Zoom logic here
    };
  });
}, [htmlContent]);
```

**Option B: Create React Image Component**
Move image handling to a proper React component with onClick handler.

**Option C: Use data-* attributes + global script**
Add `data-zoomable="true"` to images, then have a global script that attaches handlers on mount.

### If JavaScript Logic is Wrong

Fix the logic in `HelpHtmlRenderer.js` (unlikely since it worked in test harness).

---

## 📦 Asset Information

### The Diagram Image
- **Source:** Mermaid diagram exported as PNG
- **Resolution:** 4000 x 8254 pixels (high-res)
- **Location:** Airtable Media table, media_id = 68
- **Format:** PNG (switched from SVG due to rendering issues)
- **Airtable Base:** Master Clients base (appJ9XAZeJeK5x55r)
- **Help Topic:** "The Moving Parts" (ID: recmNfxlg467K25qk)

### API Endpoints
- **Help Topic:** `GET /api/help/topic/:id`
- **Test Endpoint:** https://pb-webhook-server-staging.onrender.com/api/help/topic/recmNfxlg467K25qk

---

## 🎨 Design Decisions Made

1. **120% starting size** - User feedback that text was too small at 100%
2. **High-quality rendering** - User tested 4 options, picked this for sharpness
3. **Removed progressive zoom** - Simplified from 100%→150%→200% to just 120%↔150%
4. **Auto-center on zoom** - User requested, implemented with 50ms delay
5. **Universal application** - Works for ALL images, not diagram-specific

---

## 🚀 Deployment History

Recent commits (most recent first):
- `0f7f4a7` (main) - Start images at 120% for readability
- `82f1d85` (main) - Fix zoom handler with script block  
- `23d26c5` (main) - Add smooth zoom with indicators
- `f2e9b8e` (main) - Simplify image display
- `60e0606` (main) - Simplify to all image types

All deployed via:
1. Commit to `staging` branch
2. Merge `staging` → `main`
3. Auto-deploy to Vercel (frontend) and Render (backend)

---

## ⚠️ Important Context

### This Session's Journey
We went through many iterations trying to:
1. Get SVG rendering working (failed - SVG appeared blank)
2. Switch to PNG export (success)
3. Add zoom functionality (complex inline onclick failed)
4. Test different rendering modes (high-quality won)
5. Fix blur issues (image-rendering CSS)
6. Adjust sizing (100% → 120%)
7. Move to script block (current state)

### What Works
✅ Image displays correctly  
✅ Image quality is excellent (4000px PNG)  
✅ 120% size makes text readable  
✅ Container scrolling works  
✅ Test harness zoom works perfectly  

### What Doesn't Work
❌ Click-to-zoom in production  
❌ Zoom indicator doesn't update  
❌ No response when clicking image  

---

## 🔍 Recommended Next Session Actions

### Priority 1: Verify Script Tag Presence
```
1. Open production site
2. Inspect diagram image element
3. Check if <script> tag exists in DOM
4. Report findings
```

### Priority 2: Test Standalone File
```
1. Open C:\Users\guyra\Desktop\zoom-test.html
2. Click diagram
3. Does zoom work? Report result
```

### Priority 3: Choose Solution Path
Based on findings above:
- **If script missing:** Implement React-based event handling (Option A/B/C above)
- **If script present but not working:** Debug JavaScript logic
- **If standalone test fails:** Fix the zoom function itself

---

## 📞 Quick Reference

### Commands to Deploy
```bash
cd /c/Users/guyra/Desktop/pb-webhook-server-dev
git add -A
git commit -m "Your message"
git push origin staging
git checkout main
git merge staging -m "Merge message"
git push origin main
git checkout staging
```

### Files to Check
- Frontend code: `linkedin-messaging-followup-next/components/HelpHtmlRenderer.js`
- Test harness: `test-image-rendering.html` (in project root)
- Standalone test: `C:\Users\guyra\Desktop\zoom-test.html`

### URLs
- Production: https://pb-webhook-server.vercel.app/start-here
- Staging API: https://pb-webhook-server-staging.onrender.com
- Help Topic API: https://pb-webhook-server-staging.onrender.com/api/help/topic/recmNfxlg467K25qk

---

## 💡 Key Learnings

1. **Always test locally first** - Test harness approach saved time
2. **React doesn't execute inline scripts** - Major gotcha discovered
3. **User testing validates approach** - The 4-test comparison was valuable
4. **High-res source matters** - 4000px PNG prevents blur issues
5. **Simpler is better** - Multiple zoom levels added complexity

---

**Status at Session End:** Code is deployed, zoom feature should work based on test harness, but not working in production. Need to verify if React is stripping script tags and implement proper React event handling if so.
