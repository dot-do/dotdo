/**
 * BashModule Tests
 *
 * Tests for the BashModule capability class.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BashModule, withBash, type BashExecutor, type WithBashCapability, type Constructor } from '../../src/do/index.js'
import type { BashResult } from '../../src/types.js'

// Mock the parse and analyze imports since they throw NotImplemented
vi.mock('../../src/ast/parser.js', () => ({
  parse: vi.fn().mockReturnValue({
    type: 'Program',
    body: [],
    errors: [],
  }),
}))

vi.mock('../../src/ast/analyze.js', () => ({
  analyze: vi.fn().mockReturnValue({
    classification: { type: 'read', impact: 'none', reversible: true, reason: 'Safe command' },
    intent: { commands: ['ls'], reads: [], writes: [], deletes: [], network: false, elevated: false },
  }),
  isDangerous: vi.fn().mockReturnValue({ dangerous: false }),
}))

// Helper to create a mock executor
function createMockExecutor(results: Record<string, Partial<BashResult>> = {}): BashExecutor {
  return {
    execute: vi.fn(async (command: string): Promise<BashResult> => {
      const baseResult: BashResult = {
        input: command,
        command,
        valid: true,
        generated: false,
        stdout: '',
        stderr: '',
        exitCode: 0,
        intent: { commands: [], reads: [], writes: [], deletes: [], network: false, elevated: false },
        classification: { type: 'read', impact: 'none', reversible: true, reason: 'Mock' },
      }

      if (results[command]) {
        return { ...baseResult, ...results[command] }
      }

      return { ...baseResult, stdout: `executed: ${command}` }
    }),
  }
}

describe('BashModule', () => {
  describe('constructor', () => {
    it('should create a BashModule with an executor', () => {
      const executor = createMockExecutor()
      const bash = new BashModule(executor)

      expect(bash).toBeInstanceOf(BashModule)
      expect(bash.name).toBe('bash')
    })
  })

  describe('initialize / dispose', () => {
    it('should initialize without error', async () => {
      const executor = createMockExecutor()
      const bash = new BashModule(executor)

      await expect(bash.initialize()).resolves.toBeUndefined()
    })

    it('should be idempotent on multiple initializations', async () => {
      const executor = createMockExecutor()
      const bash = new BashModule(executor)

      await bash.initialize()
      await bash.initialize()

      // No error means success
    })

    it('should dispose without error', async () => {
      const executor = createMockExecutor()
      const bash = new BashModule(executor)

      await bash.initialize()
      await expect(bash.dispose()).resolves.toBeUndefined()
    })
  })

  describe('exec', () => {
    it('should execute a simple command', async () => {
      const executor = createMockExecutor({
        'ls': { stdout: 'file1.txt\nfile2.txt', exitCode: 0 },
      })
      const bash = new BashModule(executor)

      const result = await bash.exec('ls')

      expect(result.stdout).toBe('file1.txt\nfile2.txt')
      expect(result.exitCode).toBe(0)
      expect(executor.execute).toHaveBeenCalledWith('ls', undefined)
    })

    it('should execute a command with arguments', async () => {
      const executor = createMockExecutor({
        'git status --short': { stdout: 'M file.ts', exitCode: 0 },
      })
      const bash = new BashModule(executor)

      const result = await bash.exec('git', ['status', '--short'])

      expect(result.stdout).toBe('M file.ts')
      expect(executor.execute).toHaveBeenCalledWith('git status --short', undefined)
    })

    it('should execute a command with options', async () => {
      const executor = createMockExecutor({
        'npm install': { stdout: 'added 100 packages', exitCode: 0 },
      })
      const bash = new BashModule(executor)

      const options = { cwd: '/app', timeout: 60000 }
      await bash.exec('npm', ['install'], options)

      expect(executor.execute).toHaveBeenCalledWith('npm install', options)
    })

    it('should return error result for failed commands', async () => {
      const executor = createMockExecutor({
        'nonexistent-command': { stderr: 'command not found', exitCode: 127 },
      })
      const bash = new BashModule(executor)

      const result = await bash.exec('nonexistent-command')

      expect(result.exitCode).toBe(127)
      expect(result.stderr).toBe('command not found')
    })
  })

  describe('safety gate', () => {
    it('should block critical commands without confirmation', async () => {
      // Override mock to return critical classification
      const { analyze, isDangerous } = await import('../../src/ast/analyze.js')
      vi.mocked(analyze).mockReturnValueOnce({
        classification: { type: 'delete', impact: 'critical', reversible: false, reason: 'Deletes entire filesystem' },
        intent: { commands: ['rm'], reads: [], writes: [], deletes: ['/'], network: false, elevated: true },
      })
      vi.mocked(isDangerous).mockReturnValueOnce({ dangerous: true, reason: 'Recursive delete of root filesystem' })

      const executor = createMockExecutor()
      const bash = new BashModule(executor)

      const result = await bash.exec('rm', ['-rf', '/'])

      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
      expect(result.blockReason).toContain('Recursive delete')
      expect(executor.execute).not.toHaveBeenCalled()
    })

    it('should block high impact commands without confirmation', async () => {
      const { analyze, isDangerous } = await import('../../src/ast/analyze.js')
      vi.mocked(analyze).mockReturnValueOnce({
        classification: { type: 'delete', impact: 'high', reversible: false, reason: 'Recursive delete' },
        intent: { commands: ['rm'], reads: [], writes: [], deletes: ['directory/'], network: false, elevated: false },
      })
      vi.mocked(isDangerous).mockReturnValueOnce({ dangerous: true, reason: 'Recursive directory delete' })

      const executor = createMockExecutor()
      const bash = new BashModule(executor)

      const result = await bash.exec('rm', ['-r', 'directory/'])

      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
      expect(executor.execute).not.toHaveBeenCalled()
    })

    it('should allow critical commands with confirm: true', async () => {
      const { analyze, isDangerous } = await import('../../src/ast/analyze.js')
      vi.mocked(analyze).mockReturnValueOnce({
        classification: { type: 'delete', impact: 'critical', reversible: false, reason: 'Deletes directory' },
        intent: { commands: ['rm'], reads: [], writes: [], deletes: ['temp/'], network: false, elevated: false },
      })
      vi.mocked(isDangerous).mockReturnValueOnce({ dangerous: true, reason: 'Recursive delete' })

      const executor = createMockExecutor({
        'rm -rf temp/': { stdout: '', exitCode: 0 },
      })
      const bash = new BashModule(executor)

      const result = await bash.exec('rm', ['-rf', 'temp/'], { confirm: true })

      expect(result.blocked).toBeUndefined()
      expect(result.exitCode).toBe(0)
      expect(executor.execute).toHaveBeenCalledWith('rm -rf temp/', { confirm: true })
    })

    it('should allow safe commands without confirmation', async () => {
      // Default mock returns safe classification
      const executor = createMockExecutor({
        'ls -la': { stdout: 'file1.txt', exitCode: 0 },
      })
      const bash = new BashModule(executor)

      const result = await bash.exec('ls', ['-la'])

      expect(result.blocked).toBeUndefined()
      expect(result.stdout).toBe('file1.txt')
      expect(executor.execute).toHaveBeenCalled()
    })

    it('should allow medium impact commands without confirmation', async () => {
      const { analyze, isDangerous } = await import('../../src/ast/analyze.js')
      vi.mocked(analyze).mockReturnValueOnce({
        classification: { type: 'write', impact: 'medium', reversible: true, reason: 'Moves file' },
        intent: { commands: ['mv'], reads: ['old.txt'], writes: ['new.txt'], deletes: [], network: false, elevated: false },
      })
      vi.mocked(isDangerous).mockReturnValueOnce({ dangerous: false })

      const executor = createMockExecutor({
        'mv old.txt new.txt': { stdout: '', exitCode: 0 },
      })
      const bash = new BashModule(executor)

      const result = await bash.exec('mv', ['old.txt', 'new.txt'])

      expect(result.blocked).toBeUndefined()
      expect(executor.execute).toHaveBeenCalled()
    })
  })

  describe('run', () => {
    it('should run a script', async () => {
      const script = 'echo "hello"\necho "world"'
      const executor = createMockExecutor({
        [script]: { stdout: 'hello\nworld', exitCode: 0 },
      })
      const bash = new BashModule(executor)

      const result = await bash.run(script)

      expect(result.stdout).toBe('hello\nworld')
      expect(executor.execute).toHaveBeenCalledWith(script, undefined)
    })

    it('should run a script with options', async () => {
      const script = 'npm run build'
      const executor = createMockExecutor({
        [script]: { stdout: 'Build complete', exitCode: 0 },
      })
      const bash = new BashModule(executor)

      const options = { cwd: '/app' }
      await bash.run(script, options)

      expect(executor.execute).toHaveBeenCalledWith(script, options)
    })
  })

  describe('spawn', () => {
    it('should throw if executor does not support spawn', async () => {
      const executor = createMockExecutor()
      const bash = new BashModule(executor)

      await expect(bash.spawn('tail', ['-f', '/var/log/app.log'])).rejects.toThrow(
        'Spawn not supported by this executor',
      )
    })

    it('should call executor spawn if available', async () => {
      const mockHandle = {
        pid: 1234,
        done: Promise.resolve({} as BashResult),
        kill: vi.fn(),
        write: vi.fn(),
        closeStdin: vi.fn(),
      }

      const executor: BashExecutor = {
        execute: vi.fn(),
        spawn: vi.fn().mockResolvedValue(mockHandle),
      }

      const bash = new BashModule(executor)
      const handle = await bash.spawn('tail', ['-f', 'log.txt'], { timeout: 5000 })

      expect(handle).toBe(mockHandle)
      expect(executor.spawn).toHaveBeenCalledWith('tail', ['-f', 'log.txt'], { timeout: 5000 })
    })
  })

  describe('parse', () => {
    it('should parse a command into AST', () => {
      const executor = createMockExecutor()
      const bash = new BashModule(executor)

      const ast = bash.parse('ls -la')

      expect(ast.type).toBe('Program')
    })
  })

  describe('analyze', () => {
    it('should analyze a command for safety', () => {
      const executor = createMockExecutor()
      const bash = new BashModule(executor)

      const analysis = bash.analyze('ls -la')

      expect(analysis.classification.type).toBe('read')
      expect(analysis.classification.impact).toBe('none')
    })
  })

  describe('isDangerous', () => {
    it('should check if a command is dangerous', () => {
      const executor = createMockExecutor()
      const bash = new BashModule(executor)

      const check = bash.isDangerous('ls')

      expect(check.dangerous).toBe(false)
    })
  })
})

describe('withBash mixin', () => {
  it('should add bash property to a class', () => {
    class BaseClass {
      value = 'base'
    }

    const executor = createMockExecutor()
    const MixedClass = withBash(BaseClass, () => executor)

    const instance = new MixedClass()

    expect(instance.value).toBe('base')
    expect(instance.bash).toBeInstanceOf(BashModule)
    expect(instance.bash.name).toBe('bash')
  })

  it('should lazily create BashModule', () => {
    const factoryFn = vi.fn().mockReturnValue(createMockExecutor())

    class BaseClass {}

    const MixedClass = withBash(BaseClass, factoryFn)
    const instance = new MixedClass()

    // Factory not called yet
    expect(factoryFn).not.toHaveBeenCalled()

    // Access bash property
    const _ = instance.bash

    // Now factory should be called
    expect(factoryFn).toHaveBeenCalledTimes(1)
  })

  it('should cache BashModule instance', () => {
    const factoryFn = vi.fn().mockReturnValue(createMockExecutor())

    class BaseClass {}

    const MixedClass = withBash(BaseClass, factoryFn)
    const instance = new MixedClass()

    const bash1 = instance.bash
    const bash2 = instance.bash

    expect(bash1).toBe(bash2)
    expect(factoryFn).toHaveBeenCalledTimes(1)
  })

  it('should pass instance to factory function', () => {
    const factoryFn = vi.fn().mockReturnValue(createMockExecutor())

    class BaseClass {
      config = { endpoint: 'http://example.com.ai' }
    }

    const MixedClass = withBash(BaseClass, factoryFn)
    const instance = new MixedClass()

    const _ = instance.bash

    expect(factoryFn).toHaveBeenCalledWith(instance)
    expect(factoryFn.mock.calls[0][0].config.endpoint).toBe('http://example.com.ai')
  })

  it('should preserve constructor arguments', () => {
    class BaseClass {
      name: string
      constructor(name: string) {
        this.name = name
      }
    }

    const executor = createMockExecutor()
    const MixedClass = withBash(BaseClass, () => executor)

    const instance = new MixedClass('test-instance')

    expect(instance.name).toBe('test-instance')
    expect(instance.bash).toBeInstanceOf(BashModule)
  })

  it('should work with classes that have methods', () => {
    class BaseClass {
      getValue() {
        return 42
      }
    }

    const executor = createMockExecutor()
    const MixedClass = withBash(BaseClass, () => executor)

    const instance = new MixedClass()

    expect(instance.getValue()).toBe(42)
    expect(instance.bash).toBeInstanceOf(BashModule)
  })

  it('should allow extending mixed classes', () => {
    class BaseClass {
      base = 'base-value'
    }

    const executor = createMockExecutor()
    const MixedClass = withBash(BaseClass, () => executor)

    class ExtendedClass extends MixedClass {
      extended = 'extended-value'
    }

    const instance = new ExtendedClass()

    expect(instance.base).toBe('base-value')
    expect(instance.extended).toBe('extended-value')
    expect(instance.bash).toBeInstanceOf(BashModule)
  })

  it('should support async executor creation', async () => {
    class BaseClass {
      env = { containerEndpoint: 'https://container.example.com.ai' }
    }

    const executor = createMockExecutor({
      'test-command': { stdout: 'async result', exitCode: 0 },
    })

    const MixedClass = withBash(BaseClass, (instance) => {
      // Can access instance properties when creating executor
      expect(instance.env.containerEndpoint).toBe('https://container.example.com.ai')
      return executor
    })

    const instance = new MixedClass()
    const result = await instance.bash.exec('test-command')

    expect(result.stdout).toBe('async result')
  })

  it('should create separate BashModule instances for different class instances', () => {
    class BaseClass {}

    const executor1 = createMockExecutor()
    const executor2 = createMockExecutor()
    let callCount = 0

    const MixedClass = withBash(BaseClass, () => {
      callCount++
      return callCount === 1 ? executor1 : executor2
    })

    const instance1 = new MixedClass()
    const instance2 = new MixedClass()

    const bash1 = instance1.bash
    const bash2 = instance2.bash

    expect(bash1).not.toBe(bash2)
    expect(bash1).toBeInstanceOf(BashModule)
    expect(bash2).toBeInstanceOf(BashModule)
  })

  it('should work with inherited properties', () => {
    class ParentClass {
      parentProp = 'parent'
    }

    class ChildClass extends ParentClass {
      childProp = 'child'
    }

    const executor = createMockExecutor()
    const MixedClass = withBash(ChildClass, (instance) => {
      expect(instance.parentProp).toBe('parent')
      expect(instance.childProp).toBe('child')
      return executor
    })

    const instance = new MixedClass()

    expect(instance.parentProp).toBe('parent')
    expect(instance.childProp).toBe('child')
    expect(instance.bash).toBeInstanceOf(BashModule)
  })
})

describe('withBash type exports', () => {
  it('should export WithBashCapability interface', () => {
    // Type test - verify the interface can be used for type checking
    const checkCapability = (obj: WithBashCapability): BashModule => {
      return obj.bash
    }

    class BaseClass {}
    const executor = createMockExecutor()
    const MixedClass = withBash(BaseClass, () => executor)
    const instance = new MixedClass()

    const bash = checkCapability(instance)
    expect(bash).toBeInstanceOf(BashModule)
  })

  it('should export Constructor type', () => {
    // Type test - verify the Constructor type works
    const createInstance = <T extends Constructor>(ctor: T): InstanceType<T> => {
      return new ctor()
    }

    class TestClass {
      value = 'test'
    }

    const instance = createInstance(TestClass)
    expect(instance.value).toBe('test')
  })

  it('should work with Constructor type for classes with constructor arguments', () => {
    // This test verifies that Constructor<T> works correctly with unknown[] args
    // The type should accept classes that have constructor parameters

    class ClassWithArgs {
      name: string
      count: number
      constructor(name: string, count: number) {
        this.name = name
        this.count = count
      }
    }

    // Constructor type should work as a constraint for mixin functions
    function applyMixin<TBase extends Constructor>(Base: TBase) {
      return class extends Base {
        mixed = true
      }
    }

    const MixedClass = applyMixin(ClassWithArgs)
    const instance = new MixedClass('test', 42)

    expect(instance.name).toBe('test')
    expect(instance.count).toBe(42)
    expect(instance.mixed).toBe(true)
  })

  it('should preserve constructor argument types through mixin composition', () => {
    // Verifies that Constructor type correctly handles argument passing
    class ConfigurableClass {
      config: { enabled: boolean }
      constructor(config: { enabled: boolean }) {
        this.config = config
      }
    }

    const executor = createMockExecutor()
    const MixedClass = withBash(ConfigurableClass, () => executor)

    const instance = new MixedClass({ enabled: true })

    expect(instance.config.enabled).toBe(true)
    expect(instance.bash).toBeInstanceOf(BashModule)
  })

  it('should correctly type the result of withBash', () => {
    class BaseClass {
      baseMethod() {
        return 'base'
      }
    }

    const executor = createMockExecutor()
    const MixedClass = withBash(BaseClass, () => executor)

    // The mixed class should have both base methods and bash property
    const instance = new MixedClass()

    // Type assertion tests (these compile if types are correct)
    const baseResult: string = instance.baseMethod()
    const bashModule: BashModule = instance.bash

    expect(baseResult).toBe('base')
    expect(bashModule).toBeInstanceOf(BashModule)
  })
})

// ============================================================================
// FsCapability Integration Tests
// ============================================================================

import type { FsCapability, FsEntry, FsStat } from '../../src/types.js'

/**
 * Helper to create a mock FsCapability that matches fsx.do's interface.
 *
 * fsx.do's FsCapability has:
 * - read(path, options?) - returns string when encoding is 'utf-8', Uint8Array otherwise
 * - list(path, options?) - returns Dirent[] (with methods) when withFileTypes: true
 * - stat(path) - returns Stats with isFile()/isDirectory() as methods
 */
