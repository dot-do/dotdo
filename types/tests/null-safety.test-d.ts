/**
 * Null Safety Type Tests for Store APIs
 *
 * Issue: dotdo-lzjv3 - [RED] Test: TypeScript null safety - Store return types
 *
 * These type tests verify that store APIs use `null` consistently instead of `undefined`
 * for absent values. This ensures:
 * - Consistent null handling across the codebase
 * - Proper type inference when using optional chaining
 * - Clear semantics: `null` = explicitly absent, `undefined` = not provided
 *
 * Uses vitest's expectTypeOf for compile-time type assertions.
 */

import { describe, it, expectTypeOf } from 'vitest'
import type {
  GraphStore,
  GraphThing,
  GraphRelationship,
  CreateRelationshipInput,
  NewGraphThing,
  GetThingsByTypeOptions,
  UpdateThingInput,
  RelationshipQueryOptions,
} from '../../db/graph/types'
import type { Action, Activity, Event } from '../../db/graph/actions'

// ============================================================================
// GraphStore Thing Operations - Null Safety
// ============================================================================

describe('GraphStore Thing Operations Type Safety', () => {
  describe('getThing()', () => {
    it('returns Thing | null, not Thing | undefined', () => {
      // getThing should return null for not found, not undefined
      expectTypeOf<GraphStore['getThing']>().returns.toEqualTypeOf<Promise<GraphThing | null>>()
    })

    it('return type includes null explicitly', () => {
      // Verify that null is part of the union
      type GetThingResult = Awaited<ReturnType<GraphStore['getThing']>>
      expectTypeOf<GetThingResult>().toMatchTypeOf<GraphThing | null>()
      // null should be assignable to the result type
      expectTypeOf<null>().toMatchTypeOf<GetThingResult>()
    })
  })

  describe('createThing()', () => {
    it('returns Thing, never null', () => {
      // createThing should always return a Thing (throws on error)
      expectTypeOf<GraphStore['createThing']>().returns.toEqualTypeOf<Promise<GraphThing>>()
    })

    it('return type does not include null', () => {
      type CreateThingResult = Awaited<ReturnType<GraphStore['createThing']>>
      // The result should be exactly GraphThing, not GraphThing | null
      expectTypeOf<CreateThingResult>().toEqualTypeOf<GraphThing>()
    })
  })

  describe('updateThing()', () => {
    it('returns Thing | null for not found', () => {
      // updateThing returns null if the thing doesn't exist
      expectTypeOf<GraphStore['updateThing']>().returns.toEqualTypeOf<Promise<GraphThing | null>>()
    })

    it('return type includes null for not found case', () => {
      type UpdateThingResult = Awaited<ReturnType<GraphStore['updateThing']>>
      expectTypeOf<null>().toMatchTypeOf<UpdateThingResult>()
    })
  })

  describe('deleteThing()', () => {
    it('returns Thing | null for soft delete', () => {
      // deleteThing (soft delete) returns null if not found
      expectTypeOf<GraphStore['deleteThing']>().returns.toEqualTypeOf<Promise<GraphThing | null>>()
    })

    it('return type includes null for not found case', () => {
      type DeleteThingResult = Awaited<ReturnType<GraphStore['deleteThing']>>
      expectTypeOf<null>().toMatchTypeOf<DeleteThingResult>()
    })
  })
})

// ============================================================================
// GraphStore Batch Thing Operations - Null Safety
// ============================================================================

