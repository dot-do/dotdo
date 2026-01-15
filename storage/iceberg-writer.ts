/**
 * L3: IcebergWriter (Cold Storage)
 *
 * Long-term storage in R2 with Iceberg-compatible format.
 * Supports time travel queries and schema evolution.
 * Implements StorageTier interface for consistency with L0/L2.
 */

// Import canonical types from types/index.ts
import type { ThingData } from '../types'

export interface IcebergWriterConfig {
  bucket: R2Bucket
  namespace: string
  tableName: string
}

export interface IcebergPartition {
  namespace: string
  date: string
  hour?: number
}

export interface TimeTravelQuery {
  asOf?: Date
  snapshotId?: string
  entityType?: string
  entityId?: string
}

export interface IcebergEvent {
  type: string
  entityId: string
  payload: unknown
  ts: number
}

export interface IcebergSnapshot {
  snapshotId: string
  timestamp: Date
  manifestList: string
  summary: Record<string, string>
}

export interface IcebergSchema {
  version: number
  fields: Array<{
    id: number
    name: string
    type: string
    required: boolean
  }>
}

// ThingData imported from ../types

interface R2Bucket {
  put(key: string, data: ArrayBuffer | string | ReadableStream | Blob): Promise<R2Object | null>
  get(key: string): Promise<R2ObjectBody | null>
  list(options?: { prefix?: string }): Promise<{ objects: Array<{ key: string }> }>
  delete(key: string): Promise<void>
}

interface R2Object {
  key: string
  size: number
}

interface R2ObjectBody extends R2Object {
  body: ReadableStream
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
  json(): Promise<unknown>
}

/**
 * Simple Parquet-like encoder (mock implementation)
 * In production, use a proper Parquet library
 */
function encodeParquet(events: IcebergEvent[]): ArrayBuffer {
  // Simple JSON-based encoding for now
  // In production, use parquetjs or similar
  const json = JSON.stringify(events)
  const encoder = new TextEncoder()
  return encoder.encode(json).buffer
}

/**
 * Decode Parquet data back to events
 * Handles both ArrayBuffer and string inputs
 */
function decodeParquet(data: ArrayBuffer | string): IcebergEvent[] {
  if (typeof data === 'string') {
    return JSON.parse(data)
  }
  // Handle ArrayBuffer - need to create Uint8Array view
  const uint8 = new Uint8Array(data)
  const decoder = new TextDecoder()
  const json = decoder.decode(uint8)
  return JSON.parse(json)
}

/**
 * Format date for partitioning
 */
function formatDate(ts: number): string {
  const date = new Date(ts)
  return date.toISOString().split('T')[0]
}

/**
 * Generate unique file ID
 */
