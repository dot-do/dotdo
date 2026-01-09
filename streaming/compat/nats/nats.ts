/**
 * @dotdo/nats - NATS SDK compat
 *
 * Drop-in replacement for nats.js backed by DO SQLite with in-memory storage.
 * This implementation matches the nats.js API.
 * Production version routes to Cloudflare Pub/Sub based on config.
 *
 * @see https://github.com/nats-io/nats.js
 */
import type {
  ConnectionOptions,
  NatsConnection,
  Msg,
  MsgHdrs,
  Subscription,
  SubscriptionOptions,
  PublishOptions,
  RequestOptions,
  ServerInfo,
  Stats,
  Status,
  JetStreamClient,
  JetStreamManager,
  JetStreamOptions,
  JetStreamPublishOptions,
  PubAck,
  StreamConfig,
  StreamInfo,
  StreamState,
  StreamAPI,
  ConsumerAPI,
  ConsumerConfig,
  ConsumerInfo,
  Consumer,
  Consumers,
  ConsumerMessages,
  JsMsg,
  JsMsgInfo,
  FetchOptions,
  ConsumeOptions,
  Views,
  KV,
  KvEntry,
  KvOptions,
  KvStatus,
  KvOperation,
  Lister,
  PurgeOpts,
  PurgeResponse,
  MsgRequest,
  StoredMsg,
  AccountInfo,
} from './types'
import {
  NatsError,
  ErrorCode,
  AckPolicy,
  DeliverPolicy,
  RetentionPolicy,
  StorageType,
  DiscardPolicy,
} from './types'

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

/**
 * Subject data structure
 */
interface SubjectData {
  messages: StoredMessage[]
  subscriptions: Set<SubscriptionImpl>
}

/**
 * Stored message
 */
interface StoredMessage {
  subject: string
  data: Uint8Array
  headers?: MsgHdrsImpl
  reply?: string
  timestamp: number
  seq: number
}

/**
 * Stream data structure
 */
interface StreamData {
  config: StreamConfig
  messages: StoredMessage[]
  seq: number
  created: string
  messageIds: Set<string> // For deduplication
}

/**
 * Pending message info for tracking redelivery
 */
interface PendingMessage {
  seq: number
  deliverCount: number
  ackDeadline: number // Timestamp when ack deadline expires
  redeliverAfter?: number // Timestamp when message can be redelivered (for NAK with delay)
}

/**
 * Consumer data structure
 */
interface ConsumerData {
  config: ConsumerConfig
  stream: string
  name: string
  delivered: { consumer_seq: number; stream_seq: number }
  ack_floor: { consumer_seq: number; stream_seq: number }
  pending: Map<number, PendingMessage>
  /** Messages waiting for redelivery after NAK */
  redeliveryQueue: Array<{ seq: number; deliverCount: number; availableAt: number }>
  created: string
}

/**
 * KV bucket data structure
 */
interface KvBucketData {
  name: string
  entries: Map<string, KvEntryData[]>
  seq: number
  config: KvOptions
}

/**
 * KV entry data
 */
interface KvEntryData {
  key: string
  value: Uint8Array
  revision: number
  created: Date
  operation: KvOperation
}

// Global storage
const globalSubjects = new Map<string, SubjectData>()
const globalStreams = new Map<string, StreamData>()
const globalConsumers = new Map<string, Map<string, ConsumerData>>() // stream -> consumer name -> data
const globalKvBuckets = new Map<string, KvBucketData>()
let globalSeq = 0
let globalInboxCounter = 0

// Global subscription registry for cross-connection messaging
const globalSubscriptions = new Set<SubscriptionImpl>()
// Queue group round-robin counters
const queueGroupCounters = new Map<string, number>()

/**
 * Get or create subject
 */
function getOrCreateSubject(subject: string): SubjectData {
  let data = globalSubjects.get(subject)
  if (!data) {
    data = { messages: [], subscriptions: new Set() }
    globalSubjects.set(subject, data)
  }
  return data
}

/**
 * Match subject pattern with wildcards
 */
function matchSubject(pattern: string, subject: string): boolean {
  const patternParts = pattern.split('.')
  const subjectParts = subject.split('.')

  let pi = 0
  let si = 0

  while (pi < patternParts.length && si < subjectParts.length) {
    const p = patternParts[pi]

    if (p === '>') {
      // > matches one or more tokens at the end
      // At this point, si must have at least one token remaining
      return true
    } else if (p === '*') {
      // * matches exactly one token
      pi++
      si++
    } else if (p === subjectParts[si]) {
      pi++
      si++
    } else {
      return false
    }
  }

  // Check if we've consumed all parts
  if (pi < patternParts.length) {
    // If remaining pattern is just > and there are no more subject tokens,
    // then > requires at least one token - no match
    if (patternParts[pi] === '>' && pi === patternParts.length - 1) {
      // > at end requires at least one more subject token, but we have none
      return false
    }
    return false
  }

  return si === subjectParts.length
}

/**
 * Match KV key pattern against a key
 * KV keys use . as separator and * as single-segment wildcard
 */
function matchKvKeyPattern(pattern: string, key: string): boolean {
  const patternParts = pattern.split('.')
  const keyParts = key.split('.')

  if (patternParts.length !== keyParts.length) {
    return false
  }

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i] === '*') {
      // * matches any single segment
      continue
    }
    if (patternParts[i] !== keyParts[i]) {
      return false
    }
  }

  return true
}

/**
 * Validate subject
 */
function validateSubject(subject: string): void {
  if (!subject || subject.includes('..') || subject.startsWith('.') || subject.endsWith('.')) {
    throw new NatsError('Invalid subject', ErrorCode.BadSubject)
  }
}

// ============================================================================
// MESSAGE HEADERS IMPLEMENTATION
// ============================================================================

export class MsgHdrsImpl implements MsgHdrs {
  private _headers = new Map<string, { originalKey: string; values: string[] }>()

  get(key: string): string | undefined {
    const entry = this._headers.get(key.toLowerCase())
    return entry?.values[0]
  }

  set(key: string, value: string): void {
    this._headers.set(key.toLowerCase(), { originalKey: key, values: [value] })
  }

  append(key: string, value: string): void {
    const lkey = key.toLowerCase()
    const entry = this._headers.get(lkey)
    if (entry) {
      entry.values.push(value)
    } else {
      this._headers.set(lkey, { originalKey: key, values: [value] })
    }
  }

