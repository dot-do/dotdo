import { describe, it, expect } from 'vitest'
import { z } from 'zod'

/**
 * Business Domain Noun Validation Tests
 *
 * RED PHASE TDD - Tests that validate the Business domain schemas.
 * These tests should expose schema issues including:
 * - The typo `netRevenuRetention` (should be `netRevenueRetention`)
 * - Schema inheritance issues (if SaaS doesn't properly extend Business)
 * - Missing or incorrect field validations
 *
 * Nouns under test:
 * - Business
 * - SaaS
 * - Startup
 * - Marketplace
 * - Service
 * - Organization
 * - Goal
 */

// ============================================================================
// Imports from business module
// ============================================================================

import {
  // Business
  Business,
  BusinessSchema,
  BusinessPlanSchema,
  TimePeriodSchema,
  CurrencySchema,
  FinancialMetricsSchema,
  type BusinessType,
  type BusinessPlan,
  type TimePeriod,
  type FinancialMetrics,

  // Organization
  Organization,
  OrganizationSchema,
  DepartmentSchema,
  TeamSchema,
  OrganizationalStructureSchema,
  type OrganizationType,
  type Department,
  type Team,
  type OrganizationalStructure,

  // SaaS
  SaaS,
  SaaSSchema,
  SaaSPricingModelSchema,
  SaaSMetricsSchema,
  PricingTierSchema,
  type SaaSType,
  type SaaSPricingModel,
  type SaaSMetrics,
  type PricingTier,

  // Startup
  Startup,
  StartupSchema,
  FundingStageSchema,
  FundingRoundSchema,
  StartupMetricsSchema,
  InvestorSchema,
  type StartupType,
  type FundingStage,
  type FundingRound,
  type StartupMetrics,
  type Investor,

  // Marketplace
  Marketplace,
  MarketplaceSchema,
  MarketplaceTypeSchema,
  MarketplaceRevenueModelSchema,
  MarketplaceMetricsSchema,
  CommissionTierSchema,
  type MarketplaceSchemaType,
  type MarketplaceType,
  type MarketplaceRevenueModel,
  type MarketplaceMetrics,
  type CommissionTier,

  // Service
  Service,
  ServiceSchema,
  ServicePricingModelSchema,
  ServiceCategorySchema,
  ServiceLevelAgreementSchema,
  ServiceDeliverableSchema,
  ServiceMetricsSchema,
  type ServiceType,
  type ServicePricingModel,
  type ServiceCategory,
  type ServiceLevelAgreement,
  type ServiceDeliverable,
  type ServiceMetrics,

  // Goal
  Goal,
  OKR,
  GoalSchema,
  GoalCategorySchema,
  GoalStatusSchema,
  KeyResultSchema,
  KPIDefinitionSchema,
  MilestoneSchema,
  type GoalType,
  type GoalCategory,
  type GoalStatus,
  type KeyResult,
  type KPIDefinition,
  type Milestone,
} from '../business'

// ============================================================================
// Helper Functions
// ============================================================================

function createValidBusiness(overrides?: Partial<BusinessType>): BusinessType {
  return {
    $id: 'biz-001',
    $type: 'https://schema.org.ai/Business',
    name: 'Acme Corp',
    ...overrides,
  }
}

function createValidSaaS(overrides?: Partial<SaaSType>): SaaSType {
  return {
    $id: 'saas-001',
    $type: 'https://schema.org.ai/SaaS',
    name: 'CloudApp',
    ...overrides,
  }
}

function createValidStartup(overrides?: Partial<StartupType>): StartupType {
  return {
    $id: 'startup-001',
    $type: 'https://schema.org.ai/Startup',
    name: 'TechStartup',
    ...overrides,
  }
}

function createValidMarketplace(overrides?: Partial<MarketplaceSchemaType>): MarketplaceSchemaType {
  return {
    $id: 'mp-001',
    $type: 'https://schema.org.ai/Marketplace',
    name: 'BuyNSell',
    ...overrides,
  }
}

function createValidService(overrides?: Partial<ServiceType>): ServiceType {
  return {
    $id: 'svc-001',
    $type: 'https://schema.org.ai/Service',
    name: 'ConsultingPro',
    ...overrides,
  }
}

function createValidOrganization(overrides?: Partial<OrganizationType>): OrganizationType {
  return {
    $id: 'org-001',
    $type: 'https://schema.org.ai/Organization',
    name: 'TechCorp Inc',
    ...overrides,
  }
}

function createValidGoal(overrides?: Partial<GoalType>): GoalType {
  return {
    $id: 'goal-001',
    $type: 'https://schema.org.ai/Goal',
    name: 'Q1 Revenue Target',
    ...overrides,
  }
}

// ============================================================================
// 1. BUSINESS SCHEMA TESTS
// ============================================================================

describe('Business Schema', () => {
  describe('Noun Definition', () => {
    it('has correct noun name', () => {
      expect(Business.noun).toBe('Business')
    })

    it('has correct plural name', () => {
      expect(Business.plural).toBe('Businesses')
    })

    it('has correct $type URL', () => {
      expect(Business.$type).toBe('https://schema.org.ai/Business')
    })

    it('has schema defined', () => {
      expect(Business.schema).toBeDefined()
    })

    it('has OKRs defined', () => {
      expect(Business.okrs).toBeDefined()
      expect(Business.okrs).toContain('Revenue')
      expect(Business.okrs).toContain('Profit')
    })
  })

  describe('Valid Data', () => {
    it('validates minimal Business with required fields only', () => {
      const business = createValidBusiness()
      const result = BusinessSchema.safeParse(business)
      expect(result.success).toBe(true)
    })

    it('validates Business with all optional fields', () => {
      const business = createValidBusiness({
        slug: 'acme-corp',
        description: 'A technology company',
        plan: 'enterprise',
        industry: 'Technology',
        mission: 'To innovate',
        values: ['Innovation', 'Integrity'],
        targetMarket: 'B2B Enterprise',
        foundedAt: new Date('2020-01-01'),
        teamSize: 100,
        currency: 'USD',
        financials: {
          revenue: 1000000,
          netIncome: 200000,
        },
        metadata: { key: 'value' },
      })
      const result = BusinessSchema.safeParse(business)
      expect(result.success).toBe(true)
    })
  })

  describe('Required Fields', () => {
    it('requires $id field', () => {
      const business = createValidBusiness()
      // @ts-expect-error - Testing missing $id
      delete business.$id
      const result = BusinessSchema.safeParse(business)
      expect(result.success).toBe(false)
    })

    it('requires $type field', () => {
      const business = createValidBusiness()
      // @ts-expect-error - Testing missing $type
      delete business.$type
      const result = BusinessSchema.safeParse(business)
      expect(result.success).toBe(false)
    })

    it('requires name field', () => {
      const business = createValidBusiness()
      // @ts-expect-error - Testing missing name
      delete business.name
      const result = BusinessSchema.safeParse(business)
      expect(result.success).toBe(false)
    })
  })

  describe('$id and $type Format', () => {
    it('accepts string $id', () => {
      const business = createValidBusiness({ $id: 'biz-12345-abc' })
      const result = BusinessSchema.safeParse(business)
      expect(result.success).toBe(true)
    })

    it('rejects non-string $id', () => {
      const business = createValidBusiness()
      // @ts-expect-error - Testing non-string $id
      business.$id = 12345
      const result = BusinessSchema.safeParse(business)
      expect(result.success).toBe(false)
    })

    it('requires exact $type literal', () => {
      const business = createValidBusiness()
      // @ts-expect-error - Testing wrong $type
      business.$type = 'https://schema.org.ai/WrongType'
      const result = BusinessSchema.safeParse(business)
      expect(result.success).toBe(false)
    })
  })

  describe('BusinessPlan Enum', () => {
    it('accepts valid plan values', () => {
      const validPlans: BusinessPlan[] = ['free', 'starter', 'pro', 'enterprise']
      validPlans.forEach((plan) => {
        const business = createValidBusiness({ plan })
        const result = BusinessSchema.safeParse(business)
        expect(result.success).toBe(true)
      })
    })

    it('rejects invalid plan value', () => {
      const business = createValidBusiness()
      // @ts-expect-error - Testing invalid plan
      business.plan = 'invalid-plan'
      const result = BusinessSchema.safeParse(business)
      expect(result.success).toBe(false)
    })
  })

  describe('FinancialMetrics Nested Schema', () => {
    it('validates complete financial metrics', () => {
      const financials: FinancialMetrics = {
        revenue: 1000000,
        cogs: 400000,
        grossProfit: 600000,
        grossMargin: 0.6,
        operatingExpenses: 300000,
        operatingIncome: 300000,
        operatingMargin: 0.3,
        netIncome: 200000,
        netMargin: 0.2,
        ebitda: 350000,
        ebitdaMargin: 0.35,
        operatingCashFlow: 250000,
        freeCashFlow: 200000,
        currency: 'USD',
        period: 'yearly',
      }
      const business = createValidBusiness({ financials })
      const result = BusinessSchema.safeParse(business)
      expect(result.success).toBe(true)
    })

    it('validates partial financial metrics', () => {
      const financials: FinancialMetrics = {
        revenue: 1000000,
      }
      const business = createValidBusiness({ financials })
      const result = BusinessSchema.safeParse(business)
      expect(result.success).toBe(true)
    })

    it('validates TimePeriod enum in financials', () => {
      const validPeriods: TimePeriod[] = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']
      validPeriods.forEach((period) => {
        const business = createValidBusiness({ financials: { period } })
        const result = BusinessSchema.safeParse(business)
        expect(result.success).toBe(true)
      })
    })
  })
})

