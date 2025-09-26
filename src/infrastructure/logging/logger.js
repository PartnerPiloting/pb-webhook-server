/**
 * logger.js
 * Provides standardized structured logging throughout the system
 * with client context, operation tracking, and consistent format.
 */

/**
 * Structured logger that maintains context about the current operation
 */
class Logger {
  /**
   * Create a new logger
   * @param {string} clientId - The client ID for context
   * @param {string} runId - The current run ID
   * @param {string} operation - The operation being performed (lead_scoring, post_harvesting, post_scoring)
   */
  constructor(clientId = 'SYSTEM', runId = null, operation = 'unknown') {
    this.clientId = clientId;
    this.runId = runId;
    this.operation = operation;
  }

  /**
   * Format a log message with timestamp and context
   * @param {string} level - Log level (INFO, DEBUG, ERROR, etc)
   * @param {string} message - The log message
   * @returns {string} Formatted log message
   */
  _format(level, message) {
    const timestamp = new Date().toISOString();
    const clientContext = this.clientId === 'SYSTEM' ? 'SYSTEM' : `CLIENT:${this.clientId}`;
    const runContext = this.runId ? `RUN:${this.runId}` : '';
    const operation = this.operation ? `OP:${this.operation}` : '';
    
    return `[${timestamp}] [${level}] [${clientContext}] ${runContext ? `[${runContext}] ` : ''}${operation ? `[${operation}] ` : ''}${message}`;
  }

  /**
   * Log an informational message
   * @param {string} message - The message to log
   */
  info(message) {
    console.log(this._format('INFO', message));
  }

  /**
   * Log a debug message
   * @param {string} message - The message to log
   */
  debug(message) {
    if (process.env.DEBUG_LEVEL === 'debug') {
      console.log(this._format('DEBUG', message));
    }
  }

  /**
   * Log an error message
   * @param {string} message - The error message
   * @param {string} [stack] - Optional stack trace
   */
  error(message, stack = '') {
    console.error(this._format('ERROR', message));
    if (stack) {
      console.error(this._format('STACK', stack));
    }
  }

  /**
   * Log a warning message
   * @param {string} message - The warning message
   */
  warn(message) {
    console.warn(this._format('WARN', message));
  }

  /**
   * Log a process start/update message
   * @param {string} message - The process message
   */
  process(message) {
    console.log(this._format('PROCESS', message));
  }

  /**
   * Log setup information
   * @param {string} message - The setup message
   */
  setup(message) {
    console.log(this._format('SETUP', message));
  }

  /**
   * Log a summary message
   * @param {string} message - The summary message
   */
  summary(message) {
    console.log(this._format('SUMMARY', message));
  }

  /**
   * Create a child logger with the same context but different operation
   * @param {string} operation - The new operation
   * @returns {Logger} A new logger instance with updated operation
   */
  child(operation) {
    return new Logger(this.clientId, this.runId, operation);
  }
}

module.exports = {
  Logger
};