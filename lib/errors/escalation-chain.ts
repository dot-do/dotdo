/**
 * Error Escalation Chain
 *
 * Implements error escalation chains that cascade errors through capability tiers.
 * This module provides:
 *
 * 1. Error Classification (transient/permanent/escalatable)
 * 2. Severity Determination (low/medium/high/critical)
 * 3. Escalation Path Resolution
 * 4. Recovery Pattern Execution
 * 5. Graph Integration for Escalation Tracking
 *
 * The escalation chain follows the cascade executor pattern:
 * Code -> Generative -> Agentic -> Human
 *
 * Each tier can attempt recovery before escalating to the next tier.
 *
 * @module lib/errors/escalation-chain
 *
 * @example
 * ```typescript
 * import { ErrorEscalationChain, classifyError, determineSeverity } from 'dotdo/errors'
 *
 * const chain = new ErrorEscalationChain({
 *   tiers: ['code', 'generative', 'agentic', 'human'],
 *   maxRetries: 3,
 * })
 *
 * try {
 *   await riskyOperation()
 * } catch (error) {
 *   const classification = classifyError(error)
 *   if (classification.type === 'escalatable') {
 *     await chain.escalate(error, { context: { operation: 'riskyOperation' } })
 *   }
 * }
 * ```
 */

// ============================================================================
// ERROR CLASSIFICATION TYPES
// ============================================================================

/**
 * Error classification types
 * - transient: Temporary errors that may succeed on retry (network, rate limit)
 * - permanent: Errors that will never succeed (validation, auth)
 * - escalatable: Errors that need higher-tier intervention
 */
export type ErrorClassificationType = 'transient' | 'permanent' | 'escalatable'

/**
 * Severity levels for errors
 * - low: Minor issues, log and continue
 * - medium: Notable issues, may need attention
 * - high: Serious issues, likely need intervention
 * - critical: System-threatening issues, immediate escalation
 */
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical'

/**
 * Capability tiers for escalation (following CascadeExecutor pattern)
 */
export type CapabilityTier = 'code' | 'generative' | 'agentic' | 'human'

/**
 * Recovery patterns that can be applied to errors
 */
export type RecoveryPattern =
  | 'retry' // Simple retry with backoff
  | 'circuit-breaker' // Stop trying after threshold
  | 'fallback' // Use alternative approach
  | 'compensate' // Undo partial work
  | 'escalate' // Move to next tier
  | 'ignore' // Log and continue
  | 'fail-fast' // Stop immediately

// ============================================================================
// ERROR CLASSIFICATION
// ============================================================================

/**
 * Result of error classification
 */
export interface ErrorClassification {
  /** The classification type */
  type: ErrorClassificationType
  /** Severity level */
  severity: ErrorSeverity
  /** Whether the error is retryable */
  retryable: boolean
  /** Recommended recovery pattern */
  recoveryPattern: RecoveryPattern
  /** Error code if available */
  code?: string
  /** Additional classification metadata */
  metadata?: Record<string, unknown>
}

/**
 * Error codes that indicate transient errors (may succeed on retry)
 */
const TRANSIENT_ERROR_CODES = new Set([
  // Network errors
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  // Rate limiting
  'RATE_LIMIT',
  'RATE_LIMITED',
  'TOO_MANY_REQUESTS',
  // Temporary failures
  'TIMEOUT',
  'NETWORK_ERROR',
  'SERVICE_UNAVAILABLE',
  'GATEWAY_TIMEOUT',
  'BAD_GATEWAY',
  // HTTP status codes as strings
  '429',
  '500',
  '502',
  '503',
  '504',
])

/**
 * Error codes that indicate permanent errors (will never succeed)
 */
const PERMANENT_ERROR_CODES = new Set([
  // Validation
  'VALIDATION_ERROR',
  'INVALID_INPUT',
  'INVALID_ARGUMENT',
  'INVALID_REQUEST',
  'BAD_REQUEST',
  // Authentication/Authorization
  'AUTHENTICATION_ERROR',
  'AUTHORIZATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'ACCESS_DENIED',
  // Resource issues
  'NOT_FOUND',
  'CONFLICT',
  'ALREADY_EXISTS',
  'GONE',
  // Payment
  'CARD_DECLINED',
  'INSUFFICIENT_FUNDS',
  // HTTP status codes as strings
  '400',
  '401',
  '403',
  '404',
  '409',
  '410',
  '422',
])

