require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const readFile = promisify(fs.readFile);

// Get database configuration from environment variables
const {
  DB_HOST = 'localhost',
  DB_PORT = '3306',
  DB_USER = 'root',
  DB_PASSWORD = 'mysql',
  DB_NAME = 'defaultdb'
} = process.env;

async function setupDatabase() {
  let connection;

  try {
    // First create a connection without specifying a database
    connection = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD
    });

    console.log('� Connected to MySQL server');

    // Create database if it doesn't exist
    console.log(`�️ Creating database '${DB_NAME}' if it doesn't exist...`);
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${DB_NAME}`);
    console.log(`✅ Database '${DB_NAME}' is ready`);

    // Switch to the database
    await connection.query(`USE ${DB_NAME}`);

    // Check if schema file exists and apply it
    const schemaPath = path.join(__dirname, '../src/db/schema.sql');
    if (fs.existsSync(schemaPath)) {
      console.log('� Found schema.sql, applying database schema...');
      const schemaSQL = await readFile(schemaPath, 'utf8');
      
      // Split SQL by semicolon to execute statements separately
      const statements = schemaSQL
        .split(';')
        .filter(statement => statement.trim().length > 0);

      for (const statement of statements) {
        try {
          // Replace INSERT with INSERT IGNORE to handle duplicates gracefully
          const modifiedStatement = statement.replace(/INSERT INTO/gi, 'INSERT IGNORE INTO');
          await connection.query(modifiedStatement);
        } catch (err) {
          console.warn(`⚠️ Warning in schema statement: ${err.message}`);
          console.warn('Statement:', statement.substring(0, 100) + '...');
          // Continue executing other statements despite errors
        }
      }
      console.log('✅ Database schema applied successfully');
    } else {
      console.log('⚠️ No schema.sql file found, skipping schema creation');
    }
    
    // Apply migrations if they exist
    const migrationsPath = path.join(__dirname, '../src/db/migrations');
    if (fs.existsSync(migrationsPath)) {
      console.log('� Looking for migration files...');
      const migrationFiles = fs.readdirSync(migrationsPath)
        .filter(file => file.endsWith('.sql'))
        .sort(); // This sorts alphabetically to ensure order

      for (const migrationFile of migrationFiles) {
        console.log(`� Applying migration: ${migrationFile}`);
        const migrationSQL = await readFile(path.join(migrationsPath, migrationFile), 'utf8');
        
        // Split SQL by semicolon to execute statements separately
        const statements = migrationSQL
          .split(';')
          .filter(statement => statement.trim().length > 0);

        for (const statement of statements) {
          try {
            await connection.query(statement);
          } catch (err) {
            console.warn(`⚠️ Warning in migration ${migrationFile}:`, err.message);
            // Continue executing other statements despite errors
          }
        }
        console.log(`✅ Migration ${migrationFile} applied successfully`);
      }
    }

    console.log('� Database setup complete!');
    return true;
  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('\n⚠️ MySQL server does not appear to be running.');
      console.error('Please start your MySQL server and try again.');
    }
    return false;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run if called directly from command line
if (require.main === module) {
  setupDatabase()
    .then(success => {
      if (!success) process.exit(1);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
} else {
  module.exports = setupDatabase;
}
