/**
 * Main webhook handler for Property Stewards Inspector Interface
 * Processes incoming WhatsApp messages via WhatsApp Business API
 */

const whatsapp = require('./whatsapp');
const openai = require('./openai');
const db = require('./db');
const { generatePDF } = require('./utils/pdf');

/**
 * Process webhook requests from WhatsApp Business API
 * @param {Object} req - HTTP request object
 * @param {Object} res - HTTP response object
 */
async function handleWebhook(req, res) {
  try {
    console.log('📩 Received webhook request');
    
    // Handle WhatsApp verification request
    if (req.method === 'GET') {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      
      const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
      
      if (mode === 'subscribe' && token === verifyToken) {
        console.log('✅ Webhook verified');
        return res.status(200).send(challenge);
      } else {
        console.error('❌ Webhook verification failed');
        return res.status(403).send('Verification failed');
      }
    }
    
    // Process incoming message
    if (req.method === 'POST') {
      const payload = req.body;
      
      // Parse the webhook payload
      const message = whatsapp.parseWebhookPayload(payload);
      
      // Handle verification messages
      if (message?.isVerification) {
        return res.status(200).send(message.challenge);
      }
      
      // Ignore if no message found
      if (!message) {
        return res.status(200).send('No message found');
      }
      
      // Process the message
      await processMessage(message);
      
      // Acknowledge receipt
      return res.status(200).send('OK');
    }
    
    // Unsupported method
    return res.status(405).send('Method not allowed');
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    return res.status(500).send('Internal server error');
  }
}

/**
 * Process incoming WhatsApp message
 * @param {Object} message - Parsed message from WhatsApp Business API
 */
async function processMessage(message) {
  try {
    console.log(`📱 Processing message from ${message.from}`);
    
    // Get or create user by WhatsApp ID
    const [user] = await db.query(
      'SELECT * FROM users WHERE whatsapp_id = ?',
      [message.from]
    );
    
    if (!user || user.length === 0) {
      console.log(`ℹ️ New user with WhatsApp ID ${message.from}`);
      // For new users, we might want to initiate an onboarding flow
      // This is simplified - in production you'd have a more robust onboarding process
      await whatsapp.sendTextMessage(
        message.from,
        'Welcome to Property Stewards! You are not registered in our system yet. Please contact your administrator to get set up.'
      );
      return;
    }
    
    // Get active conversation or create new one
    const [conversation] = await db.query(
      `SELECT * FROM conversations 
       WHERE user_id = ? AND active = TRUE 
       ORDER BY last_message_at DESC LIMIT 1`,
      [user[0].id]
    );
    
    let conversationId;
    let conversationContext = {};
    
    if (!conversation || conversation.length === 0) {
      // Create new conversation
      const [newConversation] = await db.query(
        'INSERT INTO conversations (user_id, context, active) VALUES (?, ?, TRUE)',
        [user[0].id, JSON.stringify({})]
      );
      conversationId = newConversation.insertId;
    } else {
      conversationId = conversation[0].id;
      conversationContext = JSON.parse(conversation[0].context || '{}');
    }
    
    // Store incoming message
    const [storedMessage] = await db.query(
      `INSERT INTO messages (conversation_id, sender_id, message_type, content, whatsapp_message_id, sent_at)
       VALUES (?, ?, ?, ?, ?, FROM_UNIXTIME(? / 1000))`,
      [
        conversationId,
        user[0].id,
        message.type,
        message.text || message.caption || '',
        message.messageId,
        message.timestamp
      ]
    );
    
    // If message has media, download and store it
    let mediaId = null;
    if (message.mediaId) {
      try {
        const mediaContent = await whatsapp.downloadMedia(message.mediaId);
        const [media] = await db.query(
          `INSERT INTO media (checklist_instance_item_id, media_type, file_name, content_type, content)
           VALUES (?, ?, ?, ?, ?)`,
          [
            // We'll need to get the checklist_instance_item_id from context
            // For now, use a placeholder value that we'll update later
            conversationContext.currentItemId || null,
            message.type,
            `${message.mediaId}.${message.mimeType.split('/')[1]}`,
            message.mimeType,
            mediaContent
          ]
        );
        
        mediaId = media.insertId;
        
        // Update the message with media reference
        await db.query(
          'UPDATE messages SET media_id = ? WHERE id = ?',
          [mediaId, storedMessage.insertId]
        );
      } catch (error) {
        console.error('❌ Failed to process media:', error);
      }
    }
    
    // Process message with OpenAI to determine intent
    const messageContent = message.text || message.caption || '';
    const openaiResponse = await openai.processMessage(
      messageContent,
      conversationContext,
      user[0].role
    );
    
    // Update conversation context with new information
    const updatedContext = {
      ...conversationContext,
      ...openaiResponse.context,
      lastIntent: openaiResponse.intent,
      lastMessageId: storedMessage.insertId
    };
    
    await db.query(
      'UPDATE conversations SET context = ?, last_message_at = NOW() WHERE id = ?',
      [JSON.stringify(updatedContext), conversationId]
    );
    
    // Handle the intent
    await handleIntent(message.from, openaiResponse, updatedContext, user[0], mediaId);
  } catch (error) {
    console.error('❌ Failed to process message:', error);
    // Send error message to user
    try {
      await whatsapp.sendTextMessage(
        message.from,
        'Sorry, we encountered an error processing your message. Please try again later.'
      );
    } catch (sendError) {
      console.error('❌ Failed to send error message:', sendError);
    }
  }
}

