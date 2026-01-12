/**
 * FunctionComposition
 *
 * Utilities for composing functions together:
 * - pipe: Execute functions sequentially, passing output to next input
 * - parallel: Execute functions concurrently, combine results
 * - conditional: Execute based on condition
 * - retry: Wrap with retry logic
 * - timeout: Wrap with timeout
 * - fallback: Try primary, fall back to alternative on failure
 */

// ============================================================================
// TYPES
// ============================================================================

export type ComposableFunction<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context?: ExecutionContext
) => TOutput | Promise<TOutput>

export interface ExecutionContext {
  signal?: AbortSignal
  metadata?: Record<string, unknown>
  onProgress?: (progress: Progress) => void
}

export interface Progress {
  stage: string
  index: number
  total: number
  result?: unknown
  error?: Error
}

export interface PipelineResult<T = unknown> {
  success: boolean
  result?: T
  error?: Error
  duration: number
  stages: StageResult[]
}

export interface StageResult {
  name: string
  index: number
  success: boolean
  duration: number
  result?: unknown
  error?: Error
}

export interface ParallelResult<T extends unknown[] = unknown[]> {
  success: boolean
  results: T
  errors: Array<Error | undefined>
  duration: number
  completed: number
  failed: number
}

// ============================================================================
// ERRORS
// ============================================================================

export class PipelineError extends Error {
  stageIndex: number
  stageName: string
  cause: Error

  constructor(message: string, stageIndex: number, stageName: string, cause: Error) {
    super(message)
    this.name = 'PipelineError'
    this.stageIndex = stageIndex
    this.stageName = stageName
    this.cause = cause
  }
}

export class ParallelExecutionError extends Error {
  errors: Array<Error | undefined>

  constructor(message: string, errors: Array<Error | undefined>) {
    super(message)
    this.name = 'ParallelExecutionError'
    this.errors = errors
  }
}

export class TimeoutError extends Error {
  constructor(timeout: number) {
    super(`Operation timed out after ${timeout}ms`)
    this.name = 'TimeoutError'
  }
}

export class RetryExhaustedError extends Error {
  attempts: number
  lastError: Error

  constructor(attempts: number, lastError: Error) {
    super(`All ${attempts} retry attempts exhausted. Last error: ${lastError.message}`)
    this.name = 'RetryExhaustedError'
    this.attempts = attempts
    this.lastError = lastError
  }
}

// ============================================================================
// PIPE COMPOSITION
// ============================================================================

export interface PipeOptions {
  name?: string
  stopOnError?: boolean
}

/**
 * Create a pipeline that executes functions sequentially.
 * Each function receives the output of the previous function.
 */
export function pipe<T1, T2>(
  f1: ComposableFunction<T1, T2>,
  options?: PipeOptions
): ComposableFunction<T1, T2>

export function pipe<T1, T2, T3>(
  f1: ComposableFunction<T1, T2>,
  f2: ComposableFunction<T2, T3>,
  options?: PipeOptions
): ComposableFunction<T1, T3>

export function pipe<T1, T2, T3, T4>(
  f1: ComposableFunction<T1, T2>,
  f2: ComposableFunction<T2, T3>,
  f3: ComposableFunction<T3, T4>,
  options?: PipeOptions
): ComposableFunction<T1, T4>

export function pipe<T1, T2, T3, T4, T5>(
  f1: ComposableFunction<T1, T2>,
  f2: ComposableFunction<T2, T3>,
  f3: ComposableFunction<T3, T4>,
  f4: ComposableFunction<T4, T5>,
  options?: PipeOptions
): ComposableFunction<T1, T5>

export function pipe<T1, T2, T3, T4, T5, T6>(
  f1: ComposableFunction<T1, T2>,
  f2: ComposableFunction<T2, T3>,
  f3: ComposableFunction<T3, T4>,
  f4: ComposableFunction<T4, T5>,
  f5: ComposableFunction<T5, T6>,
  options?: PipeOptions
): ComposableFunction<T1, T6>

export function pipe(
  ...args: (ComposableFunction | PipeOptions | undefined)[]
): ComposableFunction {
  // Extract options if last arg is an object (not a function)
  let options: PipeOptions = { stopOnError: true }
  let functions: ComposableFunction[] = args.filter(
    (arg): arg is ComposableFunction => typeof arg === 'function'
  )

  const lastArg = args[args.length - 1]
  if (lastArg && typeof lastArg === 'object') {
    options = { ...options, ...(lastArg as PipeOptions) }
  }

  return async (input: unknown, context?: ExecutionContext): Promise<unknown> => {
    let current = input

    for (let i = 0; i < functions.length; i++) {
      // Check for cancellation
      if (context?.signal?.aborted) {
        throw new Error('Pipeline cancelled')
      }

      try {
        context?.onProgress?.({
          stage: `stage-${i}`,
          index: i,
          total: functions.length,
        })

        current = await functions[i]!(current, context)
      } catch (error) {
        if (options.stopOnError) {
          throw new PipelineError(
            `Pipeline failed at stage ${i}`,
            i,
            `stage-${i}`,
            error instanceof Error ? error : new Error(String(error))
          )
        }
        // Continue with current value
      }
    }

    return current
  }
}

