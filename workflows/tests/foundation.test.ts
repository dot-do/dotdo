/**
 * Foundation Sprint Workflow Tests (RED Phase)
 *
 * TDD tests for $.foundation() - the Foundation Sprint DSL
 *
 * The Foundation Sprint is core to dotdo vision:
 * 1. Customer definition - Who are we building for?
 * 2. Problem statement - What problem are we solving?
 * 3. Differentiation - Why us? What makes us unique?
 * 4. First-customer interviews - Validate with real customers
 * 5. HUNCH metrics baseline - Hair-on-fire, Usage, NPS, Churn, LTV/CAC
 *
 * The result is a "Founding Hypothesis" that can be tested and iterated on.
 *
 * API Design:
 * - $.foundation().hypothesis({...}) - Capture founding hypothesis
 * - $.foundation().validate() - Run validation workflow
 * - $.foundation().interview(customer) - Schedule/run customer interview
 * - $.foundation().analyze() - Run differentiation analyzer
 * - $.foundation().metrics() - Establish HUNCH baseline
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

// ============================================================================
// TYPE DEFINITIONS - What the API should look like
// ============================================================================

/**
 * Customer persona definition
 */
export interface CustomerPersona {
  /** Short identifier for the persona (e.g., 'solo-founder', 'enterprise-pm') */
  id: string
  /** Display name */
  name: string
  /** Detailed description of who this customer is */
  description: string
  /** Their primary job title or role */
  role?: string
  /** Industry or vertical they operate in */
  industry?: string
  /** Size of their company (solo, startup, smb, enterprise) */
  companySize?: 'solo' | 'startup' | 'smb' | 'enterprise'
  /** Pain points they experience */
  painPoints: string[]
  /** Goals they want to achieve */
  goals: string[]
  /** Where they spend time (communities, platforms) */
  channels?: string[]
}

/**
 * Problem statement definition
 */
export interface ProblemStatement {
  /** One-line summary of the problem */
  summary: string
  /** Detailed description */
  description: string
  /** Current workarounds customers use */
  currentSolutions: string[]
  /** Why current solutions are inadequate */
  gaps: string[]
  /** How painful is this problem (1-10) */
  painLevel: number
  /** How frequently does this problem occur */
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'rarely'
  /** Is this a "hair on fire" problem? */
  hairOnFire: boolean
}

/**
 * Differentiation/positioning statement
 */
export interface Differentiation {
  /** One-line positioning statement */
  positioning: string
  /** What we do differently */
  uniqueValue: string
  /** Direct competitors */
  competitors: Array<{
    name: string
    weakness: string
    ourAdvantage: string
  }>
  /** Unfair advantages we have */
  unfairAdvantages: string[]
  /** Why we're the right team to solve this */
  teamFit: string
}

/**
 * Complete Founding Hypothesis
 */
export interface FoundingHypothesis {
  /** Unique identifier */
  id: string
  /** Startup/product name */
  name: string
  /** Customer persona(s) */
  customers: CustomerPersona[]
  /** Problem statement */
  problem: ProblemStatement
  /** Differentiation */
  differentiation: Differentiation
  /** Hypothesis status */
  status: 'draft' | 'validating' | 'validated' | 'pivoted' | 'abandoned'
  /** Confidence score (0-100) */
  confidence: number
  /** Creation timestamp */
  createdAt: Date
  /** Last update timestamp */
  updatedAt: Date
  /** Version for tracking iterations */
  version: number
}

/**
 * Customer interview data
 */
export interface CustomerInterview {
  id: string
  hypothesisId: string
  customerId: string
  customerPersona: string
  scheduledAt: Date
  completedAt?: Date
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'no_show'
  /** Pre-defined interview questions */
  questions: InterviewQuestion[]
  /** Interview responses */
  responses?: InterviewResponse[]
  /** AI-generated insights */
  insights?: string[]
  /** Tags for categorization */
  tags: string[]
}

export interface InterviewQuestion {
  id: string
  question: string
  category: 'problem' | 'solution' | 'willingness_to_pay' | 'competition' | 'behavior'
  required: boolean
}

export interface InterviewResponse {
  questionId: string
  answer: string
  sentiment?: 'positive' | 'neutral' | 'negative'
  keyInsights?: string[]
}

/**
 * HUNCH metrics baseline
 * Hair-on-fire, Usage, NPS, Churn, LTV/CAC
 */
export interface HUNCHMetrics {
  /** Hair-on-fire: Is this an urgent, critical problem? */
  hairOnFire: {
    /** Percentage of customers who describe problem as "must fix now" */
    urgencyScore: number
    /** Average pain level (1-10) */
    painLevel: number
    /** Would they actively search for a solution? */
    activelySearching: boolean
  }

  /** Usage: How often do they engage? */
  usage: {
    /** Daily active users / Monthly active users */
    dauMau: number
    /** Average session duration (minutes) */
    avgSessionDuration: number
    /** Average sessions per week */
    sessionsPerWeek: number
    /** Feature adoption rates */
    featureAdoption: Record<string, number>
  }

  /** NPS: Net Promoter Score */
  nps: {
    /** NPS score (-100 to 100) */
    score: number
    /** Percentage of promoters (9-10) */
    promoters: number
    /** Percentage of passives (7-8) */
    passives: number
    /** Percentage of detractors (0-6) */
    detractors: number
    /** Number of responses */
    responseCount: number
  }

