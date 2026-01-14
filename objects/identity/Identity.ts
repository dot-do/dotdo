/**
 * @module Identity
 * @description Base Identity Durable Object for user and agent identities
 *
 * Identity is the foundational DO for managing identities in the dotdo framework.
 * It provides core identity fields ($id, $type, createdAt, updatedAt) and methods
 * for identity lifecycle management.
 *
 * **Identity Types:**
 * - User - Human user identities
 * - AgentIdentity - AI agent identities (from id.org.ai)
 *
 * **Core Fields:**
 * | Field | Type | Description |
 * |-------|------|-------------|
 * | $id | string | Unique identifier URI (JSON-LD @id) |
 * | $type | string | Type discriminator (JSON-LD @type) |
 * | createdAt | string | ISO 8601 creation timestamp |
 * | updatedAt | string | ISO 8601 last update timestamp |
 *
 * **Events Emitted:**
 * | Event | When |
 * |-------|------|
 * | `identity.created` | Identity created |
 * | `identity.updated` | Identity fields updated |
 * | `identity.deleted` | Identity marked as deleted |
 *
 * @example Creating an Identity
 * ```typescript
 * const stub = env.Identity.get(env.Identity.idFromName('user-123'))
 * const identity = await stub.getIdentity()
 * ```
 *
 * @see User - Human user identity
 * @see Session - Authentication session management
 */

import { DO, type Env } from '../core/DO'
import type { Identity as IdentityType } from 'id.org.ai'
import { Identity as IdentityNoun } from '../../nouns/identity/Identity'

/**
 * Identity data stored in the DO
 */
export interface IdentityData {
  /** Unique identifier URI (JSON-LD @id) */
  $id: string
  /** Type discriminator (JSON-LD @type) */
  $type: string
  /** ISO 8601 timestamp when identity was created */
  createdAt: string
  /** ISO 8601 timestamp when identity was last updated */
  updatedAt: string
  /** Whether the identity has been soft-deleted */
  deleted?: boolean
  /** ISO 8601 timestamp when identity was deleted */
  deletedAt?: string
}

/**
 * Options for creating an identity
 */
export interface CreateIdentityOptions {
  /** Custom $id (auto-generated if not provided) */
  $id?: string
  /** Custom $type (defaults to 'Identity') */
  $type?: string
}

/**
 * Options for updating an identity
 */
export interface UpdateIdentityOptions {
  /** New $type (rare, but supported) */
  $type?: string
}

/**
 * Identity - Base Durable Object for identity management
 *
 * Provides foundational identity capabilities that User and AgentIdentity
 * extend. Stores identity data using the things store and emits events
 * for all identity lifecycle changes.
 */
export class Identity extends DO {
  static override readonly $type: string = IdentityNoun.$type
  static readonly noun = IdentityNoun

  /** Cached identity data */
  protected _identityData: IdentityData | null = null

  /** Storage key for identity data */
  protected static readonly IDENTITY_KEY = 'identity'

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Generate a unique identity ID
   */
  protected generateIdentityId(prefix: string = 'identities'): string {
    const uuid = crypto.randomUUID()
    return `https://schema.org.ai/${prefix}/${uuid}`
  }

  /**
   * Get the identity data, loading from storage if needed
   */
  async getIdentity(): Promise<IdentityData | null> {
    if (this._identityData) {
      return this._identityData
    }

    this._identityData = await this.ctx.storage.get<IdentityData>(Identity.IDENTITY_KEY) ?? null
    return this._identityData
  }

  /**
   * Create or initialize the identity
   *
   * @param options - Creation options including optional $id and $type
   * @returns The created identity data
   */
  async createIdentity(options: CreateIdentityOptions = {}): Promise<IdentityData> {
    const existing = await this.getIdentity()
    if (existing && !existing.deleted) {
      throw new Error('Identity already exists')
    }

    const now = new Date().toISOString()
    const identityData: IdentityData = {
      $id: options.$id ?? this.generateIdentityId(),
      $type: options.$type ?? `https://schema.org.ai/${(this.constructor as typeof Identity).$type}`,
      createdAt: now,
      updatedAt: now,
    }

    await this.ctx.storage.put(Identity.IDENTITY_KEY, identityData)
    this._identityData = identityData

    await this.emit('identity.created', { identity: identityData })

    return identityData
  }

  /**
   * Update the identity data
   *
   * @param options - Fields to update
   * @returns The updated identity data
   */
  async updateIdentity(options: UpdateIdentityOptions = {}): Promise<IdentityData> {
    const existing = await this.getIdentity()
    if (!existing) {
      throw new Error('Identity not found')
    }
    if (existing.deleted) {
      throw new Error('Cannot update deleted identity')
    }

    const now = new Date().toISOString()
    const updatedData: IdentityData = {
      ...existing,
      ...(options.$type && { $type: options.$type }),
      updatedAt: now,
    }

    await this.ctx.storage.put(Identity.IDENTITY_KEY, updatedData)
    this._identityData = updatedData

    await this.emit('identity.updated', {
      identity: updatedData,
      changes: options,
    })

    return updatedData
  }

  /**
   * Soft-delete the identity
   *
   * @returns The deleted identity data
   */
  async deleteIdentity(): Promise<IdentityData> {
    const existing = await this.getIdentity()
    if (!existing) {
      throw new Error('Identity not found')
    }
    if (existing.deleted) {
      throw new Error('Identity already deleted')
    }

    const now = new Date().toISOString()
    const deletedData: IdentityData = {
      ...existing,
      deleted: true,
      deletedAt: now,
      updatedAt: now,
    }

    await this.ctx.storage.put(Identity.IDENTITY_KEY, deletedData)
    this._identityData = deletedData

    await this.emit('identity.deleted', { identity: deletedData })

    return deletedData
  }

  /**
   * Check if the identity exists and is not deleted
   */
  async exists(): Promise<boolean> {
    const identity = await this.getIdentity()
    return identity !== null && !identity.deleted
  }

  /**
   * Handle HTTP requests with REST routes
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // GET /identity - Get identity data
    if (url.pathname === '/identity' && request.method === 'GET') {
      const identity = await this.getIdentity()
      if (!identity) {
        return new Response(JSON.stringify({ error: 'Identity not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(identity), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // POST /identity - Create identity
    if (url.pathname === '/identity' && request.method === 'POST') {
      try {
        const options = await request.json().catch(() => ({})) as CreateIdentityOptions
        const identity = await this.createIdentity(options)
        return new Response(JSON.stringify(identity), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // PATCH /identity - Update identity
    if (url.pathname === '/identity' && request.method === 'PATCH') {
      try {
        const options = await request.json() as UpdateIdentityOptions
        const identity = await this.updateIdentity(options)
        return new Response(JSON.stringify(identity), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // DELETE /identity - Soft-delete identity
    if (url.pathname === '/identity' && request.method === 'DELETE') {
      try {
        const identity = await this.deleteIdentity()
        return new Response(JSON.stringify(identity), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // Delegate to parent for other routes
    return super.fetch(request)
  }
}

export default Identity
