/**
 * Context-aware logger that automatically prefixes logs with structured metadata
 * Format: [runId] [clientId] [operation] [level] message
 * 
 * This replaces all console.log/error/warn calls and legacy [CLIENT:...] [SESSION:...] patterns
 * to provide consistent, searchable logs across the entire application.
 * 
 * Usage:
 *   const logger = createLogger({ runId: '251008-003303', clientId: 'Guy-Wilson', operation: 'lead_scoring' });
 *   logger.info('Processing 5 leads');
 *   // Output: [251008-003303] [Guy-Wilson] [lead_scoring] [INFO] Processing 5 leads
 * 
 * Benefits:
 *   - Every log line is searchable by runId in Render logs
 *   - Consistent format enables automated log analysis
 *   - Single place to change log format (this file)
 *   - Child loggers inherit context
 */

class ContextLogger {
  constructor(context = {}) {
    this.runId = context.runId || 'UNKNOWN';
    this.clientId = context.clientId || 'SYSTEM';
    this.operation = context.operation || 'general';
  }

  /**
   * Format log message with context prefix
   * @param {string} level - Log level (INFO, WARN, ERROR, DEBUG, CRITICAL)
   * @param {string} message - Log message
   * @returns {string} Formatted log string
   */
  _format(level, message) {
    const prefix = `[${this.runId}] [${this.clientId}] [${this.operation}] [${level}]`;
    return `${prefix} ${message}`;
  }

  /**
   * Log info level message
   * @param {string} message - Log message
   * @param {...any} args - Additional arguments to log
   */
  info(message, ...args) {
    if (args.length > 0) {
      console.log(this._format('INFO', message), ...args);
    } else {
      console.log(this._format('INFO', message));
    }
  }

  /**
   * Log warning level message
   * @param {string} message - Log message
   * @param {...any} args - Additional arguments to log
   */
  warn(message, ...args) {
    if (args.length > 0) {
      console.warn(this._format('WARN', message), ...args);
    } else {
      console.warn(this._format('WARN', message));
    }
  }

  /**
   * Log error level message
   * @param {string} message - Log message
   * @param {...any} args - Additional arguments to log (typically error object)
   */
  error(message, ...args) {
    if (args.length > 0) {
      console.error(this._format('ERROR', message), ...args);
    } else {
      console.error(this._format('ERROR', message));
    }
  }

  /**
   * Log debug level message
   * @param {string} message - Log message
   * @param {...any} args - Additional arguments to log
   */
  debug(message, ...args) {
    if (args.length > 0) {
      console.log(this._format('DEBUG', message), ...args);
    } else {
      console.log(this._format('DEBUG', message));
    }
  }

  /**
   * Log critical level message
   * @param {string} message - Log message
   * @param {...any} args - Additional arguments to log
   */
  critical(message, ...args) {
    if (args.length > 0) {
      console.error(this._format('CRITICAL', message), ...args);
    } else {
      console.error(this._format('CRITICAL', message));
    }
  }

  /**
   * Create child logger with updated context
   * Useful when switching operations within the same run/client
   * @param {Object} newContext - Context to merge with current context
   * @returns {ContextLogger} New logger instance with merged context
   * 
   * Example:
   *   const parentLogger = createLogger({ runId: '251008-003303', clientId: 'Guy-Wilson', operation: 'smart-resume' });
   *   const childLogger = parentLogger.child({ operation: 'post_harvesting' });
   *   // childLogger keeps runId and clientId, changes operation
   */
  child(newContext) {
    return new ContextLogger({
      runId: this.runId,
      clientId: this.clientId,
      operation: this.operation,
      ...newContext
    });
  }
}

/**
 * Factory function to create context logger
 * @param {Object} context - Logger context
 * @param {string} context.runId - Run ID for log correlation (REQUIRED for production)
 * @param {string} context.clientId - Client identifier (defaults to 'SYSTEM')
 * @param {string} context.operation - Operation/module name (defaults to 'general')
 * @returns {ContextLogger} Logger instance
 */
function createLogger(context = {}) {
  return new ContextLogger(context);
}

module.exports = { createLogger, ContextLogger };
