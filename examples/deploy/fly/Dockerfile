# fly.io Dockerfile for dotdo stateless Durable Objects
# Multi-stage build for minimal production image

# =============================================================================
# Stage 1: Build
# =============================================================================
FROM node:22-slim AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm run build

# =============================================================================
# Stage 2: Production
# =============================================================================
FROM node:22-slim AS production

# Install pnpm for production
RUN corepack enable && corepack prepare pnpm@latest --activate

# Create non-root user for security
RUN groupadd -r dotdo && useradd -r -g dotdo dotdo

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/api ./api

# Copy any additional runtime files
COPY --from=builder /app/wrangler.jsonc ./

# Set ownership to non-root user
RUN chown -R dotdo:dotdo /app

# Switch to non-root user
USER dotdo

# Expose the application port
EXPOSE 8787

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8787/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Start the application
# Note: For stateless DOs, we run a Node.js HTTP server that emulates
# the Cloudflare Workers runtime using workerd or a compatibility layer
CMD ["node", "dist/server.js"]
