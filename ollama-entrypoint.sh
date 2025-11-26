#!/bin/sh

# Start Ollama service in the background
echo "Starting Ollama service..."
ollama serve &
OLLAMA_PID=$!

# Wait for Ollama to be ready
echo "Waiting for Ollama to be ready..."
until curl -s http://localhost:11434/api/tags >/dev/null 2>&1; do
    sleep 2
    echo "Waiting for Ollama API to respond..."
done
echo "Ollama is ready!"

# Pull the configured models
echo "Pulling configured models..."

# Pull main model
if [ -n "$OLLAMA_MODEL" ]; then
    echo "Pulling model: $OLLAMA_MODEL"
    ollama pull "$OLLAMA_MODEL"
    if [ $? -eq 0 ]; then
        echo "✓ Successfully pulled $OLLAMA_MODEL"
    else
        echo "⚠ Failed to pull $OLLAMA_MODEL (might already exist or be unavailable)"
    fi
else
    echo "No OLLAMA_MODEL specified, skipping main model pull"
fi

# Pull embedding model
if [ -n "$OLLAMA_EMBEDDING_MODEL" ]; then
    echo "Pulling embedding model: $OLLAMA_EMBEDDING_MODEL"
    ollama pull "$OLLAMA_EMBEDDING_MODEL"
    if [ $? -eq 0 ]; then
        echo "✓ Successfully pulled $OLLAMA_EMBEDDING_MODEL"
    else
        echo "⚠ Failed to pull $OLLAMA_EMBEDDING_MODEL (might already exist or be unavailable)"
    fi
else
    echo "No OLLAMA_EMBEDDING_MODEL specified, skipping embedding model pull"
fi

# List available models
echo ""
echo "Available models:"
ollama list

echo ""
echo "Ollama is ready to serve requests!"

# Keep the container running
wait $OLLAMA_PID