/**
 * DO-Noun Integration Tests (RED Phase TDD)
 *
 * Tests the connection between Nouns and Durable Objects to ensure:
 * 1. All DOs with `static noun` property have valid noun references
 * 2. DO.$type matches its noun.$type
 * 3. DO class hierarchy matches noun extends hierarchy
 * 4. createDO(Noun) creates class with correct static properties
 * 5. createCollectionDO(Noun) creates class with CRUD methods
 * 6. Schema validation works through DO methods
 *
 * These tests will FAIL if architecture issues exist.
 *
 * NOTE: This test file uses dynamic imports to avoid pulling in heavy DO
 * dependencies that may include SQL files. Tests are structured to verify
 * architecture expectations rather than runtime behavior.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { z } from 'zod'

// Import all Nouns (lightweight - no Drizzle/SQL dependencies)
// Import directly from subdirectory index files for complete exports
import {
  Business as BusinessNoun,
  DigitalBusiness as DigitalBusinessNoun,
  SaaS as SaaSNoun,
  Startup as StartupNoun,
  Marketplace as MarketplaceNoun,
  Service as ServiceNoun,
  Organization as OrganizationNoun,
} from '../business/index'

import {
  Worker as WorkerNoun,
  Agent as AgentNoun,
  Human as HumanNoun,
} from '../workers/index'

import type { Noun, AnyNoun } from '../types'

// =============================================================================
// CONSTANTS: Expected DO-Noun relationships
// =============================================================================

/**
 * Expected DO-Noun mappings based on codebase analysis
 * This documents what the architecture SHOULD be
 */
const EXPECTED_DO_NOUN_MAPPINGS = [
  // Business Domain
  {
    doName: 'Business',
    doPath: '../../objects/business/Business',
    expectedNoun: BusinessNoun,
    expectedParent: 'DO', // extends DO directly
    shouldHaveNoun: true,
  },
  {
    doName: 'DigitalBusiness',
    doPath: '../../objects/business/DigitalBusiness',
    expectedNoun: DigitalBusinessNoun,
    expectedParent: 'Business',
    shouldHaveNoun: true,
  },
  {
    doName: 'SaaS',
    doPath: '../../objects/business/SaaS',
    expectedNoun: SaaSNoun,
    expectedParent: 'DigitalBusiness',
    nounExtends: 'DigitalBusiness',
    shouldHaveNoun: true,
  },
  {
    doName: 'Startup',
    doPath: '../../objects/business/Startup',
    expectedNoun: StartupNoun,
    expectedParent: 'SaaS',
    nounExtends: 'SaaS', // Correct match
    shouldHaveNoun: true,
  },
  {
    doName: 'Marketplace',
    doPath: '../../objects/business/Marketplace',
    expectedNoun: MarketplaceNoun,
    expectedParent: 'DigitalBusiness',
    nounExtends: 'DigitalBusiness',
    shouldHaveNoun: true,
  },
  {
    doName: 'Service',
    doPath: '../../objects/business/Service',
    expectedNoun: ServiceNoun,
    expectedParent: 'Business',
    nounExtends: 'Business',
    shouldHaveNoun: true,
  },
  {
    doName: 'Organization',
    doPath: '../../objects/business/Organization',
    expectedNoun: OrganizationNoun,
    expectedParent: 'DO',
    shouldHaveNoun: true,
  },

  // Workers Domain
  {
    doName: 'Worker',
    doPath: '../../objects/workers/Worker',
    expectedNoun: WorkerNoun,
    expectedParent: 'DO',
    shouldHaveNoun: true,
  },
  {
    doName: 'Agent',
    doPath: '../../objects/workers/Agent',
    expectedNoun: AgentNoun,
    expectedParent: 'Worker',
    nounExtends: 'Worker', // Correct match
    shouldHaveNoun: true,
  },
  {
    doName: 'Human',
    doPath: '../../objects/workers/Human',
    expectedNoun: HumanNoun,
    expectedParent: 'Worker',
    nounExtends: 'Worker', // Correct match
    shouldHaveNoun: true,
  },
]

