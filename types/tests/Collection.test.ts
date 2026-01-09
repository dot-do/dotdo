import { describe, it, expect, expectTypeOf } from 'vitest'

/**
 * Collection Type Tests (RED Phase - TDD)
 *
 * Issue: dotdo-yvn5n
 *
 * These tests verify that the Collection type exists and has expected properties:
 * - Collection interface exists (renamed from Things)
 * - Collection has expected methods (list, get, create, etc.)
 * - CollectionStore type exists
 * - Imports from 'dotdo/types' work
 *
 * Tests will FAIL because some types/methods don't exist yet.
 * This is intentional - RED phase of TDD.
 */

// ============================================================================
// Import types - Test that Collection is exported
// ============================================================================

import type {
  Collection,
  CollectionData,
  CollectionFactory,
  Thing,
} from '../Collection'

// Import from index to verify 'dotdo/types' style import works
import type {
  Collection as IndexCollection,
  CollectionData as IndexCollectionData,
} from '../index'

// This import will FAIL - CollectionStore doesn't exist yet
import type { CollectionStore } from '../Collection'

// ============================================================================
// Test Types
// ============================================================================

interface User extends Thing {
  $id: string
  $type: string
  name: string
  email: string
  role: 'admin' | 'user'
}

interface Product extends Thing {
  $id: string
  $type: string
  name: string
  price: number
  sku: string
}

// ============================================================================
// 1. Collection Interface Exists Tests
// ============================================================================

describe('Collection Interface Exists', () => {
  it('should export Collection type', () => {
    type C = Collection
    expectTypeOf<C>().toBeObject()
  })

  it('should export Collection<T> generic type', () => {
    type UserCollection = Collection<User>
    expectTypeOf<UserCollection>().toBeObject()
  })

  it('should export CollectionData type', () => {
    type CD = CollectionData
    expectTypeOf<CD>().toBeObject()
  })

  it('Collection should extend CollectionData', () => {
    type ExtendsData = Collection extends CollectionData ? true : false
    expectTypeOf<ExtendsData>().toEqualTypeOf<true>()
  })

  it('Collection should be renamed from Things', () => {
    // This test documents the rename: Things -> Collection
    // Both should be the same type
    type C = Collection<User>
    expectTypeOf<C>().toBeObject()
  })
})

// ============================================================================
// 2. Collection Has Expected Methods Tests
// ============================================================================

