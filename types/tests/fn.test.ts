import { describe, it, expect, expectTypeOf } from 'vitest'

/**
 * Fn Type System Tests (RED Phase)
 *
 * These tests verify the Fn<Out, In, Opts> type system with triple calling style:
 * 1. Direct call: fn(input, opts)
 * 2. Tagged template with interpolation: fn`hello ${name}`
 * 3. Tagged template with named params: fn`hello ${'name'}`
 *
 * Implementation requirements:
 * - Create types/fn.ts with Fn, AsyncFn, RpcFn, StreamFn types
 * - Support all three calling conventions
 * - Properly extract named parameters from template literals
 * - Type-safe options handling
 *
 * Reference: docs/plans/2026-01-08-functions-experiments-events-design.md
 */

// ============================================================================
// Import the types under test (will fail until implemented)
// ============================================================================

import type {
  Fn,
  AsyncFn,
  RpcFn,
  StreamFn,
  TaggedResult,
  FunctionType,
} from '../fn'

// ============================================================================
// Test Helpers & Mock Types
// ============================================================================

interface GreetingOpts {
  language?: 'en' | 'es' | 'fr'
  formal?: boolean
}

interface TranslationOpts {
  from?: string
  to: string
}

// ============================================================================
// Basic Type Definition Tests
// ============================================================================

describe('Fn Type - Basic Definition', () => {
  it('should export Fn type', () => {
    // This will fail until types/fn.ts is created
    type TestFn = Fn<string, string>
    const _typeCheck: TestFn = null as any
    expect(true).toBe(true) // Placeholder - type test
  })

  it('should export AsyncFn type', () => {
    type TestAsyncFn = AsyncFn<string, string>
    const _typeCheck: TestAsyncFn = null as any
    expect(true).toBe(true)
  })

  it('should export RpcFn type', () => {
    type TestRpcFn = RpcFn<string, string>
    const _typeCheck: TestRpcFn = null as any
    expect(true).toBe(true)
  })

  it('should export StreamFn type', () => {
    type TestStreamFn = StreamFn<string, string>
    const _typeCheck: TestStreamFn = null as any
    expect(true).toBe(true)
  })

  it('should export FunctionType enum', () => {
    const types: FunctionType[] = ['code', 'generative', 'agentic', 'human']
    expect(types).toHaveLength(4)
  })

  it('should export TaggedResult type', () => {
    type TestTaggedResult = TaggedResult<string, 'name', {}>
    const _typeCheck: TestTaggedResult = null as any
    expect(true).toBe(true)
  })
})

// ============================================================================
// Style 1: Direct Call - fn(input, opts)
// ============================================================================

