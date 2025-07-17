/**
 * Unified WhatsApp webhook handler
 * Handles messages from both Wassenger and WhatsApp Business API
 */
const db = require('./db');
const openai = require('./openai');
const whatsapp = require('./whatsapp'); // Unified messaging service
const { generatePDF } = require('./utils/pdf');
const logger = require('./utils/logger');

/**
 * Handle incoming webhook requests from WhatsApp providers
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 */
async function handleWebhook(req, res) {
  try {
    logger.info('Received webhook request');
    
    // Handle WhatsApp Business API verification request (GET method)
    if (req.method === 'GET') {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      
      if (mode && token && challenge) {
        const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
        
        if (mode === 'subscribe' && token === verifyToken) {
          logger.info('WhatsApp Business API webhook verified');
          return res.status(200).send(challenge);
        } else {
          logger.error('WhatsApp Business API webhook verification failed');
          return res.status(403).send('Verification failed');
        }
      }
    }
    
    // For POST requests, process the incoming message
    if (req.method === 'POST') {
      const payload = req.body;
      
      // Parse message using the unified parser
      const message = await whatsapp.parseWebhookMessage(payload);
      
      // If no valid message found, return early
      if (!message) {
        logger.info('No valid message data found in webhook');
        return res.status(200).send('No actionable data');
      }
      
      // For WhatsApp Business API, respond immediately to prevent retries
      if (message.provider === 'whatsapp_business') {
        res.status(200).send('OK');
      }
      
      // Process message asynchronously
      await processMessage(message);
      
      // For Wassenger, respond after processing
      if (message.provider === 'wassenger') {
        return res.status(200).send('Processed successfully');
      }
    }
    
    // For any other case that hasn't returned yet
    return res.status(200).send('OK');
    
  } catch (error) {
    logger.error('Error in webhook handler:', error);
    // Always respond with 200 to prevent retry attempts
    return res.status(200).send('Error processed');
  }
}

/**
 * Process incoming WhatsApp message
 * @param {Object} message - Parsed message data
 */
async function processMessage(message) {
  try {
    logger.info(`Processing message from ${message.from}: ${message.text ? message.text.substring(0, 50) + '...' : '[Media]'}`);
    
    // Store raw message for audit trail
    const [rawMessage] = await db.query(
      `INSERT INTO raw_messages (sender, message_type, content, media_id, provider, timestamp, external_id)
       VALUES (?, ?, ?, ?, ?, FROM_UNIXTIME(?), ?)`,
      [
        message.from,
        message.type,
        message.text || message.caption || '',
        message.mediaId || null,
        message.provider,
        Math.floor(message.timestamp / 1000),
        message.messageId
      ]
    );
    
    // Get or create user by WhatsApp ID
    const user = await getOrCreateUser(message.from);
    
    // Get active conversation or create new one
    const conversation = await getConversationContext(user.id);
    
    // Store incoming message
    const [storedMessage] = await db.query(
      `INSERT INTO messages (conversation_id, sender_id, message_type, content, whatsapp_message_id, sent_at)
       VALUES (?, ?, ?, ?, ?, FROM_UNIXTIME(?))`,
      [
        conversation.id,
        user.id,
        message.type,
        message.text || message.caption || '',
        message.messageId,
        Math.floor(message.timestamp / 1000)
      ]
    );
    
    // If message has media, download and store it
    let mediaId = null;
    if (message.mediaId || message.mediaUrl) {
      try {
        const mediaContent = await whatsapp.downloadMedia(message);
        
        const [media] = await db.query(
          `INSERT INTO media (media_type, content, file_name, content_type, created_at)
           VALUES (?, ?, ?, ?, NOW())`,
          [
            message.type,
            mediaContent.data,
            `${message.messageId}.${message.type === 'image' ? 'jpg' : 'mp4'}`,
            message.type === 'image' ? 'image/jpeg' : 'video/mp4'
          ]
        );
        
        mediaId = media.insertId;
        
        // Update the message with media reference
        await db.query(
          'UPDATE messages SET media_id = ? WHERE id = ?',
          [mediaId, storedMessage.insertId]
        );
        
        logger.info(`Media stored with ID: ${mediaId}`);
      } catch (mediaError) {
        logger.error('Failed to process media:', mediaError);
      }
    }
    
    // Process message with OpenAI to determine intent
    const nlpResponse = await openai.processMessage(
      message.text || message.caption || '',
      conversation.context,
      user.role
    );
    
    logger.info(`Detected intent: ${nlpResponse.intent}`);
    
    // Update conversation context with new information
    const updatedContext = {
      ...conversation.context,
      ...nlpResponse.contextUpdates,
      lastIntent: nlpResponse.intent,
      lastMessageId: storedMessage.insertId
    };
    
    await db.query(
      'UPDATE conversations SET context = ?, last_message_at = NOW() WHERE id = ?',
      [JSON.stringify(updatedContext), conversation.id]
    );
    
    // Handle the intent
    await handleIntent(message.from, nlpResponse, updatedContext, user, mediaId);
    
  } catch (error) {
    logger.error('Error processing message:', error);
    
    // Try to send error message to user
    try {
      await whatsapp.sendMessage(
        message.from,
        "Sorry, I encountered an error processing your request. Please try again later."
      );
    } catch (sendError) {
      logger.error('Failed to send error message:', sendError);
    }
  }
}

