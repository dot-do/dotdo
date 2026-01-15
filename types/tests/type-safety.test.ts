import { describe, it, expectTypeOf } from 'vitest'
import type {
  // Core entity types
  Thing,
  ThingData,

  // Noun/Verb types
  Noun,
  NounData,

  // Event types
  DomainEvent,
  EventHandler,

  // WorkflowContext types
  WorkflowContext,
  OnProxy,
  ScheduleBuilder,
  DomainProxy,
  DOFunction,

  // DO types
  DO,
  DOConfig,
  Relationship,
  ObjectRef,
  Action,
  Event,
  SearchResult,

  // Flag types
  Flag,
  Branch,
  Filter,
  FlagInput,
  BranchInput,
  FilterInput,

  // Collection types
  Collection,
  CollectionData,

  // Worker types
  IWorker,
  IAgent,
  Task,
  TaskResult,
} from '../index'

/**
 * Type Safety Tests using Vitest's expectTypeOf
 *
 * These tests verify that public API types do not leak `any` type
 * and that key interfaces are properly exported.
 *
 * Issue: do-n5b (TypeScript - Tests for type safety violations)
 *
 * These tests use vitest's built-in type testing:
 * - expectTypeOf<T>().toEqualTypeOf<U>() - exact type match
 * - expectTypeOf<T>().toMatchTypeOf<U>() - structural compatibility
 * - expectTypeOf<T>().not.toBeAny() - verify not `any`
 * - expectTypeOf<T>().toBeString() / .toBeNumber() etc.
 */

describe('Type Safety - No Any Leakage', () => {
  describe('Core Entity Types', () => {
    it('Thing.$id should be string, not any', () => {
      expectTypeOf<Thing['$id']>().toBeString()
      expectTypeOf<Thing['$id']>().not.toBeAny()
    })

    it('Thing.$type should be string, not any', () => {
      expectTypeOf<Thing['$type']>().toBeString()
      expectTypeOf<Thing['$type']>().not.toBeAny()
    })

    it('ThingData.$id should be string, not any', () => {
      expectTypeOf<ThingData['$id']>().toBeString()
      expectTypeOf<ThingData['$id']>().not.toBeAny()
    })

    it('ThingData.$type should be string, not any', () => {
      expectTypeOf<ThingData['$type']>().toBeString()
      expectTypeOf<ThingData['$type']>().not.toBeAny()
    })
  })

  describe('Event Types', () => {
    it('DomainEvent.verb should be string, not any', () => {
      expectTypeOf<DomainEvent['verb']>().toBeString()
      expectTypeOf<DomainEvent['verb']>().not.toBeAny()
    })

    it('DomainEvent.source should be string, not any', () => {
      expectTypeOf<DomainEvent['source']>().toBeString()
      expectTypeOf<DomainEvent['source']>().not.toBeAny()
    })

    it('DomainEvent.timestamp should be Date, not any', () => {
      expectTypeOf<DomainEvent['timestamp']>().toEqualTypeOf<Date>()
      expectTypeOf<DomainEvent['timestamp']>().not.toBeAny()
    })
  })

  describe('Flag Types - Unknown Instead of Any', () => {
    it('Branch.payload should use unknown, not any', () => {
      // Branch.payload is Record<string, unknown> | undefined
      expectTypeOf<NonNullable<Branch['payload']>>().not.toBeAny()
    })

    it('Branch.payload value type should be unknown, not any', () => {
      // The value type in the record should be unknown
      expectTypeOf<NonNullable<Branch['payload']>[string]>().toEqualTypeOf<unknown>()
      expectTypeOf<NonNullable<Branch['payload']>[string]>().not.toBeAny()
    })

    it('Filter.value should be unknown, not any', () => {
      // Filter.value was changed from `any` to `unknown`
      expectTypeOf<Filter['value']>().not.toBeAny()
    })

    it('Flag.traffic should be number, not any', () => {
      expectTypeOf<Flag['traffic']>().toBeNumber()
      expectTypeOf<Flag['traffic']>().not.toBeAny()
    })

    it('Flag.id should be string, not any', () => {
      expectTypeOf<Flag['id']>().toBeString()
      expectTypeOf<Flag['id']>().not.toBeAny()
    })

    it('Flag.key should be string, not any', () => {
      expectTypeOf<Flag['key']>().toBeString()
      expectTypeOf<Flag['key']>().not.toBeAny()
    })
  })

  describe('DO Types', () => {
    it('Action.verb should be string, not any', () => {
      expectTypeOf<Action['verb']>().toBeString()
      expectTypeOf<Action['verb']>().not.toBeAny()
    })

    it('Relationship.type should be string, not any', () => {
      expectTypeOf<Relationship['type']>().toBeString()
      expectTypeOf<Relationship['type']>().not.toBeAny()
    })

    it('ObjectRef.$id should be string, not any', () => {
      expectTypeOf<ObjectRef['$id']>().toBeString()
      expectTypeOf<ObjectRef['$id']>().not.toBeAny()
    })
  })

  describe('Collection Types', () => {
    it('Collection.$id should be string, not any', () => {
      expectTypeOf<Collection['$id']>().toBeString()
      expectTypeOf<Collection['$id']>().not.toBeAny()
    })

    it('CollectionData.$type should be the collection type literal', () => {
      // $type should be 'collection', not any
      expectTypeOf<CollectionData['$type']>().not.toBeAny()
    })
  })

  describe('Worker Types', () => {
    it('Task.id should be string, not any', () => {
      expectTypeOf<Task['id']>().toBeString()
      expectTypeOf<Task['id']>().not.toBeAny()
    })

    it('TaskResult.taskId should be string, not any', () => {
      expectTypeOf<TaskResult['taskId']>().toBeString()
      expectTypeOf<TaskResult['taskId']>().not.toBeAny()
    })
  })
})

