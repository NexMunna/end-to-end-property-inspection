/**
 * Database connection and query utilities
 * For Property Stewards – Inspector Interface System
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

// Create connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

/**
 * Execute a SQL query with parameters
 * 
 * @param {string} sql - SQL query to execute
 * @param {Array} params - Parameters for the query
 * @returns {Promise<Array>} - Query results
 */
async function query(sql, params = []) {
  try {
    const [results] = await pool.execute(sql, params);
    return results;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

/**
 * Get a single row from a query
 * 
 * @param {string} sql - SQL query to execute
 * @param {Array} params - Parameters for the query
 * @returns {Promise<Object|null>} - First row or null
 */
async function getOne(sql, params = []) {
  const results = await query(sql, params);
  return results.length > 0 ? results[0] : null;
}

/**
 * Insert a record and return the inserted ID
 * 
 * @param {string} table - Table name
 * @param {Object} data - Object with column:value pairs
 * @returns {Promise<number>} - Inserted ID
 */
async function insert(table, data) {
  const keys = Object.keys(data);
  const values = Object.values(data);
  
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  
  const result = await query(sql, values);
  return result.insertId;
}

/**
 * Update a record
 * 
 * @param {string} table - Table name
 * @param {Object} data - Object with column:value pairs to update
 * @param {Object} where - Object with column:value pairs for WHERE clause
 * @returns {Promise<Object>} - Result object with affectedRows
 */
async function update(table, data, where) {
  const setClause = Object.keys(data).map(key => `${key} = ?`).join(', ');
  const whereClause = Object.keys(where).map(key => `${key} = ?`).join(' AND ');
  
  const sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;
  const params = [...Object.values(data), ...Object.values(where)];
  
  return await query(sql, params);
}

/**
 * Store media content in the database
 * 
 * @param {number} itemId - Checklist instance item ID
 * @param {string} mediaType - Type of media ('image', 'video', 'audio')
 * @param {string} fileName - Name of the file
 * @param {string} contentType - MIME type
 * @param {Buffer} content - Binary content as Buffer
 * @returns {Promise<number>} - Inserted media ID
 */
async function storeMedia(itemId, mediaType, fileName, contentType, content) {
  const sql = `
    INSERT INTO media (
      checklist_instance_item_id, 
      media_type, 
      file_name, 
      content_type, 
      content
    ) VALUES (?, ?, ?, ?, ?)
  `;
  
  const result = await query(sql, [itemId, mediaType, fileName, contentType, content]);
  return result.insertId;
}

/**
 * Get media content by ID
 * 
 * @param {number} mediaId - Media ID
 * @returns {Promise<Object|null>} - Media object or null
 */
async function getMediaById(mediaId) {
  const sql = `
    SELECT id, checklist_instance_item_id, media_type, file_name, content_type, content 
    FROM media 
    WHERE id = ?
  `;
  
  return await getOne(sql, [mediaId]);
}

/**
 * Get all media for a checklist instance item
 * 
 * @param {number} itemId - Checklist instance item ID
 * @returns {Promise<Array>} - Array of media objects (without content)
 */
async function getMediaForChecklistItem(itemId) {
  const sql = `
    SELECT id, media_type, file_name, content_type, created_at 
    FROM media 
    WHERE checklist_instance_item_id = ?
    ORDER BY created_at ASC
  `;
  
  return await query(sql, [itemId]);
}

/**
 * Get inspector's work orders for a specific date
 * 
 * @param {number} inspectorId - Inspector user ID
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Promise<Array>} - Work orders
 */
async function getInspectorWorkOrders(inspectorId, date) {
  const sql = `
    SELECT 
      wo.id, 
      wo.scheduled_date, 
      wo.scheduled_time_window, 
      wo.status,
      p.address, 
      p.city, 
      p.state, 
      p.postal_code,
      p.property_type,
      ct.name AS checklist_template_name,
      u.name AS customer_name,
      u.phone AS customer_phone
    FROM work_orders wo
    JOIN contracts c ON wo.contract_id = c.id
    JOIN properties p ON c.property_id = p.id
    JOIN users u ON c.customer_id = u.id
    JOIN checklist_templates ct ON wo.checklist_template_id = ct.id
    WHERE wo.inspector_id = ?
      AND wo.scheduled_date = ?
    ORDER BY 
      CASE 
        WHEN wo.status = 'in_progress' THEN 0
        WHEN wo.status = 'scheduled' THEN 1
        WHEN wo.status = 'completed' THEN 2
        ELSE 3
      END,
      wo.scheduled_time_window ASC
  `;
  
  return await query(sql, [inspectorId, date]);
}

/**
 * Get checklist for a work order with all items
 * 
 * @param {number} workOrderId - Work order ID
 * @returns {Promise<Object>} - Checklist with items
 */
async function getWorkOrderChecklist(workOrderId) {
  // Get checklist instance or create if doesn't exist
  let checklistInstance = await getOne(`
    SELECT * FROM checklist_instances 
    WHERE work_order_id = ?
  `, [workOrderId]);
  
  if (!checklistInstance) {
    // Create a new checklist instance
    const insertId = await insert('checklist_instances', {
      work_order_id: workOrderId,
      status: 'not_started'
    });
    
    checklistInstance = await getOne(`
      SELECT * FROM checklist_instances 
      WHERE id = ?
    `, [insertId]);
    
    // Get checklist template ID from work order
    const workOrder = await getOne(`
      SELECT checklist_template_id 
      FROM work_orders 
      WHERE id = ?
    `, [workOrderId]);
    
    // Get template items
    const templateItems = await query(`
      SELECT * FROM checklist_template_items
      WHERE template_id = ?
      ORDER BY item_order
    `, [workOrder.checklist_template_id]);
    
    // Create instance items
    for (const item of templateItems) {
      await insert('checklist_instance_items', {
        checklist_instance_id: checklistInstance.id,
        template_item_id: item.id,
        status: 'pending'
      });
    }
  }
  
  // Get all checklist items with their template info
  const checklistItems = await query(`
    SELECT 
      cii.id,
      cii.status,
      cii.comments,
      cii.completed_at,
      cti.name,
      cti.description,
      cti.requires_media,
      cti.requires_comment,
      cti.item_order
    FROM checklist_instance_items cii
    JOIN checklist_template_items cti ON cii.template_item_id = cti.id
    WHERE cii.checklist_instance_id = ?
    ORDER BY cti.item_order
  `, [checklistInstance.id]);
  
  // Count media items for each checklist item
  for (const item of checklistItems) {
    const mediaCount = await getOne(`
      SELECT COUNT(*) as count
      FROM media
      WHERE checklist_instance_item_id = ?
    `, [item.id]);
    
    item.media_count = mediaCount.count;
  }
  
  return {
    instance: checklistInstance,
    items: checklistItems
  };
}

/**
 * Start a work order inspection
 * 
 * @param {number} workOrderId - Work order ID
 * @returns {Promise<Object>} - Updated work order and checklist
 */
async function startInspection(workOrderId) {
  // Update work order status
  await update('work_orders', {
    status: 'in_progress'
  }, {
    id: workOrderId
  });
  
  // Update or create checklist instance
  const checklistInstance = await getOne(`
    SELECT * FROM checklist_instances
    WHERE work_order_id = ?
  `, [workOrderId]);
  
  if (checklistInstance) {
    await update('checklist_instances', {
      started_at: new Date(),
      status: 'in_progress'
    }, {
      id: checklistInstance.id
    });
  } else {
    await insert('checklist_instances', {
      work_order_id: workOrderId,
      started_at: new Date(),
      status: 'in_progress'
    });
  }
  
  return await getWorkOrderChecklist(workOrderId);
}

/**
 * Complete a checklist item
 * 
 * @param {number} itemId - Checklist instance item ID
 * @param {string} status - Status of the item
 * @param {string} comments - Comments for the item
 * @returns {Promise<Object>} - Updated checklist item
 */
async function updateChecklistItem(itemId, status, comments) {
  await update('checklist_instance_items', {
    status,
    comments,
    completed_at: status === 'completed' || status === 'issue_found' ? new Date() : null
  }, {
    id: itemId
  });
  
  return await getOne(`
    SELECT 
      cii.id,
      cii.status,
      cii.comments,
      cii.completed_at,
      cti.name,
      cti.description,
      cti.requires_media,
      cti.requires_comment,
      cti.item_order
    FROM checklist_instance_items cii
    JOIN checklist_template_items cti ON cii.template_item_id = cti.id
    WHERE cii.id = ?
  `, [itemId]);
}

/**
 * Complete a work order inspection
 * 
 * @param {number} workOrderId - Work order ID
 * @returns {Promise<Object>} - Work order with checklist
 */
async function completeInspection(workOrderId) {
  // Check if all checklist items are completed or skipped
  const checklist = await getWorkOrderChecklist(workOrderId);
  
  const incompleteItems = checklist.items.filter(
    item => item.status === 'pending'
  );
  
  if (incompleteItems.length > 0) {
    throw new Error(`Cannot complete inspection. ${incompleteItems.length} items are still pending.`);
  }
  
  // Update checklist instance
  await update('checklist_instances', {
    completed_at: new Date(),
    status: 'completed'
  }, {
    id: checklist.instance.id
  });
  
  // Update work order
  await update('work_orders', {
    status: 'completed'
  }, {
    id: workOrderId
  });
  
  // Create empty report record
  await insert('reports', {
    work_order_id: workOrderId
  });
  
  return await getWorkOrderDetails(workOrderId);
}

/**
 * Get detailed work order information
 * 
 * @param {number} workOrderId - Work order ID
 * @returns {Promise<Object>} - Work order details
 */
async function getWorkOrderDetails(workOrderId) {
  const workOrder = await getOne(`
    SELECT 
      wo.*,
      c.customer_id,
      p.address,
      p.city,
      p.state,
      p.postal_code,
      p.property_type,
      u_customer.name AS customer_name,
      u_customer.phone AS customer_phone,
      u_customer.email AS customer_email,
      u_inspector.name AS inspector_name,
      u_inspector.phone AS inspector_phone,
      u_inspector.email AS inspector_email,
      ct.name AS checklist_name
    FROM work_orders wo
    JOIN contracts c ON wo.contract_id = c.id
    JOIN properties p ON c.property_id = p.id
    JOIN users u_customer ON c.customer_id = u_customer.id
    JOIN users u_inspector ON wo.inspector_id = u_inspector.id
    JOIN checklist_templates ct ON wo.checklist_template_id = ct.id
    WHERE wo.id = ?
  `, [workOrderId]);
  
  if (!workOrder) {
    return null;
  }
  
  const checklist = await getWorkOrderChecklist(workOrderId);
  
  return {
    workOrder,
    checklist
  };
}

/**
 * Find an inspector by WhatsApp ID
 * 
 * @param {string} whatsappId - WhatsApp ID
 * @returns {Promise<Object|null>} - Inspector user or null
 */
async function findInspectorByWhatsAppId(whatsappId) {
  return await getOne(`
    SELECT * FROM users
    WHERE whatsapp_id = ? AND role = 'inspector'
  `, [whatsappId]);
}

/**
 * Get or create a conversation for a user
 * 
 * @param {number} userId - User ID
 * @returns {Promise<Object>} - Conversation
 */
async function getOrCreateConversation(userId) {
  let conversation = await getOne(`
    SELECT * FROM conversations
    WHERE user_id = ? AND active = true
  `, [userId]);
  
  if (!conversation) {
    const insertId = await insert('conversations', {
      user_id: userId,
      active: true,
      context: JSON.stringify({})
    });
    
    conversation = await getOne(`
      SELECT * FROM conversations
      WHERE id = ?
    `, [insertId]);
  }
  
  return conversation;
}

/**
 * Store a message in the database
 * 
 * @param {Object} messageData - Message data
 * @returns {Promise<number>} - Inserted message ID
 */
async function storeMessage(messageData) {
  return await insert('messages', messageData);
}

/**
 * Update conversation context
 * 
 * @param {number} conversationId - Conversation ID
 * @param {Object} context - Context object
 * @returns {Promise<Object>} - Updated conversation
 */
async function updateConversationContext(conversationId, context) {
  await update('conversations', {
    context: JSON.stringify(context),
    last_message_at: new Date()
  }, {
    id: conversationId
  });
  
  return await getOne(`
    SELECT * FROM conversations
    WHERE id = ?
  `, [conversationId]);
}

/**
 * Create a notification
 * 
 * @param {number} userId - User ID
 * @param {string} type - Notification type
 * @param {string} message - Notification message
 * @param {string} entityType - Related entity type
 * @param {number} entityId - Related entity ID
 * @returns {Promise<number>} - Inserted notification ID
 */
async function createNotification(userId, type, message, entityType, entityId) {
  return await insert('notifications', {
    user_id: userId,
    notification_type: type,
    message,
    related_entity_type: entityType,
    related_entity_id: entityId,
    status: 'pending'
  });
}

/**
 * Get pending notifications
 * 
 * @param {number} limit - Maximum number of notifications to retrieve
 * @returns {Promise<Array>} - Pending notifications
 */
async function getPendingNotifications(limit = 10) {
  return await query(`
    SELECT n.*, u.email, u.phone, u.whatsapp_id
    FROM notifications n
    JOIN users u ON n.user_id = u.id
    WHERE n.status = 'pending'
    ORDER BY n.created_at ASC
    LIMIT ?
  `, [limit]);
}

/**
 * Update notification status
 * 
 * @param {number} notificationId - Notification ID
 * @param {string} status - New status
 * @returns {Promise<Object>} - Update result
 */
async function updateNotificationStatus(notificationId, status) {
  return await update('notifications', {
    status,
    sent_at: status === 'sent' ? new Date() : null
  }, {
    id: notificationId
  });
}

/**
 * Store a report PDF
 * 
 * @param {number} workOrderId - Work order ID
 * @param {Buffer} pdfBuffer - PDF file as buffer
 * @returns {Promise<Object>} - Update result
 */
async function storeReportPdf(workOrderId, pdfBuffer) {
  return await update('reports', {
    report_file: pdfBuffer,
    generated_at: new Date()
  }, {
    work_order_id: workOrderId
  });
}

/**
 * Get report by work order ID
 * 
 * @param {number} workOrderId - Work order ID
 * @returns {Promise<Object|null>} - Report or null
 */
async function getReportByWorkOrderId(workOrderId) {
  return await getOne(`
    SELECT * FROM reports
    WHERE work_order_id = ?
  `, [workOrderId]);
}

module.exports = {
  query,
  getOne,
  insert,
  update,
  storeMedia,
  getMediaById,
  getMediaForChecklistItem,
  getInspectorWorkOrders,
  getWorkOrderChecklist,
  startInspection,
  updateChecklistItem,
  completeInspection,
  getWorkOrderDetails,
  findInspectorByWhatsAppId,
  getOrCreateConversation,
  storeMessage,
  updateConversationContext,
  createNotification,
  getPendingNotifications,
  updateNotificationStatus,
  storeReportPdf,
  getReportByWorkOrderId
};
