/**
 * evaluate - Run code with WorkflowContext ($) in a flat namespace sandbox
 *
 * Executes code strings with access to the WorkflowContext,
 * enabling dynamic workflow definitions with a flat namespace.
 *
 * The sandbox provides:
 * - $ (WorkflowContext) as a global
 * - All nouns as globals (Customer, Order, etc.)
 * - All utilities as globals (on, every, send, dispatch, at)
 * - Time travel via Noun.at('date') syntax
 *
 * @module @dotdo/workers/do
 */

import type { WorkflowContext } from './WorkflowContext'

/**
 * Options for evaluate function
 */
export interface EvaluateOptions {
  /** The WorkflowContext to expose as $ */
  context: WorkflowContext
  /** Additional variables to expose */
  globals?: Record<string, unknown>
  /** Timeout in milliseconds */
  timeout?: number
}

/**
 * Result from evaluate function
 */
export interface EvaluateResult<T = unknown> {
  /** The result of the evaluation */
  value: T
  /** Duration in milliseconds */
  duration: number
  /** Any logs captured during execution */
  logs?: string[]
}

/**
 * Create a noun accessor with time travel support
 *
 * @param noun - The noun name (e.g., 'Customer', 'Order')
 * @param context - The WorkflowContext
 * @returns A function that creates stubs, with an `.at()` method for time travel
 */
function createNounAccessor(noun: string, context: WorkflowContext) {
  // The main accessor function - Customer('id') returns a stub
  const accessor = (id: string) => {
    // Use the context's dynamic noun accessor
    const nounFn = context[noun] as ((id: string) => object) | undefined
    if (typeof nounFn === 'function') {
      return nounFn(id)
    }
    // Return a minimal stub if no resolver is set
    return { _noun: noun, _id: id }
  }

  // Add time travel support: Customer.at('2024-01-01')('id')
  accessor.at = (timestamp: string) => {
    return (id: string) => {
      // Return a stub with time travel metadata
      const stub = accessor(id)
      return {
        ...stub,
        _asOf: timestamp,
        _noun: noun,
        _id: id,
      }
    }
  }

  // Add list method for querying
  accessor.list = (filter?: Record<string, unknown>) => {
    return { _noun: noun, _filter: filter, _list: true }
  }

  return accessor
}

/**
 * Create a sandbox globalThis proxy that exposes flat namespace
 *
 * @param context - The WorkflowContext ($)
 * @param userGlobals - Additional user-provided globals
 * @returns A proxy that acts as the sandbox's globalThis
 */
function createSandboxGlobalThis(
  context: WorkflowContext,
  userGlobals: Record<string, unknown>
): Record<string, unknown> {
  // Cache for noun accessors
  const nounCache = new Map<string, ReturnType<typeof createNounAccessor>>()

  // Get or create a noun accessor
  const getNounAccessor = (noun: string) => {
    if (!nounCache.has(noun)) {
      nounCache.set(noun, createNounAccessor(noun, context))
    }
    return nounCache.get(noun)!
  }

  // Create the sandbox global object with direct references (not bound)
  // This ensures globalThis.on === $.on passes the identity check
  const sandboxGlobal: Record<string, unknown> = {
    // Expose $ as a global
    $: context,

    // Expose utility methods directly (same references as on $)
    on: context.on,
    every: context.every,
    // For send/dispatch/at, we need wrapper functions that maintain `this`
    // but still work when called standalone
    send: (...args: [string, unknown]) => context.send(...args),
    dispatch: (...args: [string, unknown]) => context.dispatch(...args),
    at: (...args: [string | Date]) => context.at(...args),

    // Include user globals
    ...userGlobals,
  }

  // Create a proxy to handle dynamic noun access (Customer, Order, etc.)
  return new Proxy(sandboxGlobal, {
    get(target, prop) {
      // First check if it's a defined property
      if (prop in target) {
        return target[prop as string]
      }

      // Handle string properties that look like nouns (capitalized)
      if (typeof prop === 'string' && prop[0] === prop[0].toUpperCase() && prop[0] !== prop[0].toLowerCase()) {
        return getNounAccessor(prop)
      }

      // Return undefined for anything else
      return undefined
    },
    has(target, prop) {
      // Report that we have the property if it's defined or looks like a noun
      if (prop in target) return true
      if (typeof prop === 'string' && prop[0] === prop[0].toUpperCase() && prop[0] !== prop[0].toLowerCase()) {
        return true
      }
      return false
    },
  })
}