function createMockFsCapability(
  files: Record<string, string> = {},
  statOverrides: Record<string, { isFile?: boolean; isDirectory?: boolean }> = {},
): FsCapability {
  return {
    // fsx.do read() accepts options parameter with encoding
    read: vi.fn(async (path: string, options?: { encoding?: string }) => {
      if (path in files) {
        return files[path]
      }
      throw new Error(`File not found: ${path}`)
    }),
    exists: vi.fn(async (path: string) => path in files || path in statOverrides),
    // fsx.do list() accepts options and returns Dirent[] with methods when withFileTypes: true
    list: vi.fn(async (path: string, options?: { withFileTypes?: boolean }) => {
      // Return entries based on what files start with the path
      const entries: Array<{ name: string; isDirectory(): boolean }> = []
      for (const filePath of Object.keys({ ...files, ...statOverrides })) {
        if (filePath.startsWith(path === '.' ? '' : path)) {
          const name = filePath.replace(path === '.' ? '' : path + '/', '').split('/')[0]
          if (name && !entries.some((e) => e.name === name)) {
            const isDir = !filePath.includes('.') || filePath.endsWith('/')
            entries.push({
              name,
              // fsx.do Dirent has isDirectory() as a method
              isDirectory: () => isDir,
            })
          }
        }
      }
      return entries
    }),
    // fsx.do stat() returns Stats with isFile()/isDirectory() as methods
    stat: vi.fn(async (path: string) => {
      // Check for overrides first
      const override = statOverrides[path]
      const isDir = override?.isDirectory ?? (path.endsWith('/') || !(path in files))
      const isFile = override?.isFile ?? (path in files)
      const size = files[path]?.length || 0
      return {
        size,
        // fsx.do Stats class has isFile() and isDirectory() as methods
        isFile: () => isFile,
        isDirectory: () => isDir,
        // Additional Stats properties for compatibility
        mode: 0o644,
        uid: 0,
        gid: 0,
        nlink: 1,
        dev: 0,
        ino: 0,
        rdev: 0,
        blksize: 4096,
        blocks: Math.ceil(size / 512),
        atimeMs: Date.now(),
        mtimeMs: Date.now(),
        ctimeMs: Date.now(),
        birthtimeMs: Date.now(),
      }
    }),
  } as unknown as FsCapability
}

