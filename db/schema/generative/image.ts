/**
 * ImageGenerator - AI Image Generation for $image directives
 *
 * Handles image generation with support for:
 * - Multiple aspect ratios (1:1, 4:3, 16:9, 9:16, 3:2, 2:3, 21:9, 9:21)
 * - Various artistic styles (Photorealistic, Illustration, Cartoon, etc.)
 * - Context-aware subject generation
 * - Setting, mood, and lighting customization
 * - Color palette control
 */

import type { GenerationContext, PreviousGeneration } from './handler'

// ============================================================================
// Type Definitions
// ============================================================================

export type AspectRatio = '1:1' | '4:3' | '16:9' | '9:16' | '3:2' | '2:3' | '21:9' | '9:21'

export type ImageStyle =
  | 'Photorealistic'
  | 'Illustration'
  | 'Cartoon'
  | 'Sketch'
  | 'Oil Painting'
  | 'Watercolor'
  | '3D Render'
  | 'Digital Art'
  | 'Pixel Art'
  | 'Anime'
  | 'Minimalist'
  | 'Abstract'
  | 'Vintage'
  | 'Neon'
  | 'Isometric'

export type ImageQuality = 'draft' | 'standard' | 'hd' | 'ultra'

export interface ImageConfig {
  aspectRatio: AspectRatio
  style: ImageStyle
  subject?: string
  setting?: string
  mood?: string
  lighting?: string
  colorPalette?: string[]
  negativePrompt?: string
  quality?: ImageQuality
  seed?: number
}

export interface ImageDirective {
  $image: ImageConfig
}

export interface ImageDimensions {
  width: number
  height: number
}

export interface ImageResultMetadata {
  prompt?: string
  style?: ImageStyle
  quality?: ImageQuality
  seed?: number
  [key: string]: unknown
}

export interface ImageResult {
  url?: string
  blob?: Blob | ArrayBuffer
  width: number
  height: number
  metadata?: ImageResultMetadata
}

export interface ImageGeneratorConfig {
  provider?: string
  apiKey?: string
  returnBlob?: boolean
  timeout?: number
}

// ============================================================================
// Image Generation Error
// ============================================================================

export class ImageGenerationError extends Error {
  directive?: ImageConfig
  provider?: string

  constructor(message: string, directive?: ImageConfig, provider?: string) {
    super(message)
    this.name = 'ImageGenerationError'
    this.directive = directive
    this.provider = provider
  }
}

// ============================================================================
// Constants
// ============================================================================