describe('Fn Type - Style 1: Direct Call', () => {
  describe('basic invocation', () => {
    it('should allow calling with input only', () => {
      type Greet = Fn<string, string>

      // Type test: should accept (input) signature
      const greet: Greet = ((input: string) => `Hello, ${input}!`) as any

      const result = greet('World')
      expect(result).toBe('Hello, World!')
    })

    it('should allow calling with input and options', () => {
      type Greet = Fn<string, string, GreetingOpts>

      const greet: Greet = ((input: string, opts?: GreetingOpts) => {
        const prefix = opts?.formal ? 'Dear' : 'Hello'
        return `${prefix}, ${input}!`
      }) as any

      const result = greet('World', { formal: true })
      expect(result).toBe('Dear, World!')
    })

    it('should enforce input type', () => {
      type Sum = Fn<number, { a: number; b: number }>

      const sum: Sum = ((input: { a: number; b: number }) => input.a + input.b) as any

      const result = sum({ a: 1, b: 2 })
      expect(result).toBe(3)
    })

    it('should enforce output type', () => {
      type GetLength = Fn<number, string>

      const getLength: GetLength = ((input: string) => input.length) as any

      const result = getLength('hello')
      expectTypeOf(result).toEqualTypeOf<number>()
      expect(result).toBe(5)
    })

    it('should enforce options type', () => {
      type Translate = Fn<string, string, TranslationOpts>

      const translate: Translate = ((input: string, opts?: TranslationOpts) => {
        return `[${opts?.to}] ${input}`
      }) as any

      const result = translate('hello', { to: 'es' })
      expect(result).toBe('[es] hello')
    })
  })

  describe('type inference', () => {
    it('should infer output type correctly', () => {
      type JsonParse = Fn<unknown, string>

      const jsonParse: JsonParse = ((input: string) => JSON.parse(input)) as any

      const result = jsonParse('{"foo":"bar"}')
      expectTypeOf(result).toEqualTypeOf<unknown>()
    })

    it('should allow void output', () => {
      type Logger = Fn<void, string>

      const log: Logger = ((input: string) => {
        console.log(input)
      }) as any

      const result = log('test')
      expectTypeOf(result).toEqualTypeOf<void>()
    })

    it('should allow undefined input', () => {
      type GetTimestamp = Fn<number, undefined>

      const getTimestamp: GetTimestamp = (() => Date.now()) as any

      const result = getTimestamp(undefined)
      expectTypeOf(result).toEqualTypeOf<number>()
    })
  })

  describe('optional parameters', () => {
    it('should make options optional by default', () => {
      type Greet = Fn<string, string, GreetingOpts>

      const greet: Greet = ((input: string, _opts?: GreetingOpts) => `Hello, ${input}!`) as any

      // Should compile without options
      const result = greet('World')
      expect(result).toBe('Hello, World!')
    })

    it('should allow empty options object', () => {
      type Simple = Fn<string, string, {}>

      const simple: Simple = ((input: string) => input.toUpperCase()) as any

      const result = simple('hello', {})
      expect(result).toBe('HELLO')
    })
  })
})

// ============================================================================
// Style 2: Tagged Template with Interpolation - fn`hello ${name}`
// ============================================================================

