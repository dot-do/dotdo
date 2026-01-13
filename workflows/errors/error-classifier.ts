/**
 * Error Classifier
 *
 * Classifies errors for the escalation chain system. Determines:
 * - Classification type (transient, permanent, escalatable, recoverable)
 * - Severity level (low, medium, high, critical)
 * - Retryability and retry parameters
 * - Escalation path recommendations
 *
 * @module workflows/errors/error-classifier
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Error classification types
 */
export type ErrorClassification = 'transient' | 'permanent' | 'escalatable' | 'recoverable'

/**
 * Error severity levels
 */
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical'

/**
 * Capability tier in the escalation chain
 */
export type CapabilityTier = 'code' | 'generative' | 'agentic' | 'human'

/**
 * Classified error with full metadata
 */
export interface ClassifiedError {
  /** Original error */
  error: Error
  /** Classification type */
  classification: ErrorClassification
  /** Severity level */
  severity: ErrorSeverity
  /** Whether this error is retryable */
  retryable: boolean
  /** Retry count before classification */
  retryCount: number
  /** Maximum retries before escalation */
  maxRetries: number
  /** Delay before retry in ms */
  retryDelay?: number
  /** Current capability tier */
  currentTier: CapabilityTier
  /** Next tier to escalate to (if escalatable) */
  nextTier?: CapabilityTier
  /** Reason for classification */
  reason: string
  /** Additional context */
  context?: Record<string, unknown>
}

/**
 * Options for error classification
 */
export interface ClassifyOptions {
  /** Current capability tier */
  currentTier?: CapabilityTier
  /** Additional context */
  context?: Record<string, unknown>
  /** Custom classification rules */
  rules?: ClassificationRule[]
}

/**
 * Custom classification rule
 */
export interface ClassificationRule {
  /** Match function */
  match: (error: Error) => boolean
  /** Classification to apply */
  classification: ErrorClassification
  /** Severity to apply */
  severity?: ErrorSeverity
  /** Retry settings */
  retryable?: boolean
  maxRetries?: number
  retryDelay?: number
}

// ============================================================================
// ERROR CODE SETS
// ============================================================================

/**
 * Error codes/patterns indicating transient errors
 */
const TRANSIENT_PATTERNS = new Set([
  // Network errors
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  // Rate limiting
  'RATE_LIMIT',
  'TOO_MANY_REQUESTS',
  'TRANSIENT',
  // HTTP status codes
  '429',
  '500',
  '502',
  '503',
  '504',
])

/**
 * Error codes/patterns indicating permanent errors
 */
const PERMANENT_PATTERNS = new Set([
  // Validation
  'VALIDATION_ERROR',
  'INVALID_INPUT',
  'INVALID_ARGUMENT',
  // Auth
  'UNAUTHORIZED',
  'FORBIDDEN',
  'ACCESS_DENIED',
  // Resource
  'NOT_FOUND',
  'CONFLICT',
  'ALREADY_EXISTS',
  // HTTP status codes
  '400',
  '401',
  '403',
  '404',
  '409',
  '422',
])

/**
 * Error codes indicating escalatable errors
 */
const ESCALATABLE_PATTERNS = new Set([
  'COMPLEX_LOGIC',
  'MODEL_FAILURE',
  'AGENT_EXHAUSTED',
  'REQUIRES_HUMAN',
  'AMBIGUOUS_INPUT',
])

/**
 * Patterns that indicate specific severity levels
 */
const SEVERITY_PATTERNS: Record<ErrorSeverity, Set<string>> = {
  critical: new Set(['DATA_CORRUPTION', 'SYSTEM_ERROR', 'FATAL']),
  high: new Set(['SECURITY_VIOLATION', 'UNAUTHORIZED', 'FORBIDDEN', '401', '403']),
  medium: new Set(['RATE_LIMIT', 'TIMEOUT', '429', '500', '503']),
  low: new Set(['VALIDATION_ERROR', 'NOT_FOUND', 'FEATURE_UNAVAILABLE', '400', '404']),
}