/**
 * Create a named pipeline with detailed results
 */
export function createPipeline<TInput = unknown, TOutput = unknown>(
  stages: Array<{
    name: string
    fn: ComposableFunction
  }>,
  options?: PipeOptions
): (input: TInput, context?: ExecutionContext) => Promise<PipelineResult<TOutput>> {
  return async (input: TInput, context?: ExecutionContext): Promise<PipelineResult<TOutput>> => {
    const startTime = Date.now()
    const stageResults: StageResult[] = []
    let current: unknown = input
    let success = true
    let finalError: Error | undefined

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i]
      const stageStart = Date.now()

      // Check for cancellation
      if (context?.signal?.aborted) {
        finalError = new Error('Pipeline cancelled')
        success = false
        break
      }

      try {
        context?.onProgress?.({
          stage: stage!.name,
          index: i,
          total: stages.length,
        })

        current = await stage!.fn(current, context)

        stageResults.push({
          name: stage!.name,
          index: i,
          success: true,
          duration: Date.now() - stageStart,
          result: current,
        })
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        stageResults.push({
          name: stage!.name,
          index: i,
          success: false,
          duration: Date.now() - stageStart,
          error: err,
        })

        if (options?.stopOnError !== false) {
          success = false
          finalError = err
          break
        }
      }
    }

    return {
      success,
      result: success ? (current as TOutput) : undefined,
      error: finalError,
      duration: Date.now() - startTime,
      stages: stageResults,
    }
  }
}

// ============================================================================
// PARALLEL COMPOSITION
// ============================================================================

export interface ParallelOptions {
  maxConcurrency?: number
  stopOnFirstError?: boolean
  settleAll?: boolean
}

/**
 * Execute multiple functions in parallel with the same input
 */
export function parallel<T, R1, R2>(
  f1: ComposableFunction<T, R1>,
  f2: ComposableFunction<T, R2>,
  options?: ParallelOptions
): ComposableFunction<T, [R1, R2]>

export function parallel<T, R1, R2, R3>(
  f1: ComposableFunction<T, R1>,
  f2: ComposableFunction<T, R2>,
  f3: ComposableFunction<T, R3>,
  options?: ParallelOptions
): ComposableFunction<T, [R1, R2, R3]>

export function parallel<T, R1, R2, R3, R4>(
  f1: ComposableFunction<T, R1>,
  f2: ComposableFunction<T, R2>,
  f3: ComposableFunction<T, R3>,
  f4: ComposableFunction<T, R4>,
  options?: ParallelOptions
): ComposableFunction<T, [R1, R2, R3, R4]>

export function parallel<T>(
  ...args: (ComposableFunction<T, unknown> | ParallelOptions | undefined)[]
): ComposableFunction<T, unknown[]>

export function parallel(
  ...args: (ComposableFunction | ParallelOptions | undefined)[]
): ComposableFunction {
  // Extract options if last arg is an object (not a function)
  let options: ParallelOptions = { settleAll: true }
  const functions: ComposableFunction[] = args.filter(
    (arg): arg is ComposableFunction => typeof arg === 'function'
  )

  const lastArg = args[args.length - 1]
  if (lastArg && typeof lastArg === 'object') {
    options = { ...options, ...(lastArg as ParallelOptions) }
  }

  return async (input: unknown, context?: ExecutionContext): Promise<unknown[]> => {
    const { maxConcurrency, stopOnFirstError, settleAll } = options

    // Simple parallel execution
    if (!maxConcurrency || maxConcurrency >= functions.length) {
      if (stopOnFirstError) {
        return Promise.all(
          functions.map((fn) => fn(input, context))
        )
      }

      if (settleAll) {
        // Wrap sync functions to ensure they return promises
        const results = await Promise.allSettled(
          functions.map((fn) => Promise.resolve().then(() => fn(input, context)))
        )

        return results.map((result) => {
          if (result.status === 'fulfilled') {
            return result.value
          }
          return undefined
        })
      }

      return Promise.all(functions.map((fn) => fn(input, context)))
    }

    // Concurrency-limited execution
    const results: unknown[] = new Array(functions.length)
    const executing: Set<Promise<void>> = new Set()

    for (let i = 0; i < functions.length; i++) {
      const fn = functions[i]!
      const promise = Promise.resolve(fn(input, context))
        .then((result: unknown) => {
          results[i] = result
        })
        .catch((error: unknown) => {
          if (stopOnFirstError) {
            throw error
          }
          results[i] = undefined
        }) as Promise<void>

      executing.add(promise)
      promise.finally(() => executing.delete(promise))

      if (executing.size >= maxConcurrency) {
        await Promise.race(executing)
      }
    }

    await Promise.all(executing)
    return results
  }
}