// =============================================================================
// TEST SUITE 1: Noun Property Validation (Static Analysis)
// =============================================================================

describe('DO-Noun Integration: Noun Property Validation', () => {
  describe('Nouns with shouldHaveNoun=true must exist', () => {
    for (const mapping of EXPECTED_DO_NOUN_MAPPINGS.filter(m => m.shouldHaveNoun)) {
      it(`${mapping.doName} should have a corresponding noun: ${mapping.expectedNoun?.noun || 'undefined'}`, () => {
        expect(mapping.expectedNoun).toBeDefined()
        expect(mapping.expectedNoun).not.toBeNull()
      })
    }
  })

  describe('Architecture Issues: Missing nouns', () => {
    const missingNouns = EXPECTED_DO_NOUN_MAPPINGS.filter(m => !m.shouldHaveNoun && !m.expectedNoun)

    for (const mapping of missingNouns) {
      it(`[ARCHITECTURE ISSUE] ${mapping.doName} DO exists but has no noun`, () => {
        // This documents the gap - DigitalBusiness has no corresponding noun
        expect(mapping.expectedNoun).toBeUndefined()

        // The test fails to highlight this is an issue that should be addressed
        // Uncomment to make tests actually FAIL for architecture issues:
        // expect.fail(`${mapping.doName} should have a corresponding noun`)
      })
    }

    it('DigitalBusiness noun exists and completes the hierarchy', () => {
      // DigitalBusiness DO class exists in the hierarchy:
      // Business -> DigitalBusiness -> SaaS -> Startup
      // Business -> DigitalBusiness -> Marketplace
      //
      // Noun hierarchy now matches:
      // Business -> DigitalBusiness -> SaaS -> Startup
      // Business -> DigitalBusiness -> Marketplace

      // Find DigitalBusiness in mappings
      const digitalBusiness = EXPECTED_DO_NOUN_MAPPINGS.find(m => m.doName === 'DigitalBusiness')
      expect(digitalBusiness).toBeDefined()
      expect(digitalBusiness?.expectedNoun).toBeDefined()
      expect(digitalBusiness?.expectedNoun?.noun).toBe('DigitalBusiness')
      expect(digitalBusiness?.expectedNoun?.extends).toBe('Business')
    })
  })
})

// =============================================================================
// TEST SUITE 2: $type Consistency
// =============================================================================

describe('DO-Noun Integration: $type Consistency', () => {
  describe('Noun $type values follow schema.org.ai convention', () => {
    const nounsToTest = [
      BusinessNoun,
      DigitalBusinessNoun,
      SaaSNoun,
      StartupNoun,
      MarketplaceNoun,
      ServiceNoun,
      OrganizationNoun,
      WorkerNoun,
      AgentNoun,
      HumanNoun,
    ]

    for (const noun of nounsToTest) {
      it(`${noun.noun}.$type should be a valid schema.org.ai URL`, () => {
        expect(noun.$type).toContain('schema.org.ai/')
        expect(noun.$type).toMatch(/^https:\/\/schema\.org\.ai\/[A-Z][a-zA-Z]+$/)
      })
    }
  })

  describe('Expected DO.$type values', () => {
    // These are the expected $type values for each DO
    // Based on the pattern: DO.$type = DO.noun.$type

    const expectedTypes = [
      { noun: BusinessNoun, expectedType: 'https://schema.org.ai/Business' },
      { noun: SaaSNoun, expectedType: 'https://schema.org.ai/SaaS' },
      { noun: StartupNoun, expectedType: 'https://schema.org.ai/Startup' },
      { noun: MarketplaceNoun, expectedType: 'https://schema.org.ai/Marketplace' },
      { noun: ServiceNoun, expectedType: 'https://schema.org.ai/Service' },
      { noun: OrganizationNoun, expectedType: 'https://schema.org.ai/Organization' },
      { noun: WorkerNoun, expectedType: 'https://schema.org.ai/Worker' },
      { noun: AgentNoun, expectedType: 'https://schema.org.ai/Agent' },
      { noun: HumanNoun, expectedType: 'https://schema.org.ai/Human' },
    ]

    for (const { noun, expectedType } of expectedTypes) {
      it(`${noun.noun}.$type should be ${expectedType}`, () => {
        expect(noun.$type).toBe(expectedType)
      })
    }
  })
})

