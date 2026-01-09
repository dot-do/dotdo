import { describe, it, expect } from 'vitest'

/**
 * Feature Flag Schema Tests
 *
 * These tests verify the Flag type for feature flag management
 * with branch-based variants, traffic allocation, and targeting filters.
 *
 * This is RED phase TDD - tests should FAIL until the Flag type
 * is implemented in types/Flag.ts.
 *
 * Schema:
 * ```typescript
 * interface Flag {
 *   id: string
 *   key: string
 *   branches: Branch[]
 *   traffic: number // 0-1
 *   stickiness: 'user_id' | 'session_id' | 'random'
 *   status: 'active' | 'disabled'
 *   filters?: Filter[]
 * }
 *
 * interface Branch {
 *   key: string
 *   weight: number
 *   payload?: Record<string, any>
 * }
 *
 * interface Filter {
 *   type: 'property' | 'cohort'
 *   property?: string
 *   operator?: 'eq' | 'gt' | 'lt' | 'contains' | 'in'
 *   value?: any
 *   cohortId?: string
 * }
 * ```
 *
 * Implementation requirements:
 * - Create Flag, Branch, Filter types in types/Flag.ts
 * - Create validateFlag function for runtime validation
 * - Export from types/Flag.ts
 */

// ============================================================================
// Type Interfaces (Expected)
// ============================================================================

interface Branch {
  key: string
  weight: number
  payload?: Record<string, any>
}

interface Filter {
  type: 'property' | 'cohort'
  property?: string
  operator?: 'eq' | 'gt' | 'lt' | 'contains' | 'in'
  value?: any
  cohortId?: string
}

interface Flag {
  id: string
  key: string
  branches: Branch[]
  traffic: number // 0-1
  stickiness: 'user_id' | 'session_id' | 'random'
  status: 'active' | 'disabled'
  filters?: Filter[]
}

// ============================================================================
// Dynamic Import - Tests fail gracefully until module exists
// ============================================================================

let validateFlag: ((flag: unknown) => boolean) | undefined

// Try to import - will be undefined until implemented
try {
  // @ts-expect-error - Flag type not yet implemented
  const module = await import('../../types/Flag')
  validateFlag = module.validateFlag
} catch {
  // Module doesn't exist yet - tests will fail as expected (RED phase)
  validateFlag = undefined
}

// ============================================================================
// Helper: Create valid flag for testing
// ============================================================================

function createValidFlag(overrides?: Partial<Flag>): Flag {
  return {
    id: 'flag-001',
    key: 'test-feature',
    branches: [
      { key: 'control', weight: 50 },
      { key: 'variant', weight: 50 },
    ],
    traffic: 0.5,
    stickiness: 'user_id',
    status: 'active',
    ...overrides,
  }
}

// ============================================================================
// 1. validateFlag Export Tests
// ============================================================================

describe('validateFlag Export', () => {
  it('validateFlag function is exported from types/Flag.ts', () => {
    // This will fail until validateFlag is implemented
    expect(validateFlag).toBeDefined()
    expect(typeof validateFlag).toBe('function')
  })
})

// ============================================================================
// 2. Minimal Flag Definition Tests
// ============================================================================

