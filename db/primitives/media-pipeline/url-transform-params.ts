/**
 * URL Transform Parameters - On-the-fly transformations via URL params
 *
 * Parses URL parameters and applies media transformations on-the-fly.
 * Supports common CDN URL patterns (Cloudinary, imgix, Cloudflare Images compatible).
 *
 * ## URL Parameter Formats
 *
 * ### Short Format (compact)
 * - `w=300` - width
 * - `h=200` - height
 * - `f=webp` - format
 * - `q=85` - quality
 * - `fit=cover` - fit mode
 * - `g=face` - gravity
 * - `dpr=2` - device pixel ratio
 *
 * ### Long Format (verbose)
 * - `width=300`
 * - `height=200`
 * - `format=webp`
 * - `quality=85`
 * - `gravity=center`
 *
 * ### Cloudflare Images Format
 * - `/cdn-cgi/image/width=300,format=webp/path/to/image.jpg`
 *
 * ### imgix-style URL Format
 * - `?w=300&h=200&fit=crop&crop=faces`
 *
 * ## Usage
 *
 * ```typescript
 * import { parseTransformParams, applyUrlTransforms } from './url-transform-params'
 *
 * // Parse URL parameters
 * const params = parseTransformParams(new URL(request.url))
 *
 * // Apply transforms to image buffer
 * const result = await applyUrlTransforms(imageBuffer, params, transformer)
 *
 * // Or use the middleware for CDN delivery
 * const response = await handleTransformRequest(request, bucket, transformer)
 * ```
 *
 * @see https://developers.cloudflare.com/images/transform-images/transform-via-url/
 * @see https://docs.imgix.com/apis/rendering
 * @module db/primitives/media-pipeline
 */

import type {
  ImageTransformer,
  TransformOptions,
  TransformResult,
  OutputFormat,
  FitMode,
  GravityPosition,
  CfImageTransformOptions,
} from './image-transformer'

// =============================================================================
// Types
// =============================================================================

/**
 * Parsed transformation parameters from URL
 */
export interface TransformParams {
  /** Target width in pixels */
  width?: number
  /** Target height in pixels */
  height?: number
  /** Output format */
  format?: OutputFormat
  /** Quality (1-100) */
  quality?: number
  /** Fit mode */
  fit?: FitMode
  /** Gravity/crop focus */
  gravity?: GravityPosition
  /** Device pixel ratio multiplier */
  dpr?: number
  /** Blur radius (0-250) */
  blur?: number
  /** Brightness adjustment (0.1-10, 1 = no change) */
  brightness?: number
  /** Contrast adjustment (0.1-10, 1 = no change) */
  contrast?: number
  /** Sharpen amount (0-10) */
  sharpen?: number
  /** Rotation in degrees (0, 90, 180, 270) */
  rotate?: number
  /** Background color for padding (hex or color name) */
  background?: string
  /** Strip metadata */
  stripMetadata?: boolean
  /** Auto format detection based on Accept header */
  auto?: 'format' | 'compress' | 'format,compress'
  /** Crop coordinates */
  crop?: {
    x?: number
    y?: number
    width?: number
    height?: number
  }
  /** Trim edges */
  trim?: {
    top?: number
    right?: number
    bottom?: number
    left?: number
  }
  /** Enable/disable animation */
  anim?: boolean
  /** Aspect ratio (e.g., "16:9" or 1.777) */
  aspectRatio?: string | number
  /** Watermark options */
  watermark?: {
    url?: string
    position?: GravityPosition
    opacity?: number
    scale?: number
  }
}

/**
 * Parsing options
 */
export interface ParseOptions {
  /** Allow all parameters (default: true) */
  allowAll?: boolean
  /** Allowed parameter names (whitelist) */
  allowedParams?: string[]
  /** Maximum width allowed */
  maxWidth?: number
  /** Maximum height allowed */
  maxHeight?: number
  /** Maximum quality allowed */
  maxQuality?: number
  /** Default format when none specified */
  defaultFormat?: OutputFormat
  /** Default quality when none specified */
  defaultQuality?: number
  /** Parse Cloudflare Images path format */
  parsePathFormat?: boolean
}

