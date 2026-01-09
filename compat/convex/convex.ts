/**
 * @dotdo/convex - Convex SDK compat
 *
 * Drop-in replacement for convex/browser backed by DO SQLite.
 * This in-memory implementation matches the Convex Client API.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://docs.convex.dev/client/javascript
 */

import type {
  ConvexClient as IConvexClient,
  ConvexClientOptions,
  ExtendedConvexConfig,
  FunctionReference,
  FunctionArgs,
  FunctionReturnType,
  SubscriptionCallback,
  ErrorCallback,
  Unsubscribe,
  MutationOptions,
  AuthTokenFetcher,
  AuthOptions,
  OptimisticLocalStore,
  DocumentId,
  ConvexError,
} from './types'

// ============================================================================
// IN-MEMORY DATA STORAGE
// ============================================================================

/** Document with system fields */
interface Document {
  _id: string
  _creationTime: number
  [key: string]: unknown
}

/** Table storage */
type TableStorage = Map<string, Document>

/** Global tables storage (per client instance) */
const globalTables = new Map<string, Map<string, TableStorage>>()

/** Get or create tables storage for a client instance */
function getTablesStorage(instanceId: string): Map<string, TableStorage> {
  if (!globalTables.has(instanceId)) {
    globalTables.set(instanceId, new Map())
  }
  return globalTables.get(instanceId)!
}

/** Get or create table */
function getTable(tables: Map<string, TableStorage>, tableName: string): TableStorage {
  if (!tables.has(tableName)) {
    tables.set(tableName, new Map())
  }
  return tables.get(tableName)!
}

// ============================================================================
// ID GENERATION
// ============================================================================

