/**
 * Unified WhatsApp messaging service
 * Handles both Wassenger and WhatsApp Business API
 */
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

// Get provider preference from environment variables
const PREFERRED_PROVIDER = process.env.WHATSAPP_PROVIDER || 'wassenger';

// Wassenger API configuration
const WASSENGER_API_KEY = process.env.WASSENGER_API_KEY;
const WASSENGER_DEVICE_ID = process.env.WASSENGER_DEVICE_ID;
const WASSENGER_API_URL = 'https://api.wassenger.com/v1/messages';

// WhatsApp Business API configuration
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v17.0';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

/**
 * Send message via WhatsApp
 * @param {string} to - Recipient phone number
 * @param {string} message - Message text
 * @param {string} type - Message type (text, image, video, document)
 * @param {string|Buffer} media - Media URL, path, or buffer for media messages
 * @returns {Promise<Object>} Message send result
 */
async function sendMessage(to, message, type = 'text', media = null) {
  try {
    // Format phone number
    const formattedNumber = formatPhoneNumber(to);
    
    // Determine which provider to use
    const provider = determineProvider();
    
    // Send message through appropriate provider
    if (provider === 'wassenger') {
      return await sendViaWassenger(formattedNumber, message, type, media);
    } else {
      return await sendViaWhatsAppBusiness(formattedNumber, message, type, media);
    }
  } catch (error) {
    logger.error('Failed to send message:', error);
    throw error;
  }
}

/**
 * Determine which provider to use based on configuration
 * @returns {string} 'wassenger' or 'whatsapp_business'
 */
function determineProvider() {
  // If preferred provider is explicitly set, use it
  if (PREFERRED_PROVIDER.toLowerCase() === 'whatsapp' || 
      PREFERRED_PROVIDER.toLowerCase() === 'whatsapp_business') {
    return 'whatsapp_business';
  }
  
  // Check if Wassenger is configured
  if (WASSENGER_API_KEY && (WASSENGER_DEVICE_ID || PREFERRED_PROVIDER.toLowerCase() === 'wassenger')) {
    return 'wassenger';
  }
  
  // Check if WhatsApp Business API is configured
  if (WHATSAPP_ACCESS_TOKEN && WHATSAPP_PHONE_NUMBER_ID) {
    return 'whatsapp_business';
  }
  
  // Default to Wassenger if we can't determine
  logger.warn('Could not determine WhatsApp provider from environment, defaulting to Wassenger');
  return 'wassenger';
}

/**
 * Format phone number to ensure it includes country code
 * @param {string} phoneNumber - Phone number to format
 * @returns {string} Formatted phone number
 */
function formatPhoneNumber(phoneNumber) {
  // Remove any non-digit characters
  const digitsOnly = phoneNumber.replace(/\D/g, '');
  
  // If doesn't start with +, add it
  if (!phoneNumber.startsWith('+')) {
    return `+${digitsOnly}`;
  }
  
  return phoneNumber;
}

/**
 * Send message via Wassenger API
 * @param {string} to - Recipient phone number
 * @param {string} message - Message text
 * @param {string} type - Message type
 * @param {string|Buffer} media - Media URL or buffer
 * @returns {Promise<Object>} Wassenger API response
 */
