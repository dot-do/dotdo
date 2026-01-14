/**
 * Stream - Real-time stream processing for workflows
 *
 * Provides Flink-inspired streaming capabilities:
 * - $.stream.from.Entity.event - Domain event streams
 * - $.stream.from.track.Event - Tracked event streams
 * - $.stream.from.measure.Metric - Measurement streams
 * - Transformations: filter(), map(), enrich(), flatMap()
 * - Keyed streams via keyBy()
 * - Windowing: tumbling, sliding, session
 * - Aggregations within windows
 * - Stream joins with temporal constraints
 * - Sinks to track, measure, and view
 *
 * @module workflows/data/stream
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Aggregation function specification
 */
export interface AggregateSpec {
  type: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'first' | 'last' | 'collect' | 'distinct'
  field?: string
}

/**
 * Window specification
 */
export interface WindowSpec {
  type: 'tumbling' | 'sliding' | 'session'
  size?: number
  slide?: number
  gap?: number
}

/**
 * Window info metadata
 */
export interface WindowInfo {
  start: number
  end: number
}

/**
 * Stream source descriptor
 */
export interface StreamSource {
  type?: 'domain' | 'track' | 'measure'
  entity?: string
  event?: string
  metric?: string
}

/**
 * Stream sink descriptor
 */
export interface StreamSinkDescriptor {
  type: 'track' | 'measure' | 'view'
  event?: string
  metric?: string
  view?: string
}

/**
 * Base stream interface
 */
export interface Stream<T> {
  type: 'stream'
  source: StreamSource
  sink?: StreamSinkDescriptor

  filter(predicate: (element: T) => boolean | Promise<boolean>): Stream<T>
  map<U>(mapper: (element: T) => U | Promise<U>): Stream<U>
  enrich<U>(enricher: (element: T, context: StreamContext) => U | Promise<U>): Stream<U>
  flatMap<U>(mapper: (element: T) => U[] | Promise<U[]>): Stream<U>

  keyBy<K extends keyof T>(field: K): KeyedStream<T, string>
  keyBy(selector: (element: T) => string): KeyedStream<T, string>

  window: WindowBuilder<T, '__global__'>

  subscribe(callback: (element: T) => void): () => void
  forEach(fn: (element: T) => void | Promise<void>): Stream<T>

  flush(): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  isRunning(): boolean
  name(name: string): Stream<T>
  getName(): string | undefined

  onError(handler: (error: Error) => void): Stream<T>
  deadLetter(handler: (element: T, error: Error) => void): Stream<T>
  retry(count: number): Stream<T>

  buffer(capacity: number, options?: { strategy: 'dropOldest' | 'dropNewest' }): Stream<T>
  bufferCapacity?: number
  bufferStrategy?: 'dropOldest' | 'dropNewest'
  throttle(duration: string | number): Stream<T>

  to: SinkBuilder<T>
}

/**
 * Keyed stream interface
 */
export interface KeyedStream<T, K extends string> {
  type: 'keyed-stream'
  keySelector: string | ((element: T) => string)
  source: StreamSource

  window: WindowBuilder<T, K>

  join<U>(other: KeyedStream<U, K>): JoinBuilder<T, U, K>
  leftJoin<U>(other: KeyedStream<U, K>): LeftJoinBuilder<T, U, K>
  coGroup<U>(other: KeyedStream<U, K>): CoGroupBuilder<T, U, K>

  subscribe(callback: (element: T, key: K) => void): () => void
  flush(): Promise<void>
}

/**
 * Windowed stream interface
 */
export interface WindowedStream<T, K extends string> {
  type: 'windowed-stream'
  window: WindowSpec
  key?: K

  aggregate<R extends Record<string, AggregateSpec>>(
    specs: R
  ): AggregatedStream<{ [P in keyof R]: number } & { key: K }, K>
  reduce<A>(reducer: (acc: A, element: T) => A, initial: A): Stream<A>

  onWindowClose(callback: (key: K, elements: T[], windowInfo: WindowInfo) => void): void

  flush(): Promise<void>
}

/**
 * Aggregated stream interface
 */
export interface AggregatedStream<T, K extends string> {
  type: 'stream'

  subscribe(callback: (result: T, key: K, windowInfo: WindowInfo) => void): () => void
  map<U>(mapper: (element: T) => U): Stream<U>
  flush(): Promise<void>

  to: SinkBuilder<T>
  sink?: StreamSinkDescriptor
}

/**
 * Joined stream interface
 */
export interface JoinedStream<T, U, K extends string> {
  type: 'joined-stream'
  window?: number

  within(duration: string | number): JoinedStream<T, U, K>
  on<R>(mapper: (left: T, right: U) => R): Stream<R>
  flush(): Promise<void>
}

/**
 * Left join builder
 */
export interface LeftJoinBuilder<T, U, K extends string> {
  within(duration: string | number): LeftJoinBuilder<T, U, K>
  on<R>(mapper: (left: T, right: U | null) => R): Stream<R>
}

/**
 * CoGroup builder
 */
export interface CoGroupBuilder<T, U, K extends string> {
  within(duration: string | number): CoGroupBuilder<T, U, K>
  apply<R>(fn: (leftGroup: T[], rightGroup: U[]) => R): Stream<R>
  flush(): Promise<void>
}

/**
 * Join builder interface
 */
export interface JoinBuilder<T, U, K extends string> {
  within(duration: string | number): JoinedStream<T, U, K>
  on<R>(mapper: (left: T, right: U) => R): Stream<R>
}

