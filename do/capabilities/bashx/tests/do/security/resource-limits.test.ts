/**
 * Resource Limits Tests
 *
 * Tests for Tier 4 sandbox resource limits to prevent DoS and resource exhaustion.
 * Implements execution time limits, output size limits, and graceful termination.
 *
 * Test Categories:
 * 1. ResourceLimits interface and types
 * 2. Execution time limit enforcement (Promise.race with timeout)
 * 3. Output size limit enforcement (truncate after N bytes)
 * 4. Graceful termination with cleanup
 * 5. Resource usage tracking in result
 * 6. Integration with SandboxExecutor
 *
 * @module tests/do/security/resource-limits
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import {
  ResourceLimits,
  ResourceLimitEnforcer,
  createResourceLimitEnforcer,
  DEFAULT_RESOURCE_LIMITS,
  ResourceLimitExceededError,
  ResourceUsage,
  LimitExceededType,
} from '../../../src/do/security/resource-limits.js'
import type { BashResult, ExecOptions } from '../../../src/types.js'

// ============================================================================
// MOCK HELPERS
// ============================================================================

/**
 * Create a mock execution function that returns after a specified delay
 */
function createDelayedExecution(delayMs: number, result: Partial<BashResult> = {}): () => Promise<BashResult> {
  return async (): Promise<BashResult> => {
    await new Promise(resolve => setTimeout(resolve, delayMs))
    return {
      input: 'test-command',
      command: 'test-command',
      stdout: result.stdout ?? 'output',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? 0,
      valid: true,
      generated: false,
      intent: {
        commands: ['test'],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      },
      classification: {
        type: 'execute',
        impact: 'none',
        reversible: true,
        reason: 'Test execution',
      },
      ...result,
    }
  }
}

/**
 * Create a mock execution function that generates large output
 */
function createLargeOutputExecution(outputSizeBytes: number): () => Promise<BashResult> {
  return async (): Promise<BashResult> => {
    const output = 'x'.repeat(outputSizeBytes)
    return {
      input: 'test-command',
      command: 'test-command',
      stdout: output,
      stderr: '',
      exitCode: 0,
      valid: true,
      generated: false,
      intent: {
        commands: ['test'],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      },
      classification: {
        type: 'execute',
        impact: 'none',
        reversible: true,
        reason: 'Test execution',
      },
    }
  }
}

// ============================================================================
// RESOURCE LIMITS INTERFACE TESTS
// ============================================================================

describe('ResourceLimits interface', () => {
  it('should have default limits defined', () => {
    expect(DEFAULT_RESOURCE_LIMITS).toBeDefined()
    expect(DEFAULT_RESOURCE_LIMITS.maxExecutionTimeMs).toBeGreaterThan(0)
    expect(DEFAULT_RESOURCE_LIMITS.maxOutputBytes).toBeGreaterThan(0)
  })

  it('should have reasonable default execution time limit', () => {
    // Default should be between 30 seconds and 5 minutes
    expect(DEFAULT_RESOURCE_LIMITS.maxExecutionTimeMs).toBeGreaterThanOrEqual(30000)
    expect(DEFAULT_RESOURCE_LIMITS.maxExecutionTimeMs).toBeLessThanOrEqual(300000)
  })

  it('should have reasonable default output size limit', () => {
    // Default should be at least 1MB
    expect(DEFAULT_RESOURCE_LIMITS.maxOutputBytes).toBeGreaterThanOrEqual(1024 * 1024)
  })

  it('should allow optional memory limit', () => {
    const limits: ResourceLimits = {
      maxExecutionTimeMs: 30000,
      maxOutputBytes: 1024 * 1024,
      maxMemoryMB: 128,
    }
    expect(limits.maxMemoryMB).toBe(128)
  })
})

// ============================================================================
// RESOURCE LIMIT ENFORCER CREATION TESTS
// ============================================================================

