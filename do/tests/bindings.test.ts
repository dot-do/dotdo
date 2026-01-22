import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createBindingAccessor,
  getBinding,
  getStub,
  isDurableObjectNamespace,
  extractDOBindings,
  asBindingRegistry,
  type AnyDurableObjectNamespace,
  type DOBindingConstraint,
  type DOBindingRegistry,
  type BindingNames,
  type ExtractDOBindings,
  type RegistryFromNames,
  type BindingUnion
} from '../bindings'

/**
 * Mock DurableObjectNamespace for testing
 */
function createMockNamespace(name: string): AnyDurableObjectNamespace {
  const mockId = {
    toString: () => `mock-id-${name}`,
    equals: (other: DurableObjectId) => other.toString() === `mock-id-${name}`
  } as DurableObjectId

  const mockStub = {
    fetch: vi.fn().mockResolvedValue(new Response('ok')),
    id: mockId,
    name
  } as unknown as DurableObjectStub

  return {
    get: vi.fn().mockReturnValue(mockStub),
    idFromName: vi.fn().mockReturnValue(mockId),
    idFromString: vi.fn().mockReturnValue(mockId),
    newUniqueId: vi.fn().mockReturnValue(mockId)
  } as unknown as AnyDurableObjectNamespace
}

/**
 * Example binding interfaces for testing type safety.
 * Note: These extend DOBindingConstraint to satisfy TypeScript's strict index signature checks.
 */
interface TestBindings extends DOBindingConstraint {
  USER_DO: AnyDurableObjectNamespace
  ORDER_DO: AnyDurableObjectNamespace
  SESSION_DO: AnyDurableObjectNamespace
}

interface MixedEnv {
  USER_DO: AnyDurableObjectNamespace
  ORDER_DO: AnyDurableObjectNamespace
  KV: { get: () => void } // Not a DO namespace
  API_KEY: string
}

