// ============================================================================
// AI - AI Gateway types and configuration
// ============================================================================

/**
 * AIProvider - Supported AI providers
 */
export type AIProvider = 'workers-ai' | 'openai' | 'anthropic' | 'google'

/**
 * AIConfig - Configuration for AI operations
 */
export interface AIConfig {
  /** The AI provider to use */
  provider: AIProvider

  /** The model identifier */
  model: string

  /** AI Gateway name (optional, for Cloudflare AI Gateway) */
  gateway?: string

  /** Temperature for generation (0-2) */
  temperature?: number

  /** Max tokens to generate */
  maxTokens?: number

  /** System prompt */
  systemPrompt?: string
}

/**
 * AIModelInfo - Information about a specific model
 */
export interface AIModelInfo {
  /** Model identifier */
  id: string

  /** Display name */
  name?: string

  /** Maximum context length */
  contextLength?: number

  /** Whether the model supports vision */
  supportsVision?: boolean

  /** Whether the model supports function calling */
  supportsFunctions?: boolean
}

/**
 * AIProviderModels - Model configuration for a provider
 */
export interface AIProviderModels {
  /** Default model for general use */
  default: string

  /** Default embedding model */
  embedding?: string

  /** Default vision model */
  vision?: string

  /** Fast model for quick operations */
  fast?: string

  /** Additional models by category */
  [key: string]: string | undefined
}

/**
 * AI_MODELS - Default models for each provider
 */
export const AI_MODELS: Record<AIProvider, AIProviderModels> = {
  'workers-ai': {
    default: '@cf/meta/llama-3.1-70b-instruct',
    fast: '@cf/meta/llama-3.1-8b-instruct',
    embedding: '@cf/baai/bge-base-en-v1.5',
    code: '@cf/meta/codellama-70b-instruct',
  },
  'openai': {
    default: 'gpt-4o',
    fast: 'gpt-4o-mini',
    embedding: 'text-embedding-3-small',
    vision: 'gpt-4o',
    code: 'gpt-4o',
  },
  'anthropic': {
    default: 'claude-sonnet-4-20250514',
    fast: 'claude-3-5-haiku-20241022',
    vision: 'claude-sonnet-4-20250514',
    code: 'claude-sonnet-4-20250514',
  },
  'google': {
    default: 'gemini-1.5-pro',
    fast: 'gemini-1.5-flash',
    embedding: 'text-embedding-004',
    vision: 'gemini-1.5-pro',
  },
}

// ============================================================================
// Validation Types
// ============================================================================

export interface ValidationError {
  field: string
  message: string
}

export interface ValidationResult {
  success: boolean
  errors: ValidationError[]
}

// ============================================================================
// Validation Functions
// ============================================================================

const VALID_PROVIDERS: AIProvider[] = ['workers-ai', 'openai', 'anthropic', 'google']

/**
 * Validates an AIConfig object
 */
export function validateAIConfig(config: AIConfig): ValidationResult {
  const errors: ValidationError[] = []

  // Validate provider
  if (!VALID_PROVIDERS.includes(config.provider)) {
    errors.push({
      field: 'provider',
      message: `provider must be one of: ${VALID_PROVIDERS.join(', ')}`,
    })
  }

  // Validate model
  if (!config.model || config.model.trim() === '') {
    errors.push({
      field: 'model',
      message: 'model is required and must be non-empty',
    })
  }

  // Validate temperature if provided
  if (config.temperature !== undefined) {
    if (typeof config.temperature !== 'number' || config.temperature < 0 || config.temperature > 2) {
      errors.push({
        field: 'temperature',
        message: 'temperature must be a number between 0 and 2',
      })
    }
  }

  // Validate maxTokens if provided
  if (config.maxTokens !== undefined) {
    if (typeof config.maxTokens !== 'number' || config.maxTokens <= 0 || !Number.isInteger(config.maxTokens)) {
      errors.push({
        field: 'maxTokens',
        message: 'maxTokens must be a positive integer',
      })
    }
  }

  return {
    success: errors.length === 0,
    errors,
  }
}

/**
 * Get the default model for a provider
 */
export function getDefaultModel(provider: AIProvider): string {
  return AI_MODELS[provider].default
}

/**
 * Get a specific model type for a provider
 */
export function getModel(provider: AIProvider, type: keyof AIProviderModels = 'default'): string | undefined {
  return AI_MODELS[provider][type]
}
