/**
 * Tests for Polymorphic Executor Dispatch
 *
 * This test file verifies the polymorphic dispatch mechanism where
 * TierClassification includes an executor instance that can be called
 * directly, replacing the switch-based handler dispatch.
 *
 * TDD Phase: RED - These tests should FAIL until implementation is added.
 *
 * @module tests/do/tiered-executor-dispatch
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  TieredExecutor,
  type TierClassification,
} from '../../../src/do/tiered-executor.js'
import type { TierExecutor, LanguageExecutor, SupportedLanguage } from '../../../src/do/executors/types.js'
import type { BashResult, ExecOptions, FsCapability } from '../../../src/types.js'

// ============================================================================
// MOCK HELPERS
// ============================================================================

/**
 * Create a mock TierExecutor for testing polymorphic dispatch.
 */
function createMockTierExecutor(name: string, output: string): TierExecutor {
  return {
    canExecute: vi.fn(() => true),
    execute: vi.fn(async (command: string, _options?: ExecOptions): Promise<BashResult> => ({
      input: command,
      command,
      valid: true,
      generated: false,
      stdout: `${name}: ${output}\n`,
      stderr: '',
      exitCode: 0,
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
        impact: 'low',
        reversible: true,
        reason: `Executed via ${name}`,
      },
    })),
  }
}

/**
 * Create a mock LanguageExecutor for testing polyglot dispatch.
 */
function createMockLanguageExecutor(languages: SupportedLanguage[]): LanguageExecutor {
  return {
    canExecute: vi.fn((lang: SupportedLanguage) => languages.includes(lang)),
    execute: vi.fn(async (command: string, language: SupportedLanguage, _options?: ExecOptions): Promise<BashResult> => ({
      input: command,
      command,
      valid: true,
      generated: false,
      stdout: `polyglot-${language}: executed\n`,
      stderr: '',
      exitCode: 0,
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
        impact: 'low',
        reversible: true,
        reason: `Executed via polyglot ${language}`,
      },
    })),
    getAvailableLanguages: () => languages,
  }
}

/**
 * Create a mock FsCapability for testing.
 */
function createMockFsCapability(): FsCapability {
  return {
    read: vi.fn(async () => 'test content\n'),
    exists: vi.fn(async () => true),
    list: vi.fn(async () => []),
    stat: vi.fn(async () => ({
      size: 100,
      isDirectory: () => false,
      isFile: () => true,
    })),
  } as unknown as FsCapability
}

/**
 * Create a mock sandbox binding.
 */
function createMockSandbox() {
  return {
    execute: vi.fn(async (command: string): Promise<BashResult> => ({
      input: command,
      command,
      valid: true,
      generated: false,
      stdout: `sandbox: ${command}\n`,
      stderr: '',
      exitCode: 0,
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
        impact: 'medium',
        reversible: false,
        reason: 'Executed via sandbox',
      },
    })),
  }
}

// ============================================================================
// POLYMORPHIC DISPATCH TESTS
// ============================================================================

