/**
 * @dotdo/flink - DataStream API Contract Tests
 *
 * TDD RED phase: These tests define the DataStream API contract.
 * Tests are written first and should FAIL initially until implementation.
 *
 * This file focuses specifically on core DataStream operations:
 * - map() - Transform each element
 * - filter() - Filter elements by predicate
 * - flatMap() - One-to-many transformation
 * - keyBy() - Partition by key (returns KeyedStream)
 * - union() - Merge multiple streams
 * - connect() - Connect two streams (returns ConnectedStreams)
 * - iterate() - Iterative processing
 * - addSink() - Add output sink
 *
 * @see https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/operators/overview/
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Environment
  StreamExecutionEnvironment,
  createTestEnvironment,

  // Streams
  DataStream,
  KeyedStream,
  ConnectedStreams,

  // Transformations
  MapFunction,
  FlatMapFunction,
  FilterFunction,

  // Connectors
  SinkFunction,
  RichSinkFunction,

  // Process functions
  CoProcessFunction,
  Context,
  Collector,
  RuntimeContext,

  // Internal utilities
  _clear,
} from '../index'

// Test data types
interface User {
  id: string
  name: string
  age: number
}

interface Event {
  userId: string
  type: string
  timestamp: number
}

interface IterationElement {
  value: number
  iteration: number
}

describe('@dotdo/flink - DataStream API Contract', () => {
  beforeEach(() => {
    _clear()
  })

  // ===========================================================================
  // DataStream.map() - Transform each element
  // ===========================================================================

  describe('DataStream.map()', () => {
    it('should transform each element with a function', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3, 4, 5)

      const mapped = stream.map((x) => x * 2)

      const result = await env.executeAndCollect(mapped)
      expect(result).toEqual([2, 4, 6, 8, 10])
    })

    it('should transform elements with MapFunction interface', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements<User>(
        { id: 'u1', name: 'Alice', age: 30 },
        { id: 'u2', name: 'Bob', age: 25 }
      )

      const mapFn: MapFunction<User, string> = {
        map: (user) => user.name.toUpperCase(),
      }

      const mapped = stream.map(mapFn)

      const result = await env.executeAndCollect(mapped)
      expect(result).toEqual(['ALICE', 'BOB'])
    })

    it('should transform to different output type', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements('hello', 'world', 'foo')

      const mapped = stream.map((s) => s.length)

      const result = await env.executeAndCollect(mapped)
      expect(result).toEqual([5, 5, 3])
    })

    it('should support rich map function with open/close lifecycle', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3)

      const lifecycle: string[] = []

      const richMapFn = {
        open: (ctx: RuntimeContext) => {
          lifecycle.push('open')
        },
        map: (value: number) => {
          lifecycle.push(`map:${value}`)
          return value * 10
        },
        close: () => {
          lifecycle.push('close')
        },
      }

      const mapped = stream.map(richMapFn)
      await env.executeAndCollect(mapped)

      expect(lifecycle).toContain('open')
      expect(lifecycle).toContain('map:1')
      expect(lifecycle).toContain('map:2')
      expect(lifecycle).toContain('map:3')
      expect(lifecycle).toContain('close')
    })

    it('should preserve stream order', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(5, 3, 8, 1, 9)

      const mapped = stream.map((x) => x + 100)

      const result = await env.executeAndCollect(mapped)
      expect(result).toEqual([105, 103, 108, 101, 109])
    })

    it('should chain multiple map operations', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3)

      const mapped = stream
        .map((x) => x * 2)
        .map((x) => x + 1)
        .map((x) => `value:${x}`)

      const result = await env.executeAndCollect(mapped)
      expect(result).toEqual(['value:3', 'value:5', 'value:7'])
    })
  })

  // ===========================================================================
  // DataStream.filter() - Filter elements by predicate
  // ===========================================================================

  describe('DataStream.filter()', () => {
    it('should filter elements with predicate function', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)

      const filtered = stream.filter((x) => x % 2 === 0)

      const result = await env.executeAndCollect(filtered)
      expect(result).toEqual([2, 4, 6, 8, 10])
    })

    it('should filter elements with FilterFunction interface', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements<User>(
        { id: 'u1', name: 'Alice', age: 30 },
        { id: 'u2', name: 'Bob', age: 17 },
        { id: 'u3', name: 'Charlie', age: 25 }
      )

      const filterFn: FilterFunction<User> = {
        filter: (user) => user.age >= 18,
      }

      const filtered = stream.filter(filterFn)

      const result = await env.executeAndCollect(filtered)
      expect(result).toHaveLength(2)
      expect(result.map((u) => u.name)).toEqual(['Alice', 'Charlie'])
    })

    it('should return empty stream when no elements match', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3, 4, 5)

      const filtered = stream.filter((x) => x > 100)

      const result = await env.executeAndCollect(filtered)
      expect(result).toEqual([])
    })

    it('should return all elements when all match', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(10, 20, 30, 40)

      const filtered = stream.filter((x) => x >= 10)

      const result = await env.executeAndCollect(filtered)
      expect(result).toEqual([10, 20, 30, 40])
    })

    it('should chain filter and map operations', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3, 4, 5, 6)

      const result = stream
        .filter((x) => x % 2 === 0)
        .map((x) => x * 10)

      const collected = await env.executeAndCollect(result)
      expect(collected).toEqual([20, 40, 60])
    })

    it('should filter complex objects by nested property', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { user: { active: true }, data: 'a' },
        { user: { active: false }, data: 'b' },
        { user: { active: true }, data: 'c' }
      )

      const filtered = stream.filter((item) => item.user.active)

      const result = await env.executeAndCollect(filtered)
      expect(result).toHaveLength(2)
      expect(result.map((r) => r.data)).toEqual(['a', 'c'])
    })
  })

  // ===========================================================================
  // DataStream.flatMap() - One-to-many transformation
  // ===========================================================================

  describe('DataStream.flatMap()', () => {
    it('should expand each element to multiple outputs', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements('hello world', 'foo bar baz')

      const flatMapped = stream.flatMap((line, out) => {
        for (const word of line.split(' ')) {
          out.collect(word)
        }
      })

      const result = await env.executeAndCollect(flatMapped)
      expect(result).toEqual(['hello', 'world', 'foo', 'bar', 'baz'])
    })

    it('should support FlatMapFunction interface', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements([1, 2], [3, 4, 5], [6])

      const flatMapFn: FlatMapFunction<number[], number> = {
        flatMap: (arr, out) => {
          for (const n of arr) {
            out.collect(n)
          }
        },
      }

      const flatMapped = stream.flatMap(flatMapFn)

      const result = await env.executeAndCollect(flatMapped)
      expect(result).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('should emit zero elements for some inputs', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3, 4, 5)

      const flatMapped = stream.flatMap((n, out) => {
        if (n % 2 === 0) {
          out.collect(n)
          out.collect(n * 10)
        }
        // Odd numbers emit nothing
      })

      const result = await env.executeAndCollect(flatMapped)
      expect(result).toEqual([2, 20, 4, 40])
    })

    it('should emit different types than input', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements<User>(
        { id: 'u1', name: 'Alice Bob', age: 30 }
      )

      const flatMapped = stream.flatMap((user, out) => {
        for (const namePart of user.name.split(' ')) {
          out.collect({ userId: user.id, name: namePart })
        }
      })

      const result = await env.executeAndCollect(flatMapped)
      expect(result).toEqual([
        { userId: 'u1', name: 'Alice' },
        { userId: 'u1', name: 'Bob' },
      ])
    })

    it('should handle empty input', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements<string>()

      const flatMapped = stream.flatMap((line, out) => {
        for (const word of line.split(' ')) {
          out.collect(word)
        }
      })

      const result = await env.executeAndCollect(flatMapped)
      expect(result).toEqual([])
    })

    it('should support multiple emissions per element', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(3)

      const flatMapped = stream.flatMap((n, out) => {
        for (let i = 1; i <= n; i++) {
          out.collect(i)
        }
      })

      const result = await env.executeAndCollect(flatMapped)
      expect(result).toEqual([1, 2, 3])
    })
  })

  // ===========================================================================
  // DataStream.keyBy() - Partition by key (returns KeyedStream)
  // ===========================================================================

  describe('DataStream.keyBy()', () => {
    it('should create KeyedStream with key selector function', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const stream = env.fromElements<Event>(
        { userId: 'u1', type: 'click', timestamp: 1000 },
        { userId: 'u2', type: 'view', timestamp: 2000 },
        { userId: 'u1', type: 'click', timestamp: 3000 }
      )

      const keyed = stream.keyBy((e) => e.userId)

      expect(keyed).toBeInstanceOf(KeyedStream)
    })

    it('should key by field name', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const stream = env.fromElements<User>(
        { id: 'u1', name: 'Alice', age: 30 },
        { id: 'u2', name: 'Bob', age: 25 }
      )

      const keyed = stream.keyBy('id')

      expect(keyed).toBeInstanceOf(KeyedStream)
    })

    it('should key by composite key', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const stream = env.fromElements(
        { region: 'us', category: 'electronics', value: 100 },
        { region: 'eu', category: 'books', value: 50 },
        { region: 'us', category: 'electronics', value: 200 }
      )

      const keyed = stream.keyBy((item) => `${item.region}:${item.category}`)

      expect(keyed).toBeInstanceOf(KeyedStream)
    })

    it('should partition elements by key for reduce', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { key: 'a', value: 1 },
        { key: 'b', value: 10 },
        { key: 'a', value: 2 },
        { key: 'b', value: 20 },
        { key: 'a', value: 3 }
      )

      const reduced = stream
        .keyBy((e) => e.key)
        .reduce((a, b) => ({ key: a.key, value: a.value + b.value }))

      const result = await env.executeAndCollect(reduced)

      // Should have results for both keys
      const keyA = result.find((r) => r.key === 'a')
      const keyB = result.find((r) => r.key === 'b')

      expect(keyA?.value).toBe(6) // 1 + 2 + 3
      expect(keyB?.value).toBe(30) // 10 + 20
    })

    it('should maintain key partitioning across operations', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { userId: 'u1', score: 10 },
        { userId: 'u2', score: 20 },
        { userId: 'u1', score: 30 }
      )

      const result = stream
        .keyBy((e) => e.userId)
        .reduce((a, b) => ({ userId: a.userId, score: a.score + b.score }))

      const collected = await env.executeAndCollect(result)
      expect(collected).toHaveLength(2)
    })

    it('should support numeric keys', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const stream = env.fromElements(
        { category: 1, value: 'a' },
        { category: 2, value: 'b' }
      )

      const keyed = stream.keyBy((e) => e.category)

      expect(keyed).toBeInstanceOf(KeyedStream)
    })
  })

  // ===========================================================================
  // DataStream.union() - Merge multiple streams
  // ===========================================================================

  describe('DataStream.union()', () => {
    it('should merge two streams', async () => {
      const env = createTestEnvironment()
      const stream1 = env.fromElements(1, 2, 3)
      const stream2 = env.fromElements(4, 5, 6)

      const unioned = stream1.union(stream2)

      const result = await env.executeAndCollect(unioned)
      expect(result.sort()).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('should merge multiple streams', async () => {
      const env = createTestEnvironment()
      const stream1 = env.fromElements('a', 'b')
      const stream2 = env.fromElements('c', 'd')
      const stream3 = env.fromElements('e', 'f')
      const stream4 = env.fromElements('g')

      const unioned = stream1.union(stream2, stream3, stream4)

      const result = await env.executeAndCollect(unioned)
      expect(result.sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    })

    it('should handle union with empty stream', async () => {
      const env = createTestEnvironment()
      const stream1 = env.fromElements(1, 2, 3)
      const stream2 = env.fromElements<number>()

      const unioned = stream1.union(stream2)

      const result = await env.executeAndCollect(unioned)
      expect(result.sort()).toEqual([1, 2, 3])
    })

    it('should union streams of same type', async () => {
      const env = createTestEnvironment()
      const stream1 = env.fromElements<User>(
        { id: 'u1', name: 'Alice', age: 30 }
      )
      const stream2 = env.fromElements<User>(
        { id: 'u2', name: 'Bob', age: 25 }
      )

      const unioned = stream1.union(stream2)

      const result = await env.executeAndCollect(unioned)
      expect(result).toHaveLength(2)
      expect(result.map((u) => u.id).sort()).toEqual(['u1', 'u2'])
    })

    it('should allow further transformations after union', async () => {
      const env = createTestEnvironment()
      const stream1 = env.fromElements(1, 2)
      const stream2 = env.fromElements(3, 4)

      const result = stream1
        .union(stream2)
        .map((x) => x * 10)
        .filter((x) => x > 15)

      const collected = await env.executeAndCollect(result)
      expect(collected.sort()).toEqual([20, 30, 40])
    })

    it('should support chained unions', async () => {
      const env = createTestEnvironment()
      const s1 = env.fromElements(1)
      const s2 = env.fromElements(2)
      const s3 = env.fromElements(3)

      const unioned = s1.union(s2).union(s3)

      const result = await env.executeAndCollect(unioned)
      expect(result.sort()).toEqual([1, 2, 3])
    })
  })

  // ===========================================================================
  // DataStream.connect() - Connect two streams (returns ConnectedStreams)
  // ===========================================================================

  describe('DataStream.connect()', () => {
    it('should return ConnectedStreams', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const stream1 = env.fromElements({ type: 'click' })
      const stream2 = env.fromElements({ type: 'view' })

      const connected = stream1.connect(stream2)

      expect(connected).toBeInstanceOf(ConnectedStreams)
    })

    it('should connect streams of different types', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const clicks = env.fromElements({ userId: 'u1', page: 'home' })
      const purchases = env.fromElements({ userId: 'u1', amount: 100 })

      const connected = clicks.connect(purchases)

      expect(connected).toBeInstanceOf(ConnectedStreams)
    })

    it('should process connected streams with CoProcessFunction', async () => {
      const env = createTestEnvironment()
      const stream1 = env.fromElements(
        { source: 'a', value: 1 },
        { source: 'a', value: 2 }
      )
      const stream2 = env.fromElements(
        { source: 'b', data: 'x' },
        { source: 'b', data: 'y' }
      )

      const connected = stream1.connect(stream2)

      const coProcessFn: CoProcessFunction<
        { source: string; value: number },
        { source: string; data: string },
        string
      > = {
        processElement1: (value, ctx, out) => {
          out.collect(`from-1:${value.value}`)
        },
        processElement2: (value, ctx, out) => {
          out.collect(`from-2:${value.data}`)
        },
      }

      const processed = connected.process(coProcessFn)

      const result = await env.executeAndCollect(processed)
      expect(result).toContain('from-1:1')
      expect(result).toContain('from-1:2')
      expect(result).toContain('from-2:x')
      expect(result).toContain('from-2:y')
    })

    it('should allow flatMap on each connected stream', async () => {
      const env = createTestEnvironment()
      const rules = env.fromElements({ pattern: 'ERROR' })
      const logs = env.fromElements(
        { message: 'INFO: started' },
        { message: 'ERROR: failed' }
      )

      const connected = rules.connect(logs)

      const processed = connected.process({
        processElement1: (rule, ctx, out) => {
          out.collect({ type: 'rule', pattern: rule.pattern })
        },
        processElement2: (log, ctx, out) => {
          out.collect({ type: 'log', text: log.message })
        },
      })

      const result = await env.executeAndCollect(processed)
      expect(result).toHaveLength(3)
    })

    it('should support map on connected streams', async () => {
      const env = createTestEnvironment()
      const s1 = env.fromElements(1, 2)
      const s2 = env.fromElements('a', 'b')

      const connected = s1.connect(s2)

      const processed = connected.process({
        processElement1: (n, ctx, out) => out.collect(`num:${n}`),
        processElement2: (s, ctx, out) => out.collect(`str:${s}`),
      })

      const result = await env.executeAndCollect(processed)
      expect(result).toHaveLength(4)
    })
  })

  // ===========================================================================
  // DataStream.iterate() - Iterative processing
  // ===========================================================================

  describe('DataStream.iterate()', () => {
    it('should create iteration stream', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const stream = env.fromElements<IterationElement>(
        { value: 10, iteration: 0 },
        { value: 5, iteration: 0 }
      )

      const iteration = stream.iterate()

      expect(iteration).toBeDefined()
      // iterate() should return an IterativeStream
      expect(iteration.getBody).toBeDefined()
      expect(iteration.closeWith).toBeDefined()
    })

    it('should iterate until convergence condition', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { value: 10, iteration: 0 },
        { value: 20, iteration: 0 }
      )

      // Iterate: halve values until < 3
      const iteration = stream.iterate()

      const body = iteration.getBody()
        .map((e) => ({
          value: Math.floor(e.value / 2),
          iteration: e.iteration + 1,
        }))

      // Filter for feedback: continue if value >= 3
      const feedback = body.filter((e) => e.value >= 3)

      // Output: values that are done (< 3)
      const output = body.filter((e) => e.value < 3)

      iteration.closeWith(feedback)

      const result = await env.executeAndCollect(output)

      // 10 -> 5 -> 2 (done at iteration 2)
      // 20 -> 10 -> 5 -> 2 (done at iteration 3)
      expect(result).toHaveLength(2)
      for (const r of result) {
        expect(r.value).toBeLessThan(3)
      }
    })

    it('should support max iterations', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements({ value: 1000, iteration: 0 })

      const maxIterations = 5
      const iteration = stream.iterate(maxIterations)

      const body = iteration.getBody()
        .map((e) => ({
          value: e.value - 1,
          iteration: e.iteration + 1,
        }))

      // Always feed back (would loop forever without max)
      iteration.closeWith(body)

      const result = await env.executeAndCollect(body)

      // Should stop after maxIterations
      const maxIter = Math.max(...result.map((r) => r.iteration))
      expect(maxIter).toBeLessThanOrEqual(maxIterations)
    })

    it('should handle iteration with keyed state', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { key: 'a', value: 8, iteration: 0 },
        { key: 'b', value: 16, iteration: 0 }
      )

      const iteration = stream.iterate()

      const body = iteration.getBody()
        .keyBy((e) => e.key)
        .map((e) => ({
          key: e.key,
          value: Math.floor(e.value / 2),
          iteration: e.iteration + 1,
        }))

      const feedback = body.filter((e) => e.value >= 2)
      const output = body.filter((e) => e.value < 2)

      iteration.closeWith(feedback)

      const result = await env.executeAndCollect(output)

      // Both keys should eventually converge
      expect(result).toHaveLength(2)
      expect(result.map((r) => r.key).sort()).toEqual(['a', 'b'])
    })

    it('should support iterating with timeout', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements({ value: 100, iteration: 0 })

      // Set iteration timeout of 1 second
      const iteration = stream.iterate({ maxIterations: 1000, timeout: 1000 })

      const body = iteration.getBody()
        .map((e) => ({
          value: e.value - 1,
          iteration: e.iteration + 1,
        }))

      iteration.closeWith(body)

      // Should complete within timeout or max iterations
      const result = await env.executeAndCollect(body)
      expect(result.length).toBeGreaterThan(0)
    })

    it('should emit final results after iteration completes', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { id: 1, count: 3 },
        { id: 2, count: 2 }
      )

      const iteration = stream.iterate()

      const body = iteration.getBody()
        .map((e) => ({
          id: e.id,
          count: e.count - 1,
        }))

      // Feedback elements with count > 0
      const feedback = body.filter((e) => e.count > 0)

      // Final output: elements where count reaches 0
      const finalOutput = body.filter((e) => e.count === 0)

      iteration.closeWith(feedback)

      const result = await env.executeAndCollect(finalOutput)

      // Both elements should reach count=0
      expect(result).toHaveLength(2)
      expect(result.every((r) => r.count === 0)).toBe(true)
    })
  })

  // ===========================================================================
  // DataStream.addSink() - Add output sink
  // ===========================================================================

  describe('DataStream.addSink()', () => {
    it('should invoke sink for each element', async () => {
      const env = createTestEnvironment()
      const collected: number[] = []

      const sink: SinkFunction<number> = {
        invoke: (value) => {
          collected.push(value)
        },
      }

      const stream = env.fromElements(1, 2, 3, 4, 5)
      stream.addSink(sink)

      await env.execute('Sink Test')

      expect(collected).toEqual([1, 2, 3, 4, 5])
    })

    it('should support RichSinkFunction with lifecycle', async () => {
      const env = createTestEnvironment()
      const lifecycle: string[] = []
      const collected: string[] = []

      class LifecycleSink extends RichSinkFunction<string> {
        open(parameters: any) {
          lifecycle.push('open')
        }

        invoke(value: string) {
          lifecycle.push(`invoke:${value}`)
          collected.push(value)
        }

        close() {
          lifecycle.push('close')
        }
      }

      const stream = env.fromElements('a', 'b', 'c')
      stream.addSink(new LifecycleSink())

      await env.execute('Rich Sink Test')

      expect(lifecycle).toContain('open')
      expect(lifecycle).toContain('invoke:a')
      expect(lifecycle).toContain('invoke:b')
      expect(lifecycle).toContain('invoke:c')
      expect(lifecycle).toContain('close')
      expect(collected).toEqual(['a', 'b', 'c'])
    })

    it('should support multiple sinks', async () => {
      const env = createTestEnvironment()
      const collected1: number[] = []
      const collected2: number[] = []

      const stream = env.fromElements(1, 2, 3)

      stream.addSink({
        invoke: (value) => collected1.push(value),
      })

      stream.addSink({
        invoke: (value) => collected2.push(value * 10),
      })

      await env.execute('Multi Sink Test')

      expect(collected1).toEqual([1, 2, 3])
      expect(collected2).toEqual([10, 20, 30])
    })

    it('should sink after transformations', async () => {
      const env = createTestEnvironment()
      const collected: number[] = []

      const stream = env.fromElements(1, 2, 3, 4, 5)
        .filter((x) => x % 2 === 0)
        .map((x) => x * 100)

      stream.addSink({
        invoke: (value) => collected.push(value),
      })

      await env.execute('Transform Sink Test')

      expect(collected).toEqual([200, 400])
    })

    it('should call sink open before invoke', async () => {
      const env = createTestEnvironment()
      const order: string[] = []

      class OrderTrackingSink extends RichSinkFunction<number> {
        private initialized = false

        open(parameters: any) {
          order.push('open')
          this.initialized = true
        }

        invoke(value: number) {
          if (this.initialized) {
            order.push(`invoke:${value}`)
          } else {
            throw new Error('invoke called before open')
          }
        }

        close() {
          order.push('close')
        }
      }

      const stream = env.fromElements(1, 2)
      stream.addSink(new OrderTrackingSink())

      await env.execute('Order Test')

      expect(order[0]).toBe('open')
      expect(order[order.length - 1]).toBe('close')
    })

    it('should handle sink errors gracefully', async () => {
      const env = createTestEnvironment()
      const collected: number[] = []

      const faultySink: SinkFunction<number> = {
        invoke: (value) => {
          if (value === 3) {
            throw new Error('Sink error on value 3')
          }
          collected.push(value)
        },
      }

      const stream = env.fromElements(1, 2, 3, 4, 5)
      stream.addSink(faultySink)

      // Should throw or handle error
      await expect(env.execute('Faulty Sink Test')).rejects.toThrow()
    })

    it('should support async sink operations', async () => {
      const env = createTestEnvironment()
      const collected: number[] = []

      const asyncSink: SinkFunction<number> = {
        invoke: async (value) => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          collected.push(value)
        },
      }

      const stream = env.fromElements(1, 2, 3)
      stream.addSink(asyncSink)

      await env.execute('Async Sink Test')

      expect(collected.sort()).toEqual([1, 2, 3])
    })
  })

  // ===========================================================================
  // DataStream Integration Tests
  // ===========================================================================

  describe('DataStream Integration', () => {
    it('should chain all basic operations', async () => {
      const env = createTestEnvironment()

      const result = env.fromElements(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
        .filter((x) => x % 2 === 0) // 2, 4, 6, 8, 10
        .map((x) => x * 2) // 4, 8, 12, 16, 20
        .flatMap((x, out) => {
          out.collect(x)
          out.collect(x + 1)
        }) // 4, 5, 8, 9, 12, 13, 16, 17, 20, 21
        .filter((x) => x < 15) // 4, 5, 8, 9, 12, 13

      const collected = await env.executeAndCollect(result)
      expect(collected).toEqual([4, 5, 8, 9, 12, 13])
    })

    it('should handle union followed by keyBy', async () => {
      const env = createTestEnvironment()

      const stream1 = env.fromElements(
        { key: 'a', value: 1 },
        { key: 'b', value: 2 }
      )
      const stream2 = env.fromElements(
        { key: 'a', value: 3 },
        { key: 'b', value: 4 }
      )

      const result = stream1
        .union(stream2)
        .keyBy((e) => e.key)
        .reduce((a, b) => ({ key: a.key, value: a.value + b.value }))

      const collected = await env.executeAndCollect(result)

      expect(collected).toHaveLength(2)
      const keyA = collected.find((r) => r.key === 'a')
      const keyB = collected.find((r) => r.key === 'b')
      expect(keyA?.value).toBe(4) // 1 + 3
      expect(keyB?.value).toBe(6) // 2 + 4
    })

    it('should support complex event processing pipeline', async () => {
      const env = createTestEnvironment()

      const events = env.fromElements<Event>(
        { userId: 'u1', type: 'click', timestamp: 1000 },
        { userId: 'u2', type: 'view', timestamp: 1100 },
        { userId: 'u1', type: 'click', timestamp: 1200 },
        { userId: 'u1', type: 'purchase', timestamp: 1300 },
        { userId: 'u2', type: 'click', timestamp: 1400 }
      )

      // Count clicks per user
      const clickCounts = events
        .filter((e) => e.type === 'click')
        .map((e) => ({ userId: e.userId, count: 1 }))
        .keyBy((e) => e.userId)
        .reduce((a, b) => ({ userId: a.userId, count: a.count + b.count }))

      const result = await env.executeAndCollect(clickCounts)

      expect(result).toHaveLength(2)
      const u1 = result.find((r) => r.userId === 'u1')
      const u2 = result.find((r) => r.userId === 'u2')
      expect(u1?.count).toBe(2)
      expect(u2?.count).toBe(1)
    })
  })
})
