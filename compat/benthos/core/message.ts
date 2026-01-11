/**
 * BenthosMessage - Core message envelope type for Benthos compat layer
 * Issue: dotdo-kl162 (GREEN phase)
 */

const MESSAGE_SYMBOL = Symbol.for('benthos.message')
const BATCH_SYMBOL = Symbol.for('benthos.batch')

/**
 * Metadata container for Benthos messages
 */
export class MessageMetadata {
  private data: Map<string, string>

  constructor(initial?: Record<string, string> | MessageMetadata) {
    if (initial instanceof MessageMetadata) {
      this.data = new Map(initial.data)
    } else {
      this.data = new Map(initial ? Object.entries(initial) : [])
    }
  }

  get(key: string): string | undefined {
    return this.data.get(key)
  }

  set(key: string, value: string): void {
    this.data.set(key, value)
  }

  has(key: string): boolean {
    return this.data.has(key)
  }

  delete(key: string): boolean {
    return this.data.delete(key)
  }

  entries(): IterableIterator<[string, string]> {
    return this.data.entries()
  }

  keys(): IterableIterator<string> {
    return this.data.keys()
  }

  values(): IterableIterator<string> {
    return this.data.values()
  }

  toObject(): Record<string, string> {
    return Object.fromEntries(this.data)
  }

  clone(): MessageMetadata {
    return new MessageMetadata(this)
  }
}

export interface MessageOptions {
  timestamp?: number
}

/**
 * Core Benthos message type with content, metadata, and utility methods
 */
export class BenthosMessage {
  readonly [MESSAGE_SYMBOL] = true

  private _bytes: Uint8Array
  private _metadata: MessageMetadata
  private _timestamp: number
  private _error?: Error
  private _jsonCache?: unknown

  constructor(
    content: string | Uint8Array | object,
    metadata?: Record<string, string> | MessageMetadata,
    options?: MessageOptions
  ) {
    if (content instanceof Uint8Array) {
      this._bytes = content
    } else if (typeof content === 'string') {
      this._bytes = new TextEncoder().encode(content)
    } else {
      this._bytes = new TextEncoder().encode(JSON.stringify(content))
      this._jsonCache = content
    }

    this._metadata = metadata instanceof MessageMetadata
      ? metadata.clone()
      : new MessageMetadata(metadata)

    this._timestamp = options?.timestamp ?? Date.now()
  }

  get content(): string {
    return new TextDecoder().decode(this._bytes)
  }

  get bytes(): Uint8Array {
    return this._bytes
  }

  get metadata(): MessageMetadata {
    return this._metadata
  }

  get timestamp(): number {
    return this._timestamp
  }

  /**
   * Benthos-compatible root accessor for JSON content
   */
  get root(): unknown {
    return this.json()
  }

  /**
   * Setter for root - updates the internal JSON cache and content bytes
   */
  set root(value: unknown) {
    this._jsonCache = value
    // Update the underlying bytes to match
    if (typeof value === 'string') {
      this._bytes = new TextEncoder().encode(value)
    } else {
      this._bytes = new TextEncoder().encode(JSON.stringify(value))
    }
  }

  /**
   * Benthos-compatible meta() accessor
   */
  meta(key: string): string | undefined {
    return this._metadata.get(key)
  }