// ============================================================================
// 2. SAAS SCHEMA TESTS
// ============================================================================

describe('SaaS Schema', () => {
  describe('Noun Definition', () => {
    it('has correct noun name', () => {
      expect(SaaS.noun).toBe('SaaS')
    })

    it('has correct plural name', () => {
      expect(SaaS.plural).toBe('SaaSes')
    })

    it('has correct $type URL', () => {
      expect(SaaS.$type).toBe('https://schema.org.ai/SaaS')
    })

    it('extends Business', () => {
      expect(SaaS.extends).toBe('DigitalBusiness')
    })

    it('has SaaS-specific OKRs', () => {
      expect(SaaS.okrs).toContain('MRR')
      expect(SaaS.okrs).toContain('ARR')
      expect(SaaS.okrs).toContain('ChurnRate')
      expect(SaaS.okrs).toContain('LTV')
      expect(SaaS.okrs).toContain('CAC')
    })
  })

  describe('Valid Data', () => {
    it('validates minimal SaaS with required fields only', () => {
      const saas = createValidSaaS()
      const result = SaaSSchema.safeParse(saas)
      expect(result.success).toBe(true)
    })

    it('validates SaaS with all optional fields', () => {
      const saas = createValidSaaS({
        slug: 'cloudapp',
        description: 'Cloud-based application',
        plan: 'pro',
        pricingModel: 'subscription',
        pricingTiers: [
          { name: 'Basic', price: 10 },
          { name: 'Pro', price: 50 },
        ],
        metrics: {
          mrr: 100000,
          arr: 1200000,
          churnRate: 0.02,
        },
        productUrl: 'https://cloudapp.com',
        platforms: ['web', 'ios', 'android'],
        integrations: ['Slack', 'Zapier'],
      })
      const result = SaaSSchema.safeParse(saas)
      expect(result.success).toBe(true)
    })
  })

  describe('Required Fields', () => {
    it('requires $id field', () => {
      const saas = createValidSaaS()
      // @ts-expect-error - Testing missing $id
      delete saas.$id
      const result = SaaSSchema.safeParse(saas)
      expect(result.success).toBe(false)
    })

    it('requires $type field', () => {
      const saas = createValidSaaS()
      // @ts-expect-error - Testing missing $type
      delete saas.$type
      const result = SaaSSchema.safeParse(saas)
      expect(result.success).toBe(false)
    })

    it('requires name field', () => {
      const saas = createValidSaaS()
      // @ts-expect-error - Testing missing name
      delete saas.name
      const result = SaaSSchema.safeParse(saas)
      expect(result.success).toBe(false)
    })
  })

  describe('$type Literal Validation', () => {
    it('requires exact SaaS $type', () => {
      const saas = createValidSaaS()
      // @ts-expect-error - Testing wrong $type
      saas.$type = 'https://schema.org.ai/Business'
      const result = SaaSSchema.safeParse(saas)
      expect(result.success).toBe(false)
    })
  })

  describe('SaaSPricingModel Enum', () => {
    it('accepts all valid pricing models', () => {
      const validModels: SaaSPricingModel[] = [
        'freemium',
        'free-trial',
        'subscription',
        'usage-based',
        'tiered',
        'per-seat',
        'hybrid',
      ]
      validModels.forEach((pricingModel) => {
        const saas = createValidSaaS({ pricingModel })
        const result = SaaSSchema.safeParse(saas)
        expect(result.success).toBe(true)
      })
    })

    it('rejects invalid pricing model', () => {
      const saas = createValidSaaS()
      // @ts-expect-error - Testing invalid pricing model
      saas.pricingModel = 'invalid-model'
      const result = SaaSSchema.safeParse(saas)
      expect(result.success).toBe(false)
    })
  })

  describe('SaaSMetrics Nested Schema', () => {
    it('validates complete SaaS metrics', () => {
      const metrics: SaaSMetrics = {
        mrr: 100000,
        arr: 1200000,
        arpu: 50,
        arpa: 500,
        mrrGrowth: 0.05,
        revenueGrowth: 0.1,
        netRevenuRetention: 1.2, // NOTE: This is the TYPO we're testing!
        grossRevenueRetention: 0.95,
        expansionMrr: 5000,
        contractionMrr: 2000,
        totalCustomers: 2000,
        newCustomers: 100,
        churnedCustomers: 20,
        churnRate: 0.01,
        customerChurnRate: 0.01,
        revenueChurnRate: 0.005,
        cac: 500,
        ltv: 5000,
        ltvCacRatio: 10,
        paybackPeriod: 6,
        activeUsers: 10000,
        dau: 3000,
        mau: 8000,
        dauMauRatio: 0.375,
        trialToPayingRate: 0.15,
        freeToPayingRate: 0.05,
        period: 'monthly',
      }
      const saas = createValidSaaS({ metrics })
      const result = SaaSSchema.safeParse(saas)
      expect(result.success).toBe(true)
    })

    /**
     * CRITICAL TEST: This test will FAIL if the typo `netRevenuRetention`
     * exists in the schema. The correct field should be `netRevenueRetention`.
     *
     * This test verifies that the CORRECT field name is used.
     */
    it('should have netRevenueRetention field (not netRevenuRetention typo)', () => {
      const metrics = {
        // Using the CORRECT spelling
        netRevenueRetention: 1.2,
      }
      const saas = createValidSaaS({ metrics })
      const result = SaaSSchema.safeParse(saas)

      // This should pass if the schema uses the correct spelling
      // If the schema has the typo, this will fail
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.metrics?.netRevenueRetention).toBe(1.2)
      }
    })

    /**
     * CRITICAL TEST: Verify the typo field does NOT exist
     */
    it('should NOT accept the typo netRevenuRetention (missing "e")', () => {
      // Get the shape of SaaSMetricsSchema
      const metricsShape = SaaSMetricsSchema.shape

      // The typo field should NOT exist
      expect('netRevenuRetention' in metricsShape).toBe(false)

      // The correct field SHOULD exist
      expect('netRevenueRetention' in metricsShape).toBe(true)
    })
  })

  describe('PricingTier Nested Schema', () => {
    it('validates pricing tier with all fields', () => {
      const pricingTiers: PricingTier[] = [
        {
          name: 'Starter',
          price: 19,
          billingPeriod: 'monthly',
          features: ['10 users', '1GB storage'],
          limits: { users: 10, storage: 1 },
          recommended: false,
        },
        {
          name: 'Pro',
          price: 49,
          billingPeriod: 'monthly',
          features: ['Unlimited users', '10GB storage'],
          limits: { users: -1, storage: 10 },
          recommended: true,
        },
      ]
      const saas = createValidSaaS({ pricingTiers })
      const result = SaaSSchema.safeParse(saas)
      expect(result.success).toBe(true)
    })

    it('requires name in pricing tier', () => {
      // @ts-expect-error - Testing missing name
      const tier: PricingTier = { price: 10 }
      const result = PricingTierSchema.safeParse(tier)
      expect(result.success).toBe(false)
    })

    it('requires price in pricing tier', () => {
      // @ts-expect-error - Testing missing price
      const tier: PricingTier = { name: 'Basic' }
      const result = PricingTierSchema.safeParse(tier)
      expect(result.success).toBe(false)
    })

    it('validates billingPeriod enum', () => {
      const validPeriods = ['monthly', 'yearly', 'one-time']
      validPeriods.forEach((billingPeriod) => {
        const tier = { name: 'Test', price: 10, billingPeriod }
        const result = PricingTierSchema.safeParse(tier)
        expect(result.success).toBe(true)
      })
    })
  })

  describe('Schema Inheritance', () => {
    /**
     * CRITICAL TEST: Verify SaaS includes all Business fields
     * This tests that schema inheritance is working correctly.
     */
    it('SaaS schema should include all Business fields', () => {
      const businessShape = BusinessSchema.shape
      const saasShape = SaaSSchema.shape

      // All Business fields should exist in SaaS
      const businessFields = Object.keys(businessShape)
      businessFields.forEach((field) => {
        expect(field in saasShape).toBe(true)
      })
    })

    it('SaaS accepts Business fields', () => {
      const saas = createValidSaaS({
        // Business fields
        slug: 'cloud-saas',
        description: 'A cloud SaaS product',
        plan: 'enterprise',
        industry: 'Technology',
        mission: 'Simplify cloud computing',
        values: ['Innovation', 'Simplicity'],
        targetMarket: 'SMB',
        foundedAt: new Date('2020-01-01'),
        teamSize: 50,
        currency: 'EUR',
        financials: { revenue: 500000 },
        // SaaS-specific fields
        pricingModel: 'subscription',
        metrics: { mrr: 50000 },
      })
      const result = SaaSSchema.safeParse(saas)
      expect(result.success).toBe(true)
    })
  })
})