describe('ResourceLimitEnforcer creation', () => {
  it('should create enforcer with default limits', () => {
    const enforcer = createResourceLimitEnforcer()
    expect(enforcer).toBeDefined()
    expect(enforcer.getLimits()).toEqual(DEFAULT_RESOURCE_LIMITS)
  })

  it('should create enforcer with custom limits', () => {
    const customLimits: ResourceLimits = {
      maxExecutionTimeMs: 5000,
      maxOutputBytes: 512 * 1024,
    }
    const enforcer = createResourceLimitEnforcer(customLimits)
    expect(enforcer.getLimits()).toEqual(customLimits)
  })

  it('should merge custom limits with defaults', () => {
    const enforcer = createResourceLimitEnforcer({ maxExecutionTimeMs: 10000 })
    const limits = enforcer.getLimits()
    expect(limits.maxExecutionTimeMs).toBe(10000)
    expect(limits.maxOutputBytes).toBe(DEFAULT_RESOURCE_LIMITS.maxOutputBytes)
  })
})

// ============================================================================
// EXECUTION TIME LIMIT TESTS
// ============================================================================

describe('Execution time limit enforcement', () => {
  let enforcer: ResourceLimitEnforcer

  beforeEach(() => {
    enforcer = createResourceLimitEnforcer({
      maxExecutionTimeMs: 100, // 100ms for fast tests
      maxOutputBytes: 1024 * 1024,
    })
  })

  it('should allow execution within time limit', async () => {
    const execution = createDelayedExecution(50)
    const result = await enforcer.enforce(execution)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('output')
  })

  it('should timeout execution exceeding time limit', async () => {
    const execution = createDelayedExecution(500) // 500ms > 100ms limit

    await expect(enforcer.enforce(execution)).rejects.toThrow(ResourceLimitExceededError)
  })

  it('should include timeout type in error', async () => {
    const execution = createDelayedExecution(500)

    try {
      await enforcer.enforce(execution)
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceLimitExceededError)
      expect((error as ResourceLimitExceededError).limitType).toBe('time')
    }
  })

  it('should include elapsed time in error', async () => {
    const execution = createDelayedExecution(500)

    try {
      await enforcer.enforce(execution)
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceLimitExceededError)
      expect((error as ResourceLimitExceededError).resourceUsage.executionTimeMs).toBeGreaterThanOrEqual(100)
    }
  })

  it('should respect per-execution timeout override', async () => {
    const execution = createDelayedExecution(150)

    // Default enforcer has 100ms limit, but we override to 200ms
    const result = await enforcer.enforce(execution, { timeoutMs: 200 })
    expect(result.exitCode).toBe(0)
  })
})

// ============================================================================
// OUTPUT SIZE LIMIT TESTS
// ============================================================================

describe('Output size limit enforcement', () => {
  let enforcer: ResourceLimitEnforcer

  beforeEach(() => {
    enforcer = createResourceLimitEnforcer({
      maxExecutionTimeMs: 30000,
      maxOutputBytes: 1024, // 1KB for fast tests
    })
  })

  it('should allow output within size limit', async () => {
    const execution = createLargeOutputExecution(512) // 512 bytes < 1KB
    const result = await enforcer.enforce(execution)

    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBe(512)
  })

  it('should truncate output exceeding size limit', async () => {
    const execution = createLargeOutputExecution(2048) // 2KB > 1KB limit
    const result = await enforcer.enforce(execution)

    expect(result.stdout.length).toBeLessThanOrEqual(1024)
    expect(result.resourceUsage?.outputTruncated).toBe(true)
  })

  it('should add truncation notice to stderr', async () => {
    const execution = createLargeOutputExecution(2048)
    const result = await enforcer.enforce(execution)

    expect(result.stderr).toContain('truncated')
  })

  it('should report original output size in resource usage', async () => {
    const execution = createLargeOutputExecution(2048)
    const result = await enforcer.enforce(execution)

    expect(result.resourceUsage?.originalOutputBytes).toBe(2048)
    expect(result.resourceUsage?.truncatedOutputBytes).toBeLessThanOrEqual(1024)
  })

  it('should respect per-execution output size override', async () => {
    const execution = createLargeOutputExecution(1500)

    // Default enforcer has 1KB limit, but we override to 2KB
    const result = await enforcer.enforce(execution, { maxOutputBytes: 2048 })
    expect(result.stdout.length).toBe(1500)
    expect(result.resourceUsage?.outputTruncated).toBeFalsy()
  })
})

