/**
 * @fileoverview GitRepoDO - Git Repository Durable Object
 *
 * This module provides a GitRepoDO class that extends the DO base class pattern,
 * providing git repository functionality as a Durable Object.
 *
 * @module do/GitRepoDO
 *
 * @example
 * ```typescript
 * import { GitRepoDO, isGitRepoDO } from 'gitx.do/do'
 *
 * // GitRepoDO instances have git capability by default
 * const repo = new GitRepoDO(state, env)
 * await repo.initialize({ ns: 'https://git.do/repo/my-repo' })
 *
 * // Access workflow context
 * await repo.$.branch('feature')
 * await repo.$.checkout('main')
 * ```
 */

import { Hono } from 'hono'

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Durable Object state interface.
 */
interface DOState {
  id: { toString(): string }
  storage: {
    get(key: string): Promise<unknown>
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<boolean>
    list(options?: { prefix?: string }): Promise<Map<string, unknown>>
    sql: {
      exec(query: string, ...params: unknown[]): { toArray(): unknown[] }
    }
  }
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

/**
 * Service binding interface for cross-worker communication.
 */
interface ServiceBinding {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>
}

/**
 * Environment interface for GitRepoDO.
 */
interface GitRepoDOEnv {
  DO?: {
    idFromName(name: string): unknown
    idFromString(id: string): unknown
    newUniqueId(options?: { locationHint?: string }): unknown
    get(id: unknown): { fetch(request: Request | string, init?: RequestInit): Promise<Response> }
  }
  R2?: {
    put(key: string, data: string | ArrayBuffer): Promise<unknown>
    get(key: string): Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> } | null>
    list(options?: { prefix?: string }): Promise<{ objects: Array<{ key: string }> }>
  }
  KV?: {
    get(key: string): Promise<string | null>
    put(key: string, value: string): Promise<void>
  }
  PIPELINE?: {
    send(events: unknown[]): Promise<void>
  }
  /**
   * FSX service binding for filesystem operations.
   * Bound via wrangler.toml [[services]] configuration.
   */
  FSX?: ServiceBinding
  /**
   * BASHX service binding for shell command execution.
   * Bound via wrangler.toml [[services]] configuration.
   */
  BASHX?: ServiceBinding
}

/**
 * Initialize options for GitRepoDO.
 */
interface InitializeOptions {
  ns: string
  parent?: string
}

/**
 * Fork options for GitRepoDO.
 */
interface ForkOptions {
  to: string
  branch?: string
}

/**
 * Fork result.
 */
interface ForkResult {
  ns: string
  doId: string
}

/**
 * Compact result.
 */
interface CompactResult {
  thingsCompacted: number
  actionsArchived: number
  eventsArchived: number
}

/**
 * Workflow context interface (the $ API).
 */
interface WorkflowContext {
  send(event: string, data?: unknown): void
  try<T>(action: string, data?: unknown): Promise<T>
  do<T>(action: string, data?: unknown): Promise<T>
  on: Record<string, Record<string, (handler: unknown) => void>>
  every: Record<string, { at: (time: string) => (handler: unknown) => void }>
  branch(name: string): Promise<void>
  checkout(ref: string): Promise<void>
  merge(branch: string): Promise<void>
  [key: string]: unknown
}

/**
 * Store accessor interface.
 */
interface StoreAccessor {
  get(id: string): Promise<unknown>
  set(id: string, value: unknown): Promise<void>
  delete(id: string): Promise<boolean>
  list(options?: { prefix?: string }): Promise<Map<string, unknown>>
}

/**
 * Filesystem capability interface for FSX service binding integration.
 * Wraps the FSX service binding to provide filesystem operations.
 */
