/**
 * Validation Module - Validate DO types and classes
 *
 * Provides utilities to validate DO classes before registration.
 */

import { DO } from '../objects/core/DO'

/**
 * Options for validateType
 */
export interface ValidateTypeOptions {
  allowCustomType?: boolean
}

/**
 * Validate a DO class
 *
 * Checks:
 * - Class has a $type property
 * - $type matches class name (unless allowCustomType)
 * - Class extends DO
 *
 * @param DOClass - The class to validate
 * @param options - Validation options
 * @throws Error if validation fails
 */
export function validateType(
  DOClass: unknown,
  options?: ValidateTypeOptions,
): void {
  const allowCustomType = options?.allowCustomType ?? false

  // Check if it's a function (class)
  if (typeof DOClass !== 'function') {
    throw new Error('Expected a class')
  }

  const cls = DOClass as Function & { $type?: string; name: string }

  // Check if it extends DO
  let current = Object.getPrototypeOf(cls)
  let extendsDO = false

  while (current) {
    if (current === DO) {
      extendsDO = true
      break
    }
    current = Object.getPrototypeOf(current)
  }

  if (!extendsDO) {
    throw new Error('Class must extend DO')
  }

  // Check for $type property
  if (!cls.$type || typeof cls.$type !== 'string') {
    throw new Error('Class must have a static $type property')
  }

  // Check if $type matches class name (unless allowCustomType)
  if (!allowCustomType && cls.$type !== cls.name) {
    throw new Error(`$type mismatch: expected ${cls.name} but got ${cls.$type}`)
  }
}
