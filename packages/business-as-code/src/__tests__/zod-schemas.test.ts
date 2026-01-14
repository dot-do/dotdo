import { describe, it, expect } from 'vitest'
import {
  Organization, OrganizationSchema, isOrganization,
  Business, BusinessSchema, isBusiness, createBusiness,
  Company, CompanySchema, isCompany,
  Goal, GoalSchema, isGoal,
  KeyResult, KeyResultSchema, isKeyResult
} from '../types'

describe('Organization Zod Schema', () => {
  const validOrg = {
    $id: 'https://schema.org.ai/orgs/acme',
    $type: 'https://schema.org.ai/Organization' as const,
    name: 'Acme Inc'
  }

  it('should validate valid Organization objects', () => {
    const result = OrganizationSchema.safeParse(validOrg)
    expect(result.success).toBe(true)
  })

  it('should reject invalid Organization objects', () => {
    const result = OrganizationSchema.safeParse({ invalid: 'data' })
    expect(result.success).toBe(false)
  })

  it('should require name field', () => {
    const noName = { $id: 'test', $type: 'https://schema.org.ai/Organization' }
    const result = OrganizationSchema.safeParse(noName)
    expect(result.success).toBe(false)
  })

  it('isOrganization type guard should work', () => {
    expect(isOrganization(validOrg)).toBe(true)
    expect(isOrganization({ invalid: 'data' })).toBe(false)
  })
})

describe('Business Zod Schema', () => {
  const validBusiness = {
    $id: 'https://schema.org.ai/businesses/startup',
    $type: 'https://schema.org.ai/Business' as const,
    name: 'My Startup',
    goals: []
  }

  it('should validate valid Business objects', () => {
    const result = BusinessSchema.safeParse(validBusiness)
    expect(result.success).toBe(true)
  })

  it('should require goals array', () => {
    const noGoals = { $id: 'test', $type: 'https://schema.org.ai/Business', name: 'Test' }
    const result = BusinessSchema.safeParse(noGoals)
    expect(result.success).toBe(false)
  })

  it('should validate business with goals', () => {
    const withGoals = {
      ...validBusiness,
      goals: [{
        objective: 'Achieve PMF',
        keyResults: [{ metric: 'MRR', target: 50000, current: 30000, source: 'stripe.mrr' }]
      }]
    }
    const result = BusinessSchema.safeParse(withGoals)
    expect(result.success).toBe(true)
  })

  it('isBusiness type guard should work', () => {
    expect(isBusiness(validBusiness)).toBe(true)
    expect(isBusiness({ invalid: 'data' })).toBe(false)
  })

  it('createBusiness factory should create valid Business', () => {
    const business = createBusiness({
      $id: 'https://schema.org.ai/businesses/new',
      name: 'New Business'
    })
    expect(business.$type).toBe('https://schema.org.ai/Business')
    expect(business.goals).toEqual([])
    expect(isBusiness(business)).toBe(true)
  })
})

describe('Company Zod Schema', () => {
  const validCompany = {
    $id: 'https://schema.org.ai/companies/acme',
    $type: 'https://schema.org.ai/Company' as const,
    name: 'Acme Corp',
    goals: [],
    foundedAt: '2020-01-01',
    employees: 50
  }

  it('should validate valid Company objects', () => {
    const result = CompanySchema.safeParse(validCompany)
    expect(result.success).toBe(true)
  })

  it('should extend Business (require goals)', () => {
    const noGoals = { ...validCompany, goals: undefined }
    const result = CompanySchema.safeParse(noGoals)
    expect(result.success).toBe(false)
  })

  it('isCompany type guard should work', () => {
    expect(isCompany(validCompany)).toBe(true)
    expect(isCompany({ invalid: 'data' })).toBe(false)
  })
})

describe('Goal Zod Schema', () => {
  const validGoal = {
    objective: 'Achieve product-market fit',
    keyResults: [
      { metric: 'MRR', target: 50000, current: 32000, source: 'stripe.mrr' },
      { metric: 'NPS', target: 50, current: 42, source: 'surveys.nps' }
    ]
  }

  it('should validate valid Goal objects', () => {
    const result = GoalSchema.safeParse(validGoal)
    expect(result.success).toBe(true)
  })

  it('should require objective', () => {
    const noObjective = { keyResults: [] }
    const result = GoalSchema.safeParse(noObjective)
    expect(result.success).toBe(false)
  })

  it('should require keyResults array', () => {
    const noKRs = { objective: 'Test' }
    const result = GoalSchema.safeParse(noKRs)
    expect(result.success).toBe(false)
  })

  it('isGoal type guard should work', () => {
    expect(isGoal(validGoal)).toBe(true)
    expect(isGoal({ invalid: 'data' })).toBe(false)
  })
})

describe('KeyResult Zod Schema', () => {
  const validKR = {
    metric: 'MRR',
    target: 50000,
    current: 32000,
    source: 'stripe.mrr'
  }

  it('should validate valid KeyResult objects', () => {
    const result = KeyResultSchema.safeParse(validKR)
    expect(result.success).toBe(true)
  })

  it('should require metric, target, current, source', () => {
    const partial = { metric: 'MRR', target: 50000 }
    const result = KeyResultSchema.safeParse(partial)
    expect(result.success).toBe(false)
  })

  it('should accept optional unit field', () => {
    const withUnit = { ...validKR, unit: 'USD' }
    const result = KeyResultSchema.safeParse(withUnit)
    expect(result.success).toBe(true)
  })

  it('isKeyResult type guard should work', () => {
    expect(isKeyResult(validKR)).toBe(true)
    expect(isKeyResult({ metric: 'only-metric' })).toBe(false)
  })
})
