/**
 * @dotdo/cloudinary - Type Definitions
 *
 * Cloudinary-compatible types for the compat layer.
 * Based on Cloudinary Node SDK v2.
 */

// =============================================================================
// Resource Types
// =============================================================================

export type ResourceType = 'image' | 'video' | 'raw'
export type DeliveryType = 'upload' | 'private' | 'authenticated' | 'fetch' | 'multi'
export type AssetFormat = 'jpg' | 'png' | 'gif' | 'webp' | 'avif' | 'svg' | 'mp4' | 'webm' | 'mov' | 'pdf' | string

// =============================================================================
// Configuration
// =============================================================================

export interface CloudinaryConfig {
  cloud_name: string
  api_key?: string
  api_secret?: string
  secure?: boolean
  cdn_subdomain?: boolean
  secure_distribution?: string
  private_cdn?: boolean
}

// =============================================================================
// Upload Options
// =============================================================================

export interface UploadOptions {
  public_id?: string
  folder?: string
  resource_type?: ResourceType
  type?: DeliveryType
  format?: AssetFormat
  tags?: string[]
  context?: Record<string, string>
  metadata?: Record<string, string>
  access_mode?: 'public' | 'authenticated'
  unique_filename?: boolean
  use_filename?: boolean
  filename_override?: string
  overwrite?: boolean
  transformation?: Transformation | Transformation[]
  eager?: EagerTransformation[]
  eager_async?: boolean
  eager_notification_url?: string
  notification_url?: string
  invalidate?: boolean
  moderation?: 'manual' | 'webpurify' | 'aws_rek' | 'google_ml'
  raw_convert?: string
  categorization?: string
  auto_tagging?: number
  detection?: string
  ocr?: string
  background_removal?: string
  upload_preset?: string
}

// =============================================================================
// Transformation Types
// =============================================================================

export interface Transformation {
  width?: number | string
  height?: number | string
  crop?: CropMode
  gravity?: Gravity
  quality?: number | 'auto' | 'auto:low' | 'auto:eco' | 'auto:good' | 'auto:best'
  format?: AssetFormat
  fetch_format?: AssetFormat | 'auto'
  effect?: string
  angle?: number | string
  radius?: number | 'max'
  border?: string
  background?: string
  overlay?: string
  underlay?: string
  opacity?: number
  color?: string
  dpr?: number | 'auto'
  flags?: string | string[]
  page?: number
  density?: number
  start_offset?: number | string
  end_offset?: number | string
  duration?: number | string
  audio_codec?: string
  video_codec?: string
  bit_rate?: number | string
  fps?: number | string
  streaming_profile?: string
  default_image?: string
  if?: string
  variables?: Array<[string, string]>
  raw_transformation?: string
}

export type CropMode =
  | 'scale'
  | 'fit'
  | 'limit'
  | 'mfit'
  | 'fill'
  | 'lfill'
  | 'pad'
  | 'lpad'
  | 'mpad'
  | 'crop'
  | 'thumb'
  | 'auto'

export type Gravity =
  | 'center'
  | 'north'
  | 'south'
  | 'east'
  | 'west'
  | 'north_east'
  | 'north_west'
  | 'south_east'
  | 'south_west'
  | 'face'
  | 'face:center'
  | 'faces'
  | 'faces:center'
  | 'body'
  | 'auto'
  | 'auto:subject'
  | 'auto:face'
  | 'custom'

export interface EagerTransformation extends Transformation {
  format?: AssetFormat
}

// =============================================================================
// Upload Response
// =============================================================================

export interface UploadResponse {
  public_id: string
  version: number
  version_id: string
  signature: string
  width?: number
  height?: number
  format: string
  resource_type: ResourceType
  created_at: string
  tags: string[]
  pages?: number
  bytes: number
  type: DeliveryType
  etag: string
  placeholder?: boolean
  url: string
  secure_url: string
  folder: string
  access_mode: 'public' | 'authenticated'
  original_filename?: string
  original_extension?: string
  moderation?: ModerationResult[]
  eager?: EagerResult[]
  api_key: string
  asset_id: string
  colors?: Array<[string, number]>
  predominant?: {
    google: Array<[string, number]>
  }
  phash?: string
  faces?: number[][]
  image_metadata?: Record<string, string>
  video?: VideoInfo
  audio?: AudioInfo
  frame_rate?: number
  duration?: number
  bit_rate?: number
  nb_frames?: number
  rotation?: number
}

export interface ModerationResult {
  status: 'pending' | 'approved' | 'rejected'
  kind: string
  response?: Record<string, unknown>
}

export interface EagerResult {
  transformation: string
  width: number
  height: number
  bytes: number
  format: string
  url: string
  secure_url: string
}

export interface VideoInfo {
  pix_format: string
  codec: string
  level: number
  profile: string
  bit_rate: string
  dar: string
  time_base: string
}

