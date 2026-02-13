'use client';

import React, { useState, useMemo } from 'react';

// Email thread separator (matches backend)
const EMAIL_BLOCK_SEP = /\n-{3,}\n/;
// Meeting block separator
const MEETING_BLOCK_SEP = /━{10,}/;

/**
 * Shorten URL for display (domain + path hint)
 */
function shortenUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname !== '/' ? u.pathname.slice(0, 30) + (u.pathname.length > 30 ? '…' : '') : '';
    return path ? `${host}${path}` : host;
  } catch {
    return url.length > 40 ? url.slice(0, 37) + '…' : url;
  }
}

/**
 * Convert URLs to clickable links with shortened display
 */
function linkifyText(text, shortLinks = true) {
  if (!text) return text;
  const urlRegex = /(https?:\/\/[^\s<>"]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      const label = shortLinks ? shortenUrl(part) : part;
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 hover:underline"
          title={part}
          onClick={(e) => e.stopPropagation()}
        >
          {label} ↗
        </a>
      );
    }
    return part;
  });
}

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
    ? [{ header: `Quoted: ${quotedMatch[1].trim()}`, body: quotedMatch[2].trim().slice(0, 800) }]
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
 * Split meeting section into blocks
 */
function splitMeetingBlocks(content) {
  if (!content || !content.trim()) return [];
  return content.split(MEETING_BLOCK_SEP).map(b => b.trim()).filter(Boolean);
}

/**
 * Get block title (first line or subject)
 */
function getBlockTitle(block, fallback = 'Thread') {
  const first = block.split('\n')[0]?.trim() || '';
  if (first.toLowerCase().startsWith('subject:')) return first.slice(8).trim() || fallback;
  if (first.length > 50) return first.slice(0, 47) + '…';
  return first || fallback;
}

/**
 * Section headers we look for in notes
 */
const SECTION_MARKERS = {
  manual: '=== MANUAL NOTES ===',
  email: '=== EMAIL CORRESPONDENCE ===',
  linkedin: '=== LINKEDIN MESSAGES ===',
  salesnav: '=== SALES NAVIGATOR ===',
  meeting: '=== MEETING NOTES ==='
};

// Legacy separator used in notesSectionManager
const LEGACY_SEPARATOR = '───────────────────────────────';

/**
 * Parse notes string into sections
 * @param {string} notes - Full notes string
 * @returns {Object} Parsed sections with content and metadata
 */
