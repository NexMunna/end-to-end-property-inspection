/**
 * Property Stewards – Inspector Interface System
 * DigitalOcean Function Entry Point
 */

// Import the main handler
const { main } = require('./src/handler');

/**
 * Entry point for DigitalOcean Function
 * 
 * @param {Object} args - Request arguments
 * @returns {Object} - Response object
 */
async function handler(args) {
  // Pass the request to the main handler
  return await main(args);
}

// Export the handler function
module.exports = {
  handler
};