/**
 * Extract error code from an error object
 */
function extractErrorCode(error: unknown): string | undefined {
  if (error === null || error === undefined) {
    return undefined
  }

  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>

    // Check common error code properties
    if (typeof obj.code === 'string') return obj.code
    if (typeof obj.errorCode === 'string') return obj.errorCode
    if (typeof obj.status === 'number') return String(obj.status)
    if (typeof obj.statusCode === 'number') return String(obj.statusCode)

    // Check nested error
    if (obj.error && typeof obj.error === 'object') {
      const nested = obj.error as Record<string, unknown>
      if (typeof nested.code === 'string') return nested.code
    }
  }

  return undefined
}

/**
 * Extract error message from an error object
 */
function extractErrorMessage(error: unknown): string {
  if (error === null || error === undefined) {
    return 'Unknown error'
  }

  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.error === 'string') return obj.error
  }

  return String(error)
}

/**
 * Classify an error to determine its type, severity, and recovery pattern.
 *
 * @param error - The error to classify
 * @returns Classification result with type, severity, and recovery pattern
 *
 * @example
 * ```typescript
 * const classification = classifyError(new Error('RATE_LIMIT'))
 * // { type: 'transient', severity: 'medium', retryable: true, recoveryPattern: 'retry' }
 * ```
 */
export function classifyError(error: unknown): ErrorClassification {
  const code = extractErrorCode(error)
  const message = extractErrorMessage(error)

  // Check if transient
  if (code && TRANSIENT_ERROR_CODES.has(code)) {
    return {
      type: 'transient',
      severity: determineSeverity(error),
      retryable: true,
      recoveryPattern: 'retry',
      code,
    }
  }

  // Check message for transient patterns
  const lowerMessage = message.toLowerCase()
  if (
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('rate limit') ||
    lowerMessage.includes('too many requests') ||
    lowerMessage.includes('service unavailable') ||
    lowerMessage.includes('temporarily') ||
    lowerMessage.includes('try again')
  ) {
    return {
      type: 'transient',
      severity: determineSeverity(error),
      retryable: true,
      recoveryPattern: 'retry',
      code,
    }
  }

  // Check if permanent
  if (code && PERMANENT_ERROR_CODES.has(code)) {
    return {
      type: 'permanent',
      severity: determineSeverity(error),
      retryable: false,
      recoveryPattern: 'fail-fast',
      code,
    }
  }

  // Check message for permanent patterns
  if (
    lowerMessage.includes('invalid') ||
    lowerMessage.includes('not found') ||
    lowerMessage.includes('unauthorized') ||
    lowerMessage.includes('forbidden') ||
    lowerMessage.includes('validation')
  ) {
    return {
      type: 'permanent',
      severity: determineSeverity(error),
      retryable: false,
      recoveryPattern: 'fail-fast',
      code,
    }
  }

  // Default to escalatable for unknown errors
  return {
    type: 'escalatable',
    severity: determineSeverity(error),
    retryable: false,
    recoveryPattern: 'escalate',
    code,
  }
}

// ============================================================================
// SEVERITY DETERMINATION
// ============================================================================

/**
 * Severity scores for different error indicators
 */
interface SeverityIndicators {
  codeScore: number
  messageScore: number
  typeScore: number
}

/**
 * Error codes mapped to severity levels
 */
const CODE_SEVERITY_MAP: Record<string, ErrorSeverity> = {
  // Critical
  'SYSTEM_ERROR': 'critical',
  'DATABASE_ERROR': 'critical',
  'DATA_CORRUPTION': 'critical',
  'SECURITY_VIOLATION': 'critical',
  'MEMORY_ERROR': 'critical',
  // High
  'AUTHENTICATION_ERROR': 'high',
  'AUTHORIZATION_ERROR': 'high',
  '500': 'high',
  '503': 'high',
  // Medium
  'RATE_LIMIT': 'medium',
  '429': 'medium',
  'TIMEOUT': 'medium',
  'NETWORK_ERROR': 'medium',
  // Low
  'VALIDATION_ERROR': 'low',
  'NOT_FOUND': 'low',
  '400': 'low',
  '404': 'low',
}

/**
 * Message patterns mapped to severity levels
 */
