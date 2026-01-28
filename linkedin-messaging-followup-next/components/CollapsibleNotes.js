'use client';

import React, { useState, useMemo } from 'react';

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
 * Looks for DD-MM-YY patterns
 */
function extractLastDate(lines) {
  const datePattern = /^(\d{2}-\d{2}-\d{2})/;
  
  for (const line of lines) {
    const match = line.trim().match(datePattern);
    if (match) {
      return match[1];
    }
  }
  return null;
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
                  <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono leading-relaxed">
                    {section.content || <span className="text-gray-400 italic">No content</span>}
                  </pre>
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