// ============================================================================
// 3. STARTUP SCHEMA TESTS
// ============================================================================

describe('Startup Schema', () => {
  describe('Noun Definition', () => {
    it('has correct noun name', () => {
      expect(Startup.noun).toBe('Startup')
    })

    it('has correct plural name', () => {
      expect(Startup.plural).toBe('Startups')
    })

    it('has correct $type URL', () => {
      expect(Startup.$type).toBe('https://schema.org.ai/Startup')
    })

    it('extends SaaS', () => {
      expect(Startup.extends).toBe('SaaS')
    })

    it('has Startup-specific OKRs', () => {
      expect(Startup.okrs).toContain('Runway')
      expect(Startup.okrs).toContain('BurnRate')
      expect(Startup.okrs).toContain('Valuation')
      expect(Startup.okrs).toContain('TotalFunding')
    })
  })

  describe('Valid Data', () => {
    it('validates minimal Startup with required fields only', () => {
      const startup = createValidStartup()
      const result = StartupSchema.safeParse(startup)
      expect(result.success).toBe(true)
    })

    it('validates Startup with all fields', () => {
      const startup = createValidStartup({
        fundingStage: 'series-a',
        fundingRounds: [
          { stage: 'seed', amount: 500000 },
          { stage: 'series-a', amount: 5000000 },
        ],
        totalFunding: 5500000,
        valuation: 25000000,
        investors: ['Sequoia', 'a16z'],
        founders: ['John Doe', 'Jane Smith'],
        problemStatement: 'Solving X problem',
        solution: 'Our Y solution',
        tam: 10000000000,
        sam: 1000000000,
        som: 100000000,
      })
      const result = StartupSchema.safeParse(startup)
      expect(result.success).toBe(true)
    })
  })

  describe('FundingStage Enum', () => {
    it('accepts all valid funding stages', () => {
      const validStages: FundingStage[] = [
        'pre-seed',
        'seed',
        'series-a',
        'series-b',
        'series-c',
        'series-d',
        'series-e',
        'growth',
        'pre-ipo',
        'public',
        'bootstrapped',
      ]
      validStages.forEach((fundingStage) => {
        const startup = createValidStartup({ fundingStage })
        const result = StartupSchema.safeParse(startup)
        expect(result.success).toBe(true)
      })
    })

    it('rejects invalid funding stage', () => {
      const startup = createValidStartup()
      // @ts-expect-error - Testing invalid funding stage
      startup.fundingStage = 'series-z'
      const result = StartupSchema.safeParse(startup)
      expect(result.success).toBe(false)
    })
  })

  describe('FundingRound Nested Schema', () => {
    it('validates complete funding round', () => {
      const fundingRound: FundingRound = {
        stage: 'series-a',
        amount: 5000000,
        currency: 'USD',
        date: new Date('2023-06-15'),
        valuation: 25000000,
        investors: ['Sequoia', 'a16z'],
        leadInvestor: 'Sequoia',
        terms: 'Standard Series A terms',
      }
      const result = FundingRoundSchema.safeParse(fundingRound)
      expect(result.success).toBe(true)
    })

    it('requires stage in funding round', () => {
      // @ts-expect-error - Testing missing stage
      const round: FundingRound = { amount: 1000000 }
      const result = FundingRoundSchema.safeParse(round)
      expect(result.success).toBe(false)
    })

    it('requires amount in funding round', () => {
      // @ts-expect-error - Testing missing amount
      const round: FundingRound = { stage: 'seed' }
      const result = FundingRoundSchema.safeParse(round)
      expect(result.success).toBe(false)
    })

    it('validates array of funding rounds', () => {
      const startup = createValidStartup({
        fundingRounds: [
          { stage: 'pre-seed', amount: 100000 },
          { stage: 'seed', amount: 1000000, leadInvestor: 'Y Combinator' },
          { stage: 'series-a', amount: 10000000, valuation: 50000000 },
        ],
      })
      const result = StartupSchema.safeParse(startup)
      expect(result.success).toBe(true)
    })
  })

  describe('StartupMetrics Nested Schema', () => {
    it('validates complete startup metrics', () => {
      const startupMetrics: StartupMetrics = {
        cashBalance: 3000000,
        burnRate: 150000,
        runway: 20,
        weekOverWeekGrowth: 0.05,
        monthOverMonthGrowth: 0.2,
        yearOverYearGrowth: 3.0,
        totalUsers: 10000,
        weeklyActiveUsers: 5000,
        monthlyActiveUsers: 8000,
        signups: 500,
        waitlistSize: 2000,
        timeToFirstRevenue: 6,
        timeToBreakeven: 24,
        timeTo1mArr: 18,
        timeTo10mArr: 36,
        period: 'monthly',
      }
      const startup = createValidStartup({ startupMetrics })
      const result = StartupSchema.safeParse(startup)
      expect(result.success).toBe(true)
    })
  })

  describe('Investor Nested Schema', () => {
    it('validates complete investor', () => {
      const investor: Investor = {
        name: 'Sequoia Capital',
        type: 'vc',
        portfolio: ['Airbnb', 'Stripe', 'DoorDash'],
        leadRounds: true,
        checkSize: {
          min: 1000000,
          max: 50000000,
          currency: 'USD',
        },
      }
      const result = InvestorSchema.safeParse(investor)
      expect(result.success).toBe(true)
    })

    it('validates investor type enum', () => {
      const validTypes = ['angel', 'vc', 'corporate', 'family-office', 'accelerator', 'crowdfunding']
      validTypes.forEach((type) => {
        const investor = { name: 'Test Investor', type }
        const result = InvestorSchema.safeParse(investor)
        expect(result.success).toBe(true)
      })
    })
  })

  describe('Schema Inheritance', () => {
    /**
     * CRITICAL TEST: Verify Startup includes SaaS and Business fields
     */
    it('Startup schema should include all Business fields', () => {
      const businessShape = BusinessSchema.shape
      const startupShape = StartupSchema.shape

      const businessFields = Object.keys(businessShape)
      businessFields.forEach((field) => {
        expect(field in startupShape).toBe(true)
      })
    })

    it('Startup accepts SaaS fields', () => {
      const startup = createValidStartup({
        // SaaS fields
        pricingModel: 'freemium',
        pricingTiers: [{ name: 'Free', price: 0 }],
        saasMetrics: { mrr: 10000 },
        // Startup fields
        fundingStage: 'seed',
      })
      const result = StartupSchema.safeParse(startup)
      expect(result.success).toBe(true)
    })
  })
})

