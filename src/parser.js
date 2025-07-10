/**
 * Message parser for WhatsApp Business API webhook payloads
 */

/**
 * Parse incoming webhook payload from WhatsApp Business API
 * @param {Object} payload - Webhook payload
 * @returns {Object|null} Parsed message data or null if not a message
 */
function parseWhatsAppPayload(payload) {
  try {
    // Check if this is a webhook verification
    if (payload['hub.mode'] && payload['hub.challenge']) {
      return {
        isVerification: true,
        mode: payload['hub.mode'],
        challenge: payload['hub.challenge'],
        token: payload['hub.verify_token']
      };
    }
    
    // Validate expected payload structure for messages
    if (!payload.object || 
        payload.object !== 'whatsapp_business_account' || 
        !payload.entry || 
        !Array.isArray(payload.entry) || 
        payload.entry.length === 0) {
      console.log('Not a valid WhatsApp message payload');
      return null;
    }
    
    // Loop through entries (usually just one)
    for (const entry of payload.entry) {
      if (!entry.changes || !Array.isArray(entry.changes) || entry.changes.length === 0) {
        continue;
      }
      
      // Process each change
      for (const change of entry.changes) {
        if (change.field !== 'messages' || !change.value || !change.value.messages || 
            !Array.isArray(change.value.messages) || change.value.messages.length === 0) {
          continue;
        }
        
        const message = change.value.messages[0];
        const metadata = change.value.metadata || {};
        const contacts = change.value.contacts || [];
        const contact = contacts.length > 0 ? contacts[0] : {};
        
        // Basic message structure
        const parsedMessage = {
          messageId: message.id,
          from: message.from,
          timestamp: parseInt(message.timestamp) * 1000, // Convert to milliseconds
          type: message.type,
          senderName: contact?.profile?.name || 'Unknown',
          recipientPhone: metadata?.display_phone_number,
          recipientId: metadata?.phone_number_id
        };
        
        // Extract content based on message type
        switch (message.type) {
          case 'text':
            parsedMessage.text = message.text.body;
            break;
            
          case 'image':
            parsedMessage.mediaId = message.image.id;
            parsedMessage.mimeType = message.image.mime_type;
            parsedMessage.caption = message.image.caption || '';
            break;
            
          case 'video':
            parsedMessage.mediaId = message.video.id;
            parsedMessage.mimeType = message.video.mime_type;
            parsedMessage.caption = message.video.caption || '';
            break;
            
          case 'audio':
            parsedMessage.mediaId = message.audio.id;
            parsedMessage.mimeType = message.audio.mime_type;
            break;
            
          case 'document':
            parsedMessage.mediaId = message.document.id;
            parsedMessage.mimeType = message.document.mime_type;
            parsedMessage.fileName = message.document.filename;
            parsedMessage.caption = message.document.caption || '';
            break;
            
          case 'location':
            parsedMessage.latitude = message.location.latitude;
            parsedMessage.longitude = message.location.longitude;
            parsedMessage.address = message.location.address || '';
            parsedMessage.name = message.location.name || '';
            break;
            
          case 'button':
            parsedMessage.text = message.button.text;
            parsedMessage.payload = message.button.payload;
            break;
            
          case 'interactive':
            if (message.interactive.type === 'button_reply') {
              parsedMessage.interactiveType = 'button';
              parsedMessage.buttonId = message.interactive.button_reply.id;
              parsedMessage.buttonText = message.interactive.button_reply.title;
            } else if (message.interactive.type === 'list_reply') {
              parsedMessage.interactiveType = 'list';
              parsedMessage.listId = message.interactive.list_reply.id;
              parsedMessage.listTitle = message.interactive.list_reply.title;
              parsedMessage.listDescription = message.interactive.list_reply.description;
            }
            break;
            
          default:
            console.log(`Unsupported message type: ${message.type}`);
            break;
        }
        
        console.log(`📥 Parsed WhatsApp message of type: ${parsedMessage.type}`);
        return parsedMessage;
      }
    }
    
    // Handle status updates
    if (payload.entry[0].changes[0].value.statuses) {
      const status = payload.entry[0].changes[0].value.statuses[0];
      return {
        isStatus: true,
        messageId: status.id,
        recipientId: status.recipient_id,
        status: status.status,
        timestamp: parseInt(status.timestamp) * 1000
      };
    }
    
    return null;
  } catch (error) {
    console.error('❌ Error parsing WhatsApp payload:', error);
    return null;
  }
}

module.exports = {
  parseWhatsAppPayload
};