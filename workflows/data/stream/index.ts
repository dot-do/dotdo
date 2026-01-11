/**
 * Stream Processing API ($.stream)
 *
 * Provides real-time stream processing capabilities:
 * - Stream sources from domain events, tracked events, and measurements
 * - Transformations: filter(), map(), enrich(), flatMap()
 * - Keyed streams via keyBy()
 * - Windowing: tumbling, sliding, session windows
 * - Aggregations within windows
 * - Stream joins with temporal constraints
 * - Sinks to track, measure, and view
 *
 * @module workflows/data/stream
 */

import { toMillis, type Duration } from '../../../db/primitives/utils/duration'

// ============================================================================
// Types
// ============================================================================

export interface StreamSource {
  type?: 'domain' | 'track' | 'measure'
  entity?: string
  event?: string
  metric?: string
}

export interface WindowSpec {
  type: 'tumbling' | 'sliding' | 'session'
  size?: number
  slide?: number
  gap?: number
}

export interface AggregateSpec {
  type: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'first' | 'last' | 'collect' | 'distinct'
  field?: string
}

export interface StreamSink {
  type: 'track' | 'measure' | 'view'
  event?: string
  metric?: string
  view?: string
}

export interface WindowInfo {
  start: number
  end: number
}

type Subscriber<T> = (item: T, key?: string, info?: WindowInfo) => void
type ErrorHandler = (error: Error) => void
type DeadLetterHandler<T> = (element: T, error: Error) => void
type WindowCloseHandler<T> = (key: string, elements: T[], windowInfo: WindowInfo) => void

// ============================================================================
// Stream Interface
// ============================================================================

export interface Stream<T> {
  type: 'stream'
  source: StreamSource
  sink?: StreamSink

  // Transformations
  filter(predicate: (item: T) => boolean | Promise<boolean>): Stream<T>
  map<U>(fn: (item: T) => U | Promise<U>): Stream<U>
  flatMap<U>(fn: (item: T) => U[] | Promise<U[]>): Stream<U>
  enrich<U>(fn: (item: T, ctx: StreamContext) => U | Promise<U>): Stream<U>

  // Keying
  keyBy(keyOrFn: string | ((item: T) => string)): KeyedStream<T, string>

  // Windowing (for non-keyed streams)
  window: {
    tumbling(size: Duration): WindowedStream<T, string>
    sliding(size: Duration, slide: Duration): WindowedStream<T, string>
    session(gap: Duration): WindowedStream<T, string>
  }

  // Lifecycle
  subscribe(fn: Subscriber<T>): () => void
  forEach(fn: (item: T) => void | Promise<void>): Stream<T>
  flush(): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  isRunning(): boolean
  name(n: string): Stream<T>
  getName(): string | undefined

  // Error handling
  onError(handler: ErrorHandler): Stream<T>
  deadLetter(handler: DeadLetterHandler<T>): Stream<T>
  retry(maxRetries: number): Stream<T>

  // Backpressure
  buffer(capacity: number, options?: { strategy?: 'dropOldest' | 'dropNewest' }): Stream<T>
  bufferCapacity?: number
  bufferStrategy?: 'dropOldest' | 'dropNewest'
  throttle(interval: Duration): Stream<T>

  // Sinks
  to: {
    track: { [event: string]: Stream<T> & { sink: StreamSink } }
    measure: { [metric: string]: Stream<T> & { sink: StreamSink } }
    view: { [view: string]: Stream<T> & { sink: StreamSink } }
  }
}

export interface KeyedStream<T, K extends string> {
  type: 'keyed-stream'
  keySelector: string | ((item: T) => K)

  // Windowing
  window: {
    tumbling(size: Duration): WindowedStream<T, K>
    sliding(size: Duration, slide: Duration): WindowedStream<T, K>
    session(gap: Duration): WindowedStream<T, K>
  }

  // Joins
  join<U>(other: KeyedStream<U, K>): JoinBuilder<T, U, K>
  leftJoin<U>(other: KeyedStream<U, K>): LeftJoinBuilder<T, U, K>
  coGroup<U>(other: KeyedStream<U, K>): CoGroupBuilder<T, U, K>

  // Lifecycle
  subscribe(fn: (item: T, key: K) => void): () => void
  flush(): Promise<void>
}

export interface WindowedStream<T, K extends string> {
  type: 'windowed-stream'
  window: WindowSpec
  key?: K

  // Aggregation
  aggregate<R extends Record<string, AggregateSpec>>(
    spec: R
  ): AggregatedStream<{ [P in keyof R]: number } & { key: K }, K>

  reduce<A>(
    reducer: (acc: A, item: T) => A,
    initial: A
  ): AggregatedStream<A, K>

  // Callbacks
  onWindowClose(handler: WindowCloseHandler<T>): void

  // Lifecycle
  subscribe(fn: Subscriber<T>): () => void
  flush(): Promise<void>
}

export interface AggregatedStream<T, K extends string> {
  type: 'stream'

  map<U>(fn: (item: T) => U): AggregatedStream<U, K>

  subscribe(fn: (result: T, key: K, info: WindowInfo) => void): () => void
  flush(): Promise<void>

  to: {
    track: { [event: string]: AggregatedStream<T, K> & { sink: StreamSink } }
    measure: { [metric: string]: AggregatedStream<T, K> & { sink: StreamSink } }
    view: { [view: string]: AggregatedStream<T, K> & { sink: StreamSink } }
  }
}

export interface JoinedStream<T> {
  type: 'stream' | 'joined-stream'
  window?: number

  within(duration: Duration): JoinedStream<T>
  on<R>(fn: (left: T extends [infer L, infer R] ? L : never, right: T extends [infer L, infer R] ? R : never) => R): Stream<R>

  subscribe(fn: (item: T) => void): () => void
  flush(): Promise<void>
}

interface JoinBuilder<L, R, K extends string> {
  type: 'joined-stream'
  window?: number

  within(duration: Duration): JoinBuilder<L, R, K>
  on<T>(fn: (left: L, right: R) => T): Stream<T>
}

interface LeftJoinBuilder<L, R, K extends string> {
  type: 'joined-stream'
  window?: number

  within(duration: Duration): LeftJoinBuilder<L, R, K>
  on<T>(fn: (left: L, right: R | null) => T): Stream<T>
}

interface CoGroupBuilder<L, R, K extends string> {
  type: 'joined-stream'
  window?: number

  within(duration: Duration): CoGroupBuilder<L, R, K>
  apply<T>(fn: (leftGroup: L[], rightGroup: R[]) => T): Stream<T>
}

// ============================================================================
// Stream Context
// ============================================================================

export interface StreamContext {
  stream: {
    from: DynamicEntityProxy
    emit(entity: string, event: string, data: unknown): Promise<void>
    get(name: string): Stream<unknown> | undefined
  }

