/**
 * OpenAI integration for Property Stewards – Inspector Interface System
 * Using GPT-4o-mini for natural language processing
 */

const OpenAI = require('openai');
require('dotenv').config();

// Initialize the OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// System prompt for the property inspection assistant
const SYSTEM_PROMPT = `
You are a property inspection assistant working with inspectors through WhatsApp. 
Help them navigate property inspections, update checklists, and manage their work orders.

As an assistant, you should:
1. Help inspectors view their scheduled inspections
2. Guide them through starting/completing inspections
3. Help them add comments, photos, or videos to checklist items
4. Be helpful, concise, and professional at all times

You should respond with clear instructions and avoid lengthy explanations.
For media requests (images/videos), inform the inspector you're processing them.
`;

// Inspection conversation memory context
let conversationContext = {};

/**
 * Extract intent from inspector message
 * 
 * @param {string} message - Message text from inspector
 * @param {Object} context - Conversation context
 * @returns {Promise<Object>} - Intent object and updated context
 */
async function extractIntent(message, context = {}) {
  try {
    const messages = [
      {
        role: 'system',
        content: `${SYSTEM_PROMPT}
        
You are to analyze messages from property inspectors and extract their intent.
Respond in this exact JSON format:
{
  "intent": "<intent_type>",
  "params": {
    // Parameters based on the intent
  },
  "confidence": 0.0-1.0,
  "nextAction": "<suggested_action>"
}

Intent types:
- "greeting": General greeting or hello
- "view_jobs": Inspector wants to see today's or a specific date's jobs
- "start_inspection": Inspector wants to start a specific inspection
- "complete_inspection": Inspector wants to complete an inspection
- "update_item": Inspector wants to update a checklist item
- "add_media": Inspector wants to add photo/video to a checklist item
- "add_comment": Inspector wants to add a comment to a checklist item
- "get_help": Inspector needs help or instructions
- "cancel": Cancel the current operation
- "unknown": Could not determine intent

Always consider the conversation context when determining intent.
`
      }
    ];

    // Add conversation context if available
    if (context.currentWorkOrder) {
      messages[0].content += `\nCurrent context: The inspector is working on work order #${context.currentWorkOrder}`;
    }
    
    if (context.currentChecklistItem) {
      messages[0].content += `\nThe inspector is updating checklist item #${context.currentChecklistItem}`;
    }

    // Add user message
    messages.push({
      role: 'user',
      content: message
    });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const responseContent = response.choices[0].message.content;
    try {
      const intentData = JSON.parse(responseContent);
      return { intentData, context };
    } catch (parseError) {
      console.error('Error parsing JSON from OpenAI:', parseError);
      return {
        intentData: {
          intent: 'unknown',
          confidence: 0,
          nextAction: 'ask_clarification'
        },
        context
      };
    }
  } catch (error) {
    console.error('Error calling OpenAI:', error);
    return {
      intentData: {
        intent: 'unknown',
        confidence: 0,
        nextAction: 'ask_clarification'
      },
      context
    };
  }
}

/**
 * Generate response to inspector based on intent and data
 * 
 * @param {Object} intentData - Intent data from extractIntent
 * @param {Object} data - Data to inform the response
 * @param {Object} context - Conversation context
 * @returns {Promise<Object>} - Response object with message and updated context
 */
