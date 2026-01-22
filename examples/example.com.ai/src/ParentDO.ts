/**
 * Parent DO - Hierarchical Durable Object Architecture
 *
 * The Parent DO aggregates events from child DOs and provides:
 * - CDC (Change Data Capture) from children
 * - Event buffering and R2 streaming
 * - Global query across all children
 * - Shared context for children
 * - Child discovery and health tracking
 *
 * @module examples/example.com.ai/src/ParentDO
 */

import { DurableObject } from 'cloudflare:workers'
import type {
  ParentDOEvent,
  R2BufferConfig,
  GlobalQueryOptions,
  ChildDOInfo,
  ParentContext,
  R2FlushResult,
  R2BufferStats,
} from './types'

import { R2BufferManager, createR2Proxy } from './r2-buffer'
import { ChildrenManager, createChildrenProxy } from './children-manager'
import { QueryManager, createQueryProxy } from './query-manager'

/**
 * Event handler function type
 */
export type EventHandler = (event: ParentDOEvent) => Promise<void> | void

/**
 * Noun-level event proxy for $.on.Child, $.on.Customer, etc.
 */
export interface NounEventProxy {
  registered: (handler: EventHandler) => void
  heartbeat: (handler: EventHandler) => void
  disconnected: (handler: EventHandler) => void
  [verb: string]: (handler: EventHandler) => void
}

/**
 * Wildcard event proxy for *.verb patterns
 */
export interface WildcardEventProxy {
  '*': (handler: EventHandler) => void
  [verb: string]: (handler: EventHandler) => void
}

/**
 * Top-level OnProxy for event handler registration
 *
 * Supports patterns like:
 * - $.on.Customer.created(handler) - specific noun.verb
 * - $.on.Customer['*'](handler) - all events for noun
 * - $.on['*'].created(handler) - all nouns with verb
 * - $.on['*']['*'](handler) - all events
 */
export type OnProxy = {
  [noun: string]: NounEventProxy | WildcardEventProxy
}

/**
 * R2 buffer proxy interface
 */
export interface R2Proxy {
  buffer: (event: ParentDOEvent) => Promise<void>
  flush: () => Promise<R2FlushResult>
  getBufferStats: () => R2BufferStats
  configure: (config: R2BufferConfig) => void
}

/**
 * Query proxy interface
 */
export interface QueryProxy {
  global: <T = unknown>(options: GlobalQueryOptions) => Promise<T[]>
  child: <T = unknown>(childId: string, options: GlobalQueryOptions) => Promise<T[]>
}

/**
 * Children proxy interface
 */
export interface ChildrenProxy {
  list: () => Promise<ChildDOInfo[]>
  get: (childId: string) => Promise<ChildDOInfo | null>
  discover: () => Promise<ChildDOInfo[]>
  count: () => Promise<number>
}

/**
 * The complete $ context for Parent DO
 */
export interface ParentWorkflowContext {
  on: OnProxy
  r2: R2Proxy
  query: QueryProxy
  children: ChildrenProxy
  context: ParentContext
}

/**
 * Create the $.on proxy for event handler registration
 */
function createOnProxy(handlers: Map<string, EventHandler[]>): OnProxy {
  // Create a two-level proxy for $.on.Noun.verb(handler) pattern
  return new Proxy({} as OnProxy, {
    get(_, noun: string) {
      // Return a proxy for the verb level
      return new Proxy({} as NounEventProxy, {
        get(_, verb: string) {
          // Return a function that registers the handler
          return (handler: EventHandler) => {
            const key = `${noun}.${verb}`
            const existing = handlers.get(key) || []
            handlers.set(key, [...existing, handler])
          }
        }
      })
    }
  })
}

/**
 * Environment bindings for the Parent DO worker
 */
export interface Env {
  R2_BUCKET?: R2Bucket
  [key: string]: unknown
}

/**
 * Parent DO Class
 *
 * Aggregates events from child DOs and provides:
 * - CDC event reception from children
 * - R2 streaming with buffering
 * - Global query across children
 * - Shared parent context
 * - Child discovery and tracking
 */
export class ParentDO extends DurableObject<Env> {

  // Event handlers registry
  private handlers: Map<string, EventHandler[]> = new Map()

  // Component managers
  private r2Manager: R2BufferManager
  private childrenManager: ChildrenManager
  private queryManager: QueryManager

  // Parent context shared with children
  private _context: ParentContext = {
    config: {},
    secrets: {},
    metadata: {},
  }

  // The $ workflow context
  public $: ParentWorkflowContext

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize managers
    this.r2Manager = new R2BufferManager(env.R2_BUCKET)
    this.childrenManager = new ChildrenManager()
    this.queryManager = new QueryManager(this.childrenManager)

