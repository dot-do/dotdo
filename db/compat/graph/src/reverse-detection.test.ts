/**
 * Smart Reverse Detection - TDD RED Phase Tests
 *
 * Issue: dotdo-gxsn4
 *
 * Tests for the detectReverse() function that enables smart reverse relationship detection:
 * - `user.$followedBy` auto-resolves to reverse of `$follows`
 * - `user.$likedBy` auto-resolves to reverse of `$likes`
 * - `user.$authoredBy` auto-resolves to reverse of `$authored`
 * - `user.$reportsToBy` auto-resolves to reverse of `$reportsTo`
 *
 * The system detects "verbBy" patterns and maps them to incoming edges
 * for the corresponding relationship type.
 *
 * @see db/compat/sql/clickhouse/spikes/graph-sdk-smart-reverse.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'

// Import from production module path (does not exist yet - RED phase)
import { detectReverse, type ReverseDetectionResult } from './reverse-detection'

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Creates a standard set of known relationship types for testing.
 * These simulate the relationship types that exist in a graph schema.
 */
function createStandardRelTypes(): Set<string> {
  return new Set([
    'follows',
    'likes',
    'authored',
    'reportsTo',
    'manages',
    'owns',
    'created',
    'replied',
    'subscribedTo',
    'assignedTo',
    'worksFor',
    'memberOf',
  ])
}

/**
 * Creates an empty set of known relationship types for unknown fallback tests.
 */
function createEmptyRelTypes(): Set<string> {
  return new Set()
}

// ============================================================================
// BASIC REVERSE DETECTION - Common Patterns
// ============================================================================