/**
 * Handle the detected intent from the user's message
 * @param {string} recipient - WhatsApp ID to send response to
 * @param {Object} openaiResponse - Response from OpenAI with intent and data
 * @param {Object} context - Current conversation context
 * @param {Object} user - User info
 * @param {number|null} mediaId - ID of uploaded media if applicable
 */
async function handleIntent(recipient, openaiResponse, context, user, mediaId) {
  const { intent, response, data } = openaiResponse;
  
  try {
    // Log the intent for debugging
    console.log(`🧠 Detected intent: ${intent}`);
    
    // If we have a direct response from OpenAI, send it first
    if (response) {
      await whatsapp.sendTextMessage(recipient, response);
    }
    
    // Handle different intents
    switch (intent) {
      case 'get_today_jobs':
        await handleGetTodayJobs(recipient, user);
        break;
        
      case 'start_inspection':
        await handleStartInspection(recipient, user, data.workOrderId);
        break;
        
      case 'complete_item':
        await handleCompleteItem(recipient, user, data.itemId, data.status, data.comments, mediaId);
        break;
        
      case 'complete_inspection':
        await handleCompleteInspection(recipient, user, data.checklistInstanceId);
        break;
        
      case 'add_media':
        if (mediaId) {
          await handleAddMedia(recipient, user, data.itemId, mediaId);
        } else {
          await whatsapp.sendTextMessage(recipient, "Please send a photo or video along with your comment.");
        }
        break;
        
      case 'add_comment':
        await handleAddComment(recipient, user, data.itemId, data.comment);
        break;
        
      case 'help':
        await sendHelpMessage(recipient);
        break;
        
      default:
        // Default response for unrecognized intents
        if (!response) {
          await whatsapp.sendTextMessage(
            recipient,
            "I'm not sure what you're asking for. Type 'help' to see what I can help you with."
          );
        }
    }
    
    // Store system message with the response
    if (response) {
      const [conversation] = await db.query(
        'SELECT id FROM conversations WHERE user_id = ? AND active = TRUE LIMIT 1',
        [user.id]
      );
      
      if (conversation && conversation.length > 0) {
        await db.query(
          'INSERT INTO messages (conversation_id, message_type, content, sent_at) VALUES (?, "system", ?, NOW())',
          [conversation[0].id, response]
        );
      }
    }
  } catch (error) {
    console.error(`❌ Failed to handle intent ${intent}:`, error);
    await whatsapp.sendTextMessage(
      recipient,
      "Sorry, I encountered an error while processing your request. Please try again."
    );
  }
}

