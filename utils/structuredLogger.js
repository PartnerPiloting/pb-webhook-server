// File: utils/structuredLogger.js

/**
 * Structured logging utilities for multi-tenant client management
 * Provides consistent log formatting for easy filtering on Render
 * 
 * Supports process-specific logging levels via environment variables:
 * - DEBUG_LEAD_SCORING=debug|info|warn|error
 * - DEBUG_POST_HARVESTING=debug|info|warn|error
 * - DEBUG_POST_SCORING=debug|info|warn|error
 * - DEBUG_LEVEL=debug|info|warn|error (default level)
 */

/**
 * Determine if a particular log level should be displayed based on environment settings
 * 
 * Process-specific environment variables override the general DEBUG_LEVEL:
 * - DEBUG_LEAD_SCORING controls lead scoring logs
 * - DEBUG_POST_HARVESTING controls post harvesting logs
 * - DEBUG_POST_SCORING controls post scoring logs
 * - DEBUG_LEVEL is used as fallback for all processes
 * 
 * @param {string} level - Log level (debug|info|warn|error)
 * @param {string} processType - Process name (lead_scoring|post_harvesting|post_scoring)
 * @returns {boolean} Whether this log should be displayed
 */
function shouldLog(level, processType) {
    // Log levels in order of verbosity
    const levels = ['debug', 'info', 'warn', 'error'];
    
    // Get the process-specific log level, or fall back to general level
    let envLevel;
    if (processType === 'lead_scoring') {
        envLevel = (process.env.DEBUG_LEAD_SCORING || process.env.DEBUG_LEVEL || 'info').toLowerCase();
    } else if (processType === 'post_harvesting') {
        envLevel = (process.env.DEBUG_POST_HARVESTING || process.env.DEBUG_LEVEL || 'info').toLowerCase();
    } else if (processType === 'post_scoring') {
        envLevel = (process.env.DEBUG_POST_SCORING || process.env.DEBUG_LEVEL || 'info').toLowerCase();
    } else {
        envLevel = (process.env.DEBUG_LEVEL || 'info').toLowerCase();
    }
    
    // Get index of configured level and current message level
    const configLevelIdx = levels.indexOf(envLevel);
    const messageLevelIdx = levels.indexOf(level.toLowerCase());
    
    // If either level is not valid, default to showing the message
    if (configLevelIdx === -1 || messageLevelIdx === -1) return true;
    
    // Show the message if its level index is >= the configured level index
    // (i.e., if it's equally or more important)
    return messageLevelIdx >= configLevelIdx;
}

/**
 * Generate a unique session ID for tracking a complete operation
 * @returns {string} Session ID in format: YYYYMMDD-HHMMSS-XXX
 */
function generateSessionId() {
    const now = new Date();
    const date = now.getFullYear().toString() + 
                 (now.getMonth() + 1).toString().padStart(2, '0') + 
                 now.getDate().toString().padStart(2, '0');
    const time = now.getHours().toString().padStart(2, '0') + 
                 now.getMinutes().toString().padStart(2, '0') + 
                 now.getSeconds().toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    
    return `${date}-${time}-${random}`;
}

/**
 * Create structured log prefix for consistent filtering
 * @param {string} clientId - Client identifier
 * @param {string} sessionId - Session identifier
 * @param {string} type - Log type (SETUP|PROCESS|ERROR|SUMMARY|DEBUG)
 * @returns {string} Formatted prefix
 */
function createLogPrefix(clientId, sessionId, type) {
    const client = clientId ? `CLIENT:${clientId}` : 'CLIENT:SYSTEM';
    const session = sessionId ? `SESSION:${sessionId}` : 'SESSION:NONE';
    const logType = type || 'INFO';
    
    return `[${client}] [${session}] [${logType}]`;
}

/**
 * Structured logger class for consistent multi-tenant logging
 */