function parseNotesIntoSections(notes) {
  if (!notes) {
    return { sections: [], unsectioned: '' };
  }

  const sections = [];
  let currentSection = null;
  let currentLines = [];
  let legacyLines = [];
  let inLegacy = false;

  const lines = notes.split('\n');

  for (const line of lines) {
    // Check for legacy separator
    if (line.trim() === LEGACY_SEPARATOR || line.includes('─────────')) {
      // Save current section before switching to legacy
      if (currentSection && currentLines.length > 0) {
        sections.push({
          key: currentSection,
          title: getSectionTitle(currentSection),
          content: currentLines.join('\n').trim(),
          lineCount: currentLines.filter(l => l.trim()).length,
          lastDate: extractLastDate(currentLines)
        });
        currentSection = null;
        currentLines = [];
      }
      inLegacy = true;
      continue;
    }

    // If we're in legacy section, collect all remaining lines
    if (inLegacy) {
      legacyLines.push(line);
      continue;
    }

    // Check if this line is a section header
    let foundSection = null;
    for (const [key, marker] of Object.entries(SECTION_MARKERS)) {
      if (line.trim() === marker) {
        foundSection = key;
        break;
      }
    }

    if (foundSection) {
      // Save previous section if exists
      if (currentSection && currentLines.length > 0) {
        sections.push({
          key: currentSection,
          title: getSectionTitle(currentSection),
          content: currentLines.join('\n').trim(),
          lineCount: currentLines.filter(l => l.trim()).length,
          lastDate: extractLastDate(currentLines)
        });
      } else if (currentLines.length > 0 && !currentSection) {
        // Content before any section header goes to legacy
        legacyLines = [...currentLines, ...legacyLines];
      }
      
      currentSection = foundSection;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Don't forget the last section
  if (currentSection && currentLines.length > 0) {
    sections.push({
      key: currentSection,
      title: getSectionTitle(currentSection),
      content: currentLines.join('\n').trim(),
      lineCount: currentLines.filter(l => l.trim()).length,
      lastDate: extractLastDate(currentLines)
    });
  } else if (currentLines.length > 0) {
    // Any remaining content without a section header
    legacyLines = [...legacyLines, ...currentLines];
  }

  // Add legacy section if we have legacy content
  const legacyContent = legacyLines.join('\n').trim();
  if (legacyContent) {
    sections.push({
      key: 'legacy',
      title: 'Legacy Notes',
      content: legacyContent,
      lineCount: legacyLines.filter(l => l.trim()).length,
      lastDate: extractLastDate(legacyLines)
    });
  }

  return {
    sections,
    unsectioned: '' // All unsectioned content now goes to legacy
  };
}

/**
 * Get display title for section
 */
function getSectionTitle(key) {
  const titles = {
    manual: 'Manual',
    email: 'Email',
    linkedin: 'LinkedIn',
    salesnav: 'Sales Nav',
    meeting: 'Meeting',
    legacy: 'Legacy'
  };
  return titles[key] || key;
}

/**
 * Extract the most recent date from section content
 * Iterates from TOP to BOTTOM to find the newest entry (LinkedIn/Email show newest first at top)
 * Looks for various date patterns:
 * - DD-MM-YY (LinkedIn/Email: "04-02-26 4:27 PM - Guy Wilson...")
 * - DD/MM/YYYY (Fathom recorded: "[Recorded 04/02/2026, 9:09 pm]")
 * - YYYY-MM-DD (ISO format)
 * - Month DD, YYYY (Meeting notes: "Feb 4, 2026" or "February 4, 2026")
 * - DD Mon YY (e.g., "04 Feb 26")
 */
function extractLastDate(lines) {
  // Pattern 1: DD-MM-YY at start of line (LinkedIn/Email)
  const ddmmyyPattern = /^(\d{2}-\d{2}-\d{2})/;
  // Pattern 2: DD/MM/YYYY anywhere (Fathom recorded dates)
  const ddmmyyyySlashPattern = /(\d{2})\/(\d{2})\/(\d{4})/;
  // Pattern 3: YYYY-MM-DD anywhere in line
  const isoPattern = /(\d{4})-(\d{2})-(\d{2})/;
  // Pattern 4: Month DD, YYYY or Month D, YYYY (e.g., "February 4, 2026" or "Feb 4, 2026")
  const monthDayYearPattern = /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4}|\d{2})/i;
  // Pattern 5: DD Mon YY (e.g., "04 Feb 26")
  const ddMonYYPattern = /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2,4})/i;
  
  // Iterate from top to bottom to find the most recent date (newest entries are at top)
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    
    // Try DD-MM-YY first (most common for LinkedIn/Email)
    let match = trimmed.match(ddmmyyPattern);
    if (match) {
      return match[1];
    }
    
    // Try DD/MM/YYYY (Fathom recorded dates like "[Recorded 04/02/2026, 9:09 pm]")
    match = trimmed.match(ddmmyyyySlashPattern);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3].slice(2)}`;
    }
    
    // Try ISO format YYYY-MM-DD
    match = trimmed.match(isoPattern);
    if (match) {
      return `${match[3]}-${match[2]}-${match[1].slice(2)}`;
    }
    
    // Try Month DD, YYYY format (common in meeting notes)
    match = trimmed.match(monthDayYearPattern);
    if (match) {
      const monthMap = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', 
                        jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
      const month = monthMap[match[1].slice(0, 3).toLowerCase()];
      const day = match[2].padStart(2, '0');
      let year = match[3];
      if (year.length === 4) year = year.slice(2);
      return `${day}-${month}-${year}`;
    }
    
    // Try DD Mon YY format
    match = trimmed.match(ddMonYYPattern);
    if (match) {
      const monthMap = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', 
                        jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
      const day = match[1].padStart(2, '0');
      const month = monthMap[match[2].toLowerCase()];
      let year = match[3];
      if (year.length === 4) year = year.slice(2);
      return `${day}-${month}-${year}`;
    }
  }
  return null;
}

/** Max lines before "Show more" */
const SHOW_MORE_THRESHOLD = 15;

/**
 * Render a single block with readability enhancements
 */
function ReadableBlock({ content, defaultExpanded = false }) {
  const [showMore, setShowMore] = useState(false);
  const processed = useMemo(() => {
    let t = collapseImagePlaceholders(content);
    t = stripFooter(t);
    return t;
  }, [content]);
  const lines = processed.split('\n');
  const isLong = lines.length > SHOW_MORE_THRESHOLD;
  const displayLines = showMore || !isLong ? lines : lines.slice(0, SHOW_MORE_THRESHOLD);
  const { main, quoted } = splitQuotedSections(displayLines.join('\n'));
  const hasQuoted = quoted.length > 0;

  return (
    <div className="space-y-2">
      <div className="whitespace-pre-wrap text-sm text-gray-800 font-mono leading-relaxed break-words">
        {linkifyText(main)}
      </div>
      {hasQuoted && (
        <details className="mt-2 border border-gray-200 rounded overflow-hidden">
          <summary className="px-3 py-2 bg-gray-50 cursor-pointer text-xs text-gray-600 hover:bg-gray-100">
            {quoted[0].header}
          </summary>
          <div className="px-3 py-2 text-xs text-gray-500 whitespace-pre-wrap font-mono">
            {linkifyText(quoted[0].body)}
          </div>
        </details>
      )}
      {isLong && !showMore && (
        <button
          type="button"
          className="text-xs text-blue-600 hover:underline"
          onClick={() => setShowMore(true)}
        >
          Show more ({lines.length - SHOW_MORE_THRESHOLD} lines)
        </button>
      )}
    </div>
  );
}

/**
 * Section content: sub-collapsibles for email/meeting, flat for others
 */
function SectionContent({ sectionKey, content }) {
  const [expandedBlocks, setExpandedBlocks] = useState({});
  const blocks = useMemo(() => {
    if (!content) return [];
    if (sectionKey === 'email') return splitEmailBlocks(content);
    if (sectionKey === 'meeting') return splitMeetingBlocks(content);
    return null;
  }, [sectionKey, content]);

  const toggleBlock = (i) => {
    setExpandedBlocks(prev => ({ ...prev, [i]: !prev[i] }));
  };

  if (!content) return <span className="text-gray-400 italic">No content</span>;
  if (blocks && blocks.length > 1) {
    return (
      <div className="space-y-2">
        {blocks.map((block, i) => {
          const isExp = expandedBlocks[i] ?? (i === 0);
          const title = getBlockTitle(block, sectionKey === 'email' ? 'Email thread' : 'Meeting');
          return (
            <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
              <button
                type="button"
                className="w-full px-3 py-2 flex items-center justify-between bg-gray-50 hover:bg-gray-100 text-left text-sm"
                onClick={() => toggleBlock(i)}
              >
                <span className="font-medium text-gray-700 truncate">{title}</span>
                <svg className={`w-4 h-4 shrink-0 transform ${isExp ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isExp && (
                <div className="p-3 border-t border-gray-100">
                  <ReadableBlock content={block} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div>
      <ReadableBlock content={content} defaultExpanded />
    </div>
  );
}

