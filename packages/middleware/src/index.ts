/**
 * @dotdo/middleware
 *
 * Hono middleware for dotdo applications.
 *
 * TDD RED PHASE: This file is a stub that will fail tests.
 * Implementation will be added in the GREEN phase.
 */

// Auth middleware exports
export { authMiddleware, registerApiKey } from './auth/index'
export type { AuthConfig, AuthContext, User, Session } from './auth/index'

// WorkOS exports
export { workosAuthKit } from './workos/index'
export type { WorkOSAuthKitConfig } from './workos/index'

// Error handling exports
export { errorHandler, notFoundHandler } from './error/index'
export {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
  InternalServerError,
} from './error/index'

// Standalone middleware exports
export { requestId } from './request-id'
export { rateLimit } from './rate-limit'
export type { RateLimitConfig } from './rate-limit'
