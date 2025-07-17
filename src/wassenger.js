/**
 * Wassenger WhatsApp API integration
 * For Property Stewards – Inspector Interface System
 */

const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

// Wassenger API configuration
const API_URL = 'https://api.wassenger.com/v1';
const API_KEY = process.env.WASSENGER_API_KEY;
const DEVICE_ID = process.env.WASSENGER_DEVICE_ID; // Optional device ID if you have multiple devices

// Configure Axios instance for Wassenger API
const wassengerApi = axios.create({
  baseURL: API_URL,
  headers: {
    'Token': API_KEY,
    'Content-Type': 'application/json'
  }
});

/**
 * Send a text message to a WhatsApp number
 * 
 * @param {string} phone - Recipient phone number with country code
 * @param {string} message - Text message to send
 * @returns {Promise<Object>} - API response
 */
async function sendTextMessage(phone, message) {
  try {
    // Prepare message payload
    const payload = {
      phone,
      message,
      priority: 'high'
    };
    
    // Add device ID if specified in environment variables
    if (DEVICE_ID) {
      payload.device = DEVICE_ID;
    }
    
    const response = await wassengerApi.post('/messages', payload);
    
    console.log(`Message sent to ${phone}: ${message.substring(0, 30)}...`);
    return response.data;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error.message);
    throw error;
  }
}

/**
 * Send a media message to a WhatsApp number
 * 
 * @param {string} phone - Recipient phone number with country code
 * @param {Buffer} mediaBuffer - Media content as Buffer
 * @param {string} mimeType - MIME type of the media
 * @param {string} filename - Filename for the media
 * @param {string} caption - Optional caption for the media
 * @returns {Promise<Object>} - API response
 */
async function sendMediaMessage(phone, mediaBuffer, mimeType, filename, caption) {
  try {
    // Create form data
    const formData = new FormData();
    formData.append('phone', phone);
    formData.append('file', mediaBuffer, {
      filename,
      contentType: mimeType
    });
    
    if (caption) {
      formData.append('message', caption);
    }
    
    // Add device ID if specified in environment variables
    if (DEVICE_ID) {
      formData.append('device', DEVICE_ID);
    }

    const response = await axios.post(`${API_URL}/messages`, formData, {
      headers: {
        'Token': API_KEY,
        ...formData.getHeaders()
      }
    });
    
    console.log(`Media sent to ${phone}: ${filename}`);
    return response.data;
  } catch (error) {
    console.error('Error sending WhatsApp media:', error.message);
    throw error;
  }
}

/**
 * Send a location message to a WhatsApp number
 * 
 * @param {string} phone - Recipient phone number with country code
 * @param {number} latitude - Latitude coordinate
 * @param {number} longitude - Longitude coordinate
 * @param {string} name - Optional location name
 * @param {string} address - Optional address
 * @returns {Promise<Object>} - API response
 */
async function sendLocationMessage(phone, latitude, longitude, name, address) {
  try {
    // Prepare message payload
    const payload = {
      phone,
      location: {
        latitude,
        longitude,
        name,
        address
      }
    };
    
    // Add device ID if specified in environment variables
    if (DEVICE_ID) {
      payload.device = DEVICE_ID;
    }
    
    const response = await wassengerApi.post('/messages', payload);
    
    console.log(`Location sent to ${phone}: ${latitude},${longitude}`);
    return response.data;
  } catch (error) {
    console.error('Error sending WhatsApp location:', error.message);
    throw error;
  }
}

/**
 * Verify if a phone number is valid and has WhatsApp
 * 
 * @param {string} phone - Phone number with country code
 * @returns {Promise<boolean>} - Whether the number is valid
 */
async function verifyWhatsAppNumber(phone) {
  try {
    const response = await wassengerApi.get(`/accounts/${phone}`);
    return !!response.data.exists;
  } catch (error) {
    console.error('Error verifying WhatsApp number:', error.message);
    return false;
  }
}

/**
 * Download a media file from WhatsApp
 * 
 * @param {string} mediaUrl - Media URL from webhook
 * @returns {Promise<Buffer>} - Media content as Buffer
 */
async function downloadMedia(mediaUrl) {
  try {
    const response = await wassengerApi.get(mediaUrl, {
      responseType: 'arraybuffer'
    });
    
    return Buffer.from(response.data);
  } catch (error) {
    console.error('Error downloading WhatsApp media:', error.message);
    throw error;
  }
}

/**
 * Parse webhook data from Wassenger
 * 
 * @param {Object} webhookData - Raw webhook data
 * @returns {Object} - Parsed message data
 */
function parseWebhookData(webhookData) {
  // Verify that this is a message event
  if (!webhookData || webhookData.event !== 'message') {
    return null;
  }

  const { message } = webhookData.data;
  
  // Only process incoming messages (not outgoing)
  if (!message || message.fromMe) {
    return null;
  }
  
  const result = {
    messageId: message.id,
    sender: message.chatId.split('@')[0], // Extract phone number from chatId
    timestamp: new Date(message.timestamp * 1000),
    type: message.type
  };

  // Extract content based on message type
  switch (message.type) {
    case 'chat':
      result.content = message.body;
      break;
    
    case 'image':
    case 'video':
    case 'audio':
      result.mediaUrl = message.mediaUrl;
      result.mimeType = message.mimetype;
      result.filename = message.filename || `${message.type}_${Date.now()}`;
      result.caption = message.caption || '';
      break;
    
    case 'location':
      result.latitude = message.location.latitude;
      result.longitude = message.location.longitude;
      result.address = message.location.address;
      break;
    
    default:
      // For unsupported message types
      result.content = 'Unsupported message type';
  }
  
  return result;
}

module.exports = {
  sendTextMessage,
  sendMediaMessage,
  sendLocationMessage,
  verifyWhatsAppNumber,
  downloadMedia,
  parseWebhookData
};
