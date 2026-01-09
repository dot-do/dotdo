/**
 * Capability Modules Test Infrastructure
 *
 * Tests for capability module loading, lazy initialization, entry point exports,
 * RPC binding fallback behavior, and tree-shaking verification.
 *
 * This test file focuses on:
 * 1. Lazy loading behavior - capabilities not initialized until accessed
 * 2. Entry point exports - correct capabilities for each entry point
 * 3. RPC binding fallback - inline vs binding behavior
 * 4. Tree-shaking verification - unused capabilities not bundled
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// Import capability infrastructure
import {
  CapabilityRegistry,
  CapabilityError,
  createCapabilityProxy,
  type CapabilityModule,
  type CapabilityFactory,
} from '../capabilities'

// Project root for file inspection
const PROJECT_ROOT = join(__dirname, '../..')

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Track module instantiation for lazy loading verification
 */
interface ModuleLoadTracker {
  [key: string]: {
    loadCount: number
    instance: unknown
  }
}

/**
 * Create a fresh tracker for each test
 */
function createTracker(): ModuleLoadTracker {
  return {}
}

/**
 * Create a mock capability class that tracks instantiation
 */
function createTrackedCapability(name: string, tracker: ModuleLoadTracker) {
  return class TrackedCapability {
    constructor() {
      if (!tracker[name]) {
        tracker[name] = { loadCount: 0, instance: null }
      }
      tracker[name].loadCount++
      tracker[name].instance = this
    }

    testMethod() {
      return `${name} capability working`
    }
  }
}

// ============================================================================
// 1. LAZY LOADING TESTS
// ============================================================================

