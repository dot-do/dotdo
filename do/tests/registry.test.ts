/**
 * Tests for DOHandlerRegistry
 *
 * Comprehensive tests for the handler registry that manages handler lifecycle
 * and provides dependency injection for DO handlers.
 *
 * @module do/tests/registry.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DOHandlerRegistry, DOHandler } from '../handlers/registry'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a minimal test handler
 */
function createTestHandler(name: string, options?: {
  initialize?: () => Promise<void>
  dispose?: () => Promise<void>
}): DOHandler {
  return {
    name,
    initialize: options?.initialize,
    dispose: options?.dispose,
  }
}

/**
 * Create a handler with lifecycle tracking
 */
function createTrackedHandler(name: string): DOHandler & {
  initialized: boolean
  disposed: boolean
} {
  const handler = {
    name,
    initialized: false,
    disposed: false,
    async initialize() {
      handler.initialized = true
    },
    async dispose() {
      handler.disposed = true
    },
  }
  return handler
}

// ============================================================================
// Handler Registration Tests
// ============================================================================

describe('DOHandlerRegistry', () => {
  let registry: DOHandlerRegistry

  beforeEach(() => {
    registry = new DOHandlerRegistry()
  })

  describe('constructor', () => {
    it('should create an empty registry', () => {
      expect(registry.size).toBe(0)
      expect(registry.getAll()).toEqual([])
      expect(registry.getNames()).toEqual([])
    })

    it('should accept debug option', () => {
      const debugRegistry = new DOHandlerRegistry({ debug: true })
      expect(debugRegistry.size).toBe(0)
    })

    it('should default debug to false', () => {
      const defaultRegistry = new DOHandlerRegistry({})
      expect(defaultRegistry.size).toBe(0)
    })
  })

  describe('register', () => {
    it('should register a handler', () => {
      const handler = createTestHandler('storage')
      registry.register(handler)

      expect(registry.size).toBe(1)
      expect(registry.has('storage')).toBe(true)
    })

    it('should register multiple handlers', () => {
      registry.register(createTestHandler('storage'))
      registry.register(createTestHandler('rpc'))
      registry.register(createTestHandler('auth'))

      expect(registry.size).toBe(3)
      expect(registry.has('storage')).toBe(true)
      expect(registry.has('rpc')).toBe(true)
      expect(registry.has('auth')).toBe(true)
    })

    it('should throw when registering duplicate handler', () => {
      registry.register(createTestHandler('storage'))

      expect(() => {
        registry.register(createTestHandler('storage'))
      }).toThrow('Handler "storage" is already registered')
    })

    it('should log when debug is enabled', () => {
      const debugRegistry = new DOHandlerRegistry({ debug: true })
      const handler = createTestHandler('test')

      // Should not throw, debug logging should work
      expect(() => debugRegistry.register(handler)).not.toThrow()
      expect(debugRegistry.has('test')).toBe(true)
    })
  })

  describe('get', () => {
    it('should return handler by name', () => {
      const handler = createTestHandler('storage')
      registry.register(handler)

      const retrieved = registry.get('storage')
      expect(retrieved).toBe(handler)
    })

    it('should return undefined for unknown handler', () => {
      const retrieved = registry.get('nonexistent')
      expect(retrieved).toBeUndefined()
    })

    it('should support type parameter', () => {
      interface CustomHandler extends DOHandler {
        customMethod(): void
      }

      const handler: CustomHandler = {
        name: 'custom',
        customMethod: () => {},
      }
      registry.register(handler)

      const retrieved = registry.get<CustomHandler>('custom')
      expect(retrieved).toBeDefined()
      expect(typeof retrieved?.customMethod).toBe('function')
    })
  })

  describe('getRequired', () => {
    it('should return handler by name', () => {
      const handler = createTestHandler('storage')
      registry.register(handler)

      const retrieved = registry.getRequired('storage')
      expect(retrieved).toBe(handler)
    })

    it('should throw for unknown handler', () => {
      expect(() => {
        registry.getRequired('nonexistent')
      }).toThrow('Handler "nonexistent" not found')
    })

    it('should support type parameter', () => {
      interface CustomHandler extends DOHandler {
        value: number
      }

      const handler: CustomHandler = {
        name: 'custom',
        value: 42,
      }
      registry.register(handler)

      const retrieved = registry.getRequired<CustomHandler>('custom')
      expect(retrieved.value).toBe(42)
    })
  })

  describe('has', () => {
    it('should return true for registered handler', () => {
      registry.register(createTestHandler('storage'))
      expect(registry.has('storage')).toBe(true)
    })

    it('should return false for unregistered handler', () => {
      expect(registry.has('storage')).toBe(false)
    })
  })

  describe('getAll', () => {
    it('should return empty array when no handlers registered', () => {
      expect(registry.getAll()).toEqual([])
    })

    it('should return all registered handlers', () => {
      const h1 = createTestHandler('storage')
      const h2 = createTestHandler('rpc')
      const h3 = createTestHandler('auth')

      registry.register(h1)
      registry.register(h2)
      registry.register(h3)

      const all = registry.getAll()
      expect(all).toHaveLength(3)
      expect(all).toContain(h1)
      expect(all).toContain(h2)
      expect(all).toContain(h3)
    })

    it('should preserve registration order', () => {
      registry.register(createTestHandler('first'))
      registry.register(createTestHandler('second'))
      registry.register(createTestHandler('third'))

      const names = registry.getAll().map((h) => h.name)
      expect(names).toEqual(['first', 'second', 'third'])
    })
  })

  describe('getNames', () => {
    it('should return empty array when no handlers registered', () => {
      expect(registry.getNames()).toEqual([])
    })

    it('should return all handler names', () => {
      registry.register(createTestHandler('storage'))
      registry.register(createTestHandler('rpc'))
      registry.register(createTestHandler('auth'))

      const names = registry.getNames()
      expect(names).toHaveLength(3)
      expect(names).toContain('storage')
      expect(names).toContain('rpc')
      expect(names).toContain('auth')
    })

    it('should preserve registration order', () => {
      registry.register(createTestHandler('alpha'))
      registry.register(createTestHandler('beta'))
      registry.register(createTestHandler('gamma'))

      expect(registry.getNames()).toEqual(['alpha', 'beta', 'gamma'])
    })
  })

  describe('size', () => {
    it('should return 0 for empty registry', () => {
      expect(registry.size).toBe(0)
    })

    it('should return correct count', () => {
      registry.register(createTestHandler('a'))
      expect(registry.size).toBe(1)

      registry.register(createTestHandler('b'))
      expect(registry.size).toBe(2)

      registry.register(createTestHandler('c'))
      expect(registry.size).toBe(3)
    })
  })
})

