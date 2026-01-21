/**
 * @dotdo/api Middleware Layer
 *
 * This module exports all cross-cutting concerns as Hono middleware.
 * Middleware handles transport-level concerns that apply to all requests:
 *
 * - Authentication (via @dotdo/auth)
 * - Rate limiting
 * - Request ID tracking
 * - Logging
 * - CORS
 *
 * Business logic does NOT belong here - it should live in the DO package.
 *
 * @module api/middleware
 * @architecture
 *
 * The API package follows a clean separation of concerns:
 *
 * 1. Transport Layer (api/app.ts)
 *    - HTTP request/response handling
 *    - Middleware pipeline
 *    - Route registration
 *
 * 2. Middleware Layer (api/middleware/)
 *    - Cross-cutting concerns (auth, rate limiting, logging)
 *    - Request/response transformation
 *    - Error handling
 *
 * 3. Code Generation (api/codegen/)
 *    - SDK generation
 *    - CLI generation
 *    - MCP tool generation
 *    - OpenAPI spec generation
 *
 * 4. HATEOAS (api/hateoas.ts)
 *    - Self-describing API links
 *    - Navigation affordances
 *
 * Business logic lives in the DO package:
 * - Entity storage (Things, Events, Relationships)
 * - Schema validation
 * - Workflow execution
 * - Event handling
 */

// Rate limiting middleware
export {
  RateLimiter,
  rateLimitMiddleware,
  createRateLimiter,
  DEFAULT_TIERS,
  type RateLimitConfig,
  type RateLimitTier,
  type RateLimitResult,
  type RateLimitSqlStorage,
} from './rate-limit'

// Rate limiter Durable Object for distributed state
export {
  RateLimiterDO,
  type RateLimitCheckParams,
  type RateLimitCheckResult,
} from './RateLimiterDO'