/**
 * Window builder interface
 */
export interface WindowBuilder<T, K extends string> {
  tumbling(duration: string | number): WindowedStream<T, K>
  sliding(size: string | number, slide: string | number): WindowedStream<T, K>
  session(gap: string | number): WindowedStream<T, K>
}

/**
 * Sink builder interface
 */
export interface SinkBuilder<T> {
  track: Record<string, Stream<T> & { sink: StreamSinkDescriptor }>
  measure: Record<string, Stream<T> & { sink: StreamSinkDescriptor }>
  view: Record<string, Stream<T> & { sink: StreamSinkDescriptor }>
}

/**
 * Stream context interface
 */
export interface StreamContext {
  stream: StreamNamespace & {
    emit(entity: string, event: string, data: unknown): Promise<void>
    get(name: string): Stream<unknown> | undefined
  }

  count(): AggregateSpec
  sum(field: string): AggregateSpec
  avg(field: string): AggregateSpec
  min(field: string): AggregateSpec
  max(field: string): AggregateSpec
  first(): AggregateSpec
  last(): AggregateSpec
  collect(): AggregateSpec
  distinct(field: string): AggregateSpec

  Customer: EntityProxy
  Order: EntityProxy
  [key: string]: unknown

  view: ViewNamespace

  _hooks: {
    onTrack(event: string, callback: (data: unknown) => void): void
    onMeasure(metric: string, callback: (value: number, labels: Record<string, string>) => void): void
    onEntityAction(entity: string, action: string, callback: (id: string, payload: unknown) => void): void
  }

  _storage: {
    customers: Map<string, unknown>
  }
}

/**
 * Entity proxy for RPC-style calls
 */
export interface EntityProxy {
  (id: string): {
    get(): Promise<unknown>
    notify(payload: unknown): Promise<void>
    [key: string]: (payload?: unknown) => Promise<unknown>
  }
}

/**
 * View namespace
 */
export interface ViewNamespace {
  [key: string]: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
  }
}

/**
 * Stream namespace interface
 */
export interface StreamNamespace {
  from: StreamFromProxy
}

/**
 * Proxy for $.stream.from.Entity.event pattern
 */
export type StreamFromProxy = {
  track: Record<string, Stream<unknown>>
  measure: Record<string, Stream<unknown>>
  [entity: string]: Record<string, Stream<unknown>>
}

// ============================================================================
// UTILITIES
// ============================================================================