  // Aggregation helpers
  count(): AggregateSpec
  sum(field: string): AggregateSpec
  avg(field: string): AggregateSpec
  min(field: string): AggregateSpec
  max(field: string): AggregateSpec
  first(): AggregateSpec
  last(): AggregateSpec
  collect(): AggregateSpec
  distinct(field: string): AggregateSpec

  // Entity proxies
  Customer: EntityProxy
  Order: EntityProxy
  Payment: EntityProxy
  [entity: string]: unknown

  // View namespace
  view: ViewNamespace

  // Internal storage for testing
  _storage: {
    customers: Map<string, unknown>
    [key: string]: Map<string, unknown>
  }

  // Hooks for testing
  _hooks: {
    onTrack(event: string, handler: (data: unknown) => void): void
    onMeasure(metric: string, handler: (value: number, labels: Record<string, string>) => void): void
    onEntityAction(entity: string, action: string, handler: (id: string, payload: unknown) => void): void
  }
}

interface DynamicEntityProxy {
  [entity: string]: DynamicEventProxy
  track: DynamicEventProxy
  measure: DynamicMetricProxy
}

interface DynamicEventProxy {
  [event: string]: Stream<unknown>
}

interface DynamicMetricProxy {
  [metric: string]: Stream<unknown>
}

interface EntityProxy {
  (id: string): EntityInstance
}

interface EntityInstance {
  get(): Promise<unknown>
  notify(payload: unknown): Promise<void>
  [action: string]: (...args: unknown[]) => Promise<unknown>
}

interface ViewNamespace {
  [view: string]: ViewInstance
}

interface ViewInstance {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

// ============================================================================
// Implementation
// ============================================================================

class StreamImpl<T> implements Stream<T> {
  type = 'stream' as const
  source: StreamSource
  sink?: StreamSink
  bufferCapacity?: number
  bufferStrategy?: 'dropOldest' | 'dropNewest'

  private subscribers: Subscriber<T>[] = []
  private errorHandlers: ErrorHandler[] = []
  private deadLetterHandlers: DeadLetterHandler<T>[] = []
  private forEachHandler?: (item: T) => void | Promise<void>
  private running = false // Streams don't run until explicitly started
  private streamName?: string
  private maxRetries = 0
  private _bufferCapacity = Infinity
  private _bufferStrategy: 'dropOldest' | 'dropNewest' = 'dropOldest'
  private _buffer: T[] = [] // Renamed to avoid conflict with buffer() method
  private throttleMs = 0
  private lastEmitTime = 0
  private throttleQueue: T[] = []
  private throttleTimer: ReturnType<typeof setTimeout> | null = null
  private ctx: StreamContextImpl
  pipeline: Array<(item: unknown) => unknown | Promise<unknown>> = []
  private keyedSubscribers: Array<{ fn: (item: T, key: string) => void }> = []
  private started = false // Track if start() was called
  private isRoot = true // Whether this is a root stream (receives from emit directly)
  private parentStream?: StreamImpl<unknown> // Parent stream for child streams
  pendingOperations: Promise<void>[] = [] // Track pending async operations

  constructor(source: StreamSource, ctx: StreamContextImpl, parent?: StreamImpl<unknown>) {
    this.source = Object.freeze({ ...source })
    this.ctx = ctx
    if (parent) {
      this.isRoot = false
      this.parentStream = parent
    }
  }

  isRootStream(): boolean {
    return this.isRoot
  }

  filter(predicate: (item: T) => boolean | Promise<boolean>): Stream<T> {
    const newStream = new StreamImpl<T>(this.source, this.ctx, this as unknown as StreamImpl<unknown>)
    newStream.pipeline.push(async (item) => {
      const result = await predicate(item as T)
      if (!result) return Symbol.for('skip')
      return item
    })
    // Subscribe to parent to receive items, tracking async operations
    this.subscribe((item) => {
      const op = newStream.processItem(item as unknown)
      newStream.pendingOperations.push(op)
    })
    this.ctx.registerStream(newStream)
    return newStream
  }

  map<U>(fn: (item: T) => U | Promise<U>): Stream<U> {
    const newStream = new StreamImpl<U>(this.source, this.ctx, this as unknown as StreamImpl<unknown>)
    newStream.pipeline.push(async (item) => {
      return await fn(item as T)
    })
    // Subscribe to parent to receive items, tracking async operations
    this.subscribe((item) => {
      const op = newStream.processItem(item as unknown)
      newStream.pendingOperations.push(op)
    })
    this.ctx.registerStream(newStream)
    return newStream
  }

  flatMap<U>(fn: (item: T) => U[] | Promise<U[]>): Stream<U> {
    const newStream = new StreamImpl<U>(this.source, this.ctx, this as unknown as StreamImpl<unknown>)
    newStream.pipeline.push(async (item) => {
      const result = await fn(item as T)
      return { __flatMap: result }
    })
    // Subscribe to parent to receive items, tracking async operations
    this.subscribe((item) => {
      const op = newStream.processItem(item as unknown)
      newStream.pendingOperations.push(op)
    })
    this.ctx.registerStream(newStream)
    return newStream
  }

  enrich<U>(fn: (item: T, ctx: StreamContext) => U | Promise<U>): Stream<U> {
    const newStream = new StreamImpl<U>(this.source, this.ctx, this as unknown as StreamImpl<unknown>)
    newStream.pipeline.push(async (item) => {
      return await fn(item as T, this.ctx)
    })
    // Subscribe to parent to receive items, tracking async operations
    this.subscribe((item) => {
      const op = newStream.processItem(item as unknown)
      newStream.pendingOperations.push(op)
    })
    this.ctx.registerStream(newStream)
    return newStream
  }

  keyBy(keyOrFn: string | ((item: T) => string)): KeyedStream<T, string> {
    return new KeyedStreamImpl<T, string>(this, keyOrFn, this.ctx)
  }

  // These methods exist to provide helpful error messages
  join(): never {
    throw new Error('join() requires a keyed stream. Call keyBy() first.')
  }

  leftJoin(): never {
    throw new Error('leftJoin() requires a keyed stream. Call keyBy() first.')
  }

  coGroup(): never {
    throw new Error('coGroup() requires a keyed stream. Call keyBy() first.')
  }

  get window() {
    // For non-keyed streams, use global key
    const globalKeyedStream = new KeyedStreamImpl<T, string>(this, () => '__global__', this.ctx)
    return {
      tumbling: (size: Duration) => {
        const ws = globalKeyedStream.window.tumbling(size)
        ;(ws as WindowedStreamImpl<T, string>).key = '__global__' as string
        return ws
      },
      sliding: (size: Duration, slide: Duration) => globalKeyedStream.window.sliding(size, slide),
      session: (gap: Duration) => globalKeyedStream.window.session(gap),
    }
  }

