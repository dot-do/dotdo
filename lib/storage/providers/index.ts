/**
 * Storage Provider Adapters
 *
 * Unified interface for external storage providers in Provider Mode.
 * Allows dotdo to use external storage services as backends.
 *
 * @module lib/storage/providers
 */

// Types and interfaces
export type {
  StorageProviderType,
  StorageProviderErrorCode,
  ObjectMetadata,
  WriteOptions,
  ReadOptions,
  WriteResult,
  ReadResult,
  ListOptions,
  ListResult,
  CopyOptions,
  SignedUrlOptions,
  MultipartUpload,
  UploadPart,
  StorageProvider,
  StorageProviderConfig,
  S3ProviderConfig,
  GCSProviderConfig,
  SupabaseStorageProviderConfig,
  B2ProviderConfig,
  AnyStorageProviderConfig,
} from './interface'

export { StorageProviderError } from './interface'

// Provider implementations
export { S3Provider } from './s3'
export { GCSProvider } from './gcs'
export { SupabaseStorageProvider } from './supabase'
export { B2Provider } from './b2'

// Factory function
import type { AnyStorageProviderConfig, StorageProvider } from './interface'
import { S3Provider } from './s3'
import { GCSProvider } from './gcs'
import { SupabaseStorageProvider } from './supabase'
import { B2Provider } from './b2'

/**
 * Create a storage provider from configuration.
 *
 * @param config - Provider configuration
 * @returns Storage provider instance
 *
 * @example
 * ```typescript
 * // AWS S3
 * const s3 = createStorageProvider({
 *   type: 's3',
 *   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
 *   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
 *   bucket: 'my-bucket',
 *   region: 'us-east-1',
 * })
 *
 * // Google Cloud Storage
 * const gcs = createStorageProvider({
 *   type: 'gcs',
 *   bucket: 'my-bucket',
 *   credentials: process.env.GCS_CREDENTIALS,
 * })
 *
 * // Supabase Storage
 * const supabase = createStorageProvider({
 *   type: 'supabase',
 *   url: 'https://your-project.supabase.co',
 *   key: process.env.SUPABASE_SERVICE_KEY,
 *   bucket: 'my-bucket',
 * })
 *
 * // Backblaze B2
 * const b2 = createStorageProvider({
 *   type: 'b2',
 *   applicationKeyId: process.env.B2_APPLICATION_KEY_ID,
 *   applicationKey: process.env.B2_APPLICATION_KEY,
 *   bucket: 'my-bucket',
 *   bucketId: 'bucket123',
 * })
 *
 * // All providers implement the same interface
 * await provider.put('file.txt', data)
 * const result = await provider.get('file.txt')
 * ```
 */
export function createStorageProvider(config: AnyStorageProviderConfig): StorageProvider {
  switch (config.type) {
    case 's3':
      return new S3Provider(config)
    case 'gcs':
      return new GCSProvider(config)
    case 'supabase':
      return new SupabaseStorageProvider(config)
    case 'b2':
      return new B2Provider(config)
    default:
      throw new Error(`Unknown provider type: ${(config as { type: string }).type}`)
  }
}
