import { describe, it, expect } from 'vitest'

/**
 * Cascade Reference Operator Parsing Tests
 *
 * Four operators for cascade generation:
 * - `->` Forward Exact: Generate NEW entity, link TO it
 * - `~>` Forward Fuzzy: Semantic search existing, generate if not found
 * - `<-` Backward Exact: Generate NEW entity, link FROM it to this
 * - `<~` Backward Fuzzy: Semantic search related, link FROM found
 *
 * This is RED phase TDD - tests should FAIL until parse-reference.ts is implemented.
 *
 * Usage in schema:
 * ```typescript
 * const schema = DB({
 *   Startup: {
 *     idea: 'What is the idea? <-Idea',       // Backward exact
 *     customer: '~>IdealCustomerProfile',     // Forward fuzzy
 *     founders: '->Founder[]',                // Forward exact array
 *     owner: '->User?',                       // Forward exact optional
 *     stakeholder: '->User|Org',              // Forward exact union
 *   },
 * })
 * ```
 */

// These imports should FAIL until implemented
import {
  parseReferenceOperator,
  type ParsedReference,
  type OperatorDirection,
  type OperatorMode,
} from '../parse-reference'

// ============================================================================
// Types (Expected Interface)
// ============================================================================

interface ExpectedParsedReference {
  prompt?: string // Text before operator
  operator: '->' | '~>' | '<-' | '<~'
  direction: 'forward' | 'backward'
  mode: 'exact' | 'fuzzy'
  target: string // Primary target type
  targets?: string[] // For union types: ['User', 'Org']
  isArray?: boolean // -> Founder[]
  isOptional?: boolean // -> User?
}

// ============================================================================
// 1. Forward Exact Operator (->) Tests
// ============================================================================

describe('Forward Exact Operator (->)', () => {
  describe('Basic Parsing', () => {
    it('parses simple forward reference: ->User', () => {
      const result = parseReferenceOperator('->User')

      expect(result).not.toBeNull()
      expect(result?.direction).toBe('forward')
      expect(result?.mode).toBe('exact')
      expect(result?.target).toBe('User')
      expect(result?.operator).toBe('->')
    })

    it('parses forward reference with PascalCase: ->IdealCustomerProfile', () => {
      const result = parseReferenceOperator('->IdealCustomerProfile')

      expect(result?.target).toBe('IdealCustomerProfile')
      expect(result?.direction).toBe('forward')
      expect(result?.mode).toBe('exact')
    })

    it('parses forward reference with lowercase: ->category', () => {
      const result = parseReferenceOperator('->category')

      expect(result?.target).toBe('category')
    })
  })

  describe('Array Modifier ([])', () => {
    it('parses array reference: ->User[]', () => {
      const result = parseReferenceOperator('->User[]')

      expect(result?.target).toBe('User')
      expect(result?.isArray).toBe(true)
      expect(result?.isOptional).toBeFalsy()
    })

    it('parses array with long type name: ->Founder[]', () => {
      const result = parseReferenceOperator('->Founder[]')

      expect(result?.target).toBe('Founder')
      expect(result?.isArray).toBe(true)
    })
  })

  describe('Optional Modifier (?)', () => {
    it('parses optional reference: ->User?', () => {
      const result = parseReferenceOperator('->User?')

      expect(result?.target).toBe('User')
      expect(result?.isOptional).toBe(true)
      expect(result?.isArray).toBeFalsy()
    })

    it('parses optional array: ->User[]?', () => {
      const result = parseReferenceOperator('->User[]?')

      expect(result?.target).toBe('User')
      expect(result?.isArray).toBe(true)
      expect(result?.isOptional).toBe(true)
    })
  })

  describe('Union Types (|)', () => {
    it('parses union of two types: ->User|Org', () => {
      const result = parseReferenceOperator('->User|Org')

      expect(result?.target).toBe('User') // First type is primary
      expect(result?.targets).toEqual(['User', 'Org'])
    })

    it('parses union of three types: ->User|Org|Team', () => {
      const result = parseReferenceOperator('->User|Org|Team')

      expect(result?.target).toBe('User')
      expect(result?.targets).toEqual(['User', 'Org', 'Team'])
    })

    it('parses union with array modifier: ->User|Org[]', () => {
      const result = parseReferenceOperator('->User|Org[]')

      expect(result?.targets).toEqual(['User', 'Org'])
      expect(result?.isArray).toBe(true)
    })

    it('parses union with optional modifier: ->User|Org?', () => {
      const result = parseReferenceOperator('->User|Org?')

      expect(result?.targets).toEqual(['User', 'Org'])
      expect(result?.isOptional).toBe(true)
    })
  })
})