  /** Churn: Customer retention */
  churn: {
    /** Monthly churn rate (percentage) */
    monthlyRate: number
    /** Annual churn rate (percentage) */
    annualRate: number
    /** Average customer lifetime (months) */
    avgLifetimeMonths: number
    /** Churn by cohort */
    cohortRetention: Record<string, number>
  }

  /** LTV/CAC: Unit economics */
  ltvCac: {
    /** Lifetime value ($) */
    ltv: number
    /** Customer acquisition cost ($) */
    cac: number
    /** LTV/CAC ratio */
    ratio: number
    /** Months to recover CAC */
    paybackMonths: number
  }
}

/**
 * Validation result from running validation workflow
 */
export interface ValidationResult {
  hypothesisId: string
  passed: boolean
  score: number
  breakdown: {
    customerClarity: number
    problemSeverity: number
    differentiationStrength: number
    interviewCount: number
    metricsBaseline: number
  }
  recommendations: string[]
  nextSteps: string[]
  completedAt: Date
}

/**
 * Differentiation analysis result
 */
export interface DifferentiationAnalysis {
  hypothesisId: string
  competitors: Array<{
    name: string
    strengths: string[]
    weaknesses: string[]
    positioning: string
    pricing?: string
    marketShare?: string
  }>
  marketGaps: string[]
  opportunities: string[]
  threats: string[]
  positioningRecommendations: string[]
  analyzedAt: Date
}

// ============================================================================
// FOUNDATION BUILDER INTERFACE - Fluent API
// ============================================================================

/**
 * FoundationBuilder - Fluent builder for Foundation Sprint workflow
 */
export interface FoundationBuilder {
  /**
   * Capture or update the founding hypothesis
   * @param hypothesis - The hypothesis definition or update
   */
  hypothesis(hypothesis: Partial<FoundingHypothesis>): FoundationHypothesisBuilder

  /**
   * Access existing hypothesis by ID
   * @param id - Hypothesis ID
   */
  get(id: string): Promise<FoundingHypothesis | null>

  /**
   * List all hypotheses
   */
  list(): Promise<FoundingHypothesis[]>

  /**
   * Run validation workflow on current hypothesis
   */
  validate(): FoundationValidationBuilder

  /**
   * Schedule or conduct customer interview
   * @param customer - Customer identifier or persona
   */
  interview(customer: string | CustomerPersona): FoundationInterviewBuilder

  /**
   * Run differentiation analysis
   */
  analyze(): FoundationAnalyzerBuilder

  /**
   * Access or establish HUNCH metrics
   */
  metrics(): FoundationMetricsBuilder
}

/**
 * Hypothesis builder - for creating/updating hypotheses
 */
export interface FoundationHypothesisBuilder {
  /** Set customer persona(s) */
  customer(persona: CustomerPersona | CustomerPersona[]): this
  /** Set problem statement */
  problem(problem: ProblemStatement): this
  /** Set differentiation */
  differentiation(diff: Differentiation): this
  /** Save the hypothesis */
  save(): Promise<FoundingHypothesis>
  /** Validate before saving */
  validate(): Promise<ValidationResult>
}

/**
 * Validation builder - for running validation workflow
 */
export interface FoundationValidationBuilder {
  /** Set minimum confidence threshold */
  minConfidence(threshold: number): this
  /** Require N customer interviews */
  requireInterviews(count: number): this
  /** Require metrics baseline */
  requireMetrics(): this
  /** Run validation */
  run(): Promise<ValidationResult>
}

/**
 * Interview builder - for scheduling/conducting interviews
 */
export interface FoundationInterviewBuilder {
  /** Set interview questions */
  questions(questions: InterviewQuestion[]): this
  /** Use AI to generate questions based on hypothesis */
  generateQuestions(): Promise<this>
  /** Schedule interview for specific time */
  schedule(at: Date): Promise<CustomerInterview>
  /** Start interview now (interactive) */
  start(): Promise<CustomerInterview>
  /** Record response */
  respond(questionId: string, answer: string): this
  /** Complete and analyze interview */
  complete(): Promise<CustomerInterview>
}

/**
 * Analyzer builder - for differentiation analysis
 */
export interface FoundationAnalyzerBuilder {
  /** Add competitor to analyze */
  competitor(name: string): this
  /** Use AI to discover competitors */
  discoverCompetitors(): Promise<this>
  /** Run SWOT analysis */
  swot(): Promise<{ strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] }>
  /** Run full analysis */
  run(): Promise<DifferentiationAnalysis>
}

/**
 * Metrics builder - for HUNCH metrics
 */
export interface FoundationMetricsBuilder {
  /** Get current metrics */
  current(): Promise<HUNCHMetrics | null>
  /** Set baseline metrics */
  baseline(metrics: Partial<HUNCHMetrics>): Promise<HUNCHMetrics>
  /** Track specific metric */
  track(metric: keyof HUNCHMetrics): Promise<HUNCHMetrics[typeof metric]>
  /** Get metrics trend */
  trend(metric: keyof HUNCHMetrics, period: 'day' | 'week' | 'month'): Promise<Array<{ date: Date; value: number }>>
  /** Compare to target */
  compare(target: Partial<HUNCHMetrics>): Promise<{
    metric: string
    current: number
    target: number
    gap: number
    onTrack: boolean
  }[]>
}

