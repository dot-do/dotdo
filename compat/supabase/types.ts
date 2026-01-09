/**
 * @dotdo/supabase types
 *
 * @supabase/supabase-js-compatible type definitions
 * for the Supabase SDK backed by Durable Objects
 *
 * @see https://supabase.com/docs/reference/javascript
 */

// ============================================================================
// VALUE TYPES
// ============================================================================

/**
 * JSON-compatible value types
 */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

/**
 * Generic record type for database rows
 */
export type Row = Record<string, unknown>

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Supabase/Postgrest error
 */
export interface PostgrestError {
  message: string
  details: string
  hint: string
  code: string
}

/**
 * Auth error
 */
export interface AuthError {
  message: string
  status?: number
  name: string
}

/**
 * Storage error
 */
export interface StorageError {
  message: string
  statusCode: string
  error?: string
}

/**
 * Realtime error
 */
export interface RealtimeError {
  message: string
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/**
 * Postgrest response wrapper
 */
export interface PostgrestResponse<T> {
  data: T | null
  error: PostgrestError | null
  count: number | null
  status: number
  statusText: string
}

/**
 * Postgrest single response
 */
export interface PostgrestSingleResponse<T> extends PostgrestResponse<T> {
  data: T | null
}

/**
 * Postgrest maybe single response
 */
export interface PostgrestMaybeSingleResponse<T> extends PostgrestResponse<T> {
  data: T | null
}

/**
 * Auth response wrapper
 */
export interface AuthResponse {
  data: {
    user: User | null
    session: Session | null
  }
  error: AuthError | null
}

/**
 * User response
 */
export interface UserResponse {
  data: {
    user: User | null
  }
  error: AuthError | null
}

/**
 * Session response
 */
export interface SessionResponse {
  data: {
    session: Session | null
  }
  error: AuthError | null
}

/**
 * Storage file response
 */
export interface StorageFileResponse {
  data: {
    path: string
  } | null
  error: StorageError | null
}

/**
 * Storage list response
 */
export interface StorageListResponse {
  data: FileObject[] | null
  error: StorageError | null
}

/**
 * Storage download response
 */
export interface StorageDownloadResponse {
  data: Blob | null
  error: StorageError | null
}

/**
 * Storage remove response
 */
export interface StorageRemoveResponse {
  data: FileObject[] | null
  error: StorageError | null
}

/**
 * Storage URL response
 */
export interface StorageUrlResponse {
  data: {
    publicUrl: string
  } | null
  error: StorageError | null
}

/**
 * Storage signed URL response
 */
export interface StorageSignedUrlResponse {
  data: {
    signedUrl: string
  } | null
  error: StorageError | null
}

// ============================================================================
// USER & SESSION TYPES
// ============================================================================

/**
 * User identity from an OAuth provider
 */
export interface UserIdentity {
  id: string
  user_id: string
  identity_data: Record<string, unknown>
  provider: string
  created_at: string
  last_sign_in_at: string
  updated_at?: string
}

/**
 * User metadata
 */
export interface UserMetadata {
  [key: string]: unknown
}

/**
 * User app metadata
 */
export interface UserAppMetadata {
  provider?: string
  providers?: string[]
  [key: string]: unknown
}

/**
 * Supabase User
 */
export interface User {
  id: string
  aud: string
  role?: string
  email?: string
  email_confirmed_at?: string
  phone?: string
  phone_confirmed_at?: string
  confirmed_at?: string
  last_sign_in_at?: string
  app_metadata: UserAppMetadata
  user_metadata: UserMetadata
  identities?: UserIdentity[]
  created_at: string
  updated_at?: string
}

/**
 * Session data
 */
export interface Session {
  access_token: string
  token_type: string
  expires_in: number
  expires_at?: number
  refresh_token: string
  user: User
}

// ============================================================================
// STORAGE TYPES
// ============================================================================

/**
 * File object metadata
 */
export interface FileObject {
  id?: string
  name: string
  bucket_id?: string
  owner?: string
  created_at?: string
  updated_at?: string
  last_accessed_at?: string
  metadata?: Record<string, unknown>
  buckets?: Bucket
}

/**
 * Storage bucket
 */
export interface Bucket {
  id: string
  name: string
  owner?: string
  public: boolean
  created_at?: string
  updated_at?: string
  file_size_limit?: number
  allowed_mime_types?: string[]
}

/**
 * Upload options
 */
export interface UploadOptions {
  cacheControl?: string
  contentType?: string
  duplex?: string
  upsert?: boolean
  metadata?: Record<string, string>
}

/**
 * List options
 */
export interface ListOptions {
  limit?: number
  offset?: number
  sortBy?: {
    column: string
    order: 'asc' | 'desc'
  }
  search?: string
}

/**
 * Transform options for images
 */
export interface TransformOptions {
  width?: number
  height?: number
  resize?: 'cover' | 'contain' | 'fill'
  format?: 'origin' | 'avif' | 'webp'
  quality?: number
}

// ============================================================================
// REALTIME TYPES
// ============================================================================

/**
 * Realtime subscription statuses
 */
export type RealtimeChannelState =
  | 'SUBSCRIBED'
  | 'TIMED_OUT'
  | 'CLOSED'
  | 'CHANNEL_ERROR'

/**
 * Realtime presence state
 */
export interface RealtimePresenceState {
  [key: string]: {
    presence_ref: string
    [key: string]: unknown
  }[]
}

/**
 * Realtime presence join/leave payload
 */
export interface RealtimePresenceJoinPayload {
  key: string
  currentPresences: unknown[]
  newPresences: unknown[]
}

export interface RealtimePresenceLeavePayload {
  key: string
  currentPresences: unknown[]
  leftPresences: unknown[]
}

/**
 * Realtime broadcast payload
 */
export interface RealtimeBroadcastPayload {
  type: string
  event: string
  payload: unknown
}

/**
 * Realtime postgres changes payload
 */
export interface RealtimePostgresChangesPayload<T = Row> {
  schema: string
  table: string
  commit_timestamp: string
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: T
  old: Partial<T>
  errors: string[] | null
}

/**
 * Realtime postgres changes filter
 */
export interface RealtimePostgresChangesFilter {
  event: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
  schema?: string
  table?: string
  filter?: string
}

/**
 * Realtime channel options
 */
export interface RealtimeChannelOptions {
  config?: {
    broadcast?: {
      self?: boolean
      ack?: boolean
    }
    presence?: {
      key?: string
    }
  }
}

/**
 * Realtime channel send options
 */
export interface RealtimeChannelSendOptions {
  type: 'broadcast' | 'presence'
  event: string
  payload?: unknown
}

/**
 * Realtime channel interface
 */
export interface RealtimeChannel {
  /** Subscribe to channel */
  subscribe(
    callback?: (status: RealtimeChannelState, err?: RealtimeError) => void
  ): RealtimeChannel

