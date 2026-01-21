// Integration Types - Third-party integration interface definitions
// Part of the dotdo integration registry system (do-laux)

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

  /**
   * Initialize the integration with configuration
   * @param config - Configuration for the integration
   */
  init(config: TConfig): Promise<void>

  /**
   * Shutdown the integration cleanly
   */
  shutdown?(): Promise<void>

  /**
   * Check if the integration is healthy and connected
   */
  healthCheck?(): Promise<boolean>

  /**
   * Methods exposed by this integration
   */
  readonly methods: TMethods

  /**
   * Handle incoming webhooks from the service
   */
  handleWebhook?(request: Request): Promise<Response>

  /**
   * Register a handler for integration events
   */
  onEvent?(handler: IntegrationWebhookHandler): void
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

/**
 * Context passed to integration method calls
 */
export interface MethodCallContext {
  /** Method name being called */
  method: string
  /** Arguments passed to the method */
  args: unknown[]
  /** Timestamp when the call started */
  timestamp: Date
}

/**
 * Context for error hooks
 */
export interface ErrorContext {
  /** Integration name */
  integration: string
  /** Method name that failed */
  method: string
  /** Arguments passed to the method */
  args?: unknown[]
}

/**
 * Hooks for integration lifecycle and method calls
 */
export interface IntegrationHooks {
  /** Method call hooks */
  onMethodCall?: {
    /** Called before any method is executed */
    before?(context: MethodCallContext): Promise<void> | void
    /** Called after a method completes */
    after?(context: MethodCallContext, result: IntegrationResult): Promise<void> | void
  }
  /** Called when a method fails */
  onError?(error: IntegrationError, context: ErrorContext): Promise<void> | void
  /** Called when the integration is initialized */
  onInit?(): Promise<void> | void
  /** Called when the integration is shutdown */
  onShutdown?(): Promise<void> | void
}