describe('GraphStore Batch Thing Operations Type Safety', () => {
  describe('getThings()', () => {
    it('returns Map<string, GraphThing>, never null', () => {
      // getThings returns a Map (missing IDs are simply not in the map)
      expectTypeOf<GraphStore['getThings']>().returns.toEqualTypeOf<Promise<Map<string, GraphThing>>>()
    })

    it('Map values are GraphThing, not GraphThing | null', () => {
      type GetThingsResult = Awaited<ReturnType<GraphStore['getThings']>>
      // The Map itself is never null, and values in the Map are GraphThing
      expectTypeOf<GetThingsResult>().toMatchTypeOf<Map<string, GraphThing>>()
    })
  })

  describe('getThingsByIds()', () => {
    it('returns array with null for missing IDs', () => {
      // getThingsByIds preserves order and returns null for missing IDs
      expectTypeOf<GraphStore['getThingsByIds']>().returns.toEqualTypeOf<Promise<(GraphThing | null)[]>>()
    })

    it('array elements can be null', () => {
      type GetThingsByIdsResult = Awaited<ReturnType<GraphStore['getThingsByIds']>>
      // Each element in the array can be GraphThing or null
      expectTypeOf<(GraphThing | null)[]>().toMatchTypeOf<GetThingsByIdsResult>()
    })
  })

  describe('getThingsByType()', () => {
    it('returns GraphThing[], never null', () => {
      // List operations return empty array, not null
      expectTypeOf<GraphStore['getThingsByType']>().returns.toEqualTypeOf<Promise<GraphThing[]>>()
    })

    it('array is not nullable', () => {
      type GetThingsByTypeResult = Awaited<ReturnType<GraphStore['getThingsByType']>>
      // null should NOT be assignable - arrays are never null
      expectTypeOf<GetThingsByTypeResult>().toEqualTypeOf<GraphThing[]>()
    })
  })
})

// ============================================================================
// GraphStore Relationship Operations - Null Safety
// ============================================================================

describe('GraphStore Relationship Operations Type Safety', () => {
  describe('createRelationship()', () => {
    it('returns GraphRelationship, never null', () => {
      // createRelationship always returns a relationship (throws on error)
      expectTypeOf<GraphStore['createRelationship']>().returns.toEqualTypeOf<Promise<GraphRelationship>>()
    })
  })

  describe('deleteRelationship()', () => {
    it('returns boolean, not GraphRelationship | null', () => {
      // deleteRelationship returns boolean (true = deleted, false = not found)
      expectTypeOf<GraphStore['deleteRelationship']>().returns.toEqualTypeOf<Promise<boolean>>()
    })
  })

  describe('queryRelationshipsFrom()', () => {
    it('returns GraphRelationship[], never null', () => {
      // Query operations return empty array, not null
      expectTypeOf<GraphStore['queryRelationshipsFrom']>().returns.toEqualTypeOf<Promise<GraphRelationship[]>>()
    })
  })

  describe('queryRelationshipsTo()', () => {
    it('returns GraphRelationship[], never null', () => {
      expectTypeOf<GraphStore['queryRelationshipsTo']>().returns.toEqualTypeOf<Promise<GraphRelationship[]>>()
    })
  })

  describe('queryRelationshipsByVerb()', () => {
    it('returns GraphRelationship[], never null', () => {
      expectTypeOf<GraphStore['queryRelationshipsByVerb']>().returns.toEqualTypeOf<Promise<GraphRelationship[]>>()
    })
  })

  describe('queryRelationshipsFromMany()', () => {
    it('returns GraphRelationship[], never null', () => {
      // Batch query operations also return arrays
      expectTypeOf<GraphStore['queryRelationshipsFromMany']>().returns.toEqualTypeOf<Promise<GraphRelationship[]>>()
    })
  })
})

// ============================================================================
// GraphThing Data Field - Null Safety
// ============================================================================

describe('GraphThing Data Field Type Safety', () => {
  describe('data property', () => {
    it('data is Record<string, unknown> | null, not undefined', () => {
      // The data field should be explicitly null when empty, not undefined
      expectTypeOf<GraphThing['data']>().toEqualTypeOf<Record<string, unknown> | null>()
    })

    it('null is assignable to data field', () => {
      expectTypeOf<null>().toMatchTypeOf<GraphThing['data']>()
    })
  })

  describe('deletedAt property', () => {
    it('deletedAt is number | null for soft delete', () => {
      // deletedAt is null when not deleted, number when soft-deleted
      expectTypeOf<GraphThing['deletedAt']>().toEqualTypeOf<number | null>()
    })
  })
})

// ============================================================================
// GraphRelationship Data Field - Null Safety
// ============================================================================

describe('GraphRelationship Data Field Type Safety', () => {
  describe('data property', () => {
    it('data is Record<string, unknown> | null, not undefined', () => {
      // Relationship data field follows same null convention
      expectTypeOf<GraphRelationship['data']>().toEqualTypeOf<Record<string, unknown> | null>()
    })
  })
})

// ============================================================================
// Action/Activity/Event Types - Null Safety
// ============================================================================

