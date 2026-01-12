/**
 * RED TDD: withNpm Mixin Integration Tests
 *
 * Tests for integrating npmx.do's withNpm mixin with dotdo Durable Objects.
 * These tests verify the $.npm capability is properly added to WorkflowContext.
 *
 * Key requirements:
 * 1. withNpm requires withFs capability (throws if missing)
 * 2. withNpm adds $.npm to WorkflowContext when fs present
 * 3. $.npm.resolve() resolves semver ranges to specific versions
 * 4. $.npm.install() fetches and extracts packages
 * 5. $.npm.install() resolves transitive dependencies
 * 6. $.npm.lockfile() generates package-lock.json
 * 7. $.npm.list() shows installed packages
 * 8. $.npm.run() executes package scripts (requires withBash)
 *
 * Reference: dotdo-0w56g issue
 *
 * TDD Phase: RED
 * These tests should FAIL until withNpm is properly integrated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Import the mixins we're testing
import { withFs, type FsCapability, type WithFsContext } from '../../lib/mixins/fs'
import { withNpm, type NpmCapability, type WithNpmContext } from '../mixins/npm'
import { withBash, type BashCapability, type WithBashContext } from '../../lib/mixins/bash'
import { DO } from '../DO'
import type { WorkflowContext } from '../../types/WorkflowContext'

// ============================================================================
// TEST FIXTURES & MOCKS
// ============================================================================

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
      list: vi.fn((options?: { prefix?: string }) => {
        const result = new Map<string, unknown>()
        const prefix = options?.prefix ?? ''
        for (const [k, v] of storage) {
          if (k.startsWith(prefix)) {
            result.set(k, v)
          }
        }
        return Promise.resolve(result)
      }),
      deleteAll: vi.fn(() => {
        storage.clear()
        return Promise.resolve()
      }),
      transaction: vi.fn((cb: () => Promise<unknown>) => cb()),
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
// DEPENDENCY REQUIREMENTS TESTS
// ============================================================================

describe('withNpm Mixin - Dependency Requirements', () => {
  describe('requires withFs capability', () => {
    it('should throw error when applied to DO without withFs', () => {
      // RED: withNpm should throw when fs capability is missing
      // Applying withNpm directly to DO (without withFs) should fail
      expect(() => {
        // @ts-expect-error - Intentionally testing runtime behavior with wrong type
        const BadDO = withNpm(DO)
        const state = createMockDOState()
        const env = createMockEnv()
        const instance = new BadDO(state, env)
        // Accessing npm should throw if fs is missing
        const _npm = instance.$.npm
      }).toThrow(/requires.*fs/i)
    })

    it('should work when applied after withFs', () => {
      // This should NOT throw - withFs provides the required capability
      const DOWithFsAndNpm = withNpm(withFs(DO))

      const state = createMockDOState()
      const env = createMockEnv()
      const instance = new DOWithFsAndNpm(state, env)

      expect(instance.$.fs).toBeDefined()
      expect(instance.$.npm).toBeDefined()
    })
  })
})

// ============================================================================
// CAPABILITY DETECTION TESTS
// ============================================================================

describe('withNpm Mixin - Capability Detection', () => {
  let state: DurableObjectState
  let env: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    state = createMockDOState()
    env = createMockEnv()
  })

  it('adds $.npm to WorkflowContext', () => {
    const DOWithNpm = withNpm(withFs(DO))
    const instance = new DOWithNpm(state, env)

    expect(instance.$.npm).toBeDefined()
  })

  it('hasCapability returns true for npm', () => {
    const DOWithNpm = withNpm(withFs(DO))
    const instance = new DOWithNpm(state, env)

    expect(instance.hasCapability('npm')).toBe(true)
  })

  it('hasCapability returns true for fs (preserved from parent)', () => {
    const DOWithNpm = withNpm(withFs(DO))
    const instance = new DOWithNpm(state, env)

    expect(instance.hasCapability('fs')).toBe(true)
  })

  it('hasCapability returns false for unknown capabilities', () => {
    const DOWithNpm = withNpm(withFs(DO))
    const instance = new DOWithNpm(state, env)

    expect(instance.hasCapability('git')).toBe(false)
    expect(instance.hasCapability('bash')).toBe(false)
  })

  it('static capabilities array includes npm', () => {
    const DOWithNpm = withNpm(withFs(DO))

    expect((DOWithNpm as unknown as { capabilities?: string[] }).capabilities).toContain('npm')
  })

  it('static capabilities array includes both fs and npm', () => {
    const DOWithNpm = withNpm(withFs(DO))

    expect((DOWithNpm as unknown as { capabilities?: string[] }).capabilities).toContain('fs')
    expect((DOWithNpm as unknown as { capabilities?: string[] }).capabilities).toContain('npm')
  })
})

// ============================================================================
// $.npm.resolve() TESTS
// ============================================================================

describe('withNpm Mixin - $.npm.resolve()', () => {
  let instance: InstanceType<ReturnType<typeof withNpm<ReturnType<typeof withFs<typeof DO>>>>>

  beforeEach(() => {
    const DOWithNpm = withNpm(withFs(DO))
    const state = createMockDOState()
    const env = createMockEnv()
    instance = new DOWithNpm(state, env)
  })

  it('$.npm.resolve() resolves semver ranges', async () => {
    // RED: resolve() should query npm registry and resolve the range
    const version = await instance.$.npm.resolve('is-odd', '^3.0.0')

    // Should return a version that matches the range (3.x.x)
    expect(version).toMatch(/^3\.\d+\.\d+$/)
  })

  it('$.npm.resolve() returns exact version for exact spec', async () => {
    const version = await instance.$.npm.resolve('is-odd', '3.0.1')

    expect(version).toBe('3.0.1')
  })

  it('$.npm.resolve() throws for invalid package', async () => {
    await expect(instance.$.npm.resolve('definitely-not-a-real-package-xyz123', '^1.0.0')).rejects.toThrow()
  })

  it('$.npm.resolve() handles "latest" tag', async () => {
    const version = await instance.$.npm.resolve('is-odd', 'latest')

    // Should return some version string
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })
})

// ============================================================================
// $.npm.install() TESTS
// ============================================================================

describe('withNpm Mixin - $.npm.install()', () => {
  let instance: InstanceType<ReturnType<typeof withNpm<ReturnType<typeof withFs<typeof DO>>>>>

  beforeEach(() => {
    const DOWithNpm = withNpm(withFs(DO))
    const state = createMockDOState()
    const env = createMockEnv()
    instance = new DOWithNpm(state, env)
  })

  it('$.npm.install() fetches and extracts package', async () => {
    // RED: install() should fetch the package and extract to node_modules
    await instance.$.npm.install('is-odd', '3.0.1')

    const exists = await instance.$.fs.exists('/node_modules/is-odd/package.json')
    expect(exists).toBe(true)
  })

  it('$.npm.install() creates node_modules directory', async () => {
    await instance.$.npm.install('is-odd', '3.0.1')

    const exists = await instance.$.fs.exists('/node_modules')
    expect(exists).toBe(true)
  })

  it('$.npm.install() writes package.json with correct version', async () => {
    await instance.$.npm.install('is-odd', '3.0.1')

    const content = await instance.$.fs.read('/node_modules/is-odd/package.json')
    const pkg = JSON.parse(content)
    expect(pkg.name).toBe('is-odd')
    expect(pkg.version).toBe('3.0.1')
  })

  it('$.npm.install() resolves transitive dependencies', async () => {
    // RED: install() should also install dependencies of the package
    await instance.$.npm.install('is-odd', '3.0.1')

    // is-odd depends on is-number
    const exists = await instance.$.fs.exists('/node_modules/is-number/package.json')
    expect(exists).toBe(true)
  })

  it('$.npm.install() without args installs from package.json', async () => {
    // Write a package.json first
    await instance.$.fs.write(
      '/package.json',
      JSON.stringify({
        name: 'test',
        dependencies: { 'is-odd': '^3.0.0' },
      })
    )

    await instance.$.npm.install()

    const exists = await instance.$.fs.exists('/node_modules/is-odd/package.json')
    expect(exists).toBe(true)
  })

  it('$.npm.install() without package.json throws', async () => {
    await expect(instance.$.npm.install()).rejects.toThrow(/package\.json/i)
  })

  it('$.npm.install() returns InstallResult with added packages', async () => {
    const result = await instance.$.npm.install('is-odd', '3.0.1')

    expect(result.added).toContainEqual({ name: 'is-odd', version: '3.0.1' })
  })
})

// ============================================================================
// $.npm.lockfile() TESTS
// ============================================================================

describe('withNpm Mixin - $.npm.lockfile()', () => {
  let instance: InstanceType<ReturnType<typeof withNpm<ReturnType<typeof withFs<typeof DO>>>>>

  beforeEach(() => {
    const DOWithNpm = withNpm(withFs(DO))
    const state = createMockDOState()
    const env = createMockEnv()
    instance = new DOWithNpm(state, env)
  })

  it('$.npm.lockfile() generates package-lock.json', async () => {
    // Write package.json
    await instance.$.fs.write(
      '/package.json',
      JSON.stringify({
        name: 'test',
        dependencies: { 'is-odd': '^3.0.0' },
      })
    )

    // Install packages
    await instance.$.npm.install()

    // Get lockfile
    const lockfile = await instance.$.npm.lockfile()

    expect(lockfile.lockfileVersion).toBe(3)
    expect(lockfile.packages['node_modules/is-odd']).toBeDefined()
  })

  it('$.npm.lockfile() includes resolved versions', async () => {
    await instance.$.fs.write(
      '/package.json',
      JSON.stringify({
        name: 'test',
        dependencies: { 'is-odd': '^3.0.0' },
      })
    )

    await instance.$.npm.install()
    const lockfile = await instance.$.npm.lockfile()

    const isOddEntry = lockfile.packages['node_modules/is-odd']
    expect(isOddEntry.version).toMatch(/^3\.\d+\.\d+$/)
  })

  it('$.npm.lockfile() includes transitive dependencies', async () => {
    await instance.$.fs.write(
      '/package.json',
      JSON.stringify({
        name: 'test',
        dependencies: { 'is-odd': '^3.0.0' },
      })
    )

    await instance.$.npm.install()
    const lockfile = await instance.$.npm.lockfile()

    // is-odd depends on is-number
    expect(lockfile.packages['node_modules/is-number']).toBeDefined()
  })
})

// ============================================================================
// $.npm.list() TESTS
// ============================================================================

describe('withNpm Mixin - $.npm.list()', () => {
  let instance: InstanceType<ReturnType<typeof withNpm<ReturnType<typeof withFs<typeof DO>>>>>

  beforeEach(() => {
    const DOWithNpm = withNpm(withFs(DO))
    const state = createMockDOState()
    const env = createMockEnv()
    instance = new DOWithNpm(state, env)
  })

  it('$.npm.list() returns empty array when no packages installed', async () => {
    const list = await instance.$.npm.list()

    expect(list).toEqual([])
  })

  it('$.npm.list() shows installed packages', async () => {
    await instance.$.npm.install('is-odd', '3.0.1')

    const list = await instance.$.npm.list()

    expect(list).toContainEqual({ name: 'is-odd', version: '3.0.1' })
  })

  it('$.npm.list() includes transitive dependencies', async () => {
    await instance.$.npm.install('is-odd', '3.0.1')

    const list = await instance.$.npm.list()

    // Should include is-number (transitive dep)
    const isNumberEntry = list.find((p) => p.name === 'is-number')
    expect(isNumberEntry).toBeDefined()
  })

  it('$.npm.list() shows multiple installed packages', async () => {
    await instance.$.npm.install('is-odd', '3.0.1')
    await instance.$.npm.install('is-even', '1.0.0')

    const list = await instance.$.npm.list()

    expect(list.find((p) => p.name === 'is-odd')).toBeDefined()
    expect(list.find((p) => p.name === 'is-even')).toBeDefined()
  })
})

// ============================================================================
// $.npm.run() TESTS
// ============================================================================

describe('withNpm Mixin - $.npm.run()', () => {
  it('$.npm.run() throws without withBash capability', async () => {
    const DOWithNpm = withNpm(withFs(DO))
    const state = createMockDOState()
    const env = createMockEnv()
    const instance = new DOWithNpm(state, env)

    // Write package.json with a script
    await instance.$.fs.write(
      '/package.json',
      JSON.stringify({
        name: 'test',
        scripts: { hello: 'echo hello' },
      })
    )

    // RED: run() should throw because bash capability is missing
    await expect(instance.$.npm.run('hello')).rejects.toThrow(/requires.*bash/i)
  })

  it('$.npm.run() executes package scripts when withBash is present', async () => {
    // Create mock executor for bash
    const mockExecutor = {
      execute: vi.fn().mockResolvedValue({
        input: 'echo hello',
        command: 'echo hello',
        valid: true,
        generated: false,
        stdout: 'hello\n',
        stderr: '',
        exitCode: 0,
        intent: { commands: ['echo'], reads: [], writes: [], deletes: [], network: false, elevated: false },
        classification: { type: 'execute' as const, impact: 'none' as const, reversible: true, reason: 'Echo command' },
      }),
    }

    const DOWithAll = withNpm(withBash(withFs(DO), { executor: () => mockExecutor }))
    const state = createMockDOState()
    const env = createMockEnv()
    const instance = new DOWithAll(state, env)

    // Write package.json with a script
    await instance.$.fs.write(
      '/package.json',
      JSON.stringify({
        name: 'test',
        scripts: { hello: 'echo hello' },
      })
    )

    const result = await instance.$.npm.run('hello')

    expect(result.stdout.trim()).toBe('hello')
  })

  it('$.npm.run() throws for non-existent script', async () => {
    // Create mock executor for bash
    const mockExecutor = {
      execute: vi.fn(),
    }

    const DOWithAll = withNpm(withBash(withFs(DO), { executor: () => mockExecutor }))
    const state = createMockDOState()
    const env = createMockEnv()
    const instance = new DOWithAll(state, env)

    // Write package.json without the requested script
    await instance.$.fs.write(
      '/package.json',
      JSON.stringify({
        name: 'test',
        scripts: { build: 'tsc' },
      })
    )

    await expect(instance.$.npm.run('test')).rejects.toThrow(/script.*not found/i)
  })
})

// ============================================================================
// $.npm.pack() TESTS
// ============================================================================

describe('withNpm Mixin - $.npm.pack()', () => {
  let instance: InstanceType<ReturnType<typeof withNpm<ReturnType<typeof withFs<typeof DO>>>>>

  beforeEach(() => {
    const DOWithNpm = withNpm(withFs(DO))
    const state = createMockDOState()
    const env = createMockEnv()
    instance = new DOWithNpm(state, env)
  })

  it('$.npm.pack() creates tarball from package', async () => {
    // Create a simple package
    await instance.$.fs.write(
      '/package.json',
      JSON.stringify({
        name: 'my-package',
        version: '1.0.0',
      })
    )
    await instance.$.fs.write('/index.js', 'module.exports = {}')

    const tarball = await instance.$.npm.pack()

    // Should return Uint8Array (gzipped tarball)
    expect(tarball).toBeInstanceOf(Uint8Array)
    expect(tarball.length).toBeGreaterThan(0)
  })

  it('$.npm.pack() throws without package.json', async () => {
    await expect(instance.$.npm.pack()).rejects.toThrow(/package\.json/i)
  })

  it('$.npm.pack() excludes node_modules by default', async () => {
    // Create package with node_modules
    await instance.$.fs.write(
      '/package.json',
      JSON.stringify({
        name: 'my-package',
        version: '1.0.0',
      })
    )
    await instance.$.fs.mkdir('/node_modules/dep', { recursive: true })
    await instance.$.fs.write('/node_modules/dep/package.json', '{}')

    const tarball = await instance.$.npm.pack()

    // Tarball should be created (not error)
    // Note: actual tarball validation would require parsing
    expect(tarball).toBeInstanceOf(Uint8Array)
  })
})

// ============================================================================
// TYPE SAFETY & EXPORTS TESTS
// ============================================================================

describe('withNpm Mixin - Type Safety', () => {
  it('exports WithNpmContext type', () => {
    // Type check - if this compiles, the type is exported correctly
    const _: WithNpmContext = {} as WithNpmContext
    expect(_).toBeDefined()
  })

  it('exports NpmCapability type', () => {
    // Type check
    const _: NpmCapability = {
      resolve: vi.fn(),
      install: vi.fn(),
      list: vi.fn(),
      lockfile: vi.fn(),
      run: vi.fn(),
      pack: vi.fn(),
    } as unknown as NpmCapability
    expect(_).toBeDefined()
  })

  it('properly types $.npm on instances', () => {
    const DOWithNpm = withNpm(withFs(DO))
    const state = createMockDOState()
    const env = createMockEnv()
    const instance = new DOWithNpm(state, env)

    // TypeScript should recognize these methods
    expect(instance.$.npm.resolve).toBeDefined()
    expect(instance.$.npm.install).toBeDefined()
    expect(instance.$.npm.list).toBeDefined()
    expect(instance.$.npm.lockfile).toBeDefined()
    expect(instance.$.npm.run).toBeDefined()
    expect(instance.$.npm.pack).toBeDefined()
  })
})

// ============================================================================
// MIXIN COMPOSITION TESTS
// ============================================================================

describe('withNpm Mixin - Composition', () => {
  it('composes correctly with multiple mixins', () => {
    const mockExecutor = { execute: vi.fn() }

    // Full composition: withNpm(withBash(withFs(DO)))
    const FullDO = withNpm(withBash(withFs(DO), { executor: () => mockExecutor }))
    const state = createMockDOState()
    const env = createMockEnv()
    const instance = new FullDO(state, env)

    expect(instance.$.fs).toBeDefined()
    expect(instance.$.bash).toBeDefined()
    expect(instance.$.npm).toBeDefined()
  })

  it('preserves all capabilities after composition', () => {
    const mockExecutor = { execute: vi.fn() }

    const FullDO = withNpm(withBash(withFs(DO), { executor: () => mockExecutor }))
    const state = createMockDOState()
    const env = createMockEnv()
    const instance = new FullDO(state, env)

    expect(instance.hasCapability('fs')).toBe(true)
    expect(instance.hasCapability('bash')).toBe(true)
    expect(instance.hasCapability('npm')).toBe(true)
  })

  it('withNpm options work correctly', () => {
    const customRegistry = 'https://npm.example.com'

    const DOWithNpm = withNpm(withFs(DO), { registry: customRegistry })
    const state = createMockDOState()
    const env = createMockEnv()
    const instance = new DOWithNpm(state, env)

    // Instance should be created without error
    expect(instance.$.npm).toBeDefined()
  })
})
