/**
 * Notes Section Manager
 * 
 * Manages sectioned notes in a lead's Notes field.
 * Sections are created dynamically at the top when first used.
 * Legacy notes remain at the bottom, untouched.
 * 
 * Section Order (when present):
 * 1. === LINKEDIN MESSAGES ===
 * 2. === MANUAL NOTES ===
 * 3. === SALES NAVIGATOR ===
 * 4. ─────────────────────────────── (separator)
 * 5. [OTHER - Legacy Notes] (unmarked original content)
 */

const SECTION_HEADERS = {
    linkedin: '=== LINKEDIN MESSAGES ===',
    manual: '=== MANUAL NOTES ===',
    salesnav: '=== SALES NAVIGATOR ===',
    email: '=== EMAIL CORRESPONDENCE ==='
};

const LEGACY_SEPARATOR = '───────────────────────────────';

// Section display order (first = top of notes)
const SECTION_ORDER = ['linkedin', 'manual', 'salesnav', 'email'];

/**
 * Parse existing notes into sections
 * @param {string} notes - Current notes content
 * @returns {Object} Parsed sections { linkedin, manual, salesnav, email, legacy }
 */
function parseNotesIntoSections(notes) {
    if (!notes || typeof notes !== 'string') {
        return { linkedin: '', manual: '', salesnav: '', email: '', legacy: '' };
    }

    const sections = { linkedin: '', manual: '', salesnav: '', email: '', legacy: '' };
    
    // Find each section's content
    let remainingContent = notes;
    
    // Extract each known section
    for (const [key, header] of Object.entries(SECTION_HEADERS)) {
        const headerIndex = remainingContent.indexOf(header);
        if (headerIndex !== -1) {
            // Find where this section ends (next section header or legacy separator)
            let endIndex = remainingContent.length;
            
            // Check for other section headers after this one
            for (const otherHeader of Object.values(SECTION_HEADERS)) {
                if (otherHeader === header) continue;
                const otherIndex = remainingContent.indexOf(otherHeader, headerIndex + header.length);
                if (otherIndex !== -1 && otherIndex < endIndex) {
                    endIndex = otherIndex;
                }
            }
            
            // Check for legacy separator
            const sepIndex = remainingContent.indexOf(LEGACY_SEPARATOR, headerIndex + header.length);
            if (sepIndex !== -1 && sepIndex < endIndex) {
                endIndex = sepIndex;
            }
            
            // Extract section content (without header)
            const sectionContent = remainingContent
                .substring(headerIndex + header.length, endIndex)
                .trim();
            
            sections[key] = sectionContent;
        }
    }
    
    // Find legacy content (after separator, or content not in any section)
    const sepIndex = notes.indexOf(LEGACY_SEPARATOR);
    if (sepIndex !== -1) {
        sections.legacy = notes.substring(sepIndex + LEGACY_SEPARATOR.length).trim();
    } else {
        // If no separator, check if there's content before any section headers
        // or content that's not part of any section
        let earliestSectionIndex = notes.length;
        for (const header of Object.values(SECTION_HEADERS)) {
            const idx = notes.indexOf(header);
            if (idx !== -1 && idx < earliestSectionIndex) {
                earliestSectionIndex = idx;
            }
        }
        
        // Content before first section header could be legacy
        if (earliestSectionIndex > 0) {
            const beforeSections = notes.substring(0, earliestSectionIndex).trim();
            if (beforeSections && !Object.values(SECTION_HEADERS).some(h => beforeSections.includes(h))) {
                sections.legacy = beforeSections;
            }
        }
        
        // If no sections exist at all, everything is legacy
        if (earliestSectionIndex === notes.length) {
            sections.legacy = notes.trim();
        }
    }
    
    return sections;
}

/**
 * Rebuild notes from sections
 * Sections appear at top in defined order, legacy at bottom
 * @param {Object} sections - { linkedin, manual, salesnav, legacy }
 * @returns {string} Rebuilt notes content
 */
function rebuildNotesFromSections(sections) {
    const parts = [];
    
    // Add sections in order (only if they have content)
    for (const key of SECTION_ORDER) {
        if (sections[key] && sections[key].trim()) {
            parts.push(`${SECTION_HEADERS[key]}\n${sections[key].trim()}`);
        }
    }
    
    // Add legacy content if exists
    if (sections.legacy && sections.legacy.trim()) {
        if (parts.length > 0) {
            parts.push(`\n${LEGACY_SEPARATOR}\n${sections.legacy.trim()}`);
        } else {
            // If only legacy content, don't add separator
            parts.push(sections.legacy.trim());
        }
    }
    
    return parts.join('\n\n');
}

