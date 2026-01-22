/**
 * Type declarations for the optional ai-providers module.
 *
 * This file provides type information for TypeScript compilation when
 * the ai-providers module may not be installed (it's an optional dependency).
 *
 * @module ai-providers
 */

declare module 'ai-providers' {
  /**
   * Minimal LanguageModel interface for type checking.
   * The actual ai-providers module provides more complete types.
   */
  export interface LanguageModel {
    provider: string
    modelId: string
    specificationVersion: string
  }

  /**
   * Minimal EmbeddingModel interface for type checking.
   */
  export interface EmbeddingModel {
    provider: string
    modelId: string
    specificationVersion: string
  }

  /**
   * Resolve a model ID to a LanguageModel instance.
   */
  export function model(modelId: string): Promise<LanguageModel>

  /**
   * Resolve a model ID to an EmbeddingModel instance.
   */
  export function embeddingModel(modelId: string): Promise<EmbeddingModel>
}
