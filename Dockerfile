# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++ sqlite-dev

# Copy package files and TypeScript config
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies including TypeScript and dev dependencies
# Explicitly ensure we're not in production mode for the build stage
RUN NODE_ENV=development npm ci

# Copy source code
COPY src ./src

# Build the application (TypeScript will be available from node_modules)
RUN npm run build

# Prune dev dependencies after build
RUN npm prune --production

# Runtime stage - minimal Alpine
FROM alpine:3.19

# Install only runtime dependencies
RUN apk add --no-cache nodejs sqlite-libs libstdc++

WORKDIR /app

# Copy node binary and dependencies from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist

# Copy and set up entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Pre-create directory (volume mount will override but at least it exists)
RUN mkdir -p /app/data && chmod 777 /app/data

# Set environment to production
ENV NODE_ENV=production

# Use entrypoint script to ensure proper setup
ENTRYPOINT ["/app/entrypoint.sh"]