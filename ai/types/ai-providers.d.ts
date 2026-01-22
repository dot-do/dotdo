/**
 * Type declaration for the optional ai-providers module.
 *
 * This module is an optional dependency used for actual AI model resolution.
 * When not installed, the @dotdo/ai package falls back to mock models.
 */
declare module 'ai-providers' {
  /**
   * Resolve a model ID to a LanguageModel instance
   */
  export function model(modelId: string): Promise<unknown>

  /**
   * Resolve a model name to an EmbeddingModel instance
   */
  export function embeddingModel(modelName: string): Promise<unknown>
}