  subscribe(fn: Subscriber<T>): () => void {
    this.subscribers.push(fn)
    // Auto-start when subscribed (implicit running) unless explicitly stopped
    if (!this.started) {
      this.running = true
    }
    return () => {
      const idx = this.subscribers.indexOf(fn)
      if (idx !== -1) this.subscribers.splice(idx, 1)
    }
  }

  forEach(fn: (item: T) => void | Promise<void>): Stream<T> {
    this.forEachHandler = fn
    // Auto-start when forEach is called
    if (!this.started) {
      this.running = true
    }
    return this
  }

  async flush(): Promise<void> {
    // First, flush parent stream if we have one (to ensure upstream items flow through)
    if (this.parentStream) {
      await this.parentStream.flush()
    }

    // Wait for all pending async operations on THIS stream
    // Keep flushing until no more pending operations (items may chain through)
    while (this.pendingOperations.length > 0) {
      const ops = this.pendingOperations
      this.pendingOperations = []
      await Promise.all(ops)
    }

    // Advance time to trigger window closes
    this.ctx.advanceTime(Date.now())

    // Process any throttled items
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer)
      this.throttleTimer = null
    }
    for (const item of this.throttleQueue) {
      await this.deliverItem(item)
    }
    this.throttleQueue = []
  }

  async start(): Promise<void> {
    this.started = true
    this.running = true
  }

  async stop(): Promise<void> {
    this.running = false
  }

  isRunning(): boolean {
    return this.started && this.running
  }

  name(n: string): Stream<T> {
    this.streamName = n
    this.ctx.namedStreams.set(n, this as unknown as Stream<unknown>)
    return this
  }

  getName(): string | undefined {
    return this.streamName
  }

  onError(handler: ErrorHandler): Stream<T> {
    this.errorHandlers.push(handler)
    return this
  }

  deadLetter(handler: DeadLetterHandler<T>): Stream<T> {
    this.deadLetterHandlers.push(handler)
    return this
  }

  retry(maxRetries: number): Stream<T> {
    this.maxRetries = maxRetries
    return this
  }

  buffer(capacity: number, options?: { strategy?: 'dropOldest' | 'dropNewest' }): Stream<T> {
    this._bufferCapacity = capacity
    this.bufferCapacity = capacity
    this._bufferStrategy = options?.strategy ?? 'dropOldest'
    this.bufferStrategy = this._bufferStrategy
    return this
  }

  throttle(interval: Duration): Stream<T> {
    this.throttleMs = toMillis(interval)
    return this
  }

  get to() {
    const self = this
    return {
      track: new Proxy({} as { [event: string]: Stream<T> & { sink: StreamSink } }, {
        get(_, event: string) {
          self.sink = { type: 'track', event }
          self.ctx.registerSinkStream(self as unknown as StreamImpl<unknown>, 'track', event)
          return self
        },
      }),
      measure: new Proxy({} as { [metric: string]: Stream<T> & { sink: StreamSink } }, {
        get(_, metric: string) {
          self.sink = { type: 'measure', metric }
          self.ctx.registerSinkStream(self as unknown as StreamImpl<unknown>, 'measure', metric)
          return self
        },
      }),
      view: new Proxy({} as { [view: string]: Stream<T> & { sink: StreamSink } }, {
        get(_, view: string) {
          self.sink = { type: 'view', view }
          self.ctx.registerSinkStream(self as unknown as StreamImpl<unknown>, 'view', view)
          return self
        },
      }),
    }
  }

  async processItem(item: unknown): Promise<void> {
    // If explicitly stopped (started = true but running = false), don't process
    if (this.started && !this.running) {
      return
    }

    // Otherwise, process if:
    // - root stream (always processes unless explicitly stopped)
    // - has subscribers
    // - has forEachHandler
    // - has pipeline (predicates/transforms to run for side effects like spying)
    if (!this.isRoot && this.subscribers.length === 0 && !this.forEachHandler && this.pipeline.length === 0) {
      return
    }

    let current: unknown = item
    let attempts = 0
    const maxAttempts = this.maxRetries + 1

    while (attempts < maxAttempts) {
      try {
        // Process through pipeline
        for (const step of this.pipeline) {
          current = await step(current)
          if (current === Symbol.for('skip')) return
          if (current && typeof current === 'object' && '__flatMap' in current) {
            const items = (current as { __flatMap: unknown[] }).__flatMap
            for (const flatItem of items) {
              await this.deliverItem(flatItem as T)
            }
            return
          }
        }

        await this.deliverItem(current as T)
        return
      } catch (error) {
        attempts++
        if (attempts >= maxAttempts) {
          for (const handler of this.errorHandlers) {
            handler(error as Error)
          }
          for (const handler of this.deadLetterHandlers) {
            handler(item as T, error as Error)
          }
        }
      }
    }
  }

  private async deliverItem(item: T): Promise<void> {
    // Handle throttling
    if (this.throttleMs > 0) {
      const now = Date.now()
      if (now - this.lastEmitTime < this.throttleMs) {
        this.throttleQueue.push(item)
        if (!this.throttleTimer) {
          this.throttleTimer = setTimeout(() => {
            const next = this.throttleQueue.shift()
            if (next) this.deliverItem(next)
            this.throttleTimer = null
          }, this.throttleMs - (now - this.lastEmitTime))
        }
        return
      }
      this.lastEmitTime = now
    }

    // Handle buffering
    if (this._bufferCapacity < Infinity) {
      this._buffer.push(item)
      if (this._buffer.length > this._bufferCapacity) {
        if (this._bufferStrategy === 'dropOldest') {
          this._buffer.shift()
        } else {
          this._buffer.pop()
          return // Drop newest means don't deliver this one
        }
      }
    }

    for (const subscriber of this.subscribers) {
      subscriber(item)
    }

    if (this.forEachHandler) {
      await this.forEachHandler(item)
    }
  }
}

class KeyedStreamImpl<T, K extends string> implements KeyedStream<T, K> {
  type = 'keyed-stream' as const
  keySelector: string | ((item: T) => K)
  parentStream: StreamImpl<T>
  private ctx: StreamContextImpl
  private subscribers: Array<(item: T, key: K) => void> = []
  private timestampSubscribers: Array<(item: T, key: K, timestamp: number) => void> = []

  constructor(
    parent: StreamImpl<T>,
    keySelector: string | ((item: T) => K),
    ctx: StreamContextImpl
  ) {
    this.parentStream = parent
    this.keySelector = keySelector
    this.ctx = ctx

    // Subscribe to parent stream to get transformed items
    this.parentStream.subscribe((item) => {
      // Get timestamp from item if available, otherwise use current time
      const timestamp = (item as Record<string, unknown>)?.timestamp as number ?? Date.now()
      this.processItem(item as T, timestamp)
    })

    this.ctx.registerKeyedStream(this as unknown as KeyedStreamImpl<unknown, string>)
  }

