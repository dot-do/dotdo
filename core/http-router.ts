/**
 * HTTP Router Module - CORS, routing utilities, and HTTP constants
 *
 * This module contains:
 * - HTTP status code constants
 * - Re-exports for CORS configuration from centralized module
 * - Route-specific CORS policies
 *
 * CORS configuration is now centralized in lib/cors-config.ts for:
 * - Environment-based configuration (ALLOWED_ORIGINS env var)
 * - Sensible defaults per environment (production/staging/development)
 * - Consistent security policies across the codebase
 */

// ============================================================================
// HTTP Status Constants
// ============================================================================

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  UPGRADE_REQUIRED: 426,
  INTERNAL_SERVER_ERROR: 500,
} as const

export type HttpStatusCode = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS]

// ============================================================================
// Version Header
// ============================================================================

export const VERSION_HEADER = 'X-DO-Version'
export const VERSION = '1.0.0'

// ============================================================================
// CORS Configuration - Re-exported from centralized module
// ============================================================================

// Re-export CORS configuration from centralized module
export {
  CORS_POLICIES,
  PRODUCTION_ORIGINS,
  STAGING_ORIGINS,
  DEVELOPMENT_ORIGINS,
  getAllowedOrigins,
  validateOrigin,
  getCorsPolicy,
  buildCorsHeaders,
  parseOriginsFromEnv,
  isValidOrigin,
  getDefaultOrigins,
  getCorsConfig,
  createHonoCorsConfig,
  type CorsEnv,
  type CorsPolicy,
  type CorsConfig,
  type CorsPolicyType,
} from '../lib/cors-config'

// For backwards compatibility, export ALLOWED_ORIGINS as an alias for DEVELOPMENT_ORIGINS
// Note: This is deprecated - use getAllowedOrigins(env) instead for environment-based config
import { DEVELOPMENT_ORIGINS } from '../lib/cors-config'

/**
 * @deprecated Use getAllowedOrigins(env) from lib/cors-config.ts instead.
 * This static list doesn't support environment-based configuration.
 */
export const ALLOWED_ORIGINS = DEVELOPMENT_ORIGINS
