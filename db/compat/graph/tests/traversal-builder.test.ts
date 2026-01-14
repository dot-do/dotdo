/**
 * SDK-4: Traversal Builder Tests (RED Phase)
 *
 * Comprehensive tests for the fluent traversal chain API.
 * These tests are designed to FAIL until the production implementation is complete.
 *
 * Features tested:
 * - Direction methods: out(), in(), both()
 * - Filtering: where(), filter()
 * - Pagination: limit(), skip()
 * - Depth control: depth()
 * - Chaining and immutability
 * - Edge cases
 */

import { describe, it, expect, beforeEach } from 'vitest'
// Import from production module path (doesn't exist yet - RED phase)
import { TraversalBuilder, createTraversal } from '../src/traversal-builder'

describe('TraversalBuilder', () => {
  // ==========================================================================
  // DIRECTION METHODS: out(), in(), both()
  // ==========================================================================
  describe('Direction Methods', () => {
    describe('.out(relType)', () => {
      it('should create a traversal step for outgoing edges', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows')

        expect(result).toBeInstanceOf(TraversalBuilder)
        expect(result.getSteps()).toHaveLength(1)
        expect(result.getSteps()[0]).toEqual({
          type: 'traverse',
          direction: 'out',
          relationType: 'follows',
        })
      })

      it('should support multiple relationship types as array', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out(['follows', 'likes'])

        expect(result.getSteps()[0]).toEqual({
          type: 'traverse',
          direction: 'out',
          relationType: ['follows', 'likes'],
        })
      })

      it('should traverse all outgoing edges when no type specified', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out()

        expect(result.getSteps()[0]).toEqual({
          type: 'traverse',
          direction: 'out',
          relationType: undefined,
        })
      })
    })

    describe('.in(relType)', () => {
      it('should create a traversal step for incoming edges', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.in('follows')

        expect(result).toBeInstanceOf(TraversalBuilder)
        expect(result.getSteps()).toHaveLength(1)
        expect(result.getSteps()[0]).toEqual({
          type: 'traverse',
          direction: 'in',
          relationType: 'follows',
        })
      })

      it('should support multiple relationship types as array', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.in(['follows', 'mentions'])

        expect(result.getSteps()[0]).toEqual({
          type: 'traverse',
          direction: 'in',
          relationType: ['follows', 'mentions'],
        })
      })

      it('should traverse all incoming edges when no type specified', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.in()

        expect(result.getSteps()[0]).toEqual({
          type: 'traverse',
          direction: 'in',
          relationType: undefined,
        })
      })
    })

    describe('.both(relType)', () => {
      it('should create a traversal step for bidirectional edges', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.both('knows')

        expect(result).toBeInstanceOf(TraversalBuilder)
        expect(result.getSteps()).toHaveLength(1)
        expect(result.getSteps()[0]).toEqual({
          type: 'traverse',
          direction: 'both',
          relationType: 'knows',
        })
      })

      it('should support multiple relationship types as array', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.both(['knows', 'collaborates'])

        expect(result.getSteps()[0]).toEqual({
          type: 'traverse',
          direction: 'both',
          relationType: ['knows', 'collaborates'],
        })
      })

      it('should traverse all edges when no type specified', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.both()

        expect(result.getSteps()[0]).toEqual({
          type: 'traverse',
          direction: 'both',
          relationType: undefined,
        })
      })
    })

    describe('Direction method chaining', () => {
      it('should allow chaining multiple direction methods', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal
          .out('follows')
          .out('likes')
          .in('authored')

        expect(result.getSteps()).toHaveLength(3)
        expect(result.getSteps()[0].direction).toBe('out')
        expect(result.getSteps()[0].relationType).toBe('follows')
        expect(result.getSteps()[1].direction).toBe('out')
        expect(result.getSteps()[1].relationType).toBe('likes')
        expect(result.getSteps()[2].direction).toBe('in')
        expect(result.getSteps()[2].relationType).toBe('authored')
      })

      it('should allow mixing direction methods with different types', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal
          .out('follows')
          .both('knows')
          .in('mentions')

        expect(result.getSteps()).toHaveLength(3)
        expect(result.getSteps()[0].direction).toBe('out')
        expect(result.getSteps()[1].direction).toBe('both')
        expect(result.getSteps()[2].direction).toBe('in')
      })
    })
  })

  // ==========================================================================
  // FILTERING: where(), filter()
  // ==========================================================================
  describe('Filtering', () => {
    describe('.where(predicate)', () => {
      it('should add a filter step with object predicate', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').where({ verified: true })

        const steps = result.getSteps()
        expect(steps).toHaveLength(2)
        expect(steps[1]).toEqual({
          type: 'filter',
          predicate: { verified: true },
        })
      })

      it('should support multiple field conditions', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').where({
          verified: true,
          status: 'active',
          age: 25,
        })

        const filterStep = result.getSteps()[1]
        expect(filterStep.predicate).toEqual({
          verified: true,
          status: 'active',
          age: 25,
        })
      })

      it('should support function predicate', () => {
        const predicate = (node: any) => node.data.score > 100
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').where(predicate)

        const steps = result.getSteps()
        expect(steps[1]).toEqual({
          type: 'filter',
          predicate,
        })
      })

      it('should support nested object conditions', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').where({
          'profile.verified': true,
          'settings.public': true,
        })

        const filterStep = result.getSteps()[1]
        expect(filterStep.predicate).toEqual({
          'profile.verified': true,
          'settings.public': true,
        })
      })

      it('should allow chaining multiple where clauses', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal
          .out('follows')
          .where({ verified: true })
          .where({ status: 'active' })

        const steps = result.getSteps()
        expect(steps).toHaveLength(3)
        expect(steps[1].predicate).toEqual({ verified: true })
        expect(steps[2].predicate).toEqual({ status: 'active' })
      })
    })

    describe('.filter(predicate)', () => {
      it('should be an alias for where() with object predicate', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').filter({ verified: true })

        const steps = result.getSteps()
        expect(steps).toHaveLength(2)
        expect(steps[1]).toEqual({
          type: 'filter',
          predicate: { verified: true },
        })
      })

      it('should support function predicate', () => {
        const predicate = (node: any) => node.data.followers > 1000
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').filter(predicate)

        expect(result.getSteps()[1]).toEqual({
          type: 'filter',
          predicate,
        })
      })
    })

    describe('Filter placement', () => {
      it('should allow filter before direction method', () => {
        const traversal = createTraversal(['node-1'])
        // Filter start nodes, then traverse
        const result = traversal
          .where({ type: 'User' })
          .out('follows')

        const steps = result.getSteps()
        expect(steps).toHaveLength(2)
        expect(steps[0].type).toBe('filter')
        expect(steps[1].type).toBe('traverse')
      })

      it('should allow filter after direction method', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal
          .out('follows')
          .where({ verified: true })

        const steps = result.getSteps()
        expect(steps).toHaveLength(2)
        expect(steps[0].type).toBe('traverse')
        expect(steps[1].type).toBe('filter')
      })

      it('should allow filters interleaved with traversals', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal
          .out('follows')
          .where({ verified: true })
          .out('likes')
          .where({ public: true })

        const steps = result.getSteps()
        expect(steps).toHaveLength(4)
        expect(steps[0].type).toBe('traverse')
        expect(steps[1].type).toBe('filter')
        expect(steps[2].type).toBe('traverse')
        expect(steps[3].type).toBe('filter')
      })
    })
  })

  // ==========================================================================
  // PAGINATION: limit(), skip()
  // ==========================================================================
  describe('Pagination', () => {
    describe('.limit(n)', () => {
      it('should add a limit step', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').limit(10)

        const steps = result.getSteps()
        expect(steps).toHaveLength(2)
        expect(steps[1]).toEqual({
          type: 'limit',
          count: 10,
        })
      })

      it('should accept limit of 1', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').limit(1)

        expect(result.getSteps()[1]).toEqual({
          type: 'limit',
          count: 1,
        })
      })

      it('should accept large limits', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').limit(10000)

        expect(result.getSteps()[1]).toEqual({
          type: 'limit',
          count: 10000,
        })
      })
    })

    describe('.skip(n)', () => {
      it('should add a skip step', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').skip(20)

        const steps = result.getSteps()
        expect(steps).toHaveLength(2)
        expect(steps[1]).toEqual({
          type: 'skip',
          count: 20,
        })
      })

      it('should accept skip of 0', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').skip(0)

        expect(result.getSteps()[1]).toEqual({
          type: 'skip',
          count: 0,
        })
      })
    })

    describe('Combined skip().limit()', () => {
      it('should support skip followed by limit for pagination', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').skip(20).limit(10)

        const steps = result.getSteps()
        expect(steps).toHaveLength(3)
        expect(steps[1]).toEqual({ type: 'skip', count: 20 })
        expect(steps[2]).toEqual({ type: 'limit', count: 10 })
      })

      it('should support limit followed by skip', () => {
        // This order is unusual but should be supported
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').limit(100).skip(10)

        const steps = result.getSteps()
        expect(steps).toHaveLength(3)
        expect(steps[1]).toEqual({ type: 'limit', count: 100 })
        expect(steps[2]).toEqual({ type: 'skip', count: 10 })
      })

      it('should support pagination with filters', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal
          .out('follows')
          .where({ verified: true })
          .skip(10)
          .limit(5)

        const steps = result.getSteps()
        expect(steps).toHaveLength(4)
        expect(steps[0].type).toBe('traverse')
        expect(steps[1].type).toBe('filter')
        expect(steps[2].type).toBe('skip')
        expect(steps[3].type).toBe('limit')
      })
    })
  })

  // ==========================================================================
  // DEPTH CONTROL: depth()
  // ==========================================================================
  describe('Depth Control', () => {
    describe('.depth(n) - exact depth', () => {
      it('should set exact traversal depth as number', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').depth(2)

        const steps = result.getSteps()
        expect(steps).toHaveLength(2)
        expect(steps[1]).toEqual({
          type: 'depth',
          min: 2,
          max: 2,
        })
      })

      it('should support depth of 1 (direct neighbors)', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').depth(1)

        expect(result.getSteps()[1]).toEqual({
          type: 'depth',
          min: 1,
          max: 1,
        })
      })

      it('should support large depth values', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').depth(10)

        expect(result.getSteps()[1]).toEqual({
          type: 'depth',
          min: 10,
          max: 10,
        })
      })
    })

    describe('.depth({ min, max }) - range depth', () => {
      it('should set depth range', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').depth({ min: 1, max: 3 })

        expect(result.getSteps()[1]).toEqual({
          type: 'depth',
          min: 1,
          max: 3,
        })
      })

      it('should support min only (open-ended max)', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').depth({ min: 2 })

        expect(result.getSteps()[1]).toEqual({
          type: 'depth',
          min: 2,
          max: undefined,
        })
      })

      it('should support max only (from depth 1)', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').depth({ max: 5 })

        expect(result.getSteps()[1]).toEqual({
          type: 'depth',
          min: 1,
          max: 5,
        })
      })

      it('should support min equal to max', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').depth({ min: 3, max: 3 })

        expect(result.getSteps()[1]).toEqual({
          type: 'depth',
          min: 3,
          max: 3,
        })
      })
    })

    describe('Depth with other operations', () => {
      it('should combine depth with filter', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal
          .out('follows')
          .depth(2)
          .where({ verified: true })

        const steps = result.getSteps()
        expect(steps).toHaveLength(3)
        expect(steps[1].type).toBe('depth')
        expect(steps[2].type).toBe('filter')
      })

      it('should combine depth with limit', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal
          .out('follows')
          .depth({ min: 1, max: 3 })
          .limit(50)

        const steps = result.getSteps()
        expect(steps).toHaveLength(3)
        expect(steps[1].type).toBe('depth')
        expect(steps[2].type).toBe('limit')
      })
    })
  })

  // ==========================================================================
  // IMMUTABILITY
  // ==========================================================================
  describe('Immutability', () => {
    it('should return a new traversal on out()', () => {
      const original = createTraversal(['node-1'])
      const modified = original.out('follows')

      expect(original).not.toBe(modified)
      expect(original.getSteps()).toHaveLength(0)
      expect(modified.getSteps()).toHaveLength(1)
    })

    it('should return a new traversal on in()', () => {
      const original = createTraversal(['node-1'])
      const modified = original.in('follows')

      expect(original).not.toBe(modified)
      expect(original.getSteps()).toHaveLength(0)
    })

    it('should return a new traversal on both()', () => {
      const original = createTraversal(['node-1'])
      const modified = original.both('knows')

      expect(original).not.toBe(modified)
      expect(original.getSteps()).toHaveLength(0)
    })

    it('should return a new traversal on where()', () => {
      const base = createTraversal(['node-1']).out('follows')
      const filtered = base.where({ verified: true })

      expect(base).not.toBe(filtered)
      expect(base.getSteps()).toHaveLength(1)
      expect(filtered.getSteps()).toHaveLength(2)
    })

    it('should return a new traversal on filter()', () => {
      const base = createTraversal(['node-1']).out('follows')
      const filtered = base.filter({ active: true })

      expect(base).not.toBe(filtered)
      expect(base.getSteps()).toHaveLength(1)
      expect(filtered.getSteps()).toHaveLength(2)
    })

    it('should return a new traversal on limit()', () => {
      const base = createTraversal(['node-1']).out('follows')
      const limited = base.limit(10)

      expect(base).not.toBe(limited)
      expect(base.getSteps()).toHaveLength(1)
      expect(limited.getSteps()).toHaveLength(2)
    })

    it('should return a new traversal on skip()', () => {
      const base = createTraversal(['node-1']).out('follows')
      const skipped = base.skip(5)

      expect(base).not.toBe(skipped)
      expect(base.getSteps()).toHaveLength(1)
      expect(skipped.getSteps()).toHaveLength(2)
    })

    it('should return a new traversal on depth()', () => {
      const base = createTraversal(['node-1']).out('follows')
      const withDepth = base.depth(2)

      expect(base).not.toBe(withDepth)
      expect(base.getSteps()).toHaveLength(1)
      expect(withDepth.getSteps()).toHaveLength(2)
    })

    it('should allow branching from same traversal', () => {
      const base = createTraversal(['node-1']).out('follows')

      const branch1 = base.where({ verified: true })
      const branch2 = base.where({ premium: true })
      const branch3 = base.limit(10)

      expect(base.getSteps()).toHaveLength(1)
      expect(branch1.getSteps()).toHaveLength(2)
      expect(branch2.getSteps()).toHaveLength(2)
      expect(branch3.getSteps()).toHaveLength(2)

      // Branches should be independent
      expect(branch1.getSteps()[1]).toEqual({
        type: 'filter',
        predicate: { verified: true },
      })
      expect(branch2.getSteps()[1]).toEqual({
        type: 'filter',
        predicate: { premium: true },
      })
      expect(branch3.getSteps()[1]).toEqual({
        type: 'limit',
        count: 10,
      })
    })

    it('should not share step arrays between traversals', () => {
      const base = createTraversal(['node-1']).out('follows')
      const derived = base.where({ verified: true })

      // Mutating derived steps should not affect base
      const derivedSteps = derived.getSteps()
      expect(base.getSteps()).toHaveLength(1)
    })
  })

  // ==========================================================================
  // CHAINING ORDER
  // ==========================================================================
  describe('Chaining Order', () => {
    it('should preserve order of all operations', () => {
      const traversal = createTraversal(['node-1'])
      const result = traversal
        .where({ type: 'User' })
        .out('follows')
        .where({ verified: true })
        .depth(2)
        .skip(10)
        .limit(5)

      const steps = result.getSteps()
      expect(steps).toHaveLength(6)
      expect(steps.map(s => s.type)).toEqual([
        'filter',
        'traverse',
        'filter',
        'depth',
        'skip',
        'limit',
      ])
    })

    it('should support complex multi-hop with filters', () => {
      const traversal = createTraversal(['node-1'])
      const result = traversal
        .out('follows')
        .where({ verified: true })
        .out('likes')
        .where({ public: true })
        .in('authored')
        .limit(10)

      const steps = result.getSteps()
      expect(steps).toHaveLength(6)
      expect(steps.map(s => s.type)).toEqual([
        'traverse',
        'filter',
        'traverse',
        'filter',
        'traverse',
        'limit',
      ])
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================
  describe('Edge Cases', () => {
    describe('Zero and boundary values', () => {
      it('should handle limit(0) as no results', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').limit(0)

        expect(result.getSteps()[1]).toEqual({
          type: 'limit',
          count: 0,
        })
      })

      it('should handle depth(0) as start nodes only', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').depth(0)

        expect(result.getSteps()[1]).toEqual({
          type: 'depth',
          min: 0,
          max: 0,
        })
      })

      it('should handle skip(0) as no skip', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').skip(0)

        expect(result.getSteps()[1]).toEqual({
          type: 'skip',
          count: 0,
        })
      })
    })

    describe('Negative values', () => {
      it('should throw error for negative limit', () => {
        const traversal = createTraversal(['node-1'])

        expect(() => traversal.out('follows').limit(-1)).toThrow()
      })

      it('should throw error for negative skip', () => {
        const traversal = createTraversal(['node-1'])

        expect(() => traversal.out('follows').skip(-5)).toThrow()
      })

      it('should throw error for negative depth', () => {
        const traversal = createTraversal(['node-1'])

        expect(() => traversal.out('follows').depth(-1)).toThrow()
      })

      it('should throw error for depth range with negative min', () => {
        const traversal = createTraversal(['node-1'])

        expect(() => traversal.out('follows').depth({ min: -1, max: 5 })).toThrow()
      })

      it('should throw error for depth range with negative max', () => {
        const traversal = createTraversal(['node-1'])

        expect(() => traversal.out('follows').depth({ min: 1, max: -1 })).toThrow()
      })
    })

    describe('Invalid depth ranges', () => {
      it('should throw error when min > max in depth range', () => {
        const traversal = createTraversal(['node-1'])

        expect(() => traversal.out('follows').depth({ min: 5, max: 2 })).toThrow()
      })
    })

    describe('Empty and special inputs', () => {
      it('should handle empty start node list', () => {
        const traversal = createTraversal([])
        const result = traversal.out('follows')

        expect(result.getSteps()).toHaveLength(1)
        expect(result.getStartNodes()).toEqual([])
      })

      it('should handle single start node', () => {
        const traversal = createTraversal(['node-1'])

        expect(traversal.getStartNodes()).toEqual(['node-1'])
      })

      it('should handle multiple start nodes', () => {
        const traversal = createTraversal(['node-1', 'node-2', 'node-3'])

        expect(traversal.getStartNodes()).toEqual(['node-1', 'node-2', 'node-3'])
      })

      it('should handle empty relationship type', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('')

        expect(result.getSteps()[0]).toEqual({
          type: 'traverse',
          direction: 'out',
          relationType: '',
        })
      })

      it('should handle empty where predicate', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('follows').where({})

        expect(result.getSteps()[1]).toEqual({
          type: 'filter',
          predicate: {},
        })
      })
    })

    describe('Special characters in relationship types', () => {
      it('should handle relationship types with underscores', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('is_friend_of')

        expect(result.getSteps()[0].relationType).toBe('is_friend_of')
      })

      it('should handle relationship types with numbers', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('version2_of')

        expect(result.getSteps()[0].relationType).toBe('version2_of')
      })

      it('should handle uppercase relationship types', () => {
        const traversal = createTraversal(['node-1'])
        const result = traversal.out('FOLLOWS')

        expect(result.getSteps()[0].relationType).toBe('FOLLOWS')
      })
    })
  })

  // ==========================================================================
  // TRAVERSAL STATE ACCESS
  // ==========================================================================
  describe('Traversal State Access', () => {
    describe('.getSteps()', () => {
      it('should return empty array for new traversal', () => {
        const traversal = createTraversal(['node-1'])

        expect(traversal.getSteps()).toEqual([])
      })

      it('should return copy of steps (not mutable reference)', () => {
        const traversal = createTraversal(['node-1']).out('follows')
        const steps1 = traversal.getSteps()
        const steps2 = traversal.getSteps()

        expect(steps1).not.toBe(steps2)
        expect(steps1).toEqual(steps2)
      })
    })

    describe('.getStartNodes()', () => {
      it('should return the start node IDs', () => {
        const traversal = createTraversal(['node-1', 'node-2'])

        expect(traversal.getStartNodes()).toEqual(['node-1', 'node-2'])
      })

      it('should return copy of start nodes (not mutable reference)', () => {
        const traversal = createTraversal(['node-1'])
        const nodes1 = traversal.getStartNodes()
        const nodes2 = traversal.getStartNodes()

        expect(nodes1).not.toBe(nodes2)
        expect(nodes1).toEqual(nodes2)
      })
    })

    describe('.clone()', () => {
      it('should create an independent copy', () => {
        const original = createTraversal(['node-1']).out('follows')
        const cloned = original.clone()

        expect(cloned).not.toBe(original)
        expect(cloned.getSteps()).toEqual(original.getSteps())
        expect(cloned.getStartNodes()).toEqual(original.getStartNodes())
      })

      it('should allow independent modification of clone', () => {
        const original = createTraversal(['node-1']).out('follows')
        const cloned = original.clone()

        const modified = cloned.where({ verified: true })

        expect(original.getSteps()).toHaveLength(1)
        expect(modified.getSteps()).toHaveLength(2)
      })
    })
  })

  // ==========================================================================
  // TYPE DEFINITIONS (compile-time checks)
  // ==========================================================================
  describe('Type Definitions', () => {
    it('should have correct return types for all methods', () => {
      const traversal = createTraversal(['node-1'])

      // All methods should return TraversalBuilder
      const t1: TraversalBuilder = traversal.out('follows')
      const t2: TraversalBuilder = traversal.in('follows')
      const t3: TraversalBuilder = traversal.both('knows')
      const t4: TraversalBuilder = t1.where({ verified: true })
      const t5: TraversalBuilder = t1.filter({ active: true })
      const t6: TraversalBuilder = t1.limit(10)
      const t7: TraversalBuilder = t1.skip(5)
      const t8: TraversalBuilder = t1.depth(2)
      const t9: TraversalBuilder = t1.depth({ min: 1, max: 3 })
      const t10: TraversalBuilder = t1.clone()

      // These assertions are just to use the variables
      expect(t1).toBeInstanceOf(TraversalBuilder)
      expect(t2).toBeInstanceOf(TraversalBuilder)
      expect(t3).toBeInstanceOf(TraversalBuilder)
      expect(t4).toBeInstanceOf(TraversalBuilder)
      expect(t5).toBeInstanceOf(TraversalBuilder)
      expect(t6).toBeInstanceOf(TraversalBuilder)
      expect(t7).toBeInstanceOf(TraversalBuilder)
      expect(t8).toBeInstanceOf(TraversalBuilder)
      expect(t9).toBeInstanceOf(TraversalBuilder)
      expect(t10).toBeInstanceOf(TraversalBuilder)
    })
  })

  // ==========================================================================
  // FACTORY FUNCTION
  // ==========================================================================
  describe('createTraversal Factory', () => {
    it('should create a TraversalBuilder instance', () => {
      const traversal = createTraversal(['node-1'])

      expect(traversal).toBeInstanceOf(TraversalBuilder)
    })

    it('should accept array of node IDs', () => {
      const traversal = createTraversal(['node-1', 'node-2', 'node-3'])

      expect(traversal.getStartNodes()).toEqual(['node-1', 'node-2', 'node-3'])
    })

    it('should create traversal with no steps initially', () => {
      const traversal = createTraversal(['node-1'])

      expect(traversal.getSteps()).toEqual([])
    })
  })
})
