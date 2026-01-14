/**
 * Resource Limits Module
 *
 * Provides resource limit enforcement for Tier 4 sandbox execution to prevent
 * DoS attacks and resource exhaustion. Implements execution time limits,
 * output size limits, and graceful termination with cleanup.
 *
 * Key Features:
 * - Execution time limits with Promise.race timeout
 * - Output size limits with truncation
 * - Graceful termination with cleanup callbacks
 * - Resource usage tracking in results
 * - Per-execution limit overrides
 *
 * @example
 * ```typescript
 * import { createResourceLimitEnforcer, DEFAULT_RESOURCE_LIMITS } from 'bashx/do/security/resource-limits'
 *
 * const enforcer = createResourceLimitEnforcer({
 *   maxExecutionTimeMs: 30000,
 *   maxOutputBytes: 1024 * 1024,
 * })
 *
 * const result = await enforcer.enforce(async () => {
 *   // Execute command
 *   return await sandbox.execute('ls -la')
 * })
 *
 * console.log(result.resourceUsage)
 * ```
 *
 * @module bashx/do/security/resource-limits
 */

import type { BashResult } from '../../types.js'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Resource limits configuration.
 *
 * Defines the maximum resources that can be consumed by a single command execution.
 */
export interface ResourceLimits {
  /**
   * Maximum execution time in milliseconds.
   * Command will be terminated if it exceeds this limit.
   * Set to 0 to disable time limit.
   * @default 30000 (30 seconds)
   */
  maxExecutionTimeMs: number

  /**
   * Maximum output size in bytes.
   * Output will be truncated if it exceeds this limit.
   * @default 1048576 (1MB)
   */
  maxOutputBytes: number

  /**
   * Maximum memory usage in MB (if trackable).
   * This is optional as memory tracking may not be available
   * in all execution environments.
   */
  maxMemoryMB?: number
}

/**
 * Type of limit that was exceeded.
 */
export type LimitExceededType = 'time' | 'output' | 'memory'

/**
 * Resource usage information tracked during execution.
 */
export interface ResourceUsage {
  /**
   * Actual execution time in milliseconds.
   */
  executionTimeMs: number

  /**
   * Original output size in bytes (before truncation).
   */
  originalOutputBytes?: number

  /**
   * Truncated output size in bytes (after truncation).
   */
  truncatedOutputBytes?: number

  /**
   * Whether the output was truncated due to size limit.
   */
  outputTruncated?: boolean

  /**
   * Memory usage in MB (if tracked).
   */
  memoryUsageMB?: number

  /**
   * The limits that were applied during execution.
   */
  limitsApplied: ResourceLimits
}

/**
 * Extended BashResult with resource usage information.
 */
export interface BashResultWithResourceUsage extends BashResult {
  /**
   * Resource usage information from the execution.
   */
  resourceUsage?: ResourceUsage
}

/**
 * Options for individual execution limit enforcement.
 */
export interface EnforceOptions {
  /**
   * Override the timeout for this specific execution.
   */
  timeoutMs?: number

  /**
   * Override the max output size for this specific execution.
   */
  maxOutputBytes?: number

  /**
   * Callback invoked when execution is terminated due to timeout.
   * Used for cleanup (e.g., killing the process).
   */
  onCleanup?: () => Promise<void> | void
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default resource limits.
 *
 * These values are chosen to be reasonable for most use cases while
 * providing protection against resource exhaustion.
 */
export const DEFAULT_RESOURCE_LIMITS: Readonly<ResourceLimits> = Object.freeze({
  maxExecutionTimeMs: 30000, // 30 seconds
  maxOutputBytes: 1024 * 1024, // 1MB
})

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Error thrown when a resource limit is exceeded.
 *
 * Contains information about which limit was exceeded and
 * the resource usage at the time of the error.
 */
export class ResourceLimitExceededError extends Error {
  /**
   * The name of this error type.
   */
  override readonly name = 'ResourceLimitExceededError'

  /**
   * The type of limit that was exceeded.
   */
  readonly limitType: LimitExceededType

  /**
   * Resource usage information at the time of the error.
   */
  readonly resourceUsage: ResourceUsage

  constructor(
    limitType: LimitExceededType,
    message: string,
    resourceUsage: ResourceUsage
  ) {
    super(message)
    this.limitType = limitType
    this.resourceUsage = resourceUsage

    // Ensure prototype chain is properly set up
    Object.setPrototypeOf(this, ResourceLimitExceededError.prototype)
  }
}

// ============================================================================
// RESOURCE LIMIT ENFORCER
// ============================================================================

/**
 * Resource limit enforcer interface.
 *
 * Wraps execution functions to enforce resource limits and track usage.
 */
export interface ResourceLimitEnforcer {
  /**
   * Get the current limits configuration.
   */
  getLimits(): ResourceLimits