/**
 * Execute parallel functions and get detailed results
 */
export function parallelWithResults<T, R extends unknown[]>(
  functions: ComposableFunction<T, unknown>[],
  options?: ParallelOptions
): (input: T, context?: ExecutionContext) => Promise<ParallelResult<R>> {
  return async (input: T, context?: ExecutionContext): Promise<ParallelResult<R>> => {
    const startTime = Date.now()
    const results: unknown[] = new Array(functions.length)
    const errors: Array<Error | undefined> = new Array(functions.length).fill(undefined)
    let completed = 0
    let failed = 0

    const promises = functions.map(async (fn, i) => {
      try {
        context?.onProgress?.({
          stage: `parallel-${i}`,
          index: i,
          total: functions.length,
        })

        results[i] = await fn(input, context)
        completed++
      } catch (error) {
        errors[i] = error instanceof Error ? error : new Error(String(error))
        failed++

        if (options?.stopOnFirstError) {
          throw errors[i]
        }
      }
    })

    if (options?.settleAll) {
      await Promise.allSettled(promises)
    } else {
      await Promise.all(promises)
    }

    return {
      success: failed === 0,
      results: results as R,
      errors,
      duration: Date.now() - startTime,
      completed,
      failed,
    }
  }
}

// ============================================================================
// CONDITIONAL COMPOSITION
// ============================================================================

/**
 * Execute a function conditionally based on predicate
 */
export function conditional<TInput, TOutput>(
  predicate: (input: TInput) => boolean | Promise<boolean>,
  onTrue: ComposableFunction<TInput, TOutput>,
  onFalse?: ComposableFunction<TInput, TOutput>
): ComposableFunction<TInput, TOutput | undefined> {
  return async (input: TInput, context?: ExecutionContext): Promise<TOutput | undefined> => {
    const condition = await predicate(input)

    if (condition) {
      return onTrue(input, context)
    }

    if (onFalse) {
      return onFalse(input, context)
    }

    return undefined
  }
}

/**
 * Switch between multiple functions based on a discriminator
 */
export function switchCase<TInput, TOutput, K extends string | number>(
  discriminator: (input: TInput) => K | Promise<K>,
  cases: Record<K, ComposableFunction<TInput, TOutput>>,
  defaultCase?: ComposableFunction<TInput, TOutput>
): ComposableFunction<TInput, TOutput | undefined> {
  return async (input: TInput, context?: ExecutionContext): Promise<TOutput | undefined> => {
    const key = await discriminator(input)
    const fn = cases[key] ?? defaultCase

    if (fn) {
      return fn(input, context)
    }

    return undefined
  }
}

// ============================================================================
// RETRY COMPOSITION
// ============================================================================

export interface RetryOptions {
  maxAttempts: number
  delay: number
  backoff?: 'fixed' | 'exponential' | 'linear'
  maxDelay?: number
  retryIf?: (error: Error) => boolean
  onRetry?: (attempt: number, error: Error) => void
}

/**
 * Wrap a function with retry logic
 */
export function retry<TInput, TOutput>(
  fn: ComposableFunction<TInput, TOutput>,
  options: RetryOptions
): ComposableFunction<TInput, TOutput> {
  return async (input: TInput, context?: ExecutionContext): Promise<TOutput> => {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
      // Check for cancellation
      if (context?.signal?.aborted) {
        throw new Error('Operation cancelled')
      }

      try {
        return await fn(input, context)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Check if we should retry
        if (options.retryIf && !options.retryIf(lastError)) {
          throw lastError
        }

        if (attempt < options.maxAttempts) {
          options.onRetry?.(attempt, lastError)

          // Calculate delay
          let delay = options.delay
          if (options.backoff === 'exponential') {
            delay = options.delay * Math.pow(2, attempt - 1)
          } else if (options.backoff === 'linear') {
            delay = options.delay * attempt
          }

          if (options.maxDelay && delay > options.maxDelay) {
            delay = options.maxDelay
          }

          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    throw new RetryExhaustedError(options.maxAttempts, lastError!)
  }
}

// ============================================================================
// TIMEOUT COMPOSITION
// ============================================================================

/**
 * Wrap a function with timeout
 */
export function withTimeout<TInput, TOutput>(
  fn: ComposableFunction<TInput, TOutput>,
  timeout: number
): ComposableFunction<TInput, TOutput> {
  return async (input: TInput, context?: ExecutionContext): Promise<TOutput> => {
    return Promise.race([
      fn(input, context),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new TimeoutError(timeout)), timeout)
      }),
    ])
  }
}