const MESSAGE_SEVERITY_PATTERNS: Array<[RegExp, ErrorSeverity]> = [
  // Critical patterns
  [/data\s*(loss|corrupt)/i, 'critical'],
  [/security\s*(breach|violation)/i, 'critical'],
  [/system\s*failure/i, 'critical'],
  [/out\s*of\s*memory/i, 'critical'],
  [/fatal/i, 'critical'],
  // High patterns
  [/authentication\s*(fail|error)/i, 'high'],
  [/unauthorized/i, 'high'],
  [/access\s*denied/i, 'high'],
  [/permission\s*denied/i, 'high'],
  [/internal\s*server\s*error/i, 'high'],
  // Medium patterns
  [/rate\s*limit/i, 'medium'],
  [/timeout/i, 'medium'],
  [/too\s*many\s*requests/i, 'medium'],
  [/temporarily/i, 'medium'],
  [/retry/i, 'medium'],
  // Low patterns (default)
  [/invalid/i, 'low'],
  [/not\s*found/i, 'low'],
  [/bad\s*request/i, 'low'],
]

/**
 * Convert severity to numeric score for comparison
 */
function severityToScore(severity: ErrorSeverity): number {
  switch (severity) {
    case 'critical':
      return 4
    case 'high':
      return 3
    case 'medium':
      return 2
    case 'low':
      return 1
    default:
      return 0
  }
}

/**
 * Convert numeric score to severity
 */
function scoreToSeverity(score: number): ErrorSeverity {
  if (score >= 4) return 'critical'
  if (score >= 3) return 'high'
  if (score >= 2) return 'medium'
  return 'low'
}

/**
 * Determine the severity of an error based on its code, message, and type.
 *
 * @param error - The error to analyze
 * @returns Severity level (low, medium, high, critical)
 *
 * @example
 * ```typescript
 * const severity = determineSeverity(new Error('Authentication failed'))
 * // 'high'
 * ```
 */
export function determineSeverity(error: unknown): ErrorSeverity {
  const code = extractErrorCode(error)
  const message = extractErrorMessage(error)

  let maxScore = 0

  // Check code-based severity
  if (code && CODE_SEVERITY_MAP[code]) {
    maxScore = Math.max(maxScore, severityToScore(CODE_SEVERITY_MAP[code]!))
  }

  // Check message patterns
  for (const [pattern, severity] of MESSAGE_SEVERITY_PATTERNS) {
    if (pattern.test(message)) {
      maxScore = Math.max(maxScore, severityToScore(severity))
      break // Use first match
    }
  }

  // Check if error has explicit severity
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>
    if (
      typeof obj.severity === 'string' &&
      ['low', 'medium', 'high', 'critical'].includes(obj.severity)
    ) {
      maxScore = Math.max(maxScore, severityToScore(obj.severity as ErrorSeverity))
    }
  }

  // Default to medium if no indicators found
  if (maxScore === 0) {
    maxScore = 2 // medium
  }

  return scoreToSeverity(maxScore)
}

// ============================================================================
// ESCALATION PATH
// ============================================================================

/**
 * An escalation step in the chain
 */
export interface EscalationStep {
  /** The capability tier */
  tier: CapabilityTier
  /** Whether this step was attempted */
  attempted: boolean
  /** Whether this step succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
  /** Duration in milliseconds */
  duration: number
  /** When the step started */
  timestamp: Date
  /** Recovery pattern applied */
  recoveryPattern?: RecoveryPattern
}

/**
 * The full escalation path taken
 */
export interface EscalationPath {
  /** Steps taken in the escalation */
  steps: EscalationStep[]
  /** When escalation started */
  startedAt: Date
  /** When escalation completed */
  completedAt?: Date
  /** Final tier that handled the error */
  finalTier?: CapabilityTier
  /** Whether escalation was exhausted (all tiers failed) */
  exhausted: boolean
  /** Original error that triggered escalation */
  originalError: {
    message: string
    code?: string
    classification: ErrorClassification
  }
}

/**
 * Options for resolving an escalation path
 */
export interface ResolvePathOptions {
  /** Starting tier (default: 'code') */
  startFrom?: CapabilityTier
  /** Tiers to skip */
  skipTiers?: CapabilityTier[]
  /** Maximum number of steps */
  maxSteps?: number
  /** Minimum severity to escalate (default: 'medium') */
  minSeverityToEscalate?: ErrorSeverity
}

/**
 * The tier order for escalation
 */
const TIER_ORDER: CapabilityTier[] = ['code', 'generative', 'agentic', 'human']

