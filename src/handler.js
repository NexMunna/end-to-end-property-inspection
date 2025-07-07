/**
 * Property Stewards – Inspector Interface System
 * DigitalOcean Function Handler
 */

// Import required modules
const db = require('./db');
const openai = require('./openai');
const wassenger = require('./wassenger');
const pdfGenerator = require('./utils/pdf');
const { format } = require('date-fns');
require('dotenv').config();

/**
 * Process WhatsApp text message
 * 
 * @param {Object} message - Parsed message data
 * @returns {Promise<Object>} - Response to send
 */
async function processTextMessage(message) {
  // Find inspector by WhatsApp ID
  const inspector = await db.findInspectorByWhatsAppId(message.sender);
  
  if (!inspector) {
    return {
      text: "Sorry, your number is not registered as an inspector in our system. Please contact your administrator."
    };
  }
  
  // Get or create conversation
  const conversation = await db.getOrCreateConversation(inspector.id);
  
  // Parse context from conversation
  let context = {};
  try {
    context = JSON.parse(conversation.context);
  } catch (error) {
    console.warn('Could not parse conversation context, starting fresh');
    context = {};
  }
  
  // Extract intent using OpenAI
  const { intentData, context: updatedContext } = await openai.extractIntent(
    message.content,
    context
  );
  
  // Store message in database
  await db.storeMessage({
    conversation_id: conversation.id,
    sender_id: inspector.id,
    message_type: 'text',
    content: message.content,
    whatsapp_message_id: message.messageId
  });
  
  // Process intent
  let responseData = {};
  
  switch (intentData.intent) {
    case 'greeting':
      responseData = {
        text: `Hello ${inspector.name}! How can I assist you with your property inspections today?`
      };
      break;
    
    case 'view_jobs':
      // Get today's date or specified date
      const today = format(new Date(), 'yyyy-MM-dd');
      const targetDate = intentData.params?.date || today;
      
      const workOrders = await db.getInspectorWorkOrders(inspector.id, targetDate);
      
      if (workOrders.length === 0) {
        responseData = {
          text: `You have no scheduled inspections for ${targetDate}.`
        };
      } else {
        // Format work orders for display
        const formattedDate = format(new Date(targetDate), 'MMMM d, yyyy');
        let message = `You have ${workOrders.length} inspection(s) scheduled for ${formattedDate}:\n\n`;
        
        workOrders.forEach((wo, index) => {
          message += `${index + 1}. *Work Order #${wo.id}*\n`;
          message += `📍 ${wo.address}, ${wo.city}, ${wo.state}\n`;
          message += `🕒 ${wo.scheduled_time_window}\n`;
          message += `📋 ${wo.checklist_template_name}\n`;
          message += `📱 Customer: ${wo.customer_name} (${wo.customer_phone})\n`;
          message += `Status: ${wo.status.toUpperCase().replace('_', ' ')}\n\n`;
        });
        
        message += "To start an inspection, reply with: 'Start inspection #[number]'";
        
        responseData = { text: message };
      }
      break;
    
    case 'start_inspection':
      const workOrderId = intentData.params?.workOrderId;
      
      if (!workOrderId) {
        responseData = {
          text: "Please specify which inspection you'd like to start by providing the work order number."
        };
        break;
      }
      
      try {
        // Get work order details to ensure it belongs to this inspector
        const workOrderDetails = await db.getWorkOrderDetails(workOrderId);
        
        if (!workOrderDetails || workOrderDetails.workOrder.inspector_id !== inspector.id) {
          responseData = {
            text: `Work order #${workOrderId} is not assigned to you or doesn't exist.`
          };
          break;
        }
        
        if (workOrderDetails.workOrder.status === 'completed') {
          responseData = {
            text: `Work order #${workOrderId} has already been completed.`
          };
          break;
        }
        
        // Start the inspection
        const checklist = await db.startInspection(workOrderId);
        
        // Update conversation context
        updatedContext.currentWorkOrder = workOrderId;
        updatedContext.currentChecklistItem = null;
        
        // Format checklist for display
        let message = `✅ *Inspection #${workOrderId} started!*\n\n`;
        message += `📍 ${workOrderDetails.workOrder.address}, ${workOrderDetails.workOrder.city}\n\n`;
        message += `Here's your checklist:\n\n`;
        
        checklist.items.forEach((item, index) => {
          message += `${index + 1}. ${item.name}\n`;
        });
        
        message += "\nTo update an item, send: 'Update item #[number]'";
        
        responseData = { text: message };
      } catch (error) {
        console.error('Error starting inspection:', error);
        responseData = {
          text: `Sorry, there was an error starting inspection #${workOrderId}. Please try again.`
        };
      }
      break;
    
    case 'update_item':
      const itemNumber = intentData.params?.itemNumber;
      
      if (!updatedContext.currentWorkOrder) {
        responseData = {
          text: "You need to start an inspection first before updating checklist items."
        };
        break;
      }
      
      if (!itemNumber) {
        responseData = {
          text: "Please specify which checklist item you'd like to update by providing the item number."
        };
        break;
      }
      
      try {
        // Get the checklist
        const checklist = await db.getWorkOrderChecklist(updatedContext.currentWorkOrder);
        
        // Validate item number
        if (itemNumber < 1 || itemNumber > checklist.items.length) {
          responseData = {
            text: `Invalid item number. Please choose a number between 1 and ${checklist.items.length}.`
          };
          break;
        }
        
        const selectedItem = checklist.items[itemNumber - 1];
        
        // Update conversation context
        updatedContext.currentChecklistItem = selectedItem.id;
        
        // Format item details for display
        let message = `*Item #${itemNumber}: ${selectedItem.name}*\n\n`;
        message += `${selectedItem.description || 'No description provided'}\n\n`;
        message += `Current status: ${selectedItem.status.toUpperCase().replace('_', ' ')}\n`;
        
        if (selectedItem.comments) {
          message += `Comments: ${selectedItem.comments}\n`;
        }
        
        if (selectedItem.media_count > 0) {
          message += `Media items: ${selectedItem.media_count}\n`;
        }
        
        message += "\nTo add a comment, reply with: 'Comment: [your comment]'\n";
        message += "To mark as completed, reply with: 'Complete'\n";
        message += "To mark as having issues, reply with: 'Issue: [describe the issue]'\n";
        message += "To attach photos/videos, simply send the media with a caption.\n";
        
        responseData = { text: message };
      } catch (error) {
        console.error('Error updating item:', error);
        responseData = {
          text: "Sorry, there was an error retrieving the checklist item. Please try again."
        };
      }
      break;
    
    case 'add_comment':
      if (!updatedContext.currentWorkOrder || !updatedContext.currentChecklistItem) {
        responseData = {
          text: "Please select a checklist item first before adding a comment."
        };
        break;
      }
      
      try {
        const comment = intentData.params?.comment || '';
        
        if (!comment) {
          responseData = {
            text: "Please provide a comment to add to this item."
          };
          break;
        }
        
        // Get current item
        const checklistItem = await db.getOne(`
          SELECT * FROM checklist_instance_items WHERE id = ?
        `, [updatedContext.currentChecklistItem]);
        
        // Update the item with the comment
        await db.updateChecklistItem(
          updatedContext.currentChecklistItem,
          checklistItem.status, // keep existing status
          comment
        );
        
        responseData = {
          text: "✅ Comment added successfully!"
        };
      } catch (error) {
        console.error('Error adding comment:', error);
        responseData = {
          text: "Sorry, there was an error adding your comment. Please try again."
        };
      }
      break;
    
    case 'complete_item':
      if (!updatedContext.currentWorkOrder || !updatedContext.currentChecklistItem) {
        responseData = {
          text: "Please select a checklist item first."
        };
        break;
      }
      
      try {
        // Update the item status
        await db.updateChecklistItem(
          updatedContext.currentChecklistItem,
          'completed',
          null // keep existing comments
        );
        
        // Get the checklist to see if all items are complete
        const checklist = await db.getWorkOrderChecklist(updatedContext.currentWorkOrder);
        const pendingItems = checklist.items.filter(item => item.status === 'pending');
        
        if (pendingItems.length === 0) {
          responseData = {
            text: "✅ Item marked as completed! All checklist items are now complete. You can complete the inspection by sending 'Complete inspection'."
          };
        } else {
          responseData = {
            text: `✅ Item marked as completed! ${pendingItems.length} item(s) remaining.`
          };
        }
      } catch (error) {
        console.error('Error completing item:', error);
        responseData = {
          text: "Sorry, there was an error completing this item. Please try again."
        };
      }
      break;
    
    case 'issue_found':
      if (!updatedContext.currentWorkOrder || !updatedContext.currentChecklistItem) {
        responseData = {
          text: "Please select a checklist item first."
        };
        break;
      }
      
      try {
        const issue = intentData.params?.issue || '';
        
        // Update the item status and add issue as comment
        await db.updateChecklistItem(
          updatedContext.currentChecklistItem,
          'issue_found',
          issue
        );
        
        responseData = {
          text: "⚠️ Item marked as having issues. Please add photos to document the issues."
        };
      } catch (error) {
        console.error('Error marking issue:', error);
        responseData = {
          text: "Sorry, there was an error recording the issue. Please try again."
        };
      }
      break;
    
    case 'complete_inspection':
      if (!updatedContext.currentWorkOrder) {
        responseData = {
          text: "You need to start an inspection first before completing it."
        };
        break;
      }
      
      try {
        // Get the checklist to see if all items are addressed
        const checklist = await db.getWorkOrderChecklist(updatedContext.currentWorkOrder);
        const pendingItems = checklist.items.filter(item => item.status === 'pending');
        
        if (pendingItems.length > 0) {
          let message = `⚠️ You still have ${pendingItems.length} incomplete item(s). Please complete these items first:\n\n`;
          
          pendingItems.forEach((item, index) => {
            message += `${index + 1}. ${item.name}\n`;
          });
          
          responseData = { text: message };
          break;
        }
        
        // Complete the inspection
        await db.completeInspection(updatedContext.currentWorkOrder);
        
        // Generate PDF report
        await pdfGenerator.generateAndStoreReport(updatedContext.currentWorkOrder);
        
        // Reset context
        updatedContext.currentWorkOrder = null;
        updatedContext.currentChecklistItem = null;
        
        responseData = {
          text: "🎉 Inspection completed successfully! The report has been generated and notifications have been sent to the customer and admin."
        };
      } catch (error) {
        console.error('Error completing inspection:', error);
        responseData = {
          text: `Sorry, there was an error completing the inspection: ${error.message}`
        };
      }
      break;
    
    case 'cancel':
      // Reset context
      updatedContext.currentWorkOrder = null;
      updatedContext.currentChecklistItem = null;
      
      responseData = {
        text: "Operation cancelled. How else can I help you with your inspections today?"
      };
      break;
    
    case 'get_help':
      responseData = {
        text: `*Property Stewards - Inspector Help*

Here are commands you can use:
- "Show my jobs today" - View today's inspections
- "Show jobs for [date]" - View inspections for a specific date
- "Start inspection #[number]" - Begin an inspection
- "Update item #[number]" - Select a checklist item to update
- "Comment: [text]" - Add a comment to the current item
- "Complete" - Mark current item as completed
- "Issue: [text]" - Mark item as having issues
- "Complete inspection" - Finish the current inspection
- "Cancel" - Cancel the current operation
- "Help" - Show this help message

To add photos or videos, simply send them with a caption.`
      };
      break;
    
    default:
      // Generate a more contextual response using OpenAI
      const { message } = await openai.generateResponse(
        intentData,
        { inspectorName: inspector.name },
        updatedContext
      );
      
      responseData = { text: message };
  }
  
  // Update conversation context in database
  await db.updateConversationContext(conversation.id, updatedContext);
  
  return responseData;
}

