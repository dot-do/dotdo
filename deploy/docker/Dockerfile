# =============================================================================
# dotdo - Production Dockerfile
# Stateless Durable Objects running on workerd/miniflare
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# Install production dependencies only
# -----------------------------------------------------------------------------
FROM node:22-alpine AS deps

WORKDIR /app

# Install build tools needed for native modules
RUN apk add --no-cache python3 make g++ git

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY packages ./packages

# Install pnpm and dependencies
RUN npm install -g pnpm@9 && \
    pnpm install --frozen-lockfile --prod

# -----------------------------------------------------------------------------
# Stage 2: Builder
# Build the application
# -----------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Install build tools
RUN apk add --no-cache python3 make g++ git

# Copy package files and install all deps (including dev)
COPY package.json pnpm-lock.yaml ./
COPY packages ./packages
RUN npm install -g pnpm@9 && \
    pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm run build

# -----------------------------------------------------------------------------
# Stage 3: Runtime
# Minimal production image
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
    wget \
    ca-certificates \
    tini \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S dotdo && \
    adduser -S dotdo -u 1001 -G dotdo

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/api ./api
COPY --from=builder /app/objects ./objects
COPY --from=builder /app/types ./types
COPY --from=builder /app/workflows ./workflows
COPY --from=builder /app/workers ./workers

# Copy configuration files
COPY package.json wrangler.jsonc ./

# Create data directory for local storage fallback
RUN mkdir -p /app/data && chown -R dotdo:dotdo /app

# Environment variables
ENV NODE_ENV=production \
    PORT=8787 \
    # External state configuration
    TURSO_URL="" \
    TURSO_TOKEN="" \
    # R2/S3 storage for Iceberg
    R2_ENDPOINT="" \
    R2_ACCESS_KEY_ID="" \
    R2_SECRET_ACCESS_KEY="" \
    R2_BUCKET="" \
    # Observability
    LOG_LEVEL=info

# Switch to non-root user
USER dotdo

# Expose workerd port
EXPOSE 8787

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8787/health || exit 1

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start workerd via wrangler (local mode for container deployment)
CMD ["npx", "wrangler", "dev", "--local", "--port", "8787", "--ip", "0.0.0.0"]