// ============================================================================
// IMPLEMENTATION IMPORT
// ============================================================================

// Import the real implementation
import { createMockContext, type FoundationContext } from '../context/foundation'

// Create mock context that will be reused
type MockWorkflowContext = FoundationContext

// Factory that creates a fresh context for each test
function createTestContext(): MockWorkflowContext {
  return createMockContext()
}

// ============================================================================
// 1. HYPOTHESIS CAPTURE TESTS
// ============================================================================

describe('$.foundation().hypothesis() - Hypothesis Capture', () => {
  describe('basic hypothesis creation', () => {
    it('should create a founding hypothesis with customer, problem, differentiation', async () => {
      // This test defines the expected API
      const $ = createTestContext()

      const customer: CustomerPersona = {
        id: 'solo-founder',
        name: 'Solo Founder',
        description: 'Technical founder building their first startup',
        role: 'Founder/CEO',
        companySize: 'solo',
        painPoints: ['No time for infrastructure', 'Limited budget', 'Need to move fast'],
        goals: ['Launch MVP in 2 weeks', 'Validate idea quickly', 'Keep costs low'],
      }

      const problem: ProblemStatement = {
        summary: 'Building SaaS infrastructure is too slow and expensive',
        description: 'Founders spend weeks setting up auth, payments, databases before building their actual product',
        currentSolutions: ['Supabase', 'Firebase', 'DIY with AWS'],
        gaps: ['Still requires glue code', 'Vendor lock-in', 'No business logic layer'],
        painLevel: 8,
        frequency: 'daily',
        hairOnFire: true,
      }

      const differentiation: Differentiation = {
        positioning: 'The framework for autonomous businesses',
        uniqueValue: 'Business-as-Code - define your business in code, AI agents run it',
        competitors: [
          { name: 'Supabase', weakness: 'Just a database', ourAdvantage: 'Full business logic layer' },
          { name: 'Firebase', weakness: 'Limited to simple apps', ourAdvantage: 'Complex workflows' },
        ],
        unfairAdvantages: ['Deep Cloudflare integration', 'AI-native from day 1'],
        teamFit: 'Built by founders who have scaled SaaS businesses',
      }

      const hypothesis = await $.foundation()
        .hypothesis({ name: 'dotdo' })
        .customer(customer)
        .problem(problem)
        .differentiation(differentiation)
        .save()

      expect(hypothesis.id).toBeDefined()
      expect(hypothesis.name).toBe('dotdo')
      expect(hypothesis.customers).toContainEqual(customer)
      expect(hypothesis.problem).toEqual(problem)
      expect(hypothesis.differentiation).toEqual(differentiation)
      expect(hypothesis.status).toBe('draft')
      expect(hypothesis.version).toBe(1)
    })

    it('should support multiple customer personas', async () => {
      const $ = createTestContext()

      const personas: CustomerPersona[] = [
        {
          id: 'solo-founder',
          name: 'Solo Founder',
          description: 'Building alone',
          painPoints: ['Time constraints'],
          goals: ['Ship fast'],
        },
        {
          id: 'agency-dev',
          name: 'Agency Developer',
          description: 'Building for clients',
          painPoints: ['Client demands', 'Tight deadlines'],
          goals: ['Reusable components', 'Fast delivery'],
        },
      ]

      const hypothesis = await $.foundation()
        .hypothesis({ name: 'dotdo' })
        .customer(personas)
        .problem({
          summary: 'Building apps is slow',
          description: 'Too much boilerplate',
          currentSolutions: [],
          gaps: [],
          painLevel: 7,
          frequency: 'daily',
          hairOnFire: false,
        })
        .save()

      expect(hypothesis.customers).toHaveLength(2)
      expect(hypothesis.customers.map((c) => c.id)).toEqual(['solo-founder', 'agency-dev'])
    })

    it('should validate hypothesis before saving', async () => {
      const $ = createTestContext()

      // Incomplete hypothesis should fail validation
      const result = await $.foundation()
        .hypothesis({ name: 'incomplete' })
        .customer({
          id: 'test',
          name: 'Test',
          description: '',
          painPoints: [], // Empty!
          goals: [], // Empty!
        })
        .validate()

      expect(result.passed).toBe(false)
      expect(result.recommendations).toContain('Customer persona needs pain points')
      expect(result.recommendations).toContain('Customer persona needs goals')
    })

    it('should version hypotheses on update', async () => {
      const $ = createTestContext()

      // Create initial
      const v1 = await $.foundation()
        .hypothesis({ name: 'evolving' })
        .customer({
          id: 'v1-customer',
          name: 'Original',
          description: 'First version',
          painPoints: ['Pain 1'],
          goals: ['Goal 1'],
        })
        .save()

      expect(v1.version).toBe(1)

      // Update
      const v2 = await $.foundation()
        .hypothesis({ id: v1.id, name: 'evolving' })
        .customer({
          id: 'v2-customer',
          name: 'Pivoted',
          description: 'After learning',
          painPoints: ['Different pain'],
          goals: ['Different goal'],
        })
        .save()

      expect(v2.version).toBe(2)
      expect(v2.id).toBe(v1.id)
    })
  })

  describe('hypothesis retrieval', () => {
    it('should get hypothesis by ID', async () => {
      const $ = createTestContext()

      // First create a hypothesis
      const created = await $.foundation()
        .hypothesis({ name: 'Test' })
        .customer({
          id: 'test',
          name: 'Test',
          description: 'Test',
          painPoints: ['pain'],
          goals: ['goal'],
        })
        .save()

      const hypothesis = await $.foundation().get(created.id)

      expect(hypothesis).toBeDefined()
      if (hypothesis) {
        expect(hypothesis.id).toBe(created.id)
      }
    })

    it('should list all hypotheses', async () => {
      const $ = createTestContext()

      const hypotheses = await $.foundation().list()

      expect(Array.isArray(hypotheses)).toBe(true)
    })
  })
})

