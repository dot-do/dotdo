/**
 * @module DOTiny
 * @description Minimal Durable Object Base Class (~15KB)
 *
 * DOTiny is the foundation of the DO hierarchy, providing the smallest possible
 * implementation for edge-native applications. It includes only essential features:
 *
 * **Core Features:**
 * - Identity management (`ns`, `$type`, type hierarchy checking)
 * - Drizzle-powered SQLite storage via `ctx.storage`
 * - HTTP request handling with `fetch()` and `/health` endpoint
 * - User context extraction from `X-User-*` headers
 * - Identity derivation from request URLs
 *
 * **DO Class Hierarchy:**
 * ```
 * DOTiny (~15KB)        - Identity, db, fetch, toJSON
 *    |
 *    v
 * DOBase (~80KB)        - + WorkflowContext, stores, events, scheduling
 *    |
 *    v
 * DOFull (~120KB)       - + Lifecycle, sharding, branching, promotion
 * ```
 *
 * **When to Use DOTiny:**
 * - Minimal bundle size is critical
 * - Simple key-value storage patterns
 * - No need for workflow context or event handlers
 * - Custom routing (bring your own Hono or router)
 *
 * **Tree-shakeable Imports:**
 * - `import { DO } from 'dotdo/tiny'` - DOTiny (minimal)
 * - `import { DO } from 'dotdo/base'` - DOBase (workflow context)
 * - `import { DO } from 'dotdo/full'` - DOFull (all features)
 * - `import { DO } from 'dotdo'` - DOFull + fs/git/bash mixins
 *
 * @example Basic Custom DO
 * ```typescript
 * import { DO } from 'dotdo/tiny'
 *
 * class MyDO extends DO {
 *   async fetch(request: Request): Promise<Response> {
 *     const url = new URL(request.url)
 *
 *     if (url.pathname === '/data') {
 *       const data = await this.ctx.storage.get('myData')
 *       return Response.json(data)
 *     }
 *
 *     return super.fetch(request)
 *   }
 * }
 * ```
 *
 * @example Type Checking
 * ```typescript
 * class MyEntity extends DO {
 *   static override readonly $type = 'MyEntity'
 * }
 *
 * const entity = new MyEntity(ctx, env)
 * entity.isType('MyEntity')        // true
 * entity.extendsType('DO')         // true
 * entity.getTypeHierarchy()        // ['MyEntity', 'DO']
 * ```
 *
 * @example User Context from Headers
 * ```typescript
 * class SecureDO extends DO {
 *   protected async handleFetch(request: Request): Promise<Response> {
 *     // this.user is automatically extracted from X-User-* headers
 *     if (!this.user) {
 *       return new Response('Unauthorized', { status: 401 })
 *     }
 *     return Response.json({ userId: this.user.id })
 *   }
 * }
 * ```
 *
 * @see DOBase for WorkflowContext and stores
 * @see DOFull for lifecycle operations
 */

import { DurableObject } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/durable-sqlite'
import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'

// Minimal schema - only objects table for parent relationships
import * as schema from '../db/schema-minimal'

// Import unified CloudflareEnv from types/CloudflareBindings
import type { CloudflareEnv } from '../types/CloudflareBindings'

// Import UserContext from types
import type { UserContext } from '../types/WorkflowContext'

// Re-export UserContext for consumers
export type { UserContext }

/**
 * Env - Re-export of CloudflareEnv for backward compatibility
 */
export type Env = CloudflareEnv

// ============================================================================
// USER CONTEXT EXTRACTION
// ============================================================================

/**
 * Extract user context from X-User-* headers in a request.
 *
 * This function is used internally by DOTiny to populate the `user` property
 * on each incoming request. The RPC auth middleware sets these headers
 * after validating authentication tokens.
 *
 * **Supported Headers:**
 * - `X-User-ID` (required) - Unique user identifier
 * - `X-User-Email` (optional) - User's email address
 * - `X-User-Role` (optional) - User's role or permission level
 *
 * @param req - The incoming HTTP request
 * @returns UserContext object if X-User-ID header is present, null otherwise
 *
 * @example
 * ```typescript
 * // Headers set by auth middleware:
 * // X-User-ID: usr_123
 * // X-User-Email: john@example.com
 * // X-User-Role: admin
 *
 * const user = extractUserFromRequest(request)
 * // { id: 'usr_123', email: 'john@example.com', role: 'admin' }
 * ```
 */
export function extractUserFromRequest(req: Request): UserContext | null {
  const id = req.headers.get('X-User-ID')
  if (!id) {
    return null
  }

  const user: UserContext = { id }

  const email = req.headers.get('X-User-Email')
  if (email) {
    user.email = email
  }

  const role = req.headers.get('X-User-Role')
  if (role) {
    user.role = role
  }

  return user
}

// ============================================================================
// DOTiny - Minimal Durable Object
// ============================================================================