async function generateResponse(intentData, data, context = {}) {
  try {
    const messages = [
      {
        role: 'system',
        content: `${SYSTEM_PROMPT}
        
You are to generate a helpful, concise response to a property inspector based on their intent and the data provided.
Keep responses short and conversational as this is for WhatsApp.
`
      }
    ];

    // Prepare the context information
    let contextInfo = '';
    
    if (context.currentWorkOrder) {
      contextInfo += `\nCurrent work order: #${context.currentWorkOrder}`;
    }
    
    if (context.currentChecklistItem) {
      contextInfo += `\nCurrent checklist item: #${context.currentChecklistItem}`;
    }
    
    // Add the data and intent information for the AI
    messages.push({
      role: 'user',
      content: `
Intent: ${intentData.intent}
${contextInfo}

Data: ${JSON.stringify(data, null, 2)}

Generate a helpful WhatsApp response based on this intent and data. Keep it brief and conversational.
`
    });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.7,
    });

    return {
      message: response.choices[0].message.content,
      context: context
    };
  } catch (error) {
    console.error('Error generating response:', error);
    return {
      message: "I'm sorry, I'm having trouble processing your request right now. Please try again shortly.",
      context: context
    };
  }
}

/**
 * Process a media message (image/video) with caption
 * 
 * @param {string} caption - Media caption text
 * @param {string} mediaType - Type of media ('image', 'video')
 * @param {Object} context - Conversation context
 * @returns {Promise<Object>} - Intent object for media processing
 */
async function processMediaMessage(caption, mediaType, context = {}) {
  try {
    const messages = [
      {
        role: 'system',
        content: `
You are to analyze a media caption from a property inspector and determine what they want to do with this ${mediaType}.
Respond in this exact JSON format:
{
  "intent": "<intent_type>",
  "params": {
    // Parameters based on the intent
  },
  "confidence": 0.0-1.0,
  "nextAction": "<suggested_action>"
}

Intent types:
- "add_media": Inspector wants to add this ${mediaType} to a checklist item
- "unknown": Could not determine intent

Consider the context of their current work order and checklist item if available.
`
      }
    ];

    // Add conversation context if available
    if (context.currentWorkOrder) {
      messages[0].content += `\nCurrent context: The inspector is working on work order #${context.currentWorkOrder}`;
    }
    
    if (context.currentChecklistItem) {
      messages[0].content += `\nThe inspector is updating checklist item #${context.currentChecklistItem}`;
    }

    // Add caption as user message
    messages.push({
      role: 'user',
      content: caption || `[${mediaType} with no caption]`
    });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const responseContent = response.choices[0].message.content;
    try {
      const intentData = JSON.parse(responseContent);
      
      // If we have context about the current checklist item, add it to params
      if (context.currentChecklistItem && intentData.intent === 'add_media') {
        intentData.params = intentData.params || {};
        intentData.params.checklistItemId = context.currentChecklistItem;
      }
      
      return { intentData, context };
    } catch (parseError) {
      console.error('Error parsing JSON from OpenAI:', parseError);
      return {
        intentData: {
          intent: 'add_media',
          params: {
            checklistItemId: context.currentChecklistItem
          },
          confidence: 0.5,
          nextAction: 'process_media'
        },
        context
      };
    }
  } catch (error) {
    console.error('Error calling OpenAI for media processing:', error);
    return {
      intentData: {
        intent: 'unknown',
        confidence: 0,
        nextAction: 'ask_clarification'
      },
      context
    };
  }
}

/**
 * Extract checklist item number from message
 * 
 * @param {string} message - Message text
 * @returns {Promise<number|null>} - Extracted item number or null
 */
async function extractChecklistItemNumber(message) {
  try {
    const messages = [
      {
        role: 'system',
        content: `
You are to extract a checklist item number from the inspector's message.
The inspector is referring to a specific checklist item, and you need to identify the number.
Respond with ONLY the number, nothing else. If no number is found, respond with "null".
`
      },
      {
        role: 'user',
        content: message
      }
    ];

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.1,
    });

    const responseContent = response.choices[0].message.content.trim();
    
    if (responseContent === 'null') {
      return null;
    }
    
    const number = parseInt(responseContent, 10);
    return isNaN(number) ? null : number;
  } catch (error) {
    console.error('Error extracting checklist item number:', error);
    return null;
  }
}

module.exports = {
  extractIntent,
  generateResponse,
  processMediaMessage,
  extractChecklistItemNumber
};
