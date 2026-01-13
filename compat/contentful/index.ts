/**
 * @dotdo/contentful - Contentful SDK Compat Layer
 *
 * API-compatible implementation of contentful-management SDK
 * backed by Durable Objects
 *
 * This is a stub file for TDD RED phase - all exports will throw
 * "Not implemented" errors until the GREEN phase.
 */

// =============================================================================
// Types
// =============================================================================

export interface ContentfulClientConfig {
  accessToken: string
  host?: string
  spaceId?: string
}

export interface ContentfulClient {
  getSpace(spaceId: string): Promise<Space>
}

export interface Space {
  sys: {
    id: string
    type: 'Space'
  }
  getEnvironment(environmentId: string): Promise<Environment>
}

export interface Environment {
  sys: {
    id: string
    type: 'Environment'
  }
  createAsset(props: CreateAssetProps): Promise<Asset>
  createAssetWithId(id: string, props: CreateAssetProps): Promise<Asset>
  createUpload(props: CreateUploadProps): Promise<Upload>
  getAsset(id: string, query?: AssetQuery): Promise<Asset>
  getAssets(query?: AssetsQuery): Promise<AssetCollection>
  getPublishedAssets(query?: AssetsQuery): Promise<AssetCollection>
}

export interface CreateAssetProps {
  fields: {
    title: Record<string, string>
    description?: Record<string, string>
    file: Record<string, AssetFileProp>
  }
  metadata?: {
    tags?: Array<{ sys: { type: 'Link'; linkType: 'Tag'; id: string } }>
  }
}

export interface AssetFileProp {
  contentType: string
  fileName: string
  upload?: string
  uploadFrom?: {
    sys: {
      type: 'Link'
      linkType: 'Upload'
      id: string
    }
  }
  url?: string
  details?: {
    size: number
    image?: {
      width: number
      height: number
    }
  }
}

export interface CreateUploadProps {
  file: Uint8Array | Blob | ArrayBuffer
}

export interface Upload {
  sys: {
    id: string
    type: 'Upload'
    expiresAt: string
  }
}

export interface Asset {
  sys: AssetSys
  fields: AssetFields
  metadata?: {
    tags?: Array<{ sys: { type: 'Link'; linkType: 'Tag'; id: string } }>
  }
  processForLocale(locale: string): Promise<Asset>
  processForAllLocales(options?: ProcessOptions): Promise<Asset>
  publish(): Promise<Asset>
  unpublish(): Promise<Asset>
  archive(): Promise<Asset>
  unarchive(): Promise<Asset>
  delete(): Promise<void>
  update(): Promise<Asset>
  isPublished(): boolean
  isDraft(): boolean
  isUpdated(): boolean
  isArchived(): boolean
  toPlainObject(): AssetProps
}

export interface AssetSys {
  id: string
  type: 'Asset'
  version: number
  createdAt: string
  updatedAt: string
  publishedAt?: string
  publishedVersion?: number
  archivedAt?: string
  space: {
    sys: {
      id: string
      type: 'Link'
      linkType: 'Space'
    }
  }
  environment: {
    sys: {
      id: string
      type: 'Link'
      linkType: 'Environment'
    }
  }
}

export interface AssetFields {
  title: Record<string, string>
  description?: Record<string, string>
  file: Record<string, AssetFileProp>
}

export interface AssetProps {
  sys: AssetSys
  fields: AssetFields
  metadata?: {
    tags?: Array<{ sys: { type: 'Link'; linkType: 'Tag'; id: string } }>
  }
}

export interface ProcessOptions {
  processingCheckWait?: number
  processingCheckRetries?: number
}

export interface AssetCollection {
  items: Asset[]
  total: number
  skip: number
  limit: number
}

export interface AssetQuery {
  locale?: string
}

export interface AssetsQuery {
  [key: string]: string | number | boolean | undefined
  limit?: number
  skip?: number
  order?: string
  select?: string
  mimetype_group?: string
}

export interface ImageTransformOptions {
  width?: number
  height?: number
  fit?: 'pad' | 'fill' | 'scale' | 'crop' | 'thumb'
  focus?: 'center' | 'top' | 'right' | 'left' | 'bottom' | 'top_right' | 'top_left' | 'bottom_right' | 'bottom_left' | 'face' | 'faces'
  format?: 'jpg' | 'png' | 'webp' | 'gif' | 'avif'
  quality?: number
  radius?: number | 'max'
  backgroundColor?: string
  progressive?: boolean
  png8?: boolean
}

// =============================================================================
// Error Classes
// =============================================================================

export class ContentfulError extends Error {
  public sys?: { type: string; id: string }

  constructor(message: string) {
    super(message)
    this.name = 'ContentfulError'
  }
}

export class NotFoundError extends ContentfulError {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends ContentfulError {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class AccessDeniedError extends ContentfulError {
  constructor(message: string) {
    super(message)
    this.name = 'AccessDeniedError'
  }
}

export class RateLimitError extends ContentfulError {
  constructor(message: string) {
    super(message)
    this.name = 'RateLimitError'
  }
}

// =============================================================================
// Client Factory (Stub)
// =============================================================================

export function createClient(_config: ContentfulClientConfig): ContentfulClient {
  throw new Error('Not implemented: createClient')
}

// =============================================================================
// Image Transform Utilities (Stub)
// =============================================================================

export function getImageUrl(
  _asset: Asset,
  _locale: string,
  _options?: ImageTransformOptions
): string {
  throw new Error('Not implemented: getImageUrl')
}

export function buildImageTransformUrl(
  _baseUrl: string,
  _options: ImageTransformOptions
): string {
  throw new Error('Not implemented: buildImageTransformUrl')
}

// =============================================================================
// Test Utilities (Stub)
// =============================================================================

export function _clearAll(): void {
  throw new Error('Not implemented: _clearAll')
}

export function _getAssets(): Asset[] {
  throw new Error('Not implemented: _getAssets')
}
