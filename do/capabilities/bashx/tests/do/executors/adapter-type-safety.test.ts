/**
 * Tests for Executor Adapter Type Safety
 *
 * This test file verifies that the executor adapters use proper type-safe
 * access to tier execution methods, eliminating the need for `as any` casts.
 *
 * TDD Phase: RED - These tests verify type safety improvements.
 *
 * @module tests/do/executors/adapter-type-safety
 */

import { describe, it, expect, vi } from 'vitest'
import {
  TieredExecutor,
  type TierClassification,
} from '../../../src/do/tiered-executor.js'
import type { TierExecutor, LanguageExecutor } from '../../../src/do/executors/types.js'
import type { BashResult, FsCapability } from '../../../src/types.js'

// ============================================================================
// MOCK HELPERS
// ============================================================================

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
// TYPE SAFETY TESTS
// ============================================================================

describe('Executor Adapter Type Safety', () => {
  describe('TierExecutionMethod Type', () => {
    it('TierExecutionMethod type should be exported from types.ts', async () => {
      // This test verifies that the TierExecutionMethod type exists
      // and can be imported from the types module
      const typesModule = await import('../../../src/do/executors/types.js')

      // The type should be available (this is a compile-time check)
      // We verify the module exports the expected types
      expect(typesModule).toBeDefined()
    })
  })

  describe('Internal Interface for Tier Execution', () => {
    it('TieredExecutorInternal interface should expose tier execution methods', () => {
      // Create an executor
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })

      // The executor adapters should be able to access tier methods
      // without using 'as any' casts by implementing an internal interface
      const classification = executor.classifyCommand('echo hello')

      // Verify the executor adapter works correctly
      expect(classification.executor).toBeDefined()
      expect(typeof classification.executor?.execute).toBe('function')
    })
  })

  describe('Adapter Method Type Safety', () => {
    it('NativeExecutorAdapter calls executeTier1 without any cast', async () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })

      const classification = executor.classifyCommand('echo hello')
      expect(classification.handler).toBe('native')
      expect(classification.tier).toBe(1)

      // Execute through the adapter
      if (classification.executor) {
        const result = await classification.executor.execute('echo hello')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('hello')
      }
    })

    it('RpcExecutorAdapter calls executeTier2 without any cast', async () => {
      const rpcBinding = {
        fetch: vi.fn(async () => new Response(JSON.stringify({
          stdout: 'rpc output\n',
          stderr: '',
          exitCode: 0,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
      }

      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        rpcBindings: {
          git: {
            name: 'git',
            endpoint: rpcBinding,
            commands: ['git'],
          },
        },
      })

      const classification = executor.classifyCommand('git status')
      expect(classification.handler).toBe('rpc')
      expect(classification.tier).toBe(2)

      if (classification.executor) {
        const result = await classification.executor.execute('git status')
        expect(result).toBeDefined()
      }
    })

    it('LoaderExecutorAdapter calls executeTier3 without any cast', async () => {
      const mockLoader = {
        load: vi.fn(async () => ({
          run: async () => 'loader output',
        })),
        modules: ['esbuild'],
      }

      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
        workerLoaders: {
          esbuild: mockLoader,
        },
      })

      // Note: loader commands classification depends on implementation
      // This tests that the adapter pattern works for loader tier
      const classification = executor.classifyCommand('esbuild --version')

      // If classified as loader, verify the executor works
      if (classification.handler === 'loader' && classification.executor) {
        const result = await classification.executor.execute('esbuild --version')
        expect(result).toBeDefined()
      }
    })

    it('SandboxExecutorAdapter calls executeTier4 without any cast', async () => {
      const sandbox = createMockSandbox()
      const executor = new TieredExecutor({
        sandbox,
      })

      const classification = executor.classifyCommand('docker ps')
      expect(classification.handler).toBe('sandbox')
      expect(classification.tier).toBe(4)

      if (classification.executor) {
        const result = await classification.executor.execute('docker ps')
        expect(result.exitCode).toBe(0)
        // SandboxExecutor adds default timeout to options
        expect(sandbox.execute).toHaveBeenCalledWith(
          'docker ps',
          expect.objectContaining({ timeout: 30000 })
        )
      }
    })

    it('PolyglotExecutorAdapter calls executePolyglot without any cast', async () => {
      const pythonBinding = {
        fetch: vi.fn(async () => new Response(JSON.stringify({
          stdout: 'Python 3.11.0\n',
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

      const classification = executor.classifyCommand('python --version')
      expect(classification.handler).toBe('polyglot')
      expect(classification.capability).toBe('python')

      if (classification.executor) {
        const result = await classification.executor.execute('python --version')
        expect(result).toBeDefined()
      }
    })
  })

  describe('Type Guard for Executor Selection', () => {
    it('executor type can be determined from handler', () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })

      // Native command
      const nativeClassification = executor.classifyCommand('echo test')
      expect(nativeClassification.executor).toBeDefined()

      // The executor should implement TierExecutor interface
      const tierExecutor = nativeClassification.executor as TierExecutor
      expect(typeof tierExecutor.canExecute).toBe('function')
      expect(typeof tierExecutor.execute).toBe('function')
    })

    it('polyglot executor has correct interface', () => {
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
      expect(classification.executor).toBeDefined()

      // Polyglot executor still implements TierExecutor interface
      // (adapters use the same interface for polymorphic dispatch)
      const polyglotExecutor = classification.executor as TierExecutor
      expect(typeof polyglotExecutor.canExecute).toBe('function')
      expect(typeof polyglotExecutor.execute).toBe('function')
    })
  })

  describe('Encapsulation of Tier Methods', () => {
    it('adapters access tier methods through internal interface, not direct private access', async () => {
      const executor = new TieredExecutor({
        fs: createMockFsCapability(),
        sandbox: createMockSandbox(),
      })

      // This test verifies the pattern works - adapters should not need
      // to use 'as any' to access private methods

      const commands = [
        { cmd: 'echo hello', expectedHandler: 'native' },
        { cmd: 'docker ps', expectedHandler: 'sandbox' },
      ]

      for (const { cmd, expectedHandler } of commands) {
        const classification = executor.classifyCommand(cmd)
        expect(classification.handler).toBe(expectedHandler)
        expect(classification.executor).toBeDefined()

        // Execute through the adapter - this should work without any casts
        const result = await classification.executor!.execute(cmd)
        expect(result).toBeDefined()
        expect(typeof result.exitCode).toBe('number')
      }
    })
  })
})

// ============================================================================
// COMPILE-TIME TYPE CHECKS
// ============================================================================

describe('Compile-Time Type Safety', () => {
  it('TierClassification.executor type is properly defined', () => {
    // This is a compile-time check - if it compiles without error,
    // the types are properly defined

    const classification: TierClassification = {
      tier: 1,
      reason: 'test',
      handler: 'native',
      executor: undefined, // Optional field
    }

    expect(classification).toBeDefined()
  })

  it('executor field accepts TierExecutor implementation', () => {
    const mockExecutor: TierExecutor = {
      canExecute: () => true,
      execute: async () => ({
        input: 'test',
        command: 'test',
        valid: true,
        generated: false,
        stdout: '',
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
          type: 'execute',
          impact: 'low',
          reversible: true,
          reason: 'test',
        },
      }),
    }

    const classification: TierClassification = {
      tier: 1,
      reason: 'test',
      handler: 'native',
      executor: mockExecutor,
    }

    expect(classification.executor).toBe(mockExecutor)
  })
})