  has(key: string): boolean {
    return this._headers.has(key.toLowerCase())
  }

  delete(key: string): void {
    this._headers.delete(key.toLowerCase())
  }

  values(key: string): string[] {
    const entry = this._headers.get(key.toLowerCase())
    return entry?.values || []
  }

  *keys(): IterableIterator<string> {
    for (const entry of this._headers.values()) {
      yield entry.originalKey
    }
  }

  clone(): MsgHdrsImpl {
    const h = new MsgHdrsImpl()
    for (const [key, entry] of this._headers) {
      h._headers.set(key, { originalKey: entry.originalKey, values: [...entry.values] })
    }
    return h
  }
}

// ============================================================================
// CODECS
// ============================================================================

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/**
 * String codec implementation
 */
export function StringCodec(): { encode: (s: string) => Uint8Array; decode: (d: Uint8Array) => string } {
  return {
    encode: (s: string) => textEncoder.encode(s),
    decode: (d: Uint8Array) => textDecoder.decode(d),
  }
}

/**
 * JSON codec implementation
 */
export function JSONCodec<T>(): { encode: (o: T) => Uint8Array; decode: (d: Uint8Array) => T } {
  return {
    encode: (o: T) => textEncoder.encode(JSON.stringify(o)),
    decode: (d: Uint8Array) => JSON.parse(textDecoder.decode(d)) as T,
  }
}

/**
 * Empty payload
 */
export const Empty = new Uint8Array(0)

/**
 * Create message headers
 */
export function headers(): MsgHdrs {
  return new MsgHdrsImpl()
}

// ============================================================================
// SUBSCRIPTION IMPLEMENTATION
// ============================================================================

class SubscriptionImpl implements Subscription {
  private _subject: string
  private _queue?: string
  private _max?: number
  private _received = 0
  private _processed = 0
  private _pending: Msg[] = []
  private _closed = false
  private _id: number
  private _resolvers: Array<(value: IteratorResult<Msg>) => void> = []
  private _connection: NatsConnectionImpl

  constructor(connection: NatsConnectionImpl, subject: string, opts?: SubscriptionOptions) {
    this._connection = connection
    this._subject = subject
    this._queue = opts?.queue
    this._max = opts?.max
    this._id = ++globalSeq
  }

  unsubscribe(_max?: number): void {
    this._closed = true
    globalSubscriptions.delete(this)
    // Resolve any pending iterators
    for (const resolve of this._resolvers) {
      resolve({ value: undefined, done: true })
    }
    this._resolvers = []
  }

  async drain(): Promise<void> {
    // Process remaining messages then close
    this._closed = true
    globalSubscriptions.delete(this)
  }

  isClosed(): boolean {
    return this._closed
  }

  getSubject(): string {
    return this._subject
  }

  getReceived(): number {
    return this._received
  }

  getPending(): number {
    return this._pending.length
  }

  getProcessed(): number {
    return this._processed
  }

  getMax(): number | undefined {
    return this._max
  }

  getID(): number {
    return this._id
  }

  getQueue(): string | undefined {
    return this._queue
  }

