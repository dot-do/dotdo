// Type declaration for optional ai-providers module
// This allows TypeScript to compile even when the module is not installed

declare module 'ai-providers' {
  import type { LanguageModel, EmbeddingModel } from '../types'

  export function model(modelId: string): Promise<LanguageModel>
  export function embeddingModel(modelId: string): Promise<EmbeddingModel>
}