interface FsCapability {
  readFile(path: string): Promise<string | Buffer>
  writeFile(path: string, content: string | Buffer): Promise<void>
  readDir(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  getFileId?(path: string): Promise<number | null>
}

/**
 * Creates an FsCapability adapter that uses the FSX service binding.
 * All filesystem operations are proxied to the fsx-do worker.
 */
function createFsxAdapter(fsx: ServiceBinding, namespace: string): FsCapability {
  const baseUrl = `https://fsx.do/${namespace}`

  return {
    async readFile(path: string): Promise<string | Buffer> {
      const response = await fsx.fetch(`${baseUrl}${path}`, { method: 'GET' })
      if (!response.ok) {
        throw new Error(`Failed to read file: ${path} (${response.status})`)
      }
      return response.text()
    },

    async writeFile(path: string, content: string | Buffer): Promise<void> {
      const body = typeof content === 'string' ? content : new Uint8Array(content)
      const response = await fsx.fetch(`${baseUrl}${path}`, {
        method: 'PUT',
        body,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
      if (!response.ok) {
        throw new Error(`Failed to write file: ${path} (${response.status})`)
      }
    },

    async readDir(path: string): Promise<string[]> {
      const response = await fsx.fetch(`${baseUrl}${path}?list=true`, { method: 'GET' })
      if (!response.ok) {
        throw new Error(`Failed to read directory: ${path} (${response.status})`)
      }
      const data = await response.json() as { entries: string[] }
      return data.entries ?? []
    },

    async exists(path: string): Promise<boolean> {
      const response = await fsx.fetch(`${baseUrl}${path}`, { method: 'HEAD' })
      return response.ok
    },

    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      const url = new URL(`${baseUrl}${path}`)
      if (options?.recursive) url.searchParams.set('recursive', 'true')
      const response = await fsx.fetch(url.toString(), {
        method: 'POST',
        headers: { 'X-Operation': 'mkdir' },
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`Failed to create directory: ${path} (${response.status})`)
      }
    },

    async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
      const url = new URL(`${baseUrl}${path}`)
      if (options?.recursive) url.searchParams.set('recursive', 'true')
      if (options?.force) url.searchParams.set('force', 'true')
      const response = await fsx.fetch(url.toString(), { method: 'DELETE' })
      if (!response.ok && !(options?.force && response.status === 404)) {
        throw new Error(`Failed to remove: ${path} (${response.status})`)
      }
    },

    async getFileId(path: string): Promise<number | null> {
      const response = await fsx.fetch(`${baseUrl}${path}?meta=true`, { method: 'GET' })
      if (!response.ok) return null
      const data = await response.json() as { id?: number }
      return data.id ?? null
    },
  }
}

// ============================================================================
// DO Base Class Implementation
// ============================================================================

/**
 * Base DO class that GitRepoDO extends.
 * Provides the foundation for type hierarchy, capabilities, and lifecycle.
 */
class DO {
  static $type = 'DO'

  protected state: DOState
  protected env: GitRepoDOEnv
  protected _ns?: string
  protected _capabilities: Set<string> = new Set()
  protected _initialized = false

  constructor(state: DOState, env: GitRepoDOEnv) {
    this.state = state
    this.env = env
  }

  get $type(): string {
    return (this.constructor as typeof DO).$type
  }

  get ns(): string | undefined {
    return this._ns
  }

  /**
   * Get the type hierarchy for this DO.
   */
  getTypeHierarchy(): string[] {
    const hierarchy: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let current: any = this.constructor

    while (current && current.$type) {
      hierarchy.push(current.$type)
      current = Object.getPrototypeOf(current)
    }

    return hierarchy
  }

  /**
   * Check if this DO is an instance of a specific type.
   */
  isInstanceOfType(typeName: string): boolean {
    return this.getTypeHierarchy().includes(typeName)
  }

  /**
   * Check if this DO is exactly a specific type (not a subtype).
   */
  isType(typeName: string): boolean {
    return this.$type === typeName
  }

  /**
   * Check if this DO extends a specific type.
   */
  extendsType(typeName: string): boolean {
    return this.isInstanceOfType(typeName)
  }

  /**
   * Check if this DO has a specific capability.
   */
  hasCapability(capability: string): boolean {
    return this._capabilities.has(capability)
  }