// ============================================================================
// 2. Forward Fuzzy Operator (~>) Tests
// ============================================================================

describe('Forward Fuzzy Operator (~>)', () => {
  describe('Basic Parsing', () => {
    it('parses simple fuzzy forward reference: ~>Category', () => {
      const result = parseReferenceOperator('~>Category')

      expect(result).not.toBeNull()
      expect(result?.direction).toBe('forward')
      expect(result?.mode).toBe('fuzzy')
      expect(result?.target).toBe('Category')
      expect(result?.operator).toBe('~>')
    })

    it('parses fuzzy reference: ~>IdealCustomerProfile', () => {
      const result = parseReferenceOperator('~>IdealCustomerProfile')

      expect(result?.target).toBe('IdealCustomerProfile')
      expect(result?.mode).toBe('fuzzy')
    })
  })

  describe('Modifiers', () => {
    it('parses fuzzy array: ~>Tag[]', () => {
      const result = parseReferenceOperator('~>Tag[]')

      expect(result?.target).toBe('Tag')
      expect(result?.mode).toBe('fuzzy')
      expect(result?.isArray).toBe(true)
    })

    it('parses fuzzy optional: ~>Customer?', () => {
      const result = parseReferenceOperator('~>Customer?')

      expect(result?.target).toBe('Customer')
      expect(result?.mode).toBe('fuzzy')
      expect(result?.isOptional).toBe(true)
    })

    it('parses fuzzy union: ~>Person|Employee', () => {
      const result = parseReferenceOperator('~>Person|Employee')

      expect(result?.targets).toEqual(['Person', 'Employee'])
      expect(result?.mode).toBe('fuzzy')
    })
  })

  describe('Semantic Search Behavior', () => {
    it('fuzzy mode indicates semantic search before generation', () => {
      const result = parseReferenceOperator('~>Category')

      // Fuzzy mode means: search for existing matching entities first
      // Only generate new if semantic search finds nothing
      expect(result?.mode).toBe('fuzzy')
      expect(result?.direction).toBe('forward')
    })
  })
})

// ============================================================================
// 3. Backward Exact Operator (<-) Tests
// ============================================================================

describe('Backward Exact Operator (<-)', () => {
  describe('Basic Parsing', () => {
    it('parses simple backward reference: <-Post', () => {
      const result = parseReferenceOperator('<-Post')

      expect(result).not.toBeNull()
      expect(result?.direction).toBe('backward')
      expect(result?.mode).toBe('exact')
      expect(result?.target).toBe('Post')
      expect(result?.operator).toBe('<-')
    })

    it('parses backward reference: <-Idea', () => {
      const result = parseReferenceOperator('<-Idea')

      expect(result?.target).toBe('Idea')
      expect(result?.direction).toBe('backward')
    })
  })

  describe('Modifiers', () => {
    it('parses backward array: <-Comment[]', () => {
      const result = parseReferenceOperator('<-Comment[]')

      expect(result?.target).toBe('Comment')
      expect(result?.direction).toBe('backward')
      expect(result?.isArray).toBe(true)
    })

    it('parses backward optional: <-Parent?', () => {
      const result = parseReferenceOperator('<-Parent?')

      expect(result?.target).toBe('Parent')
      expect(result?.isOptional).toBe(true)
    })

    it('parses backward union: <-Author|Editor', () => {
      const result = parseReferenceOperator('<-Author|Editor')

      expect(result?.targets).toEqual(['Author', 'Editor'])
      expect(result?.direction).toBe('backward')
    })
  })

  describe('Backward Link Semantics', () => {
    it('backward means target links TO this entity', () => {
      const result = parseReferenceOperator('<-Post')

      // <-Post means: generate Post entity that links TO this entity
      // The Post has a field referencing this, not vice versa
      expect(result?.direction).toBe('backward')
      expect(result?.mode).toBe('exact')
    })
  })
})