describe('Minimal Flag Definition', () => {
  it('validates minimal flag definition with all required fields', () => {
    const flag: Flag = {
      id: 'flag-minimal-001',
      key: 'minimal-feature',
      branches: [{ key: 'control', weight: 100 }],
      traffic: 0.5,
      stickiness: 'user_id',
      status: 'active',
    }

    expect(validateFlag).toBeDefined()
    expect(validateFlag!(flag)).toBe(true)
  })

  it('validates flag with id field', () => {
    const flag = createValidFlag({ id: 'flag-id-test-001' })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.id).toBe('flag-id-test-001')
  })

  it('validates flag with key field', () => {
    const flag = createValidFlag({ key: 'feature-key-test' })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.key).toBe('feature-key-test')
  })

  it('validates flag with branches field', () => {
    const flag = createValidFlag({
      branches: [
        { key: 'control', weight: 50 },
        { key: 'variant-a', weight: 50 },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.branches.length).toBe(2)
  })

  it('validates flag with traffic field', () => {
    const flag = createValidFlag({ traffic: 0.75 })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.traffic).toBe(0.75)
  })

  it('validates flag with stickiness field', () => {
    const flag = createValidFlag({ stickiness: 'session_id' })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.stickiness).toBe('session_id')
  })

  it('validates flag with status field', () => {
    const flag = createValidFlag({ status: 'disabled' })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.status).toBe('disabled')
  })

  it('rejects flag missing id field', () => {
    const flag = createValidFlag()
    // @ts-expect-error - Testing invalid flag without id
    delete flag.id

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects flag missing key field', () => {
    const flag = createValidFlag()
    // @ts-expect-error - Testing invalid flag without key
    delete flag.key

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects flag missing branches field', () => {
    const flag = createValidFlag()
    // @ts-expect-error - Testing invalid flag without branches
    delete flag.branches

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects flag missing traffic field', () => {
    const flag = createValidFlag()
    // @ts-expect-error - Testing invalid flag without traffic
    delete flag.traffic

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects flag missing stickiness field', () => {
    const flag = createValidFlag()
    // @ts-expect-error - Testing invalid flag without stickiness
    delete flag.stickiness

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects flag missing status field', () => {
    const flag = createValidFlag()
    // @ts-expect-error - Testing invalid flag without status
    delete flag.status

    expect(() => validateFlag!(flag)).toThrow()
  })
})

// ============================================================================
// 3. Traffic Value Validation Tests
// ============================================================================

describe('Traffic Value Validation', () => {
  it('accepts traffic value of 0', () => {
    const flag = createValidFlag({ traffic: 0 })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.traffic).toBe(0)
  })

  it('accepts traffic value of 1', () => {
    const flag = createValidFlag({ traffic: 1 })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.traffic).toBe(1)
  })

  it('accepts traffic value between 0 and 1', () => {
    const testValues = [0.1, 0.25, 0.5, 0.75, 0.99]

    testValues.forEach((traffic) => {
      const flag = createValidFlag({ traffic })
      expect(validateFlag!(flag)).toBe(true)
    })
  })

  it('accepts traffic value of 0.001 (very small percentage)', () => {
    const flag = createValidFlag({ traffic: 0.001 })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.traffic).toBe(0.001)
  })

  it('accepts traffic value of 0.999 (nearly 100%)', () => {
    const flag = createValidFlag({ traffic: 0.999 })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.traffic).toBe(0.999)
  })

  it('rejects traffic value less than 0', () => {
    const flag = createValidFlag({ traffic: -0.1 })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects traffic value of -1', () => {
    const flag = createValidFlag({ traffic: -1 })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects traffic value greater than 1', () => {
    const flag = createValidFlag({ traffic: 1.1 })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects traffic value of 1.5', () => {
    const flag = createValidFlag({ traffic: 1.5 })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects traffic value of 100 (percentage instead of decimal)', () => {
    const flag = createValidFlag({ traffic: 100 })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects traffic value of 50 (percentage instead of decimal)', () => {
    const flag = createValidFlag({ traffic: 50 })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects negative traffic values', () => {
    const negativeValues = [-0.01, -0.5, -1, -10]

    negativeValues.forEach((traffic) => {
      const flag = createValidFlag({ traffic })
      expect(() => validateFlag!(flag)).toThrow()
    })
  })

  it('rejects traffic values above 1', () => {
    const highValues = [1.01, 1.5, 2, 10, 100]

    highValues.forEach((traffic) => {
      const flag = createValidFlag({ traffic })
      expect(() => validateFlag!(flag)).toThrow()
    })
  })
})

// ============================================================================
// 4. Branch Validation Tests
// ============================================================================