  /**
   * Enforce resource limits on an execution function.
   *
   * @param execution - The async function to execute
   * @param options - Optional per-execution limit overrides
   * @returns The execution result with resource usage information
   * @throws ResourceLimitExceededError if a limit is exceeded
   */
  enforce(
    execution: () => Promise<BashResult>,
    options?: EnforceOptions
  ): Promise<BashResultWithResourceUsage>
}

/**
 * Internal implementation of ResourceLimitEnforcer.
 */
class ResourceLimitEnforcerImpl implements ResourceLimitEnforcer {
  private readonly limits: ResourceLimits

  constructor(limits: Partial<ResourceLimits> = {}) {
    this.limits = {
      ...DEFAULT_RESOURCE_LIMITS,
      ...limits,
    }
  }

  getLimits(): ResourceLimits {
    return { ...this.limits }
  }

  async enforce(
    execution: () => Promise<BashResult>,
    options?: EnforceOptions
  ): Promise<BashResultWithResourceUsage> {
    const effectiveTimeout = options?.timeoutMs ?? this.limits.maxExecutionTimeMs
    const effectiveMaxOutput = options?.maxOutputBytes ?? this.limits.maxOutputBytes

    const startTime = Date.now()

    // Track if we timed out (for cleanup)
    let timedOut = false

    try {
      let result: BashResult

      // Handle timeout enforcement
      if (effectiveTimeout > 0) {
        // Use Promise.race to enforce time limit
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            timedOut = true
            const elapsedMs = Date.now() - startTime
            const resourceUsage: ResourceUsage = {
              executionTimeMs: elapsedMs,
              limitsApplied: {
                maxExecutionTimeMs: effectiveTimeout,
                maxOutputBytes: effectiveMaxOutput,
              },
            }
            reject(new ResourceLimitExceededError(
              'time',
              `Execution exceeded time limit of ${effectiveTimeout}ms`,
              resourceUsage
            ))
          }, effectiveTimeout)
        })

        result = await Promise.race([execution(), timeoutPromise])
      } else {
        // No timeout - just execute directly
        result = await execution()
      }

      const executionTimeMs = Date.now() - startTime

      // Enforce output size limit
      const originalOutputBytes = Buffer.byteLength(result.stdout, 'utf-8')
      let stdout = result.stdout
      let stderr = result.stderr
      let outputTruncated = false

      if (originalOutputBytes > effectiveMaxOutput) {
        // Truncate output
        const encoder = new TextEncoder()
        const bytes = encoder.encode(result.stdout)
        const truncatedBytes = bytes.slice(0, effectiveMaxOutput)
        stdout = new TextDecoder().decode(truncatedBytes)
        outputTruncated = true

        // Add truncation notice to stderr
        const truncationNotice = `\n[Output truncated: ${originalOutputBytes} bytes exceeded limit of ${effectiveMaxOutput} bytes]`
        stderr = result.stderr + truncationNotice
      }

      // Build resource usage information
      const resourceUsage: ResourceUsage = {
        executionTimeMs,
        originalOutputBytes,
        truncatedOutputBytes: outputTruncated ? effectiveMaxOutput : originalOutputBytes,
        outputTruncated,
        limitsApplied: {
          maxExecutionTimeMs: effectiveTimeout,
          maxOutputBytes: effectiveMaxOutput,
        },
      }

      return {
        ...result,
        stdout,
        stderr,
        resourceUsage,
      }
    } catch (error) {
      // If we timed out, call cleanup before re-throwing
      if (timedOut && options?.onCleanup) {
        try {
          await options.onCleanup()
        } catch {
          // Ignore cleanup errors - the original timeout error is more important
        }
      }

      // Re-throw the original error
      throw error
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new ResourceLimitEnforcer with the given limits.
 *
 * @param limits - Partial limits configuration (merged with defaults)
 * @returns A new ResourceLimitEnforcer instance
 *
 * @example
 * ```typescript
 * // With default limits
 * const enforcer = createResourceLimitEnforcer()
 *
 * // With custom limits
 * const enforcer = createResourceLimitEnforcer({
 *   maxExecutionTimeMs: 60000,  // 1 minute
 *   maxOutputBytes: 5 * 1024 * 1024,  // 5MB
 * })
 *
 * // Enforce limits on execution
 * const result = await enforcer.enforce(async () => {
 *   return await sandbox.execute('ls -la')
 * })
 * ```
 */
export function createResourceLimitEnforcer(
  limits?: Partial<ResourceLimits>
): ResourceLimitEnforcer {
  return new ResourceLimitEnforcerImpl(limits)
}
