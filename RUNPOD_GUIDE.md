# Runpod Serverless Integration Guide

This guide explains how to set up and use Runpod serverless endpoints with wob-irc.

## What is Runpod?

Runpod is a cloud GPU platform that offers serverless endpoints for running LLM models. This allows you to use powerful GPU-accelerated models without needing to run them locally.

## Benefits of Using Runpod

- **No Local GPU Required**: Run powerful LLM models without local hardware
- **Scalable**: Automatically scales based on usage
- **Pay-per-use**: Only pay for actual inference time
- **Access to Powerful Models**: Use models that might be too large to run locally

## Setup Instructions

### 1. Create a Runpod Account

1. Visit [Runpod.io](https://www.runpod.io/)
2. Sign up for an account
3. Add credits to your account (required for serverless endpoints)

### 2. Create a Serverless Endpoint

1. Navigate to the Serverless section in the Runpod dashboard
2. Click "New Endpoint"
3. Choose a template or create a custom one:
   - **Pre-built templates**: Runpod offers templates for popular models (LLaMA, Mistral, etc.)
   - **Custom**: You can deploy your own model using a Docker container

4. Configure your endpoint:
   - Set the GPU type (e.g., RTX 4090, A100)
   - Configure scaling parameters (min/max workers)
   - Set timeout and concurrency settings

5. Deploy the endpoint and wait for it to be ready

### 3. Get Your API Credentials

1. Once the endpoint is deployed, copy the **Endpoint ID** from the dashboard
2. Go to Settings → API Keys
3. Create a new API key or copy an existing one

### 4. Configure wob-irc

#### Option A: Using Environment Variables

Create or edit your `.env` file:

```env
# LLM Provider
LLM_PROVIDER=runpod

# Runpod Configuration
RUNPOD_API_KEY=your-api-key-here
RUNPOD_ENDPOINT_ID=your-endpoint-id-here

# IRC Configuration
IRC_HOST=irc.libera.chat
IRC_PORT=6667
IRC_NICK=ollama-bot
IRC_CHANNELS=#test

# Bot Settings
MESSAGE_DEBOUNCE_MS=2000
```

#### Option B: Using config.json

Copy the Runpod example configuration:

```bash
cp config.json.runpod.example config.json
```

Edit `config.json`:

```json
{
  "irc": {
    "host": "irc.libera.chat",
    "port": 6667,
    "nick": "ollama-bot",
    "channels": ["#test"]
  },
  "llm": {
    "provider": "runpod",
    "runpod": {
      "apiKey": "YOUR_RUNPOD_API_KEY",
      "endpointId": "YOUR_RUNPOD_ENDPOINT_ID"
    },
    "maxToolCallRounds": 10
  },
  "messageDebounceMs": 2000
}
```

## Important Notes

### Message History and Embeddings

When using Runpod, the bot still uses Ollama for message history embeddings and semantic search. This means:

- You need a local Ollama installation with the `nomic-embed-text` model for full functionality
- If you don't have Ollama installed, message history features will be limited

To set up Ollama for embeddings only:

```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull the embedding model
ollama pull nomic-embed-text
```

### Tool Calling Support

The Runpod integration supports tool calling (plugins), but this depends on your endpoint configuration:

- Your model must support function calling (e.g., models based on GPT, Claude, etc.)
- The endpoint must be configured to return tool calls in OpenAI-compatible format
- Check your endpoint documentation for tool calling support

### Cost Considerations

- Runpod charges based on:
  - Compute time (per second of GPU usage)
  - Idle time (if workers are kept warm)
- Monitor your usage in the Runpod dashboard
- Set appropriate scaling limits to control costs

### Timeout Settings

- Default timeout for Runpod requests is 60 seconds
- Adjust `maxToolCallRounds` in your configuration to prevent long-running tool call chains
- Consider your endpoint's timeout settings when configuring the bot

## Troubleshooting

### Connection Errors

**Error: "Runpod API error: 401"**
- Check that your API key is correct
- Ensure the API key has not expired

**Error: "Runpod API error: 404"**
- Verify your endpoint ID is correct
- Ensure the endpoint is deployed and active

### Timeout Issues

**Error: "Runpod job timed out"**
- Your request may be taking too long to process
- Check your endpoint's worker configuration
- Consider using a faster GPU or increasing timeout limits

### Tool Calling Not Working

**Tools are not being called**
- Verify your model supports function calling
- Check that your endpoint is configured for OpenAI-compatible responses
- Review the console logs for tool call parsing errors

## Switching Back to Ollama

To switch back to using Ollama:

1. Change `LLM_PROVIDER=ollama` in your `.env` file, or
2. Update `"provider": "ollama"` in your `config.json`
3. Ensure Ollama is running locally
4. Restart the bot

## Example Endpoint Configurations

### Using vLLM Template

Runpod's vLLM template is great for LLaMA-based models:

1. Select "vLLM" template
2. Choose your model (e.g., `meta-llama/Meta-Llama-3-8B-Instruct`)
3. Configure:
   - GPU: RTX 4090 or A100
   - Min Workers: 0 (pay only when used)
   - Max Workers: 3 (limit concurrent requests)

### Using Custom Docker Container

For more control, create a custom Docker container:

```dockerfile
FROM runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel

# Install your LLM framework (vLLM, TGI, etc.)
# Configure your model
# Expose serverless handler
```

## Support

For Runpod-specific issues:
- [Runpod Documentation](https://docs.runpod.io/)
- [Runpod Discord](https://discord.gg/runpod)

For wob-irc issues:
- [GitHub Issues](https://github.com/streed/wob-irc/issues)