  getKey(item: T): K {
    if (typeof this.keySelector === 'string') {
      return (item as Record<string, unknown>)[this.keySelector] as K
    }
    return this.keySelector(item)
  }

  get window() {
    return {
      tumbling: (size: Duration) => {
        const sizeMs = toMillis(size)
        return new WindowedStreamImpl<T, K>(this, { type: 'tumbling', size: sizeMs }, this.ctx)
      },
      sliding: (size: Duration, slide: Duration) => {
        const sizeMs = toMillis(size)
        const slideMs = toMillis(slide)
        if (slideMs > sizeMs) {
          throw new Error('Slide cannot be larger than size')
        }
        return new WindowedStreamImpl<T, K>(this, { type: 'sliding', size: sizeMs, slide: slideMs }, this.ctx)
      },
      session: (gap: Duration) => {
        const gapMs = toMillis(gap)
        return new WindowedStreamImpl<T, K>(this, { type: 'session', gap: gapMs }, this.ctx)
      },
    }
  }

  join<U>(other: KeyedStream<U, K>): JoinBuilder<T, U, K> {
    return new JoinBuilderImpl<T, U, K>(this, other, 'inner', this.ctx)
  }

  leftJoin<U>(other: KeyedStream<U, K>): LeftJoinBuilder<T, U, K> {
    return new JoinBuilderImpl<T, U, K>(this, other, 'left', this.ctx)
  }

  coGroup<U>(other: KeyedStream<U, K>): CoGroupBuilder<T, U, K> {
    return new CoGroupBuilderImpl<T, U, K>(this, other, this.ctx)
  }

  subscribe(fn: (item: T, key: K) => void): () => void {
    this.subscribers.push(fn)
    return () => {
      const idx = this.subscribers.indexOf(fn)
      if (idx !== -1) this.subscribers.splice(idx, 1)
    }
  }

  subscribeWithTimestamp(fn: (item: T, key: K, timestamp: number) => void): () => void {
    this.timestampSubscribers.push(fn)
    return () => {
      const idx = this.timestampSubscribers.indexOf(fn)
      if (idx !== -1) this.timestampSubscribers.splice(idx, 1)
    }
  }

  async flush(): Promise<void> {
    await this.parentStream.flush()
  }

  processItem(item: T, timestamp?: number): void {
    const key = this.getKey(item)
    const ts = timestamp ?? (item as Record<string, unknown>)?.timestamp as number ?? Date.now()
    for (const subscriber of this.subscribers) {
      subscriber(item, key)
    }
    for (const subscriber of this.timestampSubscribers) {
      subscriber(item, key, ts)
    }
  }
}

class WindowedStreamImpl<T, K extends string> implements WindowedStream<T, K> {
  type = 'windowed-stream' as const
  window: WindowSpec
  key?: K

  private keyedStream: KeyedStreamImpl<T, K>
  private ctx: StreamContextImpl
  private windowCloseHandlers: WindowCloseHandler<T>[] = []
  private windowState: Map<string, { elements: T[]; lastTimestamp: number }> = new Map()
  private subscribers: Subscriber<T>[] = []
  private aggregateSpec?: Record<string, AggregateSpec>
  private reduceSpec?: { reducer: (acc: unknown, item: T) => unknown; initial: unknown }

  constructor(
    keyedStream: KeyedStreamImpl<T, K>,
    windowSpec: WindowSpec,
    ctx: StreamContextImpl
  ) {
    this.keyedStream = keyedStream
    this.window = windowSpec
    this.ctx = ctx

    // Subscribe to keyed stream to receive items
    this.keyedStream.subscribeWithTimestamp((item, key, timestamp) => {
      this.processItem(item, timestamp)
    })

    this.ctx.registerWindowedStream(this as unknown as WindowedStreamImpl<unknown, string>)
  }

  aggregate<R extends Record<string, AggregateSpec>>(
    spec: R
  ): AggregatedStream<{ [P in keyof R]: number } & { key: K }, K> {
    this.aggregateSpec = spec
    return new AggregatedStreamImpl<{ [P in keyof R]: number } & { key: K }, K>(
      this as unknown as WindowedStreamImpl<unknown, string>,
      this.ctx
    )
  }

  reduce<A>(
    reducer: (acc: A, item: T) => A,
    initial: A
  ): AggregatedStream<A, K> {
    this.reduceSpec = { reducer: reducer as (acc: unknown, item: T) => unknown, initial }
    return new AggregatedStreamImpl<A, K>(
      this as unknown as WindowedStreamImpl<unknown, string>,
      this.ctx
    )
  }

  onWindowClose(handler: WindowCloseHandler<T>): void {
    this.windowCloseHandlers.push(handler)
  }

  subscribe(fn: Subscriber<T>): () => void {
    this.subscribers.push(fn)
    return () => {
      const idx = this.subscribers.indexOf(fn)
      if (idx !== -1) this.subscribers.splice(idx, 1)
    }
  }

  async flush(): Promise<void> {
    // Trigger window close for all pending windows
    for (const [windowKey, state] of this.windowState.entries()) {
      const [key] = windowKey.split('|')
      const windowInfo = this.computeWindowInfo(state.lastTimestamp)
      for (const handler of this.windowCloseHandlers) {
        handler(key, state.elements, windowInfo)
      }
    }
    this.windowState.clear()
  }

  private computeWindowInfo(timestamp: number): WindowInfo {
    if (this.window.type === 'tumbling') {
      const size = this.window.size!
      const start = Math.floor(timestamp / size) * size
      return { start, end: start + size }
    } else if (this.window.type === 'sliding') {
      const size = this.window.size!
      const slide = this.window.slide!
      const start = Math.floor(timestamp / slide) * slide
      return { start, end: start + size }
    } else {
      // Session - approximate based on elements
      return { start: timestamp, end: timestamp + (this.window.gap || 0) }
    }
  }

  processItem(item: T, timestamp: number): void {
    const key = this.keyedStream.getKey(item)
    const windowKeys = this.getWindowKeys(key, timestamp)

    for (const windowKey of windowKeys) {
      let state = this.windowState.get(windowKey)
      if (!state) {
        state = { elements: [], lastTimestamp: timestamp }
        this.windowState.set(windowKey, state)
      }

      state.elements.push(item)
      state.lastTimestamp = Math.max(state.lastTimestamp, timestamp)
    }

    for (const subscriber of this.subscribers) {
      subscriber(item, key)
    }
  }

