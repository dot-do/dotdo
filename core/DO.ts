// @dotdo/core - DOCore class
// The foundational Durable Object runtime class - MINIMAL implementation

import { DurableObject } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/durable-sqlite'
import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'

/**
 * Base environment type for Durable Objects.
 * Users can extend this with their own bindings.
 */
export interface DOEnv {
  [key: string]: unknown
}

/**
 * Empty schema type for unextended DOCore instances.
 */
type EmptySchema = Record<string, never>

/**
 * Constructor signature for DOCore subclasses.
 */
type DOCoreConstructor<TSchema extends Record<string, unknown>, E extends DOEnv> = new (
  ctx: DurableObjectState,
  env: E
) => DOCore<TSchema, E>

/**
 * DOCore - Minimal Durable Object Base Class for @dotdo/core
 *
 * Provides the absolute minimum required for a functional Durable Object:
 * - SQLite storage via Drizzle ORM
 * - Optional namespace identity (ns)
 * - Schema extension via `DOCore.with(schema)`
 *
 * This class does NOT include:
 * - Things, Relationships, Events, Actions stores (those stay in dotdo)
 * - WorkflowContext ($) - that's built on top
 * - HTTP routing - bring your own
 * - User context extraction - that's application logic
 *
 * @template TSchema - Drizzle schema type, defaults to empty
 * @template E - Environment bindings type, defaults to DOEnv
 *
 * @example Basic Usage
 * ```typescript
 * import { DOCore } from '@dotdo/core'
 *
 * class MyDO extends DOCore {
 *   async fetch(request: Request): Promise<Response> {
 *     // Use this.db for type-safe SQL queries
 *     return Response.json({ ns: this.ns })
 *   }
 * }
 * ```
 *
 * @example With Custom Schema
 * ```typescript
 * import { DOCore } from '@dotdo/core'
 * import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
 *
 * const users = sqliteTable('users', {
 *   id: text('id').primaryKey(),
 *   name: text('name').notNull(),
 *   createdAt: integer('created_at', { mode: 'timestamp' }),
 * })
 *
 * const mySchema = { users }
 *
 * class MyDO extends DOCore.with(mySchema) {
 *   async createUser(name: string) {
 *     // this.db is typed with your schema
 *     await this.db.insert(mySchema.users).values({
 *       id: crypto.randomUUID(),
 *       name,
 *       createdAt: new Date(),
 *     })
 *   }
 * }
 * ```
 */
export class DOCore<
  TSchema extends Record<string, unknown> = EmptySchema,
  E extends DOEnv = DOEnv,
> extends DurableObject<E> {
  // ═══════════════════════════════════════════════════════════════════════════
  // TYPE DISCRIMINATOR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Static $type property - the class type discriminator.
   * Override in subclasses to identify DO types.
   */
  static readonly $type: string = 'DOCore'

  /**
   * Instance getter that delegates to the static $type property.
   */
  get $type(): string {
    return (this.constructor as typeof DOCore).$type
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Backing field for namespace. Use the `ns` getter for public access.
   * Protected to allow subclasses (like dotdo's DOTiny) to modify directly.
   */
  protected _ns: string = ''

  /**
   * Namespace identifier - the DO's optional identity.
   * Can be set during construction or via setIdentity().
   * Typically derived from request URL hostname.
   */
  get ns(): string {
    return this._ns
  }

  /**
   * Set the namespace identity. Can only be set once.
   * @param value - The namespace identifier
   */
  protected setIdentity(value: string): void {
    if (!this._ns && value) {
      this._ns = value
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STORAGE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Drizzle ORM database instance for type-safe SQL operations.
   * Typed according to the schema provided via DOCore.with(schema).
   */
  protected db: DrizzleSqliteDODatabase<TSchema>

  /**
   * Direct access to DurableObjectStorage for KV operations.
   */
  protected get storage(): DurableObjectStorage {
    return this.ctx.storage
  }

  /**
   * Direct access to SQLite storage via raw SQL.
   * Use this.db for type-safe queries, this.sql for raw queries.
   */
  protected get sql(): SqlStorage {
    return this.ctx.storage.sql
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTRUCTOR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Schema instance stored for reference.
   * Set by DOCore.with() when creating typed subclasses.
   */
  protected static _schema: Record<string, unknown> = {}

  constructor(ctx: DurableObjectState, env: E) {
    super(ctx, env)

    // Get schema from the class (set by DOCore.with())
    const schema = (this.constructor as typeof DOCore)._schema as TSchema

    // Initialize Drizzle with SQLite via durable-sqlite driver
    // Pass schema for type inference if provided
    this.db = drizzle(ctx.storage, { schema }) as DrizzleSqliteDODatabase<TSchema>
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHEMA EXTENSION API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a DOCore subclass with a custom Drizzle schema.
   * This enables type-safe database operations with your tables.
   *
   * @param schema - A Drizzle schema object (e.g., { users, posts })
   * @returns A new class extending DOCore with the schema typed
   *
   * @example
   * ```typescript
   * const mySchema = { users, posts, comments }
   *
   * class MyDO extends DOCore.with(mySchema) {
   *   async getUsers() {
   *     // this.db is typed with mySchema
   *     return this.db.select().from(mySchema.users)
   *   }
   * }
   * ```
   */
  static with<S extends Record<string, unknown>, E extends DOEnv = DOEnv>(
    schema: S
  ): DOCoreConstructor<S, E> & typeof DOCore<S, E> {
    // Create a new class that extends DOCore with the schema
    const ExtendedDO = class extends (DOCore as unknown as typeof DOCore<S, E>) {
      static override _schema = schema
      static override readonly $type = 'DOCore'
    }

    return ExtendedDO as DOCoreConstructor<S, E> & typeof DOCore<S, E>
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER (MINIMAL)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Default fetch handler - returns 404.
   * Override in subclasses to add routing.
   *
   * @param request - Incoming HTTP request
   * @returns HTTP response
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Built-in /health endpoint for monitoring
    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        ns: this.ns || undefined,
        $type: this.$type,
      })
    }

    // Default: Not Found
    return new Response('Not Found', { status: 404 })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SERIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Serialize this DO to JSON.
   */
  toJSON(): Record<string, unknown> {
    return {
      $type: this.$type,
      ns: this.ns || undefined,
    }
  }
}

export default DOCore