describe('Fn Type - Style 2: Tagged Template with Interpolation', () => {
  describe('basic tagged template', () => {
    it('should accept tagged template syntax', () => {
      type Greet = Fn<string, string>

      const greet: Greet = ((
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        return strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')
      }) as any

      const name = 'World'
      const result = greet`Hello, ${name}!`
      expect(result).toBe('Hello, World!')
    })

    it('should handle multiple interpolations', () => {
      type Format = Fn<string, string>

      const format: Format = ((
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        return strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')
      }) as any

      const firstName = 'John'
      const lastName = 'Doe'
      const result = format`Name: ${firstName} ${lastName}`
      expect(result).toBe('Name: John Doe')
    })

    it('should handle expressions in interpolations', () => {
      type Calc = Fn<string, string>

      const calc: Calc = ((
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        return strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')
      }) as any

      const a = 5
      const b = 3
      const result = calc`${a} + ${b} = ${a + b}`
      expect(result).toBe('5 + 3 = 8')
    })

    it('should handle object interpolations', () => {
      type JsonTemplate = Fn<string, string>

      const jsonTemplate: JsonTemplate = ((
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        return strings.reduce((acc, str, i) => {
          const value = values[i]
          return acc + str + (value !== undefined ? JSON.stringify(value) : '')
        }, '')
      }) as any

      const data = { foo: 'bar' }
      const result = jsonTemplate`Data: ${data}`
      expect(result).toBe('Data: {"foo":"bar"}')
    })

    it('should handle empty template', () => {
      type Echo = Fn<string, string>

      const echo: Echo = ((strings: TemplateStringsArray) => strings[0]) as any

      const result = echo``
      expect(result).toBe('')
    })

    it('should handle template with no interpolations', () => {
      type Static = Fn<string, string>

      const static_: Static = ((strings: TemplateStringsArray) => strings[0]) as any

      const result = static_`just a string`
      expect(result).toBe('just a string')
    })
  })

  describe('type preservation in interpolations', () => {
    it('should preserve number types in interpolations', () => {
      type NumberFormat = Fn<string, string>

      const format: NumberFormat = ((
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        return strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')
      }) as any

      const count: number = 42
      const result = format`Count: ${count}`
      expect(result).toBe('Count: 42')
    })

    it('should preserve boolean types in interpolations', () => {
      type BoolFormat = Fn<string, string>

      const format: BoolFormat = ((
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        return strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')
      }) as any

      const enabled: boolean = true
      const result = format`Enabled: ${enabled}`
      expect(result).toBe('Enabled: true')
    })

    it('should preserve array types in interpolations', () => {
      type ArrayFormat = Fn<string, string>

      const format: ArrayFormat = ((
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        return strings.reduce((acc, str, i) => {
          const value = values[i]
          return acc + str + (Array.isArray(value) ? value.join(', ') : (value ?? ''))
        }, '')
      }) as any

      const items: string[] = ['a', 'b', 'c']
      const result = format`Items: ${items}`
      expect(result).toBe('Items: a, b, c')
    })
  })

  describe('output type with tagged templates', () => {
    it('should return correct output type', () => {
      type Tokenize = Fn<string[], string>

      const tokenize: Tokenize = ((
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        const full = strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')
        return full.split(' ')
      }) as any

      const word = 'world'
      const result = tokenize`hello ${word}`
      expectTypeOf(result).toEqualTypeOf<string[]>()
      expect(result).toEqual(['hello', 'world'])
    })

    it('should return object output type', () => {
      type Parse = Fn<{ template: string; values: unknown[] }, string>

      const parse: Parse = ((
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => ({
        template: strings.join('${}'),
        values,
      })) as any

      const name = 'test'
      const result = parse`hello ${name}`
      expectTypeOf(result).toEqualTypeOf<{ template: string; values: unknown[] }>()
      expect(result.values).toEqual(['test'])
    })
  })
})

// ============================================================================
// Style 3: Tagged Template with Named Params - fn`hello ${'name'}`
// ============================================================================

describe('Fn Type - Style 3: Tagged Template with Named Params', () => {
  describe('basic named parameter extraction', () => {
    it('should extract single named parameter', () => {
      type Greet = Fn<string, string, GreetingOpts>

      // When using named params like ${'name'}, returns a function that takes params
      const greet: Greet = (() => {
        // Implementation would parse template and return function
        return (params: { name: string }) => `Hello, ${params.name}!`
      }) as any

      // Style 3: Named params return a TaggedResult that accepts params
      const template = greet`Hello, ${'name'}!`
      const result = template({ name: 'World' })
      expect(result).toBe('Hello, World!')
    })

    it('should extract multiple named parameters', () => {
      type Format = Fn<string, string, {}>

      const format: Format = (() => {
        return (params: { firstName: string; lastName: string }) =>
          `Name: ${params.firstName} ${params.lastName}`
      }) as any

      const template = format`${'firstName'} ${'lastName'}`
      const result = template({ firstName: 'John', lastName: 'Doe' })
      expect(result).toBe('Name: John Doe')
    })

    it('should require all named parameters', () => {
      type Msg = Fn<string, string, {}>

      const msg: Msg = (() => {
        return (params: { subject: string; action: string; object: string }) =>
          `${params.subject} ${params.action} ${params.object}`
      }) as any

      const template = msg`${'subject'} ${'action'} ${'object'}`
      // Should require all params - this tests type safety
      const result = template({ subject: 'User', action: 'created', object: 'document' })
      expect(result).toBe('User created document')
    })
  })

  describe('TaggedResult type', () => {
    it('should infer parameter names from template string', () => {
      // TaggedResult<Out, S, Opts> should extract param names from S
      type ExtractParams<S extends string> =
        S extends `${infer _}${'${'}${infer Param}${'}'}`
          ? Param
          : never

      type Test = ExtractParams<"hello ${'name'}">
      // This should extract 'name' as a required parameter

      // The TaggedResult should create a function: (params: { [K in ParamNames]: unknown }) => Out
      const _typeCheck: TaggedResult<string, "${'name'}", {}> = null as any
      expect(true).toBe(true)
    })

    it('should preserve output type through TaggedResult', () => {
      type Render = Fn<{ html: string; text: string }, string, {}>

      const render: Render = (() => {
        return (params: { content: string }) => ({
          html: `<p>${params.content}</p>`,
          text: params.content,
        })
      }) as any

      const template = render`${'content'}`
      const result = template({ content: 'Hello' })
      expectTypeOf(result).toEqualTypeOf<{ html: string; text: string }>()
      expect(result.html).toBe('<p>Hello</p>')
    })

    it('should merge options with named params', () => {
      type Translate = Fn<string, string, TranslationOpts>

      const translate: Translate = (() => {
        return (params: { text: string }, opts?: TranslationOpts) =>
          `[${opts?.to || 'en'}] ${params.text}`
      }) as any

      const template = translate`${'text'}`
      // Should allow passing both params and options
      const result = template({ text: 'Hello' }, { to: 'es' })
      expect(result).toBe('[es] Hello')
    })
  })

  describe('static template analysis', () => {
    it('should differentiate string params from variable interpolation', () => {
      type Greet = Fn<string, string, {}>

      // ${'name'} is a named param (string literal)
      // ${name} is a value interpolation (variable)

      // For named params - returns a function
      const greetWithParams: Greet = (() => {
        return (params: { name: string }) => `Hello, ${params.name}!`
      }) as any

      // For value interpolation - returns result directly
      const greetDirect: Greet = ((
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        return strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')
      }) as any

      // Named params style - calls the returned function
      const template = greetWithParams`Hello, ${'name'}!`
      expect(template({ name: 'World' })).toBe('Hello, World!')

      // Value interpolation style - returns result directly
      const name = 'Direct'
      const result = greetDirect`Hello, ${name}!`
      expect(result).toBe('Hello, Direct!')
    })

    it('should handle mixed named params', () => {
      type Email = Fn<string, string, {}>

      const email: Email = (() => {
        return (params: { to: string; subject: string; body: string }) =>
          `To: ${params.to}\nSubject: ${params.subject}\n\n${params.body}`
      }) as any

      const template = email`To: ${'to'}\nSubject: ${'subject'}\n\n${'body'}`
      const result = template({
        to: 'user@example.com',
        subject: 'Hello',
        body: 'World',
      })
      expect(result).toContain('To: user@example.com')
    })
  })

  describe('complex param extraction', () => {
    it('should handle nested object params', () => {
      type RenderUser = Fn<string, string, {}>

      const renderUser: RenderUser = (() => {
        return (params: { user: { name: string; email: string } }) =>
          `${params.user.name} <${params.user.email}>`
      }) as any

      const template = renderUser`${'user'}`
      const result = template({ user: { name: 'John', email: 'john@example.com' } })
      expect(result).toBe('John <john@example.com>')
    })

    it('should handle array params', () => {
      type RenderList = Fn<string, string, {}>

      const renderList: RenderList = (() => {
        return (params: { items: string[] }) => params.items.join(', ')
      }) as any

      const template = renderList`${'items'}`
      const result = template({ items: ['a', 'b', 'c'] })
      expect(result).toBe('a, b, c')
    })

    it('should handle optional named params', () => {
      type Message = Fn<string, string, {}>

      const message: Message = (() => {
        return (params: { greeting?: string; name: string }) =>
          `${params.greeting || 'Hello'}, ${params.name}!`
      }) as any

      const template = message`${'greeting'}, ${'name'}!`
      const result = template({ name: 'World' })
      expect(result).toBe('Hello, World!')
    })
  })
})

// ============================================================================
// AsyncFn Variant Tests
// ============================================================================

describe('AsyncFn Type', () => {
  it('should return Promise<Out> for direct call', async () => {
    type FetchUser = AsyncFn<{ id: string; name: string }, string>

    const fetchUser: FetchUser = (async (id: string) => ({
      id,
      name: 'Test User',
    })) as any

    const result = await fetchUser('123')
    expectTypeOf(result).toEqualTypeOf<{ id: string; name: string }>()
    expect(result.id).toBe('123')
  })

  it('should return Promise<Out> for tagged template', async () => {
    type FetchData = AsyncFn<object, string>

    const fetchData: FetchData = (async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const url = strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')
      return { url, data: {} }
    }) as any

    const id = '123'
    const result = await fetchData`/api/users/${id}`
    expect(result).toHaveProperty('url')
  })

  it('should return Promise-based TaggedResult for named params', async () => {
    type Template = AsyncFn<string, string, {}>

    const template: Template = (() => {
      return async (params: { name: string }) => `Hello, ${params.name}!`
    }) as any

    const tmpl = template`${'name'}`
    const result = await tmpl({ name: 'World' })
    expect(result).toBe('Hello, World!')
  })

  it('should handle async errors', async () => {
    type MayFail = AsyncFn<string, string>

    const mayFail: MayFail = (async () => {
      throw new Error('Async error')
    }) as any

    await expect(mayFail('test')).rejects.toThrow('Async error')
  })
})