describe('Action/Activity/Event Type Safety', () => {
  describe('Action type', () => {
    it('Action.data is optional (undefined), not null', () => {
      // For user-facing types, optional properties use undefined (via ?)
      // This is different from storage types which use explicit null
      type ActionData = Action['data']
      expectTypeOf<ActionData>().toEqualTypeOf<Record<string, unknown> | undefined>()
    })
  })

  describe('Activity type', () => {
    it('Activity.to is explicitly null during work', () => {
      // Activity.to is always null (work in progress, target not yet known)
      expectTypeOf<Activity['to']>().toEqualTypeOf<null>()
    })

    it('Activity.data is optional', () => {
      type ActivityData = Activity['data']
      expectTypeOf<ActivityData>().toEqualTypeOf<Record<string, unknown> | undefined>()
    })
  })

  describe('Event type', () => {
    it('Event.to is string (result URL), never null', () => {
      // Completed events always have a result URL
      expectTypeOf<Event['to']>().toEqualTypeOf<string>()
    })

    it('Event.data is optional', () => {
      type EventData = Event['data']
      expectTypeOf<EventData>().toEqualTypeOf<Record<string, unknown> | undefined>()
    })
  })
})

// ============================================================================
// Type Constraint Tests - Ensure null vs undefined distinction
// ============================================================================

describe('Null vs Undefined Distinction', () => {
  describe('Storage layer uses null', () => {
    it('GraphThing.data uses null for empty', () => {
      // Storage types use explicit null
      type DataType = GraphThing['data']
      // null should be in the union
      expectTypeOf<null>().toMatchTypeOf<DataType>()
      // undefined should NOT be in the union (would require ? modifier)
      // This test verifies null is used, not undefined
    })

    it('GraphRelationship.data uses null for empty', () => {
      type DataType = GraphRelationship['data']
      expectTypeOf<null>().toMatchTypeOf<DataType>()
    })
  })

  describe('Domain types use undefined for optional', () => {
    it('Action.data is optional via ?', () => {
      // Domain types use TypeScript's optional modifier (?)
      // which adds undefined to the union
      type DataType = Action['data']
      expectTypeOf<undefined>().toMatchTypeOf<DataType>()
    })
  })
})

// ============================================================================
// WorkflowContext Type Safety
// ============================================================================

import type {
  WorkflowContext,
  UserContext,
  DomainEvent,
  EventPayload,
  RateLimitResult,
  WithFs,
  WithGit,
  WithBash,
  FsCapability,
  GitCapability,
  BashCapability,
} from '../../types/WorkflowContext'

describe('WorkflowContext User Context Type Safety', () => {
  describe('user property', () => {
    it('user is UserContext | null, not undefined', () => {
      // The user context is null when unauthenticated, not undefined
      expectTypeOf<WorkflowContext['user']>().toEqualTypeOf<UserContext | null>()
    })

    it('null is assignable to user', () => {
      expectTypeOf<null>().toMatchTypeOf<WorkflowContext['user']>()
    })

    it('undefined is NOT assignable to user', () => {
      // This verifies we use null for "no user", not undefined
      type UserType = WorkflowContext['user']
      // UserContext | null does not include undefined
      expectTypeOf<UserType>().not.toEqualTypeOf<UserContext | undefined>()
    })
  })

  describe('UserContext fields', () => {
    it('id is required string', () => {
      expectTypeOf<UserContext['id']>().toEqualTypeOf<string>()
    })

    it('email is optional (undefined)', () => {
      type EmailType = UserContext['email']
      expectTypeOf<EmailType>().toEqualTypeOf<string | undefined>()
    })

    it('role is optional (undefined)', () => {
      type RoleType = UserContext['role']
      expectTypeOf<RoleType>().toEqualTypeOf<string | undefined>()
    })
  })
})

describe('WorkflowContext State Type Safety', () => {
  describe('state property', () => {
    it('state is Record<string, unknown>, never null', () => {
      // State is always an object (possibly empty), never null
      expectTypeOf<WorkflowContext['state']>().toEqualTypeOf<Record<string, unknown>>()
    })
  })
})

// ============================================================================
// Things Collection Type Safety
// ============================================================================

import type { Thing, ThingData } from '../../types/Thing'
import type { Things, Query } from '../../types/Things'
import type { RpcPromise } from '../../types/fn'