// ============================================================================
// 2. VALIDATION WORKFLOW TESTS
// ============================================================================

// Helper to create a basic hypothesis for validation tests
async function setupHypothesis($: MockWorkflowContext) {
  await $.foundation()
    .hypothesis({ name: 'Test' })
    .customer({
      id: 'test',
      name: 'Test Customer',
      description: 'Test description',
      painPoints: ['Pain 1'],
      goals: ['Goal 1'],
    })
    .problem({
      summary: 'Test problem',
      description: 'Test description',
      currentSolutions: [],
      gaps: [],
      painLevel: 7,
      frequency: 'daily',
      hairOnFire: true,
    })
    .differentiation({
      positioning: 'Test positioning',
      uniqueValue: 'Test value',
      competitors: [],
      unfairAdvantages: [],
      teamFit: 'Test team',
    })
    .save()
}

describe('$.foundation().validate() - Validation Workflow', () => {
  describe('validation criteria', () => {
    it('should validate with minimum confidence threshold', async () => {
      const $ = createTestContext()
      await setupHypothesis($)

      const result = await $.foundation()
        .validate()
        .minConfidence(70)
        .run()

      expect(result.hypothesisId).toBeDefined()
      expect(result.score).toBeDefined()
      expect(result.passed).toBe(result.score >= 70)
    })

    it('should require minimum number of interviews', async () => {
      const $ = createTestContext()
      await setupHypothesis($)

      const result = await $.foundation()
        .validate()
        .requireInterviews(5)
        .run()

      expect(result.breakdown.interviewCount).toBeDefined()
      if (result.breakdown.interviewCount < 5) {
        expect(result.recommendations).toContain('Complete more customer interviews (5 required)')
      }
    })

    it('should require metrics baseline when specified', async () => {
      const $ = createTestContext()
      await setupHypothesis($)

      const result = await $.foundation()
        .validate()
        .requireMetrics()
        .run()

      expect(result.breakdown.metricsBaseline).toBeDefined()
      if (result.breakdown.metricsBaseline === 0) {
        expect(result.recommendations).toContain('Establish HUNCH metrics baseline')
      }
    })

    it('should provide breakdown of all validation criteria', async () => {
      const $ = createTestContext()
      await setupHypothesis($)

      const result = await $.foundation().validate().run()

      expect(result.breakdown).toMatchObject({
        customerClarity: expect.any(Number),
        problemSeverity: expect.any(Number),
        differentiationStrength: expect.any(Number),
        interviewCount: expect.any(Number),
        metricsBaseline: expect.any(Number),
      })
    })

    it('should provide actionable next steps', async () => {
      const $ = createTestContext()

      const result = await $.foundation().validate().run()

      expect(result.nextSteps).toBeDefined()
      expect(Array.isArray(result.nextSteps)).toBe(true)
      result.nextSteps.forEach((step) => {
        expect(typeof step).toBe('string')
        expect(step.length).toBeGreaterThan(0)
      })
    })
  })

  describe('validation status updates', () => {
    it('should update hypothesis status to validating when validation starts', async () => {
      const $ = createTestContext()

      // Start validation
      const validationPromise = $.foundation().validate().run()

      // Check hypothesis status mid-validation
      const hypothesis = await $.foundation().get('current')
      expect(hypothesis?.status).toBe('validating')

      await validationPromise
    })

    it('should update hypothesis status to validated on success', async () => {
      const $ = createTestContext()

      const result = await $.foundation()
        .validate()
        .minConfidence(50) // Low threshold for passing
        .run()

      if (result.passed) {
        const hypothesis = await $.foundation().get(result.hypothesisId)
        expect(hypothesis?.status).toBe('validated')
      }
    })
  })
})

// ============================================================================
// 3. CUSTOMER INTERVIEW TESTS
// ============================================================================

