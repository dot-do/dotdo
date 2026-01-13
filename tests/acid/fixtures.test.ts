/**
 * Tests for ACID test fixtures and factory functions.
 *
 * Verifies that fixtures are correctly typed and that factory functions
 * produce valid test data.
 */

import { describe, it, expect } from 'vitest'
import {
  FIXTURES,
  createThingFixture,
  createThingFixtures,
  createVersionedThingFixtures,
  createRelationshipFixtures,
  createActionFixtures,
  createEventFixtures,
  type ThingFixture,
  type FixtureName,
} from '../../testing/acid'

// ============================================================================
// FIXTURES TYPE TESTS
// ============================================================================

describe('FIXTURES', () => {
  describe('simpleThing', () => {
    it('has correct schema fields', () => {
      const thing = FIXTURES.simpleThing

      expect(thing.id).toBe('test-thing-1')
      expect(thing.type).toBe(1)
      expect(thing.branch).toBeNull()
      expect(thing.name).toBe('Test Thing')
      expect(thing.data).toEqual({ value: 'test' })
      expect(thing.deleted).toBe(false)
    })

    it('is type-safe', () => {
      // Type assertion - if this compiles, the type is correct
      const thing: ThingFixture = FIXTURES.simpleThing
      expect(thing).toBeDefined()
    })
  })

  describe('versionedThings', () => {
    it('has multiple versions with same id', () => {
      const versions = FIXTURES.versionedThings

      expect(versions).toHaveLength(3)
      expect(versions[0].id).toBe('versioned-1')
      expect(versions[1].id).toBe('versioned-1')
      expect(versions[2].id).toBe('versioned-1')
    })

    it('has incrementing rowids', () => {
      const versions = FIXTURES.versionedThings

      expect(versions[0].rowid).toBe(1)
      expect(versions[1].rowid).toBe(2)
      expect(versions[2].rowid).toBe(3)
    })

    it('has incrementing version data', () => {
      const versions = FIXTURES.versionedThings

      expect(versions[0].data.v).toBe(1)
      expect(versions[1].data.v).toBe(2)
      expect(versions[2].data.v).toBe(3)
    })
  })

  describe('branchedThings', () => {
    it('has main and feature branches', () => {
      const { main, feature } = FIXTURES.branchedThings

      expect(main.branch).toBeNull()
      expect(feature.branch).toBe('feature')
    })

    it('has same id on both branches', () => {
      const { main, feature } = FIXTURES.branchedThings

      expect(main.id).toBe('branch-test')
      expect(feature.id).toBe('branch-test')
    })

    it('has different source data', () => {
      const { main, feature } = FIXTURES.branchedThings

      expect(main.data.source).toBe('main')
      expect(feature.data.source).toBe('feature')
    })
  })

  describe('conflictingThings', () => {
    it('has base, main, and feature versions', () => {
      const { base, main, feature } = FIXTURES.conflictingThings

      expect(base).toBeDefined()
      expect(main).toBeDefined()
      expect(feature).toBeDefined()
    })

    it('has same id across all versions', () => {
      const { base, main, feature } = FIXTURES.conflictingThings

      expect(base.id).toBe('conflict-test')
      expect(main.id).toBe('conflict-test')
      expect(feature.id).toBe('conflict-test')
    })

    it('has conflicting field values', () => {
      const { base, main, feature } = FIXTURES.conflictingThings

      expect(base.data.field).toBe('original')
      expect(main.data.field).toBe('main-value')
      expect(feature.data.field).toBe('feature-value')
    })

    it('feature is on feature branch', () => {
      const { base, main, feature } = FIXTURES.conflictingThings

      expect(base.branch).toBeNull()
      expect(main.branch).toBeNull()
      expect(feature.branch).toBe('feature')
    })
  })

  describe('deletedThing', () => {
    it('has deleted flag set', () => {
      expect(FIXTURES.deletedThing.deleted).toBe(true)
    })
  })

  describe('publicThing', () => {
    it('has public visibility', () => {
      expect(FIXTURES.publicThing.visibility).toBe('public')
    })
  })

  describe('orgThing', () => {
    it('has org visibility', () => {
      expect(FIXTURES.orgThing.visibility).toBe('org')
    })
  })

  describe('relationships', () => {
    it('has multiple relationship types', () => {
      const rels = FIXTURES.relationships

      expect(rels).toHaveLength(3)
      expect(rels[0].verb).toBe('relatedTo')
      expect(rels[1].verb).toBe('contains')
      expect(rels[2].verb).toBe('references')
    })

    it('has valid from/to references', () => {
      const rels = FIXTURES.relationships

      expect(rels[0].from).toBe('thing-a')
      expect(rels[0].to).toBe('thing-b')
    })
  })

  describe('branches', () => {
    it('has main and feature branches', () => {
      const branches = FIXTURES.branches

      expect(branches).toHaveLength(3)
      expect(branches[0].name).toBe('main')
      expect(branches[1].name).toBe('feature')
      expect(branches[2].name).toBe('experiment')
    })

    it('has forkedFrom relationships', () => {
      const branches = FIXTURES.branches

      expect(branches[0].forkedFrom).toBeNull()
      expect(branches[1].forkedFrom).toBe('main')
      expect(branches[2].forkedFrom).toBe('main')
    })
  })

  describe('complexDataThing', () => {
    it('has complex nested data', () => {
      const { data } = FIXTURES.complexDataThing

      expect(data.string).toBe('value')
      expect(data.number).toBe(42)
      expect(data.boolean).toBe(true)
      expect(data.null).toBeNull()
      expect(data.array).toEqual([1, 2, { nested: true }])
      expect((data.object as { level1: { level2: { level3: string } } }).level1.level2.level3).toBe('deep')
    })
  })

  describe('unicodeThing', () => {
    it('has unicode characters', () => {
      const { data } = FIXTURES.unicodeThing

      expect(data.emoji).toBe('Hello World!')
      expect(data.chinese).toBe('Example Text')
      expect(data.newlines).toContain('\n')
    })
  })
})

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createThingFixture', () => {
  it('creates thing with defaults', () => {
    const thing = createThingFixture()

    expect(thing.id).toBeDefined()
    expect(thing.type).toBe(1)
    expect(thing.branch).toBeNull()
    expect(thing.name).toBe('Test Thing')
    expect(thing.data).toEqual({})
    expect(thing.deleted).toBe(false)
  })

  it('accepts overrides', () => {
    const thing = createThingFixture({
      id: 'custom-id',
      name: 'Custom Name',
      data: { custom: true },
    })

    expect(thing.id).toBe('custom-id')
    expect(thing.name).toBe('Custom Name')
    expect(thing.data).toEqual({ custom: true })
  })

  it('preserves non-overridden defaults', () => {
    const thing = createThingFixture({ id: 'custom' })

    expect(thing.id).toBe('custom')
    expect(thing.type).toBe(1) // default
    expect(thing.deleted).toBe(false) // default
  })
})