describe('BashModule with FsCapability', () => {
  describe('constructor with options', () => {
    it('should accept FsCapability in options', () => {
      const executor = createMockExecutor()
      const fs = createMockFsCapability()
      const bash = new BashModule(executor, { fs })

      expect(bash.hasFsCapability).toBe(true)
    })

    it('should report no FsCapability when not provided', () => {
      const executor = createMockExecutor()
      const bash = new BashModule(executor)

      expect(bash.hasFsCapability).toBe(false)
    })

    it('should respect useNativeOps option', () => {
      const executor = createMockExecutor()
      const fs = createMockFsCapability()
      const bash = new BashModule(executor, { fs, useNativeOps: false })

      expect(bash.hasFsCapability).toBe(false)
    })
  })

  describe('native cat command', () => {
    it('should use fs.read for cat command when FsCapability is available', async () => {
      const executor = createMockExecutor()
      const fs = createMockFsCapability({
        'file.txt': 'Hello, World!',
      })
      const bash = new BashModule(executor, { fs })

      const result = await bash.exec('cat', ['file.txt'])

      expect(result.stdout).toBe('Hello, World!')
      expect(result.exitCode).toBe(0)
      // fsx.do read() is called with encoding option
      expect(fs.read).toHaveBeenCalledWith('file.txt', { encoding: 'utf-8' })
      expect(executor.execute).not.toHaveBeenCalled()
    })

    it('should concatenate multiple files', async () => {
      const executor = createMockExecutor()
      const fs = createMockFsCapability({
        'file1.txt': 'First\n',
        'file2.txt': 'Second\n',
      })
      const bash = new BashModule(executor, { fs })

      const result = await bash.exec('cat', ['file1.txt', 'file2.txt'])

      expect(result.stdout).toBe('First\nSecond\n')
      expect(fs.read).toHaveBeenCalledTimes(2)
    })

    it('should return error for non-existent file', async () => {
      const executor = createMockExecutor()
      const fs = createMockFsCapability({})
      const bash = new BashModule(executor, { fs })

      const result = await bash.exec('cat', ['missing.txt'])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('not found')
    })

    it('should fall back to executor when cat has no args', async () => {
      const executor = createMockExecutor({
        cat: { stdout: 'stdin content', exitCode: 0 },
      })
      const fs = createMockFsCapability()
      const bash = new BashModule(executor, { fs })

      const result = await bash.exec('cat')

      expect(executor.execute).toHaveBeenCalled()
    })
  })

  describe('native ls command', () => {
    it('should use fs.list for ls command', async () => {
      const executor = createMockExecutor()
      const fs = createMockFsCapability({
        'file1.txt': 'content',
        'file2.txt': 'content',
      })
      // Override list to return fsx.do Dirent-like entries with isDirectory() as method
      ;(fs.list as any).mockResolvedValue([
        { name: 'file1.txt', isDirectory: () => false },
        { name: 'file2.txt', isDirectory: () => false },
        { name: 'subdir', isDirectory: () => true },
      ])
      const bash = new BashModule(executor, { fs })

      const result = await bash.exec('ls')

      expect(result.stdout).toContain('file1.txt')
      expect(result.stdout).toContain('file2.txt')
      expect(result.stdout).toContain('subdir/')
      expect(result.exitCode).toBe(0)
      // fsx.do list() is called with withFileTypes option
      expect(fs.list).toHaveBeenCalledWith('.', { withFileTypes: true })
    })

    it('should list specific directory', async () => {
      const executor = createMockExecutor()
      const fs = createMockFsCapability()
      ;(fs.list as any).mockResolvedValue([{ name: 'nested.txt', isDirectory: () => false }])
      const bash = new BashModule(executor, { fs })

      const result = await bash.exec('ls', ['/app'])

      // fsx.do list() is called with withFileTypes option
      expect(fs.list).toHaveBeenCalledWith('/app', { withFileTypes: true })
    })
  })

  describe('native test command', () => {
    it('should check file existence with test -e', async () => {
      const executor = createMockExecutor()
      const fs = createMockFsCapability({ 'exists.txt': 'content' })
      const bash = new BashModule(executor, { fs })

      const result = await bash.exec('test', ['-e', 'exists.txt'])

      expect(result.exitCode).toBe(0)
      expect(fs.exists).toHaveBeenCalledWith('exists.txt')
    })

    it('should return exit code 1 for non-existent file', async () => {
      const executor = createMockExecutor()
      const fs = createMockFsCapability({})
      const bash = new BashModule(executor, { fs })

      const result = await bash.exec('test', ['-e', 'missing.txt'])

      expect(result.exitCode).toBe(1)
    })

    it('should check if path is file with test -f', async () => {
      const executor = createMockExecutor()
      const fs = createMockFsCapability(
        { 'file.txt': 'content' },
        { 'file.txt': { isFile: true, isDirectory: false } },
      )
      const bash = new BashModule(executor, { fs })

      const result = await bash.exec('test', ['-f', 'file.txt'])

      expect(result.exitCode).toBe(0)
    })

    it('should check if path is directory with test -d', async () => {
      const executor = createMockExecutor()
      const fs = createMockFsCapability({}, { 'dir': { isFile: false, isDirectory: true } })
      const bash = new BashModule(executor, { fs })

      const result = await bash.exec('test', ['-d', 'dir'])

      expect(result.exitCode).toBe(0)
    })

    it('should fall back for unknown test flags', async () => {
      const executor = createMockExecutor({
        'test -x script.sh': { stdout: '', exitCode: 0 },
      })
      const fs = createMockFsCapability()
      const bash = new BashModule(executor, { fs })

      const result = await bash.exec('test', ['-x', 'script.sh'])

      expect(executor.execute).toHaveBeenCalled()
    })
  })

  describe('native head command', () => {
    it('should read first 10 lines by default', async () => {
      const executor = createMockExecutor()
      const content = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n')
      const fs = createMockFsCapability({ 'file.txt': content })
      const bash = new BashModule(executor, { fs })

      const result = await bash.exec('head', ['file.txt'])

      const lines = result.stdout.split('\n').filter((l) => l)
      expect(lines.length).toBe(10)
      expect(lines[0]).toBe('Line 1')
      expect(lines[9]).toBe('Line 10')
    })

    it('should respect -n flag', async () => {
      const executor = createMockExecutor()
      const content = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n')
      const fs = createMockFsCapability({ 'file.txt': content })
      const bash = new BashModule(executor, { fs })

      const result = await bash.exec('head', ['-n', '5', 'file.txt'])

      const lines = result.stdout.split('\n').filter((l) => l)
      expect(lines.length).toBe(5)
      expect(lines[4]).toBe('Line 5')
    })
  })

  describe('native tail command', () => {
    it('should read last 10 lines by default', async () => {
      const executor = createMockExecutor()
      const content = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n') + '\n'
      const fs = createMockFsCapability({ 'file.txt': content })
      const bash = new BashModule(executor, { fs })

      const result = await bash.exec('tail', ['file.txt'])

      const lines = result.stdout.split('\n').filter((l) => l)
      expect(lines.length).toBe(10)
      expect(lines[0]).toBe('Line 11')
      expect(lines[9]).toBe('Line 20')
    })

    it('should respect -n flag', async () => {
      const executor = createMockExecutor()
      const content = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n') + '\n'
      const fs = createMockFsCapability({ 'file.txt': content })
      const bash = new BashModule(executor, { fs })

      const result = await bash.exec('tail', ['-n', '3', 'file.txt'])

      const lines = result.stdout.split('\n').filter((l) => l)
      expect(lines.length).toBe(3)
      expect(lines[0]).toBe('Line 18')
      expect(lines[2]).toBe('Line 20')
    })
  })

  describe('fallback to executor', () => {
    it('should use executor for non-native commands', async () => {
      const executor = createMockExecutor({
        'git status': { stdout: 'On branch main', exitCode: 0 },
      })
      const fs = createMockFsCapability()
      const bash = new BashModule(executor, { fs })

      const result = await bash.exec('git', ['status'])

      expect(result.stdout).toBe('On branch main')
      expect(executor.execute).toHaveBeenCalled()
    })

    it('should use executor when useNativeOps is false', async () => {
      const executor = createMockExecutor({
        'cat file.txt': { stdout: 'from executor', exitCode: 0 },
      })
      const fs = createMockFsCapability({ 'file.txt': 'from fs' })
      const bash = new BashModule(executor, { fs, useNativeOps: false })

      const result = await bash.exec('cat', ['file.txt'])

      expect(result.stdout).toBe('from executor')
      expect(executor.execute).toHaveBeenCalled()
      expect(fs.read).not.toHaveBeenCalled()
    })
  })
})

