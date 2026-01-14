/**
 * @dotdo/flink - Apache Flink DataStream API Compat Layer Tests
 *
 * Comprehensive tests for stateful stream processing on Durable Objects.
 * Following TDD: These tests are written first and should FAIL initially.
 *
 * @see https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/overview/
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  // Environment
  StreamExecutionEnvironment,
  LocalStreamEnvironment,

  // Streams
  DataStream,
  KeyedStream,
  WindowedStream,
  ConnectedStreams,

  // Transformations
  MapFunction,
  FlatMapFunction,
  FilterFunction,
  KeySelector,
  ReduceFunction,

  // Windows
  WindowAssigner,
  TumblingEventTimeWindows,
  TumblingProcessingTimeWindows,
  SlidingEventTimeWindows,
  SlidingProcessingTimeWindows,
  SessionWindows,
  GlobalWindows,

  // Window functions
  WindowFunction,
  ProcessWindowFunction,
  AggregateFunction,
  ReduceFunction as WindowReduceFunction,

  // Time utilities
  Time,
  Duration,

  // Watermarks
  WatermarkStrategy,
  WatermarkGenerator,
  Watermark,
  TimestampAssigner,
  BoundedOutOfOrdernessWatermarks,
  AscendingTimestampsWatermarks,

  // State
  ValueState,
  ListState,
  MapState,
  ReducingState,
  AggregatingState,
  ValueStateDescriptor,
  ListStateDescriptor,
  MapStateDescriptor,
  ReducingStateDescriptor,
  AggregatingStateDescriptor,
  StateTtlConfig,

  // Process functions
  ProcessFunction,
  KeyedProcessFunction,
  CoProcessFunction,
  Context,
  OnTimerContext,
  Collector,
  RuntimeContext,
  TimerService,

  // Checkpointing
  CheckpointConfig,
  CheckpointStorage,
  CheckpointingMode,
  StateBackend,

  // Connectors
  Source,
  Sink,
  SourceFunction,
  SinkFunction,
  RichSourceFunction,
  RichSinkFunction,

  // Triggers
  Trigger,
  TriggerResult,
  CountTrigger,
  EventTimeTrigger,
  ProcessingTimeTrigger,
  PurgingTrigger,
  ContinuousEventTimeTrigger,
  ContinuousProcessingTimeTrigger,

  // Evictors
  Evictor,
  CountEvictor,
  TimeEvictor,
  DeltaEvictor,

  // Side outputs
  OutputTag,

  // Test utilities
  _clear,
  createTestEnvironment,
} from '../index'

// Test event types
interface ClickEvent {
  userId: string
  timestamp: number
  pageId: string
  action: string
}

interface UserStats {
  userId: string
  clickCount: number
  lastTimestamp: number
}

interface WindowResult {
  key: string
  count: number
  windowStart: number
  windowEnd: number
}

describe('@dotdo/flink - Apache Flink DataStream API Compat Layer', () => {
  beforeEach(() => {
    _clear()
  })

  // ===========================================================================
  // StreamExecutionEnvironment
  // ===========================================================================

  describe('StreamExecutionEnvironment', () => {
    it('should create execution environment', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      expect(env).toBeDefined()
      expect(env).toBeInstanceOf(StreamExecutionEnvironment)
    })

    it('should create local execution environment', () => {
      const env = StreamExecutionEnvironment.createLocalEnvironment()
      expect(env).toBeDefined()
      expect(env).toBeInstanceOf(LocalStreamEnvironment)
    })

    it('should set parallelism', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      env.setParallelism(4)
      expect(env.getParallelism()).toBe(4)
    })

    it('should set max parallelism', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      env.setMaxParallelism(16)
      expect(env.getMaxParallelism()).toBe(16)
    })

    it('should configure checkpointing', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      env.enableCheckpointing(5000) // Every 5 seconds
      expect(env.getCheckpointConfig().getCheckpointInterval()).toBe(5000)
    })

    it('should configure checkpoint mode', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      env.enableCheckpointing(5000, CheckpointingMode.EXACTLY_ONCE)
      expect(env.getCheckpointConfig().getCheckpointingMode()).toBe(
        CheckpointingMode.EXACTLY_ONCE
      )
    })

    it('should set state backend', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const backend = new StateBackend('do-storage')
      env.setStateBackend(backend)
      expect(env.getStateBackend()).toBe(backend)
    })

    it('should execute job with name', async () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const stream = env.fromElements(1, 2, 3)
      stream.print()

      const result = await env.execute('Test Job')
      expect(result.getJobName()).toBe('Test Job')
    })
  })

  // ===========================================================================
  // DataStream Creation
  // ===========================================================================

  describe('DataStream Creation', () => {
    it('should create stream from elements', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const stream = env.fromElements(1, 2, 3, 4, 5)

      expect(stream).toBeInstanceOf(DataStream)
    })

    it('should create stream from collection', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const elements = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]
      const stream = env.fromCollection(elements)

      expect(stream).toBeInstanceOf(DataStream)
    })

    it('should add custom source', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()

      const source: SourceFunction<number> = {
        run: (ctx) => {
          for (let i = 0; i < 10; i++) {
            ctx.collect(i)
          }
        },
        cancel: () => {},
      }

      const stream = env.addSource(source)
      expect(stream).toBeInstanceOf(DataStream)
    })

    it('should create stream from Source interface', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()

      const source: Source<ClickEvent> = {
        getBoundedness: () => 'BOUNDED',
        createReader: () => ({
          start: vi.fn(),
          pollNext: vi.fn(),
          close: vi.fn(),
        }),
      }

      const stream = env.fromSource(source, WatermarkStrategy.noWatermarks(), 'click-source')
      expect(stream).toBeInstanceOf(DataStream)
    })

    it('should generate sequence', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const stream = env.generateSequence(1, 100)

      expect(stream).toBeInstanceOf(DataStream)
    })

    it('should create socket stream', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const stream = env.socketTextStream('localhost', 9000)

      expect(stream).toBeInstanceOf(DataStream)
    })
  })

  // ===========================================================================
  // DataStream Transformations
  // ===========================================================================

  describe('DataStream Transformations', () => {
    describe('Map', () => {
      it('should map elements with function', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(1, 2, 3)

        const mapped = stream.map((x) => x * 2)

        const result = await env.executeAndCollect(mapped)
        expect(result).toEqual([2, 4, 6])
      })

      it('should map elements with MapFunction', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(1, 2, 3)

        const mapFunction: MapFunction<number, string> = {
          map: (value) => `value: ${value}`,
        }

        const mapped = stream.map(mapFunction)

        const result = await env.executeAndCollect(mapped)
        expect(result).toEqual(['value: 1', 'value: 2', 'value: 3'])
      })

      it('should support rich map function with context', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(1, 2, 3)

        const mapFunction = {
          open: vi.fn(),
          close: vi.fn(),
          map: (value: number, ctx: RuntimeContext) => {
            return { value, parallelism: ctx.getNumberOfParallelSubtasks() }
          },
        }

        const mapped = stream.map(mapFunction)

        await env.executeAndCollect(mapped)
        expect(mapFunction.open).toHaveBeenCalled()
        expect(mapFunction.close).toHaveBeenCalled()
      })
    })

    describe('FlatMap', () => {
      it('should flatMap elements', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements('hello world', 'foo bar')

        const flatMapped = stream.flatMap((s, out) => {
          for (const word of s.split(' ')) {
            out.collect(word)
          }
        })

        const result = await env.executeAndCollect(flatMapped)
        expect(result).toEqual(['hello', 'world', 'foo', 'bar'])
      })

      it('should flatMap with FlatMapFunction', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements([1, 2], [3, 4, 5])

        const flatMapFunction: FlatMapFunction<number[], number> = {
          flatMap: (value, out) => {
            for (const n of value) {
              out.collect(n)
            }
          },
        }

        const flatMapped = stream.flatMap(flatMapFunction)

        const result = await env.executeAndCollect(flatMapped)
        expect(result).toEqual([1, 2, 3, 4, 5])
      })
    })

    describe('Filter', () => {
      it('should filter elements', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(1, 2, 3, 4, 5)

        const filtered = stream.filter((x) => x % 2 === 0)

        const result = await env.executeAndCollect(filtered)
        expect(result).toEqual([2, 4])
      })

      it('should filter with FilterFunction', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(
          { name: 'Alice', age: 30 },
          { name: 'Bob', age: 17 },
          { name: 'Charlie', age: 25 }
        )

        const filterFunction: FilterFunction<{ name: string; age: number }> = {
          filter: (value) => value.age >= 18,
        }

        const filtered = stream.filter(filterFunction)

        const result = await env.executeAndCollect(filtered)
        expect(result).toHaveLength(2)
        expect(result.map((r) => r.name)).toEqual(['Alice', 'Charlie'])
      })
    })

    describe('KeyBy', () => {
      it('should create KeyedStream with key selector', () => {
        const env = StreamExecutionEnvironment.getExecutionEnvironment()
        const stream = env.fromElements(
          { userId: 'u1', value: 1 },
          { userId: 'u2', value: 2 },
          { userId: 'u1', value: 3 }
        )

        const keyed = stream.keyBy((e) => e.userId)

        expect(keyed).toBeInstanceOf(KeyedStream)
      })

      it('should key by field name', () => {
        const env = StreamExecutionEnvironment.getExecutionEnvironment()
        const stream = env.fromElements(
          { userId: 'u1', value: 1 },
          { userId: 'u2', value: 2 }
        )

        const keyed = stream.keyBy('userId')

        expect(keyed).toBeInstanceOf(KeyedStream)
      })

      it('should key by multiple fields', () => {
        const env = StreamExecutionEnvironment.getExecutionEnvironment()
        const stream = env.fromElements(
          { userId: 'u1', sessionId: 's1', value: 1 },
          { userId: 'u1', sessionId: 's2', value: 2 }
        )

        const keyed = stream.keyBy((e) => `${e.userId}:${e.sessionId}`)

        expect(keyed).toBeInstanceOf(KeyedStream)
      })
    })

    describe('Reduce', () => {
      it('should reduce keyed stream', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(
          { key: 'a', value: 1 },
          { key: 'b', value: 2 },
          { key: 'a', value: 3 },
          { key: 'b', value: 4 }
        )

        const reduced = stream
          .keyBy((e) => e.key)
          .reduce((a, b) => ({ ...a, value: a.value + b.value }))

        const result = await env.executeAndCollect(reduced)
        expect(result).toContainEqual({ key: 'a', value: 4 })
        expect(result).toContainEqual({ key: 'b', value: 6 })
      })
    })

    describe('Union', () => {
      it('should union multiple streams', async () => {
        const env = createTestEnvironment()
        const stream1 = env.fromElements(1, 2)
        const stream2 = env.fromElements(3, 4)
        const stream3 = env.fromElements(5, 6)

        const unioned = stream1.union(stream2, stream3)

        const result = await env.executeAndCollect(unioned)
        expect(result.sort()).toEqual([1, 2, 3, 4, 5, 6])
      })
    })

    describe('Connect', () => {
      it('should connect two streams', () => {
        const env = StreamExecutionEnvironment.getExecutionEnvironment()
        const stream1 = env.fromElements({ type: 'click', userId: 'u1' })
        const stream2 = env.fromElements({ type: 'view', userId: 'u1' })

        const connected = stream1.connect(stream2)

        expect(connected).toBeInstanceOf(ConnectedStreams)
      })

      it('should process connected streams', async () => {
        const env = createTestEnvironment()
        const clicks = env.fromElements({ type: 'click' as const, data: 'c1' })
        const views = env.fromElements({ type: 'view' as const, data: 'v1' })

        const connected = clicks.connect(views)
        const processed = connected.process({
          processElement1: (value, ctx, out) => {
            out.collect(`click: ${value.data}`)
          },
          processElement2: (value, ctx, out) => {
            out.collect(`view: ${value.data}`)
          },
        })

        const result = await env.executeAndCollect(processed)
        expect(result).toContain('click: c1')
        expect(result).toContain('view: v1')
      })
    })

    describe('Side Outputs', () => {
      it('should emit to side outputs', async () => {
        const env = createTestEnvironment()
        const lateOutputTag = new OutputTag<ClickEvent>('late-events')

        const stream = env.fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'p1', action: 'click' },
          { userId: 'u2', timestamp: 500, pageId: 'p2', action: 'click' } // Late event
        )

        const processed = stream.process(
          new (class extends ProcessFunction<ClickEvent, ClickEvent> {
            processElement(
              event: ClickEvent,
              ctx: Context,
              out: Collector<ClickEvent>
            ) {
              if (event.timestamp < 800) {
                ctx.output(lateOutputTag, event)
              } else {
                out.collect(event)
              }
            }
          })()
        )

        const mainResult = await env.executeAndCollect(processed)
        const lateResult = await env.executeAndCollect(
          processed.getSideOutput(lateOutputTag)
        )

        expect(mainResult).toHaveLength(1)
        expect(lateResult).toHaveLength(1)
        expect(lateResult[0]?.userId).toBe('u2')
      })
    })

    describe('Partitioning', () => {
      it('should shuffle data', () => {
        const env = StreamExecutionEnvironment.getExecutionEnvironment()
        const stream = env.fromElements(1, 2, 3, 4, 5)

        const shuffled = stream.shuffle()
        expect(shuffled).toBeInstanceOf(DataStream)
      })

      it('should rebalance data', () => {
        const env = StreamExecutionEnvironment.getExecutionEnvironment()
        const stream = env.fromElements(1, 2, 3, 4, 5)

        const rebalanced = stream.rebalance()
        expect(rebalanced).toBeInstanceOf(DataStream)
      })

      it('should rescale data', () => {
        const env = StreamExecutionEnvironment.getExecutionEnvironment()
        const stream = env.fromElements(1, 2, 3, 4, 5)

        const rescaled = stream.rescale()
        expect(rescaled).toBeInstanceOf(DataStream)
      })

      it('should broadcast data', () => {
        const env = StreamExecutionEnvironment.getExecutionEnvironment()
        const stream = env.fromElements(1, 2, 3, 4, 5)

        const broadcast = stream.broadcast()
        expect(broadcast).toBeInstanceOf(DataStream)
      })

      it('should set custom partitioner', () => {
        const env = StreamExecutionEnvironment.getExecutionEnvironment()
        const stream = env.fromElements(
          { key: 'a', value: 1 },
          { key: 'b', value: 2 }
        )

        const partitioned = stream.partitionCustom(
          {
            partition: (key, numPartitions) => key.charCodeAt(0) % numPartitions,
          },
          (e) => e.key
        )

        expect(partitioned).toBeInstanceOf(DataStream)
      })
    })
  })

  // ===========================================================================
  // Windows
  // ===========================================================================

  describe('Windows', () => {
    describe('Tumbling Windows', () => {
      it('should create tumbling event time window', async () => {
        const env = createTestEnvironment()
        const stream = env
          .fromElements(
            { key: 'a', timestamp: 1000, value: 1 },
            { key: 'a', timestamp: 2000, value: 2 },
            { key: 'a', timestamp: 6000, value: 3 }, // New window
            { key: 'a', timestamp: 7000, value: 4 }
          )
          .assignTimestampsAndWatermarks(
            WatermarkStrategy.forMonotonousTimestamps<{
              key: string
              timestamp: number
              value: number
            }>().withTimestampAssigner((e) => e.timestamp)
          )

        const windowed = stream
          .keyBy((e) => e.key)
          .window(TumblingEventTimeWindows.of(Time.seconds(5)))
          .reduce((a, b) => ({ ...a, value: a.value + b.value }))

        const result = await env.executeAndCollect(windowed)

        // Window [0, 5000) should have sum 3 (1+2)
        // Window [5000, 10000) should have sum 7 (3+4)
        expect(result).toContainEqual(
          expect.objectContaining({ key: 'a', value: 3 })
        )
        expect(result).toContainEqual(
          expect.objectContaining({ key: 'a', value: 7 })
        )
      })

      it('should create tumbling processing time window', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(
          { key: 'a', value: 1 },
          { key: 'a', value: 2 },
          { key: 'a', value: 3 }
        )

        const windowed = stream
          .keyBy((e) => e.key)
          .window(TumblingProcessingTimeWindows.of(Time.seconds(1)))
          .sum('value')

        expect(windowed).toBeInstanceOf(DataStream)
      })

      it('should support window with offset', async () => {
        const env = createTestEnvironment()
        const stream = env
          .fromElements(
            { key: 'a', timestamp: 500, value: 1 },
            { key: 'a', timestamp: 1500, value: 2 }
          )
          .assignTimestampsAndWatermarks(
            WatermarkStrategy.forMonotonousTimestamps<{
              key: string
              timestamp: number
              value: number
            }>().withTimestampAssigner((e) => e.timestamp)
          )

        // Window with 500ms offset
        const windowed = stream
          .keyBy((e) => e.key)
          .window(TumblingEventTimeWindows.of(Time.seconds(1), Time.milliseconds(500)))
          .reduce((a, b) => ({ ...a, value: a.value + b.value }))

        const result = await env.executeAndCollect(windowed)
        expect(result).toBeDefined()
      })
    })

    describe('Sliding Windows', () => {
      it('should create sliding event time window', async () => {
        const env = createTestEnvironment()
        const stream = env
          .fromElements(
            { key: 'a', timestamp: 1000, value: 1 },
            { key: 'a', timestamp: 3000, value: 2 },
            { key: 'a', timestamp: 5000, value: 3 }
          )
          .assignTimestampsAndWatermarks(
            WatermarkStrategy.forMonotonousTimestamps<{
              key: string
              timestamp: number
              value: number
            }>().withTimestampAssigner((e) => e.timestamp)
          )

        // 4 second window, sliding every 2 seconds
        const windowed = stream
          .keyBy((e) => e.key)
          .window(SlidingEventTimeWindows.of(Time.seconds(4), Time.seconds(2)))
          .reduce((a, b) => ({ ...a, value: a.value + b.value }))

        const result = await env.executeAndCollect(windowed)
        // Multiple windows will fire with overlapping elements
        expect(result.length).toBeGreaterThan(0)
      })

      it('should create sliding processing time window', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(
          { key: 'a', value: 1 },
          { key: 'a', value: 2 }
        )

        const windowed = stream
          .keyBy((e) => e.key)
          .window(
            SlidingProcessingTimeWindows.of(Time.minutes(10), Time.minutes(5))
          )
          .sum('value')

        expect(windowed).toBeInstanceOf(DataStream)
      })
    })

    describe('Session Windows', () => {
      it('should create session window with gap', async () => {
        const env = createTestEnvironment()
        const stream = env
          .fromElements(
            { key: 'a', timestamp: 1000, value: 1 },
            { key: 'a', timestamp: 2000, value: 2 },
            // Gap > 3 seconds
            { key: 'a', timestamp: 10000, value: 3 },
            { key: 'a', timestamp: 11000, value: 4 }
          )
          .assignTimestampsAndWatermarks(
            WatermarkStrategy.forMonotonousTimestamps<{
              key: string
              timestamp: number
              value: number
            }>().withTimestampAssigner((e) => e.timestamp)
          )

        const windowed = stream
          .keyBy((e) => e.key)
          .window(SessionWindows.withGap(Time.seconds(3)))
          .reduce((a, b) => ({ ...a, value: a.value + b.value }))

        const result = await env.executeAndCollect(windowed)

        // Session 1: [1000, 2000] -> sum 3
        // Session 2: [10000, 11000] -> sum 7
        expect(result).toContainEqual(
          expect.objectContaining({ key: 'a', value: 3 })
        )
        expect(result).toContainEqual(
          expect.objectContaining({ key: 'a', value: 7 })
        )
      })

      it('should create session window with dynamic gap', async () => {
        const env = createTestEnvironment()
        const stream = env
          .fromElements(
            { key: 'a', timestamp: 1000, gapHint: 2000 },
            { key: 'a', timestamp: 2000, gapHint: 3000 }
          )
          .assignTimestampsAndWatermarks(
            WatermarkStrategy.forMonotonousTimestamps<{
              key: string
              timestamp: number
              gapHint: number
            }>().withTimestampAssigner((e) => e.timestamp)
          )

        const windowed = stream
          .keyBy((e) => e.key)
          .window(
            SessionWindows.withDynamicGap({
              extract: (element) => element.gapHint,
            })
          )
          .reduce((a, b) => a)

        expect(windowed).toBeInstanceOf(DataStream)
      })
    })

    describe('Global Windows', () => {
      it('should create global window with count trigger', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(
          { key: 'a', value: 1 },
          { key: 'a', value: 2 },
          { key: 'a', value: 3 },
          { key: 'a', value: 4 },
          { key: 'a', value: 5 }
        )

        const windowed = stream
          .keyBy((e) => e.key)
          .window(GlobalWindows.create())
          .trigger(CountTrigger.of(3))
          .reduce((a, b) => ({ ...a, value: a.value + b.value }))

        const result = await env.executeAndCollect(windowed)
        // Fires after every 3 elements
        expect(result).toHaveLength(1)
        expect(result[0]?.value).toBe(6) // 1+2+3
      })
    })

    describe('Window Functions', () => {
      it('should apply WindowFunction', async () => {
        const env = createTestEnvironment()
        const stream = env
          .fromElements(
            { key: 'a', timestamp: 1000, value: 1 },
            { key: 'a', timestamp: 2000, value: 2 }
          )
          .assignTimestampsAndWatermarks(
            WatermarkStrategy.forMonotonousTimestamps<{
              key: string
              timestamp: number
              value: number
            }>().withTimestampAssigner((e) => e.timestamp)
          )

        const windowFunction: WindowFunction<
          { key: string; timestamp: number; value: number },
          WindowResult,
          string
        > = {
          apply: (key, window, elements, out) => {
            let count = 0
            for (const e of elements) {
              count += e.value
            }
            out.collect({
              key,
              count,
              windowStart: window.getStart(),
              windowEnd: window.getEnd(),
            })
          },
        }

        const windowed = stream
          .keyBy((e) => e.key)
          .window(TumblingEventTimeWindows.of(Time.seconds(5)))
          .apply(windowFunction)

        const result = await env.executeAndCollect(windowed)
        expect(result[0]?.count).toBe(3)
        expect(result[0]?.windowStart).toBe(0)
        expect(result[0]?.windowEnd).toBe(5000)
      })

      it('should apply ProcessWindowFunction', async () => {
        const env = createTestEnvironment()
        const stream = env
          .fromElements(
            { key: 'a', timestamp: 1000, value: 1 },
            { key: 'a', timestamp: 2000, value: 2 }
          )
          .assignTimestampsAndWatermarks(
            WatermarkStrategy.forMonotonousTimestamps<{
              key: string
              timestamp: number
              value: number
            }>().withTimestampAssigner((e) => e.timestamp)
          )

        const processFunction: ProcessWindowFunction<
          { key: string; timestamp: number; value: number },
          WindowResult,
          string
        > = {
          process: (key, context, elements, out) => {
            const window = context.window()
            let count = 0
            for (const e of elements) {
              count += e.value
            }
            out.collect({
              key,
              count,
              windowStart: window.getStart(),
              windowEnd: window.getEnd(),
            })
          },
        }

        const windowed = stream
          .keyBy((e) => e.key)
          .window(TumblingEventTimeWindows.of(Time.seconds(5)))
          .process(processFunction)

        const result = await env.executeAndCollect(windowed)
        expect(result[0]?.count).toBe(3)
      })

      it('should apply AggregateFunction', async () => {
        const env = createTestEnvironment()
        const stream = env
          .fromElements(
            { key: 'a', timestamp: 1000, value: 1 },
            { key: 'a', timestamp: 2000, value: 2 },
            { key: 'a', timestamp: 3000, value: 3 }
          )
          .assignTimestampsAndWatermarks(
            WatermarkStrategy.forMonotonousTimestamps<{
              key: string
              timestamp: number
              value: number
            }>().withTimestampAssigner((e) => e.timestamp)
          )

        // Average aggregator
        const aggregator: AggregateFunction<
          { key: string; timestamp: number; value: number },
          { sum: number; count: number },
          number
        > = {
          createAccumulator: () => ({ sum: 0, count: 0 }),
          add: (value, acc) => ({
            sum: acc.sum + value.value,
            count: acc.count + 1,
          }),
          getResult: (acc) => acc.sum / acc.count,
          merge: (a, b) => ({ sum: a.sum + b.sum, count: a.count + b.count }),
        }

        const windowed = stream
          .keyBy((e) => e.key)
          .window(TumblingEventTimeWindows.of(Time.seconds(5)))
          .aggregate(aggregator)

        const result = await env.executeAndCollect(windowed)
        expect(result[0]).toBe(2) // Average of 1, 2, 3
      })
    })

    describe('Triggers', () => {
      it('should use EventTimeTrigger', async () => {
        const env = createTestEnvironment()
        const stream = env
          .fromElements({ key: 'a', timestamp: 1000, value: 1 })
          .assignTimestampsAndWatermarks(
            WatermarkStrategy.forMonotonousTimestamps<{
              key: string
              timestamp: number
              value: number
            }>().withTimestampAssigner((e) => e.timestamp)
          )

        const windowed = stream
          .keyBy((e) => e.key)
          .window(TumblingEventTimeWindows.of(Time.seconds(5)))
          .trigger(EventTimeTrigger.create())
          .reduce((a, b) => ({ ...a, value: a.value + b.value }))

        expect(windowed).toBeInstanceOf(DataStream)
      })

      it('should use ProcessingTimeTrigger', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements({ key: 'a', value: 1 })

        const windowed = stream
          .keyBy((e) => e.key)
          .window(TumblingProcessingTimeWindows.of(Time.seconds(5)))
          .trigger(ProcessingTimeTrigger.create())
          .reduce((a, b) => ({ ...a, value: a.value + b.value }))

        expect(windowed).toBeInstanceOf(DataStream)
      })

      it('should use ContinuousEventTimeTrigger', async () => {
        const env = createTestEnvironment()
        const stream = env
          .fromElements({ key: 'a', timestamp: 1000, value: 1 })
          .assignTimestampsAndWatermarks(
            WatermarkStrategy.forMonotonousTimestamps<{
              key: string
              timestamp: number
              value: number
            }>().withTimestampAssigner((e) => e.timestamp)
          )

        const windowed = stream
          .keyBy((e) => e.key)
          .window(TumblingEventTimeWindows.of(Time.minutes(10)))
          .trigger(ContinuousEventTimeTrigger.of(Time.seconds(30)))
          .reduce((a, b) => ({ ...a, value: a.value + b.value }))

        expect(windowed).toBeInstanceOf(DataStream)
      })

      it('should use PurgingTrigger', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements({ key: 'a', value: 1 })

        const windowed = stream
          .keyBy((e) => e.key)
          .window(GlobalWindows.create())
          .trigger(PurgingTrigger.of(CountTrigger.of(3)))
          .reduce((a, b) => ({ ...a, value: a.value + b.value }))

        expect(windowed).toBeInstanceOf(DataStream)
      })
    })

    describe('Evictors', () => {
      it('should use CountEvictor', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(
          { key: 'a', value: 1 },
          { key: 'a', value: 2 },
          { key: 'a', value: 3 },
          { key: 'a', value: 4 },
          { key: 'a', value: 5 }
        )

        const windowed = stream
          .keyBy((e) => e.key)
          .window(GlobalWindows.create())
          .trigger(CountTrigger.of(5))
          .evictor(CountEvictor.of(2)) // Keep only last 2
          .reduce((a, b) => ({ ...a, value: a.value + b.value }))

        const result = await env.executeAndCollect(windowed)
        // Should only sum last 2 elements: 4 + 5 = 9
        expect(result[0]?.value).toBe(9)
      })

      it('should use TimeEvictor', async () => {
        const env = createTestEnvironment()
        const stream = env
          .fromElements(
            { key: 'a', timestamp: 1000, value: 1 },
            { key: 'a', timestamp: 8000, value: 2 }
          )
          .assignTimestampsAndWatermarks(
            WatermarkStrategy.forMonotonousTimestamps<{
              key: string
              timestamp: number
              value: number
            }>().withTimestampAssigner((e) => e.timestamp)
          )

        const windowed = stream
          .keyBy((e) => e.key)
          .window(TumblingEventTimeWindows.of(Time.seconds(10)))
          .evictor(TimeEvictor.of(Time.seconds(5))) // Evict elements older than 5 seconds
          .reduce((a, b) => ({ ...a, value: a.value + b.value }))

        expect(windowed).toBeInstanceOf(DataStream)
      })
    })

    describe('Allowed Lateness', () => {
      it('should configure allowed lateness', async () => {
        const env = createTestEnvironment()
        const stream = env
          .fromElements({ key: 'a', timestamp: 1000, value: 1 })
          .assignTimestampsAndWatermarks(
            WatermarkStrategy.forBoundedOutOfOrderness<{
              key: string
              timestamp: number
              value: number
            }>(Time.seconds(5)).withTimestampAssigner((e) => e.timestamp)
          )

        const windowed = stream
          .keyBy((e) => e.key)
          .window(TumblingEventTimeWindows.of(Time.seconds(10)))
          .allowedLateness(Time.seconds(30))
          .reduce((a, b) => ({ ...a, value: a.value + b.value }))

        expect(windowed).toBeInstanceOf(DataStream)
      })

      it('should output late elements to side output', async () => {
        const env = createTestEnvironment()
        const lateTag = new OutputTag<{ key: string; timestamp: number; value: number }>('late')

        const stream = env
          .fromElements({ key: 'a', timestamp: 1000, value: 1 })
          .assignTimestampsAndWatermarks(
            WatermarkStrategy.forBoundedOutOfOrderness<{
              key: string
              timestamp: number
              value: number
            }>(Time.seconds(5)).withTimestampAssigner((e) => e.timestamp)
          )

        const windowed = stream
          .keyBy((e) => e.key)
          .window(TumblingEventTimeWindows.of(Time.seconds(10)))
          .allowedLateness(Time.seconds(0))
          .sideOutputLateData(lateTag)
          .reduce((a, b) => ({ ...a, value: a.value + b.value }))

        expect(windowed).toBeInstanceOf(DataStream)
      })
    })
  })

  // ===========================================================================
  // Watermarks
  // ===========================================================================

  describe('Watermarks', () => {
    it('should create bounded out of orderness strategy', () => {
      const strategy = WatermarkStrategy.forBoundedOutOfOrderness<ClickEvent>(
        Time.seconds(5)
      )

      expect(strategy).toBeDefined()
    })

    it('should create monotonous timestamps strategy', () => {
      const strategy = WatermarkStrategy.forMonotonousTimestamps<ClickEvent>()

      expect(strategy).toBeDefined()
    })

    it('should create no watermarks strategy', () => {
      const strategy = WatermarkStrategy.noWatermarks<ClickEvent>()

      expect(strategy).toBeDefined()
    })

    it('should assign timestamps', async () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'p1', action: 'click' },
          { userId: 'u2', timestamp: 2000, pageId: 'p2', action: 'view' }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forBoundedOutOfOrderness<ClickEvent>(
            Time.seconds(5)
          ).withTimestampAssigner((event) => event.timestamp)
        )

      expect(stream).toBeInstanceOf(DataStream)
    })

    it('should support custom watermark generator', async () => {
      const env = createTestEnvironment()

      const customGenerator: WatermarkGenerator<ClickEvent> = {
        onEvent: (event, eventTimestamp, output) => {
          // Emit watermark on special marker events
          if (event.action === 'watermark-marker') {
            output.emitWatermark(new Watermark(event.timestamp))
          }
        },
        onPeriodicEmit: (output) => {
          // Called periodically
        },
      }

      const strategy = WatermarkStrategy.forGenerator<ClickEvent>(() => customGenerator)

      const stream = env
        .fromElements({ userId: 'u1', timestamp: 1000, pageId: 'p1', action: 'click' })
        .assignTimestampsAndWatermarks(
          strategy.withTimestampAssigner((e) => e.timestamp)
        )

      expect(stream).toBeInstanceOf(DataStream)
    })

    it('should support watermark idle timeout', async () => {
      const env = createTestEnvironment()
      const strategy = WatermarkStrategy.forBoundedOutOfOrderness<ClickEvent>(
        Time.seconds(5)
      ).withIdleness(Time.minutes(1))

      expect(strategy).toBeDefined()
    })
  })

  // ===========================================================================
  // State Management
  // ===========================================================================

  describe('State Management', () => {
    describe('ValueState', () => {
      it('should access value state in process function', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(
          { userId: 'u1', value: 1 },
          { userId: 'u1', value: 2 },
          { userId: 'u2', value: 3 },
          { userId: 'u1', value: 4 }
        )

        class CountingProcessFunction extends KeyedProcessFunction<
          string,
          { userId: string; value: number },
          { userId: string; total: number; count: number }
        > {
          private countState!: ValueState<number>
          private totalState!: ValueState<number>

          open(context: RuntimeContext) {
            this.countState = context.getState(
              new ValueStateDescriptor<number>('count', 0)
            )
            this.totalState = context.getState(
              new ValueStateDescriptor<number>('total', 0)
            )
          }

          processElement(
            event: { userId: string; value: number },
            ctx: Context,
            out: Collector<{ userId: string; total: number; count: number }>
          ) {
            const count = (this.countState.value() ?? 0) + 1
            const total = (this.totalState.value() ?? 0) + event.value

            this.countState.update(count)
            this.totalState.update(total)

            out.collect({ userId: event.userId, total, count })
          }
        }

        const processed = stream
          .keyBy((e) => e.userId)
          .process(new CountingProcessFunction())

        const result = await env.executeAndCollect(processed)

        // u1 events: (1, count=1), (2, count=2), (4, count=3)
        // u2 events: (3, count=1)
        expect(result).toContainEqual({ userId: 'u1', total: 7, count: 3 })
        expect(result).toContainEqual({ userId: 'u2', total: 3, count: 1 })
      })

      it('should support state TTL', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements({ userId: 'u1', value: 1 })

        class TTLProcessFunction extends KeyedProcessFunction<
          string,
          { userId: string; value: number },
          number
        > {
          private state!: ValueState<number>

          open(context: RuntimeContext) {
            const ttlConfig = StateTtlConfig.newBuilder(Time.hours(1))
              .setUpdateType(StateTtlConfig.UpdateType.OnCreateAndWrite)
              .setStateVisibility(
                StateTtlConfig.StateVisibility.NeverReturnExpired
              )
              .build()

            const descriptor = new ValueStateDescriptor<number>('ttl-state', 0)
            descriptor.enableTimeToLive(ttlConfig)

            this.state = context.getState(descriptor)
          }

          processElement(
            event: { userId: string; value: number },
            ctx: Context,
            out: Collector<number>
          ) {
            const current = this.state.value() ?? 0
            this.state.update(current + event.value)
            out.collect(this.state.value()!)
          }
        }

        const processed = stream
          .keyBy((e) => e.userId)
          .process(new TTLProcessFunction())

        expect(processed).toBeInstanceOf(DataStream)
      })
    })

    describe('ListState', () => {
      it('should access list state', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(
          { userId: 'u1', pageId: 'p1' },
          { userId: 'u1', pageId: 'p2' },
          { userId: 'u1', pageId: 'p3' }
        )

        class PageHistoryFunction extends KeyedProcessFunction<
          string,
          { userId: string; pageId: string },
          { userId: string; history: string[] }
        > {
          private pagesState!: ListState<string>

          open(context: RuntimeContext) {
            this.pagesState = context.getListState(
              new ListStateDescriptor<string>('pages', [])
            )
          }

          processElement(
            event: { userId: string; pageId: string },
            ctx: Context,
            out: Collector<{ userId: string; history: string[] }>
          ) {
            this.pagesState.add(event.pageId)
            out.collect({
              userId: event.userId,
              history: [...this.pagesState.get()],
            })
          }
        }

        const processed = stream
          .keyBy((e) => e.userId)
          .process(new PageHistoryFunction())

        const result = await env.executeAndCollect(processed)

        // Should accumulate pages
        expect(result[result.length - 1]?.history).toEqual(['p1', 'p2', 'p3'])
      })

      it('should support list state operations', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements({ key: 'a', values: [1, 2, 3] })

        class ListOpsFunction extends KeyedProcessFunction<
          string,
          { key: string; values: number[] },
          number[]
        > {
          private listState!: ListState<number>

          open(context: RuntimeContext) {
            this.listState = context.getListState(
              new ListStateDescriptor<number>('list', [])
            )
          }

          processElement(
            event: { key: string; values: number[] },
            ctx: Context,
            out: Collector<number[]>
          ) {
            // Add all values
            this.listState.addAll(event.values)

            // Get all values
            const all = [...this.listState.get()]

            // Update with new list
            this.listState.update([...all, 4, 5])

            out.collect([...this.listState.get()])
          }
        }

        const processed = stream.keyBy((e) => e.key).process(new ListOpsFunction())

        const result = await env.executeAndCollect(processed)
        expect(result[0]).toEqual([1, 2, 3, 4, 5])
      })
    })

    describe('MapState', () => {
      it('should access map state', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(
          { userId: 'u1', pageId: 'p1', count: 1 },
          { userId: 'u1', pageId: 'p2', count: 2 },
          { userId: 'u1', pageId: 'p1', count: 3 }
        )

        class PageCountFunction extends KeyedProcessFunction<
          string,
          { userId: string; pageId: string; count: number },
          { userId: string; pageCounts: Record<string, number> }
        > {
          private pageCountState!: MapState<string, number>

          open(context: RuntimeContext) {
            this.pageCountState = context.getMapState(
              new MapStateDescriptor<string, number>('page-counts')
            )
          }

          processElement(
            event: { userId: string; pageId: string; count: number },
            ctx: Context,
            out: Collector<{ userId: string; pageCounts: Record<string, number> }>
          ) {
            const current = this.pageCountState.get(event.pageId) ?? 0
            this.pageCountState.put(event.pageId, current + event.count)

            const pageCounts: Record<string, number> = {}
            for (const [key, value] of this.pageCountState.entries()) {
              pageCounts[key] = value
            }

            out.collect({ userId: event.userId, pageCounts })
          }
        }

        const processed = stream
          .keyBy((e) => e.userId)
          .process(new PageCountFunction())

        const result = await env.executeAndCollect(processed)

        // Last result should have accumulated counts
        expect(result[result.length - 1]?.pageCounts).toEqual({
          p1: 4, // 1 + 3
          p2: 2,
        })
      })

      it('should support map state operations', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements({ key: 'a' })

        class MapOpsFunction extends KeyedProcessFunction<
          string,
          { key: string },
          { keys: string[]; values: number[]; size: number }
        > {
          private mapState!: MapState<string, number>

          open(context: RuntimeContext) {
            this.mapState = context.getMapState(
              new MapStateDescriptor<string, number>('map')
            )
          }

          processElement(
            event: { key: string },
            ctx: Context,
            out: Collector<{ keys: string[]; values: number[]; size: number }>
          ) {
            this.mapState.put('a', 1)
            this.mapState.put('b', 2)
            this.mapState.put('c', 3)

            const keys = [...this.mapState.keys()]
            const values = [...this.mapState.values()]
            const size = this.mapState.size()

            // Check contains
            expect(this.mapState.contains('a')).toBe(true)
            expect(this.mapState.contains('z')).toBe(false)

            // Remove one
            this.mapState.remove('b')

            out.collect({ keys, values, size })
          }
        }

        const processed = stream.keyBy((e) => e.key).process(new MapOpsFunction())

        const result = await env.executeAndCollect(processed)
        expect(result[0]?.keys.sort()).toEqual(['a', 'b', 'c'])
        expect(result[0]?.size).toBe(3)
      })
    })

    describe('ReducingState', () => {
      it('should access reducing state', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(
          { key: 'a', value: 1 },
          { key: 'a', value: 2 },
          { key: 'a', value: 3 }
        )

        class SumFunction extends KeyedProcessFunction<
          string,
          { key: string; value: number },
          number
        > {
          private sumState!: ReducingState<number>

          open(context: RuntimeContext) {
            this.sumState = context.getReducingState(
              new ReducingStateDescriptor<number>('sum', (a, b) => a + b, 0)
            )
          }

          processElement(
            event: { key: string; value: number },
            ctx: Context,
            out: Collector<number>
          ) {
            this.sumState.add(event.value)
            out.collect(this.sumState.get()!)
          }
        }

        const processed = stream.keyBy((e) => e.key).process(new SumFunction())

        const result = await env.executeAndCollect(processed)
        expect(result).toEqual([1, 3, 6]) // Running sums
      })
    })

    describe('AggregatingState', () => {
      it('should access aggregating state', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(
          { key: 'a', value: 1 },
          { key: 'a', value: 2 },
          { key: 'a', value: 3 }
        )

        // Average aggregator
        const avgAggregator: AggregateFunction<
          number,
          { sum: number; count: number },
          number
        > = {
          createAccumulator: () => ({ sum: 0, count: 0 }),
          add: (value, acc) => ({ sum: acc.sum + value, count: acc.count + 1 }),
          getResult: (acc) => acc.sum / acc.count,
          merge: (a, b) => ({ sum: a.sum + b.sum, count: a.count + b.count }),
        }

        class AvgFunction extends KeyedProcessFunction<
          string,
          { key: string; value: number },
          number
        > {
          private avgState!: AggregatingState<number, number>

          open(context: RuntimeContext) {
            this.avgState = context.getAggregatingState(
              new AggregatingStateDescriptor<
                number,
                { sum: number; count: number },
                number
              >('avg', avgAggregator)
            )
          }

          processElement(
            event: { key: string; value: number },
            ctx: Context,
            out: Collector<number>
          ) {
            this.avgState.add(event.value)
            out.collect(this.avgState.get()!)
          }
        }

        const processed = stream.keyBy((e) => e.key).process(new AvgFunction())

        const result = await env.executeAndCollect(processed)
        expect(result).toEqual([1, 1.5, 2]) // Running averages
      })
    })

    describe('State Clear', () => {
      it('should clear state', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(
          { key: 'a', value: 1, clear: false },
          { key: 'a', value: 2, clear: false },
          { key: 'a', value: 0, clear: true }, // Clear signal
          { key: 'a', value: 3, clear: false }
        )

        class ClearableFunction extends KeyedProcessFunction<
          string,
          { key: string; value: number; clear: boolean },
          number
        > {
          private sumState!: ValueState<number>

          open(context: RuntimeContext) {
            this.sumState = context.getState(
              new ValueStateDescriptor<number>('sum', 0)
            )
          }

          processElement(
            event: { key: string; value: number; clear: boolean },
            ctx: Context,
            out: Collector<number>
          ) {
            if (event.clear) {
              this.sumState.clear()
              out.collect(0)
            } else {
              const current = this.sumState.value() ?? 0
              this.sumState.update(current + event.value)
              out.collect(this.sumState.value()!)
            }
          }
        }

        const processed = stream.keyBy((e) => e.key).process(new ClearableFunction())

        const result = await env.executeAndCollect(processed)
        expect(result).toEqual([1, 3, 0, 3]) // State cleared at index 2
      })
    })
  })

  // ===========================================================================
  // Process Functions with Timers
  // ===========================================================================

  describe('Process Functions with Timers', () => {
    it('should register event time timer', async () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements({ key: 'a', timestamp: 1000 }, { key: 'a', timestamp: 5000 })
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            key: string
            timestamp: number
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      const timerFired = vi.fn()

      class TimerFunction extends KeyedProcessFunction<
        string,
        { key: string; timestamp: number },
        string
      > {
        processElement(
          event: { key: string; timestamp: number },
          ctx: Context,
          out: Collector<string>
        ) {
          // Register timer 2 seconds after event
          ctx.timerService().registerEventTimeTimer(event.timestamp + 2000)
          out.collect(`event: ${event.timestamp}`)
        }

        onTimer(timestamp: number, ctx: OnTimerContext, out: Collector<string>) {
          timerFired(timestamp)
          out.collect(`timer: ${timestamp}`)
        }
      }

      const processed = stream.keyBy((e) => e.key).process(new TimerFunction())

      const result = await env.executeAndCollect(processed)

      // Timers should fire at 3000 and 7000
      expect(timerFired).toHaveBeenCalledWith(3000)
      expect(timerFired).toHaveBeenCalledWith(7000)
      expect(result).toContain('timer: 3000')
      expect(result).toContain('timer: 7000')
    })

    it('should register processing time timer', async () => {
      const env = createTestEnvironment()
      vi.useFakeTimers()

      const stream = env.fromElements({ key: 'a', value: 1 })

      const timerFired = vi.fn()

      class ProcessingTimeTimerFunction extends KeyedProcessFunction<
        string,
        { key: string; value: number },
        string
      > {
        processElement(
          event: { key: string; value: number },
          ctx: Context,
          out: Collector<string>
        ) {
          const currentTime = ctx.timerService().currentProcessingTime()
          ctx.timerService().registerProcessingTimeTimer(currentTime + 1000)
          out.collect(`event: ${event.value}`)
        }

        onTimer(timestamp: number, ctx: OnTimerContext, out: Collector<string>) {
          timerFired(timestamp)
          out.collect(`timer: ${timestamp}`)
        }
      }

      const processed = stream
        .keyBy((e) => e.key)
        .process(new ProcessingTimeTimerFunction())

      // Start execution
      const execution = env.executeAndCollect(processed)

      // Advance time to trigger timer
      vi.advanceTimersByTime(1000)

      await execution

      expect(timerFired).toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('should delete timer', async () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements(
          { key: 'a', timestamp: 1000, cancel: false },
          { key: 'a', timestamp: 2000, cancel: true } // Cancel the timer
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            key: string
            timestamp: number
            cancel: boolean
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      const timerFired = vi.fn()

      class CancelableTimerFunction extends KeyedProcessFunction<
        string,
        { key: string; timestamp: number; cancel: boolean },
        string
      > {
        private timerTimestamp: number = 0

        processElement(
          event: { key: string; timestamp: number; cancel: boolean },
          ctx: Context,
          out: Collector<string>
        ) {
          if (event.cancel) {
            ctx.timerService().deleteEventTimeTimer(this.timerTimestamp)
            out.collect('timer deleted')
          } else {
            this.timerTimestamp = event.timestamp + 5000
            ctx.timerService().registerEventTimeTimer(this.timerTimestamp)
            out.collect('timer registered')
          }
        }

        onTimer(timestamp: number, ctx: OnTimerContext, out: Collector<string>) {
          timerFired(timestamp)
          out.collect(`timer: ${timestamp}`)
        }
      }

      const processed = stream
        .keyBy((e) => e.key)
        .process(new CancelableTimerFunction())

      const result = await env.executeAndCollect(processed)

      // Timer should have been deleted
      expect(timerFired).not.toHaveBeenCalled()
      expect(result).toContain('timer deleted')
      expect(result).not.toContain('timer: 6000')
    })

    it('should access current watermark', async () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements({ key: 'a', timestamp: 1000 }, { key: 'a', timestamp: 5000 })
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            key: string
            timestamp: number
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      const watermarks: number[] = []

      class WatermarkAccessFunction extends KeyedProcessFunction<
        string,
        { key: string; timestamp: number },
        { watermark: number }
      > {
        processElement(
          event: { key: string; timestamp: number },
          ctx: Context,
          out: Collector<{ watermark: number }>
        ) {
          const watermark = ctx.timerService().currentWatermark()
          watermarks.push(watermark)
          out.collect({ watermark })
        }
      }

      const processed = stream
        .keyBy((e) => e.key)
        .process(new WatermarkAccessFunction())

      await env.executeAndCollect(processed)

      // Watermarks should be advancing
      expect(watermarks[1]).toBeGreaterThan(watermarks[0]!)
    })
  })

  // ===========================================================================
  // Checkpointing
  // ===========================================================================

  describe('Checkpointing', () => {
    it('should configure checkpoint interval', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      env.enableCheckpointing(10000)

      expect(env.getCheckpointConfig().getCheckpointInterval()).toBe(10000)
    })

    it('should configure checkpoint mode', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      env.enableCheckpointing(10000, CheckpointingMode.EXACTLY_ONCE)

      expect(env.getCheckpointConfig().getCheckpointingMode()).toBe(
        CheckpointingMode.EXACTLY_ONCE
      )
    })

    it('should configure checkpoint timeout', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const checkpointConfig = env.getCheckpointConfig()
      checkpointConfig.setCheckpointTimeout(60000)

      expect(checkpointConfig.getCheckpointTimeout()).toBe(60000)
    })

    it('should configure min pause between checkpoints', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const checkpointConfig = env.getCheckpointConfig()
      checkpointConfig.setMinPauseBetweenCheckpoints(5000)

      expect(checkpointConfig.getMinPauseBetweenCheckpoints()).toBe(5000)
    })

    it('should configure max concurrent checkpoints', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const checkpointConfig = env.getCheckpointConfig()
      checkpointConfig.setMaxConcurrentCheckpoints(1)

      expect(checkpointConfig.getMaxConcurrentCheckpoints()).toBe(1)
    })

    it('should enable unaligned checkpoints', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const checkpointConfig = env.getCheckpointConfig()
      checkpointConfig.enableUnalignedCheckpoints()

      expect(checkpointConfig.isUnalignedCheckpointsEnabled()).toBe(true)
    })

    it('should configure externalized checkpoints', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const checkpointConfig = env.getCheckpointConfig()
      checkpointConfig.setExternalizedCheckpointCleanup(
        CheckpointConfig.ExternalizedCheckpointCleanup.RETAIN_ON_CANCELLATION
      )

      expect(checkpointConfig.getExternalizedCheckpointCleanup()).toBe(
        CheckpointConfig.ExternalizedCheckpointCleanup.RETAIN_ON_CANCELLATION
      )
    })

    it('should configure checkpoint storage', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const storage = new CheckpointStorage('do://checkpoints')
      env.getCheckpointConfig().setCheckpointStorage(storage)

      expect(env.getCheckpointConfig().getCheckpointStorage()).toBe(storage)
    })
  })

  // ===========================================================================
  // Connectors - Sources
  // ===========================================================================

  describe('Sources', () => {
    it('should create source function', async () => {
      const env = createTestEnvironment()

      let running = true
      const source: SourceFunction<number> = {
        run: (ctx) => {
          let i = 0
          while (running && i < 5) {
            ctx.collect(i++)
          }
        },
        cancel: () => {
          running = false
        },
      }

      const stream = env.addSource(source)
      const result = await env.executeAndCollect(stream)

      expect(result).toEqual([0, 1, 2, 3, 4])
    })

    it('should create rich source function with lifecycle', async () => {
      const env = createTestEnvironment()

      const lifecycleEvents: string[] = []

      class LifecycleSource extends RichSourceFunction<number> {
        private running = true

        open(parameters: any) {
          lifecycleEvents.push('open')
        }

        run(ctx: { collect: (value: number) => void }) {
          for (let i = 0; this.running && i < 3; i++) {
            ctx.collect(i)
          }
        }

        cancel() {
          this.running = false
          lifecycleEvents.push('cancel')
        }

        close() {
          lifecycleEvents.push('close')
        }
      }

      const stream = env.addSource(new LifecycleSource())
      await env.executeAndCollect(stream)

      expect(lifecycleEvents).toContain('open')
      expect(lifecycleEvents).toContain('close')
    })

    it('should support source with parallelism', async () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      env.setParallelism(4)

      const source: SourceFunction<number> = {
        run: (ctx) => ctx.collect(1),
        cancel: () => {},
      }

      const stream = env.addSource(source).setParallelism(2)
      expect(stream.getParallelism()).toBe(2)
    })
  })

  // ===========================================================================
  // Connectors - Sinks
  // ===========================================================================

  describe('Sinks', () => {
    it('should create sink function', async () => {
      const env = createTestEnvironment()
      const collected: number[] = []

      const sink: SinkFunction<number> = {
        invoke: (value) => {
          collected.push(value)
        },
      }

      const stream = env.fromElements(1, 2, 3)
      stream.addSink(sink)

      await env.execute('Sink Test')

      expect(collected).toEqual([1, 2, 3])
    })

    it('should create rich sink function with lifecycle', async () => {
      const env = createTestEnvironment()
      const lifecycleEvents: string[] = []
      const collected: number[] = []

      class LifecycleSink extends RichSinkFunction<number> {
        open(parameters: any) {
          lifecycleEvents.push('open')
        }

        invoke(value: number) {
          collected.push(value)
        }

        close() {
          lifecycleEvents.push('close')
        }
      }

      const stream = env.fromElements(1, 2, 3)
      stream.addSink(new LifecycleSink())

      await env.execute('Rich Sink Test')

      expect(lifecycleEvents).toContain('open')
      expect(lifecycleEvents).toContain('close')
      expect(collected).toEqual([1, 2, 3])
    })

    it('should print to stdout', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3)

      // print() should not throw
      stream.print()

      await env.execute('Print Test')
    })

    it('should print with identifier', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3)

      stream.print('mystream')

      await env.execute('Print with ID Test')
    })

    it('should write to text file', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements('line1', 'line2', 'line3')

      // writeAsText should not throw
      stream.writeAsText('/tmp/test-output.txt')

      await env.execute('Write Text Test')
    })
  })

  // ===========================================================================
  // Time Utilities
  // ===========================================================================

  describe('Time Utilities', () => {
    it('should create time from milliseconds', () => {
      const time = Time.milliseconds(500)
      expect(time.toMilliseconds()).toBe(500)
    })

    it('should create time from seconds', () => {
      const time = Time.seconds(5)
      expect(time.toMilliseconds()).toBe(5000)
    })

    it('should create time from minutes', () => {
      const time = Time.minutes(2)
      expect(time.toMilliseconds()).toBe(120000)
    })

    it('should create time from hours', () => {
      const time = Time.hours(1)
      expect(time.toMilliseconds()).toBe(3600000)
    })

    it('should create time from days', () => {
      const time = Time.days(1)
      expect(time.toMilliseconds()).toBe(86400000)
    })

    it('should create Duration from time', () => {
      const duration = Duration.ofMillis(5000)
      expect(duration.toMillis()).toBe(5000)
    })
  })

  // ===========================================================================
  // Integration Tests
  // ===========================================================================

  describe('Integration', () => {
    it('should process click stream with windows and state', async () => {
      const env = createTestEnvironment()

      // Simulate click events
      const clicks = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'home', action: 'click' },
          { userId: 'u1', timestamp: 2000, pageId: 'products', action: 'click' },
          { userId: 'u2', timestamp: 3000, pageId: 'home', action: 'click' },
          { userId: 'u1', timestamp: 4000, pageId: 'checkout', action: 'click' },
          { userId: 'u2', timestamp: 5000, pageId: 'products', action: 'click' }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      // Count clicks per user in 5-second windows
      const clickCounts = clicks
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .aggregate({
          createAccumulator: () => ({ count: 0 }),
          add: (value, acc) => ({ count: acc.count + 1 }),
          getResult: (acc) => acc.count,
          merge: (a, b) => ({ count: a.count + b.count }),
        })

      const result = await env.executeAndCollect(clickCounts)

      // u1 has 3 clicks, u2 has 2 clicks in window [0, 5000)
      expect(result).toContain(3)
      expect(result).toContain(2)
    })

    it('should join two streams on key', async () => {
      const env = createTestEnvironment()

      const orders = env
        .fromElements(
          { orderId: 'o1', userId: 'u1', timestamp: 1000 },
          { orderId: 'o2', userId: 'u2', timestamp: 2000 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            orderId: string
            userId: string
            timestamp: number
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      const payments = env
        .fromElements(
          { paymentId: 'p1', orderId: 'o1', amount: 100, timestamp: 1500 },
          { paymentId: 'p2', orderId: 'o2', amount: 200, timestamp: 2500 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            paymentId: string
            orderId: string
            amount: number
            timestamp: number
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      // Join orders with payments
      const joined = orders
        .keyBy((o) => o.orderId)
        .connect(payments.keyBy((p) => p.orderId))
        .process({
          processElement1: vi.fn(),
          processElement2: vi.fn(),
        })

      expect(joined).toBeInstanceOf(DataStream)
    })

    it('should handle late events with side output', async () => {
      const env = createTestEnvironment()
      const lateTag = new OutputTag<ClickEvent>('late')

      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'p1', action: 'click' },
          { userId: 'u1', timestamp: 6000, pageId: 'p2', action: 'click' }, // On time
          { userId: 'u1', timestamp: 2000, pageId: 'p3', action: 'click' } // Late (after watermark)
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .allowedLateness(Time.seconds(0))
        .sideOutputLateData(lateTag)
        .reduce((a, b) => a)

      expect(windowed).toBeInstanceOf(DataStream)
    })
  })
})
