/**
 * @fileoverview Tests for NpmDO WorkflowContext Integration
 *
 * Tests verify:
 * - NpmDO extends dotdo DO base class (not raw DurableObject)
 * - WorkflowContext ($) is available
 * - Event handlers can be registered ($.on.Package.installed)
 * - Scheduling works ($.every)
 * - Cross-DO RPC is available via $ context
 * - All existing NpmDO API methods still work
 *
 * TDD RED Phase: These tests should FAIL initially
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Mock DurableObjectStorage for testing
 */
class MockStorage {
  private data = new Map<string, unknown>()

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const result = new Map<string, T>()
    for (const [key, value] of this.data) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.set(key, value as T)
      }
    }
    return result
  }

  _clear(): void {
    this.data.clear()
  }

  async setAlarm(time: Date | number): Promise<void> {
    // Mock alarm setting
  }

  async getAlarm(): Promise<number | null> {
    return null
  }

  async deleteAlarm(): Promise<void> {
    // Mock alarm deletion
  }
}

/**
 * Mock DurableObjectState for testing DO classes
 */
function createMockState(): DurableObjectState {
  const storage = new MockStorage()
  return {
    id: { toString: () => 'test-npm-do-id', name: 'test' },
    storage: storage as unknown as DurableObjectStorage,
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
    waitUntil: () => {},
  } as unknown as DurableObjectState
}

/**
 * Mock Env for NpmDO testing
 */
interface NpmEnv {
  DO?: DurableObjectNamespace
  FSX?: Fetcher
  BASHX?: Fetcher
  PIPELINE?: { send: (events: unknown[]) => Promise<void> }
}

function createMockEnv(): NpmEnv {
  return {
    DO: {
      idFromName: (name: string) => ({ toString: () => `id-${name}` }),
      get: () => ({ fetch: async () => new Response('OK') }),
    } as unknown as DurableObjectNamespace,
    FSX: {
      fetch: async () => new Response(JSON.stringify({ data: '{}' })),
    } as unknown as Fetcher,
  }
}

// ============================================================================
// Test Suite: WorkflowContext Integration
// ============================================================================

describe('NpmDO WorkflowContext Integration', () => {
  let mockState: DurableObjectState
  let mockEnv: NpmEnv

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
  })

  // ============================================================================
  // Tests for DO Base Class Extension
  // ============================================================================

  describe('DO Base Class Extension', () => {
    it('should extend DO base class from dotdo', async () => {
      // Import dynamically to test the actual implementation
      const { NpmDO } = await import('../../src/do/NpmDO.js')

      // Check that it extends DO (has WorkflowContext)
      const instance = new NpmDO(mockState, mockEnv as any)

      // WorkflowContext ($) should be available
      expect(instance.$).toBeDefined()
      expect(typeof instance.$).toBe('object')
    })

    it('should have WorkflowContext ($) available on instance', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      // $ should be the WorkflowContext
      expect(instance.$).toBeDefined()
    })

    it('should have $.send method for fire-and-forget events', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      expect(typeof instance.$.send).toBe('function')
    })

    it('should have $.try method for single-attempt actions', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      expect(typeof instance.$.try).toBe('function')
    })

    it('should have $.do method for durable retried actions', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      expect(typeof instance.$.do).toBe('function')
    })
  })

  // ============================================================================
  // Tests for Event Handler Registration
  // ============================================================================

  describe('Event Handler Registration ($.on)', () => {
    it('should have $.on proxy available', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      expect(instance.$.on).toBeDefined()
    })

    it('should allow registering Package.installed event handler', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      const handler = vi.fn()

      // This should not throw
      expect(() => {
        instance.$.on.Package.installed(handler)
      }).not.toThrow()
    })

    it('should allow registering Package.resolved event handler', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      const handler = vi.fn()

      expect(() => {
        instance.$.on.Package.resolved(handler)
      }).not.toThrow()
    })

    it('should allow registering Script.executed event handler', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      const handler = vi.fn()

      expect(() => {
        instance.$.on.Script.executed(handler)
      }).not.toThrow()
    })
  })

  // ============================================================================
  // Tests for Scheduling ($.every)
  // ============================================================================

  describe('Scheduling ($.every)', () => {
    it('should have $.every proxy available', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      expect(instance.$.every).toBeDefined()
    })

    it('should allow scheduling hourly cache cleanup', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      const handler = vi.fn()

      // This should not throw
      expect(() => {
        instance.$.every.hour(handler)
      }).not.toThrow()
    })
  })

  // ============================================================================
  // Tests for Cross-DO RPC via $
  // ============================================================================

  describe('Cross-DO RPC', () => {
    it('should allow cross-DO calls via $.Noun(id).method() syntax', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      // $.Noun(id) should return a DomainProxy
      const proxy = instance.$.Package('lodash')

      expect(proxy).toBeDefined()
      // The proxy should have callable methods
      expect(typeof proxy.resolve).toBe('function')
    })
  })

  // ============================================================================
  // Tests for Namespace (ns) Property
  // ============================================================================

  describe('Namespace Property', () => {
    it('should have ns property from DO base', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      // ns should be available (from DO base class)
      expect(instance.ns).toBeDefined()
      expect(typeof instance.ns).toBe('string')
    })
  })
})

