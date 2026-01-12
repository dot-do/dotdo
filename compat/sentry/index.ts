/**
 * @dotdo/sentry - Sentry SDK Compat Layer for Cloudflare Workers
 *
 * Edge-compatible drop-in replacement for @sentry/browser that runs on
 * Cloudflare Workers with optimized performance and zero cold start impact.
 *
 * Features:
 * - API-compatible with @sentry/browser and @sentry/node
 * - Error tracking with stack traces
 * - Breadcrumb trail for debugging
 * - User context and tags
 * - Custom event capture
 * - Scoped operations with withScope
 * - Sampling support
 * - beforeSend hook for filtering
 * - Performance tracing (transactions/spans)
 * - TemporalStore for event persistence
 * - WindowManager for batched sending
 *
 * @example Basic Usage
 * ```typescript
 * import * as Sentry from '@dotdo/sentry'
 *
 * Sentry.init({
 *   dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0',
 *   environment: 'production',
 *   release: 'my-app@1.0.0',
 * })
 *
 * try {
 *   throw new Error('Something went wrong')
 * } catch (error) {
 *   Sentry.captureException(error)
 * }
 * ```
 *
 * @example With User Context
 * ```typescript
 * import * as Sentry from '@dotdo/sentry'
 *
 * Sentry.init({ dsn: env.SENTRY_DSN })
 *
 * // Set user context for all events
 * Sentry.setUser({
 *   id: 'user-123',
 *   email: 'user@example.com',
 *   username: 'johndoe',
 * })
 *
 * // Add tags for filtering
 * Sentry.setTags({
 *   feature: 'checkout',
 *   tier: 'premium',
 * })
 * ```
 *
 * @example With Breadcrumbs
 * ```typescript
 * import * as Sentry from '@dotdo/sentry'
 *
 * Sentry.init({ dsn: env.SENTRY_DSN })
 *
 * // Add navigation breadcrumb
 * Sentry.addBreadcrumb({
 *   category: 'navigation',
 *   message: 'User clicked checkout button',
 *   level: 'info',
 * })
 *
 * // Add HTTP breadcrumb
 * Sentry.addBreadcrumb({
 *   category: 'http',
 *   message: 'POST /api/orders',
 *   level: 'info',
 *   data: {
 *     method: 'POST',
 *     url: '/api/orders',
 *     status_code: 200,
 *   },
 * })
 * ```
 *
 * @example Scoped Operations
 * ```typescript
 * import * as Sentry from '@dotdo/sentry'
 *
 * Sentry.init({ dsn: env.SENTRY_DSN })
 *
 * Sentry.withScope((scope) => {
 *   scope.setTag('component', 'payment')
 *   scope.setExtra('orderId', 'order-456')
 *
 *   // This exception will include the scoped data
 *   Sentry.captureException(new Error('Payment failed'))
 * })
 *
 * // Outside withScope, the extra data is not included
 * Sentry.captureMessage('General log message')
 * ```
 *
 * @example Performance Tracing
 * ```typescript
 * import * as Sentry from '@dotdo/sentry'
 *
 * Sentry.init({
 *   dsn: env.SENTRY_DSN,
 *   tracesSampleRate: 1.0,
 * })
 *
 * // Start a transaction
 * const transaction = Sentry.startTransaction({
 *   name: 'GET /api/users',
 *   op: 'http.server',
 * })
 *
 * // Create child spans
 * const dbSpan = transaction.startChild({
 *   op: 'db.query',
 *   description: 'SELECT * FROM users',
 * })
 * dbSpan.finish()
 *
 * transaction.finish()
 *
 * // Or use the convenient startSpan helper
 * await Sentry.startSpan({ name: 'my-operation', op: 'task' }, async (span) => {
 *   // Your code here
 *   return result
 * })
 * ```
 *
 * @example With beforeSend Hook
 * ```typescript
 * import * as Sentry from '@dotdo/sentry'
 *
 * Sentry.init({
 *   dsn: env.SENTRY_DSN,
 *   beforeSend(event, hint) {
 *     // Filter out certain errors
 *     if (event.message?.includes('ResizeObserver')) {
 *       return null // Drop the event
 *     }
 *
 *     // Modify the event
 *     event.tags = { ...event.tags, custom: 'value' }
 *     return event
 *   },
 * })
 * ```
 *
 * @example Cloudflare Worker Integration
 * ```typescript
 * import * as Sentry from '@dotdo/sentry'
 *
 * export default {
 *   async fetch(request: Request, env: Env, ctx: ExecutionContext) {
 *     Sentry.init({
 *       dsn: env.SENTRY_DSN,
 *       environment: env.ENVIRONMENT,
 *       release: env.RELEASE,
 *     })
 *
 *     try {
 *       return await handleRequest(request, env)
 *     } catch (error) {
 *       Sentry.captureException(error)
 *       ctx.waitUntil(Sentry.flush(2000))
 *       throw error
 *     }
 *   },
 * }
 * ```
 *
 * @see https://docs.sentry.io/platforms/javascript/
 */

