import { describe, it, expect } from 'vitest'
import { createStream, Stream } from '../stream'

describe('Stream', () => {
  describe('Basic AsyncIterable Interface', () => {
    it('should create a stream from an async generator', async () => {
      async function* gen() {
        yield 'hello'
        yield 'world'
      }

      const stream = createStream(gen())
      const chunks: string[] = []

      for await (const chunk of stream) {
        chunks.push(chunk)
      }

      expect(chunks).toEqual(['hello', 'world'])
    })

    it('should support multiple consumers via [Symbol.asyncIterator]', async () => {
      async function* gen() {
        yield 1
        yield 2
        yield 3
      }

      const stream = createStream(gen())
      const consumer1: number[] = []
      const consumer2: number[] = []

      for await (const chunk of stream) {
        consumer1.push(chunk)
      }

      // Second consumer gets cached chunks
      for await (const chunk of stream) {
        consumer2.push(chunk)
      }

      expect(consumer1).toEqual([1, 2, 3])
      expect(consumer2).toEqual([1, 2, 3])
    })

    it('should handle empty streams', async () => {
      async function* gen() {
        // empty
      }

      const stream = createStream(gen())
      const chunks: unknown[] = []

      for await (const chunk of stream) {
        chunks.push(chunk)
      }

      expect(chunks).toEqual([])
    })

    it('should propagate errors from the generator', async () => {
      async function* gen() {
        yield 'ok'
        throw new Error('stream error')
      }

      const stream = createStream(gen())
      const chunks: string[] = []

      await expect(async () => {
        for await (const chunk of stream) {
          chunks.push(chunk)
        }
      }).rejects.toThrow('stream error')

      expect(chunks).toEqual(['ok'])
    })
  })

  describe('Stream Transformations', () => {
    it('should support map transformation', async () => {
      async function* gen() {
        yield 1
        yield 2
        yield 3
      }

      const stream = createStream(gen())
      const mapped = stream.map((n) => n * 2)
      const chunks: number[] = []

      for await (const chunk of mapped) {
        chunks.push(chunk)
      }

      expect(chunks).toEqual([2, 4, 6])
    })

    it('should support async map transformation', async () => {
      async function* gen() {
        yield 'a'
        yield 'b'
      }

      const stream = createStream(gen())
      const mapped = stream.map(async (s) => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        return s.toUpperCase()
      })
      const chunks: string[] = []

      for await (const chunk of mapped) {
        chunks.push(chunk)
      }

      expect(chunks).toEqual(['A', 'B'])
    })

    it('should support filter transformation', async () => {
      async function* gen() {
        yield 1
        yield 2
        yield 3
        yield 4
        yield 5
      }

      const stream = createStream(gen())
      const filtered = stream.filter((n) => n % 2 === 0)
      const chunks: number[] = []

      for await (const chunk of filtered) {
        chunks.push(chunk)
      }

      expect(chunks).toEqual([2, 4])
    })

    it('should support async filter', async () => {
      async function* gen() {
        yield 1
        yield 2
        yield 3
      }

      const stream = createStream(gen())
      const filtered = stream.filter(async (n) => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        return n > 1
      })
      const chunks: number[] = []

      for await (const chunk of filtered) {
        chunks.push(chunk)
      }

      expect(chunks).toEqual([2, 3])
    })

    it('should chain multiple transformations', async () => {
      async function* gen() {
        yield 1
        yield 2
        yield 3
        yield 4
        yield 5
      }

      const stream = createStream(gen())
      const result = stream
        .filter((n) => n % 2 === 1) // odd numbers: 1, 3, 5
        .map((n) => n * 2) // double: 2, 6, 10
        .filter((n) => n > 3) // greater than 3: 6, 10

      const chunks: number[] = []
      for await (const chunk of result) {
        chunks.push(chunk)
      }

      expect(chunks).toEqual([6, 10])
    })
  })

  describe('Stream Collection', () => {
    it('should collect all chunks into an array', async () => {
      async function* gen() {
        yield 'a'
        yield 'b'
        yield 'c'
      }

      const stream = createStream(gen())
      const result = await stream.collect()

      expect(result).toEqual(['a', 'b', 'c'])
    })

    it('should collect empty stream to empty array', async () => {
      async function* gen() {
        // empty
      }

      const stream = createStream(gen())
      const result = await stream.collect()

      expect(result).toEqual([])
    })

    it('should collect after transformations', async () => {
      async function* gen() {
        yield 1
        yield 2
        yield 3
      }

      const stream = createStream(gen())
      const result = await stream.map((n) => n * 2).collect()

      expect(result).toEqual([2, 4, 6])
    })

    it('should join string chunks', async () => {
      async function* gen() {
        yield 'hello'
        yield ' '
        yield 'world'
      }

      const stream = createStream(gen())
      const result = await stream.join('')

      expect(result).toBe('hello world')
    })

    it('should join with custom separator', async () => {
      async function* gen() {
        yield 'a'
        yield 'b'
        yield 'c'
      }

      const stream = createStream(gen())
      const result = await stream.join(', ')

      expect(result).toBe('a, b, c')
    })
  })

  describe('Backpressure Handling', () => {
    it('should handle slow consumers without buffering all data', async () => {
      let producedCount = 0
      async function* gen() {
        for (let i = 0; i < 100; i++) {
          producedCount++
          yield i
        }
      }

      const stream = createStream(gen())
      let consumedCount = 0

      for await (const chunk of stream) {
        consumedCount++
        // Slow consumer
        await new Promise((resolve) => setTimeout(resolve, 1))

        // Producer should not run far ahead
        expect(producedCount - consumedCount).toBeLessThan(50)
      }

      expect(consumedCount).toBe(100)
    })

    it('should support take() for early termination', async () => {
      let producedCount = 0
      async function* gen() {
        for (let i = 0; i < 1000; i++) {
          producedCount++
          yield i
        }
      }

      const stream = createStream(gen())
      const result = await stream.take(5).collect()

      expect(result).toEqual([0, 1, 2, 3, 4])
      // Should not produce all 1000 items
      expect(producedCount).toBeLessThanOrEqual(10)
    })

    it('should support take(0)', async () => {
      async function* gen() {
        yield 1
        yield 2
      }

      const stream = createStream(gen())
      const result = await stream.take(0).collect()

      expect(result).toEqual([])
    })
  })

  describe('Stream Cancellation', () => {
    it('should support cancellation via AbortSignal', async () => {
      const controller = new AbortController()
      let producedCount = 0

      async function* gen() {
        for (let i = 0; i < 100; i++) {
          producedCount++
          yield i
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
      }

      const stream = createStream(gen(), { signal: controller.signal })
      const chunks: number[] = []

      try {
        let count = 0
        for await (const chunk of stream) {
          chunks.push(chunk)
          count++
          if (count === 5) {
            controller.abort()
          }
        }
      } catch (error) {
        // AbortError is expected
        if (error instanceof Error) {
          expect(error.name).toBe('AbortError')
        }
      }

      expect(chunks.length).toBe(5)
      // Should not produce all items
      expect(producedCount).toBeLessThan(20)
    })

    it('should throw AbortError if signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      async function* gen() {
        yield 1
      }

      const stream = createStream(gen(), { signal: controller.signal })

      await expect(async () => {
        for await (const _ of stream) {
          // should not reach here
        }
      }).rejects.toThrow('Stream aborted')
    })
  })

  describe('Stream Utility Methods', () => {
    it('should support forEach for side effects', async () => {
      async function* gen() {
        yield 1
        yield 2
        yield 3
      }

      const stream = createStream(gen())
      const sideEffects: number[] = []

      await stream.forEach((n) => {
        sideEffects.push(n * 2)
      })

      expect(sideEffects).toEqual([2, 4, 6])
    })

    it('should support async forEach', async () => {
      async function* gen() {
        yield 'a'
        yield 'b'
      }

      const stream = createStream(gen())
      const sideEffects: string[] = []

      await stream.forEach(async (s) => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        sideEffects.push(s.toUpperCase())
      })

      expect(sideEffects).toEqual(['A', 'B'])
    })

    it('should support reduce for aggregation', async () => {
      async function* gen() {
        yield 1
        yield 2
        yield 3
        yield 4
      }

      const stream = createStream(gen())
      const sum = await stream.reduce((acc, n) => acc + n, 0)

      expect(sum).toBe(10)
    })

    it('should support reduce without initial value', async () => {
      async function* gen(): AsyncGenerator<number> {
        yield 1
        yield 2
        yield 3
      }

      const stream = createStream(gen())
      const sum = await stream.reduce((acc, n) => acc + n)

      expect(sum).toBe(6)
    })

    it('should throw on reduce without initial value on empty stream', async () => {
      async function* gen(): AsyncGenerator<number> {
        // empty
      }

      const stream = createStream(gen())

      await expect(async () => {
        await stream.reduce((acc, n) => acc + n)
      }).rejects.toThrow('Reduce of empty stream with no initial value')
    })

    it('should support async reduce', async () => {
      async function* gen() {
        yield 1
        yield 2
        yield 3
      }

      const stream = createStream(gen())
      const result = await stream.reduce(async (acc, n) => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        return acc + n
      }, 0)

      expect(result).toBe(6)
    })
  })

  describe('Stream Peek and Tap', () => {
    it('should support peek for debugging without consuming', async () => {
      async function* gen() {
        yield 1
        yield 2
        yield 3
      }

      const stream = createStream(gen())
      const peeked: number[] = []

      const result = await stream
        .peek((n) => { peeked.push(n) })
        .map((n) => n * 2)
        .collect()

      expect(peeked).toEqual([1, 2, 3])
      expect(result).toEqual([2, 4, 6])
    })

    it('should support async peek', async () => {
      async function* gen() {
        yield 'a'
        yield 'b'
      }

      const stream = createStream(gen())
      const peeked: string[] = []

      await stream
        .peek(async (s) => {
          await new Promise((resolve) => setTimeout(resolve, 1))
          peeked.push(s)
        })
        .collect()

      expect(peeked).toEqual(['a', 'b'])
    })
  })

  describe('Error Handling', () => {
    it('should catch and handle errors in map', async () => {
      async function* gen() {
        yield 1
        yield 2
        yield 3
      }

      const stream = createStream(gen())
      const chunks: number[] = []

      await expect(async () => {
        for await (const chunk of stream.map((n) => {
          if (n === 2) throw new Error('map error')
          return n * 2
        })) {
          chunks.push(chunk)
        }
      }).rejects.toThrow('map error')

      expect(chunks).toEqual([2]) // Only first chunk before error
    })

    it('should catch and handle errors in filter', async () => {
      async function* gen() {
        yield 1
        yield 2
        yield 3
      }

      const stream = createStream(gen())

      await expect(async () => {
        for await (const _ of stream.filter((n) => {
          if (n === 2) throw new Error('filter error')
          return true
        })) {
          // consume
        }
      }).rejects.toThrow('filter error')
    })
  })

  describe('Edge Cases', () => {
    it('should handle very large streams efficiently', async () => {
      async function* gen() {
        for (let i = 0; i < 10000; i++) {
          yield i
        }
      }

      const stream = createStream(gen())
      const sum = await stream.reduce((acc, n) => acc + n, 0)

      expect(sum).toBe(49995000) // sum of 0 to 9999
    })

    it('should handle streams that yield objects', async () => {
      async function* gen() {
        yield { id: 1, name: 'Alice' }
        yield { id: 2, name: 'Bob' }
      }

      const stream = createStream(gen())
      const names = await stream.map((obj) => obj.name).collect()

      expect(names).toEqual(['Alice', 'Bob'])
    })

    it('should handle streams with undefined values', async () => {
      async function* gen() {
        yield 1
        yield undefined
        yield 3
      }

      const stream = createStream(gen())
      const result = await stream.collect()

      expect(result).toEqual([1, undefined, 3])
    })

    it('should handle streams with null values', async () => {
      async function* gen() {
        yield null
        yield 'value'
        yield null
      }

      const stream = createStream(gen())
      const result = await stream.filter((v) => v !== null).collect()

      expect(result).toEqual(['value'])
    })
  })
})
