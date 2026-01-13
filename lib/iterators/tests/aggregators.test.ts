/**
 * Tests for aggregators module
 */

import { describe, it, expect } from 'vitest'
import {
  collect,
  collectSet,
  collectMap,
  groupBy,
  aggregateNumeric,
  sum,
  avg,
  min,
  max,
  count,
  aggregateText,
  join,
  aggregateTable,
  reduce,
  first,
  last,
  find,
  findIndex,
  some,
  every,
  includes,
} from '../aggregators'

describe('collect', () => {
  it('should collect items into array', async () => {
    const result = await collect([1, 2, 3])
    expect(result).toEqual([1, 2, 3])
  })

  it('should respect limit', async () => {
    const result = await collect([1, 2, 3, 4, 5], { limit: 3 })
    expect(result).toEqual([1, 2, 3])
  })

  it('should handle async generators', async () => {
    async function* gen() {
      yield 1
      yield 2
      yield 3
    }
    const result = await collect(gen())
    expect(result).toEqual([1, 2, 3])
  })
})

describe('collectSet', () => {
  it('should collect unique items', async () => {
    const result = await collectSet([1, 2, 2, 3, 3, 3])
    expect(result).toEqual(new Set([1, 2, 3]))
  })
})

describe('collectMap', () => {
  it('should collect into map', async () => {
    const users = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]
    const result = await collectMap(users, u => u.id, u => u.name)
    expect(result.get(1)).toBe('Alice')
    expect(result.get(2)).toBe('Bob')
  })
})

describe('groupBy', () => {
  it('should group items by key', async () => {
    const items = [
      { type: 'a', value: 1 },
      { type: 'b', value: 2 },
      { type: 'a', value: 3 },
    ]
    const result = await groupBy(items, i => i.type)
    expect(result.get('a')).toEqual([
      { type: 'a', value: 1 },
      { type: 'a', value: 3 },
    ])
    expect(result.get('b')).toEqual([
      { type: 'b', value: 2 },
    ])
  })
})

describe('aggregateNumeric', () => {
  it('should calculate statistics', async () => {
    const result = await aggregateNumeric([1, 2, 3, 4, 5])
    expect(result.sum).toBe(15)
    expect(result.count).toBe(5)
    expect(result.avg).toBe(3)
    expect(result.min).toBe(1)
    expect(result.max).toBe(5)
  })

  it('should calculate median when requested', async () => {
    const result = await aggregateNumeric([1, 2, 3, 4, 5], { includeMedian: true })
    expect(result.median).toBe(3)
  })

  it('should calculate variance and stdDev', async () => {
    const result = await aggregateNumeric([2, 4, 4, 4, 5, 5, 7, 9])
    expect(result.variance).toBe(4)
    expect(result.stdDev).toBe(2)
  })

  it('should handle empty input', async () => {
    const result = await aggregateNumeric([])
    expect(result.count).toBe(0)
    expect(result.sum).toBe(0)
    expect(result.avg).toBe(0)
  })

  it('should use value extractor', async () => {
    const items = [{ value: 10 }, { value: 20 }, { value: 30 }]
    const result = await aggregateNumeric(items, {
      valueExtractor: i => i.value,
    })
    expect(result.sum).toBe(60)
    expect(result.avg).toBe(20)
  })
})

describe('sum', () => {
  it('should sum numbers', async () => {
    const result = await sum([1, 2, 3, 4, 5])
    expect(result).toBe(15)
  })
})

describe('avg', () => {
  it('should average numbers', async () => {
    const result = await avg([2, 4, 6])
    expect(result).toBe(4)
  })
})

describe('min', () => {
  it('should find minimum', async () => {
    const result = await min([3, 1, 4, 1, 5])
    expect(result).toBe(1)
  })
})

describe('max', () => {
  it('should find maximum', async () => {
    const result = await max([3, 1, 4, 1, 5])
    expect(result).toBe(5)
  })
})