// ============================================================================
// 4. MARKETPLACE SCHEMA TESTS
// ============================================================================

describe('Marketplace Schema', () => {
  describe('Noun Definition', () => {
    it('has correct noun name', () => {
      expect(Marketplace.noun).toBe('Marketplace')
    })

    it('has correct plural name', () => {
      expect(Marketplace.plural).toBe('Marketplaces')
    })

    it('has correct $type URL', () => {
      expect(Marketplace.$type).toBe('https://schema.org.ai/Marketplace')
    })

    it('extends Business', () => {
      expect(Marketplace.extends).toBe('DigitalBusiness')
    })

    it('has Marketplace-specific OKRs', () => {
      expect(Marketplace.okrs).toContain('GMV')
      expect(Marketplace.okrs).toContain('TakeRate')
      expect(Marketplace.okrs).toContain('Liquidity')
    })
  })

  describe('Valid Data', () => {
    it('validates minimal Marketplace with required fields only', () => {
      const marketplace = createValidMarketplace()
      const result = MarketplaceSchema.safeParse(marketplace)
      expect(result.success).toBe(true)
    })

    it('validates Marketplace with all fields', () => {
      const marketplace = createValidMarketplace({
        marketplaceType: 'b2c',
        revenueModel: 'commission',
        commissionRate: 0.15,
        commissionTiers: [
          { name: 'Standard', rate: 0.15 },
          { name: 'Premium Seller', rate: 0.10, minGmv: 100000 },
        ],
        metrics: {
          gmv: 10000000,
          takeRate: 0.15,
          totalSellers: 5000,
          totalBuyers: 100000,
        },
        verificationRequired: true,
        paymentEscrow: true,
        categories: ['Electronics', 'Fashion'],
      })
      const result = MarketplaceSchema.safeParse(marketplace)
      expect(result.success).toBe(true)
    })
  })

  describe('MarketplaceType Enum', () => {
    it('accepts all valid marketplace types', () => {
      const validTypes: MarketplaceType[] = [
        'b2b',
        'b2c',
        'c2c',
        'b2b2c',
        'product',
        'service',
        'talent',
        'rental',
        'booking',
        'hybrid',
      ]
      validTypes.forEach((marketplaceType) => {
        const marketplace = createValidMarketplace({ marketplaceType })
        const result = MarketplaceSchema.safeParse(marketplace)
        expect(result.success).toBe(true)
      })
    })

    it('rejects invalid marketplace type', () => {
      const marketplace = createValidMarketplace()
      // @ts-expect-error - Testing invalid type
      marketplace.marketplaceType = 'invalid-type'
      const result = MarketplaceSchema.safeParse(marketplace)
      expect(result.success).toBe(false)
    })
  })

  describe('MarketplaceRevenueModel Enum', () => {
    it('accepts all valid revenue models', () => {
      const validModels: MarketplaceRevenueModel[] = [
        'commission',
        'subscription',
        'listing-fee',
        'lead-gen',
        'featured-listings',
        'advertising',
        'freemium',
        'hybrid',
      ]
      validModels.forEach((revenueModel) => {
        const marketplace = createValidMarketplace({ revenueModel })
        const result = MarketplaceSchema.safeParse(marketplace)
        expect(result.success).toBe(true)
      })
    })
  })

  describe('MarketplaceMetrics Nested Schema', () => {
    it('validates complete marketplace metrics', () => {
      const metrics: MarketplaceMetrics = {
        gmv: 50000000,
        takeRate: 0.12,
        averageOrderValue: 75,
        transactionVolume: 5000000,
        transactionCount: 66666,
        totalSellers: 10000,
        activeSellers: 7500,
        newSellers: 500,
        sellerChurnRate: 0.02,
        averageListingsPerSeller: 15,
        totalListings: 150000,
        activeListings: 120000,
        totalBuyers: 500000,
        activeBuyers: 100000,
        newBuyers: 20000,
        buyerChurnRate: 0.05,
        repeatPurchaseRate: 0.35,
        buyerToSellerRatio: 50,
        searchToTransactionRate: 0.03,
        listingToSaleRate: 0.25,
        timeToFirstTransaction: 7,
        averageTimeToSale: 14,
        buyerSatisfaction: 4.5,
        sellerSatisfaction: 4.2,
        disputeRate: 0.01,
        refundRate: 0.02,
        period: 'monthly',
      }
      const marketplace = createValidMarketplace({ metrics })
      const result = MarketplaceSchema.safeParse(marketplace)
      expect(result.success).toBe(true)
    })
  })

  describe('CommissionTier Nested Schema', () => {
    it('validates commission tier with all fields', () => {
      const tier: CommissionTier = {
        name: 'Premium',
        rate: 0.08,
        minGmv: 100000,
        maxGmv: 1000000,
        categories: ['Electronics', 'Computers'],
      }
      const result = CommissionTierSchema.safeParse(tier)
      expect(result.success).toBe(true)
    })

    it('requires name in commission tier', () => {
      // @ts-expect-error - Testing missing name
      const tier: CommissionTier = { rate: 0.1 }
      const result = CommissionTierSchema.safeParse(tier)
      expect(result.success).toBe(false)
    })

    it('requires rate in commission tier', () => {
      // @ts-expect-error - Testing missing rate
      const tier: CommissionTier = { name: 'Standard' }
      const result = CommissionTierSchema.safeParse(tier)
      expect(result.success).toBe(false)
    })
  })
})

