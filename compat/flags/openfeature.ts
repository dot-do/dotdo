/**
 * OpenFeature Provider Implementation
 *
 * OpenFeature-compatible feature flags provider for dotdo.
 *
 * @module @dotdo/compat/flags/openfeature
 */

import type { EvaluationContext, EvaluationDetails } from './types'

// Re-export types from base types module
export type { EvaluationContext, EvaluationDetails }

// ============================================================================
// ERROR CODES
// ============================================================================

/**
 * Error codes for flag evaluation failures
 */
export const ErrorCode = {
  PROVIDER_NOT_READY: 'PROVIDER_NOT_READY',
  FLAG_NOT_FOUND: 'FLAG_NOT_FOUND',
  PARSE_ERROR: 'PARSE_ERROR',
  TYPE_MISMATCH: 'TYPE_MISMATCH',
  TARGETING_KEY_MISSING: 'TARGETING_KEY_MISSING',
  GENERAL: 'GENERAL',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

// ============================================================================
// RESOLUTION REASONS
// ============================================================================

/**
 * Reasons for flag evaluation result
 */
export const ResolutionReason = {
  STATIC: 'STATIC',
  DEFAULT: 'DEFAULT',
  TARGETING_MATCH: 'TARGETING_MATCH',
  SPLIT: 'SPLIT',
  CACHED: 'CACHED',
  DISABLED: 'DISABLED',
  ERROR: 'ERROR',
} as const

export type ResolutionReason = (typeof ResolutionReason)[keyof typeof ResolutionReason]

// ============================================================================
// RESOLUTION DETAILS
// ============================================================================

/**
 * Resolution details returned from flag evaluation
 */
export interface ResolutionDetails<T> {
  /** The evaluated flag value */
  value: T
  /** Variant name or index */
  variant?: string
  /** Reason for the evaluation result */
  reason?: ResolutionReason
  /** Error code if evaluation failed */
  errorCode?: ErrorCode
  /** Human-readable error message */
  errorMessage?: string
  /** Additional flag metadata */
  flagMetadata?: Record<string, unknown>
}

// ============================================================================
// HOOK TYPES
// ============================================================================

/**
 * Context passed to hooks
 */
export interface HookContext {
  flagKey: string
  defaultValue: unknown
  flagValueType: string
  context?: EvaluationContext
}

/**
 * Error details passed to error hooks
 */
export interface HookError {
  errorCode: ErrorCode
  errorMessage?: string
}

/**
 * Hints passed to hooks for additional context
 */
export interface HookHints {
  /** Provider name */
  providerName?: string
  /** Timestamp when evaluation started */
  evaluationStartTime?: number
  /** Custom hints */
  [key: string]: unknown
}

/**
 * Result from before hook that can transform context
 */
export interface BeforeHookResult {
  /** Transformed evaluation context (optional) */
  context?: EvaluationContext
}

/**
 * Hook interface for flag evaluation lifecycle
 *
 * OpenFeature hooks spec: https://openfeature.dev/specification/sections/hooks
 */
export interface Hook {
  /** Hook name for identification */
  name?: string
  /**
   * Called before flag evaluation.
   * Can return a transformed context to modify evaluation.
   */
  before?: (
    context: HookContext,
    hints?: HookHints
  ) => void | BeforeHookResult | Promise<void | BeforeHookResult>
  /** Called after successful flag evaluation */
  after?: (
    context: HookContext,
    details: ResolutionDetails<unknown>,
    hints?: HookHints
  ) => void | Promise<void>
  /** Called when flag evaluation encounters an error */
  error?: (
    context: HookContext,
    error: HookError,
    hints?: HookHints
  ) => void | Promise<void>
  /** Called after evaluation completes (success or failure) */
  finally?: (context: HookContext, hints?: HookHints) => void | Promise<void>
}

// ============================================================================
// BUILT-IN HOOKS
// ============================================================================

/**
 * Logger interface for logging hook
 */
export interface Logger {
  debug: (message: string, data?: Record<string, unknown>) => void
  info: (message: string, data?: Record<string, unknown>) => void
  warn: (message: string, data?: Record<string, unknown>) => void
  error: (message: string, data?: Record<string, unknown>) => void
}

/**
 * Configuration for logging hook
 */
export interface LoggingHookConfig {
  /** Logger instance */
  logger?: Logger
  /** Log level for successful evaluations */
  logLevel?: 'debug' | 'info'
  /** Include context in logs */
  includeContext?: boolean
  /** Include evaluation details in logs */
  includeDetails?: boolean
}

/**
 * Create a logging hook for flag evaluations
 *
 * @example
 * ```ts
 * const client = new FlagsClient(config)
 * client.addHook(createLoggingHook({
 *   logger: console,
 *   logLevel: 'debug',
 *   includeContext: true,
 * }))
 * ```
 */
export function createLoggingHook(config: LoggingHookConfig = {}): Hook {
  const logger = config.logger ?? console
  const logLevel = config.logLevel ?? 'debug'
  const includeContext = config.includeContext ?? false
  const includeDetails = config.includeDetails ?? true

  return {
    name: 'logging-hook',

    before(hookContext, hints) {
      const data: Record<string, unknown> = {
        flagKey: hookContext.flagKey,
        flagType: hookContext.flagValueType,
        timestamp: hints?.evaluationStartTime,
      }
      if (includeContext && hookContext.context) {
        data.context = hookContext.context
      }
      logger[logLevel](`[flags] Evaluating flag: ${hookContext.flagKey}`, data)
    },

    after(hookContext, details) {
      const data: Record<string, unknown> = {
        flagKey: hookContext.flagKey,
        value: details.value,
        reason: details.reason,
      }
      if (includeDetails) {
        data.variant = details.variant
      }
      logger[logLevel](`[flags] Flag evaluated: ${hookContext.flagKey}`, data)
    },

    error(hookContext, error) {
      logger.error(`[flags] Flag evaluation error: ${hookContext.flagKey}`, {
        flagKey: hookContext.flagKey,
        errorCode: error.errorCode,
        errorMessage: error.errorMessage,
      })
    },
  }
}

/**
 * Metrics collector interface for metrics hook
 */
export interface MetricsCollector {
  /** Increment a counter metric */
  increment: (name: string, value?: number, tags?: Record<string, string>) => void
  /** Record a timing/histogram metric */
  timing: (name: string, valueMs: number, tags?: Record<string, string>) => void
  /** Record a gauge metric */
  gauge: (name: string, value: number, tags?: Record<string, string>) => void
}

/**
 * Configuration for metrics hook
 */
export interface MetricsHookConfig {
  /** Metrics collector instance */
  collector: MetricsCollector
  /** Metric name prefix */
  prefix?: string
  /** Include flag key as tag */
  includeFlagKey?: boolean
  /** Include variant as tag */
  includeVariant?: boolean
  /** Include reason as tag */
  includeReason?: boolean
}

/**
 * Create a metrics hook for flag evaluations
 *
 * @example
 * ```ts
 * const client = new FlagsClient(config)
 * client.addHook(createMetricsHook({
 *   collector: myMetricsClient,
 *   prefix: 'feature_flags',
 *   includeFlagKey: true,
 * }))
 * ```
 */
export function createMetricsHook(config: MetricsHookConfig): Hook {
  const prefix = config.prefix ?? 'flags'
  const includeFlagKey = config.includeFlagKey ?? true
  const includeVariant = config.includeVariant ?? true
  const includeReason = config.includeReason ?? true

  return {
    name: 'metrics-hook',

    before(hookContext, hints) {
      // Record evaluation request
      const tags: Record<string, string> = {}
      if (includeFlagKey) {
        tags.flag_key = hookContext.flagKey
      }
      tags.flag_type = hookContext.flagValueType
      config.collector.increment(`${prefix}.evaluations`, 1, tags)
    },

    after(hookContext, details, hints) {
      const tags: Record<string, string> = {}
      if (includeFlagKey) {
        tags.flag_key = hookContext.flagKey
      }
      if (includeVariant && details.variant) {
        tags.variant = details.variant
      }
      if (includeReason && details.reason) {
        tags.reason = details.reason
      }

      // Record success
      config.collector.increment(`${prefix}.evaluations.success`, 1, tags)

      // Record timing if available
      if (hints?.evaluationStartTime) {
        const duration = Date.now() - (hints.evaluationStartTime as number)
        config.collector.timing(`${prefix}.evaluation_duration_ms`, duration, tags)
      }
    },

    error(hookContext, error, hints) {
      const tags: Record<string, string> = {
        error_code: error.errorCode,
      }
      if (includeFlagKey) {
        tags.flag_key = hookContext.flagKey
      }

      // Record error
      config.collector.increment(`${prefix}.evaluations.error`, 1, tags)

      // Record timing if available
      if (hints?.evaluationStartTime) {
        const duration = Date.now() - (hints.evaluationStartTime as number)
        config.collector.timing(`${prefix}.evaluation_duration_ms`, duration, tags)
      }
    },
  }
}

/**
 * Configuration for context transformation hook
 */
export interface ContextTransformConfig {
  /** Transform function for context */
  transform: (context: EvaluationContext) => EvaluationContext | Promise<EvaluationContext>
}

/**
 * Create a context transformation hook
 *
 * @example
 * ```ts
 * const client = new FlagsClient(config)
 * client.addHook(createContextTransformHook({
 *   transform: (ctx) => ({
 *     ...ctx,
 *     environment: process.env.NODE_ENV,
 *     timestamp: Date.now(),
 *   }),
 * }))
 * ```
 */
export function createContextTransformHook(config: ContextTransformConfig): Hook {
  return {
    name: 'context-transform-hook',

    async before(hookContext) {
      if (hookContext.context) {
        const transformedContext = await config.transform(hookContext.context)
        return { context: transformedContext }
      }
    },
  }
}

// ============================================================================
// FLAG TYPES
// ============================================================================

/**
 * A named variation with value
 */
export interface NamedVariation<T> {
  name: string
  value: T
}

/**
 * Targeting rule clause
 */
export interface FlagClause {
  attribute: string
  op: string
  values: unknown[]
}

/**
 * Targeting rule
 */
export interface FlagRule {
  clauses: FlagClause[]
  variation: number
}

/**
 * Target configuration for specific values
 */
export interface FlagTarget {
  variation: number
  values: string[]
}

/**
 * Flag registration input
 */
export interface FlagRegistration<T = unknown> {
  key: string
  type: 'boolean' | 'string' | 'number' | 'object'
  variations: T[] | NamedVariation<T>[]
  defaultVariation: number
  targets?: FlagTarget[]
  rules?: FlagRule[]
}

// ============================================================================
// FLAGS CLIENT CONFIG
// ============================================================================

/**
 * Configuration for FlagsClient
 */
export interface FlagsConfig {
  /** DO storage for persistence */
  storage: unknown
}

// ============================================================================
// FLAGS CLIENT
// ============================================================================

/**
 * OpenFeature-compatible flags client
 */
export class FlagsClient {
  private readonly _metadata = Object.freeze({ name: 'dotdo-flags' })
  private flags = new Map<string, FlagRegistration>()
  private hooks: Hook[] = []
  private cleanupHandlers: Array<() => void | Promise<void>> = []
  private closed = false

  constructor(_config: FlagsConfig) {
    // Config stored for future storage integration
  }

  /**
   * Provider metadata
   */
  get metadata(): Readonly<{ name: string }> {
    return this._metadata
  }

  set metadata(_value: { name: string }) {
    throw new Error('Cannot modify readonly metadata property')
  }

  /**
   * Register a flag definition
   */
  registerFlag<T>(flag: FlagRegistration<T>): void {
    this.flags.set(flag.key, flag as FlagRegistration)
  }

  /**
   * Add a lifecycle hook
   */
  addHook(hook: Hook): void {
    this.hooks.push(hook)
  }

  /**
   * Register a cleanup handler
   */
  onCleanup(handler: () => void | Promise<void>): void {
    this.cleanupHandlers.push(handler)
  }

  /**
   * Initialize the provider
   */
  async initialize(_context: EvaluationContext): Promise<void> {
    // Initialize provider resources
    this.closed = false
  }

  /**
   * Close the provider and cleanup resources
   */
  async onClose(): Promise<void> {
    this.closed = true
    for (const handler of this.cleanupHandlers) {
      await handler()
    }
  }

  // ============================================================================
  // EVALUATION METHODS
  // ============================================================================

  /**
   * Resolve a boolean flag
   */
  async resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext
  ): Promise<ResolutionDetails<boolean>> {
    return this.resolveEvaluation(flagKey, defaultValue, context, 'boolean')
  }

  /**
   * Resolve a string flag
   */
  async resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext
  ): Promise<ResolutionDetails<string>> {
    return this.resolveEvaluation(flagKey, defaultValue, context, 'string')
  }

  /**
   * Resolve a number flag
   */
  async resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext
  ): Promise<ResolutionDetails<number>> {
    return this.resolveEvaluation(flagKey, defaultValue, context, 'number')
  }

  /**
   * Resolve an object flag
   */
  async resolveObjectEvaluation<T extends object>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext
  ): Promise<ResolutionDetails<T>> {
    return this.resolveEvaluation(flagKey, defaultValue, context, 'object')
  }

  // ============================================================================
  // INTERNAL METHODS
  // ============================================================================

  /**
   * Core evaluation logic
   */
  private async resolveEvaluation<T>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
    expectedType: string
  ): Promise<ResolutionDetails<T>> {
    // Create hints with evaluation metadata
    const hints: HookHints = {
      providerName: this._metadata.name,
      evaluationStartTime: Date.now(),
    }

    const hookContext: HookContext = {
      flagKey,
      defaultValue,
      flagValueType: expectedType,
      context,
    }

    // Run before hooks (may transform context)
    const transformedContext = await this.runBeforeHooks(hookContext, hints)

    // Use transformed context for evaluation
    const evaluationContext = transformedContext ?? context

    // Update hook context with transformed context for subsequent hooks
    if (transformedContext) {
      hookContext.context = transformedContext
    }

    let result: ResolutionDetails<T>

    try {
      result = await this.evaluate(flagKey, defaultValue, evaluationContext, expectedType)
    } catch (error) {
      result = {
        value: defaultValue,
        reason: ResolutionReason.ERROR,
        errorCode: ErrorCode.GENERAL,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      }
    }

    // Run appropriate hooks based on result
    if (result.errorCode) {
      await this.runErrorHooks(hookContext, {
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      }, hints)
    } else {
      await this.runAfterHooks(hookContext, result, hints)
    }

    // Always run finally hooks
    await this.runFinallyHooks(hookContext, hints)

    return result
  }

  /**
   * Internal evaluation method
   */
  private evaluate<T>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
    expectedType: string
  ): ResolutionDetails<T> {
    // Check if client is closed
    if (this.closed) {
      return {
        value: defaultValue,
        reason: ResolutionReason.ERROR,
        errorCode: ErrorCode.GENERAL,
        errorMessage: 'Provider is closed',
      }
    }

    const flag = this.flags.get(flagKey)

    // Flag not found
    if (!flag) {
      return {
        value: defaultValue,
        reason: ResolutionReason.DEFAULT,
        errorCode: ErrorCode.FLAG_NOT_FOUND,
        errorMessage: `Flag '${flagKey}' not found`,
      }
    }

    // Type mismatch
    if (flag.type !== expectedType) {
      return {
        value: defaultValue,
        reason: ResolutionReason.ERROR,
        errorCode: ErrorCode.TYPE_MISMATCH,
        errorMessage: `Flag '${flagKey}' is of type '${flag.type}', expected '${expectedType}'`,
      }
    }

    // Validate variations exist
    if (!flag.variations || flag.variations.length === 0) {
      return {
        value: defaultValue,
        reason: ResolutionReason.ERROR,
        errorCode: ErrorCode.PARSE_ERROR,
        errorMessage: `Flag '${flagKey}' has no variations defined`,
      }
    }

    // Check target matching first
    if (flag.targets && context.targetingKey) {
      for (const target of flag.targets) {
        if (target.values.includes(context.targetingKey)) {
          const variation = flag.variations[target.variation]
          const { value, variant } = this.extractVariationValue<T>(variation, target.variation)
          return {
            value: this.cloneIfObject(value),
            variant,
            reason: ResolutionReason.TARGETING_MATCH,
          }
        }
      }
    }

    // Check rule matching
    if (flag.rules) {
      for (const rule of flag.rules) {
        if (this.evaluateRule(rule, context)) {
          const variation = flag.variations[rule.variation]
          const { value, variant } = this.extractVariationValue<T>(variation, rule.variation)
          return {
            value: this.cloneIfObject(value),
            variant,
            reason: ResolutionReason.TARGETING_MATCH,
          }
        }
      }
    }

    // Return default variation
    const defaultVariationIndex = flag.defaultVariation
    const variation = flag.variations[defaultVariationIndex]
    const { value, variant } = this.extractVariationValue<T>(variation, defaultVariationIndex)

    return {
      value: this.cloneIfObject(value),
      variant,
      reason: ResolutionReason.STATIC,
    }
  }

  /**
   * Extract value and variant from a variation
   */
  private extractVariationValue<T>(
    variation: unknown,
    index: number
  ): { value: T; variant: string } {
    if (this.isNamedVariation(variation)) {
      return {
        value: variation.value as T,
        variant: variation.name,
      }
    }
    return {
      value: variation as T,
      variant: String(index),
    }
  }

  /**
   * Check if variation is a named variation
   */
  private isNamedVariation(variation: unknown): variation is NamedVariation<unknown> {
    return (
      typeof variation === 'object' &&
      variation !== null &&
      'name' in variation &&
      'value' in variation
    )
  }

  /**
   * Clone object values to preserve immutability
   */
  private cloneIfObject<T>(value: T): T {
    if (typeof value === 'object' && value !== null) {
      return JSON.parse(JSON.stringify(value)) as T
    }
    return value
  }

  /**
   * Evaluate a targeting rule against context
   */
  private evaluateRule(rule: FlagRule, context: EvaluationContext): boolean {
    return rule.clauses.every((clause) => this.evaluateClause(clause, context))
  }

  /**
   * Evaluate a single clause against context
   */
  private evaluateClause(clause: FlagClause, context: EvaluationContext): boolean {
    const attributeValue = context[clause.attribute]

    switch (clause.op) {
      case 'in':
        return clause.values.includes(attributeValue)
      case 'endsWith':
        if (typeof attributeValue !== 'string') return false
        return clause.values.some(
          (v) => typeof v === 'string' && attributeValue.endsWith(v)
        )
      case 'startsWith':
        if (typeof attributeValue !== 'string') return false
        return clause.values.some(
          (v) => typeof v === 'string' && attributeValue.startsWith(v)
        )
      case 'contains':
        if (typeof attributeValue !== 'string') return false
        return clause.values.some(
          (v) => typeof v === 'string' && attributeValue.includes(v)
        )
      case 'matches':
        if (typeof attributeValue !== 'string') return false
        return clause.values.some((v) => {
          if (typeof v !== 'string') return false
          try {
            return new RegExp(v).test(attributeValue)
          } catch {
            return false
          }
        })
      default:
        return false
    }
  }

  // ============================================================================
  // HOOK RUNNERS
  // ============================================================================

  /**
   * Run before hooks and collect context transformations.
   * Returns transformed context if any hook provides one.
   */
  private async runBeforeHooks(
    context: HookContext,
    hints: HookHints
  ): Promise<EvaluationContext | undefined> {
    let transformedContext: EvaluationContext | undefined

    for (const hook of this.hooks) {
      if (hook.before) {
        try {
          const result = await hook.before(context, hints)

          // Check if hook returned a context transformation
          if (result && typeof result === 'object' && 'context' in result && result.context) {
            transformedContext = result.context
            // Update hook context for subsequent before hooks
            context.context = transformedContext
          }
        } catch {
          // Hooks should not break evaluation
        }
      }
    }

    return transformedContext
  }

  private async runAfterHooks(
    context: HookContext,
    details: ResolutionDetails<unknown>,
    hints: HookHints
  ): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.after) {
        try {
          await hook.after(context, details, hints)
        } catch {
          // Hooks should not break evaluation
        }
      }
    }
  }

  private async runErrorHooks(
    context: HookContext,
    error: HookError,
    hints: HookHints
  ): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.error) {
        try {
          await hook.error(context, error, hints)
        } catch {
          // Hooks should not break evaluation
        }
      }
    }
  }

  private async runFinallyHooks(context: HookContext, hints: HookHints): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.finally) {
        try {
          await hook.finally(context, hints)
        } catch {
          // Hooks should not break evaluation
        }
      }
    }
  }

  // ============================================================================
  // HOOK UTILITIES
  // ============================================================================

  /**
   * Get all registered hooks
   */
  getHooks(): readonly Hook[] {
    return [...this.hooks]
  }

  /**
   * Remove a hook by reference or name
   */
  removeHook(hookOrName: Hook | string): boolean {
    const index =
      typeof hookOrName === 'string'
        ? this.hooks.findIndex((h) => h.name === hookOrName)
        : this.hooks.indexOf(hookOrName)

    if (index !== -1) {
      this.hooks.splice(index, 1)
      return true
    }
    return false
  }

  /**
   * Clear all hooks
   */
  clearHooks(): void {
    this.hooks = []
  }
}