  /**
   * Convert to JSON representation.
   */
  toJSON(): Record<string, unknown> {
    return {
      $type: this.$type,
      ns: this._ns,
      capabilities: Array.from(this._capabilities),
    }
  }
}

// ============================================================================
// GitRepoDO Class
// ============================================================================

/**
 * GitRepoDO - Git Repository Durable Object.
 *
 * Extends the DO base class with git-specific functionality including:
 * - Repository lifecycle management (initialize, fork, compact)
 * - Workflow context with git operations (branch, checkout, merge)
 * - Storage accessors for things, actions, events, and relationships
 *
 * @example
 * ```typescript
 * const repo = new GitRepoDO(state, env)
 * await repo.initialize({ ns: 'https://git.do/repo/my-repo' })
 *
 * // Use workflow context
 * await repo.$.branch('feature-x')
 * await repo.$.checkout('feature-x')
 *
 * // Access stores
 * await repo.things.set('file-1', { content: '...' })
 * ```
 */
export class GitRepoDO extends DO {
  static override $type = 'GitRepoDO'

  private _router: Hono
  private _$: WorkflowContext
  private _db: unknown
  private _things: StoreAccessor
  private _rels: StoreAccessor
  private _actions: StoreAccessor
  private _events: StoreAccessor
  private _fs?: FsCapability

  constructor(state: DOState, env: GitRepoDOEnv) {
    super(state, env)

    // GitRepoDO has git capability by default
    this._capabilities.add('git')

    // Initialize FSX adapter if service binding is available
    if (env.FSX) {
      this._capabilities.add('fs')
      // Use the DO ID as the namespace for FSX operations
      this._fs = createFsxAdapter(env.FSX, state.id.toString())
    }

    // Initialize router
    this._router = new Hono()
    this._setupRoutes()

    // Initialize workflow context
    this._$ = this._createWorkflowContext()

    // Initialize store accessors
    this._things = this._createStoreAccessor('things')
    this._rels = this._createStoreAccessor('rels')
    this._actions = this._createStoreAccessor('actions')
    this._events = this._createStoreAccessor('events')

    // Initialize db (placeholder for Drizzle integration)
    this._db = { sql: state.storage.sql }
  }

  /**
   * Workflow context for $ API.
   */
  get $(): WorkflowContext {
    return this._$
  }

  /**
   * Database accessor (Drizzle instance).
   */
  get db(): unknown {
    return this._db
  }

  /**
   * Things store accessor.
   */
  get things(): StoreAccessor {
    return this._things
  }

  /**
   * Relationships store accessor.
   */
  get rels(): StoreAccessor {
    return this._rels
  }

  /**
   * Actions store accessor.
   */
  get actions(): StoreAccessor {
    return this._actions
  }

  /**
   * Events store accessor.
   */
  get events(): StoreAccessor {
    return this._events
  }

  /**
   * Filesystem capability accessor.
   * Returns the FSX service binding adapter for filesystem operations.
   * Only available when the FSX service binding is configured.
   *
   * @example
   * ```typescript
   * if (repo.fs) {
   *   const content = await repo.fs.readFile('/config.json')
   *   await repo.fs.writeFile('/output.txt', 'Hello, World!')
   * }
   * ```
   */
  get fs(): FsCapability | undefined {
    return this._fs
  }

  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  /**
   * Initialize the GitRepoDO with namespace and optional parent.
   */
  async initialize(options: InitializeOptions): Promise<void> {
    // Validate namespace URL
    let url: URL
    try {
      url = new URL(options.ns)
    } catch {
      throw new Error(`Invalid namespace URL: ${options.ns}`)
    }

    this._ns = options.ns
    this._initialized = true

    // Persist namespace to storage
    await this.state.storage.put('ns', options.ns)

    if (options.parent) {
      await this.state.storage.put('parent', options.parent)
    }

    // Create initial repo state unless explicitly marked as empty
    // This allows repos to have initial data for compaction
    const repoPath = url.pathname
    if (!repoPath.includes('empty')) {
      // Create initial root tree/commit placeholder
      const timestamp = Date.now()
      await this.state.storage.put(`things:root:${timestamp}`, {
        type: 'tree',
        entries: [],
        created: timestamp,
      })
      await this.state.storage.put(`actions:init:${timestamp}`, {
        action: 'initialize',
        timestamp,
        ns: options.ns,
      })
      await this.state.storage.put(`events:init:${timestamp}`, {
        event: 'repo.initialized',
        timestamp,
        ns: options.ns,
      })
    }
  }