/**
 * Handle getting today's jobs for an inspector
 * @param {string} recipient - WhatsApp ID to send response to
 * @param {Object} user - User info
 */
async function handleGetTodayJobs(recipient, user) {
  try {
    // Only applicable for inspectors
    if (user.role !== 'inspector') {
      await whatsapp.sendTextMessage(
        recipient,
        "This feature is only available to inspectors."
      );
      return;
    }
    
    // Get today's work orders for the inspector
    const today = new Date().toISOString().split('T')[0];
    const [workOrders] = await db.query(
      `SELECT wo.id, wo.scheduled_time_start, wo.scheduled_time_end, 
              p.address_line1, p.city, p.state, p.zip,
              c.first_name AS customer_first_name, c.last_name AS customer_last_name
       FROM work_orders wo
       JOIN contracts ct ON wo.contract_id = ct.id
       JOIN properties p ON ct.property_id = p.id
       JOIN users c ON ct.customer_id = c.id
       WHERE wo.inspector_id = ? AND wo.scheduled_date = ? AND wo.status IN ('scheduled', 'in_progress')
       ORDER BY wo.scheduled_time_start`,
      [user.id, today]
    );
    
    if (!workOrders || workOrders.length === 0) {
      await whatsapp.sendTextMessage(
        recipient,
        "You have no inspections scheduled for today."
      );
      return;
    }
    
    // Format the response
    let response = `📋 *Your Inspections Today (${today})*\n\n`;
    
    workOrders.forEach((wo, index) => {
      const timeWindow = `${wo.scheduled_time_start?.substring(0, 5) || 'N/A'} - ${wo.scheduled_time_end?.substring(0, 5) || 'N/A'}`;
      
      response += `*${index + 1}. Work Order #${wo.id}*\n`;
      response += `🕒 Time: ${timeWindow}\n`;
      response += `📍 Location: ${wo.address_line1}, ${wo.city}, ${wo.state} ${wo.zip}\n`;
      response += `👤 Customer: ${wo.customer_first_name} ${wo.customer_last_name}\n\n`;
    });
    
    response += "To start an inspection, reply with 'Start inspection #' followed by the work order number.";
    
    await whatsapp.sendTextMessage(recipient, response);
  } catch (error) {
    console.error('❌ Failed to get today\'s jobs:', error);
    await whatsapp.sendTextMessage(
      recipient,
      "Sorry, I couldn't retrieve your inspections for today. Please try again later."
    );
  }
}

/**
 * Handle starting an inspection
 * @param {string} recipient - WhatsApp ID to send response to
 * @param {Object} user - User info
 * @param {number} workOrderId - Work order ID
 */
