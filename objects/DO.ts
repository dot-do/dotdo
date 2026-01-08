/**
 * DO - Base Durable Object class
 *
 * Core data model with Things, Relationships, Actions, Events
 * All other DO classes inherit from this base.
 */

import { DurableObject } from 'cloudflare:workers'

export interface Env {
  AI?: any
  PIPELINE?: any
  [key: string]: any
}

export type ThingData = Record<string, unknown>
export type MetaData = Record<string, unknown>

export interface Thing {
  id: string
  type: string
  name?: string
  data?: ThingData
  meta?: MetaData
  createdAt?: Date
  updatedAt?: Date
  deletedAt?: Date
}

export interface Relationship {
  id: string
  type: string
  fromId: string
  fromType: string
  toId: string
  toType: string
  data?: Record<string, unknown>
  createdAt?: Date
}

export interface Action {
  id: string
  type: string
  target: string
  actor: string
  data?: Record<string, unknown>
  result?: Record<string, unknown>
  status: 'pending' | 'completed' | 'failed' | 'undone'
  createdAt?: Date
}

export interface Event {
  id: string
  type: string
  source: string
  data?: Record<string, unknown>
  sequence: number
  createdAt?: Date
}

export interface DOObject {
  id: string
  doId: string
  doClass: string
  localRef?: string
  role?: string
  data?: Record<string, unknown>
  createdAt?: Date
}

/**
 * Base Durable Object class with unified data model
 */
export class DO extends DurableObject<Env> {
  protected env: Env

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.env = env
  }

  // ============================================================================
  // Things - Core entity storage
  // ============================================================================

  async createThing(thing: Omit<Thing, 'id' | 'createdAt' | 'updatedAt'>): Promise<Thing> {
    const id = crypto.randomUUID()
    const now = new Date()
    const record: Thing = {
      ...thing,
      id,
      createdAt: now,
      updatedAt: now,
    }
    await this.ctx.storage.put(`thing:${id}`, record)
    return record
  }

  async getThing(id: string): Promise<Thing | null> {
    return await this.ctx.storage.get(`thing:${id}`) as Thing | null
  }

  async updateThing(id: string, updates: Partial<Thing>): Promise<Thing | null> {
    const thing = await this.getThing(id)
    if (!thing) return null
    const updated = { ...thing, ...updates, updatedAt: new Date() }
    await this.ctx.storage.put(`thing:${id}`, updated)
    return updated
  }

  async deleteThing(id: string): Promise<boolean> {
    const thing = await this.getThing(id)
    if (!thing) return false
    await this.updateThing(id, { deletedAt: new Date() })
    return true
  }

  async listThings(type?: string): Promise<Thing[]> {
    const map = await this.ctx.storage.list({ prefix: 'thing:' })
    const things = Array.from(map.values()) as Thing[]
    if (type) {
      return things.filter(t => t.type === type && !t.deletedAt)
    }
    return things.filter(t => !t.deletedAt)
  }

  // ============================================================================
  // Relationships - Graph edges between things
  // ============================================================================

  async createRelationship(rel: Omit<Relationship, 'id' | 'createdAt'>): Promise<Relationship> {
    const id = crypto.randomUUID()
    const record: Relationship = {
      ...rel,
      id,
      createdAt: new Date(),
    }
    await this.ctx.storage.put(`rel:${id}`, record)
    return record
  }

  async getRelationship(id: string): Promise<Relationship | null> {
    return await this.ctx.storage.get(`rel:${id}`) as Relationship | null
  }

  async findRelationships(query: { fromId?: string; toId?: string; type?: string }): Promise<Relationship[]> {
    const map = await this.ctx.storage.list({ prefix: 'rel:' })
    const rels = Array.from(map.values()) as Relationship[]
    return rels.filter(r => {
      if (query.fromId && r.fromId !== query.fromId) return false
      if (query.toId && r.toId !== query.toId) return false
      if (query.type && r.type !== query.type) return false
      return true
    })
  }

  // ============================================================================
  // Actions - Command log with undo/redo support
  // ============================================================================

  async createAction(action: Omit<Action, 'id' | 'createdAt' | 'status'>): Promise<Action> {
    const id = crypto.randomUUID()
    const record: Action = {
      ...action,
      id,
      status: 'pending',
      createdAt: new Date(),
    }
    await this.ctx.storage.put(`action:${id}`, record)
    return record
  }

  async completeAction(id: string, result: Record<string, unknown>): Promise<Action | null> {
    const action = await this.ctx.storage.get(`action:${id}`) as Action | null
    if (!action) return null
    const updated = { ...action, status: 'completed' as const, result }
    await this.ctx.storage.put(`action:${id}`, updated)
    return updated
  }

  async failAction(id: string, error: Record<string, unknown>): Promise<Action | null> {
    const action = await this.ctx.storage.get(`action:${id}`) as Action | null
    if (!action) return null
    const updated = { ...action, status: 'failed' as const, result: error }
    await this.ctx.storage.put(`action:${id}`, updated)
    return updated
  }

  // ============================================================================
  // Events - Event sourcing
  // ============================================================================

  private eventSequence = 0

  async emit(type: string, data: Record<string, unknown>, options?: { stream?: boolean }): Promise<Event> {
    const id = crypto.randomUUID()
    const event: Event = {
      id,
      type,
      source: this.ctx.id.toString(),
      data,
      sequence: ++this.eventSequence,
      createdAt: new Date(),
    }
    await this.ctx.storage.put(`event:${id}`, event)

    // Stream to Pipeline if configured
    if (options?.stream && this.env.PIPELINE) {
      await this.env.PIPELINE.send(event)
    }

    return event
  }

  async getEvents(since?: number): Promise<Event[]> {
    const map = await this.ctx.storage.list({ prefix: 'event:' })
    const events = Array.from(map.values()) as Event[]
    if (since !== undefined) {
      return events.filter(e => e.sequence > since).sort((a, b) => a.sequence - b.sequence)
    }
    return events.sort((a, b) => a.sequence - b.sequence)
  }

  // ============================================================================
  // Objects - Cross-DO references
  // ============================================================================

  async link(obj: Omit<DOObject, 'id' | 'createdAt'>): Promise<DOObject> {
    const id = crypto.randomUUID()
    const record: DOObject = {
      ...obj,
      id,
      createdAt: new Date(),
    }
    await this.ctx.storage.put(`object:${id}`, record)
    return record
  }

  async getLinkedObjects(role?: string): Promise<DOObject[]> {
    const map = await this.ctx.storage.list({ prefix: 'object:' })
    const objects = Array.from(map.values()) as DOObject[]
    if (role) {
      return objects.filter(o => o.role === role)
    }
    return objects
  }

  async parent(): Promise<DOObject | null> {
    const parents = await this.getLinkedObjects('parent')
    return parents[0] || null
  }

  async children(): Promise<DOObject[]> {
    return this.getLinkedObjects('child')
  }

  // ============================================================================
  // HTTP Handler
  // ============================================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // Health check
    if (path === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Override in subclasses for custom routing
    return new Response('Not Found', { status: 404 })
  }
}

export default DO
