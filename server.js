/**
 * Local development server for Property Stewards – Inspector Interface System
 */

const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const { handler } = require('./index');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Parse JSON request bodies
app.use(bodyParser.json());

// Serve static files (for future web UI if needed)
app.use(express.static('public'));

// Webhook endpoint for Wassenger
app.post('/webhook', async (req, res) => {
  try {
    // Pass the request body to the handler function
    const result = await handler(req.body);
    
    // Return the result
    res.status(result.statusCode).json(result.body);
  } catch (error) {
    console.error('Error handling webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
});