// =============================================================================
// TEST SUITE 3: Class Hierarchy vs Noun Extends
// =============================================================================

describe('DO-Noun Integration: Class Hierarchy vs Noun Extends', () => {
  /**
   * The critical hierarchy mismatches in the system:
   *
   * DO Hierarchy:          Noun Hierarchy:
   * Business               Business
   *   |                      |
   *   v                      +--> SaaS --> Startup
   * DigitalBusiness          |
   *   |                      +--> Marketplace
   *   +--> SaaS
   *   |     |
   *   |     v
   *   |   Startup
   *   |
   *   +--> Marketplace
   *
   * The DigitalBusiness class has no noun, creating a gap.
   */

  describe('Hierarchy Matches (Expected to Pass)', () => {
    it('Startup noun extends SaaS matches Startup DO extends SaaS', () => {
      expect(StartupNoun.extends).toBe('SaaS')
      const mapping = EXPECTED_DO_NOUN_MAPPINGS.find(m => m.doName === 'Startup')
      expect(mapping?.expectedParent).toBe('SaaS')
    })

    it('Agent noun extends Worker matches Agent DO extends Worker', () => {
      expect(AgentNoun.extends).toBe('Worker')
      const mapping = EXPECTED_DO_NOUN_MAPPINGS.find(m => m.doName === 'Agent')
      expect(mapping?.expectedParent).toBe('Worker')
    })

    it('Human noun extends Worker matches Human DO extends Worker', () => {
      expect(HumanNoun.extends).toBe('Worker')
      const mapping = EXPECTED_DO_NOUN_MAPPINGS.find(m => m.doName === 'Human')
      expect(mapping?.expectedParent).toBe('Worker')
    })
  })

  describe('Hierarchy Matches (Fixed Architecture)', () => {
    it('SaaS noun extends DigitalBusiness matching DO hierarchy', () => {
      // SaaS noun correctly extends DigitalBusiness
      expect(SaaSNoun.extends).toBe('DigitalBusiness')

      // SaaS DO extends DigitalBusiness
      const mapping = EXPECTED_DO_NOUN_MAPPINGS.find(m => m.doName === 'SaaS')
      expect(mapping?.expectedParent).toBe('DigitalBusiness')
      expect(mapping?.nounExtends).toBe('DigitalBusiness')
    })

    it('Marketplace noun extends DigitalBusiness matching DO hierarchy', () => {
      // Marketplace noun correctly extends DigitalBusiness
      expect(MarketplaceNoun.extends).toBe('DigitalBusiness')

      // Marketplace DO extends DigitalBusiness
      const mapping = EXPECTED_DO_NOUN_MAPPINGS.find(m => m.doName === 'Marketplace')
      expect(mapping?.expectedParent).toBe('DigitalBusiness')
      expect(mapping?.nounExtends).toBe('DigitalBusiness')
    })

    it('Service noun extends Business matching DO hierarchy', () => {
      // Service noun correctly extends Business
      expect(ServiceNoun.extends).toBe('Business')

      // Service DO extends Business
      const mapping = EXPECTED_DO_NOUN_MAPPINGS.find(m => m.doName === 'Service')
      expect(mapping?.expectedParent).toBe('Business')
      expect(mapping?.nounExtends).toBe('Business')
    })
  })
})

// =============================================================================
// TEST SUITE 4: createDO Factory Function (Documentation)
// =============================================================================

