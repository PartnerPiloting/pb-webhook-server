/**
 * Notes display formatting utilities
 * Pure functions for transforming notes content for display.
 * Used by CollapsibleNotes and testable without env vars.
 */

// Email thread separator (matches backend - must NOT be plain "---" which appears in email bodies)
const EMAIL_BLOCK_SEP = /\n---EMAIL-THREAD---\n/;
// Meeting block separator (primary: heavy horizontal line from notesSectionManager)
const MEETING_BLOCK_SEP = /━{10,}/;
// Fallback 1: split on double newline before next meeting header (═ or 📹) - handles legacy/merged content
const MEETING_BLOCK_FALLBACK = /\r?\n\r?\n+(?=[═=]{20,}|📹\s)/;
// Fallback 2: split before each 📹 line that starts a meeting header (Name | date | duration)
const MEETING_BLOCK_FALLBACK_VIDEO = /\r?\n\r?\n+(?=📹\s[^\n]+\|)/;

/**
 * Collapse [image: ...] placeholders to compact pill
 */
function collapseImagePlaceholders(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/\[image:\s*([^\]]*)\]/gi, (_, label) => {
    const short = (label || 'image').trim().slice(0, 20);
    return short ? ` [📷 ${short}] ` : ' [📷] ';
  });
}

/**
 * Collapse "From: ... Date: ... Subject: ..." email headers to reduce clutter.
 * ONLY matches when preceded by "---------- Forwarded message ----------" to avoid
 * replacing content that happens to contain "From:" or "Date:" in the body.
 */
function collapseEmailHeaders(text) {
  if (!text || typeof text !== 'string') return text;
  // Only match header blocks that follow the Gmail forwarded message separator
  const forwardedBlockRegex = /(-{5,}\s*Forwarded message\s*-{5,}\s*\n)(From:\s*[^\n]+(?:\n?\s*Date:\s*[^\n]+)?(?:\n?\s*Subject:\s*[^\n]+)?(?:\n?\s*To:\s*[^\n]+)?)/gi;
  return text.replace(forwardedBlockRegex, (_, separator, headerBlock) => {
    const fromMatch = headerBlock.match(/From:\s*([^<\n]+(?:<[^>]+>)?)/i);
    const dateMatch = headerBlock.match(/Date:\s*([^\n]+)/i);
    let from = fromMatch ? fromMatch[1].trim().replace(/\s+/g, ' ').slice(0, 40) : '';
    let date = '';
    if (dateMatch) {
      // Strip "Subject: ..." from date when Date and Subject are on same line
      date = dateMatch[1].trim().replace(/\s+Subject:.*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 30);
    }
    return `${separator}[Forwarded: ${from}${date ? ` · ${date}` : ''}]\n\n`;
  });
}

/**
 * Strip common corporate footer/disclaimer
 */
function stripFooter(text) {
  if (!text || typeof text !== 'string') return text;
  const footerPatterns = [
    /\n\s*This email and any attachments may contain confidential[\s\S]*$/i,
    /\n\s*This message and any attachment[\s\S]*$/i,
    /\n\s*CONFIDENTIALITY NOTICE[\s\S]*$/i,
    /\n\s*Disclaimer[\s\S]*$/i
  ];
  let result = text;
  for (const p of footerPatterns) {
    const match = result.match(p);
    if (match) {
      result = result.slice(0, match.index).trim();
      break;
    }
  }
  return result;
}

/**
 * Split content into main + quoted sections for collapsible display
 */
function splitQuotedSections(text) {
  if (!text || typeof text !== 'string') return { main: text, quoted: [] };
  const onWrote = /On\s+.+?wrote:\s*/i;
  const idx = text.search(onWrote);
  if (idx === -1) return { main: text, quoted: [] };
  const main = text.slice(0, idx).trim();
  const rest = text.slice(idx);
  const quotedMatch = rest.match(/On\s+(.+?)wrote:\s*([\s\S]*)/i);
  const quoted = quotedMatch
    ? [{ header: `Quoted: ${quotedMatch[1].trim()}`, body: quotedMatch[2].trim() }]
    : [];
  return { main, quoted };
}

