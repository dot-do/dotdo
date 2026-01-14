/**
 * @dotdo/flink - Apache Flink DataStream API Compat Layer Tests
 *
 * Core tests for stateful stream processing with in-memory backend.
 *
 * @see https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/overview/
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  StreamExecutionEnvironment,
  LocalStreamEnvironment,
  DataStream,
  KeyedStream,
  ConnectedStreams,
  WindowedStream,
  MapFunction,
  FlatMapFunction,
  FilterFunction,
  TumblingEventTimeWindows,
  TumblingProcessingTimeWindows,
  SlidingEventTimeWindows,
  SessionWindows,
  GlobalWindows,
  Time,
  Duration,
  WatermarkStrategy,
  Watermark,
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
  KeyedProcessFunction,
  ProcessFunction,
  Context,
  OnTimerContext,
  Collector,
  RuntimeContext,
  CheckpointConfig,
  CheckpointingMode,
  StateBackend,
  SourceFunction,
  SinkFunction,
  RichSourceFunction,
  RichSinkFunction,
  CountTrigger,
  EventTimeTrigger,
  ProcessingTimeTrigger,
  OutputTag,
  AggregateFunction,
  _clear,
  createTestEnvironment,
} from '../src/index'

describe('@dotdo/flink - Apache Flink DataStream API', () => {
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

    it('should configure checkpointing', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      env.enableCheckpointing(5000)
      expect(env.getCheckpointConfig().getCheckpointInterval()).toBe(5000)
    })

    it('should set state backend', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const backend = new StateBackend('do-storage')
      env.setStateBackend(backend)
      expect(env.getStateBackend()).toBe(backend)
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
      const stream = env.fromCollection([{ id: 1 }, { id: 2 }])
      expect(stream).toBeInstanceOf(DataStream)
    })

    it('should generate sequence', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const stream = env.generateSequence(1, 100)
      expect(stream).toBeInstanceOf(DataStream)
    })
  })

  // ===========================================================================
  // DataStream Transformations
  // ===========================================================================

  describe('DataStream Transformations', () => {
    it('should map elements', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3)
      const mapped = stream.map((x) => x * 2)
      const result = await env.executeAndCollect(mapped)
      expect(result).toEqual([2, 4, 6])
    })

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

    it('should filter elements', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3, 4, 5)
      const filtered = stream.filter((x) => x % 2 === 0)
      const result = await env.executeAndCollect(filtered)
      expect(result).toEqual([2, 4])
    })

    it('should create KeyedStream', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const stream = env.fromElements(
        { userId: 'u1', value: 1 },
        { userId: 'u2', value: 2 }
      )
      const keyed = stream.keyBy((e) => e.userId)
      expect(keyed).toBeInstanceOf(KeyedStream)
    })

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

    it('should union streams', async () => {
      const env = createTestEnvironment()
      const stream1 = env.fromElements(1, 2)
      const stream2 = env.fromElements(3, 4)
      const unioned = stream1.union(stream2)
      const result = await env.executeAndCollect(unioned)
      expect(result.sort()).toEqual([1, 2, 3, 4])
    })

    it('should connect streams', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const stream1 = env.fromElements({ type: 'click' })
      const stream2 = env.fromElements({ type: 'view' })
      const connected = stream1.connect(stream2)
      expect(connected).toBeInstanceOf(ConnectedStreams)
    })
  })

  // ===========================================================================
  // Windows
  // ===========================================================================

  describe('Windows', () => {
    it('should create tumbling event time window', async () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements(
          { key: 'a', timestamp: 1000, value: 1 },
          { key: 'a', timestamp: 2000, value: 2 },
          { key: 'a', timestamp: 6000, value: 3 },
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
      expect(result).toContainEqual(expect.objectContaining({ key: 'a', value: 3 }))
      expect(result).toContainEqual(expect.objectContaining({ key: 'a', value: 7 }))
    })

    it('should create session window', async () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements(
          { key: 'a', timestamp: 1000, value: 1 },
          { key: 'a', timestamp: 2000, value: 2 },
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
      expect(result).toContainEqual(expect.objectContaining({ key: 'a', value: 3 }))
      expect(result).toContainEqual(expect.objectContaining({ key: 'a', value: 7 }))
    })

    it('should create global window with count trigger', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { key: 'a', value: 1 },
        { key: 'a', value: 2 },
        { key: 'a', value: 3 }
      )

      const windowed = stream
        .keyBy((e) => e.key)
        .window(GlobalWindows.create())
        .trigger(CountTrigger.of(3))
        .reduce((a, b) => ({ ...a, value: a.value + b.value }))

      const result = await env.executeAndCollect(windowed)
      expect(result).toHaveLength(1)
      expect(result[0]?.value).toBe(6)
    })
  })

  // ===========================================================================
  // Watermarks
  // ===========================================================================

  describe('Watermarks', () => {
    it('should create bounded out of orderness strategy', () => {
      const strategy = WatermarkStrategy.forBoundedOutOfOrderness(Time.seconds(5))
      expect(strategy).toBeDefined()
    })

    it('should create monotonous timestamps strategy', () => {
      const strategy = WatermarkStrategy.forMonotonousTimestamps()
      expect(strategy).toBeDefined()
    })

    it('should create no watermarks strategy', () => {
      const strategy = WatermarkStrategy.noWatermarks()
      expect(strategy).toBeDefined()
    })
  })

  // ===========================================================================
  // State Management
  // ===========================================================================

  describe('State Management', () => {
    it('should access value state', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { userId: 'u1', value: 1 },
        { userId: 'u1', value: 2 },
        { userId: 'u2', value: 3 },
        { userId: 'u1', value: 4 }
      )

      class CountingFunction extends KeyedProcessFunction<
        string,
        { userId: string; value: number },
        { userId: string; total: number; count: number }
      > {
        private countState!: ValueState<number>
        private totalState!: ValueState<number>

        open(context: RuntimeContext) {
          this.countState = context.getState(new ValueStateDescriptor<number>('count', 0))
          this.totalState = context.getState(new ValueStateDescriptor<number>('total', 0))
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

      const processed = stream.keyBy((e) => e.userId).process(new CountingFunction())
      const result = await env.executeAndCollect(processed)

      expect(result).toContainEqual({ userId: 'u1', total: 7, count: 3 })
      expect(result).toContainEqual({ userId: 'u2', total: 3, count: 1 })
    })

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
          this.pagesState = context.getListState(new ListStateDescriptor<string>('pages', []))
        }

        processElement(
          event: { userId: string; pageId: string },
          ctx: Context,
          out: Collector<{ userId: string; history: string[] }>
        ) {
          this.pagesState.add(event.pageId)
          out.collect({ userId: event.userId, history: [...this.pagesState.get()] })
        }
      }

      const processed = stream.keyBy((e) => e.userId).process(new PageHistoryFunction())
      const result = await env.executeAndCollect(processed)
      expect(result[result.length - 1]?.history).toEqual(['p1', 'p2', 'p3'])
    })

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
          this.pageCountState = context.getMapState(new MapStateDescriptor<string, number>('page-counts'))
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

      const processed = stream.keyBy((e) => e.userId).process(new PageCountFunction())
      const result = await env.executeAndCollect(processed)
      expect(result[result.length - 1]?.pageCounts).toEqual({ p1: 4, p2: 2 })
    })

    it('should access reducing state', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { key: 'a', value: 1 },
        { key: 'a', value: 2 },
        { key: 'a', value: 3 }
      )

      class SumFunction extends KeyedProcessFunction<string, { key: string; value: number }, number> {
        private sumState!: ReducingState<number>

        open(context: RuntimeContext) {
          this.sumState = context.getReducingState(
            new ReducingStateDescriptor<number>('sum', (a, b) => a + b, 0)
          )
        }

        processElement(event: { key: string; value: number }, ctx: Context, out: Collector<number>) {
          this.sumState.add(event.value)
          out.collect(this.sumState.get()!)
        }
      }

      const processed = stream.keyBy((e) => e.key).process(new SumFunction())
      const result = await env.executeAndCollect(processed)
      expect(result).toEqual([1, 3, 6])
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
      expect(env.getCheckpointConfig().getCheckpointingMode()).toBe(CheckpointingMode.EXACTLY_ONCE)
    })

    it('should configure checkpoint timeout', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const config = env.getCheckpointConfig()
      config.setCheckpointTimeout(60000)
      expect(config.getCheckpointTimeout()).toBe(60000)
    })
  })

  // ===========================================================================
  // Sources and Sinks
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
  })

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

    it('should create Duration', () => {
      const duration = Duration.ofMillis(5000)
      expect(duration.toMillis()).toBe(5000)
    })
  })
})