  /** Unsubscribe from channel */
  unsubscribe(): Promise<'ok' | 'timed_out' | 'error'>

  /** Listen for broadcast events */
  on(
    type: 'broadcast',
    filter: { event: string },
    callback: (payload: RealtimeBroadcastPayload) => void
  ): RealtimeChannel

  /** Listen for presence sync */
  on(
    type: 'presence',
    filter: { event: 'sync' },
    callback: () => void
  ): RealtimeChannel

  /** Listen for presence join */
  on(
    type: 'presence',
    filter: { event: 'join' },
    callback: (payload: RealtimePresenceJoinPayload) => void
  ): RealtimeChannel

  /** Listen for presence leave */
  on(
    type: 'presence',
    filter: { event: 'leave' },
    callback: (payload: RealtimePresenceLeavePayload) => void
  ): RealtimeChannel

  /** Listen for postgres changes */
  on<T = Row>(
    type: 'postgres_changes',
    filter: RealtimePostgresChangesFilter,
    callback: (payload: RealtimePostgresChangesPayload<T>) => void
  ): RealtimeChannel

  /** Send broadcast message */
  send(options: RealtimeChannelSendOptions): Promise<'ok' | 'timed_out' | 'error'>

  /** Track presence */
  track(payload: Record<string, unknown>): Promise<'ok' | 'timed_out' | 'error'>

