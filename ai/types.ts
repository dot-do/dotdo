/**
 * Centralized Type Definitions for @dotdo/ai
 *
 * This file serves as the single source of truth for core AI types
 * to prevent duplication across the module.
 *
 * @see do-b3no - Centralize Provider type definition
 */

// ============================================================================
// Provider Types
// ============================================================================

/**
 * Core AI provider identifiers supported by the routing and tracking modules.
 *
 * These are the primary providers with direct SDK integration:
 * - openai: OpenAI GPT models
 * - anthropic: Anthropic Claude models
 * - google: Google Gemini models
 * - cloudflare: Cloudflare Workers AI models
 *
 * Note: For extended provider support (openrouter, bedrock), see ProviderId
 * in providers/index.ts which is a superset of this type.
 */
export type Provider = 'openai' | 'anthropic' | 'google' | 'cloudflare'

/**
 * Base provider configuration used across routing and context modules.
 * This is the minimal configuration needed to identify and authenticate
 * with a provider.
 */
export interface ProviderConfig {
  provider: Provider
  apiKey?: string
  accountId?: string
  defaultModel?: string
}

/**
 * Capability hints for model selection in routing.
 * Used by the Router to select appropriate models based on task requirements.
 */
export type Capability = 'fast' | 'smart' | 'cheap'

/**
 * Load balancing strategies for multi-provider routing.
 */
export type LoadBalancingStrategy = 'round-robin' | 'random' | 'least-loaded'

// ============================================================================
// Fallback Chain Types
// ============================================================================

/**
 * Configuration for exponential backoff retry behavior.
 */
export interface BackoffConfig {
  /** Initial delay in milliseconds (default: 1000) */
  initialDelay?: number
  /** Multiplier for each retry (default: 2) */
  multiplier?: number
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelay?: number
  /** Add random jitter to prevent thundering herd (default: true) */
  jitter?: boolean
}

/**
 * Circuit breaker configuration for automatic health recovery.
 */
export interface CircuitBreakerConfig {
  /** Number of failures before marking provider unhealthy (default: 3) */
  failureThreshold?: number
  /** Time in milliseconds before retrying unhealthy provider (default: 60000) */
  recoveryTimeout?: number
  /** Number of successful requests to mark provider healthy again (default: 1) */
  successThreshold?: number
}

/**
 * Single entry in a fallback chain with optional model mapping.
 */
export interface FallbackEntry {
  /** The provider to use */
  provider: Provider
  /** Model to use for this provider (fallback model if primary unavailable) */
  model?: string
  /** Priority weight (higher = preferred, default: 1) */
  weight?: number
}

/**
 * Fallback chain configuration for a specific capability or model.
 * Defines an ordered list of providers to try with optional model mappings.
 */
export interface FallbackChainConfig {
  /** Ordered list of providers to try */
  chain: FallbackEntry[]
  /** Maximum retries per provider (default: from RouterConfig) */
  maxRetriesPerProvider?: number
  /** Backoff configuration for this chain */
  backoff?: BackoffConfig
}

/**
 * Complete fallback configuration supporting both simple and capability-based chains.
 */
export interface FallbackConfig {
  /** Default fallback chain for any request */
  default?: FallbackChainConfig | Provider[]
  /** Capability-specific fallback chains */
  byCapability?: Partial<Record<Capability, FallbackChainConfig | Provider[]>>
  /** Model-specific fallback chains (when specific model is requested but unavailable) */
  byModel?: Record<string, FallbackChainConfig | Provider[]>
}

// ============================================================================
// Fallback Error Types
// ============================================================================

/**
 * Details about a single provider failure during fallback chain execution.
 */
export interface ProviderFailureDetail {
  /** The provider that failed */
  provider: Provider | string
  /** The model that was attempted */
  model?: string
  /** The error message from this provider */
  error: string
  /** The error code if available */
  code?: string | number
  /** HTTP status if available */
  status?: number
  /** Timestamp when the failure occurred */
  timestamp: number
  /** Number of retries attempted on this provider */
  retries?: number
}

/**
 * Summary of fallback chain execution for error reporting.
 */
export interface FallbackChainSummary {
  /** All providers that were attempted */
  providersAttempted: (Provider | string)[]
  /** Providers that were skipped due to health/circuit breaker */
  providersSkipped: (Provider | string)[]
  /** Total time spent in fallback chain (ms) */
  totalDuration: number
  /** Detailed failure information for each provider */
  failures: ProviderFailureDetail[]
}
