/**
 * Modifier API - Transform inputs/outputs of workflow steps
 *
 * Provides a chainable API for creating modifiers that can:
 * - Transform input before step execution
 * - Transform output after step execution
 * - Apply conditional transformations
 * - Compose multiple modifiers together
 *
 * Usage:
 * ```typescript
 * const addTimestamp = modifier()
 *   .output((result) => ({ ...result, timestamp: Date.now() }))
 *
 * const validateInput = modifier()
 *   .input((input) => {
 *     if (!input.orderId) throw new Error('Missing orderId')
 *     return input
 *   })
 *
 * // Apply to step
 * workflow.step('process', handler, { modifiers: [validateInput, addTimestamp] })
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Context passed to modifier functions
 */
export interface ModifierContext {
  /** Current step name */
  stepName?: string
  /** Current step index */
  stepIndex?: number
  /** Workflow instance ID */
  workflowInstanceId?: string
}

/**
 * Configuration for creating a modifier
 */
export interface ModifierConfig {
  /** Optional name for the modifier */
  name?: string
  /** Optional description */
  description?: string
}

/**
 * Function type for input transformation
 */
export type InputModifierFunction<TIn = unknown, TOut = unknown> = (
  input: TIn,
  context?: ModifierContext
) => TOut | Promise<TOut>

/**
 * Function type for output transformation
 */
export type OutputModifierFunction<TResult = unknown, TIn = unknown, TOut = unknown> = (
  result: TResult,
  input?: TIn,
  context?: ModifierContext
) => TOut | Promise<TOut>

/**
 * Function type for condition evaluation
 */
export type ConditionFunction<TIn = unknown> = (input: TIn, context?: ModifierContext) => boolean

/**
 * Generic modifier function type (for internal use)
 */
export type ModifierFunction<TIn = unknown, TOut = unknown> = (
  value: TIn,
  context?: ModifierContext
) => TOut | Promise<TOut>

/**
 * Modifier interface - the main API
 */
export interface Modifier<TIn = unknown, TOut = unknown> {
  /** Modifier name */
  readonly name: string
  /** Modifier description */
  readonly description?: string

  /**
   * Add an input transformation
   * @param fn Function to transform input before step execution
   */
  input<TNewOut>(fn: InputModifierFunction<TIn, TNewOut>): Modifier<TIn, TNewOut>

  /**
   * Add an output transformation
   * @param fn Function to transform output after step execution
   */
  output<TNewOut>(fn: OutputModifierFunction<TOut, TIn, TNewOut>): Modifier<TIn, TNewOut>

  /**
   * Apply a condition for when this modifier should be active
   * @param condition Function that returns true when modifier should apply
   */
  when(condition: ConditionFunction<TIn>): Modifier<TIn, TOut>

  /**
   * Compose this modifier with other modifiers
   * @param modifiers Other modifiers to compose with
   */
  compose(...modifiers: Modifier[]): Modifier<TIn, TOut>

  /**
   * Apply input transformations to a value
   * @param input The input value to transform
   * @param context Optional context information
   */
  applyInput(input: unknown, context?: ModifierContext): Promise<unknown>