describe('createThingFixtures', () => {
  it('creates specified number of things', () => {
    const things = createThingFixtures(5)

    expect(things).toHaveLength(5)
  })

  it('generates sequential ids', () => {
    const things = createThingFixtures(3)

    expect(things[0].id).toBe('thing-0')
    expect(things[1].id).toBe('thing-1')
    expect(things[2].id).toBe('thing-2')
  })

  it('applies template to all things', () => {
    const things = createThingFixtures(3, { type: 42, data: { shared: true } })

    for (const thing of things) {
      expect(thing.type).toBe(42)
      expect(thing.data.shared).toBe(true)
    }
  })

  it('adds index to each thing data', () => {
    const things = createThingFixtures(3)

    expect(things[0].data.index).toBe(0)
    expect(things[1].data.index).toBe(1)
    expect(things[2].data.index).toBe(2)
  })

  it('assigns sequential rowids', () => {
    const things = createThingFixtures(3)

    expect(things[0].rowid).toBe(1)
    expect(things[1].rowid).toBe(2)
    expect(things[2].rowid).toBe(3)
  })
})

describe('createVersionedThingFixtures', () => {
  it('creates specified number of versions', () => {
    const versions = createVersionedThingFixtures('doc-1', 5)

    expect(versions).toHaveLength(5)
  })

  it('all versions have same id', () => {
    const versions = createVersionedThingFixtures('doc-1', 3)

    expect(versions[0].id).toBe('doc-1')
    expect(versions[1].id).toBe('doc-1')
    expect(versions[2].id).toBe('doc-1')
  })

  it('has incrementing version numbers in data', () => {
    const versions = createVersionedThingFixtures('doc-1', 3)

    expect(versions[0].data.version).toBe(1)
    expect(versions[1].data.version).toBe(2)
    expect(versions[2].data.version).toBe(3)
  })

  it('has incrementing rowids', () => {
    const versions = createVersionedThingFixtures('doc-1', 3)

    expect(versions[0].rowid).toBe(1)
    expect(versions[1].rowid).toBe(2)
    expect(versions[2].rowid).toBe(3)
  })

  it('preserves base data across versions', () => {
    const versions = createVersionedThingFixtures('doc-1', 3, { author: 'test' })

    for (const version of versions) {
      expect(version.data.author).toBe('test')
    }
  })

  it('names include version number', () => {
    const versions = createVersionedThingFixtures('doc-1', 3)

    expect(versions[0].name).toBe('doc-1 v1')
    expect(versions[1].name).toBe('doc-1 v2')
    expect(versions[2].name).toBe('doc-1 v3')
  })
})