/**
 * DO (DOTiny) - Minimal Durable Object Base Class
 *
 * The smallest possible DO implementation providing identity, storage, and HTTP handling.
 * Extend this class for minimal-footprint edge applications.
 *
 * @template E - Environment bindings type, defaults to CloudflareEnv
 *
 * @property {string} ns - Namespace URL identifying this DO instance (e.g., 'https://tenant.api.dotdo.dev')
 * @property {string} $type - Type discriminator for polymorphic behavior
 * @property {UserContext | null} user - Current authenticated user, extracted from request headers
 * @property {DrizzleSqliteDODatabase} db - Drizzle ORM instance for SQLite operations
 *
 * @example Subclassing DOTiny
 * ```typescript
 * class CounterDO extends DO {
 *   static override readonly $type = 'Counter'
 *
 *   async increment(): Promise<number> {
 *     const current = await this.ctx.storage.get<number>('count') ?? 0
 *     const next = current + 1
 *     await this.ctx.storage.put('count', next)
 *     return next
 *   }
 *
 *   protected async handleFetch(request: Request): Promise<Response> {
 *     const url = new URL(request.url)
 *     if (url.pathname === '/increment' && request.method === 'POST') {
 *       const count = await this.increment()
 *       return Response.json({ count })
 *     }
 *     return super.handleFetch(request)
 *   }
 * }
 * ```
 */
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

  /**
   * Parent namespace URL (optional)
   * Used as $context in root responses
   * e.g., 'https://Startups.Studio'
   */
  protected parent?: string

  // ═══════════════════════════════════════════════════════════════════════════
  // USER CONTEXT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Current authenticated user context.
   * Extracted from X-User-* headers on each incoming request.
   * Set by the RPC auth middleware before forwarding to the DO.
   *
   * - `null` if the request is unauthenticated (no X-User-ID header)
   * - Contains `id`, optional `email`, and optional `role`
   *
   * @example
   * ```typescript
   * async fetch(request: Request) {
   *   // user is automatically extracted from headers
   *   if (this.user) {
   *     console.log(`Request from: ${this.user.id}`)
   *   } else {
   *     console.log('Unauthenticated request')
   *   }
   * }
   * ```
   */
  user: UserContext | null = null

  // ═══════════════════════════════════════════════════════════════════════════
  // STORAGE
  // ═══════════════════════════════════════════════════════════════════════════

  // Use 'any' for schema type to allow subclasses to use extended schemas
  // DOBase overrides this with the full schema type
  protected db: DrizzleSqliteDODatabase<any>

  /**
   * Access to the raw DurableObjectStorage
   */
  protected get storage(): DurableObjectStorage {
    return this.ctx.storage
  }

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

    // If has parent, record the relationship and store locally
    if (config.parent) {
      this.parent = config.parent
      await this.ctx.storage.put('parent', config.parent)
      await this.db.insert(schema.objects).values({
        ns: config.parent,
        id: this.ctx.id.toString(),
        class: this.constructor.name,
        relation: 'parent',
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
  // IDENTITY DERIVATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Track whether identity has been derived from a request.
   * Once set, ns remains stable for the DO's lifetime.
   */
  private _identityDerived = false

  /**
   * Derive identity (ns) from the incoming request URL if not already set.
   * The ns is the first subdomain from the request URL's hostname.
   *
   * Examples:
   * - https://acme.api.dotdo.dev/foo → ns = 'acme'
   * - https://localhost:8787/bar → ns = 'localhost'
   * - https://single-domain.dev/bar → ns = 'single-domain'
   *
   * @param request - The incoming request
   */
  protected deriveIdentityFromRequest(request: Request): void {
    // Only derive once - first request wins
    if (this._identityDerived) {
      return
    }

    try {
      const url = new URL(request.url)
      const hostname = url.hostname

      // Extract first subdomain (e.g., 'acme' from 'acme.api.dotdo.dev')
      const parts = hostname.split('.')
      const ns = parts[0] ?? hostname

      // Set ns if it's empty
      if (!this.ns && ns) {
        // @ts-expect-error - Setting readonly property after construction
        this.ns = ns
      }

      this._identityDerived = true
    } catch {
      // Silently ignore URL parsing errors - ns remains as-is
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle incoming HTTP requests.
   * Derives identity from request URL, extracts user context from X-User-* headers,
   * then delegates to handleFetch.
   */
  async fetch(request: Request): Promise<Response> {
    // Derive identity from request URL (sets ns from hostname subdomain)
    this.deriveIdentityFromRequest(request)

    // Extract user from X-User-* headers (set by RPC auth middleware)
    this.user = extractUserFromRequest(request)

    return this.handleFetch(request)
  }

  /**
   * Core fetch handler - override in subclasses for custom routing.
   * DOBase overrides this to add /resolve endpoint and Hono routing.
   */
  protected async handleFetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Built-in /health endpoint
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', ns: this.ns, $type: this.$type })
    }

    // Default: 404 Not Found
    // Override handleFetch() in subclasses for custom routes
    return new Response('Not Found', { status: 404 })
  }
}

export default DO
