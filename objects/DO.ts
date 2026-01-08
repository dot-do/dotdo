/**
 * DO - Base Durable Object class
 *
 * Minimal runtime implementation with:
 * - Identity (ns)
 * - Storage (Drizzle + SQLite)
 * - Workflow context ($)
 * - Lifecycle operations (fork, compact, moveTo, branch, checkout, merge)
 * - Resolution (local and cross-DO)
 *
 * Types are defined in types/*.ts
 * Schema is defined in db/*.ts
 */

import { DurableObject } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import * as schema from '../db'
import type { WorkflowContext, DomainProxy } from '../types/WorkflowContext'
import type { Thing } from '../types/Thing'

// ============================================================================
// ENVIRONMENT
// ============================================================================

export interface Env {
  AI?: Fetcher
  PIPELINE?: Pipeline
  DO?: DurableObjectNamespace
  [key: string]: unknown
}

interface Pipeline {
  send(data: unknown): Promise<void>
}

// ============================================================================
// DO - Base Durable Object
// ============================================================================

export class DO extends DurableObject<Env> {
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

  protected db: DrizzleD1Database<typeof schema>

  // ═══════════════════════════════════════════════════════════════════════════
  // WORKFLOW CONTEXT ($)
  // ═══════════════════════════════════════════════════════════════════════════

  readonly $: WorkflowContext

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTRUCTOR
  // ═══════════════════════════════════════════════════════════════════════════

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize namespace from storage or derive from ID
    this.ns = '' // Will be set during initialization

    // Initialize Drizzle with SQLite
    // @ts-expect-error - SqlStorage is compatible with D1Database for Drizzle
    this.db = drizzle(ctx.storage.sql, { schema })

    // Initialize workflow context
    this.$ = this.createWorkflowContext()
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
  // WORKFLOW CONTEXT FACTORY
  // ═══════════════════════════════════════════════════════════════════════════