// ============================================================================
// 5. SERVICE SCHEMA TESTS
// ============================================================================

describe('Service Schema', () => {
  describe('Noun Definition', () => {
    it('has correct noun name', () => {
      expect(Service.noun).toBe('Service')
    })

    it('has correct plural name', () => {
      expect(Service.plural).toBe('Services')
    })

    it('has correct $type URL', () => {
      expect(Service.$type).toBe('https://schema.org.ai/Service')
    })

    it('has Service-specific OKRs', () => {
      expect(Service.okrs).toContain('Utilization')
      expect(Service.okrs).toContain('ClientSatisfaction')
      expect(Service.okrs).toContain('NPS')
    })
  })

  describe('Valid Data', () => {
    it('validates minimal Service with required fields only', () => {
      const service = createValidService()
      const result = ServiceSchema.safeParse(service)
      expect(result.success).toBe(true)
    })

    it('validates Service with all fields', () => {
      const service = createValidService({
        slug: 'consulting-pro',
        description: 'Professional consulting services',
        category: 'consulting',
        targetSegment: 'Enterprise',
        valueProposition: 'Strategic business transformation',
        pricingModel: 'retainer',
        price: 10000,
        currency: 'USD',
        hourlyRate: 250,
        minimumEngagement: 3,
        estimatedDuration: '3-6 months',
        deliverables: [
          { name: 'Strategy Document', description: 'Comprehensive strategy' },
        ],
        sla: { uptime: 0.999, responseTime: '4 hours' },
        metrics: { utilization: 0.85, billableHours: 160 },
        status: 'active',
      })
      const result = ServiceSchema.safeParse(service)
      expect(result.success).toBe(true)
    })
  })

  describe('ServicePricingModel Enum', () => {
    it('accepts all valid pricing models', () => {
      const validModels: ServicePricingModel[] = [
        'hourly',
        'fixed',
        'retainer',
        'value-based',
        'subscription',
        'milestone',
        'success-fee',
        'hybrid',
      ]
      validModels.forEach((pricingModel) => {
        const service = createValidService({ pricingModel })
        const result = ServiceSchema.safeParse(service)
        expect(result.success).toBe(true)
      })
    })
  })

  describe('ServiceCategory Enum', () => {
    it('accepts all valid categories', () => {
      const validCategories: ServiceCategory[] = [
        'consulting',
        'professional',
        'creative',
        'technical',
        'maintenance',
        'support',
        'training',
        'managed',
        'advisory',
        'implementation',
        'custom',
      ]
      validCategories.forEach((category) => {
        const service = createValidService({ category })
        const result = ServiceSchema.safeParse(service)
        expect(result.success).toBe(true)
      })
    })
  })

  describe('Service Status Enum', () => {
    it('accepts all valid status values', () => {
      const validStatuses = ['draft', 'active', 'paused', 'deprecated', 'retired']
      validStatuses.forEach((status) => {
        const service = createValidService({ status: status as any })
        const result = ServiceSchema.safeParse(service)
        expect(result.success).toBe(true)
      })
    })
  })

  describe('ServiceLevelAgreement Nested Schema', () => {
    it('validates complete SLA', () => {
      const sla: ServiceLevelAgreement = {
        uptime: 0.999,
        responseTime: '4 hours',
        resolutionTime: '24 hours',
        supportHours: '24/7',
        supportChannels: ['email', 'phone', 'chat', 'slack'],
        penalties: '10% credit per hour of downtime',
        credits: 0.1,
      }
      const result = ServiceLevelAgreementSchema.safeParse(sla)
      expect(result.success).toBe(true)
    })

    it('validates support channels enum', () => {
      const validChannels = ['email', 'phone', 'chat', 'ticket', 'slack']
      validChannels.forEach((channel) => {
        const sla = { supportChannels: [channel] }
        const result = ServiceLevelAgreementSchema.safeParse(sla)
        expect(result.success).toBe(true)
      })
    })
  })

  describe('ServiceDeliverable Nested Schema', () => {
    it('validates complete deliverable', () => {
      const deliverable: ServiceDeliverable = {
        name: 'Strategy Document',
        description: 'Comprehensive business strategy',
        estimatedDuration: '2 weeks',
        dependencies: ['Discovery Phase', 'Stakeholder Interviews'],
        acceptanceCriteria: [
          'Approved by executive team',
          'Includes 3-year roadmap',
        ],
      }
      const result = ServiceDeliverableSchema.safeParse(deliverable)
      expect(result.success).toBe(true)
    })

    it('requires name in deliverable', () => {
      // @ts-expect-error - Testing missing name
      const deliverable: ServiceDeliverable = { description: 'Test' }
      const result = ServiceDeliverableSchema.safeParse(deliverable)
      expect(result.success).toBe(false)
    })
  })

  describe('ServiceMetrics Nested Schema', () => {
    it('validates complete service metrics', () => {
      const metrics: ServiceMetrics = {
        utilization: 0.85,
        billableHours: 160,
        nonBillableHours: 20,
        billableRate: 250,
        revenue: 40000,
        revenuePerHour: 250,
        averageProjectValue: 50000,
        recurringRevenue: 10000,
        activeProjects: 5,
        completedProjects: 20,
        projectSuccessRate: 0.95,
        onTimeDeliveryRate: 0.9,
        onBudgetRate: 0.85,
        scopeCreepRate: 0.1,
        activeClients: 10,
        newClients: 2,
        clientRetentionRate: 0.9,
        clientSatisfaction: 4.5,
        nps: 65,
        referralRate: 0.3,
        defectRate: 0.02,
        reworkRate: 0.05,
        firstTimeRightRate: 0.95,
        period: 'monthly',
      }
      const result = ServiceMetricsSchema.safeParse(metrics)
      expect(result.success).toBe(true)
    })
  })
})

// ============================================================================
// 6. ORGANIZATION SCHEMA TESTS
// ============================================================================