/**
 * Section icon components
 */
const SectionIcons = {
  manual: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  ),
  email: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  linkedin: (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
    </svg>
  ),
  salesnav: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  meeting: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  ),
  legacy: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
};

/**
 * CollapsibleNotes - Renders notes with collapsible sections
 * 
 * @param {string} notes - The full notes string
 * @param {number} maxHeight - Max height before scrolling (default: 300px)
 * @param {boolean} defaultExpanded - Whether sections start expanded (default: false)
 * @param {boolean} showLineNumbers - Show line count badges (default: true)
 */
export default function CollapsibleNotes({ 
  notes, 
  maxHeight = 300, 
  defaultExpanded = false,
  showLineNumbers = true 
}) {
  const [expandedSections, setExpandedSections] = useState(() => {
    // Default: expand first section only if defaultExpanded is false
    return defaultExpanded ? {} : {};
  });
  const [isFullyExpanded, setIsFullyExpanded] = useState(false);

  const { sections, unsectioned } = useMemo(() => parseNotesIntoSections(notes), [notes]);

  const toggleSection = (key) => {
    setExpandedSections(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const toggleAll = () => {
    if (isFullyExpanded) {
      setExpandedSections({});
    } else {
      const allExpanded = {};
      sections.forEach(s => { allExpanded[s.key] = true; });
      setExpandedSections(allExpanded);
    }
    setIsFullyExpanded(!isFullyExpanded);
  };

  // If no sections found, just show raw notes
  if (sections.length === 0) {
    return (
      <div 
        className="overflow-y-auto font-mono text-sm text-gray-800 whitespace-pre-wrap"
        style={{ maxHeight: `${maxHeight}px` }}
      >
        {notes || <span className="text-gray-400 italic">No notes</span>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Expand/Collapse All Button */}
      <div className="flex justify-end mb-2">
        <button
          onClick={toggleAll}
          className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
        >
          {isFullyExpanded ? (
            <>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
              Collapse All
            </>
          ) : (
            <>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              Expand All
            </>
          )}
        </button>
      </div>

      {/* Unsectioned content (if any) */}
      {unsectioned && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-2">
          <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono">
            {unsectioned}
          </pre>
        </div>
      )}

      {/* Collapsible Sections */}
      <div 
        className="space-y-2 overflow-y-auto"
        style={{ maxHeight: isFullyExpanded ? '400px' : `${maxHeight}px` }}
      >
        {sections.map((section) => {
          const isExpanded = expandedSections[section.key];
          const Icon = SectionIcons[section.key] || SectionIcons.manual;

          return (
            <div 
              key={section.key} 
              className="border border-gray-200 rounded-lg overflow-hidden bg-white"
            >
              {/* Section Header */}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleSection(section.key);
                }}
                className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">{Icon}</span>
                  <span className="font-medium text-gray-700">{section.title}</span>
                  {showLineNumbers && section.lineCount > 0 && (
                    <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                      {section.lineCount} lines
                    </span>
                  )}
                  {section.lastDate && (
                    <span className="text-xs text-gray-400">
                      Last: {section.lastDate}
                    </span>
                  )}
                </div>
                <svg 
                  className={`w-4 h-4 text-gray-400 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Section Content */}
              {isExpanded && (
                <div className="p-4 border-t border-gray-100">
                  <SectionContent sectionKey={section.key} content={section.content} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Compact version for inline display (e.g., in lead cards)
 */
export function CollapsibleNotesCompact({ notes, maxHeight = 200 }) {
  const { sections } = useMemo(() => parseNotesIntoSections(notes), [notes]);
  
  if (sections.length === 0 && !notes) {
    return <span className="text-gray-400 italic text-sm">No notes</span>;
  }

  return (
    <div 
      className="overflow-y-auto text-sm"
      style={{ maxHeight: `${maxHeight}px` }}
    >
      {sections.length > 0 ? (
        <div className="space-y-1">
          {sections.map(section => (
            <div key={section.key} className="flex items-center gap-2 text-gray-600">
              <span className="font-medium">{section.title}:</span>
              <span className="text-gray-400">{section.lineCount} lines</span>
              {section.lastDate && (
                <span className="text-gray-400 text-xs">(last: {section.lastDate})</span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <pre className="whitespace-pre-wrap text-gray-700 font-mono">
          {notes?.substring(0, 200)}{notes?.length > 200 ? '...' : ''}
        </pre>
      )}
    </div>
  );
}
