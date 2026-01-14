/**
 * Security Module
 *
 * Comprehensive security utilities for dotdo applications:
 *
 * - **Validators**: Table names, paths, headers, JSON paths
 * - **Sanitizers**: HTML escaping, SQL escaping, prototype pollution prevention
 * - **Rate Limiting**: In-memory rate limiter with metrics
 * - **Request Limiting**: Body size and JSON depth limits
 * - **Events**: Security event logging and monitoring
 * - **Metrics**: Rate limit and validation metrics
 * - **Middleware**: Hono security middleware
 * - **Rules**: Static code analysis rules (for sandbox)
 *
 * @module lib/security
 *
 * @example
 * ```typescript
 * import {
 *   // Validators
 *   TableValidator,
 *   PathValidator,
 *   HeaderValidator,
 *   validateJsonPath,
 *
 *   // Sanitizers
 *   HtmlEscaper,
 *   SqlSanitizer,
 *   ObjectSanitizer,
 *
 *   // Rate limiting
 *   RateLimiter,
 *   createRateLimiter,
 *
 *   // Events and metrics
 *   securityEvents,
 *   SecurityEventType,
 *   rateLimitMetrics,
 *
 *   // Middleware
 *   securityMiddleware,
 *   rateLimitMiddleware,
 * } from './lib/security'
 * ```
 */

// ============================================================================
// VALIDATORS
// ============================================================================

export {
  TableValidator,
  PathValidator,
  HeaderValidator,
  validateJsonPath,
} from './validators'

// ============================================================================
// SANITIZERS
// ============================================================================

export {
  HtmlEscaper,
  SqlSanitizer,
  ObjectSanitizer,
} from './sanitizers'

// ============================================================================
// RATE LIMITING
// ============================================================================

export {
  RateLimiter,
  createRateLimiter,
  type RateLimitConfig,
  type RateLimitResult,
  type RateLimitEntry,
} from './rate-limiter'

// ============================================================================
// REQUEST LIMITING
// ============================================================================

export {
  RequestLimiter,
  formatBytes,
  parseSize,
} from './request-limiter'

// ============================================================================
// SECURITY EVENTS
// ============================================================================

export {
  SecurityEventEmitter,
  SecurityEventType,
  SecurityEventSeverity,
  securityEvents,
  type SecurityEvent,
  type SecurityEventListener,
  type SecurityMetrics,
} from './events'

// ============================================================================
// METRICS
// ============================================================================

export {
  RateLimitMetricsCollector,
  ValidationMetricsCollector,
  rateLimitMetrics,
  validationMetrics,
  type RateLimitMetric,
  type RateLimitSummary,
  type ValidationMetrics,
} from './metrics'

// ============================================================================
// MIDDLEWARE
// ============================================================================

export {
  securityMiddleware,
  rateLimitMiddleware,
  requestSizeMiddleware,
  securityHeadersMiddleware,
  prototypePollutionMiddleware,
  validateRedirect,
  type SecurityMiddlewareOptions,
  type RateLimitInfo,
} from './middleware'

// ============================================================================
// STATIC ANALYSIS RULES (for sandbox)
// ============================================================================

export {
  allRules,
  dangerousFunctionRules,
  codeExecutionRules,
  filesystemRules,
  networkRules,
  processRules,
  secretRules,
  prototypePollutionRules,
  infiniteLoopRules,
  resourceExhaustionRules,
  deserializationRules,
} from './rules'

export type {
  ViolationType,
  Severity,
  SecurityViolation,
  SecurityReport,
  AnalyzerConfig,
  SecurityRule,
} from './types'