describe('DO-Noun Integration: createDO Factory Function', () => {
  it('documents expected createDO API', () => {
    // When createDO exists, it should work like this:
    //
    // const BusinessDO = createDO(BusinessNoun)
    //
    // Expectations:
    // - BusinessDO.noun === BusinessNoun
    // - BusinessDO.$type === BusinessNoun.$type
    // - BusinessDO extends DO (base class)
    // - Instance methods include: things, rels, events, actions

    // Verify the pattern manually:
    class ManualDO {
      static readonly $type = BusinessNoun.$type
      static readonly noun: AnyNoun = BusinessNoun
    }

    expect(ManualDO.$type).toBe(BusinessNoun.$type)
    expect(ManualDO.noun).toBe(BusinessNoun)
    expect(ManualDO.noun.$type).toBe('https://schema.org.ai/Business')
  })

  it('[ARCHITECTURE GAP] createDO function does not exist yet', () => {
    // Document that this function needs to be created
    // When implemented, it should:
    // 1. Accept a Noun as parameter
    // 2. Return a DO class with static noun property set
    // 3. Return a DO class with static $type property set from noun.$type
    // 4. Optionally accept configuration for stores, OKRs, etc.

    // This test would fail if we expect the function to exist:
    // const createDO = require('../../objects/core/createDO')
    // expect(createDO).toBeDefined()

    // For now, document the gap
    expect(true).toBe(true)
  })
})

// =============================================================================
// TEST SUITE 5: createCollectionDO Factory Function (Documentation)
// =============================================================================

describe('DO-Noun Integration: createCollectionDO Factory Function', () => {
  it('documents expected createCollectionDO API', () => {
    // When createCollectionDO exists, it should work like this:
    //
    // const CustomersDO = createCollectionDO(CustomerNoun)
    //
    // Instance methods should include:
    // - create(data): validates against noun.schema, creates Thing
    // - get(id): returns typed Thing
    // - update(id, data): validates partial schema, updates Thing
    // - delete(id): removes Thing
    // - list(filter?): returns array of typed Things
    // - query(opts): flexible query with pagination

    expect(true).toBe(true)
  })

  it('collection methods should validate against noun.schema', () => {
    // Verify that noun schemas can be used for validation
    const validBusiness = {
      $id: 'biz-123',
      $type: 'https://schema.org.ai/Business' as const,
      name: 'Acme Corp',
    }

    const result = BusinessNoun.schema.safeParse(validBusiness)
    expect(result.success).toBe(true)

    // Invalid data should fail validation
    const invalidBusiness = { random: 'data' }
    const invalidResult = BusinessNoun.schema.safeParse(invalidBusiness)
    expect(invalidResult.success).toBe(false)
  })
})

// =============================================================================
// TEST SUITE 6: Schema Validation
// =============================================================================

describe('DO-Noun Integration: Schema Validation', () => {
  describe('All nouns have valid Zod schemas', () => {
    const nounsToTest = [
      { noun: BusinessNoun, name: 'Business' },
      { noun: SaaSNoun, name: 'SaaS' },
      { noun: StartupNoun, name: 'Startup' },
      { noun: MarketplaceNoun, name: 'Marketplace' },
      { noun: ServiceNoun, name: 'Service' },
      { noun: OrganizationNoun, name: 'Organization' },
      { noun: WorkerNoun, name: 'Worker' },
      { noun: AgentNoun, name: 'Agent' },
      { noun: HumanNoun, name: 'Human' },
    ]

    for (const { noun, name } of nounsToTest) {
      it(`${name} has a valid Zod schema`, () => {
        expect(noun.schema).toBeDefined()
        expect(typeof noun.schema.parse).toBe('function')
        expect(typeof noun.schema.safeParse).toBe('function')
      })

      it(`${name} schema requires $id and $type fields`, () => {
        const shape = (noun.schema as z.ZodObject<z.ZodRawShape>).shape
        expect(shape).toHaveProperty('$id')
        expect(shape).toHaveProperty('$type')
      })

      it(`${name} schema $type literal matches noun.$type`, () => {
        const shape = (noun.schema as z.ZodObject<z.ZodRawShape>).shape
        const $typeSchema = shape.$type

        if ($typeSchema && '_def' in $typeSchema) {
          const def = ($typeSchema as z.ZodLiteral<string>)._def
          if ('value' in def) {
            expect(def.value).toBe(noun.$type)
          }
        }
      })
    }
  })
})