function generateFileId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`
}

export class IcebergWriter {
  private bucket: R2Bucket
  private namespace: string
  private tableName: string
  private snapshots: IcebergSnapshot[] = []
  private schema: IcebergSchema
  private currentSnapshotId: number = 0
  private totalBytes: number = 0
  private entryCount: number = 0

  // In-memory event cache for fast queries (indexed by entityId)
  private eventCache: Map<string, IcebergEvent[]> = new Map()

  constructor(config: IcebergWriterConfig) {
    this.bucket = config.bucket
    this.namespace = config.namespace
    this.tableName = config.tableName

    // Initialize default schema
    this.schema = {
      version: 1,
      fields: [
        { id: 1, name: 'type', type: 'string', required: true },
        { id: 2, name: 'entityId', type: 'string', required: true },
        { id: 3, name: 'payload', type: 'string', required: true },
        { id: 4, name: 'ts', type: 'long', required: true },
      ],
    }
  }

  // =========================================================================
  // StorageTier Interface Methods
  // =========================================================================

  /**
   * Get a thing by ID from L3 storage
   * Reconstructs state from events
   */
  async get(id: string): Promise<ThingData | null> {
    const events = await this.query({ entityId: id })
    if (events.length === 0) return null

    // Sort by timestamp and reconstruct state
    events.sort((a, b) => a.ts - b.ts)

    let state: ThingData | null = null
    for (const event of events) {
      if (event.type === 'thing.created') {
        state = event.payload as ThingData
      } else if (event.type === 'thing.updated' && state) {
        state = { ...state, ...(event.payload as Partial<ThingData>) }
      } else if (event.type === 'thing.deleted') {
        state = null
      }
    }

    return state
  }

  /**
   * Create a thing in L3 storage
   * Writes a thing.created event
   */
  async create(data: ThingData): Promise<ThingData> {
    await this.write([
      {
        type: 'thing.created',
        entityId: data.$id,
        payload: data,
        ts: Date.now(),
      },
    ])
    return data
  }

  /**
   * Put a thing into L3 storage (upsert)
   * Creates or updates depending on existence
   */
  async put(id: string, data: ThingData): Promise<void> {
    const existing = await this.get(id)
    if (existing) {
      await this.write([
        {
          type: 'thing.updated',
          entityId: id,
          payload: data,
          ts: Date.now(),
        },
      ])
    } else {
      await this.write([
        {
          type: 'thing.created',
          entityId: id,
          payload: { ...data, $id: id },
          ts: Date.now(),
        },
      ])
    }
  }

  /**
   * Delete a thing from L3 storage
   * Writes a thing.deleted event (soft delete for event sourcing)
   */
  async delete(id: string): Promise<boolean> {
    const existing = await this.get(id)
    if (!existing) return false

    await this.write([
      {
        type: 'thing.deleted',
        entityId: id,
        payload: {},
        ts: Date.now(),
      },
    ])
    return true
  }

  /**
   * List things with optional prefix filtering
   */
  async list(options?: { prefix?: string; limit?: number }): Promise<ThingData[]> {
    // Get all unique entity IDs from cache
    const entityIds = new Set<string>()
    for (const id of this.eventCache.keys()) {
      if (!options?.prefix || id.startsWith(options.prefix)) {
        entityIds.add(id)
      }
    }

    // Reconstruct state for each entity
    const things: ThingData[] = []
    for (const id of entityIds) {
      const thing = await this.get(id)
      if (thing) {
        things.push(thing)
        if (options?.limit && things.length >= options.limit) {
          break
        }
      }
    }

    return things
  }

  /**
   * Get statistics for this storage tier
   */
  getStats(): { entryCount: number; estimatedBytes: number } {
    return {
      entryCount: this.entryCount,
      estimatedBytes: this.totalBytes,
    }
  }

  // =========================================================================
  // Core IcebergWriter Methods
  // =========================================================================

  /**
   * Write events to R2 in Iceberg-compatible format
   */
  async write(events: IcebergEvent[]): Promise<void> {
    if (events.length === 0) return

    // Group events by date partition
    const partitioned = new Map<string, IcebergEvent[]>()
    for (const event of events) {
      const date = formatDate(event.ts)
      const existing = partitioned.get(date) ?? []
      existing.push(event)
      partitioned.set(date, existing)

      // Update event cache for queries
      const cached = this.eventCache.get(event.entityId) ?? []
      cached.push(event)
      this.eventCache.set(event.entityId, cached)

      // Update stats
      this.entryCount++
      this.totalBytes += JSON.stringify(event).length
    }

    // Write each partition
    const dataFiles: string[] = []
    for (const [date, partitionEvents] of partitioned) {
      const fileId = generateFileId()
      const key = this.buildDataPath(date, fileId)

      // Encode as Parquet (simplified)
      const data = encodeParquet(partitionEvents)
      await this.bucket.put(key, data)
      dataFiles.push(key)

      // Update schema if needed (schema evolution)
      this.evolveSchema(partitionEvents)
    }

    // Create new snapshot and write metadata
    await this.createSnapshot(dataFiles)
  }

  /**
   * List all snapshots for time travel
   */
  async listSnapshots(): Promise<IcebergSnapshot[]> {
    return [...this.snapshots]
  }

  /**
   * Query events with time travel support
   */
  async query(queryOptions: TimeTravelQuery): Promise<IcebergEvent[]> {
    const results: IcebergEvent[] = []

    // If querying by entityId, check cache first
    if (queryOptions.entityId) {
      const cached = this.eventCache.get(queryOptions.entityId)
      if (cached && cached.length > 0) {
        // Filter by time if asOf is specified
        if (queryOptions.asOf) {
          const cutoff = queryOptions.asOf.getTime()
          return cached.filter((e) => e.ts <= cutoff)
        }
        return [...cached]
      }
    }

    // If not in cache, scan R2 for data files
    try {
      const prefix = `${this.tableName}/ns=${this.namespace}/`
      const listResult = await this.bucket.list({ prefix })

      for (const obj of listResult.objects) {
        // Only process parquet data files
        if (!obj.key.endsWith('.parquet')) continue

        // If asOf query, check date partition
        if (queryOptions.asOf) {
          const dateMatch = obj.key.match(/date=(\d{4}-\d{2}-\d{2})/)
          if (dateMatch) {
            const fileDate = new Date(dateMatch[1])
            if (fileDate.getTime() > queryOptions.asOf.getTime()) {
              continue // Skip files after the asOf date
            }
          }
        }

        // Read and decode the file
        const r2Object = await this.bucket.get(obj.key)
        if (r2Object) {
          // Try text() first since mock often returns strings, then arrayBuffer()
          let data: ArrayBuffer | string
          try {
            data = await r2Object.text()
          } catch {
            data = await r2Object.arrayBuffer()
          }
          const events = decodeParquet(data)

          for (const event of events) {
            // Filter by entityId if specified
            if (queryOptions.entityId && event.entityId !== queryOptions.entityId) {
              continue
            }

            // Filter by timestamp if asOf is specified
            if (queryOptions.asOf && event.ts > queryOptions.asOf.getTime()) {
              continue
            }

            results.push(event)

            // Update cache
            const cached = this.eventCache.get(event.entityId) ?? []
            if (!cached.some((e) => e.ts === event.ts && e.type === event.type)) {
              cached.push(event)
              this.eventCache.set(event.entityId, cached)
            }
          }
        }
      }
    } catch (error) {
      // Log but don't throw - return what we have
      console.error('[IcebergWriter] Error querying R2:', error)
    }

    // Sort results by timestamp
    results.sort((a, b) => a.ts - b.ts)

    return results
  }

  /**
   * Get current schema
   */
  async getSchema(): Promise<IcebergSchema> {
    return { ...this.schema }
  }

  /**
   * Close the writer and persist final metadata
   */
  async close(): Promise<void> {
    // Write final snapshot list to R2
    if (this.snapshots.length > 0) {
      const snapshotListPath = `${this.tableName}/metadata/version-hint.text`
      await this.bucket.put(snapshotListPath, String(this.currentSnapshotId))
    }
  }

  /**
   * Build data file path with partitioning
   */
  private buildDataPath(date: string, fileId: string): string {
    return `${this.tableName}/ns=${this.namespace}/date=${date}/data-${fileId}.parquet`
  }

  /**
   * Evolve schema based on new events
   */
  private evolveSchema(events: IcebergEvent[]): void {
    // Check for new fields in payload
    const existingFields = new Set(this.schema.fields.map((f) => f.name))
    let nextFieldId = Math.max(...this.schema.fields.map((f) => f.id)) + 1

    for (const event of events) {
      if (typeof event.payload === 'object' && event.payload !== null) {
        for (const key of Object.keys(event.payload as Record<string, unknown>)) {
          const fieldName = `payload.${key}`
          if (!existingFields.has(fieldName)) {
            // Add new field (schema evolution)
            this.schema.fields.push({
              id: nextFieldId++,
              name: fieldName,
              type: 'string', // Default to string for simplicity
              required: false,
            })
            existingFields.add(fieldName)
            this.schema.version++
          }
        }
      }
    }
  }

  /**
   * Create a new snapshot after writes and persist metadata
   */
  private async createSnapshot(dataFiles: string[]): Promise<void> {
    this.currentSnapshotId++
    const snapshotId = `snap-${this.currentSnapshotId}`

    // Create manifest file listing the data files
    const manifest = {
      snapshotId,
      timestamp: new Date().toISOString(),
      dataFiles,
      schema: this.schema,
    }

    const manifestPath = `${this.tableName}/metadata/${snapshotId}-manifest.json`
    await this.bucket.put(manifestPath, JSON.stringify(manifest))

    // Create snapshot metadata
    const snapshot: IcebergSnapshot = {
      snapshotId,
      timestamp: new Date(),
      manifestList: manifestPath,
      summary: {
        operation: 'append',
        'added-data-files': String(dataFiles.length),
      },
    }
    this.snapshots.push(snapshot)

    // Write snapshot list
    const snapshotListPath = `${this.tableName}/metadata/snapshots.json`
    await this.bucket.put(snapshotListPath, JSON.stringify(this.snapshots))
  }
}
