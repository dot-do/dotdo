/**
 * Noun Accessors Module - RPC-compatible noun accessor classes
 *
 * This module contains:
 * - NounAccessor - For type-level operations (create, list)
 * - NounInstanceAccessor - For instance-level operations (update, delete, get)
 * - Types for noun accessor patterns
 *
 * Usage patterns:
 * - this.Customer.create({...})
 * - this.Customer.list()
 * - this.Customer('id').update({...})
 * - this.Customer('id').delete()
 * - this.Customer('id').profile (property access for pipelines)
 */

import { RpcTarget } from 'cloudflare:workers'
import type { ThingData } from '../types'

// ============================================================================
// Types
// ============================================================================

/**
 * Interface for thing storage operations (implemented by ThingStore)
 */
export interface ThingStorageInterface {
  create(type: string, data: Record<string, unknown>): Promise<ThingData>
  list(type: string, query?: { where?: Record<string, unknown>; limit?: number; offset?: number }): Promise<ThingData[]>
  getById(id: string): Promise<ThingData | null>
  updateById(id: string, updates: Record<string, unknown>): Promise<ThingData>
  deleteById(id: string): Promise<boolean>
}

/**
 * Query options for listing things
 */
export interface NounQueryOptions {
  where?: Record<string, unknown>
  limit?: number
  offset?: number
}

/**
 * Interface for noun instance RPC methods
 */
export interface NounInstanceRPC {
  update(updates: Record<string, unknown>): Promise<ThingData>
  delete(): Promise<boolean>
  notify(): Promise<{ success: boolean }>
  getProfile(): Promise<ThingData | null>
  getStatus(): Promise<{ status: string }>
}

/**
 * Type for noun accessor with callable + methods pattern
 */
export type NounAccessorRPC = ((id: string) => NounInstanceRPC) & {
  create(data: Record<string, unknown>): Promise<ThingData>
  list(query?: NounQueryOptions): Promise<ThingData[]>
}

// ============================================================================
// Noun Accessor Classes (RpcTarget for nested method calls)
// ============================================================================

/**
 * NounAccessor - RpcTarget class for noun operations
 * Supports: this.Customer.create(), this.Customer.list()
 */
export class NounAccessor extends RpcTarget {
  constructor(
    private storage: ThingStorageInterface,
    private noun: string
  ) {
    super()
  }

  /**
   * Create a new thing of this noun type
   */
  async create(data: Record<string, unknown>): Promise<ThingData> {
    return this.storage.create(this.noun, data)
  }

  /**
   * List things of this noun type
   */
  async list(query?: NounQueryOptions): Promise<ThingData[]> {
    return this.storage.list(this.noun, query)
  }
}

/**
 * NounInstanceAccessor - RpcTarget class for noun instance operations
 * Supports: this.Customer('id').update(), this.Customer('id').delete()
 *
 * Also supports property access for pipelining:
 * - this.Customer('id').profile.email via getProperty()
 * - Pipeline executor can traverse properties by calling getProperty()
 */
export class NounInstanceAccessor extends RpcTarget {
  // Cached thing data for property access
  private _thingData: ThingData | null = null

  constructor(
    private storage: ThingStorageInterface,
    private noun: string,
    private id: string
  ) {
    super()
  }

  /**
   * Update this thing instance
   */
  async update(updates: Record<string, unknown>): Promise<ThingData> {
    return this.storage.updateById(this.id, updates)
  }

  /**
   * Delete this thing instance
   */
  async delete(): Promise<boolean> {
    return this.storage.deleteById(this.id)
  }

  /**
   * Notify (placeholder for cross-DO RPC)
   */
  async notify(): Promise<{ success: boolean }> {
    return { success: true }
  }

  /**
   * Get the full profile (thing data)
   */
  async getProfile(): Promise<ThingData | null> {
    return this.storage.getById(this.id)
  }

  /**
   * Get status (placeholder)
   */
  async getStatus(): Promise<{ status: string }> {
    return { status: 'active' }
  }

  /**
   * Get the full thing data for property access in pipelines
   * This enables: Customer('id').profile.email
   */
  async getData(): Promise<ThingData | null> {
    if (!this._thingData) {
      this._thingData = await this.storage.getById(this.id)
    }
    return this._thingData
  }

  /**
   * Get a specific property value from the thing
   * Used by pipeline executor for property access
   */
  async getProperty(name: string): Promise<unknown> {
    const data = await this.getData()
    if (!data) {
      throw new Error(`Thing not found: ${this.id}`)
    }
    return data[name]
  }

  // =========================================================================
  // Direct property accessors for common patterns
  // These allow pipeline executor to access thing properties directly
  // =========================================================================

  get profile(): Promise<unknown> {
    return this.getProperty('profile')
  }

  get email(): Promise<unknown> {
    return this.getProperty('email')
  }

  get name(): Promise<unknown> {
    return this.getProperty('name')
  }

  get settings(): Promise<unknown> {
    return this.getProperty('settings')
  }

  get orders(): Promise<unknown> {
    return this.getProperty('orders')
  }

  get data(): Promise<unknown> {
    return this.getProperty('data')
  }

  get value(): Promise<unknown> {
    return this.getProperty('value')
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a noun accessor or instance accessor
 *
 * @param storage The thing storage interface
 * @param noun The noun type (e.g., 'Customer', 'Order')
 * @param id Optional ID for instance access
 * @returns NounAccessor or NounInstanceAccessor
 */
export function createNounAccessor(
  storage: ThingStorageInterface,
  noun: string,
  id?: string
): NounAccessor | NounInstanceAccessor {
  return id
    ? new NounInstanceAccessor(storage, noun, id)
    : new NounAccessor(storage, noun)
}
