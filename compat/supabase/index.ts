/**
 * @dotdo/supabase - Supabase Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for Supabase client with enhanced security
 * and edge-optimized performance.
 *
 * @example
 * ```typescript
 * import { generateRecoveryCodes, createMFAApi, StorageClient } from '@dotdo/supabase'
 *
 * // Generate secure MFA recovery codes
 * const codes = generateRecoveryCodes()
 * // ['ABCD-EFGH-JKLM-NPQR', 'STUV-WXYZ-2345-6789', ...]
 *
 * // Create MFA API instance
 * const mfa = createMFAApi()
 * const { data, error } = await mfa.getRecoveryCodes()
 *
 * // Use Supabase-compatible storage
 * const storage = new StorageClient('https://project.supabase.co/storage/v1', {
 *   apikey: 'your-api-key',
 * })
 * await storage.createBucket('avatars', { public: true })
 * const file = storage.from('avatars')
 * await file.upload('user/avatar.png', imageData, { contentType: 'image/png' })
 * ```
 *
 * @module
 */

export {
  // Recovery code generation
  generateRecoveryCodes,
  RECOVERY_CODE_CONFIG,

  // MFA API
  createMFAApi,

  // Types
  type RecoveryCodeOptions,
  type MFAEnrollResponse,
  type MFAChallengeResponse,
  type MFAVerifyResponse,
  type MFAApi,
} from './supabase'

// Storage exports
export {
  StorageClient,
  StorageFileApi,
  _clearAll as clearStorage,
  createTestClient,
} from './storage'

export type {
  // Storage client options
  StorageClientOptions,

  // Storage types
  Bucket,
  CreateBucketOptions,
  UpdateBucketOptions,
  FileObject,
  FileObjectV2,
  FileMetadata,
  FileOptions,
  TransformOptions,
  UploadOptions,
  DownloadOptions,
  CreateSignedUrlOptions,
  SignedUrl,
  SignedUploadUrl,
  SearchOptions,
  ListOptions,
  StorageApiResponse,
  StorageError,
  UploadResponse,
} from './storage'

// Default export
export { default } from './supabase'