describe('$.foundation().interview() - Customer Interviews', () => {
  describe('interview scheduling', () => {
    it('should schedule interview for specific customer', async () => {
      const $ = createTestContext()

      const scheduledAt = new Date(Date.now() + 86400000) // Tomorrow

      const interview = await $.foundation()
        .interview('customer-123')
        .schedule(scheduledAt)

      expect(interview.id).toBeDefined()
      expect(interview.customerId).toBe('customer-123')
      expect(interview.scheduledAt).toEqual(scheduledAt)
      expect(interview.status).toBe('scheduled')
    })

    it('should schedule interview for customer persona', async () => {
      const $ = createTestContext()

      const persona: CustomerPersona = {
        id: 'enterprise-pm',
        name: 'Enterprise PM',
        description: 'Product manager at large company',
        painPoints: ['Slow procurement', 'Security requirements'],
        goals: ['Fast deployment', 'Compliance'],
      }

      const interview = await $.foundation()
        .interview(persona)
        .schedule(new Date())

      expect(interview.customerPersona).toBe('enterprise-pm')
    })
  })

  describe('interview questions', () => {
    it('should set custom interview questions', async () => {
      const $ = createTestContext()

      const questions: InterviewQuestion[] = [
        { id: 'q1', question: 'What is your biggest challenge?', category: 'problem', required: true },
        { id: 'q2', question: 'How do you solve it today?', category: 'solution', required: true },
        { id: 'q3', question: 'Would you pay for a solution?', category: 'willingness_to_pay', required: false },
      ]

      const interview = await $.foundation()
        .interview('customer-456')
        .questions(questions)
        .schedule(new Date())

      expect(interview.questions).toEqual(questions)
    })

    it('should auto-generate questions based on hypothesis', async () => {
      const $ = createTestContext()

      const builder = await $.foundation()
        .interview('customer-789')
        .generateQuestions()

      const interview = await builder.schedule(new Date())

      expect(interview.questions.length).toBeGreaterThan(0)
      // Should have questions from each category
      const categories = interview.questions.map((q) => q.category)
      expect(categories).toContain('problem')
      expect(categories).toContain('solution')
    })
  })

  describe('interview execution', () => {
    it('should start interactive interview', async () => {
      const $ = createTestContext()

      const interview = await $.foundation()
        .interview('customer-abc')
        .questions([
          { id: 'q1', question: 'Test question?', category: 'problem', required: true },
        ])
        .start()

      expect(interview.status).toBe('in_progress')
    })

    it('should record interview responses', async () => {
      const $ = createTestContext()

      const interview = await $.foundation()
        .interview('customer-def')
        .questions([
          { id: 'q1', question: 'What problem?', category: 'problem', required: true },
        ])
        .start()

      const completed = await $.foundation()
        .interview(interview.customerId)
        .respond('q1', 'Our deployment process takes 3 hours')
        .complete()

      expect(completed.status).toBe('completed')
      expect(completed.responses).toHaveLength(1)
      expect(completed.responses![0].answer).toBe('Our deployment process takes 3 hours')
    })

    it('should generate insights from completed interview', async () => {
      const $ = createTestContext()

      const completed = await $.foundation()
        .interview('customer-ghi')
        .questions([
          { id: 'q1', question: 'What problem?', category: 'problem', required: true },
        ])
        .respond('q1', 'I spend 4 hours a day on manual data entry')
        .complete()

      expect(completed.insights).toBeDefined()
      expect(completed.insights!.length).toBeGreaterThan(0)
      // AI should extract key insights
      expect(completed.insights!.some((i) => i.includes('manual') || i.includes('time'))).toBe(true)
    })

    it('should analyze sentiment in responses', async () => {
      const $ = createTestContext()

      const completed = await $.foundation()
        .interview('customer-jkl')
        .questions([
          { id: 'q1', question: 'How do you feel about current solution?', category: 'solution', required: true },
        ])
        .respond('q1', 'It is terrible! So frustrating and wastes my time every day.')
        .complete()

      const response = completed.responses![0]
      expect(response.sentiment).toBe('negative')
    })
  })
})

// ============================================================================
// 4. DIFFERENTIATION ANALYZER TESTS
// ============================================================================