// ============================================================================
// TIER ESCALATION MAP
// ============================================================================

const TIER_ORDER: CapabilityTier[] = ['code', 'generative', 'agentic', 'human']

function getNextTier(currentTier: CapabilityTier): CapabilityTier | undefined {
  const index = TIER_ORDER.indexOf(currentTier)
  if (index === -1 || index >= TIER_ORDER.length - 1) {
    return undefined
  }
  return TIER_ORDER[index + 1]
}

// ============================================================================
// ERROR PROPERTY EXTRACTION
// ============================================================================

/**
 * Extract error code from various error shapes
 */
function extractErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined

  const obj = error as Record<string, unknown>

  // Check common code properties
  if (typeof obj.code === 'string') return obj.code
  if (typeof obj.errorCode === 'string') return obj.errorCode
  if (typeof obj.status === 'number') return String(obj.status)
  if (typeof obj.statusCode === 'number') return String(obj.statusCode)

  return undefined
}

/**
 * Extract error message
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>
    if (typeof obj.message === 'string') return obj.message
  }
  return 'Unknown error'
}

/**
 * Extract HTTP status from error
 */
function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined

  const obj = error as Record<string, unknown>
  if (typeof obj.status === 'number') return obj.status
  if (typeof obj.statusCode === 'number') return obj.statusCode

  return undefined
}

/**
 * Extract retry-after header value
 */
function extractRetryAfter(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined

  const obj = error as Record<string, unknown>
  if (typeof obj.retryAfter === 'number') return obj.retryAfter

  return undefined
}

/**
 * Check if error has a specific property indicating optional/non-critical
 */
function isOptionalError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const obj = error as Record<string, unknown>
  return obj.optional === true || obj.code === 'FEATURE_UNAVAILABLE'
}

// ============================================================================
// CLASSIFICATION LOGIC
// ============================================================================

/**
 * Determine if error matches a pattern set
 */
function matchesPatterns(error: Error, patterns: Set<string>): boolean {
  const code = extractErrorCode(error)
  const message = extractErrorMessage(error)
  const status = extractStatus(error)

  // Check code
  if (code && patterns.has(code)) return true

  // Check status
  if (status && patterns.has(String(status))) return true

  // Check message patterns
  const lowerMessage = message.toLowerCase()
  for (const pattern of patterns) {
    if (lowerMessage.includes(pattern.toLowerCase())) return true
  }

  return false
}

/**
 * Determine severity from error
 */
function determineSeverity(error: Error): ErrorSeverity {
  const code = extractErrorCode(error)
  const message = extractErrorMessage(error)
  const status = extractStatus(error)

  // Check critical patterns first
  if (code && SEVERITY_PATTERNS.critical.has(code)) return 'critical'
  if (message.toLowerCase().includes('data corruption')) return 'critical'

  // Check high patterns
  if (code && SEVERITY_PATTERNS.high.has(code)) return 'high'
  if (status === 401 || status === 403) return 'high'
  if (message.toLowerCase().includes('authentication fail')) return 'high'
  if (message.toLowerCase().includes('access denied')) return 'high'
  if (message.toLowerCase().includes('security violation')) return 'high'

  // Check low patterns (optional/informational)
  if (isOptionalError(error)) return 'low'
  if (code && SEVERITY_PATTERNS.low.has(code)) return 'low'
  if (status === 400 || status === 404) return 'low'

  // Default to medium
  return 'medium'
}

/**
 * Get default max retries based on classification
 */
function getDefaultMaxRetries(classification: ErrorClassification): number {
  switch (classification) {
    case 'transient':
      return 3
    case 'recoverable':
      return 2
    case 'escalatable':
    case 'permanent':
      return 0
  }
}

/**
 * Get default retry delay
 */
