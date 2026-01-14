/**
 * DO $type Discriminator and Identity Model Tests
 *
 * TDD RED Phase: These tests define the expected behavior for:
 * 1. $type property on DO instances
 * 2. Type-based routing in the dispatch layer
 * 3. Identity resolution (ID -> DO type -> namespace)
 * 4. Type registration and discovery
 *
 * All tests should FAIL initially as the functionality doesn't exist yet.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO, type Env } from '../DO'
import { Business } from '../Business'
import { Worker } from '../Worker'
import { Agent } from '../Agent'
import { Human } from '../Human'
import { App } from '../App'
import { Site } from '../Site'
import { Entity } from '../Entity'
import { Collection } from '../Collection'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

function createMockSqlStorage() {
  return {
    exec(query: string, ...params: unknown[]) {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
  }
}

function createMockKvStorage() {
  const storage = new Map<string, unknown>()
  return {
    get: vi.fn(async <T = unknown>(key: string | string[]) => {
      if (Array.isArray(key)) {
        const result = new Map<string, T>()
        for (const k of key) {
          const value = storage.get(k)
          if (value !== undefined) result.set(k, value as T)
        }
        return result
      }
      return storage.get(key) as T | undefined
    }),
    put: vi.fn(async <T>(key: string | Record<string, T>, value?: T) => {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) storage.set(k, v)
      } else {
        storage.set(key, value)
      }
    }),
    delete: vi.fn(async () => true),
    deleteAll: vi.fn(async () => {}),
    list: vi.fn(async () => new Map()),
    _storage: storage,
  }
}

function createMockDOId(name: string = 'test-do-id') {
  return {
    toString: () => name,
    equals: (other: { toString(): string }) => other.toString() === name,
    name,
  }
}

function createMockState(idName: string = 'test-do-id') {
  const kvStorage = createMockKvStorage()
  const sqlStorage = createMockSqlStorage()

  return {
    id: createMockDOId(idName),
    storage: {
      ...kvStorage,
      sql: sqlStorage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async <T>(callback: () => Promise<T>) => callback()),
  } as unknown as DurableObjectState
}

function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
    ...overrides,
  }
}

// ============================================================================
// SECTION 1: $type PROPERTY ON DO INSTANCES
// ============================================================================

describe('DO $type Discriminator', () => {
  describe('$type Property Existence', () => {
    let mockState: DurableObjectState
    let mockEnv: Env

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
    })

    it('base DO class has static $type property', () => {
      // RED: DO class should have a static $type property
      expect(DO).toHaveProperty('$type')
      expect((DO as unknown as { $type: string }).$type).toBe('DO')
    })

    it('DO instance has $type property', () => {
      const doInstance = new DO(mockState, mockEnv)

      // RED: DO instances should expose $type
      expect(doInstance).toHaveProperty('$type')
      expect((doInstance as unknown as { $type: string }).$type).toBe('DO')
    })

    it('$type property is readonly', () => {
      const doInstance = new DO(mockState, mockEnv)

      // RED: $type should be readonly (setting should throw or be ignored)
      expect(() => {
        (doInstance as unknown as { $type: string }).$type = 'SomethingElse'
      }).toThrow()
    })

    it('Business has $type "Business"', () => {
      const business = new Business(mockState, mockEnv)

      // RED: Business subclass should have its own $type
      expect((business as unknown as { $type: string }).$type).toBe('Business')
    })

    it('Worker has $type "Worker"', () => {
      const worker = new Worker(mockState, mockEnv)

      expect((worker as unknown as { $type: string }).$type).toBe('Worker')
    })

    it('Agent has $type "Agent"', () => {
      const agent = new Agent(mockState, mockEnv)

      // RED: Agent (extends Worker extends DO) should have $type "Agent"
      expect((agent as unknown as { $type: string }).$type).toBe('Agent')
    })

    it('Human has $type "Human"', () => {
      const human = new Human(mockState, mockEnv)

      expect((human as unknown as { $type: string }).$type).toBe('Human')
    })

    it('App has $type "App"', () => {
      const app = new App(mockState, mockEnv)

      expect((app as unknown as { $type: string }).$type).toBe('App')
    })

    it('Site has $type "Site"', () => {
      const site = new Site(mockState, mockEnv)

      expect((site as unknown as { $type: string }).$type).toBe('Site')
    })

    it('Entity has $type "Entity"', () => {
      const entity = new Entity(mockState, mockEnv)

      expect((entity as unknown as { $type: string }).$type).toBe('Entity')
    })

    it('Collection has $type "Collection"', () => {
      const collection = new Collection(mockState, mockEnv)

      expect((collection as unknown as { $type: string }).$type).toBe('Collection')
    })
  })

  describe('$type Format and Validation', () => {
    let mockState: DurableObjectState
    let mockEnv: Env

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
    })

    it('$type is PascalCase', () => {
      const doInstance = new DO(mockState, mockEnv)
      const $type = (doInstance as unknown as { $type: string }).$type

      // RED: $type should follow PascalCase convention
      expect($type).toMatch(/^[A-Z][a-zA-Z]*$/)
    })

    it('$type matches class name', () => {
      const business = new Business(mockState, mockEnv)

      // RED: $type should match the constructor name
      expect((business as unknown as { $type: string }).$type).toBe(business.constructor.name)
    })

    it('static $type matches instance $type', () => {
      const business = new Business(mockState, mockEnv)

      // RED: Static and instance $type should be the same
      expect((Business as unknown as { $type: string }).$type).toBe(
        (business as unknown as { $type: string }).$type,
      )
    })

    it('$type can be accessed via constructor', () => {
      const business = new Business(mockState, mockEnv)

      // RED: Should be able to get $type from instance.constructor
      expect(
        (business.constructor as unknown as { $type: string }).$type,
      ).toBe('Business')
    })
  })

  describe('$type in Inheritance Chain', () => {
    let mockState: DurableObjectState
    let mockEnv: Env

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
    })

    it('subclass $type overrides parent $type', () => {
      const worker = new Worker(mockState, mockEnv)
      const agent = new Agent(mockState, mockEnv)

      // RED: Agent should have its own $type, not inherit Worker's
      expect((worker as unknown as { $type: string }).$type).toBe('Worker')
      expect((agent as unknown as { $type: string }).$type).toBe('Agent')
      expect((agent as unknown as { $type: string }).$type).not.toBe('Worker')
    })

    it('getTypeHierarchy returns full type chain', () => {
      const agent = new Agent(mockState, mockEnv)

      // RED: Agent should know its full type hierarchy
      const hierarchy = (agent as unknown as { getTypeHierarchy(): string[] }).getTypeHierarchy()

      expect(hierarchy).toEqual(['Agent', 'Worker', 'DO'])
    })

    it('isInstanceOfType checks type hierarchy', () => {
      const agent = new Agent(mockState, mockEnv)

      // RED: isInstanceOfType should check the full hierarchy
      const isType = (agent as unknown as { isInstanceOfType(type: string): boolean }).isInstanceOfType

      expect(isType.call(agent, 'Agent')).toBe(true)
      expect(isType.call(agent, 'Worker')).toBe(true)
      expect(isType.call(agent, 'DO')).toBe(true)
      expect(isType.call(agent, 'Business')).toBe(false)
    })
  })
})

// ============================================================================
// SECTION 2: TYPE-BASED ROUTING IN DISPATCH LAYER
// ============================================================================

describe('Type-Based Routing', () => {
  describe('TypeRegistry', () => {
    it('TypeRegistry exists and can be imported', async () => {
      // RED: TypeRegistry should exist for registering DO types
      const { TypeRegistry } = await import('../TypeRegistry')

      expect(TypeRegistry).toBeDefined()
      expect(typeof TypeRegistry).toBe('function')
    })

    it('TypeRegistry can register a DO class', async () => {
      const { TypeRegistry } = await import('../TypeRegistry')

      const registry = new TypeRegistry()

      // RED: Should be able to register a DO class by $type
      expect(() => registry.register(DO)).not.toThrow()
      expect(() => registry.register(Business)).not.toThrow()
      expect(() => registry.register(Agent)).not.toThrow()
    })

    it('TypeRegistry can retrieve class by $type', async () => {
      const { TypeRegistry } = await import('../TypeRegistry')

      const registry = new TypeRegistry()
      registry.register(Business)

      // RED: Should be able to get the class back by type name
      const BusinessClass = registry.get('Business')

      expect(BusinessClass).toBe(Business)
    })

    it('TypeRegistry returns undefined for unknown type', async () => {
      const { TypeRegistry } = await import('../TypeRegistry')

      const registry = new TypeRegistry()

      // RED: Should return undefined for unregistered types
      expect(registry.get('NonExistent')).toBeUndefined()
    })

    it('TypeRegistry lists all registered types', async () => {
      const { TypeRegistry } = await import('../TypeRegistry')

      const registry = new TypeRegistry()
      registry.register(DO)
      registry.register(Business)
      registry.register(Agent)

      // RED: Should list all registered $types
      const types = registry.listTypes()

      expect(types).toContain('DO')
      expect(types).toContain('Business')
      expect(types).toContain('Agent')
    })

    it('TypeRegistry prevents duplicate registration', async () => {
      const { TypeRegistry } = await import('../TypeRegistry')

      const registry = new TypeRegistry()
      registry.register(Business)

      // RED: Should throw on duplicate registration
      expect(() => registry.register(Business)).toThrow(/already registered/)
    })

    it('TypeRegistry supports inheritance queries', async () => {
      const { TypeRegistry } = await import('../TypeRegistry')

      const registry = new TypeRegistry()
      registry.register(DO)
      registry.register(Worker)
      registry.register(Agent)

      // RED: Should find all types that extend a base type
      const workerTypes = registry.findSubtypes('Worker')

      expect(workerTypes).toContain('Agent')
      expect(workerTypes).not.toContain('Business')
    })
  })

  describe('DODispatcher', () => {
    let mockEnv: Env

    beforeEach(() => {
      mockEnv = createMockEnv()
    })

    it('DODispatcher exists and can be imported', async () => {
      // RED: DODispatcher should exist for routing requests to DOs
      const { DODispatcher } = await import('../DODispatcher')

      expect(DODispatcher).toBeDefined()
    })

    it('DODispatcher routes by $type in request path', async () => {
      const { DODispatcher, TypeRegistry } = await import('../DODispatcher')

      const registry = new TypeRegistry()
      registry.register(Business)

      const dispatcher = new DODispatcher(registry, mockEnv)

      // RED: Should route /Business/acme-corp to a Business DO
      const request = new Request('https://api.do/Business/acme-corp')
      const { doClass, doId } = await dispatcher.resolve(request)

      expect(doClass).toBe('Business')
      expect(doId).toBe('acme-corp')
    })

    it('DODispatcher routes by $type in header', async () => {
      const { DODispatcher, TypeRegistry } = await import('../DODispatcher')

      const registry = new TypeRegistry()
      registry.register(Agent)

      const dispatcher = new DODispatcher(registry, mockEnv)

      // RED: Should use X-DO-Type header for routing
      const request = new Request('https://api.do/some-id', {
        headers: { 'X-DO-Type': 'Agent' },
      })
      const { doClass, doId } = await dispatcher.resolve(request)

      expect(doClass).toBe('Agent')
    })

    it('DODispatcher throws for unknown type', async () => {
      const { DODispatcher, TypeRegistry } = await import('../DODispatcher')

      const registry = new TypeRegistry()
      const dispatcher = new DODispatcher(registry, mockEnv)

      // RED: Should throw for unregistered types
      const request = new Request('https://api.do/UnknownType/id')

      await expect(dispatcher.resolve(request)).rejects.toThrow(/unknown type/i)
    })

    it('DODispatcher extracts namespace from request', async () => {
      const { DODispatcher, TypeRegistry } = await import('../DODispatcher')

      const registry = new TypeRegistry()
      registry.register(Business)

      const dispatcher = new DODispatcher(registry, mockEnv)

      // RED: Should extract full namespace from request
      const request = new Request('https://acme.do/Business/main')
      const { namespace, doClass, doId } = await dispatcher.resolve(request)

      expect(namespace).toBe('https://acme.do')
      expect(doClass).toBe('Business')
      expect(doId).toBe('main')
    })

    it('DODispatcher returns correct DO stub', async () => {
      const { DODispatcher, TypeRegistry } = await import('../DODispatcher')

      const mockDONamespace = {
        idFromName: vi.fn((name: string) => createMockDOId(name)),
        get: vi.fn(() => ({ fetch: vi.fn() })),
      }

      const envWithDO = createMockEnv({ DO: mockDONamespace as unknown as DurableObjectNamespace })
      const registry = new TypeRegistry()
      registry.register(Business)

      const dispatcher = new DODispatcher(registry, envWithDO)

      // RED: Should return a usable DO stub
      const request = new Request('https://api.do/Business/test')
      const stub = await dispatcher.getStub(request)

      expect(stub).toBeDefined()
      expect(typeof stub.fetch).toBe('function')
    })
  })
})

// ============================================================================
// SECTION 3: IDENTITY RESOLUTION (ID -> DO Type -> Namespace)
// ============================================================================

describe('Identity Resolution', () => {
  describe('ID Format and Parsing', () => {
    it('parseDoId extracts type from qualified ID', async () => {
      // RED: Should parse "Business/acme-corp" into type and id
      const { parseDoId } = await import('../identity')

      const result = parseDoId('Business/acme-corp')

      expect(result.type).toBe('Business')
      expect(result.id).toBe('acme-corp')
    })

    it('parseDoId handles URL format', async () => {
      const { parseDoId } = await import('../identity')

      // RED: Should parse full URL format
      const result = parseDoId('https://startups.studio/Business/acme')

      expect(result.namespace).toBe('https://startups.studio')
      expect(result.type).toBe('Business')
      expect(result.id).toBe('acme')
    })

    it('parseDoId handles nested paths', async () => {
      const { parseDoId } = await import('../identity')

      // RED: Should handle nested entity paths
      const result = parseDoId('Business/acme/App/main')

      expect(result.type).toBe('Business')
      expect(result.id).toBe('acme')
      expect(result.subPath).toBe('App/main')
    })

    it('parseDoId validates type is registered', async () => {
      const { parseDoId, TypeRegistry } = await import('../identity')

      const registry = new TypeRegistry()
      registry.register(Business)

      // RED: Should validate the type exists in registry
      expect(() => parseDoId('InvalidType/id', registry)).toThrow(/unknown type/i)
    })

    it('buildDoId constructs qualified ID', async () => {
      const { buildDoId } = await import('../identity')

      // RED: Should build a qualified ID from parts
      const id = buildDoId({ type: 'Business', id: 'acme' })

      expect(id).toBe('Business/acme')
    })

    it('buildDoId constructs full URL ID', async () => {
      const { buildDoId } = await import('../identity')

      // RED: Should build full URL when namespace is provided
      const id = buildDoId({
        namespace: 'https://startups.studio',
        type: 'Business',
        id: 'acme',
      })

      expect(id).toBe('https://startups.studio/Business/acme')
    })
  })

  describe('ID to DO Mapping', () => {
    let mockEnv: Env

    beforeEach(() => {
      mockEnv = createMockEnv()
    })

    it('resolveId returns DO class and namespace binding', async () => {
      const { resolveId, TypeRegistry } = await import('../identity')

      const registry = new TypeRegistry()
      registry.register(Business)

      // RED: resolveId should return the DO class and binding info
      const result = await resolveId('Business/acme', registry, mockEnv)

      expect(result.DOClass).toBe(Business)
      expect(result.bindingName).toBe('DO') // Default binding
    })

    it('resolveId uses type-specific namespace binding', async () => {
      const { resolveId, TypeRegistry } = await import('../identity')

      const registry = new TypeRegistry()
      registry.register(Business, { binding: 'BUSINESS_DO' })

      const envWithMultiBindings = createMockEnv({
        BUSINESS_DO: {} as DurableObjectNamespace,
      })

      // RED: Should use type-specific binding when configured
      const result = await resolveId('Business/acme', registry, envWithMultiBindings)

      expect(result.bindingName).toBe('BUSINESS_DO')
    })

    it('resolveId generates deterministic DO ID', async () => {
      const { resolveId, TypeRegistry } = await import('../identity')

      const registry = new TypeRegistry()
      registry.register(Business)

      // RED: Same input should produce same DO ID
      const result1 = await resolveId('Business/acme', registry, mockEnv)
      const result2 = await resolveId('Business/acme', registry, mockEnv)

      expect(result1.doIdString).toBe(result2.doIdString)
    })

    it('different types with same ID produce different DO IDs', async () => {
      const { resolveId, TypeRegistry } = await import('../identity')

      const registry = new TypeRegistry()
      registry.register(Business)
      registry.register(App)

      // RED: Type is part of identity - same name, different type = different DO
      const business = await resolveId('Business/main', registry, mockEnv)
      const app = await resolveId('App/main', registry, mockEnv)

      expect(business.doIdString).not.toBe(app.doIdString)
    })
  })

  describe('Namespace Isolation', () => {
    it('same type+id in different namespaces are different DOs', async () => {
      const { resolveId, TypeRegistry } = await import('../identity')

      const registry = new TypeRegistry()
      registry.register(Business)

      const mockEnv = createMockEnv()

      // RED: Namespace provides isolation
      const acme = await resolveId('https://acme.do/Business/main', registry, mockEnv)
      const beta = await resolveId('https://beta.do/Business/main', registry, mockEnv)

      expect(acme.doIdString).not.toBe(beta.doIdString)
    })

    it('resolveId includes namespace in DO lookup key', async () => {
      const { resolveId, TypeRegistry } = await import('../identity')

      const registry = new TypeRegistry()
      registry.register(Business)

      const mockEnv = createMockEnv()

      // RED: The internal lookup key should include namespace
      const result = await resolveId('https://acme.do/Business/main', registry, mockEnv)

      expect(result.lookupKey).toBe('https://acme.do/Business/main')
    })
  })
})

// ============================================================================
// SECTION 4: TYPE REGISTRATION AND DISCOVERY
// ============================================================================

describe('Type Registration and Discovery', () => {
  describe('Automatic Registration', () => {
    it('@DOType decorator registers class', async () => {
      // RED: Decorator should auto-register the class
      const { DOType, TypeRegistry } = await import('../decorators')

      const registry = new TypeRegistry()

      @DOType({ registry })
      class CustomDO extends DO {
        static override $type = 'CustomDO'
      }

      expect(registry.get('CustomDO')).toBe(CustomDO)
    })

    it('@DOType decorator accepts custom type name', async () => {
      const { DOType, TypeRegistry } = await import('../decorators')

      const registry = new TypeRegistry()

      @DOType({ registry, name: 'MyCustomName' })
      class CustomDO extends DO {}

      // RED: Should register with custom name
      expect(registry.get('MyCustomName')).toBe(CustomDO)
      expect(registry.get('CustomDO')).toBeUndefined()
    })

    it('@DOType decorator specifies binding', async () => {
      const { DOType, TypeRegistry } = await import('../decorators')

      const registry = new TypeRegistry()

      @DOType({ registry, binding: 'CUSTOM_BINDING' })
      class CustomDO extends DO {
        static override $type = 'CustomDO'
      }

      // RED: Should record the binding name
      const meta = registry.getMetadata('CustomDO')
      expect(meta.binding).toBe('CUSTOM_BINDING')
    })
  })

  describe.skip('Type Discovery (NOT IMPLEMENTED - RED tests for future discovery module)', () => {
    it('discoverTypes finds all DO subclasses in module', async () => {
      const { discoverTypes } = await import('../discovery')
      const objectsModule = await import('../index')

      // RED: Should find all exported DO classes
      const types = discoverTypes(objectsModule)

      expect(types).toContain('Business')
      expect(types).toContain('Agent')
      expect(types).toContain('Human')
      expect(types).toContain('App')
      expect(types).toContain('Worker')
    })

    it('discoverTypes returns type metadata', async () => {
      const { discoverTypes } = await import('../discovery')
      const objectsModule = await import('../index')

      // RED: Should return metadata about each type
      const types = discoverTypes(objectsModule, { includeMetadata: true })

      expect(types.Business).toBeDefined()
      expect(types.Business.extends).toBe('DO')
      expect(types.Agent.extends).toBe('Worker')
    })

    it('autoRegister registers all discovered types', async () => {
      const { autoRegister, TypeRegistry } = await import('../discovery')
      const objectsModule = await import('../index')

      const registry = new TypeRegistry()

      // RED: Should register all discovered types
      autoRegister(objectsModule, registry)

      expect(registry.get('Business')).toBe(Business)
      expect(registry.get('Agent')).toBe(Agent)
    })
  })

  describe('Type Validation', () => {
    it('validateType checks for required $type property', async () => {
      const { validateType } = await import('../../lib/validation')

      // RED: Should reject classes without $type
      class InvalidDO extends DO {
        // No $type defined
      }

      expect(() => validateType(InvalidDO)).toThrow(/\$type/)
    })

    it('validateType checks $type matches class name', async () => {
      const { validateType } = await import('../../lib/validation')

      // RED: Should reject mismatched $type
      class MismatchedDO extends DO {
        static override $type = 'SomethingElse'
      }

      expect(() => validateType(MismatchedDO)).toThrow(/mismatch/)
    })

    it('validateType allows custom $type with explicit override', async () => {
      const { validateType } = await import('../../lib/validation')

      // RED: Should allow custom $type with explicit config
      class CustomDO extends DO {
        static override $type = 'MyCustomType'
      }

      expect(() => validateType(CustomDO, { allowCustomType: true })).not.toThrow()
    })

    it('validateType checks inheritance chain', async () => {
      const { validateType } = await import('../../lib/validation')

      // RED: Should verify class extends DO
      class NotADO {
        static $type = 'NotADO'
      }

      expect(() => validateType(NotADO)).toThrow(/must extend DO/)
    })
  })

  describe('Runtime Type Checking', () => {
    let mockState: DurableObjectState
    let mockEnv: Env

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
    })

    it('DO.isType checks exact type match', () => {
      const business = new Business(mockState, mockEnv)

      // RED: Should check for exact type
      expect((business as unknown as { isType(t: string): boolean }).isType('Business')).toBe(true)
      expect((business as unknown as { isType(t: string): boolean }).isType('DO')).toBe(false)
    })

    it('DO.extendsType checks type hierarchy', () => {
      const agent = new Agent(mockState, mockEnv)

      // RED: Should check full hierarchy
      expect((agent as unknown as { extendsType(t: string): boolean }).extendsType('Agent')).toBe(true)
      expect((agent as unknown as { extendsType(t: string): boolean }).extendsType('Worker')).toBe(true)
      expect((agent as unknown as { extendsType(t: string): boolean }).extendsType('DO')).toBe(true)
      expect((agent as unknown as { extendsType(t: string): boolean }).extendsType('Business')).toBe(false)
    })

    it('assertType throws for type mismatch', () => {
      const business = new Business(mockState, mockEnv)

      // RED: Should throw with descriptive error
      expect(() => {
        (business as unknown as { assertType(t: string): void }).assertType('Agent')
      }).toThrow(/expected Agent but got Business/)
    })

    it('DO serialization includes $type', async () => {
      const business = new Business(mockState, mockEnv)
      await business.initialize({ ns: 'https://test.do' })

      // RED: JSON serialization should include $type
      const json = (business as unknown as { toJSON(): Record<string, unknown> }).toJSON()

      expect(json.$type).toBe('Business')
      expect(json.ns).toBe('https://test.do')
    })
  })
})

// ============================================================================
// SECTION 5: EDGE CASES AND ERROR CONDITIONS
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  let mockState: DurableObjectState
  let mockEnv: Env

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
  })

  describe('Invalid Type Names', () => {
    it('rejects lowercase type names', async () => {
      const { TypeRegistry } = await import('../TypeRegistry')

      const registry = new TypeRegistry()

      // RED: Type names must be PascalCase
      class lowercase extends DO {
        static override $type = 'lowercase'
      }

      expect(() => registry.register(lowercase)).toThrow(/PascalCase/)
    })

    it('rejects type names with special characters', async () => {
      const { TypeRegistry } = await import('../TypeRegistry')

      const registry = new TypeRegistry()

      // RED: Type names should only contain alphanumeric chars
      class Bad_Name extends DO {
        static override $type = 'Bad_Name'
      }

      expect(() => registry.register(Bad_Name)).toThrow(/invalid.*character/i)
    })

    it('rejects reserved type names', async () => {
      const { TypeRegistry } = await import('../TypeRegistry')

      const registry = new TypeRegistry()

      // RED: Some names should be reserved
      class Object extends DO {
        static override $type = 'Object'
      }

      expect(() => registry.register(Object)).toThrow(/reserved/)
    })
  })

  describe('Missing or Invalid Configuration', () => {
    it('throws when DO binding is missing for dispatch', async () => {
      const { DODispatcher, TypeRegistry } = await import('../DODispatcher')

      const registry = new TypeRegistry()
      registry.register(Business)

      // No DO binding in env
      const dispatcher = new DODispatcher(registry, mockEnv)
      const request = new Request('https://api.do/Business/test')

      // RED: Should throw descriptive error about missing binding
      await expect(dispatcher.getStub(request)).rejects.toThrow(/DO.*binding.*not configured/i)
    })

    it('throws when type-specific binding is missing', async () => {
      const { resolveId, TypeRegistry } = await import('../identity')

      const registry = new TypeRegistry()
      registry.register(Business, { binding: 'BUSINESS_DO' })

      // Missing the BUSINESS_DO binding
      await expect(resolveId('Business/test', registry, mockEnv)).rejects.toThrow(
        /BUSINESS_DO.*not found/i,
      )
    })
  })

  describe('Type Collision Detection', () => {
    it('detects when two classes claim same $type', async () => {
      const { TypeRegistry } = await import('../TypeRegistry')

      const registry = new TypeRegistry()

      class CustomBusiness1 extends DO {
        static override $type = 'CustomBusiness'
      }

      class CustomBusiness2 extends DO {
        static override $type = 'CustomBusiness'
      }

      registry.register(CustomBusiness1)

      // RED: Should detect collision and provide clear error
      expect(() => registry.register(CustomBusiness2)).toThrow(
        /CustomBusiness.*already registered.*CustomBusiness1/i,
      )
    })
  })

  describe('Runtime Type Integrity', () => {
    it('detects $type tampering attempt', () => {
      const business = new Business(mockState, mockEnv)

      // RED: Attempting to change $type should be detected/prevented
      expect(() => {
        Object.defineProperty(business, '$type', { value: 'Hacked' })
      }).toThrow()
    })

    it('prototype.$type cannot be modified', () => {
      // RED: Prototype-level $type should be protected
      expect(() => {
        (Business.prototype as unknown as { $type: string }).$type = 'Hacked'
      }).toThrow()
    })
  })
})

// ============================================================================
// TYPE DECLARATIONS FOR TESTS
// ============================================================================

interface DurableObjectState {
  id: { toString(): string; equals(other: { toString(): string }): boolean; name?: string }
  storage: unknown
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

interface DurableObjectNamespace {
  idFromName(name: string): unknown
  idFromString(id: string): unknown
  newUniqueId(options?: { jurisdiction?: string }): unknown
  get(id: unknown): unknown
}