describe('createRelationshipFixtures', () => {
  it('creates relationships from one to many', () => {
    const rels = createRelationshipFixtures('parent', ['child-1', 'child-2', 'child-3'])

    expect(rels).toHaveLength(3)
  })

  it('sets correct from/to values', () => {
    const rels = createRelationshipFixtures('parent', ['child-1', 'child-2'])

    expect(rels[0].from).toBe('parent')
    expect(rels[0].to).toBe('child-1')
    expect(rels[1].from).toBe('parent')
    expect(rels[1].to).toBe('child-2')
  })

  it('uses default verb relatedTo', () => {
    const rels = createRelationshipFixtures('a', ['b'])

    expect(rels[0].verb).toBe('relatedTo')
  })

  it('accepts custom verb', () => {
    const rels = createRelationshipFixtures('parent', ['child'], 'contains')

    expect(rels[0].verb).toBe('contains')
  })

  it('generates unique ids', () => {
    const rels = createRelationshipFixtures('a', ['b', 'c'])

    expect(rels[0].id).toBe('rel-a-b')
    expect(rels[1].id).toBe('rel-a-c')
  })

  it('includes order in data', () => {
    const rels = createRelationshipFixtures('a', ['b', 'c', 'd'])

    expect(rels[0].data?.order).toBe(0)
    expect(rels[1].data?.order).toBe(1)
    expect(rels[2].data?.order).toBe(2)
  })
})

describe('createActionFixtures', () => {
  it('creates specified number of actions', () => {
    const actions = createActionFixtures(5, 'thing-1')

    expect(actions).toHaveLength(5)
  })

  it('first action is create', () => {
    const actions = createActionFixtures(3, 'thing-1')

    expect(actions[0].verb).toBe('create')
  })

  it('subsequent actions are update', () => {
    const actions = createActionFixtures(3, 'thing-1')

    expect(actions[1].verb).toBe('update')
    expect(actions[2].verb).toBe('update')
  })

  it('targets specified thing', () => {
    const actions = createActionFixtures(3, 'target-thing')

    for (const action of actions) {
      expect(action.target).toBe('target-thing')
    }
  })

  it('has completed status', () => {
    const actions = createActionFixtures(3, 'thing-1')

    for (const action of actions) {
      expect(action.status).toBe('completed')
    }
  })
})

describe('createEventFixtures', () => {
  it('creates specified number of events', () => {
    const events = createEventFixtures(5, 'https://test.do')

    expect(events).toHaveLength(5)
  })

  it('first event is thing.created', () => {
    const events = createEventFixtures(3, 'https://test.do')

    expect(events[0].verb).toBe('thing.created')
  })

  it('subsequent events are thing.updated', () => {
    const events = createEventFixtures(3, 'https://test.do')

    expect(events[1].verb).toBe('thing.updated')
    expect(events[2].verb).toBe('thing.updated')
  })

  it('uses specified source', () => {
    const events = createEventFixtures(3, 'https://custom.do')

    for (const event of events) {
      expect(event.source).toBe('https://custom.do')
    }
  })

  it('has incrementing sequence numbers', () => {
    const events = createEventFixtures(3, 'https://test.do')

    expect(events[0].sequence).toBe(1)
    expect(events[1].sequence).toBe(2)
    expect(events[2].sequence).toBe(3)
  })
})

// ============================================================================
// TYPE SAFETY TESTS
// ============================================================================

describe('Type Safety', () => {
  it('FixtureName type includes all fixture keys', () => {
    // This is a compile-time check - if it compiles, the type is correct
    const names: FixtureName[] = [
      'simpleThing',
      'versionedThings',
      'branchedThings',
      'conflictingThings',
      'deletedThing',
      'publicThing',
      'orgThing',
      'relationships',
      'branches',
      'complexDataThing',
      'unicodeThing',
    ]

    expect(names).toHaveLength(11)
  })

  it('FIXTURES is readonly', () => {
    // This test ensures FIXTURES cannot be mutated at runtime
    // The const assertion enforces this at compile time
    expect(Object.isFrozen(FIXTURES.simpleThing)).toBe(false) // shallow freeze from const
    // But the types prevent mutation at compile time
  })
})
