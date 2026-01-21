// Integration Types - Third-party integration interface definitions
// Part of the dotdo integration registry system (do-laux)
// Integration hooks pattern standardized in do-07dn

/**
 * Configuration for initializing an integration
 */
export interface IntegrationConfig {
  /** API key or credentials for the service */
  apiKey?: string
  /** Secret key for authenticated requests */
  secretKey?: string
  /** API version to use */
  apiVersion?: string
  /** Base URL override for the API */
  baseUrl?: string
  /** Environment (production, sandbox, test) */
  environment?: 'production' | 'sandbox' | 'test'
  /** Timeout in milliseconds */
  timeout?: number
  /** Additional service-specific configuration */
  [key: string]: unknown
}

// ============================================================================
// Integration Hooks Pattern (do-07dn)
// ============================================================================
//
// All integrations MUST implement the following hooks consistently:
//
// LIFECYCLE HOOKS (required):
// - init(config): Initialize the integration
// - shutdown(): Clean up resources
// - healthCheck(): Verify connectivity
//
// EVENT HOOKS (required for webhook-capable integrations):
// - handleWebhook(request): Process incoming webhooks
// - onEvent(handler): Register event listeners
//
// METHOD HOOKS (optional, for observability):
// - onMethodCall(hook): Called before/after method execution
// - onError(handler): Centralized error handling
//
// ============================================================================

/**
 * Hook called before and after integration method calls.
 * Provides observability into integration operations.
 */
export interface MethodCallHook {
  /** Called before method execution */
  before?: (context: MethodCallContext) => void | Promise<void>
  /** Called after method execution (success or failure) */
  after?: (context: MethodCallContext, result: IntegrationResult) => void | Promise<void>
}

/**
 * Context passed to method call hooks
 */
export interface MethodCallContext {
  /** Name of the method being called */
  method: string
  /** Arguments passed to the method */
  args: unknown[]
  /** Timestamp when the method was called */
  timestamp: Date
  /** Optional correlation ID for tracing */
  correlationId?: string
}

/**
 * Error handler for integration errors
 */
export type IntegrationErrorHandler = (error: IntegrationError, context: {
  integration: string
  method?: string
  args?: unknown[]
}) => void | Promise<void>

/**
 * Hooks configuration for integrations
 */
export interface IntegrationHooks {
  /** Hook for method calls (before/after) */
  onMethodCall?: MethodCallHook
  /** Centralized error handler */
  onError?: IntegrationErrorHandler
}

/**
 * Status of an integration
 */
export type IntegrationStatus = 'uninitialized' | 'initializing' | 'ready' | 'error' | 'disabled'

/**
 * Integration metadata for registry
 */
export interface IntegrationMetadata {
  /** Display name for the integration */
  displayName: string
  /** Description of what this integration provides */
  description: string
  /** Category of the integration */
  category: IntegrationCategory
  /** URL to integration documentation */
  docsUrl?: string
  /** URL to the service's website */
  websiteUrl?: string
  /** Required configuration fields */
  requiredConfig: string[]
  /** Optional configuration fields */
  optionalConfig?: string[]
}

/**
 * Categories of integrations
 */
export type IntegrationCategory =
  | 'payments'
  | 'email'
  | 'sms'
  | 'storage'
  | 'database'
  | 'analytics'
  | 'auth'
  | 'ai'
  | 'messaging'
  | 'crm'
  | 'logging'
  | 'monitoring'
  | 'other'

/**
 * Result of an integration method call
 */
export type IntegrationResult<T = unknown> =
  | { success: true; data: T; error?: undefined; requestId?: string; duration?: number }
  | { success: false; data?: undefined; error: IntegrationError; requestId?: string; duration?: number }

/**
 * Error from an integration
 */
export interface IntegrationError {
  code: string
  message: string
  /** Original error from the service */
  originalError?: unknown
  /** Whether this error is retryable */
  retryable?: boolean
}

/**
 * Event emitted by an integration
 */
export interface IntegrationEvent<T = unknown> {
  /** Integration name that emitted the event */
  integration: string
  /** Type of event */
  type: string
  /** Event payload */
  payload: T
  /** Timestamp of the event */
  timestamp: Date
  /** External webhook ID if applicable */
  webhookId?: string | undefined
}

/**
 * Webhook handler for integration events
 */