describe('Collection Expected Methods', () => {
  describe('CRUD methods', () => {
    it('Collection should have get method', () => {
      type HasGet = Collection<User> extends { get: any } ? true : false
      expectTypeOf<HasGet>().toEqualTypeOf<true>()
    })

    it('get should accept id and return Promise<T | null>', () => {
      type GetMethod = Collection<User>['get']

      expectTypeOf<GetMethod>().toBeFunction()
      expectTypeOf<GetMethod>().parameter(0).toBeString()

      type ReturnType = GetMethod extends (id: string) => Promise<infer R> ? R : never
      expectTypeOf<ReturnType>().toEqualTypeOf<User | null>()
    })

    it('Collection should have create method', () => {
      type HasCreate = Collection<User> extends { create: any } ? true : false
      expectTypeOf<HasCreate>().toEqualTypeOf<true>()
    })

    it('create should accept id and data, return Promise<T>', () => {
      type CreateMethod = Collection<User>['create']

      expectTypeOf<CreateMethod>().toBeFunction()

      // First param is id (string)
      expectTypeOf<CreateMethod>().parameter(0).toBeString()

      type ReturnType = CreateMethod extends (id: string, data: any) => Promise<infer R> ? R : never
      expectTypeOf<ReturnType>().toEqualTypeOf<User>()
    })

    it('Collection should have update method', () => {
      type HasUpdate = Collection<User> extends { update: any } ? true : false
      expectTypeOf<HasUpdate>().toEqualTypeOf<true>()
    })

    it('update should accept id and partial data, return Promise<T>', () => {
      type UpdateMethod = Collection<User>['update']

      expectTypeOf<UpdateMethod>().toBeFunction()
      expectTypeOf<UpdateMethod>().parameter(0).toBeString()

      type ReturnType = UpdateMethod extends (id: string, data: any) => Promise<infer R> ? R : never
      expectTypeOf<ReturnType>().toEqualTypeOf<User>()
    })

    it('Collection should have delete method', () => {
      type HasDelete = Collection<User> extends { delete: any } ? true : false
      expectTypeOf<HasDelete>().toEqualTypeOf<true>()
    })

    it('delete should accept id and return Promise<void>', () => {
      type DeleteMethod = Collection<User>['delete']

      expectTypeOf<DeleteMethod>().toBeFunction()
      expectTypeOf<DeleteMethod>().parameter(0).toBeString()

      type ReturnType = DeleteMethod extends (id: string) => Promise<infer R> ? R : never
      expectTypeOf<ReturnType>().toEqualTypeOf<void>()
    })
  })

  describe('Query methods', () => {
    it('Collection should have list method', () => {
      type HasList = Collection<User> extends { list: any } ? true : false
      expectTypeOf<HasList>().toEqualTypeOf<true>()
    })

    it('list should return Promise with items and cursor', () => {
      type ListMethod = Collection<User>['list']

      expectTypeOf<ListMethod>().toBeFunction()

      type ReturnType = ListMethod extends (options?: any) => Promise<infer R> ? R : never
      type HasItems = ReturnType extends { items: User[] } ? true : false
      expectTypeOf<HasItems>().toEqualTypeOf<true>()
    })

    it('Collection should have find method', () => {
      type HasFind = Collection<User> extends { find: any } ? true : false
      expectTypeOf<HasFind>().toEqualTypeOf<true>()
    })

    it('find should accept query and return Promise<T[]>', () => {
      type FindMethod = Collection<User>['find']

      expectTypeOf<FindMethod>().toBeFunction()

      type ReturnType = FindMethod extends (query: any) => Promise<infer R> ? R : never
      expectTypeOf<ReturnType>().toEqualTypeOf<User[]>()
    })

    it('Collection should have count method', () => {
      type HasCount = Collection<User> extends { count: any } ? true : false
      expectTypeOf<HasCount>().toEqualTypeOf<true>()
    })

    it('count should return Promise<number>', () => {
      type CountMethod = Collection<User>['count']

      expectTypeOf<CountMethod>().toBeFunction()

      type ReturnType = CountMethod extends (query?: any) => Promise<infer R> ? R : never
      expectTypeOf<ReturnType>().toEqualTypeOf<number>()
    })
  })

  describe('ID construction', () => {
    it('Collection should have buildItemId method', () => {
      type HasBuildItemId = Collection<User> extends { buildItemId: any } ? true : false
      expectTypeOf<HasBuildItemId>().toEqualTypeOf<true>()
    })

    it('buildItemId should accept id and return string', () => {
      type BuildItemIdMethod = Collection<User>['buildItemId']

      expectTypeOf<BuildItemIdMethod>().toBeFunction()
      expectTypeOf<BuildItemIdMethod>().parameter(0).toBeString()
      expectTypeOf<BuildItemIdMethod>().returns.toBeString()
    })
  })
})

// ============================================================================
// 3. CollectionStore Type Exists Tests (WILL FAIL - type doesn't exist)
// ============================================================================

describe('CollectionStore Type', () => {
  it('should export CollectionStore type', () => {
    // This will FAIL because CollectionStore doesn't exist yet
    type CS = CollectionStore
    expectTypeOf<CS>().toBeObject()
  })

  it('CollectionStore should be a storage interface', () => {
    // CollectionStore should provide persistence operations
    type CS = CollectionStore

    // Should have methods for persistence
    type HasPersist = CS extends { persist: any } ? true : false
    expectTypeOf<HasPersist>().toEqualTypeOf<true>()
  })

  it('CollectionStore should have load method', () => {
    type CS = CollectionStore

    type HasLoad = CS extends { load: any } ? true : false
    expectTypeOf<HasLoad>().toEqualTypeOf<true>()
  })

  it('CollectionStore should have sync method', () => {
    type CS = CollectionStore

    type HasSync = CS extends { sync: any } ? true : false
    expectTypeOf<HasSync>().toEqualTypeOf<true>()
  })
})

