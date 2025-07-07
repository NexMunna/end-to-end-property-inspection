-- Property Stewards - Inspector Interface System Database Schema

-- Enable foreign key constraints
SET FOREIGN_KEY_CHECKS = 1;

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    role ENUM('admin', 'inspector', 'customer') NOT NULL,
    whatsapp_id VARCHAR(255) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create properties table
CREATE TABLE IF NOT EXISTS properties (
    id INT AUTO_INCREMENT PRIMARY KEY,
    address VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(50) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    property_type ENUM('residential', 'commercial', 'industrial', 'land') NOT NULL,
    owner_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Create contracts table
CREATE TABLE IF NOT EXISTS contracts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    property_id INT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    status ENUM('draft', 'active', 'completed', 'cancelled') NOT NULL DEFAULT 'draft',
    terms TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
);

-- Create checklist_templates table
CREATE TABLE IF NOT EXISTS checklist_templates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create checklist_items table for template items
CREATE TABLE IF NOT EXISTS checklist_template_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    template_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    item_order INT NOT NULL,
    requires_media BOOLEAN DEFAULT FALSE,
    requires_comment BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (template_id) REFERENCES checklist_templates(id) ON DELETE CASCADE
);

-- Create work orders table
CREATE TABLE IF NOT EXISTS work_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    contract_id INT NOT NULL,
    inspector_id INT,
    checklist_template_id INT NOT NULL,
    scheduled_date DATE NOT NULL,
    scheduled_time_window VARCHAR(50),
    status ENUM('scheduled', 'in_progress', 'completed', 'cancelled', 'rescheduled') NOT NULL DEFAULT 'scheduled',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE,
    FOREIGN KEY (inspector_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (checklist_template_id) REFERENCES checklist_templates(id) ON DELETE CASCADE
);

-- Create checklist_instances table
CREATE TABLE IF NOT EXISTS checklist_instances (
    id INT AUTO_INCREMENT PRIMARY KEY,
    work_order_id INT NOT NULL,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    status ENUM('not_started', 'in_progress', 'completed') NOT NULL DEFAULT 'not_started',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE
);

-- Create checklist_instance_items table
CREATE TABLE IF NOT EXISTS checklist_instance_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    checklist_instance_id INT NOT NULL,
    template_item_id INT NOT NULL,
    status ENUM('pending', 'completed', 'skipped', 'issue_found') NOT NULL DEFAULT 'pending',
    comments TEXT,
    completed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (checklist_instance_id) REFERENCES checklist_instances(id) ON DELETE CASCADE,
    FOREIGN KEY (template_item_id) REFERENCES checklist_template_items(id) ON DELETE CASCADE
);

-- Create media table for storing images and videos as BLOBs
CREATE TABLE IF NOT EXISTS media (
    id INT AUTO_INCREMENT PRIMARY KEY,
    checklist_instance_item_id INT NOT NULL,
    media_type ENUM('image', 'video', 'audio') NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    content LONGBLOB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (checklist_instance_item_id) REFERENCES checklist_instance_items(id) ON DELETE CASCADE
);

-- Create reports table
CREATE TABLE IF NOT EXISTS reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    work_order_id INT NOT NULL UNIQUE,
    report_file LONGBLOB,
    generated_at TIMESTAMP NULL,
    sent_to_customer BOOLEAN DEFAULT FALSE,
    sent_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE
);

-- Create conversations table to track inspector interactions
CREATE TABLE IF NOT EXISTS conversations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    context JSON,
    active BOOLEAN DEFAULT TRUE,
    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create messages table to store WhatsApp messages
CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    conversation_id INT NOT NULL,
    sender_id INT,
    message_type ENUM('text', 'image', 'video', 'audio', 'system') NOT NULL,
    content TEXT,
    media_id INT,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    whatsapp_message_id VARCHAR(255),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE SET NULL
);

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    notification_type ENUM('email', 'whatsapp', 'system') NOT NULL,
    message TEXT NOT NULL,
    related_entity_type VARCHAR(50),
    related_entity_id INT,
    status ENUM('pending', 'sent', 'failed') NOT NULL DEFAULT 'pending',
    sent_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create triggers to update timestamps
DELIMITER //

-- Add initial demo data for testing
-- Insert sample users (admin, inspector, customer)
INSERT INTO users (name, email, phone, role, whatsapp_id)
VALUES 
  ('Admin User', 'admin@propertystewards.com', '1234567890', 'admin', NULL),
  ('Inspector Joe', 'inspector@propertystewards.com', '2345678901', 'inspector', '12345678901'),
  ('Customer Smith', 'smith@example.com', '3456789012', 'customer', '23456789012');

-- Insert sample property
INSERT INTO properties (address, city, state, postal_code, property_type, owner_id)
VALUES 
  ('123 Main St', 'Anytown', 'CA', '12345', 'residential', 3);

-- Insert sample contract
INSERT INTO contracts (customer_id, property_id, start_date, end_date, status, terms)
VALUES 
  (3, 1, '2025-01-01', '2025-12-31', 'active', 'Monthly inspections');

-- Insert sample checklist template
INSERT INTO checklist_templates (name, description)
VALUES 
  ('Residential Property Inspection', 'Standard inspection checklist for residential properties');

-- Insert sample checklist template items
INSERT INTO checklist_template_items (template_id, name, description, item_order, requires_media, requires_comment)
VALUES 
  (1, 'Exterior Inspection', 'Check the exterior of the property', 1, TRUE, TRUE),
  (1, 'Interior Inspection', 'Check the interior of the property', 2, TRUE, TRUE),
  (1, 'Plumbing Inspection', 'Check all plumbing fixtures', 3, TRUE, TRUE),
  (1, 'Electrical Inspection', 'Check electrical systems', 4, TRUE, TRUE),
  (1, 'HVAC Inspection', 'Check heating and cooling systems', 5, TRUE, TRUE);

-- Insert sample work order for tomorrow
INSERT INTO work_orders (contract_id, inspector_id, checklist_template_id, scheduled_date, scheduled_time_window, status, notes)
VALUES 
  (1, 2, 1, DATE_ADD(CURRENT_DATE, INTERVAL 1 DAY), '9:00 AM - 12:00 PM', 'scheduled', 'Regular monthly inspection');

DELIMITER ;