export type IntegrationWebhookHandler<T = unknown> = (
  event: IntegrationEvent<T>
) => Promise<void> | void

/**
 * Base methods type for integrations
 */
export type IntegrationMethods = {
  [key: string]: (...args: any[]) => Promise<IntegrationResult>
}

/**
 * Core Integration interface
 * All third-party integrations must implement this interface
 *
 * ## Hooks Pattern (do-07dn)
 *
 * Integrations implement a consistent hooks pattern:
 *
 * ### Required Lifecycle Hooks
 * - `init(config)`: Initialize with configuration
 * - `shutdown()`: Clean up resources (optional but recommended)
 * - `healthCheck()`: Verify connectivity (optional but recommended)
 *
 * ### Event Hooks (for webhook-capable integrations)
 * - `handleWebhook(request)`: Process incoming webhooks
 * - `onEvent(handler)`: Register event listeners
 *
 * ### Observability Hooks (optional)
 * - `setHooks(hooks)`: Configure method call and error hooks
 *
 * @example
 * ```typescript
 * const stripe = createStripeIntegration()
 *
 * // Set up observability hooks
 * stripe.setHooks?.({
 *   onMethodCall: {
 *     before: (ctx) => console.log(`Calling ${ctx.method}`),
 *     after: (ctx, result) => console.log(`${ctx.method} completed`)
 *   },
 *   onError: (error, ctx) => reportError(error, ctx)
 * })
 *
 * // Register event handlers
 * stripe.onEvent?.((event) => {
 *   if (event.type === 'payment_intent.succeeded') {
 *     // Handle successful payment
 *   }
 * })
 *
 * await stripe.init(config)
 * ```
 */
export interface Integration<
  TConfig extends IntegrationConfig = IntegrationConfig,
  TMethods extends IntegrationMethods = IntegrationMethods
> {
  /** Unique identifier for this integration */
  readonly name: string
  /** Version of the integration implementation */
  readonly version: string
  /** Metadata about the integration */
  readonly metadata: IntegrationMetadata
  /** Current status of the integration */
  readonly status: IntegrationStatus

  // ============================================================================
  // LIFECYCLE HOOKS (required)
  // ============================================================================

  /**
   * Initialize the integration with configuration.
   * Must set status to 'ready' on success or 'error' on failure.
   * @param config - Configuration for the integration
   */
  init(config: TConfig): Promise<void>

  /**
   * Shutdown the integration cleanly.
   * Should reset status to 'uninitialized' and clean up resources.
   */
  shutdown?(): Promise<void>

  /**
   * Check if the integration is healthy and connected.
   * Returns true if the integration can successfully communicate with the service.
   */
  healthCheck?(): Promise<boolean>

  // ============================================================================
  // METHODS
  // ============================================================================

  /**
   * Methods exposed by this integration.
   * All methods should return IntegrationResult for consistent error handling.
   */
  readonly methods: TMethods

  // ============================================================================
  // EVENT HOOKS (for webhook-capable integrations)
  // ============================================================================

  /**
   * Handle incoming webhooks from the service.
   * Should verify signatures, parse events, and dispatch to registered handlers.
   */
  handleWebhook?(request: Request): Promise<Response>

  /**
   * Register a handler for integration events.
   * Events are emitted when webhooks are received or internal events occur.
   */
  onEvent?(handler: IntegrationWebhookHandler): void

  // ============================================================================
  // OBSERVABILITY HOOKS (optional)
  // ============================================================================

  /**
   * Configure observability hooks for method calls and errors.
   * Allows intercepting method calls for logging, metrics, and error handling.
   */
  setHooks?(hooks: IntegrationHooks): void
}

/**
 * Factory function type for creating integrations
 */
export type IntegrationFactory<
  TConfig extends IntegrationConfig = IntegrationConfig,
  TIntegration extends Integration<TConfig> = Integration<TConfig>
> = () => TIntegration

/**
 * Options for registering an integration
 */
export interface RegisterIntegrationOptions {
  /** Whether to auto-initialize when config is available */
  autoInit?: boolean
  /** Priority for initialization order (lower = earlier) */
  priority?: number
}

/**
 * Registered integration entry in the registry
 */
export interface RegisteredIntegration<TConfig extends IntegrationConfig = IntegrationConfig> {
  integration: Integration<TConfig>
  options: RegisterIntegrationOptions
  config?: TConfig
}