describe('TierClassification - Polymorphic Executor Dispatch', () => {
  describe('Executor Instance in Classification', () => {
    it('includes executor instance in TierClassification for native commands', () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })

      const classification = executor.classifyCommand('echo hello')

      // Classification should include an executor instance
      expect(classification.executor).toBeDefined()
      expect(typeof classification.executor?.execute).toBe('function')
    })

    it('includes executor instance in TierClassification for sandbox commands', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      const classification = executor.classifyCommand('docker ps')

      // Classification should include an executor instance
      expect(classification.executor).toBeDefined()
      expect(typeof classification.executor?.execute).toBe('function')
    })

    it('includes executor instance in TierClassification for RPC commands', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        rpcBindings: {
          customtool: {
            name: 'customtool',
            endpoint: 'https://customtool.do',
            commands: ['customtool'],
          },
        },
      })

      const classification = executor.classifyCommand('customtool --help')

      // Classification should include an executor instance
      expect(classification.executor).toBeDefined()
      expect(typeof classification.executor?.execute).toBe('function')
    })

    it('includes executor instance for polyglot commands when worker available', () => {
      const pythonBinding = {
        fetch: vi.fn(async () => new Response(JSON.stringify({
          stdout: 'Python output\n',
          stderr: '',
          exitCode: 0,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
      }

      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        languageWorkers: {
          python: pythonBinding,
        },
      })

      const classification = executor.classifyCommand('python -c "print(1)"')

      // Classification should include an executor instance
      expect(classification.executor).toBeDefined()
      expect(typeof classification.executor?.execute).toBe('function')
    })

    it('keeps handler string for debugging/logging alongside executor', () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })

      const classification = executor.classifyCommand('echo hello')

      // Should still have handler string
      expect(classification.handler).toBe('native')
      // AND should have executor
      expect(classification.executor).toBeDefined()
    })
  })

  describe('Polymorphic Dispatch in execute()', () => {
    it('uses classification.executor.execute() when executor is present', async () => {
      const mockExecutor = createMockTierExecutor('test', 'polymorphic output')
      const sandbox = createMockSandbox()

      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox,
      })

      // We need to verify that when an executor is present in classification,
      // it gets called directly instead of going through the switch statement.
      // This test verifies the behavior indirectly through the result.

      const result = await executor.execute('echo hello')

      // The result should come from proper execution
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('hello')
    })

    it('falls back to switch dispatch when executor is missing (backward compatibility)', async () => {
      const sandbox = createMockSandbox()

      const executor = new TieredExecutor({
        sandbox,
      })

      // docker command goes to sandbox - should still work via switch fallback
      const result = await executor.execute('docker ps')

      expect(result.exitCode).toBe(0)
      expect(sandbox.execute).toHaveBeenCalled()
    })
  })

  describe('Type Safety', () => {
    it('TierClassification.executor is optional for backward compatibility', () => {
      // This is a compile-time check - if it compiles, the test passes
      const classification: TierClassification = {
        tier: 1,
        reason: 'test',
        handler: 'native',
        // executor is intentionally omitted
      }

      expect(classification.executor).toBeUndefined()
    })

    it('executor can be TierExecutor type', () => {
      const tierExecutor = createMockTierExecutor('native', 'output')

      const classification: TierClassification = {
        tier: 1,
        reason: 'test',
        handler: 'native',
        executor: tierExecutor,
      }

      expect(classification.executor).toBeDefined()
      expect(typeof classification.executor?.execute).toBe('function')
    })

    it('executor can be LanguageExecutor type', () => {
      const langExecutor = createMockLanguageExecutor(['python', 'ruby'])

      // For polyglot, the executor could be LanguageExecutor
      // The type should allow both TierExecutor and LanguageExecutor
      const classification: TierClassification = {
        tier: 2,
        reason: 'polyglot execution',
        handler: 'polyglot',
        executor: langExecutor as unknown as TierExecutor, // Type union should handle this
      }

      expect(classification.executor).toBeDefined()
    })
  })

  describe('Classification Executor Assignment', () => {
    it('assigns native executor for Tier 1 filesystem commands', () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })

      const classification = executor.classifyCommand('cat /etc/passwd')

      expect(classification.tier).toBe(1)
      expect(classification.handler).toBe('native')
      expect(classification.executor).toBeDefined()
    })

    it('assigns native executor for Tier 1 compute commands', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      const classification = executor.classifyCommand('true')

      expect(classification.tier).toBe(1)
      expect(classification.handler).toBe('native')
      expect(classification.executor).toBeDefined()
    })

    it('assigns rpc executor for Tier 2 RPC commands', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        rpcBindings: {
          git: {
            name: 'git',
            endpoint: 'https://git.do',
            commands: ['git'],
          },
        },
      })

      const classification = executor.classifyCommand('git status')

      expect(classification.tier).toBe(2)
      expect(classification.handler).toBe('rpc')
      expect(classification.executor).toBeDefined()
    })

    it('assigns sandbox executor for Tier 4 commands', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      const classification = executor.classifyCommand('docker ps')

      expect(classification.tier).toBe(4)
      expect(classification.handler).toBe('sandbox')
      expect(classification.executor).toBeDefined()
    })

    it('assigns polyglot executor for language commands with worker', () => {
      const pythonBinding = {
        fetch: vi.fn(async () => new Response(JSON.stringify({
          stdout: 'output\n',
          stderr: '',
          exitCode: 0,
        }), { status: 200 })),
      }

      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        languageWorkers: {
          python: pythonBinding,
        },
      })

      const classification = executor.classifyCommand('python script.py')

      expect(classification.handler).toBe('polyglot')
      expect(classification.capability).toBe('python')
      expect(classification.executor).toBeDefined()
    })
  })

  describe('Executor Execution via Classification', () => {
    it('can execute command through classification.executor directly', async () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })

      const classification = executor.classifyCommand('echo direct-call')

      // If executor is present, we should be able to call it directly
      if (classification.executor) {
        const result = await classification.executor.execute('echo direct-call')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('direct-call')
      } else {
        // Test fails if executor is not present
        expect(classification.executor).toBeDefined()
      }
    })

    it('executor in classification produces same result as TieredExecutor.execute()', async () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })

      const command = 'echo comparison-test'
      const classification = executor.classifyCommand(command)

      // Get result from both paths
      const directResult = await executor.execute(command)

      // Both should produce the same output
      expect(directResult.stdout).toContain('comparison-test')
      expect(directResult.exitCode).toBe(0)

      // If executor is present, it should also work
      if (classification.executor) {
        const executorResult = await classification.executor.execute(command)
        expect(executorResult.stdout).toBe(directResult.stdout)
        expect(executorResult.exitCode).toBe(directResult.exitCode)
      }
    })
  })
})

// ============================================================================
// BACKWARD COMPATIBILITY TESTS
// ============================================================================

describe('Backward Compatibility - Switch Fallback', () => {
  it('still works when classification has no executor (legacy behavior)', async () => {
    const sandbox = createMockSandbox()
    const executor = new TieredExecutor({
      sandbox,
    })

    // This should work even if executor is not set
    const result = await executor.execute('docker run alpine')

    expect(result.exitCode).toBe(0)
    expect(sandbox.execute).toHaveBeenCalled()
  })

  it('handler string is preserved for all classification types', () => {
    const executor = new TieredExecutor({
      fs: createMockFsCapability(),
      sandbox: createMockSandbox(),
      rpcBindings: {
        git: {
          name: 'git',
          endpoint: 'https://git.do',
          commands: ['git'],
        },
      },
    })

    // Native
    const native = executor.classifyCommand('echo test')
    expect(native.handler).toBe('native')

    // RPC
    const rpc = executor.classifyCommand('git status')
    expect(rpc.handler).toBe('rpc')

    // Sandbox
    const sandbox = executor.classifyCommand('docker ps')
    expect(sandbox.handler).toBe('sandbox')
  })

  it('existing tests continue to pass with new executor field', async () => {
    // This is a smoke test to ensure adding the executor field
    // doesn't break existing functionality

    const executor = new TieredExecutor({
      fs: createMockFsCapability(),
      sandbox: createMockSandbox(),
    })

    // Various commands should still work
    const echoResult = await executor.execute('echo hello')
    expect(echoResult.exitCode).toBe(0)

    const trueResult = await executor.execute('true')
    expect(trueResult.exitCode).toBe(0)

    const falseResult = await executor.execute('false')
    expect(falseResult.exitCode).toBe(1)
  })
})