// ============================================================================
// GRACEFUL TERMINATION TESTS
// ============================================================================

describe('Graceful termination', () => {
  it('should call cleanup callback on timeout', async () => {
    const cleanup = vi.fn()
    const enforcer = createResourceLimitEnforcer({
      maxExecutionTimeMs: 50,
      maxOutputBytes: 1024 * 1024,
    })

    const execution = createDelayedExecution(500)

    try {
      await enforcer.enforce(execution, { onCleanup: cleanup })
    } catch {
      // Expected to throw
    }

    expect(cleanup).toHaveBeenCalled()
  })

  it('should not call cleanup on successful execution', async () => {
    const cleanup = vi.fn()
    const enforcer = createResourceLimitEnforcer({
      maxExecutionTimeMs: 200,
      maxOutputBytes: 1024 * 1024,
    })

    const execution = createDelayedExecution(50)
    await enforcer.enforce(execution, { onCleanup: cleanup })

    expect(cleanup).not.toHaveBeenCalled()
  })

  it('should handle cleanup errors gracefully', async () => {
    const cleanup = vi.fn().mockRejectedValue(new Error('Cleanup failed'))
    const enforcer = createResourceLimitEnforcer({
      maxExecutionTimeMs: 50,
      maxOutputBytes: 1024 * 1024,
    })

    const execution = createDelayedExecution(500)

    // Should still throw ResourceLimitExceededError, not cleanup error
    await expect(enforcer.enforce(execution, { onCleanup: cleanup })).rejects.toThrow(ResourceLimitExceededError)
  })
})

// ============================================================================
// RESOURCE USAGE TRACKING TESTS
// ============================================================================

describe('Resource usage tracking', () => {
  let enforcer: ResourceLimitEnforcer

  beforeEach(() => {
    enforcer = createResourceLimitEnforcer({
      maxExecutionTimeMs: 30000,
      maxOutputBytes: 1024 * 1024,
    })
  })

  it('should track execution time in result', async () => {
    const execution = createDelayedExecution(50)
    const result = await enforcer.enforce(execution)

    expect(result.resourceUsage).toBeDefined()
    expect(result.resourceUsage?.executionTimeMs).toBeGreaterThanOrEqual(50)
  })

  it('should track output size in result', async () => {
    const execution = createLargeOutputExecution(1000)
    const result = await enforcer.enforce(execution)

    expect(result.resourceUsage?.originalOutputBytes).toBe(1000)
  })

  it('should track limits that were applied', async () => {
    const execution = createDelayedExecution(10)
    const result = await enforcer.enforce(execution)

    expect(result.resourceUsage?.limitsApplied).toBeDefined()
    expect(result.resourceUsage?.limitsApplied.maxExecutionTimeMs).toBe(30000)
    expect(result.resourceUsage?.limitsApplied.maxOutputBytes).toBe(1024 * 1024)
  })

  it('should track memory usage if available', async () => {
    const execution = createDelayedExecution(10)
    const result = await enforcer.enforce(execution)

    // Memory tracking is optional - just verify structure
    if (result.resourceUsage?.memoryUsageMB !== undefined) {
      expect(typeof result.resourceUsage.memoryUsageMB).toBe('number')
    }
  })
})

// ============================================================================
// ERROR TYPES TESTS
// ============================================================================

describe('ResourceLimitExceededError', () => {
  it('should be an instance of Error', () => {
    const error = new ResourceLimitExceededError('time', 'Execution timed out', {
      executionTimeMs: 100,
      limitsApplied: { maxExecutionTimeMs: 50, maxOutputBytes: 1024 },
    })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ResourceLimitExceededError')
  })

  it('should include limit type', () => {
    const error = new ResourceLimitExceededError('output', 'Output too large', {
      executionTimeMs: 10,
      originalOutputBytes: 2048,
      limitsApplied: { maxExecutionTimeMs: 30000, maxOutputBytes: 1024 },
    })

    expect(error.limitType).toBe('output')
  })

  it('should include resource usage', () => {
    const usage: ResourceUsage = {
      executionTimeMs: 100,
      originalOutputBytes: 2048,
      limitsApplied: { maxExecutionTimeMs: 30000, maxOutputBytes: 1024 },
    }
    const error = new ResourceLimitExceededError('output', 'Output too large', usage)

    expect(error.resourceUsage).toEqual(usage)
  })
})