async function handleStartInspection(recipient, user, workOrderId) {
  try {
    // Verify the work order exists and is assigned to this inspector
    const [workOrder] = await db.query(
      `SELECT wo.*, ct.id AS contract_id, p.address_line1, p.city, p.state, p.zip,
              cl.id AS checklist_id, cl.title AS checklist_title
       FROM work_orders wo
       JOIN contracts ct ON wo.contract_id = ct.id
       JOIN properties p ON ct.property_id = p.id
       JOIN checklists cl ON wo.checklist_id = cl.id
       WHERE wo.id = ? AND wo.inspector_id = ?`,
      [workOrderId, user.id]
    );
    
    if (!workOrder || workOrder.length === 0) {
      await whatsapp.sendTextMessage(
        recipient,
        `Work order #${workOrderId} is not assigned to you or does not exist.`
      );
      return;
    }
    
    const wo = workOrder[0];
    
    // Check if inspection is already in progress
    let checklistInstanceId;
    const [existingInstance] = await db.query(
      'SELECT * FROM checklist_instances WHERE work_order_id = ?',
      [workOrderId]
    );
    
    if (existingInstance && existingInstance.length > 0) {
      // Inspection already exists
      checklistInstanceId = existingInstance[0].id;
      
      if (existingInstance[0].status === 'completed') {
        await whatsapp.sendTextMessage(
          recipient,
          `Inspection for work order #${workOrderId} has already been completed.`
        );
        return;
      } else {
        // Resume existing inspection
        await db.query(
          'UPDATE work_orders SET status = "in_progress" WHERE id = ?',
          [workOrderId]
        );
        
        await whatsapp.sendTextMessage(
          recipient,
          `Resuming inspection for work order #${workOrderId}.`
        );
      }
    } else {
      // Start new inspection
      const [newInstance] = await db.query(
        `INSERT INTO checklist_instances (work_order_id, started_at, status) 
         VALUES (?, NOW(), 'in_progress')`,
        [workOrderId]
      );
      
      checklistInstanceId = newInstance.insertId;
      
      // Update work order status
      await db.query(
        'UPDATE work_orders SET status = "in_progress" WHERE id = ?',
        [workOrderId]
      );
      
      await whatsapp.sendTextMessage(
        recipient,
        `Started inspection for work order #${workOrderId}.`
      );
    }
    
    // Get checklist items
    const [checklistItems] = await db.query(
      `SELECT ci.*
       FROM checklist_items ci
       WHERE ci.checklist_id = ?
       ORDER BY ci.item_order`,
      [wo.checklist_id]
    );
    
    // Create checklist instance items if they don't exist
    for (const item of checklistItems) {
      const [existingItem] = await db.query(
        `SELECT * FROM checklist_instance_items 
         WHERE checklist_instance_id = ? AND checklist_item_id = ?`,
        [checklistInstanceId, item.id]
      );
      
      if (!existingItem || existingItem.length === 0) {
        await db.query(
          `INSERT INTO checklist_instance_items 
           (checklist_instance_id, checklist_item_id, status)
           VALUES (?, ?, 'pending')`,
          [checklistInstanceId, item.id]
        );
      }
    }
    
    // Send inspection details
    let response = `🏠 *Inspection Details*\n\n`;
    response += `📍 Location: ${wo.address_line1}, ${wo.city}, ${wo.state} ${wo.zip}\n`;
    response += `📋 Checklist: ${wo.checklist_title}\n\n`;
    response += `*Checklist Items:*\n`;
    
    checklistItems.forEach((item, index) => {
      response += `${index + 1}. ${item.title}\n`;
    });
    
    response += `\nTo inspect an item, say "Inspect item #" followed by the item number.`;
    
    await whatsapp.sendTextMessage(recipient, response);
    
    // Update conversation context
    const [conversation] = await db.query(
      'SELECT * FROM conversations WHERE user_id = ? AND active = TRUE LIMIT 1',
      [user.id]
    );
    
    if (conversation && conversation.length > 0) {
      const context = JSON.parse(conversation[0].context || '{}');
      const updatedContext = {
        ...context,
        currentWorkOrderId: workOrderId,
        currentChecklistInstanceId: checklistInstanceId,
        currentChecklistItems: checklistItems.map(item => ({
          id: item.id,
          title: item.title
        }))
      };
      
      await db.query(
        'UPDATE conversations SET context = ? WHERE id = ?',
        [JSON.stringify(updatedContext), conversation[0].id]
      );
    }
  } catch (error) {
    console.error('❌ Failed to start inspection:', error);
    await whatsapp.sendTextMessage(
      recipient,
      "Sorry, I couldn't start the inspection. Please try again later."
    );
  }
}