describe('$.foundation().analyze() - Differentiation Analyzer', () => {
  describe('competitor analysis', () => {
    it('should analyze specified competitors', async () => {
      const $ = createTestContext()

      const analysis = await $.foundation()
        .analyze()
        .competitor('Supabase')
        .competitor('Firebase')
        .competitor('PlanetScale')
        .run()

      expect(analysis.competitors).toHaveLength(3)
      expect(analysis.competitors.map((c) => c.name)).toEqual(['Supabase', 'Firebase', 'PlanetScale'])
    })

    it('should discover competitors automatically', async () => {
      const $ = createTestContext()

      const builder = await $.foundation()
        .analyze()
        .discoverCompetitors()

      const analysis = await builder.run()

      expect(analysis.competitors.length).toBeGreaterThan(0)
    })

    it('should identify competitor strengths and weaknesses', async () => {
      const $ = createTestContext()

      const analysis = await $.foundation()
        .analyze()
        .competitor('Supabase')
        .run()

      const supabase = analysis.competitors.find((c) => c.name === 'Supabase')
      expect(supabase).toBeDefined()
      expect(supabase!.strengths.length).toBeGreaterThan(0)
      expect(supabase!.weaknesses.length).toBeGreaterThan(0)
    })
  })

  describe('market analysis', () => {
    it('should identify market gaps', async () => {
      const $ = createTestContext()

      const analysis = await $.foundation()
        .analyze()
        .competitor('Competitor1')
        .competitor('Competitor2')
        .run()

      expect(analysis.marketGaps).toBeDefined()
      expect(Array.isArray(analysis.marketGaps)).toBe(true)
    })

    it('should identify opportunities', async () => {
      const $ = createTestContext()

      const analysis = await $.foundation().analyze().run()

      expect(analysis.opportunities).toBeDefined()
      expect(Array.isArray(analysis.opportunities)).toBe(true)
    })

    it('should identify threats', async () => {
      const $ = createTestContext()

      const analysis = await $.foundation().analyze().run()

      expect(analysis.threats).toBeDefined()
      expect(Array.isArray(analysis.threats)).toBe(true)
    })
  })

  describe('SWOT analysis', () => {
    it('should run SWOT analysis', async () => {
      const $ = createTestContext()

      const swot = await $.foundation()
        .analyze()
        .swot()

      expect(swot.strengths).toBeDefined()
      expect(swot.weaknesses).toBeDefined()
      expect(swot.opportunities).toBeDefined()
      expect(swot.threats).toBeDefined()
    })
  })

  describe('positioning recommendations', () => {
    it('should provide positioning recommendations', async () => {
      const $ = createTestContext()

      const analysis = await $.foundation().analyze().run()

      expect(analysis.positioningRecommendations).toBeDefined()
      expect(Array.isArray(analysis.positioningRecommendations)).toBe(true)
      expect(analysis.positioningRecommendations.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// 5. HUNCH METRICS TESTS
// ============================================================================

describe('$.foundation().metrics() - HUNCH Metrics', () => {
  describe('baseline establishment', () => {
    it('should establish HUNCH metrics baseline', async () => {
      const $ = createTestContext()

      const baseline = await $.foundation().metrics().baseline({
        hairOnFire: {
          urgencyScore: 75,
          painLevel: 8,
          activelySearching: true,
        },
        nps: {
          score: 45,
          promoters: 55,
          passives: 30,
          detractors: 15,
          responseCount: 100,
        },
      })

      expect(baseline.hairOnFire.urgencyScore).toBe(75)
      expect(baseline.nps.score).toBe(45)
    })

    it('should get current metrics', async () => {
      const $ = createTestContext()

      const metrics = await $.foundation().metrics().current()

      if (metrics) {
        expect(metrics.hairOnFire).toBeDefined()
        expect(metrics.usage).toBeDefined()
        expect(metrics.nps).toBeDefined()
        expect(metrics.churn).toBeDefined()
        expect(metrics.ltvCac).toBeDefined()
      }
    })
  })

  describe('individual metric tracking', () => {
    it('should track Hair-on-fire metrics', async () => {
      const $ = createTestContext()

      const hairOnFire = await $.foundation().metrics().track('hairOnFire')

      expect(hairOnFire.urgencyScore).toBeDefined()
      expect(hairOnFire.painLevel).toBeDefined()
      expect(hairOnFire.activelySearching).toBeDefined()
    })

    it('should track Usage metrics', async () => {
      const $ = createTestContext()

      const usage = await $.foundation().metrics().track('usage')

      expect(usage.dauMau).toBeDefined()
      expect(usage.avgSessionDuration).toBeDefined()
      expect(usage.sessionsPerWeek).toBeDefined()
    })

    it('should track NPS metrics', async () => {
      const $ = createTestContext()

      const nps = await $.foundation().metrics().track('nps')

      expect(nps.score).toBeDefined()
      expect(nps.promoters).toBeDefined()
      expect(nps.detractors).toBeDefined()
    })

    it('should track Churn metrics', async () => {
      const $ = createTestContext()

      const churn = await $.foundation().metrics().track('churn')

      expect(churn.monthlyRate).toBeDefined()
      expect(churn.avgLifetimeMonths).toBeDefined()
    })

    it('should track LTV/CAC metrics', async () => {
      const $ = createTestContext()

      const ltvCac = await $.foundation().metrics().track('ltvCac')

      expect(ltvCac.ltv).toBeDefined()
      expect(ltvCac.cac).toBeDefined()
      expect(ltvCac.ratio).toBeDefined()
      expect(ltvCac.paybackMonths).toBeDefined()
    })
  })

  describe('metric trends', () => {
    it('should get metric trends over time', async () => {
      const $ = createTestContext()

      const trend = await $.foundation().metrics().trend('nps', 'week')

      expect(Array.isArray(trend)).toBe(true)
      trend.forEach((point) => {
        expect(point.date).toBeInstanceOf(Date)
        expect(typeof point.value).toBe('number')
      })
    })

    it('should support different time periods', async () => {
      const $ = createTestContext()

      const dailyTrend = await $.foundation().metrics().trend('usage', 'day')
      const weeklyTrend = await $.foundation().metrics().trend('usage', 'week')
      const monthlyTrend = await $.foundation().metrics().trend('usage', 'month')

      // Daily should have more data points than weekly
      expect(dailyTrend.length).toBeGreaterThanOrEqual(weeklyTrend.length)
      expect(weeklyTrend.length).toBeGreaterThanOrEqual(monthlyTrend.length)
    })
  })

  describe('metric comparison', () => {
    it('should compare current metrics to target', async () => {
      const $ = createTestContext()

      const target: Partial<HUNCHMetrics> = {
        nps: {
          score: 50,
          promoters: 60,
          passives: 25,
          detractors: 15,
          responseCount: 200,
        },
        churn: {
          monthlyRate: 3,
          annualRate: 30,
          avgLifetimeMonths: 24,
          cohortRetention: {},
        },
      }

      const comparison = await $.foundation().metrics().compare(target)

      expect(Array.isArray(comparison)).toBe(true)
      comparison.forEach((item) => {
        expect(item.metric).toBeDefined()
        expect(typeof item.current).toBe('number')
        expect(typeof item.target).toBe('number')
        expect(typeof item.gap).toBe('number')
        expect(typeof item.onTrack).toBe('boolean')
      })
    })

    it('should identify which metrics are on/off track', async () => {
      const $ = createTestContext()

      const target: Partial<HUNCHMetrics> = {
        nps: {
          score: 50,
          promoters: 60,
          passives: 25,
          detractors: 15,
          responseCount: 200,
        },
      }

      const comparison = await $.foundation().metrics().compare(target)

      const npsComparison = comparison.find((c) => c.metric === 'nps.score')
      expect(npsComparison).toBeDefined()
      expect(npsComparison!.onTrack).toBe(npsComparison!.current >= npsComparison!.target)
    })
  })
})

// ============================================================================
// 6. INTEGRATION TESTS - Complete Workflows
// ============================================================================

describe('Foundation Sprint Complete Workflow', () => {
  it('should support complete foundation sprint flow', async () => {
    const $ = createTestContext()

    // 1. Create hypothesis
    const hypothesis = await $.foundation()
      .hypothesis({ name: 'MyStartup' })
      .customer({
        id: 'target-customer',
        name: 'Target Customer',
        description: 'Our ideal customer',
        painPoints: ['Problem A', 'Problem B'],
        goals: ['Goal 1', 'Goal 2'],
      })
      .problem({
        summary: 'Big problem',
        description: 'Detailed problem description',
        currentSolutions: ['Solution A'],
        gaps: ['Gap 1'],
        painLevel: 9,
        frequency: 'daily',
        hairOnFire: true,
      })
      .differentiation({
        positioning: 'The best solution',
        uniqueValue: 'What makes us unique',
        competitors: [],
        unfairAdvantages: ['Advantage 1'],
        teamFit: 'Perfect team',
      })
      .save()

    expect(hypothesis.id).toBeDefined()

    // 2. Schedule interviews
    const interview = await $.foundation()
      .interview('customer-1')
      .generateQuestions()
      .then((b) => b.schedule(new Date()))

    expect(interview.status).toBe('scheduled')

    // 3. Run analysis
    const analysis = await $.foundation()
      .analyze()
      .discoverCompetitors()
      .then((b) => b.run())

    expect(analysis.competitors.length).toBeGreaterThan(0)

    // 4. Establish metrics baseline
    const metrics = await $.foundation().metrics().baseline({
      hairOnFire: {
        urgencyScore: 80,
        painLevel: 9,
        activelySearching: true,
      },
    })

    expect(metrics.hairOnFire.urgencyScore).toBe(80)

    // 5. Validate
    const validation = await $.foundation()
      .validate()
      .minConfidence(60)
      .requireInterviews(1)
      .requireMetrics()
      .run()

    expect(validation.hypothesisId).toBeDefined()
    expect(validation.breakdown).toBeDefined()
  })

  it('should emit events during foundation sprint', async () => {
    const $ = createTestContext()

    // Event handlers would be registered via $.on
    const events: string[] = []

    // Hypothesis creation should emit 'Hypothesis.created'
    // Interview completion should emit 'Interview.completed'
    // Validation pass should emit 'Hypothesis.validated'
    // Metrics baseline should emit 'Metrics.baselined'

    // This tests integration with $.on event system
    // $.on.Hypothesis.created((event) => events.push('created'))
    // $.on.Hypothesis.validated((event) => events.push('validated'))

    // After full flow, events array should contain expected events
    expect(events).toBeDefined() // Placeholder until integration
  })
})

// ============================================================================
// 7. TYPE SAFETY TESTS
// ============================================================================

describe('Foundation Sprint Type Safety', () => {
  it('should have typed CustomerPersona', () => {
    const persona: CustomerPersona = {
      id: 'test',
      name: 'Test',
      description: 'Test persona',
      painPoints: ['pain'],
      goals: ['goal'],
    }

    expect(persona.id).toBe('test')
  })

  it('should have typed ProblemStatement', () => {
    const problem: ProblemStatement = {
      summary: 'Summary',
      description: 'Description',
      currentSolutions: [],
      gaps: [],
      painLevel: 5,
      frequency: 'weekly',
      hairOnFire: false,
    }

    expect(problem.frequency).toBe('weekly')
  })

  it('should have typed HUNCHMetrics', () => {
    const metrics: Partial<HUNCHMetrics> = {
      hairOnFire: {
        urgencyScore: 80,
        painLevel: 8,
        activelySearching: true,
      },
      nps: {
        score: 45,
        promoters: 55,
        passives: 30,
        detractors: 15,
        responseCount: 100,
      },
    }

    expect(metrics.hairOnFire?.urgencyScore).toBe(80)
    expect(metrics.nps?.score).toBe(45)
  })

  it('should enforce required fields in FoundingHypothesis', () => {
    // This is a compile-time check - if it compiles, types are correct
    const hypothesis: FoundingHypothesis = {
      id: 'hyp-1',
      name: 'Test',
      customers: [],
      problem: {
        summary: 'S',
        description: 'D',
        currentSolutions: [],
        gaps: [],
        painLevel: 5,
        frequency: 'monthly',
        hairOnFire: false,
      },
      differentiation: {
        positioning: 'P',
        uniqueValue: 'U',
        competitors: [],
        unfairAdvantages: [],
        teamFit: 'T',
      },
      status: 'draft',
      confidence: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    }

    expect(hypothesis.status).toBe('draft')
  })
})

// ============================================================================
// 8. ZOD SCHEMA TESTS
// ============================================================================

describe('Foundation Sprint Zod Schemas', () => {
  // Define schemas that should be exported
  const CustomerPersonaSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    role: z.string().optional(),
    industry: z.string().optional(),
    companySize: z.enum(['solo', 'startup', 'smb', 'enterprise']).optional(),
    painPoints: z.array(z.string()).min(1),
    goals: z.array(z.string()).min(1),
    channels: z.array(z.string()).optional(),
  })

  const ProblemStatementSchema = z.object({
    summary: z.string().min(1),
    description: z.string().min(1),
    currentSolutions: z.array(z.string()),
    gaps: z.array(z.string()),
    painLevel: z.number().min(1).max(10),
    frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'rarely']),
    hairOnFire: z.boolean(),
  })

  const HUNCHMetricsSchema = z.object({
    hairOnFire: z.object({
      urgencyScore: z.number().min(0).max(100),
      painLevel: z.number().min(1).max(10),
      activelySearching: z.boolean(),
    }),
    usage: z.object({
      dauMau: z.number().min(0).max(1),
      avgSessionDuration: z.number().min(0),
      sessionsPerWeek: z.number().min(0),
      featureAdoption: z.record(z.string(), z.number()),
    }),
    nps: z.object({
      score: z.number().min(-100).max(100),
      promoters: z.number().min(0).max(100),
      passives: z.number().min(0).max(100),
      detractors: z.number().min(0).max(100),
      responseCount: z.number().min(0),
    }),
    churn: z.object({
      monthlyRate: z.number().min(0).max(100),
      annualRate: z.number().min(0).max(100),
      avgLifetimeMonths: z.number().min(0),
      cohortRetention: z.record(z.string(), z.number()),
    }),
    ltvCac: z.object({
      ltv: z.number().min(0),
      cac: z.number().min(0),
      ratio: z.number().min(0),
      paybackMonths: z.number().min(0),
    }),
  })

  it('should validate CustomerPersona', () => {
    const valid = CustomerPersonaSchema.safeParse({
      id: 'solo-founder',
      name: 'Solo Founder',
      description: 'Building alone',
      painPoints: ['No time'],
      goals: ['Ship fast'],
    })

    expect(valid.success).toBe(true)
  })

  it('should reject invalid CustomerPersona', () => {
    const invalid = CustomerPersonaSchema.safeParse({
      id: 'test',
      name: 'Test',
      description: 'Test',
      painPoints: [], // Empty - should fail
      goals: ['Goal'],
    })

    expect(invalid.success).toBe(false)
  })

  it('should validate ProblemStatement', () => {
    const valid = ProblemStatementSchema.safeParse({
      summary: 'Problem',
      description: 'Details',
      currentSolutions: [],
      gaps: [],
      painLevel: 8,
      frequency: 'daily',
      hairOnFire: true,
    })

    expect(valid.success).toBe(true)
  })

  it('should reject invalid pain level', () => {
    const invalid = ProblemStatementSchema.safeParse({
      summary: 'Problem',
      description: 'Details',
      currentSolutions: [],
      gaps: [],
      painLevel: 15, // Invalid - must be 1-10
      frequency: 'daily',
      hairOnFire: true,
    })

    expect(invalid.success).toBe(false)
  })

  it('should validate complete HUNCHMetrics', () => {
    const valid = HUNCHMetricsSchema.safeParse({
      hairOnFire: {
        urgencyScore: 75,
        painLevel: 8,
        activelySearching: true,
      },
      usage: {
        dauMau: 0.4,
        avgSessionDuration: 15,
        sessionsPerWeek: 5,
        featureAdoption: { feature1: 0.8, feature2: 0.5 },
      },
      nps: {
        score: 45,
        promoters: 55,
        passives: 30,
        detractors: 15,
        responseCount: 100,
      },
      churn: {
        monthlyRate: 5,
        annualRate: 45,
        avgLifetimeMonths: 18,
        cohortRetention: { '2024-01': 0.95, '2024-02': 0.90 },
      },
      ltvCac: {
        ltv: 5000,
        cac: 500,
        ratio: 10,
        paybackMonths: 3,
      },
    })

    expect(valid.success).toBe(true)
  })

  it('should reject NPS score out of range', () => {
    const invalid = HUNCHMetricsSchema.safeParse({
      hairOnFire: { urgencyScore: 75, painLevel: 8, activelySearching: true },
      usage: { dauMau: 0.4, avgSessionDuration: 15, sessionsPerWeek: 5, featureAdoption: {} },
      nps: {
        score: 150, // Invalid - must be -100 to 100
        promoters: 55,
        passives: 30,
        detractors: 15,
        responseCount: 100,
      },
      churn: { monthlyRate: 5, annualRate: 45, avgLifetimeMonths: 18, cohortRetention: {} },
      ltvCac: { ltv: 5000, cac: 500, ratio: 10, paybackMonths: 3 },
    })

    expect(invalid.success).toBe(false)
  })
})

// ============================================================================
// 9. ERROR HANDLING TESTS
// ============================================================================

describe('Foundation Sprint Error Handling', () => {
  it('should throw when hypothesis not found', async () => {
    const $ = createTestContext()

    await expect($.foundation().get('non-existent')).rejects.toThrow('Hypothesis not found')
  })

  it('should throw when validating without hypothesis', async () => {
    const $ = createTestContext()

    await expect($.foundation().validate().run()).rejects.toThrow('No active hypothesis')
  })

  it('should throw when interview customer not found', async () => {
    const $ = createTestContext()

    await expect(
      $.foundation().interview('non-existent-customer').start()
    ).rejects.toThrow('Customer not found')
  })
})