  /** Untrack presence */
  untrack(): Promise<'ok' | 'timed_out' | 'error'>

  /** Get presence state */
  presenceState(): RealtimePresenceState
}

// ============================================================================
// QUERY BUILDER TYPES
// ============================================================================

/**
 * Count options
 */
export type CountOption = 'exact' | 'planned' | 'estimated'

/**
 * Filter operators
 */
export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'ilike'
  | 'is'
  | 'in'
  | 'contains'
  | 'containedBy'
  | 'rangeGt'
  | 'rangeGte'
  | 'rangeLt'
  | 'rangeLte'
  | 'rangeAdjacent'
  | 'overlaps'
  | 'textSearch'
  | 'match'
  | 'not'

/**
 * Postgrest filter builder
 */
export interface PostgrestFilterBuilder<T> {
  /** Equal */
  eq<K extends keyof T>(column: K, value: T[K]): PostgrestFilterBuilder<T>
  /** Not equal */
  neq<K extends keyof T>(column: K, value: T[K]): PostgrestFilterBuilder<T>
  /** Greater than */
  gt<K extends keyof T>(column: K, value: T[K]): PostgrestFilterBuilder<T>
  /** Greater than or equal */
  gte<K extends keyof T>(column: K, value: T[K]): PostgrestFilterBuilder<T>
  /** Less than */
  lt<K extends keyof T>(column: K, value: T[K]): PostgrestFilterBuilder<T>
  /** Less than or equal */
  lte<K extends keyof T>(column: K, value: T[K]): PostgrestFilterBuilder<T>
  /** Pattern match LIKE */
  like<K extends keyof T>(column: K, pattern: string): PostgrestFilterBuilder<T>
  /** Case-insensitive pattern match */
  ilike<K extends keyof T>(column: K, pattern: string): PostgrestFilterBuilder<T>
  /** Is null/true/false */
  is<K extends keyof T>(column: K, value: null | boolean): PostgrestFilterBuilder<T>
  /** In list */
  in<K extends keyof T>(column: K, values: T[K][]): PostgrestFilterBuilder<T>
  /** Array contains */
  contains<K extends keyof T>(column: K, value: T[K]): PostgrestFilterBuilder<T>
  /** Array contained by */
  containedBy<K extends keyof T>(column: K, value: T[K]): PostgrestFilterBuilder<T>
  /** Range greater than */
  rangeGt<K extends keyof T>(column: K, range: string): PostgrestFilterBuilder<T>
  /** Range greater than or equal */
  rangeGte<K extends keyof T>(column: K, range: string): PostgrestFilterBuilder<T>
  /** Range less than */
  rangeLt<K extends keyof T>(column: K, range: string): PostgrestFilterBuilder<T>
  /** Range less than or equal */
  rangeLte<K extends keyof T>(column: K, range: string): PostgrestFilterBuilder<T>
  /** Range adjacent */
  rangeAdjacent<K extends keyof T>(column: K, range: string): PostgrestFilterBuilder<T>
  /** Array overlaps */
  overlaps<K extends keyof T>(column: K, value: T[K]): PostgrestFilterBuilder<T>
  /** Full-text search */
  textSearch<K extends keyof T>(
    column: K,
    query: string,
    options?: { type?: 'plain' | 'phrase' | 'websearch'; config?: string }
  ): PostgrestFilterBuilder<T>
  /** Pattern match */
  match(query: Partial<T>): PostgrestFilterBuilder<T>
  /** Negate filter */
  not<K extends keyof T>(
    column: K,
    operator: FilterOperator,
    value: unknown
  ): PostgrestFilterBuilder<T>
  /** OR filter */
  or(filters: string, options?: { foreignTable?: string }): PostgrestFilterBuilder<T>
  /** Filter on foreign table */
  filter<K extends keyof T>(
    column: K,
    operator: FilterOperator,
    value: unknown
  ): PostgrestFilterBuilder<T>

