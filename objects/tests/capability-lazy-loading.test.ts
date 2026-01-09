/**
 * Capability Lazy Loading Tests (RED TDD)
 *
 * These tests verify that capability modules ($.fs, $.git, $.bash, etc.)
 * are loaded lazily on first access rather than eagerly on DO construction.
 *
 * Tests should FAIL until objects/DO.ts is updated with lazy loading proxy.
 *
 * This import will FAIL - CapabilityRegistry and related types don't exist yet
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports will FAIL - they don't exist yet
import {
  CapabilityRegistry,
  CapabilityError,
  createCapabilityProxy,
  type CapabilityModule,
  type CapabilityFactory,
  type CapabilityOptions,
  type DestroyResult,
} from '../capabilities'

// ============================================================================
// MOCK CAPABILITY MODULES
// ============================================================================

/**
 * Track module loading for verification
 */
const moduleLoadTracker = {
  fs: { loadCount: 0, instance: null as unknown },
  git: { loadCount: 0, instance: null as unknown },
  bash: { loadCount: 0, instance: null as unknown },
}

/**
 * Reset tracking state between tests
 */
function resetTracker() {
  moduleLoadTracker.fs = { loadCount: 0, instance: null }
  moduleLoadTracker.git = { loadCount: 0, instance: null }
  moduleLoadTracker.bash = { loadCount: 0, instance: null }
}

/**
 * Mock FS capability module
 */
class MockFsCapability {
  constructor() {
    moduleLoadTracker.fs.loadCount++
    moduleLoadTracker.fs.instance = this
  }

  readFile(path: string): Promise<string> {
    return Promise.resolve(`contents of ${path}`)
  }

  writeFile(path: string, content: string): Promise<void> {
    return Promise.resolve()
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(true)
  }
}

/**
 * Mock Git capability module
 */
class MockGitCapability {
  constructor() {
    moduleLoadTracker.git.loadCount++
    moduleLoadTracker.git.instance = this
  }

  status(): Promise<string> {
    return Promise.resolve('clean')
  }

  commit(message: string): Promise<string> {
    return Promise.resolve('abc123')
  }

  push(): Promise<void> {
    return Promise.resolve()
  }
}

/**
 * Mock Bash capability module
 */
class MockBashCapability {
  constructor() {
    moduleLoadTracker.bash.loadCount++
    moduleLoadTracker.bash.instance = this
  }

  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
  }

  spawn(command: string, args: string[]): Promise<void> {
    return Promise.resolve()
  }
}

// ============================================================================
// MOCK WORKFLOW CONTEXT WITH CAPABILITIES
// ============================================================================

/**
 * Expected WorkflowContext interface with capabilities extension
 */
interface WorkflowContextWithCapabilities {
  // Original workflow context methods
  send(event: string, data: unknown): void
  try<T>(action: string, data: unknown): Promise<T>
  do<T>(action: string, data: unknown): Promise<T>
  on: unknown
  every: unknown
  branch(name: string): Promise<void>
  checkout(ref: string): Promise<void>
  merge(branch: string): Promise<void>
  log(message: string, data?: unknown): void
  state: Record<string, unknown>

  // Capability registry
  capabilities: CapabilityRegistry

  // Dynamic capability access
  fs: MockFsCapability
  git: MockGitCapability
  bash: MockBashCapability
  [key: string]: unknown
}

// ============================================================================
// TESTS
// ============================================================================

