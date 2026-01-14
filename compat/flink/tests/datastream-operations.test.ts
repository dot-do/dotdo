/**
 * @dotdo/flink - DataStream Operations Contract Tests (TDD RED Phase)
 * Issue: dotdo-vg5vo
 *
 * These tests define additional expected behaviors for DataStream operations.
 * Tests are written FIRST and should FAIL until implementation is complete.
 *
 * Test coverage:
 * 1. map() - Edge cases, error handling, type transformations
 * 2. filter() - Edge cases, null handling, complex predicates
 * 3. flatMap() - Edge cases, async operations, error handling
 * 4. keyBy() - Advanced keying scenarios, null keys, composite keys
 *
 * @see https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/operators/overview/
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  StreamExecutionEnvironment,
  createTestEnvironment,
  DataStream,
  KeyedStream,
  MapFunction,
  FlatMapFunction,
  FilterFunction,
  Collector,
  RuntimeContext,
  _clear,
} from '../index'

// Test types
interface Event {
  id: string
  userId: string
  timestamp: number
  value: number
  metadata?: Record<string, unknown>
}

interface User {
  id: string
  name: string
  age: number
  active: boolean
}

interface NestedData {
  level1: {
    level2: {
      level3: {
        value: number
      }
    }
  }
}

describe('@dotdo/flink - DataStream Operations Contract (RED Phase)', () => {
  beforeEach(() => {
    _clear()
  })

  // ===========================================================================
  // map() Operations - Extended Tests
  // ===========================================================================

  describe('map() - Extended Behavior', () => {
    it('should handle null/undefined values in elements', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements<{ value: number | null }>(
        { value: 10 },
        { value: null },
        { value: 30 }
      )

      const mapped = stream.map((e) => ({
        original: e.value,
        doubled: e.value !== null ? e.value * 2 : 0,
      }))

      const result = await env.executeAndCollect(mapped)

      expect(result).toEqual([
        { original: 10, doubled: 20 },
        { original: null, doubled: 0 },
        { original: 30, doubled: 60 },
      ])
    })

    it('should handle exceptions in map function and propagate error', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3)

      const mapped = stream.map((x) => {
        if (x === 2) {
          throw new Error('Map error on value 2')
        }
        return x * 2
      })

      // Map should propagate errors
      await expect(env.executeAndCollect(mapped)).rejects.toThrow('Map error on value 2')
    })

    it('should provide element index in map function via context', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements('a', 'b', 'c')

      const mapFn: MapFunction<string, { value: string; index: number }> = {
        index: 0,
        open(ctx: RuntimeContext) {
          this.index = 0
        },
        map(value: string) {
          const result = { value, index: this.index }
          this.index++
          return result
        },
      } as MapFunction<string, { value: string; index: number }> & { index: number }

      const mapped = stream.map(mapFn)

      const result = await env.executeAndCollect(mapped)

      expect(result).toEqual([
        { value: 'a', index: 0 },
        { value: 'b', index: 1 },
        { value: 'c', index: 2 },
      ])
    })

    it('should map deeply nested objects correctly', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements<NestedData>(
        { level1: { level2: { level3: { value: 1 } } } },
        { level1: { level2: { level3: { value: 2 } } } }
      )

      const mapped = stream.map((e) => ({
        extracted: e.level1.level2.level3.value,
        doubled: e.level1.level2.level3.value * 2,
      }))

      const result = await env.executeAndCollect(mapped)

      expect(result).toEqual([
        { extracted: 1, doubled: 2 },
        { extracted: 2, doubled: 4 },
      ])
    })

    it('should correctly type transform from primitives to objects', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3)

      const mapped = stream.map((x) => ({
        value: x,
        squared: x * x,
        cubed: x * x * x,
        isEven: x % 2 === 0,
      }))

      const result = await env.executeAndCollect(mapped)

      expect(result[0]).toEqual({ value: 1, squared: 1, cubed: 1, isEven: false })
      expect(result[1]).toEqual({ value: 2, squared: 4, cubed: 8, isEven: true })
      expect(result[2]).toEqual({ value: 3, squared: 9, cubed: 27, isEven: false })
    })

    it('should handle map with async-like operations (returning promises)', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3)

      // Note: This tests if the implementation handles returning promises from map
      const mapped = stream.map(async (x) => {
        return x * 2
      })

      const result = await env.executeAndCollect(mapped)

      // Should resolve promises and return actual values
      expect(result).toEqual([2, 4, 6])
    })

    it('should map with access to parallelism info from RuntimeContext', async () => {
      const env = createTestEnvironment()
      env.setParallelism(4)
      const stream = env.fromElements(1, 2, 3)

      let capturedParallelism = 0
      let capturedSubtaskIndex = -1

      const mapFn: MapFunction<number, number> & { open?: (ctx: RuntimeContext) => void } = {
        open(ctx: RuntimeContext) {
          capturedParallelism = ctx.getNumberOfParallelSubtasks()
          capturedSubtaskIndex = ctx.getIndexOfThisSubtask()
        },
        map(value: number) {
          return value * 2
        },
      }

      const mapped = stream.map(mapFn)
      await env.executeAndCollect(mapped)

      expect(capturedParallelism).toBe(4)
      expect(capturedSubtaskIndex).toBeGreaterThanOrEqual(0)
    })

    it('should preserve element timestamps through map operation', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements<Event>(
        { id: 'e1', userId: 'u1', timestamp: 1000, value: 10 },
        { id: 'e2', userId: 'u1', timestamp: 2000, value: 20 }
      )

      // Assign timestamps
      const withTimestamps = stream.assignTimestampsAndWatermarks({
        getTimestampAssigner: () => (e: Event) => e.timestamp,
        createWatermarkGenerator: () => ({
          onEvent: () => {},
          onPeriodicEmit: () => {},
        }),
      } as any)

      const mapped = withTimestamps.map((e) => ({ ...e, mappedValue: e.value * 2 }))

      // Timestamps should be preserved
      const result = await env.executeAndCollect(mapped)

      expect(result[0]?.timestamp).toBe(1000)
      expect(result[1]?.timestamp).toBe(2000)
    })
  })

  // ===========================================================================
  // filter() Operations - Extended Tests
  // ===========================================================================

  describe('filter() - Extended Behavior', () => {
    it('should handle null values in filter predicate', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements<{ value: number | null }>(
        { value: 10 },
        { value: null },
        { value: 30 },
        { value: null }
      )

      const filtered = stream.filter((e) => e.value !== null && e.value > 15)

      const result = await env.executeAndCollect(filtered)

      expect(result).toEqual([{ value: 30 }])
    })

    it('should handle exceptions in filter predicate and propagate error', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3)

      const filtered = stream.filter((x) => {
        if (x === 2) {
          throw new Error('Filter error on value 2')
        }
        return x > 0
      })

      await expect(env.executeAndCollect(filtered)).rejects.toThrow('Filter error on value 2')
    })

    it('should filter with complex boolean expressions', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements<User>(
        { id: 'u1', name: 'Alice', age: 25, active: true },
        { id: 'u2', name: 'Bob', age: 17, active: true },
        { id: 'u3', name: 'Charlie', age: 30, active: false },
        { id: 'u4', name: 'Diana', age: 22, active: true }
      )

      // Complex predicate: active AND (age >= 18) AND (name starts with 'A' OR 'D')
      const filtered = stream.filter((u) =>
        u.active && u.age >= 18 && (u.name.startsWith('A') || u.name.startsWith('D'))
      )

      const result = await env.executeAndCollect(filtered)

      expect(result).toHaveLength(2)
      expect(result.map((u) => u.name)).toEqual(['Alice', 'Diana'])
    })

    it('should filter using FilterFunction with stateful logic', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)

      // Filter that tracks and only allows every 3rd element
      let counter = 0
      const statefulFilter: FilterFunction<number> & { open?: (ctx: RuntimeContext) => void } = {
        open(ctx: RuntimeContext) {
          counter = 0
        },
        filter(value: number) {
          counter++
          return counter % 3 === 0
        },
      }

      const filtered = stream.filter(statefulFilter)

      const result = await env.executeAndCollect(filtered)

      expect(result).toEqual([3, 6, 9])
    })

    it('should filter with regex matching', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { id: 'user-123', type: 'click' },
        { id: 'admin-456', type: 'view' },
        { id: 'user-789', type: 'click' },
        { id: 'system-001', type: 'error' }
      )

      const userPattern = /^user-\d+$/
      const filtered = stream.filter((e) => userPattern.test(e.id))

      const result = await env.executeAndCollect(filtered)

      expect(result).toHaveLength(2)
      expect(result.every((e) => e.id.startsWith('user-'))).toBe(true)
    })

    it('should filter array properties', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { id: 'a', tags: ['important', 'urgent'] },
        { id: 'b', tags: ['normal'] },
        { id: 'c', tags: ['important'] },
        { id: 'd', tags: [] }
      )

      const filtered = stream.filter((e) => e.tags.includes('important'))

      const result = await env.executeAndCollect(filtered)

      expect(result).toHaveLength(2)
      expect(result.map((e) => e.id)).toEqual(['a', 'c'])
    })

    it('should filter by date comparisons', async () => {
      const now = Date.now()
      const oneHourAgo = now - 3600000
      const twoHoursAgo = now - 7200000

      const env = createTestEnvironment()
      const stream = env.fromElements(
        { id: 'e1', timestamp: now },
        { id: 'e2', timestamp: oneHourAgo },
        { id: 'e3', timestamp: twoHoursAgo }
      )

      // Filter events from last 90 minutes
      const cutoff = now - 90 * 60 * 1000
      const filtered = stream.filter((e) => e.timestamp >= cutoff)

      const result = await env.executeAndCollect(filtered)

      expect(result).toHaveLength(2)
      expect(result.map((e) => e.id)).toEqual(['e1', 'e2'])
    })

    it('should preserve watermark strategy after filter', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements<Event>(
        { id: 'e1', userId: 'u1', timestamp: 1000, value: 10 },
        { id: 'e2', userId: 'u1', timestamp: 2000, value: 20 },
        { id: 'e3', userId: 'u1', timestamp: 3000, value: 5 }
      )

      const withWatermarks = stream.assignTimestampsAndWatermarks({
        getTimestampAssigner: () => (e: Event) => e.timestamp,
        createWatermarkGenerator: () => ({
          onEvent: () => {},
          onPeriodicEmit: () => {},
        }),
      } as any)

      const filtered = withWatermarks.filter((e) => e.value > 8)

      // Should still have watermark info after filter
      const result = await env.executeAndCollect(filtered)

      expect(result).toHaveLength(2)
      expect(result[0]?.timestamp).toBe(1000)
      expect(result[1]?.timestamp).toBe(2000)
    })
  })

  // ===========================================================================
  // flatMap() Operations - Extended Tests
  // ===========================================================================

  describe('flatMap() - Extended Behavior', () => {
    it('should handle exceptions in flatMap and propagate error', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements('a', 'b', 'c')

      const flatMapped = stream.flatMap((value, out) => {
        if (value === 'b') {
          throw new Error('FlatMap error on value b')
        }
        out.collect(value.toUpperCase())
      })

      await expect(env.executeAndCollect(flatMapped)).rejects.toThrow('FlatMap error on value b')
    })

    it('should flatMap with conditional emission based on element properties', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements<User>(
        { id: 'u1', name: 'Alice', age: 25, active: true },
        { id: 'u2', name: 'Bob', age: 17, active: true },
        { id: 'u3', name: 'Charlie', age: 30, active: false }
      )

      const flatMapped = stream.flatMap((user, out) => {
        // Only emit for active adult users
        if (user.active && user.age >= 18) {
          out.collect({ type: 'welcome', userId: user.id })
          out.collect({ type: 'profile_setup', userId: user.id })
        }
      })

      const result = await env.executeAndCollect(flatMapped)

      expect(result).toHaveLength(2) // Only Alice qualifies, gets 2 events
      expect(result).toEqual([
        { type: 'welcome', userId: 'u1' },
        { type: 'profile_setup', userId: 'u1' },
      ])
    })

    it('should flatMap JSON parsing to extract nested arrays', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { id: 'batch1', items: [{ name: 'a' }, { name: 'b' }] },
        { id: 'batch2', items: [{ name: 'c' }] },
        { id: 'batch3', items: [] }
      )

      const flatMapped = stream.flatMap((batch, out) => {
        for (const item of batch.items) {
          out.collect({ batchId: batch.id, itemName: item.name })
        }
      })

      const result = await env.executeAndCollect(flatMapped)

      expect(result).toEqual([
        { batchId: 'batch1', itemName: 'a' },
        { batchId: 'batch1', itemName: 'b' },
        { batchId: 'batch2', itemName: 'c' },
      ])
    })

    it('should flatMap with variable number of outputs per element', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3, 4, 5)

      const flatMapped = stream.flatMap((n, out) => {
        // Emit n copies of the value
        for (let i = 0; i < n; i++) {
          out.collect(n)
        }
      })

      const result = await env.executeAndCollect(flatMapped)

      // 1 appears 1 time, 2 appears 2 times, etc.
      expect(result).toEqual([1, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5])
    })

    it('should flatMap and change type from object to primitives', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { word: 'hello', count: 2 },
        { word: 'world', count: 3 }
      )

      const flatMapped = stream.flatMap((item, out) => {
        for (let i = 0; i < item.count; i++) {
          out.collect(item.word)
        }
      })

      const result = await env.executeAndCollect(flatMapped)

      expect(result).toEqual(['hello', 'hello', 'world', 'world', 'world'])
    })

    it('should flatMap with FlatMapFunction having open/close lifecycle', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3)

      const lifecycle: string[] = []

      const flatMapFn: FlatMapFunction<number, string> & {
        open?: (ctx: RuntimeContext) => void
        close?: () => void
      } = {
        open(ctx: RuntimeContext) {
          lifecycle.push('open')
        },
        flatMap(value: number, out: Collector<string>) {
          lifecycle.push(`flatMap:${value}`)
          out.collect(`value-${value}`)
        },
        close() {
          lifecycle.push('close')
        },
      }

      const flatMapped = stream.flatMap(flatMapFn)
      await env.executeAndCollect(flatMapped)

      expect(lifecycle).toContain('open')
      expect(lifecycle).toContain('flatMap:1')
      expect(lifecycle).toContain('flatMap:2')
      expect(lifecycle).toContain('flatMap:3')
      expect(lifecycle).toContain('close')
    })

    it('should flatMap with recursive expansion', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements({ value: 8, depth: 0 })

      // Recursively halve until value < 2
      const flatMapped = stream.flatMap((item, out) => {
        if (item.value >= 2) {
          out.collect({ value: Math.floor(item.value / 2), depth: item.depth + 1 })
          out.collect({ value: Math.floor(item.value / 2), depth: item.depth + 1 })
        } else {
          out.collect(item)
        }
      })

      const result = await env.executeAndCollect(flatMapped)

      // 8 -> 4,4 -> 2,2,2,2 -> 1,1,1,1,1,1,1,1 (if fully recursive)
      // But single flatMap only does one level: 8 -> 4,4
      expect(result).toEqual([
        { value: 4, depth: 1 },
        { value: 4, depth: 1 },
      ])
    })

    it('should flatMap preserving order of emissions', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements('abc', 'de')

      const flatMapped = stream.flatMap((str, out) => {
        for (const char of str) {
          out.collect(char)
        }
      })

      const result = await env.executeAndCollect(flatMapped)

      // Order should be preserved: a, b, c from 'abc', then d, e from 'de'
      expect(result).toEqual(['a', 'b', 'c', 'd', 'e'])
    })
  })

  // ===========================================================================
  // keyBy() Operations - Extended Tests
  // ===========================================================================

  describe('keyBy() - Extended Behavior', () => {
    it('should handle null keys by grouping them together', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { category: 'A' as string | null, value: 1 },
        { category: null, value: 2 },
        { category: 'A', value: 3 },
        { category: null, value: 4 }
      )

      const reduced = stream
        .keyBy((e) => e.category)
        .reduce((a, b) => ({ category: a.category, value: a.value + b.value }))

      const result = await env.executeAndCollect(reduced)

      // Null keys should be grouped together
      const nullResult = result.find((r) => r.category === null)
      const aResult = result.find((r) => r.category === 'A')

      expect(nullResult?.value).toBe(6) // 2 + 4
      expect(aResult?.value).toBe(4) // 1 + 3
    })

    it('should handle complex object keys via serialization', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { key: { userId: 'u1', sessionId: 's1' }, value: 10 },
        { key: { userId: 'u1', sessionId: 's2' }, value: 20 },
        { key: { userId: 'u1', sessionId: 's1' }, value: 30 }
      )

      // Use JSON serialization for complex key
      const keyed = stream.keyBy((e) => JSON.stringify(e.key))

      const reduced = keyed.reduce((a, b) => ({
        key: a.key,
        value: a.value + b.value,
      }))

      const result = await env.executeAndCollect(reduced)

      // Same session should be grouped
      expect(result).toHaveLength(2)
      const s1Result = result.find((r) => r.key.sessionId === 's1')
      expect(s1Result?.value).toBe(40) // 10 + 30
    })

    it('should key by array element', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { tags: ['important', 'urgent'], value: 1 },
        { tags: ['normal'], value: 2 },
        { tags: ['important'], value: 3 }
      )

      // Key by first tag
      const keyed = stream.keyBy((e) => e.tags[0] ?? 'none')

      const reduced = keyed.reduce((a, b) => ({
        tags: a.tags,
        value: a.value + b.value,
      }))

      const result = await env.executeAndCollect(reduced)

      const importantResult = result.find((r) => r.tags[0] === 'important')
      expect(importantResult?.value).toBe(4) // 1 + 3
    })

    it('should support keyBy with enum values', async () => {
      enum Status {
        PENDING = 'PENDING',
        ACTIVE = 'ACTIVE',
        COMPLETED = 'COMPLETED',
      }

      const env = createTestEnvironment()
      const stream = env.fromElements(
        { status: Status.PENDING, count: 1 },
        { status: Status.ACTIVE, count: 2 },
        { status: Status.PENDING, count: 3 },
        { status: Status.ACTIVE, count: 4 }
      )

      const reduced = stream
        .keyBy((e) => e.status)
        .reduce((a, b) => ({ status: a.status, count: a.count + b.count }))

      const result = await env.executeAndCollect(reduced)

      expect(result).toContainEqual({ status: Status.PENDING, count: 4 })
      expect(result).toContainEqual({ status: Status.ACTIVE, count: 6 })
    })

    it('should keyBy with boolean key', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { active: true, value: 10 },
        { active: false, value: 20 },
        { active: true, value: 30 },
        { active: false, value: 40 }
      )

      const reduced = stream
        .keyBy((e) => e.active)
        .reduce((a, b) => ({ active: a.active, value: a.value + b.value }))

      const result = await env.executeAndCollect(reduced)

      const activeResult = result.find((r) => r.active === true)
      const inactiveResult = result.find((r) => r.active === false)

      expect(activeResult?.value).toBe(40) // 10 + 30
      expect(inactiveResult?.value).toBe(60) // 20 + 40
    })

    it('should keyBy with date-based key (group by hour)', async () => {
      const env = createTestEnvironment()
      const baseTime = new Date('2024-01-15T10:00:00Z').getTime()

      const stream = env.fromElements(
        { timestamp: baseTime, value: 1 }, // 10:00
        { timestamp: baseTime + 30 * 60 * 1000, value: 2 }, // 10:30
        { timestamp: baseTime + 60 * 60 * 1000, value: 3 }, // 11:00
        { timestamp: baseTime + 90 * 60 * 1000, value: 4 } // 11:30
      )

      // Key by hour
      const keyed = stream.keyBy((e) => {
        const date = new Date(e.timestamp)
        return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-${date.getUTCHours()}`
      })

      const reduced = keyed.reduce((a, b) => ({
        timestamp: a.timestamp,
        value: a.value + b.value,
      }))

      const result = await env.executeAndCollect(reduced)

      // Hour 10: 1 + 2 = 3
      // Hour 11: 3 + 4 = 7
      expect(result).toHaveLength(2)
    })

    it('should handle many distinct keys efficiently', async () => {
      const env = createTestEnvironment()
      const elements = Array.from({ length: 1000 }, (_, i) => ({
        key: `key-${i % 100}`, // 100 distinct keys
        value: 1,
      }))

      const stream = env.fromCollection(elements)

      const reduced = stream
        .keyBy((e) => e.key)
        .reduce((a, b) => ({ key: a.key, value: a.value + b.value }))

      const result = await env.executeAndCollect(reduced)

      expect(result).toHaveLength(100)
      // Each key should have 10 elements summed (1000/100)
      expect(result.every((r) => r.value === 10)).toBe(true)
    })

    it('should keyBy followed by map on KeyedStream', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { userId: 'u1', action: 'click' },
        { userId: 'u2', action: 'view' },
        { userId: 'u1', action: 'purchase' }
      )

      // Map should work on KeyedStream
      const keyed = stream.keyBy((e) => e.userId)

      const mapped = keyed.map((e) => ({
        userId: e.userId,
        action: e.action.toUpperCase(),
      }))

      const result = await env.executeAndCollect(mapped)

      expect(result).toContainEqual({ userId: 'u1', action: 'CLICK' })
      expect(result).toContainEqual({ userId: 'u2', action: 'VIEW' })
      expect(result).toContainEqual({ userId: 'u1', action: 'PURCHASE' })
    })

    it('should keyBy followed by filter on KeyedStream', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { userId: 'u1', amount: 10 },
        { userId: 'u2', amount: 100 },
        { userId: 'u1', amount: 50 },
        { userId: 'u2', amount: 5 }
      )

      const filtered = stream
        .keyBy((e) => e.userId)
        .filter((e) => e.amount > 20)

      const result = await env.executeAndCollect(filtered)

      expect(result).toEqual([
        { userId: 'u2', amount: 100 },
        { userId: 'u1', amount: 50 },
      ])
    })

    it('should support rekey operation (keyBy after keyBy)', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { userId: 'u1', category: 'A', value: 1 },
        { userId: 'u2', category: 'A', value: 2 },
        { userId: 'u1', category: 'B', value: 3 },
        { userId: 'u2', category: 'B', value: 4 }
      )

      // First key by userId, then rekey by category
      const result = stream
        .keyBy((e) => e.userId)
        .keyBy((e) => e.category) // Rekey operation
        .reduce((a, b) => ({
          userId: `${a.userId}+${b.userId}`,
          category: a.category,
          value: a.value + b.value,
        }))

      const collected = await env.executeAndCollect(result)

      // After rekeying by category:
      // Category A: 1 + 2 = 3
      // Category B: 3 + 4 = 7
      expect(collected).toHaveLength(2)
      const catA = collected.find((r) => r.category === 'A')
      const catB = collected.find((r) => r.category === 'B')

      expect(catA?.value).toBe(3)
      expect(catB?.value).toBe(7)
    })

    it('should handle exception in key selector', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { id: 'a', data: { key: 'k1' } },
        { id: 'b', data: null as any },
        { id: 'c', data: { key: 'k2' } }
      )

      const keyed = stream.keyBy((e) => {
        if (e.data === null) {
          throw new Error('Cannot extract key from null data')
        }
        return e.data.key
      })

      const reduced = keyed.reduce((a, b) => a)

      await expect(env.executeAndCollect(reduced)).rejects.toThrow('Cannot extract key from null data')
    })

    it('should keyBy with tuple-like key for window operations', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { userId: 'u1', productId: 'p1', quantity: 1 },
        { userId: 'u1', productId: 'p2', quantity: 2 },
        { userId: 'u1', productId: 'p1', quantity: 3 },
        { userId: 'u2', productId: 'p1', quantity: 4 }
      )

      // Key by (userId, productId) tuple
      type TupleKey = [string, string]
      const keyed = stream.keyBy((e): string => `${e.userId}:${e.productId}`)

      const reduced = keyed.reduce((a, b) => ({
        userId: a.userId,
        productId: a.productId,
        quantity: a.quantity + b.quantity,
      }))

      const result = await env.executeAndCollect(reduced)

      // (u1, p1): 1 + 3 = 4
      // (u1, p2): 2
      // (u2, p1): 4
      expect(result).toHaveLength(3)

      const u1p1 = result.find((r) => r.userId === 'u1' && r.productId === 'p1')
      expect(u1p1?.quantity).toBe(4)
    })
  })

  // ===========================================================================
  // Combined Operations - Integration Tests
  // ===========================================================================

  describe('Combined Operations', () => {
    it('should chain map -> filter -> flatMap -> keyBy', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { text: 'hello world', category: 'A' },
        { text: 'foo bar baz', category: 'B' },
        { text: 'short', category: 'A' }
      )

      const result = stream
        .map((e) => ({ ...e, wordCount: e.text.split(' ').length }))
        .filter((e) => e.wordCount > 1)
        .flatMap((e, out) => {
          for (const word of e.text.split(' ')) {
            out.collect({ word, category: e.category })
          }
        })
        .keyBy((e) => e.category)
        .reduce((a, b) => ({
          word: `${a.word},${b.word}`,
          category: a.category,
        }))

      const collected = await env.executeAndCollect(result)

      expect(collected).toHaveLength(2)
      const catA = collected.find((r) => r.category === 'A')
      const catB = collected.find((r) => r.category === 'B')

      expect(catA?.word).toBe('hello,world')
      expect(catB?.word).toBe('foo,bar,baz')
    })

    it('should handle empty stream through all operations', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements<{ value: number; key: string }>()

      const result = stream
        .map((e) => ({ ...e, doubled: e.value * 2 }))
        .filter((e) => e.doubled > 10)
        .flatMap((e, out) => {
          out.collect(e)
          out.collect({ ...e, doubled: e.doubled * 2 })
        })
        .keyBy((e) => e.key)
        .reduce((a, b) => a)

      const collected = await env.executeAndCollect(result)

      expect(collected).toEqual([])
    })

    it('should handle single element through all operations', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements({ value: 10, key: 'only' })

      const result = stream
        .map((e) => ({ ...e, doubled: e.value * 2 }))
        .filter((e) => e.doubled > 10)
        .flatMap((e, out) => {
          out.collect({ key: e.key, result: 'processed' })
        })
        .keyBy((e) => e.key)
        .reduce((a, b) => a)

      const collected = await env.executeAndCollect(result)

      expect(collected).toEqual([{ key: 'only', result: 'processed' }])
    })

    it('should preserve parallelism through operations', async () => {
      const env = createTestEnvironment()
      env.setParallelism(4)

      const stream = env.fromElements(1, 2, 3, 4, 5, 6, 7, 8).setParallelism(4)

      const result = stream
        .map((x) => x * 2)
        .setParallelism(4)
        .filter((x) => x > 5)
        .setParallelism(4)

      expect(result.getParallelism()).toBe(4)
    })

    it('should handle type changes through operation chain', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3)

      // number -> string -> object -> number
      const result = stream
        .map((n) => `value:${n}`) // number -> string
        .map((s) => ({ original: s, length: s.length })) // string -> object
        .map((o) => o.length) // object -> number

      const collected = await env.executeAndCollect(result)

      expect(collected).toEqual([7, 7, 7]) // 'value:1'.length = 7
    })
  })

  // ===========================================================================
  // setParallelism() Tests
  // ===========================================================================

  describe('setParallelism()', () => {
    it('should set parallelism on DataStream', () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3).setParallelism(4)

      expect(stream.getParallelism()).toBe(4)
    })

    it('should set parallelism on mapped stream', () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3).map((x) => x * 2).setParallelism(8)

      expect(stream.getParallelism()).toBe(8)
    })

    it('should set parallelism on keyed stream', () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements({ key: 'a', value: 1 })
        .keyBy((e) => e.key)
        .setParallelism(2)

      expect(stream.getParallelism()).toBe(2)
    })

    it('should throw on invalid parallelism (0 or negative)', () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3)

      expect(() => stream.setParallelism(0)).toThrow()
      expect(() => stream.setParallelism(-1)).toThrow()
    })

    it('should throw when parallelism exceeds max parallelism', () => {
      const env = createTestEnvironment()
      env.setMaxParallelism(10)

      const stream = env.fromElements(1, 2, 3)

      expect(() => stream.setParallelism(20)).toThrow()
    })
  })

  // ===========================================================================
  // name() and uid() Tests
  // ===========================================================================

  describe('Operator Naming', () => {
    it('should set operator name', () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3).map((x) => x * 2).name('Double Values')

      expect(stream.getName()).toBe('Double Values')
    })

    it('should set operator uid', () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3).map((x) => x * 2).uid('double-op')

      expect(stream.getUid()).toBe('double-op')
    })

    it('should chain name and uid', () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements(1, 2, 3)
        .map((x) => x * 2)
        .name('Double Values')
        .uid('double-op')

      expect(stream.getName()).toBe('Double Values')
      expect(stream.getUid()).toBe('double-op')
    })
  })

  // ===========================================================================
  // returns() Type Hint Tests
  // ===========================================================================

  describe('Type Information', () => {
    it('should specify return type via returns()', () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements({ data: '{"value": 42}' })
        .map((e) => JSON.parse(e.data))
        .returns<{ value: number }>()

      // Type should be properly inferred for subsequent operations
      const result = stream.map((e) => e.value * 2)

      expect(result).toBeDefined()
    })
  })

  // ===========================================================================
  // disableChaining() Tests
  // ===========================================================================

  describe('Operator Chaining', () => {
    it('should disable chaining on operator', () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements(1, 2, 3)
        .map((x) => x * 2)
        .disableChaining()
        .filter((x) => x > 2)

      // Should execute without error
      expect(stream).toBeDefined()
    })

    it('should start new chain after disableChaining', () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements(1, 2, 3)
        .map((x) => x * 2)
        .startNewChain()
        .filter((x) => x > 2)

      expect(stream).toBeDefined()
    })
  })

  // ===========================================================================
  // Broadcast and Partitioning Tests
  // ===========================================================================

  describe('Partitioning Strategies', () => {
    it('should shuffle partition data', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3, 4, 5).shuffle()

      const result = await env.executeAndCollect(stream)

      // All elements should be present (order may vary)
      expect(result.sort()).toEqual([1, 2, 3, 4, 5])
    })

    it('should rebalance partition data', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3, 4, 5).rebalance()

      const result = await env.executeAndCollect(stream)

      expect(result.sort()).toEqual([1, 2, 3, 4, 5])
    })

    it('should rescale partition data', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3, 4, 5).rescale()

      const result = await env.executeAndCollect(stream)

      expect(result.sort()).toEqual([1, 2, 3, 4, 5])
    })

    it('should global partition (all to one)', async () => {
      const env = createTestEnvironment()
      env.setParallelism(4)

      const stream = env.fromElements(1, 2, 3, 4, 5).global()

      // Global sends all to task 0
      expect(stream.getParallelism()).toBeLessThanOrEqual(1)
    })

    it('should forward partition (1:1 locality)', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3).forward()

      const result = await env.executeAndCollect(stream)

      expect(result).toEqual([1, 2, 3])
    })

    it('should custom partition with partitioner', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { region: 'us', value: 1 },
        { region: 'eu', value: 2 },
        { region: 'us', value: 3 }
      )

      const partitioned = stream.partitionCustom(
        {
          partition: (key: string, numPartitions: number) => {
            return key === 'us' ? 0 : 1
          },
        },
        (e) => e.region
      )

      const result = await env.executeAndCollect(partitioned)

      expect(result).toHaveLength(3)
    })
  })

  // ===========================================================================
  // Split and Select Tests (Deprecated but still used)
  // ===========================================================================

  describe('Split and Select (Legacy)', () => {
    it('should split stream by selector', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { type: 'click', value: 1 },
        { type: 'view', value: 2 },
        { type: 'click', value: 3 }
      )

      const split = stream.split((e) => [e.type])

      const clicks = split.select('click')
      const views = split.select('view')

      const clickResults = await env.executeAndCollect(clicks)
      const viewResults = await env.executeAndCollect(views)

      expect(clickResults).toHaveLength(2)
      expect(viewResults).toHaveLength(1)
    })

    it('should select multiple outputs', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { category: 'A', value: 1 },
        { category: 'B', value: 2 },
        { category: 'C', value: 3 }
      )

      const split = stream.split((e) => [e.category])
      const aOrB = split.select('A', 'B')

      const result = await env.executeAndCollect(aOrB)

      expect(result).toHaveLength(2)
    })
  })
})
