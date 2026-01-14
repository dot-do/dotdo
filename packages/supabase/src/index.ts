/**
 * @dotdo/supabase - Supabase SDK compat
 *
 * Drop-in replacement for @supabase/supabase-js backed by in-memory storage.
 * This implementation provides the full Supabase Client API including:
 * - Database queries (select, insert, update, delete, upsert)
 * - Authentication (signUp, signIn, signOut, MFA)
 * - Storage (upload, download, buckets)
 * - Realtime (channels, presence, postgres_changes)
 * - Edge Functions (invoke)
 *
 * @example
 * ```typescript
 * import { createClient } from '@dotdo/supabase'
 *
 * const supabase = createClient('https://project.supabase.co', 'anon-key')
 *
 * // Database
 * const { data, error } = await supabase
 *   .from('users')
 *   .select('*')
 *   .eq('active', true)
 *
 * // Auth
 * await supabase.auth.signInWithPassword({ email, password })
 *
 * // Storage
 * await supabase.storage.from('avatars').upload('avatar.png', file)
 *
 * // Realtime
 * supabase.channel('room')
 *   .on('postgres_changes', { event: '*', table: 'messages' }, callback)
 *   .subscribe()
 * ```
 *
 * @see https://supabase.com/docs/reference/javascript
 */

// Types
export type {
  // Value types
  Json,
  Row,

  // Error types
  PostgrestError,
  AuthError,
  StorageError,
  RealtimeError,

  // Response types
  PostgrestResponse,
  PostgrestSingleResponse,
  PostgrestMaybeSingleResponse,
  AuthResponse,
  UserResponse,
  SessionResponse,
  StorageFileResponse,
  StorageListResponse,
  StorageDownloadResponse,
  StorageRemoveResponse,
  StorageUrlResponse,
  StorageSignedUrlResponse,

  // User & Session types
  UserIdentity,
  UserMetadata,
  UserAppMetadata,
  User,
  Session,

  // Storage types
  FileObject,
  Bucket,
  UploadOptions,
  ListOptions,
  TransformOptions,

  // Realtime types
  RealtimeChannelState,
  RealtimePresenceState,
  RealtimePresenceJoinPayload,
  RealtimePresenceLeavePayload,
  RealtimeBroadcastPayload,
  RealtimePostgresChangesPayload,
  RealtimePostgresChangesFilter,
  RealtimeChannelOptions,
  RealtimeChannelSendOptions,
  RealtimeChannel,

  // Query builder types
  CountOption,
  FilterOperator,
  PostgrestFilterBuilder,
  PostgrestTransformBuilder,
  PostgrestQueryBuilder,

  // Client types
  StorageFileApi,
  StorageBucketApi,
  StorageClient,
  SignUpCredentials,
  SignInWithPasswordCredentials,
  SignInWithOAuthCredentials,
  SignInWithOTPCredentials,
  SignInWithIdTokenCredentials,
  SignInWithSSOCredentials,
  VerifyOTPParams,
  ResetPasswordOptions,
  UserAttributes,
  AuthChangeEvent,
  AuthStateChangeCallback,
  AuthSubscription,
  Factor,
  MFAChallenge,
  AuthClient,
  FunctionInvokeOptions,
  FunctionResponse,
  FunctionsClient,
  SupabaseClientOptions,
  ExtendedSupabaseConfig,
  RealtimeClient,
  SupabaseClient,
} from './types'

// Core function
export { createClient } from './client'