  _deliver(msg: Msg): void {
    if (this._closed) return

    this._received++
    this._pending.push(msg)

    // Check max
    if (this._max !== undefined && this._received >= this._max) {
      this._closed = true
    }

    // Resolve waiting iterator if any
    if (this._resolvers.length > 0) {
      const resolve = this._resolvers.shift()!
      const pendingMsg = this._pending.shift()
      if (pendingMsg) {
        this._processed++
        resolve({ value: pendingMsg, done: false })
      }
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Msg> {
    while (!this._closed || this._pending.length > 0) {
      if (this._pending.length > 0) {
        const msg = this._pending.shift()!
        this._processed++
        yield msg
      } else if (!this._closed) {
        // Wait for next message
        const msg = await new Promise<IteratorResult<Msg>>((resolve) => {
          this._resolvers.push(resolve)
        })
        if (msg.done) break
        yield msg.value
      } else {
        break
      }
    }
  }
}

// ============================================================================
// MESSAGE IMPLEMENTATION
// ============================================================================

class MsgImpl implements Msg {
  subject: string
  reply?: string
  data: Uint8Array
  headers?: MsgHdrs
  sid: number
  private _connection: NatsConnectionImpl

  constructor(
    connection: NatsConnectionImpl,
    subject: string,
    data: Uint8Array,
    reply?: string,
    headers?: MsgHdrs
  ) {
    this._connection = connection
    this.subject = subject
    this.data = data
    this.reply = reply
    this.headers = headers
    this.sid = ++globalSeq
  }

  respond(data?: Uint8Array, opts?: PublishOptions): boolean {
    if (!this.reply) return false
    this._connection.publish(this.reply, data, opts)
    return true
  }
}

// ============================================================================
// JETSTREAM MESSAGE IMPLEMENTATION
// ============================================================================

class JsMsgImpl implements JsMsg {
  subject: string
  data: Uint8Array
  headers?: MsgHdrs
  info: JsMsgInfo
  private _acked = false
  private _consumer: ConsumerImpl

  constructor(
    consumer: ConsumerImpl,
    subject: string,
    data: Uint8Array,
    info: JsMsgInfo,
    headers?: MsgHdrs
  ) {
    this._consumer = consumer
    this.subject = subject
    this.data = data
    this.info = info
    this.headers = headers
  }

  ack(): void {
    if (this._acked) return
    this._acked = true
    this._consumer._ack(this.info.streamSequence)
  }

  nak(delay?: number): void {
    if (this._acked) return
    this._acked = true
    this._consumer._nak(this.info.streamSequence, this.info.deliveryCount, delay)
  }

  async working(): Promise<void> {
    // Extend ack deadline
    this._consumer._working(this.info.streamSequence)
  }

  term(): void {
    if (this._acked) return
    this._acked = true
    this._consumer._term(this.info.streamSequence)
  }

  isJetStream(): boolean {
    return true
  }
}

// ============================================================================
// CONSUMER MESSAGES IMPLEMENTATION
// ============================================================================

class ConsumerMessagesImpl implements ConsumerMessages {
  private _consumer: ConsumerImpl
  private _stopped = false
  private _messages: JsMsg[] = []
  private _resolvers: Array<(value: IteratorResult<JsMsg>) => void> = []

  constructor(consumer: ConsumerImpl) {
    this._consumer = consumer
  }

  stop(): void {
    this._stopped = true
    for (const resolve of this._resolvers) {
      resolve({ value: undefined, done: true })
    }
    this._resolvers = []
  }

  async getConsumerInfo(): Promise<ConsumerInfo> {
    return this._consumer.info()
  }

  _addMessage(msg: JsMsg): void {
    if (this._stopped) return

    if (this._resolvers.length > 0) {
      const resolve = this._resolvers.shift()!
      resolve({ value: msg, done: false })
    } else {
      this._messages.push(msg)
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<JsMsg> {
    while (!this._stopped || this._messages.length > 0) {
      if (this._messages.length > 0) {
        yield this._messages.shift()!
      } else if (!this._stopped) {
        const result = await new Promise<IteratorResult<JsMsg>>((resolve) => {
          this._resolvers.push(resolve)
        })
        if (result.done) break
        yield result.value
      } else {
        break
      }
    }
  }
}

// ============================================================================
// CONSUMER IMPLEMENTATION
// ============================================================================

class ConsumerImpl implements Consumer {
  private _stream: string
  private _name: string
  private _js: JetStreamClientImpl

  constructor(js: JetStreamClientImpl, stream: string, name: string) {
    this._js = js
    this._stream = stream
    this._name = name
  }

  async info(): Promise<ConsumerInfo> {
    const consumers = globalConsumers.get(this._stream)
    if (!consumers) {
      throw new NatsError(`Stream ${this._stream} not found`, ErrorCode.JetStream404NoMessages)
    }
    const consumer = consumers.get(this._name)
    if (!consumer) {
      throw new NatsError(`Consumer ${this._name} not found`, ErrorCode.JetStream404NoMessages)
    }

    return buildConsumerInfo(this._stream, this._name, consumer)
  }

  async fetch(opts?: FetchOptions): Promise<ConsumerMessages> {
    const maxMessages = opts?.max_messages ?? 1

    const stream = globalStreams.get(this._stream)
    if (!stream) {
      throw new NatsError(`Stream ${this._stream} not found`, ErrorCode.JetStream404NoMessages)
    }

    const consumers = globalConsumers.get(this._stream)
    if (!consumers) {
      throw new NatsError(`Consumer not found`, ErrorCode.JetStream404NoMessages)
    }
    const consumer = consumers.get(this._name)
    if (!consumer) {
      throw new NatsError(`Consumer ${this._name} not found`, ErrorCode.JetStream404NoMessages)
    }

    const messages = new ConsumerMessagesImpl(this)
    const now = Date.now()
    const ackWaitMs = consumer.config.ack_wait ? consumer.config.ack_wait / 1000000 : 30000 // Default 30s
    const maxDeliver = consumer.config.max_deliver ?? -1

    let count = 0

    // First, check redelivery queue for messages ready for redelivery
    const readyForRedelivery: typeof consumer.redeliveryQueue = []
    const stillWaiting: typeof consumer.redeliveryQueue = []

    for (const redeliveryItem of consumer.redeliveryQueue) {
      if (redeliveryItem.availableAt <= now) {
        // Check max_deliver limit
        if (maxDeliver > 0 && redeliveryItem.deliverCount >= maxDeliver) {
          // Max delivery attempts reached, drop the message
          continue
        }
        readyForRedelivery.push(redeliveryItem)
      } else {
        stillWaiting.push(redeliveryItem)
      }
    }
    consumer.redeliveryQueue = stillWaiting

    // Deliver redelivery messages first
    for (const redeliveryItem of readyForRedelivery) {
      if (count >= maxMessages) {
        // Put back remaining for next fetch
        stillWaiting.push(redeliveryItem)
        continue
      }

      const msg = stream.messages.find(m => m.seq === redeliveryItem.seq)
      if (!msg) continue

      const filterSubject = consumer.config.filter_subject
      if (filterSubject && !matchSubject(filterSubject, msg.subject)) {
        continue
      }

      const newDeliverCount = redeliveryItem.deliverCount + 1
      consumer.delivered.consumer_seq++
      consumer.pending.set(msg.seq, {
        seq: msg.seq,
        deliverCount: newDeliverCount,
        ackDeadline: now + ackWaitMs,
      })

      const jsMsg = new JsMsgImpl(
        this,
        msg.subject,
        msg.data,
        {
          stream: this._stream,
          consumer: this._name,
          deliveryCount: newDeliverCount,
          streamSequence: msg.seq,
          consumerSequence: consumer.delivered.consumer_seq,
          timestampNanos: msg.timestamp * 1000000,
          pending: stream.messages.length - msg.seq,
        },
        msg.headers
      )

      messages._addMessage(jsMsg)
      count++
    }
    consumer.redeliveryQueue = stillWaiting

    // Then get new messages from stream
    const startSeq = consumer.delivered.stream_seq
    const filterSubject = consumer.config.filter_subject

    for (const msg of stream.messages) {
      if (count >= maxMessages) break
      if (msg.seq <= startSeq) continue

      // Check filter subject
      if (filterSubject && !matchSubject(filterSubject, msg.subject)) {
        continue
      }

      consumer.delivered.consumer_seq++
      consumer.delivered.stream_seq = msg.seq
      consumer.pending.set(msg.seq, {
        seq: msg.seq,
        deliverCount: 1,
        ackDeadline: now + ackWaitMs,
      })

      const jsMsg = new JsMsgImpl(
        this,
        msg.subject,
        msg.data,
        {
          stream: this._stream,
          consumer: this._name,
          deliveryCount: 1,
          streamSequence: msg.seq,
          consumerSequence: consumer.delivered.consumer_seq,
          timestampNanos: msg.timestamp * 1000000,
          pending: stream.messages.length - msg.seq,
        },
        msg.headers
      )

      messages._addMessage(jsMsg)
      count++
    }

    // Complete the iterator after fetching
    setTimeout(() => messages.stop(), 0)

    return messages
  }

  async consume(_opts?: ConsumeOptions): Promise<ConsumerMessages> {
    return this.fetch({ max_messages: 100 })
  }

  async delete(): Promise<boolean> {
    const consumers = globalConsumers.get(this._stream)
    if (consumers) {
      consumers.delete(this._name)
    }
    return true
  }

  _ack(streamSeq: number): void {
    const consumers = globalConsumers.get(this._stream)
    if (!consumers) return
    const consumer = consumers.get(this._name)
    if (!consumer) return

    consumer.pending.delete(streamSeq)
    if (streamSeq > consumer.ack_floor.stream_seq) {
      consumer.ack_floor.stream_seq = streamSeq
      consumer.ack_floor.consumer_seq++
    }
  }

  _nak(streamSeq: number, deliveryCount: number, delay?: number): void {
    const consumers = globalConsumers.get(this._stream)
    if (!consumers) return
    const consumer = consumers.get(this._name)
    if (!consumer) return

    // Remove from pending
    consumer.pending.delete(streamSeq)

    // Check max_deliver limit before queueing for redelivery
    const maxDeliver = consumer.config.max_deliver ?? -1
    if (maxDeliver > 0 && deliveryCount >= maxDeliver) {
      // Max delivery attempts reached, don't redeliver
      return
    }

    // Add to redelivery queue with optional delay
    const availableAt = delay ? Date.now() + delay : Date.now()
    consumer.redeliveryQueue.push({
      seq: streamSeq,
      deliverCount: deliveryCount,
      availableAt,
    })
  }

  _working(streamSeq: number): void {
    const consumers = globalConsumers.get(this._stream)
    if (!consumers) return
    const consumer = consumers.get(this._name)
    if (!consumer) return

    // Extend the ack deadline
    const pending = consumer.pending.get(streamSeq)
    if (pending) {
      const ackWaitMs = consumer.config.ack_wait ? consumer.config.ack_wait / 1000000 : 30000
      pending.ackDeadline = Date.now() + ackWaitMs
    }
  }

  _term(streamSeq: number): void {
    const consumers = globalConsumers.get(this._stream)
    if (!consumers) return
    const consumer = consumers.get(this._name)
    if (!consumer) return

    consumer.pending.delete(streamSeq)
  }
}

// ============================================================================
// CONSUMERS ACCESSOR IMPLEMENTATION
// ============================================================================

class ConsumersImpl implements Consumers {
  private _js: JetStreamClientImpl

  constructor(js: JetStreamClientImpl) {
    this._js = js
  }

  async get(stream: string, consumer: string): Promise<Consumer> {
    const consumers = globalConsumers.get(stream)
    if (!consumers || !consumers.has(consumer)) {
      throw new NatsError(`Consumer ${consumer} not found`, ErrorCode.JetStream404NoMessages)
    }
    return new ConsumerImpl(this._js, stream, consumer)
  }
}

// ============================================================================
// KV IMPLEMENTATION
// ============================================================================

class KVImpl implements KV {
  private _name: string
  private _js: JetStreamClientImpl
  private _watchers: Set<(entry: KvEntry) => void> = new Set()

  constructor(js: JetStreamClientImpl, name: string) {
    this._js = js
    this._name = name
  }

  private _getBucket(): KvBucketData {
    let bucket = globalKvBuckets.get(this._name)
    if (!bucket) {
      bucket = {
        name: this._name,
        entries: new Map(),
        seq: 0,
        config: {},
      }
      globalKvBuckets.set(this._name, bucket)
    }
    return bucket
  }

  async put(key: string, value: Uint8Array): Promise<number> {
    const bucket = this._getBucket()
    bucket.seq++

    const entry: KvEntryData = {
      key,
      value,
      revision: bucket.seq,
      created: new Date(),
      operation: 'PUT',
    }

    let history = bucket.entries.get(key)
    if (!history) {
      history = []
      bucket.entries.set(key, history)
    }
    history.push(entry)

    // Notify watchers
    const kvEntry: KvEntry = {
      bucket: this._name,
      key,
      value,
      revision: entry.revision,
      created: entry.created,
      operation: 'PUT',
    }
    for (const watcher of this._watchers) {
      watcher(kvEntry)
    }

    return bucket.seq
  }

  async get(key: string, _revision?: number): Promise<KvEntry | null> {
    const bucket = this._getBucket()
    const history = bucket.entries.get(key)

    if (!history || history.length === 0) {
      return null
    }

    const entry = history[history.length - 1]

    // If deleted or purged, return null
    if (entry.operation !== 'PUT') {
      return null
    }

    return {
      bucket: this._name,
      key: entry.key,
      value: entry.value,
      revision: entry.revision,
      created: entry.created,
      operation: entry.operation,
    }
  }

  async create(key: string, value: Uint8Array): Promise<number> {
    const existing = await this.get(key)
    if (existing) {
      return 0 // Key already exists
    }
    return this.put(key, value)
  }

  async update(key: string, value: Uint8Array, revision: number): Promise<number> {
    const existing = await this.get(key)
    if (!existing || existing.revision !== revision) {
      throw new NatsError('Revision mismatch', ErrorCode.JetStream409)
    }
    return this.put(key, value)
  }

  async delete(key: string, _opts?: { revision?: number }): Promise<void> {
    const bucket = this._getBucket()
    bucket.seq++

    const entry: KvEntryData = {
      key,
      value: new Uint8Array(0),
      revision: bucket.seq,
      created: new Date(),
      operation: 'DEL',
    }

    let history = bucket.entries.get(key)
    if (!history) {
      history = []
      bucket.entries.set(key, history)
    }
    history.push(entry)
  }

  async purge(key: string): Promise<void> {
    const bucket = this._getBucket()
    bucket.entries.delete(key)
  }

  async destroy(): Promise<boolean> {
    globalKvBuckets.delete(this._name)
    return true
  }

  async keys(filter?: string): Promise<AsyncIterable<string>> {
    const bucket = this._getBucket()
    const keyList: string[] = []

    for (const [key, history] of bucket.entries) {
      if (history.length > 0 && history[history.length - 1].operation === 'PUT') {
        // If filter provided, check if key matches (using NATS subject matching on key)
        if (filter) {
          if (matchKvKeyPattern(filter, key)) {
            keyList.push(key)
          }
        } else {
          keyList.push(key)
        }
      }
    }

    return {
      async *[Symbol.asyncIterator]() {
        for (const key of keyList) {
          yield key
        }
      },
    }
  }

  async watch(opts?: { key?: string }): Promise<AsyncIterable<KvEntry>> {
    const entries: KvEntry[] = []
    const resolvers: Array<(value: IteratorResult<KvEntry>) => void> = []
    let stopped = false
    const keyPattern = opts?.key

    const watcher = (entry: KvEntry) => {
      if (stopped) return

      // Filter by key pattern if provided
      if (keyPattern && !matchKvKeyPattern(keyPattern, entry.key)) {
        return
      }

      if (resolvers.length > 0) {
        const resolve = resolvers.shift()!
        resolve({ value: entry, done: false })
      } else {
        entries.push(entry)
      }
    }

    this._watchers.add(watcher)

    return {
      async *[Symbol.asyncIterator]() {
        try {
          while (!stopped) {
            if (entries.length > 0) {
              yield entries.shift()!
            } else {
              const result = await new Promise<IteratorResult<KvEntry>>((resolve) => {
                resolvers.push(resolve)
              })
              if (result.done) break
              yield result.value
            }
          }
        } finally {
          stopped = true
        }
      },
    }
  }

  async history(key: string, _opts?: { include_history?: boolean }): Promise<AsyncIterable<KvEntry>> {
    const bucket = this._getBucket()
    const history = bucket.entries.get(key) || []

    return {
      async *[Symbol.asyncIterator]() {
        for (const entry of history) {
          yield {
            bucket: bucket.name,
            key: entry.key,
            value: entry.value,
            revision: entry.revision,
            created: entry.created,
            operation: entry.operation,
          }
        }
      },
    }
  }

  async status(): Promise<KvStatus> {
    const bucket = this._getBucket()
    let values = 0

    for (const [, history] of bucket.entries) {
      if (history.length > 0 && history[history.length - 1].operation === 'PUT') {
        values++
      }
    }

    return {
      bucket: this._name,
      values,
      history: bucket.config.history ?? 1,
      ttl: bucket.config.ttl ?? 0,
      bucket_location: 'memory',
      backingStore: 'JetStream',
      streamInfo: {
        config: {
          name: `KV_${this._name}`,
          subjects: [`$KV.${this._name}.>`],
        },
        state: {
          messages: 0,
          bytes: 0,
          first_seq: 1,
          first_ts: new Date().toISOString(),
          last_seq: bucket.seq,
          last_ts: new Date().toISOString(),
          consumer_count: 0,
        },
        created: new Date().toISOString(),
      },
    }
  }
}

// ============================================================================
// VIEWS ACCESSOR IMPLEMENTATION
// ============================================================================

class ViewsImpl implements Views {
  private _js: JetStreamClientImpl

  constructor(js: JetStreamClientImpl) {
    this._js = js
  }

  async kv(bucket: string, opts?: KvOptions): Promise<KV> {
    if (opts?.bindOnly) {
      if (!globalKvBuckets.has(bucket)) {
        throw new NatsError(`KV bucket ${bucket} not found`, ErrorCode.JetStream404NoMessages)
      }
    }

    // Create bucket if it doesn't exist
    if (!globalKvBuckets.has(bucket)) {
      globalKvBuckets.set(bucket, {
        name: bucket,
        entries: new Map(),
        seq: 0,
        config: opts || {},
      })
    }

    return new KVImpl(this._js, bucket)
  }
}

// ============================================================================
// JETSTREAM CLIENT IMPLEMENTATION
// ============================================================================

class JetStreamClientImpl implements JetStreamClient {
  private _nc: NatsConnectionImpl
  consumers: Consumers
  views: Views

  constructor(nc: NatsConnectionImpl) {
    this._nc = nc
    this.consumers = new ConsumersImpl(this)
    this.views = new ViewsImpl(this)
  }

  async publish(subject: string, data?: Uint8Array, opts?: JetStreamPublishOptions): Promise<PubAck> {
    // Find stream for subject
    let targetStream: StreamData | undefined
    for (const [name, stream] of globalStreams) {
      for (const streamSubject of stream.config.subjects || []) {
        if (matchSubject(streamSubject, subject)) {
          targetStream = stream
          break
        }
      }
      if (targetStream) break
    }

    if (!targetStream) {
      throw new NatsError(`No stream found for subject ${subject}`, ErrorCode.JetStream404NoMessages)
    }

    // Check expectations
    if (opts?.expect) {
      if (opts.expect.lastSequence !== undefined && opts.expect.lastSequence !== targetStream.seq) {
        throw new NatsError(`Expected last sequence ${opts.expect.lastSequence} but stream has ${targetStream.seq}`, ErrorCode.JetStream409)
      }
      if (opts.expect.lastMsgID !== undefined) {
        // Find the last message's ID
        const lastMsgId = targetStream.messages.length > 0 ?
          Array.from(targetStream.messageIds).pop() : undefined
        if (lastMsgId !== opts.expect.lastMsgID) {
          throw new NatsError(`Expected last message ID ${opts.expect.lastMsgID}`, ErrorCode.JetStream409)
        }
      }
    }

    // Check for duplicate
    if (opts?.msgID && targetStream.messageIds.has(opts.msgID)) {
      return {
        stream: targetStream.config.name,
        seq: 0,
        duplicate: true,
      }
    }

    targetStream.seq++
    const msg: StoredMessage = {
      subject,
      data: data || Empty,
      timestamp: Date.now(),
      seq: targetStream.seq,
      headers: opts?.headers as MsgHdrsImpl,
    }

    targetStream.messages.push(msg)

    if (opts?.msgID) {
      targetStream.messageIds.add(opts.msgID)
    }

    // Enforce stream limits
    const config = targetStream.config

    // Enforce max_msgs
    if (config.max_msgs && config.max_msgs > 0) {
      while (targetStream.messages.length > config.max_msgs) {
        targetStream.messages.shift()
      }
    }

    // Enforce max_bytes
    if (config.max_bytes && config.max_bytes > 0) {
      let totalBytes = targetStream.messages.reduce((sum, m) => sum + m.data.length, 0)
      while (totalBytes > config.max_bytes && targetStream.messages.length > 0) {
        const removed = targetStream.messages.shift()
        if (removed) {
          totalBytes -= removed.data.length
        }
      }
    }

    return {
      stream: targetStream.config.name,
      seq: targetStream.seq,
      duplicate: false,
    }
  }
}

// ============================================================================
// STREAM API IMPLEMENTATION
// ============================================================================

class StreamAPIImpl implements StreamAPI {
  async add(config: Partial<StreamConfig>): Promise<StreamInfo> {
    if (!config.name) {
      throw new NatsError('Stream name is required', ErrorCode.BadSubject)
    }

    const streamConfig: StreamConfig = {
      name: config.name,
      subjects: config.subjects || [],
      retention: config.retention || RetentionPolicy.Limits,
      storage: config.storage || StorageType.Memory,
      max_consumers: config.max_consumers ?? -1,
      max_msgs: config.max_msgs ?? -1,
      max_bytes: config.max_bytes ?? -1,
      max_age: config.max_age ?? 0,
      max_msg_size: config.max_msg_size ?? -1,
      discard: config.discard || DiscardPolicy.Old,
      num_replicas: config.num_replicas ?? 1,
    }

    const stream: StreamData = {
      config: streamConfig,
      messages: [],
      seq: 0,
      created: new Date().toISOString(),
      messageIds: new Set(),
    }

    globalStreams.set(config.name, stream)
    globalConsumers.set(config.name, new Map())

    return this._streamInfo(stream)
  }

  async update(name: string, config: Partial<StreamConfig>): Promise<StreamInfo> {
    const stream = globalStreams.get(name)
    if (!stream) {
      throw new NatsError(`Stream ${name} not found`, ErrorCode.JetStream404NoMessages)
    }

    // Update config
    Object.assign(stream.config, config)

    return this._streamInfo(stream)
  }

  async info(name: string): Promise<StreamInfo> {
    const stream = globalStreams.get(name)
    if (!stream) {
      throw new NatsError(`Stream ${name} not found`, ErrorCode.JetStream404NoMessages)
    }

    return this._streamInfo(stream)
  }

  async delete(name: string): Promise<boolean> {
    globalStreams.delete(name)
    globalConsumers.delete(name)
    return true
  }

  async purge(name: string, opts?: PurgeOpts): Promise<PurgeResponse> {
    const stream = globalStreams.get(name)
    if (!stream) {
      throw new NatsError(`Stream ${name} not found`, ErrorCode.JetStream404NoMessages)
    }

    let purged = 0

    if (opts?.filter) {
      // Purge only messages matching the filter subject
      const originalLength = stream.messages.length
      stream.messages = stream.messages.filter(msg => {
        if (matchSubject(opts.filter!, msg.subject)) {
          purged++
          return false // Remove this message
        }
        return true // Keep this message
      })
    } else {
      // Purge all messages
      purged = stream.messages.length
      stream.messages = []
      stream.messageIds.clear()
    }

    return { success: true, purged }
  }

  list(): Lister<StreamInfo> {
    const streams = Array.from(globalStreams.values())
    const self = this

    return {
      async next(): Promise<StreamInfo[]> {
        return streams.map(s => self._streamInfo(s))
      },
      async *[Symbol.asyncIterator]() {
        for (const stream of streams) {
          yield self._streamInfo(stream)
        }
      },
    }
  }

  names(subject?: string): Lister<string> {
    let names: string[]

    if (subject) {
      // Filter streams by subject - find streams that would handle this subject
      names = []
      for (const [streamName, stream] of globalStreams) {
        for (const streamSubject of stream.config.subjects || []) {
          if (matchSubject(streamSubject, subject)) {
            names.push(streamName)
            break
          }
        }
      }
    } else {
      names = Array.from(globalStreams.keys())
    }

    return {
      async next(): Promise<string[]> {
        return names
      },
      async *[Symbol.asyncIterator]() {
        for (const name of names) {
          yield name
        }
      },
    }
  }

  async getMessage(name: string, query: MsgRequest): Promise<StoredMsg> {
    const stream = globalStreams.get(name)
    if (!stream) {
      throw new NatsError(`Stream ${name} not found`, ErrorCode.JetStream404NoMessages)
    }

    let msg: StoredMessage | undefined

    if (query.seq !== undefined) {
      msg = stream.messages.find(m => m.seq === query.seq)
    } else if (query.last_by_subj) {
      const matching = stream.messages.filter(m => m.subject === query.last_by_subj)
      msg = matching[matching.length - 1]
    } else if (query.next_by_subj) {
      // Get first message matching the subject
      msg = stream.messages.find(m => m.subject === query.next_by_subj)
    }

    if (!msg) {
      throw new NatsError('Message not found', ErrorCode.JetStream404NoMessages)
    }

    return {
      subject: msg.subject,
      seq: msg.seq,
      data: msg.data,
      time: new Date(msg.timestamp).toISOString(),
    }
  }

  async deleteMessage(name: string, seq: number, _erase?: boolean): Promise<boolean> {
    const stream = globalStreams.get(name)
    if (!stream) {
      throw new NatsError(`Stream ${name} not found`, ErrorCode.JetStream404NoMessages)
    }

    const index = stream.messages.findIndex(m => m.seq === seq)
    if (index !== -1) {
      stream.messages.splice(index, 1)
      return true
    }
    return false
  }

  private _streamInfo(stream: StreamData): StreamInfo {
    // Count unique subjects
    const uniqueSubjects = new Set(stream.messages.map(m => m.subject))

    return {
      config: stream.config,
      state: {
        messages: stream.messages.length,
        bytes: stream.messages.reduce((sum, m) => sum + m.data.length, 0),
        first_seq: stream.messages[0]?.seq ?? 0,
        first_ts: stream.messages[0] ? new Date(stream.messages[0].timestamp).toISOString() : new Date().toISOString(),
        last_seq: stream.seq,
        last_ts: stream.messages[stream.messages.length - 1] ? new Date(stream.messages[stream.messages.length - 1].timestamp).toISOString() : new Date().toISOString(),
        consumer_count: globalConsumers.get(stream.config.name)?.size ?? 0,
        num_subjects: uniqueSubjects.size,
      },
      created: stream.created,
    }
  }
}

// ============================================================================
// CONSUMER API IMPLEMENTATION
// ============================================================================

/**
 * Helper to calculate num_pending for a consumer
 */
function calculateNumPending(consumerData: ConsumerData): number {
  const stream = globalStreams.get(consumerData.stream)
  if (!stream) return 0

  // Count messages after the delivered position that match the filter
  const filter = consumerData.config.filter_subject
  let pending = 0

  for (const msg of stream.messages) {
    if (msg.seq > consumerData.delivered.stream_seq) {
      if (!filter || matchSubject(filter, msg.subject)) {
        pending++
      }
    }
  }

  return pending
}

/**
 * Build ConsumerInfo from consumer data
 */
function buildConsumerInfo(streamName: string, name: string, consumerData: ConsumerData): ConsumerInfo {
  return {
    stream_name: streamName,
    name,
    created: consumerData.created,
    config: consumerData.config,
    delivered: consumerData.delivered,
    ack_floor: consumerData.ack_floor,
    num_ack_pending: consumerData.pending.size,
    num_redelivered: 0,
    num_waiting: 0,
    num_pending: calculateNumPending(consumerData),
  }
}

class ConsumerAPIImpl implements ConsumerAPI {
  async add(stream: string, config: Partial<ConsumerConfig>): Promise<ConsumerInfo> {
    const streamData = globalStreams.get(stream)
    if (!streamData) {
      throw new NatsError(`Stream ${stream} not found`, ErrorCode.JetStream404NoMessages)
    }

    const name = config.durable_name || config.name || `ephemeral-${++globalSeq}`

    const consumerConfig: ConsumerConfig = {
      durable_name: config.durable_name,
      name,
      ack_policy: config.ack_policy || AckPolicy.Explicit,
      deliver_policy: config.deliver_policy || DeliverPolicy.All,
      filter_subject: config.filter_subject,
      max_deliver: config.max_deliver ?? -1,
      ack_wait: config.ack_wait ?? 30000000000,
      deliver_subject: config.deliver_subject,
      opt_start_seq: config.opt_start_seq,
    }

    // Determine starting stream sequence based on deliver_policy
    let startStreamSeq = 0
    const deliverPolicy = consumerConfig.deliver_policy

    if (deliverPolicy === DeliverPolicy.Last || deliverPolicy === 'last') {
      // Start from the last message
      startStreamSeq = streamData.seq > 0 ? streamData.seq - 1 : 0
    } else if (deliverPolicy === DeliverPolicy.New || deliverPolicy === 'new') {
      // Only new messages after consumer creation
      startStreamSeq = streamData.seq
    } else if ((deliverPolicy === DeliverPolicy.StartSequence || deliverPolicy === 'by_start_sequence') && config.opt_start_seq !== undefined) {
      // Start from specific sequence (minus 1 since we start AFTER this point)
      startStreamSeq = config.opt_start_seq - 1
    }
    // For DeliverPolicy.All (default), startStreamSeq = 0

    const consumer: ConsumerData = {
      config: consumerConfig,
      stream,
      name,
      delivered: { consumer_seq: 0, stream_seq: startStreamSeq },
      ack_floor: { consumer_seq: 0, stream_seq: startStreamSeq },
      pending: new Map(),
      redeliveryQueue: [],
      created: new Date().toISOString(),
    }

    let consumers = globalConsumers.get(stream)
    if (!consumers) {
      consumers = new Map()
      globalConsumers.set(stream, consumers)
    }
    consumers.set(name, consumer)

    return buildConsumerInfo(stream, name, consumer)
  }

  async update(stream: string, durable: string, config: Partial<ConsumerConfig>): Promise<ConsumerInfo> {
    const consumers = globalConsumers.get(stream)
    if (!consumers) {
      throw new NatsError(`Stream ${stream} not found`, ErrorCode.JetStream404NoMessages)
    }

    const consumer = consumers.get(durable)
    if (!consumer) {
      throw new NatsError(`Consumer ${durable} not found`, ErrorCode.JetStream404NoMessages)
    }

    Object.assign(consumer.config, config)

    return buildConsumerInfo(stream, durable, consumer)
  }

  async info(stream: string, consumer: string): Promise<ConsumerInfo> {
    const consumers = globalConsumers.get(stream)
    if (!consumers) {
      throw new NatsError(`Stream ${stream} not found`, ErrorCode.JetStream404NoMessages)
    }

    const consumerData = consumers.get(consumer)
    if (!consumerData) {
      throw new NatsError(`Consumer ${consumer} not found`, ErrorCode.JetStream404NoMessages)
    }

    return buildConsumerInfo(stream, consumer, consumerData)
  }

  async delete(stream: string, consumer: string): Promise<boolean> {
    const consumers = globalConsumers.get(stream)
    if (!consumers) return false
    return consumers.delete(consumer)
  }

  list(stream: string): Lister<ConsumerInfo> {
    const consumers = globalConsumers.get(stream) || new Map()
    const consumerList = Array.from(consumers.entries())

    return {
      async next(): Promise<ConsumerInfo[]> {
        return consumerList.map(([name, data]) => buildConsumerInfo(stream, name, data))
      },
      async *[Symbol.asyncIterator]() {
        for (const [name, data] of consumerList) {
          yield buildConsumerInfo(stream, name, data)
        }
      },
    }
  }
}

// ============================================================================
// JETSTREAM MANAGER IMPLEMENTATION
// ============================================================================

class JetStreamManagerImpl implements JetStreamManager {
  streams: StreamAPI
  consumers: ConsumerAPI

  constructor() {
    this.streams = new StreamAPIImpl()
    this.consumers = new ConsumerAPIImpl()
  }

  async getAccountInfo(): Promise<AccountInfo> {
    let totalMsgs = 0
    let totalBytes = 0
    let totalConsumers = 0

    for (const stream of globalStreams.values()) {
      totalMsgs += stream.messages.length
      totalBytes += stream.messages.reduce((sum, m) => sum + m.data.length, 0)
    }

    for (const consumers of globalConsumers.values()) {
      totalConsumers += consumers.size
    }

    return {
      memory: totalBytes,
      storage: totalBytes,
      streams: globalStreams.size,
      consumers: totalConsumers,
      limits: {
        max_memory: -1,
        max_storage: -1,
        max_streams: -1,
        max_consumers: -1,
      },
    }
  }
}

// ============================================================================
// NATS CONNECTION IMPLEMENTATION
// ============================================================================

class NatsConnectionImpl implements NatsConnection {
  private _options: ConnectionOptions
  private _closed = false
  private _draining = false
  private _subscriptions = new Map<number, SubscriptionImpl>()
  private _inboxPrefix = `_INBOX.${++globalInboxCounter}`
  private _inboxCounter = 0
  private _stats = { inBytes: 0, outBytes: 0, inMsgs: 0, outMsgs: 0, reconnects: 0 }
  private _statusIterators: Set<{
    entries: Status[]
    resolvers: Array<(value: IteratorResult<Status>) => void>
    closed: boolean
  }> = new Set()

  info?: ServerInfo

  constructor(options?: ConnectionOptions) {
    this._options = options || {}

    this.info = {
      server_id: 'dotdo-nats-1',
      server_name: 'dotdo-nats',
      version: '2.10.0',
      proto: 1,
      go: 'go1.21',
      host: 'localhost',
      port: 4222,
      headers: true,
      max_payload: 1048576,
      jetstream: true,
      client_id: ++globalSeq,
      client_ip: '127.0.0.1',
    }
  }

  publish(subject: string, data?: Uint8Array, options?: PublishOptions): void {
    if (this._closed) {
      throw new NatsError('Connection closed', ErrorCode.ConnectionClosed)
    }

    validateSubject(subject)

    const msg: StoredMessage = {
      subject,
      data: data || Empty,
      timestamp: Date.now(),
      seq: ++globalSeq,
      reply: options?.reply,
      headers: options?.headers as MsgHdrsImpl,
    }

    this._stats.outMsgs++
    this._stats.outBytes += msg.data.length

    // Collect matching subscriptions across all connections
    const matchingSubs: SubscriptionImpl[] = []
    for (const sub of globalSubscriptions) {
      if (!sub.isClosed() && matchSubject(sub.getSubject(), subject)) {
        matchingSubs.push(sub)
      }
    }

    // Group subscriptions by queue group
    const regularSubs: SubscriptionImpl[] = []
    const queueGroups = new Map<string, SubscriptionImpl[]>()

    for (const sub of matchingSubs) {
      const queue = sub.getQueue()
      if (queue) {
        if (!queueGroups.has(queue)) {
          queueGroups.set(queue, [])
        }
        queueGroups.get(queue)!.push(sub)
      } else {
        regularSubs.push(sub)
      }
    }

    // Deliver to all non-queue subscribers
    for (const sub of regularSubs) {
      const msgObj = new MsgImpl(this, subject, msg.data, msg.reply, msg.headers)
      sub._deliver(msgObj)
    }

    // Deliver to one subscriber per queue group (round-robin)
    for (const [queueName, subs] of queueGroups) {
      if (subs.length === 0) continue
      const key = `${subject}:${queueName}`
      const counter = queueGroupCounters.get(key) ?? 0
      const selectedSub = subs[counter % subs.length]
      queueGroupCounters.set(key, counter + 1)
      const msgObj = new MsgImpl(this, subject, msg.data, msg.reply, msg.headers)
      selectedSub._deliver(msgObj)
    }
  }

  subscribe(subject: string, opts?: SubscriptionOptions): Subscription {
    if (this._closed) {
      throw new NatsError('Connection closed', ErrorCode.ConnectionClosed)
    }

    const sub = new SubscriptionImpl(this, subject, opts)
    this._subscriptions.set(sub.getID(), sub)
    globalSubscriptions.add(sub)

    return sub
  }

  async request(subject: string, data?: Uint8Array, opts?: RequestOptions): Promise<Msg> {
    if (this._closed) {
      throw new NatsError('Connection closed', ErrorCode.ConnectionClosed)
    }

    const timeout = opts?.timeout ?? 10000
    const inbox = `${this._inboxPrefix}.${++this._inboxCounter}`

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.unsubscribe()
        reject(new NatsError('Request timeout', ErrorCode.Timeout))
      }, timeout)

      const sub = this.subscribe(inbox, { max: 1 })

      // Start async iterator to receive response
      ;(async () => {
        try {
          for await (const msg of sub) {
            clearTimeout(timer)
            resolve(msg)
            break
          }
        } catch (e) {
          clearTimeout(timer)
          reject(e)
        }
      })()

      // Publish request
      this.publish(subject, data, { reply: inbox, headers: opts?.headers })
    })
  }

