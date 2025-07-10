/**
 * WhatsApp Business API integration module
 * Handles sending and receiving messages directly through WhatsApp Business API
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// WhatsApp Business API configuration
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v17.0';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

// Verify required configuration is present
if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
  console.error('❌ Missing required WhatsApp Business API configuration');
}

/**
 * Send a text message via WhatsApp Business API
 * @param {string} to - Recipient phone number with country code
 * @param {string} message - Message text content
 * @returns {Promise<Object>} API response
 */
async function sendTextMessage(to, message) {
  try {
    // Format phone number (remove + if present)
    const recipient = to.startsWith('+') ? to.substring(1) : to;
    
    const response = await axios({
      method: 'POST',
      url: `${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      data: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'text',
        text: {
          body: message
        }
      }
    });
    
    console.log('✅ WhatsApp message sent successfully');
    return response.data;
  } catch (error) {
    console.error('❌ Failed to send WhatsApp message:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send a media message via WhatsApp Business API
 * @param {string} to - Recipient phone number with country code
 * @param {Buffer|string} media - Media content as buffer or file path
 * @param {string} mediaType - Type of media (image, video, document, audio)
 * @param {string} caption - Optional caption for the media
 * @returns {Promise<Object>} API response
 */
async function sendMediaMessage(to, media, mediaType, caption = '') {
  try {
    const recipient = to.startsWith('+') ? to.substring(1) : to;
    let mediaId;

    // If media is a file path, upload it first
    if (typeof media === 'string' && fs.existsSync(media)) {
      mediaId = await uploadMedia(media, mediaType);
    } else if (Buffer.isBuffer(media)) {
      // For direct buffer uploads, save to temp file then upload
      const tempFilePath = path.join(__dirname, `../temp/${Date.now()}.${getExtension(mediaType)}`);
      fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
      fs.writeFileSync(tempFilePath, media);
      mediaId = await uploadMedia(tempFilePath, mediaType);
      // Clean up temp file
      fs.unlinkSync(tempFilePath);
    } else {
      throw new Error('Media must be a Buffer or valid file path');
    }

    // Send media message using the uploaded media ID
    const response = await axios({
      method: 'POST',
      url: `${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      data: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: mediaType,
        [mediaType]: {
          id: mediaId,
          caption: caption
        }
      }
    });
    
    console.log(`✅ WhatsApp ${mediaType} sent successfully`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to send WhatsApp ${mediaType}:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Upload media to WhatsApp Business API
 * @param {string} filePath - Path to the file
 * @param {string} mediaType - Type of media (image, video, document, audio)
 * @returns {Promise<string>} Media ID
 */
async function uploadMedia(filePath, mediaType) {
  try {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', getMimeType(filePath, mediaType));
    
    const response = await axios({
      method: 'POST',
      url: `${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/media`,
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        ...formData.getHeaders()
      },
      data: formData
    });
    
    return response.data.id;
  } catch (error) {
    console.error('❌ Failed to upload media:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Verify webhook signature from WhatsApp
 * @param {string} signature - X-Hub-Signature-256 header value
 * @param {string} body - Raw request body
 * @returns {boolean} Whether signature is valid
 */
function verifyWebhook(signature, body) {
  // Implementation depends on your webhook verification approach
  // For Facebook Graph API, we would validate the X-Hub-Signature-256 header
  // against a HMAC SHA-256 hash of the raw request body
  
  // This is a placeholder for the actual implementation
  return true;
}

/**
 * Parse incoming webhook payload from WhatsApp Business API
 * @param {Object} payload - Webhook payload
 * @returns {Object} Parsed message data
 */
function parseWebhookPayload(payload) {
  try {
    // Extract the message data from WhatsApp Business API format
    if (!payload.entry || !payload.entry[0].changes || !payload.entry[0].changes[0].value.messages) {
      if (payload.object === 'whatsapp_business_account') {
        // This might be a verification message
        return { isVerification: true, challenge: payload['hub.challenge'] };
      }
      return null;
    }
    
    const message = payload.entry[0].changes[0].value.messages[0];
    const contact = payload.entry[0].changes[0].value.contacts?.[0];
    
    // Basic message structure
    const parsedMessage = {
      messageId: message.id,
      from: message.from,
      timestamp: parseInt(message.timestamp) * 1000, // Convert to milliseconds
      type: message.type,
      senderName: contact?.profile?.name || 'Unknown'
    };
    
    // Extract content based on message type
    if (message.type === 'text') {
      parsedMessage.text = message.text.body;
    } else if (['image', 'video', 'document', 'audio'].includes(message.type)) {
      parsedMessage.mediaId = message[message.type].id;
      parsedMessage.mimeType = message[message.type].mime_type;
      parsedMessage.caption = message[message.type].caption || '';
    }
    
    return parsedMessage;
  } catch (error) {
    console.error('❌ Failed to parse webhook payload:', error);
    return null;
  }
}

/**
 * Download media from WhatsApp Business API
 * @param {string} mediaId - ID of the media to download
 * @returns {Promise<Buffer>} Media content
 */
async function downloadMedia(mediaId) {
  try {
    // First, get the media URL
    const mediaInfoResponse = await axios({
      method: 'GET',
      url: `${WHATSAPP_API_URL}/${mediaId}`,
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`
      }
    });
    
    // Then download the media using the URL
    const mediaResponse = await axios({
      method: 'GET',
      url: mediaInfoResponse.data.url,
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`
      },
      responseType: 'arraybuffer'
    });
    
    return Buffer.from(mediaResponse.data);
  } catch (error) {
    console.error('❌ Failed to download media:', error.response?.data || error.message);
    throw error;
  }
}

// Helper functions
function getMimeType(filePath, mediaType) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.mp3': 'audio/mpeg'
  };
  
  return mimeTypes[ext] || `${mediaType}/octet-stream`;
}

function getExtension(mediaType) {
  const extensions = {
    'image': 'jpg',
    'video': 'mp4',
    'document': 'pdf',
    'audio': 'mp3'
  };
  
  return extensions[mediaType] || 'bin';
}

module.exports = {
  sendTextMessage,
  sendMediaMessage,
  uploadMedia,
  verifyWebhook,
  parseWebhookPayload,
  downloadMedia
};