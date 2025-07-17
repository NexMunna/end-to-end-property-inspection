-- Create new tables needed for WhatsApp integration

-- Store raw incoming messages for audit trail
CREATE TABLE IF NOT EXISTS raw_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sender VARCHAR(50) NOT NULL,
  message_type VARCHAR(20) NOT NULL,
  content TEXT,
  media_id VARCHAR(255),
  provider VARCHAR(20) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  external_id VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

-- Add messages table for conversation history
CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  sender_id INT,
  message_type VARCHAR(20) NOT NULL,
  content TEXT,
  media_id INT,
  whatsapp_message_id VARCHAR(100),
  delivery_status VARCHAR(20) DEFAULT 'sent',
  sent_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE SET NULL
);

-- Ensure media table has the right structure
CREATE TABLE IF NOT EXISTS media (
  id INT AUTO_INCREMENT PRIMARY KEY,
  media_type VARCHAR(20) NOT NULL,
  content MEDIUMBLOB NOT NULL,
  file_name VARCHAR(255),
  content_type VARCHAR(100),
  checklist_instance_item_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (checklist_instance_item_id) REFERENCES checklist_instance_items(id) ON DELETE SET NULL
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_whatsapp_id ON users(whatsapp_id);
CREATE INDEX IF NOT EXISTS idx_conversation_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_external_id ON raw_messages(external_id);