/**
 * Sandbox Resource Limits Integration Tests
 *
 * Tests for integrating resource limits with SandboxExecutor.
 * Verifies that resource limits are properly applied to sandbox execution.
 *
 * @module tests/do/security/sandbox-resource-limits
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import {
  SandboxExecutor,
  createSandboxExecutor,
  type SandboxBackend,
  type SandboxExecutorConfig,
} from '../../../src/do/executors/sandbox-executor.js'
import {
  ResourceLimits,
  ResourceLimitExceededError,
  DEFAULT_RESOURCE_LIMITS,
} from '../../../src/do/security/resource-limits.js'
import type { BashResult, ExecOptions, SpawnHandle } from '../../../src/types.js'

// ============================================================================
// MOCK HELPERS
// ============================================================================

/**
 * Create a mock sandbox backend that can simulate various behaviors
 */
function createMockSandboxBackend(options: {
  delayMs?: number
  outputSize?: number
  throwError?: Error
} = {}): SandboxBackend {
  return {
    execute: vi.fn(async (command: string, execOptions?: ExecOptions): Promise<BashResult> => {
      // Simulate delay
      if (options.delayMs) {
        await new Promise(resolve => setTimeout(resolve, options.delayMs))
      }

      // Simulate error
      if (options.throwError) {
        throw options.throwError
      }

      // Generate output
      const stdout = options.outputSize
        ? 'x'.repeat(options.outputSize)
        : `sandbox output: ${command}`

      return {
        input: command,
        command,
        stdout,
        stderr: '',
        exitCode: 0,
        valid: true,
        generated: false,
        intent: {
          commands: [command.split(' ')[0]],
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
          reason: 'Sandbox execution',
        },
      }
    }),
    spawn: vi.fn(async (command: string, args?: string[]): Promise<SpawnHandle> => {
      return {
        pid: 12345,
        stdin: {
          write: vi.fn(async () => {}),
          close: vi.fn(async () => {}),
        },
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn(),
        kill: vi.fn(async () => {}),
        wait: vi.fn(async () => ({ exitCode: 0 })),
      }
    }),
  }
}

// ============================================================================
// SANDBOX EXECUTOR WITH RESOURCE LIMITS CONFIG TESTS
// ============================================================================

describe('SandboxExecutor with resource limits configuration', () => {
  it('should accept resource limits in configuration', () => {
    const sandbox = createMockSandboxBackend()
    const config: SandboxExecutorConfig = {
      sandbox,
      defaultTimeout: 30000,
      resourceLimits: {
        maxExecutionTimeMs: 10000,
        maxOutputBytes: 512 * 1024,
      },
    }

    const executor = createSandboxExecutor(config)
    expect(executor).toBeDefined()
  })

  it('should use default resource limits when not configured', () => {
    const sandbox = createMockSandboxBackend()
    const executor = createSandboxExecutor({ sandbox })

    expect(executor.getResourceLimits()).toEqual(DEFAULT_RESOURCE_LIMITS)
  })

  it('should use custom resource limits when configured', () => {
    const sandbox = createMockSandboxBackend()
    const customLimits: ResourceLimits = {
      maxExecutionTimeMs: 5000,
      maxOutputBytes: 256 * 1024,
    }
    const executor = createSandboxExecutor({
      sandbox,
      resourceLimits: customLimits,
    })

    expect(executor.getResourceLimits()).toEqual(customLimits)
  })
})

// ============================================================================
// EXECUTION TIME LIMIT INTEGRATION TESTS
// ============================================================================

describe('SandboxExecutor execution time limit enforcement', () => {
  it('should execute commands within time limit', async () => {
    const sandbox = createMockSandboxBackend({ delayMs: 50 })
    const executor = createSandboxExecutor({
      sandbox,
      resourceLimits: {
        maxExecutionTimeMs: 200,
        maxOutputBytes: 1024 * 1024,
      },
    })

    const result = await executor.execute('test-command')
    expect(result.exitCode).toBe(0)
  })

  it('should timeout commands exceeding time limit', async () => {
    const sandbox = createMockSandboxBackend({ delayMs: 500 })
    const executor = createSandboxExecutor({
      sandbox,
      resourceLimits: {
        maxExecutionTimeMs: 100,
        maxOutputBytes: 1024 * 1024,
      },
    })

    await expect(executor.execute('slow-command')).rejects.toThrow(ResourceLimitExceededError)
  })

  it('should include resource usage in successful result', async () => {
    const sandbox = createMockSandboxBackend({ delayMs: 50 })
    const executor = createSandboxExecutor({
      sandbox,
      resourceLimits: {
        maxExecutionTimeMs: 200,
        maxOutputBytes: 1024 * 1024,
      },
    })

    const result = await executor.execute('test-command')
    expect(result.resourceUsage).toBeDefined()
    expect(result.resourceUsage?.executionTimeMs).toBeGreaterThanOrEqual(50)
  })
})

// ============================================================================
// OUTPUT SIZE LIMIT INTEGRATION TESTS
// ============================================================================