describe('count', () => {
  it('should count items', async () => {
    const result = await count([1, 2, 3, 4, 5])
    expect(result).toBe(5)
  })

  it('should count with predicate', async () => {
    const result = await count([1, 2, 3, 4, 5], x => x % 2 === 0)
    expect(result).toBe(2)
  })
})

describe('aggregateText', () => {
  it('should concatenate text', async () => {
    const result = await aggregateText(['Hello', ' ', 'World'])
    expect(result.text).toBe('Hello World')
    expect(result.count).toBe(3)
  })

  it('should use separator', async () => {
    const result = await aggregateText(['a', 'b', 'c'], { separator: '-' })
    expect(result.text).toBe('a-b-c')
  })

  it('should count words', async () => {
    const result = await aggregateText(['Hello World', 'How are you'], { separator: ' ' })
    expect(result.wordCount).toBe(5)
  })

  it('should respect maxLength', async () => {
    const result = await aggregateText(['Hello', 'World'], { maxLength: 8 })
    expect(result.text).toBe('HelloWor')
  })
})

describe('join', () => {
  it('should join strings', async () => {
    const result = await join(['a', 'b', 'c'], ', ')
    expect(result).toBe('a, b, c')
  })
})

describe('aggregateTable', () => {
  it('should collect table data', async () => {
    const rows = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]
    const result = await aggregateTable(rows)
    expect(result.rowCount).toBe(2)
    expect(result.columns).toContain('name')
    expect(result.columns).toContain('age')
  })

  it('should calculate column statistics', async () => {
    const rows = [
      { value: 10 },
      { value: 20 },
      { value: 30 },
    ]
    const result = await aggregateTable(rows)
    const valueStats = result.columnStats.get('value')
    expect(valueStats?.numeric?.sum).toBe(60)
    expect(valueStats?.numeric?.avg).toBe(20)
    expect(valueStats?.numeric?.min).toBe(10)
    expect(valueStats?.numeric?.max).toBe(30)
  })
})

describe('reduce', () => {
  it('should reduce to single value', async () => {
    const result = await reduce([1, 2, 3, 4], (acc, x) => acc + x, 0)
    expect(result).toBe(10)
  })
})

describe('first', () => {
  it('should get first item', async () => {
    const result = await first([1, 2, 3])
    expect(result).toBe(1)
  })

  it('should return undefined for empty', async () => {
    const result = await first([])
    expect(result).toBeUndefined()
  })
})

describe('last', () => {
  it('should get last item', async () => {
    const result = await last([1, 2, 3])
    expect(result).toBe(3)
  })
})

describe('find', () => {
  it('should find matching item', async () => {
    const result = await find([1, 2, 3, 4], x => x > 2)
    expect(result).toBe(3)
  })

  it('should return undefined if not found', async () => {
    const result = await find([1, 2, 3], x => x > 10)
    expect(result).toBeUndefined()
  })
})

describe('findIndex', () => {
  it('should find index of matching item', async () => {
    const result = await findIndex([1, 2, 3, 4], x => x === 3)
    expect(result).toBe(2)
  })

  it('should return -1 if not found', async () => {
    const result = await findIndex([1, 2, 3], x => x > 10)
    expect(result).toBe(-1)
  })
})

describe('some', () => {
  it('should return true if any match', async () => {
    const result = await some([1, 2, 3], x => x === 2)
    expect(result).toBe(true)
  })

  it('should return false if none match', async () => {
    const result = await some([1, 2, 3], x => x > 10)
    expect(result).toBe(false)
  })
})

describe('every', () => {
  it('should return true if all match', async () => {
    const result = await every([2, 4, 6], x => x % 2 === 0)
    expect(result).toBe(true)
  })

  it('should return false if any fail', async () => {
    const result = await every([2, 3, 6], x => x % 2 === 0)
    expect(result).toBe(false)
  })
})

describe('includes', () => {
  it('should return true if contains', async () => {
    const result = await includes([1, 2, 3], 2)
    expect(result).toBe(true)
  })

  it('should return false if not contains', async () => {
    const result = await includes([1, 2, 3], 5)
    expect(result).toBe(false)
  })
})