/**
 * Resolve the escalation path for an error based on its classification.
 *
 * @param classification - The error classification
 * @param options - Path resolution options
 * @returns Array of tiers to try in order
 *
 * @example
 * ```typescript
 * const classification = classifyError(error)
 * const path = resolveEscalationPath(classification, { startFrom: 'generative' })
 * // ['generative', 'agentic', 'human']
 * ```
 */
export function resolveEscalationPath(
  classification: ErrorClassification,
  options: ResolvePathOptions = {}
): CapabilityTier[] {
  const {
    startFrom = 'code',
    skipTiers = [],
    maxSteps = TIER_ORDER.length,
    minSeverityToEscalate = 'medium',
  } = options

  // Check if severity is high enough to escalate
  const severityScore = severityToScore(classification.severity)
  const minScore = severityToScore(minSeverityToEscalate)

  if (severityScore < minScore) {
    // Only return the starting tier for low-severity errors
    return skipTiers.includes(startFrom) ? [] : [startFrom]
  }

  // Find starting index
  const startIndex = TIER_ORDER.indexOf(startFrom)
  if (startIndex === -1) {
    return []
  }

  // Build path from starting tier
  const path: CapabilityTier[] = []
  const skipSet = new Set(skipTiers)

  for (let i = startIndex; i < TIER_ORDER.length && path.length < maxSteps; i++) {
    const tier = TIER_ORDER[i]!
    if (!skipSet.has(tier)) {
      path.push(tier)
    }
  }

  // For permanent errors, only include the first tier
  if (classification.type === 'permanent') {
    return path.slice(0, 1)
  }

  return path
}

// ============================================================================
// RECOVERY PATTERNS
// ============================================================================

/**
 * Configuration for a recovery pattern
 */
export interface RecoveryConfig {
  /** Maximum retry attempts */
  maxRetries?: number
  /** Initial delay in ms for exponential backoff */
  initialDelay?: number
  /** Maximum delay in ms */
  maxDelay?: number
  /** Backoff multiplier */
  multiplier?: number
  /** Jitter factor (0-1) */
  jitter?: number
  /** Timeout for recovery attempt */
  timeout?: number
  /** Fallback value or function */
  fallback?: unknown | (() => unknown)
  /** Compensation function */
  compensate?: () => Promise<void>
}

/**
 * Result of executing a recovery pattern
 */
export interface RecoveryResult<T = unknown> {
  /** Whether recovery succeeded */
  success: boolean
  /** Recovered value on success */
  value?: T
  /** Error if recovery failed */
  error?: Error
  /** Pattern that was executed */
  pattern: RecoveryPattern
  /** Number of attempts made */
  attempts: number
  /** Total duration in ms */
  duration: number
}

/**
 * Default recovery configuration
 */