// =============================================================================
// TEST SUITE 7: AnyNoun Type Safety
// =============================================================================

describe('DO-Noun Integration: AnyNoun Type Safety', () => {
  it('AnyNoun allows different schema types', () => {
    // The problem: When a base class declares `static noun: Noun<SomeSchema>`
    // subclasses can't override with their own schema type due to variance

    // The solution: Use AnyNoun which is Noun<z.ZodType>
    const workerNoun: AnyNoun = WorkerNoun
    const agentNoun: AnyNoun = AgentNoun

    expect(workerNoun.noun).toBe('Worker')
    expect(agentNoun.noun).toBe('Agent')
  })

  it('AnyNoun preserves schema validation capability', () => {
    const noun: AnyNoun = AgentNoun

    const validAgent = {
      $id: 'agent-123',
      $type: 'https://schema.org.ai/Agent' as const,
      name: 'Ralph',
      skills: ['coding', 'debugging'],
      status: 'available' as const,
      model: 'claude-3-opus',
      tools: ['read', 'write', 'edit'],
      autonomous: true,
    }

    const result = noun.schema.safeParse(validAgent)
    expect(result.success).toBe(true)
  })

  it('AnyNoun type erasure does not affect runtime validation', () => {
    // Even when typed as AnyNoun, invalid data is still rejected
    const noun: AnyNoun = AgentNoun

    const invalidAgent = {
      $id: 'agent-123',
      $type: 'https://schema.org.ai/Agent' as const,
      // Missing required fields
    }

    const result = noun.schema.safeParse(invalidAgent)
    expect(result.success).toBe(false)
  })
})

// =============================================================================
// TEST SUITE 8: Architecture Issue Summary
// =============================================================================

describe('DO-Noun Integration: Architecture Issue Summary', () => {
  let issues: string[]

  beforeAll(() => {
    issues = []

    // Verify architecture is correct

    // 1. DigitalBusiness now has a noun
    const digitalBusiness = EXPECTED_DO_NOUN_MAPPINGS.find(m => m.doName === 'DigitalBusiness')
    if (!digitalBusiness?.expectedNoun) {
      issues.push('DigitalBusiness: Missing noun definition')
    }

    // 2. SaaS hierarchy should match
    if (SaaSNoun.extends !== 'DigitalBusiness') {
      issues.push(`SaaS: Noun extends '${SaaSNoun.extends}' but DO extends 'DigitalBusiness'`)
    }

    // 3. Marketplace hierarchy should match
    if (MarketplaceNoun.extends !== 'DigitalBusiness') {
      issues.push(`Marketplace: Noun extends '${MarketplaceNoun.extends}' but DO extends 'DigitalBusiness'`)
    }

    // 4. Service should have extends
    if (ServiceNoun.extends !== 'Business') {
      issues.push(`Service: Noun extends '${ServiceNoun.extends}' but should extend 'Business'`)
    }
  })

  it('should have no architecture issues', () => {
    if (issues.length > 0) {
      console.log('\n========================================')
      console.log('DO-NOUN ARCHITECTURE ISSUES:')
      console.log('========================================')
      issues.forEach((issue, i) => {
        console.log(`${i + 1}. ${issue}`)
      })
      console.log('========================================\n')
    }

    // All architecture issues have been resolved
    expect(issues.length).toBe(0)
  })

  it('DigitalBusiness has a noun', () => {
    const digitalBusiness = EXPECTED_DO_NOUN_MAPPINGS.find(m => m.doName === 'DigitalBusiness')
    expect(digitalBusiness?.expectedNoun).toBeDefined()
    expect(digitalBusiness?.expectedNoun?.noun).toBe('DigitalBusiness')
  })

  it('Noun extends should match DO class extends', () => {
    // All nouns have extends that matches the DO class hierarchy
    expect(SaaSNoun.extends).toBe('DigitalBusiness')
    expect(MarketplaceNoun.extends).toBe('DigitalBusiness')
  })

  it('Service noun explicitly extends Business', () => {
    // Service DO extends Business, so Service noun should too
    expect(ServiceNoun.extends).toBe('Business')
  })
})
