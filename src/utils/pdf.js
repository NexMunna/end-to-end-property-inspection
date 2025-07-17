/**
 * PDF Report Generator
 * For Property Stewards – Inspector Interface System
 */

const PDFDocument = require('pdfkit');
const db = require('../db');

/**
 * Generate a PDF report for a completed inspection
 * 
 * @param {number} workOrderId - Work order ID
 * @returns {Promise<Buffer>} - PDF report as buffer
 */
async function generateInspectionReport(workOrderId) {
  // Get work order details with checklist
  const details = await db.getWorkOrderDetails(workOrderId);
  
  if (!details || details.workOrder.status !== 'completed') {
    throw new Error('Cannot generate report: Work order not found or not completed');
  }
  
  // Create a PDF document
  const doc = new PDFDocument({
    margins: {
      top: 50,
      bottom: 50,
      left: 50,
      right: 50
    },
    info: {
      Title: `Property Inspection Report #${workOrderId}`,
      Author: 'Property Stewards',
      Subject: 'Property Inspection Report',
      Keywords: 'inspection, property, report',
      CreationDate: new Date()
    }
  });
  
  // Buffer to store PDF data
  const buffers = [];
  doc.on('data', buffers.push.bind(buffers));
  
  // Add header with logo (placeholder for actual logo)
  doc.fontSize(24)
     .font('Helvetica-Bold')
     .text('Property Stewards', { align: 'center' });
     
  doc.fontSize(16)
     .font('Helvetica')
     .text('Property Inspection Report', { align: 'center' });
     
  doc.moveDown();
  
  // Add inspection information
  const { workOrder } = details;
  const property = {
    address: workOrder.address,
    city: workOrder.city,
    state: workOrder.state,
    postalCode: workOrder.postal_code
  };
  
  // Format date
  const inspectionDate = new Date(workOrder.scheduled_date);
  const dateOptions = { year: 'numeric', month: 'long', day: 'numeric' };
  const formattedDate = inspectionDate.toLocaleDateString('en-US', dateOptions);
  
  // Add inspection details
  doc.fontSize(12)
     .font('Helvetica-Bold')
     .text('Inspection Details', { underline: true });
     
  doc.font('Helvetica')
     .text(`Inspection ID: #${workOrder.id}`)
     .text(`Date: ${formattedDate}`)
     .text(`Inspector: ${workOrder.inspector_name}`)
     .text(`Property Type: ${workOrder.property_type}`);
     
  doc.moveDown();
  
  // Add property information
  doc.font('Helvetica-Bold')
     .text('Property Information', { underline: true });
     
  doc.font('Helvetica')
     .text(`Address: ${property.address}`)
     .text(`City: ${property.city}`)
     .text(`State: ${property.state}`)
     .text(`Postal Code: ${property.postalCode}`);
     
  doc.moveDown();
  
  // Add customer information
  doc.font('Helvetica-Bold')
     .text('Customer Information', { underline: true });
     
  doc.font('Helvetica')
     .text(`Name: ${workOrder.customer_name}`)
     .text(`Phone: ${workOrder.customer_phone}`)
     .text(`Email: ${workOrder.customer_email}`);
     
  doc.moveDown();
  
  // Add checklist items
  doc.addPage();
  
  doc.fontSize(16)
     .font('Helvetica-Bold')
     .text('Inspection Checklist', { align: 'center' });
     
  doc.moveDown();
  
  // Retrieve all checklist items with their media
  const { items } = details.checklist;
  
  // Iterate through each checklist item
  for (const item of items) {
    // Add item header
    doc.fontSize(14)
       .font('Helvetica-Bold')
       .text(item.name);
       
    // Add description
    doc.fontSize(12)
       .font('Helvetica-Oblique')
       .text(item.description || 'No description provided');
       
    // Add status
    let statusColor;
    switch (item.status) {
      case 'completed':
        statusColor = [0, 128, 0]; // Green
        break;
      case 'issue_found':
        statusColor = [255, 0, 0]; // Red
        break;
      case 'skipped':
        statusColor = [255, 165, 0]; // Orange
        break;
      default:
        statusColor = [0, 0, 0]; // Black
    }
    
    doc.font('Helvetica-Bold')
       .fillColor(statusColor[0], statusColor[1], statusColor[2])
       .text(`Status: ${item.status.toUpperCase().replace('_', ' ')}`)
       .fillColor('black');
       
    // Add comments if any
    if (item.comments) {
      doc.font('Helvetica')
         .text('Comments:')
         .font('Helvetica-Oblique')
         .text(item.comments);
    }
    
    // Get media items for this checklist item
    const mediaItems = await db.getMediaForChecklistItem(item.id);
    
    if (mediaItems.length > 0) {
      doc.font('Helvetica')
         .text(`Media Items: ${mediaItems.length}`);
         
      // Note: In a real implementation, we would add the actual images here
      // This would require additional processing to fit images properly on the page
      // For simplicity, we're just mentioning the media items
    }
    
    doc.moveDown(2);
  }
  
  // Add signature section
  doc.moveDown(2);
  doc.fontSize(12)
     .font('Helvetica')
     .text('Inspector Signature:', { continued: true })
     .text('____________________', { align: 'right' });
     
  doc.moveDown();
  
  doc.text('Date:', { continued: true })
     .text('____________________', { align: 'right' });
     
  // Add footer
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    
    // Save position
    const oldBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    
    // Draw footer
    doc.fontSize(10)
       .font('Helvetica')
       .text(
         `Property Stewards Inspection Report - Generated on ${new Date().toLocaleDateString()}`,
         0,
         doc.page.height - 50,
         { align: 'center' }
       );
       
    // Add page number
    doc.text(
      `Page ${i + 1} of ${pageCount}`,
      0,
      doc.page.height - 35,
      { align: 'center' }
    );
    
    // Restore margins
    doc.page.margins.bottom = oldBottomMargin;
  }
  
  // Finalize the PDF
  doc.end();
  
  // Return the PDF as a buffer
  return new Promise((resolve) => {
    doc.on('end', () => {
      resolve(Buffer.concat(buffers));
    });
  });
}

/**
 * Generate and store a report for a work order
 * 
 * @param {number} workOrderId - Work order ID
 * @returns {Promise<boolean>} - Whether report was generated successfully
 */
async function generateAndStoreReport(workOrderId) {
  try {
    // Generate PDF
    const pdfBuffer = await generateInspectionReport(workOrderId);
    
    // Store PDF in database
    await db.storeReportPdf(workOrderId, pdfBuffer);
    
    // Create notification for admin
    const workOrderDetails = await db.getWorkOrderDetails(workOrderId);
    
    // Find admin user(s) to notify
    const admins = await db.query(
      'SELECT id FROM users WHERE role = ?',
      ['admin']
    );
    
    if (admins.length > 0) {
      const adminId = admins[0].id;
      
      // Create admin notification
      await db.createNotification(
        adminId,
        'system',
        `Inspection report for property at ${workOrderDetails.workOrder.address} is now available.`,
        'work_order',
        workOrderId
      );
    }
    
    // Create customer notification
    await db.createNotification(
      workOrderDetails.workOrder.customer_id,
      'whatsapp',
      `Your property inspection report for ${workOrderDetails.workOrder.address} is now available.`,
      'work_order',
      workOrderId
    );
    
    return true;
  } catch (error) {
    console.error('Error generating report:', error);
    return false;
  }
}

module.exports = {
  generateInspectionReport,
  generateAndStoreReport
};
