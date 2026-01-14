import { describe, it, expect } from 'vitest'
import type { Organization, Business, Company, Org, Goal, Objective, KeyResult } from '../types'

describe('Organization types', () => {
  it('Organization has required properties', () => {
    const org: Organization = {
      $id: 'https://schema.org.ai/organizations/o1',
      $type: 'https://schema.org.ai/Organization',
      name: 'Test Org'
    }
    expect(org.$type).toBe('https://schema.org.ai/Organization')
  })

  it('Business extends Organization with Goals', () => {
    const business: Business = {
      $id: 'https://schema.org.ai/businesses/b1',
      $type: 'https://schema.org.ai/Business',
      name: 'Acme Inc',
      goals: [{
        objective: 'Increase revenue',
        keyResults: [
          { metric: 'MRR', target: 100000, current: 75000, source: 'stripe.mrr' }
        ]
      }]
    }
    expect(business.$type).toBe('https://schema.org.ai/Business')
    expect(business.goals).toHaveLength(1)
  })

  it('Company extends Business with legal properties', () => {
    const company: Company = {
      $id: 'https://schema.org.ai/companies/c1',
      $type: 'https://schema.org.ai/Company',
      name: 'Acme Corporation',
      goals: [],
      legalName: 'Acme Corporation, Inc.',
      jurisdiction: 'Delaware',
      taxId: '12-3456789'
    }
    expect(company.$type).toBe('https://schema.org.ai/Company')
  })

  it('Org is a tenant/workspace', () => {
    const org: Org = {
      $id: 'https://schema.org.ai/orgs/o1',
      $type: 'https://schema.org.ai/Org',
      name: 'Engineering Team',
      slug: 'engineering',
      plan: 'pro',
      members: []
    }
    expect(org.$type).toBe('https://schema.org.ai/Org')
  })
})

describe('Goal types', () => {
  it('KeyResult is grounded in analytics', () => {
    const kr: KeyResult = {
      metric: 'MRR',
      target: 50000,
      current: 32000,
      source: 'stripe.mrr'
    }
    expect(kr.source).toBe('stripe.mrr')
  })

  it('Goal contains objective and keyResults', () => {
    const goal: Goal = {
      objective: 'Launch MVP',
      keyResults: [
        { metric: 'users', target: 100, current: 0, source: 'analytics.users' },
        { metric: 'revenue', target: 10000, current: 0, source: 'stripe.revenue' }
      ]
    }
    expect(goal.objective).toBe('Launch MVP')
    expect(goal.keyResults).toHaveLength(2)
  })

  it('Objective is a string description', () => {
    const objective: Objective = 'Become market leader in AI agents'
    expect(typeof objective).toBe('string')
  })
})

describe('Organization hierarchy', () => {
  it('Business can have parent Organization', () => {
    const parent: Organization = {
      $id: 'https://schema.org.ai/organizations/holding',
      $type: 'https://schema.org.ai/Organization',
      name: 'Holding Group'
    }

    const subsidiary: Business = {
      $id: 'https://schema.org.ai/businesses/sub1',
      $type: 'https://schema.org.ai/Business',
      name: 'Subsidiary Inc',
      goals: [],
      parentOrganization: parent.$id
    }

    expect(subsidiary.parentOrganization).toBe(parent.$id)
  })

  it('Company can reference headquarters and locations', () => {
    const company: Company = {
      $id: 'https://schema.org.ai/companies/c2',
      $type: 'https://schema.org.ai/Company',
      name: 'Global Corp',
      goals: [],
      legalName: 'Global Corporation',
      jurisdiction: 'California',
      headquarters: {
        address: '123 Main St',
        city: 'San Francisco',
        country: 'USA'
      }
    }
    expect(company.headquarters?.city).toBe('San Francisco')
  })

  it('Org has billing and subscription metadata', () => {
    const org: Org = {
      $id: 'https://schema.org.ai/orgs/o2',
      $type: 'https://schema.org.ai/Org',
      name: 'Pro Team',
      slug: 'pro-team',
      plan: 'enterprise',
      members: ['user1', 'user2'],
      billing: {
        stripeCustomerId: 'cus_123',
        subscriptionId: 'sub_456'
      }
    }
    expect(org.billing?.stripeCustomerId).toBe('cus_123')
  })
})