  protected createWorkflowContext(): WorkflowContext {
    const self = this

    return new Proxy({} as WorkflowContext, {
      get(_, prop: string) {
        switch (prop) {
          case 'send':
            return self.send.bind(self)
          case 'try':
            return self.try.bind(self)
          case 'do':
            return self.do.bind(self)
          case 'on':
            return self.createOnProxy()
          case 'every':
            return self.createScheduleBuilder()
          case 'branch':
            return self.branch.bind(self)
          case 'checkout':
            return self.checkout.bind(self)
          case 'merge':
            return self.merge.bind(self)
          case 'log':
            return self.log.bind(self)
          case 'state':
            return {}
          default:
            // Domain resolution: $.Noun(id)
            return (id: string) => self.createDomainProxy(prop, id)
        }
      },
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXECUTION MODES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fire-and-forget event emission (non-blocking, non-durable)
   */
  protected send(event: string, data: unknown): void {
    // Best-effort action logging
    this.logAction('send', event, data).catch(() => {})

    // Best-effort event emission
    this.emitEvent(event, data).catch(() => {})
  }

  /**
   * Quick attempt without durability (blocking, non-durable)
   */
  protected async try<T>(action: string, data: unknown): Promise<T> {
    const actionRecord = await this.logAction('try', action, data)

    try {
      const result = await this.executeAction(action, data)
      await this.completeAction(actionRecord.rowid, result)
      await this.emitEvent(`${action}.completed`, { result })
      return result as T
    } catch (error) {
      await this.failAction(actionRecord.rowid, error)
      await this.emitEvent(`${action}.failed`, { error }).catch(() => {})
      throw error
    }
  }

  /**
   * Durable execution with retries (blocking, durable)
   */
  protected async do<T>(action: string, data: unknown): Promise<T> {
    const actionRecord = await this.logAction('do', action, data)

    const maxRetries = 3
    let lastError: unknown

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await this.executeAction(action, data)
        await this.completeAction(actionRecord.rowid, result)
        await this.emitEvent(`${action}.completed`, { result })
        return result as T
      } catch (error) {
        lastError = error
        if (attempt < maxRetries - 1) {
          await this.updateActionStatus(actionRecord.rowid, 'retrying')
          await this.sleep(Math.pow(2, attempt) * 1000) // Exponential backoff
        }
      }
    }

    await this.failAction(actionRecord.rowid, lastError)
    await this.emitEvent(`${action}.failed`, { error: lastError })
    throw lastError
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTION LOGGING (append-only)
  // ═══════════════════════════════════════════════════════════════════════════

  protected async logAction(durability: 'send' | 'try' | 'do', verb: string, input: unknown): Promise<{ rowid: number }> {
    const result = await this.db
      .insert(schema.actions)
      // @ts-expect-error - Schema field names may differ
      .values({
        id: crypto.randomUUID(),
        verb,
        target: this.ns,
        actor: '', // TODO: Get from context
        input: input as Record<string, unknown>,
        status: 'pending',
        createdAt: new Date(),
      })
      .returning({ rowid: schema.actions.id })

    return { rowid: 0 } // SQLite rowid
  }

  protected async completeAction(rowid: number | string, output: unknown): Promise<void> {
    // Update action status
  }

  protected async failAction(rowid: number | string, error: unknown): Promise<void> {
    // Update action status to failed
  }

  protected async updateActionStatus(rowid: number, status: string): Promise<void> {
    // Update action status
  }

  protected async executeAction(action: string, data: unknown): Promise<unknown> {
    // Override in subclasses to handle specific actions
    throw new Error(`Unknown action: ${action}`)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT EMISSION
  // ═══════════════════════════════════════════════════════════════════════════

  protected async emitEvent(verb: string, data: unknown): Promise<void> {
    // Insert event
    await this.db.insert(schema.events).values({
      id: crypto.randomUUID(),
      verb,
      source: this.ns,
      data: data as Record<string, unknown>,
      sequence: 0, // Will use SQLite rowid
      streamed: false,
      createdAt: new Date(),
    })

    // Stream to Pipeline if configured
    if (this.env.PIPELINE) {
      try {
        await this.env.PIPELINE.send({
          verb,
          source: this.ns,
          data,
          timestamp: new Date().toISOString(),
        })
      } catch {
        // Best-effort streaming
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fork current state to a new DO (new identity, fresh history)
   */
  async fork(options: { to: string }): Promise<void> {
    // 1. Get current state (latest version of each thing)
    // 2. Create new DO at target namespace
    // 3. Copy current state (without history)
    // 4. Optionally delete this DO
    throw new Error('Not implemented')
  }

  /**
   * Squash history to current state (same identity)
   */
  async compact(): Promise<void> {
    // 1. Get latest version of each thing
    // 2. Delete all but latest versions
    // 3. Reset action/event log (or archive to R2)
    throw new Error('Not implemented')
  }

  /**
   * Relocate DO to a different colo (same identity, new location)
   */
  async moveTo(colo: string): Promise<void> {
    // 1. Create new DO with locationHint at target colo
    // 2. Compact + transfer current state
    // 3. Update objects table: ns -> new doId
    // 4. Delete this DO
    throw new Error('Not implemented')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCHING & VERSION CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new branch at current HEAD
   */
  async branch(name: string): Promise<void> {
    // Insert into branches table
    throw new Error('Not implemented')
  }

  /**
   * Switch to a branch or version
   * @param ref - Branch name or version reference (e.g., '@v1234', '@main')
   */
  async checkout(ref: string): Promise<void> {
    // Parse ref and switch context
    throw new Error('Not implemented')
  }

  /**
   * Merge a branch into current
   */
  async merge(branch: string): Promise<void> {
    // Merge branch into current
    throw new Error('Not implemented')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESOLUTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve any URL to a Thing (local, cross-DO, or external)
   */
  async resolve(url: string): Promise<Thing> {
    const parsed = new URL(url)
    const ns = `${parsed.protocol}//${parsed.host}`
    const path = parsed.pathname.slice(1)
    const ref = parsed.hash.slice(1) || 'main' // @ref in fragment

    if (ns === this.ns) {
      // Local resolution
      return this.resolveLocal(path, ref)
    } else {
      // Cross-DO resolution
      return this.resolveCrossDO(ns, path, ref)
    }
  }

  protected async resolveLocal(path: string, ref: string): Promise<Thing> {
    // Query things table for latest version at ref
    throw new Error('Not implemented')
  }

  protected async resolveCrossDO(ns: string, path: string, ref: string): Promise<Thing> {
    // Look up in objects table, get DO stub, call resolve
    throw new Error('Not implemented')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROXY FACTORIES
  // ═══════════════════════════════════════════════════════════════════════════

  protected createOnProxy(): Record<string, Record<string, (handler: Function) => void>> {
    return new Proxy(
      {},
      {
        get: (_, noun: string) => {
          return new Proxy(
            {},
            {
              get: (_, verb: string) => {
                return (handler: Function) => {
                  // Register event handler
                  // Store in event handlers registry
                }
              },
            },
          )
        },
      },
    )
  }

  protected createScheduleBuilder(): unknown {
    // Return a proxy that builds cron expressions
    return new Proxy(() => {}, {
      get: (_, day: string) => {
        return new Proxy(() => {}, {
          get: (_, time: string) => {
            return (handler: Function) => {
              // Register schedule handler
            }
          },
        })
      },
      apply: (_, __, [schedule, handler]: [string, Function]) => {
        // Natural language schedule
      },
    })
  }

  protected createDomainProxy(noun: string, id: string): DomainProxy {
    const self = this
    return new Proxy({} as DomainProxy, {
      get(_, method: string) {
        return async (...args: unknown[]) => {
          // Resolve the DO and call the method
          const url = `${self.ns}/${id}`
          const thing = await self.resolve(url)
          // Call method on resolved thing/DO
          throw new Error('Not implemented')
        }
      },
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  protected log(message: string, data?: unknown): void {
    console.log(`[${this.ns}] ${message}`, data)
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RELATIONSHIPS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Parent namespace (for hierarchical DOs)
   */
  protected parent?: string

  /**
   * Emit an event (public wrapper for emitEvent)
   */
  protected async emit(verb: string, data?: unknown): Promise<void> {
    return this.emitEvent(verb, data)
  }

  /**
   * Link this DO to another object
   */
  protected async link(
    target: string | { doId: string; doClass: string; role?: string; data?: Record<string, unknown> },
    relationType: string = 'related',
  ): Promise<void> {
    const targetNs = typeof target === 'string' ? target : target.doId
    const metadata = typeof target === 'string' ? undefined : target
    await this.db.insert(schema.relationships).values({
      id: crypto.randomUUID(),
      verb: typeof target === 'string' ? relationType : target.role || relationType,
      from: this.ns,
      to: targetNs,
      data: metadata as Record<string, unknown> | null,
      createdAt: new Date(),
    })
  }

  /**
   * Get linked objects by relation type
   */
  protected async getLinkedObjects(
    relationType?: string,
  ): Promise<Array<{ ns: string; relationType: string; doId: string; doClass?: string; data?: Record<string, unknown> }>> {
    // Query relationships table
    const results = await this.db.select().from(schema.relationships)
    return results
      .filter((r) => r.from === this.ns && (!relationType || r.verb === relationType))
      .map((r) => ({
        ns: r.to,
        relationType: r.verb,
        doId: r.to,
        doClass: (r.data as Record<string, unknown> | null)?.doClass as string | undefined,
        data: r.data as Record<string, unknown> | undefined,
      }))
  }

  /**
   * Create a Thing in the database (stub for subclasses)
   */
  protected async createThing(data: { type: string; name: string; data?: Record<string, unknown> }): Promise<{ id: string }> {
    const id = crypto.randomUUID()
    // @ts-expect-error - Drizzle schema types may differ slightly
    await this.db.insert(schema.things).values({
      id,
      ns: this.ns,
      type: data.type,
      data: { name: data.name, ...data.data } as Record<string, unknown>,
      version: 1,
      branch: this.currentBranch,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    return { id }
  }

  /**
   * Create an Action record (stub for subclasses)
   */
  protected async createAction(data: {
    type: string
    target: string
    actor: string
    data?: Record<string, unknown>
  }): Promise<{ id: string }> {
    const id = crypto.randomUUID()
    // @ts-expect-error - Schema field names may differ
    await this.db.insert(schema.actions).values({
      id,
      verb: data.type,
      target: data.target,
      actor: data.actor,
      input: data.data as Record<string, unknown>,
      status: 'pending',
      createdAt: new Date(),
    })
    return { id }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', ns: this.ns })
    }

    // Override in subclasses for custom routing
    return new Response('Not Found', { status: 404 })
  }
}

export default DO
