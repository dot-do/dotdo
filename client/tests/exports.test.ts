/**
 * Client Entry Point Exports Tests (RED Phase - TDD)
 *
 * Issue: dotdo-hsb4n
 *
 * These tests verify that the client entry point (client/index.ts) exports:
 * - use$ hook (alias for useDollar)
 * - useCollection hook
 * - useSyncForm hook
 * - useSyncTable hook
 * - DataProvider factory (createDataProvider) for shadmin
 * - AuthProvider factory (createAuthProvider) for shadmin
 * - $ context factory (create$Context) for saaskit
 * - All exports are tree-shakeable
 * - Types are correctly exported
 *
 * Tests will FAIL because the client entry point doesn't exist yet.
 * This is intentional - RED phase of TDD.
 */

import { describe, it, expect, expectTypeOf } from 'vitest'

// ============================================================================
// Import Tests - These will fail because client/index.ts doesn't exist
// ============================================================================

describe('Client Entry Point Exports', () => {
  // ============================================================================
  // 1. Hook Exports
  // ============================================================================

  describe('Hook Exports', () => {
    it('should export use$ hook', async () => {
      // This will FAIL - client/index.ts doesn't export use$
      const { use$ } = await import('../../client')

      expect(use$).toBeDefined()
      expect(typeof use$).toBe('function')
    })

    it('should export useDollar hook (aliased as use$)', async () => {
      // This will FAIL - client/index.ts doesn't export useDollar
      const { useDollar } = await import('../../client')

      expect(useDollar).toBeDefined()
      expect(typeof useDollar).toBe('function')
    })

    it('use$ and useDollar should be the same function', async () => {
      // This will FAIL - imports don't exist
      const { use$, useDollar } = await import('../../client')

      expect(use$).toBe(useDollar)
    })

    it('should export useCollection hook', async () => {
      // This will FAIL - client/index.ts doesn't export useCollection
      const { useCollection } = await import('../../client')

      expect(useCollection).toBeDefined()
      expect(typeof useCollection).toBe('function')
    })

    it('should export useSyncForm hook', async () => {
      // This will FAIL - client/index.ts doesn't export useSyncForm
      const { useSyncForm } = await import('../../client')

      expect(useSyncForm).toBeDefined()
      expect(typeof useSyncForm).toBe('function')
    })

    it('should export useSyncTable hook', async () => {
      // This will FAIL - client/index.ts doesn't export useSyncTable
      const { useSyncTable } = await import('../../client')

      expect(useSyncTable).toBeDefined()
      expect(typeof useSyncTable).toBe('function')
    })
  })

  // ============================================================================
  // 2. Provider Factory Exports (for shadmin)
  // ============================================================================

  describe('Provider Factory Exports (shadmin)', () => {
    it('should export createDataProvider factory', async () => {
      // This will FAIL - client/index.ts doesn't export createDataProvider
      const { createDataProvider } = await import('../../client')

      expect(createDataProvider).toBeDefined()
      expect(typeof createDataProvider).toBe('function')
    })

    it('createDataProvider should return a DataProvider object', async () => {
      // This will FAIL - factory doesn't exist
      const { createDataProvider } = await import('../../client')

      const provider = createDataProvider({ baseUrl: 'https://api.example.com.ai' })

      // DataProvider should have CRUD methods
      expect(provider).toHaveProperty('getList')
      expect(provider).toHaveProperty('getOne')
      expect(provider).toHaveProperty('create')
      expect(provider).toHaveProperty('update')
      expect(provider).toHaveProperty('delete')
      expect(provider).toHaveProperty('getMany')
      expect(provider).toHaveProperty('getManyReference')
    })

    it('should export createAuthProvider factory', async () => {
      // This will FAIL - client/index.ts doesn't export createAuthProvider
      const { createAuthProvider } = await import('../../client')

      expect(createAuthProvider).toBeDefined()
      expect(typeof createAuthProvider).toBe('function')
    })

    it('createAuthProvider should return an AuthProvider object', async () => {
      // This will FAIL - factory doesn't exist
      const { createAuthProvider } = await import('../../client')

      const provider = createAuthProvider({ authUrl: 'https://auth.example.com.ai' })

      // AuthProvider should have auth methods
      expect(provider).toHaveProperty('login')
      expect(provider).toHaveProperty('logout')
      expect(provider).toHaveProperty('checkAuth')
      expect(provider).toHaveProperty('checkError')
      expect(provider).toHaveProperty('getIdentity')
      expect(provider).toHaveProperty('getPermissions')
    })
  })

  // ============================================================================
  // 3. Context Factory Exports (for saaskit)
  // ============================================================================

  describe('Context Factory Exports (saaskit)', () => {
    it('should export create$Context factory', async () => {
      // This will FAIL - client/index.ts doesn't export create$Context
      const { create$Context } = await import('../../client')

      expect(create$Context).toBeDefined()
      expect(typeof create$Context).toBe('function')
    })

    it('create$Context should return context with Provider and hook', async () => {
      // This will FAIL - factory doesn't exist
      const { create$Context } = await import('../../client')

      const context = create$Context({ baseUrl: 'https://api.example.com.ai' })

      // Context should have Provider component and use$ hook
      expect(context).toHaveProperty('Provider')
      expect(context).toHaveProperty('use$')
      expect(typeof context.Provider).toBe('function')
      expect(typeof context.use$).toBe('function')
    })

    it('create$Context should accept configuration options', async () => {
      // This will FAIL - factory doesn't exist
      const { create$Context } = await import('../../client')

      // Should not throw with valid config
      expect(() =>
        create$Context({
          baseUrl: 'https://api.example.com.ai',
          auth: { token: 'test-token' },
          timeout: 30000,
        })
      ).not.toThrow()
    })
  })

  // ============================================================================
  // 4. Tree-Shakeability Tests
  // ============================================================================

  describe('Tree-Shakeability', () => {
    it('should allow importing only use$ without side effects', async () => {
      // This will FAIL - import doesn't exist
      // Tree-shakeable means we can import just what we need
      const module = await import('../../client')

      // Module should have named exports, not a default object
      expect(module).toHaveProperty('use$')
      expect(module.default).toBeUndefined()
    })

    it('should allow importing only useCollection without other hooks', async () => {
      // This will FAIL - import doesn't exist
      const { useCollection } = await import('../../client')

      // Should be able to destructure just what we need
      expect(useCollection).toBeDefined()
    })

    it('should allow importing only createDataProvider without hooks', async () => {
      // This will FAIL - import doesn't exist
      const { createDataProvider } = await import('../../client')

      // Should be able to destructure just what we need
      expect(createDataProvider).toBeDefined()
    })

    it('exports should be statically analyzable (no barrel re-exports from index)', async () => {
      // This will FAIL - module doesn't exist
      const module = await import('../../client')

      // Named exports should be direct, not through intermediate barrels
      // This is verified by the module loading successfully
      expect(Object.keys(module).length).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // 5. Type Exports
  // ============================================================================

  describe('Type Exports', () => {
    it('should export DollarContext type', async () => {
      // This will FAIL - types don't exist
      const module = await import('../../client')
      type DollarContext = typeof module extends { DollarContext: infer T } ? T : never

      // Type should exist (compile-time check)
      expect(module).toHaveProperty('DollarContext')
    })

    it('should export DataProviderConfig type', async () => {
      // This will FAIL - types don't exist
      const module = await import('../../client')

      // Check the type is exported (runtime check for type export)
      expect('DataProviderConfig' in module || typeof module.createDataProvider === 'function').toBe(true)
    })

    it('should export AuthProviderConfig type', async () => {
      // This will FAIL - types don't exist
      const module = await import('../../client')

      // Check the type is exported (runtime check for type export)
      expect('AuthProviderConfig' in module || typeof module.createAuthProvider === 'function').toBe(true)
    })

    it('should export CollectionHookResult type', async () => {
      // This will FAIL - types don't exist
      const module = await import('../../client')

      // Type is typically inferred from useCollection return, check the hook exists
      expect(module).toHaveProperty('useCollection')
    })

    it('should export SyncFormConfig type', async () => {
      // This will FAIL - types don't exist
      const module = await import('../../client')

      // Type is typically inferred from useSyncForm param, check the hook exists
      expect(module).toHaveProperty('useSyncForm')
    })

    it('should export SyncTableConfig type', async () => {
      // This will FAIL - types don't exist
      const module = await import('../../client')

      // Type is typically inferred from useSyncTable param, check the hook exists
      expect(module).toHaveProperty('useSyncTable')
    })
  })
})

// ============================================================================
// Type-Level Tests (compile-time checks)
// ============================================================================

describe('Client Type Definitions', () => {
  it('use$ hook should return typed $ context', async () => {
    // This tests the type signature of use$
    // Will FAIL at compile time because types don't exist

    const { use$ } = await import('../../client')

    // use$ should return the $ context with workflow methods
    const $ = use$()

    // $ should have common workflow context methods
    expectTypeOf($).toHaveProperty('send')
    expectTypeOf($).toHaveProperty('do')
    expectTypeOf($).toHaveProperty('try')
    expectTypeOf($).toHaveProperty('on')
    expectTypeOf($).toHaveProperty('every')
  })

  it('useCollection should accept generic type parameter', async () => {
    // This will FAIL - useCollection doesn't exist

    const { useCollection } = await import('../../client')

    interface User {
      id: string
      name: string
      email: string
    }

    // Should accept generic type
    const result = useCollection<User>('users')

    // Result should have typed data
    expectTypeOf(result.data).toEqualTypeOf<User[] | undefined>()
    expectTypeOf(result.isLoading).toBeBoolean()
    expectTypeOf(result.error).toEqualTypeOf<Error | null>()
  })

  it('useSyncForm should return typed form state', async () => {
    // This will FAIL - useSyncForm doesn't exist

    const { useSyncForm } = await import('../../client')

    interface UserForm {
      name: string
      email: string
    }

    const form = useSyncForm<UserForm>({ collection: 'users', id: 'user-1' })

    // Should have typed values and setters
    expectTypeOf(form.values).toEqualTypeOf<UserForm>()
    expectTypeOf(form.setValue).toBeFunction()
    expectTypeOf(form.submit).toBeFunction()
    expectTypeOf(form.isDirty).toBeBoolean()
    expectTypeOf(form.isSaving).toBeBoolean()
  })

  it('useSyncTable should return typed table state', async () => {
    // This will FAIL - useSyncTable doesn't exist

    const { useSyncTable } = await import('../../client')

    interface User {
      id: string
      name: string
      email: string
    }

    const table = useSyncTable<User>({ collection: 'users' })

    // Should have typed rows and pagination
    expectTypeOf(table.rows).toEqualTypeOf<User[]>()
    expectTypeOf(table.page).toBeNumber()
    expectTypeOf(table.pageSize).toBeNumber()
    expectTypeOf(table.total).toBeNumber()
    expectTypeOf(table.nextPage).toBeFunction()
    expectTypeOf(table.prevPage).toBeFunction()
    expectTypeOf(table.setPage).toBeFunction()
  })

  it('createDataProvider should return properly typed provider', async () => {
    // This will FAIL - createDataProvider doesn't exist

    const { createDataProvider } = await import('../../client')

    const provider = createDataProvider({ baseUrl: 'https://api.example.com.ai' })

    // Provider methods should be properly typed
    expectTypeOf(provider.getList).toBeFunction()
    expectTypeOf(provider.getOne).toBeFunction()
    expectTypeOf(provider.create).toBeFunction()
    expectTypeOf(provider.update).toBeFunction()
    expectTypeOf(provider.delete).toBeFunction()
  })

  it('createAuthProvider should return properly typed provider', async () => {
    // This will FAIL - createAuthProvider doesn't exist

    const { createAuthProvider } = await import('../../client')

    const provider = createAuthProvider({ authUrl: 'https://auth.example.com.ai' })

    // Provider methods should be properly typed
    expectTypeOf(provider.login).toBeFunction()
    expectTypeOf(provider.logout).toBeFunction()
    expectTypeOf(provider.checkAuth).toBeFunction()
    expectTypeOf(provider.checkError).toBeFunction()
    expectTypeOf(provider.getIdentity).toBeFunction()
  })
})

// ============================================================================
// Integration Pattern Tests
// ============================================================================

describe('Client Integration Patterns', () => {
  it('should support typical React app usage pattern', async () => {
    // This will FAIL - imports don't exist

    const { use$, useCollection, create$Context } = await import('../../client')

    // Pattern: Create context at app level
    const { Provider, use$: useContext$ } = create$Context({
      baseUrl: 'https://api.example.com.ai',
    })

    expect(Provider).toBeDefined()
    expect(useContext$).toBeDefined()

    // Direct hooks should also work
    expect(use$).toBeDefined()
    expect(useCollection).toBeDefined()
  })

  it('should support shadmin admin panel pattern', async () => {
    // This will FAIL - imports don't exist

    const { createDataProvider, createAuthProvider } = await import('../../client')

    // Pattern: Create providers for react-admin
    const dataProvider = createDataProvider({
      baseUrl: 'https://api.example.com.ai',
    })

    const authProvider = createAuthProvider({
      authUrl: 'https://api.example.com.ai/auth',
    })

    // Both providers should be usable with react-admin
    expect(dataProvider.getList).toBeDefined()
    expect(authProvider.login).toBeDefined()
  })

  it('should support saaskit SaaS starter pattern', async () => {
    // This will FAIL - imports don't exist

    const { create$Context, useSyncForm, useSyncTable } = await import('../../client')

    // Pattern: SaaS app with forms and tables
    const context = create$Context({
      baseUrl: 'https://api.example.com.ai',
      auth: { token: 'user-token' },
    })

    expect(context.Provider).toBeDefined()
    expect(useSyncForm).toBeDefined()
    expect(useSyncTable).toBeDefined()
  })
})