const DEFAULT_RECOVERY_CONFIG: Required<Omit<RecoveryConfig, 'fallback' | 'compensate'>> = {
  maxRetries: 3,
  initialDelay: 100,
  maxDelay: 5000,
  multiplier: 2,
  jitter: 0.25,
  timeout: 30000,
}

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoffDelay(
  attempt: number,
  config: Required<Omit<RecoveryConfig, 'fallback' | 'compensate'>>
): number {
  const baseDelay = config.initialDelay * Math.pow(config.multiplier, attempt - 1)
  const cappedDelay = Math.min(baseDelay, config.maxDelay)

  if (config.jitter > 0) {
    const jitterFactor = 1 + (Math.random() * 2 - 1) * config.jitter
    return Math.round(cappedDelay * jitterFactor)
  }

  return cappedDelay
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Execute a recovery pattern for an error.
 *
 * @param pattern - The recovery pattern to execute
 * @param operation - The operation to recover
 * @param config - Recovery configuration
 * @returns Recovery result with success status and value
 *
 * @example
 * ```typescript
 * const result = await executeRecovery('retry', async () => {
 *   return await riskyApiCall()
 * }, { maxRetries: 3 })
 *
 * if (result.success) {
 *   console.log('Recovered:', result.value)
 * }
 * ```
 */
export async function executeRecovery<T>(
  pattern: RecoveryPattern,
  operation: () => Promise<T>,
  config: RecoveryConfig = {}
): Promise<RecoveryResult<T>> {
  const fullConfig = { ...DEFAULT_RECOVERY_CONFIG, ...config }
  const startTime = Date.now()
  let attempts = 0
  let lastError: Error | undefined

  switch (pattern) {
    case 'retry': {
      while (attempts < fullConfig.maxRetries) {
        attempts++
        try {
          const value = await operation()
          return {
            success: true,
            value,
            pattern,
            attempts,
            duration: Date.now() - startTime,
          }
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))

          if (attempts < fullConfig.maxRetries) {
            const delay = calculateBackoffDelay(attempts, fullConfig)
            await sleep(delay)
          }
        }
      }

      return {
        success: false,
        error: lastError,
        pattern,
        attempts,
        duration: Date.now() - startTime,
      }
    }

    case 'fallback': {
      attempts = 1
      try {
        const value = await operation()
        return {
          success: true,
          value,
          pattern,
          attempts,
          duration: Date.now() - startTime,
        }
      } catch {
        // Use fallback
        const fallbackValue =
          typeof config.fallback === 'function' ? config.fallback() : config.fallback

        return {
          success: true,
          value: fallbackValue as T,
          pattern,
          attempts,
          duration: Date.now() - startTime,
        }
      }
    }

    case 'compensate': {
      attempts = 1
      try {
        const value = await operation()
        return {
          success: true,
          value,
          pattern,
          attempts,
          duration: Date.now() - startTime,
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Execute compensation
        if (config.compensate) {
          try {
            await config.compensate()
          } catch {
            // Compensation failed, but we still report the original error
          }
        }

        return {
          success: false,
          error: lastError,
          pattern,
          attempts,
          duration: Date.now() - startTime,
        }
      }
    }

    case 'circuit-breaker':
    case 'escalate':
    case 'ignore':
    case 'fail-fast':
    default: {
      // These patterns don't retry the operation
      attempts = 1
      try {
        const value = await operation()
        return {
          success: true,
          value,
          pattern,
          attempts,
          duration: Date.now() - startTime,
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          pattern,
          attempts,
          duration: Date.now() - startTime,
        }
      }
    }
  }
}

// ============================================================================
// ESCALATION CHAIN
// ============================================================================

/**
 * Handler function for a capability tier
 */
export type TierHandler<T = unknown> = (
  error: unknown,
  context: EscalationContext
) => Promise<T> | T

/**
 * Context passed to tier handlers
 */
export interface EscalationContext {
  /** The error being escalated */
  error: unknown
  /** Error classification */
  classification: ErrorClassification
  /** Previous escalation steps */
  previousSteps: EscalationStep[]
  /** Additional context data */
  data?: Record<string, unknown>
  /** Invocation ID for tracking */
  invocationId: string
}

/**
 * Configuration for the escalation chain
 */
export interface EscalationChainConfig {
  /** Ordered list of tiers to use */
  tiers?: CapabilityTier[]
  /** Maximum retries per tier */
  maxRetriesPerTier?: number
  /** Timeout per tier in ms */
  tierTimeout?: number
  /** Global timeout in ms */
  globalTimeout?: number
  /** Minimum severity to escalate beyond first tier */
  minSeverityToEscalate?: ErrorSeverity
  /** Callback when escalation starts */
  onEscalationStart?: (context: EscalationContext) => void | Promise<void>
  /** Callback when a tier starts */
  onTierStart?: (tier: CapabilityTier, context: EscalationContext) => void | Promise<void>
  /** Callback when a tier completes */
  onTierComplete?: (step: EscalationStep, context: EscalationContext) => void | Promise<void>
  /** Callback when escalation completes */
  onEscalationComplete?: (path: EscalationPath) => void | Promise<void>
}

/**
 * Options for escalating an error
 */
export interface EscalateOptions {
  /** Starting tier */
  startFrom?: CapabilityTier
  /** Additional context data */
  context?: Record<string, unknown>
  /** Custom handlers for tiers */
  handlers?: Partial<Record<CapabilityTier, TierHandler>>
  /** Recovery config to use */
  recoveryConfig?: RecoveryConfig
}

/**
 * Result of an escalation
 */
export interface EscalationResult<T = unknown> {
  /** Whether escalation succeeded */
  success: boolean
  /** Result value if succeeded */
  result?: T
  /** The escalation path taken */
  path: EscalationPath
  /** Final error if failed */
  error?: Error
}

/**
 * Error thrown when all escalation tiers are exhausted
 */
export class EscalationExhaustedError extends Error {
  name = 'EscalationExhaustedError'
  path: EscalationPath
  errors: Error[]

  constructor(message: string, path: EscalationPath, errors: Error[]) {
    super(message)
    this.path = path
    this.errors = errors
  }
}