  async flush(): Promise<void> {
    // In-memory implementation - messages are delivered synchronously
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  async drain(): Promise<void> {
    this._draining = true

    // Drain all subscriptions
    for (const sub of this._subscriptions.values()) {
      await sub.drain()
    }

    this._closed = true
    this._subscriptions.clear()
  }

  async close(): Promise<void> {
    this._closed = true

    for (const sub of this._subscriptions.values()) {
      sub.unsubscribe()
    }
    this._subscriptions.clear()

    // Complete status iterators
    for (const iter of this._statusIterators) {
      iter.closed = true
      for (const resolve of iter.resolvers) {
        resolve({ value: undefined, done: true })
      }
    }
    this._statusIterators.clear()
  }

  isClosed(): boolean {
    return this._closed
  }

  isDraining(): boolean {
    return this._draining
  }

  stats(): Stats {
    return { ...this._stats }
  }

  async rtt(): Promise<number> {
    // Simulated RTT for in-memory implementation
    return 0
  }

  status(): AsyncIterable<Status> {
    const iter = {
      entries: [] as Status[],
      resolvers: [] as Array<(value: IteratorResult<Status>) => void>,
      closed: false,
    }

    this._statusIterators.add(iter)

    return {
      async *[Symbol.asyncIterator]() {
        while (!iter.closed) {
          if (iter.entries.length > 0) {
            yield iter.entries.shift()!
          } else {
            const result = await new Promise<IteratorResult<Status>>((resolve) => {
              iter.resolvers.push(resolve)
            })
            if (result.done) break
            yield result.value
          }
        }
      },
    }
  }

  jetstream(_opts?: JetStreamOptions): JetStreamClient {
    return new JetStreamClientImpl(this)
  }

  async jetstreamManager(_opts?: JetStreamOptions): Promise<JetStreamManager> {
    return new JetStreamManagerImpl()
  }
}

// ============================================================================
// CONNECT FUNCTION
// ============================================================================

/**
 * Connect to NATS server
 */
export async function connect(options?: ConnectionOptions): Promise<NatsConnection> {
  return new NatsConnectionImpl(options)
}

// ============================================================================
// CLEAR ALL (FOR TESTING)
// ============================================================================

/**
 * Clear all in-memory data (for testing)
 */
export function _clearAll(): void {
  globalSubjects.clear()
  globalStreams.clear()
  globalConsumers.clear()
  globalKvBuckets.clear()
  globalSubscriptions.clear()
  queueGroupCounters.clear()
  globalSeq = 0
  globalInboxCounter = 0
}