// ============================================================================
// 4. Imports from 'dotdo/types' Work
// ============================================================================

describe("Imports from 'dotdo/types' Work", () => {
  it('Collection should be importable from index', () => {
    type C = IndexCollection
    expectTypeOf<C>().toBeObject()
  })

  it('CollectionData should be importable from index', () => {
    type CD = IndexCollectionData
    expectTypeOf<CD>().toBeObject()
  })

  it('Index Collection should equal direct Collection import', () => {
    type AreSame = IndexCollection extends Collection ? (Collection extends IndexCollection ? true : false) : false
    expectTypeOf<AreSame>().toEqualTypeOf<true>()
  })

  it('Index CollectionData should equal direct CollectionData import', () => {
    type AreSame = IndexCollectionData extends CollectionData ? (CollectionData extends IndexCollectionData ? true : false) : false
    expectTypeOf<AreSame>().toEqualTypeOf<true>()
  })
})

// ============================================================================
// 5. CollectionData Properties Tests
// ============================================================================

describe('CollectionData Properties', () => {
  it('should have $id property', () => {
    type HasId = CollectionData extends { readonly $id: string } ? true : false
    expectTypeOf<HasId>().toEqualTypeOf<true>()
  })

  it('should have $type property', () => {
    type HasType = CollectionData extends { readonly $type: any } ? true : false
    expectTypeOf<HasType>().toEqualTypeOf<true>()
  })

  it('should have ns property', () => {
    type HasNs = CollectionData extends { readonly ns: string } ? true : false
    expectTypeOf<HasNs>().toEqualTypeOf<true>()
  })

  it('should have itemType property', () => {
    type HasItemType = CollectionData extends { readonly itemType: string } ? true : false
    expectTypeOf<HasItemType>().toEqualTypeOf<true>()
  })

  it('should have optional name property', () => {
    type HasName = CollectionData extends { name?: string } ? true : false
    expectTypeOf<HasName>().toEqualTypeOf<true>()
  })

  it('should have optional description property', () => {
    type HasDescription = CollectionData extends { description?: string } ? true : false
    expectTypeOf<HasDescription>().toEqualTypeOf<true>()
  })

  it('should have createdAt property', () => {
    type HasCreatedAt = CollectionData extends { createdAt: Date } ? true : false
    expectTypeOf<HasCreatedAt>().toEqualTypeOf<true>()
  })

  it('should have updatedAt property', () => {
    type HasUpdatedAt = CollectionData extends { updatedAt: Date } ? true : false
    expectTypeOf<HasUpdatedAt>().toEqualTypeOf<true>()
  })
})

// ============================================================================
// 6. CollectionFactory Type Tests
// ============================================================================

describe('CollectionFactory Type', () => {
  it('should export CollectionFactory type', () => {
    type CF = CollectionFactory
    expectTypeOf<CF>().toBeFunction()
  })

  it('CollectionFactory should accept type string and return Collection', () => {
    type CF = CollectionFactory

    // Should be a function that creates collections
    type IsFactory = CF extends (type: string) => Collection<any> ? true : false
    expectTypeOf<IsFactory>().toEqualTypeOf<true>()
  })

  it('CollectionFactory should be generic', () => {
    type CF = CollectionFactory

    // Should support generic type parameter
    // CF should be a function: <T extends Thing = Thing>(type: string) => Collection<T>
    type IsGenericFactory = CF extends <T extends Thing>(type: string) => Collection<T> ? true : false
    expectTypeOf<IsGenericFactory>().toEqualTypeOf<true>()

    // Note: This tests the generic signature
    expectTypeOf<CF>().toBeFunction()
  })
})

// ============================================================================
// 7. Collection Generic Type Parameter Tests
// ============================================================================

