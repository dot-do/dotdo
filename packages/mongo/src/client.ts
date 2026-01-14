/**
 * MongoDB-compatible Client
 */

import type { Backend } from './backends/interface'
import { MemoryBackend } from './backends/memory'
import { Collection } from './collection'
import type { Document } from './types'

/** ObjectId implementation */
export class ObjectId {
  private _id: string

  constructor(id?: string) {
    if (id) {
      this._id = id
    } else {
      // Generate MongoDB-style ObjectId (24 hex chars)
      const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0')
      const random = Array.from(crypto.getRandomValues(new Uint8Array(8)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
      this._id = timestamp + random
    }
  }

  toString(): string {
    return this._id
  }

  toHexString(): string {
    return this._id
  }

  equals(other: ObjectId | string): boolean {
    const otherId = other instanceof ObjectId ? other._id : other
    return this._id === otherId
  }

  getTimestamp(): Date {
    const timestamp = parseInt(this._id.substring(0, 8), 16)
    return new Date(timestamp * 1000)
  }

  static isValid(id: string): boolean {
    return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id)
  }

  static createFromTime(time: number | Date): ObjectId {
    const timestamp = time instanceof Date ? Math.floor(time.getTime() / 1000) : time
    const hex = timestamp.toString(16).padStart(8, '0')
    return new ObjectId(hex + '0'.repeat(16))
  }
}

/** Database instance */
export class Db {
  private backend: Backend
  private name: string

  constructor(backend: Backend, name: string) {
    this.backend = backend
    this.name = name
  }

  /** Get database name */
  get databaseName(): string {
    return this.name
  }

  /** Get a collection */
  collection<T extends Document = Document>(name: string): Collection<T> {
    return new Collection<T>(this.backend, this.name, name)
  }
}

/** Client options */
export interface MongoClientOptions {
  backend?: Backend
}

/** MongoDB-compatible client */
export class MongoClient {
  private backend: Backend
  private defaultDbName: string
  private connected = false

  constructor(uri?: string, options?: MongoClientOptions) {
    // Use provided backend or default to memory
    this.backend = options?.backend ?? new MemoryBackend()
    this.defaultDbName = 'test'
  }

  /** Connect to database (no-op for memory backend) */
  async connect(): Promise<MongoClient> {
    this.connected = true
    return this
  }

  /** Close connection */
  async close(): Promise<void> {
    this.connected = false
  }

  /** Check if connected */
  isConnected(): boolean {
    return this.connected
  }

  /** Get a database */
  db(name?: string): Db {
    return new Db(this.backend, name ?? this.defaultDbName)
  }
}