describe('detectReverse - Common Verb Patterns', () => {
  let knownRelTypes: Set<string>

  beforeEach(() => {
    knownRelTypes = createStandardRelTypes()
  })

  describe('followedBy pattern (ends with -edBy)', () => {
    it('should detect followedBy as reverse of follows', () => {
      const result = detectReverse('followedBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('follows')
    })

    it('should return direction as "in" for reverse relationships', () => {
      const result = detectReverse('followedBy', knownRelTypes)

      expect(result.direction).toBe('in')
    })
  })

  describe('likedBy pattern (ends with -dBy)', () => {
    it('should detect likedBy as reverse of likes', () => {
      const result = detectReverse('likedBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('likes')
    })

    it('should return direction as "in" for likedBy', () => {
      const result = detectReverse('likedBy', knownRelTypes)

      expect(result.direction).toBe('in')
    })
  })

  describe('authoredBy pattern (verb ending in -ed)', () => {
    it('should detect authoredBy as reverse of authored', () => {
      const result = detectReverse('authoredBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('authored')
    })

    it('should return direction as "in" for authoredBy', () => {
      const result = detectReverse('authoredBy', knownRelTypes)

      expect(result.direction).toBe('in')
    })
  })

  describe('reportsToBy pattern (compound verb)', () => {
    it('should detect reportsToBy as reverse of reportsTo', () => {
      const result = detectReverse('reportsToBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('reportsTo')
    })

    it('should handle compound verbs ending in preposition', () => {
      const result = detectReverse('reportsToBy', knownRelTypes)

      expect(result.direction).toBe('in')
    })
  })
})

// ============================================================================
// DIRECT RELATIONSHIP DETECTION (Not Reverse)
// ============================================================================

describe('detectReverse - Direct Relationships (Not Reverse)', () => {
  let knownRelTypes: Set<string>

  beforeEach(() => {
    knownRelTypes = createStandardRelTypes()
  })

  it('should detect "follows" as direct relationship, not reverse', () => {
    const result = detectReverse('follows', knownRelTypes)

    expect(result.isReverse).toBe(false)
    expect(result.relType).toBe('follows')
  })

  it('should return direction as "out" for direct relationships', () => {
    const result = detectReverse('follows', knownRelTypes)

    expect(result.direction).toBe('out')
  })

  it('should detect "likes" as direct relationship', () => {
    const result = detectReverse('likes', knownRelTypes)

    expect(result.isReverse).toBe(false)
    expect(result.relType).toBe('likes')
    expect(result.direction).toBe('out')
  })

  it('should detect "authored" as direct relationship', () => {
    const result = detectReverse('authored', knownRelTypes)

    expect(result.isReverse).toBe(false)
    expect(result.relType).toBe('authored')
    expect(result.direction).toBe('out')
  })

  it('should detect "reportsTo" as direct relationship', () => {
    const result = detectReverse('reportsTo', knownRelTypes)

    expect(result.isReverse).toBe(false)
    expect(result.relType).toBe('reportsTo')
    expect(result.direction).toBe('out')
  })

  it('should detect "manages" as direct relationship', () => {
    const result = detectReverse('manages', knownRelTypes)

    expect(result.isReverse).toBe(false)
    expect(result.relType).toBe('manages')
    expect(result.direction).toBe('out')
  })

  it('should detect "owns" as direct relationship', () => {
    const result = detectReverse('owns', knownRelTypes)

    expect(result.isReverse).toBe(false)
    expect(result.relType).toBe('owns')
    expect(result.direction).toBe('out')
  })
})

// ============================================================================
// UNKNOWN RELATIONSHIP FALLBACK
// ============================================================================

describe('detectReverse - Unknown Relationship Fallback', () => {
  let knownRelTypes: Set<string>

  beforeEach(() => {
    knownRelTypes = createStandardRelTypes()
  })

  it('should treat unknown relationship as direct (not reverse)', () => {
    const result = detectReverse('unknownRelation', knownRelTypes)

    expect(result.isReverse).toBe(false)
    expect(result.relType).toBe('unknownRelation')
  })

  it('should return direction as "out" for unknown relationships', () => {
    const result = detectReverse('unknownRelation', knownRelTypes)

    expect(result.direction).toBe('out')
  })

  it('should treat "fooBy" as unknown if "foo" is not a known rel type', () => {
    const result = detectReverse('fooBy', knownRelTypes)

    // Since 'foo' is not in knownRelTypes, this should not be detected as reverse
    expect(result.isReverse).toBe(false)
    expect(result.relType).toBe('fooBy')
    expect(result.direction).toBe('out')
  })

  it('should treat "randomVerbBy" as unknown if base verb not found', () => {
    const result = detectReverse('randomVerbBy', knownRelTypes)

    expect(result.isReverse).toBe(false)
    expect(result.relType).toBe('randomVerbBy')
  })

  it('should handle completely unknown patterns gracefully', () => {
    const result = detectReverse('xyz123', knownRelTypes)

    expect(result.isReverse).toBe(false)
    expect(result.relType).toBe('xyz123')
    expect(result.direction).toBe('out')
  })

  it('should handle empty string gracefully', () => {
    const result = detectReverse('', knownRelTypes)

    expect(result.isReverse).toBe(false)
    expect(result.relType).toBe('')
    expect(result.direction).toBe('out')
  })
})

// ============================================================================
// EDGE CASES - Verbs Ending in Different Suffixes
// ============================================================================

describe('detectReverse - Edge Cases: Different Suffixes', () => {
  let knownRelTypes: Set<string>

  beforeEach(() => {
    knownRelTypes = createStandardRelTypes()
  })

  describe('Verbs ending in -s (follows, likes)', () => {
    it('should detect followedBy -> follows (strip -edBy, add -s)', () => {
      const result = detectReverse('followedBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('follows')
    })

    it('should detect likedBy -> likes (strip -dBy, add -s)', () => {
      const result = detectReverse('likedBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('likes')
    })
  })

  describe('Verbs ending in -ed (authored, created)', () => {
    it('should detect authoredBy -> authored', () => {
      const result = detectReverse('authoredBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('authored')
    })

    it('should detect createdBy -> created', () => {
      const result = detectReverse('createdBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('created')
    })
  })

  describe('Verbs ending in preposition (reportsTo, subscribedTo, assignedTo)', () => {
    it('should detect reportsToBy -> reportsTo', () => {
      const result = detectReverse('reportsToBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('reportsTo')
    })

    it('should detect subscribedToBy -> subscribedTo', () => {
      const result = detectReverse('subscribedToBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('subscribedTo')
    })

    it('should detect assignedToBy -> assignedTo', () => {
      const result = detectReverse('assignedToBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('assignedTo')
    })
  })

  describe('Verbs ending in -ied (replied)', () => {
    it('should detect repliedBy -> replied', () => {
      const result = detectReverse('repliedBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('replied')
    })
  })

  describe('Verbs ending in -Of (memberOf)', () => {
    it('should detect memberOfBy -> memberOf', () => {
      const result = detectReverse('memberOfBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('memberOf')
    })
  })

  describe('Verbs ending in -For (worksFor)', () => {
    it('should detect worksForBy -> worksFor', () => {
      const result = detectReverse('worksForBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('worksFor')
    })
  })
})

// ============================================================================
// EDGE CASES - Tricky Transformations
// ============================================================================

describe('detectReverse - Edge Cases: Tricky Transformations', () => {
  let knownRelTypes: Set<string>

  beforeEach(() => {
    knownRelTypes = new Set([
      'follows',
      'likes',
      'manages',
      'owns',
      'reply',    // Base form
      'study',    // Ends in consonant + y
      'applies',  // Ends in -ies
      'watches',  // Ends in -es
      'has',      // Irregular
    ])
  })

  describe('managedBy transformation', () => {
    it('should detect managedBy -> manages', () => {
      const result = detectReverse('managedBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('manages')
    })
  })

  describe('ownedBy transformation', () => {
    it('should detect ownedBy -> owns', () => {
      const result = detectReverse('ownedBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('owns')
    })
  })

  describe('repliedBy transformation (consonant + y verbs)', () => {
    it('should detect repliedBy -> reply (or replied if that exists)', () => {
      // This tests verbs where -ied needs to become -y
      const result = detectReverse('repliedBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      // Should find 'reply' as the base form
      expect(result.relType).toBe('reply')
    })
  })

  describe('studiedBy transformation', () => {
    it('should detect studiedBy -> study', () => {
      const result = detectReverse('studiedBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('study')
    })
  })

  describe('appliedBy transformation', () => {
    it('should detect appliedBy -> applies', () => {
      const result = detectReverse('appliedBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('applies')
    })
  })

  describe('watchedBy transformation', () => {
    it('should detect watchedBy -> watches', () => {
      const result = detectReverse('watchedBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('watches')
    })
  })

  describe('hadBy transformation (irregular verb)', () => {
    it('should detect hadBy -> has', () => {
      const result = detectReverse('hadBy', knownRelTypes)

      expect(result.isReverse).toBe(true)
      expect(result.relType).toBe('has')
    })
  })
})

// ============================================================================
// EDGE CASES - Case Sensitivity
// ============================================================================

describe('detectReverse - Edge Cases: Case Sensitivity', () => {
  let knownRelTypes: Set<string>

  beforeEach(() => {
    knownRelTypes = new Set(['follows', 'LIKES', 'Authored'])
  })

  it('should be case-sensitive for exact matches', () => {
    const result = detectReverse('follows', knownRelTypes)

    expect(result.isReverse).toBe(false)
    expect(result.relType).toBe('follows')
  })

  it('should not match "FOLLOWS" to "follows" (case mismatch)', () => {
    const result = detectReverse('FOLLOWS', knownRelTypes)

    // 'FOLLOWS' is not in set (only 'follows' is), so treated as unknown
    expect(result.relType).toBe('FOLLOWS')
  })

  it('should handle mixed case in reverse detection', () => {
    // 'LIKES' is in the set
    const result = detectReverse('LIKES', knownRelTypes)

    expect(result.isReverse).toBe(false)
    expect(result.relType).toBe('LIKES')
  })

  it('should handle PascalCase relationship types', () => {
    // 'Authored' is in the set
    const result = detectReverse('AuthoredBy', knownRelTypes)

    expect(result.isReverse).toBe(true)
    expect(result.relType).toBe('Authored')
  })
})

// ============================================================================
// EDGE CASES - Special Characters and Unicode
// ============================================================================

describe('detectReverse - Edge Cases: Special Characters', () => {
  let knownRelTypes: Set<string>

  beforeEach(() => {
    knownRelTypes = new Set([
      'follows',
      'is_friend_of',
      'belongs-to',
    ])
  })

  it('should handle snake_case relationship types', () => {
    const result = detectReverse('is_friend_ofBy', knownRelTypes)

    expect(result.isReverse).toBe(true)
    expect(result.relType).toBe('is_friend_of')
  })

  it('should handle kebab-case relationship types', () => {
    const result = detectReverse('belongs-toBy', knownRelTypes)

    expect(result.isReverse).toBe(true)
    expect(result.relType).toBe('belongs-to')
  })

  it('should handle relationship type with only "By" suffix', () => {
    const result = detectReverse('By', knownRelTypes)

    expect(result.isReverse).toBe(false)
    expect(result.relType).toBe('By')
  })

  it('should handle single character before "By"', () => {
    const result = detectReverse('aBy', knownRelTypes)

    expect(result.isReverse).toBe(false)
    expect(result.relType).toBe('aBy')
  })
})

// ============================================================================
// EDGE CASES - Empty and Null Inputs
// ============================================================================

describe('detectReverse - Edge Cases: Empty and Edge Inputs', () => {
  let knownRelTypes: Set<string>

  beforeEach(() => {
    knownRelTypes = createStandardRelTypes()
  })

  it('should handle empty knownRelTypes set', () => {
    const emptySet = createEmptyRelTypes()
    const result = detectReverse('followedBy', emptySet)

    // No known types, so cannot detect reverse
    expect(result.isReverse).toBe(false)
    expect(result.relType).toBe('followedBy')
  })

  it('should handle whitespace in property name', () => {
    const result = detectReverse(' followedBy ', knownRelTypes)

    // Depending on implementation, might need trimming
    // This tests edge case handling
    expect(result.relType).toBeDefined()
  })

  it('should handle numeric suffixes', () => {
    const numericTypes = new Set(['follows1', 'likes2'])
    const result = detectReverse('follows1By', numericTypes)

    // Should detect 'follows1' if the pattern matching is smart enough
    expect(result.relType).toBeDefined()
  })
})

// ============================================================================
// RETURN TYPE STRUCTURE TESTS
// ============================================================================

describe('detectReverse - Return Type Structure', () => {
  let knownRelTypes: Set<string>

  beforeEach(() => {
    knownRelTypes = createStandardRelTypes()
  })

  it('should return object with isReverse property', () => {
    const result = detectReverse('follows', knownRelTypes)

    expect(result).toHaveProperty('isReverse')
    expect(typeof result.isReverse).toBe('boolean')
  })

  it('should return object with relType property', () => {
    const result = detectReverse('follows', knownRelTypes)

    expect(result).toHaveProperty('relType')
    expect(typeof result.relType).toBe('string')
  })

  it('should return object with direction property', () => {
    const result = detectReverse('follows', knownRelTypes)

    expect(result).toHaveProperty('direction')
    expect(['in', 'out']).toContain(result.direction)
  })

  it('should return consistent structure for reverse relationships', () => {
    const result = detectReverse('followedBy', knownRelTypes)

    expect(result).toEqual({
      isReverse: true,
      relType: 'follows',
      direction: 'in',
    })
  })

  it('should return consistent structure for direct relationships', () => {
    const result = detectReverse('follows', knownRelTypes)

    expect(result).toEqual({
      isReverse: false,
      relType: 'follows',
      direction: 'out',
    })
  })
})

// ============================================================================
// COMPREHENSIVE INTEGRATION-LIKE TESTS
// ============================================================================

describe('detectReverse - Comprehensive Patterns', () => {
  let knownRelTypes: Set<string>

  beforeEach(() => {
    // Comprehensive set of relationship types
    knownRelTypes = new Set([
      // Social
      'follows',
      'likes',
      'loves',
      'mentions',
      'blocks',
      'mutes',
      // Content
      'authored',
      'created',
      'published',
      'edited',
      'deleted',
      // Organizational
      'manages',
      'reportsTo',
      'memberOf',
      'owns',
      'employs',
      // Actions
      'replied',
      'commented',
      'shared',
      'bookmarked',
      'viewed',
      // Subscriptions
      'subscribedTo',
      'assignedTo',
      'delegatedTo',
    ])
  })

  describe('Social relationship reverses', () => {
    it('should detect all social reverses', () => {
      const socialReverses = [
        { input: 'followedBy', expected: 'follows' },
        { input: 'likedBy', expected: 'likes' },
        { input: 'lovedBy', expected: 'loves' },
        { input: 'mentionedBy', expected: 'mentions' },
        { input: 'blockedBy', expected: 'blocks' },
        { input: 'mutedBy', expected: 'mutes' },
      ]

      for (const { input, expected } of socialReverses) {
        const result = detectReverse(input, knownRelTypes)
        expect(result.isReverse).toBe(true)
        expect(result.relType).toBe(expected)
        expect(result.direction).toBe('in')
      }
    })
  })

  describe('Content relationship reverses', () => {
    it('should detect all content reverses', () => {
      const contentReverses = [
        { input: 'authoredBy', expected: 'authored' },
        { input: 'createdBy', expected: 'created' },
        { input: 'publishedBy', expected: 'published' },
        { input: 'editedBy', expected: 'edited' },
        { input: 'deletedBy', expected: 'deleted' },
      ]

      for (const { input, expected } of contentReverses) {
        const result = detectReverse(input, knownRelTypes)
        expect(result.isReverse).toBe(true)
        expect(result.relType).toBe(expected)
        expect(result.direction).toBe('in')
      }
    })
  })

  describe('Organizational relationship reverses', () => {
    it('should detect all organizational reverses', () => {
      const orgReverses = [
        { input: 'managedBy', expected: 'manages' },
        { input: 'reportsToBy', expected: 'reportsTo' },
        { input: 'memberOfBy', expected: 'memberOf' },
        { input: 'ownedBy', expected: 'owns' },
        { input: 'employedBy', expected: 'employs' },
      ]

      for (const { input, expected } of orgReverses) {
        const result = detectReverse(input, knownRelTypes)
        expect(result.isReverse).toBe(true)
        expect(result.relType).toBe(expected)
        expect(result.direction).toBe('in')
      }
    })
  })

  describe('Action relationship reverses', () => {
    it('should detect all action reverses', () => {
      const actionReverses = [
        { input: 'repliedBy', expected: 'replied' },
        { input: 'commentedBy', expected: 'commented' },
        { input: 'sharedBy', expected: 'shared' },
        { input: 'bookmarkedBy', expected: 'bookmarked' },
        { input: 'viewedBy', expected: 'viewed' },
      ]

      for (const { input, expected } of actionReverses) {
        const result = detectReverse(input, knownRelTypes)
        expect(result.isReverse).toBe(true)
        expect(result.relType).toBe(expected)
        expect(result.direction).toBe('in')
      }
    })
  })

  describe('Subscription relationship reverses', () => {
    it('should detect all subscription reverses', () => {
      const subscriptionReverses = [
        { input: 'subscribedToBy', expected: 'subscribedTo' },
        { input: 'assignedToBy', expected: 'assignedTo' },
        { input: 'delegatedToBy', expected: 'delegatedTo' },
      ]

      for (const { input, expected } of subscriptionReverses) {
        const result = detectReverse(input, knownRelTypes)
        expect(result.isReverse).toBe(true)
        expect(result.relType).toBe(expected)
        expect(result.direction).toBe('in')
      }
    })
  })
})

// ============================================================================
// PERFORMANCE CONSIDERATIONS
// ============================================================================

describe('detectReverse - Performance Considerations', () => {
  it('should handle large knownRelTypes set efficiently', () => {
    // Create a large set with 1000 relationship types
    const largeSet = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      largeSet.add(`relationship${i}`)
    }
    largeSet.add('follows') // Add the one we're looking for

    const start = performance.now()
    const result = detectReverse('followedBy', largeSet)
    const elapsed = performance.now() - start

    expect(result.isReverse).toBe(true)
    expect(result.relType).toBe('follows')
    // Should complete in reasonable time (< 10ms)
    expect(elapsed).toBeLessThan(10)
  })

  it('should not have exponential behavior with long property names', () => {
    const knownRelTypes = createStandardRelTypes()
    const longProp = 'a'.repeat(1000) + 'By'

    const start = performance.now()
    const result = detectReverse(longProp, knownRelTypes)
    const elapsed = performance.now() - start

    expect(result.relType).toBeDefined()
    // Should complete in reasonable time (< 10ms)
    expect(elapsed).toBeLessThan(10)
  })
})

// ============================================================================
// TYPE SAFETY TESTS
// ============================================================================

describe('detectReverse - Type Safety', () => {
  it('should accept Set<string> for knownRelTypes', () => {
    const knownRelTypes: Set<string> = new Set(['follows', 'likes'])
    const result = detectReverse('followedBy', knownRelTypes)

    expect(result).toBeDefined()
  })

  it('should return ReverseDetectionResult type', () => {
    const knownRelTypes = createStandardRelTypes()
    const result: ReverseDetectionResult = detectReverse('followedBy', knownRelTypes)

    // Type check - these should all be defined based on ReverseDetectionResult interface
    const _isReverse: boolean = result.isReverse
    const _relType: string = result.relType
    const _direction: 'in' | 'out' = result.direction

    expect(_isReverse).toBe(true)
    expect(_relType).toBe('follows')
    expect(_direction).toBe('in')
  })
})
