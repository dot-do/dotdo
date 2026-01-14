/**
 * Stream - Real-time data streams for workflows
 *
 * Provides real-time streaming capabilities:
 * - $.stream.create() - Create a new stream
 * - $.stream.publish() - Publish items to a stream
 * - $.stream.subscribe() - Subscribe to a stream
 *
 * @module workflows/data/stream
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Item in a stream
 */
export interface StreamItem<T = unknown> {
  /** Unique item ID */
  id: string
  /** Stream name */
  stream: string
  /** Item data */
  data: T
  /** Timestamp when item was published */
  timestamp: number
  /** Sequence number in the stream */
  sequence: number
  /** Optional partition key */
  partitionKey?: string
  /** Item metadata */
  metadata?: Record<string, unknown>
}

/**
 * Stream definition
 */
export interface Stream {
  /** Stream name */
  name: string
  /** Stream description */
  description?: string
  /** Retention policy in ms */
  retentionMs?: number
  /** Maximum items to retain */
  maxItems?: number
  /** Whether stream is partitioned */
  partitioned?: boolean
  /** Created timestamp */
  createdAt: number
}

/**
 * Stream sink for consuming items
 */
export interface StreamSink<T = unknown> {
  /** Write item to sink */
  write(item: StreamItem<T>): Promise<void>
  /** Flush any buffered items */
  flush(): Promise<void>
  /** Close the sink */
  close(): Promise<void>
}

/**
 * Stream source for producing items
 */
export interface StreamSource<T = unknown> {
  /** Read next item from source */
  read(): Promise<StreamItem<T> | null>
  /** Read items in batches */
  readBatch(count: number): Promise<StreamItem<T>[]>
  /** Seek to a position */
  seek(position: number | 'earliest' | 'latest'): Promise<void>
  /** Close the source */
  close(): Promise<void>
}

/**
 * Stream subscription handle
 */
export interface StreamSubscription {
  /** Unsubscribe from stream */
  unsubscribe(): void
  /** Current position in stream */
  position: number
  /** Whether subscription is active */
  active: boolean
}

/**
 * Stream subscriber callback
 */
export type StreamSubscriber<T = unknown> = (item: StreamItem<T>) => void | Promise<void>

/**
 * Publish options
 */