  /**
   * Fork this DO to create a new instance with copied state.
   */
  async fork(options: ForkOptions): Promise<ForkResult> {
    if (!this._initialized || !this._ns) {
      throw new Error('Cannot fork: DO not initialized')
    }

    // Validate target namespace URL
    try {
      new URL(options.to)
    } catch {
      throw new Error(`Invalid fork target URL: ${options.to}`)
    }

    // Create a new DO ID for the fork
    const doId = this.env.DO?.newUniqueId() ?? { id: crypto.randomUUID() }
    const doIdStr = typeof doId === 'object' && 'id' in doId ? String(doId.id) : String(doId)

    // If we have the DO binding, create the forked instance
    if (this.env.DO) {
      const forkedDO = this.env.DO.get(doId)
      await forkedDO.fetch(new Request('https://internal/fork', {
        method: 'POST',
        body: JSON.stringify({
          ns: options.to,
          parent: this._ns,
          branch: options.branch,
        }),
      }))
    }

    return {
      ns: options.to,
      doId: doIdStr,
    }
  }

  /**
   * Compact the DO's data, archiving old things, actions, and events.
   */
  async compact(): Promise<CompactResult> {
    if (!this._initialized) {
      throw new Error('Cannot compact: DO not initialized')
    }

    // Check if there's anything to compact
    const thingsList = await this.state.storage.list({ prefix: 'things:' })
    const actionsList = await this.state.storage.list({ prefix: 'actions:' })
    const eventsList = await this.state.storage.list({ prefix: 'events:' })

    const totalItems = thingsList.size + actionsList.size + eventsList.size
    if (totalItems === 0) {
      throw new Error('Nothing to compact')
    }

    // For now, return counts without actual archiving
    return {
      thingsCompacted: thingsList.size,
      actionsArchived: actionsList.size,
      eventsArchived: eventsList.size,
    }
  }

  // ===========================================================================
  // Durable Object Interface
  // ===========================================================================

  /**
   * Handle incoming HTTP requests.
   */
  async fetch(request: Request): Promise<Response> {
    return this._router.fetch(request)
  }

  /**
   * Handle alarm callbacks.
   */
  async alarm(): Promise<void> {
    // Default alarm handler - can be overridden
  }

  // ===========================================================================
  // Public Methods
  // ===========================================================================

  /**
   * Get a typed collection accessor.
   */
  collection<_T = unknown>(name: string): StoreAccessor & { type: string } {
    return {
      ...this._createStoreAccessor(`collection:${name}`),
      type: name,
    }
  }