describe('Type-Safe DO Binding Registry', () => {
  let mockEnv: TestBindings

  beforeEach(() => {
    mockEnv = {
      USER_DO: createMockNamespace('user'),
      ORDER_DO: createMockNamespace('order'),
      SESSION_DO: createMockNamespace('session')
    }
  })

  describe('createBindingAccessor', () => {
    it('should create an accessor with get method', () => {
      const accessor = createBindingAccessor(mockEnv)

      const userDO = accessor.get('USER_DO')
      expect(userDO).toBe(mockEnv.USER_DO)
    })

    it('should provide autocomplete-friendly binding access', () => {
      const accessor = createBindingAccessor(mockEnv)

      // These should all work with autocomplete
      const user = accessor.get('USER_DO')
      const order = accessor.get('ORDER_DO')
      const session = accessor.get('SESSION_DO')

      expect(user).toBeDefined()
      expect(order).toBeDefined()
      expect(session).toBeDefined()
    })

    it('should throw for missing bindings', () => {
      const emptyEnv = {} as TestBindings

      const accessor = createBindingAccessor(emptyEnv)

      expect(() => accessor.get('USER_DO')).toThrow(
        'DOBinding with id USER_DO not found'
      )
    })

    it('should check binding existence with has()', () => {
      const accessor = createBindingAccessor(mockEnv)

      expect(accessor.has('USER_DO')).toBe(true)
      expect(accessor.has('ORDER_DO')).toBe(true)
      expect(accessor.has('SESSION_DO')).toBe(true)
    })

    it('should return all binding names', () => {
      const accessor = createBindingAccessor(mockEnv)

      const names = accessor.names()

      expect(names).toContain('USER_DO')
      expect(names).toContain('ORDER_DO')
      expect(names).toContain('SESSION_DO')
      expect(names.length).toBe(3)
    })

    it('should get stub by binding name and string ID', () => {
      const accessor = createBindingAccessor(mockEnv)

      const stub = accessor.getStub('USER_DO', 'user-123')

      expect(mockEnv.USER_DO.idFromName).toHaveBeenCalledWith('user-123')
      expect(mockEnv.USER_DO.get).toHaveBeenCalled()
      expect(stub).toBeDefined()
    })

    it('should get stub by binding name and DurableObjectId', () => {
      const accessor = createBindingAccessor(mockEnv)
      const existingId = { toString: () => 'existing-id' } as DurableObjectId

      const stub = accessor.getStub('ORDER_DO', existingId)

      expect(mockEnv.ORDER_DO.idFromName).not.toHaveBeenCalled()
      expect(mockEnv.ORDER_DO.get).toHaveBeenCalledWith(existingId)
      expect(stub).toBeDefined()
    })

    it('should create new unique ID', () => {
      const accessor = createBindingAccessor(mockEnv)

      const id = accessor.newUniqueId('SESSION_DO')

      expect(mockEnv.SESSION_DO.newUniqueId).toHaveBeenCalled()
      expect(id).toBeDefined()
    })

    it('should get ID from name', () => {
      const accessor = createBindingAccessor(mockEnv)

      const id = accessor.idFromName('USER_DO', 'test-user')

      expect(mockEnv.USER_DO.idFromName).toHaveBeenCalledWith('test-user')
      expect(id).toBeDefined()
    })

    it('should get ID from hex string', () => {
      const accessor = createBindingAccessor(mockEnv)

      const id = accessor.idFromString('ORDER_DO', 'abc123def456')

      expect(mockEnv.ORDER_DO.idFromString).toHaveBeenCalledWith('abc123def456')
      expect(id).toBeDefined()
    })
  })

  describe('getBinding helper', () => {
    it('should return the correct binding', () => {
      const userDO = getBinding<TestBindings, 'USER_DO'>('USER_DO', mockEnv)

      expect(userDO).toBe(mockEnv.USER_DO)
    })

    it('should throw for missing binding', () => {
      const emptyEnv = {} as TestBindings

      expect(() => getBinding<TestBindings, 'USER_DO'>('USER_DO', emptyEnv)).toThrow(
        'DOBinding with id USER_DO not found'
      )
    })
  })

  describe('getStub helper', () => {
    it('should return a stub for string ID', () => {
      const stub = getStub<TestBindings, 'USER_DO'>('USER_DO', 'user-123', mockEnv)

      expect(mockEnv.USER_DO.idFromName).toHaveBeenCalledWith('user-123')
      expect(mockEnv.USER_DO.get).toHaveBeenCalled()
      expect(stub).toBeDefined()
    })

    it('should return a stub for DurableObjectId', () => {
      const existingId = { toString: () => 'existing-id' } as DurableObjectId

      const stub = getStub<TestBindings, 'ORDER_DO'>('ORDER_DO', existingId, mockEnv)

      expect(mockEnv.ORDER_DO.get).toHaveBeenCalledWith(existingId)
      expect(stub).toBeDefined()
    })
  })

  describe('isDurableObjectNamespace', () => {
    it('should return true for valid namespace', () => {
      expect(isDurableObjectNamespace(mockEnv.USER_DO)).toBe(true)
    })

    it('should return false for null', () => {
      expect(isDurableObjectNamespace(null)).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isDurableObjectNamespace(undefined)).toBe(false)
    })

    it('should return false for plain object', () => {
      expect(isDurableObjectNamespace({})).toBe(false)
    })

    it('should return false for partial namespace', () => {
      const partial = {
        get: () => {},
        idFromName: () => {}
        // Missing idFromString and newUniqueId
      }
      expect(isDurableObjectNamespace(partial)).toBe(false)
    })

    it('should return false for object with non-function properties', () => {
      const invalid = {
        get: 'not a function',
        idFromName: 'not a function',
        idFromString: 'not a function',
        newUniqueId: 'not a function'
      }
      expect(isDurableObjectNamespace(invalid)).toBe(false)
    })
  })

  describe('extractDOBindings', () => {
    it('should extract only DO namespaces from mixed env', () => {
      const mixedEnv: MixedEnv = {
        USER_DO: createMockNamespace('user'),
        ORDER_DO: createMockNamespace('order'),
        KV: { get: () => {} },
        API_KEY: 'secret-key'
      }

      const doBindings = extractDOBindings(mixedEnv as unknown as Record<string, unknown>)

      expect(Object.keys(doBindings)).toContain('USER_DO')
      expect(Object.keys(doBindings)).toContain('ORDER_DO')
      expect(Object.keys(doBindings)).not.toContain('KV')
      expect(Object.keys(doBindings)).not.toContain('API_KEY')
      expect(Object.keys(doBindings).length).toBe(2)
    })

    it('should return empty object for env with no DO bindings', () => {
      const noDoEnv = {
        KV: { get: () => {} },
        API_KEY: 'secret'
      }

      const doBindings = extractDOBindings(noDoEnv)

      expect(Object.keys(doBindings).length).toBe(0)
    })
  })

  describe('asBindingRegistry', () => {
    it('should return the same object with correct type', () => {
      const registry = asBindingRegistry(mockEnv)

      expect(registry).toBe(mockEnv)
      expect(registry['USER_DO']).toBe(mockEnv['USER_DO'])
    })
  })

  describe('Type Safety Demonstrations', () => {
    /**
     * These tests demonstrate compile-time type safety.
     * The actual assertions may seem trivial, but the important part
     * is that the TypeScript compiler validates the types.
     */

    it('should enforce binding name types at compile time', () => {
      const accessor = createBindingAccessor(mockEnv)

      // Valid binding names - TypeScript allows these
      const _user: AnyDurableObjectNamespace = accessor.get('USER_DO')
      const _order: AnyDurableObjectNamespace = accessor.get('ORDER_DO')
      const _session: AnyDurableObjectNamespace = accessor.get('SESSION_DO')

      // The following would cause a TypeScript error if uncommented:
      // const _invalid = accessor.get('TYPO_DO') // Error: Argument of type '"TYPO_DO"' is not assignable...

      expect(_user).toBeDefined()
      expect(_order).toBeDefined()
      expect(_session).toBeDefined()
    })

    it('should extract binding names as union type', () => {
      // BindingNames<TestBindings> = 'USER_DO' | 'ORDER_DO' | 'SESSION_DO'
      type Names = BindingNames<TestBindings>

      // This is valid
      const validName: Names = 'USER_DO'

      // The following would cause a TypeScript error:
      // const invalidName: Names = 'TYPO_DO' // Error: Type '"TYPO_DO"' is not assignable...

      expect(validName).toBe('USER_DO')
    })

    it('should extract DO bindings from mixed environment type', () => {
      // ExtractDOBindings filters out non-DO properties at type level
      type DOOnly = ExtractDOBindings<MixedEnv>

      // DOOnly = { USER_DO: DurableObjectNamespace, ORDER_DO: DurableObjectNamespace }
      // KV and API_KEY are filtered out

      const doOnlyEnv: DOOnly = {
        USER_DO: mockEnv.USER_DO,
        ORDER_DO: mockEnv.ORDER_DO
        // Adding KV or API_KEY here would be a type error
      }

      expect(doOnlyEnv.USER_DO).toBeDefined()
      expect(doOnlyEnv.ORDER_DO).toBeDefined()
    })

    it('should create registry type from const array', () => {
      // Define bindings as const array
      const BINDINGS = ['ALPHA_DO', 'BETA_DO', 'GAMMA_DO'] as const

      // Create registry type from array
      type Registry = RegistryFromNames<typeof BINDINGS>

      // This enforces that the env must have exactly these bindings
      const env: Registry = {
        ALPHA_DO: createMockNamespace('alpha'),
        BETA_DO: createMockNamespace('beta'),
        GAMMA_DO: createMockNamespace('gamma')
      }

      expect(Object.keys(env)).toEqual(['ALPHA_DO', 'BETA_DO', 'GAMMA_DO'])
    })

    it('should create union type from const array', () => {
      const BINDINGS = ['X_DO', 'Y_DO', 'Z_DO'] as const

      type Names = BindingUnion<typeof BINDINGS>

      const valid: Names = 'X_DO'
      // const invalid: Names = 'INVALID' // Would be a type error

      expect(valid).toBe('X_DO')
    })
  })

  describe('Integration Scenarios', () => {
    it('should work with typed worker environment', async () => {
      // Simulate a typical worker environment with DO bindings
      interface DOEnv extends DOBindingConstraint {
        USER_DO: AnyDurableObjectNamespace
        ORDER_DO: AnyDurableObjectNamespace
      }

      const env: DOEnv = {
        USER_DO: createMockNamespace('user'),
        ORDER_DO: createMockNamespace('order')
      }

      // Create accessor for the DO bindings
      const accessor = createBindingAccessor(env)

      // Use the accessor
      const userStub = accessor.getStub('USER_DO', 'user-123')
      const response = await userStub.fetch(new Request('https://example.com'))

      expect(response.ok).toBe(true)
    })

    it('should support cross-DO communication pattern', async () => {
      interface CrossDOEnv extends DOBindingConstraint {
        SOURCE_DO: AnyDurableObjectNamespace
        TARGET_DO: AnyDurableObjectNamespace
      }

      const env: CrossDOEnv = {
        SOURCE_DO: createMockNamespace('source'),
        TARGET_DO: createMockNamespace('target')
      }

      const bindings = createBindingAccessor(env)

      // Get stubs for cross-DO communication
      const sourceStub = bindings.getStub('SOURCE_DO', 'source-1')
      const targetStub = bindings.getStub('TARGET_DO', 'target-1')

      // Both stubs should be valid
      expect(sourceStub).toBeDefined()
      expect(targetStub).toBeDefined()

      // Simulate calling target from source
      const result = await targetStub.fetch(new Request('https://target/action'))
      expect(result.ok).toBe(true)
    })

    it('should work in fetch handler pattern', async () => {
      interface Env extends DOBindingConstraint {
        ROUTER_DO: AnyDurableObjectNamespace
      }

      const env: Env = {
        ROUTER_DO: createMockNamespace('router')
      }

      // Typical fetch handler pattern
      async function handleRequest(request: Request, env: Env): Promise<Response> {
        const bindings = createBindingAccessor(env)

        // Type-safe binding access
        const routerId = bindings.idFromName('ROUTER_DO', 'main')
        const routerStub = bindings.getStub('ROUTER_DO', routerId)

        return routerStub.fetch(request)
      }

      const response = await handleRequest(new Request('https://test.com'), env)
      expect(response.ok).toBe(true)
    })
  })
})