/**
 * Error thrown when escalation times out
 */
export class EscalationTimeoutError extends Error {
  name = 'EscalationTimeoutError'
  path: EscalationPath

  constructor(message: string, path: EscalationPath) {
    super(message)
    this.path = path
  }
}

/**
 * Default tier handlers
 */
const DEFAULT_TIER_HANDLERS: Record<CapabilityTier, TierHandler> = {
  code: async (_error, _context) => {
    // Default code handler - just rethrows (actual implementation would attempt automatic fix)
    throw new Error('Code tier handler not implemented')
  },
  generative: async (_error, _context) => {
    // Default generative handler - would use AI to suggest fix
    throw new Error('Generative tier handler not implemented')
  },
  agentic: async (_error, _context) => {
    // Default agentic handler - would use AI agent with tools
    throw new Error('Agentic tier handler not implemented')
  },
  human: async (_error, _context) => {
    // Default human handler - would create human escalation request
    throw new Error('Human tier handler not implemented')
  },
}

/**
 * ErrorEscalationChain manages error escalation through capability tiers.
 *
 * The chain follows the cascade pattern: Code -> Generative -> Agentic -> Human
 * Each tier attempts to handle the error before escalating to the next.
 *
 * @example
 * ```typescript
 * const chain = new ErrorEscalationChain({
 *   tiers: ['code', 'generative', 'agentic', 'human'],
 *   maxRetriesPerTier: 2,
 *   onEscalationComplete: (path) => {
 *     console.log('Escalation completed:', path.finalTier)
 *   },
 * })
 *
 * // Register custom handlers
 * chain.registerHandler('code', async (error, context) => {
 *   // Attempt automatic fix
 *   return await autoFix(error)
 * })
 *
 * // Escalate an error
 * const result = await chain.escalate(new Error('Something went wrong'))
 * ```
 */
export class ErrorEscalationChain {
  private config: Required<EscalationChainConfig>
  private handlers: Map<CapabilityTier, TierHandler> = new Map()

  constructor(config: EscalationChainConfig = {}) {
    this.config = {
      tiers: config.tiers ?? TIER_ORDER,
      maxRetriesPerTier: config.maxRetriesPerTier ?? 3,
      tierTimeout: config.tierTimeout ?? 30000,
      globalTimeout: config.globalTimeout ?? 120000,
      minSeverityToEscalate: config.minSeverityToEscalate ?? 'medium',
      onEscalationStart: config.onEscalationStart ?? (() => {}),
      onTierStart: config.onTierStart ?? (() => {}),
      onTierComplete: config.onTierComplete ?? (() => {}),
      onEscalationComplete: config.onEscalationComplete ?? (() => {}),
    }

    // Initialize with default handlers
    for (const tier of TIER_ORDER) {
      this.handlers.set(tier, DEFAULT_TIER_HANDLERS[tier])
    }
  }

  /**
   * Register a handler for a capability tier.
   *
   * @param tier - The tier to register the handler for
   * @param handler - The handler function
   */
  registerHandler<T>(tier: CapabilityTier, handler: TierHandler<T>): void {
    this.handlers.set(tier, handler as TierHandler)
  }