/**
 * Handle completing a checklist item
 * @param {string} recipient - WhatsApp ID to send response to
 * @param {Object} user - User info
 * @param {number} itemId - Checklist item ID
 * @param {string} status - Item status (completed, skipped, issue_found)
 * @param {string} comments - Comments for the item
 * @param {number|null} mediaId - ID of uploaded media if applicable
 */
async function handleCompleteItem(recipient, user, itemId, status, comments, mediaId) {
  try {
    // Verify the checklist item exists and belongs to this inspector's active inspection
    const [checklistItem] = await db.query(
      `SELECT cii.*, ci.id AS instance_id, wo.id AS work_order_id
       FROM checklist_instance_items cii
       JOIN checklist_instances ci ON cii.checklist_instance_id = ci.id
       JOIN work_orders wo ON ci.work_order_id = wo.id
       WHERE cii.id = ? AND wo.inspector_id = ? AND ci.status = 'in_progress'`,
      [itemId, user.id]
    );
    
    if (!checklistItem || checklistItem.length === 0) {
      await whatsapp.sendTextMessage(
        recipient,
        `Checklist item #${itemId} is not part of your active inspection.`
      );
      return;
    }
    
    // Update item status
    await db.query(
      `UPDATE checklist_instance_items
       SET status = ?, comments = ?, completed_at = NOW()
       WHERE id = ?`,
      [status, comments, itemId]
    );
    
    // If media was uploaded, link it to this checklist item
    if (mediaId) {
      await db.query(
        'UPDATE media SET checklist_instance_item_id = ? WHERE id = ?',
        [itemId, mediaId]
      );
    }
    
    await whatsapp.sendTextMessage(
      recipient,
      `✅ Item marked as ${status}.`
    );
    
    // Check if all items are completed
    const [checklistItems] = await db.query(
      `SELECT COUNT(*) AS total, 
              SUM(CASE WHEN status != 'pending' THEN 1 ELSE 0 END) AS completed
       FROM checklist_instance_items
       WHERE checklist_instance_id = ?`,
      [checklistItem[0].instance_id]
    );
    
    if (checklistItems[0].total === checklistItems[0].completed) {
      await whatsapp.sendTextMessage(
        recipient,
        "All items in the checklist have been completed. You can now complete the inspection by saying 'Complete inspection'."
      );
    } else {
      // Get the next pending item
      const [nextItem] = await db.query(
        `SELECT cii.id, ci.title
         FROM checklist_instance_items cii
         JOIN checklist_items ci ON cii.checklist_item_id = ci.id
         WHERE cii.checklist_instance_id = ? AND cii.status = 'pending'
         ORDER BY ci.item_order
         LIMIT 1`,
        [checklistItem[0].instance_id]
      );
      
      if (nextItem && nextItem.length > 0) {
        await whatsapp.sendTextMessage(
          recipient,
          `Next item: ${nextItem[0].title} (Item #${nextItem[0].id})`
        );
      }
    }
  } catch (error) {
    console.error('❌ Failed to complete checklist item:', error);
    await whatsapp.sendTextMessage(
      recipient,
      "Sorry, I couldn't update the checklist item. Please try again later."
    );
  }
}

/**
 * Handle completing an entire inspection
 * @param {string} recipient - WhatsApp ID to send response to
 * @param {Object} user - User info
 * @param {number} checklistInstanceId - Checklist instance ID
 */