/**
 * Transform request configuration
 */
export interface TransformRequestConfig {
  /** R2 bucket for fetching source images */
  bucket: R2Bucket
  /** Image transformer instance */
  transformer: ImageTransformer
  /** URL path prefix to strip (e.g., '/images/') */
  pathPrefix?: string
  /** Parse options */
  parseOptions?: ParseOptions
  /** Cache transformed images */
  cacheTransformed?: boolean
  /** Cache bucket for transformed images */
  cacheBucket?: R2Bucket
  /** Cache key prefix */
  cachePrefix?: string
  /** Accept header for auto format */
  acceptHeader?: string
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Parameter name mappings (short -> long)
 */
const PARAM_ALIASES: Record<string, string> = {
  // Dimensions
  w: 'width',
  h: 'height',
  // Format
  f: 'format',
  fm: 'format',
  // Quality
  q: 'quality',
  // Fit mode
  fit: 'fit',
  c: 'fit', // crop mode alias
  // Gravity
  g: 'gravity',
  crop: 'gravity', // imgix uses crop for gravity
  // Device pixel ratio
  dpr: 'dpr',
  // Effects
  blur: 'blur',
  bri: 'brightness',
  bright: 'brightness',
  con: 'contrast',
  sharp: 'sharpen',
  // Rotation
  rot: 'rotate',
  or: 'rotate', // orientation
  // Background
  bg: 'background',
  'bg-color': 'background',
  // Metadata
  strip: 'stripMetadata',
  // Auto
  auto: 'auto',
  // Animation
  anim: 'anim',
  // Aspect ratio
  ar: 'aspectRatio',
  aspect: 'aspectRatio',
}

/**
 * Valid output formats
 */
const VALID_FORMATS: OutputFormat[] = ['jpeg', 'jpg', 'png', 'webp', 'avif', 'gif']

/**
 * Valid fit modes
 */
const VALID_FIT_MODES: FitMode[] = ['contain', 'cover', 'scale-down', 'pad', 'crop']

/**
 * Fit mode aliases
 */
const FIT_ALIASES: Record<string, FitMode> = {
  fill: 'cover',
  inside: 'contain',
  outside: 'cover',
  'scale-down': 'scale-down',
  max: 'contain',
  min: 'cover',
  thumb: 'cover',
  clip: 'contain',
  facearea: 'cover',
  fillmax: 'cover',
}

/**
 * Valid gravity positions
 */
const VALID_GRAVITIES: GravityPosition[] = [
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'face',
  'faces',
  'entropy',
  'attention',
  'auto',
]

/**
 * Gravity aliases
 */
const GRAVITY_ALIASES: Record<string, GravityPosition> = {
  c: 'center',
  n: 'top',
  ne: 'top-right',
  e: 'right',
  se: 'bottom-right',
  s: 'bottom',
  sw: 'bottom-left',
  w: 'left',
  nw: 'top-left',
  north: 'top',
  south: 'bottom',
  east: 'right',
  west: 'left',
  northeast: 'top-right',
  southeast: 'bottom-right',
  southwest: 'bottom-left',
  northwest: 'top-left',
  smart: 'attention',
  focal: 'attention',
}

/**
 * Default parse options
 */
const DEFAULT_PARSE_OPTIONS: Required<ParseOptions> = {
  allowAll: true,
  allowedParams: [],
  maxWidth: 8192,
  maxHeight: 8192,
  maxQuality: 100,
  defaultFormat: 'webp',
  defaultQuality: 85,
  parsePathFormat: true,
}

// =============================================================================
// Parser Functions
// =============================================================================

/**
 * Normalize parameter name using aliases
 */
function normalizeParamName(name: string): string {
  const lower = name.toLowerCase()
  return PARAM_ALIASES[lower] || lower
}

/**
 * Normalize format value
 */
function normalizeFormat(format: string): OutputFormat | null {
  const lower = format.toLowerCase()
  if (VALID_FORMATS.includes(lower as OutputFormat)) {
    return lower === 'jpg' ? 'jpeg' : (lower as OutputFormat)
  }
  return null
}

/**
 * Normalize fit mode value
 */
function normalizeFit(fit: string): FitMode | null {
  const lower = fit.toLowerCase()
  if (VALID_FIT_MODES.includes(lower as FitMode)) {
    return lower as FitMode
  }
  return FIT_ALIASES[lower] || null
}

/**
 * Normalize gravity value
 */
function normalizeGravity(gravity: string): GravityPosition | null {
  const lower = gravity.toLowerCase()
  if (VALID_GRAVITIES.includes(lower as GravityPosition)) {
    return lower as GravityPosition
  }
  return GRAVITY_ALIASES[lower] || null
}

/**
 * Parse integer with bounds checking
 */
function parseIntBounded(value: string, min: number, max: number): number | null {
  const num = parseInt(value, 10)
  if (isNaN(num)) return null
  return Math.max(min, Math.min(max, num))
}

/**
 * Parse float with bounds checking
 */
function parseFloatBounded(value: string, min: number, max: number): number | null {
  const num = parseFloat(value)
  if (isNaN(num)) return null
  return Math.max(min, Math.min(max, num))
}

/**
 * Parse Cloudflare Images path format
 * Format: /cdn-cgi/image/width=300,format=webp/path/to/image.jpg
 */
function parseCloudflarePathFormat(pathname: string): { params: TransformParams; imagePath: string } | null {
  const match = pathname.match(/^\/cdn-cgi\/image\/([^/]+)\/(.+)$/)
  if (!match) return null

  const [, optionsStr, imagePath] = match
  const params: TransformParams = {}

  // Parse comma-separated key=value pairs
  const options = optionsStr.split(',')
  for (const option of options) {
    const [key, value] = option.split('=')
    if (!key || value === undefined) continue

    const normalizedKey = normalizeParamName(key)
    parseParamValue(normalizedKey, value, params)
  }

  return { params, imagePath }
}

/**
 * Parse a single parameter value into the params object
 */
function parseParamValue(key: string, value: string, params: TransformParams): void {
  // Normalize key to lowercase for switch matching
  const normalizedKey = key.toLowerCase()

  switch (normalizedKey) {
    case 'width':
      params.width = parseIntBounded(value, 1, 8192) ?? undefined
      break
    case 'height':
      params.height = parseIntBounded(value, 1, 8192) ?? undefined
      break
    case 'format':
      params.format = normalizeFormat(value) ?? undefined
      break
    case 'quality':
      params.quality = parseIntBounded(value, 1, 100) ?? undefined
      break
    case 'fit':
      params.fit = normalizeFit(value) ?? undefined
      break
    case 'gravity':
      params.gravity = normalizeGravity(value) ?? undefined
      break
    case 'dpr':
      params.dpr = parseFloatBounded(value, 0.1, 10) ?? undefined
      break
    case 'blur':
      params.blur = parseIntBounded(value, 0, 250) ?? undefined
      break
    case 'brightness':
      params.brightness = parseFloatBounded(value, 0.1, 10) ?? undefined
      break
    case 'contrast':
      params.contrast = parseFloatBounded(value, 0.1, 10) ?? undefined
      break
    case 'sharpen':
      params.sharpen = parseFloatBounded(value, 0, 10) ?? undefined
      break
    case 'rotate':
      const rot = parseInt(value, 10)
      if ([0, 90, 180, 270].includes(rot)) {
        params.rotate = rot
      }
      break
    case 'background':
      // Validate hex color or named color
      if (/^#?[0-9a-fA-F]{3,8}$/.test(value) || /^[a-z]+$/i.test(value)) {
        params.background = value.startsWith('#') ? value : `#${value}`
      }
      break
    case 'stripmetadata':
      params.stripMetadata = value === 'true' || value === '1'
      break
    case 'auto':
      if (['format', 'compress', 'format,compress'].includes(value)) {
        params.auto = value as TransformParams['auto']
      }
      break
    case 'anim':
      params.anim = value !== 'false' && value !== '0'
      break
    case 'aspectratio':
      // Support "16:9" or "1.777" format
      if (/^\d+:\d+$/.test(value) || /^\d+\.?\d*$/.test(value)) {
        params.aspectRatio = value
      }
      break
  }
}

/**
 * Parse transform parameters from URL
 *
 * Supports multiple URL formats:
 * - Query parameters: `?w=300&h=200&f=webp`
 * - Cloudflare path format: `/cdn-cgi/image/width=300/image.jpg`
 *
 * @param url - URL to parse
 * @param options - Parsing options
 * @returns Parsed transform parameters
 */
export function parseTransformParams(
  url: URL,
  options: ParseOptions = {}
): TransformParams {
  const opts = { ...DEFAULT_PARSE_OPTIONS, ...options }
  const params: TransformParams = {}

  // Try Cloudflare path format first
  if (opts.parsePathFormat) {
    const cfResult = parseCloudflarePathFormat(url.pathname)
    if (cfResult) {
      Object.assign(params, cfResult.params)
    }
  }

  // Parse query string parameters
  url.searchParams.forEach((value, key) => {
    const normalizedKey = normalizeParamName(key)

    // Check whitelist if not allowing all
    if (!opts.allowAll && opts.allowedParams.length > 0) {
      if (!opts.allowedParams.includes(normalizedKey)) {
        return
      }
    }

    parseParamValue(normalizedKey, value, params)
  })

  // Apply bounds from options
  if (params.width && params.width > opts.maxWidth) {
    params.width = opts.maxWidth
  }
  if (params.height && params.height > opts.maxHeight) {
    params.height = opts.maxHeight
  }
  if (params.quality && params.quality > opts.maxQuality) {
    params.quality = opts.maxQuality
  }

  return params
}

/**
 * Parse transform parameters from a plain object (e.g., parsed query string)
 */
export function parseTransformParamsFromObject(
  obj: Record<string, string | undefined>,
  options: ParseOptions = {}
): TransformParams {
  const opts = { ...DEFAULT_PARSE_OPTIONS, ...options }
  const params: TransformParams = {}

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue

    const normalizedKey = normalizeParamName(key)

    if (!opts.allowAll && opts.allowedParams.length > 0) {
      if (!opts.allowedParams.includes(normalizedKey)) {
        continue
      }
    }

    parseParamValue(normalizedKey, value, params)
  }