class StructuredLogger {
    constructor(clientId, sessionId = null, processType = null) {
        // ROOT CAUSE FIX: Validate parameters to prevent [object Object] issues
        
        // Handle clientId
        if (typeof clientId === 'object') {
            console.error('CRITICAL ERROR: Object passed as clientId to StructuredLogger constructor:', 
                JSON.stringify(clientId));
            
            // Try to extract a usable clientId from the object
            if (clientId && clientId.clientId) {
                clientId = clientId.clientId;
            } else if (clientId && clientId.id) {
                clientId = clientId.id;
            } else {
                clientId = 'INVALID_OBJECT_CLIENT_ID';
            }
        }
        
        // Handle sessionId
        if (typeof sessionId === 'object') {
            console.error('CRITICAL ERROR: Object passed as sessionId to StructuredLogger constructor:', 
                JSON.stringify(sessionId));
            
            // Try to extract a usable sessionId from the object
            if (sessionId && sessionId.runId) {
                sessionId = sessionId.runId;
            } else if (sessionId && sessionId.id) {
                sessionId = sessionId.id;
            } else {
                sessionId = 'INVALID_OBJECT_SESSION_ID';
            }
        }
        
        // Ensure clientId is a string
        this.clientId = (clientId !== null && clientId !== undefined) ? String(clientId) : 'SYSTEM';
        
        // Ensure sessionId is a string or generate one
        this.sessionId = (sessionId !== null && sessionId !== undefined) ? String(sessionId) : generateSessionId();
        
        // Ensure processType is a string
        this.processType = processType ? String(processType) : null; // lead_scoring, post_harvesting, post_scoring
        
        // Log a warning if we had to fix any parameters
        if (typeof clientId === 'object' || typeof sessionId === 'object') {
            console.warn(`[StructuredLogger] Created logger with fixed parameters: clientId=${this.clientId}, sessionId=${this.sessionId}`);
            console.trace(); // Add stack trace to see where the invalid object was passed
        }
    }

    setup(message, ...args) {
        if (shouldLog('info', this.processType)) {
            const prefix = createLogPrefix(this.clientId, this.sessionId, 'SETUP');
            console.log(`${prefix} ${message}`, ...args);
        }
    }

    process(message, ...args) {
        if (shouldLog('info', this.processType)) {
            const prefix = createLogPrefix(this.clientId, this.sessionId, 'PROCESS');
            console.log(`${prefix} ${message}`, ...args);
        }
    }

    error(message, ...args) {
        if (shouldLog('error', this.processType)) {
            const prefix = createLogPrefix(this.clientId, this.sessionId, 'ERROR');
            console.error(`${prefix} ${message}`, ...args);
        }
    }

    info(message, ...args) {
        if (shouldLog('info', this.processType)) {
            const prefix = createLogPrefix(this.clientId, this.sessionId, 'INFO');
            console.log(`${prefix} ${message}`, ...args);
        }
    }

    summary(message, ...args) {
        if (shouldLog('info', this.processType)) {
            const prefix = createLogPrefix(this.clientId, this.sessionId, 'SUMMARY');
            console.log(`${prefix} ${message}`, ...args);
        }
    }

    debug(message, ...args) {
        if (shouldLog('debug', this.processType)) {
            const prefix = createLogPrefix(this.clientId, this.sessionId, 'DEBUG');
            console.log(`${prefix} ${message}`, ...args);
        }
    }

    warn(message, ...args) {
        if (shouldLog('warn', this.processType)) {
            const prefix = createLogPrefix(this.clientId, this.sessionId, 'WARN');
            console.warn(`${prefix} ${message}`, ...args);
        }
    }

    // Get session ID for cross-function tracking
    getSessionId() {
        return this.sessionId;
    }

    // Create child logger for sub-operations with same session and process type
    createChild(subClientId = null) {
        return new StructuredLogger(subClientId || this.clientId, this.sessionId, this.processType);
    }
}

module.exports = {
    generateSessionId,
    createLogPrefix,
    StructuredLogger
};
