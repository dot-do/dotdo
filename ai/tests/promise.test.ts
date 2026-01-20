import { describe, it, expect, vi } from 'vitest'
import { createAIPromise, type AIPromise, type AIMeta } from '../promise'

describe('AIPromise', () => {
  it('should create a promise with $meta', () => {
    const promise = createAIPromise(async () => 'result', { model: 'test' })

    expect(promise.$meta).toBeDefined()
    expect(promise.$meta.model).toBe('test')
  })

  it('should resolve to the executor result', async () => {
    const promise = createAIPromise(async () => 'hello')
    const result = await promise

    expect(result).toBe('hello')
  })

  it('should allow chaining with .with()', () => {
    const p1 = createAIPromise(async () => 'result', { model: 'a' })
    const p2 = p1.with({ model: 'b', temperature: 0.5 })

    expect(p2.$meta.model).toBe('b')
    expect(p2.$meta.temperature).toBe(0.5)
  })

  it('should support async iteration via stream()', async () => {
    const promise = createAIPromise(async () => 'streamed result')
    const chunks: string[] = []

    for await (const chunk of promise.stream()) {
      chunks.push(chunk)
    }

    // Should have chunks, when joined should equal original
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.join('')).toBe('streamed result')
  })

  it('should preserve original meta when using .with()', () => {
    const p1 = createAIPromise(async () => 'result', { model: 'a', temperature: 0.3 })
    const p2 = p1.with({ model: 'b' })

    expect(p2.$meta.model).toBe('b')
    expect(p2.$meta.temperature).toBe(0.3)
  })

  it('should update meta during execution', async () => {
    const promise = createAIPromise(async (meta) => {
      meta.tokens = { input: 10, output: 20 }
      meta.duration = 100
      return 'result'
    })

    await promise

    expect(promise.$meta.tokens).toEqual({ input: 10, output: 20 })
    expect(promise.$meta.duration).toBe(100)
  })

  describe('.json<T>() for structured output', () => {
    it('should parse JSON string response', async () => {
      const promise = createAIPromise<string>(async () => '{"name":"Alice","age":30}')
      const parsed = await promise.json<{ name: string; age: number }>()

      expect(parsed.name).toBe('Alice')
      expect(parsed.age).toBe(30)
    })

    it('should handle already-parsed objects', async () => {
      const promise = createAIPromise<{ name: string }>(async () => ({ name: 'Bob' }))
      const result = await promise.json<{ name: string }>()

      expect(result.name).toBe('Bob')
    })

    it('should preserve $meta in json result', async () => {
      const promise = createAIPromise<string>(
        async (meta) => {
          meta.model = 'test-model'
          meta.tokens = { input: 5, output: 10 }
          return '{"value":"test"}'
        }
      )

      const result = await promise.json<{ value: string }>()

      expect(result.value).toBe('test')
      expect(promise.$meta.model).toBe('test-model')
      expect(promise.$meta.tokens).toEqual({ input: 5, output: 10 })
    })
  })

  describe('.pipe(fn) for transformations', () => {
    it('should transform the result', async () => {
      const promise = createAIPromise(async () => 'hello')
      const piped = promise.pipe((s) => s.toUpperCase())

      expect(await piped).toBe('HELLO')
    })

    it('should chain multiple pipes', async () => {
      const promise = createAIPromise(async () => '42')
      const piped = promise
        .pipe((s) => parseInt(s))
        .pipe((n) => n * 2)

      expect(await piped).toBe(84)
    })

    it('should preserve $meta through pipe', async () => {
      const promise = createAIPromise(
        async (meta) => {
          meta.model = 'test'
          meta.tokens = { input: 10, output: 20 }
          return 'result'
        }
      )

      const piped = promise.pipe((s) => s.toUpperCase())
      await piped

      expect(piped.$meta.model).toBe('test')
      expect(piped.$meta.tokens).toEqual({ input: 10, output: 20 })
    })

    it('should allow async transformations', async () => {
      const promise = createAIPromise(async () => '5')
      const piped = promise.pipe(async (s) => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return parseInt(s) * 10
      })

      expect(await piped).toBe(50)
    })
  })

  describe('streaming with .stream()', () => {
    it('should stream chunks incrementally', async () => {
      const chunks = ['chunk1', 'chunk2', 'chunk3']
      const promise = createAIPromise(async () => chunks.join(''))

      // Override the stream method for this test
      const streamable = promise as AIPromise<string> & {
        streamChunks?: string[]
      }
      streamable.streamChunks = chunks

      const received: string[] = []
      for await (const chunk of promise.stream()) {
        received.push(chunk)
      }

      // For now, we expect at least the full result
      expect(received.length).toBeGreaterThan(0)
    })

    it('should allow consuming stream multiple times', async () => {
      const promise = createAIPromise(async () => 'test result')

      const firstRun: string[] = []
      for await (const chunk of promise.stream()) {
        firstRun.push(chunk)
      }

      const secondRun: string[] = []
      for await (const chunk of promise.stream()) {
        secondRun.push(chunk)
      }

      expect(firstRun).toEqual(secondRun)
    })

    it('should support stream transformations', async () => {
      const promise = createAIPromise(async () => 'hello world')

      const uppercased = await promise.stream()
        .map(chunk => chunk.toUpperCase())
        .collect()

      expect(uppercased.join('')).toBe('HELLO WORLD')
    })

    it('should support stream filtering', async () => {
      const promise = createAIPromise(async () => 'a1b2c3')

      const onlyLetters = await promise.stream()
        .filter(chunk => /[a-z]/i.test(chunk))
        .collect()

      // Should have filtered chunks
      expect(onlyLetters.length).toBeGreaterThan(0)
    })

    it('should support collecting stream to string', async () => {
      const promise = createAIPromise(async () => 'test result')

      const result = await promise.stream().join('')

      expect(result).toBe('test result')
    })

    it('should support stream.collect() for array', async () => {
      const promise = createAIPromise(async () => 'chunks')

      const chunks = await promise.stream().collect()

      expect(Array.isArray(chunks)).toBe(true)
      expect(chunks.join('')).toBe('chunks')
    })

    it('should support stream.forEach() for side effects', async () => {
      const promise = createAIPromise(async () => 'test')
      const sideEffects: string[] = []

      await promise.stream().forEach(chunk => {
        sideEffects.push(chunk)
      })

      expect(sideEffects.join('')).toBe('test')
    })
  })

  describe('cost tracking', () => {
    it('should track cost in $meta', async () => {
      const promise = createAIPromise(async (meta) => {
        meta.cost = 0.0015
        return 'result'
      })

      await promise

      expect(promise.$meta.cost).toBe(0.0015)
    })

    it('should allow updating cost after resolution', async () => {
      const promise = createAIPromise(async (meta) => {
        meta.tokens = { input: 100, output: 200 }
        // Cost calculation: (input * $0.003 + output * $0.015) / 1000
        meta.cost = (100 * 0.003 + 200 * 0.015) / 1000
        return 'result'
      })

      await promise

      expect(promise.$meta.cost).toBeGreaterThan(0)
    })
  })

  describe('Promise interface compatibility', () => {
    it('should work with Promise.all', async () => {
      const p1 = createAIPromise(async () => 'a')
      const p2 = createAIPromise(async () => 'b')
      const p3 = createAIPromise(async () => 'c')

      const results = await Promise.all([p1, p2, p3])

      expect(results).toEqual(['a', 'b', 'c'])
    })

    it('should work with Promise.race', async () => {
      const p1 = createAIPromise(async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return 'slow'
      })
      const p2 = createAIPromise(async () => 'fast')

      const result = await Promise.race([p1, p2])

      expect(result).toBe('fast')
    })

    it('should work with .then()', async () => {
      const promise = createAIPromise(async () => 'hello')
      const result = await promise.then(s => s.toUpperCase())

      expect(result).toBe('HELLO')
    })

    it('should work with .catch()', async () => {
      const promise = createAIPromise(async () => {
        throw new Error('test error')
      })

      const result = await promise.catch(err => `caught: ${err.message}`)

      expect(result).toBe('caught: test error')
    })

    it('should work with .finally()', async () => {
      const cleanup = vi.fn()
      const promise = createAIPromise(async () => 'result')

      await promise.finally(cleanup)

      expect(cleanup).toHaveBeenCalled()
    })
  })

  describe('complex chaining scenarios', () => {
    it('should chain .with() and .pipe()', async () => {
      const promise = createAIPromise(async () => 'test', { model: 'a' })
      const result = await promise
        .with({ model: 'b', temperature: 0.7 })
        .pipe(s => s.toUpperCase())

      expect(result).toBe('TEST')
      expect(promise.with({ model: 'b' }).$meta.model).toBe('b')
    })

    it('should chain .json() and .pipe()', async () => {
      const promise = createAIPromise(async () => '{"count":5}')
      const result = await promise
        .json<{ count: number }>()
        .then(obj => obj.count * 2)

      expect(result).toBe(10)
    })
  })

  describe('error handling', () => {
    it('should propagate errors through pipe', async () => {
      const promise = createAIPromise(async () => {
        throw new Error('executor error')
      })

      await expect(promise.pipe(s => s.toUpperCase())).rejects.toThrow('executor error')
    })

    it('should handle errors in pipe transformations', async () => {
      const promise = createAIPromise(async () => 'test')
      const piped = promise.pipe(() => {
        throw new Error('pipe error')
      })

      await expect(piped).rejects.toThrow('pipe error')
    })

    it('should handle JSON parse errors gracefully', async () => {
      const promise = createAIPromise(async () => 'not valid json')

      await expect(promise.json()).rejects.toThrow()
    })
  })

  describe('.boolean() for yes/no questions', () => {
    it('should parse "yes" as true', async () => {
      const promise = createAIPromise(async () => 'yes')
      const result = await promise.boolean()

      expect(result).toBe(true)
    })

    it('should parse "true" as true', async () => {
      const promise = createAIPromise(async () => 'true')
      const result = await promise.boolean()

      expect(result).toBe(true)
    })

    it('should parse "y" as true', async () => {
      const promise = createAIPromise(async () => 'y')
      const result = await promise.boolean()

      expect(result).toBe(true)
    })

    it('should parse "1" as true', async () => {
      const promise = createAIPromise(async () => '1')
      const result = await promise.boolean()

      expect(result).toBe(true)
    })

    it('should parse "on" as true', async () => {
      const promise = createAIPromise(async () => 'on')
      const result = await promise.boolean()

      expect(result).toBe(true)
    })

    it('should parse "affirmative" as true', async () => {
      const promise = createAIPromise(async () => 'affirmative')
      const result = await promise.boolean()

      expect(result).toBe(true)
    })

    it('should parse "correct" as true', async () => {
      const promise = createAIPromise(async () => 'correct')
      const result = await promise.boolean()

      expect(result).toBe(true)
    })

    it('should parse "sure" as true', async () => {
      const promise = createAIPromise(async () => 'sure')
      const result = await promise.boolean()

      expect(result).toBe(true)
    })

    it('should parse "no" as false', async () => {
      const promise = createAIPromise(async () => 'no')
      const result = await promise.boolean()

      expect(result).toBe(false)
    })

    it('should parse "false" as false', async () => {
      const promise = createAIPromise(async () => 'false')
      const result = await promise.boolean()

      expect(result).toBe(false)
    })

    it('should parse "n" as false', async () => {
      const promise = createAIPromise(async () => 'n')
      const result = await promise.boolean()

      expect(result).toBe(false)
    })

    it('should parse "0" as false', async () => {
      const promise = createAIPromise(async () => '0')
      const result = await promise.boolean()

      expect(result).toBe(false)
    })

    it('should handle case-insensitivity', async () => {
      const promise = createAIPromise(async () => 'YES')
      const result = await promise.boolean()

      expect(result).toBe(true)
    })

    it('should handle whitespace trimming', async () => {
      const promise = createAIPromise(async () => '  yes  ')
      const result = await promise.boolean()

      expect(result).toBe(true)
    })

    it('should return false for unrecognized responses', async () => {
      const promise = createAIPromise(async () => 'maybe')
      const result = await promise.boolean()

      expect(result).toBe(false)
    })

    it('should return false for empty string', async () => {
      const promise = createAIPromise(async () => '')
      const result = await promise.boolean()

      expect(result).toBe(false)
    })

    it('should preserve $meta when calling boolean()', async () => {
      const promise = createAIPromise(
        async (meta) => {
          meta.model = 'test-model'
          meta.tokens = { input: 5, output: 10 }
          return 'yes'
        }
      )

      const result = await promise.boolean()

      expect(result).toBe(true)
      expect(promise.boolean().$meta.model).toBe('test-model')
      expect(promise.boolean().$meta.tokens).toEqual({ input: 5, output: 10 })
    })

    it('should allow chaining with .with()', async () => {
      const promise = createAIPromise(async () => 'yes', { model: 'a' })
      const result = await promise.with({ model: 'b' }).boolean()

      expect(result).toBe(true)
      expect(promise.with({ model: 'b' }).$meta.model).toBe('b')
    })

    it('should parse numeric true/false responses', async () => {
      const p1 = createAIPromise(async () => '1')
      const p0 = createAIPromise(async () => '0')

      expect(await p1.boolean()).toBe(true)
      expect(await p0.boolean()).toBe(false)
    })

    it('should return AIPromise for further chaining', async () => {
      const promise = createAIPromise(async () => 'yes')
      const boolPromise = promise.boolean()

      expect(boolPromise).toHaveProperty('$meta')
      expect(boolPromise).toHaveProperty('with')
      expect(boolPromise).toHaveProperty('pipe')
    })

    it('should support piping after boolean()', async () => {
      const promise = createAIPromise(async () => 'yes')
      const result = await promise.boolean().pipe(b => b ? 'YES' : 'NO')

      expect(result).toBe('YES')
    })

    it('should parse "absolutely" as true', async () => {
      const promise = createAIPromise(async () => 'absolutely')
      const result = await promise.boolean()

      expect(result).toBe(true)
    })

    it('should parse "definitely" as true', async () => {
      const promise = createAIPromise(async () => 'definitely')
      const result = await promise.boolean()

      expect(result).toBe(true)
    })
  })

  describe('.list<T>() for list generation', () => {
    it('should parse JSON array string response', async () => {
      const promise = createAIPromise<string>(async () => '["apple","banana","orange"]')
      const result = await promise.list<string>()

      expect(Array.isArray(result)).toBe(true)
      expect(result).toEqual(['apple', 'banana', 'orange'])
    })

    it('should handle already-parsed arrays', async () => {
      const promise = createAIPromise<string[]>(async () => ['red', 'green', 'blue'])
      const result = await promise.list<string>()

      expect(result).toEqual(['red', 'green', 'blue'])
    })

    it('should parse array of objects', async () => {
      const data = '[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]'
      const promise = createAIPromise<string>(async () => data)
      const result = await promise.list<{ id: number; name: string }>()

      expect(result).toEqual([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' }
      ])
    })

    it('should wrap non-array JSON object in array', async () => {
      const promise = createAIPromise<string>(async () => '{"id":1,"name":"Alice"}')
      const result = await promise.list<{ id: number; name: string }>()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(1)
      expect(result[0]).toEqual({ id: 1, name: 'Alice' })
    })

    it('should parse newline-delimited text as list', async () => {
      const text = 'apple\nbanana\norange'
      const promise = createAIPromise<string>(async () => text)
      const result = await promise.list<string>()

      expect(result).toEqual(['apple', 'banana', 'orange'])
    })

    it('should parse comma-delimited text as list', async () => {
      const text = 'apple, banana, orange'
      const promise = createAIPromise<string>(async () => text)
      const result = await promise.list<string>()

      expect(result).toEqual(['apple', 'banana', 'orange'])
    })

    it('should parse markdown-style bullet lists', async () => {
      const text = '- apple\n- banana\n- orange'
      const promise = createAIPromise<string>(async () => text)
      const result = await promise.list<string>()

      expect(result).toEqual(['apple', 'banana', 'orange'])
    })

    it('should parse markdown-style numbered lists', async () => {
      const text = '1. apple\n2. banana\n3. orange'
      const promise = createAIPromise<string>(async () => text)
      const result = await promise.list<string>()

      expect(result).toEqual(['apple', 'banana', 'orange'])
    })

    it('should parse asterisk bullet lists', async () => {
      const text = '* apple\n* banana\n* orange'
      const promise = createAIPromise<string>(async () => text)
      const result = await promise.list<string>()

      expect(result).toEqual(['apple', 'banana', 'orange'])
    })

    it('should parse plus bullet lists', async () => {
      const text = '+ apple\n+ banana\n+ orange'
      const promise = createAIPromise<string>(async () => text)
      const result = await promise.list<string>()

      expect(result).toEqual(['apple', 'banana', 'orange'])
    })

    it('should handle mixed whitespace in list items', async () => {
      const text = '  - apple  \n  - banana  \n  - orange  '
      const promise = createAIPromise<string>(async () => text)
      const result = await promise.list<string>()

      expect(result).toEqual(['apple', 'banana', 'orange'])
    })

    it('should preserve $meta in list result', async () => {
      const promise = createAIPromise<string>(
        async (meta) => {
          meta.model = 'test-model'
          meta.tokens = { input: 5, output: 10 }
          return '["a","b","c"]'
        }
      )

      const result = await promise.list<string>()

      expect(result).toEqual(['a', 'b', 'c'])
      expect(promise.list().$meta.model).toBe('test-model')
      expect(promise.list().$meta.tokens).toEqual({ input: 5, output: 10 })
    })

    it('should return AIPromise for further chaining', async () => {
      const promise = createAIPromise(async () => '["a","b"]')
      const listPromise = promise.list<string>()

      expect(listPromise).toHaveProperty('$meta')
      expect(listPromise).toHaveProperty('with')
      expect(listPromise).toHaveProperty('pipe')
    })

    it('should support piping after list()', async () => {
      const promise = createAIPromise(async () => '["a","b","c"]')
      const result = await promise.list<string>().pipe(arr => arr.length)

      expect(result).toBe(3)
    })

    it('should support chaining with .with()', async () => {
      const promise = createAIPromise(async () => '["a","b"]', { model: 'a' })
      const result = await promise.with({ model: 'b' }).list<string>()

      expect(result).toEqual(['a', 'b'])
      expect(promise.with({ model: 'b' }).$meta.model).toBe('b')
    })

    it('should handle empty list', async () => {
      const promise = createAIPromise<string>(async () => '[]')
      const result = await promise.list<string>()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(0)
    })

    it('should handle empty string as empty list', async () => {
      const promise = createAIPromise<string>(async () => '')
      const result = await promise.list<string>()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(0)
    })

    it('should parse numeric items in list', async () => {
      const promise = createAIPromise<string>(async () => '[1,2,3,4,5]')
      const result = await promise.list<number>()

      expect(result).toEqual([1, 2, 3, 4, 5])
    })

    it('should handle mixed JSON and text list items', async () => {
      const text = '{"name":"Alice"}\n{"name":"Bob"}\n{"name":"Charlie"}'
      const promise = createAIPromise<string>(async () => text)
      const result = await promise.list<{ name: string }>()

      expect(result).toEqual([
        { name: 'Alice' },
        { name: 'Bob' },
        { name: 'Charlie' }
      ])
    })

    it('should trim whitespace from each item', async () => {
      const text = 'apple  ,  banana  ,  orange  '
      const promise = createAIPromise<string>(async () => text)
      const result = await promise.list<string>()

      expect(result).toEqual(['apple', 'banana', 'orange'])
    })

    it('should handle single item as single-element list', async () => {
      const promise = createAIPromise<string>(async () => 'apple')
      const result = await promise.list<string>()

      expect(result).toEqual(['apple'])
    })

    it('should return actual list, not placeholder', async () => {
      const promise = createAIPromise(async () => '["red","green","blue"]')
      const result = await promise.list<string>()

      expect(Array.isArray(result)).toBe(true)
      expect(result.every(item => !String(item).includes('placeholder'))).toBe(true)
    })
  })
})