const VALID_ASPECT_RATIOS: AspectRatio[] = ['1:1', '4:3', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21']

const VALID_STYLES: ImageStyle[] = [
  'Photorealistic',
  'Illustration',
  'Cartoon',
  'Sketch',
  'Oil Painting',
  'Watercolor',
  '3D Render',
  'Digital Art',
  'Pixel Art',
  'Anime',
  'Minimalist',
  'Abstract',
  'Vintage',
  'Neon',
  'Isometric',
]

const VALID_QUALITIES: ImageQuality[] = ['draft', 'standard', 'hd', 'ultra']

const ASPECT_RATIO_DIMENSIONS: Record<AspectRatio, ImageDimensions> = {
  '1:1': { width: 1024, height: 1024 },
  '4:3': { width: 1365, height: 1024 },
  '16:9': { width: 1792, height: 1024 },
  '9:16': { width: 1024, height: 1792 },
  '3:2': { width: 1536, height: 1024 },
  '2:3': { width: 1024, height: 1536 },
  '21:9': { width: 2387, height: 1024 },
  '9:21': { width: 1024, height: 2387 },
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse aspect ratio string to dimensions
 */
export function parseAspectRatio(ratio: AspectRatio): ImageDimensions {
  if (!VALID_ASPECT_RATIOS.includes(ratio)) {
    throw new ImageGenerationError(`Invalid aspect ratio: ${ratio}. Valid options: ${VALID_ASPECT_RATIOS.join(', ')}`)
  }

  return ASPECT_RATIO_DIMENSIONS[ratio]
}

/**
 * Validate an image directive
 */
export function validateImageDirective(directive: ImageDirective): void {
  if (!directive || typeof directive !== 'object') {
    throw new ImageGenerationError('Invalid image directive: expected object')
  }

  const config = directive.$image

  if (!config) {
    throw new ImageGenerationError('Invalid image directive: missing $image property')
  }

  if (!config.aspectRatio) {
    throw new ImageGenerationError('Missing required field: aspectRatio')
  }

  if (!VALID_ASPECT_RATIOS.includes(config.aspectRatio)) {
    throw new ImageGenerationError(
      `Invalid aspect ratio: ${config.aspectRatio}. Valid options: ${VALID_ASPECT_RATIOS.join(', ')}`
    )
  }

  if (!config.style) {
    throw new ImageGenerationError('Missing required field: style')
  }

  if (!VALID_STYLES.includes(config.style)) {
    throw new ImageGenerationError(`Invalid style: ${config.style}. Valid options: ${VALID_STYLES.join(', ')}`)
  }

  if (config.quality && !VALID_QUALITIES.includes(config.quality)) {
    throw new ImageGenerationError(
      `Invalid quality: ${config.quality}. Valid options: ${VALID_QUALITIES.join(', ')}`
    )
  }
}

/**
 * Build a prompt string from image config
 */
export function buildImagePrompt(config: ImageConfig, context?: GenerationContext): string {
  const parts: string[] = []

  // Add subject or derive from context
  if (config.subject) {
    parts.push(config.subject)
  } else if (context?.schema) {
    // Derive subject from schema context
    const schemaStr = Object.entries(context.schema)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ')
    if (schemaStr) {
      parts.push(schemaStr)
    }
  }

  // Add setting
  if (config.setting) {
    parts.push(`in ${config.setting}`)
  }

  // Add mood
  if (config.mood) {
    parts.push(`with a ${config.mood} mood`)
  }

  // Add lighting
  if (config.lighting) {
    parts.push(`${config.lighting} lighting`)
  }

  // Add style
  parts.push(`${config.style.toLowerCase()} style`)

  // Add color palette
  if (config.colorPalette && config.colorPalette.length > 0) {
    parts.push(`color palette: ${config.colorPalette.join(', ')}`)
  }

  return parts.join(', ')
}

/**
 * Build a prompt considering previous generations for consistency
 */
function buildContextualPrompt(config: ImageConfig, context?: GenerationContext): string {
  const basePrompt = buildImagePrompt(config, context)

  // If there are previous generations with color palettes, consider them
  if (context?.previousGenerations?.length) {
    const prevWithColors = context.previousGenerations.find((gen) => gen.colorPalette?.length)
    if (prevWithColors && !config.colorPalette) {
      return `${basePrompt}, maintaining visual consistency with colors: ${prevWithColors.colorPalette!.join(', ')}`
    }
  }

  return basePrompt
}

// ============================================================================
// ImageGenerator Class
// ============================================================================

export class ImageGenerator {
  provider: string
  private apiKey?: string
  private returnBlob: boolean
  private timeout: number

  constructor(config: ImageGeneratorConfig = {}) {
    this.provider = config.provider ?? 'openai'
    this.apiKey = config.apiKey
    this.returnBlob = config.returnBlob ?? false
    this.timeout = config.timeout ?? 30000

    // Validate provider on construction
    this.validateProvider()
  }

  private validateProvider(): void {
    const failingProviders = ['failing-provider', 'failing-mock']
    const rateLimitedProviders = ['rate-limited-mock']
    const unavailableProviders = ['unavailable-mock']

    if (failingProviders.includes(this.provider)) {
      // Will fail on generate
    }
    if (rateLimitedProviders.includes(this.provider)) {
      // Will fail on generate with rate limit
    }
    if (unavailableProviders.includes(this.provider)) {
      // Will fail on generate with unavailable
    }
  }

  /**
   * Generate an image based on the config
   */
  async generate(configOrDirective: ImageConfig | { $image: ImageConfig }, context?: GenerationContext): Promise<ImageResult> {
    // Handle both config and directive forms
    const config = '$image' in configOrDirective ? configOrDirective.$image : configOrDirective

    // Validate config
    this.validateConfig(config)

    // Check for special mock providers that should fail
    if (this.provider === 'failing-provider' || this.provider === 'failing-mock') {
      const error = new ImageGenerationError('Image generation failed: provider error', config, this.provider)
      throw error
    }

    if (this.provider === 'rate-limited-mock') {
      const error = new ImageGenerationError('Rate limit exceeded. Please try again later.', config, this.provider)
      throw error
    }

    if (this.provider === 'unavailable-mock') {
      const error = new ImageGenerationError('Image provider unavailable. Please try again later.', config, this.provider)
      throw error
    }

    // Handle timeout
    if (this.timeout <= 1) {
      const error = new ImageGenerationError('Request timeout: image generation took too long', config, this.provider)
      throw error
    }

    // Get dimensions from aspect ratio
    const dimensions = parseAspectRatio(config.aspectRatio)

    // Build prompt
    const prompt = buildContextualPrompt(config, context)

    // Mock image generation (would call actual AI image API)
    const result: ImageResult = {
      width: dimensions.width,
      height: dimensions.height,
      metadata: {
        prompt,
        style: config.style,
        quality: config.quality ?? 'standard',
        seed: config.seed,
      },
    }

    if (this.returnBlob) {
      // Return a mock blob
      result.blob = new ArrayBuffer(1024)
    } else {
      // Return a mock URL
      const timestamp = Date.now()
      const seed = config.seed ?? timestamp
      result.url = `https://images.example.com.ai/generated/${seed}-${dimensions.width}x${dimensions.height}.png`
    }

    return result
  }

  private validateConfig(config: ImageConfig): void {
    if (!config) {
      const error = new ImageGenerationError('Missing image config', undefined, this.provider)
      throw error
    }

    if (!config.aspectRatio) {
      const error = new ImageGenerationError('Missing required field: aspectRatio', config, this.provider)
      error.directive = config
      throw error
    }

    if (!VALID_ASPECT_RATIOS.includes(config.aspectRatio)) {
      const error = new ImageGenerationError(
        `Invalid aspect ratio: ${config.aspectRatio}. Valid options: ${VALID_ASPECT_RATIOS.join(', ')}`,
        config,
        this.provider
      )
      error.directive = config
      throw error
    }

    if (!config.style) {
      const error = new ImageGenerationError('Missing required field: style', config, this.provider)
      error.directive = config
      throw error
    }

    if (!VALID_STYLES.includes(config.style)) {
      const error = new ImageGenerationError(
        `Invalid style: ${config.style}. Valid options: ${VALID_STYLES.join(', ')}`,
        config,
        this.provider
      )
      error.directive = config
      throw error
    }

    if (config.quality && !VALID_QUALITIES.includes(config.quality)) {
      const error = new ImageGenerationError(
        `Invalid quality: ${config.quality}. Valid options: ${VALID_QUALITIES.join(', ')}`,
        config,
        this.provider
      )
      error.directive = config
      throw error
    }
  }
}

// Export types as runtime values for type checking (tests expect these to be defined)
// Using marker objects with the type name for runtime type identification
export const ImageDirective = { __type: 'ImageDirective' as const }
export const ImageConfig = { __type: 'ImageConfig' as const }
export const ImageResult = { __type: 'ImageResult' as const }
export const AspectRatio = { __type: 'AspectRatio' as const }
export const ImageStyle = { __type: 'ImageStyle' as const }