export interface PublishOptions {
  /** Partition key for ordered delivery */
  partitionKey?: string
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * Subscribe options
 */
export interface SubscribeOptions {
  /** Start position */
  position?: number | 'earliest' | 'latest'
  /** Batch size for consumption */
  batchSize?: number
  /** Maximum concurrency for processing */
  concurrency?: number
}

/**
 * Stream namespace interface
 */
export interface StreamNamespace {
  /** Create a new stream */
  create(name: string, options?: Partial<Stream>): Promise<Stream>
  /** Get a stream by name */
  get(name: string): Promise<Stream | null>
  /** List all streams */
  list(): Promise<Stream[]>
  /** Delete a stream */
  delete(name: string): Promise<boolean>
  /** Publish an item to a stream */
  publish<T>(name: string, data: T, options?: PublishOptions): Promise<StreamItem<T>>
  /** Subscribe to a stream */
  subscribe<T>(name: string, callback: StreamSubscriber<T>, options?: SubscribeOptions): StreamSubscription
  /** Create a stream source */
  source<T>(name: string, options?: SubscribeOptions): StreamSource<T>
  /** Create a stream sink */
  sink<T>(name: string): StreamSink<T>
}

/**
 * Stream context
 */
export interface StreamContext {
  /** Stream namespace */
  stream: StreamNamespace
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

let itemCounter = 0

/**
 * Generate a unique item ID
 */
function generateItemId(): string {
  itemCounter++
  return `item:${Date.now().toString(36)}-${itemCounter.toString(36)}`
}

/**
 * Create a stream context
 */
export function createStreamContext(): StreamContext {
  const streams = new Map<string, Stream>()
  const items = new Map<string, StreamItem[]>()
  const subscriptions = new Map<string, Set<{ callback: StreamSubscriber; options: SubscribeOptions }>>()

  const namespace: StreamNamespace = {
    async create(name, options = {}) {
      if (streams.has(name)) {
        throw new Error(`Stream ${name} already exists`)
      }

      const stream: Stream = {
        name,
        description: options.description,
        retentionMs: options.retentionMs,
        maxItems: options.maxItems,
        partitioned: options.partitioned ?? false,
        createdAt: Date.now(),
      }

      streams.set(name, stream)
      items.set(name, [])
      subscriptions.set(name, new Set())

      return stream
    },

    async get(name) {
      return streams.get(name) ?? null
    },

    async list() {
      return Array.from(streams.values())
    },

    async delete(name) {
      if (!streams.has(name)) {
        return false
      }

      // Notify subscribers that stream is closing
      const subs = subscriptions.get(name)
      if (subs) {
        // Just clear, don't notify
        subs.clear()
      }

      streams.delete(name)
      items.delete(name)
      subscriptions.delete(name)

      return true
    },

    async publish<T>(name: string, data: T, options: PublishOptions = {}): Promise<StreamItem<T>> {
      // Auto-create stream if it doesn't exist
      if (!streams.has(name)) {
        await this.create(name)
      }

      const streamItems = items.get(name)!
      const stream = streams.get(name)!

      const item: StreamItem<T> = {
        id: generateItemId(),
        stream: name,
        data,
        timestamp: Date.now(),
        sequence: streamItems.length,
        partitionKey: options.partitionKey,
        metadata: options.metadata,
      }

      streamItems.push(item as StreamItem)

      // Apply retention
      if (stream.maxItems && streamItems.length > stream.maxItems) {
        streamItems.splice(0, streamItems.length - stream.maxItems)
      }

      // Notify subscribers
      const subs = subscriptions.get(name)
      if (subs) {
        for (const { callback } of subs) {
          try {
            await callback(item as StreamItem)
          } catch {
            // Ignore subscriber errors
          }
        }
      }

      return item
    },

    subscribe<T>(name: string, callback: StreamSubscriber<T>, options: SubscribeOptions = {}): StreamSubscription {
      // Auto-create stream if it doesn't exist
      if (!streams.has(name)) {
        streams.set(name, {
          name,
          createdAt: Date.now(),
        })
        items.set(name, [])
        subscriptions.set(name, new Set())
      }

      const sub = { callback: callback as StreamSubscriber, options }
      subscriptions.get(name)!.add(sub)

      const subscription: StreamSubscription = {
        unsubscribe() {
          subscriptions.get(name)?.delete(sub)
          this.active = false
        },
        position: options.position === 'earliest' ? 0 : (items.get(name)?.length ?? 0),
        active: true,
      }

      // If starting from earlier position, deliver existing items
      if (options.position === 'earliest' || typeof options.position === 'number') {
        const streamItems = items.get(name) ?? []
        const startPos = options.position === 'earliest' ? 0 : (options.position ?? 0)

        for (let i = startPos; i < streamItems.length; i++) {
          callback(streamItems[i] as StreamItem<T>)
        }
      }

      return subscription
    },

    source<T>(name: string, options: SubscribeOptions = {}): StreamSource<T> {
      let position = options.position === 'earliest' ? 0 : (items.get(name)?.length ?? 0)

      return {
        async read() {
          const streamItems = items.get(name)
          if (!streamItems || position >= streamItems.length) {
            return null
          }

          const item = streamItems[position] as StreamItem<T>
          position++
          return item
        },

        async readBatch(count) {
          const streamItems = items.get(name)
          if (!streamItems) return []

          const batch = streamItems.slice(position, position + count) as StreamItem<T>[]
          position += batch.length
          return batch
        },

        async seek(pos) {
          const streamItems = items.get(name)
          if (!streamItems) {
            position = 0
            return
          }

          if (pos === 'earliest') {
            position = 0
          } else if (pos === 'latest') {
            position = streamItems.length
          } else {
            position = Math.max(0, Math.min(pos, streamItems.length))
          }
        },

        async close() {
          // No-op for in-memory implementation
        },
      }
    },

    sink<T>(name: string): StreamSink<T> {
      const buffer: StreamItem<T>[] = []

      return {
        async write(item) {
          buffer.push(item)
        },

        async flush() {
          for (const item of buffer) {
            await namespace.publish(name, item.data, {
              partitionKey: item.partitionKey,
              metadata: item.metadata,
            })
          }
          buffer.length = 0
        },

        async close() {
          await this.flush()
        },
      }
    },
  }

  return { stream: namespace }
}