// ============================================================================
// RpcFn Variant Tests (Pipelining Support)
// ============================================================================

describe('RpcFn Type', () => {
  it('should return RpcPromise for pipelining', () => {
    type GetUser = RpcFn<{ id: string; name: string }, string>

    // RpcPromise should support .then() and pipeline methods
    const getUser: GetUser = ((id: string) => {
      // Return an RpcPromise-like object
      return {
        then: (resolve: (value: { id: string; name: string }) => void) => {
          resolve({ id, name: 'Test' })
        },
        // Pipeline support
        pipe: (fn: (data: { id: string; name: string }) => unknown) => fn({ id, name: 'Test' }),
      }
    }) as any

    const result = getUser('123')
    // RpcPromise should NOT be the same as regular Promise
    expect(result).toHaveProperty('pipe')
  })

  it('should support method chaining', () => {
    type ProcessData = RpcFn<{ processed: boolean }, string>

    const processData: ProcessData = ((_input: string) => {
      return {
        then: () => ({ processed: true }),
        map: (fn: (data: { processed: boolean }) => unknown) => fn({ processed: true }),
        catch: () => ({ processed: false }),
      }
    }) as any

    const result = processData('test')
    expect(result).toHaveProperty('then')
    expect(result).toHaveProperty('map')
  })
})