  /** Order results */
  order<K extends keyof T>(
    column: K,
    options?: { ascending?: boolean; nullsFirst?: boolean; foreignTable?: string }
  ): PostgrestFilterBuilder<T>
  /** Limit results */
  limit(count: number, options?: { foreignTable?: string }): PostgrestFilterBuilder<T>
  /** Offset/skip results */
  range(from: number, to: number, options?: { foreignTable?: string }): PostgrestFilterBuilder<T>

  /** Return single row */
  single(): PromiseLike<PostgrestSingleResponse<T>>
  /** Return maybe single row (null if no match) */
  maybeSingle(): PromiseLike<PostgrestMaybeSingleResponse<T>>
  /** Return CSV */
  csv(): PromiseLike<PostgrestResponse<string>>
  /** Return GeoJSON */
  geojson(): PromiseLike<PostgrestResponse<unknown>>
  /** Explain query plan */
  explain(options?: {
    analyze?: boolean
    verbose?: boolean
    settings?: boolean
    buffers?: boolean
    wal?: boolean
    format?: 'json' | 'text'
  }): PromiseLike<PostgrestResponse<unknown>>

  /** Abort controller */
  abortSignal(signal: AbortSignal): PostgrestFilterBuilder<T>

  /** Execute and return promise */
  then<TResult1 = PostgrestResponse<T[]>, TResult2 = never>(
    onfulfilled?: ((value: PostgrestResponse<T[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2>
}

/**
 * Postgrest transform builder (after select)
 */
export interface PostgrestTransformBuilder<T> extends PostgrestFilterBuilder<T> {
  /** Select specific columns */
  select(columns?: string): PostgrestFilterBuilder<T>
}

/**
 * Postgrest query builder (main entry point)
 */
export interface PostgrestQueryBuilder<T> {
  /** Select rows */
  select(
    columns?: string,
    options?: { head?: boolean; count?: CountOption }
  ): PostgrestFilterBuilder<T>

  /** Insert rows */
  insert(
    values: Partial<T> | Partial<T>[],
    options?: { count?: CountOption; defaultToNull?: boolean }
  ): PostgrestFilterBuilder<T>

  /** Update rows */
  update(
    values: Partial<T>,
    options?: { count?: CountOption }
  ): PostgrestFilterBuilder<T>

  /** Upsert rows */
  upsert(
    values: Partial<T> | Partial<T>[],
    options?: {
      count?: CountOption
      ignoreDuplicates?: boolean
      onConflict?: string
      defaultToNull?: boolean
    }
  ): PostgrestFilterBuilder<T>

  /** Delete rows */
  delete(options?: { count?: CountOption }): PostgrestFilterBuilder<T>
}

// ============================================================================
// STORAGE CLIENT TYPES
// ============================================================================

/**
 * Storage file API
 */
export interface StorageFileApi {
  /** Upload file */
  upload(
    path: string,
    file: File | Blob | ArrayBuffer | FormData | string,
    options?: UploadOptions
  ): Promise<StorageFileResponse>

  /** Download file */
  download(path: string, options?: TransformOptions): Promise<StorageDownloadResponse>

  /** Get public URL */
  getPublicUrl(path: string, options?: TransformOptions): StorageUrlResponse

  /** Create signed URL */
  createSignedUrl(
    path: string,
    expiresIn: number,
    options?: TransformOptions
  ): Promise<StorageSignedUrlResponse>

  /** Create signed URLs */
  createSignedUrls(
    paths: string[],
    expiresIn: number
  ): Promise<{ data: { signedUrl: string; path: string; error: string | null }[] | null; error: StorageError | null }>

  /** List files */
  list(path?: string, options?: ListOptions): Promise<StorageListResponse>

  /** Move file */
  move(fromPath: string, toPath: string): Promise<{ data: { message: string } | null; error: StorageError | null }>

  /** Copy file */
  copy(fromPath: string, toPath: string): Promise<StorageFileResponse>

  /** Remove files */
  remove(paths: string[]): Promise<StorageRemoveResponse>

  /** Update file (upsert) */
  update(
    path: string,
    file: File | Blob | ArrayBuffer | FormData | string,
    options?: UploadOptions
  ): Promise<StorageFileResponse>
}

/**
 * Storage bucket API
 */
export interface StorageBucketApi {
  /** List buckets */
  listBuckets(): Promise<{ data: Bucket[] | null; error: StorageError | null }>

  /** Get bucket */
  getBucket(id: string): Promise<{ data: Bucket | null; error: StorageError | null }>

  /** Create bucket */
  createBucket(
    id: string,
    options?: { public?: boolean; fileSizeLimit?: number; allowedMimeTypes?: string[] }
  ): Promise<{ data: { name: string } | null; error: StorageError | null }>

  /** Update bucket */
  updateBucket(
    id: string,
    options: { public?: boolean; fileSizeLimit?: number; allowedMimeTypes?: string[] }
  ): Promise<{ data: { message: string } | null; error: StorageError | null }>

  /** Delete bucket */
  deleteBucket(id: string): Promise<{ data: { message: string } | null; error: StorageError | null }>

  /** Empty bucket */
  emptyBucket(id: string): Promise<{ data: { message: string } | null; error: StorageError | null }>
}

/**
 * Storage client
 */
export interface StorageClient extends StorageBucketApi {
  /** Get file API for bucket */
  from(bucketId: string): StorageFileApi
}

// ============================================================================
// AUTH CLIENT TYPES
// ============================================================================

/**
 * Sign up credentials
 */
export interface SignUpCredentials {
  email?: string
  phone?: string
  password: string
  options?: {
    emailRedirectTo?: string
    data?: UserMetadata
    captchaToken?: string
  }
}

/**
 * Sign in with password credentials
 */
export interface SignInWithPasswordCredentials {
  email?: string
  phone?: string
  password: string
  options?: {
    captchaToken?: string
  }
}

/**
 * Sign in with OAuth credentials
 */
export interface SignInWithOAuthCredentials {
  provider:
    | 'apple'
    | 'azure'
    | 'bitbucket'
    | 'discord'
    | 'facebook'
    | 'figma'
    | 'github'
    | 'gitlab'
    | 'google'
    | 'kakao'
    | 'keycloak'
    | 'linkedin'
    | 'linkedin_oidc'
    | 'notion'
    | 'slack'
    | 'spotify'
    | 'twitch'
    | 'twitter'
    | 'workos'
    | 'zoom'
  options?: {
    redirectTo?: string
    scopes?: string
    queryParams?: Record<string, string>
    skipBrowserRedirect?: boolean
  }
}

/**
 * Sign in with OTP credentials
 */
export interface SignInWithOTPCredentials {
  email?: string
  phone?: string
  options?: {
    emailRedirectTo?: string
    shouldCreateUser?: boolean
    captchaToken?: string
  }
}

/**
 * Sign in with ID token credentials
 */
export interface SignInWithIdTokenCredentials {
  provider: 'apple' | 'google'
  token: string
  access_token?: string
  nonce?: string
  options?: {
    captchaToken?: string
  }
}

/**
 * Sign in with SSO credentials
 */
export interface SignInWithSSOCredentials {
  providerId?: string
  domain?: string
  options?: {
    redirectTo?: string
    captchaToken?: string
  }
}

/**
 * Verify OTP params
 */
export interface VerifyOTPParams {
  email?: string
  phone?: string
  token: string
  type: 'sms' | 'email' | 'signup' | 'invite' | 'magiclink' | 'recovery'
  options?: {
    redirectTo?: string
    captchaToken?: string
  }
}

/**
 * Reset password options
 */
export interface ResetPasswordOptions {
  redirectTo?: string
  captchaToken?: string
}

/**
 * User attributes to update
 */
export interface UserAttributes {
  email?: string
  phone?: string
  password?: string
  data?: UserMetadata
  nonce?: string
}

/**
 * Auth state change event
 */
export type AuthChangeEvent =
  | 'INITIAL_SESSION'
  | 'PASSWORD_RECOVERY'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'MFA_CHALLENGE_VERIFIED'

/**
 * Auth state change callback
 */
export type AuthStateChangeCallback = (
  event: AuthChangeEvent,
  session: Session | null
) => void

/**
 * Auth subscription
 */
export interface AuthSubscription {
  unsubscribe: () => void
}

/**
 * MFA Factor
 */
export interface Factor {
  id: string
  friendly_name?: string
  factor_type: 'totp' | 'phone'
  status: 'verified' | 'unverified'
  created_at: string
  updated_at: string
  phone?: string
}

/**
 * MFA challenge
 */
export interface MFAChallenge {
  id: string
  expires_at: number
}

/**
 * Auth client
 */
export interface AuthClient {
  /** Sign up new user */
  signUp(credentials: SignUpCredentials): Promise<AuthResponse>

  /** Sign in with password */
  signInWithPassword(credentials: SignInWithPasswordCredentials): Promise<AuthResponse>

  /** Sign in with OAuth */
  signInWithOAuth(
    credentials: SignInWithOAuthCredentials
  ): Promise<{ data: { provider: string; url: string } | null; error: AuthError | null }>

  /** Sign in with OTP (magic link) */
  signInWithOtp(credentials: SignInWithOTPCredentials): Promise<AuthResponse>

  /** Sign in with ID token */
  signInWithIdToken(credentials: SignInWithIdTokenCredentials): Promise<AuthResponse>

  /** Sign in with SSO */
  signInWithSSO(
    credentials: SignInWithSSOCredentials
  ): Promise<{ data: { url: string } | null; error: AuthError | null }>

  /** Verify OTP */
  verifyOtp(params: VerifyOTPParams): Promise<AuthResponse>

  /** Sign out */
  signOut(options?: { scope?: 'global' | 'local' | 'others' }): Promise<{ error: AuthError | null }>

  /** Get current session */
  getSession(): Promise<SessionResponse>

  /** Get current user */
  getUser(): Promise<UserResponse>

  /** Refresh session */
  refreshSession(params?: { refreshToken?: string }): Promise<AuthResponse>

  /** Set session */
  setSession(params: {
    access_token: string
    refresh_token: string
  }): Promise<AuthResponse>

  /** Update user */
  updateUser(attributes: UserAttributes): Promise<UserResponse>

  /** Reset password */
  resetPasswordForEmail(email: string, options?: ResetPasswordOptions): Promise<{ data: object | null; error: AuthError | null }>

  /** Reauthenticate */
  reauthenticate(): Promise<AuthResponse>

  /** Resend verification */
  resend(params: {
    type: 'signup' | 'email_change' | 'sms' | 'phone_change'
    email?: string
    phone?: string
    options?: { emailRedirectTo?: string; captchaToken?: string }
  }): Promise<{ data: { message_id: string } | null; error: AuthError | null }>

  /** Exchange code for session */
  exchangeCodeForSession(authCode: string): Promise<AuthResponse>

  /** Listen to auth state changes */
  onAuthStateChange(callback: AuthStateChangeCallback): { data: { subscription: AuthSubscription } }

  /** MFA enrollment */
  mfa: {
    enroll(params: { factorType: 'totp'; issuer?: string; friendlyName?: string }): Promise<{
      data: {
        id: string
        type: 'totp'
        totp: { qr_code: string; secret: string; uri: string }
      } | null
      error: AuthError | null
    }>
    challenge(params: { factorId: string }): Promise<{ data: MFAChallenge | null; error: AuthError | null }>
    verify(params: { factorId: string; challengeId: string; code: string }): Promise<AuthResponse>
    unenroll(params: { factorId: string }): Promise<{ data: { id: string } | null; error: AuthError | null }>
    listFactors(): Promise<{ data: { all: Factor[]; totp: Factor[] } | null; error: AuthError | null }>
    getAuthenticatorAssuranceLevel(): Promise<{
      data: {
        currentLevel: 'aal1' | 'aal2' | null
        nextLevel: 'aal1' | 'aal2' | null
        currentAuthenticationMethods: { method: string; timestamp: number }[]
      } | null
      error: AuthError | null
    }>
  }
}

// ============================================================================
// FUNCTIONS CLIENT TYPES
// ============================================================================

/**
 * Function invoke options
 */
export interface FunctionInvokeOptions {
  body?: string | FormData | ArrayBuffer | Blob | Record<string, unknown>
  headers?: Record<string, string>
}

/**
 * Function response
 */
export interface FunctionResponse<T = unknown> {
  data: T | null
  error: { message: string; context?: unknown } | null
}

/**
 * Functions client
 */
export interface FunctionsClient {
  /** Invoke edge function */
  invoke<T = unknown>(
    functionName: string,
    options?: FunctionInvokeOptions
  ): Promise<FunctionResponse<T>>

  /** Set auth token */
  setAuth(accessToken: string): void
}

// ============================================================================
// CLIENT CONFIG TYPES
// ============================================================================

/**
 * Supabase client options
 */
export interface SupabaseClientOptions {
  auth?: {
    autoRefreshToken?: boolean
    persistSession?: boolean
    detectSessionInUrl?: boolean
    storage?: {
      getItem(key: string): string | null | Promise<string | null>
      setItem(key: string, value: string): void | Promise<void>
      removeItem(key: string): void | Promise<void>
    }
    storageKey?: string
    flowType?: 'implicit' | 'pkce'
  }
  db?: {
    schema?: string
  }
  global?: {
    headers?: Record<string, string>
    fetch?: typeof fetch
  }
  realtime?: RealtimeChannelOptions
}

/**
 * Extended config for DO-backed implementation
 */
export interface ExtendedSupabaseConfig extends SupabaseClientOptions {
  /** DO namespace binding */
  doNamespace?: DurableObjectNamespace
  /** Shard configuration */
  shard?: {
    /** Sharding algorithm */
    algorithm?: 'consistent' | 'range' | 'hash'
    /** Number of shards */
    count?: number
    /** Shard key field for routing */
    key?: string
  }
  /** Replica configuration */
  replica?: {
    /** Read preference */
    readPreference?: 'primary' | 'secondary' | 'nearest'
    /** Write-through to all replicas */
    writeThrough?: boolean
    /** Jurisdiction constraint */
    jurisdiction?: 'eu' | 'us' | 'fedramp'
  }
}

// ============================================================================
// SUPABASE CLIENT TYPES
// ============================================================================

/**
 * Realtime client
 */
export interface RealtimeClient {
  /** Create channel */
  channel(name: string, options?: RealtimeChannelOptions): RealtimeChannel

  /** Remove channel */
  removeChannel(channel: RealtimeChannel): Promise<'ok' | 'timed_out' | 'error'>

  /** Remove all channels */
  removeAllChannels(): Promise<('ok' | 'timed_out' | 'error')[]>

  /** Get all channels */
  getChannels(): RealtimeChannel[]
}

/**
 * Supabase client interface
 */
export interface SupabaseClient {
  /** Database query builder */
  from<T extends Row = Row>(table: string): PostgrestQueryBuilder<T>

  /** RPC function call */
  rpc<T = unknown>(
    fn: string,
    args?: Record<string, unknown>,
    options?: { head?: boolean; count?: CountOption }
  ): PostgrestFilterBuilder<T>

  /** Auth client */
  auth: AuthClient

  /** Storage client */
  storage: StorageClient

  /** Functions client */
  functions: FunctionsClient

  /** Realtime client */
  realtime: RealtimeClient

  /** Create realtime channel */
  channel(name: string, options?: RealtimeChannelOptions): RealtimeChannel

  /** Remove realtime channel */
  removeChannel(channel: RealtimeChannel): Promise<'ok' | 'timed_out' | 'error'>

  /** Remove all channels */
  removeAllChannels(): Promise<('ok' | 'timed_out' | 'error')[]>

  /** Get all channels */
  getChannels(): RealtimeChannel[]
}