async function sendViaWassenger(to, message, type, media) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${WASSENGER_API_KEY}`
    };
    
    let payload = {
      phone: to,
      message: message
    };
    
    // Add device ID if specified
    if (WASSENGER_DEVICE_ID) {
      payload.device = WASSENGER_DEVICE_ID;
    }
    
    // Handle media messages
    if (media && ['image', 'video', 'document'].includes(type)) {
      let mediaUrl;
      
      // If media is already a URL, use it directly
      if (typeof media === 'string' && (media.startsWith('http://') || media.startsWith('https://'))) {
        mediaUrl = media;
      } 
      // If media is a Buffer or file path, convert to base64
      else {
        let mediaBuffer;
        
        if (Buffer.isBuffer(media)) {
          mediaBuffer = media;
        } else if (typeof media === 'string' && fs.existsSync(media)) {
          mediaBuffer = fs.readFileSync(media);
        } else {
          throw new Error('Media must be a URL, Buffer, or valid file path');
        }
        
        // Convert to base64
        const base64Media = mediaBuffer.toString('base64');
        mediaUrl = `data:${getMediaMimeType(type)};base64,${base64Media}`;
      }
      
      payload = {
        ...payload,
        media: {
          file: mediaUrl,
          caption: message || ''
        }
      };
      
      // For document type, we need filename
      if (type === 'document') {
        payload.media.filename = typeof media === 'string' ? 
          path.basename(media) : `document_${Date.now()}.pdf`;
      }
    }
    
    const response = await axios.post(WASSENGER_API_URL, payload, { headers });
    logger.info('Message sent via Wassenger:', response.data.id);
    return response.data;
  } catch (error) {
    logger.error('Wassenger API error:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send message via WhatsApp Business API
 * @param {string} to - Recipient phone number
 * @param {string} message - Message text
 * @param {string} type - Message type
 * @param {string|Buffer} media - Media URL or buffer
 * @returns {Promise<Object>} WhatsApp Business API response
 */
async function sendViaWhatsAppBusiness(to, message, type, media) {
  try {
    // Format phone number (remove + if present)
    const recipient = to.startsWith('+') ? to.substring(1) : to;
    
    const headers = {
      'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    };
    
    let payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient
    };
    
    // Handle different message types
    if (type === 'text' || !media) {
      payload.type = 'text';
      payload.text = { body: message };
    } else {
      payload.type = mapMessageType(type);
      
      // If media is a URL, use it directly
      if (typeof media === 'string' && (media.startsWith('http://') || media.startsWith('https://'))) {
        payload[payload.type] = {
          link: media,
          caption: message || ''
        };
      } 
      // If media is a Buffer or file path, upload it first
      else {
        const mediaId = await uploadMediaToWhatsApp(media, type);
        payload[payload.type] = {
          id: mediaId,
          caption: message || ''
        };
        
        // For document, add filename
        if (type === 'document') {
          payload[payload.type].filename = typeof media === 'string' ? 
            path.basename(media) : `document_${Date.now()}.pdf`;
        }
      }
    }
    
    const response = await axios({
      method: 'POST',
      url: `${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      headers,
      data: payload
    });
    
    logger.info('Message sent via WhatsApp Business API:', response.data.messages[0].id);
    return response.data;
  } catch (error) {
    logger.error('WhatsApp Business API error:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Map message type to WhatsApp Business API type
 */
function mapMessageType(type) {
  const typeMapping = {
    'image': 'image',
    'video': 'video',
    'document': 'document',
    'audio': 'audio'
  };
  
  return typeMapping[type] || 'text';
}

/**
 * Upload media to WhatsApp Business API
 * @param {Buffer|string} media - Media content
 * @param {string} type - Media type
 * @returns {Promise<string>} Media ID
 */
async function uploadMediaToWhatsApp(media, type) {
  try {
    const formData = new FormData();
    let fileStream;
    let tempFilePath;
    
    // If media is a Buffer, create temp file
    if (Buffer.isBuffer(media)) {
      const extension = getMediaExtension(type);
      tempFilePath = path.join(__dirname, `../temp/${Date.now()}.${extension}`);
      
      // Create temp directory if it doesn't exist
      fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
      
      // Write buffer to temp file
      fs.writeFileSync(tempFilePath, media);
      fileStream = fs.createReadStream(tempFilePath);
    } 
    // If media is a file path
    else if (typeof media === 'string' && fs.existsSync(media)) {
      fileStream = fs.createReadStream(media);
    } else {
      throw new Error('Media must be a Buffer or valid file path');
    }
    
    formData.append('file', fileStream);
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', getMediaMimeType(type));
    
    const response = await axios({
      method: 'POST',
      url: `${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/media`,
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        ...formData.getHeaders()
      },
      data: formData
    });
    
    // Clean up temp file if created
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    
    return response.data.id;
  } catch (error) {
    logger.error('Failed to upload media to WhatsApp:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Parse webhook message from either Wassenger or WhatsApp Business API
 * @param {Object} payload - Webhook payload
 * @returns {Object|null} Parsed message data
 */
async function parseWebhookMessage(payload) {
  try {
    // Determine which provider sent the webhook
    const provider = detectWebhookProvider(payload);
    
    // Parse based on provider
    if (provider === 'wassenger') {
      return parseWassengerWebhook(payload);
    } else if (provider === 'whatsapp_business') {
      return parseWhatsAppBusinessWebhook(payload);
    }
    
    return null;
  } catch (error) {
    logger.error('Failed to parse webhook message:', error);
    return null;
  }
}

/**
 * Detect which provider sent the webhook
 * @param {Object} payload - Webhook payload
 * @returns {string} Provider name
 */
function detectWebhookProvider(payload) {
  // WhatsApp Business API webhook structure
  if (payload.object && 
      payload.object === 'whatsapp_business_account' && 
      payload.entry && 
      Array.isArray(payload.entry)) {
    return 'whatsapp_business';
  }
  
  // Wassenger webhook structure
  if ((payload.event || payload.status) && 
      (payload.data || payload.message || payload.id)) {
    return 'wassenger';
  }
  
  // Use configured provider if we can't determine from payload
  return determineProvider();
}

/**
 * Parse Wassenger webhook payload
 * @param {Object} payload - Wassenger webhook payload
 * @returns {Object|null} Parsed message data
 */
function parseWassengerWebhook(payload) {
  // Handle different Wassenger webhook events
  if (payload.event !== 'message') {
    logger.debug('Ignoring non-message Wassenger webhook event:', payload.event);
    return null;
  }
  
  // Extract basic message data
  const messageData = {
    messageId: payload.id,
    from: payload.from || payload.owner,
    timestamp: payload.data.timestamp ? payload.data.timestamp * 1000 : Date.now(),
    provider: 'wassenger',
    type: 'text'
  };
  
  // Handle different message types
  if (payload.data.type === 'chat') {
    messageData.text = payload.data.body || '';
  } else if (payload.data.type === 'image') {
    messageData.type = 'image';
    messageData.caption = payload.data.caption || '';
    messageData.mediaUrl = payload.data.url || payload.data.body;
  } else if (payload.data.type === 'video') {
    messageData.type = 'video';
    messageData.caption = payload.data.caption || '';
    messageData.mediaUrl = payload.data.url || payload.data.body;
  } else if (payload.data.type === 'document') {
    messageData.type = 'document';
    messageData.caption = payload.data.caption || '';
    messageData.mediaUrl = payload.data.url || payload.data.body;
    messageData.fileName = payload.data.filename || `document_${Date.now()}.pdf`;
  }
  
  return messageData;
}

/**
 * Parse WhatsApp Business API webhook payload
 * @param {Object} payload - WhatsApp Business API webhook payload
 * @returns {Object|null} Parsed message data
 */
function parseWhatsAppBusinessWebhook(payload) {
  try {
    // Validate expected payload structure
    if (!payload.entry || 
        !Array.isArray(payload.entry) || 
        payload.entry.length === 0 ||
        !payload.entry[0].changes ||
        !Array.isArray(payload.entry[0].changes) ||
        payload.entry[0].changes.length === 0) {
      return null;
    }
    
    const change = payload.entry[0].changes[0];
    
    // Check if this is a status update, not a message
    if (!change.value || !change.value.messages || !Array.isArray(change.value.messages) || change.value.messages.length === 0) {
      // If it contains statuses, this is a status update
      if (change.value && change.value.statuses) {
        logger.debug('Received status update, not a message');
        return null;
      }
      return null;
    }
    
    const message = change.value.messages[0];
    const contacts = change.value.contacts || [];
    const contact = contacts.length > 0 ? contacts[0] : {};
    
    // Basic message data
    const messageData = {
      messageId: message.id,
      from: message.from,
      timestamp: parseInt(message.timestamp) * 1000,
      provider: 'whatsapp_business',
      type: 'text',
      senderName: contact.profile?.name || ''
    };
    
    // Handle different message types
    switch (message.type) {
      case 'text':
        messageData.text = message.text.body;
        break;
        
      case 'image':
        messageData.type = 'image';
        messageData.mediaId = message.image.id;
        messageData.caption = message.image.caption || '';
        break;
        
      case 'video':
        messageData.type = 'video';
        messageData.mediaId = message.video.id;
        messageData.caption = message.video.caption || '';
        break;
        
      case 'document':
        messageData.type = 'document';
        messageData.mediaId = message.document.id;
        messageData.fileName = message.document.filename || `document_${Date.now()}.pdf`;
        messageData.caption = message.document.caption || '';
        break;
        
      default:
        logger.warn(`Unsupported WhatsApp message type: ${message.type}`);
        return null;
    }
    
    return messageData;
  } catch (error) {
    logger.error('Error parsing WhatsApp Business webhook:', error);
    return null;
  }
}

/**
 * Download media from either provider
 * @param {Object} message - Parsed message with media information
 * @returns {Promise<{data: Buffer, contentType: string}>} Downloaded media
 */
async function downloadMedia(message) {
  try {
    if (message.provider === 'wassenger') {
      return downloadWassengerMedia(message.mediaUrl);
    } else if (message.provider === 'whatsapp_business') {
      return downloadWhatsAppBusinessMedia(message.mediaId);
    }
    
    throw new Error(`Unknown provider: ${message.provider}`);
  } catch (error) {
    logger.error(`Failed to download media from ${message.provider}:`, error);
    throw error;
  }
}

/**
 * Download media from Wassenger URL
 * @param {string} mediaUrl - Wassenger media URL
 * @returns {Promise<{data: Buffer, contentType: string}>} Downloaded media
 */
async function downloadWassengerMedia(mediaUrl) {
  try {
    const response = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      headers: {
        'Authorization': `Bearer ${WASSENGER_API_KEY}`
      }
    });
    
    return {
      data: Buffer.from(response.data),
      contentType: response.headers['content-type'] || 'application/octet-stream'
    };
  } catch (error) {
    logger.error('Failed to download Wassenger media:', error);
    throw error;
  }
}

/**
 * Download media from WhatsApp Business API
 * @param {string} mediaId - WhatsApp media ID
 * @returns {Promise<{data: Buffer, contentType: string}>} Downloaded media
 */
async function downloadWhatsAppBusinessMedia(mediaId) {
  try {
    // First get the media URL using the media ID
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
    
    return {
      data: Buffer.from(mediaResponse.data),
      contentType: mediaInfoResponse.data.mime_type || 'application/octet-stream'
    };
  } catch (error) {
    logger.error('Failed to download WhatsApp Business media:', error);
    throw error;
  }
}

/**
 * Helper functions for media handling
 */
function getMediaMimeType(type) {
  const mimeTypes = {
    'image': 'image/jpeg',
    'video': 'video/mp4',
    'document': 'application/pdf',
    'audio': 'audio/mpeg'
  };
  
  return mimeTypes[type] || 'application/octet-stream';
}

function getMediaExtension(type) {
  const extensions = {
    'image': 'jpg',
    'video': 'mp4',
    'document': 'pdf',
    'audio': 'mp3'
  };
  
  return extensions[type] || 'bin';
}

module.exports = {
  sendMessage,
  parseWebhookMessage,
  downloadMedia,
  determineProvider
};