// ============================================================================
// FALLBACK COMPOSITION
// ============================================================================

/**
 * Try primary function, fall back to alternative on failure
 */
export function fallback<TInput, TOutput>(
  primary: ComposableFunction<TInput, TOutput>,
  alternative: ComposableFunction<TInput, TOutput>,
  shouldFallback?: (error: Error) => boolean
): ComposableFunction<TInput, TOutput> {
  return async (input: TInput, context?: ExecutionContext): Promise<TOutput> => {
    try {
      return await primary(input, context)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      if (shouldFallback && !shouldFallback(err)) {
        throw err
      }

      return alternative(input, context)
    }
  }
}

/**
 * Try multiple functions in order until one succeeds
 */
export function tryEach<TInput, TOutput>(
  ...fns: ComposableFunction<TInput, TOutput>[]
): ComposableFunction<TInput, TOutput> {
  return async (input: TInput, context?: ExecutionContext): Promise<TOutput> => {
    let lastError: Error | null = null

    for (const fn of fns) {
      try {
        return await fn(input, context)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
      }
    }

    throw lastError ?? new Error('All functions failed')
  }
}

// ============================================================================
// MAP/FILTER COMPOSITION
// ============================================================================

/**
 * Map over an array input, applying function to each element
 */
export function mapOver<TItem, TOutput>(
  fn: ComposableFunction<TItem, TOutput>,
  options?: { parallel?: boolean; maxConcurrency?: number }
): ComposableFunction<TItem[], TOutput[]> {
  return async (input: TItem[], context?: ExecutionContext): Promise<TOutput[]> => {
    if (options?.parallel) {
      if (options.maxConcurrency) {
        const results: TOutput[] = []
        const executing: Set<Promise<void>> = new Set()

        for (let i = 0; i < input.length; i++) {
          const promise = Promise.resolve(fn(input[i]!, context))
            .then((result: TOutput) => {
              results[i] = result
            }) as unknown as Promise<void>

          executing.add(promise)
          promise.finally(() => executing.delete(promise))

          if (executing.size >= options.maxConcurrency) {
            await Promise.race(executing)
          }
        }

        await Promise.all(executing)
        return results
      }

      return Promise.all(input.map((item) => fn(item, context)))
    }

    const results: TOutput[] = []
    for (const item of input) {
      results.push(await fn(item, context))
    }
    return results
  }
}

/**
 * Filter array input based on predicate function
 */
export function filterBy<TItem>(
  predicate: ComposableFunction<TItem, boolean>
): ComposableFunction<TItem[], TItem[]> {
  return async (input: TItem[], context?: ExecutionContext): Promise<TItem[]> => {
    const results: TItem[] = []

    for (const item of input) {
      const include = await predicate(item, context)
      if (include) {
        results.push(item)
      }
    }

    return results
  }
}

/**
 * Reduce array input to single value
 */
export function reduceWith<TItem, TAcc>(
  reducer: (acc: TAcc, item: TItem, context?: ExecutionContext) => TAcc | Promise<TAcc>,
  initial: TAcc
): ComposableFunction<TItem[], TAcc> {
  return async (input: TItem[], context?: ExecutionContext): Promise<TAcc> => {
    let acc = initial

    for (const item of input) {
      acc = await reducer(acc, item, context)
    }

    return acc
  }
}

// ============================================================================
// TAP / PASSTHROUGH COMPOSITION
// ============================================================================

/**
 * Execute side effect without modifying input
 */
export function tap<T>(
  sideEffect: (input: T, context?: ExecutionContext) => void | Promise<void>
): ComposableFunction<T, T> {
  return async (input: T, context?: ExecutionContext): Promise<T> => {
    await sideEffect(input, context)
    return input
  }
}

/**
 * Log input and pass through
 */
export function log<T>(label?: string): ComposableFunction<T, T> {
  return tap((input) => {
    if (label) {
      console.log(`[${label}]`, input)
    } else {
      console.log(input)
    }
  })
}

export default {
  pipe,
  createPipeline,
  parallel,
  parallelWithResults,
  conditional,
  switchCase,
  retry,
  withTimeout,
  fallback,
  tryEach,
  mapOver,
  filterBy,
  reduceWith,
  tap,
  log,
}