/**
 * Get or create user based on WhatsApp ID
 */
async function getOrCreateUser(whatsappId) {
  try {
    // Check if user exists
    const [users] = await db.query(
      'SELECT * FROM users WHERE whatsapp_id = ? OR phone = ? LIMIT 1',
      [whatsappId, whatsappId]
    );
    
    if (users && users.length > 0) {
      return users[0];
    }
    
    // Create new user if not found
    logger.info(`Creating new user for WhatsApp ID: ${whatsappId}`);
    const [newUser] = await db.query(
      `INSERT INTO users (phone, whatsapp_id, role, created_at)
       VALUES (?, ?, 'inspector', NOW())`,
      [whatsappId, whatsappId]
    );
    
    const [createdUser] = await db.query(
      'SELECT * FROM users WHERE id = ?',
      [newUser.insertId]
    );
    
    return createdUser[0];
  } catch (error) {
    logger.error('Failed to get or create user:', error);
    throw error;
  }
}

/**
 * Get active conversation or create new one
 */
async function getConversationContext(userId) {
  try {
    const [conversations] = await db.query(
      `SELECT * FROM conversations 
       WHERE user_id = ? AND active = TRUE 
       ORDER BY last_message_at DESC LIMIT 1`,
      [userId]
    );
    
    if (conversations && conversations.length > 0) {
      const conversation = conversations[0];
      conversation.context = JSON.parse(conversation.context || '{}');
      return conversation;
    }
    
    // Create new conversation
    const [newConversation] = await db.query(
      'INSERT INTO conversations (user_id, context, active, created_at) VALUES (?, ?, TRUE, NOW())',
      [userId, JSON.stringify({})]
    );
    
    return {
      id: newConversation.insertId,
      user_id: userId,
      context: {},
      active: true
    };
  } catch (error) {
    logger.error('Failed to get conversation context:', error);
    throw error;
  }
}

/**
 * Handle the detected intent from the user's message
 */
async function handleIntent(recipient, nlpResponse, context, user, mediaId) {
  const { intent, data, response } = nlpResponse;
  
  try {
    // Send the AI-generated response if available
    if (response) {
      await whatsapp.sendMessage(recipient, response);
    }
    
    // Handle different intents
    switch (intent) {
      case 'get_today_jobs':
        await handleGetTodayJobs(recipient, user.id);
        break;
        
      case 'start_inspection':
        if (data.workOrderId) {
          await handleStartInspection(recipient, user.id, data.workOrderId);
        }
        break;
        
      case 'complete_item':
        if (data.itemId) {
          await handleCompleteItem(recipient, user.id, data.itemId, data.status, data.comments, mediaId);
        }
        break;
        
      case 'complete_inspection':
        if (context.currentChecklistInstanceId) {
          await handleCompleteInspection(recipient, user.id, context.currentChecklistInstanceId);
        }
        break;
        
      case 'add_media':
        if (mediaId && data.itemId) {
          await handleAddMedia(recipient, user.id, data.itemId, mediaId);
        } else if (mediaId && context.currentItemId) {
          await handleAddMedia(recipient, user.id, context.currentItemId, mediaId);
        }
        break;
        
      case 'help':
        await sendHelpMessage(recipient);
        break;
        
      // Add more intent handlers as needed
    }
    
  } catch (error) {
    logger.error(`Failed to handle intent ${intent}:`, error);
    await whatsapp.sendMessage(
      recipient,
      "Sorry, I encountered an error while processing your request. Please try again later."
    );
  }
}

/**
 * Intent handlers implementation...
 * These methods would contain the business logic for each intent
 */
async function handleGetTodayJobs(recipient, userId) {
  // Implementation omitted for brevity
  // This would fetch today's jobs and send them to the user
}

async function handleStartInspection(recipient, userId, workOrderId) {
  // Implementation omitted for brevity
  // This would start a new inspection
}

async function handleCompleteItem(recipient, userId, itemId, status, comments, mediaId) {
  // Implementation omitted for brevity
  // This would mark a checklist item as complete
}

async function handleCompleteInspection(recipient, userId, checklistInstanceId) {
  // Implementation omitted for brevity
  // This would complete an entire inspection
}

async function handleAddMedia(recipient, userId, itemId, mediaId) {
  // Implementation omitted for brevity
  // This would add media to a checklist item
}

async function sendHelpMessage(recipient) {
  // Implementation omitted for brevity
  // This would send a help message with available commands
}

module.exports = {
  handleWebhook
};