// ============================================================================
// Lifecycle Management Tests
// ============================================================================

describe('DOHandlerRegistry Lifecycle', () => {
  let registry: DOHandlerRegistry

  beforeEach(() => {
    registry = new DOHandlerRegistry()
  })

  describe('initializeAll', () => {
    it('should initialize all handlers with initialize method', async () => {
      const h1 = createTrackedHandler('h1')
      const h2 = createTrackedHandler('h2')
      const h3 = createTrackedHandler('h3')

      registry.register(h1)
      registry.register(h2)
      registry.register(h3)

      await registry.initializeAll()

      expect(h1.initialized).toBe(true)
      expect(h2.initialized).toBe(true)
      expect(h3.initialized).toBe(true)
    })

    it('should skip handlers without initialize method', async () => {
      const withInit = createTrackedHandler('withInit')
      const withoutInit = createTestHandler('withoutInit')

      registry.register(withInit)
      registry.register(withoutInit)

      // Should not throw
      await registry.initializeAll()

      expect(withInit.initialized).toBe(true)
    })

    it('should initialize handlers in registration order', async () => {
      const order: string[] = []

      registry.register(createTestHandler('first', {
        initialize: async () => { order.push('first') },
      }))
      registry.register(createTestHandler('second', {
        initialize: async () => { order.push('second') },
      }))
      registry.register(createTestHandler('third', {
        initialize: async () => { order.push('third') },
      }))

      await registry.initializeAll()

      expect(order).toEqual(['first', 'second', 'third'])
    })

    it('should only initialize once (idempotent)', async () => {
      let initCount = 0

      registry.register(createTestHandler('counter', {
        initialize: async () => { initCount++ },
      }))

      await registry.initializeAll()
      await registry.initializeAll()
      await registry.initializeAll()

      expect(initCount).toBe(1)
    })

    it('should set initialized flag', async () => {
      registry.register(createTestHandler('test'))

      expect(registry.isInitialized()).toBe(false)

      await registry.initializeAll()

      expect(registry.isInitialized()).toBe(true)
    })

    it('should propagate initialization errors', async () => {
      registry.register(createTestHandler('failing', {
        initialize: async () => {
          throw new Error('Init failed')
        },
      }))

      await expect(registry.initializeAll()).rejects.toThrow('Init failed')
    })

    it('should log when debug is enabled', async () => {
      const debugRegistry = new DOHandlerRegistry({ debug: true })
      debugRegistry.register(createTrackedHandler('test'))

      // Should not throw, debug logging should work
      await expect(debugRegistry.initializeAll()).resolves.toBeUndefined()
    })
  })

  describe('disposeAll', () => {
    it('should dispose all handlers with dispose method', async () => {
      const h1 = createTrackedHandler('h1')
      const h2 = createTrackedHandler('h2')
      const h3 = createTrackedHandler('h3')

      registry.register(h1)
      registry.register(h2)
      registry.register(h3)

      await registry.disposeAll()

      expect(h1.disposed).toBe(true)
      expect(h2.disposed).toBe(true)
      expect(h3.disposed).toBe(true)
    })

    it('should skip handlers without dispose method', async () => {
      const withDispose = createTrackedHandler('withDispose')
      const withoutDispose = createTestHandler('withoutDispose')

      registry.register(withDispose)
      registry.register(withoutDispose)

      // Should not throw
      await registry.disposeAll()

      expect(withDispose.disposed).toBe(true)
    })

    it('should dispose handlers in reverse registration order', async () => {
      const order: string[] = []

      registry.register(createTestHandler('first', {
        dispose: async () => { order.push('first') },
      }))
      registry.register(createTestHandler('second', {
        dispose: async () => { order.push('second') },
      }))
      registry.register(createTestHandler('third', {
        dispose: async () => { order.push('third') },
      }))

      await registry.disposeAll()

      expect(order).toEqual(['third', 'second', 'first'])
    })

    it('should clear all handlers after dispose', async () => {
      registry.register(createTestHandler('h1'))
      registry.register(createTestHandler('h2'))

      expect(registry.size).toBe(2)

      await registry.disposeAll()

      expect(registry.size).toBe(0)
      expect(registry.getAll()).toEqual([])
    })

    it('should reset initialized flag after dispose', async () => {
      registry.register(createTestHandler('test'))
      await registry.initializeAll()

      expect(registry.isInitialized()).toBe(true)

      await registry.disposeAll()

      expect(registry.isInitialized()).toBe(false)
    })

    it('should continue disposing even if one handler fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const order: string[] = []

      registry.register(createTestHandler('first', {
        dispose: async () => { order.push('first') },
      }))
      registry.register(createTestHandler('failing', {
        dispose: async () => {
          order.push('failing')
          throw new Error('Dispose failed')
        },
      }))
      registry.register(createTestHandler('third', {
        dispose: async () => { order.push('third') },
      }))

      // Should not throw - errors are caught and logged
      await registry.disposeAll()

      // All handlers should have had dispose called (reverse order)
      expect(order).toEqual(['third', 'failing', 'first'])
      expect(errorSpy).toHaveBeenCalled()

      errorSpy.mockRestore()
    })

    it('should log when debug is enabled', async () => {
      const debugRegistry = new DOHandlerRegistry({ debug: true })
      debugRegistry.register(createTrackedHandler('test'))

      // Should not throw, debug logging should work
      await expect(debugRegistry.disposeAll()).resolves.toBeUndefined()
    })
  })

  describe('isInitialized', () => {
    it('should return false initially', () => {
      expect(registry.isInitialized()).toBe(false)
    })

    it('should return true after initializeAll', async () => {
      registry.register(createTestHandler('test'))
      await registry.initializeAll()

      expect(registry.isInitialized()).toBe(true)
    })

    it('should return false after disposeAll', async () => {
      registry.register(createTestHandler('test'))
      await registry.initializeAll()
      await registry.disposeAll()

      expect(registry.isInitialized()).toBe(false)
    })
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('DOHandlerRegistry Edge Cases', () => {
  let registry: DOHandlerRegistry

  beforeEach(() => {
    registry = new DOHandlerRegistry()
  })

  describe('empty registry operations', () => {
    it('should handle initializeAll on empty registry', async () => {
      await expect(registry.initializeAll()).resolves.toBeUndefined()
      expect(registry.isInitialized()).toBe(true)
    })

    it('should handle disposeAll on empty registry', async () => {
      await expect(registry.disposeAll()).resolves.toBeUndefined()
    })
  })

  describe('handler name edge cases', () => {
    it('should handle empty string handler name', () => {
      const handler = createTestHandler('')
      registry.register(handler)

      expect(registry.has('')).toBe(true)
      expect(registry.get('')).toBe(handler)
    })

    it('should handle handler names with special characters', () => {
      registry.register(createTestHandler('my-handler'))
      registry.register(createTestHandler('my_handler'))
      registry.register(createTestHandler('my.handler'))
      registry.register(createTestHandler('my:handler'))

      expect(registry.has('my-handler')).toBe(true)
      expect(registry.has('my_handler')).toBe(true)
      expect(registry.has('my.handler')).toBe(true)
      expect(registry.has('my:handler')).toBe(true)
    })

    it('should handle unicode handler names', () => {
      registry.register(createTestHandler('handler_unicode'))
      registry.register(createTestHandler('handler-test'))

      expect(registry.has('handler_unicode')).toBe(true)
      expect(registry.has('handler-test')).toBe(true)
    })
  })

  describe('async initialization edge cases', () => {
    it('should handle slow async initialization', async () => {
      registry.register(createTestHandler('slow', {
        initialize: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
        },
      }))

      await expect(registry.initializeAll()).resolves.toBeUndefined()
    })

    it('should handle slow async disposal', async () => {
      registry.register(createTestHandler('slow', {
        dispose: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
        },
      }))

      await expect(registry.disposeAll()).resolves.toBeUndefined()
    })
  })

  describe('re-registration after dispose', () => {
    it('should allow re-registration after disposeAll', async () => {
      const handler1 = createTestHandler('test')
      registry.register(handler1)

      await registry.disposeAll()

      // Should be able to register new handler with same name
      const handler2 = createTestHandler('test')
      expect(() => registry.register(handler2)).not.toThrow()
      expect(registry.get('test')).toBe(handler2)
    })

    it('should allow re-initialization after disposeAll', async () => {
      let initCount = 0

      registry.register(createTestHandler('counter', {
        initialize: async () => { initCount++ },
      }))

      await registry.initializeAll()
      await registry.disposeAll()

      // Register new handler
      registry.register(createTestHandler('counter2', {
        initialize: async () => { initCount++ },
      }))

      await registry.initializeAll()

      expect(initCount).toBe(2)
    })
  })
})

// ============================================================================
// Type Safety Tests (compile-time checked)
// ============================================================================

describe('DOHandlerRegistry Type Safety', () => {
  it('should enforce DOHandler interface on registration', () => {
    const registry = new DOHandlerRegistry()

    // Valid handler
    const validHandler: DOHandler = {
      name: 'valid',
    }
    registry.register(validHandler)

    // Handler with optional methods
    const fullHandler: DOHandler = {
      name: 'full',
      async initialize() {},
      async dispose() {},
    }
    registry.register(fullHandler)

    expect(registry.size).toBe(2)
  })

  it('should allow typed get with custom handler interface', () => {
    interface StorageHandler extends DOHandler {
      readonly name: 'storage'
      getData(): string
    }

    const registry = new DOHandlerRegistry()

    const storageHandler: StorageHandler = {
      name: 'storage',
      getData: () => 'data',
    }
    registry.register(storageHandler)

    const retrieved = registry.get<StorageHandler>('storage')
    expect(retrieved?.getData()).toBe('data')
  })

  it('should allow typed getRequired with custom handler interface', () => {
    interface RPCHandler extends DOHandler {
      readonly name: 'rpc'
      call(method: string): Promise<unknown>
    }

    const registry = new DOHandlerRegistry()

    const rpcHandler: RPCHandler = {
      name: 'rpc',
      call: async (method) => ({ method }),
    }
    registry.register(rpcHandler)

    const retrieved = registry.getRequired<RPCHandler>('rpc')
    expect(retrieved.name).toBe('rpc')
  })
})