describe('Branch Validation', () => {
  it('requires at least one branch', () => {
    const flag = createValidFlag({ branches: [] })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('accepts single branch', () => {
    const flag = createValidFlag({
      branches: [{ key: 'control', weight: 100 }],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.branches.length).toBe(1)
  })

  it('accepts two branches', () => {
    const flag = createValidFlag({
      branches: [
        { key: 'control', weight: 50 },
        { key: 'variant', weight: 50 },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.branches.length).toBe(2)
  })

  it('accepts multiple branches', () => {
    const flag = createValidFlag({
      branches: [
        { key: 'control', weight: 25 },
        { key: 'variant-a', weight: 25 },
        { key: 'variant-b', weight: 25 },
        { key: 'variant-c', weight: 25 },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.branches.length).toBe(4)
  })

  it('validates branch key is required', () => {
    const flag = createValidFlag({
      // @ts-expect-error - Testing branch without key
      branches: [{ weight: 100 }],
    })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('validates branch weight is required', () => {
    const flag = createValidFlag({
      // @ts-expect-error - Testing branch without weight
      branches: [{ key: 'control' }],
    })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('validates branch key is a string', () => {
    const flag = createValidFlag({
      branches: [{ key: 'control', weight: 100 }],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(typeof flag.branches[0].key).toBe('string')
  })

  it('validates branch weight is a number', () => {
    const flag = createValidFlag({
      branches: [{ key: 'control', weight: 100 }],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(typeof flag.branches[0].weight).toBe('number')
  })

  it('validates branch can have optional payload', () => {
    const flag = createValidFlag({
      branches: [
        {
          key: 'variant',
          weight: 100,
          payload: { color: 'blue', size: 'large' },
        },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.branches[0].payload).toEqual({ color: 'blue', size: 'large' })
  })

  it('validates branch payload can be any object', () => {
    const flag = createValidFlag({
      branches: [
        {
          key: 'variant',
          weight: 100,
          payload: {
            string: 'value',
            number: 42,
            boolean: true,
            array: [1, 2, 3],
            nested: { deep: 'value' },
          },
        },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
  })

  it('accepts branch without payload', () => {
    const flag = createValidFlag({
      branches: [{ key: 'control', weight: 100 }],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.branches[0].payload).toBeUndefined()
  })

  it('rejects empty branches array', () => {
    const flag = createValidFlag({ branches: [] })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('validates branches array cannot be null', () => {
    const flag = createValidFlag()
    // @ts-expect-error - Testing null branches
    flag.branches = null

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('validates branches array cannot be undefined', () => {
    const flag = createValidFlag()
    // @ts-expect-error - Testing undefined branches
    flag.branches = undefined

    expect(() => validateFlag!(flag)).toThrow()
  })
})

// ============================================================================
// 5. Filter Structure Validation Tests
// ============================================================================

describe('Filter Structure Validation', () => {
  it('validates flag without filters (optional)', () => {
    const flag = createValidFlag()
    delete flag.filters

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.filters).toBeUndefined()
  })

  it('validates flag with empty filters array', () => {
    const flag = createValidFlag({ filters: [] })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.filters).toEqual([])
  })

  it('validates property filter with all fields', () => {
    const flag = createValidFlag({
      filters: [
        {
          type: 'property',
          property: 'country',
          operator: 'eq',
          value: 'US',
        },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.filters![0].type).toBe('property')
  })

  it('validates cohort filter with cohortId', () => {
    const flag = createValidFlag({
      filters: [
        {
          type: 'cohort',
          cohortId: 'beta-users',
        },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.filters![0].type).toBe('cohort')
    expect(flag.filters![0].cohortId).toBe('beta-users')
  })

  it('validates filter type is required', () => {
    const flag = createValidFlag({
      filters: [
        // @ts-expect-error - Testing filter without type
        {
          property: 'country',
          operator: 'eq',
          value: 'US',
        },
      ],
    })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('validates filter type must be property or cohort', () => {
    const flag = createValidFlag({
      filters: [
        {
          // @ts-expect-error - Testing invalid filter type
          type: 'invalid',
          property: 'country',
          operator: 'eq',
          value: 'US',
        },
      ],
    })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('validates filter operator eq', () => {
    const flag = createValidFlag({
      filters: [
        {
          type: 'property',
          property: 'plan',
          operator: 'eq',
          value: 'premium',
        },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.filters![0].operator).toBe('eq')
  })

  it('validates filter operator gt', () => {
    const flag = createValidFlag({
      filters: [
        {
          type: 'property',
          property: 'age',
          operator: 'gt',
          value: 18,
        },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.filters![0].operator).toBe('gt')
  })

  it('validates filter operator lt', () => {
    const flag = createValidFlag({
      filters: [
        {
          type: 'property',
          property: 'age',
          operator: 'lt',
          value: 65,
        },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.filters![0].operator).toBe('lt')
  })

  it('validates filter operator contains', () => {
    const flag = createValidFlag({
      filters: [
        {
          type: 'property',
          property: 'email',
          operator: 'contains',
          value: '@company.com',
        },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.filters![0].operator).toBe('contains')
  })

  it('validates filter operator in', () => {
    const flag = createValidFlag({
      filters: [
        {
          type: 'property',
          property: 'country',
          operator: 'in',
          value: ['US', 'CA', 'UK'],
        },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.filters![0].operator).toBe('in')
  })

  it('rejects invalid filter operator', () => {
    const flag = createValidFlag({
      filters: [
        {
          type: 'property',
          property: 'country',
          // @ts-expect-error - Testing invalid operator
          operator: 'invalid',
          value: 'US',
        },
      ],
    })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('validates multiple filters', () => {
    const flag = createValidFlag({
      filters: [
        {
          type: 'property',
          property: 'country',
          operator: 'eq',
          value: 'US',
        },
        {
          type: 'property',
          property: 'plan',
          operator: 'in',
          value: ['premium', 'enterprise'],
        },
        {
          type: 'cohort',
          cohortId: 'beta-users',
        },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.filters!.length).toBe(3)
  })

  it('validates filter value can be string', () => {
    const flag = createValidFlag({
      filters: [
        {
          type: 'property',
          property: 'name',
          operator: 'eq',
          value: 'John',
        },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(typeof flag.filters![0].value).toBe('string')
  })

  it('validates filter value can be number', () => {
    const flag = createValidFlag({
      filters: [
        {
          type: 'property',
          property: 'age',
          operator: 'gt',
          value: 21,
        },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(typeof flag.filters![0].value).toBe('number')
  })

  it('validates filter value can be boolean', () => {
    const flag = createValidFlag({
      filters: [
        {
          type: 'property',
          property: 'verified',
          operator: 'eq',
          value: true,
        },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(typeof flag.filters![0].value).toBe('boolean')
  })

  it('validates filter value can be array for in operator', () => {
    const flag = createValidFlag({
      filters: [
        {
          type: 'property',
          property: 'role',
          operator: 'in',
          value: ['admin', 'moderator', 'editor'],
        },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
    expect(Array.isArray(flag.filters![0].value)).toBe(true)
  })
})

// ============================================================================
// 6. Stickiness Enum Validation Tests
// ============================================================================

describe('Stickiness Enum Validation', () => {
  it('validates stickiness user_id', () => {
    const flag = createValidFlag({ stickiness: 'user_id' })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.stickiness).toBe('user_id')
  })

  it('validates stickiness session_id', () => {
    const flag = createValidFlag({ stickiness: 'session_id' })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.stickiness).toBe('session_id')
  })

  it('validates stickiness random', () => {
    const flag = createValidFlag({ stickiness: 'random' })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.stickiness).toBe('random')
  })

  it('rejects invalid stickiness value', () => {
    const flag = createValidFlag({
      // @ts-expect-error - Testing invalid stickiness
      stickiness: 'invalid',
    })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects stickiness value device_id', () => {
    const flag = createValidFlag({
      // @ts-expect-error - Testing invalid stickiness
      stickiness: 'device_id',
    })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects stickiness value ip_address', () => {
    const flag = createValidFlag({
      // @ts-expect-error - Testing invalid stickiness
      stickiness: 'ip_address',
    })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects empty string for stickiness', () => {
    const flag = createValidFlag({
      // @ts-expect-error - Testing empty stickiness
      stickiness: '',
    })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects null for stickiness', () => {
    const flag = createValidFlag()
    // @ts-expect-error - Testing null stickiness
    flag.stickiness = null

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('validates all allowed stickiness values', () => {
    const allowedValues: Array<'user_id' | 'session_id' | 'random'> = [
      'user_id',
      'session_id',
      'random',
    ]

    allowedValues.forEach((stickiness) => {
      const flag = createValidFlag({ stickiness })
      expect(validateFlag!(flag)).toBe(true)
    })
  })
})

// ============================================================================
// 7. Status Enum Validation Tests
// ============================================================================

describe('Status Enum Validation', () => {
  it('validates status active', () => {
    const flag = createValidFlag({ status: 'active' })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.status).toBe('active')
  })

  it('validates status disabled', () => {
    const flag = createValidFlag({ status: 'disabled' })

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.status).toBe('disabled')
  })

  it('rejects invalid status value', () => {
    const flag = createValidFlag({
      // @ts-expect-error - Testing invalid status
      status: 'invalid',
    })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects status value draft', () => {
    const flag = createValidFlag({
      // @ts-expect-error - Testing invalid status
      status: 'draft',
    })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects status value paused', () => {
    const flag = createValidFlag({
      // @ts-expect-error - Testing invalid status
      status: 'paused',
    })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects status value archived', () => {
    const flag = createValidFlag({
      // @ts-expect-error - Testing invalid status
      status: 'archived',
    })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects empty string for status', () => {
    const flag = createValidFlag({
      // @ts-expect-error - Testing empty status
      status: '',
    })

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('rejects null for status', () => {
    const flag = createValidFlag()
    // @ts-expect-error - Testing null status
    flag.status = null

    expect(() => validateFlag!(flag)).toThrow()
  })

  it('validates all allowed status values', () => {
    const allowedValues: Array<'active' | 'disabled'> = ['active', 'disabled']

    allowedValues.forEach((status) => {
      const flag = createValidFlag({ status })
      expect(validateFlag!(flag)).toBe(true)
    })
  })
})

// ============================================================================
// 8. Complete Flag Validation Tests
// ============================================================================

describe('Complete Flag Validation', () => {
  it('validates complete flag with all fields', () => {
    const flag: Flag = {
      id: 'flag-complete-001',
      key: 'complete-feature',
      branches: [
        { key: 'control', weight: 50 },
        { key: 'variant', weight: 50, payload: { color: 'blue' } },
      ],
      traffic: 0.8,
      stickiness: 'user_id',
      status: 'active',
      filters: [
        {
          type: 'property',
          property: 'country',
          operator: 'in',
          value: ['US', 'CA'],
        },
        {
          type: 'cohort',
          cohortId: 'beta-users',
        },
      ],
    }

    expect(validateFlag!(flag)).toBe(true)
  })

  it('validates flag for gradual rollout', () => {
    const flag: Flag = {
      id: 'flag-rollout-001',
      key: 'new-checkout-flow',
      branches: [
        { key: 'control', weight: 90 },
        { key: 'new-flow', weight: 10 },
      ],
      traffic: 0.1, // Start with 10% traffic
      stickiness: 'user_id',
      status: 'active',
    }

    expect(validateFlag!(flag)).toBe(true)
  })

  it('validates flag for A/B test', () => {
    const flag: Flag = {
      id: 'flag-ab-001',
      key: 'button-color-test',
      branches: [
        { key: 'control', weight: 50, payload: { color: 'blue' } },
        { key: 'variant', weight: 50, payload: { color: 'green' } },
      ],
      traffic: 0.5,
      stickiness: 'user_id',
      status: 'active',
    }

    expect(validateFlag!(flag)).toBe(true)
  })

  it('validates flag for multi-variant test', () => {
    const flag: Flag = {
      id: 'flag-mv-001',
      key: 'pricing-page-test',
      branches: [
        { key: 'control', weight: 25, payload: { layout: 'original' } },
        { key: 'variant-a', weight: 25, payload: { layout: 'simple' } },
        { key: 'variant-b', weight: 25, payload: { layout: 'detailed' } },
        { key: 'variant-c', weight: 25, payload: { layout: 'comparison' } },
      ],
      traffic: 1.0,
      stickiness: 'session_id',
      status: 'active',
    }

    expect(validateFlag!(flag)).toBe(true)
  })

  it('validates flag with targeting filters', () => {
    const flag: Flag = {
      id: 'flag-targeted-001',
      key: 'premium-feature',
      branches: [
        { key: 'disabled', weight: 0 },
        { key: 'enabled', weight: 100 },
      ],
      traffic: 1.0,
      stickiness: 'user_id',
      status: 'active',
      filters: [
        {
          type: 'property',
          property: 'plan',
          operator: 'in',
          value: ['premium', 'enterprise'],
        },
      ],
    }

    expect(validateFlag!(flag)).toBe(true)
  })

  it('validates disabled flag', () => {
    const flag: Flag = {
      id: 'flag-disabled-001',
      key: 'disabled-feature',
      branches: [{ key: 'control', weight: 100 }],
      traffic: 0,
      stickiness: 'user_id',
      status: 'disabled',
    }

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.status).toBe('disabled')
  })
})

// ============================================================================
// 9. Edge Cases and Error Handling Tests
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  it('rejects non-object input', () => {
    expect(() => validateFlag!('string')).toThrow()
    expect(() => validateFlag!(123)).toThrow()
    expect(() => validateFlag!(null)).toThrow()
    expect(() => validateFlag!(undefined)).toThrow()
    expect(() => validateFlag!([])).toThrow()
  })

  it('rejects empty object', () => {
    expect(() => validateFlag!({})).toThrow()
  })

  it('rejects flag with extra unknown fields (strict mode)', () => {
    const flag = {
      ...createValidFlag(),
      unknownField: 'should-not-be-here',
    }

    // Depending on implementation, this might pass or fail
    // If strict validation is required, it should throw
    expect(() => validateFlag!(flag)).toThrow()
  })

  it('handles flag with very long key', () => {
    const longKey = 'a'.repeat(1000)
    const flag = createValidFlag({ key: longKey })

    // Should either pass (if no length limit) or throw (if length limited)
    expect(() => validateFlag!(flag)).not.toThrow()
  })

  it('handles flag with special characters in key', () => {
    const flag = createValidFlag({ key: 'feature-key_v2.0' })

    expect(validateFlag!(flag)).toBe(true)
  })

  it('handles flag with unicode in key', () => {
    const flag = createValidFlag({ key: 'feature-key-' })

    expect(validateFlag!(flag)).toBe(true)
  })

  it('handles branch weight of 0', () => {
    const flag = createValidFlag({
      branches: [
        { key: 'control', weight: 100 },
        { key: 'disabled-variant', weight: 0 },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
  })

  it('handles very large branch weights', () => {
    const flag = createValidFlag({
      branches: [
        { key: 'control', weight: 50000 },
        { key: 'variant', weight: 50000 },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
  })

  it('handles traffic at exact boundary 0', () => {
    const flag = createValidFlag({ traffic: 0 })

    expect(validateFlag!(flag)).toBe(true)
  })

  it('handles traffic at exact boundary 1', () => {
    const flag = createValidFlag({ traffic: 1 })

    expect(validateFlag!(flag)).toBe(true)
  })

  it('handles deeply nested payload', () => {
    const flag = createValidFlag({
      branches: [
        {
          key: 'variant',
          weight: 100,
          payload: {
            level1: {
              level2: {
                level3: {
                  value: 'deep',
                },
              },
            },
          },
        },
      ],
    })

    expect(validateFlag!(flag)).toBe(true)
  })
})

// ============================================================================
// 10. Use Case Tests
// ============================================================================

describe('Flag Use Cases', () => {
  it('feature toggle - simple on/off', () => {
    const flag: Flag = {
      id: 'flag-toggle-001',
      key: 'dark-mode',
      branches: [{ key: 'enabled', weight: 100 }],
      traffic: 1.0,
      stickiness: 'user_id',
      status: 'active',
    }

    expect(validateFlag!(flag)).toBe(true)
  })

  it('percentage rollout - gradual release', () => {
    const flag: Flag = {
      id: 'flag-rollout-001',
      key: 'new-search',
      branches: [
        { key: 'old', weight: 95 },
        { key: 'new', weight: 5 },
      ],
      traffic: 1.0,
      stickiness: 'user_id',
      status: 'active',
    }

    expect(validateFlag!(flag)).toBe(true)
  })

  it('user targeting - beta users only', () => {
    const flag: Flag = {
      id: 'flag-beta-001',
      key: 'beta-feature',
      branches: [{ key: 'enabled', weight: 100 }],
      traffic: 1.0,
      stickiness: 'user_id',
      status: 'active',
      filters: [
        {
          type: 'cohort',
          cohortId: 'beta-testers',
        },
      ],
    }

    expect(validateFlag!(flag)).toBe(true)
  })

  it('geo targeting - country-specific feature', () => {
    const flag: Flag = {
      id: 'flag-geo-001',
      key: 'gdpr-consent',
      branches: [{ key: 'enabled', weight: 100 }],
      traffic: 1.0,
      stickiness: 'user_id',
      status: 'active',
      filters: [
        {
          type: 'property',
          property: 'country',
          operator: 'in',
          value: ['DE', 'FR', 'IT', 'ES', 'NL'],
        },
      ],
    }

    expect(validateFlag!(flag)).toBe(true)
  })

  it('session-based random variant', () => {
    const flag: Flag = {
      id: 'flag-session-001',
      key: 'landing-page-test',
      branches: [
        { key: 'hero-a', weight: 50, payload: { hero: 'image' } },
        { key: 'hero-b', weight: 50, payload: { hero: 'video' } },
      ],
      traffic: 1.0,
      stickiness: 'session_id',
      status: 'active',
    }

    expect(validateFlag!(flag)).toBe(true)
  })

  it('random assignment - no persistence', () => {
    const flag: Flag = {
      id: 'flag-random-001',
      key: 'ad-variant',
      branches: [
        { key: 'ad-a', weight: 33, payload: { adId: 'ad-001' } },
        { key: 'ad-b', weight: 33, payload: { adId: 'ad-002' } },
        { key: 'ad-c', weight: 34, payload: { adId: 'ad-003' } },
      ],
      traffic: 1.0,
      stickiness: 'random',
      status: 'active',
    }

    expect(validateFlag!(flag)).toBe(true)
  })

  it('kill switch - disabled feature', () => {
    const flag: Flag = {
      id: 'flag-kill-001',
      key: 'problematic-feature',
      branches: [{ key: 'disabled', weight: 100 }],
      traffic: 0,
      stickiness: 'user_id',
      status: 'disabled',
    }

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.status).toBe('disabled')
    expect(flag.traffic).toBe(0)
  })

  it('complex targeting - multiple filters', () => {
    const flag: Flag = {
      id: 'flag-complex-001',
      key: 'enterprise-feature',
      branches: [{ key: 'enabled', weight: 100 }],
      traffic: 1.0,
      stickiness: 'user_id',
      status: 'active',
      filters: [
        {
          type: 'property',
          property: 'plan',
          operator: 'eq',
          value: 'enterprise',
        },
        {
          type: 'property',
          property: 'seats',
          operator: 'gt',
          value: 100,
        },
        {
          type: 'cohort',
          cohortId: 'early-adopters',
        },
      ],
    }

    expect(validateFlag!(flag)).toBe(true)
    expect(flag.filters!.length).toBe(3)
  })
})