/**
 * Update a specific section in the notes
 * @param {string} currentNotes - Current notes content
 * @param {string} sectionKey - Section to update: 'linkedin', 'manual', 'salesnav'
 * @param {string} newContent - New content for the section
 * @param {Object} options - Update options
 * @param {boolean} options.append - If true, prepend to existing content (for manual notes)
 * @param {boolean} options.replace - If true, replace entire section content
 * @returns {{ notes: string, previousContent: string, lineCount: { old: number, new: number } }}
 */
function updateSection(currentNotes, sectionKey, newContent, options = {}) {
    const { append = false, replace = true } = options;
    
    // Parse current notes
    const sections = parseNotesIntoSections(currentNotes || '');
    
    // Get previous content for this section
    const previousContent = sections[sectionKey] || '';
    const oldLineCount = previousContent ? previousContent.split('\n').length : 0;
    
    // Update the section
    if (append) {
        // For manual notes: prepend new content (newest first)
        if (sections[sectionKey]) {
            sections[sectionKey] = `${newContent.trim()}\n${sections[sectionKey].trim()}`;
        } else {
            sections[sectionKey] = newContent.trim();
        }
    } else if (replace) {
        // For LinkedIn/SalesNav: complete replacement
        sections[sectionKey] = newContent.trim();
    }
    
    const newLineCount = sections[sectionKey] ? sections[sectionKey].split('\n').length : 0;
    
    // Rebuild notes
    const rebuiltNotes = rebuildNotesFromSections(sections);
    
    return {
        notes: rebuiltNotes,
        previousContent,
        lineCount: {
            old: oldLineCount,
            new: newLineCount
        }
    };
}

/**
 * Get current content of a specific section
 * @param {string} currentNotes - Current notes content
 * @param {string} sectionKey - Section key: 'linkedin', 'manual', 'salesnav', 'legacy'
 * @returns {string} Section content
 */
function getSection(currentNotes, sectionKey) {
    const sections = parseNotesIntoSections(currentNotes);
    return sections[sectionKey] || '';
}

/**
 * Get summary of all sections
 * @param {string} currentNotes - Current notes content
 * @returns {Object} Summary with line counts and last update dates
 */
function getSectionsSummary(currentNotes) {
    const sections = parseNotesIntoSections(currentNotes);
    
    const summary = {};
    for (const [key, content] of Object.entries(sections)) {
        if (content && content.trim()) {
            const lines = content.trim().split('\n');
            // Try to extract last date from first line (newest message)
            let lastDate = null;
            if (lines.length > 0) {
                const dateMatch = lines[0].match(/^(\d{2}-\d{2}-\d{2})/);
                if (dateMatch) {
                    lastDate = dateMatch[1];
                }
            }
            
            summary[key] = {
                lineCount: lines.length,
                lastDate,
                hasContent: true
            };
        } else {
            summary[key] = {
                lineCount: 0,
                lastDate: null,
                hasContent: false
            };
        }
    }
    
    return summary;
}

/**
 * Format today's date for manual notes
 * @param {Date} date - Date to format (defaults to now)
 * @returns {string} Formatted date DD-MM-YY
 */
function formatManualNoteDate(date = new Date()) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
}

/**
 * Add a manual note with auto-dated prefix
 * @param {string} currentNotes - Current notes content
 * @param {string} noteText - The note text to add
 * @param {Date} date - Date for the note (defaults to now)
 * @returns {{ notes: string, formattedNote: string }}
 */
function addManualNote(currentNotes, noteText, date = new Date()) {
    const dateStr = formatManualNoteDate(date);
    const formattedNote = `${dateStr}: ${noteText.trim()}`;
    
    const result = updateSection(currentNotes, 'manual', formattedNote, { append: true });
    
    return {
        notes: result.notes,
        formattedNote
    };
}

module.exports = {
    SECTION_HEADERS,
    SECTION_ORDER,
    LEGACY_SEPARATOR,
    parseNotesIntoSections,
    rebuildNotesFromSections,
    updateSection,
    getSection,
    getSectionsSummary,
    formatManualNoteDate,
    addManualNote
};