describe('withBash with FsCapability integration', () => {
  it('should accept config object with fs factory', () => {
    class BaseClass {
      fsCapability = createMockFsCapability({ 'test.txt': 'content' })
    }

    const executor = createMockExecutor()
    const MixedClass = withBash(BaseClass, {
      executor: () => executor,
      fs: (instance) => instance.fsCapability,
    })

    const instance = new MixedClass()

    expect(instance.bash).toBeInstanceOf(BashModule)
    expect(instance.bash.hasFsCapability).toBe(true)
  })

  it('should use native ops when fs is provided via config', async () => {
    const fsCapability = createMockFsCapability({ 'config.json': '{"key": "value"}' })

    class BaseClass {
      fs = fsCapability
    }

    const executor = createMockExecutor()
    const MixedClass = withBash(BaseClass, {
      executor: () => executor,
      fs: (instance) => instance.fs,
    })

    const instance = new MixedClass()
    const result = await instance.bash.exec('cat', ['config.json'])

    expect(result.stdout).toBe('{"key": "value"}')
    // fsx.do read() is called with encoding option
    expect(fsCapability.read).toHaveBeenCalledWith('config.json', { encoding: 'utf-8' })
    expect(executor.execute).not.toHaveBeenCalled()
  })

  it('should work with function shorthand (no fs)', () => {
    class BaseClass {}

    const executor = createMockExecutor()
    const MixedClass = withBash(BaseClass, () => executor)

    const instance = new MixedClass()

    expect(instance.bash.hasFsCapability).toBe(false)
  })

  it('should allow disabling native ops in config', async () => {
    const fsCapability = createMockFsCapability({ 'file.txt': 'fs content' })

    class BaseClass {
      fs = fsCapability
    }

    const executor = createMockExecutor({
      'cat file.txt': { stdout: 'executor content', exitCode: 0 },
    })

    const MixedClass = withBash(BaseClass, {
      executor: () => executor,
      fs: (instance) => instance.fs,
      useNativeOps: false,
    })

    const instance = new MixedClass()
    const result = await instance.bash.exec('cat', ['file.txt'])

    expect(result.stdout).toBe('executor content')
    expect(executor.execute).toHaveBeenCalled()
  })
})

