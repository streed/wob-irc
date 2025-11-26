#!/bin/bash

echo "Setting up directories for Docker..."

# Create data directory on host if it doesn't exist
if [ ! -d "./data" ]; then
  echo "Creating ./data directory..."
  mkdir -p ./data
  chmod 777 ./data
  echo "✓ Created ./data directory"
else
  echo "✓ ./data directory already exists"
fi

# Create ollama-data directory on host if it doesn't exist
if [ ! -d "./ollama-data" ]; then
  echo "Creating ./ollama-data directory..."
  mkdir -p ./ollama-data
  chmod 777 ./ollama-data
  echo "✓ Created ./ollama-data directory"
else
  echo "✓ ./ollama-data directory already exists"
fi

echo ""
echo "Directories ready! You can now run:"
echo "  docker-compose up -d"
echo ""
echo "Models will be automatically pulled on first startup."
echo "The Ollama container will pull:"
echo "  - Main model: ${OLLAMA_MODEL:-llama3.2}"
echo "  - Embedding model: ${OLLAMA_EMBEDDING_MODEL:-nomic-embed-text}"
echo ""
echo "You can monitor the model download progress with:"
echo "  docker logs -f ollama-server"