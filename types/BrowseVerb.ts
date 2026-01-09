import type { VerbData } from './Verb'

// ============================================================================
// BROWSE VERB - Browser automation action
// ============================================================================

/**
 * BrowseMode - The type of browser action to perform
 */
export type BrowseMode = 'navigate' | 'act' | 'extract' | 'observe' | 'agent'

/**
 * BrowseInput - Input for a browse action
 */
export interface BrowseInput {
  /** The mode of browser operation */
  mode: BrowseMode

  /** URL to navigate to (required for 'navigate' mode) */
  url?: string

  /** Instructions for the browser (required for 'act' and 'agent' modes) */
  instructions?: string

  /** Schema for data extraction (used with 'extract' mode) */
  schema?: unknown

  /** Reference to an existing browser session */
  browser?: string

  /** Wait for specific element or condition */
  waitFor?: string

  /** Timeout in milliseconds */
  timeout?: number
}

/**
 * BrowseOutput - Output from a browse action
 */
export interface BrowseOutput {
  /** Whether the action was successful */
  success: boolean

  /** Extracted or returned data */
  data?: unknown

  /** Base64 encoded screenshot */
  screenshot?: string

  /** Error message if success is false */
  error?: string

  /** Current URL after action completed */
  currentUrl?: string

  /** Page title */
  title?: string

  /** Console logs captured */
  logs?: string[]
}

/**
 * BrowseVerb - Verb for browser automation actions
 * Extends VerbData with input/output schemas
 */
export interface BrowseVerb extends VerbData {
  /** The verb name */
  verb: 'browse'

  /** Present participle form */
  activity?: 'browsing'

  /** Past participle form */
  event?: 'browsed'

  /** Input schema for the browse action */
  input: BrowseInput

  /** Output schema for the browse action */
  output: BrowseOutput
}

// ============================================================================
// Validation Types
// ============================================================================

export interface ValidationError {
  field: string
  message: string
}

export interface ValidationResult {
  success: boolean
  errors: ValidationError[]
}

// ============================================================================
// Validation Functions
// ============================================================================

const VALID_MODES: BrowseMode[] = ['navigate', 'act', 'extract', 'observe', 'agent']

/**
 * URL validation helper
 */
function isValidUrl(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

/**
 * Validates a BrowseInput object
 */
export function validateBrowseInput(input: BrowseInput): ValidationResult {
  const errors: ValidationError[] = []

  // Validate mode
  if (!VALID_MODES.includes(input.mode)) {
    errors.push({
      field: 'mode',
      message: `mode must be one of: ${VALID_MODES.join(', ')}`,
    })
  }

  // Mode-specific validations
  switch (input.mode) {
    case 'navigate':
      if (!input.url) {
        errors.push({
          field: 'url',
          message: 'url is required for navigate mode',
        })
      } else if (!isValidUrl(input.url)) {
        errors.push({
          field: 'url',
          message: 'url must be a valid URL',
        })
      }
      break

    case 'act':
    case 'agent':
      if (!input.instructions) {
        errors.push({
          field: 'instructions',
          message: `instructions is required for ${input.mode} mode`,
        })
      }
      break

    case 'extract':
      // URL is optional for extract (might be using existing browser)
      if (input.url && !isValidUrl(input.url)) {
        errors.push({
          field: 'url',
          message: 'url must be a valid URL',
        })
      }
      break

    case 'observe':
      // No specific requirements for observe mode
      break
  }

  // Validate URL format if provided
  if (input.url && !isValidUrl(input.url)) {
    // Already handled in switch but ensure general validation
    if (!errors.some(e => e.field === 'url')) {
      errors.push({
        field: 'url',
        message: 'url must be a valid URL',
      })
    }
  }

  // Validate timeout if provided
  if (input.timeout !== undefined && (typeof input.timeout !== 'number' || input.timeout <= 0)) {
    errors.push({
      field: 'timeout',
      message: 'timeout must be a positive number',
    })
  }

  return {
    success: errors.length === 0,
    errors,
  }
}