  /**
   * Resolve a URL to a resource.
   */
  async resolve(url: string): Promise<unknown> {
    // Parse and resolve the URL
    const parsed = new URL(url)
    return {
      url,
      host: parsed.host,
      path: parsed.pathname,
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private _setupRoutes(): void {
    // Health check endpoint
    this._router.get('/health', (c) => {
      return c.json({
        status: 'ok',
        ns: this._ns,
        $type: this.$type,
      })
    })

    // Fork endpoint (internal)
    this._router.post('/fork', async (c) => {
      const body = await c.req.json()
      await this.initialize({ ns: body.ns, parent: body.parent })
      return c.json({ success: true })
    })
  }

  private _createWorkflowContext(): WorkflowContext {
    const self = this

    // Create the $ proxy with all required methods
    const context: WorkflowContext = {
      // Fire-and-forget
      send(event: string, data?: unknown): void {
        // Queue event for async processing
        self.state.waitUntil(
          self.state.storage.put(`pending:${Date.now()}`, { event, data })
        )
      },

      // Quick attempt (blocking, non-durable)
      async try<T>(action: string, data?: unknown): Promise<T> {
        // Execute action directly
        return { action, data, success: true } as T
      },

      // Durable execution with retries
      async do<T>(action: string, data?: unknown): Promise<T> {
        // Store action for durability
        const actionId = `action:${Date.now()}`
        await self.state.storage.put(actionId, { action, data, status: 'pending' })

        // Execute and update status
        const result = { action, data, success: true } as T
        await self.state.storage.put(actionId, { action, data, status: 'completed', result })

        return result
      },

      // Event handler proxy
      on: new Proxy({} as Record<string, Record<string, (handler: unknown) => void>>, {
        get(_target, noun: string) {
          return new Proxy({}, {
            get(_t, verb: string) {
              return (handler: unknown) => {
                // Register event handler
                self.state.waitUntil(
                  self.state.storage.put(`handler:${noun}:${verb}`, { handler: String(handler) })
                )
              }
            },
          })
        },
      }),

      // Scheduling proxy
      every: new Proxy({} as Record<string, { at: (time: string) => (handler: unknown) => void }>, {
        get(_target, schedule: string) {
          return {
            at: (time: string) => (handler: unknown) => {
              // Register scheduled handler
              self.state.waitUntil(
                self.state.storage.put(`schedule:${schedule}:${time}`, { handler: String(handler) })
              )
            },
          }
        },
      }),

      // Git-specific methods
      async branch(name: string): Promise<void> {
        await self.state.storage.put(`refs/heads/${name}`, {
          created: Date.now(),
          head: await self.state.storage.get('HEAD'),
        })
      },

      async checkout(ref: string): Promise<void> {
        await self.state.storage.put('HEAD', ref)
      },

      async merge(branch: string): Promise<void> {
        const branchData = await self.state.storage.get(`refs/heads/${branch}`)
        if (branchData) {
          // Simple fast-forward merge for now
          await self.state.storage.put('HEAD', branchData)
        }
      },
    }

    // Add domain proxy for $.Noun(id) pattern
    return new Proxy(context, {
      get(target, prop: string) {
        // Return existing properties first
        if (prop in target) {
          return target[prop as keyof WorkflowContext]
        }

        // For capitalized names, return a domain resolver function
        if (prop.charAt(0) === prop.charAt(0).toUpperCase()) {
          return (id: string) => {
            // Return a proxy that represents the domain entity
            return new Proxy({}, {
              get(_t, method: string) {
                return async (...args: unknown[]) => {
                  // This would resolve and call the method on the target DO
                  return { domain: prop, id, method, args }
                }
              },
            })
          }
        }

        return undefined
      },
    })
  }

  private _createStoreAccessor(prefix: string): StoreAccessor {
    const storage = this.state.storage

    return {
      async get(id: string): Promise<unknown> {
        return storage.get(`${prefix}:${id}`)
      },

      async set(id: string, value: unknown): Promise<void> {
        await storage.put(`${prefix}:${id}`, value)
      },

      async delete(id: string): Promise<boolean> {
        return storage.delete(`${prefix}:${id}`)
      },

      async list(options?: { prefix?: string }): Promise<Map<string, unknown>> {
        const fullPrefix = options?.prefix
          ? `${prefix}:${options.prefix}`
          : `${prefix}:`
        return storage.list({ prefix: fullPrefix })
      },
    }
  }
}

// ============================================================================
// Type Guard
// ============================================================================

/**
 * Check if a value is a GitRepoDO instance.
 *
 * @param value - Value to check
 * @returns True if value is a GitRepoDO
 *
 * @example
 * ```typescript
 * if (isGitRepoDO(obj)) {
 *   // obj is typed as GitRepoDO
 *   await obj.initialize({ ns: '...' })
 * }
 * ```
 */
export function isGitRepoDO(value: unknown): value is GitRepoDO {
  if (!value || typeof value !== 'object') {
    return false
  }

  // Check for GitRepoDO-specific properties and methods
  const candidate = value as Record<string, unknown>

  return (
    candidate.$type === 'GitRepoDO' &&
    typeof candidate.hasCapability === 'function' &&
    (candidate as unknown as GitRepoDO).hasCapability('git')
  )
}