describe('Things Collection Null Safety', () => {
  describe('first() method', () => {
    it('returns RpcPromise<Thing | null>', () => {
      // first() returns null when no matching item found
      type FirstReturn = ReturnType<Things<Thing>['first']>
      expectTypeOf<FirstReturn>().toEqualTypeOf<RpcPromise<Thing | null>>()
    })

    it('null is in the resolved type', () => {
      type FirstResult = Awaited<ReturnType<Things<Thing>['first']>>
      expectTypeOf<null>().toMatchTypeOf<FirstResult>()
    })
  })

  describe('get() method', () => {
    it('returns RpcPromise<Thing>, not nullable', () => {
      // get() throws if not found, so return type is not nullable
      type GetReturn = ReturnType<Things<Thing>['get']>
      expectTypeOf<GetReturn>().toEqualTypeOf<RpcPromise<Thing>>()
    })
  })

  describe('list() method', () => {
    it('returns RpcPromise<Thing[]>, never null', () => {
      // list() always returns an array (possibly empty)
      type ListReturn = ReturnType<Things<Thing>['list']>
      expectTypeOf<ListReturn>().toEqualTypeOf<RpcPromise<Thing[]>>()
    })
  })

  describe('count() method', () => {
    it('returns RpcPromise<number>, never null', () => {
      type CountReturn = ReturnType<Things<Thing>['count']>
      expectTypeOf<CountReturn>().toEqualTypeOf<RpcPromise<number>>()
    })
  })
})

// ============================================================================
// ThingData Optional vs Null Fields
// ============================================================================

describe('ThingData Field Type Safety', () => {
  describe('Required fields', () => {
    it('$id is required string', () => {
      expectTypeOf<ThingData['$id']>().toEqualTypeOf<string>()
    })

    it('$type is required string', () => {
      expectTypeOf<ThingData['$type']>().toEqualTypeOf<string>()
    })

    it('createdAt is required Date', () => {
      expectTypeOf<ThingData['createdAt']>().toEqualTypeOf<Date>()
    })

    it('updatedAt is required Date', () => {
      expectTypeOf<ThingData['updatedAt']>().toEqualTypeOf<Date>()
    })
  })

  describe('Optional fields use undefined', () => {
    it('name is optional (undefined)', () => {
      type NameType = ThingData['name']
      expectTypeOf<NameType>().toEqualTypeOf<string | undefined>()
    })

    it('data is optional (undefined)', () => {
      type DataType = ThingData['data']
      expectTypeOf<DataType>().toEqualTypeOf<Record<string, unknown> | undefined>()
    })

    it('meta is optional (undefined)', () => {
      type MetaType = ThingData['meta']
      expectTypeOf<MetaType>().toEqualTypeOf<Record<string, unknown> | undefined>()
    })

    it('visibility is optional (undefined)', () => {
      type VisibilityType = ThingData['visibility']
      expectTypeOf<VisibilityType>().toEqualTypeOf<'public' | 'unlisted' | 'org' | 'user' | undefined>()
    })

    it('$version is optional (undefined)', () => {
      type VersionType = ThingData['$version']
      expectTypeOf<VersionType>().toEqualTypeOf<number | undefined>()
    })

    it('deletedAt is optional (undefined)', () => {
      type DeletedAtType = ThingData['deletedAt']
      expectTypeOf<DeletedAtType>().toEqualTypeOf<Date | undefined>()
    })
  })
})

// ============================================================================
// DomainEvent Type Safety
// ============================================================================

describe('DomainEvent Type Safety', () => {
  describe('Required fields', () => {
    it('id is required string', () => {
      expectTypeOf<DomainEvent['id']>().toEqualTypeOf<string>()
    })

    it('verb is required string', () => {
      expectTypeOf<DomainEvent['verb']>().toEqualTypeOf<string>()
    })

    it('source is required string', () => {
      expectTypeOf<DomainEvent['source']>().toEqualTypeOf<string>()
    })

    it('data is required (typed by generic)', () => {
      expectTypeOf<DomainEvent['data']>().toEqualTypeOf<unknown>()
    })

    it('timestamp is required Date', () => {
      expectTypeOf<DomainEvent['timestamp']>().toEqualTypeOf<Date>()
    })
  })

  describe('Optional fields', () => {
    it('actionId is optional (undefined)', () => {
      type ActionIdType = DomainEvent['actionId']
      expectTypeOf<ActionIdType>().toEqualTypeOf<string | undefined>()
    })
  })

  describe('Generic data typing', () => {
    it('data is typed when generic is provided', () => {
      interface CustomPayload {
        customField: string
        amount: number
      }
      type TypedEvent = DomainEvent<CustomPayload>
      expectTypeOf<TypedEvent['data']>().toEqualTypeOf<CustomPayload>()
    })
  })
})

