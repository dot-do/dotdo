/**
 * Function<Output, Input, Config> Type System
 *
 * A generic function abstraction supporting:
 * - TOutput: The return type (first generic - most important)
 * - TInput: The input parameter type (optional, defaults to undefined)
 * - TConfig: Configuration/options type (optional)
 *
 * This provides a consistent interface for async functions across dotdo.
 *
 * Issue: dotdo-im1tz (GREEN phase - implementation)
 * Depends on: dotdo-ckb4i (RED phase - tests)
 *
 * @module types/Function
 */

// ============================================================================
// FunctionSchema Type
// ============================================================================

/**
 * Schema type for validating function inputs and outputs.
 * Generic over the type it describes for type safety.
 *
 * @template T - The TypeScript type this schema describes
 *
 * @example
 * ```typescript
 * const userSchema: FunctionSchema<User> = {
 *   type: 'object',
 *   properties: {
 *     id: { type: 'string' },
 *     name: { type: 'string' },
 *     email: { type: 'string' }
 *   },
 *   required: ['id', 'name', 'email']
 * }
 * ```
 */
export interface FunctionSchema<T> {
  /** JSON Schema type */
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'object' | 'array'
  /** Properties for object schemas */
  properties?: Record<string, FunctionSchema<unknown>>
  /** Array item schema */
  items?: FunctionSchema<unknown>
  /** Required property names */
  required?: readonly string[]
  /** Enum values */
  enum?: readonly unknown[]
  /** Description */
  description?: string
  /** Default value */
  default?: T
  /** Additional properties */
  additionalProperties?: boolean | FunctionSchema<unknown>
  /** Phantom type marker for T */
  readonly __type?: T
}

// ============================================================================
// FunctionConfig Type
// ============================================================================

/**
 * Base configuration type for function execution.
 * Provides common options like timeout and retry behavior.
 *
 * @example
 * ```typescript
 * const config: FunctionConfig = {
 *   timeout: 30000,
 *   retries: 3
 * }
 * ```
 */
export interface FunctionConfig {
  /** Execution timeout in milliseconds */
  timeout?: number
  /** Number of retry attempts on failure */
  retries?: number
}

// ============================================================================
// Function Type
// ============================================================================

/**
 * Generic async function type with schema-aware input/output.
 *
 * @template TOutput - The return type (required, comes first for emphasis)
 * @template TInput - The input parameter type (optional, defaults to undefined)
 * @template TConfig - Additional configuration options (optional)
 *
 * Key design decisions:
 * - Output comes FIRST because it's what matters most (what does the function produce?)
 * - Input defaults to undefined (optional parameter)
 * - Config is always optional as a second parameter
 * - Always returns Promise<TOutput> (async by default)
 * - Includes optional schema properties for runtime validation
 *
 * @example
 * ```typescript
 * // Simple function returning string
 * type Greeter = Function<string>
 *
 * // Function with input
 * type CreateUser = Function<User, CreateUserInput>
 *
 * // Function with config
 * type ConfiguredFn = Function<Result, Input, { timeout: number }>
 * ```
 */
export interface Function<
  TOutput,
  TInput = undefined,
  TConfig = {},
> {
  /**
   * Call the function with no arguments (when TInput is undefined).
   * Returns Promise<TOutput>.
   */
  (): Promise<TOutput>

  /**
   * Call the function with optional input.
   * When TInput is undefined, input is optional.
   */
  (input?: TInput): Promise<TOutput>

  /**
   * Call the function with input and optional config.
   * When TInput is defined (not undefined), input is required.
   * TConfig is always optional as second argument.
   */
  (input: TInput, config?: TConfig): Promise<TOutput>

  /**
   * Output schema for validation.
   * Required - every function must know its output type.
   */
  outputSchema: FunctionSchema<TOutput>

  /**
   * Input schema for validation.
   * Optional - some functions have no input.
   */
  inputSchema?: FunctionSchema<TInput>
}