  // Apply bounds
  if (params.width && params.width > opts.maxWidth) {
    params.width = opts.maxWidth
  }
  if (params.height && params.height > opts.maxHeight) {
    params.height = opts.maxHeight
  }
  if (params.quality && params.quality > opts.maxQuality) {
    params.quality = opts.maxQuality
  }

  return params
}

/**
 * Extract image path from URL (removing transform parameters and prefixes)
 */
export function extractImagePath(url: URL, options: { pathPrefix?: string; parsePathFormat?: boolean } = {}): string {
  let pathname = url.pathname

  // Handle Cloudflare path format
  if (options.parsePathFormat !== false) {
    const cfResult = parseCloudflarePathFormat(pathname)
    if (cfResult) {
      pathname = `/${cfResult.imagePath}`
    }
  }

  // Strip path prefix
  if (options.pathPrefix && pathname.startsWith(options.pathPrefix)) {
    pathname = pathname.slice(options.pathPrefix.length)
  }

  // Ensure leading slash is removed for R2 key
  if (pathname.startsWith('/')) {
    pathname = pathname.slice(1)
  }

  return pathname
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate transform parameters
 */
export function validateTransformParams(
  params: TransformParams,
  options: ParseOptions = {}
): ValidationResult {
  const opts = { ...DEFAULT_PARSE_OPTIONS, ...options }
  const errors: string[] = []
  const warnings: string[] = []

  // Dimension validation
  if (params.width !== undefined) {
    if (params.width < 1) {
      errors.push('Width must be at least 1 pixel')
    } else if (params.width > opts.maxWidth) {
      errors.push(`Width exceeds maximum of ${opts.maxWidth} pixels`)
    }
  }

  if (params.height !== undefined) {
    if (params.height < 1) {
      errors.push('Height must be at least 1 pixel')
    } else if (params.height > opts.maxHeight) {
      errors.push(`Height exceeds maximum of ${opts.maxHeight} pixels`)
    }
  }

  // Total pixel limit
  if (params.width && params.height) {
    const totalPixels = params.width * params.height
    const maxPixels = opts.maxWidth * opts.maxHeight
    if (totalPixels > maxPixels) {
      errors.push(`Total pixels (${totalPixels}) exceeds maximum (${maxPixels})`)
    }
  }

  // Quality validation
  if (params.quality !== undefined) {
    if (params.quality < 1 || params.quality > 100) {
      errors.push('Quality must be between 1 and 100')
    }
  }

  // Format validation
  if (params.format !== undefined) {
    if (!VALID_FORMATS.includes(params.format)) {
      errors.push(`Invalid format: ${params.format}. Valid formats: ${VALID_FORMATS.join(', ')}`)
    }
  }

  // DPR validation
  if (params.dpr !== undefined) {
    if (params.dpr < 0.1 || params.dpr > 10) {
      errors.push('DPR must be between 0.1 and 10')
    }
  }

  // Blur validation
  if (params.blur !== undefined) {
    if (params.blur < 0 || params.blur > 250) {
      errors.push('Blur must be between 0 and 250')
    }
  }

  // Rotation validation
  if (params.rotate !== undefined) {
    if (![0, 90, 180, 270].includes(params.rotate)) {
      warnings.push('Rotation will be rounded to nearest 90 degrees')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Check if URL has transform parameters
 */
export function hasTransformParams(url: URL): boolean {
  const transformKeys = Object.keys(PARAM_ALIASES).concat(Object.values(PARAM_ALIASES))

  // Check query parameters
  for (const key of url.searchParams.keys()) {
    if (transformKeys.includes(key.toLowerCase())) {
      return true
    }
  }

  // Check Cloudflare path format
  if (url.pathname.startsWith('/cdn-cgi/image/')) {
    return true
  }

  return false
}

// =============================================================================
// Transform Application
// =============================================================================

/**
 * Convert TransformParams to TransformOptions for the image transformer
 */
export function toTransformOptions(params: TransformParams): TransformOptions {
  const options: TransformOptions = {}

  if (params.width !== undefined) {
    options.width = params.dpr ? Math.round(params.width * params.dpr) : params.width
  }
  if (params.height !== undefined) {
    options.height = params.dpr ? Math.round(params.height * params.dpr) : params.height
  }
  if (params.format !== undefined) {
    options.format = params.format
  }
  if (params.quality !== undefined) {
    options.quality = params.quality
  }
  if (params.fit !== undefined) {
    options.fit = params.fit
  }
  if (params.gravity !== undefined) {
    options.gravity = params.gravity
  }
  if (params.background !== undefined) {
    options.background = params.background
  }

  return options
}

/**
 * Convert TransformParams to CfImageTransformOptions
 */
export function toCfImageOptions(params: TransformParams): CfImageTransformOptions {
  const options: CfImageTransformOptions = {}

  if (params.width !== undefined) {
    options.width = params.width
  }
  if (params.height !== undefined) {
    options.height = params.height
  }
  if (params.format !== undefined) {
    options.format = params.format
  }
  if (params.quality !== undefined) {
    options.quality = params.quality
  }
  if (params.fit !== undefined) {
    options.fit = params.fit
  }
  if (params.gravity !== undefined) {
    options.gravity = params.gravity
  }
  if (params.dpr !== undefined) {
    options.dpr = params.dpr
  }
  if (params.blur !== undefined) {
    options.blur = params.blur
  }
  if (params.brightness !== undefined) {
    options.brightness = params.brightness
  }
  if (params.contrast !== undefined) {
    options.contrast = params.contrast
  }
  if (params.sharpen !== undefined) {
    options.sharpen = params.sharpen
  }
  if (params.rotate !== undefined) {
    options.rotate = params.rotate
  }
  if (params.background !== undefined) {
    options.background = params.background
  }
  if (params.anim !== undefined) {
    options.anim = params.anim
  }
  if (params.trim !== undefined) {
    options.trim = params.trim
  }
  if (params.stripMetadata !== undefined) {
    options.metadata = params.stripMetadata ? 'none' : 'keep'
  }

  return options
}

/**
 * Apply URL-based transforms to image data
 */
export async function applyUrlTransforms(
  imageData: Uint8Array,
  params: TransformParams,
  transformer: ImageTransformer
): Promise<TransformResult> {
  // Check if any transforms are needed
  const hasTransforms =
    params.width !== undefined ||
    params.height !== undefined ||
    params.format !== undefined ||
    params.quality !== undefined ||
    params.fit !== undefined ||
    params.gravity !== undefined

  if (!hasTransforms) {
    // No transforms needed, just get metadata
    const metadata = await transformer.getMetadata(imageData)
    return {
      data: imageData,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      metadata,
    }
  }

  // Apply transforms
  const cfOptions = toCfImageOptions(params)
  return transformer.transformWithCfOptions(imageData, cfOptions)
}

/**
 * Determine best output format based on Accept header
 */
export function selectBestFormat(
  acceptHeader: string | null,
  sourceFormat: OutputFormat,
  preferredFormat?: OutputFormat
): OutputFormat {
  if (preferredFormat) {
    return preferredFormat
  }

  if (!acceptHeader) {
    return sourceFormat
  }

  const accept = acceptHeader.toLowerCase()

  // Check for modern formats first
  if (accept.includes('image/avif')) {
    return 'avif'
  }
  if (accept.includes('image/webp')) {
    return 'webp'
  }

  // Fall back to source format
  return sourceFormat
}

// =============================================================================
// URL Generation
// =============================================================================

/**
 * Generate URL with transform parameters
 */
export function generateTransformUrl(
  baseUrl: string,
  params: TransformParams,
  format: 'query' | 'cloudflare' = 'query'
): string {
  const url = new URL(baseUrl)

  if (format === 'cloudflare') {
    // Generate Cloudflare path format
    const options: string[] = []

    if (params.width !== undefined) options.push(`width=${params.width}`)
    if (params.height !== undefined) options.push(`height=${params.height}`)
    if (params.format !== undefined) options.push(`format=${params.format}`)
    if (params.quality !== undefined) options.push(`quality=${params.quality}`)
    if (params.fit !== undefined) options.push(`fit=${params.fit}`)
    if (params.gravity !== undefined) options.push(`gravity=${params.gravity}`)
    if (params.dpr !== undefined) options.push(`dpr=${params.dpr}`)
    if (params.blur !== undefined) options.push(`blur=${params.blur}`)
    if (params.sharpen !== undefined) options.push(`sharpen=${params.sharpen}`)
    if (params.rotate !== undefined) options.push(`rotate=${params.rotate}`)
    if (params.background !== undefined) options.push(`background=${params.background}`)

    if (options.length > 0) {
      url.pathname = `/cdn-cgi/image/${options.join(',')}${url.pathname}`
    }
  } else {
    // Generate query string format
    if (params.width !== undefined) url.searchParams.set('w', params.width.toString())
    if (params.height !== undefined) url.searchParams.set('h', params.height.toString())
    if (params.format !== undefined) url.searchParams.set('f', params.format)
    if (params.quality !== undefined) url.searchParams.set('q', params.quality.toString())
    if (params.fit !== undefined) url.searchParams.set('fit', params.fit)
    if (params.gravity !== undefined) url.searchParams.set('g', params.gravity)
    if (params.dpr !== undefined) url.searchParams.set('dpr', params.dpr.toString())
    if (params.blur !== undefined) url.searchParams.set('blur', params.blur.toString())
    if (params.sharpen !== undefined) url.searchParams.set('sharp', params.sharpen.toString())
    if (params.rotate !== undefined) url.searchParams.set('rot', params.rotate.toString())
    if (params.background !== undefined) url.searchParams.set('bg', params.background)
  }

  return url.toString()
}

/**
 * Generate cache key for transformed image
 */
export function generateCacheKey(imagePath: string, params: TransformParams): string {
  const parts = [imagePath]

  // Add sorted params to ensure consistent keys
  const sortedKeys = Object.keys(params).sort()
  for (const key of sortedKeys) {
    const value = params[key as keyof TransformParams]
    if (value !== undefined) {
      parts.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
    }
  }

  return parts.join('/')
}

// =============================================================================
// Request Handler
// =============================================================================

/**
 * Handle transform request - full request/response handler for CDN
 *
 * @param request - Incoming HTTP request
 * @param config - Transform request configuration
 * @returns HTTP Response with transformed image
 */
export async function handleTransformRequest(
  request: Request,
  config: TransformRequestConfig
): Promise<Response> {
  const { bucket, transformer, pathPrefix, parseOptions, acceptHeader } = config

  const url = new URL(request.url)

  // Only handle GET and HEAD
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    })
  }

  // Parse transform parameters
  const params = parseTransformParams(url, parseOptions)

  // Validate parameters
  const validation = validateTransformParams(params, parseOptions)
  if (!validation.valid) {
    return new Response(`Invalid parameters: ${validation.errors.join(', ')}`, {
      status: 400,
    })
  }

  // Extract image path
  const imagePath = extractImagePath(url, { pathPrefix, parsePathFormat: parseOptions?.parsePathFormat })

  if (!imagePath) {
    return new Response('Not Found', { status: 404 })
  }

  // Check cache if enabled
  if (config.cacheTransformed && config.cacheBucket) {
    const cacheKey = `${config.cachePrefix || 'transforms/'}${generateCacheKey(imagePath, params)}`
    const cached = await config.cacheBucket.get(cacheKey)
    if (cached) {
      const headers = new Headers()
      headers.set('Content-Type', cached.httpMetadata?.contentType || 'application/octet-stream')
      headers.set('Content-Length', cached.size.toString())
      headers.set('Cache-Control', 'public, max-age=31536000, immutable')
      headers.set('X-Cache', 'HIT')

      if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers })
      }

      return new Response(cached.body, { status: 200, headers })
    }
  }

  // Fetch source image
  const sourceObject = await bucket.get(imagePath)
  if (!sourceObject) {
    return new Response('Not Found', { status: 404 })
  }

  const sourceData = new Uint8Array(await sourceObject.arrayBuffer())

  // Check if transforms are needed
  if (!hasTransformParams(url)) {
    // No transforms, serve original
    const headers = new Headers()
    headers.set('Content-Type', sourceObject.httpMetadata?.contentType || 'application/octet-stream')
    headers.set('Content-Length', sourceObject.size.toString())
    headers.set('ETag', sourceObject.httpEtag)
    headers.set('Cache-Control', sourceObject.httpMetadata?.cacheControl || 'public, max-age=86400')

    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers })
    }

    return new Response(sourceObject.body, { status: 200, headers })
  }

  // Auto-select format based on Accept header
  const effectiveAccept = acceptHeader || request.headers.get('Accept')
  if (params.auto?.includes('format') && !params.format) {
    const sourceMetadata = await transformer.getMetadata(sourceData)
    params.format = selectBestFormat(effectiveAccept, sourceMetadata.format)
  }

  // Apply transforms
  const result = await applyUrlTransforms(sourceData, params, transformer)

  // Store in cache if enabled
  if (config.cacheTransformed && config.cacheBucket) {
    const cacheKey = `${config.cachePrefix || 'transforms/'}${generateCacheKey(imagePath, params)}`
    await config.cacheBucket.put(cacheKey, result.data, {
      httpMetadata: {
        contentType: `image/${result.format}`,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    })
  }

  // Build response
  const headers = new Headers()
  headers.set('Content-Type', `image/${result.format}`)
  headers.set('Content-Length', result.data.length.toString())
  headers.set('Cache-Control', 'public, max-age=86400')
  headers.set('Vary', 'Accept')
  headers.set('X-Cache', 'MISS')

  if (result.metadata) {
    headers.set('X-Image-Width', result.width.toString())
    headers.set('X-Image-Height', result.height.toString())
  }

  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers })
  }

  return new Response(result.data, { status: 200, headers })
}

// =============================================================================
// Exports
// =============================================================================

export {
  VALID_FORMATS,
  VALID_FIT_MODES,
  VALID_GRAVITIES,
  PARAM_ALIASES,
  FIT_ALIASES,
  GRAVITY_ALIASES,
}
