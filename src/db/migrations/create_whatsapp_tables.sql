-- First check if index exists before creating it
SELECT COUNT(1) INTO @index_exists FROM information_schema.statistics 
WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'idx_whatsapp_id';

SET @create_index = CONCAT("CREATE INDEX idx_whatsapp_id ON users(whatsapp_id)");

-- Only create the index if it doesn't exist
SET @sql = IF(@index_exists = 0, @create_index, 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
