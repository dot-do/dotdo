/**
 * RED Phase Tests: Function Registry
 * Issue: dotdo-71ziz
 *
 * These tests define the expected API for a function registry system
 * that replaces the 40+ case statements in callFunction() and 15+ in callStringMethod().
 *
 * The registry pattern follows Open-Closed Principle:
 * - Open for extension (register new functions without modifying interpreter)
 * - Closed for modification (no need to touch switch statements)
 *
 * These tests should FAIL until the implementation is complete.
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import types that DON'T EXIST YET - will be created in GREEN phase
import type {
  FunctionRegistry,
  FunctionDefinition,
  MethodDefinition,
  FunctionMetadata,
  RegisteredFunction,
  TypedMethodRegistry,
} from '../registry'

import {
  createRegistry,
  getGlobalRegistry,
  registerGlobalFunction,
  registerMethod,
  resetRegistry,
} from '../registry'

import { Interpreter, evaluate } from '../interpreter'
import { BenthosMessage, createMessage } from '../../core/message'
import type { ASTNode, IdentifierNode, CallNode, MemberAccessNode, LiteralNode } from '../ast'

/**
 * Helper to build AST nodes for testing registered functions
 */
namespace ASTBuilder {
  export function literal(value: string | number | boolean | null): LiteralNode {
    let kind: 'string' | 'number' | 'boolean' | 'null'
    if (value === null) kind = 'null'
    else if (typeof value === 'string') kind = 'string'
    else if (typeof value === 'number') kind = 'number'
    else kind = 'boolean'
    return { type: 'Literal', kind, value, line: 1, column: 1 }
  }

  export function identifier(name: string): IdentifierNode {
    return { type: 'Identifier', name, line: 1, column: 1 }
  }

  export function call(func: ASTNode, args: ASTNode[] = []): CallNode {
    return { type: 'Call', function: func, arguments: args, line: 1, column: 1 }
  }

  export function memberAccess(object: ASTNode, property: string): MemberAccessNode {
    return { type: 'MemberAccess', object, property, accessType: 'dot', line: 1, column: 1 }
  }
}