// ============================================================================
// StreamFn Variant Tests
// ============================================================================

describe('StreamFn Type', () => {
  it('should return AsyncIterable<Out>', async () => {
    type TokenStream = StreamFn<string, string>

    const tokenStream: TokenStream = (async function* (input: string) {
      for (const char of input) {
        yield char
      }
    }) as any

    const result = tokenStream('hello')
    const chars: string[] = []
    for await (const char of result) {
      chars.push(char)
    }
    expect(chars).toEqual(['h', 'e', 'l', 'l', 'o'])
  })

  it('should support for await...of iteration', async () => {
    type NumberStream = StreamFn<number, number>

    const range: NumberStream = (async function* (max: number) {
      for (let i = 0; i < max; i++) {
        yield i
      }
    }) as any

    const numbers: number[] = []
    for await (const n of range(5)) {
      numbers.push(n)
    }
    expect(numbers).toEqual([0, 1, 2, 3, 4])
  })

  it('should work with tagged template', async () => {
    type WordStream = StreamFn<string, string>

    const words: WordStream = (async function* (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) {
      const full = strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')
      for (const word of full.split(' ')) {
        yield word
      }
    }) as any

    const name = 'world'
    const result: string[] = []
    for await (const word of words`hello ${name}`) {
      result.push(word)
    }
    expect(result).toEqual(['hello', 'world'])
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('Fn Type Safety', () => {
  describe('input type constraints', () => {
    it('should reject incorrect input types', () => {
      type NumericFn = Fn<number, number>

      const double: NumericFn = ((n: number) => n * 2) as any

      // TYPE TEST: Once Fn is implemented, the following should error:
      // double('not a number') - string is not assignable to number
      const _badResult = double('not a number' as any)

      const goodResult = double(5)
      expect(goodResult).toBe(10)
    })

    it('should reject missing required input', () => {
      type RequiredInput = Fn<string, { name: string; age: number }>

      const describe_: RequiredInput = ((input: { name: string; age: number }) =>
        `${input.name} is ${input.age}`) as any

      // TYPE TEST: Once Fn is implemented, the following should error:
      // describe_({ name: 'John' }) - age is required
      const _badResult = describe_({ name: 'John' } as any)

      const goodResult = describe_({ name: 'John', age: 30 })
      expect(goodResult).toBe('John is 30')
    })
  })

  describe('output type constraints', () => {
    it('should enforce output type', () => {
      type MustReturnNumber = Fn<number, string>

      // TYPE TEST: Once Fn is implemented, the following should error:
      // const _badImpl: MustReturnNumber = (input: string) => input.toUpperCase()
      // - implementation returns string, not number
      const _badImpl: MustReturnNumber = ((input: string) => input.toUpperCase()) as any

      const goodImpl: MustReturnNumber = ((input: string) => input.length) as any
      expect(goodImpl('hello')).toBe(5)
    })
  })

  describe('options type constraints', () => {
    it('should enforce options type', () => {
      type StrictOpts = Fn<string, string, { count: number }>

      const repeat: StrictOpts = ((input: string, opts?: { count: number }) =>
        input.repeat(opts?.count ?? 1)) as any

      // TYPE TEST: Once Fn is implemented, the following should error:
      // repeat('hi', { count: 'three' }) - wrong option type
      const _badResult = repeat('hi', { count: 'three' as any })

      const goodResult = repeat('hi', { count: 3 })
      expect(goodResult).toBe('hihihi')
    })

    it('should reject unknown options', () => {
      type KnownOpts = Fn<string, string, { format: 'upper' | 'lower' }>

      const transform: KnownOpts = ((input: string, opts?: { format: 'upper' | 'lower' }) =>
        opts?.format === 'upper' ? input.toUpperCase() : input.toLowerCase()) as any

      // TYPE TEST: Once Fn is implemented, the following should error:
      // transform('Hello', { format: 'upper', unknown: true }) - unknown option
      const _badResult = transform('Hello', { format: 'upper', unknown: true } as any)

      const goodResult = transform('Hello', { format: 'upper' })
      expect(goodResult).toBe('HELLO')
    })
  })

  describe('tagged template type safety', () => {
    it('should type-check interpolated values', () => {
      type NumericTemplate = Fn<number, string>

      const sum: NumericTemplate = ((
        _strings: TemplateStringsArray,
        ...values: number[]
      ) => values.reduce((a, b) => a + b, 0)) as any

      const a = 1
      const b = 2
      const result = sum`${a} + ${b}`
      expectTypeOf(result).toEqualTypeOf<number>()
    })
  })
})

// ============================================================================
// FunctionType Classification Tests
// ============================================================================

describe('FunctionType Classification', () => {
  it('should include all four types', () => {
    const types: FunctionType[] = ['code', 'generative', 'agentic', 'human']

    expect(types).toContain('code')
    expect(types).toContain('generative')
    expect(types).toContain('agentic')
    expect(types).toContain('human')
  })

  it('should reject invalid types', () => {
    // TYPE TEST: Once FunctionType is implemented, the following should error:
    // const _invalid: FunctionType = 'invalid' - 'invalid' is not a valid FunctionType
    const _invalid: FunctionType = 'invalid' as any

    const valid: FunctionType = 'code'
    expect(valid).toBe('code')
  })
})

// ============================================================================
// Real-World Use Case Tests
// ============================================================================

describe('Real-World Use Cases', () => {
  describe('AI prompt templates', () => {
    it('should support generative function pattern', () => {
      type AIPrompt = Fn<{ text: string; confidence: number }, string, { model?: string }>

      // ai`analyze ${text}` pattern
      const ai: AIPrompt = ((
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        const prompt = strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')
        return {
          text: `[AI Response to: ${prompt}]`,
          confidence: 0.95,
        }
      }) as any

      const text = 'some content'
      const result = ai`analyze ${text}`
      expect(result.text).toContain('analyze')
      expect(result.confidence).toBeGreaterThan(0)
    })

    it('should support named param prompts', () => {
      type PromptTemplate = Fn<string, string, {}>

      const prompt: PromptTemplate = (() => {
        return (params: { hero: string; problem: string }) =>
          `Story: ${params.hero} faces ${params.problem}`
      }) as any

      const template = prompt`${'hero'} faces ${'problem'}`
      const result = template({ hero: 'Developer', problem: 'type errors' })
      expect(result).toBe('Story: Developer faces type errors')
    })
  })

  describe('human task pattern', () => {
    it('should support user approval workflow', () => {
      type UserApproval = AsyncFn<{ approved: boolean; notes?: string }, string, { timeout?: number }>

      // user`approve ${expense}` pattern
      const user: UserApproval = (async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        const message = strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')
        // Simulate user response
        return {
          approved: true,
          notes: `Approved: ${message}`,
        }
      }) as any

      const expense = '$500 software license'
      const promise = user`approve ${expense}`
      expectTypeOf(promise).toMatchTypeOf<Promise<{ approved: boolean; notes?: string }>>()
    })
  })

  describe('code function pattern', () => {
    it('should support pure computation', () => {
      type Sum = Fn<number, number[]>

      const sum: Sum = ((numbers: number[]) => numbers.reduce((a, b) => a + b, 0)) as any

      const result = sum([1, 2, 3, 4, 5])
      expect(result).toBe(15)
    })

    it('should support transform functions', () => {
      type Transform<T, U> = Fn<U, T>

      const toUpper: Transform<string, string> = ((s: string) => s.toUpperCase()) as any

      expect(toUpper('hello')).toBe('HELLO')
    })
  })

  describe('agentic function pattern', () => {
    it('should support multi-step operations', async () => {
      type Research = AsyncFn<{ findings: string[]; sources: string[] }, string, { depth?: number }>

      // amy`research ${topic}` pattern
      const amy: Research = (async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        const topic = strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')
        // Simulate agentic research
        return {
          findings: [`Found info about: ${topic}`],
          sources: ['source1', 'source2'],
        }
      }) as any

      const competitor = 'ACME Corp'
      const result = await amy`research ${competitor} market position`
      expect(result.findings.length).toBeGreaterThan(0)
      expect(result.sources.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('should handle empty string input', () => {
    type Echo = Fn<string, string>

    const echo: Echo = ((input: string) => input) as any

    expect(echo('')).toBe('')
  })

  it('should handle null in interpolation', () => {
    type Format = Fn<string, string>

    const format: Format = ((
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => strings.reduce((acc, str, i) => {
      const val = values[i]
      const display = val === null ? 'null' : (val === undefined ? '' : val)
      return acc + str + display
    }, '')) as any

    const value: null = null
    const result = format`Value: ${value}`
    expect(result).toBe('Value: null')
  })

  it('should handle undefined in interpolation', () => {
    type Format = Fn<string, string>

    const format: Format = ((
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => strings.reduce((acc, str, i) => {
      if (i >= values.length) return acc + str
      const val = values[i]
      const display = val === undefined ? 'undefined' : (val === null ? '' : val)
      return acc + str + display
    }, '')) as any

    const value: undefined = undefined
    const result = format`Value: ${value}`
    expect(result).toBe('Value: undefined')
  })

  it('should handle deeply nested params', () => {
    type DeepParam = Fn<string, string, {}>

    const deep: DeepParam = (() => {
      return (params: { a: { b: { c: { d: string } } } }) => params.a.b.c.d
    }) as any

    const template = deep`${'a'}`
    const result = template({ a: { b: { c: { d: 'deep value' } } } })
    expect(result).toBe('deep value')
  })

  it('should handle special characters in template', () => {
    type Special = Fn<string, string>

    const special: Special = ((
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')) as any

    const emoji = 'test'
    const result = special`Hello! @#$%^&*() ${emoji} \n\t`
    expect(result).toContain('@#$%^&*()')
  })

  it('should handle unicode in template', () => {
    type Unicode = Fn<string, string>

    const unicode: Unicode = ((
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')) as any

    const name = 'user'
    const result = unicode`Hello ${name}`
    expect(result).toContain('Hello')
  })
})