    // Create the $ workflow context
    this.$ = {
      on: createOnProxy(this.handlers),
      r2: createR2Proxy(this.r2Manager),
      query: createQueryProxy(this.queryManager),
      children: createChildrenProxy(this.childrenManager),
      context: this._context,
    }
  }

  /**
   * Handle HTTP requests to the Parent DO
   *
   * Routes:
   * - POST /events - Receive events from child DOs
   * - GET /children - List registered children
   * - GET /context - Get parent context
   * - POST /context - Update parent context
   * - POST /flush - Flush R2 buffer
   * - GET /stats - Get buffer statistics
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method

    try {
      // Health check
      if (url.pathname === '/' && method === 'GET') {
        return Response.json({
          status: 'ok',
          service: 'example.com.ai',
          type: 'parent-do',
        })
      }

      // Receive events from child DOs
      if (url.pathname === '/events' && method === 'POST') {
        const event = await request.json() as ParentDOEvent
        await this.receiveChildEvent(event)
        return Response.json({ success: true })
      }

      // List children
      if (url.pathname === '/children' && method === 'GET') {
        const children = await this.$.children.list()
        return Response.json({ children })
      }

      // Get context
      if (url.pathname === '/context' && method === 'GET') {
        return Response.json({ context: this.$.context })
      }

      // Update context
      if (url.pathname === '/context' && method === 'POST') {
        const update = await request.json() as Partial<ParentContext>
        this.setContext(update)
        return Response.json({ success: true, context: this.$.context })
      }

      // Flush R2 buffer
      if (url.pathname === '/flush' && method === 'POST') {
        const result = await this.flushToR2()
        return Response.json({ success: true, result })
      }

      // Get buffer stats
      if (url.pathname === '/stats' && method === 'GET') {
        const stats = this.$.r2.getBufferStats()
        const childCount = await this.$.children.count()
        return Response.json({
          buffer: stats,
          children: childCount,
        })
      }

      // Register child
      if (url.pathname === '/children/register' && method === 'POST') {
        const { id, ...info } = await request.json() as ChildDOInfo
        const child = this.registerChild(id, info)
        return Response.json({ success: true, child })
      }

      return Response.json({ error: 'Not Found' }, { status: 404 })
    } catch (error) {
      console.error('ParentDO fetch error:', error)
      return Response.json(
        { error: error instanceof Error ? error.message : 'Internal Error' },
        { status: 500 }
      )
    }
  }

  /**
   * Receive an event from a child DO
   */
  async receiveChildEvent(event: ParentDOEvent): Promise<void> {
    // Update child's last seen and event count
    if (event.childId) {
      this.childrenManager.heartbeat(event.childId)
      this.childrenManager.incrementEventCount(event.childId)
    }

    // Invoke all matching handlers
    await this.invokeHandlers(event)

    // Buffer for R2
    await this.r2Manager.buffer(event)
  }

  /**
   * Invoke all handlers that match an event
   */
  private async invokeHandlers(event: ParentDOEvent): Promise<void> {
    const [noun, verb] = event.type.split('.')
    const matched: EventHandler[] = []

    // 1. Exact match
    const exact = this.handlers.get(event.type)
    if (exact) matched.push(...exact)

    // 2. Noun wildcard (Customer.*)
    if (noun && verb) {
      const nounWild = this.handlers.get(`${noun}.*`)
      if (nounWild) matched.push(...nounWild)
    }

    // 3. Verb wildcard (*.created)
    if (noun && verb) {
      const verbWild = this.handlers.get(`*.${verb}`)
      if (verbWild) matched.push(...verbWild)
    }

    // 4. Global wildcard (*.*)
    const globalWild = this.handlers.get('*.*')
    if (globalWild) matched.push(...globalWild)

    // Execute all matched handlers
    for (const handler of matched) {
      try {
        await handler(event)
      } catch (error) {
        console.error(`Handler failed for event ${event.type}:`, error)
      }
    }
  }

  /**
   * Register a child DO
   */
  registerChild(childId: string, info: Omit<ChildDOInfo, 'id'>): ChildDOInfo {
    return this.childrenManager.register(childId, info)
  }

  /**
   * Update parent context
   */
  setContext(context: Partial<ParentContext>): void {
    if (context.config) {
      this._context.config = { ...this._context.config, ...context.config }
    }
    if (context.secrets) {
      this._context.secrets = { ...this._context.secrets, ...context.secrets }
    }
    if (context.metadata) {
      this._context.metadata = { ...this._context.metadata, ...context.metadata }
    }
    // Update the $ reference
    this.$.context = this._context
  }

  /**
   * Store data for querying (CDC events can store their payload)
   */
  storeData(childId: string, type: string, item: unknown): void {
    this.queryManager.storeData(childId, type, item)
  }

  /**
   * Flush R2 buffer to storage
   */
  async flushToR2(): Promise<R2FlushResult> {
    return this.r2Manager.flush()
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.r2Manager.destroy()
  }
}

// Re-export types for convenience
export type {
  ParentDOEvent,
  R2BufferConfig,
  GlobalQueryOptions,
  ChildDOInfo,
  ParentContext,
  R2FlushResult,
  R2BufferStats,
}
