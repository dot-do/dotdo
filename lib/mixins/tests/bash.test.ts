/**
 * withBash Mixin Tests (TDD - RED Phase)
 *
 * Tests for the withBash mixin that adds $.bash capability to DO classes.
 * Uses BashModule from bashx/do for AST-based safety analysis and execution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DO } from '../../../objects/DO'
import { withFs } from '../fs'
import { withBash, BashModule } from '../bash'
import type { BashExecutor, BashResult, BashCapability } from '../bash'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Mock executor for testing
 */
function createMockExecutor(
  responses: Partial<BashResult> = {}
): BashExecutor {
  return {
    execute: vi.fn().mockResolvedValue({
      input: 'test command',
      command: 'test command',
      valid: true,
      generated: false,
      stdout: 'mock output',
      stderr: '',
      exitCode: 0,
      intent: {
        commands: ['test'],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      },
      classification: {
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Mock execution',
      },
      ...responses,
    }),
  }
}

/**
 * Mock DurableObjectState for testing
 */
function createMockDOState(): DurableObjectState {
  const storage = new Map<string, unknown>()
  return {
    id: { toString: () => 'test-do-id' } as DurableObjectId,
    storage: {
      get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
      put: vi.fn((key: string, value: unknown) => {
        storage.set(key, value)
        return Promise.resolve()
      }),
      delete: vi.fn((key: string) => {
        storage.delete(key)
        return Promise.resolve(true)
      }),
      list: vi.fn(() => Promise.resolve(storage)),
      sql: {
        exec: vi.fn(),
      },
    } as unknown as DurableObjectStorage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn((fn: () => Promise<unknown>) => fn()),
  } as unknown as DurableObjectState
}

/**
 * Mock environment
 */
function createMockEnv() {
  return {
    DO: undefined,
    KV: undefined,
    R2: undefined,
    PIPELINE: undefined,
  }
}

// ============================================================================
// MIXIN COMPOSITION TESTS
// ============================================================================

describe('withBash Mixin', () => {
  describe('Mixin Composition', () => {
    it('should extend DO class with bash capability', () => {
      const mockExecutor = createMockExecutor()

      const DOWithBash = withBash(DO, {
        executor: () => mockExecutor,
      })

      const state = createMockDOState()
      const env = createMockEnv()
      const instance = new DOWithBash(state, env)

      expect(instance).toBeInstanceOf(DO)
      expect(instance.$.bash).toBeDefined()
    })

    it('should compose with withFs mixin', () => {
      const mockExecutor = createMockExecutor()

      // Compose: DO -> withFs -> withBash
      const DOWithFsAndBash = withBash(withFs(DO), {
        executor: () => mockExecutor,
      })

      const state = createMockDOState()
      const env = createMockEnv()
      const instance = new DOWithFsAndBash(state, env)

      expect(instance.$.fs).toBeDefined()
      expect(instance.$.bash).toBeDefined()
    })

    it('should add "bash" to static capabilities array', () => {
      const mockExecutor = createMockExecutor()

      const DOWithBash = withBash(DO, {
        executor: () => mockExecutor,
      })

      expect((DOWithBash as any).capabilities).toContain('bash')
    })

    it('should return true from hasCapability("bash")', () => {
      const mockExecutor = createMockExecutor()

      const DOWithBash = withBash(DO, {
        executor: () => mockExecutor,
      })

      const state = createMockDOState()
      const env = createMockEnv()
      const instance = new DOWithBash(state, env)

      expect(instance.hasCapability('bash')).toBe(true)
    })
  })

  describe('Executor Injection', () => {
    it('should accept executor factory function', () => {
      const mockExecutor = createMockExecutor()
      const executorFactory = vi.fn(() => mockExecutor)

      const DOWithBash = withBash(DO, {
        executor: executorFactory,
      })

      const state = createMockDOState()
      const env = createMockEnv()
      const instance = new DOWithBash(state, env)

      // Access $.bash to trigger lazy initialization
      const bash = instance.$.bash

      expect(executorFactory).toHaveBeenCalledWith(instance)
    })

    it('should lazily initialize BashModule on first access', () => {
      const mockExecutor = createMockExecutor()
      const executorFactory = vi.fn(() => mockExecutor)

      const DOWithBash = withBash(DO, {
        executor: executorFactory,
      })

      const state = createMockDOState()
      const env = createMockEnv()
      const instance = new DOWithBash(state, env)

      // Factory should not be called yet
      expect(executorFactory).not.toHaveBeenCalled()

      // First access triggers initialization
      const bash1 = instance.$.bash
      expect(executorFactory).toHaveBeenCalledTimes(1)

      // Second access should return cached instance
      const bash2 = instance.$.bash
      expect(executorFactory).toHaveBeenCalledTimes(1)
      expect(bash1).toBe(bash2)
    })

    it('should pass instance to executor factory for env access', async () => {
      let capturedInstance: any = null
      const mockExecutor = createMockExecutor()

      const DOWithBash = withBash(DO, {
        executor: (instance) => {
          capturedInstance = instance
          return mockExecutor
        },
      })

      const state = createMockDOState()
      const env = createMockEnv()
      const instance = new DOWithBash(state, env)

      // Access bash to trigger executor creation
      instance.$.bash

      expect(capturedInstance).toBe(instance)
      expect(capturedInstance.env).toBe(env)
    })
  })

  describe('FsCapability Integration', () => {
    it('should accept optional fs capability from config', () => {
      const mockExecutor = createMockExecutor()

      // Use withFs first to have $.fs available
      const DOWithFsAndBash = withBash(withFs(DO), {
        executor: () => mockExecutor,
        fs: (instance) => instance.$.fs,
      })

      const state = createMockDOState()
      const env = createMockEnv()
      const instance = new DOWithFsAndBash(state, env)

      // Should not throw when accessing bash
      expect(() => instance.$.bash).not.toThrow()
    })

    it('should work without fs capability', () => {
      const mockExecutor = createMockExecutor()

      // Just withBash, no withFs
      const DOWithBash = withBash(DO, {
        executor: () => mockExecutor,
      })

      const state = createMockDOState()
      const env = createMockEnv()
      const instance = new DOWithBash(state, env)

      // Should work without fs
      expect(() => instance.$.bash).not.toThrow()
    })
  })
})

