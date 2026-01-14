/**
 * Determinism Enforcement Module
 *
 * Runtime detection and prevention of non-deterministic patterns in workflows.
 * Workflows MUST be deterministic to support replay - given the same inputs
 * and history, they must produce the same sequence of commands.
 */

import type { WorkflowState } from './types'

// ============================================================================
// DETERMINISM CONFIGURATION
// ============================================================================

/**
 * Configuration for determinism enforcement
 */
interface DeterminismConfig {
  /** Whether to warn about non-deterministic operations (default: true in dev, false in prod) */
  warnOnNonDeterministic: boolean
}

// Default configuration - warn in development, silent in production
let determinismConfig: DeterminismConfig = {
  warnOnNonDeterministic: typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production',
}

/**
 * Configure determinism enforcement settings
 *
 * @example
 * ```typescript
 * import { configureDeterminism } from '@dotdo/temporal'
 *
 * // Disable warnings in tests
 * configureDeterminism({ warnOnNonDeterministic: false })
 *
 * // Enable warnings in production for debugging
 * configureDeterminism({ warnOnNonDeterministic: true })
 * ```
 */
export function configureDeterminism(config: Partial<DeterminismConfig>): void {
  determinismConfig = { ...determinismConfig, ...config }
}

/**
 * Get current determinism configuration
 */
export function getDeterminismConfig(): DeterminismConfig {
  return { ...determinismConfig }
}

// ============================================================================
// VIOLATION TYPES
// ============================================================================

/**
 * Types of non-deterministic operations that can be detected
 */
export type DeterminismViolationType =
  | 'Date.now'
  | 'new Date'
  | 'Math.random'
  | 'crypto.randomUUID'
  | 'fetch'
  | 'setTimeout'
  | 'setInterval'

// ============================================================================
// WARNING CLASS
// ============================================================================

/**
 * Warning class for tracking determinism violations.
 * These are logged in development mode to help identify potential replay issues.
 */
export class WorkflowDeterminismWarning {
  /** Type of non-deterministic operation detected */
  readonly type: DeterminismViolationType

  /** Human-readable message describing the violation */
  readonly message: string

  /** Stack trace showing where the violation occurred */
  readonly stack: string | undefined

  /** Workflow ID where the violation was detected (if available) */
  readonly workflowId: string | undefined

  /** Suggested alternative to use instead */
  readonly suggestion: string

  /** Timestamp when the warning was created */
  readonly timestamp: Date

  constructor(
    type: DeterminismViolationType,
    message: string,
    suggestion: string,
    workflowId?: string
  ) {
    this.type = type
    this.message = message
    this.suggestion = suggestion
    this.workflowId = workflowId
    this.timestamp = new Date()
    this.stack = new Error().stack
  }

  /**
   * Format the warning for console output
   */
  toString(): string {
    const workflowInfo = this.workflowId ? ` in workflow ${this.workflowId}` : ''
    return `[WorkflowDeterminismWarning]${workflowInfo}: ${this.message}\n  Suggestion: ${this.suggestion}`
  }
}

// ============================================================================
// WARNING TRACKING
// ============================================================================

/**
 * Track warnings for analysis (limited to prevent memory leaks)
 */
const MAX_WARNINGS = 100
const determinismWarnings: WorkflowDeterminismWarning[] = []

/**
 * Get all recorded determinism warnings
 */
export function getDeterminismWarnings(): readonly WorkflowDeterminismWarning[] {
  return determinismWarnings
}

/**
 * Clear all recorded determinism warnings
 */
export function clearDeterminismWarnings(): void {
  determinismWarnings.length = 0
}

// ============================================================================
// WARNING FUNCTION
// ============================================================================

// Callback to get current workflow - set by context module to avoid circular deps
let getCurrentWorkflowFn: (() => WorkflowState | null) | null = null

/**
 * Set the function to get current workflow (called by context module)
 */
export function setGetCurrentWorkflowFn(fn: () => WorkflowState | null): void {
  getCurrentWorkflowFn = fn
}

/**
 * Record a determinism violation warning
 */
export function warnNonDeterministic(
  type: DeterminismViolationType,
  message: string,
  suggestion: string
): void {
  // Only warn if enabled and we're in a workflow context
  const workflow = getCurrentWorkflowFn?.()
  if (!determinismConfig.warnOnNonDeterministic || !workflow) {
    return
  }

  const warning = new WorkflowDeterminismWarning(
    type,
    message,
    suggestion,
    workflow.workflowId
  )

  // Store warning (with limit to prevent memory leaks)
  if (determinismWarnings.length < MAX_WARNINGS) {
    determinismWarnings.push(warning)
  }

  // Log to console in development
  console.warn(warning.toString())
}