  /**
   * Escalate an error through the capability tiers.
   *
   * @param error - The error to escalate
   * @param options - Escalation options
   * @returns Escalation result
   */
  async escalate<T = unknown>(
    error: unknown,
    options: EscalateOptions = {}
  ): Promise<EscalationResult<T>> {
    const startedAt = new Date()
    const invocationId = crypto.randomUUID()
    const classification = classifyError(error)
    const steps: EscalationStep[] = []
    const errors: Error[] = []

    // Resolve escalation path
    const path = resolveEscalationPath(classification, {
      startFrom: options.startFrom ?? 'code',
      minSeverityToEscalate: this.config.minSeverityToEscalate,
    })

    // Build initial context
    const context: EscalationContext = {
      error,
      classification,
      previousSteps: [],
      data: options.context,
      invocationId,
    }

    // Notify escalation start
    await this.config.onEscalationStart(context)

    // Set up global timeout
    const globalTimeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new EscalationTimeoutError('Global escalation timeout', this.buildPath(steps, startedAt, classification, error)))
      }, this.config.globalTimeout)
    })

    // Process each tier
    let result: T | undefined
    let success = false

    for (const tier of path) {
      // Get handler (use custom if provided, otherwise registered handler)
      const handler = options.handlers?.[tier] ?? this.handlers.get(tier)
      if (!handler) {
        continue
      }

      const stepStart = Date.now()

      // Notify tier start
      await this.config.onTierStart(tier, { ...context, previousSteps: [...steps] })

      try {
        // Execute handler with timeout
        const tierResult = await Promise.race([
          this.executeTierHandler(tier, handler, error, context, options.recoveryConfig),
          globalTimeoutPromise,
        ])

        // Handler succeeded
        const step: EscalationStep = {
          tier,
          attempted: true,
          success: true,
          duration: Date.now() - stepStart,
          timestamp: new Date(stepStart),
          recoveryPattern: classification.recoveryPattern,
        }
        steps.push(step)

        // Notify tier complete
        await this.config.onTierComplete(step, { ...context, previousSteps: [...steps] })

        result = tierResult as T
        success = true
        break
      } catch (tierError) {
        const errorObj = tierError instanceof Error ? tierError : new Error(String(tierError))
        errors.push(errorObj)

        // Record failed step
        const step: EscalationStep = {
          tier,
          attempted: true,
          success: false,
          error: errorObj.message,
          duration: Date.now() - stepStart,
          timestamp: new Date(stepStart),
          recoveryPattern: classification.recoveryPattern,
        }
        steps.push(step)

        // Notify tier complete
        await this.config.onTierComplete(step, { ...context, previousSteps: [...steps] })

        // Update context for next tier
        context.previousSteps = [...steps]
      }
    }

    // Build final path
    const finalPath = this.buildPath(steps, startedAt, classification, error)
    finalPath.completedAt = new Date()
    finalPath.finalTier = steps.find((s) => s.success)?.tier
    finalPath.exhausted = !success

    // Notify escalation complete
    await this.config.onEscalationComplete(finalPath)

    if (!success) {
      return {
        success: false,
        path: finalPath,
        error: new EscalationExhaustedError(
          `All escalation tiers exhausted: ${errors.map((e) => e.message).join(', ')}`,
          finalPath,
          errors
        ),
      }
    }

    return {
      success: true,
      result,
      path: finalPath,
    }
  }

  /**
   * Execute a tier handler with retry logic
   */
  private async executeTierHandler<T>(
    tier: CapabilityTier,
    handler: TierHandler,
    error: unknown,
    context: EscalationContext,
    recoveryConfig?: RecoveryConfig
  ): Promise<T> {
    const classification = context.classification

    // Use recovery pattern based on classification
    if (classification.type === 'transient' && classification.recoveryPattern === 'retry') {
      const result = await executeRecovery<T>(
        'retry',
        () => handler(error, context) as Promise<T>,
        {
          maxRetries: this.config.maxRetriesPerTier,
          timeout: this.config.tierTimeout,
          ...recoveryConfig,
        }
      )

      if (result.success) {
        return result.value!
      }

      throw result.error
    }

    // For other patterns, execute directly
    return handler(error, context) as Promise<T>
  }

  /**
   * Build an EscalationPath object
   */
  private buildPath(
    steps: EscalationStep[],
    startedAt: Date,
    classification: ErrorClassification,
    originalError: unknown
  ): EscalationPath {
    return {
      steps,
      startedAt,
      exhausted: false,
      originalError: {
        message: extractErrorMessage(originalError),
        code: extractErrorCode(originalError),
        classification,
      },
    }
  }

  /**
   * Get the current configuration
   */
  getConfig(): Required<EscalationChainConfig> {
    return { ...this.config }
  }
}

// ============================================================================
// GRAPH INTEGRATION
// ============================================================================

/**
 * Escalation tracking record for graph storage
 */