  private getWindowKeys(key: K, timestamp: number): string[] {
    if (this.window.type === 'tumbling') {
      const size = this.window.size!
      const windowStart = Math.floor(timestamp / size) * size
      return [`${key}|${windowStart}`]
    } else if (this.window.type === 'session') {
      // For session windows, check if we should start a new session
      const gap = this.window.gap!

      // Find the current session for this key (if any)
      let currentSession: string | null = null
      let currentLastTimestamp = -Infinity

      for (const [windowKey, state] of this.windowState.entries()) {
        if (windowKey.startsWith(`${key}|session_`)) {
          if (state.lastTimestamp > currentLastTimestamp) {
            currentSession = windowKey
            currentLastTimestamp = state.lastTimestamp
          }
        }
      }

      // If there's no current session, or the gap is too large, start a new session
      if (currentSession === null || timestamp - currentLastTimestamp > gap) {
        return [`${key}|session_${timestamp}`]
      }

      // Otherwise, add to the current session
      return [currentSession]
    } else {
      // Sliding window: item belongs to all windows where windowStart <= timestamp < windowStart + size
      const size = this.window.size!
      const slide = this.window.slide!
      const keys: string[] = []

      // Find the earliest window that could contain this timestamp
      // Window starts at multiples of slide
      const earliestWindowStart = Math.floor((timestamp - size + 1) / slide) * slide
      const latestWindowStart = Math.floor(timestamp / slide) * slide

      for (let windowStart = Math.max(0, earliestWindowStart); windowStart <= latestWindowStart; windowStart += slide) {
        if (timestamp >= windowStart && timestamp < windowStart + size) {
          keys.push(`${key}|${windowStart}`)
        }
      }

      return keys
    }
  }

  triggerWindowClose(currentTime: number): void {
    const windowsToClose: Array<{ key: string; windowKey: string; state: { elements: T[]; lastTimestamp: number } }> = []

    for (const [windowKey, state] of this.windowState.entries()) {
      const [key, windowId] = windowKey.split('|')
      let shouldClose = false
      let windowInfo: WindowInfo

      if (this.window.type === 'tumbling') {
        const size = this.window.size!
        const windowStart = parseInt(windowId)
        const windowEnd = windowStart + size
        windowInfo = { start: windowStart, end: windowEnd }
        shouldClose = currentTime >= windowEnd
      } else if (this.window.type === 'sliding') {
        const size = this.window.size!
        const slide = this.window.slide!
        const windowStart = parseInt(windowId)
        const windowEnd = windowStart + size
        windowInfo = { start: windowStart, end: windowEnd }
        shouldClose = currentTime >= windowEnd
      } else {
        // Session
        const gap = this.window.gap!
        windowInfo = { start: state.lastTimestamp - gap, end: state.lastTimestamp + gap }
        shouldClose = currentTime >= state.lastTimestamp + gap
      }

      if (shouldClose) {
        windowsToClose.push({ key, windowKey, state })
      }
    }

    for (const { key, windowKey, state } of windowsToClose) {
      const windowInfo = this.computeWindowInfo(state.lastTimestamp)
      for (const handler of this.windowCloseHandlers) {
        handler(key, state.elements, windowInfo)
      }
      this.windowState.delete(windowKey)
    }
  }

  getAggregateSpec(): Record<string, AggregateSpec> | undefined {
    return this.aggregateSpec
  }

  getReduceSpec(): { reducer: (acc: unknown, item: T) => unknown; initial: unknown } | undefined {
    return this.reduceSpec
  }

  getWindowState(): Map<string, { elements: T[]; lastTimestamp: number }> {
    return this.windowState
  }

  getKeyedStream(): KeyedStreamImpl<T, K> {
    return this.keyedStream
  }
}

class AggregatedStreamImpl<T, K extends string> implements AggregatedStream<T, K> {
  type = 'stream' as const
  sink?: StreamSink

  private windowedStream: WindowedStreamImpl<unknown, string>
  private ctx: StreamContextImpl
  private subscribers: Array<(result: T, key: K, info: WindowInfo) => void> = []
  private mapFn?: (item: unknown) => T

  constructor(windowedStream: WindowedStreamImpl<unknown, string>, ctx: StreamContextImpl) {
    this.windowedStream = windowedStream
    this.ctx = ctx
    this.ctx.registerAggregatedStream(this as unknown as AggregatedStreamImpl<unknown, string>)
  }

  map<U>(fn: (item: T) => U): AggregatedStream<U, K> {
    const newStream = new AggregatedStreamImpl<U, K>(this.windowedStream, this.ctx)
    const prevMapFn = this.mapFn
    newStream.mapFn = (item: unknown) => {
      const prev = prevMapFn ? prevMapFn(item) : (item as T)
      return fn(prev)
    }
    return newStream
  }

  subscribe(fn: (result: T, key: K, info: WindowInfo) => void): () => void {
    this.subscribers.push(fn)
    return () => {
      const idx = this.subscribers.indexOf(fn)
      if (idx !== -1) this.subscribers.splice(idx, 1)
    }
  }

  async flush(): Promise<void> {
    // Advance time to trigger window closes
    this.ctx.advanceTime(Date.now())
    await this.windowedStream.flush()
  }

  get to() {
    const self = this
    return {
      track: new Proxy({} as { [event: string]: AggregatedStream<T, K> & { sink: StreamSink } }, {
        get(_, event: string) {
          self.sink = { type: 'track', event }
          return self
        },
      }),
      measure: new Proxy({} as { [metric: string]: AggregatedStream<T, K> & { sink: StreamSink } }, {
        get(_, metric: string) {
          self.sink = { type: 'measure', metric }
          self.ctx.registerAggregatedSink(self as unknown as AggregatedStreamImpl<unknown, string>, 'measure', metric)
          return self
        },
      }),
      view: new Proxy({} as { [view: string]: AggregatedStream<T, K> & { sink: StreamSink } }, {
        get(_, view: string) {
          self.sink = { type: 'view', view }
          self.ctx.registerAggregatedSink(self as unknown as AggregatedStreamImpl<unknown, string>, 'view', view)
          return self
        },
      }),
    }
  }

  emitResult(result: unknown, key: string, info: WindowInfo): void {
    let finalResult = result as T
    if (this.mapFn) {
      finalResult = this.mapFn(result) as T
    }
    for (const subscriber of this.subscribers) {
      subscriber(finalResult, key as K, info)
    }
  }

  getWindowedStream(): WindowedStreamImpl<unknown, string> {
    return this.windowedStream
  }
}

class JoinBuilderImpl<L, R, K extends string> implements JoinBuilder<L, R, K>, LeftJoinBuilder<L, R, K> {
  type = 'joined-stream' as const
  window?: number

  private leftStream: KeyedStreamImpl<L, K>
  private rightStream: KeyedStream<R, K>
  private joinType: 'inner' | 'left'
  private ctx: StreamContextImpl

  constructor(
    left: KeyedStreamImpl<L, K>,
    right: KeyedStream<R, K>,
    joinType: 'inner' | 'left',
    ctx: StreamContextImpl
  ) {
    this.leftStream = left
    this.rightStream = right
    this.joinType = joinType
    this.ctx = ctx
  }

