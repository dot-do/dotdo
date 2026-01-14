/**
 * LoaderExecutor Module Tests (RED)
 *
 * Tests for the LoaderExecutor module that will be extracted from TieredExecutor.
 * LoaderExecutor handles Tier 3 operations: dynamic npm module loading via worker_loaders.
 *
 * This includes:
 * - Dynamic module loading (esbuild, typescript, prettier, eslint)
 * - Data processing libraries (zod, ajv, yaml, toml)
 * - Crypto libraries (crypto-js, jose)
 * - Utility libraries (lodash, date-fns, uuid)
 *
 * Tests are written to FAIL until the module is implemented.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

// Import types and classes that don't exist yet - this will cause compilation errors
import type {
  LoaderExecutorConfig,
  WorkerLoaderBinding,
  ModuleLoader,
  LoadableModule,
  ModuleExecutionResult,
} from '../../../src/do/executors/loader-executor.js'

import {
  LoaderExecutor,
  createLoaderExecutor,
  LOADABLE_MODULES,
  MODULE_CATEGORIES,
} from '../../../src/do/executors/loader-executor.js'

import type { BashResult, ExecOptions } from '../../../src/types.js'

// ============================================================================
// Mock Module Loader for Testing
// ============================================================================

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
    toml: {
      parse: vi.fn((input: string) => ({ parsed: input })),
      stringify: vi.fn((obj: unknown) => 'stringified'),
    },
    lodash: {
      get: vi.fn((obj: unknown, path: string) => 'value'),
      set: vi.fn(),
      map: vi.fn(),
    },
    uuid: {
      v4: vi.fn(() => 'mock-uuid-v4'),
      v5: vi.fn(() => 'mock-uuid-v5'),
    },
    zod: {
      object: vi.fn(),
      string: vi.fn(),
    },
    ajv: vi.fn().mockImplementation(() => ({
      compile: vi.fn(() => () => true),
    })),
    jose: {
      SignJWT: vi.fn(),
      jwtVerify: vi.fn(),
    },
    'crypto-js': {
      SHA256: vi.fn(() => 'hash'),
      AES: {
        encrypt: vi.fn(() => 'encrypted'),
        decrypt: vi.fn(() => 'decrypted'),
      },
    },
    'date-fns': {
      format: vi.fn(() => '2024-01-01'),
      parse: vi.fn(() => new Date()),
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

function createMockWorkerLoaderBinding(): WorkerLoaderBinding {
  return {
    name: 'npm-loader',
    load: vi.fn(async (module: string) => {
      return { default: vi.fn(), loaded: true }
    }),
    modules: ['esbuild', 'prettier', 'typescript'],
  }
}

// ============================================================================
// LoaderExecutor Class Tests
// ============================================================================

describe('LoaderExecutor', () => {
  describe('Construction', () => {
    it('should create an instance with no config', () => {
      const executor = new LoaderExecutor()

      expect(executor).toBeDefined()
      expect(executor).toBeInstanceOf(LoaderExecutor)
    })

    it('should create an instance with module loader', () => {
      const loader = createMockModuleLoader()
      const executor = new LoaderExecutor({ loader })

      expect(executor).toBeDefined()
      expect(executor.hasLoader).toBe(true)
    })

    it('should create an instance with worker loader binding', () => {
      const binding = createMockWorkerLoaderBinding()
      const executor = new LoaderExecutor({
        workerLoaders: { npm: binding },
      })

      expect(executor).toBeDefined()
      expect(executor.hasWorkerLoader('npm')).toBe(true)
    })

    it('should create an instance via factory function', () => {
      const executor = createLoaderExecutor()

      expect(executor).toBeDefined()
      expect(executor).toBeInstanceOf(LoaderExecutor)
    })

    it('should create an instance with config via factory function', () => {
      const loader = createMockModuleLoader()
      const executor = createLoaderExecutor({ loader })

      expect(executor).toBeDefined()
      expect(executor.hasLoader).toBe(true)
    })
  })

  describe('Module Classification', () => {
    let executor: LoaderExecutor

    beforeEach(() => {
      const loader = createMockModuleLoader()
      executor = new LoaderExecutor({ loader })
    })

    it('should identify loadable modules', () => {
      expect(executor.canLoad('esbuild')).toBe(true)
      expect(executor.canLoad('prettier')).toBe(true)
      expect(executor.canLoad('typescript')).toBe(true)
    })

    it('should reject non-loadable modules', () => {
      expect(executor.canLoad('docker')).toBe(false)
      expect(executor.canLoad('kubectl')).toBe(false)
      expect(executor.canLoad('bash')).toBe(false)
    })

    it('should identify module categories', () => {
      expect(executor.getModuleCategory('esbuild')).toBe('javascript')
      expect(executor.getModuleCategory('prettier')).toBe('javascript')
      expect(executor.getModuleCategory('yaml')).toBe('data')
      expect(executor.getModuleCategory('zod')).toBe('data')
      expect(executor.getModuleCategory('jose')).toBe('crypto')
      expect(executor.getModuleCategory('lodash')).toBe('utility')
    })

    it('should return null for unknown modules', () => {
      expect(executor.getModuleCategory('unknown')).toBeNull()
    })

    it('should check if executor can handle command', () => {
      // Commands that map to loadable modules
      expect(executor.canExecute('esbuild src/index.ts')).toBe(true)
      expect(executor.canExecute('prettier --write .')).toBe(true)

      // Commands that don't map to loadable modules
      expect(executor.canExecute('docker ps')).toBe(false)
      expect(executor.canExecute('echo hello')).toBe(false)
    })
  })

  describe('Module Loading', () => {
    let executor: LoaderExecutor
    let mockLoader: ModuleLoader

    beforeEach(() => {
      mockLoader = createMockModuleLoader()
      executor = new LoaderExecutor({ loader: mockLoader })
    })

    it('should load a module', async () => {
      const module = await executor.loadModule('esbuild')

      expect(mockLoader.load).toHaveBeenCalledWith('esbuild')
      expect(module).toBeDefined()
    })

    it('should cache loaded modules', async () => {
      await executor.loadModule('esbuild')
      await executor.loadModule('esbuild')

      // Should only load once due to caching
      expect((mockLoader.load as Mock).mock.calls.filter(c => c[0] === 'esbuild').length).toBe(1)
    })

    it('should throw for unavailable modules', async () => {
      await expect(executor.loadModule('nonexistent')).rejects.toThrow(
        'Module not available'
      )
    })

    it('should handle module load errors gracefully', async () => {
      ;(mockLoader.load as Mock).mockRejectedValueOnce(new Error('Load failed'))

      await expect(executor.loadModule('esbuild')).rejects.toThrow('Module loading failed')
    })

    it('should unload a module', async () => {
      await executor.loadModule('esbuild')
      await executor.unloadModule('esbuild')

      expect(mockLoader.unload).toHaveBeenCalledWith('esbuild')
    })

    it('should list loaded modules', async () => {
      await executor.loadModule('esbuild')
      await executor.loadModule('prettier')

      const loaded = executor.getLoadedModules()

      expect(loaded).toContain('esbuild')
      expect(loaded).toContain('prettier')
    })
  })

  describe('JavaScript Tool Execution', () => {
    let executor: LoaderExecutor

    beforeEach(() => {
      const loader = createMockModuleLoader()
      executor = new LoaderExecutor({ loader })
    })

    it('should execute esbuild transform', async () => {
      const result = await executor.execute('esbuild --transform --loader=ts', {
        stdin: 'const x: number = 1',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('transformed')
    })

    it('should execute esbuild build', async () => {
      const result = await executor.execute('esbuild src/index.ts --bundle --outfile=dist/out.js')

      expect(result.exitCode).toBe(0)
    })

    it('should execute prettier format', async () => {
      const result = await executor.execute('prettier --write', {
        stdin: 'const x=1',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('formatted')
    })

    it('should execute prettier check', async () => {
      const result = await executor.execute('prettier --check src/')

      expect(result.exitCode).toBe(0)
    })

    it('should execute typescript transpile', async () => {
      const result = await executor.execute('tsc --transpileOnly', {
        stdin: 'const x: number = 1',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('transpiled')
    })

    it('should execute eslint verify', async () => {
      const result = await executor.execute('eslint src/', {
        stdin: 'const x = 1;',
      })

      expect(result.exitCode).toBe(0)
    })
  })

  describe('Data Processing Execution', () => {
    let executor: LoaderExecutor

    beforeEach(() => {
      const loader = createMockModuleLoader()
      executor = new LoaderExecutor({ loader })
    })

    it('should execute yaml parse', async () => {
      const result = await executor.execute('yaml parse', {
        stdin: 'key: value',
      })

      expect(result.exitCode).toBe(0)
    })

    it('should execute yaml stringify', async () => {
      const result = await executor.execute('yaml stringify', {
        stdin: '{"key": "value"}',
      })

      expect(result.exitCode).toBe(0)
    })

    it('should execute toml parse', async () => {
      const result = await executor.execute('toml parse', {
        stdin: 'key = "value"',
      })

      expect(result.exitCode).toBe(0)
    })

    it('should execute zod validation', async () => {
      const result = await executor.execute('zod validate', {
        stdin: '{"schema": {}, "data": {}}',
      })

      expect(result.exitCode).toBe(0)
    })

    it('should execute ajv validation', async () => {
      const result = await executor.execute('ajv validate', {
        stdin: '{"schema": {}, "data": {}}',
      })

      expect(result.exitCode).toBe(0)
    })
  })

  describe('Crypto Library Execution', () => {
    let executor: LoaderExecutor

    beforeEach(() => {
      const loader = createMockModuleLoader()
      executor = new LoaderExecutor({ loader })
    })

    it('should execute jose sign', async () => {
      const result = await executor.execute('jose sign', {
        stdin: '{"payload": {}}',
        env: { JWT_SECRET: 'secret' },
      })

      expect(result.exitCode).toBe(0)
    })

    it('should execute jose verify', async () => {
      const result = await executor.execute('jose verify', {
        stdin: 'eyJ...',
        env: { JWT_SECRET: 'secret' },
      })

      expect(result.exitCode).toBe(0)
    })

    it('should execute crypto-js hash', async () => {
      const result = await executor.execute('crypto-js sha256', {
        stdin: 'hello',
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('hash')
    })

    it('should execute crypto-js encrypt', async () => {
      const result = await executor.execute('crypto-js encrypt', {
        stdin: 'secret message',
        env: { ENCRYPTION_KEY: 'key' },
      })

      expect(result.exitCode).toBe(0)
    })
  })

  describe('Utility Library Execution', () => {
    let executor: LoaderExecutor

    beforeEach(() => {
      const loader = createMockModuleLoader()
      executor = new LoaderExecutor({ loader })
    })

    it('should execute lodash get', async () => {
      const result = await executor.execute('lodash get .path', {
        stdin: '{"path": {"to": "value"}}',
      })

      expect(result.exitCode).toBe(0)
    })

    it('should execute date-fns format', async () => {
      const result = await executor.execute('date-fns format "yyyy-MM-dd"', {
        stdin: '2024-01-01T00:00:00Z',
      })

      expect(result.exitCode).toBe(0)
    })

    it('should execute uuid generate', async () => {
      const result = await executor.execute('uuid v4')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('mock-uuid-v4')
    })

    it('should execute uuid v5', async () => {
      const result = await executor.execute('uuid v5 "namespace" "name"')

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('mock-uuid-v5')
    })
  })

  describe('Error Handling', () => {
    let executor: LoaderExecutor

    beforeEach(() => {
      executor = new LoaderExecutor()
    })

    it('should fail when no loader is available', async () => {
      const result = await executor.execute('esbuild src/index.ts')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No module loader available')
    })

    it('should fail for unknown commands', async () => {
      const loader = createMockModuleLoader()
      executor = new LoaderExecutor({ loader })

      await expect(executor.execute('unknown-module cmd')).rejects.toThrow(
        'No loader available for command'
      )
    })

    it('should handle module execution errors', async () => {
      const loader = createMockModuleLoader()
      ;(loader.load as Mock).mockResolvedValueOnce({
        transform: vi.fn().mockRejectedValue(new Error('Transform failed')),
      })

      executor = new LoaderExecutor({ loader })
      const result = await executor.execute('esbuild --transform', {
        stdin: 'bad code',
      })

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Execution failed')
    })
  })

  describe('Worker Loader Binding', () => {
    let executor: LoaderExecutor
    let mockBinding: WorkerLoaderBinding

    beforeEach(() => {
      mockBinding = createMockWorkerLoaderBinding()
      executor = new LoaderExecutor({
        workerLoaders: { npm: mockBinding },
      })
    })

    it('should use worker loader for module loading', async () => {
      await executor.loadModuleFromWorker('npm', 'esbuild')

      expect(mockBinding.load).toHaveBeenCalledWith('esbuild')
    })

    it('should list modules available from worker loader', () => {
      const modules = executor.getWorkerLoaderModules('npm')

      expect(modules).toContain('esbuild')
      expect(modules).toContain('prettier')
      expect(modules).toContain('typescript')
    })

    it('should check if worker loader has module', () => {
      expect(executor.workerLoaderHasModule('npm', 'esbuild')).toBe(true)
      expect(executor.workerLoaderHasModule('npm', 'unknown')).toBe(false)
    })

    it('should throw for unknown worker loader', async () => {
      await expect(
        executor.loadModuleFromWorker('unknown', 'module')
      ).rejects.toThrow('Worker loader not found')
    })
  })

  describe('Result Format', () => {
    let executor: LoaderExecutor

    beforeEach(() => {
      const loader = createMockModuleLoader()
      executor = new LoaderExecutor({ loader })
    })

    it('should return BashResult compatible structure', async () => {
      const result = await executor.execute('prettier --write', {
        stdin: 'const x=1',
      })

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

    it('should include tier information in classification', async () => {
      const result = await executor.execute('prettier --write', {
        stdin: 'const x=1',
      })

      expect(result.classification.reason).toContain('Tier 3')
    })

    it('should include module name in classification', async () => {
      const result = await executor.execute('esbuild --transform', {
        stdin: 'const x: number = 1',
      })

      expect(result.classification.capability).toBe('esbuild')
    })
  })

  describe('Timeout Handling', () => {
    let executor: LoaderExecutor

    beforeEach(() => {
      const loader = createMockModuleLoader()
      executor = new LoaderExecutor({ loader, defaultTimeout: 30000 })
    })

    it('should use default timeout', async () => {
      const result = await executor.execute('prettier --write', {
        stdin: 'const x=1',
      })

      expect(result.exitCode).toBe(0)
    })

    it('should respect custom timeout', async () => {
      const slowLoader = createMockModuleLoader()
      ;(slowLoader.load as Mock).mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 200))
      )

      executor = new LoaderExecutor({ loader: slowLoader, defaultTimeout: 50 })

      await expect(executor.execute('prettier --write', { stdin: 'x' })).rejects.toThrow(
        'Execution timed out'
      )
    })
  })
})

// ============================================================================
// LOADABLE_MODULES Tests
// ============================================================================

describe('LOADABLE_MODULES', () => {
  it('should export LOADABLE_MODULES set', () => {
    expect(LOADABLE_MODULES).toBeDefined()
    expect(LOADABLE_MODULES).toBeInstanceOf(Set)
  })

  it('should include JavaScript tools', () => {
    expect(LOADABLE_MODULES.has('esbuild')).toBe(true)
    expect(LOADABLE_MODULES.has('typescript')).toBe(true)
    expect(LOADABLE_MODULES.has('prettier')).toBe(true)
    expect(LOADABLE_MODULES.has('eslint')).toBe(true)
  })

  it('should include data processing libraries', () => {
    expect(LOADABLE_MODULES.has('yaml')).toBe(true)
    expect(LOADABLE_MODULES.has('toml')).toBe(true)
    expect(LOADABLE_MODULES.has('zod')).toBe(true)
    expect(LOADABLE_MODULES.has('ajv')).toBe(true)
  })

  it('should include crypto libraries', () => {
    expect(LOADABLE_MODULES.has('crypto-js')).toBe(true)
    expect(LOADABLE_MODULES.has('jose')).toBe(true)
  })

  it('should include utility libraries', () => {
    expect(LOADABLE_MODULES.has('lodash')).toBe(true)
    expect(LOADABLE_MODULES.has('date-fns')).toBe(true)
    expect(LOADABLE_MODULES.has('uuid')).toBe(true)
  })
})

// ============================================================================
// MODULE_CATEGORIES Tests
// ============================================================================

describe('MODULE_CATEGORIES', () => {
  it('should export MODULE_CATEGORIES', () => {
    expect(MODULE_CATEGORIES).toBeDefined()
    expect(typeof MODULE_CATEGORIES).toBe('object')
  })

  it('should have javascript category', () => {
    expect(MODULE_CATEGORIES.javascript).toBeDefined()
    expect(MODULE_CATEGORIES.javascript).toContain('esbuild')
    expect(MODULE_CATEGORIES.javascript).toContain('typescript')
    expect(MODULE_CATEGORIES.javascript).toContain('prettier')
    expect(MODULE_CATEGORIES.javascript).toContain('eslint')
  })

  it('should have data category', () => {
    expect(MODULE_CATEGORIES.data).toBeDefined()
    expect(MODULE_CATEGORIES.data).toContain('yaml')
    expect(MODULE_CATEGORIES.data).toContain('toml')
    expect(MODULE_CATEGORIES.data).toContain('zod')
    expect(MODULE_CATEGORIES.data).toContain('ajv')
  })

  it('should have crypto category', () => {
    expect(MODULE_CATEGORIES.crypto).toBeDefined()
    expect(MODULE_CATEGORIES.crypto).toContain('crypto-js')
    expect(MODULE_CATEGORIES.crypto).toContain('jose')
  })

  it('should have utility category', () => {
    expect(MODULE_CATEGORIES.utility).toBeDefined()
    expect(MODULE_CATEGORIES.utility).toContain('lodash')
    expect(MODULE_CATEGORIES.utility).toContain('date-fns')
    expect(MODULE_CATEGORIES.utility).toContain('uuid')
  })
})

// ============================================================================
// Type Tests
// ============================================================================

describe('LoaderExecutor Type Definitions', () => {
  it('should have correct LoaderExecutorConfig shape', () => {
    const config: LoaderExecutorConfig = {
      loader: createMockModuleLoader(),
      workerLoaders: {
        npm: createMockWorkerLoaderBinding(),
      },
      defaultTimeout: 30000,
    }

    expect(config).toBeDefined()
  })

  it('should have correct WorkerLoaderBinding shape', () => {
    const binding: WorkerLoaderBinding = {
      name: 'test',
      load: async (module: string) => ({ default: {} }),
      modules: ['module1', 'module2'],
    }

    expect(binding).toBeDefined()
  })

  it('should have correct ModuleLoader shape', () => {
    const loader: ModuleLoader = {
      load: async (name: string) => ({}),
      isLoaded: (name: string) => false,
      getAvailableModules: () => [],
      unload: async (name: string) => {},
    }

    expect(loader).toBeDefined()
  })

  it('should have correct LoadableModule type', () => {
    const modules: LoadableModule[] = [
      'esbuild',
      'typescript',
      'prettier',
      'eslint',
      'yaml',
      'toml',
      'zod',
      'ajv',
      'crypto-js',
      'jose',
      'lodash',
      'date-fns',
      'uuid',
    ]

    expect(modules.length).toBe(13)
  })

  it('should have correct ModuleExecutionResult shape', () => {
    const result: ModuleExecutionResult = {
      success: true,
      output: 'result',
      error: undefined,
      duration: 100,
    }

    expect(result).toBeDefined()
  })
})