describe('Collection Generic Type Parameter', () => {
  it('Collection<User> should type CRUD operations with User', () => {
    type UserCollection = Collection<User>

    // get should return User
    type GetReturn = UserCollection['get'] extends (id: string) => Promise<infer R> ? R : never
    expectTypeOf<GetReturn>().toEqualTypeOf<User | null>()

    // create should return User
    type CreateReturn = UserCollection['create'] extends (id: string, data: any) => Promise<infer R> ? R : never
    expectTypeOf<CreateReturn>().toEqualTypeOf<User>()
  })

  it('Collection<Product> should type CRUD operations with Product', () => {
    type ProductCollection = Collection<Product>

    // get should return Product
    type GetReturn = ProductCollection['get'] extends (id: string) => Promise<infer R> ? R : never
    expectTypeOf<GetReturn>().toEqualTypeOf<Product | null>()
  })

  it('Collection<Thing> should be the default', () => {
    type DefaultCollection = Collection

    // Default should use Thing
    type GetReturn = DefaultCollection['get'] extends (id: string) => Promise<infer R> ? R : never
    expectTypeOf<GetReturn>().toEqualTypeOf<Thing | null>()
  })
})

// ============================================================================
// 8. Type Safety Tests
// ============================================================================

describe('Collection Type Safety', () => {
  it('Collection<User> should not accept Product in create', () => {
    type UserCollection = Collection<User>
    type CreateMethod = UserCollection['create']

    // The data param should be Partial<Omit<User, '$id' | '$type'>>
    // Product should not be directly assignable
    type CreateDataType = CreateMethod extends (id: string, data: infer D) => any ? D : never

    // Should be partial User data, not Product
    type IsUserData = CreateDataType extends Partial<Omit<User, '$id' | '$type'>> ? true : false
    expectTypeOf<IsUserData>().toEqualTypeOf<true>()
  })

  it('get should return T | null, not just T', () => {
    type UserCollection = Collection<User>
    type GetReturn = UserCollection['get'] extends (id: string) => Promise<infer R> ? R : never

    // Should include null possibility
    type IncludesNull = null extends GetReturn ? true : false
    expectTypeOf<IncludesNull>().toEqualTypeOf<true>()
  })
})

// ============================================================================
// 9. Comparison with Things Type (Backward Compatibility)
// ============================================================================

describe('Collection vs Things Backward Compatibility', () => {
  // Import Things to verify it still exists
  it('Things type should still exist for backward compatibility', async () => {
    // This tests that Things is still exported
    const { Things } = await import('../Things')

    // Things should exist as a type or value
    expect(Things).toBeDefined()
  })

  it('Collection should have similar interface to Things', () => {
    // Both should have CRUD methods
    type CollectionMethods = keyof Collection<User>

    // Collection should have at minimum: get, create, update, delete, list, find, count
    type HasGet = 'get' extends CollectionMethods ? true : false
    type HasCreate = 'create' extends CollectionMethods ? true : false
    type HasUpdate = 'update' extends CollectionMethods ? true : false
    type HasDelete = 'delete' extends CollectionMethods ? true : false

    expectTypeOf<HasGet>().toEqualTypeOf<true>()
    expectTypeOf<HasCreate>().toEqualTypeOf<true>()
    expectTypeOf<HasUpdate>().toEqualTypeOf<true>()
    expectTypeOf<HasDelete>().toEqualTypeOf<true>()
  })
})

// ============================================================================
// 10. Integration Tests
// ============================================================================

describe('Collection Integration Patterns', () => {
  it('should support typed collection creation', () => {
    // Simulates: const users = collection<User>('User')
    type CF = CollectionFactory

    // Factory should return typed collection
    expectTypeOf<CF>().toBeFunction()
  })

  it('should support async iteration pattern', () => {
    type UserCollection = Collection<User>

    // list should return items for iteration
    type ListReturn = UserCollection['list'] extends (options?: any) => Promise<infer R> ? R : never
    type HasItems = ListReturn extends { items: User[] } ? true : false
    expectTypeOf<HasItems>().toEqualTypeOf<true>()
  })

  it('should support pagination pattern', () => {
    type UserCollection = Collection<User>

    // list should support cursor-based pagination
    type ListReturn = UserCollection['list'] extends (options?: any) => Promise<infer R> ? R : never
    type HasCursor = ListReturn extends { cursor?: string } ? true : false
    expectTypeOf<HasCursor>().toEqualTypeOf<true>()
  })
})
