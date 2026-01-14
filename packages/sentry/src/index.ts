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
 * - In-memory backend for testing
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

  // Utilities
  parseDsn,

  // Test utilities
  _clear,
  _getHub,
} from './sentry.js'

// =============================================================================
// Transport
// =============================================================================

export {
  FetchTransport,
  InMemoryTransport,
} from './transport.js'

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

  // Types
  type BreadcrumbManagerConfig,
  type HttpBreadcrumbOptions,
  type NavigationBreadcrumbOptions,
  type ClickBreadcrumbOptions,
  type QueryBreadcrumbOptions,
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

  // Types
  type ExceptionMechanism,
  type SerializedError,
} from './capture.js'

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
  ScopeInterface,

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
  SentryClientInterface,
  Hub,
} from './types.js'

// =============================================================================
// Default Export
// =============================================================================

// Export init as default for convenience
export { init as default } from './sentry.js'
