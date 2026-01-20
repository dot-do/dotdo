/**
 * Type declarations for the optional ai-providers module.
 * This module may not be installed - it's dynamically imported with a fallback.
 */
declare module 'ai-providers' {
  import type { LanguageModel, EmbeddingModel } from 'ai'

  /**
   * Get a language model by ID or alias
   */
  export function model(id: string): Promise<LanguageModel>

  /**
   * Get an embedding model by ID or alias
   */
  export function embeddingModel(id: string): Promise<EmbeddingModel<string>>
}
