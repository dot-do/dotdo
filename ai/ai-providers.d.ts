/**
 * Type declarations for the optional ai-providers module.
 * This module may not be installed - it's dynamically imported with a fallback.
 *
 * These types mirror the exports from primitives/packages/ai-providers
 */
declare module 'ai-providers' {
  import type { LanguageModel, EmbeddingModel, Provider, ProviderRegistryProvider } from 'ai'

  // ============================================================================
  // Registry types and functions (from registry.ts)
  // ============================================================================

  /**
   * Available provider IDs
   */
  export type ProviderId = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'cloudflare' | 'bedrock'

  /**
   * Providers that get direct SDK access (not via openrouter)
   */
  export type DirectProvider = 'openai' | 'anthropic' | 'google'

  /**
   * Provider configuration options
   */
  export interface ProviderConfig {
    /** Cloudflare AI Gateway URL */
    gatewayUrl?: string
    /** AI Gateway auth token */
    gatewayToken?: string
    /** Use llm.do WebSocket transport */
    useWebSocket?: boolean
    /** llm.do WebSocket URL */
    llmUrl?: string
    /** OpenAI API key */
    openaiApiKey?: string
    /** Anthropic API key */
    anthropicApiKey?: string
    /** Google AI API key */
    googleApiKey?: string
    /** OpenRouter API key */
    openrouterApiKey?: string
    /** Cloudflare Account ID */
    cloudflareAccountId?: string
    /** Cloudflare API Token */
    cloudflareApiToken?: string
    /** Custom base URLs */
    baseUrls?: Partial<Record<ProviderId, string>>
  }

  /**
   * Direct providers constant
   */
  export const DIRECT_PROVIDERS: readonly DirectProvider[]

  /**
   * Create a unified provider registry with all configured providers
   */
  export function createRegistry(
    config?: ProviderConfig,
    options?: { providers?: ProviderId[] }
  ): Promise<ProviderRegistryProvider>

  /**
   * Get or create the default provider registry
   */
  export function getRegistry(): Promise<ProviderRegistryProvider>

  /**
   * Configure the default registry with custom settings
   */
  export function configureRegistry(config: ProviderConfig): Promise<void>

  /**
   * Get a language model with smart routing
   */
  export function model(id: string): Promise<LanguageModel>

  /**
   * Get an embedding model from the default registry
   */
  export function embeddingModel(id: string): Promise<EmbeddingModel<string>>

  // ============================================================================
  // LLM WebSocket types and functions (from llm.do.ts)
  // ============================================================================

  /**
   * llm.do configuration
   */
  export interface LLMConfig {
    /** llm.do WebSocket URL (default: wss://llm.do/ws) */
    url?: string
    /** Authentication token (DO_TOKEN) */
    token: string
    /** Auto-reconnect on disconnect (default: true) */
    autoReconnect?: boolean
    /** Max reconnect attempts (default: 5) */
    maxReconnectAttempts?: number
    /** Reconnect delay in ms (default: 1000) */
    reconnectDelay?: number
  }

  /**
   * WebSocket message types (Cloudflare AI Gateway protocol)
   */
  export interface UniversalRequest {
    type: 'universal.create'
    request: {
      eventId: string
      provider: string
      endpoint: string
      headers?: Record<string, string>
      query?: Record<string, unknown>
    }
  }

  export interface UniversalCreated {
    type: 'universal.created'
    eventId: string
    metadata?: {
      cacheStatus?: string
      requestId?: string
    }
    response: {
      status: number
      headers?: Record<string, string>
      body: unknown
    }
  }

  export interface UniversalStream {
    type: 'universal.stream'
    eventId: string
    chunk: string | unknown
  }

  export interface UniversalDone {
    type: 'universal.done'
    eventId: string
    metadata?: {
      cacheStatus?: string
      requestId?: string
      usage?: {
        promptTokens?: number
        completionTokens?: number
        totalTokens?: number
      }
    }
  }

  export interface UniversalError {
    type: 'universal.error'
    eventId: string
    error: {
      message: string
      code?: string
    }
  }

  export type GatewayMessage = UniversalCreated | UniversalStream | UniversalDone | UniversalError

  /**
   * llm.do WebSocket client
   */
  export class LLM {
    readonly config: Required<LLMConfig>

    constructor(config: LLMConfig)

    /** Get the WebSocket URL */
    get wsUrl(): string

    /** Get current connection state */
    get connectionState(): 'disconnected' | 'connecting' | 'connected' | 'closed'

    /** Check if connected */
    get isConnected(): boolean

    /** Connect to llm.do */
    connect(): Promise<void>

    /** Fetch-compatible interface that routes through llm.do */
    fetch(url: string | URL, init?: RequestInit): Promise<Response>

    /** Create a fetch function bound to this connection */
    createFetch(): typeof fetch

    /** Close the WebSocket connection */
    close(): void
  }

  /**
   * Get or create the default llm.do connection
   */
  export function getLLM(config?: LLMConfig): LLM

  /**
   * Create a fetch function that uses llm.do WebSocket
   */
  export function createLLMFetch(config?: LLMConfig): typeof fetch

  // ============================================================================
  // Re-exported AI SDK types
  // ============================================================================

  export type { Provider, ProviderRegistryProvider }
}