// ============================================================================
// BASH CAPABILITY TESTS
// ============================================================================

describe('BashCapability Interface', () => {
  let mockExecutor: BashExecutor
  let instance: InstanceType<ReturnType<typeof withBash>>

  beforeEach(() => {
    mockExecutor = createMockExecutor()

    const DOWithBash = withBash(DO, {
      executor: () => mockExecutor,
    })

    const state = createMockDOState()
    const env = createMockEnv()
    instance = new DOWithBash(state, env)
  })

  describe('exec()', () => {
    it('should execute command and return BashResult', async () => {
      const result = await instance.$.bash.exec('ls', ['-la'])

      expect(result).toBeDefined()
      expect(result.stdout).toBe('mock output')
      expect(result.exitCode).toBe(0)
    })

    it('should pass command with args to executor', async () => {
      await instance.$.bash.exec('git', ['status', '--short'])

      expect(mockExecutor.execute).toHaveBeenCalledWith(
        'git status --short',
        undefined
      )
    })

    it('should accept execution options', async () => {
      await instance.$.bash.exec('npm', ['install'], {
        cwd: '/app',
        timeout: 60000,
      })

      expect(mockExecutor.execute).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          cwd: '/app',
          timeout: 60000,
        })
      )
    })
  })

  describe('run()', () => {
    it('should execute shell script', async () => {
      const result = await instance.$.bash.run('echo hello && echo world')

      expect(result).toBeDefined()
      expect(mockExecutor.execute).toHaveBeenCalled()
    })

    it('should handle multi-line scripts', async () => {
      const script = `
        set -e
        cd /app
        npm install
        npm run build
      `

      await instance.$.bash.run(script)

      expect(mockExecutor.execute).toHaveBeenCalledWith(
        script,
        undefined
      )
    })
  })

  describe('spawn()', () => {
    it('should spawn process with streaming support', async () => {
      mockExecutor.spawn = vi.fn().mockResolvedValue({
        pid: 12345,
        done: Promise.resolve({
          stdout: 'streamed output',
          stderr: '',
          exitCode: 0,
        }),
        kill: vi.fn(),
        write: vi.fn(),
        closeStdin: vi.fn(),
      })

      const handle = await instance.$.bash.spawn('tail', ['-f', '/var/log/app.log'])

      expect(handle).toBeDefined()
      expect(handle.pid).toBe(12345)
      expect(typeof handle.kill).toBe('function')
    })

    it('should throw if executor does not support spawn', async () => {
      // Default mock executor has no spawn method
      await expect(
        instance.$.bash.spawn('tail', ['-f', 'log.txt'])
      ).rejects.toThrow('Spawn not supported')
    })
  })

  describe('parse()', () => {
    it('should parse command into AST without executing', () => {
      const ast = instance.$.bash.parse('ls -la /home')

      expect(ast).toBeDefined()
      expect(ast.type).toBe('Program')
    })
  })

  describe('analyze()', () => {
    it('should return safety classification and intent', () => {
      const analysis = instance.$.bash.analyze('rm -rf /tmp/build')

      expect(analysis.classification).toBeDefined()
      expect(analysis.classification.type).toBeDefined()
      expect(analysis.classification.impact).toBeDefined()
      expect(analysis.intent).toBeDefined()
    })
  })

  describe('isDangerous()', () => {
    it('should identify dangerous commands', () => {
      const result = instance.$.bash.isDangerous('rm -rf /')

      expect(result.dangerous).toBe(true)
      expect(result.reason).toBeDefined()
    })

    it('should identify safe commands', () => {
      const result = instance.$.bash.isDangerous('ls -la')

      expect(result.dangerous).toBe(false)
    })
  })
})

