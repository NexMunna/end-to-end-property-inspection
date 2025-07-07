#!/bin/bash

# Deployment script for Property Stewards Inspector Interface System
# This script packages and deploys the application to DigitalOcean Functions

echo "Preparing deployment package..."

# Create a temporary directory for the package
mkdir -p deploy

# Copy project files to deployment directory
cp -r src/ index.js package.json package-lock.json deploy/

# Create environment file from template if it doesn't exist
if [ ! -f deploy/.env ]; then
  echo "Creating .env file from template..."
  cp .env.template deploy/.env
  echo "WARNING: Please update the API keys and database credentials in deploy/.env before deploying"
fi

# Navigate to deployment directory
cd deploy

# Install production dependencies
echo "Installing production dependencies..."
npm install --production

# Create deployment package
echo "Creating deployment package..."
zip -r ../function.zip . -x "node_modules/*/test/*" "node_modules/*/docs/*"

# Return to project root
cd ..

echo "Deployment package created: function.zip"
echo "You can now deploy this package to DigitalOcean Functions"
echo "Command: doctl serverless deploy . --env-file .env"
