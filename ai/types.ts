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