async function handleCompleteInspection(recipient, user, checklistInstanceId) {
  try {
    // Verify the checklist instance exists and belongs to this inspector
    const [checklistInstance] = await db.query(
      `SELECT ci.*, wo.id AS work_order_id
       FROM checklist_instances ci
       JOIN work_orders wo ON ci.work_order_id = wo.id
       WHERE ci.id = ? AND wo.inspector_id = ? AND ci.status = 'in_progress'`,
      [checklistInstanceId, user.id]
    );
    
    if (!checklistInstance || checklistInstance.length === 0) {
      await whatsapp.sendTextMessage(
        recipient,
        `Checklist instance #${checklistInstanceId} is not part of your active inspections.`
      );
      return;
    }
    
    // Check if all items are completed
    const [checklistItems] = await db.query(
      `SELECT COUNT(*) AS total, 
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM checklist_instance_items
       WHERE checklist_instance_id = ?`,
      [checklistInstanceId]
    );
    
    if (checklistItems[0].pending > 0) {
      await whatsapp.sendTextMessage(
        recipient,
        `You still have ${checklistItems[0].pending} pending items. Please complete all items before completing the inspection.`
      );
      return;
    }
    
    // Mark checklist instance as completed
    await db.query(
      'UPDATE checklist_instances SET status = "completed", completed_at = NOW() WHERE id = ?',
      [checklistInstanceId]
    );
    
    // Mark work order as completed
    await db.query(
      'UPDATE work_orders SET status = "completed", completed_at = NOW() WHERE id = ?',
      [checklistInstance[0].work_order_id]
    );
    
    await whatsapp.sendTextMessage(
      recipient,
      "✅ Inspection completed successfully!"
    );
    
    // Generate PDF report
    try {
      const pdfBuffer = await generatePDF(checklistInstanceId);
      
      // Store the report
      await db.query(
        `INSERT INTO reports (work_order_id, report_file, generated_at)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE report_file = ?, generated_at = NOW()`,
        [checklistInstance[0].work_order_id, pdfBuffer, pdfBuffer]
      );
      
      // Send notification to admin
      const [admins] = await db.query(
        'SELECT * FROM users WHERE role = "admin"'
      );
      
      if (admins && admins.length > 0) {
        for (const admin of admins) {
          await db.query(
            `INSERT INTO notifications (user_id, notification_type, message, 
                                      related_entity_type, related_entity_id, status)
             VALUES (?, "system", ?, "work_order", ?, "pending")`,
            [
              admin.id,
              `Work order #${checklistInstance[0].work_order_id} has been completed by ${user.first_name} ${user.last_name}.`,
              checklistInstance[0].work_order_id
            ]
          );
        }
      }
      
      // If admin has WhatsApp, notify them
      for (const admin of admins) {
        if (admin.whatsapp_id) {
          await whatsapp.sendTextMessage(
            admin.whatsapp_id,
            `🔔 *Inspection Completed*\n\nWork order #${checklistInstance[0].work_order_id} has been completed by ${user.first_name} ${user.last_name}.\n\nThe report is available in the system.`
          );
        }
      }
      
      await whatsapp.sendTextMessage(
        recipient,
        "📄 Report generated and notifications sent to admin."
      );
    } catch (error) {
      console.error('❌ Failed to generate report:', error);
      await whatsapp.sendTextMessage(
        recipient,
        "Inspection marked as complete, but there was an issue generating the report. An administrator will review it."
      );
    }
    
    // Clear conversation context
    const [conversation] = await db.query(
      'SELECT * FROM conversations WHERE user_id = ? AND active = TRUE LIMIT 1',
      [user.id]
    );
    
    if (conversation && conversation.length > 0) {
      await db.query(
        'UPDATE conversations SET context = "{}", active = FALSE WHERE id = ?',
        [conversation[0].id]
      );
    }
  } catch (error) {
    console.error('❌ Failed to complete inspection:', error);
    await whatsapp.sendTextMessage(
      recipient,
      "Sorry, I couldn't complete the inspection. Please try again later."
    );
  }
}

/**
 * Handle adding media to a checklist item
 * @param {string} recipient - WhatsApp ID to send response to
 * @param {Object} user - User info
 * @param {number} itemId - Checklist instance item ID
 * @param {number} mediaId - ID of the uploaded media
 */
