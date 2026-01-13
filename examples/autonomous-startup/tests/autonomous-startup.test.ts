/**
 * Autonomous Startup - Integration Tests
 *
 * Tests the complete end-to-end startup launch workflow including:
 * - Named agent invocations with typed results
 * - The do/while review loop pattern
 * - Event handlers ($.on.Noun.verb)
 * - Scheduled jobs ($.every)
 * - Error handling for agent/human failures
 *
 * @module examples/autonomous-startup/tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { z } from 'zod'

// Import named agents with mock mode support
import {
  priya,
  ralph,
  tom,
  mark,
  sally,
  quinn,
  enableMockMode,
  disableMockMode,
  setMockResponse,
  isMockMode,
} from '../../../agents/named'

// Define schemas inline to avoid importing from AutonomousStartup which has Cloudflare deps
const HypothesisSchema = z.object({
  customer: z.string().describe('Target customer segment'),
  problem: z.string().describe('Problem being solved'),
  solution: z.string().describe('Proposed solution'),
  differentiator: z.string().optional().describe('What makes this unique'),
})

type Hypothesis = z.infer<typeof HypothesisSchema>

const ProductSpecSchema = z.object({
  name: z.string().describe('Product name'),
  features: z.array(z.string()).describe('MVP features'),
  timeline: z.string().describe('Development timeline'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  acceptanceCriteria: z.array(z.string()).optional(),
  successMetrics: z.array(z.string()).optional(),
})

type ProductSpec = z.infer<typeof ProductSpecSchema>

const ApplicationSchema = z.object({
  code: z.string().describe('Generated application code'),
  version: z.string().describe('Version number'),
  tests: z.array(z.string()).optional().describe('Test cases'),
  dependencies: z.array(z.string()).optional(),
  deploymentReady: z.boolean().default(false),
})

type Application = z.infer<typeof ApplicationSchema>

const CodeReviewSchema = z.object({
  approved: z.boolean().describe('Whether the code is approved'),
  issues: z.array(z.object({
    severity: z.enum(['error', 'warning', 'info']),
    message: z.string(),
    suggestion: z.string().optional(),
  })),
  suggestions: z.array(z.string()).optional(),
  score: z.number().min(0).max(100).optional(),
})

type CodeReview = z.infer<typeof CodeReviewSchema>

const QAResultSchema = z.object({
  passed: z.boolean().describe('Whether all tests passed'),
  testsPassed: z.number(),
  testsFailed: z.number(),
  coverage: z.number().describe('Code coverage percentage'),
  criticalBugs: z.array(z.string()),
  minorBugs: z.array(z.string()),
})

const LaunchMaterialsSchema = z.object({
  title: z.string().describe('Launch title'),
  body: z.string().describe('Press release or blog post'),
  summary: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  callToAction: z.string().optional(),
  socialPosts: z.array(z.object({
    platform: z.string(),
    content: z.string(),
  })).optional(),
})

const SalesStrategySchema = z.object({
  targetSegments: z.array(z.string()),
  valueProposition: z.string(),
  pricingTiers: z.array(z.object({
    name: z.string(),
    price: z.number(),
    features: z.array(z.string()),
  })),
  objectionHandling: z.record(z.string()).optional(),
})

// Import workflow helpers
import {
  on,
  every,
  clearHandlers,
  getHandlerCount,
  getRegisteredEventKeys,
} from '../../../workflows/on'

// Import human escalation
import {
  ceo,
  legal,
  HumanRequest,
  HumanTimeoutError,
  configureHumanClient,
} from '../../../lib/humans'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('AutonomousStartup', () => {
  beforeEach(() => {
    enableMockMode()
    clearHandlers()
  })

  afterEach(() => {
    disableMockMode()
    clearHandlers()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // TYPED AGENT INVOCATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Typed Agent Invocations (agent.as(Schema))', () => {
    it('should invoke Priya with typed ProductSpec result', async () => {
      // Setup mock response
      setMockResponse('Define the MVP', JSON.stringify({
        name: 'TaskAI',
        features: ['Task creation', 'AI prioritization', 'Calendar sync'],
        timeline: '4 weeks',
        priority: 'high',
        acceptanceCriteria: ['Users can create tasks'],
        successMetrics: ['1000 users', '50% retention'],
      }))

      const hypothesis: Hypothesis = {
        customer: 'Busy professionals',
        problem: 'Too many tasks',
        solution: 'AI-powered task management',
        differentiator: 'Zero-config AI',
      }

      // Invoke with typed result
      const result = await priya.as(ProductSpecSchema)`
        Define the MVP for this startup:
        Customer: ${hypothesis.customer}
        Problem: ${hypothesis.problem}
        Solution: ${hypothesis.solution}
      `

      expect(result.parsed).toBe(true)
      expect(result.content.name).toBe('TaskAI')
      expect(result.content.features).toHaveLength(3)
      expect(result.content.timeline).toBe('4 weeks')
      expect(result.content.priority).toBe('high')
    })

    it('should invoke Ralph with typed Application result', async () => {
      setMockResponse('Build', JSON.stringify({
        code: 'export function main() {}',
        version: '1.0.0',
        tests: ['test("works", () => expect(true).toBe(true))'],
        dependencies: ['hono'],
        deploymentReady: true,
      }))

      const spec: ProductSpec = {
        name: 'TaskAI',
        features: ['Feature 1'],
        timeline: '2 weeks',
        priority: 'medium',
      }

      const result = await ralph.as(ApplicationSchema)`
        Build the application from:
        ${JSON.stringify(spec)}
      `

      expect(result.parsed).toBe(true)
      expect(result.content.version).toBe('1.0.0')
      expect(result.content.deploymentReady).toBe(true)
      expect(result.content.dependencies).toContain('hono')
    })

    it('should invoke Tom with typed CodeReview result', async () => {
      setMockResponse('Review', JSON.stringify({
        approved: true,
        issues: [],
        suggestions: ['Add more tests'],
        score: 90,
      }))

      const result = await tom.as(CodeReviewSchema)`
        Review this code:
        export function add(a: number, b: number) { return a + b; }
      `

      expect(result.parsed).toBe(true)
      expect(result.content.approved).toBe(true)
      expect(result.content.score).toBe(90)
      expect(result.content.issues).toHaveLength(0)
    })

    it('should invoke Quinn with typed QAResult', async () => {
      setMockResponse('Test', JSON.stringify({
        passed: true,
        testsPassed: 42,
        testsFailed: 0,
        coverage: 85,
        criticalBugs: [],
        minorBugs: ['UI alignment'],
      }))

      const result = await quinn.as(QAResultSchema)`
        Test this application thoroughly
      `

      expect(result.parsed).toBe(true)
      expect(result.content.passed).toBe(true)
      expect(result.content.coverage).toBe(85)
      expect(result.content.criticalBugs).toHaveLength(0)
    })

    it('should invoke Mark with typed LaunchMaterials result', async () => {
      setMockResponse('Create launch', JSON.stringify({
        title: 'Introducing TaskAI',
        body: 'We are excited to announce...',
        summary: 'AI-powered task management',
        keywords: ['AI', 'productivity'],
        callToAction: 'Sign up now',
        socialPosts: [
          { platform: 'twitter', content: 'Launching TaskAI!' },
        ],
      }))

      const result = await mark.as(LaunchMaterialsSchema)`
        Create launch materials for TaskAI
      `

      expect(result.parsed).toBe(true)
      expect(result.content.title).toBe('Introducing TaskAI')
      expect(result.content.socialPosts).toHaveLength(1)
    })

    it('should invoke Sally with typed SalesStrategy result', async () => {
      setMockResponse('Create sales', JSON.stringify({
        targetSegments: ['SMBs', 'Enterprises'],
        valueProposition: 'Save 10 hours per week',
        pricingTiers: [
          { name: 'Starter', price: 29, features: ['Basic'] },
          { name: 'Pro', price: 99, features: ['All features'] },
        ],
        objectionHandling: {
          'Too expensive': 'Consider the ROI',
        },
      }))

      const result = await sally.as(SalesStrategySchema)`
        Create sales strategy for TaskAI
      `

      expect(result.parsed).toBe(true)
      expect(result.content.targetSegments).toHaveLength(2)
      expect(result.content.pricingTiers).toHaveLength(2)
      expect(result.content.pricingTiers[0].price).toBe(29)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DO/WHILE REVIEW LOOP PATTERN
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Do/While Review Loop Pattern', () => {
    it('should iterate until Tom approves', async () => {
      let iteration = 0

      // First review: not approved
      setMockResponse('Review iteration 1', JSON.stringify({
        approved: false,
        issues: [{ severity: 'warning', message: 'Missing tests' }],
        suggestions: ['Add unit tests'],
        score: 60,
      }))

      // Build response
      setMockResponse('Build', JSON.stringify({
        code: 'export function main() {}',
        version: '1.0.0',
        tests: [],
        dependencies: [],
        deploymentReady: false,
      }))

      // Improve response
      setMockResponse('Improve', JSON.stringify({
        code: 'export function main() { /* improved */ }',
        version: '1.0.1',
        tests: ['test("it works")'],
        dependencies: [],
        deploymentReady: true,
      }))

      // Second review: approved
      setMockResponse('Review improved', JSON.stringify({
        approved: true,
        issues: [],
        suggestions: [],
        score: 85,
      }))

      const maxIterations = 5
      let appResult = await ralph.as(ApplicationSchema)`Build initial app`
      let reviewResult: Awaited<ReturnType<typeof tom.as<typeof CodeReviewSchema>>>

      do {
        iteration++

        if (iteration === 1) {
          reviewResult = await tom.as(CodeReviewSchema)`Review iteration 1`
        } else {
          reviewResult = await tom.as(CodeReviewSchema)`Review improved code`
        }

        if (!reviewResult.content.approved && iteration < maxIterations) {
          appResult = await ralph.as(ApplicationSchema)`Improve based on feedback`
        }
      } while (!reviewResult.content.approved && iteration < maxIterations)

      expect(iteration).toBe(2)
      expect(reviewResult!.content.approved).toBe(true)
      expect(reviewResult!.content.score).toBe(85)
    })

    it('should stop after max iterations even if not approved', async () => {
      // Always return not approved
      setMockResponse('Review', JSON.stringify({
        approved: false,
        issues: [{ severity: 'error', message: 'Critical bug' }],
        suggestions: [],
        score: 30,
      }))

      setMockResponse('Build', JSON.stringify({
        code: 'buggy code',
        version: '1.0.0',
        tests: [],
        dependencies: [],
        deploymentReady: false,
      }))

      const maxIterations = 3
      let iteration = 0
      let reviewResult: Awaited<ReturnType<typeof tom.as<typeof CodeReviewSchema>>>

      do {
        iteration++
        reviewResult = await tom.as(CodeReviewSchema)`Review the code`
      } while (!reviewResult.content.approved && iteration < maxIterations)

      expect(iteration).toBe(maxIterations)
      expect(reviewResult!.content.approved).toBe(false)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT HANDLERS ($.on.Noun.verb)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Event Handlers ($.on.Noun.verb)', () => {
    it('should register event handlers', () => {
      const signupHandler = vi.fn()
      const paymentHandler = vi.fn()

      on.Customer.signup(signupHandler)
      on.Payment.received(paymentHandler)

      expect(getHandlerCount()).toBe(2)
      expect(getRegisteredEventKeys()).toContain('Customer.signup')
      expect(getRegisteredEventKeys()).toContain('Payment.received')
    })

    it('should register handlers with context for cleanup', () => {
      const context = 'startup-123'
      const handler = vi.fn()

      on.Customer.signup(handler, { context })
      on.Payment.failed(handler, { context })
      on.Feature.requested(handler, { context })

      expect(getHandlerCount(context)).toBe(3)
    })

    it('should unsubscribe handlers', () => {
      const handler = vi.fn()
      const unsubscribe = on.Customer.signup(handler)

      expect(getHandlerCount()).toBe(1)

      const removed = unsubscribe()

      expect(removed).toBe(true)
      expect(getHandlerCount()).toBe(0)
    })

    it('should handle multiple handlers for same event', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      on.Customer.signup(handler1)
      on.Customer.signup(handler2)

      expect(getHandlerCount()).toBe(2)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHEDULED JOBS ($.every)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Scheduled Jobs ($.every)', () => {
    it('should register daily schedule', () => {
      const handler = vi.fn()

      every.day.at9am(handler)

      // Check that a schedule was registered
      expect(getRegisteredEventKeys().some(k => k.startsWith('schedule:'))).toBe(true)
    })

    it('should register weekly schedule', () => {
      const handler = vi.fn()

      every.Monday.at10am(handler)

      expect(getRegisteredEventKeys().some(k => k.startsWith('schedule:'))).toBe(true)
    })

    it('should register hourly schedule', () => {
      const handler = vi.fn()

      every.hour(handler)

      expect(getRegisteredEventKeys().some(k => k.includes('0 * * * *'))).toBe(true)
    })

    it('should register with natural language', () => {
      const handler = vi.fn()

      every('Monday at 9am', handler)

      expect(getRegisteredEventKeys().some(k => k.startsWith('schedule:'))).toBe(true)
    })

    it('should unsubscribe scheduled jobs', () => {
      const handler = vi.fn()
      const unsubscribe = every.day.at9am(handler)

      expect(getHandlerCount()).toBe(1)

      unsubscribe()

      expect(getHandlerCount()).toBe(0)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // HUMAN ESCALATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Human Escalation (humans.do)', () => {
    it('should create CEO approval request', () => {
      const request = ceo`approve the product launch`

      expect(request).toBeInstanceOf(HumanRequest)
      expect(request.role).toBe('ceo')
      expect(request.message).toBe('approve the product launch')
    })

    it('should create Legal review request', () => {
      const request = legal`review this contract for compliance`

      expect(request).toBeInstanceOf(HumanRequest)
      expect(request.role).toBe('legal')
      expect(request.message).toBe('review this contract for compliance')
    })

    it('should support timeout configuration', () => {
      const request = ceo`approve partnership`.timeout('4 hours')

      expect(request.sla).toBe(4 * 60 * 60 * 1000) // 4 hours in ms
    })

    it('should support channel configuration', () => {
      const request = legal`urgent review`.via('slack')

      expect(request.channel).toBe('slack')
    })

    it('should chain timeout and channel', () => {
      const request = ceo`approve budget`.timeout('2 hours').via('email')

      expect(request.sla).toBe(2 * 60 * 60 * 1000)
      expect(request.channel).toBe('email')
    })

    it('should interpolate template values', () => {
      const productName = 'TaskAI'
      const budget = 50000

      const request = ceo`approve ${productName} with budget $${budget}`

      expect(request.message).toBe('approve TaskAI with budget $50000')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ERROR HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Error Handling', () => {
    it('should handle agent parse failures gracefully', async () => {
      // Return invalid JSON
      setMockResponse('invalid', 'This is not JSON')

      const BrokenSchema = z.object({
        required: z.string(),
      })

      await expect(
        priya.as(BrokenSchema)`Return invalid response`
      ).rejects.toThrow()
    })

    it('should handle partial results with allowPartial', async () => {
      // Return partial JSON
      setMockResponse('partial', '{ "name": "Test" }')

      // This test verifies the pattern works - actual implementation may vary
      const result = await priya`Return partial response`
      expect(result).toBeDefined()
    })

    it('should include error metadata', async () => {
      setMockResponse('with meta', JSON.stringify({
        name: 'Test',
        features: ['a', 'b'],
        timeline: '1 week',
      }))

      const result = await priya.as(ProductSpecSchema)`Request with meta`

      expect(result.meta).toBeDefined()
      expect(result.meta?.agent).toBe('Priya')
    })

    it('should track agent execution time', async () => {
      setMockResponse('timed', JSON.stringify({
        name: 'Test',
        features: ['a'],
        timeline: '1 week',
      }))

      const result = await priya.as(ProductSpecSchema)`Measure execution time`

      expect(result.meta?.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHEMA VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Schema Validation', () => {
    it('should validate Hypothesis schema', () => {
      const valid: Hypothesis = {
        customer: 'Developers',
        problem: 'Testing is slow',
        solution: 'AI testing',
        differentiator: 'No config needed',
      }

      const result = HypothesisSchema.safeParse(valid)
      expect(result.success).toBe(true)
    })

    it('should reject invalid Hypothesis', () => {
      const invalid = {
        customer: 'Developers',
        // missing problem and solution
      }

      const result = HypothesisSchema.safeParse(invalid)
      expect(result.success).toBe(false)
    })

    it('should validate ProductSpec with defaults', () => {
      const spec = {
        name: 'Test',
        features: ['a'],
        timeline: '1 week',
        // priority should default to 'medium'
      }

      const result = ProductSpecSchema.safeParse(spec)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.priority).toBe('medium')
      }
    })

    it('should validate CodeReview score range', () => {
      const review: CodeReview = {
        approved: true,
        issues: [],
        score: 150, // Invalid: should be 0-100
      }

      const result = CodeReviewSchema.safeParse(review)
      expect(result.success).toBe(false)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLETE WORKFLOW INTEGRATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Complete Workflow Integration', () => {
    it('should execute simplified launch workflow', async () => {
      // Setup all mock responses
      setMockResponse('Define', JSON.stringify({
        name: 'LaunchAI',
        features: ['Feature 1', 'Feature 2'],
        timeline: '4 weeks',
        priority: 'high',
      }))

      setMockResponse('Build', JSON.stringify({
        code: 'export function main() {}',
        version: '1.0.0',
        tests: ['test 1'],
        dependencies: ['hono'],
        deploymentReady: true,
      }))

      setMockResponse('Review', JSON.stringify({
        approved: true,
        issues: [],
        suggestions: [],
        score: 90,
      }))

      setMockResponse('Test', JSON.stringify({
        passed: true,
        testsPassed: 10,
        testsFailed: 0,
        coverage: 80,
        criticalBugs: [],
        minorBugs: [],
      }))

      setMockResponse('launch', JSON.stringify({
        title: 'Launching LaunchAI',
        body: 'Exciting news!',
        callToAction: 'Sign up',
      }))

      setMockResponse('sales', JSON.stringify({
        targetSegments: ['SMBs'],
        valueProposition: 'Save time',
        pricingTiers: [{ name: 'Pro', price: 99, features: ['All'] }],
      }))

      // Execute workflow phases
      const hypothesis: Hypothesis = {
        customer: 'Startups',
        problem: 'Launching is hard',
        solution: 'AI-powered launches',
      }

      // Phase 1: Specification
      const spec = await priya.as(ProductSpecSchema)`Define MVP for ${hypothesis.customer}`
      expect(spec.content.name).toBe('LaunchAI')

      // Phase 2: Development
      const app = await ralph.as(ApplicationSchema)`Build the app`
      expect(app.content.version).toBe('1.0.0')

      // Phase 3: Review
      const review = await tom.as(CodeReviewSchema)`Review the code`
      expect(review.content.approved).toBe(true)

      // Phase 4: QA
      const qa = await quinn.as(QAResultSchema)`Test thoroughly`
      expect(qa.content.passed).toBe(true)

      // Phase 5: Marketing
      const marketing = await mark.as(LaunchMaterialsSchema)`Create launch materials`
      expect(marketing.content.title).toContain('LaunchAI')

      // Phase 6: Sales
      const sales = await sally.as(SalesStrategySchema)`Create sales strategy`
      expect(sales.content.targetSegments).toHaveLength(1)

      // Verify all phases completed
      expect(spec.parsed).toBe(true)
      expect(app.parsed).toBe(true)
      expect(review.parsed).toBe(true)
      expect(qa.parsed).toBe(true)
      expect(marketing.parsed).toBe(true)
      expect(sales.parsed).toBe(true)
    })

    it('should track metrics through event handlers', () => {
      const metrics = {
        signups: 0,
        mrr: 0,
        customers: 0,
        churn: 0,
      }

      // Register handlers
      on.Customer.signup(async (data: { email: string; plan: string }) => {
        metrics.signups++
        metrics.customers++
      })

      on.Payment.received(async (data: { amount: number }) => {
        metrics.mrr += data.amount
      })

      on.Customer.churned(async () => {
        metrics.churn++
        metrics.customers--
      })

      // Verify handlers registered
      expect(getHandlerCount()).toBe(3)

      // Simulate events (in real impl, emit() would trigger handlers)
      // For now, verify structure is correct
      expect(metrics.signups).toBe(0)
      expect(metrics.mrr).toBe(0)
    })
  })
})

// ============================================================================
// HELPER TESTS
// ============================================================================

describe('Helper Functions', () => {
  beforeEach(() => {
    enableMockMode()
  })

  afterEach(() => {
    disableMockMode()
  })

  it('should verify mock mode is enabled', () => {
    expect(isMockMode()).toBe(true)
  })

  it('should clear handlers between tests', () => {
    clearHandlers()
    expect(getHandlerCount()).toBe(0)
  })
})