describe('Organization Schema', () => {
  describe('Noun Definition', () => {
    it('has correct noun name', () => {
      expect(Organization.noun).toBe('Organization')
    })

    it('has correct plural name', () => {
      expect(Organization.plural).toBe('Organizations')
    })

    it('has correct $type URL', () => {
      expect(Organization.$type).toBe('https://schema.org.ai/Organization')
    })

    it('has Organization-specific OKRs', () => {
      expect(Organization.okrs).toContain('Headcount')
      expect(Organization.okrs).toContain('Retention')
    })
  })

  describe('Valid Data', () => {
    it('validates minimal Organization with required fields only', () => {
      const org = createValidOrganization()
      const result = OrganizationSchema.safeParse(org)
      expect(result.success).toBe(true)
    })

    it('validates Organization with all fields', () => {
      const org = createValidOrganization({
        slug: 'techcorp',
        description: 'A technology corporation',
        legalName: 'TechCorp Inc.',
        taxId: 'XX-XXXXXXX',
        registrationNumber: 'REG123456',
        foundedAt: new Date('2015-01-01'),
        dissolvedAt: undefined,
        status: 'active',
        type: 'corporation',
        parentOrganization: 'parent-org-id',
        subsidiaries: ['sub-org-1', 'sub-org-2'],
        structure: {
          departments: [{ name: 'Engineering' }],
          teams: [{ name: 'Platform Team' }],
        },
        headquarters: 'San Francisco, CA',
        locations: ['San Francisco', 'New York', 'London'],
        employeeCount: 500,
        metadata: { industry: 'Technology' },
      })
      const result = OrganizationSchema.safeParse(org)
      expect(result.success).toBe(true)
    })
  })

  describe('Organization Type Enum', () => {
    it('accepts all valid organization types', () => {
      const validTypes = ['corporation', 'llc', 'partnership', 'nonprofit', 'government', 'other']
      validTypes.forEach((type) => {
        const org = createValidOrganization({ type: type as any })
        const result = OrganizationSchema.safeParse(org)
        expect(result.success).toBe(true)
      })
    })
  })

  describe('Organization Status Enum', () => {
    it('accepts all valid status values', () => {
      const validStatuses = ['active', 'inactive', 'dissolved']
      validStatuses.forEach((status) => {
        const org = createValidOrganization({ status: status as any })
        const result = OrganizationSchema.safeParse(org)
        expect(result.success).toBe(true)
      })
    })
  })

  describe('Department Nested Schema', () => {
    it('validates complete department', () => {
      const department: Department = {
        name: 'Engineering',
        description: 'Software development team',
        head: 'eng-lead-001',
        members: ['dev-001', 'dev-002', 'dev-003'],
        budget: 1000000,
      }
      const result = DepartmentSchema.safeParse(department)
      expect(result.success).toBe(true)
    })

    it('requires name in department', () => {
      // @ts-expect-error - Testing missing name
      const department: Department = { description: 'Test dept' }
      const result = DepartmentSchema.safeParse(department)
      expect(result.success).toBe(false)
    })
  })

  describe('Team Nested Schema', () => {
    it('validates complete team', () => {
      const team: Team = {
        name: 'Platform Team',
        description: 'Core platform development',
        lead: 'team-lead-001',
        members: ['member-001', 'member-002'],
        objectives: ['Improve performance', 'Reduce latency'],
      }
      const result = TeamSchema.safeParse(team)
      expect(result.success).toBe(true)
    })

    it('requires name in team', () => {
      // @ts-expect-error - Testing missing name
      const team: Team = { description: 'Test team' }
      const result = TeamSchema.safeParse(team)
      expect(result.success).toBe(false)
    })
  })

  describe('OrganizationalStructure Nested Schema', () => {
    it('validates complete organizational structure', () => {
      const structure: OrganizationalStructure = {
        departments: [
          { name: 'Engineering', budget: 1000000 },
          { name: 'Sales', budget: 500000 },
        ],
        hierarchy: {
          ceo: ['cto', 'cfo', 'cmo'],
          cto: ['vp-eng', 'vp-product'],
        },
        teams: [
          { name: 'Platform', lead: 'lead-001' },
          { name: 'Growth', lead: 'lead-002' },
        ],
      }
      const result = OrganizationalStructureSchema.safeParse(structure)
      expect(result.success).toBe(true)
    })
  })
})

// ============================================================================
// 7. GOAL SCHEMA TESTS
// ============================================================================