// ============================================================================
// DO Integration Pattern Tests
// ============================================================================

describe('DO Integration Patterns', () => {
  describe('WorkflowContext-like integration', () => {
    it('should support lazy capability initialization pattern', () => {
      // Simulating the DO $ proxy pattern where capabilities are lazily initialized
      const executor = createMockExecutor()

      class MockWorkflowContext {
        private _bash?: BashModule

        get bash(): BashModule {
          if (!this._bash) {
            this._bash = new BashModule(executor)
          }
          return this._bash
        }
      }

      const $ = new MockWorkflowContext()

      // First access creates the module
      const bash1 = $.bash
      // Second access returns the same instance
      const bash2 = $.bash

      expect(bash1).toBe(bash2)
      expect(bash1).toBeInstanceOf(BashModule)
    })

    it('should support capability registration pattern', () => {
      // Pattern where DO registers capabilities at construction time
      const executor = createMockExecutor()

      class CapabilityRegistry {
        private capabilities = new Map<string, unknown>()

        register<T>(name: string, capability: T): void {
          this.capabilities.set(name, capability)
        }

        get<T>(name: string): T | undefined {
          return this.capabilities.get(name) as T | undefined
        }
      }

      const registry = new CapabilityRegistry()
      const bashModule = new BashModule(executor)

      registry.register('bash', bashModule)

      const retrieved = registry.get<BashModule>('bash')
      expect(retrieved).toBe(bashModule)
      expect(retrieved?.name).toBe('bash')
    })
  })

  describe('Multi-capability composition', () => {
    it('should compose multiple capabilities via mixin chain', () => {
      // Simulating withFs + withBash composition
      const executor = createMockExecutor()
      const fsCapability = createMockFsCapability({ 'test.txt': 'content' })

      class BaseClass {
        id = 'test-do'
      }

      // Simulate withFs mixin
      class WithFsClass extends BaseClass {
        fs = fsCapability
      }

      // Apply withBash to class that already has fs
      const ComposedClass = withBash(WithFsClass, {
        executor: () => executor,
        fs: (instance) => instance.fs,
      })

      const instance = new ComposedClass()

      expect(instance.id).toBe('test-do')
      expect(instance.fs).toBe(fsCapability)
      expect(instance.bash).toBeInstanceOf(BashModule)
      expect(instance.bash.hasFsCapability).toBe(true)
    })

    it('should allow async operations across capabilities', async () => {
      const executor = createMockExecutor({
        'git status': { stdout: 'On branch main\nnothing to commit', exitCode: 0 },
      })
      const fsCapability = createMockFsCapability({
        '.git/config': '[core]\n\trepositoryformatversion = 0',
      })

      class BaseClass {}

      const ComposedClass = withBash(BaseClass, {
        executor: () => executor,
        fs: () => fsCapability,
      })

      const instance = new ComposedClass()

      // Read git config via native fs
      const configResult = await instance.bash.exec('cat', ['.git/config'])
      expect(configResult.stdout).toContain('repositoryformatversion')

      // Execute git command via executor
      const statusResult = await instance.bash.exec('git', ['status'])
      expect(statusResult.stdout).toContain('On branch main')
    })
  })

  describe('Durable Object lifecycle integration', () => {
    it('should support initialization in constructor', () => {
      const executor = createMockExecutor()

      class MockDurableObject {
        state: { id: string }
        bash: BashModule

        constructor(state: { id: string }) {
          this.state = state
          this.bash = new BashModule(executor)
        }
      }

      const obj = new MockDurableObject({ id: 'test-id' })

      expect(obj.state.id).toBe('test-id')
      expect(obj.bash).toBeInstanceOf(BashModule)
    })

    it('should support initialization from environment bindings', () => {
      const mockExecutor = createMockExecutor()

      interface Env {
        EXECUTOR: BashExecutor
      }

      class MockDurableObject {
        bash: BashModule

        constructor(state: unknown, env: Env) {
          this.bash = new BashModule(env.EXECUTOR)
        }
      }

      const env: Env = { EXECUTOR: mockExecutor }
      const obj = new MockDurableObject({}, env)

      expect(obj.bash).toBeInstanceOf(BashModule)
    })

    it('should support dispose pattern for cleanup', async () => {
      const executor = createMockExecutor()
      const bash = new BashModule(executor)

      await bash.initialize()
      await bash.dispose()

      // After dispose, should be able to reinitialize
      await bash.initialize()
      expect(bash.name).toBe('bash')
    })
  })

  describe('Error handling in DO context', () => {
    it('should handle executor errors gracefully', async () => {
      const failingExecutor: BashExecutor = {
        execute: vi.fn().mockRejectedValue(new Error('Container unavailable')),
      }

      const bash = new BashModule(failingExecutor)

      await expect(bash.exec('ls')).rejects.toThrow('Container unavailable')
    })

    it('should handle parse errors gracefully', async () => {
      // Import the mocked parse function
      const parserModule = await import('../../src/ast/parser.js')
      const parse = vi.mocked(parserModule.parse)

      // Reset mock to throw for this test
      parse.mockImplementationOnce(() => {
        throw new Error('Parse error')
      })

      const executor = createMockExecutor({
        'invalid command {{': { stdout: '', stderr: 'syntax error', exitCode: 2 },
      })
      const bash = new BashModule(executor)

      // Should fall through to executor even if parse fails
      expect(() => bash.parse('invalid command {{')).toThrow()
    })

    it('should propagate executor timeout behavior', async () => {
      const slowExecutor: BashExecutor = {
        execute: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    input: 'slow',
                    command: 'slow',
                    valid: true,
                    generated: false,
                    stdout: 'eventually done',
                    stderr: '',
                    exitCode: 0,
                    intent: { commands: [], reads: [], writes: [], deletes: [], network: false, elevated: false },
                    classification: { type: 'read' as const, impact: 'none' as const, reversible: true, reason: '' },
                  }),
                50,
              ),
            ),
        ),
      }

      const bash = new BashModule(slowExecutor)
      const result = await bash.exec('slow', [], { timeout: 100 })

      expect(result.stdout).toBe('eventually done')
    })
  })

  describe('Environment variable handling', () => {
    it('should pass environment variables through options', async () => {
      const capturedOptions: any[] = []
      const trackingExecutor: BashExecutor = {
        execute: vi.fn().mockImplementation(async (command, options) => {
          capturedOptions.push(options)
          return {
            input: command,
            command,
            valid: true,
            generated: false,
            stdout: '',
            stderr: '',
            exitCode: 0,
            intent: { commands: [], reads: [], writes: [], deletes: [], network: false, elevated: false },
            classification: { type: 'read' as const, impact: 'none' as const, reversible: true, reason: '' },
          }
        }),
      }

      const bash = new BashModule(trackingExecutor)

      await bash.exec('node', ['script.js'], {
        env: {
          NODE_ENV: 'production',
          API_KEY: 'secret',
        },
        cwd: '/app',
      })

      expect(capturedOptions[0]).toMatchObject({
        env: {
          NODE_ENV: 'production',
          API_KEY: 'secret',
        },
        cwd: '/app',
      })
    })
  })

  describe('Concurrent execution handling', () => {
    it('should handle concurrent exec calls', async () => {
      let callCount = 0
      const concurrentExecutor: BashExecutor = {
        execute: vi.fn().mockImplementation(async (command) => {
          const count = ++callCount
          await new Promise((r) => setTimeout(r, 10))
          return {
            input: command,
            command,
            valid: true,
            generated: false,
            stdout: `result-${count}`,
            stderr: '',
            exitCode: 0,
            intent: { commands: [], reads: [], writes: [], deletes: [], network: false, elevated: false },
            classification: { type: 'read' as const, impact: 'none' as const, reversible: true, reason: '' },
          }
        }),
      }

      const bash = new BashModule(concurrentExecutor)

      const [r1, r2, r3] = await Promise.all([
        bash.exec('cmd1'),
        bash.exec('cmd2'),
        bash.exec('cmd3'),
      ])

      expect(r1.stdout).toMatch(/result-\d/)
      expect(r2.stdout).toMatch(/result-\d/)
      expect(r3.stdout).toMatch(/result-\d/)
      expect(concurrentExecutor.execute).toHaveBeenCalledTimes(3)
    })
  })
})
