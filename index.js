/**
 * Property Stewards - Inspector Interface System
 * DigitalOcean Functions entry point
 */

const express = require('express');
const bodyParser = require('body-parser');
const handler = require('./src/handler');

// Initialize Express app
const app = express();

// Parse JSON bodies for webhook events from WhatsApp Business API
app.use(bodyParser.json());

// Parse URL-encoded bodies for form submissions (if needed)
app.use(bodyParser.urlencoded({ extended: true }));

// Handle WhatsApp webhook verification and events
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
  console.error('Unhandled error:', err);
  res.status(500).send({
    error: 'Internal server error',
    message: 'An unexpected error occurred'
  });
});

// For DigitalOcean Functions
module.exports = app;

// For local development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