/**
 * Split email section into thread blocks
 */
function splitEmailBlocks(content) {
  if (!content || !content.trim()) return [];
  return content.split(EMAIL_BLOCK_SEP).map(b => b.trim()).filter(Boolean);
}

/**
 * Split meeting section into blocks.
 * Primary: split on ━━ separator (used when appending via inbound email).
 * Fallback: split on double newline before next meeting header - handles legacy/merged content.
 */
function splitMeetingBlocks(content) {
  if (!content || !content.trim()) return [];
  let blocks = content.split(MEETING_BLOCK_SEP).map(b => b.trim()).filter(Boolean);
  // If only one block, try fallbacks for legacy/merged content
  if (blocks.length === 1) {
    // Trigger if: multiple [Recorded...] lines, or multiple 📹 lines, or 4+ ═/=
    const recordedCount = (content.match(/\[Recorded\s+\d{2}\/\d{2}\/\d{4}/g) || []).length;
    const videoCount = (content.match(/📹\s/g) || []).length;
    const eqCount = (content.match(/[═=]{20,}/g) || []).length;
    const hasMultipleMeetings = recordedCount >= 2 || videoCount >= 2 || eqCount >= 4;
    if (hasMultipleMeetings) {
      // Try fallback 1 (═ or 📹), then fallback 2 (📹 Name | date)
      blocks = content.split(MEETING_BLOCK_FALLBACK).map(b => b.trim()).filter(Boolean);
      if (blocks.length <= 1) {
        blocks = content.split(MEETING_BLOCK_FALLBACK_VIDEO).map(b => b.trim()).filter(Boolean);
      }
    }
  }
  return blocks;
}

/**
 * Get block title (first line or subject)
 * For meeting blocks: prefer 📹 line (Name | date | duration)
 */
function getBlockTitle(block, fallback = 'Thread') {
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
  const first = lines[0] || '';
  if (first.toLowerCase().startsWith('subject:')) return first.slice(8).trim() || fallback;
  // For meeting blocks: look for 📹 line (Name | date | duration)
  if (fallback === 'Meeting') {
    const videoLine = lines.find(l => l.startsWith('📹'));
    if (videoLine) return videoLine.replace(/^📹\s*/, '').trim().slice(0, 60) || fallback;
  }
  if (first.length > 50) return first.slice(0, 47) + '…';
  return first || fallback;
}

/**
 * Put each sentence on its own line for easier scanning.
 * Splits on period/exclamation/question followed by space.
 * Skips common abbreviations (Dr., Mr., etc.) to avoid false splits.
 */
function splitIntoSentences(text) {
  if (!text || typeof text !== 'string') return text;
  const abbrev = /\b(Dr|Mr|Mrs|Ms|Jr|Sr|U\.S|U\.K|etc|vs|i\.e|e\.g|a\.m|p\.m)\.\s+/gi;
  // Temporarily protect abbreviations
  const placeholders = [];
  let t = text.replace(abbrev, (m) => {
    placeholders.push(m);
    return `\x00${placeholders.length - 1}\x00`;
  });
  // Split on sentence-ending punctuation followed by space
  t = t.replace(/([.!?])\s+(?=[A-Z])/g, '$1\n');
  // Restore abbreviations
  placeholders.forEach((p, i) => {
    t = t.replace(new RegExp(`\x00${i}\x00`, 'g'), p);
  });
  return t;
}

/**
 * Full processing pipeline for display (collapse headers, images, strip footer, sentence-per-line).
 * Use this to test the complete transform.
 */
function processForDisplay(text) {
  if (!text || typeof text !== 'string') return text;
  let t = collapseImagePlaceholders(text);
  t = collapseEmailHeaders(t);
  t = stripFooter(t);
  t = splitIntoSentences(t);
  return t;
}

module.exports = {
  collapseImagePlaceholders,
  collapseEmailHeaders,
  stripFooter,
  splitIntoSentences,
  splitQuotedSections,
  splitEmailBlocks,
  splitMeetingBlocks,
  getBlockTitle,
  processForDisplay
};
