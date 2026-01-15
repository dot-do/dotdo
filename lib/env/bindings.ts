/**
 * Safe Environment Binding Resolution
 *
 * Provides type-safe access to Cloudflare Worker environment bindings
 * with graceful error handling and descriptive error messages.
 *
 * STUB FILE - TDD RED Phase
 * This file contains only type definitions and stub implementations.
 * All functions will fail, causing tests to be in RED state.
 *
 * @module lib/env/bindings
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Binding validation result
 */
export interface BindingValidationResult {
  /** Whether all required bindings are present */
  valid: boolean
  /** List of missing required bindings */
  missingBindings: string[]
  /** List of available bindings in the environment */
  availableBindings: string[]
  /** List of required bindings that were checked */
  requiredBindings: string[]
  /** List of missing optional bindings (if optional bindings were specified) */
  missingOptional?: string[]
}

/**
 * Binding specification for validation
 */
export interface BindingSpec {
  required: string[]
  optional?: string[]
}

// ============================================================================
// BindingError Class
// ============================================================================

/**
 * Error thrown when a required binding is not found
 *
 * STUB: Not yet implemented - tests should FAIL
 */
export class BindingError extends Error {
  readonly bindingName: string
  readonly availableBindings?: string[]
  readonly code: string

  constructor(
    _bindingName: string,
    _message: string,
    _options?: {
      availableBindings?: string[]
      code?: string
    }
  ) {
    // STUB: Minimal implementation that will cause tests to fail
    super('Not implemented')
    this.name = 'BindingError'
    this.bindingName = ''  // Wrong - should be _bindingName
    this.availableBindings = undefined  // Wrong - should be from options
    this.code = ''  // Wrong - should default to 'BINDING_NOT_FOUND'
  }

  toJSON(): Record<string, unknown> {
    // STUB: Returns wrong shape
    return {}
  }
}

// ============================================================================
// Binding Resolution Functions
// ============================================================================

/**
 * Get a binding from the environment (returns undefined if not found)
 *
 * STUB: Not yet implemented - tests should FAIL
 */
export function getBinding<T = unknown>(
  _env: Record<string, unknown>,
  _bindingName: string
): T | undefined {
  // STUB: Always throws to make tests fail
  throw new Error('getBinding not implemented')
}

/**
 * Get a binding from the environment or throw BindingError
 *
 * STUB: Not yet implemented - tests should FAIL
 */
export function getBindingOrThrow<T = unknown>(
  _env: Record<string, unknown>,
  _bindingName: string
): T {
  // STUB: Always throws wrong error type to make tests fail
  throw new Error('getBindingOrThrow not implemented')
}

/**
 * Validate that required bindings are present in the environment
 *
 * STUB: Not yet implemented - tests should FAIL
 */
export function validateBindings(
  _env: Record<string, unknown>,
  _bindings: string[] | BindingSpec
): BindingValidationResult {
  // STUB: Returns wrong result to make tests fail
  return {
    valid: false,
    missingBindings: [],
    availableBindings: [],
    requiredBindings: [],
  }
}