// ============================================================================
// 4. Backward Fuzzy Operator (<~) Tests
// ============================================================================

describe('Backward Fuzzy Operator (<~)', () => {
  describe('Basic Parsing', () => {
    it('parses simple backward fuzzy reference: <~Article', () => {
      const result = parseReferenceOperator('<~Article')

      expect(result).not.toBeNull()
      expect(result?.direction).toBe('backward')
      expect(result?.mode).toBe('fuzzy')
      expect(result?.target).toBe('Article')
      expect(result?.operator).toBe('<~')
    })

    it('parses backward fuzzy: <~RelatedContent', () => {
      const result = parseReferenceOperator('<~RelatedContent')

      expect(result?.target).toBe('RelatedContent')
      expect(result?.mode).toBe('fuzzy')
    })
  })

  describe('Modifiers', () => {
    it('parses backward fuzzy array: <~Citation[]', () => {
      const result = parseReferenceOperator('<~Citation[]')

      expect(result?.target).toBe('Citation')
      expect(result?.mode).toBe('fuzzy')
      expect(result?.isArray).toBe(true)
    })

    it('parses backward fuzzy optional: <~Source?', () => {
      const result = parseReferenceOperator('<~Source?')

      expect(result?.target).toBe('Source')
      expect(result?.isOptional).toBe(true)
    })

    it('parses backward fuzzy union: <~Reference|Footnote', () => {
      const result = parseReferenceOperator('<~Reference|Footnote')

      expect(result?.targets).toEqual(['Reference', 'Footnote'])
      expect(result?.direction).toBe('backward')
      expect(result?.mode).toBe('fuzzy')
    })
  })

  describe('Backward Fuzzy Semantics', () => {
    it('backward fuzzy means semantic search for entities linking to this', () => {
      const result = parseReferenceOperator('<~Article')

      // <~Article means: semantic search for Article entities related to this
      // Then establish backward links from found entities
      expect(result?.direction).toBe('backward')
      expect(result?.mode).toBe('fuzzy')
    })
  })
})

// ============================================================================
// 5. Combined with Prompts Tests
// ============================================================================

describe('Combined with Prompts', () => {
  describe('Prompt Extraction', () => {
    it('extracts prompt before backward operator: "What is the idea? <-Idea"', () => {
      const result = parseReferenceOperator('What is the idea? <-Idea')

      expect(result?.prompt).toBe('What is the idea?')
      expect(result?.operator).toBe('<-')
      expect(result?.target).toBe('Idea')
      expect(result?.direction).toBe('backward')
    })

    it('extracts prompt before forward operator: "Who created this? ->Author"', () => {
      const result = parseReferenceOperator('Who created this? ->Author')

      expect(result?.prompt).toBe('Who created this?')
      expect(result?.operator).toBe('->')
      expect(result?.target).toBe('Author')
    })

    it('extracts prompt before fuzzy operator: "Find related ~>Category"', () => {
      const result = parseReferenceOperator('Find related ~>Category')

      expect(result?.prompt).toBe('Find related')
      expect(result?.mode).toBe('fuzzy')
    })

    it('extracts prompt with trailing whitespace: "   Who?   ->Person"', () => {
      const result = parseReferenceOperator('   Who?   ->Person')

      expect(result?.prompt).toBe('Who?')
      expect(result?.target).toBe('Person')
    })
  })

  describe('Prompt + Union Types', () => {
    it('parses prompt with union: "Who? ~>Person|Employee"', () => {
      const result = parseReferenceOperator('Who? ~>Person|Employee')

      expect(result?.prompt).toBe('Who?')
      expect(result?.mode).toBe('fuzzy')
      expect(result?.targets).toEqual(['Person', 'Employee'])
    })

    it('parses complex prompt with union and array: "List stakeholders ->User|Org[]"', () => {
      const result = parseReferenceOperator('List stakeholders ->User|Org[]')

      expect(result?.prompt).toBe('List stakeholders')
      expect(result?.targets).toEqual(['User', 'Org'])
      expect(result?.isArray).toBe(true)
    })
  })

  describe('Prompt + Modifiers', () => {
    it('parses prompt with optional: "Optional parent? <-Parent?"', () => {
      const result = parseReferenceOperator('Optional parent? <-Parent?')

      expect(result?.prompt).toBe('Optional parent?')
      expect(result?.isOptional).toBe(true)
      expect(result?.direction).toBe('backward')
    })

    it('parses multi-sentence prompt: "Define the concept. What makes it unique? ->Concept"', () => {
      const result = parseReferenceOperator(
        'Define the concept. What makes it unique? ->Concept',
      )

      expect(result?.prompt).toBe('Define the concept. What makes it unique?')
      expect(result?.target).toBe('Concept')
    })
  })

  describe('Edge Cases', () => {
    it('handles empty prompt (operator at start): "->User" has no prompt', () => {
      const result = parseReferenceOperator('->User')

      expect(result?.prompt).toBeUndefined()
      // Or it could be empty string depending on implementation
      // expect(result?.prompt).toBe('')
    })

    it('handles prompt with special characters: "What\'s the target? ->Target"', () => {
      const result = parseReferenceOperator("What's the target? ->Target")

      expect(result?.prompt).toBe("What's the target?")
    })

    it('handles prompt with newlines', () => {
      const result = parseReferenceOperator('Line one\nLine two ->Entity')

      expect(result?.prompt).toBe('Line one\nLine two')
      expect(result?.target).toBe('Entity')
    })
  })
})

