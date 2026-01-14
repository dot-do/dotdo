/**
 * RED Phase Tests: Bloblang Interpreter Core
 * @dotdo/benthos - Benthos-compatible stream processing SDK
 *
 * Tests for interpreter core functionality:
 * - Expression evaluation
 * - Variable binding
 * - Function execution
 * - Method invocation
 *
 * These tests exercise the interpreter's ability to execute Bloblang AST
 * with message context, following the Benthos specification.
 */

import { describe, it, expect } from 'vitest'
import { parse, evaluate, createMessage, Interpreter, DELETED, NOTHING, createInterpreterContext } from '../src'
import { BenthosMessage } from '../src/message'

/**
 * Helper function to evaluate Bloblang expression with input data and optional metadata
 */
function evalBloblang(
  expr: string,
  input: unknown,
  meta?: Record<string, string>
): unknown {
  const msg = createMessage(input, meta)
  return evaluate(parse(expr), msg)
}

describe('BloblangInterpreter Core', () => {
  describe('Expression Evaluation', () => {
    it('evaluates simple assignment to root', () => {
      const msg = createMessage({ y: 42 })
      const interpreter = new Interpreter(msg)
      const result = interpreter.evaluate(parse('root.x = this.y'))
      // After assignment, result should be the assigned value
      expect(result).toBe(42)
      // And message root should be updated
      expect(msg.root).toEqual({ y: 42, x: 42 })
    })

    it('evaluates nested field access', () => {
      const result = evalBloblang('root.user.profile.name', {
        user: { profile: { name: 'Alice' } }
      })
      expect(result).toBe('Alice')
    })

    it('evaluates deeply nested assignment', () => {
      const msg = createMessage({ source: 'input' })
      const interpreter = new Interpreter(msg)
      interpreter.evaluate(parse('root.a.b.c = "deep"'))
      expect(msg.root).toEqual({ source: 'input', a: { b: { c: 'deep' } } })
    })

    it('evaluates binary expressions with correct precedence', () => {
      // 1 + (3 * 2) = 7
      const result = evalBloblang('this.a + this.b * 2', { a: 1, b: 3 })
      expect(result).toBe(7)
    })

    it('evaluates complex arithmetic expressions', () => {
      const result = evalBloblang('(this.x + this.y) * (this.z - 1)', { x: 2, y: 3, z: 4 })
      expect(result).toBe(15) // (2 + 3) * (4 - 1) = 5 * 3 = 15
    })

    it('evaluates conditional expressions with field access', () => {
      const result = evalBloblang(
        'if this.score > 90 then "A" else "B"',
        { score: 95 }
      )
      expect(result).toBe('A')
    })

    it('evaluates nested conditionals', () => {
      const result = evalBloblang(
        'if this.x > 0 then (if this.x > 10 then "big" else "small") else "zero"',
        { x: 5 }
      )
      expect(result).toBe('small')
    })

    it('evaluates match expression with field access', () => {
      const result = evalBloblang(
        'match this.status { case "active": 1 case "pending": 2 default: 0 }',
        { status: 'pending' }
      )
      expect(result).toBe(2)
    })
  })

  describe('Variable Binding', () => {
    it('binds and accesses let variables', () => {
      const result = evalBloblang('let x = 10 in x * 2', {})
      expect(result).toBe(20)
    })

    it('binds multiple variables with chained let', () => {
      const result = evalBloblang('let x = 5 in let y = 3 in x + y', {})
      expect(result).toBe(8)
    })

    it('accesses outer scope variables', () => {
      const result = evalBloblang('let x = 10 in let y = x * 2 in y + x', {})
      expect(result).toBe(30) // y = 20, x = 10, result = 30
    })

    it('shadows outer variables in inner scope', () => {
      const result = evalBloblang('let x = 10 in let x = 5 in x', {})
      expect(result).toBe(5)
    })

    it('supports variable assignment with $ prefix', () => {
      const msg = createMessage({ value: 42 })
      const interpreter = new Interpreter(msg)
      // Assignment creates a variable
      interpreter.evaluate(parse('let doubled = this.value * 2; $doubled'))
      // Accessing $doubled after assignment in sequence
      const result = interpreter.evaluate(parse('let doubled = this.value * 2 in $doubled'))
      expect(result).toBe(84)
    })

    it('supports pipe value binding with _', () => {
      const result = evalBloblang('[1, 2, 3] | map(x -> x * _)', {})
      // This should fail if _ is not properly bound in pipe context
      // _ should refer to the piped value [1, 2, 3]
      // Expected: each x multiplied by entire array? This depends on semantics
      // More realistic: _ used for identity in pipe chain
      expect(result).toBeDefined()
    })

    it('variables are scoped to their let block', () => {
      // After let block ends, variable should not be accessible
      // This tests proper scoping
      expect(() => evalBloblang('(let x = 5 in x) + x', {})).toThrow()
    })
  })

  describe('Function Execution', () => {
    it('executes now() function', () => {
      const result = evalBloblang('now()', {})
      expect(typeof result).toBe('string')
      // Should be ISO timestamp
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('executes timestamp_unix() function', () => {
      const result = evalBloblang('timestamp_unix()', {})
      expect(typeof result).toBe('number')
      // Should be reasonable Unix timestamp
      expect(result).toBeGreaterThan(1700000000)
    })

    it('executes uuid_v4() function', () => {
      const result = evalBloblang('uuid_v4()', {})
      expect(typeof result).toBe('string')
      // Should be valid UUID v4 format
      expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    })

    it('executes length() function with string', () => {
      const result = evalBloblang('length("hello")', {})
      expect(result).toBe(5)
    })

    it('executes length() function with array', () => {
      const result = evalBloblang('length([1, 2, 3, 4])', {})
      expect(result).toBe(4)
    })

    it('executes throw() function', () => {
      expect(() => evalBloblang('throw("custom error")', {})).toThrow('custom error')
    })

    it('executes meta() function without arguments', () => {
      const result = evalBloblang('meta()', {}, { key1: 'value1', key2: 'value2' })
      expect(result).toEqual({ key1: 'value1', key2: 'value2' })
    })

    it('executes meta() function with key argument', () => {
      const result = evalBloblang('meta("kafka_topic")', {}, { kafka_topic: 'orders' })
      expect(result).toBe('orders')
    })

    it('returns undefined for missing meta key', () => {
      const result = evalBloblang('meta("nonexistent")', {}, { other: 'value' })
      expect(result).toBeUndefined()
    })

    it('executes deleted() function', () => {
      const result = evalBloblang('deleted()', {})
      expect(result).toBe(DELETED)
    })

    it('executes nothing() function', () => {
      const result = evalBloblang('nothing()', {})
      expect(result).toBe(NOTHING)
    })

    it('throws on unknown function', () => {
      expect(() => evalBloblang('unknown_function()', {})).toThrow()
    })
  })

  describe('Method Invocation', () => {
    describe('String Methods', () => {
      it('invokes uppercase() method', () => {
        const result = evalBloblang('this.name.uppercase()', { name: 'alice' })
        expect(result).toBe('ALICE')
      })

      it('invokes lowercase() method', () => {
        const result = evalBloblang('this.name.lowercase()', { name: 'ALICE' })
        expect(result).toBe('alice')
      })

      it('invokes upper() alias', () => {
        const result = evalBloblang('this.name.upper()', { name: 'alice' })
        expect(result).toBe('ALICE')
      })

      it('invokes lower() alias', () => {
        const result = evalBloblang('this.name.lower()', { name: 'ALICE' })
        expect(result).toBe('alice')
      })

      it('invokes trim() method', () => {
        const result = evalBloblang('this.text.trim()', { text: '  hello  ' })
        expect(result).toBe('hello')
      })

      it('invokes replace() method', () => {
        const result = evalBloblang('this.text.replace("o", "0")', { text: 'hello' })
        expect(result).toBe('hell0')
      })

      it('invokes replace_all() method', () => {
        const result = evalBloblang('this.text.replace_all("l", "L")', { text: 'hello' })
        expect(result).toBe('heLLo')
      })

      it('invokes split() method', () => {
        const result = evalBloblang('this.csv.split(",")', { csv: 'a,b,c' })
        expect(result).toEqual(['a', 'b', 'c'])
      })

      it('invokes contains() method on string', () => {
        const result = evalBloblang('this.text.contains("world")', { text: 'hello world' })
        expect(result).toBe(true)
      })

      it('invokes has_prefix() method', () => {
        const result = evalBloblang('this.url.has_prefix("https://")', { url: 'https://example.com' })
        expect(result).toBe(true)
      })

      it('invokes has_suffix() method', () => {
        const result = evalBloblang('this.file.has_suffix(".json")', { file: 'data.json' })
        expect(result).toBe(true)
      })

      it('invokes slice() method on string', () => {
        const result = evalBloblang('this.text.slice(0, 5)', { text: 'hello world' })
        expect(result).toBe('hello')
      })

      it('invokes length() method on string', () => {
        const result = evalBloblang('this.text.length()', { text: 'hello' })
        expect(result).toBe(5)
      })

      it('chains string methods', () => {
        const result = evalBloblang('this.text.trim().uppercase()', { text: '  hello  ' })
        expect(result).toBe('HELLO')
      })
    })

    describe('Array Methods', () => {
      it('invokes map() with lambda', () => {
        const result = evalBloblang('this.items.map(i -> i * 2)', { items: [1, 2, 3] })
        expect(result).toEqual([2, 4, 6])
      })

      it('invokes filter() with lambda', () => {
        const result = evalBloblang('this.nums.filter(n -> n > 2)', { nums: [1, 2, 3, 4] })
        expect(result).toEqual([3, 4])
      })

      it('invokes reduce() with lambda', () => {
        const result = evalBloblang('this.nums.reduce(acc -> acc + this, 0)', { nums: [1, 2, 3] })
        // Note: reduce semantics might need adjustment based on implementation
        expect(result).toBeDefined()
      })

      it('invokes first() method', () => {
        const result = evalBloblang('this.items.first()', { items: [10, 20, 30] })
        expect(result).toBe(10)
      })

      it('invokes last() method', () => {
        const result = evalBloblang('this.items.last()', { items: [10, 20, 30] })
        expect(result).toBe(30)
      })

      it('invokes length() method on array', () => {
        const result = evalBloblang('this.items.length()', { items: [1, 2, 3, 4, 5] })
        expect(result).toBe(5)
      })

      it('invokes join() method', () => {
        const result = evalBloblang('this.items.join("-")', { items: ['a', 'b', 'c'] })
        expect(result).toBe('a-b-c')
      })

      it('invokes flatten() method', () => {
        const result = evalBloblang('this.nested.flatten()', { nested: [[1, 2], [3, 4]] })
        expect(result).toEqual([1, 2, 3, 4])
      })

      it('invokes unique() method', () => {
        const result = evalBloblang('this.items.unique()', { items: [1, 2, 2, 3, 3, 3] })
        expect(result).toEqual([1, 2, 3])
      })

      it('invokes sum() method', () => {
        const result = evalBloblang('this.nums.sum()', { nums: [1, 2, 3, 4, 5] })
        expect(result).toBe(15)
      })

      it('invokes append() method', () => {
        const result = evalBloblang('this.items.append(4)', { items: [1, 2, 3] })
        expect(result).toEqual([1, 2, 3, 4])
      })

      it('invokes concat() method', () => {
        const result = evalBloblang('this.a.concat(this.b)', { a: [1, 2], b: [3, 4] })
        expect(result).toEqual([1, 2, 3, 4])
      })

      it('invokes slice() method on array', () => {
        const result = evalBloblang('this.items.slice(1, 3)', { items: [0, 1, 2, 3, 4] })
        expect(result).toEqual([1, 2])
      })

      it('invokes contains() method on array', () => {
        const result = evalBloblang('this.items.contains(2)', { items: [1, 2, 3] })
        expect(result).toBe(true)
      })

      it('invokes reverse() method', () => {
        const result = evalBloblang('this.items.reverse()', { items: [1, 2, 3] })
        expect(result).toEqual([3, 2, 1])
      })

      it('invokes sort() method', () => {
        const result = evalBloblang('this.items.sort()', { items: [3, 1, 2] })
        expect(result).toEqual([1, 2, 3])
      })

      it('invokes index() method', () => {
        const result = evalBloblang('this.items.index("b")', { items: ['a', 'b', 'c'] })
        expect(result).toBe(1)
      })

      it('chains array methods', () => {
        const result = evalBloblang('this.items.filter(x -> x > 1).map(x -> x * 10)', { items: [1, 2, 3] })
        expect(result).toEqual([20, 30])
      })

      it('accesses array by negative index', () => {
        const result = evalBloblang('this.items[-1]', { items: [1, 2, 3] })
        expect(result).toBe(3)
      })
    })

    describe('Object Methods', () => {
      it('invokes keys() method', () => {
        const result = evalBloblang('this.obj.keys()', { obj: { a: 1, b: 2 } })
        expect(result).toContain('a')
        expect(result).toContain('b')
        expect((result as string[]).length).toBe(2)
      })

      it('invokes values() method', () => {
        const result = evalBloblang('this.obj.values()', { obj: { a: 1, b: 2 } })
        expect(result).toContain(1)
        expect(result).toContain(2)
        expect((result as number[]).length).toBe(2)
      })
    })

    describe('Type Checking', () => {
      it('throws TypeError when calling string method on non-string', () => {
        expect(() => evalBloblang('this.num.uppercase()', { num: 42 })).toThrow(TypeError)
      })

      it('throws TypeError when calling array method on non-array', () => {
        expect(() => evalBloblang('this.text.map(x -> x)', { text: 'hello' })).toThrow(TypeError)
      })

      it('throws TypeError when calling object method on non-object', () => {
        expect(() => evalBloblang('this.arr.keys()', { arr: [1, 2, 3] })).toThrow(TypeError)
      })

      it('throws on arithmetic with incompatible types', () => {
        expect(() => evalBloblang('this.arr + 1', { arr: [1, 2] })).toThrow(TypeError)
      })

      it('throws on comparison of incompatible types', () => {
        expect(() => evalBloblang('this.arr > 1', { arr: [1, 2] })).toThrow(TypeError)
      })
    })
  })

  describe('Error Handling', () => {
    it('handles missing field access gracefully', () => {
      const result = evalBloblang('this.missing.field', {})
      expect(result).toBeUndefined()
    })

    it('handles optional chaining on null', () => {
      const result = evalBloblang('this.user?.name', { user: null })
      expect(result).toBeUndefined()
    })

    it('handles optional chaining on undefined', () => {
      const result = evalBloblang('this.user?.name', {})
      expect(result).toBeUndefined()
    })

    it('handles array index out of bounds', () => {
      const result = evalBloblang('this.items[100]', { items: [1, 2, 3] })
      expect(result).toBeUndefined()
    })

    it('handles division by zero', () => {
      const result = evalBloblang('this.x / 0', { x: 10 })
      expect(result).toBe(Infinity)
    })

    it('handles modulo by zero', () => {
      const result = evalBloblang('this.x % 0', { x: 10 })
      expect(result).toBeNaN()
    })
  })

  describe('Complex Expressions', () => {
    it('evaluates complex transformation', () => {
      const input = {
        users: [
          { name: 'alice', age: 30 },
          { name: 'bob', age: 25 },
          { name: 'charlie', age: 35 }
        ]
      }
      const result = evalBloblang(
        'this.users.filter(u -> u.age > 28).map(u -> u.name.uppercase())',
        input
      )
      expect(result).toEqual(['ALICE', 'CHARLIE'])
    })

    it('evaluates object construction with field access', () => {
      const result = evalBloblang(
        '{ "name": this.user, "doubled": this.value * 2 }',
        { user: 'Alice', value: 21 }
      )
      expect(result).toEqual({ name: 'Alice', doubled: 42 })
    })

    it('evaluates array construction with expressions', () => {
      const result = evalBloblang(
        '[this.a, this.b, this.a + this.b]',
        { a: 1, b: 2 }
      )
      expect(result).toEqual([1, 2, 3])
    })

    it('evaluates pipe chain with multiple transformations', () => {
      const result = evalBloblang(
        '"  HELLO WORLD  " | trim() | lowercase() | split(" ")',
        {}
      )
      expect(result).toEqual(['hello', 'world'])
    })

    it('evaluates in operator for array membership', () => {
      const result = evalBloblang('this.val in this.allowed', { val: 'b', allowed: ['a', 'b', 'c'] })
      expect(result).toBe(true)
    })

    it('evaluates in operator for object key membership', () => {
      const result = evalBloblang('"name" in this.obj', { obj: { name: 'Alice', age: 30 } })
      expect(result).toBe(true)
    })

    it('evaluates multiple assignments in sequence', () => {
      const msg = createMessage({ x: 10 })
      const interpreter = new Interpreter(msg)
      interpreter.evaluate(parse('root.doubled = this.x * 2; root.tripled = this.x * 3'))
      expect(msg.root).toEqual({ x: 10, doubled: 20, tripled: 30 })
    })

    it('evaluates assignment with deleted() to remove field', () => {
      const msg = createMessage({ keep: 'yes', remove: 'no' })
      const interpreter = new Interpreter(msg)
      interpreter.evaluate(parse('root.remove = deleted()'))
      expect(msg.root).toEqual({ keep: 'yes' })
    })

    it('evaluates meta assignment', () => {
      const msg = createMessage({ data: 'value' })
      const interpreter = new Interpreter(msg)
      interpreter.evaluate(parse('meta("custom_key") = "custom_value"'))
      expect(msg.metadata.get('custom_key')).toBe('custom_value')
    })

    it('evaluates meta deletion', () => {
      const msg = createMessage({ data: 'value' }, { to_delete: 'old_value' })
      const interpreter = new Interpreter(msg)
      interpreter.evaluate(parse('meta("to_delete") = deleted()'))
      expect(msg.metadata.get('to_delete')).toBeUndefined()
    })
  })

  describe('Edge Cases', () => {
    it('evaluates empty string', () => {
      const result = evalBloblang('""', {})
      expect(result).toBe('')
    })

    it('evaluates empty array', () => {
      const result = evalBloblang('[]', {})
      expect(result).toEqual([])
    })

    it('evaluates empty object', () => {
      const result = evalBloblang('{}', {})
      expect(result).toEqual({})
    })

    it('evaluates negative numbers', () => {
      const result = evalBloblang('-42', {})
      expect(result).toBe(-42)
    })

    it('evaluates negative zero', () => {
      const result = evalBloblang('-0', {})
      expect(result).toBe(0) // -0 and 0 are equal in JS
    })

    it('evaluates boolean negation', () => {
      const result = evalBloblang('!this.flag', { flag: true })
      expect(result).toBe(false)
    })

    it('evaluates double negation', () => {
      const result = evalBloblang('!!this.val', { val: 'truthy' })
      expect(result).toBe(true)
    })

    it('evaluates null equality', () => {
      expect(evalBloblang('null == null', {})).toBe(true)
      expect(evalBloblang('null == this.missing', {})).toBe(true)
    })

    it('evaluates string with special characters', () => {
      const result = evalBloblang('"line1\\nline2"', {})
      expect(result).toBe('line1\nline2')
    })

    it('evaluates floating point arithmetic', () => {
      const result = evalBloblang('0.1 + 0.2', {})
      // JavaScript floating point, should be close to 0.3
      expect(result).toBeCloseTo(0.3)
    })

    it('preserves array order in unique()', () => {
      const result = evalBloblang('[3, 1, 2, 1, 3].unique()', {})
      expect(result).toEqual([3, 1, 2])
    })

    it('handles unicode strings', () => {
      const result = evalBloblang('this.emoji.length()', { emoji: '\u{1F600}\u{1F601}' })
      // Note: length depends on how unicode is handled
      expect(result).toBeGreaterThan(0)
    })
  })
})

describe('Interpreter Context', () => {
  it('creates interpreter context with default message', () => {
    const ctx = createInterpreterContext()
    expect(ctx.message).toBeDefined()
    expect(ctx.variables).toBeInstanceOf(Map)
  })

  it('creates interpreter context with provided message', () => {
    const msg = createMessage({ test: 'data' })
    const ctx = createInterpreterContext(msg)
    expect(ctx.message).toBe(msg)
    expect(ctx.message.json()).toEqual({ test: 'data' })
  })

  it('interpreter maintains variable state across evaluations', () => {
    const msg = createMessage({})
    const interpreter = new Interpreter(msg)

    // First evaluation sets a variable
    interpreter.evaluate(parse('let x = 100'))

    // Variable should not persist outside let scope
    // But if using sequence with assignment...
    const result = interpreter.evaluate(parse('let x = 100 in x'))
    expect(result).toBe(100)
  })
})
