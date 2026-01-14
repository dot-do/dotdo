/**
 * Validation Utilities
 *
 * Common validation functions for CLI commands.
 */

import { ValidationError } from './errors'

/**
 * Parse and validate a port number from a string.
 *
 * @param value - The string value to parse as a port number
 * @returns The parsed port number
 * @throws ValidationError if the value is not a valid port (1-65535)
 *
 * @example
 * parsePort('4000')  // Returns 4000
 * parsePort('abc')   // Throws: ValidationError
 * parsePort('0')     // Throws: ValidationError
 */
export function parsePort(value: string): number {
  // Check that the entire string is numeric (no trailing characters)
  if (!/^\d+$/.test(value)) {
    throw ValidationError.invalidPort(value)
  }
  const port = parseInt(value, 10)
  if (port < 1 || port > 65535) {
    throw ValidationError.invalidPort(value)
  }
  return port
}

/**
 * Validate an E.164 phone number format.
 *
 * @param value - The phone number to validate
 * @returns The validated phone number
 * @throws ValidationError if the format is invalid
 */
export function validatePhoneNumber(value: string): string {
  // E.164 format: + followed by 1-15 digits
  if (!/^\+[1-9]\d{1,14}$/.test(value)) {
    throw ValidationError.invalidPhoneNumber(value)
  }
  return value
}

/**
 * Validate an email address format.
 *
 * @param value - The email address to validate
 * @returns The validated email address
 * @throws ValidationError if the format is invalid
 */
export function validateEmail(value: string): string {
  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw ValidationError.invalidEmail(value)
  }
  return value
}

/**
 * Parse and validate JSON.
 *
 * @param value - The JSON string to parse
 * @param field - The field name for error messages
 * @returns The parsed JSON value
 * @throws ValidationError if the JSON is invalid
 */
export function parseJSON<T = unknown>(value: string, field: string): T {
  try {
    return JSON.parse(value) as T
  } catch {
    throw ValidationError.invalidJSON(field, value)
  }
}
