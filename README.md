# Property Stewards – Inspector Interface System

A WhatsApp-based property inspection management system for inspectors, built on DigitalOcean Functions.

## Overview

This system enables property inspectors to manage their work orders and complete inspections using WhatsApp as the interface. The application uses:

- **Backend**: DigitalOcean Functions (serverless Node.js runtime)
- **Database**: MySQL (stores all structured data and media as BLOBs)
- **Messaging**: WhatsApp via Wassenger API (Webhook support)
- **AI**: OpenAI GPT-4o-mini for NLP-based prompt parsing and conversation routing

Admins use Retool (separately) for back office operations.

## Features

1. **WhatsApp Integration**: Receive and respond to inspector messages via WhatsApp
2. **AI-Powered Understanding**: Uses OpenAI GPT-4o-mini to interpret inspector messages and determine intent
3. **Work Order Management**: View, start, and complete work orders
4. **Checklist Management**: Update checklist items with comments and media
5. **Media Support**: Add images and videos directly via WhatsApp
6. **PDF Report Generation**: Generate inspection reports in PDF format
7. **Notification System**: Send notifications to admins and customers when jobs are completed

## Installation

### Prerequisites

- Node.js 18.x
- MySQL Database
- Wassenger API account
- OpenAI API account

### Setup

1. Clone this repository
2. Copy the `.env.template` file to `.env` and fill in your API keys and database credentials:
   ```
   cp .env.template .env
   ```
3. Install dependencies:
   ```
   npm install
   ```
4. Create the database schema:
   ```
   mysql -u your_user -p your_database < src/db/schema.sql
   ```

## Deployment to DigitalOcean Functions

1. Zip the project:
   ```
   zip -r function.zip . -x "node_modules/*" ".git/*"
   ```

2. Deploy to DigitalOcean Functions via their dashboard or CLI:
   ```
   doctl serverless deploy . --env-file .env
   ```

## Usage

Inspectors can interact with the system via WhatsApp using natural language commands:

- "Show my jobs today" - View today's inspections
- "Show jobs for [date]" - View inspections for a specific date
- "Start inspection #[number]" - Begin an inspection
- "Update item #[number]" - Select a checklist item to update
- "Comment: [text]" - Add a comment to the current item
- "Complete" - Mark current item as completed
- "Issue: [text]" - Mark item as having issues
- "Complete inspection" - Finish the current inspection
- "Cancel" - Cancel the current operation
- "Help" - Show help message

## Webhook Configuration

Configure your Wassenger account to send webhooks to the deployed function URL. The webhook should be set to receive all incoming message events.

## Wassenger Configuration

When setting up Wassenger:

1. Create an account and generate an API key
2. Set up a WhatsApp device in Wassenger
3. Copy your API key to the WASSENGER_API_KEY environment variable
4. If you have multiple devices, copy your device ID to the WASSENGER_DEVICE_ID environment variable
5. Configure the webhook URL in your Wassenger dashboard to point to your deployed function

## WhatsApp Business API Setup

This system uses the WhatsApp Business API directly instead of Wassenger. Follow these steps to set it up:

1. **Create a Meta Developer Account**:
   - Visit [Meta for Developers](https://developers.facebook.com/)
   - Create an account if you don't have one

2. **Create a Meta App**:
   - Go to [My Apps](https://developers.facebook.com/apps/)
   - Click "Create App"
   - Select "Business" type
   - Complete the setup process

3. **Set Up WhatsApp Business**:
   - From your app dashboard, click "Add Products"
   - Select "WhatsApp"
   - Follow the guided setup process
   - Get your test phone number or request access to production

4. **Configure Webhooks**:
   - Go to "WhatsApp > Configuration"
   - Under Webhooks, add your webhook URL (your deployed DigitalOcean Function URL)
   - Set a verify token (can be any string you choose)
   - Select the subscription fields: messages, message_status_updates

5. **Update Environment Variables**:
   - Update your `.env` file with:
     - `WHATSAPP_PHONE_NUMBER_ID`: Found in WhatsApp > Getting Started
     - `WHATSAPP_BUSINESS_ACCOUNT_ID`: Found in WhatsApp > API Setup
     - `WHATSAPP_ACCESS_TOKEN`: Generate a new token in App Dashboard > Settings > Basic
     - `WHATSAPP_VERIFY_TOKEN`: The verify token you set for your webhook

6. **Test Your Integration**:
   - Use the "Send Test Message" feature in the Meta dashboard
   - Or send a message to your WhatsApp number from a registered test number

## Architecture

- `index.js` - Function entry point
- `src/handler.js` - Main webhook handler logic
- `src/db/index.js` - Database operations
- `src/wassenger.js` - WhatsApp API integration
- `src/openai.js` - OpenAI integration for NLP
- `src/utils/pdf.js` - PDF report generation

## Database Schema

The system uses the following key tables:

- **users**: Stores admin, inspector, and customer information
- **properties**: Stores property details
- **contracts**: Links customers to properties
- **work_orders**: Represents inspection jobs
- **checklist_instances**: Contains inspection checklists
- **media**: Stores inspection photos and videos as BLOBs
- **reports**: Stores generated PDF reports

## License

ISC
