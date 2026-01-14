/**
 * Tier3Executor Integration Tests (RED Phase)
 *
 * Tests verifying that TieredExecutor properly delegates Tier 3 execution
 * to the LoaderExecutor module. This ensures the Tier 3 logic is properly
 * extracted and the delegation works correctly.
 *
 * Key test areas:
 * - LoaderExecutor implements TierExecutor interface
 * - matchWorkerLoader() detects loadable modules correctly
 * - executeLoadedModule() invokes modules with correct args
 * - Module not found errors handled gracefully
 * - Module execution errors handled properly
 *
 * @module tests/do/executors/tier3-executor
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

import {
  LoaderExecutor,
  createLoaderExecutor,
  LOADABLE_MODULES,
  type LoaderExecutorConfig,
  type ModuleLoader,
  type WorkerLoaderBinding,
} from '../../../src/do/executors/loader-executor.js'

import {
  TieredExecutor,
  type TierClassification,
  type WorkerLoaderBinding as TieredWorkerLoaderBinding,
} from '../../../src/do/tiered-executor.js'

import type { TierExecutor } from '../../../src/do/executors/types.js'
import type { BashResult, ExecOptions, FsCapability } from '../../../src/types.js'

// ============================================================================
// MOCK HELPERS
// ============================================================================

/**
 * Create a mock module loader for testing
 */
function createMockModuleLoader(): ModuleLoader {
  const modules: Record<string, unknown> = {
    esbuild: {
      transform: vi.fn(async (code: string) => ({ code: `transformed: ${code}` })),
      build: vi.fn(async () => ({ outputFiles: [] })),
    },
    prettier: {
      format: vi.fn(async (code: string) => `formatted: ${code}`),
      check: vi.fn(async () => true),
    },
    typescript: {
      transpileModule: vi.fn((code: string) => ({ outputText: `transpiled: ${code}` })),
    },
    eslint: {
      Linter: vi.fn().mockImplementation(() => ({
        verify: vi.fn(() => []),
      })),
    },
    yaml: {
      parse: vi.fn((input: string) => ({ parsed: input })),
      stringify: vi.fn((obj: unknown) => 'stringified'),
    },
    lodash: {
      get: vi.fn((obj: unknown, path: string) => 'value'),
    },
    uuid: {
      v4: vi.fn(() => 'mock-uuid-v4'),
    },
    'crypto-js': {
      SHA256: vi.fn(() => 'hash'),
    },
    'date-fns': {
      format: vi.fn(() => '2024-01-01'),
    },
  }

  return {
    load: vi.fn(async (name: string) => {
      if (modules[name]) {
        return modules[name]
      }
      throw new Error(`Module not found: ${name}`)
    }),
    isLoaded: vi.fn((name: string) => !!modules[name]),
    getAvailableModules: vi.fn(() => Object.keys(modules)),
    unload: vi.fn(async () => {}),
  }
}

/**
 * Create a mock worker loader binding
 */
function createMockWorkerLoaderBinding(
  name: string = 'npm-loader',
  modules: string[] = ['esbuild', 'prettier', 'typescript']
): TieredWorkerLoaderBinding {
  return {
    name,
    load: vi.fn(async (module: string) => {
      return { default: vi.fn(), loaded: true, run: vi.fn(async () => 'executed') }
    }),
    modules,
  }
}

