/**
 * Notes Audit Logger
 * 
 * Logs EVERY modification to a lead's Notes field, regardless of which code path.
 * This provides complete visibility into what's changing Notes and when.
 */

const { createLogger } = require('./contextLogger');
const auditLog = createLogger({ runId: 'AUDIT', clientId: 'SYSTEM', operation: 'notes-audit' });

/**
 * Log a Notes modification with before/after comparison
 * @param {Object} params
 * @param {string} params.leadId - The lead record ID
 * @param {string} params.leadEmail - Lead's email (for identification)
 * @param {string} params.source - Which code path is making the change (e.g., 'inbound-email', 'portal-put', 'portal-patch')
 * @param {string} params.notesBefore - Notes content BEFORE the change
 * @param {string} params.notesAfter - Notes content AFTER the change (what will be written)
 * @param {Object} params.metadata - Any additional context
 */
function logNotesChange({ leadId, leadEmail, source, notesBefore, notesAfter, metadata = {} }) {
    const beforeLen = (notesBefore || '').length;
    const afterLen = (notesAfter || '').length;
    const diff = afterLen - beforeLen;
    
    // Check for email section specifically
    const emailHeaderBefore = (notesBefore || '').includes('=== EMAIL CORRESPONDENCE ===');
    const emailHeaderAfter = (notesAfter || '').includes('=== EMAIL CORRESPONDENCE ===');
    
    // Extract email section lengths
    const getEmailSectionLen = (notes) => {
        if (!notes) return 0;
        const emailStart = notes.indexOf('=== EMAIL CORRESPONDENCE ===');
        if (emailStart === -1) return 0;
        const emailEnd = notes.indexOf('===', emailStart + 30); // Next section header
        if (emailEnd === -1) return notes.length - emailStart;
        return emailEnd - emailStart;
    };
    
    const emailLenBefore = getEmailSectionLen(notesBefore);
    const emailLenAfter = getEmailSectionLen(notesAfter);
    const emailDiff = emailLenAfter - emailLenBefore;
    
    // Count email blocks
    const countEmailBlocks = (notes) => {
        if (!notes) return 0;
        const matches = notes.match(/---EMAIL-THREAD---/g);
        return matches ? matches.length + 1 : (notes.includes('=== EMAIL CORRESPONDENCE ===') ? 1 : 0);
    };
    
    const emailBlocksBefore = countEmailBlocks(notesBefore);
    const emailBlocksAfter = countEmailBlocks(notesAfter);
    
    // Log the summary
    auditLog.info(`[NOTES-AUDIT] ========================================`);
    auditLog.info(`[NOTES-AUDIT] Lead: ${leadId} (${leadEmail || 'unknown'})`);
    auditLog.info(`[NOTES-AUDIT] Source: ${source}`);
    auditLog.info(`[NOTES-AUDIT] Total: ${beforeLen} -> ${afterLen} chars (${diff >= 0 ? '+' : ''}${diff})`);
    auditLog.info(`[NOTES-AUDIT] Email section: ${emailLenBefore} -> ${emailLenAfter} chars (${emailDiff >= 0 ? '+' : ''}${emailDiff})`);
    auditLog.info(`[NOTES-AUDIT] Email blocks: ${emailBlocksBefore} -> ${emailBlocksAfter}`);
    auditLog.info(`[NOTES-AUDIT] Has email header: ${emailHeaderBefore} -> ${emailHeaderAfter}`);
    
    // CRITICAL: Warn if we're LOSING email content
    if (emailLenAfter < emailLenBefore && emailLenBefore > 0) {
        auditLog.warn(`[NOTES-AUDIT] ⚠️ WARNING: EMAIL CONTENT LOSS DETECTED! Lost ${emailLenBefore - emailLenAfter} chars`);
        auditLog.warn(`[NOTES-AUDIT] Email before (first 200 chars): "${(notesBefore || '').substring(notesBefore.indexOf('=== EMAIL'), notesBefore.indexOf('=== EMAIL') + 200)}..."`);
        auditLog.warn(`[NOTES-AUDIT] Email after (first 200 chars): "${(notesAfter || '').substring(notesAfter.indexOf('=== EMAIL'), notesAfter.indexOf('=== EMAIL') + 200)}..."`);
    }
    
    // CRITICAL: Warn if email blocks decreased
    if (emailBlocksAfter < emailBlocksBefore) {
        auditLog.warn(`[NOTES-AUDIT] ⚠️ WARNING: EMAIL BLOCKS DECREASED! ${emailBlocksBefore} -> ${emailBlocksAfter}`);
    }
    
    // Log metadata if provided
    if (Object.keys(metadata).length > 0) {
        auditLog.info(`[NOTES-AUDIT] Metadata: ${JSON.stringify(metadata)}`);
    }
    
    auditLog.info(`[NOTES-AUDIT] ========================================`);
    
    return {
        beforeLen,
        afterLen,
        diff,
        emailLenBefore,
        emailLenAfter,
        emailDiff,
        emailBlocksBefore,
        emailBlocksAfter,
        contentLoss: emailLenAfter < emailLenBefore && emailLenBefore > 0
    };
}

module.exports = { logNotesChange };