export interface EscalationRecord {
  /** Unique escalation ID */
  id: string
  /** Invocation ID for correlation */
  invocationId: string
  /** When escalation started */
  startedAt: number
  /** When escalation completed */
  completedAt?: number
  /** Whether escalation succeeded */
  success: boolean
  /** Final tier that handled the error */
  finalTier?: CapabilityTier
  /** All escalation steps */
  steps: EscalationStep[]
  /** Original error info */
  originalError: {
    message: string
    code?: string
    classification: ErrorClassification
  }
  /** Whether all tiers were exhausted */
  exhausted: boolean
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * In-memory store for escalation records (per-db isolation)
 */
const escalationRecordStores = new WeakMap<object, Map<string, EscalationRecord>>()

/**
 * Get or create the escalation record store for a database
 */
function getEscalationRecordStore(db: object): Map<string, EscalationRecord> {
  let store = escalationRecordStores.get(db)
  if (!store) {
    store = new Map()
    escalationRecordStores.set(db, store)
  }
  return store
}

/**
 * ID counter for escalation records
 */
let escalationIdCounter = 0

/**
 * Generate a unique escalation record ID
 */
function generateEscalationRecordId(): string {
  escalationIdCounter++
  return `erresc-${Date.now().toString(36)}-${escalationIdCounter.toString(36)}`
}

/**
 * Track an escalation in the graph.
 *
 * @param db - Database instance (or empty object for testing)
 * @param path - The escalation path to track
 * @param metadata - Additional metadata
 * @returns The created escalation record
 */
export async function trackEscalation(
  db: object,
  path: EscalationPath,
  metadata?: Record<string, unknown>
): Promise<EscalationRecord> {
  const store = getEscalationRecordStore(db)

  const record: EscalationRecord = {
    id: generateEscalationRecordId(),
    invocationId: crypto.randomUUID(),
    startedAt: path.startedAt.getTime(),
    completedAt: path.completedAt?.getTime(),
    success: !path.exhausted,
    finalTier: path.finalTier,
    steps: path.steps,
    originalError: path.originalError,
    exhausted: path.exhausted,
    metadata,
  }

  store.set(record.id, record)

  return record
}

/**
 * Get an escalation record by ID.
 *
 * @param db - Database instance
 * @param id - Escalation record ID
 * @returns The escalation record or null
 */
export async function getEscalationRecord(
  db: object,
  id: string
): Promise<EscalationRecord | null> {
  const store = getEscalationRecordStore(db)
  return store.get(id) ?? null
}

/**
 * Query escalation records by various criteria.
 *
 * @param db - Database instance
 * @param options - Query options
 * @returns Array of matching escalation records
 */
export async function queryEscalationRecords(
  db: object,
  options: {
    success?: boolean
    finalTier?: CapabilityTier
    severity?: ErrorSeverity
    since?: Date
    limit?: number
  } = {}
): Promise<EscalationRecord[]> {
  const store = getEscalationRecordStore(db)
  const { success, finalTier, severity, since, limit = 100 } = options

  let results: EscalationRecord[] = []

  for (const record of Array.from(store.values())) {
    // Apply filters
    if (success !== undefined && record.success !== success) continue
    if (finalTier !== undefined && record.finalTier !== finalTier) continue
    if (severity !== undefined && record.originalError.classification.severity !== severity) continue
    if (since !== undefined && record.startedAt < since.getTime()) continue

    results.push(record)
  }

  // Sort by startedAt descending (newest first)
  results.sort((a, b) => b.startedAt - a.startedAt)

  // Apply limit
  if (limit > 0) {
    results = results.slice(0, limit)
  }

  return results
}

/**
 * Get escalation statistics.
 *
 * @param db - Database instance
 * @param options - Statistics options
 * @returns Escalation statistics
 */
export async function getEscalationStats(
  db: object,
  options: { since?: Date } = {}
): Promise<{
  total: number
  succeeded: number
  exhausted: number
  byTier: Record<CapabilityTier, number>
  bySeverity: Record<ErrorSeverity, number>
  averageDuration: number
}> {
  const records = await queryEscalationRecords(db, {
    since: options.since,
    limit: 0, // No limit for stats
  })

  const stats = {
    total: records.length,
    succeeded: 0,
    exhausted: 0,
    byTier: { code: 0, generative: 0, agentic: 0, human: 0 } as Record<CapabilityTier, number>,
    bySeverity: { low: 0, medium: 0, high: 0, critical: 0 } as Record<ErrorSeverity, number>,
    averageDuration: 0,
  }

  let totalDuration = 0

  for (const record of records) {
    if (record.success) {
      stats.succeeded++
    }
    if (record.exhausted) {
      stats.exhausted++
    }
    if (record.finalTier) {
      stats.byTier[record.finalTier]++
    }
    stats.bySeverity[record.originalError.classification.severity]++

    if (record.completedAt) {
      totalDuration += record.completedAt - record.startedAt
    }
  }

  if (records.length > 0) {
    stats.averageDuration = Math.round(totalDuration / records.length)
  }

  return stats
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  extractErrorCode,
  extractErrorMessage,
  TIER_ORDER,
  DEFAULT_RECOVERY_CONFIG,
}
