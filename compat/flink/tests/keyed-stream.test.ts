/**
 * @dotdo/flink - KeyedStream API Tests (TDD RED Phase)
 * Issue: dotdo-3he0e
 *
 * These tests define the expected behavior for KeyedStream operations.
 * They should FAIL until the implementation is complete.
 *
 * Test coverage:
 * 1. KeyedStream.reduce() - Rolling aggregation by key
 * 2. KeyedStream.sum() - Sum field by key
 * 3. KeyedStream.min()/max() - Min/max by key
 * 4. KeyedStream.window() - Apply windowing (returns WindowedStream)
 * 5. KeyedStream.process() - ProcessFunction with state
 * 6. State access via RuntimeContext.getState()
 * 7. Value, List, Map, and Reducing state descriptors
 *
 * @see https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/operators/overview/#keyedstream-transformations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  StreamExecutionEnvironment,
  KeyedStream,
  DataStream,
  WindowedStream,
  KeyedProcessFunction,
  RuntimeContext,
  Context,
  Collector,
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
  Time,
  TumblingEventTimeWindows,
  WatermarkStrategy,
  ReduceFunction,
  AggregateFunction,
  _clear,
  createTestEnvironment,
} from '../index'

// Test event types
interface SensorReading {
  sensorId: string
  timestamp: number
  value: number
  type: string
}

interface PageView {
  userId: string
  pageId: string
  timestamp: number
  duration: number
}

interface Transaction {
  accountId: string
  amount: number
  timestamp: number
  type: 'credit' | 'debit'
}

describe('@dotdo/flink - KeyedStream Operations', () => {
  beforeEach(() => {
    _clear()
  })

  // ===========================================================================
  // KeyedStream.reduce() - Rolling Aggregation by Key
  // ===========================================================================

  describe('KeyedStream.reduce()', () => {
    it('should perform rolling reduce by key with lambda function', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { key: 'a', value: 1 },
        { key: 'b', value: 10 },
        { key: 'a', value: 2 },
        { key: 'b', value: 20 },
        { key: 'a', value: 3 },
        { key: 'b', value: 30 }
      )

      const reduced = stream
        .keyBy((e) => e.key)
        .reduce((a, b) => ({ key: a.key, value: a.value + b.value }))

      const result = await env.executeAndCollect(reduced)

      // Each key's final reduction result
      expect(result).toContainEqual({ key: 'a', value: 6 }) // 1 + 2 + 3
      expect(result).toContainEqual({ key: 'b', value: 60 }) // 10 + 20 + 30
    })

    it('should perform rolling reduce with ReduceFunction interface', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { sensorId: 's1', value: 100 },
        { sensorId: 's2', value: 200 },
        { sensorId: 's1', value: 150 },
        { sensorId: 's2', value: 250 }
      )

      const reducer: ReduceFunction<{ sensorId: string; value: number }> = {
        reduce: (a, b) => ({
          sensorId: a.sensorId,
          value: Math.max(a.value, b.value), // Running max
        }),
      }

      const reduced = stream.keyBy((e) => e.sensorId).reduce(reducer)

      const result = await env.executeAndCollect(reduced)
      expect(result).toContainEqual({ sensorId: 's1', value: 150 })
      expect(result).toContainEqual({ sensorId: 's2', value: 250 })
    })

    it('should emit intermediate rolling results for each element', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { key: 'a', value: 1 },
        { key: 'a', value: 2 },
        { key: 'a', value: 3 }
      )

      const reduced = stream
        .keyBy((e) => e.key)
        .reduce((a, b) => ({ key: a.key, value: a.value + b.value }))

      const result = await env.executeAndCollect(reduced)

      // Rolling reduce should emit after each element:
      // After element 1: { key: 'a', value: 1 }
      // After element 2: { key: 'a', value: 3 }  (1+2)
      // After element 3: { key: 'a', value: 6 }  (3+3)
      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({ key: 'a', value: 1 })
      expect(result[1]).toEqual({ key: 'a', value: 3 })
      expect(result[2]).toEqual({ key: 'a', value: 6 })
    })

    it('should handle empty stream', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements<{ key: string; value: number }>()

      const reduced = stream
        .keyBy((e) => e.key)
        .reduce((a, b) => ({ key: a.key, value: a.value + b.value }))

      const result = await env.executeAndCollect(reduced)
      expect(result).toHaveLength(0)
    })

    it('should handle single element per key', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { key: 'a', value: 5 },
        { key: 'b', value: 10 }
      )

      const reduced = stream
        .keyBy((e) => e.key)
        .reduce((a, b) => ({ key: a.key, value: a.value + b.value }))

      const result = await env.executeAndCollect(reduced)
      // Single elements should pass through unchanged
      expect(result).toContainEqual({ key: 'a', value: 5 })
      expect(result).toContainEqual({ key: 'b', value: 10 })
    })
  })

  // ===========================================================================
  // KeyedStream.sum() - Sum Field by Key
  // ===========================================================================

  describe('KeyedStream.sum()', () => {
    it('should sum numeric field by key using field name', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { category: 'electronics', sales: 100 },
        { category: 'clothing', sales: 50 },
        { category: 'electronics', sales: 200 },
        { category: 'clothing', sales: 75 }
      )

      const summed = stream.keyBy((e) => e.category).sum('sales')

      const result = await env.executeAndCollect(summed)
      expect(result).toContainEqual({ category: 'electronics', sales: 300 })
      expect(result).toContainEqual({ category: 'clothing', sales: 125 })
    })

    it('should sum by positional index (tuple-like elements)', async () => {
      const env = createTestEnvironment()
      // Simulating tuple-like objects with positional access
      const stream = env.fromElements(
        { 0: 'key1', 1: 100 },
        { 0: 'key1', 1: 200 },
        { 0: 'key2', 1: 50 }
      )

      const summed = stream.keyBy((e) => e[0]).sum(1)

      const result = await env.executeAndCollect(summed)
      expect(result).toContainEqual({ 0: 'key1', 1: 300 })
      expect(result).toContainEqual({ 0: 'key2', 1: 50 })
    })

    it('should emit rolling sums for each element', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { userId: 'u1', count: 1 },
        { userId: 'u1', count: 2 },
        { userId: 'u1', count: 3 }
      )

      const summed = stream.keyBy((e) => e.userId).sum('count')

      const result = await env.executeAndCollect(summed)
      // Rolling sums: 1, 3, 6
      expect(result).toHaveLength(3)
      expect(result.map((r) => r.count)).toEqual([1, 3, 6])
    })
  })

  // ===========================================================================
  // KeyedStream.min() / KeyedStream.max() - Min/Max by Key
  // ===========================================================================

  describe('KeyedStream.min()', () => {
    it('should compute minimum by field for each key', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { sensorId: 's1', temperature: 25, timestamp: 1000 },
        { sensorId: 's2', temperature: 30, timestamp: 1000 },
        { sensorId: 's1', temperature: 22, timestamp: 2000 },
        { sensorId: 's2', temperature: 28, timestamp: 2000 },
        { sensorId: 's1', temperature: 27, timestamp: 3000 }
      )

      const minStream = stream.keyBy((e) => e.sensorId).min('temperature')

      const result = await env.executeAndCollect(minStream)
      // s1: min is 22
      // s2: min is 28
      expect(result).toContainEqual(expect.objectContaining({ sensorId: 's1', temperature: 22 }))
      expect(result).toContainEqual(expect.objectContaining({ sensorId: 's2', temperature: 28 }))
    })

    it('should emit rolling minimum for each element', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { key: 'a', value: 5 },
        { key: 'a', value: 3 },
        { key: 'a', value: 7 },
        { key: 'a', value: 2 }
      )

      const minStream = stream.keyBy((e) => e.key).min('value')

      const result = await env.executeAndCollect(minStream)
      // Rolling min: 5, 3, 3, 2
      expect(result.map((r) => r.value)).toEqual([5, 3, 3, 2])
    })
  })

  describe('KeyedStream.max()', () => {
    it('should compute maximum by field for each key', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { sensorId: 's1', temperature: 25, timestamp: 1000 },
        { sensorId: 's2', temperature: 30, timestamp: 1000 },
        { sensorId: 's1', temperature: 22, timestamp: 2000 },
        { sensorId: 's2', temperature: 35, timestamp: 2000 }
      )

      const maxStream = stream.keyBy((e) => e.sensorId).max('temperature')

      const result = await env.executeAndCollect(maxStream)
      // s1: max is 25
      // s2: max is 35
      expect(result).toContainEqual(expect.objectContaining({ sensorId: 's1', temperature: 25 }))
      expect(result).toContainEqual(expect.objectContaining({ sensorId: 's2', temperature: 35 }))
    })

    it('should emit rolling maximum for each element', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { key: 'a', value: 2 },
        { key: 'a', value: 5 },
        { key: 'a', value: 3 },
        { key: 'a', value: 8 }
      )

      const maxStream = stream.keyBy((e) => e.key).max('value')

      const result = await env.executeAndCollect(maxStream)
      // Rolling max: 2, 5, 5, 8
      expect(result.map((r) => r.value)).toEqual([2, 5, 5, 8])
    })
  })

  describe('KeyedStream.minBy() / maxBy()', () => {
    it('should return element with minimum field value', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { id: 'a1', score: 85, name: 'Alice' },
        { id: 'a2', score: 92, name: 'Bob' },
        { id: 'a3', score: 78, name: 'Charlie' }
      )

      const minByStream = stream.keyBy(() => 'all').minBy('score')

      const result = await env.executeAndCollect(minByStream)
      // Should return the complete element with minimum score
      expect(result[result.length - 1]).toEqual({ id: 'a3', score: 78, name: 'Charlie' })
    })

    it('should return element with maximum field value', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { id: 'a1', score: 85, name: 'Alice' },
        { id: 'a2', score: 92, name: 'Bob' },
        { id: 'a3', score: 78, name: 'Charlie' }
      )

      const maxByStream = stream.keyBy(() => 'all').maxBy('score')

      const result = await env.executeAndCollect(maxByStream)
      // Should return the complete element with maximum score
      expect(result[result.length - 1]).toEqual({ id: 'a2', score: 92, name: 'Bob' })
    })
  })

  // ===========================================================================
  // KeyedStream.window() - Apply Windowing
  // ===========================================================================

  describe('KeyedStream.window()', () => {
    it('should return WindowedStream when window assigner is applied', async () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, action: 'click' },
          { userId: 'u1', timestamp: 2000, action: 'view' }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{ userId: string; timestamp: number; action: string }>().withTimestampAssigner((e) => e.timestamp)
        )

      const windowed = stream
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))

      expect(windowed).toBeInstanceOf(WindowedStream)
    })

    it('should properly partition by key before windowing', async () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, value: 1 },
          { userId: 'u2', timestamp: 1500, value: 10 },
          { userId: 'u1', timestamp: 2000, value: 2 },
          { userId: 'u2', timestamp: 2500, value: 20 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{ userId: string; timestamp: number; value: number }>().withTimestampAssigner((e) => e.timestamp)
        )

      const windowed = stream
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => ({ ...a, value: a.value + b.value }))

      const result = await env.executeAndCollect(windowed)

      // u1: 1 + 2 = 3
      // u2: 10 + 20 = 30
      expect(result).toContainEqual(expect.objectContaining({ userId: 'u1', value: 3 }))
      expect(result).toContainEqual(expect.objectContaining({ userId: 'u2', value: 30 }))
    })

    it('should support countWindow for count-based windows', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { key: 'a', value: 1 },
        { key: 'a', value: 2 },
        { key: 'a', value: 3 },
        { key: 'a', value: 4 },
        { key: 'a', value: 5 },
        { key: 'a', value: 6 }
      )

      // Count window of size 3
      const windowed = stream
        .keyBy((e) => e.key)
        .countWindow(3)
        .reduce((a, b) => ({ key: a.key, value: a.value + b.value }))

      const result = await env.executeAndCollect(windowed)

      // First window: 1+2+3 = 6
      // Second window: 4+5+6 = 15
      expect(result).toHaveLength(2)
      expect(result[0]?.value).toBe(6)
      expect(result[1]?.value).toBe(15)
    })

    it('should support sliding count window', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { key: 'a', value: 1 },
        { key: 'a', value: 2 },
        { key: 'a', value: 3 },
        { key: 'a', value: 4 }
      )

      // Sliding count window: size 3, slide 1
      const windowed = stream
        .keyBy((e) => e.key)
        .countWindow(3, 1)
        .reduce((a, b) => ({ key: a.key, value: a.value + b.value }))

      const result = await env.executeAndCollect(windowed)

      // Windows: [1,2,3]=6, [2,3,4]=9
      expect(result).toContainEqual({ key: 'a', value: 6 })
      expect(result).toContainEqual({ key: 'a', value: 9 })
    })
  })

  // ===========================================================================
  // KeyedStream.process() - ProcessFunction with State
  // ===========================================================================

  describe('KeyedStream.process()', () => {
    it('should process elements with KeyedProcessFunction', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { userId: 'u1', action: 'login' },
        { userId: 'u2', action: 'view' },
        { userId: 'u1', action: 'click' }
      )

      class SimpleProcessFunction extends KeyedProcessFunction<
        string,
        { userId: string; action: string },
        { userId: string; actions: string[] }
      > {
        processElement(
          event: { userId: string; action: string },
          ctx: Context,
          out: Collector<{ userId: string; actions: string[] }>
        ) {
          out.collect({ userId: event.userId, actions: [event.action] })
        }
      }

      const processed = stream
        .keyBy((e) => e.userId)
        .process(new SimpleProcessFunction())

      const result = await env.executeAndCollect(processed)
      expect(result).toHaveLength(3)
    })

    it('should provide access to current key in process function', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { userId: 'alice', value: 1 },
        { userId: 'bob', value: 2 }
      )

      class KeyAccessFunction extends KeyedProcessFunction<
        string,
        { userId: string; value: number },
        { currentKey: string; value: number }
      > {
        processElement(
          event: { userId: string; value: number },
          ctx: Context,
          out: Collector<{ currentKey: string; value: number }>
        ) {
          // getCurrentKey() should return the key for this element
          const currentKey = ctx.getCurrentKey() as string
          out.collect({ currentKey, value: event.value })
        }
      }

      const processed = stream
        .keyBy((e) => e.userId)
        .process(new KeyAccessFunction())

      const result = await env.executeAndCollect(processed)
      expect(result).toContainEqual({ currentKey: 'alice', value: 1 })
      expect(result).toContainEqual({ currentKey: 'bob', value: 2 })
    })

    it('should maintain separate state per key', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { userId: 'u1', value: 1 },
        { userId: 'u2', value: 10 },
        { userId: 'u1', value: 2 },
        { userId: 'u2', value: 20 },
        { userId: 'u1', value: 3 }
      )

      class CountingFunction extends KeyedProcessFunction<
        string,
        { userId: string; value: number },
        { userId: string; count: number; sum: number }
      > {
        private countState!: ValueState<number>
        private sumState!: ValueState<number>

        open(ctx: RuntimeContext) {
          this.countState = ctx.getState(new ValueStateDescriptor<number>('count', 0))
          this.sumState = ctx.getState(new ValueStateDescriptor<number>('sum', 0))
        }

        processElement(
          event: { userId: string; value: number },
          ctx: Context,
          out: Collector<{ userId: string; count: number; sum: number }>
        ) {
          const count = (this.countState.value() ?? 0) + 1
          const sum = (this.sumState.value() ?? 0) + event.value

          this.countState.update(count)
          this.sumState.update(sum)

          out.collect({ userId: event.userId, count, sum })
        }
      }

      const processed = stream
        .keyBy((e) => e.userId)
        .process(new CountingFunction())

      const result = await env.executeAndCollect(processed)

      // u1: count=3, sum=6 (1+2+3)
      // u2: count=2, sum=30 (10+20)
      const u1Results = result.filter((r) => r.userId === 'u1')
      const u2Results = result.filter((r) => r.userId === 'u2')

      expect(u1Results[u1Results.length - 1]).toEqual({ userId: 'u1', count: 3, sum: 6 })
      expect(u2Results[u2Results.length - 1]).toEqual({ userId: 'u2', count: 2, sum: 30 })
    })
  })

  // ===========================================================================
  // State Access via RuntimeContext.getState()
  // ===========================================================================

  describe('RuntimeContext.getState()', () => {
    it('should provide ValueState through RuntimeContext', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { key: 'a', value: 1 },
        { key: 'a', value: 2 }
      )

      let stateAccessed = false

      class StateAccessFunction extends KeyedProcessFunction<
        string,
        { key: string; value: number },
        number
      > {
        private state!: ValueState<number>

        open(ctx: RuntimeContext) {
          this.state = ctx.getState(new ValueStateDescriptor<number>('my-state', 0))
          stateAccessed = true
        }

        processElement(
          event: { key: string; value: number },
          ctx: Context,
          out: Collector<number>
        ) {
          const current = this.state.value() ?? 0
          this.state.update(current + event.value)
          out.collect(this.state.value()!)
        }
      }

      const processed = stream.keyBy((e) => e.key).process(new StateAccessFunction())
      await env.executeAndCollect(processed)

      expect(stateAccessed).toBe(true)
    })

    it('should provide ListState through RuntimeContext', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { key: 'a', item: 'x' },
        { key: 'a', item: 'y' },
        { key: 'a', item: 'z' }
      )

      class ListStateFunction extends KeyedProcessFunction<
        string,
        { key: string; item: string },
        string[]
      > {
        private listState!: ListState<string>

        open(ctx: RuntimeContext) {
          this.listState = ctx.getListState(new ListStateDescriptor<string>('items'))
        }

        processElement(
          event: { key: string; item: string },
          ctx: Context,
          out: Collector<string[]>
        ) {
          this.listState.add(event.item)
          out.collect([...this.listState.get()])
        }
      }

      const processed = stream.keyBy((e) => e.key).process(new ListStateFunction())
      const result = await env.executeAndCollect(processed)

      // Should accumulate: ['x'], ['x','y'], ['x','y','z']
      expect(result[0]).toEqual(['x'])
      expect(result[1]).toEqual(['x', 'y'])
      expect(result[2]).toEqual(['x', 'y', 'z'])
    })

    it('should provide MapState through RuntimeContext', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { user: 'alice', page: 'home', visits: 1 },
        { user: 'alice', page: 'about', visits: 2 },
        { user: 'alice', page: 'home', visits: 3 }
      )

      class MapStateFunction extends KeyedProcessFunction<
        string,
        { user: string; page: string; visits: number },
        Record<string, number>
      > {
        private pageVisits!: MapState<string, number>

        open(ctx: RuntimeContext) {
          this.pageVisits = ctx.getMapState(new MapStateDescriptor<string, number>('page-visits'))
        }

        processElement(
          event: { user: string; page: string; visits: number },
          ctx: Context,
          out: Collector<Record<string, number>>
        ) {
          const current = this.pageVisits.get(event.page) ?? 0
          this.pageVisits.put(event.page, current + event.visits)

          const result: Record<string, number> = {}
          for (const [k, v] of this.pageVisits.entries()) {
            result[k] = v
          }
          out.collect(result)
        }
      }

      const processed = stream.keyBy((e) => e.user).process(new MapStateFunction())
      const result = await env.executeAndCollect(processed)

      expect(result[result.length - 1]).toEqual({ home: 4, about: 2 })
    })

    it('should provide ReducingState through RuntimeContext', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { key: 'a', value: 10 },
        { key: 'a', value: 20 },
        { key: 'a', value: 30 }
      )

      class ReducingStateFunction extends KeyedProcessFunction<
        string,
        { key: string; value: number },
        number
      > {
        private sumState!: ReducingState<number>

        open(ctx: RuntimeContext) {
          this.sumState = ctx.getReducingState(
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

      const processed = stream.keyBy((e) => e.key).process(new ReducingStateFunction())
      const result = await env.executeAndCollect(processed)

      // Running sums: 10, 30, 60
      expect(result).toEqual([10, 30, 60])
    })

    it('should provide AggregatingState through RuntimeContext', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { key: 'a', value: 2 },
        { key: 'a', value: 4 },
        { key: 'a', value: 6 }
      )

      const avgAggregator: AggregateFunction<number, { sum: number; count: number }, number> = {
        createAccumulator: () => ({ sum: 0, count: 0 }),
        add: (value, acc) => ({ sum: acc.sum + value, count: acc.count + 1 }),
        getResult: (acc) => acc.sum / acc.count,
        merge: (a, b) => ({ sum: a.sum + b.sum, count: a.count + b.count }),
      }

      class AggregatingStateFunction extends KeyedProcessFunction<
        string,
        { key: string; value: number },
        number
      > {
        private avgState!: AggregatingState<number, number>

        open(ctx: RuntimeContext) {
          this.avgState = ctx.getAggregatingState(
            new AggregatingStateDescriptor<number, { sum: number; count: number }, number>(
              'avg',
              avgAggregator
            )
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

      const processed = stream.keyBy((e) => e.key).process(new AggregatingStateFunction())
      const result = await env.executeAndCollect(processed)

      // Running averages: 2/1=2, 6/2=3, 12/3=4
      expect(result).toEqual([2, 3, 4])
    })
  })

  // ===========================================================================
  // State Descriptors
  // ===========================================================================

  describe('State Descriptors', () => {
    describe('ValueStateDescriptor', () => {
      it('should create descriptor with name and default value', () => {
        const descriptor = new ValueStateDescriptor<number>('counter', 0)

        expect(descriptor.name).toBe('counter')
        expect(descriptor.defaultValue).toBe(0)
      })

      it('should create descriptor with null default value', () => {
        const descriptor = new ValueStateDescriptor<string>('name')

        expect(descriptor.name).toBe('name')
        expect(descriptor.defaultValue).toBeNull()
      })

      it('should support TTL configuration', () => {
        const descriptor = new ValueStateDescriptor<number>('ttl-state', 0)

        const ttlConfig = StateTtlConfig.newBuilder(Time.hours(1))
          .setUpdateType(StateTtlConfig.UpdateType.OnCreateAndWrite)
          .setStateVisibility(StateTtlConfig.StateVisibility.NeverReturnExpired)
          .build()

        descriptor.enableTimeToLive(ttlConfig)

        expect(descriptor.getTtlConfig()).toBeDefined()
        expect(descriptor.getTtlConfig()?.getTtl().toMilliseconds()).toBe(3600000)
      })
    })

    describe('ListStateDescriptor', () => {
      it('should create descriptor with name', () => {
        const descriptor = new ListStateDescriptor<string>('items')

        expect(descriptor.name).toBe('items')
        expect(descriptor.defaultValue).toEqual([])
      })

      it('should create descriptor with default value', () => {
        const descriptor = new ListStateDescriptor<number>('numbers', [1, 2, 3])

        expect(descriptor.defaultValue).toEqual([1, 2, 3])
      })
    })

    describe('MapStateDescriptor', () => {
      it('should create descriptor with name', () => {
        const descriptor = new MapStateDescriptor<string, number>('counts')

        expect(descriptor.name).toBe('counts')
      })

      it('should support complex key and value types', () => {
        interface Key {
          userId: string
          sessionId: string
        }
        interface Value {
          count: number
          lastSeen: number
        }

        const descriptor = new MapStateDescriptor<Key, Value>('sessions')

        expect(descriptor.name).toBe('sessions')
      })
    })

    describe('ReducingStateDescriptor', () => {
      it('should create descriptor with reduce function', () => {
        const descriptor = new ReducingStateDescriptor<number>(
          'sum',
          (a, b) => a + b,
          0
        )

        expect(descriptor.name).toBe('sum')
        expect(descriptor.reduceFunction(1, 2)).toBe(3)
        expect(descriptor.defaultValue).toBe(0)
      })
    })

    describe('AggregatingStateDescriptor', () => {
      it('should create descriptor with aggregate function', () => {
        const avgAggregator: AggregateFunction<number, { sum: number; count: number }, number> = {
          createAccumulator: () => ({ sum: 0, count: 0 }),
          add: (value, acc) => ({ sum: acc.sum + value, count: acc.count + 1 }),
          getResult: (acc) => (acc.count === 0 ? 0 : acc.sum / acc.count),
          merge: (a, b) => ({ sum: a.sum + b.sum, count: a.count + b.count }),
        }

        const descriptor = new AggregatingStateDescriptor<
          number,
          { sum: number; count: number },
          number
        >('avg', avgAggregator)

        expect(descriptor.name).toBe('avg')
        expect(descriptor.aggregateFunction.createAccumulator()).toEqual({ sum: 0, count: 0 })
      })
    })
  })

  // ===========================================================================
  // State Operations
  // ===========================================================================

  describe('State Operations', () => {
    describe('ValueState operations', () => {
      it('should return null/default when state is not set', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements({ key: 'a', value: 1 })

        let initialValue: number | null = null

        class CheckInitialStateFunction extends KeyedProcessFunction<
          string,
          { key: string; value: number },
          number
        > {
          private state!: ValueState<number>

          open(ctx: RuntimeContext) {
            this.state = ctx.getState(new ValueStateDescriptor<number>('state', 42))
          }

          processElement(
            event: { key: string; value: number },
            ctx: Context,
            out: Collector<number>
          ) {
            initialValue = this.state.value()
            out.collect(initialValue ?? 0)
          }
        }

        const processed = stream.keyBy((e) => e.key).process(new CheckInitialStateFunction())
        await env.executeAndCollect(processed)

        expect(initialValue).toBe(42) // Should return default value
      })

      it('should update and retrieve value', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(
          { key: 'a', value: 5 },
          { key: 'a', value: 10 }
        )

        class UpdateStateFunction extends KeyedProcessFunction<
          string,
          { key: string; value: number },
          number
        > {
          private state!: ValueState<number>

          open(ctx: RuntimeContext) {
            this.state = ctx.getState(new ValueStateDescriptor<number>('state', 0))
          }

          processElement(
            event: { key: string; value: number },
            ctx: Context,
            out: Collector<number>
          ) {
            this.state.update(event.value)
            out.collect(this.state.value()!)
          }
        }

        const processed = stream.keyBy((e) => e.key).process(new UpdateStateFunction())
        const result = await env.executeAndCollect(processed)

        expect(result).toEqual([5, 10])
      })

      it('should clear state', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(
          { key: 'a', value: 5, clear: false },
          { key: 'a', value: 0, clear: true },
          { key: 'a', value: 10, clear: false }
        )

        class ClearStateFunction extends KeyedProcessFunction<
          string,
          { key: string; value: number; clear: boolean },
          number | null
        > {
          private state!: ValueState<number>

          open(ctx: RuntimeContext) {
            this.state = ctx.getState(new ValueStateDescriptor<number>('state'))
          }

          processElement(
            event: { key: string; value: number; clear: boolean },
            ctx: Context,
            out: Collector<number | null>
          ) {
            if (event.clear) {
              this.state.clear()
              out.collect(this.state.value())
            } else {
              this.state.update(event.value)
              out.collect(this.state.value())
            }
          }
        }

        const processed = stream.keyBy((e) => e.key).process(new ClearStateFunction())
        const result = await env.executeAndCollect(processed)

        expect(result).toEqual([5, null, 10])
      })
    })

    describe('ListState operations', () => {
      it('should add elements to list', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(
          { key: 'a', item: 'x' },
          { key: 'a', item: 'y' }
        )

        class AddToListFunction extends KeyedProcessFunction<
          string,
          { key: string; item: string },
          string[]
        > {
          private list!: ListState<string>

          open(ctx: RuntimeContext) {
            this.list = ctx.getListState(new ListStateDescriptor<string>('items'))
          }

          processElement(
            event: { key: string; item: string },
            ctx: Context,
            out: Collector<string[]>
          ) {
            this.list.add(event.item)
            out.collect([...this.list.get()])
          }
        }

        const processed = stream.keyBy((e) => e.key).process(new AddToListFunction())
        const result = await env.executeAndCollect(processed)

        expect(result[1]).toEqual(['x', 'y'])
      })

      it('should addAll elements at once', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements({ key: 'a', items: ['a', 'b', 'c'] })

        class AddAllFunction extends KeyedProcessFunction<
          string,
          { key: string; items: string[] },
          string[]
        > {
          private list!: ListState<string>

          open(ctx: RuntimeContext) {
            this.list = ctx.getListState(new ListStateDescriptor<string>('items'))
          }

          processElement(
            event: { key: string; items: string[] },
            ctx: Context,
            out: Collector<string[]>
          ) {
            this.list.addAll(event.items)
            out.collect([...this.list.get()])
          }
        }

        const processed = stream.keyBy((e) => e.key).process(new AddAllFunction())
        const result = await env.executeAndCollect(processed)

        expect(result[0]).toEqual(['a', 'b', 'c'])
      })

      it('should update entire list', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(
          { key: 'a', items: ['x'] },
          { key: 'a', items: ['a', 'b', 'c'] }
        )

        class UpdateListFunction extends KeyedProcessFunction<
          string,
          { key: string; items: string[] },
          string[]
        > {
          private list!: ListState<string>

          open(ctx: RuntimeContext) {
            this.list = ctx.getListState(new ListStateDescriptor<string>('items'))
          }

          processElement(
            event: { key: string; items: string[] },
            ctx: Context,
            out: Collector<string[]>
          ) {
            this.list.update(event.items)
            out.collect([...this.list.get()])
          }
        }

        const processed = stream.keyBy((e) => e.key).process(new UpdateListFunction())
        const result = await env.executeAndCollect(processed)

        expect(result[1]).toEqual(['a', 'b', 'c']) // Update replaces, not appends
      })
    })

    describe('MapState operations', () => {
      it('should put and get values', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(
          { key: 'a', k: 'x', v: 1 },
          { key: 'a', k: 'y', v: 2 }
        )

        class MapPutGetFunction extends KeyedProcessFunction<
          string,
          { key: string; k: string; v: number },
          number | undefined
        > {
          private map!: MapState<string, number>

          open(ctx: RuntimeContext) {
            this.map = ctx.getMapState(new MapStateDescriptor<string, number>('map'))
          }

          processElement(
            event: { key: string; k: string; v: number },
            ctx: Context,
            out: Collector<number | undefined>
          ) {
            this.map.put(event.k, event.v)
            out.collect(this.map.get(event.k))
          }
        }

        const processed = stream.keyBy((e) => e.key).process(new MapPutGetFunction())
        const result = await env.executeAndCollect(processed)

        expect(result).toEqual([1, 2])
      })

      it('should check contains and remove', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements(
          { key: 'a', action: 'put', k: 'x', v: 1 },
          { key: 'a', action: 'check', k: 'x', v: 0 },
          { key: 'a', action: 'remove', k: 'x', v: 0 },
          { key: 'a', action: 'check', k: 'x', v: 0 }
        )

        class MapContainsFunction extends KeyedProcessFunction<
          string,
          { key: string; action: string; k: string; v: number },
          boolean
        > {
          private map!: MapState<string, number>

          open(ctx: RuntimeContext) {
            this.map = ctx.getMapState(new MapStateDescriptor<string, number>('map'))
          }

          processElement(
            event: { key: string; action: string; k: string; v: number },
            ctx: Context,
            out: Collector<boolean>
          ) {
            if (event.action === 'put') {
              this.map.put(event.k, event.v)
              out.collect(true)
            } else if (event.action === 'check') {
              out.collect(this.map.contains(event.k))
            } else if (event.action === 'remove') {
              this.map.remove(event.k)
              out.collect(true)
            }
          }
        }

        const processed = stream.keyBy((e) => e.key).process(new MapContainsFunction())
        const result = await env.executeAndCollect(processed)

        // put -> true, check -> true (exists), remove -> true, check -> false (removed)
        expect(result).toEqual([true, true, true, false])
      })

      it('should iterate keys, values, and entries', async () => {
        const env = createTestEnvironment()
        const stream = env.fromElements({ key: 'a' })

        class MapIterationFunction extends KeyedProcessFunction<
          string,
          { key: string },
          { keys: string[]; values: number[]; size: number }
        > {
          private map!: MapState<string, number>

          open(ctx: RuntimeContext) {
            this.map = ctx.getMapState(new MapStateDescriptor<string, number>('map'))
          }

          processElement(
            event: { key: string },
            ctx: Context,
            out: Collector<{ keys: string[]; values: number[]; size: number }>
          ) {
            this.map.put('a', 1)
            this.map.put('b', 2)
            this.map.put('c', 3)

            out.collect({
              keys: [...this.map.keys()].sort(),
              values: [...this.map.values()].sort((a, b) => a - b),
              size: this.map.size(),
            })
          }
        }

        const processed = stream.keyBy((e) => e.key).process(new MapIterationFunction())
        const result = await env.executeAndCollect(processed)

        expect(result[0]).toEqual({
          keys: ['a', 'b', 'c'],
          values: [1, 2, 3],
          size: 3,
        })
      })
    })
  })

  // ===========================================================================
  // Key Partitioning
  // ===========================================================================

  describe('Key Partitioning', () => {
    it('should partition by string key', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { userId: 'alice', value: 1 },
        { userId: 'bob', value: 2 },
        { userId: 'alice', value: 3 }
      )

      const keyed = stream.keyBy((e) => e.userId)
      expect(keyed).toBeInstanceOf(KeyedStream)
    })

    it('should partition by numeric key', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { categoryId: 1, amount: 100 },
        { categoryId: 2, amount: 200 },
        { categoryId: 1, amount: 150 }
      )

      const keyed = stream.keyBy((e) => e.categoryId)
      expect(keyed).toBeInstanceOf(KeyedStream)
    })

    it('should partition by composite key', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { userId: 'u1', sessionId: 's1', action: 'click' },
        { userId: 'u1', sessionId: 's2', action: 'view' },
        { userId: 'u1', sessionId: 's1', action: 'scroll' }
      )

      // Composite key using tuple-like structure
      const keyed = stream.keyBy((e) => `${e.userId}:${e.sessionId}`)

      const reduced = keyed.reduce((a, b) => ({
        userId: a.userId,
        sessionId: a.sessionId,
        action: `${a.action},${b.action}`,
      }))

      const result = await env.executeAndCollect(reduced)

      // u1:s1 should have 2 actions combined
      // u1:s2 should have 1 action
      expect(result).toContainEqual(
        expect.objectContaining({ userId: 'u1', sessionId: 's1' })
      )
    })

    it('should partition by field name shorthand', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const stream = env.fromElements(
        { category: 'A', value: 1 },
        { category: 'B', value: 2 }
      )

      // keyBy with field name instead of function
      const keyed = stream.keyBy('category')
      expect(keyed).toBeInstanceOf(KeyedStream)
    })

    it('should maintain key order within partitions', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { key: 'a', seq: 1 },
        { key: 'b', seq: 1 },
        { key: 'a', seq: 2 },
        { key: 'b', seq: 2 },
        { key: 'a', seq: 3 }
      )

      class OrderTrackingFunction extends KeyedProcessFunction<
        string,
        { key: string; seq: number },
        { key: string; seqs: number[] }
      > {
        private seqState!: ListState<number>

        open(ctx: RuntimeContext) {
          this.seqState = ctx.getListState(new ListStateDescriptor<number>('seqs'))
        }

        processElement(
          event: { key: string; seq: number },
          ctx: Context,
          out: Collector<{ key: string; seqs: number[] }>
        ) {
          this.seqState.add(event.seq)
          out.collect({ key: event.key, seqs: [...this.seqState.get()] })
        }
      }

      const processed = stream
        .keyBy((e) => e.key)
        .process(new OrderTrackingFunction())

      const result = await env.executeAndCollect(processed)

      // Check that sequences are in order within each key
      const aResults = result.filter((r) => r.key === 'a')
      const lastA = aResults[aResults.length - 1]
      expect(lastA?.seqs).toEqual([1, 2, 3])

      const bResults = result.filter((r) => r.key === 'b')
      const lastB = bResults[bResults.length - 1]
      expect(lastB?.seqs).toEqual([1, 2])
    })
  })

  // ===========================================================================
  // State Backend Integration
  // ===========================================================================

  describe('State Backend Integration', () => {
    it('should work with default state backend', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { key: 'a', value: 1 },
        { key: 'a', value: 2 }
      )

      class SimpleStateFunction extends KeyedProcessFunction<
        string,
        { key: string; value: number },
        number
      > {
        private state!: ValueState<number>

        open(ctx: RuntimeContext) {
          this.state = ctx.getState(new ValueStateDescriptor<number>('state', 0))
        }

        processElement(
          event: { key: string; value: number },
          ctx: Context,
          out: Collector<number>
        ) {
          const current = this.state.value() ?? 0
          this.state.update(current + event.value)
          out.collect(this.state.value()!)
        }
      }

      const processed = stream.keyBy((e) => e.key).process(new SimpleStateFunction())
      const result = await env.executeAndCollect(processed)

      expect(result).toEqual([1, 3])
    })

    it('should isolate state between different keys', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { key: 'a', value: 100 },
        { key: 'b', value: 1 },
        { key: 'a', value: 200 },
        { key: 'b', value: 2 }
      )

      class IsolationTestFunction extends KeyedProcessFunction<
        string,
        { key: string; value: number },
        { key: string; state: number }
      > {
        private state!: ValueState<number>

        open(ctx: RuntimeContext) {
          this.state = ctx.getState(new ValueStateDescriptor<number>('state', 0))
        }

        processElement(
          event: { key: string; value: number },
          ctx: Context,
          out: Collector<{ key: string; state: number }>
        ) {
          const current = this.state.value() ?? 0
          this.state.update(current + event.value)
          out.collect({ key: event.key, state: this.state.value()! })
        }
      }

      const processed = stream.keyBy((e) => e.key).process(new IsolationTestFunction())
      const result = await env.executeAndCollect(processed)

      // Key 'a' state should be independent from key 'b' state
      const aResults = result.filter((r) => r.key === 'a')
      const bResults = result.filter((r) => r.key === 'b')

      expect(aResults[aResults.length - 1]?.state).toBe(300) // 100 + 200
      expect(bResults[bResults.length - 1]?.state).toBe(3) // 1 + 2
    })
  })
})
