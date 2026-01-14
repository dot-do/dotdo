/**
 * Base Provider - Abstract base class for LLM providers
 *
 * Provides common functionality for all provider implementations.
 *
 * @module db/primitives/agent-runtime/providers
 */

import type {
  LLMProvider,
  ProviderConfig,
  ProviderName,
  CompletionRequest,
  CompletionResponse,
  Message,
  StreamEvent,
  ModelConfig,
} from '../types'

// ============================================================================
// Abstract Base Provider
// ============================================================================

export abstract class BaseProvider implements LLMProvider {
  readonly name: ProviderName
  readonly config: ProviderConfig

  constructor(config: ProviderConfig) {
    this.name = config.name
    this.config = config
  }

  /** Check if provider supports a model */
  abstract supportsModel(model: string): boolean

  /** Generate a completion */
  abstract complete(request: CompletionRequest): Promise<CompletionResponse>

  /** Stream a completion */
  abstract stream(request: CompletionRequest): AsyncIterable<StreamEvent>

  /** Count tokens for messages */
  abstract countTokens(messages: Message[]): Promise<number>

  /** List available models */
  abstract listModels(): Promise<ModelConfig[]>

  /**
   * Estimate token count using character-based approximation
   * Override in subclasses for more accurate counting
   */
  protected estimateTokens(text: string): number {
    // Rough approximation: ~4 characters per token
    return Math.ceil(text.length / 4)
  }

  /**
   * Measure execution time of an async function
   */
  protected async withLatency<T>(
    fn: () => Promise<T>
  ): Promise<{ result: T; latencyMs: number }> {
    const start = performance.now()
    const result = await fn()
    const latencyMs = Math.round(performance.now() - start)
    return { result, latencyMs }
  }

  /**
   * Convert unified messages to provider format
   */
  protected abstract convertMessages(messages: Message[]): unknown[]

  /**
   * Convert provider response to unified format
   */
  protected abstract parseResponse(raw: unknown): CompletionResponse
}