  within(duration: Duration): JoinBuilder<L, R, K> & LeftJoinBuilder<L, R, K> {
    this.window = toMillis(duration)
    return this
  }

  on<T>(fn: (left: L, right: R | null) => T): Stream<T> {
    const newStream = new StreamImpl<T>({ type: 'domain' }, this.ctx)
    this.ctx.registerJoin(
      this.leftStream as unknown as KeyedStreamImpl<unknown, string>,
      this.rightStream as unknown as KeyedStream<unknown, string>,
      this.window ?? Infinity,
      this.joinType,
      fn as (left: unknown, right: unknown) => unknown,
      newStream as unknown as StreamImpl<unknown>
    )
    return newStream
  }
}

class CoGroupBuilderImpl<L, R, K extends string> implements CoGroupBuilder<L, R, K> {
  type = 'joined-stream' as const
  window?: number

  private leftStream: KeyedStreamImpl<L, K>
  private rightStream: KeyedStream<R, K>
  private ctx: StreamContextImpl

  constructor(
    left: KeyedStreamImpl<L, K>,
    right: KeyedStream<R, K>,
    ctx: StreamContextImpl
  ) {
    this.leftStream = left
    this.rightStream = right
    this.ctx = ctx
  }

  within(duration: Duration): CoGroupBuilder<L, R, K> {
    this.window = toMillis(duration)
    return this
  }

  apply<T>(fn: (leftGroup: L[], rightGroup: R[]) => T): Stream<T> {
    const newStream = new StreamImpl<T>({ type: 'domain' }, this.ctx)
    this.ctx.registerCoGroup(
      this.leftStream as unknown as KeyedStreamImpl<unknown, string>,
      this.rightStream as unknown as KeyedStream<unknown, string>,
      this.window ?? Infinity,
      fn as (left: unknown[], right: unknown[]) => unknown,
      newStream as unknown as StreamImpl<unknown>
    )
    return newStream
  }
}

// ============================================================================
// Stream Context Implementation
// ============================================================================

class StreamContextImpl implements StreamContext {
  _storage = {
    customers: new Map<string, unknown>(),
  } as { customers: Map<string, unknown>; [key: string]: Map<string, unknown> }

  private trackHandlers = new Map<string, Array<(data: unknown) => void>>()
  private measureHandlers = new Map<string, Array<(value: number, labels: Record<string, string>) => void>>()
  private entityActionHandlers = new Map<string, Array<(id: string, payload: unknown) => void>>()

  private streams: StreamImpl<unknown>[] = []
  private keyedStreams: KeyedStreamImpl<unknown, string>[] = []
  private windowedStreams: WindowedStreamImpl<unknown, string>[] = []
  private aggregatedStreams: AggregatedStreamImpl<unknown, string>[] = []
  namedStreams = new Map<string, Stream<unknown>>()

  private eventBuffer: Map<string, Array<{ data: unknown; timestamp: number }>> = new Map()
  private trackEventBuffer: Map<string, Array<{ data: unknown; timestamp: number }>> = new Map()

  // Sink streams
  private sinkStreams: Map<string, StreamImpl<unknown>[]> = new Map()
  private aggregatedSinks: Map<string, AggregatedStreamImpl<unknown, string>[]> = new Map()

  // Joins
  private joins: Array<{
    left: KeyedStreamImpl<unknown, string>
    right: KeyedStream<unknown, string>
    window: number
    joinType: 'inner' | 'left'
    mapper: (left: unknown, right: unknown) => unknown
    output: StreamImpl<unknown>
    leftBuffer: Map<string, Array<{ data: unknown; timestamp: number }>>
    rightBuffer: Map<string, Array<{ data: unknown; timestamp: number }>>
  }> = []

  private coGroups: Array<{
    left: KeyedStreamImpl<unknown, string>
    right: KeyedStream<unknown, string>
    window: number
    mapper: (left: unknown[], right: unknown[]) => unknown
    output: StreamImpl<unknown>
    leftBuffer: Map<string, Array<{ data: unknown; timestamp: number }>>
    rightBuffer: Map<string, Array<{ data: unknown; timestamp: number }>>
  }> = []

  // Views storage
  private viewData = new Map<string, Map<string, unknown>>()

  _hooks = {
    onTrack: (event: string, handler: (data: unknown) => void) => {
      if (!this.trackHandlers.has(event)) this.trackHandlers.set(event, [])
      this.trackHandlers.get(event)!.push(handler)
    },
    onMeasure: (metric: string, handler: (value: number, labels: Record<string, string>) => void) => {
      if (!this.measureHandlers.has(metric)) this.measureHandlers.set(metric, [])
      this.measureHandlers.get(metric)!.push(handler)
    },
    onEntityAction: (entity: string, action: string, handler: (id: string, payload: unknown) => void) => {
      const key = `${entity}.${action}`
      if (!this.entityActionHandlers.has(key)) this.entityActionHandlers.set(key, [])
      this.entityActionHandlers.get(key)!.push(handler)
    },
  }