describe('Type Consistency - Interface vs Zod-Inferred', () => {
  describe('Branch Types', () => {
    it('Branch should be assignable to BranchInput', () => {
      // If Branch uses `any` but BranchInput uses `unknown`, this could cause issues
      expectTypeOf<Branch>().toMatchTypeOf<BranchInput>()
    })

    it('BranchInput.payload value should be unknown', () => {
      expectTypeOf<NonNullable<BranchInput['payload']>[string]>().toEqualTypeOf<unknown>()
    })
  })

  describe('Filter Types', () => {
    it('Filter should be assignable to FilterInput', () => {
      expectTypeOf<Filter>().toMatchTypeOf<FilterInput>()
    })

    it('FilterInput.value should not be any', () => {
      expectTypeOf<FilterInput['value']>().not.toBeAny()
    })
  })

  describe('Flag Types', () => {
    it('Flag should be assignable to FlagInput', () => {
      expectTypeOf<Flag>().toMatchTypeOf<FlagInput>()
    })
  })
})

describe('Key Interfaces Are Exported', () => {
  /**
   * These tests verify that key types are exported from types/index.ts
   * If any import at the top of this file fails, the test file won't compile.
   * These assertions just verify the types have the expected basic shape.
   */

  it('Thing type is exported and has $id, $type', () => {
    expectTypeOf<Thing>().toHaveProperty('$id')
    expectTypeOf<Thing>().toHaveProperty('$type')
  })

  it('DomainEvent type is exported and has verb, source, timestamp', () => {
    expectTypeOf<DomainEvent>().toHaveProperty('verb')
    expectTypeOf<DomainEvent>().toHaveProperty('source')
    expectTypeOf<DomainEvent>().toHaveProperty('timestamp')
  })

  it('Flag type is exported and has id, key, branches', () => {
    expectTypeOf<Flag>().toHaveProperty('id')
    expectTypeOf<Flag>().toHaveProperty('key')
    expectTypeOf<Flag>().toHaveProperty('branches')
  })

  it('WorkflowContext type is exported', () => {
    expectTypeOf<WorkflowContext>().not.toBeAny()
  })

  it('DO type is exported', () => {
    expectTypeOf<DO>().not.toBeAny()
  })

  it('Collection type is exported', () => {
    expectTypeOf<Collection>().not.toBeAny()
  })

  it('IWorker type is exported', () => {
    expectTypeOf<IWorker>().not.toBeAny()
  })

  it('IAgent type is exported', () => {
    expectTypeOf<IAgent>().not.toBeAny()
  })
})