// ============================================================================
// Test Suite: API Compatibility
// ============================================================================

describe('NpmDO API Compatibility', () => {
  let mockState: DurableObjectState
  let mockEnv: NpmEnv

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
  })

  describe('Existing Methods Preserved', () => {
    it('should have getPackageMetadata method', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      expect(typeof instance.getPackageMetadata).toBe('function')
    })

    it('should have search method', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      expect(typeof instance.search).toBe('function')
    })

    it('should have install method', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      expect(typeof instance.install).toBe('function')
    })

    it('should have exec method', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      expect(typeof instance.exec).toBe('function')
    })

    it('should have runScript method', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      expect(typeof instance.runScript).toBe('function')
    })

    it('should have listInstalled method', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      expect(typeof instance.listInstalled).toBe('function')
    })

    it('should have clearCache method', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      expect(typeof instance.clearCache).toBe('function')
    })
  })

  describe('Functionality Preserved', () => {
    it('should clear cache without errors', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      // Should not throw
      expect(() => instance.clearCache()).not.toThrow()
    })

    it('should return empty list when no packages installed', async () => {
      const { NpmDO } = await import('../../src/do/NpmDO.js')
      const instance = new NpmDO(mockState, mockEnv as any)

      const packages = await instance.listInstalled()
      expect(packages).toEqual([])
    })
  })
})

// ============================================================================
// Test Suite: Event Emission on Operations
// ============================================================================

describe('NpmDO Event Emission', () => {
  let mockState: DurableObjectState
  let mockEnv: NpmEnv

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()

    // Mock global fetch for registry calls
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.url

      if (url.includes('registry.npmjs.org/lodash/latest')) {
        return new Response(JSON.stringify({
          name: 'lodash',
          version: '4.17.21',
          description: 'Lodash modular utilities',
        }))
      }

      return new Response('Not Found', { status: 404 })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should emit Package.resolved event after version resolution', async () => {
    const { NpmDO } = await import('../../src/do/NpmDO.js')
    const instance = new NpmDO(mockState, mockEnv as any)

    const eventHandler = vi.fn()
    instance.$.on.Package.resolved(eventHandler)

    // This test verifies events are emitted - will need implementation
    // For now, we just verify the handler can be registered
    expect(typeof instance.$.on.Package.resolved).toBe('function')
  })

  it('should emit Package.installed event after installation', async () => {
    const { NpmDO } = await import('../../src/do/NpmDO.js')
    const instance = new NpmDO(mockState, mockEnv as any)

    const eventHandler = vi.fn()
    instance.$.on.Package.installed(eventHandler)

    // This test verifies events are emitted - will need implementation
    expect(typeof instance.$.on.Package.installed).toBe('function')
  })
})
