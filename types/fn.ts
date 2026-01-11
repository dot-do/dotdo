/**
 * Fn Type System
 *
 * Implementation-agnostic function abstraction supporting triple calling style:
 * 1. Direct call: fn(input, opts)
 * 2. Tagged template with interpolation: fn`hello ${name}`
 * 3. Tagged template with named params: fn`hello ${'name'}`
 *
 * @module types/fn
 */

// ============================================================================
// Function Type Classification
// ============================================================================

/**
 * The four implementation types for functions.
 * - code: Deterministic TypeScript (fastest, cheapest)
 * - generative: Single AI completion
 * - agentic: AI + tools in a loop
 * - human: Human-in-the-loop (slowest, most expensive)
 */
export type FunctionType = 'code' | 'generative' | 'agentic' | 'human'

// ============================================================================
// Tagged Template Result Types
// ============================================================================

/**
 * Result type for tagged templates with named parameters.
 * When using fn`hello ${'name'}`, returns a function that accepts params.
 *
 * @template Out - The output type
 * @template S - The template string type (for param extraction)
 * @template Opts - Optional configuration
 */
export type TaggedResult<
  Out,
  S extends string,
  Opts extends Record<string, unknown> = {},
> = (params: Record<string, unknown>, opts?: Opts) => Out

// ============================================================================
// RpcPromise Type (for pipelining)
// ============================================================================

/**
 * Promise-like type that supports RPC pipelining operations.
 */
export interface RpcPromise<T> extends Promise<T> {
  pipe<U>(fn: (data: T) => U): RpcPromise<U>
  map<U>(fn: (data: T) => U): RpcPromise<U>
}

// ============================================================================
// Core Fn Type
// ============================================================================

/**
 * Core function type with triple calling style support.
 *
 * @template Out - The output type
 * @template In - The input type (default: unknown)
 * @template Opts - Optional configuration object (default: {})
 *
 * @example
 * ```typescript
 * // Style 1: Direct call
 * const greet: Fn<string, string> = (name) => `Hello, ${name}!`
 * greet('World') // => 'Hello, World!'
 *
 * // Style 2: Tagged template with interpolation
 * const name = 'World'
 * greet`Hello, ${name}!` // => 'Hello, World!'
 *
 * // Style 3: Tagged template with named params
 * greet`Hello, ${'name'}!`({ name: 'World' }) // => 'Hello, World!'
 * ```
 */
export interface Fn<Out, In = unknown, Opts extends Record<string, unknown> = {}> {
  // Style 1: Direct call
  (input: In, opts?: Opts): Out

  // Style 2: Tagged template with interpolation
  (strings: TemplateStringsArray, ...values: unknown[]): Out

  // Style 3: Tagged template with named params - returns a function
  <S extends string>(
    strings: TemplateStringsArray & { raw: readonly S[] },
  ): TaggedResult<Out, S, Opts>
}

// ============================================================================
// AsyncFn Type
// ============================================================================

/**
 * Async function type - returns Promise<Out> for all calling styles.
 *
 * @template Out - The output type (wrapped in Promise)
 * @template In - The input type (default: unknown)
 * @template Opts - Optional configuration object (default: {})
 *
 * @example
 * ```typescript
 * const fetchUser: AsyncFn<User, string> = async (id) => {
 *   return await api.getUser(id)
 * }
 *
 * const user = await fetchUser('123')
 * ```
 */
export interface AsyncFn<
  Out,
  In = unknown,
  Opts extends Record<string, unknown> = {},
> {
  // Style 1: Direct call
  (input: In, opts?: Opts): Promise<Out>

  // Style 2: Tagged template with interpolation
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Out>

  // Style 3: Tagged template with named params - returns async function
  <S extends string>(
    strings: TemplateStringsArray & { raw: readonly S[] },
  ): (params: Record<string, unknown>, opts?: Opts) => Promise<Out>
}

// ============================================================================
// RpcFn Type
// ============================================================================

/**
 * RPC function type - returns RpcPromise<Out> for pipelining support.
 *
 * @template Out - The output type (wrapped in RpcPromise)
 * @template In - The input type (default: unknown)
 * @template Opts - Optional configuration object (default: {})
 *
 * @example
 * ```typescript
 * const getUser: RpcFn<User, string> = (id) => {
 *   return rpc.call('getUser', id)
 * }
 *
 * // Supports pipelining
 * getUser('123').pipe(user => user.name)
 * ```
 */
export interface RpcFn<
  Out,
  In = unknown,
  Opts extends Record<string, unknown> = {},
> {
  // Style 1: Direct call
  (input: In, opts?: Opts): RpcPromise<Out>

  // Style 2: Tagged template with interpolation
  (strings: TemplateStringsArray, ...values: unknown[]): RpcPromise<Out>

  // Style 3: Tagged template with named params - returns RpcPromise function
  <S extends string>(
    strings: TemplateStringsArray & { raw: readonly S[] },
  ): (params: Record<string, unknown>, opts?: Opts) => RpcPromise<Out>
}

// ============================================================================
// StreamFn Type
// ============================================================================

/**
 * Streaming function type - returns AsyncIterable<Out> for streaming results.
 *
 * @template Out - The output type (yielded from AsyncIterable)
 * @template In - The input type (default: unknown)
 * @template Opts - Optional configuration object (default: {})
 *
 * @example
 * ```typescript
 * const tokenStream: StreamFn<string, string> = async function*(prompt) {
 *   for (const token of generateTokens(prompt)) {
 *     yield token
 *   }
 * }
 *
 * for await (const token of tokenStream('Hello')) {
 *   console.log(token)
 * }
 * ```
 */
export interface StreamFn<
  Out,
  In = unknown,
  Opts extends Record<string, unknown> = {},
> {
  // Style 1: Direct call
  (input: In, opts?: Opts): AsyncIterable<Out>

  // Style 2: Tagged template with interpolation
  (strings: TemplateStringsArray, ...values: unknown[]): AsyncIterable<Out>

  // Style 3: Tagged template with named params - returns AsyncIterable function
  <S extends string>(
    strings: TemplateStringsArray & { raw: readonly S[] },
  ): (params: Record<string, unknown>, opts?: Opts) => AsyncIterable<Out>
}