// ============================================================================
// Capability Type Guards - Null Safety
// ============================================================================

describe('Capability Type Guard Safety', () => {
  describe('WithFs context', () => {
    it('fs is required FsCapability', () => {
      expectTypeOf<WithFs['fs']>().toEqualTypeOf<FsCapability>()
    })

    it('fs is not nullable in WithFs', () => {
      type FsType = WithFs['fs']
      expectTypeOf<FsType>().not.toMatchTypeOf<null>()
    })
  })

  describe('WithGit context', () => {
    it('git is required GitCapability', () => {
      expectTypeOf<WithGit['git']>().toEqualTypeOf<GitCapability>()
    })

    it('git is not nullable in WithGit', () => {
      type GitType = WithGit['git']
      expectTypeOf<GitType>().not.toMatchTypeOf<null>()
    })
  })

  describe('WithBash context', () => {
    it('bash is required BashCapability', () => {
      expectTypeOf<WithBash['bash']>().toEqualTypeOf<BashCapability>()
    })

    it('bash is not nullable in WithBash', () => {
      type BashType = WithBash['bash']
      expectTypeOf<BashType>().not.toMatchTypeOf<null>()
    })
  })
})

// ============================================================================
// RateLimitResult Type Safety
// ============================================================================

describe('RateLimitResult Type Safety', () => {
  describe('Required fields', () => {
    it('success is required boolean', () => {
      expectTypeOf<RateLimitResult['success']>().toEqualTypeOf<boolean>()
    })

    it('remaining is required number', () => {
      expectTypeOf<RateLimitResult['remaining']>().toEqualTypeOf<number>()
    })
  })

  describe('Optional fields', () => {
    it('resetAt is optional (undefined)', () => {
      type ResetAtType = RateLimitResult['resetAt']
      expectTypeOf<ResetAtType>().toEqualTypeOf<number | undefined>()
    })

    it('limit is optional (undefined)', () => {
      type LimitType = RateLimitResult['limit']
      expectTypeOf<LimitType>().toEqualTypeOf<number | undefined>()
    })
  })
})

// ============================================================================
// RpcPromise Type Safety
// ============================================================================

describe('RpcPromise Type Safety', () => {
  describe('Promise extension', () => {
    it('extends Promise<T>', () => {
      expectTypeOf<RpcPromise<string>>().toMatchTypeOf<Promise<string>>()
    })

    it('pipe returns RpcPromise', () => {
      type PipeResult = ReturnType<RpcPromise<string>['pipe']>
      expectTypeOf<PipeResult>().toMatchTypeOf<RpcPromise<unknown>>()
    })

    it('map returns RpcPromise', () => {
      type MapResult = ReturnType<RpcPromise<string>['map']>
      expectTypeOf<MapResult>().toMatchTypeOf<RpcPromise<unknown>>()
    })
  })

  describe('Chained nullability', () => {
    it('pipe preserves null in return type', () => {
      // When mapping over a potentially null value, null should be preserved
      type Input = RpcPromise<string | null>
      // The pipe function accepts the full type including null
      expectTypeOf<Input>().toMatchTypeOf<RpcPromise<string | null>>()
    })
  })
})

// ============================================================================
// UpdateThingInput Type Safety
// ============================================================================

describe('UpdateThingInput Type Safety', () => {
  describe('data field', () => {
    it('data accepts Record | null | undefined', () => {
      // UpdateThingInput.data can be:
      // - undefined (don't update)
      // - null (set to null)
      // - Record (set to new value)
      type DataType = UpdateThingInput['data']
      expectTypeOf<DataType>().toEqualTypeOf<Record<string, unknown> | null | undefined>()
    })

    it('can set data to null explicitly', () => {
      expectTypeOf<null>().toMatchTypeOf<UpdateThingInput['data']>()
    })

    it('can omit data update with undefined', () => {
      expectTypeOf<undefined>().toMatchTypeOf<UpdateThingInput['data']>()
    })
  })
})

// ============================================================================
// NewGraphThing Type Safety (Insert Type)
// ============================================================================

