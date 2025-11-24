#!/bin/sh

# Ensure the data directory exists with proper permissions
echo "Setting up data directory..."
mkdir -p /app/data
chmod 777 /app/data
echo "Data directory ready at /app/data"
ls -la /app/data

# Start the application
echo "Starting IRC bot..."
exec node dist/index.js