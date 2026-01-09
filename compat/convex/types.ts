/**
 * @dotdo/convex types
 *
 * Convex Browser SDK-compatible type definitions
 * for the Convex SDK backed by Durable Objects
 *
 * @see https://docs.convex.dev/client/javascript
 */

// ============================================================================
// DOCUMENT ID TYPES
// ============================================================================

/**
 * Opaque document ID type for a specific table
 */
export type DocumentId<TableName extends string> = string & { __tableName: TableName }

/**
 * Generic ID type (alias for DocumentId)
 */
export type GenericId<TableName extends string> = DocumentId<TableName>

/**
 * System fields present on all documents
 */
export interface SystemFields {
  _id: DocumentId<string>
  _creationTime: number
}

// ============================================================================
// FUNCTION REFERENCE TYPES
// ============================================================================

/**
 * Function type discriminator
 */
export type FunctionType = 'query' | 'mutation' | 'action'

/**
 * Function reference with type information
 */
export interface FunctionReference<Type extends FunctionType = FunctionType> {
  _name: string
  _type?: Type
  _args?: Record<string, unknown>
  _returnType?: unknown
}

/**
 * Extract arguments type from function reference
 */
export type FunctionArgs<F extends FunctionReference> = F extends FunctionReference<infer _T>
  ? F['_args'] extends Record<string, unknown>
    ? F['_args']
    : Record<string, unknown>
  : Record<string, unknown>

/**
 * Extract return type from function reference
 */
export type FunctionReturnType<F extends FunctionReference> = F extends FunctionReference<infer _T>
  ? F['_returnType']
  : unknown

// ============================================================================
// SUBSCRIPTION TYPES
// ============================================================================

/**
 * Unsubscribe function for reactive subscriptions
 */
export type Unsubscribe = () => void

/**
 * Query token for identifying subscriptions
 */
export type QueryToken = string

/**
 * Subscription callback
 */
export type SubscriptionCallback<T> = (value: T) => void

/**
 * Error callback for subscriptions
 */
export type ErrorCallback = (error: ConvexError) => void

// ============================================================================
// OPTIMISTIC UPDATE TYPES
// ============================================================================

/**
 * Local store for optimistic updates
 */
export interface OptimisticLocalStore {
  /**
   * Get the current cached value for a query
   */
  getQuery<F extends FunctionReference<'query'>>(
    query: F,
    args: FunctionArgs<F>
  ): FunctionReturnType<F> | null

  /**
   * Set the cached value for a query (optimistically)
   */
  setQuery<F extends FunctionReference<'query'>>(
    query: F,
    args: FunctionArgs<F>,
    value: FunctionReturnType<F>
  ): void
}

/**
 * Optimistic update function
 */
export type OptimisticUpdate<F extends FunctionReference<'mutation'>> = (
  localStore: OptimisticLocalStore,
  args: FunctionArgs<F>
) => void

/**
 * Mutation options including optimistic updates
 */
export interface MutationOptions<F extends FunctionReference<'mutation'>> {
  optimisticUpdate?: OptimisticUpdate<F>
}

// ============================================================================
// AUTHENTICATION TYPES
// ============================================================================

/**
 * Auth token fetcher function
 */
export type AuthTokenFetcher = () => Promise<string | null | undefined>

/**
 * Auth options
 */
export interface AuthOptions {
  /**
   * Callback when token changes
   */
  onTokenChange?: (isAuthenticated: boolean) => void
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Convex error class
 */
export interface ConvexError extends Error {
  /**
   * Error code
   */
  code?: string

  /**
   * Error data (for application-defined errors)
   */
  data?: unknown
}

// ============================================================================
// PAGINATION TYPES
// ============================================================================

/**
 * Pagination options
 */
export interface PaginationOptions {
  /**
   * Number of items to fetch
   */
  numItems: number

  /**
   * Cursor for pagination (null for first page)
   */
  cursor: string | null
}

/**
 * Pagination result
 */
export interface PaginationResult<T> {
  /**
   * Page data
   */
  page: T[]

  /**
   * Is there a next page?
   */
  isDone: boolean

  /**
   * Cursor for next page
   */
  continueCursor: string | null
}

// ============================================================================
// CLIENT OPTIONS TYPES
// ============================================================================

/**
 * Convex client options
 */
export interface ConvexClientOptions {
  /**
   * Show warning before unload if there are unsaved changes
   */
  unsavedChangesWarning?: boolean

  /**
   * Skip URL validation (for local development)
   */
  skipConvexDeploymentUrlCheck?: boolean

  /**
   * Enable verbose logging
   */
  verbose?: boolean
}

/**
 * Extended config for DO-backed implementation
 */
export interface ExtendedConvexConfig extends ConvexClientOptions {
  /**
   * DO namespace binding
   */
  doNamespace?: DurableObjectNamespace

  /**
   * Shard configuration
   */
  shard?: {
    /**
     * Sharding algorithm
     */
    algorithm?: 'consistent' | 'range' | 'hash'

    /**
     * Number of shards
     */
    count?: number

    /**
     * Shard key field for routing
     */
    key?: string
  }

  /**
   * Replica configuration
   */
  replica?: {
    /**
     * Read preference
     */
    readPreference?: 'primary' | 'secondary' | 'nearest'

    /**
     * Write-through to all replicas
     */
    writeThrough?: boolean

    /**
     * Jurisdiction constraint
     */
    jurisdiction?: 'eu' | 'us' | 'fedramp'
  }
}

// ============================================================================
// CONVEX CLIENT INTERFACE
// ============================================================================

/**
 * Convex client interface
 */
export interface ConvexClient {
  /**
   * Execute a one-shot query
   */
  query<F extends FunctionReference<'query'>>(
    query: F,
    args: FunctionArgs<F>
  ): Promise<FunctionReturnType<F>>

  /**
   * Subscribe to reactive query updates
   */
  onUpdate<F extends FunctionReference<'query'>>(
    query: F,
    args: FunctionArgs<F>,
    callback: SubscriptionCallback<FunctionReturnType<F>>,
    errorCallback?: ErrorCallback
  ): Unsubscribe

  /**
   * Execute a mutation
   */
  mutation<F extends FunctionReference<'mutation'>>(
    mutation: F,
    args: FunctionArgs<F>,
    options?: MutationOptions<F>
  ): Promise<FunctionReturnType<F>>

  /**
   * Execute an action
   */
  action<F extends FunctionReference<'action'>>(
    action: F,
    args: FunctionArgs<F>
  ): Promise<FunctionReturnType<F>>

  /**
   * Set authentication token fetcher
   */
  setAuth(
    fetchToken: AuthTokenFetcher | null,
    options?: AuthOptions
  ): void

  /**
   * Wait for all pending mutations to complete
   */
  sync(): Promise<void>

  /**
   * Close the client and clean up resources
   */
  close(): Promise<void>
}