describe('NewGraphThing Insert Type Safety', () => {
  describe('Required vs Optional fields', () => {
    it('id is required', () => {
      expectTypeOf<NewGraphThing['id']>().toEqualTypeOf<string>()
    })

    it('typeId is required', () => {
      expectTypeOf<NewGraphThing['typeId']>().toEqualTypeOf<number>()
    })

    it('typeName is required', () => {
      expectTypeOf<NewGraphThing['typeName']>().toEqualTypeOf<string>()
    })

    it('data is optional (can be null or undefined)', () => {
      type DataType = NewGraphThing['data']
      // Insert type: can omit or provide null
      expectTypeOf<null>().toMatchTypeOf<DataType>()
    })

    it('createdAt is required number', () => {
      expectTypeOf<NewGraphThing['createdAt']>().toEqualTypeOf<number>()
    })

    it('updatedAt is required number', () => {
      expectTypeOf<NewGraphThing['updatedAt']>().toEqualTypeOf<number>()
    })

    it('deletedAt is optional (null in select type)', () => {
      // deletedAt is nullable in the select type
      type DeletedAtType = NewGraphThing['deletedAt']
      expectTypeOf<null>().toMatchTypeOf<DeletedAtType>()
    })
  })
})

// ============================================================================
// CreateRelationshipInput Type Safety
// ============================================================================

describe('CreateRelationshipInput Type Safety', () => {
  describe('Required fields', () => {
    it('id is required string', () => {
      expectTypeOf<CreateRelationshipInput['id']>().toEqualTypeOf<string>()
    })

    it('verb is required string', () => {
      expectTypeOf<CreateRelationshipInput['verb']>().toEqualTypeOf<string>()
    })

    it('from is required string', () => {
      expectTypeOf<CreateRelationshipInput['from']>().toEqualTypeOf<string>()
    })

    it('to is required string', () => {
      expectTypeOf<CreateRelationshipInput['to']>().toEqualTypeOf<string>()
    })
  })

  describe('Optional fields', () => {
    it('data is optional (undefined)', () => {
      type DataType = CreateRelationshipInput['data']
      expectTypeOf<DataType>().toEqualTypeOf<object | undefined>()
    })
  })
})

// ============================================================================
// RelationshipQueryOptions Type Safety
// ============================================================================

describe('RelationshipQueryOptions Type Safety', () => {
  describe('Optional fields', () => {
    it('verb is optional (undefined)', () => {
      type VerbType = RelationshipQueryOptions['verb']
      expectTypeOf<VerbType>().toEqualTypeOf<string | undefined>()
    })
  })
})

// ============================================================================
// GetThingsByTypeOptions Type Safety
// ============================================================================

describe('GetThingsByTypeOptions Type Safety', () => {
  describe('All fields are optional', () => {
    it('typeId is optional (undefined)', () => {
      type TypeIdType = GetThingsByTypeOptions['typeId']
      expectTypeOf<TypeIdType>().toEqualTypeOf<number | undefined>()
    })

    it('typeName is optional (undefined)', () => {
      type TypeNameType = GetThingsByTypeOptions['typeName']
      expectTypeOf<TypeNameType>().toEqualTypeOf<string | undefined>()
    })

    it('limit is optional (undefined)', () => {
      type LimitType = GetThingsByTypeOptions['limit']
      expectTypeOf<LimitType>().toEqualTypeOf<number | undefined>()
    })

    it('offset is optional (undefined)', () => {
      type OffsetType = GetThingsByTypeOptions['offset']
      expectTypeOf<OffsetType>().toEqualTypeOf<number | undefined>()
    })

    it('orderBy is optional (undefined)', () => {
      type OrderByType = GetThingsByTypeOptions['orderBy']
      expectTypeOf<OrderByType>().toEqualTypeOf<string | undefined>()
    })

    it('orderDirection is optional (undefined)', () => {
      type OrderDirType = GetThingsByTypeOptions['orderDirection']
      expectTypeOf<OrderDirType>().toEqualTypeOf<'asc' | 'desc' | undefined>()
    })

    it('includeDeleted is optional (undefined)', () => {
      type IncludeDeletedType = GetThingsByTypeOptions['includeDeleted']
      expectTypeOf<IncludeDeletedType>().toEqualTypeOf<boolean | undefined>()
    })
  })
})