describe('SandboxExecutor output size limit enforcement', () => {
  it('should allow output within size limit', async () => {
    const sandbox = createMockSandboxBackend({ outputSize: 512 })
    const executor = createSandboxExecutor({
      sandbox,
      resourceLimits: {
        maxExecutionTimeMs: 30000,
        maxOutputBytes: 1024,
      },
    })

    const result = await executor.execute('test-command')
    expect(result.stdout.length).toBe(512)
    expect(result.resourceUsage?.outputTruncated).toBeFalsy()
  })

  it('should truncate output exceeding size limit', async () => {
    const sandbox = createMockSandboxBackend({ outputSize: 2048 })
    const executor = createSandboxExecutor({
      sandbox,
      resourceLimits: {
        maxExecutionTimeMs: 30000,
        maxOutputBytes: 1024,
      },
    })

    const result = await executor.execute('test-command')
    expect(result.stdout.length).toBeLessThanOrEqual(1024)
    expect(result.resourceUsage?.outputTruncated).toBe(true)
  })

  it('should add truncation notice to stderr', async () => {
    const sandbox = createMockSandboxBackend({ outputSize: 2048 })
    const executor = createSandboxExecutor({
      sandbox,
      resourceLimits: {
        maxExecutionTimeMs: 30000,
        maxOutputBytes: 1024,
      },
    })

    const result = await executor.execute('test-command')
    expect(result.stderr).toContain('truncated')
  })
})

// ============================================================================
// RESOURCE USAGE TRACKING TESTS
// ============================================================================

describe('SandboxExecutor resource usage tracking', () => {
  it('should track execution time in result', async () => {
    const sandbox = createMockSandboxBackend({ delayMs: 100 })
    const executor = createSandboxExecutor({
      sandbox,
      resourceLimits: {
        maxExecutionTimeMs: 500,
        maxOutputBytes: 1024 * 1024,
      },
    })

    const result = await executor.execute('test-command')
    expect(result.resourceUsage?.executionTimeMs).toBeGreaterThanOrEqual(100)
  })

  it('should track output size in result', async () => {
    const sandbox = createMockSandboxBackend({ outputSize: 500 })
    const executor = createSandboxExecutor({ sandbox })

    const result = await executor.execute('test-command')
    expect(result.resourceUsage?.originalOutputBytes).toBe(500)
  })

  it('should track limits applied in result', async () => {
    const limits: ResourceLimits = {
      maxExecutionTimeMs: 10000,
      maxOutputBytes: 512 * 1024,
    }
    const sandbox = createMockSandboxBackend()
    const executor = createSandboxExecutor({
      sandbox,
      resourceLimits: limits,
    })

    const result = await executor.execute('test-command')
    expect(result.resourceUsage?.limitsApplied).toEqual(limits)
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('SandboxExecutor error handling with resource limits', () => {
  it('should propagate sandbox errors (not wrap as resource limit error)', async () => {
    const sandbox = createMockSandboxBackend({ throwError: new Error('Sandbox crashed') })
    const executor = createSandboxExecutor({
      sandbox,
      resourceLimits: {
        maxExecutionTimeMs: 30000,
        maxOutputBytes: 1024 * 1024,
      },
    })

    await expect(executor.execute('test-command')).rejects.toThrow('Sandbox crashed')
  })

  it('should throw ResourceLimitExceededError for time limits only', async () => {
    const sandbox = createMockSandboxBackend({ delayMs: 500 })
    const executor = createSandboxExecutor({
      sandbox,
      resourceLimits: {
        maxExecutionTimeMs: 100,
        maxOutputBytes: 1024 * 1024,
      },
    })

    try {
      await executor.execute('slow-command')
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceLimitExceededError)
      expect((error as ResourceLimitExceededError).limitType).toBe('time')
    }
  })
})

// ============================================================================
// PER-EXECUTION OVERRIDE TESTS
// ============================================================================

describe('SandboxExecutor per-execution resource limit overrides', () => {
  it('should allow timeout override via exec options', async () => {
    const sandbox = createMockSandboxBackend({ delayMs: 150 })
    const executor = createSandboxExecutor({
      sandbox,
      resourceLimits: {
        maxExecutionTimeMs: 100, // Default would timeout
        maxOutputBytes: 1024 * 1024,
      },
    })

    // Override with longer timeout
    const result = await executor.execute('slow-command', { timeout: 300 })
    expect(result.exitCode).toBe(0)
  })

  it('should allow output size override via exec options', async () => {
    const sandbox = createMockSandboxBackend({ outputSize: 1500 })
    const executor = createSandboxExecutor({
      sandbox,
      resourceLimits: {
        maxExecutionTimeMs: 30000,
        maxOutputBytes: 1024, // Default would truncate
      },
    })

    // Override with larger output limit
    const result = await executor.execute('big-output-command', { maxOutputSize: 2048 })
    expect(result.stdout.length).toBe(1500)
    expect(result.resourceUsage?.outputTruncated).toBeFalsy()
  })
})

// ============================================================================
// DISABLE LIMITS TESTS
// ============================================================================

describe('SandboxExecutor disable resource limits', () => {
  it('should disable time limit when set to 0', async () => {
    const sandbox = createMockSandboxBackend({ delayMs: 100 })
    const executor = createSandboxExecutor({
      sandbox,
      resourceLimits: {
        maxExecutionTimeMs: 0, // Disabled
        maxOutputBytes: 1024 * 1024,
      },
    })

    const result = await executor.execute('test-command')
    expect(result.exitCode).toBe(0)
  })

  it('should use very large output limit when not enforcing', async () => {
    const sandbox = createMockSandboxBackend({ outputSize: 10 * 1024 * 1024 }) // 10MB
    const executor = createSandboxExecutor({
      sandbox,
      resourceLimits: {
        maxExecutionTimeMs: 30000,
        maxOutputBytes: 100 * 1024 * 1024, // 100MB (effectively unlimited)
      },
    })

    const result = await executor.execute('test-command')
    expect(result.resourceUsage?.outputTruncated).toBeFalsy()
  })
})
