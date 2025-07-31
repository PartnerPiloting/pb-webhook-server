// File: utils/structuredLogger.js

/**
 * Structured logging utilities for multi-tenant client management
 * Provides consistent log formatting for easy filtering on Render
 */

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
    constructor(clientId, sessionId = null) {
        this.clientId = clientId;
        this.sessionId = sessionId || generateSessionId();
    }

    setup(message, ...args) {
        const prefix = createLogPrefix(this.clientId, this.sessionId, 'SETUP');
        console.log(`${prefix} ${message}`, ...args);
    }

    process(message, ...args) {
        const prefix = createLogPrefix(this.clientId, this.sessionId, 'PROCESS');
        console.log(`${prefix} ${message}`, ...args);
    }

    error(message, ...args) {
        const prefix = createLogPrefix(this.clientId, this.sessionId, 'ERROR');
        console.error(`${prefix} ${message}`, ...args);
    }

    summary(message, ...args) {
        const prefix = createLogPrefix(this.clientId, this.sessionId, 'SUMMARY');
        console.log(`${prefix} ${message}`, ...args);
    }

    debug(message, ...args) {
        const prefix = createLogPrefix(this.clientId, this.sessionId, 'DEBUG');
        console.log(`${prefix} ${message}`, ...args);
    }

    warn(message, ...args) {
        const prefix = createLogPrefix(this.clientId, this.sessionId, 'WARN');
        console.warn(`${prefix} ${message}`, ...args);
    }

    // Get session ID for cross-function tracking
    getSessionId() {
        return this.sessionId;
    }

    // Create child logger for sub-operations with same session
    createChild(subClientId = null) {
        return new StructuredLogger(subClientId || this.clientId, this.sessionId);
    }
}

module.exports = {
    generateSessionId,
    createLogPrefix,
    StructuredLogger
};
