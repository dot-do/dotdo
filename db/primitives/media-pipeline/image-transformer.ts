/**
 * Image Transformer - Stub Implementation
 *
 * This is a stub file to make the TDD RED tests compile.
 * All functions will throw "Not implemented" errors.
 *
 * Implementation TODO:
 * - Use Workers Image Resizing API for production
 * - Consider sharp-wasm or @cf/image/process for edge environments
 * - Support all CloudFlare image transformation options
 *
 * @see https://developers.cloudflare.com/images/transform-images/transform-via-workers/
 */

// =============================================================================
// Types
// =============================================================================

export type OutputFormat = 'jpeg' | 'jpg' | 'png' | 'webp' | 'avif' | 'gif'

export type FitMode = 'contain' | 'cover' | 'scale-down' | 'pad' | 'crop'

export type GravityPosition =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'face'
  | 'faces'
  | 'entropy'
  | 'attention'
  | 'auto'

export interface ImageMetadata {
  width: number
  height: number
  format: OutputFormat
  size: number
  hasAlpha: boolean
  colorSpace?: string
}

export interface ResizeOptions {
  width?: number
  height?: number
  fit?: FitMode
  allowUpscale?: boolean
  background?: string
}

export interface CropOptions {
  x?: number | string
  y?: number | string
  width?: number | string
  height?: number | string
  gravity?: GravityPosition
  aspectRatio?: string | number
}

export interface TransformOptions extends ResizeOptions {
  format?: OutputFormat
  quality?: number
  lossless?: boolean
  compressionLevel?: number
  timeout?: number
}

export interface CfImageTransformOptions {
  width?: number
  height?: number
  fit?: FitMode | 'scale-down'
  gravity?: GravityPosition
  quality?: number
  format?: OutputFormat
  anim?: boolean
  blur?: number
  brightness?: number
  contrast?: number
  rotate?: number
  sharpen?: number
  trim?: {
    top?: number
    right?: number
    bottom?: number
    left?: number
  }
  dpr?: number
  metadata?: 'keep' | 'copyright' | 'none'
  background?: string
}

export interface TransformResult {
  data: Uint8Array
  width: number
  height: number
  format: OutputFormat
  metadata?: ImageMetadata
}

export interface ImageTransformerConfig {
  maxWidth?: number
  maxHeight?: number
  defaultQuality?: number
  defaultFormat?: OutputFormat
}

export interface ImageTransformer {
  resize(input: Uint8Array, options: ResizeOptions): Promise<TransformResult>
  crop(input: Uint8Array, options: CropOptions): Promise<TransformResult>
  transform(input: Uint8Array, options: TransformOptions): Promise<TransformResult>
  transformWithCfOptions(
    input: Uint8Array,
    options: CfImageTransformOptions
  ): Promise<TransformResult>
  getMetadata(input: Uint8Array): Promise<ImageMetadata>
  getTransformUrl(baseUrl: string, options: TransformOptions): string
}

// =============================================================================
// Stub Implementation
// =============================================================================

/**
 * Creates an ImageTransformer instance
 *
 * @param config - Configuration options for the transformer
 * @returns ImageTransformer instance
 */
export function createImageTransformer(
  _config?: ImageTransformerConfig
): ImageTransformer {
  return {
    async resize(
      _input: Uint8Array,
      _options: ResizeOptions
    ): Promise<TransformResult> {
      throw new Error('Not implemented: resize')
    },

    async crop(
      _input: Uint8Array,
      _options: CropOptions
    ): Promise<TransformResult> {
      throw new Error('Not implemented: crop')
    },

    async transform(
      _input: Uint8Array,
      _options: TransformOptions
    ): Promise<TransformResult> {
      throw new Error('Not implemented: transform')
    },

    async transformWithCfOptions(
      _input: Uint8Array,
      _options: CfImageTransformOptions
    ): Promise<TransformResult> {
      throw new Error('Not implemented: transformWithCfOptions')
    },

    async getMetadata(_input: Uint8Array): Promise<ImageMetadata> {
      throw new Error('Not implemented: getMetadata')
    },

    getTransformUrl(_baseUrl: string, _options: TransformOptions): string {
      throw new Error('Not implemented: getTransformUrl')
    },
  }
}