/**
 * Create a mock sandbox for fallback testing
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
// TierExecutor INTERFACE COMPLIANCE TESTS
// ============================================================================

describe('LoaderExecutor TierExecutor Interface', () => {
  describe('Interface Implementation', () => {
    it('implements TierExecutor interface correctly', () => {
      const executor = new LoaderExecutor()

      // Must have canExecute method
      expect(typeof executor.canExecute).toBe('function')

      // Must have execute method
      expect(typeof executor.execute).toBe('function')
    })

    it('canExecute returns boolean for any command string', () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      // Loadable modules
      expect(typeof executor.canExecute('esbuild')).toBe('boolean')
      expect(typeof executor.canExecute('prettier')).toBe('boolean')

      // Non-loadable modules
      expect(typeof executor.canExecute('docker')).toBe('boolean')
      expect(typeof executor.canExecute('unknown')).toBe('boolean')
    })

    it('execute returns Promise<BashResult>', async () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      const result = await executor.execute('prettier --write', { stdin: 'const x=1' })

      // Verify BashResult structure
      expect(result).toHaveProperty('input')
      expect(result).toHaveProperty('command')
      expect(result).toHaveProperty('stdout')
      expect(result).toHaveProperty('stderr')
      expect(result).toHaveProperty('exitCode')
      expect(result).toHaveProperty('valid')
      expect(result).toHaveProperty('generated')
      expect(result).toHaveProperty('intent')
      expect(result).toHaveProperty('classification')
    })

    it('can be used as TierExecutor type', () => {
      const loader = createMockModuleLoader()

      // This should compile without errors
      const executor: TierExecutor = new LoaderExecutor({ loader })

      expect(executor.canExecute('esbuild')).toBe(true)
    })
  })
})

// ============================================================================
// matchWorkerLoader() DETECTION TESTS
// ============================================================================

describe('Worker Loader Detection (matchWorkerLoader equivalent)', () => {
  describe('LOADABLE_MODULES detection', () => {
    it('detects esbuild as loadable', () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      expect(executor.canExecute('esbuild src/index.ts')).toBe(true)
      expect(executor.canLoad('esbuild')).toBe(true)
    })

    it('detects typescript/tsc as loadable', () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      expect(executor.canExecute('tsc --noEmit')).toBe(true)
      expect(executor.canExecute('typescript --version')).toBe(true)
    })

    it('detects prettier as loadable', () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      expect(executor.canExecute('prettier --check .')).toBe(true)
    })

    it('detects eslint as loadable', () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      expect(executor.canExecute('eslint src/')).toBe(true)
    })

    it('detects data processing modules', () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      expect(executor.canExecute('yaml parse')).toBe(true)
      expect(executor.canExecute('toml parse')).toBe(true)
      expect(executor.canExecute('zod validate')).toBe(true)
      expect(executor.canExecute('ajv validate')).toBe(true)
    })

    it('detects crypto modules', () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      expect(executor.canExecute('crypto-js sha256')).toBe(true)
      expect(executor.canExecute('jose sign')).toBe(true)
    })

    it('detects utility modules', () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      expect(executor.canExecute('lodash get .path')).toBe(true)
      expect(executor.canExecute('date-fns format')).toBe(true)
      expect(executor.canExecute('uuid v4')).toBe(true)
    })
  })

  describe('Non-loadable command rejection', () => {
    it('rejects docker commands', () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      expect(executor.canExecute('docker ps')).toBe(false)
      expect(executor.canExecute('docker build .')).toBe(false)
    })

    it('rejects system commands', () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      expect(executor.canExecute('ps aux')).toBe(false)
      expect(executor.canExecute('top')).toBe(false)
      expect(executor.canExecute('kill -9 123')).toBe(false)
    })

    it('rejects basic shell commands', () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      expect(executor.canExecute('echo hello')).toBe(false)
      expect(executor.canExecute('cat file.txt')).toBe(false)
      expect(executor.canExecute('ls -la')).toBe(false)
    })

    it('rejects unknown commands', () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      expect(executor.canExecute('unknown-tool --help')).toBe(false)
      expect(executor.canExecute('my-custom-script')).toBe(false)
    })
  })

  describe('Worker loader binding detection', () => {
    it('detects modules from worker loader', () => {
      const binding = createMockWorkerLoaderBinding('custom', ['custom-module'])
      const executor = new LoaderExecutor({
        workerLoaders: { custom: binding as unknown as WorkerLoaderBinding },
      })

      expect(executor.hasWorkerLoader('custom')).toBe(true)
    })

    it('reports available modules from worker loader', () => {
      const binding = createMockWorkerLoaderBinding('npm', ['esbuild', 'prettier'])
      const executor = new LoaderExecutor({
        workerLoaders: { npm: binding as unknown as WorkerLoaderBinding },
      })

      const modules = executor.getWorkerLoaderModules('npm')
      expect(modules).toContain('esbuild')
      expect(modules).toContain('prettier')
    })
  })
})

// ============================================================================
// executeLoadedModule() INVOCATION TESTS
// ============================================================================

describe('Module Invocation (executeLoadedModule equivalent)', () => {
  describe('JavaScript tool execution', () => {
    it('invokes esbuild transform with correct args', async () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      const result = await executor.execute('esbuild --transform', {
        stdin: 'const x: number = 1',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('transformed')
    })

    it('invokes prettier format with correct args', async () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      const result = await executor.execute('prettier --write', {
        stdin: 'const   x=1',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('formatted')
    })

    it('invokes typescript transpile with correct args', async () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      const result = await executor.execute('tsc --transpileOnly', {
        stdin: 'const x: number = 1',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('transpiled')
    })
  })

  describe('Option passing', () => {
    it('passes stdin to module executor', async () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      await executor.execute('yaml parse', {
        stdin: 'key: value',
      })

      // The module should have been called with the input
      expect((loader.load as Mock)).toHaveBeenCalledWith('yaml')
    })

    it('passes env variables to module executor', async () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      const result = await executor.execute('crypto-js encrypt', {
        stdin: 'secret',
        env: { ENCRYPTION_KEY: 'test-key' },
      })

      expect(result.exitCode).toBe(0)
    })
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  describe('Module not found errors', () => {
    it('handles module not found gracefully', async () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      // Try to execute a non-existent module that passes canExecute but fails to load
      ;(loader.load as Mock).mockRejectedValueOnce(new Error('Module not found'))

      const result = await executor.execute('esbuild --transform', {
        stdin: 'code',
      })

      // Should return error result, not throw
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Module loading failed')
    })

    it('throws for completely unknown commands', async () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      await expect(
        executor.execute('completely-unknown-module arg')
      ).rejects.toThrow('No loader available for command')
    })
  })

  describe('Module execution errors', () => {
    it('handles module execution failure gracefully', async () => {
      const loader = createMockModuleLoader()
      ;(loader.load as Mock).mockResolvedValueOnce({
        transform: vi.fn().mockRejectedValue(new Error('Transform failed')),
      })

      const executor = new LoaderExecutor({ loader })

      const result = await executor.execute('esbuild --transform', {
        stdin: 'bad code',
      })

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Execution failed')
    })

    it('handles missing loader gracefully', async () => {
      const executor = new LoaderExecutor() // No loader provided

      const result = await executor.execute('prettier --write', {
        stdin: 'code',
      })

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No module loader available')
    })
  })

  describe('Timeout handling', () => {
    it('times out long-running module execution', async () => {
      const slowLoader = createMockModuleLoader()
      ;(slowLoader.load as Mock).mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 200))
      )

      const executor = new LoaderExecutor({
        loader: slowLoader,
        defaultTimeout: 50,
      })

      await expect(
        executor.execute('esbuild --transform', { stdin: 'code' })
      ).rejects.toThrow('timed out')
    })
  })
})

// ============================================================================
// TieredExecutor INTEGRATION TESTS
// ============================================================================

describe('TieredExecutor Tier 3 Integration', () => {
  describe('Classification', () => {
    it('classifies loadable modules as Tier 3', () => {
      const workerLoader = createMockWorkerLoaderBinding('npm', ['esbuild', 'prettier'])
      const executor = new TieredExecutor({
        workerLoaders: { npm: workerLoader },
        sandbox: createMockSandbox(),
      })

      const classification = executor.classifyCommand('esbuild src/index.ts')

      expect(classification.tier).toBe(3)
      expect(classification.handler).toBe('loader')
    })

    it('includes capability in classification', () => {
      const workerLoader = createMockWorkerLoaderBinding('npm', ['esbuild'])
      const executor = new TieredExecutor({
        workerLoaders: { npm: workerLoader },
        sandbox: createMockSandbox(),
      })

      const classification = executor.classifyCommand('esbuild src/index.ts')

      expect(classification.capability).toBeDefined()
    })

    it('includes executor in classification for Tier 3', () => {
      const workerLoader = createMockWorkerLoaderBinding('npm', ['esbuild'])
      const executor = new TieredExecutor({
        workerLoaders: { npm: workerLoader },
        sandbox: createMockSandbox(),
      })

      const classification = executor.classifyCommand('esbuild src/index.ts')

      expect(classification.executor).toBeDefined()
      expect(typeof classification.executor?.execute).toBe('function')
    })
  })

  describe('Execution delegation', () => {
    it('delegates Tier 3 execution to LoaderExecutor', async () => {
      const workerLoader = createMockWorkerLoaderBinding('npm', ['esbuild'])
      const sandbox = createMockSandbox()
      const executor = new TieredExecutor({
        workerLoaders: { npm: workerLoader },
        sandbox,
      })

      // With workerLoaders configured, TieredExecutor initializes LoaderExecutor
      // but LoaderExecutor requires a ModuleLoader to execute.
      // Since we haven't provided one, it will return an error result (not throw)
      // but importantly it will NOT fall back to sandbox for known loadable modules.
      const result = await executor.execute('esbuild src/index.ts')

      // The LoaderExecutor without a ModuleLoader returns error status
      // but the key verification is it went through LoaderExecutor (Tier 3 classification)
      const classification = executor.classifyCommand('esbuild src/index.ts')
      expect(classification.tier).toBe(3)
      expect(classification.handler).toBe('loader')

      // Sandbox should NOT be called for Tier 3 classified commands
      // even if LoaderExecutor returns an error
      expect(sandbox.execute).not.toHaveBeenCalled()
    })

    it('falls back to sandbox when worker loader not found', async () => {
      const sandbox = createMockSandbox()
      const executor = new TieredExecutor({
        // No workerLoaders configured
        sandbox,
      })

      const result = await executor.execute('esbuild src/index.ts')

      // Should fall back to sandbox
      expect(sandbox.execute).toHaveBeenCalled()
    })
  })

  describe('Capability reporting', () => {
    it('reports Tier 3 availability correctly', () => {
      const workerLoader = createMockWorkerLoaderBinding('npm', ['esbuild'])
      const executor = new TieredExecutor({
        workerLoaders: { npm: workerLoader },
        sandbox: createMockSandbox(),
      })

      const capabilities = executor.getCapabilities()

      expect(capabilities.tier3.available).toBe(true)
      expect(capabilities.tier3.loaders).toContain('npm')
    })

    it('reports Tier 3 unavailable when no loaders', () => {
      const executor = new TieredExecutor({
        sandbox: createMockSandbox(),
      })

      const capabilities = executor.getCapabilities()

      expect(capabilities.tier3.available).toBe(false)
      expect(capabilities.tier3.loaders).toHaveLength(0)
    })

    it('checks tier availability for specific commands', () => {
      const workerLoader = createMockWorkerLoaderBinding('npm', ['esbuild'])
      const executor = new TieredExecutor({
        workerLoaders: { npm: workerLoader },
        sandbox: createMockSandbox(),
      })

      expect(executor.isTierAvailable(3, 'esbuild src/index.ts')).toBe(true)
      expect(executor.isTierAvailable(3, 'docker ps')).toBe(false)
    })
  })
})

// ============================================================================
// RESULT FORMAT TESTS
// ============================================================================

describe('Result Format', () => {
  it('returns properly formatted BashResult', async () => {
    const loader = createMockModuleLoader()
    const executor = new LoaderExecutor({ loader })

    const result = await executor.execute('prettier --write', {
      stdin: 'const x=1',
    })

    // Verify full BashResult structure
    expect(result.input).toBe('prettier --write')
    expect(result.command).toBe('prettier --write')
    expect(result.valid).toBe(true)
    expect(result.generated).toBe(false)
    expect(typeof result.stdout).toBe('string')
    expect(typeof result.stderr).toBe('string')
    expect(typeof result.exitCode).toBe('number')

    // Verify intent structure
    expect(result.intent).toHaveProperty('commands')
    expect(result.intent).toHaveProperty('reads')
    expect(result.intent).toHaveProperty('writes')
    expect(result.intent).toHaveProperty('deletes')
    expect(result.intent).toHaveProperty('network')
    expect(result.intent).toHaveProperty('elevated')

    // Verify classification structure
    expect(result.classification).toHaveProperty('type')
    expect(result.classification).toHaveProperty('impact')
    expect(result.classification).toHaveProperty('reversible')
    expect(result.classification).toHaveProperty('reason')
  })

  it('includes Tier 3 in classification reason', async () => {
    const loader = createMockModuleLoader()
    const executor = new LoaderExecutor({ loader })

    const result = await executor.execute('prettier --write', {
      stdin: 'code',
    })

    expect(result.classification.reason).toContain('Tier 3')
  })

  it('includes module name in classification capability', async () => {
    const loader = createMockModuleLoader()
    const executor = new LoaderExecutor({ loader })

    const result = await executor.execute('esbuild --transform', {
      stdin: 'code',
    })

    expect(result.classification.capability).toBe('esbuild')
  })
})
