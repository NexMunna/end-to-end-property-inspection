<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

# Project: Property Stewards – Inspector Interface System

## Architecture
- **Backend**: DigitalOcean Functions (serverless Node.js runtime)
- **Database**: MySQL (store all structured data and media as BLOBs)
- **Storage**: MySQL BLOBs for images/videos (no S3)
- **Messaging**: WhatsApp via Wassenger API (Webhook and Polling support)
- **AI**: OpenAI GPT-4o-mini for NLP-based prompt parsing, conversation routing

## Key Files
- `index.js` - Function entry point
- `src/handler.js` - Main webhook handler logic
- `src/db/index.js` - Database operations
- `src/wassenger.js` - WhatsApp API integration
- `src/openai.js` - OpenAI integration for NLP
- `src/utils/pdf.js` - PDF report generation

## Requirements
- Keep code modular and maintainable
- Ensure proper error handling and logging
- Make the WhatsApp conversation flow intuitive for inspectors
- Store all media in MySQL as BLOBs (not external storage)
- Use GPT-4o-mini for understanding inspector intent
- Follow best practices for serverless functions (fast cold starts)

## Database Schema
The system uses the following key tables:
- `users`: Stores admin, inspector, and customer information
- `properties`: Stores property details
- `contracts`: Links customers to properties
- `work_orders`: Represents inspection jobs
- `checklist_instances`: Contains inspection checklists
- `media`: Stores inspection photos and videos as BLOBs
- `reports`: Stores generated PDF reports

## Messaging Flow
1. Inspector sends message via WhatsApp
2. Message received by Wassenger webhook
3. Message processed by handler.js
4. Intent extracted by OpenAI
5. Database operations performed
6. Response sent back via WhatsApp

When writing code for this project, focus on creating a seamless user experience for inspectors who are not technical users.