  stream = {
    from: new Proxy({} as DynamicEntityProxy, {
      get: (_, entity: string) => {
        if (entity === 'track') {
          return new Proxy({} as DynamicEventProxy, {
            get: (_, event: string) => {
              const stream = new StreamImpl<unknown>({ type: 'track', event }, this)
              this.registerStream(stream)
              return stream
            },
          })
        }
        if (entity === 'measure') {
          return new Proxy({} as DynamicMetricProxy, {
            get: (_, metric: string) => {
              const stream = new StreamImpl<unknown>({ type: 'measure', metric }, this)
              this.registerStream(stream)
              return stream
            },
          })
        }
        return new Proxy({} as DynamicEventProxy, {
          get: (_, event: string) => {
            const stream = new StreamImpl<unknown>({ type: 'domain', entity, event }, this)
            this.registerStream(stream)
            return stream
          },
        })
      },
    }),
    emit: async (entity: string, event: string, data: unknown) => {
      const timestamp = (data as Record<string, unknown>)?.timestamp as number ?? Date.now()

      if (entity === 'track') {
        const eventKey = event
        if (!this.trackEventBuffer.has(eventKey)) {
          this.trackEventBuffer.set(eventKey, [])
        }
        this.trackEventBuffer.get(eventKey)!.push({ data, timestamp })

        // Process through streams
        for (const stream of this.streams) {
          if (stream.source.type === 'track' && stream.source.event === event) {
            await stream.processItem(data)
          }
        }
        // Don't return - continue to process joins and coGroups below
      } else {
        // Domain events
        const eventKey = `${entity}.${event}`
        if (!this.eventBuffer.has(eventKey)) {
          this.eventBuffer.set(eventKey, [])
        }
        this.eventBuffer.get(eventKey)!.push({ data, timestamp })

        // Process through ROOT streams only (child streams get data via parent subscription)
        for (const stream of this.streams) {
          // Check if this stream matches the emit
          const isMatchingSource =
            // Domain events: $.stream.from.Order.created
            ((stream.source.entity === entity || stream.source.entity === '*') &&
              (stream.source.event === event || stream.source.event === '*'))

          if (stream.isRootStream() && isMatchingSource) {
            await stream.processItem(data)
          }
        }
      }

      // NOTE: keyed streams and windowed streams receive data through parent subscriptions
      // They don't need direct processing here anymore

      // Process joins
      for (const join of this.joins) {
        const leftKey = (join.left as KeyedStreamImpl<unknown, string>).getKey(data)
        const rightKey = (join.right as KeyedStreamImpl<unknown, string>).getKey?.(data)

        // Check if this event matches left stream
        const leftSource = (join.left as KeyedStreamImpl<unknown, string>).parentStream?.source
        const leftSourceMatches =
          (leftSource?.entity === entity && leftSource?.event === event) ||
          (leftSource?.type === 'track' && entity === 'track' && leftSource?.event === event)
        if (leftSourceMatches) {
          join.leftBuffer.set(leftKey, join.leftBuffer.get(leftKey) ?? [])
          join.leftBuffer.get(leftKey)!.push({ data, timestamp })

          // Try to match with right buffer
          const rightMatches = join.rightBuffer.get(leftKey) ?? []
          for (const rightItem of rightMatches) {
            if (Math.abs(timestamp - rightItem.timestamp) <= join.window) {
              const result = join.mapper(data, rightItem.data)
              await join.output.processItem(result)
            }
          }
        }

        // Check if this event matches right stream
        const rightSource = (join.right as KeyedStreamImpl<unknown, string>).parentStream?.source
        const rightSourceMatches =
          (rightSource?.entity === entity && rightSource?.event === event) ||
          (rightSource?.type === 'track' && entity === 'track' && rightSource?.event === event)
        if (rightSourceMatches) {
          if (rightKey) {
            join.rightBuffer.set(rightKey, join.rightBuffer.get(rightKey) ?? [])
            join.rightBuffer.get(rightKey)!.push({ data, timestamp })

            // Try to match with left buffer
            const leftMatches = join.leftBuffer.get(rightKey) ?? []
            for (const leftItem of leftMatches) {
              if (Math.abs(timestamp - leftItem.timestamp) <= join.window) {
                const result = join.mapper(leftItem.data, data)
                await join.output.processItem(result)
              }
            }
          }
        }
      }

      // Process coGroups
      for (const coGroup of this.coGroups) {
        const leftKey = (coGroup.left as KeyedStreamImpl<unknown, string>).getKey(data)
        const rightKey = (coGroup.right as KeyedStreamImpl<unknown, string>).getKey?.(data)

        const leftSource = (coGroup.left as KeyedStreamImpl<unknown, string>).parentStream?.source
        const leftSourceMatches =
          (leftSource?.entity === entity && leftSource?.event === event) ||
          (leftSource?.type === 'track' && entity === 'track' && leftSource?.event === event)
        if (leftSourceMatches) {
          coGroup.leftBuffer.set(leftKey, coGroup.leftBuffer.get(leftKey) ?? [])
          coGroup.leftBuffer.get(leftKey)!.push({ data, timestamp })
        }

        const rightSource = (coGroup.right as KeyedStreamImpl<unknown, string>).parentStream?.source
        const rightSourceMatches =
          (rightSource?.entity === entity && rightSource?.event === event) ||
          (rightSource?.type === 'track' && entity === 'track' && rightSource?.event === event)
        if (rightSourceMatches) {
          if (rightKey) {
            coGroup.rightBuffer.set(rightKey, coGroup.rightBuffer.get(rightKey) ?? [])
            coGroup.rightBuffer.get(rightKey)!.push({ data, timestamp })
          }
        }
      }
    },
    get: (name: string) => this.namedStreams.get(name),
  }

  registerStream(stream: StreamImpl<unknown>): void {
    this.streams.push(stream)
  }

  registerKeyedStream(stream: KeyedStreamImpl<unknown, string>): void {
    this.keyedStreams.push(stream)
  }

  registerWindowedStream(stream: WindowedStreamImpl<unknown, string>): void {
    this.windowedStreams.push(stream)
  }

  registerAggregatedStream(stream: AggregatedStreamImpl<unknown, string>): void {
    this.aggregatedStreams.push(stream)
  }

  registerSinkStream(stream: StreamImpl<unknown>, type: string, name: string): void {
    const key = `${type}.${name}`
    if (!this.sinkStreams.has(key)) this.sinkStreams.set(key, [])
    this.sinkStreams.get(key)!.push(stream)
  }

  registerAggregatedSink(stream: AggregatedStreamImpl<unknown, string>, type: string, name: string): void {
    const key = `${type}.${name}`
    if (!this.aggregatedSinks.has(key)) this.aggregatedSinks.set(key, [])
    this.aggregatedSinks.get(key)!.push(stream)
  }

  registerJoin(
    left: KeyedStreamImpl<unknown, string>,
    right: KeyedStream<unknown, string>,
    window: number,
    joinType: 'inner' | 'left',
    mapper: (left: unknown, right: unknown) => unknown,
    output: StreamImpl<unknown>
  ): void {
    this.joins.push({
      left,
      right,
      window,
      joinType,
      mapper,
      output,
      leftBuffer: new Map(),
      rightBuffer: new Map(),
    })
  }

  registerCoGroup(
    left: KeyedStreamImpl<unknown, string>,
    right: KeyedStream<unknown, string>,
    window: number,
    mapper: (left: unknown[], right: unknown[]) => unknown,
    output: StreamImpl<unknown>
  ): void {
    this.coGroups.push({
      left,
      right,
      window,
      mapper,
      output,
      leftBuffer: new Map(),
      rightBuffer: new Map(),
    })
  }

  // Aggregation helpers
  count(): AggregateSpec {
    return { type: 'count' }
  }

  sum(field: string): AggregateSpec {
    return { type: 'sum', field }
  }

  avg(field: string): AggregateSpec {
    return { type: 'avg', field }
  }

  min(field: string): AggregateSpec {
    return { type: 'min', field }
  }

  max(field: string): AggregateSpec {
    return { type: 'max', field }
  }

  first(): AggregateSpec {
    return { type: 'first' }
  }

  last(): AggregateSpec {
    return { type: 'last' }
  }

  collect(): AggregateSpec {
    return { type: 'collect' }
  }

  distinct(field: string): AggregateSpec {
    return { type: 'distinct', field }
  }

  // Entity proxies
  Customer = this.createEntityProxy('Customer')
  Order = this.createEntityProxy('Order')
  Payment = this.createEntityProxy('Payment')