export interface AudioInfo {
  codec: string
  bit_rate: string
  frequency: number
  channels: number
  channel_layout: string
}

// =============================================================================
// Admin API Types
// =============================================================================

export interface ResourceInfo {
  public_id: string
  format: string
  version: number
  resource_type: ResourceType
  type: DeliveryType
  created_at: string
  bytes: number
  width?: number
  height?: number
  folder: string
  url: string
  secure_url: string
  access_mode: 'public' | 'authenticated'
  tags: string[]
  context?: Record<string, string>
  metadata?: Record<string, string>
  asset_id: string
  derived?: DerivedResource[]
}

export interface DerivedResource {
  transformation: string
  format: string
  bytes: number
  id: string
  url: string
  secure_url: string
}

export interface ResourceListOptions {
  resource_type?: ResourceType
  type?: DeliveryType
  prefix?: string
  public_ids?: string[]
  max_results?: number
  next_cursor?: string
  start_at?: string
  direction?: 'asc' | 'desc'
  tags?: boolean
  context?: boolean
  metadata?: boolean
  moderations?: boolean
}

export interface ResourceListResponse {
  resources: ResourceInfo[]
  rate_limit_allowed: number
  rate_limit_remaining: number
  rate_limit_reset_at: string
  next_cursor?: string
}

export interface DeleteResourcesOptions {
  resource_type?: ResourceType
  type?: DeliveryType
  public_ids?: string[]
  prefix?: string
  all?: boolean
  invalidate?: boolean
  next_cursor?: string
  keep_original?: boolean
  transformations?: string[]
}

export interface DeleteResourcesResponse {
  deleted: Record<string, string>
  deleted_counts: Record<string, Record<string, number>>
  partial: boolean
  rate_limit_allowed: number
  rate_limit_remaining: number
  rate_limit_reset_at: string
  next_cursor?: string
}

// =============================================================================
// Folder Types
// =============================================================================

export interface FolderInfo {
  name: string
  path: string
  external_id?: string
}

export interface FoldersResponse {
  folders: FolderInfo[]
  total_count: number
  next_cursor?: string
}

export interface CreateFolderResponse {
  success: boolean
  path: string
  name: string
}

export interface DeleteFolderResponse {
  deleted: string[]
}

// =============================================================================
// Tag Types
// =============================================================================

export interface TagsListOptions {
  resource_type?: ResourceType
  prefix?: string
  max_results?: number
  next_cursor?: string
}

export interface TagsListResponse {
  tags: string[]
  next_cursor?: string
}

export interface TagResourcesOptions {
  resource_type?: ResourceType
  type?: DeliveryType
}

export interface TagResourcesResponse {
  public_ids: string[]
}

// =============================================================================
// Search API Types
// =============================================================================

export interface SearchExpression {
  expression: string
  sort_by?: Array<{ field: string; direction: 'asc' | 'desc' }>
  max_results?: number
  next_cursor?: string
  with_field?: string[]
  aggregate?: string[]
  fields?: string[]
}

export interface SearchResult {
  total_count: number
  time: number
  resources: ResourceInfo[]
  next_cursor?: string
  aggregations?: Record<string, AggregationResult[]>
}

export interface AggregationResult {
  value: string
  count: number
}

// =============================================================================
// URL Generation
// =============================================================================

export interface UrlOptions {
  cloud_name?: string
  resource_type?: ResourceType
  type?: DeliveryType
  transformation?: Transformation | Transformation[]
  format?: AssetFormat
  secure?: boolean
  secure_distribution?: string
  private_cdn?: boolean
  cdn_subdomain?: boolean
  sign_url?: boolean
  long_url_signature?: boolean
  auth_token?: AuthToken
  version?: number | string
}

export interface AuthToken {
  key: string
  duration?: number
  start_time?: number
  expiration?: number
  ip?: string
  acl?: string
  url?: string
}

// =============================================================================
// Internal Storage Types
// =============================================================================

export interface InternalAsset {
  public_id: string
  asset_id: string
  version: number
  version_id: string
  format: string
  resource_type: ResourceType
  type: DeliveryType
  created_at: Date
  bytes: number
  width?: number
  height?: number
  folder: string
  access_mode: 'public' | 'authenticated'
  tags: string[]
  context: Record<string, string>
  metadata: Record<string, string>
  data: Uint8Array
  content_type: string
  etag: string
  // Video/audio specific
  duration?: number
  bit_rate?: number
  frame_rate?: number
  rotation?: number
  video?: VideoInfo
  audio?: AudioInfo
}

export interface InternalFolder {
  name: string
  path: string
  external_id: string
  created_at: Date
}

export interface InternalDerived {
  id: string
  public_id: string
  transformation: string
  format: string
  bytes: number
  data: Uint8Array
  created_at: Date
}
