/**
 * RED Phase: Entry Point Export Tests for @dotdo/react
 *
 * Tests that all 5 entry points export their documented APIs:
 * 1. Main (.) - Provider, context, hooks, and types
 * 2. Hooks (./hooks) - Standalone hooks entry
 * 3. TanStack (./tanstack) - TanStack DB integration
 * 4. Admin (./admin) - Admin panel data provider
 * 5. Sync (./sync) - WebSocket sync utilities
 *
 * This is the RED phase - tests verify exports exist and are typed correctly.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'

// Mock @dotdo/client to avoid capnweb WebSocket session creation during import
vi.mock('@dotdo/client', () => ({
  createClient: vi.fn(() => ({
    disconnect: vi.fn(),
  })),
  $Context: vi.fn(() => ({})),
  $: {},
  DOClient: {},
  ConnectionState: 'connected',
}))

describe('@dotdo/react entry points', () => {
  describe('Main entry point (.)', () => {
    it('exports DO provider component', async () => {
      const { DO } = await import('../src/index')
      expect(DO).toBeDefined()
      expect(typeof DO).toBe('function')
    })

    it('exports DOProps type', async () => {
      // Type-level verification - DOProps should be exported as a type
      const mod = await import('../src/index')
      // DOProps is a type, we verify the module shape
      expect(mod).toHaveProperty('DO')
    })

    it('exports DotdoContext', async () => {
      const { DotdoContext } = await import('../src/index')
      expect(DotdoContext).toBeDefined()
    })

    it('exports useDotdoContext hook', async () => {
      const { useDotdoContext } = await import('../src/index')
      expect(useDotdoContext).toBeDefined()
      expect(typeof useDotdoContext).toBe('function')
    })

    it('exports useDO hook', async () => {
      const { useDO } = await import('../src/index')
      expect(useDO).toBeDefined()
      expect(typeof useDO).toBe('function')
    })

    it('exports use$ hook with WorkflowContext type', async () => {
      const { use$ } = await import('../src/index')
      expect(use$).toBeDefined()
      expect(typeof use$).toBe('function')
    })

    it('exports useCollection hook', async () => {
      const { useCollection } = await import('../src/index')
      expect(useCollection).toBeDefined()
      expect(typeof useCollection).toBe('function')
    })

    it('exports useLiveQuery hook', async () => {
      const { useLiveQuery } = await import('../src/index')
      expect(useLiveQuery).toBeDefined()
      expect(typeof useLiveQuery).toBe('function')
    })

    it('exports useRecord hook with UseRecordConfig type', async () => {
      const { useRecord } = await import('../src/index')
      expect(useRecord).toBeDefined()
      expect(typeof useRecord).toBe('function')
    })

    it('exports useConnectionState hook', async () => {
      const { useConnectionState } = await import('../src/index')
      expect(useConnectionState).toBeDefined()
      expect(typeof useConnectionState).toBe('function')
    })

    it('exports all documented types', async () => {
      // Type exports verification - these are compile-time only
      // We verify the module can be imported without error
      const mod = await import('../src/index')
      expect(mod).toBeDefined()

      // Runtime exports should all be present
      expect(mod).toHaveProperty('DO')
      expect(mod).toHaveProperty('DotdoContext')
      expect(mod).toHaveProperty('useDotdoContext')
      expect(mod).toHaveProperty('useDO')
      expect(mod).toHaveProperty('use$')
      expect(mod).toHaveProperty('useCollection')
      expect(mod).toHaveProperty('useLiveQuery')
      expect(mod).toHaveProperty('useRecord')
      expect(mod).toHaveProperty('useConnectionState')
    })
  })

  describe('Hooks entry point (./hooks)', () => {
    it('exports useDO hook', async () => {
      const { useDO } = await import('../src/hooks/index')
      expect(useDO).toBeDefined()
      expect(typeof useDO).toBe('function')
    })

    it('exports use$ hook', async () => {
      const { use$ } = await import('../src/hooks/index')
      expect(use$).toBeDefined()
      expect(typeof use$).toBe('function')
    })

    it('exports useCollection hook', async () => {
      const { useCollection } = await import('../src/hooks/index')
      expect(useCollection).toBeDefined()
      expect(typeof useCollection).toBe('function')
    })

    it('exports useLiveQuery hook', async () => {
      const { useLiveQuery } = await import('../src/hooks/index')
      expect(useLiveQuery).toBeDefined()
      expect(typeof useLiveQuery).toBe('function')
    })

    it('exports useRecord hook', async () => {
      const { useRecord } = await import('../src/hooks/index')
      expect(useRecord).toBeDefined()
      expect(typeof useRecord).toBe('function')
    })

    it('exports useConnectionState hook', async () => {
      const { useConnectionState } = await import('../src/hooks/index')
      expect(useConnectionState).toBeDefined()
      expect(typeof useConnectionState).toBe('function')
    })

    it('re-exports types from main types module', async () => {
      // CollectionConfig, UseDotdoCollectionResult, LiveQueryConfig, UseRecordResult
      // are type-only exports, verify module loads
      const mod = await import('../src/hooks/index')
      expect(mod).toBeDefined()
    })
  })

  describe('TanStack entry point (./tanstack)', () => {
    it('exports CollectionOptions factory', async () => {
      const { CollectionOptions } = await import('../src/tanstack/index')
      expect(CollectionOptions).toBeDefined()
      expect(typeof CollectionOptions).toBe('function')
    })

    it('exports all documented types', async () => {
      // CollectionConfig, CollectionOptionsResult, CollectionCallbacks, Mutation, MutationContext
      const mod = await import('../src/tanstack/index')
      expect(mod).toBeDefined()
      expect(mod).toHaveProperty('CollectionOptions')
    })
  })

  describe('Admin entry point (./admin)', () => {
    it('exports AdminProvider component', async () => {
      const { AdminProvider } = await import('../src/admin/index')
      expect(AdminProvider).toBeDefined()
      expect(typeof AdminProvider).toBe('function')
    })

    it('exports useAdminContext hook', async () => {
      const { useAdminContext } = await import('../src/admin/index')
      expect(useAdminContext).toBeDefined()
      expect(typeof useAdminContext).toBe('function')
    })

    it('exports DotdoDataProvider factory', async () => {
      const { DotdoDataProvider } = await import('../src/admin/index')
      expect(DotdoDataProvider).toBeDefined()
      expect(typeof DotdoDataProvider).toBe('function')
    })

    it('exports useResource hook', async () => {
      const { useResource } = await import('../src/admin/index')
      expect(useResource).toBeDefined()
      expect(typeof useResource).toBe('function')
    })

    it('exports useResourceRecord hook', async () => {
      const { useResourceRecord } = await import('../src/admin/index')
      expect(useResourceRecord).toBeDefined()
      expect(typeof useResourceRecord).toBe('function')
    })

    it('exports AdminError class and utilities', async () => {
      const { AdminError, isAdminError, formatAdminError } = await import('../src/admin/index')
      expect(AdminError).toBeDefined()
      expect(isAdminError).toBeDefined()
      expect(formatAdminError).toBeDefined()
      expect(typeof AdminError).toBe('function')
      expect(typeof isAdminError).toBe('function')
      expect(typeof formatAdminError).toBe('function')
    })

    it('exports schema utilities', async () => {
      const { inferFieldsFromSchema, createResourceFromSchema } = await import('../src/admin/index')
      expect(inferFieldsFromSchema).toBeDefined()
      expect(createResourceFromSchema).toBeDefined()
      expect(typeof inferFieldsFromSchema).toBe('function')
      expect(typeof createResourceFromSchema).toBe('function')
    })

    it('exports cache utilities', async () => {
      const { createCacheKey, invalidateCache, useOptimisticUpdate } = await import('../src/admin/index')
      expect(createCacheKey).toBeDefined()
      expect(invalidateCache).toBeDefined()
      expect(useOptimisticUpdate).toBeDefined()
      expect(typeof createCacheKey).toBe('function')
      expect(typeof invalidateCache).toBe('function')
      expect(typeof useOptimisticUpdate).toBe('function')
    })
  })

  describe('Sync entry point (./sync)', () => {
    it('exports SyncClient class', async () => {
      const { SyncClient } = await import('../src/sync/index')
      expect(SyncClient).toBeDefined()
      expect(typeof SyncClient).toBe('function')
    })

    it('SyncClient can be instantiated', async () => {
      const { SyncClient } = await import('../src/sync/index')
      const client = new SyncClient({
        doUrl: 'wss://test.example.com',
        collection: 'Task',
      })
      expect(client).toBeInstanceOf(SyncClient)
    })

    it('SyncClient has required methods and properties', async () => {
      const { SyncClient } = await import('../src/sync/index')
      const client = new SyncClient({
        doUrl: 'wss://test.example.com',
        collection: 'Task',
      })

      // Check methods exist
      expect(typeof client.connect).toBe('function')
      expect(typeof client.disconnect).toBe('function')

      // Check properties
      expect(client).toHaveProperty('connectionState')
      expect(client).toHaveProperty('isConnected')

      // Check callback properties
      expect(client).toHaveProperty('onInitial')
      expect(client).toHaveProperty('onChange')
      expect(client).toHaveProperty('onDisconnect')
      expect(client).toHaveProperty('onStateChange')
      expect(client).toHaveProperty('onError')
    })
  })

  describe('Cross-entry point consistency', () => {
    it('hooks from main and hooks entry are the same', async () => {
      const mainModule = await import('../src/index')
      const hooksModule = await import('../src/hooks/index')

      // All hooks should be the exact same functions
      expect(mainModule.useDO).toBe(hooksModule.useDO)
      expect(mainModule.use$).toBe(hooksModule.use$)
      expect(mainModule.useCollection).toBe(hooksModule.useCollection)
      expect(mainModule.useLiveQuery).toBe(hooksModule.useLiveQuery)
      expect(mainModule.useRecord).toBe(hooksModule.useRecord)
      expect(mainModule.useConnectionState).toBe(hooksModule.useConnectionState)
    })

    it('sync client is used internally by tanstack', async () => {
      const { SyncClient } = await import('../src/sync/index')
      // The SyncClient class should be the same one used by tanstack
      expect(SyncClient).toBeDefined()

      // Verify tanstack can be imported (uses sync internally)
      const tanstack = await import('../src/tanstack/index')
      expect(tanstack.CollectionOptions).toBeDefined()
    })
  })
})

describe('TypeScript type exports', () => {
  it('main entry exports correct type definitions', async () => {
    // This test verifies type-level exports are available
    // The actual type checking happens at compile time
    // We just verify the module can be imported cleanly
    const mod = await import('../src/index')

    // Verify all runtime exports are present
    const expectedExports = [
      'DO',
      'DotdoContext',
      'useDotdoContext',
      'useDO',
      'use$',
      'useCollection',
      'useLiveQuery',
      'useRecord',
      'useConnectionState',
    ]

    for (const exportName of expectedExports) {
      expect(mod).toHaveProperty(exportName)
    }
  })

  it('hooks entry exports correct type definitions', async () => {
    const mod = await import('../src/hooks/index')

    const expectedExports = [
      'useDO',
      'use$',
      'useCollection',
      'useLiveQuery',
      'useRecord',
      'useConnectionState',
    ]

    for (const exportName of expectedExports) {
      expect(mod).toHaveProperty(exportName)
    }
  })

  it('tanstack entry exports correct type definitions', async () => {
    const mod = await import('../src/tanstack/index')

    expect(mod).toHaveProperty('CollectionOptions')
  })

  it('admin entry exports correct type definitions', async () => {
    const mod = await import('../src/admin/index')

    const expectedExports = [
      'AdminProvider',
      'useAdminContext',
      'DotdoDataProvider',
      'useResource',
      'useResourceRecord',
      'AdminError',
      'isAdminError',
      'formatAdminError',
      'inferFieldsFromSchema',
      'createResourceFromSchema',
      'createCacheKey',
      'invalidateCache',
      'useOptimisticUpdate',
    ]

    for (const exportName of expectedExports) {
      expect(mod).toHaveProperty(exportName)
    }
  })

  it('sync entry exports correct type definitions', async () => {
    const mod = await import('../src/sync/index')

    expect(mod).toHaveProperty('SyncClient')
  })
})