/**
 * Extract capitalized identifiers from code that might be noun references
 *
 * @param code - The code to scan
 * @returns Array of potential noun names
 */
function extractPotentialNouns(code: string): string[] {
  // Match capitalized identifiers that aren't keywords
  // Pattern: word boundary + capital letter + alphanumeric, not followed by certain patterns
  const jsKeywords = new Set([
    'Array', 'Boolean', 'Date', 'Error', 'Function', 'JSON', 'Math',
    'Number', 'Object', 'Promise', 'Proxy', 'Reflect', 'RegExp', 'Set',
    'String', 'Symbol', 'Map', 'WeakMap', 'WeakSet', 'Infinity', 'NaN',
    'undefined', 'null', 'true', 'false', 'Intl', 'BigInt', 'URL',
    'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError',
    'AggregateError', 'EvalError', 'URIError', 'globalThis',
  ])

  const matches = code.match(/\b([A-Z][a-zA-Z0-9]*)\b/g) || []
  const uniqueNouns = new Set<string>()

  for (const match of matches) {
    if (!jsKeywords.has(match)) {
      uniqueNouns.add(match)
    }
  }

  return Array.from(uniqueNouns)
}

/**
 * Execute code with WorkflowContext ($) available in a flat namespace sandbox
 *
 * The sandbox provides:
 * - globalThis.$ === $ (the context)
 * - globalThis.Customer === $.Customer (noun accessors)
 * - globalThis.on === $.on (event handlers)
 * - globalThis.every === $.every (scheduling)
 * - globalThis.send === $.send (fire-and-forget events)
 * - globalThis.dispatch === $.dispatch (event dispatch)
 * - globalThis.at === $.at (one-time scheduling)
 *
 * @param code - The code string to evaluate
 * @param options - Evaluation options including context
 * @returns The result of the evaluation
 *
 * @example
 * ```typescript
 * const $ = createWorkflowContext({ stubResolver })
 * const result = await evaluate(`
 *   // These all work without $ prefix:
 *   Customer('c_123').notify('hello')
 *   on.Customer.signup((e) => console.log(e))
 *   send('Test.event', { foo: 'bar' })
 *   return 'done'
 * `, { context: $ })
 * ```
 */
export async function evaluate<T = unknown>(
  code: string,
  options: EvaluateOptions
): Promise<EvaluateResult<T>> {
  const { context, globals = {}, timeout } = options

  const startTime = performance.now()

  // Create the sandbox globalThis
  const sandboxGlobal = createSandboxGlobalThis(context, globals)

  // Extract potential noun names from the code
  const potentialNouns = extractPotentialNouns(code)

  // Build the list of all globals to expose as function parameters
  // This includes fixed utilities and dynamically detected nouns
  const knownGlobals = [
    '$',
    'on',
    'every',
    'send',
    'dispatch',
    'at',
    'globalThis',
    ...potentialNouns,
    ...Object.keys(globals),
  ]

  // Deduplicate
  const uniqueGlobals = [...new Set(knownGlobals)]

  // Build argument names and values for the function
  const argNames = uniqueGlobals
  const argValues = uniqueGlobals.map((name) => {
    if (name === 'globalThis') {
      return sandboxGlobal
    }
    return sandboxGlobal[name]
  })

  // Wrap code in async function
  const wrappedCode = `
    return (async function() {
      ${code}
    }).call(this)
  `

  // Create the function with all globals as parameters
  // This creates a scope where these names shadow any outer scope
  const fn = new Function(...argNames, wrappedCode)

  // Execute with the context bound as `this`
  let value: T
  if (timeout) {
    const result = await Promise.race([
      fn.call(context, ...argValues) as Promise<T>,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Evaluation timeout')), timeout)
      ),
    ])
    value = result
  } else {
    value = await fn.call(context, ...argValues)
  }

  const duration = performance.now() - startTime

  return {
    value,
    duration,
  }
}