describe('Goal Schema', () => {
  describe('Noun Definition', () => {
    it('has correct noun name', () => {
      expect(Goal.noun).toBe('Goal')
    })

    it('has correct plural name', () => {
      expect(Goal.plural).toBe('Goals')
    })

    it('has correct $type URL', () => {
      expect(Goal.$type).toBe('https://schema.org.ai/Goal')
    })

    it('has Goal-specific OKRs', () => {
      expect(Goal.okrs).toContain('Progress')
      expect(Goal.okrs).toContain('Confidence')
      expect(Goal.okrs).toContain('KeyResultsCompleted')
    })
  })

  describe('OKR Alias', () => {
    it('OKR noun is defined', () => {
      expect(OKR.noun).toBe('OKR')
    })

    it('OKR has correct plural', () => {
      expect(OKR.plural).toBe('OKRs')
    })

    it('OKR uses GoalSchema', () => {
      expect(OKR.schema).toBe(GoalSchema)
    })
  })

  describe('Valid Data', () => {
    it('validates minimal Goal with required fields only', () => {
      const goal = createValidGoal()
      const result = GoalSchema.safeParse(goal)
      expect(result.success).toBe(true)
    })

    it('validates Goal with all fields', () => {
      const goal = createValidGoal({
        slug: 'q1-revenue',
        description: 'Increase Q1 revenue by 50%',
        objective: 'Grow revenue to $5M ARR',
        keyResults: [
          { description: 'Close 10 enterprise deals', metric: 'enterprise_deals', targetValue: 10 },
          { description: 'Increase MRR to $400k', metric: 'mrr', targetValue: 400000 },
        ],
        category: 'financial',
        status: 'in-progress',
        priority: 1,
        progress: 35,
        confidence: 70,
        period: 'Q1 2024',
        startDate: new Date('2024-01-01'),
        targetDate: new Date('2024-03-31'),
        owner: 'user-001',
        team: 'sales-team',
        contributors: ['user-002', 'user-003'],
        kpis: [{ name: 'MRR', target: 400000 }],
        milestones: [{ name: 'First $100k MRR month', targetDate: new Date('2024-02-15') }],
      })
      const result = GoalSchema.safeParse(goal)
      expect(result.success).toBe(true)
    })
  })

  describe('GoalCategory Enum', () => {
    it('accepts all valid goal categories', () => {
      const validCategories: GoalCategory[] = [
        'strategic',
        'operational',
        'financial',
        'customer',
        'internal',
        'learning',
        'growth',
      ]
      validCategories.forEach((category) => {
        const goal = createValidGoal({ category })
        const result = GoalSchema.safeParse(goal)
        expect(result.success).toBe(true)
      })
    })

    it('rejects invalid category', () => {
      const goal = createValidGoal()
      // @ts-expect-error - Testing invalid category
      goal.category = 'invalid-category'
      const result = GoalSchema.safeParse(goal)
      expect(result.success).toBe(false)
    })
  })

  describe('GoalStatus Enum', () => {
    it('accepts all valid goal statuses', () => {
      const validStatuses: GoalStatus[] = [
        'not-started',
        'in-progress',
        'on-track',
        'at-risk',
        'behind',
        'completed',
        'cancelled',
      ]
      validStatuses.forEach((status) => {
        const goal = createValidGoal({ status })
        const result = GoalSchema.safeParse(goal)
        expect(result.success).toBe(true)
      })
    })

    it('rejects invalid status', () => {
      const goal = createValidGoal()
      // @ts-expect-error - Testing invalid status
      goal.status = 'invalid-status'
      const result = GoalSchema.safeParse(goal)
      expect(result.success).toBe(false)
    })
  })

  describe('Priority Validation', () => {
    it('accepts priority values 1-5', () => {
      for (let priority = 1; priority <= 5; priority++) {
        const goal = createValidGoal({ priority })
        const result = GoalSchema.safeParse(goal)
        expect(result.success).toBe(true)
      }
    })

    it('rejects priority below 1', () => {
      const goal = createValidGoal({ priority: 0 })
      const result = GoalSchema.safeParse(goal)
      expect(result.success).toBe(false)
    })

    it('rejects priority above 5', () => {
      const goal = createValidGoal({ priority: 6 })
      const result = GoalSchema.safeParse(goal)
      expect(result.success).toBe(false)
    })
  })

  describe('Progress and Confidence Validation', () => {
    it('accepts progress values 0-100', () => {
      const testValues = [0, 25, 50, 75, 100]
      testValues.forEach((progress) => {
        const goal = createValidGoal({ progress })
        const result = GoalSchema.safeParse(goal)
        expect(result.success).toBe(true)
      })
    })

    it('rejects progress below 0', () => {
      const goal = createValidGoal({ progress: -1 })
      const result = GoalSchema.safeParse(goal)
      expect(result.success).toBe(false)
    })

    it('rejects progress above 100', () => {
      const goal = createValidGoal({ progress: 101 })
      const result = GoalSchema.safeParse(goal)
      expect(result.success).toBe(false)
    })

    it('accepts confidence values 0-100', () => {
      const testValues = [0, 25, 50, 75, 100]
      testValues.forEach((confidence) => {
        const goal = createValidGoal({ confidence })
        const result = GoalSchema.safeParse(goal)
        expect(result.success).toBe(true)
      })
    })

    it('rejects confidence below 0', () => {
      const goal = createValidGoal({ confidence: -1 })
      const result = GoalSchema.safeParse(goal)
      expect(result.success).toBe(false)
    })

    it('rejects confidence above 100', () => {
      const goal = createValidGoal({ confidence: 101 })
      const result = GoalSchema.safeParse(goal)
      expect(result.success).toBe(false)
    })
  })

  describe('KeyResult Nested Schema', () => {
    it('validates complete key result', () => {
      const keyResult: KeyResult = {
        description: 'Increase MRR to $500k',
        metric: 'mrr',
        startValue: 300000,
        targetValue: 500000,
        currentValue: 400000,
        unit: 'USD',
        progress: 50,
        confidence: 80,
        owner: 'sales-lead',
        notes: 'On track with enterprise deals',
      }
      const result = KeyResultSchema.safeParse(keyResult)
      expect(result.success).toBe(true)
    })

    it('requires description in key result', () => {
      // @ts-expect-error - Testing missing description
      const kr: KeyResult = { metric: 'test', targetValue: 100 }
      const result = KeyResultSchema.safeParse(kr)
      expect(result.success).toBe(false)
    })

    it('requires metric in key result', () => {
      // @ts-expect-error - Testing missing metric
      const kr: KeyResult = { description: 'Test KR', targetValue: 100 }
      const result = KeyResultSchema.safeParse(kr)
      expect(result.success).toBe(false)
    })

    it('requires targetValue in key result', () => {
      // @ts-expect-error - Testing missing targetValue
      const kr: KeyResult = { description: 'Test KR', metric: 'test' }
      const result = KeyResultSchema.safeParse(kr)
      expect(result.success).toBe(false)
    })
  })

  describe('KPIDefinition Nested Schema', () => {
    it('validates complete KPI definition', () => {
      const kpi: KPIDefinition = {
        name: 'Monthly Recurring Revenue',
        description: 'Total recurring revenue per month',
        category: 'financial',
        unit: 'USD',
        target: 500000,
        current: 400000,
        frequency: 'monthly',
        dataSource: 'Stripe',
        formula: 'SUM(active_subscriptions * price)',
        trend: 'up',
        isGood: 'higher',
      }
      const result = KPIDefinitionSchema.safeParse(kpi)
      expect(result.success).toBe(true)
    })

    it('requires name in KPI', () => {
      // @ts-expect-error - Testing missing name
      const kpi: KPIDefinition = { target: 100 }
      const result = KPIDefinitionSchema.safeParse(kpi)
      expect(result.success).toBe(false)
    })

    it('validates KPI category enum', () => {
      const validCategories = ['financial', 'customer', 'operations', 'people', 'growth']
      validCategories.forEach((category) => {
        const kpi = { name: 'Test KPI', category }
        const result = KPIDefinitionSchema.safeParse(kpi)
        expect(result.success).toBe(true)
      })
    })

    it('validates KPI trend enum', () => {
      const validTrends = ['up', 'down', 'stable']
      validTrends.forEach((trend) => {
        const kpi = { name: 'Test KPI', trend }
        const result = KPIDefinitionSchema.safeParse(kpi)
        expect(result.success).toBe(true)
      })
    })

    it('validates KPI isGood enum', () => {
      const validValues = ['higher', 'lower', 'target']
      validValues.forEach((isGood) => {
        const kpi = { name: 'Test KPI', isGood }
        const result = KPIDefinitionSchema.safeParse(kpi)
        expect(result.success).toBe(true)
      })
    })
  })

  describe('Milestone Nested Schema', () => {
    it('validates complete milestone', () => {
      const milestone: Milestone = {
        name: 'Launch MVP',
        description: 'Release minimum viable product',
        targetDate: new Date('2024-03-01'),
        completedDate: new Date('2024-02-28'),
        status: 'completed',
        dependencies: ['Design Complete', 'Backend Ready'],
      }
      const result = MilestoneSchema.safeParse(milestone)
      expect(result.success).toBe(true)
    })

    it('requires name in milestone', () => {
      // @ts-expect-error - Testing missing name
      const milestone: Milestone = { targetDate: new Date() }
      const result = MilestoneSchema.safeParse(milestone)
      expect(result.success).toBe(false)
    })

    it('validates milestone status enum', () => {
      const validStatuses = ['pending', 'completed', 'missed', 'cancelled']
      validStatuses.forEach((status) => {
        const milestone = { name: 'Test Milestone', status }
        const result = MilestoneSchema.safeParse(milestone)
        expect(result.success).toBe(true)
      })
    })
  })

  describe('Update History', () => {
    it('validates goal with update history', () => {
      const goal = createValidGoal({
        updateHistory: [
          {
            date: new Date('2024-01-15'),
            progress: 10,
            confidence: 80,
            status: 'in-progress',
            notes: 'Initial progress',
          },
          {
            date: new Date('2024-02-01'),
            progress: 25,
            confidence: 75,
            status: 'on-track',
            notes: 'Good progress this sprint',
          },
        ],
      })
      const result = GoalSchema.safeParse(goal)
      expect(result.success).toBe(true)
    })
  })
})

// ============================================================================
// 8. CROSS-SCHEMA VALIDATION TESTS
// ============================================================================

describe('Cross-Schema Validation', () => {
  describe('Type Discrimination', () => {
    it('Business $type is distinct from SaaS $type', () => {
      const business = createValidBusiness()
      const saas = createValidSaaS()

      expect(business.$type).not.toBe(saas.$type)
    })

    it('each noun has unique $type', () => {
      const types = [
        Business.$type,
        SaaS.$type,
        Startup.$type,
        Marketplace.$type,
        Service.$type,
        Organization.$type,
        Goal.$type,
      ]
      const uniqueTypes = new Set(types)
      expect(uniqueTypes.size).toBe(types.length)
    })
  })

  describe('Schema Isolation', () => {
    it('BusinessSchema does not accept SaaS $type', () => {
      const data = {
        $id: 'test-001',
        $type: 'https://schema.org.ai/SaaS',
        name: 'Test',
      }
      const result = BusinessSchema.safeParse(data)
      expect(result.success).toBe(false)
    })

    it('SaaSSchema does not accept Business $type', () => {
      const data = {
        $id: 'test-001',
        $type: 'https://schema.org.ai/Business',
        name: 'Test',
      }
      const result = SaaSSchema.safeParse(data)
      expect(result.success).toBe(false)
    })
  })
})