describe('Capability Module Lazy Loading', () => {
  let registry: CapabilityRegistry
  let tracker: ModuleLoadTracker

  beforeEach(() => {
    registry = new CapabilityRegistry()
    tracker = createTracker()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('module instantiation timing', () => {
    it('capabilities are NOT instantiated during registration', () => {
      const FsCapability = createTrackedCapability('fs', tracker)
      const GitCapability = createTrackedCapability('git', tracker)
      const BashCapability = createTrackedCapability('bash', tracker)

      registry.register('fs', FsCapability)
      registry.register('git', GitCapability)
      registry.register('bash', BashCapability)

      // None should be loaded yet
      expect(tracker.fs?.loadCount ?? 0).toBe(0)
      expect(tracker.git?.loadCount ?? 0).toBe(0)
      expect(tracker.bash?.loadCount ?? 0).toBe(0)
    })

    it('capability loads only on first proxy access', () => {
      const FsCapability = createTrackedCapability('fs', tracker)
      registry.register('fs', FsCapability)

      expect(tracker.fs?.loadCount ?? 0).toBe(0)

      const proxy = createCapabilityProxy(registry)
      const fs = proxy.fs

      expect(tracker.fs.loadCount).toBe(1)
      expect(fs).toBeDefined()
    })

    it('accessing one capability does not load others', () => {
      registry.register('fs', createTrackedCapability('fs', tracker))
      registry.register('git', createTrackedCapability('git', tracker))
      registry.register('bash', createTrackedCapability('bash', tracker))

      const proxy = createCapabilityProxy(registry)

      // Access only fs
      const _ = proxy.fs

      expect(tracker.fs.loadCount).toBe(1)
      expect(tracker.git?.loadCount ?? 0).toBe(0)
      expect(tracker.bash?.loadCount ?? 0).toBe(0)
    })

    it('subsequent accesses return cached instance (no re-instantiation)', () => {
      registry.register('fs', createTrackedCapability('fs', tracker))

      const proxy = createCapabilityProxy(registry)

      const fs1 = proxy.fs
      const fs2 = proxy.fs
      const fs3 = proxy.fs

      // Only loaded once
      expect(tracker.fs.loadCount).toBe(1)

      // Same instance returned
      expect(fs1).toBe(fs2)
      expect(fs2).toBe(fs3)
    })

    it('method calls preserve cached instance', () => {
      registry.register('fs', createTrackedCapability('fs', tracker))

      const proxy = createCapabilityProxy(registry)

      // Multiple method calls
      ;(proxy.fs as { testMethod: () => string }).testMethod()
      ;(proxy.fs as { testMethod: () => string }).testMethod()
      ;(proxy.fs as { testMethod: () => string }).testMethod()

      // Still only one instantiation
      expect(tracker.fs.loadCount).toBe(1)
    })
  })

  describe('registry isolation', () => {
    it('separate registries have separate instances', () => {
      const registry1 = new CapabilityRegistry()
      const registry2 = new CapabilityRegistry()

      registry1.register('fs', createTrackedCapability('fs', tracker))
      registry2.register('fs', createTrackedCapability('fs', tracker))

      const proxy1 = createCapabilityProxy(registry1)
      const proxy2 = createCapabilityProxy(registry2)

      const fs1 = proxy1.fs
      const fs2 = proxy2.fs

      // Each registry loads its own instance
      expect(tracker.fs.loadCount).toBe(2)
      expect(fs1).not.toBe(fs2)
    })
  })

  describe('capability registration API', () => {
    it('registry.has() does not trigger loading', () => {
      registry.register('fs', createTrackedCapability('fs', tracker))

      const hasFs = registry.has('fs')
      const hasGit = registry.has('git')

      expect(hasFs).toBe(true)
      expect(hasGit).toBe(false)
      expect(tracker.fs?.loadCount ?? 0).toBe(0)
    })

    it('registry.list() does not trigger loading', () => {
      registry.register('fs', createTrackedCapability('fs', tracker))
      registry.register('git', createTrackedCapability('git', tracker))

      const capabilities = registry.list()

      expect(capabilities).toContain('fs')
      expect(capabilities).toContain('git')
      expect(tracker.fs?.loadCount ?? 0).toBe(0)
      expect(tracker.git?.loadCount ?? 0).toBe(0)
    })

    it('registry.isLoaded() reports correct state', () => {
      registry.register('fs', createTrackedCapability('fs', tracker))

      expect(registry.isLoaded('fs')).toBe(false)

      const proxy = createCapabilityProxy(registry)
      const _ = proxy.fs

      expect(registry.isLoaded('fs')).toBe(true)
    })
  })
})

// ============================================================================
// 2. ENTRY POINT EXPORT TESTS
// ============================================================================

describe('Entry Point Capability Exports', () => {
  describe('package.json exports configuration', () => {
    const packageJsonPath = join(PROJECT_ROOT, 'package.json')
    let pkg: Record<string, unknown>

    beforeEach(() => {
      pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
    })

    it('defines all expected entry point exports', () => {
      const exports = pkg.exports as Record<string, string>

      expect(exports['.']).toBe('./index.ts')
      expect(exports['./tiny']).toBe('./tiny.ts')
      expect(exports['./fs']).toBe('./fs.ts')
      expect(exports['./git']).toBe('./git.ts')
      expect(exports['./bash']).toBe('./bash.ts')
      expect(exports['./full']).toBe('./full.ts')
    })
  })

  describe('entry point files', () => {
    it('all entry point files exist', () => {
      expect(existsSync(join(PROJECT_ROOT, 'index.ts'))).toBe(true)
      expect(existsSync(join(PROJECT_ROOT, 'tiny.ts'))).toBe(true)
      expect(existsSync(join(PROJECT_ROOT, 'fs.ts'))).toBe(true)
      expect(existsSync(join(PROJECT_ROOT, 'git.ts'))).toBe(true)
      expect(existsSync(join(PROJECT_ROOT, 'bash.ts'))).toBe(true)
      expect(existsSync(join(PROJECT_ROOT, 'full.ts'))).toBe(true)
    })
  })

  // NOTE: Dynamic import tests for DO classes are in api/tests/entry-points.test.ts
  // which runs in the 'node' workspace with cloudflare:workers mock configured.
  // Here we verify entry point structure through static analysis.

  describe('dotdo/tiny structure', () => {
    it('exports DO from objects/DO', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'tiny.ts'), 'utf-8')
      expect(content).toMatch(/export\s+\{\s*DO\s*\}\s+from\s+['"]\.\/objects\/DO['"]/)
    })

    it('exports empty capabilities array', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'tiny.ts'), 'utf-8')
      expect(content).toMatch(/export\s+const\s+capabilities.*\[\s*\]/)
    })
  })

  describe('dotdo/fs structure', () => {
    it('applies withFs mixin to DO', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'fs.ts'), 'utf-8')
      expect(content).toMatch(/withFs/)
    })

    it('exports capabilities with fs', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'fs.ts'), 'utf-8')
      expect(content).toMatch(/capabilities.*['"]fs['"]/)
    })

    it('exports withFs mixin', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'fs.ts'), 'utf-8')
      expect(content).toMatch(/export\s+\{[^}]*withFs[^}]*\}/)
    })
  })

  describe('dotdo/git structure', () => {
    it('applies withGit and withFs mixins', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'git.ts'), 'utf-8')
      expect(content).toMatch(/withGit/)
      expect(content).toMatch(/withFs/)
    })

    it('exports capabilities with fs and git', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'git.ts'), 'utf-8')
      expect(content).toMatch(/capabilities/)
      expect(content).toMatch(/['"]fs['"]/)
      expect(content).toMatch(/['"]git['"]/)
    })

    it('exports withGit mixin', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'git.ts'), 'utf-8')
      expect(content).toMatch(/export\s+\{[^}]*withGit[^}]*\}/)
    })
  })

  describe('dotdo/bash structure', () => {
    it('applies withBash and withFs mixins', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'bash.ts'), 'utf-8')
      expect(content).toMatch(/withBash/)
      expect(content).toMatch(/withFs/)
    })

    it('exports capabilities with fs and bash', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'bash.ts'), 'utf-8')
      expect(content).toMatch(/capabilities/)
      expect(content).toMatch(/['"]fs['"]/)
      expect(content).toMatch(/['"]bash['"]/)
    })

    it('exports withBash mixin', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'bash.ts'), 'utf-8')
      expect(content).toMatch(/export\s+\{[^}]*withBash[^}]*\}/)
    })
  })

  describe('dotdo/full structure', () => {
    it('applies all three mixins', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'full.ts'), 'utf-8')
      expect(content).toMatch(/withFs/)
      expect(content).toMatch(/withGit/)
      expect(content).toMatch(/withBash/)
    })

    it('exports capabilities with all three', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'full.ts'), 'utf-8')
      expect(content).toMatch(/capabilities/)
      expect(content).toMatch(/['"]fs['"]/)
      expect(content).toMatch(/['"]git['"]/)
      expect(content).toMatch(/['"]bash['"]/)
    })

    it('exports all mixins', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'full.ts'), 'utf-8')
      expect(content).toMatch(/export\s+\{[^}]*withFs[^}]*\}/)
      expect(content).toMatch(/export\s+\{[^}]*withGit[^}]*\}/)
      expect(content).toMatch(/export\s+\{[^}]*withBash[^}]*\}/)
    })
  })

  describe('dotdo (default) structure', () => {
    it('re-exports from full.ts', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'index.ts'), 'utf-8')
      expect(content).toMatch(/from\s+['"]\.\/full['"]/)
    })

    it('exports DO and capabilities from full', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'index.ts'), 'utf-8')
      expect(content).toMatch(/export\s+\{[^}]*DO[^}]*\}.*from\s+['"]\.\/full['"]/)
      expect(content).toMatch(/export\s+\{[^}]*capabilities[^}]*\}.*from\s+['"]\.\/full['"]/)
    })
  })
})