function parseDuration(duration: string | number): number {
  if (typeof duration === 'number') return duration

  const match = duration.match(/^(\d+)(ms|s|m|h|d)$/)
  if (!match) throw new Error(`Invalid duration: ${duration}`)

  const value = parseInt(match[1], 10)
  const unit = match[2]

  switch (unit) {
    case 'ms':
      return value
    case 's':
      return value * 1000
    case 'm':
      return value * 60 * 1000
    case 'h':
      return value * 60 * 60 * 1000
    case 'd':
      return value * 24 * 60 * 60 * 1000
    default:
      throw new Error(`Unknown unit: ${unit}`)
  }
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

interface StreamState<T> {
  subscribers: Set<(element: T, key?: string) => void>
  elements: T[]
  running: boolean
  explicitlyStarted: boolean // Whether start()/stop() was explicitly called
  name?: string
  errorHandler?: (error: Error) => void
  deadLetterHandler?: (element: T, error: Error) => void
  retryCount: number
  bufferCapacity?: number
  bufferStrategy?: 'dropOldest' | 'dropNewest'
  throttleMs?: number
  lastEmitTime?: number
}

interface WindowState<T> {
  elements: Map<string, T[]>
  windowCallbacks: Array<(key: string, elements: T[], windowInfo: WindowInfo) => void>
  aggregateCallbacks: Set<(result: unknown, key: string, windowInfo: WindowInfo) => void>
  currentWindowStart: number
}

export function createStreamContext(): StreamContext {
  const eventBus = new Map<string, Set<(data: unknown) => void>>()
  const namedStreams = new Map<string, Stream<unknown>>()
  const trackHooks = new Map<string, Set<(data: unknown) => void>>()
  const measureHooks = new Map<string, Set<(value: number, labels: Record<string, string>) => void>>()
  const entityActionHooks = new Map<string, Set<(id: string, payload: unknown) => void>>()
  const viewStorage = new Map<string, Map<string, unknown>>()
  const customerStorage = new Map<string, unknown>()

  function createSinkBuilder<T>(
    stream: Stream<T>,
    source: StreamSource,
  ): SinkBuilder<T> {
    return {
      track: new Proxy({} as Record<string, Stream<T> & { sink: StreamSinkDescriptor }>, {
        get(_, eventName: string) {
          const sinkStream = { ...stream, sink: { type: 'track' as const, event: eventName } }
          stream.subscribe((element) => {
            const hooks = trackHooks.get(eventName)
            if (hooks) {
              for (const hook of hooks) {
                hook(element)
              }
            }
          })
          return sinkStream
        },
      }),
      measure: new Proxy({} as Record<string, Stream<T> & { sink: StreamSinkDescriptor }>, {
        get(_, metricName: string) {
          const sinkStream = { ...stream, sink: { type: 'measure' as const, metric: metricName } }
          stream.subscribe((element) => {
            const hooks = measureHooks.get(metricName)
            if (hooks) {
              const value = typeof element === 'number' ? element : 0
              for (const hook of hooks) {
                hook(value, {})
              }
            }
          })
          return sinkStream
        },
      }),
      view: new Proxy({} as Record<string, Stream<T> & { sink: StreamSinkDescriptor }>, {
        get(_, viewName: string) {
          const sinkStream = { ...stream, sink: { type: 'view' as const, view: viewName } }
          return sinkStream
        },
      }),
    }
  }

  function createAggregatedSinkBuilder<T>(
    aggregateCallbacks: Set<(result: unknown, key: string, windowInfo: WindowInfo) => void>,
    keyField: string,
    flushFn?: () => Promise<void>
  ): SinkBuilder<T> {
    const createStreamWithFlush = (sink: StreamSinkDescriptor): Stream<T> & { sink: StreamSinkDescriptor } => ({
      type: 'stream',
      source: {},
      sink,
      filter: () => { throw new Error('Not supported on sink stream') },
      map: () => { throw new Error('Not supported on sink stream') },
      enrich: () => { throw new Error('Not supported on sink stream') },
      flatMap: () => { throw new Error('Not supported on sink stream') },
      keyBy: () => { throw new Error('Not supported on sink stream') },
      window: {} as WindowBuilder<T, '__global__'>,
      subscribe: () => () => {},
      forEach: () => { throw new Error('Not supported on sink stream') },
      flush: flushFn || (async () => {}),
      start: async () => {},
      stop: async () => {},
      isRunning: () => true,
      name: () => { throw new Error('Not supported on sink stream') },
      getName: () => undefined,
      onError: () => { throw new Error('Not supported on sink stream') },
      deadLetter: () => { throw new Error('Not supported on sink stream') },
      retry: () => { throw new Error('Not supported on sink stream') },
      buffer: () => { throw new Error('Not supported on sink stream') },
      throttle: () => { throw new Error('Not supported on sink stream') },
      get to() { throw new Error('Not supported on sink stream') },
    } as Stream<T> & { sink: StreamSinkDescriptor })

    return {
      track: new Proxy({} as Record<string, Stream<T> & { sink: StreamSinkDescriptor }>, {
        get(_, eventName: string) {
          aggregateCallbacks.add((result) => {
            const hooks = trackHooks.get(eventName)
            if (hooks) {
              for (const hook of hooks) {
                hook(result)
              }
            }
          })
          return createStreamWithFlush({ type: 'track' as const, event: eventName })
        },
      }),
      measure: new Proxy({} as Record<string, Stream<T> & { sink: StreamSinkDescriptor }>, {
        get(_, metricName: string) {
          aggregateCallbacks.add((result, key) => {
            const hooks = measureHooks.get(metricName)
            if (hooks) {
              const value =
                typeof result === 'object' && result !== null
                  ? (result as Record<string, number>).revenue ||
                    Object.values(result as Record<string, number>).find((v) => typeof v === 'number') ||
                    0
                  : 0
              const labels: Record<string, string> = {}
              if (keyField !== '__global__') {
                labels[keyField] = key
              }
              for (const hook of hooks) {
                hook(value, labels)
              }
            }
          })
          return createStreamWithFlush({ type: 'measure' as const, metric: metricName })
        },
      }),
      view: new Proxy({} as Record<string, Stream<T> & { sink: StreamSinkDescriptor }>, {
        get(_, viewName: string) {
          if (!viewStorage.has(viewName)) {
            viewStorage.set(viewName, new Map())
          }
          aggregateCallbacks.add((result, key) => {
            viewStorage.get(viewName)!.set(key, result)
          })
          return createStreamWithFlush({ type: 'view' as const, view: viewName })
        },
      }),
    }
  }

  function createStream<T>(source: StreamSource): Stream<T> {
    const state: StreamState<T> = {
      subscribers: new Set(),
      elements: [],
      running: false,
      explicitlyStarted: false,
      retryCount: 0,
    }

    const pipeline: Array<{
      type: 'filter' | 'map' | 'enrich' | 'flatMap' | 'forEach'
      fn: (element: unknown, ctx?: StreamContext) => unknown
    }> = []

    const eventKey = `${source.entity || source.type}:${source.event || source.metric || '*'}`
    let eventSubscribers = eventBus.get(eventKey)
    if (!eventSubscribers) {
      eventSubscribers = new Set()
      eventBus.set(eventKey, eventSubscribers)
    }

    const processElement = async (element: unknown): Promise<void> => {
      // If explicitly stopped, don't process
      if (state.explicitlyStarted && !state.running) return

      // Process if we have subscribers, error handlers, or any pipeline stages
      const hasHandlers = state.subscribers.size > 0 || state.errorHandler || state.deadLetterHandler || pipeline.length > 0
      if (!state.running && !hasHandlers) return

      if (state.throttleMs) {
        const now = Date.now()
        if (state.lastEmitTime && now - state.lastEmitTime < state.throttleMs) {
          return
        }
        state.lastEmitTime = now
      }

      if (state.bufferCapacity && state.bufferStrategy === 'dropNewest') {
        if (state.elements.length >= state.bufferCapacity) {
          return
        }
      }

      let current: unknown = element
      let attempts = 0
      const maxAttempts = state.retryCount > 0 ? state.retryCount + 1 : 1

      while (attempts < maxAttempts) {
        attempts++
        current = element

        try {
          for (const stage of pipeline) {
            if (current === undefined) break

            if (stage.type === 'filter') {
              const result = await (stage.fn as (e: unknown) => boolean | Promise<boolean>)(current)
              if (!result) {
                current = undefined
                break
              }
            } else if (stage.type === 'map' || stage.type === 'enrich') {
              current = await stage.fn(current, context)
            } else if (stage.type === 'flatMap') {
              const results = (await stage.fn(current)) as unknown[]
              for (const result of results) {
                for (const subscriber of state.subscribers) {
                  subscriber(result as T)
                }
              }
              current = undefined
              break
            } else if (stage.type === 'forEach') {
              await stage.fn(current)
            }
          }

          break
        } catch (error) {
          if (attempts >= maxAttempts) {
            if (state.deadLetterHandler) {
              state.deadLetterHandler(element as T, error as Error)
            } else if (state.errorHandler) {
              state.errorHandler(error as Error)
            }
            return
          }
        }
      }

      if (current !== undefined) {
        if (state.bufferCapacity && state.bufferStrategy !== 'dropNewest') {
          if (state.elements.length >= state.bufferCapacity) {
            state.elements.shift()
          }
        }

        state.elements.push(current as T)
        for (const subscriber of state.subscribers) {
          subscriber(current as T)
        }
      }
    }

    eventSubscribers.add(processElement)

    if (source.entity === '*' || source.event === '*') {
      for (const [key, subscribers] of eventBus) {
        if (source.entity === '*' && key.endsWith(`:${source.event}`)) {
          subscribers.add(processElement)
        } else if (source.event === '*' && key.startsWith(`${source.entity}:`)) {
          subscribers.add(processElement)
        }
      }
    }

    const stream: Stream<T> = {
      type: 'stream',
      source: Object.freeze({ ...source }),

      filter(predicate) {
        pipeline.push({ type: 'filter', fn: predicate as (e: unknown) => boolean })
        return stream
      },

      map<U>(mapper: (element: T) => U | Promise<U>): Stream<U> {
        pipeline.push({ type: 'map', fn: mapper as (e: unknown) => unknown })
        return stream as unknown as Stream<U>
      },

      enrich<U>(enricher: (element: T, ctx: StreamContext) => U | Promise<U>): Stream<U> {
        pipeline.push({ type: 'enrich', fn: enricher as (e: unknown, ctx?: StreamContext) => unknown })
        return stream as unknown as Stream<U>
      },

      flatMap<U>(mapper: (element: T) => U[] | Promise<U[]>): Stream<U> {
        pipeline.push({ type: 'flatMap', fn: mapper as (e: unknown) => unknown })
        return stream as unknown as Stream<U>
      },

      keyBy<K extends keyof T>(fieldOrSelector: K | ((element: T) => string)): KeyedStream<T, string> {
        return createKeyedStream(source, fieldOrSelector as string | ((e: T) => string), state, pipeline)
      },

      window: createWindowBuilder(source, '__global__', state),

      subscribe(callback) {
        state.subscribers.add(callback)
        return () => state.subscribers.delete(callback)
      },

      forEach(fn) {
        pipeline.push({ type: 'forEach', fn: fn as (e: unknown) => void })
        return stream
      },

      async flush() {
        await Promise.resolve()
      },

      async start() {
        state.running = true
        state.explicitlyStarted = true
      },

      async stop() {
        state.running = false
        state.explicitlyStarted = true
      },

      isRunning() {
        return state.running
      },

      name(n) {
        state.name = n
        namedStreams.set(n, stream as Stream<unknown>)
        return stream
      },

      getName() {
        return state.name
      },

      onError(handler) {
        state.errorHandler = handler
        return stream
      },

      deadLetter(handler) {
        state.deadLetterHandler = handler
        return stream
      },

      retry(count) {
        state.retryCount = count
        return stream
      },

      buffer(capacity, options) {
        state.bufferCapacity = capacity
        state.bufferStrategy = options?.strategy || 'dropOldest'
        ;(stream as Stream<T>).bufferCapacity = capacity
        ;(stream as Stream<T>).bufferStrategy = state.bufferStrategy
        return stream
      },

      throttle(duration) {
        state.throttleMs = parseDuration(duration)
        return stream
      },

      get to() {
        return createSinkBuilder(stream, source)
      },
    }

    return stream
  }

  function createKeyedStream<T>(
    source: StreamSource,
    keySelector: string | ((element: T) => string),
    parentState: StreamState<T>,
    pipeline: Array<{ type: string; fn: (element: unknown, context?: StreamContext) => unknown }>
  ): KeyedStream<T, string> {
    const keyedSubscribers = new Set<(element: T, key: string) => void>()
    const keyedElements = new Map<string, T[]>()

    const getKey = (element: T): string => {
      if (typeof keySelector === 'function') {
        return keySelector(element)
      }
      return String((element as Record<string, unknown>)[keySelector])
    }

    const originalSubscribers = [...parentState.subscribers]
    parentState.subscribers.clear()

    parentState.subscribers.add((element: T) => {
      const key = getKey(element)
      if (!keyedElements.has(key)) {
        keyedElements.set(key, [])
      }
      keyedElements.get(key)!.push(element)

      for (const subscriber of keyedSubscribers) {
        subscriber(element, key)
      }
      for (const subscriber of originalSubscribers) {
        subscriber(element)
      }
    })

    const keyedStream: KeyedStream<T, string> = {
      type: 'keyed-stream',
      keySelector,
      source,

      window: createWindowBuilder(source, keySelector, parentState, getKey),

      join<U>(other: KeyedStream<U, string>) {
        return createJoinBuilder<T, U>(keyedStream, other, keyedElements)
      },

      leftJoin<U>(other: KeyedStream<U, string>) {
        return createLeftJoinBuilder<T, U>(keyedStream, other, keyedElements)
      },

      coGroup<U>(other: KeyedStream<U, string>) {
        return createCoGroupBuilder<T, U>(keyedStream, other)
      },

      subscribe(callback) {
        keyedSubscribers.add(callback)
        return () => keyedSubscribers.delete(callback)
      },

      async flush() {
        await Promise.resolve()
      },
    }

    return keyedStream
  }

  function createWindowBuilder<T, K extends string>(
    source: StreamSource,
    keySelector: string | ((element: T) => string),
    parentState: StreamState<T>,
    getKeyFn?: (element: T) => string
  ): WindowBuilder<T, K> {
    return {
      tumbling(duration: string | number): WindowedStream<T, K> {
        return createWindowedStream(
          source,
          { type: 'tumbling', size: parseDuration(duration) },
          keySelector,
          parentState,
          getKeyFn
        )
      },

      sliding(size: string | number, slide: string | number): WindowedStream<T, K> {
        const sizeMs = parseDuration(size)
        const slideMs = parseDuration(slide)
        if (slideMs > sizeMs) {
          throw new Error('Slide must be less than or equal to size')
        }
        return createWindowedStream(
          source,
          { type: 'sliding', size: sizeMs, slide: slideMs },
          keySelector,
          parentState,
          getKeyFn
        )
      },

      session(gap: string | number): WindowedStream<T, K> {
        return createWindowedStream(
          source,
          { type: 'session', gap: parseDuration(gap) },
          keySelector,
          parentState,
          getKeyFn
        )
      },
    }
  }

  function createWindowedStream<T, K extends string>(
    source: StreamSource,
    windowSpec: WindowSpec,
    keySelector: string | ((element: T) => string),
    parentState: StreamState<T>,
    getKeyFn?: (element: T) => string
  ): WindowedStream<T, K> {
    const windowState: WindowState<T> = {
      elements: new Map(),
      windowCallbacks: [],
      aggregateCallbacks: new Set(),
      currentWindowStart: Date.now(),
    }

    const getKey = getKeyFn || ((element: T): string => {
      if (keySelector === '__global__') return '__global__'
      if (typeof keySelector === 'function') return keySelector(element)
      return String((element as Record<string, unknown>)[keySelector as string])
    })

    const getTimestamp = (element: T): number => {
      if (typeof element === 'object' && element !== null && 'timestamp' in element) {
        return (element as { timestamp: number }).timestamp
      }
      return Date.now()
    }

    const activeWindows = new Map<string, Map<number, T[]>>()
    const sessionLastActivity = new Map<string, number>()
    const sessionElements = new Map<string, T[]>()

    let aggregateSpecs: Record<string, AggregateSpec> | null = null
    let reduceState: { reducer: (acc: unknown, element: T) => unknown; initial: unknown } | null = null

    const computeAggregates = (elements: T[], specs: Record<string, AggregateSpec>): Record<string, number> => {
      const result: Record<string, number> = {}

      for (const [name, spec] of Object.entries(specs)) {
        switch (spec.type) {
          case 'count':
            result[name] = elements.length
            break
          case 'sum':
            result[name] = elements.reduce(
              (sum, e) => sum + ((e as Record<string, number>)[spec.field!] || 0),
              0
            )
            break
          case 'avg': {
            const sum = elements.reduce(
              (s, e) => s + ((e as Record<string, number>)[spec.field!] || 0),
              0
            )
            result[name] = elements.length > 0 ? sum / elements.length : 0
            break
          }
          case 'min':
            result[name] = Math.min(
              ...elements.map((e) => (e as Record<string, number>)[spec.field!] || Infinity)
            )
            break
          case 'max':
            result[name] = Math.max(
              ...elements.map((e) => (e as Record<string, number>)[spec.field!] || -Infinity)
            )
            break
        }
      }

      return result
    }

    const emitAggregations = (key: string, elements: T[], windowInfo: WindowInfo) => {
      if (aggregateSpecs) {
        const result = computeAggregates(elements, aggregateSpecs)
        ;(result as Record<string, unknown>).key = key
        for (const callback of windowState.aggregateCallbacks) {
          callback(result, key, windowInfo)
        }
      }
      if (reduceState) {
        let acc = reduceState.initial
        for (const element of elements) {
          acc = reduceState.reducer(acc, element)
        }
        for (const callback of windowState.aggregateCallbacks) {
          callback(acc, key, windowInfo)
        }
      }
    }

    const checkWindowClose = () => {
      const now = Date.now()

      if (windowSpec.type === 'tumbling') {
        const windowSize = windowSpec.size!
        const windowEnd = windowState.currentWindowStart + windowSize

        if (now >= windowEnd) {
          for (const [key, elements] of windowState.elements) {
            if (elements.length > 0) {
              const windowInfo = {
                start: windowState.currentWindowStart,
                end: windowEnd,
              }

              for (const callback of windowState.windowCallbacks) {
                callback(key, [...elements], windowInfo)
              }

              emitAggregations(key, elements, windowInfo)
            }
          }

          windowState.elements.clear()
          windowState.currentWindowStart = windowEnd
        }
      } else if (windowSpec.type === 'sliding') {
        for (const [key, keyWindows] of activeWindows) {
          for (const [windowStart, elements] of keyWindows) {
            const windowEnd = windowStart + windowSpec.size!
            if (now >= windowEnd) {
              const windowInfo = { start: windowStart, end: windowEnd }

              for (const callback of windowState.windowCallbacks) {
                callback(key, [...elements], windowInfo)
              }

              emitAggregations(key, elements, windowInfo)

              keyWindows.delete(windowStart)
            }
          }
        }
      } else if (windowSpec.type === 'session') {
        const gap = windowSpec.gap!

        for (const [key, lastActivity] of sessionLastActivity) {
          if (now - lastActivity > gap && sessionElements.has(key) && sessionElements.get(key)!.length > 0) {
            const elements = sessionElements.get(key)!
            const firstTimestamp = getTimestamp(elements[0])
            const lastTimestamp = getTimestamp(elements[elements.length - 1])
            const windowInfo = { start: firstTimestamp, end: lastTimestamp + gap }

            for (const callback of windowState.windowCallbacks) {
              callback(key, [...elements], windowInfo)
            }

            emitAggregations(key, elements, windowInfo)

            sessionElements.set(key, [])
          }
        }
      }
    }

    parentState.subscribers.add((element: T) => {
      const key = getKey(element)
      const timestamp = getTimestamp(element)

      if (windowSpec.type === 'tumbling') {
        if (!windowState.elements.has(key)) {
          windowState.elements.set(key, [])
        }
        windowState.elements.get(key)!.push(element)
      } else if (windowSpec.type === 'sliding') {
        if (!activeWindows.has(key)) {
          activeWindows.set(key, new Map())
        }
        const keyWindows = activeWindows.get(key)!

        const windowSize = windowSpec.size!
        const slide = windowSpec.slide!
        const windowStart = Math.floor(timestamp / slide) * slide

        for (let ws = windowStart - windowSize + slide; ws <= windowStart; ws += slide) {
          if (ws < 0) continue
          if (!keyWindows.has(ws)) {
            keyWindows.set(ws, [])
          }
          keyWindows.get(ws)!.push(element)
        }

        if (!windowState.elements.has(key)) {
          windowState.elements.set(key, [])
        }
        windowState.elements.get(key)!.push(element)
      } else if (windowSpec.type === 'session') {
        const lastActivity = sessionLastActivity.get(key) || 0
        const gap = windowSpec.gap!

        if (timestamp - lastActivity > gap && sessionElements.has(key) && sessionElements.get(key)!.length > 0) {
          const sessionElems = sessionElements.get(key)!
          const firstTimestamp = getTimestamp(sessionElems[0])
          const lastTimestamp = getTimestamp(sessionElems[sessionElems.length - 1])

          for (const callback of windowState.windowCallbacks) {
            callback(key, [...sessionElems], { start: firstTimestamp, end: lastTimestamp + gap })
          }

          emitAggregations(key, sessionElems, { start: firstTimestamp, end: lastTimestamp + gap })

          sessionElements.set(key, [])
        }

        if (!sessionElements.has(key)) {
          sessionElements.set(key, [])
        }
        sessionElements.get(key)!.push(element)
        sessionLastActivity.set(key, timestamp)
      }
    })

    const windowedStream: WindowedStream<T, K> = {
      type: 'windowed-stream',
      window: windowSpec,
      key: (typeof keySelector === 'string' && keySelector !== '__global__' ? keySelector : undefined) as K | undefined,

      aggregate<R extends Record<string, AggregateSpec>>(specs: R) {
        aggregateSpecs = specs

        const aggregatedStream: AggregatedStream<{ [P in keyof R]: number } & { key: K }, K> = {
          type: 'stream',
          sink: undefined,

          subscribe(callback) {
            windowState.aggregateCallbacks.add(callback as (result: unknown, key: string, windowInfo: WindowInfo) => void)
            return () => windowState.aggregateCallbacks.delete(callback as (result: unknown, key: string, windowInfo: WindowInfo) => void)
          },

          map<U>(mapper: (element: { [P in keyof R]: number } & { key: K }) => U): Stream<U> {
            const mapState: StreamState<U> = {
              subscribers: new Set(),
              elements: [],
              running: true,
              retryCount: 0,
            }

            windowState.aggregateCallbacks.add((result) => {
              const mapped = mapper(result as { [P in keyof R]: number } & { key: K })
              for (const subscriber of mapState.subscribers) {
                subscriber(mapped)
              }
            })

            return {
              type: 'stream',
              source,
              subscribe: (cb) => {
                mapState.subscribers.add(cb)
                return () => mapState.subscribers.delete(cb)
              },
              flush: async () => { await Promise.resolve() },
            } as Stream<U>
          },

          async flush() {
            checkWindowClose()
            await Promise.resolve()
          },

          get to() {
            return createAggregatedSinkBuilder(
              windowState.aggregateCallbacks,
              keySelector === '__global__' ? '__global__' : keySelector as string
            )
          },
        }

        return aggregatedStream
      },

      reduce<A>(reducer: (acc: A, element: T) => A, initial: A): Stream<A> {
        reduceState = { reducer: reducer as (acc: unknown, element: T) => unknown, initial }

        const reduceSubscribers = new Set<(result: A) => void>()

        windowState.aggregateCallbacks.add((result) => {
          for (const subscriber of reduceSubscribers) {
            subscriber(result as A)
          }
        })

        return {
          type: 'stream',
          source,
          subscribe(callback) {
            reduceSubscribers.add(callback)
            return () => reduceSubscribers.delete(callback)
          },
          async flush() {
            checkWindowClose()
          },
        } as Stream<A>
      },

      onWindowClose(callback) {
        windowState.windowCallbacks.push(callback as (key: string, elements: T[], windowInfo: WindowInfo) => void)
      },

      async flush() {
        checkWindowClose()
        await Promise.resolve()
      },
    }

    return windowedStream
  }

  function createJoinBuilder<T, U>(
    left: KeyedStream<T, string>,
    right: KeyedStream<U, string>,
    leftElements: Map<string, T[]>
  ): JoinBuilder<T, U, string> {
    let windowMs: number | undefined
    const rightElements = new Map<string, U[]>()

    right.subscribe((element, key) => {
      if (!rightElements.has(key)) {
        rightElements.set(key, [])
      }
      rightElements.get(key)!.push(element)
    })

    const getTimestamp = (element: unknown): number => {
      if (typeof element === 'object' && element !== null && 'timestamp' in element) {
        return (element as { timestamp: number }).timestamp
      }
      return Date.now()
    }

    return {
      within(duration): JoinedStream<T, U, string> {
        windowMs = parseDuration(duration)

        const joinedStream: JoinedStream<T, U, string> = {
          type: 'joined-stream',
          window: windowMs,

          within(d) {
            windowMs = parseDuration(d)
            ;(joinedStream as JoinedStream<T, U, string>).window = windowMs
            return joinedStream
          },

          on<R>(mapper: (l: T, r: U) => R): Stream<R> {
            const resultSubscribers = new Set<(result: R) => void>()
            const results: R[] = []

            left.subscribe((leftElem, key) => {
              const rights = rightElements.get(key) || []
              const leftTs = getTimestamp(leftElem)

              for (const rightElem of rights) {
                const rightTs = getTimestamp(rightElem)
                if (windowMs && Math.abs(leftTs - rightTs) > windowMs) continue

                const result = mapper(leftElem, rightElem)
                results.push(result)
                for (const subscriber of resultSubscribers) {
                  subscriber(result)
                }
              }
            })

            right.subscribe((rightElem, key) => {
              const lefts = leftElements.get(key) || []
              const rightTs = getTimestamp(rightElem)

              for (const leftElem of lefts) {
                const leftTs = getTimestamp(leftElem)
                if (windowMs && Math.abs(leftTs - rightTs) > windowMs) continue

                const result = mapper(leftElem, rightElem)
                if (!results.some((r) => JSON.stringify(r) === JSON.stringify(result))) {
                  results.push(result)
                  for (const subscriber of resultSubscribers) {
                    subscriber(result)
                  }
                }
              }
            })

            return {
              type: 'stream',
              source: left.source,
              subscribe(callback) {
                resultSubscribers.add(callback)
                return () => resultSubscribers.delete(callback)
              },
              async flush() {
                await Promise.resolve()
              },
            } as Stream<R>
          },

          async flush() {
            await Promise.resolve()
          },
        }

        return joinedStream
      },

      on<R>(mapper: (l: T, r: U) => R): Stream<R> {
        return this.within(Infinity).on(mapper)
      },
    }
  }

  function createLeftJoinBuilder<T, U>(
    left: KeyedStream<T, string>,
    right: KeyedStream<U, string>,
    leftElements: Map<string, T[]>
  ): LeftJoinBuilder<T, U, string> {
    let windowMs: number | undefined
    const rightElements = new Map<string, U[]>()
    const unmatchedLeft = new Map<string, Set<T>>()

    right.subscribe((element, key) => {
      if (!rightElements.has(key)) {
        rightElements.set(key, [])
      }
      rightElements.get(key)!.push(element)
    })

    const getTimestamp = (element: unknown): number => {
      if (typeof element === 'object' && element !== null && 'timestamp' in element) {
        return (element as { timestamp: number }).timestamp
      }
      return Date.now()
    }

    return {
      within(duration) {
        windowMs = parseDuration(duration)
        return this
      },

      on<R>(mapper: (l: T, r: U | null) => R): Stream<R> {
        const resultSubscribers = new Set<(result: R) => void>()
        const emittedPairs = new Set<string>()

        left.subscribe((leftElem, key) => {
          const rights = rightElements.get(key) || []
          const leftTs = getTimestamp(leftElem)
          let matched = false

          for (const rightElem of rights) {
            const rightTs = getTimestamp(rightElem)
            if (windowMs && Math.abs(leftTs - rightTs) > windowMs) continue

            matched = true
            const result = mapper(leftElem, rightElem)
            const pairKey = JSON.stringify({ left: leftElem, right: rightElem })
            if (!emittedPairs.has(pairKey)) {
              emittedPairs.add(pairKey)
              for (const subscriber of resultSubscribers) {
                subscriber(result)
              }
            }
          }

          if (!matched) {
            if (!unmatchedLeft.has(key)) {
              unmatchedLeft.set(key, new Set())
            }
            unmatchedLeft.get(key)!.add(leftElem)
          }
        })

        const checkUnmatched = () => {
          const now = Date.now()
          for (const [, leftSet] of unmatchedLeft) {
            for (const leftElem of leftSet) {
              const leftTs = getTimestamp(leftElem)
              if (windowMs && now - leftTs > windowMs) {
                const result = mapper(leftElem, null)
                for (const subscriber of resultSubscribers) {
                  subscriber(result)
                }
                leftSet.delete(leftElem)
              }
            }
          }
        }

        return {
          type: 'stream',
          source: left.source,
          subscribe(callback) {
            resultSubscribers.add(callback)
            return () => resultSubscribers.delete(callback)
          },
          async flush() {
            checkUnmatched()
            await Promise.resolve()
          },
        } as Stream<R>
      },
    }
  }

  function createCoGroupBuilder<T, U>(
    left: KeyedStream<T, string>,
    right: KeyedStream<U, string>
  ): CoGroupBuilder<T, U, string> {
    let windowMs: number | undefined
    const leftElements = new Map<string, T[]>()
    const rightElements = new Map<string, U[]>()

    left.subscribe((element, key) => {
      if (!leftElements.has(key)) {
        leftElements.set(key, [])
      }
      leftElements.get(key)!.push(element)
    })

    right.subscribe((element, key) => {
      if (!rightElements.has(key)) {
        rightElements.set(key, [])
      }
      rightElements.get(key)!.push(element)
    })

    return {
      within(duration) {
        windowMs = parseDuration(duration)
        return this
      },

      apply<R>(fn: (leftGroup: T[], rightGroup: U[]) => R): Stream<R> {
        const resultSubscribers = new Set<(result: R) => void>()
        const emittedKeys = new Set<string>()

        const emitGroups = () => {
          const allKeys = new Set([...leftElements.keys(), ...rightElements.keys()])
          for (const key of allKeys) {
            if (emittedKeys.has(key)) continue

            const lefts = leftElements.get(key) || []
            const rights = rightElements.get(key) || []

            if (lefts.length > 0 || rights.length > 0) {
              const result = fn(lefts, rights)
              emittedKeys.add(key)
              for (const subscriber of resultSubscribers) {
                subscriber(result)
              }
            }
          }
        }

        return {
          type: 'stream',
          source: left.source,
          subscribe(callback) {
            resultSubscribers.add(callback)
            return () => resultSubscribers.delete(callback)
          },
          async flush() {
            emitGroups()
            await Promise.resolve()
          },
        } as Stream<R>
      },

      async flush() {
        await Promise.resolve()
      },
    }
  }

  function createEntityProxy(entityName: string): EntityProxy {
    return (id: string) => ({
      async get() {
        if (entityName === 'Customer') {
          return customerStorage.get(id) ?? null
        }
        return null
      },
      async notify(payload: unknown) {
        const hooks = entityActionHooks.get(`${entityName}:notify`)
        if (hooks) {
          for (const hook of hooks) {
            hook(id, payload)
          }
        }
      },
    })
  }

  const context: StreamContext = {
    stream: {
      from: new Proxy({} as StreamFromProxy, {
        get(_, entityName: string) {
          if (entityName === 'track') {
            return new Proxy({} as Record<string, Stream<unknown>>, {
              get(_, eventName: string) {
                return createStream({
                  type: 'track',
                  event: eventName,
                })
              },
            })
          }

          if (entityName === 'measure') {
            return new Proxy({} as Record<string, Stream<unknown>>, {
              get(_, metricName: string) {
                return createStream({
                  type: 'measure',
                  metric: metricName,
                })
              },
            })
          }

          return new Proxy({} as Record<string, Stream<unknown>>, {
            get(_, eventName: string) {
              return createStream({
                type: 'domain',
                entity: entityName,
                event: eventName,
              })
            },
          })
        },
      }),

      async emit(entity: string, event: string, data: unknown) {
        const key = `${entity}:${event}`
        const subscribers = eventBus.get(key)
        if (subscribers) {
          for (const subscriber of subscribers) {
            await subscriber(data)
          }
        }

        const wildcardEntity = eventBus.get(`*:${event}`)
        if (wildcardEntity) {
          for (const subscriber of wildcardEntity) {
            await subscriber(data)
          }
        }

        const wildcardEvent = eventBus.get(`${entity}:*`)
        if (wildcardEvent) {
          for (const subscriber of wildcardEvent) {
            await subscriber(data)
          }
        }
      },

      get(name: string) {
        return namedStreams.get(name)
      },
    },

    count: () => ({ type: 'count' }),
    sum: (field: string) => ({ type: 'sum', field }),
    avg: (field: string) => ({ type: 'avg', field }),
    min: (field: string) => ({ type: 'min', field }),
    max: (field: string) => ({ type: 'max', field }),
    first: () => ({ type: 'first' }),
    last: () => ({ type: 'last' }),
    collect: () => ({ type: 'collect' }),
    distinct: (field: string) => ({ type: 'distinct', field }),

    Customer: createEntityProxy('Customer'),
    Order: createEntityProxy('Order'),

    view: new Proxy({} as ViewNamespace, {
      get(_, viewName: string) {
        if (!viewStorage.has(viewName)) {
          viewStorage.set(viewName, new Map())
        }
        const storage = viewStorage.get(viewName)!

        return {
          async get(key: string) {
            return storage.get(key)
          },
          async set(key: string, value: unknown) {
            storage.set(key, value)
          },
        }
      },
    }),

    _hooks: {
      onTrack(event: string, callback: (data: unknown) => void) {
        if (!trackHooks.has(event)) {
          trackHooks.set(event, new Set())
        }
        trackHooks.get(event)!.add(callback)
      },
      onMeasure(metric: string, callback: (value: number, labels: Record<string, string>) => void) {
        if (!measureHooks.has(metric)) {
          measureHooks.set(metric, new Set())
        }
        measureHooks.get(metric)!.add(callback)
      },
      onEntityAction(entity: string, action: string, callback: (id: string, payload: unknown) => void) {
        const key = `${entity}:${action}`
        if (!entityActionHooks.has(key)) {
          entityActionHooks.set(key, new Set())
        }
        entityActionHooks.get(key)!.add(callback)
      },
    },

    _storage: {
      customers: customerStorage,
    },
  }

  return context
}

export type {
  Stream as StreamType,
  KeyedStream,
  WindowedStream,
  JoinedStream,
  StreamSource as StreamSourceType,
  StreamSinkDescriptor as StreamSink,
}