  /**
   * Parse content as JSON, optionally extracting a path
   */
  json(path?: string): unknown {
    if (this._jsonCache === undefined) {
      try {
        this._jsonCache = JSON.parse(this.content)
      } catch {
        // If content isn't valid JSON, return the raw string
        this._jsonCache = this.content
      }
    }

    if (!path) {
      return this._jsonCache
    }

    // Navigate path like "user.profile.name"
    const parts = path.split('.')
    let current: unknown = this._jsonCache

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined
      }
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }

  /**
   * Safe JSON parsing that returns undefined on error
   */
  jsonSafe(path?: string): unknown {
    try {
      return this.json(path)
    } catch {
      return undefined
    }
  }

  /**
   * Create new message with different content, preserving metadata
   */
  withContent(content: string | Uint8Array | object): BenthosMessage {
    const msg = new BenthosMessage(content, this._metadata, { timestamp: this._timestamp })
    if (this._error) {
      msg._error = this._error
    }
    return msg
  }

  /**
   * Create new message with additional metadata
   */
  withMetadata(additional: Record<string, string>): BenthosMessage {
    const newMeta = this._metadata.clone()
    for (const [key, value] of Object.entries(additional)) {
      newMeta.set(key, value)
    }
    const msg = new BenthosMessage(this._bytes, newMeta, { timestamp: this._timestamp })
    if (this._error) {
      msg._error = this._error
    }
    return msg
  }

  /**
   * Create a deep copy of the message
   */
  clone(): BenthosMessage {
    const msg = new BenthosMessage(
      new Uint8Array(this._bytes),
      this._metadata.clone(),
      { timestamp: this._timestamp }
    )
    if (this._error) {
      msg._error = this._error
    }
    return msg
  }

  /**
   * Check if message has an error attached
   */
  hasError(): boolean {
    return this._error !== undefined
  }

  /**
   * Get the attached error, if any
   */
  getError(): Error | undefined {
    return this._error
  }

  /**
   * Create new message with error attached
   */
  withError(error: Error): BenthosMessage {
    const msg = this.clone()
    msg._error = error
    return msg
  }

  /**
   * Create new message with error cleared
   */
  clearError(): BenthosMessage {
    const msg = this.clone()
    msg._error = undefined
    return msg
  }
}

/**
 * Message batch for processing multiple messages together
 */
export class BenthosBatch implements Iterable<BenthosMessage> {
  readonly [BATCH_SYMBOL] = true

  private _messages: BenthosMessage[]
  private _metadata: MessageMetadata

  constructor(
    messages: BenthosMessage[],
    metadata?: Record<string, string> | MessageMetadata
  ) {
    this._messages = messages
    this._metadata = metadata instanceof MessageMetadata
      ? metadata.clone()
      : new MessageMetadata(metadata)
  }

  get length(): number {
    return this._messages.length
  }

  get metadata(): MessageMetadata {
    return this._metadata
  }

  get(index: number): BenthosMessage {
    if (index < 0 || index >= this._messages.length) {
      throw new RangeError(`Index ${index} out of bounds`)
    }
    return this._messages[index]
  }

  [Symbol.iterator](): Iterator<BenthosMessage> {
    return this._messages[Symbol.iterator]()
  }

  map(fn: (msg: BenthosMessage, index: number) => BenthosMessage): BenthosBatch {
    return new BenthosBatch(
      this._messages.map(fn),
      this._metadata
    )
  }

  filter(fn: (msg: BenthosMessage, index: number) => boolean): BenthosBatch {
    return new BenthosBatch(
      this._messages.filter(fn),
      this._metadata
    )
  }

  reduce<T>(fn: (acc: T, msg: BenthosMessage, index: number) => T, initial: T): T {
    return this._messages.reduce(fn, initial)
  }

  toArray(): BenthosMessage[] {
    return [...this._messages]
  }
}

/**
 * Create a new Benthos message
 */
export function createMessage(
  content: string | Uint8Array | object,
  metadata?: Record<string, string>,
  options?: MessageOptions
): BenthosMessage {
  return new BenthosMessage(content, metadata, options)
}

/**
 * Create a batch of messages
 */
export function createBatch(
  items: (string | Uint8Array | object | BenthosMessage)[],
  metadata?: Record<string, string>
): BenthosBatch {
  const messages = items.map(item =>
    item instanceof BenthosMessage ? item : createMessage(item)
  )
  return new BenthosBatch(messages, metadata)
}

/**
 * Type guard for BenthosMessage
 */
export function isMessage(value: unknown): value is BenthosMessage {
  return value !== null &&
    typeof value === 'object' &&
    MESSAGE_SYMBOL in value
}

/**
 * Type guard for BenthosBatch
 */
export function isBatch(value: unknown): value is BenthosBatch {
  return value !== null &&
    typeof value === 'object' &&
    BATCH_SYMBOL in value
}

// Re-export types
export type { BenthosMessage as Message, BenthosBatch as Batch }
