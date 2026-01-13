/**
 * Tests for iterator module
 */

import { describe, it, expect } from 'vitest'
import {
  iterate,
  batchIterate,
  range,
  repeat,
  cycle,
  generate,
  map,
  filter,
  take,
  skip,
  takeWhile,
  skipWhile,
  flatten,
  flatMap,
  zip,
  concat,
  merge,
  enumerate,
  window,
  chunk,
  tap,
} from '../iterator'
import { collect } from '../aggregators'

describe('iterate', () => {
  it('should iterate over arrays', async () => {
    const result = await collect(iterate([1, 2, 3]))
    expect(result).toEqual([1, 2, 3])
  })

  it('should respect limit option', async () => {
    const result = await collect(iterate([1, 2, 3, 4, 5], { limit: 3 }))
    expect(result).toEqual([1, 2, 3])
  })

  it('should respect offset option', async () => {
    const result = await collect(iterate([1, 2, 3, 4, 5], { offset: 2 }))
    expect(result).toEqual([3, 4, 5])
  })

  it('should combine limit and offset', async () => {
    const result = await collect(iterate([1, 2, 3, 4, 5], { limit: 2, offset: 2 }))
    expect(result).toEqual([3, 4])
  })

  it('should handle async iterables', async () => {
    async function* gen() {
      yield 1
      yield 2
      yield 3
    }
    const result = await collect(iterate(gen()))
    expect(result).toEqual([1, 2, 3])
  })

  it('should handle abort signal', async () => {
    const controller = new AbortController()
    let count = 0

    for await (const _ of iterate([1, 2, 3, 4, 5], { signal: controller.signal })) {
      count++
      if (count === 2) {
        controller.abort()
      }
    }

    expect(count).toBe(2)
  })
})

describe('batchIterate', () => {
  it('should batch items', async () => {
    const result = await collect(batchIterate([1, 2, 3, 4, 5], { batchSize: 2 }))
    expect(result).toEqual([[1, 2], [3, 4], [5]])
  })

  it('should emit full batches only when emitPartial is false', async () => {
    const result = await collect(batchIterate([1, 2, 3, 4, 5], { batchSize: 2, emitPartial: false }))
    expect(result).toEqual([[1, 2], [3, 4]])
  })
})

describe('range', () => {
  it('should generate range with end only', async () => {
    const result = await collect(range(5))
    expect(result).toEqual([0, 1, 2, 3, 4])
  })

  it('should generate range with start and end', async () => {
    const result = await collect(range(2, 6))
    expect(result).toEqual([2, 3, 4, 5])
  })

  it('should generate range with step', async () => {
    const result = await collect(range(0, 10, 2))
    expect(result).toEqual([0, 2, 4, 6, 8])
  })

  it('should generate descending range', async () => {
    const result = await collect(range(5, 0, -1))
    expect(result).toEqual([5, 4, 3, 2, 1])
  })
})

describe('repeat', () => {
  it('should repeat value', async () => {
    const result = await collect(take(repeat('x'), 3))
    expect(result).toEqual(['x', 'x', 'x'])
  })
})

describe('cycle', () => {
  it('should cycle through values', async () => {
    const result = await collect(take(cycle([1, 2, 3]), 7))
    expect(result).toEqual([1, 2, 3, 1, 2, 3, 1])
  })
})

describe('generate', () => {
  it('should generate values from factory', async () => {
    const result = await collect(generate(i => i * 2, { limit: 4 }))
    expect(result).toEqual([0, 2, 4, 6])
  })
})

describe('map', () => {
  it('should transform items', async () => {
    const result = await collect(map([1, 2, 3], x => x * 2))
    expect(result).toEqual([2, 4, 6])
  })

  it('should handle async transforms', async () => {
    const result = await collect(map([1, 2, 3], async x => x + 1))
    expect(result).toEqual([2, 3, 4])
  })
})