// =============================================================================
// Core API
// =============================================================================

export {
  // Initialization
  init,

  // Error capture
  captureException,
  captureMessage,
  captureEvent,

  // Context
  addBreadcrumb,
  setUser,
  setTags,
  setTag,
  setExtra,
  setExtras,
  setContext,

  // Scope
  withScope,
  configureScope,
  getCurrentScope,
  getCurrentHub,

  // Lifecycle
  flush,
  close,

  // Classes
  Scope,
  SentryClient,
  FetchTransport,
  InMemoryTransport,

  // Utilities
  parseDsn,

  // Test utilities
  _clear,
  _getHub,
} from './sentry.js'

// =============================================================================
// Performance Tracing
// =============================================================================

export {
  // Transaction & Span
  startTransaction,
  startSpan,
  getActiveSpan,
  getActiveTransaction,
  continueTrace,

  // Types
  type Transaction,
  type Span,
  type SpanContext,
  type TransactionContext,
  type SpanStatus,
  type Measurement,
  type ContinueTraceOptions,
} from './transactions.js'

// =============================================================================
// Breadcrumbs Module
// =============================================================================

export {
  // Manager
  BreadcrumbManager,

  // Factory functions
  createHttpBreadcrumb,
  createNavigationBreadcrumb,
  createConsoleBreadcrumb,
  createClickBreadcrumb,
  createErrorBreadcrumb,
  createQueryBreadcrumb,
  createBreadcrumb,

  // Wrappers
  createFetchBreadcrumbWrapper,
  createConsoleBreadcrumbWrapper,

  // Types
  type BreadcrumbManagerConfig,
  type HttpBreadcrumbOptions,
  type NavigationBreadcrumbOptions,
  type ClickBreadcrumbOptions,
  type QueryBreadcrumbOptions,
  type AutoBreadcrumbConfig,
} from './breadcrumbs.js'

// =============================================================================
// Capture Module
// =============================================================================

export {
  // Utilities
  createEventId,
  extractStackFrames,
  normalizeException,
  normalizeExceptionChain,
  serializeError,
  createBaseEvent,
  createExceptionEvent,
  createMessageEvent,
  createCheckInId,
  createCheckInItem,
  createExceptionHint,
  createMessageHint,
  parseRateLimitHeaders,
  filterPII,

  // Types
  type ExceptionMechanism,
  type CheckInStatus,
  type CheckInOptions,
  type SerializedError,
  type RateLimitInfo,
} from './capture.js'

// =============================================================================
// Client Module (with Storage)
// =============================================================================

export {
  // Classes
  SentryClientWithStorage,
  BatchingTransport,

  // Factory
  createStorageClient,

  // Types
  type StorageClientOptions,
  type BatchingOptions,
  type StorageClientFactoryOptions,
} from './client.js'

// =============================================================================
// Check-In (Cron Monitoring)
// =============================================================================

import { createCheckInItem as _createCheckInItem, type CheckInOptions as _CheckInOptions } from './capture.js'

/**
 * Capture a cron check-in.
 */
export function captureCheckIn(options: _CheckInOptions): string {
  const { checkInId } = _createCheckInItem(options)
  // In a full implementation, this would send the check-in via transport
  return checkInId
}

// =============================================================================
// Types
// =============================================================================

export type {
  // Severity
  SeverityLevel,
  BreadcrumbType,

  // User & Context
  User,
  Context,
  Tags,
  Extras,

  // Breadcrumbs
  Breadcrumb,
  BreadcrumbHint,

  // Events
  SentryEvent,
  EventHint,
  StackFrame,
  Stacktrace,
  ExceptionValue,

  // Scope
  Scope as ScopeInterface,

  // Transport
  Transport,
  TransportResult,
  TransportOptions,
  Envelope,
  EnvelopeItem,
  EnvelopeItemType,
  EnvelopeItemHeader,
  EnvelopeHeader,

  // Integration
  Integration,

  // Options
  SentryOptions,
  ParsedDsn,

  // Client
  SentryClient as SentryClientInterface,
  Hub,
} from './types.js'

// =============================================================================
// Default Export
// =============================================================================

// Export init as default for convenience
export { init as default } from './sentry.js'
