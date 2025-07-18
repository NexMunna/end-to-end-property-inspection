/**
 * Property Stewards - Inspector Interface System
 * Entry point for DigitalOcean Functions
 */
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const handler = require('./src/handler');
const db = require('./src/db');
const logger = require('./src/utils/logger');

// Initialize Express app
const app = express();

// Increase payload limit for media uploads
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// WhatsApp webhook endpoint
app.all('/webhook', handler.handleWebhook);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send({ status: 'ok' });
});

// Handle unsupported routes
app.use((req, res) => {
  res.status(404).send({
    error: 'Not found',
    message: 'The requested endpoint does not exist'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).send({
    error: 'Internal server error',
    message: 'An unexpected error occurred'
  });
});

// Start server
const PORT = process.env.PORT || 8080;

(async function startServer() {
  try {
    // Test database connection in production
    if (process.env.NODE_ENV === 'production') {
      await db.query('SELECT 1');
      logger.info('Database connection successful');
    }
    
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Database connection failed:', error);
    // Don't exit in production, let App Platform handle retries
    if (process.env.NODE_ENV !== 'production') {
      process.exit(1);
    }
  }
})();

// For DigitalOcean Functions - export the app
module.exports = app;