async function handleAddMedia(recipient, user, itemId, mediaId) {
  try {
    // Verify the checklist item exists and belongs to this inspector's active inspection
    const [checklistItem] = await db.query(
      `SELECT cii.*, ci.id AS instance_id, wo.id AS work_order_id
       FROM checklist_instance_items cii
       JOIN checklist_instances ci ON cii.checklist_instance_id = ci.id
       JOIN work_orders wo ON ci.work_order_id = wo.id
       WHERE cii.id = ? AND wo.inspector_id = ? AND ci.status = 'in_progress'`,
      [itemId, user.id]
    );
    
    if (!checklistItem || checklistItem.length === 0) {
      await whatsapp.sendTextMessage(
        recipient,
        `Checklist item #${itemId} is not part of your active inspection.`
      );
      return;
    }
    
    // Update the media record with the checklist item ID
    await db.query(
      'UPDATE media SET checklist_instance_item_id = ? WHERE id = ?',
      [itemId, mediaId]
    );
    
    await whatsapp.sendTextMessage(
      recipient,
      "✅ Media added to the checklist item."
    );
  } catch (error) {
    console.error('❌ Failed to add media:', error);
    await whatsapp.sendTextMessage(
      recipient,
      "Sorry, I couldn't add the media to the checklist item. Please try again later."
    );
  }
}

/**
 * Handle adding a comment to a checklist item
 * @param {string} recipient - WhatsApp ID to send response to
 * @param {Object} user - User info
 * @param {number} itemId - Checklist instance item ID
 * @param {string} comment - Comment text
 */
async function handleAddComment(recipient, user, itemId, comment) {
  try {
    // Verify the checklist item exists and belongs to this inspector's active inspection
    const [checklistItem] = await db.query(
      `SELECT cii.*, ci.id AS instance_id, wo.id AS work_order_id
       FROM checklist_instance_items cii
       JOIN checklist_instances ci ON cii.checklist_instance_id = ci.id
       JOIN work_orders wo ON ci.work_order_id = wo.id
       WHERE cii.id = ? AND wo.inspector_id = ? AND ci.status = 'in_progress'`,
      [itemId, user.id]
    );
    
    if (!checklistItem || checklistItem.length === 0) {
      await whatsapp.sendTextMessage(
        recipient,
        `Checklist item #${itemId} is not part of your active inspection.`
      );
      return;
    }
    
    // Update the comments
    const existingComments = checklistItem[0].comments || '';
    const updatedComments = existingComments ? `${existingComments}\n\n${comment}` : comment;
    
    await db.query(
      'UPDATE checklist_instance_items SET comments = ? WHERE id = ?',
      [updatedComments, itemId]
    );
    
    await whatsapp.sendTextMessage(
      recipient,
      "✅ Comment added to the checklist item."
    );
  } catch (error) {
    console.error('❌ Failed to add comment:', error);
    await whatsapp.sendTextMessage(
      recipient,
      "Sorry, I couldn't add the comment to the checklist item. Please try again later."
    );
  }
}

/**
 * Send help message with available commands
 * @param {string} recipient - WhatsApp ID to send response to
 */
async function sendHelpMessage(recipient) {
  const helpMessage = `
🔍 *Property Stewards Inspector Help*

Here are commands you can use:

*Work Orders*
• "Today's jobs" - List today's scheduled inspections
• "Start inspection #123" - Start/resume inspection for work order #123

*During Inspection*
• "Inspect item #5" - View details for item #5
• "Complete item #5 [status]" - Mark item as completed, skipped, or issue found
• "Add photo to item #5" - Add a photo to item #5 (send with a photo)
• "Add comment to item #5: [your comment]" - Add a comment
• "Complete inspection" - Finalize and submit inspection

*Other Commands*
• "Help" - Show this help message
• "Cancel" - Cancel current operation

Send a message with your question if you need more assistance.
`;

  await whatsapp.sendTextMessage(recipient, helpMessage);
}

module.exports = {
  handleWebhook
};