// ============================================================================
// NON-DETERMINISTIC PATTERN DETECTION
// ============================================================================

// Store original functions for restoration and proxying
const originalDateNow = Date.now
const originalMathRandom = Math.random
const originalFetch = typeof fetch !== 'undefined' ? fetch : undefined
const originalSetTimeout = setTimeout
const originalSetInterval = setInterval

/**
 * Wrapped Date.now that warns about non-deterministic usage in workflows
 */
function wrappedDateNow(): number {
  const workflow = getCurrentWorkflowFn?.()
  if (workflow && determinismConfig.warnOnNonDeterministic) {
    warnNonDeterministic(
      'Date.now',
      'Date.now() is non-deterministic and will return different values on replay',
      'Use workflowNow() for deterministic timestamps'
    )
  }
  return originalDateNow.call(Date)
}

/**
 * Wrapped Math.random that warns about non-deterministic usage in workflows
 */
function wrappedMathRandom(): number {
  const workflow = getCurrentWorkflowFn?.()
  if (workflow && determinismConfig.warnOnNonDeterministic) {
    warnNonDeterministic(
      'Math.random',
      'Math.random() is non-deterministic and will return different values on replay',
      'Use random() for deterministic random numbers'
    )
  }
  return originalMathRandom.call(Math)
}

/**
 * Wrapped fetch that warns about non-deterministic usage in workflows
 */
function wrappedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const workflow = getCurrentWorkflowFn?.()
  if (workflow && determinismConfig.warnOnNonDeterministic) {
    warnNonDeterministic(
      'fetch',
      'fetch() is non-deterministic - network responses can vary between executions',
      'Use activities (proxyActivities) for network calls'
    )
  }
  return originalFetch!(input, init)
}

/**
 * Wrapped setTimeout that warns about non-deterministic usage in workflows
 */
function wrappedSetTimeout<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  ms?: number,
  ...args: TArgs
): ReturnType<typeof setTimeout> {
  const workflow = getCurrentWorkflowFn?.()
  if (workflow && determinismConfig.warnOnNonDeterministic) {
    warnNonDeterministic(
      'setTimeout',
      'setTimeout() is non-deterministic - timing varies between executions',
      'Use sleep() or createTimer() for durable delays'
    )
  }
  return originalSetTimeout(callback, ms, ...args)
}

/**
 * Wrapped setInterval that warns about non-deterministic usage in workflows
 */
function wrappedSetInterval<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  ms?: number,
  ...args: TArgs
): ReturnType<typeof setInterval> {
  const workflow = getCurrentWorkflowFn?.()
  if (workflow && determinismConfig.warnOnNonDeterministic) {
    warnNonDeterministic(
      'setInterval',
      'setInterval() is non-deterministic - timing varies between executions',
      'Use sleep() in a loop or schedule recurring activities'
    )
  }
  return originalSetInterval(callback, ms, ...args)
}

// ============================================================================
// DETECTION ENABLE/DISABLE
// ============================================================================

/**
 * Enable determinism detection by patching global functions.
 * This is automatically called when the module loads in development mode.
 *
 * Note: This patches global objects, which may affect other code.
 * Use with caution in shared environments.
 */
export function enableDeterminismDetection(): void {
  // Only patch if we're configured to warn
  if (!determinismConfig.warnOnNonDeterministic) {
    return
  }

  // Patch Date.now
  Date.now = wrappedDateNow

  // Patch Math.random
  Math.random = wrappedMathRandom

  // Patch fetch if available
  if (originalFetch && typeof globalThis !== 'undefined') {
    ;(globalThis as Record<string, unknown>).fetch = wrappedFetch
  }

  // Note: setTimeout and setInterval are intentionally not patched by default
  // as they're used internally by the workflow runtime.
}

/**
 * Disable determinism detection and restore original functions.
 */
export function disableDeterminismDetection(): void {
  Date.now = originalDateNow
  Math.random = originalMathRandom

  if (originalFetch && typeof globalThis !== 'undefined') {
    ;(globalThis as Record<string, unknown>).fetch = originalFetch
  }
}
