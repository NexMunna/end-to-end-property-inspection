/**
 * Custom logger utility for Property Stewards system
 * Provides consistent logging across the application
 */

/**
 * Log levels with proper emoji prefixes
 */
const logger = {
  info: (message, ...args) => {
    console.log(`ℹ️ [INFO] ${message}`, ...args);
  },
  warn: (message, ...args) => {
    console.warn(`⚠️ [WARN] ${message}`, ...args);
  },
  error: (message, ...args) => {
    console.error(`❌ [ERROR] ${message}`, ...args);
  },
  debug: (message, ...args) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`🐞 [DEBUG] ${message}`, ...args);
    }
  }
};

module.exports = logger;