// ============================================================================
// 9. EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  describe('Empty and Null Values', () => {
    it('rejects null as Business', () => {
      const result = BusinessSchema.safeParse(null)
      expect(result.success).toBe(false)
    })

    it('rejects undefined as Business', () => {
      const result = BusinessSchema.safeParse(undefined)
      expect(result.success).toBe(false)
    })

    it('rejects empty object as Business', () => {
      const result = BusinessSchema.safeParse({})
      expect(result.success).toBe(false)
    })

    it('rejects string as Business', () => {
      const result = BusinessSchema.safeParse('not an object')
      expect(result.success).toBe(false)
    })

    it('rejects array as Business', () => {
      const result = BusinessSchema.safeParse([])
      expect(result.success).toBe(false)
    })
  })

  describe('Type Coercion', () => {
    it('coerces date strings to Date objects', () => {
      const business = createValidBusiness({
        foundedAt: '2020-01-01' as unknown as Date,
      })
      const result = BusinessSchema.safeParse(business)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.foundedAt).toBeInstanceOf(Date)
      }
    })

    it('rejects invalid date strings', () => {
      const business = createValidBusiness({
        foundedAt: 'not-a-date' as unknown as Date,
      })
      const result = BusinessSchema.safeParse(business)
      expect(result.success).toBe(false)
    })
  })

  describe('Large Data Sets', () => {
    it('handles large values array', () => {
      const values = Array(1000).fill('value')
      const business = createValidBusiness({ values })
      const result = BusinessSchema.safeParse(business)
      expect(result.success).toBe(true)
    })

    it('handles SaaS with many pricing tiers', () => {
      const pricingTiers = Array(100).fill(null).map((_, i) => ({
        name: `Tier ${i}`,
        price: i * 10,
      }))
      const saas = createValidSaaS({ pricingTiers })
      const result = SaaSSchema.safeParse(saas)
      expect(result.success).toBe(true)
    })

    it('handles Goal with many key results', () => {
      const keyResults = Array(50).fill(null).map((_, i) => ({
        description: `KR ${i}`,
        metric: `metric_${i}`,
        targetValue: i * 100,
      }))
      const goal = createValidGoal({ keyResults })
      const result = GoalSchema.safeParse(goal)
      expect(result.success).toBe(true)
    })
  })

  describe('Numeric Edge Cases', () => {
    it('accepts zero values for numeric fields', () => {
      const saas = createValidSaaS({
        metrics: {
          mrr: 0,
          churnRate: 0,
          cac: 0,
        },
      })
      const result = SaaSSchema.safeParse(saas)
      expect(result.success).toBe(true)
    })

    it('accepts negative values where appropriate (e.g., netIncome loss)', () => {
      const business = createValidBusiness({
        financials: {
          netIncome: -100000,
        },
      })
      const result = BusinessSchema.safeParse(business)
      expect(result.success).toBe(true)
    })

    it('accepts decimal values for percentages', () => {
      const saas = createValidSaaS({
        metrics: {
          churnRate: 0.025,
          grossRevenueRetention: 0.95,
        },
      })
      const result = SaaSSchema.safeParse(saas)
      expect(result.success).toBe(true)
    })
  })

  describe('String Edge Cases', () => {
    it('accepts empty string for optional string fields', () => {
      const business = createValidBusiness({
        description: '',
        mission: '',
      })
      const result = BusinessSchema.safeParse(business)
      expect(result.success).toBe(true)
    })

    it('accepts very long strings', () => {
      const longString = 'a'.repeat(10000)
      const business = createValidBusiness({
        description: longString,
      })
      const result = BusinessSchema.safeParse(business)
      expect(result.success).toBe(true)
    })

    it('accepts unicode characters', () => {
      const business = createValidBusiness({
        name: 'Entreprise Internationale',
        description: 'Description with emoji and special chars',
      })
      const result = BusinessSchema.safeParse(business)
      expect(result.success).toBe(true)
    })
  })

  describe('URL Validation', () => {
    it('accepts valid URLs for URL fields', () => {
      const saas = createValidSaaS({
        productUrl: 'https://example.com',
        appStoreUrl: 'https://apps.apple.com/app/id123',
        playStoreUrl: 'https://play.google.com/store/apps/details?id=com.example',
      })
      const result = SaaSSchema.safeParse(saas)
      expect(result.success).toBe(true)
    })

    it('rejects invalid URLs', () => {
      const saas = createValidSaaS({
        productUrl: 'not-a-url',
      })
      const result = SaaSSchema.safeParse(saas)
      expect(result.success).toBe(false)
    })
  })
})

// ============================================================================
// 10. SCHEMA DOCUMENTATION TESTS
// ============================================================================

describe('Schema Documentation', () => {
  it('all Business nouns are exported from index', () => {
    // These imports would fail if not exported
    expect(Business).toBeDefined()
    expect(SaaS).toBeDefined()
    expect(Startup).toBeDefined()
    expect(Marketplace).toBeDefined()
    expect(Service).toBeDefined()
    expect(Organization).toBeDefined()
    expect(Goal).toBeDefined()
    expect(OKR).toBeDefined()
  })

  it('all schemas are exported from index', () => {
    expect(BusinessSchema).toBeDefined()
    expect(SaaSSchema).toBeDefined()
    expect(StartupSchema).toBeDefined()
    expect(MarketplaceSchema).toBeDefined()
    expect(ServiceSchema).toBeDefined()
    expect(OrganizationSchema).toBeDefined()
    expect(GoalSchema).toBeDefined()
  })

  it('all supporting schemas are exported', () => {
    // Business
    expect(BusinessPlanSchema).toBeDefined()
    expect(TimePeriodSchema).toBeDefined()
    expect(CurrencySchema).toBeDefined()
    expect(FinancialMetricsSchema).toBeDefined()

    // SaaS
    expect(SaaSPricingModelSchema).toBeDefined()
    expect(SaaSMetricsSchema).toBeDefined()
    expect(PricingTierSchema).toBeDefined()

    // Startup
    expect(FundingStageSchema).toBeDefined()
    expect(FundingRoundSchema).toBeDefined()
    expect(StartupMetricsSchema).toBeDefined()
    expect(InvestorSchema).toBeDefined()

    // Marketplace
    expect(MarketplaceTypeSchema).toBeDefined()
    expect(MarketplaceRevenueModelSchema).toBeDefined()
    expect(MarketplaceMetricsSchema).toBeDefined()
    expect(CommissionTierSchema).toBeDefined()

    // Service
    expect(ServicePricingModelSchema).toBeDefined()
    expect(ServiceCategorySchema).toBeDefined()
    expect(ServiceLevelAgreementSchema).toBeDefined()
    expect(ServiceDeliverableSchema).toBeDefined()
    expect(ServiceMetricsSchema).toBeDefined()

    // Organization
    expect(DepartmentSchema).toBeDefined()
    expect(TeamSchema).toBeDefined()
    expect(OrganizationalStructureSchema).toBeDefined()

    // Goal
    expect(GoalCategorySchema).toBeDefined()
    expect(GoalStatusSchema).toBeDefined()
    expect(KeyResultSchema).toBeDefined()
    expect(KPIDefinitionSchema).toBeDefined()
    expect(MilestoneSchema).toBeDefined()
  })
})
