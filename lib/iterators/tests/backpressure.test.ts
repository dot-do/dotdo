/**
 * Tests for backpressure module
 */

import { describe, it, expect } from 'vitest'
import {
  BackpressureController,
  withBackpressure,
  rateLimit,
  throttle,
  buffer,
} from '../backpressure'
import { collect } from '../aggregators'

describe('BackpressureController', () => {
  it('should buffer items up to high water mark', async () => {
    const controller = new BackpressureController<number>({ highWaterMark: 3 })

    await controller.push(1)
    await controller.push(2)
    await controller.push(3)

    const state = controller.getState()
    expect(state.bufferSize).toBe(3)
  })

  it('should yield items in order', async () => {
    const controller = new BackpressureController<number>()

    // Producer
    setTimeout(async () => {
      await controller.push(1)
      await controller.push(2)
      await controller.push(3)
      controller.end()
    }, 0)

    // Consumer
    const result: number[] = []
    for await (const item of controller) {
      result.push(item)
    }

    expect(result).toEqual([1, 2, 3])
  })

  it('should drop oldest when using drop-oldest strategy', async () => {
    const controller = new BackpressureController<number>({
      highWaterMark: 2,
      strategy: 'drop-oldest',
    })

    await controller.push(1)
    await controller.push(2)
    await controller.push(3) // Should drop 1

    const state = controller.getState()
    expect(state.droppedCount).toBe(1)

    controller.end()
    const result: number[] = []
    for await (const item of controller) {
      result.push(item)
    }

    expect(result).toEqual([2, 3])
  })

  it('should drop newest when using drop-newest strategy', async () => {
    const controller = new BackpressureController<number>({
      highWaterMark: 2,
      strategy: 'drop-newest',
    })

    await controller.push(1)
    await controller.push(2)
    const accepted = await controller.push(3) // Should be dropped

    expect(accepted).toBe(false)

    const state = controller.getState()
    expect(state.droppedCount).toBe(1)

    controller.end()
    const result: number[] = []
    for await (const item of controller) {
      result.push(item)
    }

    expect(result).toEqual([1, 2])
  })

  it('should throw when using error strategy', async () => {
    const controller = new BackpressureController<number>({
      highWaterMark: 2,
      strategy: 'error',
    })

    await controller.push(1)
    await controller.push(2)

    await expect(controller.push(3)).rejects.toThrow('Buffer overflow')
  })
})

describe('withBackpressure', () => {
  it('should wrap iterator with backpressure', async () => {
    async function* source() {
      yield 1
      yield 2
      yield 3
    }

    const result = await collect(
      withBackpressure(source(), { highWaterMark: 10 })
    )

    expect(result).toEqual([1, 2, 3])
  })
})

describe('rateLimit', () => {
  it('should limit items per second', async () => {
    const source = [1, 2, 3, 4, 5]
    const start = Date.now()

    const result = await collect(
      rateLimit(source, { itemsPerSecond: 100 }) // Fast for testing
    )

    expect(result).toEqual([1, 2, 3, 4, 5])
  })
})

describe('throttle', () => {
  it('should throttle items', async () => {
    async function* fastSource() {
      yield 1
      yield 2
      yield 3
      yield 4
      yield 5
    }

    // With 0ms throttle, all items should pass
    const result = await collect(throttle(fastSource(), 0))
    expect(result).toEqual([1, 2, 3, 4, 5])
  })
})

describe('buffer', () => {
  it('should buffer items by size', async () => {
    const result = await collect(
      buffer([1, 2, 3, 4, 5], { maxSize: 2 })
    )

    expect(result).toEqual([[1, 2], [3, 4], [5]])
  })
})
