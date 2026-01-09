/**
 * DOTiny - Minimal Durable Object Base Class
 *
 * The smallest possible DO implementation (~15KB) with:
 * - Identity (ns, $type)
 * - Storage (Drizzle/SQLite)
 * - fetch() + /health
 * - initialize()
 * - toJSON()
 *
 * Use this when you need the smallest bundle size and don't need:
 * - WorkflowContext ($)
 * - Event handlers ($.on)
 * - Stores (things, rels, actions, events, search, objects, dlq)
 * - Scheduling ($.every, alarm)
 * - Lifecycle operations (fork, clone, compact, move)
 * - Sharding, branching, promotion
 *
 * @example
 * ```typescript
 * import { DO } from 'dotdo/tiny'
 *
 * class MyDO extends DO {
 *   async fetch(request: Request): Promise<Response> {
 *     // Custom routing
 *   }
 * }
 * ```
 */

import { DurableObject } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/durable-sqlite'
import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import { Hono } from 'hono'
import * as schema from '../db'

// Import unified CloudflareEnv from types/CloudflareBindings
import type { CloudflareEnv } from '../types/CloudflareBindings'

/**
 * Env - Re-export of CloudflareEnv for backward compatibility
 */
export type Env = CloudflareEnv

// ============================================================================
// DOTiny - Minimal Durable Object
// ============================================================================

export class DO<E extends Env = Env> extends DurableObject<E> {
  // ═══════════════════════════════════════════════════════════════════════════
  // TYPE DISCRIMINATOR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Static $type property - the class type discriminator
   * Must be overridden in subclasses
   */
  static readonly $type: string = 'DO'

  /**
   * Instance getter that delegates to the static $type property.
   * This allows TypeScript to recognize `this.$type` on instances.
   */
  get $type(): string {
    return (this.constructor as typeof DO).$type
  }

  /**
   * Get the full type hierarchy for this instance
   * Returns an array from most specific to most general (e.g., ['Agent', 'Worker', 'DO'])
   */
  getTypeHierarchy(): string[] {
    const hierarchy: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let current: typeof DO | null = this.constructor as typeof DO

    while (current && current.$type) {
      hierarchy.push(current.$type)
      const parent = Object.getPrototypeOf(current)
      if (parent === Function.prototype || !parent.$type) break
      current = parent
    }

    return hierarchy
  }

  /**
   * Check if this instance is of or extends the given type
   */
  isInstanceOfType(type: string): boolean {
    return this.getTypeHierarchy().includes(type)
  }

  /**
   * Check for exact type match
   */
  isType(type: string): boolean {
    return this.$type === type
  }

  /**
   * Check if this type extends the given type (includes exact match)
   */
  extendsType(type: string): boolean {
    return this.isInstanceOfType(type)
  }

  /**
   * Assert that this instance is of the expected type, throw otherwise
   */
  assertType(expectedType: string): void {
    if (this.$type !== expectedType) {
      throw new Error(`expected ${expectedType} but got ${this.$type}`)
    }
  }

  /**
   * Serialize this DO to JSON including $type
   */
  toJSON(): Record<string, unknown> {
    return {
      $type: this.$type,
      ns: this.ns,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Namespace URL - the DO's identity
   * e.g., 'https://startups.studio'
   */
  readonly ns: string

  /**
   * Current branch (default: 'main')
   */
  protected currentBranch: string = 'main'

  // ═══════════════════════════════════════════════════════════════════════════
  // STORAGE
  // ═══════════════════════════════════════════════════════════════════════════

  protected db: DrizzleSqliteDODatabase<typeof schema>

  /**
   * Access to the raw DurableObjectStorage
   */
  protected get storage(): DurableObjectStorage {
    return this.ctx.storage
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HONO APP (for subclass routing)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Optional Hono app for HTTP routing.
   * Subclasses can create and configure this for custom routes.
   */
  protected app?: Hono

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTRUCTOR
  // ═══════════════════════════════════════════════════════════════════════════

  constructor(ctx: DurableObjectState, env: E) {
    super(ctx, env)

    // Protect $type on this instance to prevent tampering
    Object.defineProperty(this, '$type', {
      get: () => (this.constructor as typeof DO).$type,
      configurable: false,
      enumerable: true,
    })

    // Initialize namespace from storage or derive from ID
    this.ns = '' // Will be set during initialization

    // Initialize Drizzle with SQLite via durable-sqlite driver
    this.db = drizzle(ctx.storage, { schema })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  async initialize(config: { ns: string; parent?: string }): Promise<void> {
    // @ts-expect-error - Setting readonly after construction
    this.ns = config.ns

    // Store namespace
    await this.ctx.storage.put('ns', config.ns)

    // If has parent, record the relationship
    if (config.parent) {
      // @ts-expect-error - Schema field names may differ
      await this.db.insert(schema.objects).values({
        ns: config.parent,
        doId: this.ctx.id.toString(),
        doClass: this.constructor.name,
        relationType: 'parent',
        createdAt: new Date(),
      })
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  protected log(message: string, data?: unknown): void {
    console.log(`[${this.ns}] ${message}`, data)
  }

  /**
   * Check if this DO class has a specific capability
   * Base DO class has no capabilities - mixins add them
   */
  hasCapability(name: string): boolean {
    return false
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle incoming HTTP requests.
   *
   * If a Hono app is configured, it delegates to the app first.
   * Falls back to built-in routes (/health) if not handled by app.
   */
  async fetch(request: Request): Promise<Response> {
    return this.handleFetch(request)
  }

  /**
   * Core fetch handler that integrates with Hono.
   *
   * Order of handling:
   * 1. Built-in routes (/health)
   * 2. Hono app routes (if configured)
   * 3. 404 Not Found
   */
  protected async handleFetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Built-in routes always handled first
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', ns: this.ns })
    }

    // Delegate to Hono app if configured
    if (this.app) {
      const response = await this.app.fetch(request, this.env)
      return response
    }

    // Default: 404 Not Found
    return new Response('Not Found', { status: 404 })
  }

  /**
   * Create a default Hono app with common middleware.
   * Subclasses can call this and extend with their own routes.
   */
  protected createDefaultApp(): Hono {
    return new Hono()
  }
}

export default DO