describe('Function Registry', () => {
  let registry: FunctionRegistry
  let msg: BenthosMessage

  beforeEach(() => {
    // Create fresh registry for each test
    registry = createRegistry()
    msg = createMessage({ name: 'Alice', age: 30 })
    // Reset global registry to ensure clean state
    resetRegistry()
  })

  describe('Registry Creation', () => {
    it('creates an empty registry', () => {
      const reg = createRegistry()
      expect(reg).toBeDefined()
      expect(reg.listFunctions()).toEqual([])
    })

    it('creates registry with default stdlib functions', () => {
      const reg = createRegistry({ includeStdlib: true })
      const functions = reg.listFunctions()

      // Should include common stdlib functions
      expect(functions).toContain('uppercase')
      expect(functions).toContain('lowercase')
      expect(functions).toContain('length')
      expect(functions).toContain('abs')
      expect(functions).toContain('keys')
    })

    it('provides a global singleton registry', () => {
      const global1 = getGlobalRegistry()
      const global2 = getGlobalRegistry()
      expect(global1).toBe(global2)
    })
  })

  describe('Registering Global Functions', () => {
    it('registers a simple function with no arguments', () => {
      registry.register({
        name: 'timestamp',
        fn: () => Date.now(),
        arity: 0,
        description: 'Returns current timestamp in milliseconds',
      })

      expect(registry.has('timestamp')).toBe(true)
      expect(registry.listFunctions()).toContain('timestamp')
    })

    it('registers a function with single argument', () => {
      registry.register({
        name: 'double',
        fn: (x: number) => x * 2,
        arity: 1,
        description: 'Doubles a number',
        argTypes: ['number'],
        returnType: 'number',
      })

      const fn = registry.get('double')
      expect(fn).toBeDefined()
      expect(fn?.call(null, 5)).toBe(10)
    })

    it('registers a function with multiple arguments', () => {
      registry.register({
        name: 'clamp',
        fn: (value: number, min: number, max: number) => Math.min(Math.max(value, min), max),
        arity: 3,
        description: 'Clamps a value between min and max',
        argTypes: ['number', 'number', 'number'],
        returnType: 'number',
      })

      const fn = registry.get('clamp')
      expect(fn?.call(null, 15, 0, 10)).toBe(10)
      expect(fn?.call(null, -5, 0, 10)).toBe(0)
      expect(fn?.call(null, 5, 0, 10)).toBe(5)
    })

    it('registers a variadic function', () => {
      registry.register({
        name: 'concat_all',
        fn: (...args: string[]) => args.join(''),
        arity: -1, // -1 indicates variadic
        description: 'Concatenates all string arguments',
        variadic: true,
      })

      const fn = registry.get('concat_all')
      expect(fn?.call(null, 'a', 'b', 'c')).toBe('abc')
      expect(fn?.call(null, 'hello', ' ', 'world')).toBe('hello world')
    })

    it('registers using convenience function', () => {
      registerGlobalFunction('greet', (name: string) => `Hello, ${name}!`, {
        arity: 1,
        description: 'Greets someone by name',
      })

      const global = getGlobalRegistry()
      expect(global.has('greet')).toBe(true)
    })

    it('throws when registering duplicate function name', () => {
      registry.register({
        name: 'myFunc',
        fn: () => 1,
        arity: 0,
      })

      expect(() => {
        registry.register({
          name: 'myFunc',
          fn: () => 2,
          arity: 0,
        })
      }).toThrow(/already registered|duplicate/i)
    })

    it('allows overwriting with explicit flag', () => {
      registry.register({
        name: 'myFunc',
        fn: () => 1,
        arity: 0,
      })

      registry.register({
        name: 'myFunc',
        fn: () => 2,
        arity: 0,
        overwrite: true,
      })

      const fn = registry.get('myFunc')
      expect(fn?.call(null)).toBe(2)
    })
  })

  describe('Registering Type Methods', () => {
    it('registers a string method', () => {
      registry.registerMethod('string', {
        name: 'reverse',
        fn: (str: string) => str.split('').reverse().join(''),
        arity: 0,
        description: 'Reverses a string',
      })

      expect(registry.hasMethod('string', 'reverse')).toBe(true)
    })

    it('registers a string method with arguments', () => {
      registry.registerMethod('string', {
        name: 'pad_left',
        fn: (str: string, length: number, char: string = ' ') => str.padStart(length, char),
        arity: 2,
        description: 'Pads string on the left',
        argTypes: ['number', 'string?'],
      })

      const method = registry.getMethod('string', 'pad_left')
      expect(method?.call('42', 5, '0')).toBe('00042')
    })

    it('registers an array method', () => {
      registry.registerMethod('array', {
        name: 'chunk',
        fn: (arr: unknown[], size: number) => {
          const chunks: unknown[][] = []
          for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size))
          }
          return chunks
        },
        arity: 1,
        description: 'Splits array into chunks of given size',
      })

      const method = registry.getMethod('array', 'chunk')
      expect(method?.call([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    })

    it('registers an object method', () => {
      registry.registerMethod('object', {
        name: 'pick',
        fn: (obj: Record<string, unknown>, ...keys: string[]) => {
          const result: Record<string, unknown> = {}
          for (const key of keys) {
            if (key in obj) result[key] = obj[key]
          }
          return result
        },
        arity: -1,
        variadic: true,
        description: 'Picks specific keys from object',
      })

      const method = registry.getMethod('object', 'pick')
      expect(method?.call({ a: 1, b: 2, c: 3 }, 'a', 'c')).toEqual({ a: 1, c: 3 })
    })

    it('registers a number method', () => {
      registry.registerMethod('number', {
        name: 'to_fixed',
        fn: (num: number, digits: number) => num.toFixed(digits),
        arity: 1,
        description: 'Formats number with fixed decimal places',
        returnType: 'string',
      })

      const method = registry.getMethod('number', 'to_fixed')
      expect(method?.call(3.14159, 2)).toBe('3.14')
    })

    it('registers using convenience function', () => {
      registerMethod('string', 'shout', (str: string) => str.toUpperCase() + '!', {
        arity: 0,
        description: 'Converts to uppercase and adds exclamation',
      })

      const global = getGlobalRegistry()
      expect(global.hasMethod('string', 'shout')).toBe(true)
    })

    it('lists methods for a type', () => {
      registry.registerMethod('string', {
        name: 'method1',
        fn: (s: string) => s,
        arity: 0,
      })
      registry.registerMethod('string', {
        name: 'method2',
        fn: (s: string) => s,
        arity: 0,
      })

      const methods = registry.listMethods('string')
      expect(methods).toContain('method1')
      expect(methods).toContain('method2')
    })
  })

  describe('Calling Registered Functions via Interpreter', () => {
    it('calls registered global function through interpreter', () => {
      registerGlobalFunction('square', (x: number) => x * x, { arity: 1 })

      const ast = ASTBuilder.call(
        ASTBuilder.identifier('square'),
        [ASTBuilder.literal(5)]
      )

      const result = evaluate(ast, msg)
      expect(result).toBe(25)
    })

    it('calls registered method on string through interpreter', () => {
      registerMethod('string', 'reverse', (str: string) => str.split('').reverse().join(''), {
        arity: 0,
      })

      const ast = ASTBuilder.call(
        ASTBuilder.memberAccess(ASTBuilder.literal('hello'), 'reverse'),
        []
      )

      const result = evaluate(ast, msg)
      expect(result).toBe('olleh')
    })

    it('calls registered method on array through interpreter', () => {
      registerMethod('array', 'second', (arr: unknown[]) => arr[1], {
        arity: 0,
        description: 'Returns the second element',
      })

      const ast = ASTBuilder.call(
        ASTBuilder.memberAccess(
          { type: 'Array', elements: [ASTBuilder.literal(1), ASTBuilder.literal(2), ASTBuilder.literal(3)], line: 1, column: 1 },
          'second'
        ),
        []
      )

      const result = evaluate(ast, msg)
      expect(result).toBe(2)
    })

    it('passes arguments to registered method', () => {
      registerMethod('string', 'repeat_n', (str: string, n: number) => str.repeat(n), {
        arity: 1,
      })

      const ast = ASTBuilder.call(
        ASTBuilder.memberAccess(ASTBuilder.literal('ab'), 'repeat_n'),
        [ASTBuilder.literal(3)]
      )

      const result = evaluate(ast, msg)
      expect(result).toBe('ababab')
    })

    it('registered function overrides built-in function', () => {
      // Override the built-in 'length' function
      registerGlobalFunction('length', () => 999, {
        arity: 1,
        overwrite: true,
      })

      const ast = ASTBuilder.call(
        ASTBuilder.identifier('length'),
        [ASTBuilder.literal('hello')]
      )

      const result = evaluate(ast, msg)
      expect(result).toBe(999)
    })
  })

  describe('Error Handling for Unknown Functions', () => {
    it('throws descriptive error for unknown global function', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.identifier('nonexistent_function'),
        []
      )

      expect(() => evaluate(ast, msg)).toThrow(/unknown function.*nonexistent_function/i)
    })

    it('throws descriptive error for unknown method on string', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.memberAccess(ASTBuilder.literal('hello'), 'nonexistent_method'),
        []
      )

      expect(() => evaluate(ast, msg)).toThrow(/unknown.*method.*nonexistent_method.*string/i)
    })

    it('throws descriptive error for unknown method on array', () => {
      const ast = ASTBuilder.call(
        ASTBuilder.memberAccess(
          { type: 'Array', elements: [], line: 1, column: 1 },
          'nonexistent_method'
        ),
        []
      )

      expect(() => evaluate(ast, msg)).toThrow(/unknown.*method.*nonexistent_method.*array/i)
    })

    it('suggests similar function names in error message', () => {
      // Use overwrite since global registry includes stdlib with uppercase already registered
      registerGlobalFunction('uppercase', (s: string) => s.toUpperCase(), { arity: 1, overwrite: true })

      const ast = ASTBuilder.call(
        ASTBuilder.identifier('uppercas'), // Typo
        [ASTBuilder.literal('hello')]
      )

      expect(() => evaluate(ast, msg)).toThrow(/did you mean.*uppercase/i)
    })

    it('returns undefined from registry.get for unknown function', () => {
      const fn = registry.get('nonexistent')
      expect(fn).toBeUndefined()
    })

    it('returns false from registry.has for unknown function', () => {
      expect(registry.has('nonexistent')).toBe(false)
    })
  })

  describe('Function Metadata', () => {
    it('stores and retrieves function description', () => {
      registry.register({
        name: 'documented_fn',
        fn: () => 42,
        arity: 0,
        description: 'A well-documented function that returns 42',
      })

      const metadata = registry.getMetadata('documented_fn')
      expect(metadata?.description).toBe('A well-documented function that returns 42')
    })

    it('stores and retrieves arity information', () => {
      registry.register({
        name: 'ternary_fn',
        fn: (a: number, b: number, c: number) => a + b + c,
        arity: 3,
      })

      const metadata = registry.getMetadata('ternary_fn')
      expect(metadata?.arity).toBe(3)
    })

    it('stores argument type information', () => {
      registry.register({
        name: 'typed_fn',
        fn: (s: string, n: number) => s.repeat(n),
        arity: 2,
        argTypes: ['string', 'number'],
        returnType: 'string',
      })

      const metadata = registry.getMetadata('typed_fn')
      expect(metadata?.argTypes).toEqual(['string', 'number'])
      expect(metadata?.returnType).toBe('string')
    })

    it('stores variadic flag', () => {
      registry.register({
        name: 'variadic_fn',
        fn: (...args: number[]) => args.reduce((a, b) => a + b, 0),
        arity: -1,
        variadic: true,
      })

      const metadata = registry.getMetadata('variadic_fn')
      expect(metadata?.variadic).toBe(true)
    })

    it('stores method metadata', () => {
      registry.registerMethod('string', {
        name: 'documented_method',
        fn: (s: string) => s,
        arity: 0,
        description: 'A documented string method',
        argTypes: [],
        returnType: 'string',
      })

      const metadata = registry.getMethodMetadata('string', 'documented_method')
      expect(metadata?.description).toBe('A documented string method')
      expect(metadata?.returnType).toBe('string')
    })

    it('returns undefined metadata for unknown function', () => {
      const metadata = registry.getMetadata('nonexistent')
      expect(metadata).toBeUndefined()
    })

    it('stores category/tags for functions', () => {
      registry.register({
        name: 'categorized_fn',
        fn: () => 1,
        arity: 0,
        category: 'math',
        tags: ['arithmetic', 'utility'],
      })

      const metadata = registry.getMetadata('categorized_fn')
      expect(metadata?.category).toBe('math')
      expect(metadata?.tags).toContain('arithmetic')
      expect(metadata?.tags).toContain('utility')
    })
  })

  describe('Overwriting Existing Functions', () => {
    it('prevents overwriting without explicit flag', () => {
      registry.register({
        name: 'protected_fn',
        fn: () => 'original',
        arity: 0,
      })

      expect(() => {
        registry.register({
          name: 'protected_fn',
          fn: () => 'replacement',
          arity: 0,
        })
      }).toThrow(/already registered/i)
    })

    it('allows overwriting with overwrite: true', () => {
      registry.register({
        name: 'replaceable_fn',
        fn: () => 'original',
        arity: 0,
      })

      registry.register({
        name: 'replaceable_fn',
        fn: () => 'replacement',
        arity: 0,
        overwrite: true,
      })

      const fn = registry.get('replaceable_fn')
      expect(fn?.call(null)).toBe('replacement')
    })

    it('allows overwriting methods with overwrite: true', () => {
      registry.registerMethod('string', {
        name: 'replaceable_method',
        fn: () => 'original',
        arity: 0,
      })

      registry.registerMethod('string', {
        name: 'replaceable_method',
        fn: () => 'replacement',
        arity: 0,
        overwrite: true,
      })

      const method = registry.getMethod('string', 'replaceable_method')
      expect(method?.call('test')).toBe('replacement')
    })

    it('updates metadata when overwriting', () => {
      registry.register({
        name: 'evolving_fn',
        fn: () => 1,
        arity: 0,
        description: 'Original description',
      })

      registry.register({
        name: 'evolving_fn',
        fn: () => 2,
        arity: 0,
        description: 'Updated description',
        overwrite: true,
      })

      const metadata = registry.getMetadata('evolving_fn')
      expect(metadata?.description).toBe('Updated description')
    })
  })

  describe('Listing All Registered Functions', () => {
    it('lists all global functions', () => {
      registry.register({ name: 'fn1', fn: () => 1, arity: 0 })
      registry.register({ name: 'fn2', fn: () => 2, arity: 0 })
      registry.register({ name: 'fn3', fn: () => 3, arity: 0 })

      const functions = registry.listFunctions()
      expect(functions).toHaveLength(3)
      expect(functions).toContain('fn1')
      expect(functions).toContain('fn2')
      expect(functions).toContain('fn3')
    })

    it('lists functions alphabetically', () => {
      registry.register({ name: 'zebra', fn: () => 1, arity: 0 })
      registry.register({ name: 'apple', fn: () => 1, arity: 0 })
      registry.register({ name: 'mango', fn: () => 1, arity: 0 })

      const functions = registry.listFunctions()
      expect(functions).toEqual(['apple', 'mango', 'zebra'])
    })

    it('lists all methods for a specific type', () => {
      registry.registerMethod('string', { name: 'method_a', fn: (s: string) => s, arity: 0 })
      registry.registerMethod('string', { name: 'method_b', fn: (s: string) => s, arity: 0 })
      registry.registerMethod('array', { name: 'method_c', fn: (a: unknown[]) => a, arity: 0 })

      const stringMethods = registry.listMethods('string')
      expect(stringMethods).toHaveLength(2)
      expect(stringMethods).toContain('method_a')
      expect(stringMethods).toContain('method_b')
      expect(stringMethods).not.toContain('method_c')
    })

    it('lists all supported types', () => {
      registry.registerMethod('string', { name: 'm1', fn: (s: string) => s, arity: 0 })
      registry.registerMethod('array', { name: 'm2', fn: (a: unknown[]) => a, arity: 0 })
      registry.registerMethod('number', { name: 'm3', fn: (n: number) => n, arity: 0 })

      const types = registry.listTypes()
      expect(types).toContain('string')
      expect(types).toContain('array')
      expect(types).toContain('number')
    })

    it('provides function count', () => {
      registry.register({ name: 'fn1', fn: () => 1, arity: 0 })
      registry.register({ name: 'fn2', fn: () => 2, arity: 0 })

      expect(registry.functionCount()).toBe(2)
    })

    it('provides method count per type', () => {
      registry.registerMethod('string', { name: 'm1', fn: (s: string) => s, arity: 0 })
      registry.registerMethod('string', { name: 'm2', fn: (s: string) => s, arity: 0 })
      registry.registerMethod('array', { name: 'm3', fn: (a: unknown[]) => a, arity: 0 })

      expect(registry.methodCount('string')).toBe(2)
      expect(registry.methodCount('array')).toBe(1)
    })
  })

  describe('Unregistering Functions', () => {
    it('unregisters a global function', () => {
      registry.register({ name: 'temp_fn', fn: () => 1, arity: 0 })
      expect(registry.has('temp_fn')).toBe(true)

      registry.unregister('temp_fn')
      expect(registry.has('temp_fn')).toBe(false)
    })

    it('unregisters a method', () => {
      registry.registerMethod('string', { name: 'temp_method', fn: (s: string) => s, arity: 0 })
      expect(registry.hasMethod('string', 'temp_method')).toBe(true)

      registry.unregisterMethod('string', 'temp_method')
      expect(registry.hasMethod('string', 'temp_method')).toBe(false)
    })

    it('silently ignores unregistering non-existent function', () => {
      expect(() => registry.unregister('nonexistent')).not.toThrow()
    })

    it('clears all functions', () => {
      registry.register({ name: 'fn1', fn: () => 1, arity: 0 })
      registry.register({ name: 'fn2', fn: () => 2, arity: 0 })
      registry.registerMethod('string', { name: 'm1', fn: (s: string) => s, arity: 0 })

      registry.clear()

      expect(registry.listFunctions()).toHaveLength(0)
      expect(registry.listMethods('string')).toHaveLength(0)
    })
  })

  describe('Namespace Support', () => {
    it('registers functions in a namespace', () => {
      registry.register({
        name: 'math.sin',
        fn: Math.sin,
        arity: 1,
        namespace: 'math',
      })

      expect(registry.has('math.sin')).toBe(true)
    })

    it('lists functions by namespace', () => {
      registry.register({ name: 'math.sin', fn: Math.sin, arity: 1, namespace: 'math' })
      registry.register({ name: 'math.cos', fn: Math.cos, arity: 1, namespace: 'math' })
      registry.register({ name: 'string.trim', fn: (s: string) => s.trim(), arity: 0, namespace: 'string' })

      const mathFunctions = registry.listFunctions({ namespace: 'math' })
      expect(mathFunctions).toHaveLength(2)
      expect(mathFunctions).toContain('math.sin')
      expect(mathFunctions).toContain('math.cos')
    })

    it('lists all namespaces', () => {
      registry.register({ name: 'math.sin', fn: Math.sin, arity: 1, namespace: 'math' })
      registry.register({ name: 'json.parse', fn: JSON.parse, arity: 1, namespace: 'json' })

      const namespaces = registry.listNamespaces()
      expect(namespaces).toContain('math')
      expect(namespaces).toContain('json')
    })
  })

  describe('Type Validation', () => {
    it('validates argument types when specified', () => {
      registry.register({
        name: 'typed_add',
        fn: (a: number, b: number) => a + b,
        arity: 2,
        argTypes: ['number', 'number'],
        validateArgs: true,
      })

      const fn = registry.get('typed_add')

      // Valid call
      expect(fn?.call(null, 1, 2)).toBe(3)

      // Invalid call - should throw type error
      expect(() => fn?.call(null, 'a', 'b')).toThrow(/type.*number/i)
    })

    it('validates return type when specified', () => {
      registry.register({
        name: 'returns_string',
        fn: (x: unknown) => x, // Returns whatever is passed
        arity: 1,
        returnType: 'string',
        validateReturn: true,
      })

      const fn = registry.get('returns_string')

      // Valid - returns string
      expect(fn?.call(null, 'hello')).toBe('hello')

      // Invalid - returns number, should throw
      expect(() => fn?.call(null, 42)).toThrow(/return type.*string/i)
    })

    it('handles optional arguments', () => {
      registry.register({
        name: 'greet_optional',
        fn: (name: string, greeting: string = 'Hello') => `${greeting}, ${name}!`,
        arity: 2,
        argTypes: ['string', 'string?'], // ? indicates optional
        minArity: 1,
      })

      const fn = registry.get('greet_optional')
      expect(fn?.call(null, 'World')).toBe('Hello, World!')
      expect(fn?.call(null, 'World', 'Hi')).toBe('Hi, World!')
    })
  })

  describe('Function Aliases', () => {
    it('creates alias for existing function', () => {
      registry.register({
        name: 'uppercase',
        fn: (s: string) => s.toUpperCase(),
        arity: 1,
      })

      registry.alias('uppercase', 'upper')

      expect(registry.has('upper')).toBe(true)
      const fn = registry.get('upper')
      expect(fn?.call(null, 'hello')).toBe('HELLO')
    })

    it('alias shares same function reference', () => {
      registry.register({
        name: 'original',
        fn: () => 42,
        arity: 0,
      })

      registry.alias('original', 'aliased')

      const original = registry.get('original')
      const aliased = registry.get('aliased')
      expect(original).toBe(aliased)
    })

    it('throws when aliasing non-existent function', () => {
      expect(() => registry.alias('nonexistent', 'alias')).toThrow(/not found/i)
    })

    it('creates method alias', () => {
      registry.registerMethod('string', {
        name: 'uppercase',
        fn: (s: string) => s.toUpperCase(),
        arity: 0,
      })

      registry.aliasMethod('string', 'uppercase', 'upper')

      expect(registry.hasMethod('string', 'upper')).toBe(true)
    })
  })

  describe('Batch Registration', () => {
    it('registers multiple functions at once', () => {
      registry.registerBatch([
        { name: 'fn1', fn: () => 1, arity: 0 },
        { name: 'fn2', fn: () => 2, arity: 0 },
        { name: 'fn3', fn: () => 3, arity: 0 },
      ])

      expect(registry.has('fn1')).toBe(true)
      expect(registry.has('fn2')).toBe(true)
      expect(registry.has('fn3')).toBe(true)
    })

    it('registers multiple methods for a type at once', () => {
      registry.registerMethodBatch('string', [
        { name: 'm1', fn: (s: string) => s, arity: 0 },
        { name: 'm2', fn: (s: string) => s, arity: 0 },
      ])

      expect(registry.hasMethod('string', 'm1')).toBe(true)
      expect(registry.hasMethod('string', 'm2')).toBe(true)
    })

    it('rolls back if any registration fails', () => {
      registry.register({ name: 'existing', fn: () => 1, arity: 0 })

      expect(() => {
        registry.registerBatch([
          { name: 'new1', fn: () => 1, arity: 0 },
          { name: 'existing', fn: () => 2, arity: 0 }, // Should fail
          { name: 'new2', fn: () => 3, arity: 0 },
        ])
      }).toThrow()

      // new1 should not exist due to rollback
      expect(registry.has('new1')).toBe(false)
    })
  })

  describe('Integration with Existing Stdlib', () => {
    it('stdlib string functions available via registry', () => {
      const reg = createRegistry({ includeStdlib: true })

      expect(reg.hasMethod('string', 'uppercase')).toBe(true)
      expect(reg.hasMethod('string', 'lowercase')).toBe(true)
      expect(reg.hasMethod('string', 'trim')).toBe(true)
      expect(reg.hasMethod('string', 'split')).toBe(true)
      expect(reg.hasMethod('string', 'replace')).toBe(true)
    })

    it('stdlib array functions available via registry', () => {
      const reg = createRegistry({ includeStdlib: true })

      expect(reg.hasMethod('array', 'map')).toBe(true)
      expect(reg.hasMethod('array', 'filter')).toBe(true)
      expect(reg.hasMethod('array', 'sort')).toBe(true)
      expect(reg.hasMethod('array', 'reverse')).toBe(true)
      expect(reg.hasMethod('array', 'join')).toBe(true)
    })

    it('stdlib number functions available via registry', () => {
      const reg = createRegistry({ includeStdlib: true })

      expect(reg.has('abs')).toBe(true)
      expect(reg.has('ceil')).toBe(true)
      expect(reg.has('floor')).toBe(true)
      expect(reg.has('round')).toBe(true)
    })

    it('stdlib object functions available via registry', () => {
      const reg = createRegistry({ includeStdlib: true })

      expect(reg.has('keys')).toBe(true)
      expect(reg.has('values')).toBe(true)
      expect(reg.has('merge')).toBe(true)
    })

    it('interpreter uses registry instead of switch statements', () => {
      const reg = createRegistry({ includeStdlib: true })

      // Add a custom function
      reg.register({
        name: 'custom_double',
        fn: (x: number) => x * 2,
        arity: 1,
      })

      // Create interpreter with custom registry
      const interpreter = new Interpreter(msg, { registry: reg })

      const ast = ASTBuilder.call(
        ASTBuilder.identifier('custom_double'),
        [ASTBuilder.literal(21)]
      )

      const result = interpreter.evaluate(ast)
      expect(result).toBe(42)
    })
  })

  describe('Edge Cases', () => {
    it('handles function names with special characters', () => {
      registry.register({
        name: '$special_fn',
        fn: () => 'special',
        arity: 0,
      })

      expect(registry.has('$special_fn')).toBe(true)
    })

    it('handles empty function name', () => {
      expect(() => {
        registry.register({
          name: '',
          fn: () => 1,
          arity: 0,
        })
      }).toThrow(/invalid.*name/i)
    })

    it('handles null function', () => {
      expect(() => {
        registry.register({
          name: 'null_fn',
          fn: null as unknown as () => void,
          arity: 0,
        })
      }).toThrow(/invalid.*function/i)
    })

    it('handles async functions', () => {
      registry.register({
        name: 'async_fn',
        fn: async () => 'async result',
        arity: 0,
        async: true,
      })

      const metadata = registry.getMetadata('async_fn')
      expect(metadata?.async).toBe(true)
    })

    it('handles functions that throw', () => {
      registry.register({
        name: 'throwing_fn',
        fn: () => { throw new Error('Intentional error') },
        arity: 0,
      })

      const fn = registry.get('throwing_fn')
      expect(() => fn?.call(null)).toThrow('Intentional error')
    })

    it('preserves this context when calling methods', () => {
      const contextTracker = { lastThis: null as unknown }

      registry.registerMethod('string', {
        name: 'track_context',
        fn: function(this: string) {
          contextTracker.lastThis = this
          return this
        },
        arity: 0,
      })

      const method = registry.getMethod('string', 'track_context')
      method?.call('test_string')

      expect(contextTracker.lastThis).toBe('test_string')
    })
  })

  describe('Performance Considerations', () => {
    it('handles large number of registered functions', () => {
      // Register 1000 functions
      for (let i = 0; i < 1000; i++) {
        registry.register({
          name: `fn_${i}`,
          fn: () => i,
          arity: 0,
        })
      }

      expect(registry.functionCount()).toBe(1000)
      expect(registry.has('fn_500')).toBe(true)

      const fn = registry.get('fn_999')
      expect(fn?.call(null)).toBe(999)
    })

    it('maintains O(1) lookup for functions', () => {
      // Register many functions
      for (let i = 0; i < 10000; i++) {
        registry.register({
          name: `fn_${i}`,
          fn: () => i,
          arity: 0,
        })
      }

      // Lookup should be fast regardless of registry size
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        registry.get(`fn_${i * 10}`)
      }
      const duration = performance.now() - start

      // Should complete in under 50ms for 1000 lookups
      expect(duration).toBeLessThan(50)
    })
  })
})