/**
 * Process WhatsApp media message (image/video)
 * 
 * @param {Object} message - Parsed message data
 * @returns {Promise<Object>} - Response to send
 */
async function processMediaMessage(message) {
  // Find inspector by WhatsApp ID
  const inspector = await db.findInspectorByWhatsAppId(message.sender);
  
  if (!inspector) {
    return {
      text: "Sorry, your number is not registered as an inspector in our system. Please contact your administrator."
    };
  }
  
  // Get conversation
  const conversation = await db.getOrCreateConversation(inspector.id);
  
  // Parse context from conversation
  let context = {};
  try {
    context = JSON.parse(conversation.context);
  } catch (error) {
    console.warn('Could not parse conversation context, starting fresh');
    context = {};
  }
  
  // Store message in database
  await db.storeMessage({
    conversation_id: conversation.id,
    sender_id: inspector.id,
    message_type: message.type,
    content: message.caption,
    whatsapp_message_id: message.messageId
  });
  
  // If we don't have an active checklist item, ask the user to select one
  if (!context.currentWorkOrder || !context.currentChecklistItem) {
    return {
      text: "Please select a checklist item first before sending media. Use 'Update item #[number]' to select an item."
    };
  }
  
  try {
    // Process the caption to determine intent
    const { intentData, context: updatedContext } = await openai.processMediaMessage(
      message.caption,
      message.type,
      context
    );
    
    // Download the media
    const mediaBuffer = await wassenger.downloadMedia(message.mediaUrl);
    
    // Store the media in the database
    const mediaId = await db.storeMedia(
      context.currentChecklistItem,
      message.type,
      message.filename,
      message.mimeType,
      mediaBuffer
    );
    
    // Update the message with the media ID
    await db.update('messages', { media_id: mediaId }, {
      whatsapp_message_id: message.messageId
    });
    
    // Get media count for the item
    const mediaCount = await db.getOne(`
      SELECT COUNT(*) as count
      FROM media
      WHERE checklist_instance_item_id = ?
    `, [context.currentChecklistItem]);
    
    return {
      text: `✅ ${message.type} uploaded successfully! You now have ${mediaCount.count} media item(s) for this checklist item.`
    };
  } catch (error) {
    console.error('Error processing media:', error);
    return {
      text: `Sorry, there was an error processing your ${message.type}. Please try again.`
    };
  }
}

/**
 * Main handler for DigitalOcean Function
 * 
 * @param {Object} args - Request arguments
 * @returns {Object} - Response object
 */
async function main(args) {
  try {
    console.log('Received webhook:', JSON.stringify(args));
    
    // Parse webhook data
    const message = wassenger.parseWebhookData(args);
    
    if (!message) {
      return {
        statusCode: 200,
        body: { message: 'Not a valid or incoming message event' }
      };
    }
    
    console.log('Parsed message:', JSON.stringify(message));
    
    // Process message based on type
    let response;
    if (message.type === 'chat') {
      response = await processTextMessage(message);
    } else if (['image', 'video', 'audio'].includes(message.type)) {
      response = await processMediaMessage(message);
    } else {
      response = {
        text: `Sorry, I don't support ${message.type} messages yet. Please send text, images, or videos.`
      };
    }
    
    // Send response via WhatsApp
    if (response.text) {
      await wassenger.sendTextMessage(message.sender, response.text);
    }
    
    return {
      statusCode: 200,
      body: { success: true }
    };
  } catch (error) {
    console.error('Error processing webhook:', error);
    
    return {
      statusCode: 500,
      body: { error: 'Internal server error' }
    };
  }
}

module.exports = {
  main
};