describe('Capability Lazy Loading', () => {
  let registry: CapabilityRegistry

  beforeEach(() => {
    resetTracker()
    registry = new CapabilityRegistry()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // 1. LAZY LOADING - Modules NOT loaded until first access
  // ==========================================================================

  describe('Lazy Loading Behavior', () => {
    it('capability modules are NOT loaded during registry construction', () => {
      // Create registry and register modules
      const reg = new CapabilityRegistry()
      reg.register('fs', MockFsCapability)
      reg.register('git', MockGitCapability)
      reg.register('bash', MockBashCapability)

      // Capabilities should NOT be loaded yet
      expect(moduleLoadTracker.fs.loadCount).toBe(0)
      expect(moduleLoadTracker.git.loadCount).toBe(0)
      expect(moduleLoadTracker.bash.loadCount).toBe(0)
    })

    it('$.fs module loads only on first property access', async () => {
      registry.register('fs', MockFsCapability)

      // Not loaded yet
      expect(moduleLoadTracker.fs.loadCount).toBe(0)

      // Access via proxy
      const proxy = createCapabilityProxy(registry)
      const fs = proxy.fs

      // Now it should be loaded
      expect(moduleLoadTracker.fs.loadCount).toBe(1)
    })

    it('$.git module loads only on first property access', async () => {
      registry.register('git', MockGitCapability)

      expect(moduleLoadTracker.git.loadCount).toBe(0)

      const proxy = createCapabilityProxy(registry)
      const git = proxy.git

      expect(moduleLoadTracker.git.loadCount).toBe(1)
    })

    it('$.bash module loads only on first property access', async () => {
      registry.register('bash', MockBashCapability)

      expect(moduleLoadTracker.bash.loadCount).toBe(0)

      const proxy = createCapabilityProxy(registry)
      const bash = proxy.bash

      expect(moduleLoadTracker.bash.loadCount).toBe(1)
    })

    it('accessing one capability does not load others', async () => {
      registry.register('fs', MockFsCapability)
      registry.register('git', MockGitCapability)
      registry.register('bash', MockBashCapability)

      const proxy = createCapabilityProxy(registry)

      // Access only fs
      const fs = proxy.fs

      // Only fs should be loaded
      expect(moduleLoadTracker.fs.loadCount).toBe(1)
      expect(moduleLoadTracker.git.loadCount).toBe(0)
      expect(moduleLoadTracker.bash.loadCount).toBe(0)
    })
  })

  // ==========================================================================
  // 2. CACHING - Modules cached after first load (singleton per registry)
  // ==========================================================================

  describe('Module Caching (Singleton per Registry)', () => {
    it('module is cached after first load', async () => {
      registry.register('fs', MockFsCapability)

      const proxy = createCapabilityProxy(registry)

      // First access
      const fs1 = proxy.fs
      expect(moduleLoadTracker.fs.loadCount).toBe(1)

      // Second access - should return cached instance
      const fs2 = proxy.fs
      expect(moduleLoadTracker.fs.loadCount).toBe(1) // Still 1, not 2

      // Should be same instance
      expect(fs1).toBe(fs2)
    })

    it('multiple accesses return same instance', async () => {
      registry.register('git', MockGitCapability)

      const proxy = createCapabilityProxy(registry)

      const git1 = proxy.git
      const git2 = proxy.git
      const git3 = proxy.git

      expect(moduleLoadTracker.git.loadCount).toBe(1)
      expect(git1).toBe(git2)
      expect(git2).toBe(git3)
    })

    it('different registries have separate cached instances', async () => {
      const registry1 = new CapabilityRegistry()
      const registry2 = new CapabilityRegistry()

      registry1.register('fs', MockFsCapability)
      registry2.register('fs', MockFsCapability)

      const proxy1 = createCapabilityProxy(registry1)
      const proxy2 = createCapabilityProxy(registry2)

      const fs1 = proxy1.fs
      const fs2 = proxy2.fs

      // Each registry should load its own instance
      expect(moduleLoadTracker.fs.loadCount).toBe(2)

      // Instances should be different
      expect(fs1).not.toBe(fs2)
    })

    it('caching persists across method calls', async () => {
      registry.register('fs', MockFsCapability)

      const proxy = createCapabilityProxy(registry)

      // Call method multiple times
      await proxy.fs.readFile('/test1')
      await proxy.fs.readFile('/test2')
      await proxy.fs.writeFile('/test3', 'content')

      // Module should only be loaded once
      expect(moduleLoadTracker.fs.loadCount).toBe(1)
    })
  })

  // ==========================================================================
  // 3. PROXY BEHAVIOR - Capabilities proxied correctly
  // ==========================================================================

  describe('Capability Proxy Behavior', () => {
    it('$.fs methods are accessible', async () => {
      registry.register('fs', MockFsCapability)

      const proxy = createCapabilityProxy(registry)

      const result = await proxy.fs.readFile('/test.txt')
      expect(result).toBe('contents of /test.txt')
    })

    it('$.git methods are accessible', async () => {
      registry.register('git', MockGitCapability)

      const proxy = createCapabilityProxy(registry)

      const status = await proxy.git.status()
      expect(status).toBe('clean')

      const hash = await proxy.git.commit('test commit')
      expect(hash).toBe('abc123')
    })

    it('$.bash methods are accessible', async () => {
      registry.register('bash', MockBashCapability)

      const proxy = createCapabilityProxy(registry)

      const result = await proxy.bash.exec('ls -la')
      expect(result).toEqual({ stdout: '', stderr: '', exitCode: 0 })
    })

    it('capability names are listable', async () => {
      registry.register('fs', MockFsCapability)
      registry.register('git', MockGitCapability)

      const registeredCapabilities = registry.list()

      expect(registeredCapabilities).toContain('fs')
      expect(registeredCapabilities).toContain('git')
    })

    it('capability methods preserve this context', async () => {
      // Create a capability with instance state
      class StatefulCapability {
        private counter = 0

        increment() {
          return ++this.counter
        }

        getCount() {
          return this.counter
        }
      }

      registry.register('stateful', StatefulCapability)

      const proxy = createCapabilityProxy(registry)

      proxy.stateful.increment()
      proxy.stateful.increment()
      const count = proxy.stateful.getCount()

      expect(count).toBe(2)
    })
  })

  // ==========================================================================
  // 4. ERROR HANDLING - Accessing unavailable capability
  // ==========================================================================

  describe('Error Handling', () => {
    it('throws CapabilityError when accessing unregistered capability', () => {
      const proxy = createCapabilityProxy(registry)

      expect(() => proxy.fs).toThrow(CapabilityError)
    })

    it('error includes capability name', () => {
      const proxy = createCapabilityProxy(registry)

      expect(() => proxy.unknownCapability).toThrow(/unknownCapability/i)
    })

    it('error is of type CapabilityError', () => {
      const proxy = createCapabilityProxy(registry)

      try {
        const _ = proxy.missingCapability
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(CapabilityError)
        expect((error as Error).name).toBe('CapabilityError')
      }
    })

    it('error message is descriptive', () => {
      const proxy = createCapabilityProxy(registry)

      expect(() => proxy.foo).toThrow(
        /capability.*foo.*not registered|no.*capability.*named.*foo/i,
      )
    })

    it('error includes available capabilities in message', () => {
      registry.register('fs', MockFsCapability)
      registry.register('git', MockGitCapability)

      const proxy = createCapabilityProxy(registry)

      try {
        const _ = proxy.bash
        expect.fail('Should have thrown')
      } catch (error) {
        const message = (error as Error).message
        // Error should mention available capabilities
        expect(message).toMatch(/available.*fs.*git|registered.*fs.*git/i)
      }
    })

    it('does not throw for reserved property names', () => {
      const proxy = createCapabilityProxy(registry, {
        reservedNames: ['capabilities', 'send', 'try', 'do', 'on', 'every'],
      })

      // These are reserved names, not capabilities - should return undefined
      expect(() => proxy.capabilities).not.toThrow()
    })
  })

  // ==========================================================================
  // 5. MODULE REGISTRATION - External package registration
  // ==========================================================================

  describe('Module Registration', () => {
    it('can register capability from external package', () => {
      // Simulate external package registering capability
      class ExternalCapability {
        doSomething() {
          return 'done'
        }
      }

      registry.register('external', ExternalCapability)

      expect(registry.has('external')).toBe(true)
    })

    it('registered capability is available via proxy', async () => {
      class CustomCapability {
        greet(name: string) {
          return `Hello, ${name}!`
        }
      }

      registry.register('custom', CustomCapability)

      const proxy = createCapabilityProxy(registry)

      const result = proxy.custom.greet('World')
      expect(result).toBe('Hello, World!')
    })

    it('cannot register duplicate capability name', () => {
      registry.register('fs', MockFsCapability)

      expect(() => {
        registry.register('fs', MockGitCapability)
      }).toThrow(/already registered|duplicate/i)
    })

    it('can force re-register with force option', () => {
      registry.register('test', MockFsCapability)

      // Force re-registration
      registry.register('test', MockGitCapability, { force: true })

      expect(registry.has('test')).toBe(true)
    })

    it('can unregister capability', () => {
      registry.register('temp', MockFsCapability)
      expect(registry.has('temp')).toBe(true)

      registry.unregister('temp')
      expect(registry.has('temp')).toBe(false)
    })

    it('unregistering clears cached instance', () => {
      registry.register('fs', MockFsCapability)

      const proxy = createCapabilityProxy(registry)

      // Load the capability
      const fs1 = proxy.fs
      expect(moduleLoadTracker.fs.loadCount).toBe(1)

      // Unregister
      registry.unregister('fs')

      // Re-register
      registry.register('fs', MockFsCapability)

      // Access again - should create new instance
      const fs2 = proxy.fs
      expect(moduleLoadTracker.fs.loadCount).toBe(2)
      expect(fs1).not.toBe(fs2)
    })
  })

  // ==========================================================================
  // 6. MODULE LOADER VERIFICATION - Loader called only once
  // ==========================================================================

  describe('Module Loader Verification', () => {
    it('module constructor called exactly once per capability', async () => {
      registry.register('fs', MockFsCapability)

      const proxy = createCapabilityProxy(registry)

      // Access multiple times and call multiple methods
      await proxy.fs.readFile('/a')
      await proxy.fs.writeFile('/b', 'content')
      await proxy.fs.exists('/c')
      const _ = proxy.fs
      const __ = proxy.fs

      expect(moduleLoadTracker.fs.loadCount).toBe(1)
    })

    it('loader receives context when instantiating with passContext option', async () => {
      let receivedContext: unknown = null

      class ContextAwareCapability {
        constructor(ctx?: { registry: CapabilityRegistry }) {
          receivedContext = ctx
        }

        test() {
          return 'ok'
        }
      }

      registry.register('contextAware', ContextAwareCapability, {
        passContext: true,
      })

      const proxy = createCapabilityProxy(registry)

      // Access to trigger instantiation
      proxy.contextAware.test()

      expect(receivedContext).toBeDefined()
      expect((receivedContext as { registry: CapabilityRegistry }).registry).toBe(registry)
    })

    it('async factory function supported for module creation', async () => {
      let factoryCalled = false

      const asyncFactory: CapabilityFactory = async () => {
        factoryCalled = true
        return new MockFsCapability()
      }

      registry.registerFactory('asyncFs', asyncFactory)

      expect(factoryCalled).toBe(false)

      const proxy = createCapabilityProxy(registry)

      // Access triggers factory
      await proxy.asyncFs.readFile('/test')

      expect(factoryCalled).toBe(true)
    })
  })

  // ==========================================================================
  // 7. CLEANUP ON DESTROY - Unloading/cleanup on registry destroy
  // ==========================================================================

  describe('Cleanup on Destroy', () => {
    it('capability dispose method called on destroy', async () => {
      let disposed = false

      class DisposableCapability {
        dispose() {
          disposed = true
        }

        doWork() {
          return 'working'
        }
      }

      registry.register('disposable', DisposableCapability)

      const proxy = createCapabilityProxy(registry)

      // Load the capability
      proxy.disposable.doWork()

      // Destroy registry
      await registry.destroy()

      expect(disposed).toBe(true)
    })

    it('Symbol.dispose supported for cleanup', async () => {
      let symbolDisposeCalled = false

      class SymbolDisposableCapability {
        [Symbol.dispose]() {
          symbolDisposeCalled = true
        }

        doWork() {
          return 'working'
        }
      }

      registry.register('symbolDisposable', SymbolDisposableCapability)

      const proxy = createCapabilityProxy(registry)

      proxy.symbolDisposable.doWork()

      await registry.destroy()

      expect(symbolDisposeCalled).toBe(true)
    })

    it('all loaded capabilities cleaned up on destroy', async () => {
      const disposedCapabilities: string[] = []

      class TrackingCapability1 {
        dispose() {
          disposedCapabilities.push('cap1')
        }
        work() {}
      }

      class TrackingCapability2 {
        dispose() {
          disposedCapabilities.push('cap2')
        }
        work() {}
      }

      class TrackingCapability3 {
        dispose() {
          disposedCapabilities.push('cap3')
        }
        work() {}
      }

      registry.register('cap1', TrackingCapability1)
      registry.register('cap2', TrackingCapability2)
      registry.register('cap3', TrackingCapability3)

      const proxy = createCapabilityProxy(registry)

      // Load only cap1 and cap2 (not cap3)
      proxy.cap1.work()
      proxy.cap2.work()

      await registry.destroy()

      // Only loaded capabilities should be disposed
      expect(disposedCapabilities).toContain('cap1')
      expect(disposedCapabilities).toContain('cap2')
      expect(disposedCapabilities).not.toContain('cap3')
    })

    it('cached instances cleared after destroy', async () => {
      registry.register('fs', MockFsCapability)

      const proxy = createCapabilityProxy(registry)

      // Load capability
      const fs1 = proxy.fs
      expect(moduleLoadTracker.fs.loadCount).toBe(1)

      // Destroy
      await registry.destroy()

      // Verify cache is cleared
      expect(registry.isLoaded('fs')).toBe(false)
    })

    it('cleanup errors do not prevent other cleanups', async () => {
      const cleanupResults: string[] = []

      class FailingCapability {
        dispose() {
          cleanupResults.push('failing-start')
          throw new Error('Cleanup failed!')
        }
        work() {}
      }

      class SuccessCapability {
        dispose() {
          cleanupResults.push('success')
        }
        work() {}
      }

      registry.register('failing', FailingCapability)
      registry.register('success', SuccessCapability)

      const proxy = createCapabilityProxy(registry)

      proxy.failing.work()
      proxy.success.work()

      // Should not throw, but continue cleanup
      await registry.destroy()

      // Both should have attempted cleanup
      expect(cleanupResults).toContain('failing-start')
      expect(cleanupResults).toContain('success')
    })

    it('destroy returns cleanup results/errors', async () => {
      class FailingCapability {
        dispose() {
          throw new Error('Intentional failure')
        }
        work() {}
      }

      registry.register('failing', FailingCapability)

      const proxy = createCapabilityProxy(registry)
      proxy.failing.work()

      const result: DestroyResult = await registry.destroy()

      expect(result.errors).toBeDefined()
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0].capability).toBe('failing')
    })
  })

  // ==========================================================================
  // INTEGRATION: Combined behavior tests
  // ==========================================================================

  describe('Integration', () => {
    it('full workflow: register, access, use, cleanup', async () => {
      // Register
      registry.register('fs', MockFsCapability)
      registry.register('git', MockGitCapability)

      expect(moduleLoadTracker.fs.loadCount).toBe(0)
      expect(moduleLoadTracker.git.loadCount).toBe(0)

      const proxy = createCapabilityProxy(registry)

      // Access fs only
      const content = await proxy.fs.readFile('/readme.md')
      expect(content).toBe('contents of /readme.md')
      expect(moduleLoadTracker.fs.loadCount).toBe(1)
      expect(moduleLoadTracker.git.loadCount).toBe(0)

      // Access git
      const status = await proxy.git.status()
      expect(status).toBe('clean')
      expect(moduleLoadTracker.git.loadCount).toBe(1)

      // Multiple accesses - still singleton
      await proxy.fs.writeFile('/test', 'data')
      await proxy.git.commit('test')
      expect(moduleLoadTracker.fs.loadCount).toBe(1)
      expect(moduleLoadTracker.git.loadCount).toBe(1)

      // Cleanup
      await registry.destroy()

      // Cache cleared
      expect(registry.isLoaded('fs')).toBe(false)
      expect(registry.isLoaded('git')).toBe(false)
    })
  })
})