// ============================================================================
// LIMIT TYPE TESTS
// ============================================================================

describe('LimitExceededType', () => {
  it('should support time limit type', () => {
    const limitType: LimitExceededType = 'time'
    expect(limitType).toBe('time')
  })

  it('should support output limit type', () => {
    const limitType: LimitExceededType = 'output'
    expect(limitType).toBe('output')
  })

  it('should support memory limit type', () => {
    const limitType: LimitExceededType = 'memory'
    expect(limitType).toBe('memory')
  })
})

// ============================================================================
// INTEGRATION WITH BASHRESULT TESTS
// ============================================================================

describe('Integration with BashResult', () => {
  it('should augment BashResult with resourceUsage field', async () => {
    const enforcer = createResourceLimitEnforcer()
    const execution = createDelayedExecution(10)
    const result = await enforcer.enforce(execution)

    // Verify the result has all standard BashResult fields
    expect(result.input).toBeDefined()
    expect(result.command).toBeDefined()
    expect(result.stdout).toBeDefined()
    expect(result.stderr).toBeDefined()
    expect(result.exitCode).toBeDefined()
    expect(result.valid).toBeDefined()
    expect(result.generated).toBeDefined()
    expect(result.intent).toBeDefined()
    expect(result.classification).toBeDefined()

    // Plus the new resourceUsage field
    expect(result.resourceUsage).toBeDefined()
  })
})

// ============================================================================
// CONCURRENT EXECUTION TESTS
// ============================================================================

describe('Concurrent execution limits', () => {
  it('should enforce limits on concurrent executions independently', async () => {
    const enforcer = createResourceLimitEnforcer({
      maxExecutionTimeMs: 100,
      maxOutputBytes: 1024,
    })

    const fastExecution = createDelayedExecution(30)
    const slowExecution = createDelayedExecution(200)

    const results = await Promise.allSettled([
      enforcer.enforce(fastExecution),
      enforcer.enforce(slowExecution),
    ])

    expect(results[0].status).toBe('fulfilled')
    expect(results[1].status).toBe('rejected')
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge cases', () => {
  it('should handle zero timeout gracefully', async () => {
    // Zero timeout should effectively disable the limit
    const enforcer = createResourceLimitEnforcer({
      maxExecutionTimeMs: 0,
      maxOutputBytes: 1024,
    })

    const execution = createDelayedExecution(50)
    const result = await enforcer.enforce(execution)

    expect(result.exitCode).toBe(0)
  })

  it('should handle execution that produces no output', async () => {
    const enforcer = createResourceLimitEnforcer()
    const execution = createLargeOutputExecution(0)
    const result = await enforcer.enforce(execution)

    expect(result.stdout).toBe('')
    expect(result.resourceUsage?.originalOutputBytes).toBe(0)
  })

  it('should handle execution that throws', async () => {
    const enforcer = createResourceLimitEnforcer()
    const execution = async (): Promise<BashResult> => {
      throw new Error('Execution failed')
    }

    await expect(enforcer.enforce(execution)).rejects.toThrow('Execution failed')
  })

  it('should not confuse execution error with timeout', async () => {
    const enforcer = createResourceLimitEnforcer({ maxExecutionTimeMs: 100 })
    const execution = async (): Promise<BashResult> => {
      await new Promise(resolve => setTimeout(resolve, 10))
      throw new Error('Command not found')
    }

    try {
      await enforcer.enforce(execution)
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).not.toBeInstanceOf(ResourceLimitExceededError)
      expect((error as Error).message).toBe('Command not found')
    }
  })
})