// ============================================================================
// SAFETY BLOCKING TESTS
// ============================================================================

describe('Safety Blocking', () => {
  let mockExecutor: BashExecutor
  let instance: InstanceType<ReturnType<typeof withBash>>

  beforeEach(() => {
    mockExecutor = createMockExecutor()

    const DOWithBash = withBash(DO, {
      executor: () => mockExecutor,
    })

    const state = createMockDOState()
    const env = createMockEnv()
    instance = new DOWithBash(state, env)
  })

  it('should block dangerous commands by default', async () => {
    const result = await instance.$.bash.exec('rm', ['-rf', '/'])

    expect(result.blocked).toBe(true)
    expect(result.requiresConfirm).toBe(true)
    expect(mockExecutor.execute).not.toHaveBeenCalled()
  })

  it('should allow dangerous commands with confirm: true', async () => {
    await instance.$.bash.exec('rm', ['-rf', '/tmp/build'], { confirm: true })

    expect(mockExecutor.execute).toHaveBeenCalled()
  })

  it('should not block safe read commands', async () => {
    await instance.$.bash.exec('ls', ['-la'])

    expect(mockExecutor.execute).toHaveBeenCalled()
  })
})

// ============================================================================
// TYPE EXPORTS TESTS
// ============================================================================

describe('Type Exports', () => {
  it('should export BashCapability type', () => {
    // This test verifies the type is exported - TypeScript will fail at compile time if not
    const capability: BashCapability = {
      exec: vi.fn(),
      spawn: vi.fn(),
      run: vi.fn(),
      parse: vi.fn(),
      analyze: vi.fn(),
      isDangerous: vi.fn(),
    }
    expect(capability).toBeDefined()
  })

  it('should export BashExecutor type', () => {
    const executor: BashExecutor = {
      execute: vi.fn(),
    }
    expect(executor).toBeDefined()
  })

  it('should export BashModule class', () => {
    expect(BashModule).toBeDefined()
  })
})

// ============================================================================
// WITHBASHCONTEXT TESTS
// ============================================================================

describe('WithBashContext Type', () => {
  it('should provide properly typed $.bash on extended DO', () => {
    const mockExecutor = createMockExecutor()

    const DOWithBash = withBash(DO, {
      executor: () => mockExecutor,
    })

    const state = createMockDOState()
    const env = createMockEnv()
    const instance = new DOWithBash(state, env)

    // TypeScript should recognize these methods
    const bash = instance.$.bash
    expect(bash.exec).toBeDefined()
    expect(bash.run).toBeDefined()
    expect(bash.spawn).toBeDefined()
    expect(bash.parse).toBeDefined()
    expect(bash.analyze).toBeDefined()
    expect(bash.isDangerous).toBeDefined()
  })
})