// ============================================================================
// 3. RPC BINDING FALLBACK TESTS
// ============================================================================

describe('RPC Binding Fallback Behavior', () => {
  let registry: CapabilityRegistry

  beforeEach(() => {
    registry = new CapabilityRegistry()
  })

  describe('inline capability (no binding)', () => {
    it('uses inline implementation when no binding configured', () => {
      class InlineCapability {
        source = 'inline'
        execute() {
          return 'inline execution'
        }
      }

      registry.register('test', InlineCapability)
      const proxy = createCapabilityProxy(registry)

      const cap = proxy.test as { source: string; execute: () => string }
      expect(cap.source).toBe('inline')
      expect(cap.execute()).toBe('inline execution')
    })
  })

  describe('factory-based capabilities', () => {
    it('supports async factory for deferred loading', async () => {
      let factoryExecuted = false

      const asyncFactory: CapabilityFactory = async () => {
        factoryExecuted = true
        return {
          source: 'async-factory',
          getValue: () => 'factory value',
        }
      }

      registry.registerFactory('async', asyncFactory)

      expect(factoryExecuted).toBe(false)

      const proxy = createCapabilityProxy(registry)

      // Access triggers factory
      const result = await (proxy.async as { getValue: () => Promise<string> }).getValue()

      expect(factoryExecuted).toBe(true)
      expect(result).toBe('factory value')
    })

    it('factory with passContext receives registry context', () => {
      let receivedContext: unknown = null

      class ContextAwareCapability {
        constructor(ctx?: { registry: CapabilityRegistry }) {
          receivedContext = ctx
        }

        getInfo() {
          return 'context-aware'
        }
      }

      registry.register('contextAware', ContextAwareCapability, {
        passContext: true,
      })

      const proxy = createCapabilityProxy(registry)
      ;(proxy.contextAware as { getInfo: () => string }).getInfo()

      expect(receivedContext).toBeDefined()
      expect((receivedContext as { registry: CapabilityRegistry }).registry).toBe(registry)
    })
  })

  describe('binding detection pattern', () => {
    it('capability can be configured to check for binding presence', () => {
      interface BindingConfig {
        bindingName?: string
        useBinding?: boolean
      }

      class ConfigurableCapability {
        private config: BindingConfig

        constructor(config: BindingConfig = {}) {
          this.config = config
        }

        get isUsingBinding(): boolean {
          return Boolean(this.config.useBinding && this.config.bindingName)
        }

        get source(): string {
          return this.isUsingBinding ? 'rpc-binding' : 'inline'
        }
      }

      // Without binding
      const inlineInstance = new ConfigurableCapability()
      expect(inlineInstance.source).toBe('inline')

      // With binding configured
      const bindingInstance = new ConfigurableCapability({
        bindingName: 'FS_SERVICE',
        useBinding: true,
      })
      expect(bindingInstance.source).toBe('rpc-binding')
    })
  })

  describe('fallback chain', () => {
    it('capability can implement fallback pattern', async () => {
      class FallbackCapability {
        private primaryAvailable: boolean

        constructor(primaryAvailable: boolean = false) {
          this.primaryAvailable = primaryAvailable
        }

        async execute(): Promise<{ source: string; result: string }> {
          if (this.primaryAvailable) {
            return { source: 'rpc-binding', result: 'primary result' }
          }
          // Fallback to inline
          return { source: 'inline-fallback', result: 'fallback result' }
        }
      }

      // Test with primary unavailable (simulates missing binding)
      const withFallback = new FallbackCapability(false)
      const fallbackResult = await withFallback.execute()

      expect(fallbackResult.source).toBe('inline-fallback')
      expect(fallbackResult.result).toBe('fallback result')

      // Test with primary available (simulates available binding)
      const withPrimary = new FallbackCapability(true)
      const primaryResult = await withPrimary.execute()

      expect(primaryResult.source).toBe('rpc-binding')
      expect(primaryResult.result).toBe('primary result')
    })
  })
})

