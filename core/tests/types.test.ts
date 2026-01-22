/**
 * Tests for types.ts
 *
 * Type tests to ensure type definitions work correctly at compile time.
 * These tests verify type compatibility and inference.
 */

import { describe, it, expect } from 'vitest'
import type {
  JsonPrimitive,
  JsonArray,
  JsonValue,
  JsonObject,
  StorableData,
  Thing,
  CreateThingInput,
  Relationship,
  CreateRelationshipInput,
  QueryOptions,
  SearchOptions,
  PaginatedResult,
  CursorResult,
  TypeSchema,
  Discriminated,
} from '../src/index'

describe('Type Definitions', () => {
  describe('JSON Types', () => {
    it('should allow valid JsonPrimitive values', () => {
      // Type tests - if these compile, the types are correct
      const str: JsonPrimitive = 'hello'
      const num: JsonPrimitive = 42
      const bool: JsonPrimitive = true
      const nil: JsonPrimitive = null

      expect(str).toBe('hello')
      expect(num).toBe(42)
      expect(bool).toBe(true)
      expect(nil).toBeNull()
    })

    it('should allow valid JsonArray values', () => {
      const arr: JsonArray = [1, 'two', true, null, { nested: 'object' }]
      expect(arr).toHaveLength(5)
    })

    it('should allow valid JsonValue values', () => {
      const values: JsonValue[] = [
        'string',
        123,
        true,
        null,
        [1, 2, 3],
        { key: 'value', nested: { deep: true } },
      ]
      expect(values).toHaveLength(6)
    })

    it('should allow valid JsonObject values', () => {
      const obj: JsonObject = {
        string: 'value',
        number: 42,
        boolean: false,
        null: null,
        array: [1, 2, 3],
        nested: { key: 'value' },
      }
      expect(Object.keys(obj)).toHaveLength(6)
    })

    it('should allow valid StorableData values', () => {
      const data: StorableData = {
        name: 'Test',
        count: 5,
        active: true,
        metadata: { tags: ['a', 'b'] },
      }
      expect(data.name).toBe('Test')
    })
  })

  describe('Thing Type', () => {
    it('should have correct shape with generic data', () => {
      interface UserData extends StorableData {
        name: string
        email: string
      }

      const user: Thing<UserData> = {
        ns: 'example.com',
        type: 'User',
        id: 'user-123',
        url: 'https://example.com/User/user-123',
        createdAt: new Date(),
        updatedAt: new Date(),
        data: { name: 'Alice', email: 'alice@example.com' },
      }

      expect(user.ns).toBe('example.com')
      expect(user.type).toBe('User')
      expect(user.id).toBe('user-123')
      expect(user.data.name).toBe('Alice')
      expect(user.data.email).toBe('alice@example.com')
    })

    it('should have correct shape with default StorableData', () => {
      const thing: Thing = {
        ns: 'app',
        type: 'Generic',
        id: 'id-1',
        url: 'https://app/Generic/id-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        data: { arbitrary: 'data', nested: { value: 123 } },
      }

      expect(thing.data.arbitrary).toBe('data')
    })
  })

  describe('CreateThingInput Type', () => {
    it('should allow optional id', () => {
      const withId: CreateThingInput = {
        ns: 'app',
        type: 'Test',
        id: 'explicit-id',
        data: { key: 'value' },
      }

      const withoutId: CreateThingInput = {
        ns: 'app',
        type: 'Test',
        data: { key: 'value' },
      }

      expect(withId.id).toBe('explicit-id')
      expect(withoutId.id).toBeUndefined()
    })

    it('should support generic data type', () => {
      interface Config extends StorableData {
        setting: string
        enabled: boolean
      }

      const input: CreateThingInput<Config> = {
        ns: 'app',
        type: 'Config',
        data: { setting: 'dark-mode', enabled: true },
      }

      expect(input.data.setting).toBe('dark-mode')
      expect(input.data.enabled).toBe(true)
    })
  })

  describe('Relationship Type', () => {
    it('should have correct shape', () => {
      const rel: Relationship = {
        id: 'rel-123',
        type: 'follows',
        from: 'https://app/User/alice',
        to: 'https://app/User/bob',
        createdAt: new Date(),
      }

      expect(rel.type).toBe('follows')
      expect(rel.from).toContain('alice')
      expect(rel.to).toContain('bob')
    })

    it('should support optional data', () => {
      interface FollowData extends StorableData {
        since: string
        notifications: boolean
      }

      const relWithData: Relationship<FollowData> = {
        id: 'rel-456',
        type: 'follows',
        from: 'a',
        to: 'b',
        createdAt: new Date(),
        data: { since: '2024-01-01', notifications: true },
      }

      expect(relWithData.data?.since).toBe('2024-01-01')
    })
  })

  describe('CreateRelationshipInput Type', () => {
    it('should have correct shape', () => {
      const input: CreateRelationshipInput = {
        type: 'likes',
        from: 'https://app/User/user-1',
        to: 'https://app/Post/post-1',
      }

      expect(input.type).toBe('likes')
    })

    it('should support optional data', () => {
      const inputWithData: CreateRelationshipInput<{ weight: number }> = {
        type: 'rated',
        from: 'a',
        to: 'b',
        data: { weight: 5 },
      }

      expect(inputWithData.data?.weight).toBe(5)
    })
  })

  describe('QueryOptions Type', () => {
    it('should allow all optional fields', () => {
      const fullOptions: QueryOptions = {
        ns: 'app',
        type: 'User',
        where: { active: true },
        orderBy: 'createdAt',
        order: 'desc',
        limit: 10,
        offset: 5,
      }

      expect(fullOptions.limit).toBe(10)
    })

    it('should allow empty options', () => {
      const emptyOptions: QueryOptions = {}
      expect(Object.keys(emptyOptions)).toHaveLength(0)
    })
  })

  describe('SearchOptions Type', () => {
    it('should require query field', () => {
      const options: SearchOptions = {
        query: 'search term',
      }

      expect(options.query).toBe('search term')
    })

    it('should allow optional fields', () => {
      const options: SearchOptions = {
        query: 'search',
        fields: ['title', 'body'],
        limit: 20,
      }

      expect(options.fields).toHaveLength(2)
    })
  })

  describe('PaginatedResult Type', () => {
    it('should have correct shape', () => {
      interface User {
        id: string
        name: string
      }

      const result: PaginatedResult<User> = {
        items: [
          { id: '1', name: 'Alice' },
          { id: '2', name: 'Bob' },
        ],
        total: 100,
        offset: 0,
        limit: 10,
        hasMore: true,
      }

      expect(result.items).toHaveLength(2)
      expect(result.total).toBe(100)
      expect(result.hasMore).toBe(true)
    })
  })

  describe('CursorResult Type', () => {
    it('should have correct shape', () => {
      const result: CursorResult<string> = {
        items: ['a', 'b', 'c'],
        cursor: 'next-page-cursor',
        hasMore: true,
      }

      expect(result.items).toHaveLength(3)
      expect(result.cursor).toBe('next-page-cursor')
    })

    it('should allow undefined cursor', () => {
      const result: CursorResult<number> = {
        items: [1, 2, 3],
        hasMore: false,
      }

      expect(result.cursor).toBeUndefined()
      expect(result.hasMore).toBe(false)
    })
  })

  describe('TypeSchema Type', () => {
    it('should have required $type field', () => {
      const schema: TypeSchema = {
        $type: 'User',
        name: 'string!',
        email: 'string!',
      }

      expect(schema.$type).toBe('User')
    })

    it('should support inheritance with $extends', () => {
      const schema: TypeSchema = {
        $type: 'AdminUser',
        $extends: 'User',
        permissions: 'string[]!',
      }

      expect(schema.$extends).toBe('User')
    })

    it('should support abstract types', () => {
      const schema: TypeSchema = {
        $type: 'BaseEntity',
        $abstract: true,
        id: 'uuid!',
      }

      expect(schema.$abstract).toBe(true)
    })

    it('should support index definitions', () => {
      const schema: TypeSchema = {
        $type: 'Post',
        $index: [['authorId'], ['createdAt', 'status']],
        authorId: 'uuid!',
        status: 'string!',
      }

      expect(schema.$index).toHaveLength(2)
    })
  })

  describe('Discriminated Type', () => {
    it('should have $type discriminator', () => {
      const item: Discriminated<'User'> = {
        $type: 'User',
      }

      expect(item.$type).toBe('User')
    })

    it('should work with union types', () => {
      interface Cat extends Discriminated<'Cat'> {
        meow: () => string
      }

      interface Dog extends Discriminated<'Dog'> {
        bark: () => string
      }

      type Pet = Cat | Dog

      const cat: Pet = { $type: 'Cat', meow: () => 'meow' }
      const dog: Pet = { $type: 'Dog', bark: () => 'woof' }

      expect(cat.$type).toBe('Cat')
      expect(dog.$type).toBe('Dog')
    })
  })
})