// ============================================================================
// 6. Non-Reference Strings (No Operator) Tests
// ============================================================================

describe('Non-Reference Strings (No Operator)', () => {
  it('returns null for plain string without operator', () => {
    const result = parseReferenceOperator('What is the concept?')

    expect(result).toBeNull()
  })

  it('returns null for string with arrow-like characters but not operators', () => {
    const result = parseReferenceOperator('Use > and < for comparison')

    expect(result).toBeNull()
  })

  it('returns null for string with tilde but not operator', () => {
    const result = parseReferenceOperator('About ~100 items')

    expect(result).toBeNull()
  })

  it('returns null for empty string', () => {
    const result = parseReferenceOperator('')

    expect(result).toBeNull()
  })

  it('returns null for string with dash only', () => {
    const result = parseReferenceOperator('some-value')

    expect(result).toBeNull()
  })

  it('returns null for URL-like strings', () => {
    const result = parseReferenceOperator('https://example.com')

    expect(result).toBeNull()
  })
})

// ============================================================================
// 7. Type Export Tests
// ============================================================================

describe('Type Exports', () => {
  it('ParsedReference type is exported', () => {
    // Type check - if this compiles, the type is exported correctly
    const ref: ParsedReference = {
      operator: '->',
      direction: 'forward',
      mode: 'exact',
      target: 'User',
    }
    expect(ref.direction).toBe('forward')
  })

  it('OperatorDirection type includes forward and backward', () => {
    const forward: OperatorDirection = 'forward'
    const backward: OperatorDirection = 'backward'
    expect(forward).toBe('forward')
    expect(backward).toBe('backward')
  })

  it('OperatorMode type includes exact and fuzzy', () => {
    const exact: OperatorMode = 'exact'
    const fuzzy: OperatorMode = 'fuzzy'
    expect(exact).toBe('exact')
    expect(fuzzy).toBe('fuzzy')
  })
})

// ============================================================================
// 8. Operator Constants Tests
// ============================================================================

describe('Operator Constants', () => {
  it('recognizes all four operator strings', () => {
    const operators = ['->', '~>', '<-', '<~']

    for (const op of operators) {
      const result = parseReferenceOperator(`${op}Type`)
      expect(result).not.toBeNull()
      expect(result?.operator).toBe(op)
    }
  })

  it('-> is forward exact', () => {
    const result = parseReferenceOperator('->X')
    expect(result?.direction).toBe('forward')
    expect(result?.mode).toBe('exact')
  })

  it('~> is forward fuzzy', () => {
    const result = parseReferenceOperator('~>X')
    expect(result?.direction).toBe('forward')
    expect(result?.mode).toBe('fuzzy')
  })

  it('<- is backward exact', () => {
    const result = parseReferenceOperator('<-X')
    expect(result?.direction).toBe('backward')
    expect(result?.mode).toBe('exact')
  })

  it('<~ is backward fuzzy', () => {
    const result = parseReferenceOperator('<~X')
    expect(result?.direction).toBe('backward')
    expect(result?.mode).toBe('fuzzy')
  })
})