function getDefaultRetryDelay(error: Error): number | undefined {
  const retryAfter = extractRetryAfter(error)
  if (retryAfter) return retryAfter

  const status = extractStatus(error)
  if (status === 429) return 1000 // Default 1 second for rate limits

  return 100 // Default 100ms for other transient errors
}

// ============================================================================
// MAIN CLASSIFICATION FUNCTION
// ============================================================================

/**
 * Classify an error for the escalation chain.
 *
 * @param error - The error to classify
 * @param options - Classification options
 * @returns Classified error with full metadata
 *
 * @example
 * ```typescript
 * const classified = classifyError(new Error('ETIMEDOUT'))
 * // { classification: 'transient', retryable: true, severity: 'medium', ... }
 *
 * const classified = classifyError(error, { currentTier: 'code' })
 * // { classification: 'escalatable', nextTier: 'generative', ... }
 * ```
 */
export function classifyError(error: Error, options: ClassifyOptions = {}): ClassifiedError {
  const { currentTier = 'code', context, rules } = options

  // Check custom rules first
  if (rules) {
    for (const rule of rules) {
      if (rule.match(error)) {
        const classification = rule.classification
        const severity = rule.severity ?? determineSeverity(error)
        const maxRetries = rule.maxRetries ?? getDefaultMaxRetries(classification)
        const retryable = rule.retryable ?? (classification === 'transient' && maxRetries > 0)

        return {
          error,
          classification,
          severity,
          retryable,
          retryCount: 0,
          maxRetries,
          retryDelay: rule.retryDelay ?? getDefaultRetryDelay(error),
          currentTier,
          nextTier: classification === 'escalatable' ? getNextTier(currentTier) : undefined,
          reason: `Matched custom rule`,
          context,
        }
      }
    }
  }

  const code = extractErrorCode(error)
  const message = extractErrorMessage(error)

  // Check transient patterns
  if (matchesPatterns(error, TRANSIENT_PATTERNS)) {
    const retryDelay = getDefaultRetryDelay(error)
    return {
      error,
      classification: 'transient',
      severity: determineSeverity(error),
      retryable: true,
      retryCount: 0,
      maxRetries: 3,
      retryDelay,
      currentTier,
      reason: `Transient error: ${code ?? message.slice(0, 50)}`,
      context,
    }
  }

  // Check permanent patterns
  if (matchesPatterns(error, PERMANENT_PATTERNS)) {
    return {
      error,
      classification: 'permanent',
      severity: determineSeverity(error),
      retryable: false,
      retryCount: 0,
      maxRetries: 0,
      currentTier,
      reason: `Permanent error: ${code ?? message.slice(0, 50)}`,
      context,
    }
  }

  // Check escalatable patterns
  if (matchesPatterns(error, ESCALATABLE_PATTERNS)) {
    const nextTier = getNextTier(currentTier)
    return {
      error,
      classification: 'escalatable',
      severity: determineSeverity(error),
      retryable: false,
      retryCount: 0,
      maxRetries: 0,
      currentTier,
      nextTier,
      reason: `Escalatable error: ${code ?? message.slice(0, 50)}`,
      context,
    }
  }

  // Human tier errors cannot be escalated further
  if (currentTier === 'human') {
    return {
      error,
      classification: 'permanent',
      severity: determineSeverity(error),
      retryable: false,
      retryCount: 0,
      maxRetries: 0,
      currentTier,
      reason: `Human tier error (no further escalation)`,
      context,
    }
  }

  // Default: escalatable to next tier
  const nextTier = getNextTier(currentTier)
  return {
    error,
    classification: nextTier ? 'escalatable' : 'permanent',
    severity: determineSeverity(error),
    retryable: false,
    retryCount: 0,
    maxRetries: 0,
    currentTier,
    nextTier,
    reason: `Default classification: ${code ?? message.slice(0, 50)}`,
    context,
  }
}

// ============================================================================
// RE-EXPORTS FOR CONVENIENCE
// ============================================================================

export { TIER_ORDER, getNextTier }