describe('filter', () => {
  it('should filter items', async () => {
    const result = await collect(filter([1, 2, 3, 4, 5], x => x % 2 === 0))
    expect(result).toEqual([2, 4])
  })

  it('should handle async predicates', async () => {
    const result = await collect(filter([1, 2, 3], async x => x > 1))
    expect(result).toEqual([2, 3])
  })
})

describe('take', () => {
  it('should take first N items', async () => {
    const result = await collect(take([1, 2, 3, 4, 5], 3))
    expect(result).toEqual([1, 2, 3])
  })
})

describe('skip', () => {
  it('should skip first N items', async () => {
    const result = await collect(skip([1, 2, 3, 4, 5], 2))
    expect(result).toEqual([3, 4, 5])
  })
})

describe('takeWhile', () => {
  it('should take while predicate is true', async () => {
    const result = await collect(takeWhile([1, 2, 3, 4, 1], x => x < 4))
    expect(result).toEqual([1, 2, 3])
  })
})

describe('skipWhile', () => {
  it('should skip while predicate is true', async () => {
    const result = await collect(skipWhile([1, 2, 3, 4, 1], x => x < 3))
    expect(result).toEqual([3, 4, 1])
  })
})

describe('flatten', () => {
  it('should flatten nested arrays', async () => {
    const result = await collect(flatten([[1, 2], [3, 4], [5]]))
    expect(result).toEqual([1, 2, 3, 4, 5])
  })
})

describe('flatMap', () => {
  it('should map and flatten', async () => {
    const result = await collect(flatMap([1, 2, 3], x => [x, x * 2]))
    expect(result).toEqual([1, 2, 2, 4, 3, 6])
  })
})

describe('zip', () => {
  it('should zip iterators together', async () => {
    const result = await collect(zip([1, 2, 3], ['a', 'b', 'c']))
    expect(result).toEqual([[1, 'a'], [2, 'b'], [3, 'c']])
  })

  it('should stop at shortest iterator', async () => {
    const result = await collect(zip([1, 2], ['a', 'b', 'c']))
    expect(result).toEqual([[1, 'a'], [2, 'b']])
  })
})

describe('concat', () => {
  it('should concatenate iterators', async () => {
    const result = await collect(concat([1, 2], [3, 4], [5]))
    expect(result).toEqual([1, 2, 3, 4, 5])
  })
})

describe('merge', () => {
  it('should merge iterators', async () => {
    async function* fast() {
      yield 1
      yield 2
    }
    async function* slow() {
      yield 'a'
      yield 'b'
    }
    const result = await collect(merge(fast(), slow()))
    // Order depends on timing, but should contain all elements
    expect(result.sort()).toEqual([1, 2, 'a', 'b'].sort())
  })
})

describe('enumerate', () => {
  it('should add indices', async () => {
    const result = await collect(enumerate(['a', 'b', 'c']))
    expect(result).toEqual([[0, 'a'], [1, 'b'], [2, 'c']])
  })

  it('should support custom start index', async () => {
    const result = await collect(enumerate(['a', 'b'], 10))
    expect(result).toEqual([[10, 'a'], [11, 'b']])
  })
})

describe('window', () => {
  it('should create sliding windows', async () => {
    const result = await collect(window([1, 2, 3, 4, 5], 3))
    expect(result).toEqual([[1, 2, 3], [2, 3, 4], [3, 4, 5]])
  })
})

describe('chunk', () => {
  it('should chunk into fixed sizes', async () => {
    const result = await collect(chunk([1, 2, 3, 4, 5], 2))
    expect(result).toEqual([[1, 2], [3, 4], [5]])
  })
})

describe('tap', () => {
  it('should call function without modifying stream', async () => {
    const seen: number[] = []
    const result = await collect(tap([1, 2, 3], item => { seen.push(item) }))
    expect(result).toEqual([1, 2, 3])
    expect(seen).toEqual([1, 2, 3])
  })
})
