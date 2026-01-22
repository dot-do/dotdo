/**
 * @dotdo/utils - Shared Utility Functions
 *
 * Provides common utilities used across all dotdo packages:
 *
 * - **Base Error**: Common error base class for consistent error handling
 * - **Logging**: Structured logging with request-scoped configuration
 * - **Proxy Utilities**: Proxy patterns for fluent DSLs ($.on.Noun.verb, $.every.Monday)
 * - **Mixin Types**: TypeScript mixin pattern utilities for composable classes
 * - **Circuit Breaker**: Resilience pattern for protecting against cascading failures
 * - **Environment Config**: Type-safe environment validation with Zod schemas
 * - **Time Constants**: Standardized time durations to avoid magic numbers
 * - **Cookies**: HTTP cookie parsing utilities
 *
 * @example
 * ```typescript
 * import {
 *   DotdoError,
 *   createScopedLogger,
 *   LogLevel,
 *   createDeepRPCProxy,
 *   CircuitBreaker,
 *   validateEnv,
 *   MS_PER_SECOND,
 * } from '@dotdo/utils'
 *
 * // Extend DotdoError in your package
 * class MyPackageError extends DotdoError {
 *   constructor(message: string) {
 *     super('MY_PACKAGE_ERROR', message)
 *     this.name = 'MyPackageError'
 *   }
 * }
 *
 * // Structured logging (request-scoped)
 * const logger = createScopedLogger({
 *   level: LogLevel.DEBUG,
 *   prefix: '[MyService]'
 * })
 * logger.info('Service started', { port: 3000 })
 *
 * // Deep RPC proxy for client.users.create() patterns
 * const client = createDeepRPCProxy({
 *   invoke: async (path, args) => {
 *     return fetch('/rpc', {
 *       method: 'POST',
 *       body: JSON.stringify({ method: path.join('.'), args })
 *     }).then(r => r.json())
 *   }
 * })
 * await client.users.create({ name: 'Alice' })
 *
 * // Circuit breaker for resilience
 * const breaker = new CircuitBreaker({
 *   name: 'payment-service',
 *   failureThreshold: 5,
 *   resetTimeoutMs: 30 * MS_PER_SECOND
 * })
 * const result = await breaker.execute(() => processPayment(order))
 *
 * // Environment validation with Zod
 * const env = validateEnv(MyEnvSchema, process.env)
 * ```
 *
 * @module @dotdo/utils
 */

/**
 * Base error class for consistent error handling across packages.
 * Provides error codes, cause chaining, and JSON serialization.
 */
export * from './base-error'

/**
 * Structured logging with request-scoped configuration.
 * Supports log levels, prefixes, and AsyncLocalStorage-based context.
 */
export * from './logger'

/**
 * TypeScript mixin pattern utilities.
 * Provides Constructor, MixinInstance, and ComposedType helpers.
 */
export * from './mixin-types'

/**
 * Proxy utilities for fluent DSL patterns.
 * Includes deep RPC proxies, event handler proxies, and schedule DSL proxies.
 */
export * from './proxy'

/**
 * Standardized time constants to avoid magic numbers.
 * Includes MS_PER_SECOND, MS_PER_MINUTE, and common timeout defaults.
 */
export * from './time-constants'

/**
 * Circuit breaker pattern for resilience.
 * Protects against cascading failures with CLOSED/OPEN/HALF_OPEN states.
 */
export * from './circuit-breaker'

/**
 * Type-safe environment validation with Zod schemas.
 * Includes common schemas for ports, URLs, API keys, and dotdo-specific configs.
 */
export * from './env-config'

/**
 * HTTP cookie parsing utilities.
 * Parse cookies from Cookie headers for auth and session handling.
 */
export * from './cookies'