  /**
   * Apply output transformations to a value
   * @param result The output value to transform
   * @param input Original input (for context)
   * @param context Optional context information
   */
  applyOutput(result: unknown, input?: unknown, context?: ModifierContext): Promise<unknown>
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

interface ModifierState {
  name: string
  description?: string
  inputTransformers: InputModifierFunction[]
  outputTransformers: OutputModifierFunction[]
  condition?: ConditionFunction
}

/**
 * Creates a modifier instance
 */
function createModifierInstance(state: ModifierState): Modifier {
  const modifier: Modifier = {
    get name() {
      return state.name
    },

    get description() {
      return state.description
    },

    input<TNewOut>(fn: InputModifierFunction<unknown, TNewOut>): Modifier<unknown, TNewOut> {
      return createModifierInstance({
        ...state,
        inputTransformers: [...state.inputTransformers, fn],
      }) as Modifier<unknown, TNewOut>
    },

    output<TNewOut>(fn: OutputModifierFunction<unknown, unknown, TNewOut>): Modifier<unknown, TNewOut> {
      return createModifierInstance({
        ...state,
        outputTransformers: [...state.outputTransformers, fn],
      }) as Modifier<unknown, TNewOut>
    },

    when(condition: ConditionFunction): Modifier {
      return createModifierInstance({
        ...state,
        condition,
      })
    },

    compose(...modifiers: Modifier[]): Modifier {
      // Collect all transformers from composed modifiers
      const composedInputTransformers: InputModifierFunction[] = [...state.inputTransformers]
      const composedOutputTransformers: OutputModifierFunction[] = [...state.outputTransformers]

      for (const mod of modifiers) {
        // Access internal state through applyInput/applyOutput
        // We'll extract transformers by wrapping the entire modifier
        composedInputTransformers.push(async (input, ctx) => mod.applyInput(input, ctx))
        composedOutputTransformers.push(async (result, input, ctx) => mod.applyOutput(result, input, ctx))
      }

      return createModifierInstance({
        ...state,
        inputTransformers: composedInputTransformers,
        outputTransformers: composedOutputTransformers,
      })
    },

    async applyInput(input: unknown, context?: ModifierContext): Promise<unknown> {
      // Check condition if present
      if (state.condition && !state.condition(input, context)) {
        return input
      }

      let result = input
      for (const transformer of state.inputTransformers) {
        result = await transformer(result, context)
      }
      return result
    },

    async applyOutput(result: unknown, input?: unknown, context?: ModifierContext): Promise<unknown> {
      // Check condition if present
      if (state.condition && !state.condition(input, context)) {
        return result
      }

      let output = result
      for (const transformer of state.outputTransformers) {
        output = await transformer(output, input, context)
      }
      return output
    },
  }

  return modifier
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

let modifierCounter = 0

/**
 * Create a new modifier
 *
 * @example
 * ```typescript
 * const addTimestamp = modifier()
 *   .output((result) => ({ ...result, timestamp: Date.now() }))
 *
 * const validateInput = modifier({ name: 'input-validator' })
 *   .input((input) => {
 *     if (!input.orderId) throw new Error('Missing orderId')
 *     return input
 *   })
 * ```
 */
export function modifier(config?: ModifierConfig): Modifier {
  const name = config?.name || `modifier-${++modifierCounter}`

  return createModifierInstance({
    name,
    description: config?.description,
    inputTransformers: [],
    outputTransformers: [],
  })
}

/**
 * Create an input-only modifier (convenience helper)
 *
 * @example
 * ```typescript
 * const validateOrder = inputModifier((input) => {
 *   if (!input.items) throw new Error('Missing items')
 *   return input
 * })
 * ```
 */
export function inputModifier<TIn = unknown, TOut = unknown>(
  fn: InputModifierFunction<TIn, TOut>
): Modifier<TIn, TOut> {
  return modifier().input(fn as InputModifierFunction<unknown, TOut>) as Modifier<TIn, TOut>
}

/**
 * Create an output-only modifier (convenience helper)
 *
 * @example
 * ```typescript
 * const addMetadata = outputModifier((result) => ({
 *   ...result,
 *   processedAt: new Date().toISOString()
 * }))
 * ```
 */
export function outputModifier<TResult = unknown, TOut = unknown>(
  fn: OutputModifierFunction<TResult, unknown, TOut>
): Modifier<unknown, TOut> {
  return modifier().output(fn as OutputModifierFunction<unknown, unknown, TOut>)
}

/**
 * Create a conditional modifier that only applies when condition is met
 *
 * @example
 * ```typescript
 * const mod = conditionalModifier(
 *   (input) => input.shouldModify === true,
 *   modifier().input((i) => ({ ...i, modified: true }))
 * )
 * ```
 */
export function conditionalModifier<TIn = unknown>(
  condition: ConditionFunction<TIn>,
  mod: Modifier
): Modifier<TIn> {
  return mod.when(condition as ConditionFunction) as Modifier<TIn>
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Apply multiple modifiers to input in sequence
 */
export async function applyInputModifiers(
  modifiers: Modifier[],
  input: unknown,
  context?: ModifierContext
): Promise<unknown> {
  let result = input
  for (const mod of modifiers) {
    result = await mod.applyInput(result, context)
  }
  return result
}

/**
 * Apply multiple modifiers to output in sequence
 */
export async function applyOutputModifiers(
  modifiers: Modifier[],
  result: unknown,
  input?: unknown,
  context?: ModifierContext
): Promise<unknown> {
  let output = result
  for (const mod of modifiers) {
    output = await mod.applyOutput(output, input, context)
  }
  return output
}

export default modifier
