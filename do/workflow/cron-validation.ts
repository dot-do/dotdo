/**
 * CRON Expression Validation Module
 *
 * Provides strict validation for CRON expressions to prevent injection attacks.
 * This module ensures that all CRON fields contain only valid values and patterns.
 *
 * Security considerations:
 * - Reject all shell metacharacters and injection patterns
 * - Validate numeric ranges strictly
 * - Reject malformed input early
 *
 * @module do/workflow/cron-validation
 */

/**
 * CRON field types with their valid ranges
 */
export const CRON_FIELD_RANGES = {
  second: { min: 0, max: 59 },
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dayOfMonth: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dayOfWeek: { min: 0, max: 7 }, // 0 and 7 both represent Sunday
} as const

export type CronFieldType = keyof typeof CRON_FIELD_RANGES

/**
 * Error class for CRON validation failures
 */
export class CronValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: CronFieldType,
    public readonly value?: string
  ) {
    super(message)
    this.name = 'CronValidationError'
  }
}

/**
 * Dangerous characters that could indicate injection attempts
 * These are common shell metacharacters and control characters
 */
const DANGEROUS_PATTERNS = [
  /[;&|`$\\<>(){}[\]!#~'"]/,       // Shell metacharacters
  /\x00/,                          // Null byte
  /[\x01-\x1f]/,                   // Control characters (except space/tab)
  /[\x7f-\x9f]/,                   // DEL and C1 control codes
  /[\u200B-\u200F\u202A-\u202E]/,  // Zero-width and RTL override chars
  /[\uFEFF\uFFFE\uFFFF]/,          // BOM and non-characters
  /\r|\n/,                         // Newlines
]

/**
 * Valid CRON field pattern - only allows safe characters:
 * - Digits (0-9)
 * - Asterisk (*) for wildcards
 * - Comma (,) for lists
 * - Hyphen (-) for ranges
 * - Forward slash (/) for steps
 */
const VALID_CRON_FIELD_CHARS = /^[\d*,\-/]+$/

/**
 * Check if a string contains dangerous injection patterns
 *
 * @param input - String to check
 * @returns True if dangerous patterns found
 */
export function containsDangerousPatterns(input: string): boolean {
  return DANGEROUS_PATTERNS.some(pattern => pattern.test(input))
}

/**
 * Validate a single CRON field value
 *
 * @param fieldType - The type of CRON field (minute, hour, etc.)
 * @param value - The field value to validate
 * @throws CronValidationError if the value is invalid
 */
export function validateCronField(fieldType: CronFieldType, value: string): void {
  const range = CRON_FIELD_RANGES[fieldType]

  // Check for empty/whitespace
  if (!value || value.trim() === '') {
    throw new CronValidationError(`Empty ${fieldType} field`, fieldType, value)
  }

  // Check for dangerous patterns
  if (containsDangerousPatterns(value)) {
    throw new CronValidationError(
      `Invalid characters in ${fieldType} field: ${value}`,
      fieldType,
      value
    )
  }

  // Check for valid character set
  if (!VALID_CRON_FIELD_CHARS.test(value)) {
    throw new CronValidationError(
      `Invalid characters in ${fieldType} field: ${value}`,
      fieldType,
      value
    )
  }

  // Wildcard is always valid
  if (value === '*') {
    return
  }

  // Handle lists: "0,15,30,45"
  if (value.includes(',')) {
    // Check for empty list items
    if (value.startsWith(',') || value.endsWith(',') || value.includes(',,')) {
      throw new CronValidationError(
        `Invalid list format in ${fieldType} field: ${value}`,
        fieldType,
        value
      )
    }

    const parts = value.split(',')
    for (const part of parts) {
      validateCronFieldPart(fieldType, part.trim(), range)
    }
    return
  }

  // Single value or range or step
  validateCronFieldPart(fieldType, value, range)
}

/**
 * Validate a single part of a CRON field (after splitting lists)
 */
function validateCronFieldPart(
  fieldType: CronFieldType,
  value: string,
  range: { min: number; max: number }
): void {
  // Handle step values: "*/5" or "0-30/5"
  if (value.includes('/')) {
    const [rangeOrWildcard, stepStr] = value.split('/')

    if (!stepStr || stepStr === '') {
      throw new CronValidationError(
        `Invalid step format in ${fieldType} field: ${value}`,
        fieldType,
        value
      )
    }

    const step = parseInt(stepStr, 10)

    // Step must be positive integer
    if (isNaN(step) || step <= 0) {
      throw new CronValidationError(
        `Invalid step value in ${fieldType} field: ${value}`,
        fieldType,
        value
      )
    }

    // Step cannot exceed the field range
    const maxStep = range.max - range.min + 1
    if (step > maxStep) {
      throw new CronValidationError(
        `Step value ${step} exceeds valid range for ${fieldType}`,
        fieldType,
        value
      )
    }

    // Validate the range part
    if (rangeOrWildcard !== '*') {
      validateRangeValue(fieldType, rangeOrWildcard!, range)
    }

    return
  }

  // Handle ranges: "1-5"
  if (value.includes('-')) {
    validateRangeValue(fieldType, value, range)
    return
  }

  // Simple numeric value
  validateNumericValue(fieldType, value, range)
}

/**
 * Validate a range expression like "1-5"
 */
function validateRangeValue(
  fieldType: CronFieldType,
  value: string,
  range: { min: number; max: number }
): void {
  // Check for malformed ranges
  if (value.startsWith('-') || value.endsWith('-') || value.includes('--')) {
    throw new CronValidationError(
      `Invalid range format in ${fieldType} field: ${value}`,
      fieldType,
      value
    )
  }

  const parts = value.split('-')

  if (parts.length !== 2) {
    throw new CronValidationError(
      `Invalid range format in ${fieldType} field: ${value}`,
      fieldType,
      value
    )
  }

  const [startStr, endStr] = parts
  const start = parseInt(startStr!, 10)
  const end = parseInt(endStr!, 10)

  if (isNaN(start) || isNaN(end)) {
    throw new CronValidationError(
      `Invalid range values in ${fieldType} field: ${value}`,
      fieldType,
      value
    )
  }

  // Validate both ends are in range
  if (start < range.min || start > range.max) {
    throw new CronValidationError(
      `Range start ${start} out of bounds for ${fieldType} (${range.min}-${range.max})`,
      fieldType,
      value
    )
  }

  if (end < range.min || end > range.max) {
    throw new CronValidationError(
      `Range end ${end} out of bounds for ${fieldType} (${range.min}-${range.max})`,
      fieldType,
      value
    )
  }

  // Start must be <= end (no wraparound for most fields)
  // Note: dayOfWeek allows wraparound (e.g., 5-1 for Fri-Mon), but we disallow for simplicity
  if (start > end) {
    throw new CronValidationError(
      `Range start (${start}) cannot be greater than end (${end}) in ${fieldType} field`,
      fieldType,
      value
    )
  }
}

/**
 * Validate a simple numeric value
 */
function validateNumericValue(
  fieldType: CronFieldType,
  value: string,
  range: { min: number; max: number }
): void {
  const num = parseInt(value, 10)

  if (isNaN(num) || value !== String(num)) {
    throw new CronValidationError(
      `Invalid numeric value in ${fieldType} field: ${value}`,
      fieldType,
      value
    )
  }

  if (num < range.min || num > range.max) {
    throw new CronValidationError(
      `Value ${num} out of bounds for ${fieldType} (${range.min}-${range.max})`,
      fieldType,
      value
    )
  }
}

/**
 * Validate a complete CRON expression
 *
 * Standard format: minute hour dayOfMonth month dayOfWeek
 * Example: "0 9 * * 1" = Monday at 9am
 *
 * @param expression - The CRON expression to validate
 * @throws CronValidationError if the expression is invalid
 */
export function validateCronExpression(expression: string): void {
  // Check for dangerous patterns in the full expression
  if (containsDangerousPatterns(expression)) {
    throw new CronValidationError(
      `CRON expression contains dangerous characters: ${expression}`
    )
  }

  // Check for excessive length (prevent DoS)
  if (expression.length > 200) {
    throw new CronValidationError(
      `CRON expression too long (max 200 characters): ${expression.length} chars`
    )
  }

  const parts = expression.trim().split(/\s+/)

  // Standard 5-field cron
  if (parts.length !== 5) {
    throw new CronValidationError(
      `CRON expression must have exactly 5 fields (minute hour day month weekday), got ${parts.length}: ${expression}`
    )
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  // Validate each field
  validateCronField('minute', minute!)
  validateCronField('hour', hour!)
  validateCronField('dayOfMonth', dayOfMonth!)
  validateCronField('month', month!)
  validateCronField('dayOfWeek', dayOfWeek!)
}

/**
 * Validate a time string for the schedule DSL
 *
 * Valid formats:
 * - "9am", "6pm" (hour + meridiem)
 * - "3:45pm" (hour:minute + meridiem)
 * - "15:30" (24-hour format)
 *
 * @param timeStr - The time string to validate
 * @throws CronValidationError if the time string is invalid
 */
export function validateTimeString(timeStr: string): { hour: number; minute: number } {
  // Check for empty/whitespace
  if (!timeStr || timeStr.trim() === '') {
    throw new CronValidationError('Empty time string')
  }

  const clean = timeStr.trim()

  // Check for excessive length
  if (clean.length > 20) {
    throw new CronValidationError(`Time string too long: ${clean}`)
  }

  // Check for dangerous patterns
  if (containsDangerousPatterns(clean)) {
    throw new CronValidationError(`Time string contains dangerous characters: ${clean}`)
  }

  // Only allow safe characters: digits, colon, space, and am/pm letters
  if (!/^[\d:apmAPM\s]+$/.test(clean)) {
    throw new CronValidationError(`Time string contains invalid characters: ${clean}`)
  }

  const normalized = clean.toLowerCase()

  // Parse formats: "6pm", "9am", "3:45pm", "15:30"
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)

  if (!match) {
    throw new CronValidationError(
      `Invalid time format: ${timeStr}. Use formats like "9am", "3:45pm", or "15:30"`
    )
  }

  const hourStr = match[1]
  if (!hourStr) {
    throw new CronValidationError(`Invalid time format: ${timeStr}`)
  }

  let hour = parseInt(hourStr, 10)
  const minute = match[2] ? parseInt(match[2], 10) : 0
  const meridiem = match[3]?.toLowerCase()

  // Validate base hour value
  if (meridiem) {
    // 12-hour format: hour must be 1-12
    if (hour < 1 || hour > 12) {
      throw new CronValidationError(`Invalid hour for 12-hour format: ${hour}`)
    }
  } else {
    // 24-hour format: hour must be 0-23
    if (hour < 0 || hour > 23) {
      throw new CronValidationError(`Invalid hour: ${hour}`)
    }
  }

  // Validate minute
  if (minute < 0 || minute > 59) {
    throw new CronValidationError(`Invalid minute: ${minute}`)
  }

  // Convert to 24-hour format
  if (meridiem === 'pm' && hour < 12) {
    hour += 12
  } else if (meridiem === 'am' && hour === 12) {
    hour = 0
  }

  // Final validation of converted hour
  if (hour < 0 || hour > 23) {
    throw new CronValidationError(`Invalid time: ${timeStr}`)
  }

  return { hour, minute }
}