  private createEntityProxy(entityName: string): EntityProxy {
    return (id: string): EntityInstance => ({
      get: async () => {
        const storage = this._storage[entityName.toLowerCase() + 's'] ?? this._storage.customers
        return storage.get(id)
      },
      notify: async (payload: unknown) => {
        const handlers = this.entityActionHandlers.get(`${entityName}.notify`) ?? []
        for (const handler of handlers) {
          handler(id, payload)
        }
      },
    })
  }

  // View namespace
  view = new Proxy({} as ViewNamespace, {
    get: (_, viewName: string): ViewInstance => {
      if (!this.viewData.has(viewName)) {
        this.viewData.set(viewName, new Map())
      }
      const viewStore = this.viewData.get(viewName)!
      return {
        get: async (key: string) => viewStore.get(key),
        set: async (key: string, value: unknown) => viewStore.set(key, value),
      }
    },
  })

  // Trigger window processing (called when time advances)
  advanceTime(currentTime: number): void {
    for (const windowedStream of this.windowedStreams) {
      // Process aggregations BEFORE triggering window close (which deletes the state)
      const aggregateSpec = windowedStream.getAggregateSpec()
      const reduceSpec = windowedStream.getReduceSpec()
      const windowState = windowedStream.getWindowState()

      if (aggregateSpec || reduceSpec) {
        for (const [windowKey, state] of windowState.entries()) {
          const [key, windowId] = windowKey.split('|')
          let shouldClose = false
          let windowInfo: WindowInfo

          if (windowedStream.window.type === 'tumbling') {
            const size = windowedStream.window.size!
            const windowStart = parseInt(windowId)
            const windowEnd = windowStart + size
            windowInfo = { start: windowStart, end: windowEnd }
            shouldClose = currentTime >= windowEnd
          } else if (windowedStream.window.type === 'sliding') {
            const size = windowedStream.window.size!
            const slide = windowedStream.window.slide!
            const windowStart = parseInt(windowId)
            const windowEnd = windowStart + size
            windowInfo = { start: windowStart, end: windowEnd }
            shouldClose = currentTime >= windowEnd
          } else {
            const gap = windowedStream.window.gap!
            windowInfo = { start: state.lastTimestamp - gap, end: state.lastTimestamp + gap }
            shouldClose = currentTime >= state.lastTimestamp + gap
          }

          if (shouldClose) {
            let result: unknown

            if (aggregateSpec) {
              result = this.computeAggregation(aggregateSpec, state.elements, key)
            } else if (reduceSpec) {
              result = state.elements.reduce(
                (acc, item) => reduceSpec.reducer(acc, item),
                reduceSpec.initial
              )
            }

            // Emit to aggregated streams
            for (const aggStream of this.aggregatedStreams) {
              if (aggStream.getWindowedStream() === windowedStream) {
                aggStream.emitResult(result, key, windowInfo)

                // Handle sinks
                if (aggStream.sink?.type === 'measure') {
                  const handlers = this.measureHandlers.get(aggStream.sink.metric!) ?? []
                  const value = typeof result === 'object' ? (result as Record<string, number>).revenue ?? (result as Record<string, number>).count ?? 0 : 0
                  for (const handler of handlers) {
                    handler(value, { region: key })
                  }
                }

                if (aggStream.sink?.type === 'view') {
                  const viewName = aggStream.sink.view!
                  if (!this.viewData.has(viewName)) {
                    this.viewData.set(viewName, new Map())
                  }
                  this.viewData.get(viewName)!.set(key, result)
                }
              }
            }
          }
        }
      }

      // Trigger window close AFTER processing aggregations (this clears the state)
      windowedStream.triggerWindowClose(currentTime)
    }

    // Process left joins (emit unmatched left elements after window expires)
    for (const join of this.joins) {
      if (join.joinType === 'left') {
        for (const [key, leftItems] of join.leftBuffer.entries()) {
          const rightItems = join.rightBuffer.get(key) ?? []
          for (const leftItem of leftItems) {
            if (currentTime - leftItem.timestamp > join.window) {
              // Check if there was a match
              const hasMatch = rightItems.some(
                (r) => Math.abs(leftItem.timestamp - r.timestamp) <= join.window
              )
              if (!hasMatch) {
                const result = join.mapper(leftItem.data, null)
                join.output.processItem(result)
              }
            }
          }
        }
      }
    }

    // Process coGroups
    for (const coGroup of this.coGroups) {
      const allKeys = new Set([
        ...coGroup.leftBuffer.keys(),
        ...coGroup.rightBuffer.keys(),
      ])

      for (const key of allKeys) {
        const leftItems = coGroup.leftBuffer.get(key) ?? []
        const rightItems = coGroup.rightBuffer.get(key) ?? []

        // Check if any items are past the window
        const expiredLeft = leftItems.filter((i) => currentTime - i.timestamp > coGroup.window)
        const expiredRight = rightItems.filter((i) => currentTime - i.timestamp > coGroup.window)

        if (expiredLeft.length > 0 || expiredRight.length > 0) {
          const result = coGroup.mapper(
            leftItems.map((i) => i.data),
            rightItems.map((i) => i.data)
          )
          coGroup.output.processItem(result)

          // Clear processed items
          coGroup.leftBuffer.delete(key)
          coGroup.rightBuffer.delete(key)
        }
      }
    }
  }

  private computeAggregation(
    spec: Record<string, AggregateSpec>,
    elements: unknown[],
    key: string
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { key }

    for (const [name, aggSpec] of Object.entries(spec)) {
      switch (aggSpec.type) {
        case 'count':
          result[name] = elements.length
          break
        case 'sum':
          result[name] = elements.reduce(
            (sum, el) => sum + ((el as Record<string, number>)[aggSpec.field!] ?? 0),
            0
          )
          break
        case 'avg':
          result[name] =
            elements.length > 0
              ? elements.reduce((sum, el) => sum + ((el as Record<string, number>)[aggSpec.field!] ?? 0), 0) /
                elements.length
              : 0
          break
        case 'min':
          result[name] = Math.min(
            ...elements.map((el) => (el as Record<string, number>)[aggSpec.field!] ?? Infinity)
          )
          break
        case 'max':
          result[name] = Math.max(
            ...elements.map((el) => (el as Record<string, number>)[aggSpec.field!] ?? -Infinity)
          )
          break
        case 'first':
          result[name] = elements[0]
          break
        case 'last':
          result[name] = elements[elements.length - 1]
          break
        case 'collect':
          result[name] = [...elements]
          break
        case 'distinct':
          result[name] = new Set(
            elements.map((el) => (el as Record<string, unknown>)[aggSpec.field!])
          ).size
          break
      }
    }

    return result
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createStreamContext(): StreamContext {
  const ctx = new StreamContextImpl()
  return ctx
}