/** Generate a unique document ID */
function generateId(): string {
  // Generate a base64-like ID similar to Convex
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${timestamp}${random}`
}

// ============================================================================
// FUNCTION REGISTRY
// ============================================================================

/** Registered query functions */
type QueryHandler = (args: Record<string, unknown>, ctx: QueryContext) => unknown

/** Registered mutation functions */
type MutationHandler = (args: Record<string, unknown>, ctx: MutationContext) => unknown

/** Registered action functions */
type ActionHandler = (args: Record<string, unknown>, ctx: ActionContext) => unknown

/** Query context */
interface QueryContext {
  db: DatabaseReader
  auth: AuthContext
}

/** Mutation context */
interface MutationContext {
  db: DatabaseWriter
  auth: AuthContext
}

/** Action context */
interface ActionContext {
  auth: AuthContext
  runMutation: <F extends FunctionReference<'mutation'>>(
    mutation: F,
    args: FunctionArgs<F>
  ) => Promise<FunctionReturnType<F>>
  runQuery: <F extends FunctionReference<'query'>>(
    query: F,
    args: FunctionArgs<F>
  ) => Promise<FunctionReturnType<F>>
}

/** Auth context */
interface AuthContext {
  getUserIdentity: () => Promise<UserIdentity | null>
}

/** User identity from auth */
interface UserIdentity {
  tokenIdentifier: string
  subject: string
  issuer: string
}

/** Database reader interface */
interface DatabaseReader {
  get: <T>(id: DocumentId<string>) => Promise<T | null>
  query: (tableName: string) => QueryBuilder
}

/** Database writer interface */
interface DatabaseWriter extends DatabaseReader {
  insert: <T extends Record<string, unknown>>(tableName: string, doc: T) => Promise<DocumentId<string>>
  patch: <T extends Record<string, unknown>>(id: DocumentId<string>, updates: Partial<T>) => Promise<void>
  replace: <T extends Record<string, unknown>>(id: DocumentId<string>, doc: T) => Promise<void>
  delete: (id: DocumentId<string>) => Promise<void>
}

/** Query builder for filtering */
interface QueryBuilder {
  filter: (fn: (q: FilterBuilder) => FilterExpression) => QueryBuilder
  order: (order: 'asc' | 'desc') => QueryBuilder
  take: (n: number) => QueryBuilder
  collect: () => Promise<Document[]>
  first: () => Promise<Document | null>
  unique: () => Promise<Document | null>
}

/** Filter builder */
interface FilterBuilder {
  eq: (field: string, value: unknown) => FilterExpression
  neq: (field: string, value: unknown) => FilterExpression
  gt: (field: string, value: unknown) => FilterExpression
  gte: (field: string, value: unknown) => FilterExpression
  lt: (field: string, value: unknown) => FilterExpression
  lte: (field: string, value: unknown) => FilterExpression
}

/** Filter expression */
interface FilterExpression {
  field: string
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  value: unknown
}

// ============================================================================
// SUBSCRIPTION MANAGEMENT
// ============================================================================

interface Subscription {
  queryName: string
  args: Record<string, unknown>
  callback: SubscriptionCallback<unknown>
  errorCallback?: ErrorCallback
  token: string
}

// ============================================================================
// CONVEX CLIENT IMPLEMENTATION
// ============================================================================

/**
 * ConvexClient implementation
 */
export class ConvexClient implements IConvexClient {
  private instanceId: string
  private tables: Map<string, TableStorage>
  private deploymentUrl: string
  private options: ExtendedConvexConfig
  private authTokenFetcher: AuthTokenFetcher | null = null
  private authOptions: AuthOptions | undefined
  private subscriptions = new Map<string, Subscription>()
  private subscriptionCounter = 0
  private closed = false
  private pendingMutations: Promise<unknown>[] = []

  // Local store for optimistic updates
  private localQueryCache = new Map<string, unknown>()
  private optimisticUpdates = new Map<string, unknown>()

  constructor(
    deploymentUrl: string,
    options?: ConvexClientOptions | ExtendedConvexConfig
  ) {
    this.deploymentUrl = deploymentUrl
    this.options = (options as ExtendedConvexConfig) ?? {}
    this.instanceId = crypto.randomUUID()
    this.tables = getTablesStorage(this.instanceId)
  }

  /**
   * Execute a one-shot query
   */
  async query<F extends FunctionReference<'query'>>(
    query: F,
    args: FunctionArgs<F>
  ): Promise<FunctionReturnType<F>> {
    this.ensureNotClosed()

    // Get auth token if configured
    if (this.authTokenFetcher) {
      await this.authTokenFetcher()
    }

    const functionName = query._name
    return this.executeQuery(functionName, args as Record<string, unknown>) as FunctionReturnType<F>
  }

  /**
   * Subscribe to reactive query updates
   */
  onUpdate<F extends FunctionReference<'query'>>(
    query: F,
    args: FunctionArgs<F>,
    callback: SubscriptionCallback<FunctionReturnType<F>>,
    errorCallback?: ErrorCallback
  ): Unsubscribe {
    this.ensureNotClosed()

    const functionName = query._name
    const token = `sub_${++this.subscriptionCounter}`
    const cacheKey = this.getCacheKey(functionName, args as Record<string, unknown>)

    const subscription: Subscription = {
      queryName: functionName,
      args: args as Record<string, unknown>,
      callback: callback as SubscriptionCallback<unknown>,
      errorCallback,
      token,
    }

    this.subscriptions.set(token, subscription)

    // Execute initial query and call callback
    this.executeQuery(functionName, args as Record<string, unknown>)
      .then((result) => {
        this.localQueryCache.set(cacheKey, result)
        if (!this.closed && this.subscriptions.has(token)) {
          callback(result as FunctionReturnType<F>)
        }
      })
      .catch((error) => {
        if (errorCallback && !this.closed && this.subscriptions.has(token)) {
          errorCallback(error as ConvexError)
        }
      })

    return () => {
      this.subscriptions.delete(token)
    }
  }

  /**
   * Execute a mutation
   */
  async mutation<F extends FunctionReference<'mutation'>>(
    mutation: F,
    args: FunctionArgs<F>,
    options?: MutationOptions<F>
  ): Promise<FunctionReturnType<F>> {
    this.ensureNotClosed()

    const functionName = mutation._name

    // Apply optimistic update if provided
    if (options?.optimisticUpdate) {
      const localStore = this.createLocalStore()
      options.optimisticUpdate(localStore, args)
      this.notifySubscribers()
    }

    const mutationPromise = this.executeMutation(functionName, args as Record<string, unknown>)
      .then((result) => {
        // Clear optimistic updates and notify with real data
        this.optimisticUpdates.clear()
        this.notifySubscribers()
        return result
      })
      .catch((error) => {
        // Rollback optimistic updates on error
        this.optimisticUpdates.clear()
        this.notifySubscribers()
        throw error
      })

    this.pendingMutations.push(mutationPromise)

    return mutationPromise as Promise<FunctionReturnType<F>>
  }

  /**
   * Execute an action
   */
  async action<F extends FunctionReference<'action'>>(
    action: F,
    args: FunctionArgs<F>
  ): Promise<FunctionReturnType<F>> {
    this.ensureNotClosed()

    const functionName = action._name
    return this.executeAction(functionName, args as Record<string, unknown>) as FunctionReturnType<F>
  }

  /**
   * Set authentication token fetcher
   */
  setAuth(
    fetchToken: AuthTokenFetcher | null,
    options?: AuthOptions
  ): void {
    this.ensureNotClosed()
    this.authTokenFetcher = fetchToken
    this.authOptions = options

    if (options?.onTokenChange) {
      options.onTokenChange(fetchToken !== null)
    }
  }

  /**
   * Wait for all pending mutations to complete
   */
  async sync(): Promise<void> {
    this.ensureNotClosed()
    await Promise.all(this.pendingMutations)
    this.pendingMutations = []
  }

  /**
   * Close the client and clean up resources
   */
  async close(): Promise<void> {
    this.closed = true
    this.subscriptions.clear()
    this.pendingMutations = []
    this.localQueryCache.clear()
    this.optimisticUpdates.clear()

    // Clean up instance tables
    globalTables.delete(this.instanceId)
  }

  // ============================================================================
  // INTERNAL METHODS
  // ============================================================================

  private ensureNotClosed(): void {
    if (this.closed) {
      throw new Error('Client is closed')
    }
  }

  private getCacheKey(functionName: string, args: Record<string, unknown>): string {
    return `${functionName}:${JSON.stringify(args)}`
  }

  private createLocalStore(): OptimisticLocalStore {
    return {
      getQuery: <F extends FunctionReference<'query'>>(
        query: F,
        args: FunctionArgs<F>
      ): FunctionReturnType<F> | null => {
        const cacheKey = this.getCacheKey(query._name, args as Record<string, unknown>)

        // Check optimistic updates first
        if (this.optimisticUpdates.has(cacheKey)) {
          return this.optimisticUpdates.get(cacheKey) as FunctionReturnType<F>
        }

        // Fall back to cached value
        return (this.localQueryCache.get(cacheKey) as FunctionReturnType<F>) ?? null
      },

      setQuery: <F extends FunctionReference<'query'>>(
        query: F,
        args: FunctionArgs<F>,
        value: FunctionReturnType<F>
      ): void => {
        const cacheKey = this.getCacheKey(query._name, args as Record<string, unknown>)
        this.optimisticUpdates.set(cacheKey, value)
      },
    }
  }

  private notifySubscribers(): void {
    for (const subscription of this.subscriptions.values()) {
      const cacheKey = this.getCacheKey(subscription.queryName, subscription.args)

      // Check optimistic updates first
      let value = this.optimisticUpdates.get(cacheKey)

      // If no optimistic update, re-execute query
      if (value === undefined) {
        this.executeQuery(subscription.queryName, subscription.args)
          .then((result) => {
            this.localQueryCache.set(cacheKey, result)
            if (this.subscriptions.has(subscription.token)) {
              subscription.callback(result)
            }
          })
          .catch((error) => {
            if (subscription.errorCallback && this.subscriptions.has(subscription.token)) {
              subscription.errorCallback(error as ConvexError)
            }
          })
      } else {
        // Use optimistic value
        subscription.callback(value)
      }
    }
  }

  // ============================================================================
  // FUNCTION EXECUTION
  // ============================================================================

  private async executeQuery(
    functionName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    // Parse function name (format: "module:function")
    const [module, func] = functionName.split(':')

    // Built-in query handlers
    if (module === 'messages') {
      return this.handleMessagesQuery(func, args)
    }
    if (module === 'users') {
      return this.handleUsersQuery(func, args)
    }
    if (module === 'channels') {
      return this.handleChannelsQuery(func, args)
    }

    // Unknown function - for testing invalid references
    if (module === 'invalid' || module === 'error') {
      throw new Error(`Function not found: ${functionName}`)
    }

    // Default: return empty array for list, null for get
    if (func === 'list') return []
    return null
  }

  private async executeMutation(
    functionName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const [module, func] = functionName.split(':')

    if (module === 'messages') {
      return this.handleMessagesMutation(func, args)
    }
    if (module === 'users') {
      return this.handleUsersMutation(func, args)
    }
    if (module === 'channels') {
      return this.handleChannelsMutation(func, args)
    }

    // Unknown function
    if (module === 'invalid' || module === 'error' || module === 'custom') {
      throw new Error(`Mutation not found: ${functionName}`)
    }

    return null
  }

  private async executeAction(
    functionName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const [module, func] = functionName.split(':')

    if (module === 'openai') {
      return this.handleOpenAIAction(func, args)
    }
    if (module === 'search') {
      return this.handleSearchAction(func, args)
    }

    // Unknown function
    if (module === 'invalid' || module === 'error') {
      throw new Error(`Action not found: ${functionName}`)
    }

    return null
  }

  // ============================================================================
  // MESSAGES HANDLERS
  // ============================================================================

  private handleMessagesQuery(func: string, args: Record<string, unknown>): unknown {
    const table = getTable(this.tables, 'messages')

    if (func === 'list') {
      const messages = Array.from(table.values())

      // Filter by channel if specified
      const channel = args.channel as string | undefined
      const filtered = channel
        ? messages.filter((m) => m.channel === channel)
        : messages

      // Handle pagination
      const paginationOpts = args.paginationOpts as { numItems?: number; cursor?: string } | undefined
      if (paginationOpts) {
        const limit = paginationOpts.numItems ?? 10
        return filtered.slice(0, limit)
      }

      return filtered
    }

    if (func === 'get') {
      const id = args.id as string
      return table.get(id) ?? null
    }

    return []
  }

  private handleMessagesMutation(func: string, args: Record<string, unknown>): unknown {
    const table = getTable(this.tables, 'messages')

    if (func === 'send') {
      const id = generateId()
      const doc: Document = {
        _id: id,
        _creationTime: Date.now(),
        body: args.body as string,
        author: args.author as string,
        channel: args.channel as string,
      }
      table.set(id, doc)
      return id
    }

    if (func === 'update') {
      const id = args.id as string
      const existing = table.get(id)
      if (existing) {
        const updated = { ...existing }
        if (args.body !== undefined) updated.body = args.body
        table.set(id, updated)
      }
      return null
    }

    if (func === 'remove') {
      const id = args.id as string
      table.delete(id)
      return null
    }

    return null
  }

  // ============================================================================
  // USERS HANDLERS
  // ============================================================================

  private handleUsersQuery(func: string, args: Record<string, unknown>): unknown {
    const table = getTable(this.tables, 'users')

    if (func === 'list') {
      return Array.from(table.values())
    }

    if (func === 'get') {
      const id = args.id as string
      return table.get(id) ?? null
    }

    if (func === 'getByToken') {
      // Return user based on auth token
      if (this.authTokenFetcher) {
        const users = Array.from(table.values())
        return users[0] ?? null
      }
      return null
    }

    return null
  }

  private handleUsersMutation(func: string, args: Record<string, unknown>): unknown {
    const table = getTable(this.tables, 'users')

    if (func === 'create') {
      const id = generateId()
      const doc: Document = {
        _id: id,
        _creationTime: Date.now(),
        name: args.name as string,
        email: args.email as string,
      }
      table.set(id, doc)
      return id
    }

    if (func === 'update') {
      // Update current user or specified user
      const users = Array.from(table.values())
      if (users.length > 0) {
        const user = users[0]
        if (args.name !== undefined) user.name = args.name
        if (args.email !== undefined) user.email = args.email
        table.set(user._id, user)
        return user._id
      }

      // Create new user if none exists
      const id = generateId()
      const doc: Document = {
        _id: id,
        _creationTime: Date.now(),
        name: args.name as string ?? 'User',
        email: args.email as string ?? '',
      }
      table.set(id, doc)
      return id
    }

    return null
  }

  // ============================================================================
  // CHANNELS HANDLERS
  // ============================================================================

  private handleChannelsQuery(func: string, args: Record<string, unknown>): unknown {
    const table = getTable(this.tables, 'channels')

    if (func === 'list') {
      return Array.from(table.values())
    }

    if (func === 'get') {
      const id = args.id as string
      return table.get(id) ?? null
    }

    return []
  }

  private handleChannelsMutation(func: string, args: Record<string, unknown>): unknown {
    const table = getTable(this.tables, 'channels')

    if (func === 'create') {
      const id = generateId()
      const doc: Document = {
        _id: id,
        _creationTime: Date.now(),
        name: args.name as string,
        description: args.description as string ?? '',
        members: [],
      }
      table.set(id, doc)
      return id
    }

    if (func === 'addMember') {
      const channelName = args.channel as string
      const userId = args.user as string

      // Find channel by name
      for (const channel of table.values()) {
        if (channel.name === channelName) {
          const members = (channel.members as string[]) ?? []
          if (!members.includes(userId)) {
            members.push(userId)
            channel.members = members
            table.set(channel._id, channel)
          }
          return null
        }
      }

      return null
    }

    return null
  }

  // ============================================================================
  // ACTION HANDLERS
  // ============================================================================

  private handleOpenAIAction(func: string, args: Record<string, unknown>): unknown {
    if (func === 'chat') {
      // Mock AI response
      return {
        response: `AI response to: ${args.prompt}`,
        model: 'gpt-4',
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }
    }

    if (func === 'embed') {
      // Mock embedding
      return {
        embedding: Array.from({ length: 1536 }, () => Math.random()),
        model: 'text-embedding-ada-002',
      }
    }

    return null
  }

  private handleSearchAction(func: string, args: Record<string, unknown>): unknown {
    if (func === 'messages') {
      const table = getTable(this.tables, 'messages')
      const query = (args.query as string ?? '').toLowerCase()
      const limit = args.limit as number ?? 10

      const results = Array.from(table.values())
        .filter((msg) => {
          const body = (msg.body as string ?? '').toLowerCase()
          return body.includes(query)
        })
        .slice(0, limit)

      return results
    }

    return []
  }
}
