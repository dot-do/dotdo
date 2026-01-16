/**
 * Deprecation Warning Utilities
 *
 * Provides runtime deprecation warnings to help developers migrate from deprecated APIs.
 * Warnings are emitted only once per method to avoid console spam.
 *
 * @module lib/deprecation
 */

/**
 * Set of method keys that have already emitted warnings.
 * Used to ensure each deprecation warning is only logged once.
 */
const warned = new Set<string>()

/**
 * Array to capture warning calls for testing purposes.
 * Only used in test environments.
 */
const warningCalls: string[] = []

/**
 * Get recorded warning calls (for testing).
 * @internal
 */
export function _getWarningCalls(): readonly string[] {
  return warningCalls
}

/**
 * Reset recorded warning calls (for testing).
 * @internal
 */
export function _resetWarningCalls(): void {
  warningCalls.length = 0
}

/**
 * Emit a deprecation warning for a method.
 * Only emits once per method key to avoid console spam.
 *
 * @param method - The fully-qualified method name (e.g., "DOCore.getThingPublic")
 * @param replacement - Optional replacement method to suggest
 *
 * @example
 * ```typescript
 * // Simple deprecation
 * emitDeprecationWarning('oldFunction')
 * // Output: [DEPRECATED] oldFunction is deprecated.
 *
 * // With replacement suggestion
 * emitDeprecationWarning('DOCore.getThingPublic', 'DOCore.getThingById')
 * // Output: [DEPRECATED] DOCore.getThingPublic is deprecated. Use DOCore.getThingById instead.
 * ```
 */
export function emitDeprecationWarning(method: string, replacement?: string): void {
  if (warned.has(method)) return

  warned.add(method)

  let message = `[DEPRECATED] ${method} is deprecated.`
  if (replacement) {
    message += ` Use ${replacement} instead.`
  }

  // Record for testing
  warningCalls.push(message)

  // Also emit to console
  console.warn(message)
}

/**
 * Clear all recorded deprecation warnings.
 * Primarily used for testing to reset state between tests.
 */
export function clearDeprecationWarnings(): void {
  warned.clear()
}

/**
 * Wrap a function with deprecation warning.
 * Emits a warning on first invocation with the replacement method name.
 *
 * @param methodName - The name of the deprecated method (for the warning message)
 * @param fn - The original function to wrap
 * @param replacement - The name of the replacement method
 * @returns A wrapped function that emits a deprecation warning on first call
 *
 * @example
 * ```typescript
 * class MyClass {
 *   // Use the wrapper for deprecated methods
 *   oldMethod = wrapDeprecated(
 *     'MyClass.oldMethod',
 *     () => this.newMethod(),
 *     'newMethod'
 *   )
 *
 *   newMethod() {
 *     return 'result'
 *   }
 * }
 *
 * // First call emits: [DEPRECATED] MyClass.oldMethod is deprecated. Use newMethod instead.
 * const instance = new MyClass()
 * instance.oldMethod() // logs warning
 * instance.oldMethod() // no warning (only once)
 * ```
 */
export function wrapDeprecated<T extends (...args: unknown[]) => unknown>(
  methodName: string,
  fn: T,
  replacement: string
): T {
  return function (this: unknown, ...args: Parameters<T>): ReturnType<T> {
    emitDeprecationWarning(methodName, replacement)
    return fn.apply(this, args) as ReturnType<T>
  } as T
}