// ============================================================================
// 4. TREE-SHAKING VERIFICATION TESTS
// ============================================================================

describe('Tree-Shaking Verification', () => {
  describe('entry point import isolation', () => {
    it('tiny.ts does not import capability-related packages', () => {
      const tinyContent = readFileSync(join(PROJECT_ROOT, 'tiny.ts'), 'utf-8')

      // Should not import capability mixins or external capability packages
      expect(tinyContent).not.toMatch(/from ['"]\.\/objects\/mixins['"]/)
      expect(tinyContent).not.toMatch(/withFs|withGit|withBash/)
    })

    it('fs.ts does not import git or bash capabilities', () => {
      const fsContent = readFileSync(join(PROJECT_ROOT, 'fs.ts'), 'utf-8')

      expect(fsContent).not.toMatch(/withGit/)
      expect(fsContent).not.toMatch(/withBash/)
      expect(fsContent).not.toMatch(/GitCapability/)
      expect(fsContent).not.toMatch(/BashCapability/)
    })

    it('git.ts does not import bash capabilities', () => {
      const gitContent = readFileSync(join(PROJECT_ROOT, 'git.ts'), 'utf-8')

      expect(gitContent).not.toMatch(/withBash/)
      expect(gitContent).not.toMatch(/BashCapability/)
    })

    it('bash.ts does not import git capabilities', () => {
      const bashContent = readFileSync(join(PROJECT_ROOT, 'bash.ts'), 'utf-8')

      expect(bashContent).not.toMatch(/withGit/)
      expect(bashContent).not.toMatch(/GitCapability/)
    })
  })

  describe('mixin composition pattern', () => {
    it('mixin files exist and are independently structured', () => {
      // Each mixin should exist as a separate file
      expect(existsSync(join(PROJECT_ROOT, 'objects/mixins/fs.ts'))).toBe(true)
      expect(existsSync(join(PROJECT_ROOT, 'objects/mixins/git.ts'))).toBe(true)
      expect(existsSync(join(PROJECT_ROOT, 'objects/mixins/bash.ts'))).toBe(true)
    })

    it('mixin index exports all mixins', () => {
      const indexContent = readFileSync(join(PROJECT_ROOT, 'objects/mixins/index.ts'), 'utf-8')

      expect(indexContent).toMatch(/export.*withFs/)
      expect(indexContent).toMatch(/export.*withGit/)
      expect(indexContent).toMatch(/export.*withBash/)
    })

    it('mixin files have clean dependency chains', () => {
      // fs.ts should not import git.ts or bash.ts
      const fsMixinPath = join(PROJECT_ROOT, 'objects/mixins/fs.ts')
      const fsMixinContent = readFileSync(fsMixinPath, 'utf-8')

      expect(fsMixinContent).not.toMatch(/from ['"]\.\/git['"]/)
      expect(fsMixinContent).not.toMatch(/from ['"]\.\/bash['"]/)
    })

    it('each mixin file exports its mixin function', () => {
      const fsMixin = readFileSync(join(PROJECT_ROOT, 'objects/mixins/fs.ts'), 'utf-8')
      const gitMixin = readFileSync(join(PROJECT_ROOT, 'objects/mixins/git.ts'), 'utf-8')
      const bashMixin = readFileSync(join(PROJECT_ROOT, 'objects/mixins/bash.ts'), 'utf-8')

      expect(fsMixin).toMatch(/export\s+function\s+withFs/)
      expect(gitMixin).toMatch(/export\s+function\s+withGit/)
      expect(bashMixin).toMatch(/export\s+function\s+withBash/)
    })
  })

  describe('capability export verification (static analysis)', () => {
    it('tiny exports empty capabilities array', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'tiny.ts'), 'utf-8')
      // Match export const capabilities: string[] = [] or similar
      expect(content).toMatch(/capabilities.*\[\s*\]/)
    })

    it('fs exports capabilities with fs', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'fs.ts'), 'utf-8')
      expect(content).toMatch(/capabilities.*=.*\[.*['"]fs['"].*\]/)
    })

    it('git exports capabilities with fs and git', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'git.ts'), 'utf-8')
      expect(content).toMatch(/capabilities/)
      expect(content).toMatch(/['"]fs['"]/)
      expect(content).toMatch(/['"]git['"]/)
    })

    it('bash exports capabilities with fs and bash', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'bash.ts'), 'utf-8')
      expect(content).toMatch(/capabilities/)
      expect(content).toMatch(/['"]fs['"]/)
      expect(content).toMatch(/['"]bash['"]/)
    })

    it('full exports capabilities with all three', () => {
      const content = readFileSync(join(PROJECT_ROOT, 'full.ts'), 'utf-8')
      expect(content).toMatch(/capabilities/)
      expect(content).toMatch(/['"]fs['"]/)
      expect(content).toMatch(/['"]git['"]/)
      expect(content).toMatch(/['"]bash['"]/)
    })
  })
})

// ============================================================================
// 5. ERROR HANDLING TESTS
// ============================================================================

describe('Capability Error Handling', () => {
  let registry: CapabilityRegistry

  beforeEach(() => {
    registry = new CapabilityRegistry()
  })

  describe('accessing unregistered capabilities', () => {
    it('throws CapabilityError for unregistered capability', () => {
      const proxy = createCapabilityProxy(registry)

      expect(() => proxy.fs).toThrow(CapabilityError)
    })

    it('error message includes capability name', () => {
      const proxy = createCapabilityProxy(registry)

      expect(() => proxy.unknownCapability).toThrow(/unknownCapability/)
    })

    it('error includes list of available capabilities', () => {
      registry.register('fs', class MockFs {})
      registry.register('git', class MockGit {})

      const proxy = createCapabilityProxy(registry)

      try {
        const _ = proxy.bash
        expect.fail('Should have thrown')
      } catch (error) {
        const message = (error as Error).message
        expect(message).toMatch(/fs.*git|git.*fs/)
      }
    })
  })

  describe('reserved property names', () => {
    it('reserved names do not throw', () => {
      const proxy = createCapabilityProxy(registry, {
        reservedNames: ['send', 'try', 'do', 'on', 'every'],
      })

      // These should return undefined, not throw
      expect(() => proxy.send).not.toThrow()
      expect(() => proxy.try).not.toThrow()
      expect(() => proxy.do).not.toThrow()
      expect(proxy.send).toBeUndefined()
    })
  })

  describe('duplicate registration', () => {
    it('throws on duplicate registration without force', () => {
      registry.register('fs', class MockFs {})

      expect(() => {
        registry.register('fs', class AnotherFs {})
      }).toThrow(/already registered/)
    })

    it('allows re-registration with force option', () => {
      class FirstFs {
        version = 1
      }
      class SecondFs {
        version = 2
      }

      registry.register('fs', FirstFs)
      registry.register('fs', SecondFs, { force: true })

      const proxy = createCapabilityProxy(registry)
      const fs = proxy.fs as { version: number }

      expect(fs.version).toBe(2)
    })
  })
})

// ============================================================================
// 6. CLEANUP AND LIFECYCLE TESTS
// ============================================================================

describe('Capability Lifecycle and Cleanup', () => {
  let registry: CapabilityRegistry

  beforeEach(() => {
    registry = new CapabilityRegistry()
  })

  describe('unregistration', () => {
    it('unregister removes capability', () => {
      registry.register('fs', class MockFs {})
      expect(registry.has('fs')).toBe(true)

      registry.unregister('fs')
      expect(registry.has('fs')).toBe(false)
    })

    it('unregister clears cached instance', () => {
      const tracker = createTracker()
      registry.register('fs', createTrackedCapability('fs', tracker))

      const proxy = createCapabilityProxy(registry)

      // Load it
      const _ = proxy.fs
      expect(tracker.fs.loadCount).toBe(1)

      // Unregister and re-register
      registry.unregister('fs')
      registry.register('fs', createTrackedCapability('fs', tracker))

      // Access again - should create new instance
      const __ = proxy.fs
      expect(tracker.fs.loadCount).toBe(2)
    })
  })

  describe('destroy cleanup', () => {
    it('destroy calls dispose on loaded capabilities', async () => {
      let disposed = false

      class DisposableCapability {
        dispose() {
          disposed = true
        }
        work() {
          return 'working'
        }
      }

      registry.register('disposable', DisposableCapability)

      const proxy = createCapabilityProxy(registry)
      ;(proxy.disposable as { work: () => string }).work()

      await registry.destroy()

      expect(disposed).toBe(true)
    })

    it('destroy only cleans up loaded capabilities', async () => {
      const disposedList: string[] = []

      class Cap1 {
        dispose() {
          disposedList.push('cap1')
        }
        work() {}
      }

      class Cap2 {
        dispose() {
          disposedList.push('cap2')
        }
        work() {}
      }

      class Cap3 {
        dispose() {
          disposedList.push('cap3')
        }
        work() {}
      }

      registry.register('cap1', Cap1)
      registry.register('cap2', Cap2)
      registry.register('cap3', Cap3)

      const proxy = createCapabilityProxy(registry)

      // Only load cap1 and cap2
      ;(proxy.cap1 as { work: () => void }).work()
      ;(proxy.cap2 as { work: () => void }).work()

      await registry.destroy()

      expect(disposedList).toContain('cap1')
      expect(disposedList).toContain('cap2')
      expect(disposedList).not.toContain('cap3')
    })

    it('destroy clears all cached instances', async () => {
      registry.register('fs', class MockFs {})

      const proxy = createCapabilityProxy(registry)
      const _ = proxy.fs

      expect(registry.isLoaded('fs')).toBe(true)

      await registry.destroy()

      expect(registry.isLoaded('fs')).toBe(false)
    })

    it('cleanup errors are collected and returned', async () => {
      class FailingCapability {
        dispose() {
          throw new Error('Cleanup failed!')
        }
        work() {}
      }

      class SuccessCapability {
        disposed = false
        dispose() {
          this.disposed = true
        }
        work() {}
      }

      registry.register('failing', FailingCapability)
      registry.register('success', SuccessCapability)

      const proxy = createCapabilityProxy(registry)
      ;(proxy.failing as { work: () => void }).work()
      ;(proxy.success as { work: () => void }).work()

      const result = await registry.destroy()

      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0].capability).toBe('failing')
    })
  })
})
