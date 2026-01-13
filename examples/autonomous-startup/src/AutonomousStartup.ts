/**
 * AutonomousStartup - Complete End-to-End Startup Example
 *
 * Demonstrates the complete autonomous startup lifecycle from CLAUDE.md:
 * - Spec definition with Priya
 * - Building with Ralph
 * - Code review loop with Tom
 * - Human escalation for legal/CEO approval
 * - Marketing announcement with Mark
 * - Sales with Sally
 *
 * Uses:
 * - Named agents from agents.do (priya, ralph, tom, mark, sally, quinn)
 * - Typed agent results via agent.as(Schema)
 * - Awaitable human approval from humans.do
 * - Event handlers via $.on.Noun.verb pattern
 * - Scheduling via $.every pattern
 *
 * @see https://platform.do
 * @module examples/autonomous-startup
 */

import { z } from 'zod'
import { Startup } from '../../../objects/Startup'
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
  SpecSchema,
  ReviewSchema,
  ContentSchema,
  type AgentResult,
} from '../../../agents/named'
import {
  ceo,
  legal,
  HumanTimeoutError,
  configureHumanClient,
} from '../../../lib/humans'
import { on, every, clearHandlers } from '../../../workflows/on'
import type { Env } from '../../../objects/DO'

// ============================================================================
// TYPED SCHEMAS FOR AGENT OUTPUTS
// ============================================================================

/**
 * Hypothesis - The foundation of every startup
 */
export const HypothesisSchema = z.object({
  customer: z.string().describe('Target customer segment'),
  problem: z.string().describe('Problem being solved'),
  solution: z.string().describe('Proposed solution'),
  differentiator: z.string().optional().describe('What makes this unique'),
})

export type Hypothesis = z.infer<typeof HypothesisSchema>

/**
 * Product specification from Priya
 */
export const ProductSpecSchema = z.object({
  name: z.string().describe('Product name'),
  features: z.array(z.string()).describe('MVP features'),
  timeline: z.string().describe('Development timeline'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  acceptanceCriteria: z.array(z.string()).optional(),
  successMetrics: z.array(z.string()).optional(),
})

export type ProductSpec = z.infer<typeof ProductSpecSchema>

/**
 * Application build result from Ralph
 */
export const ApplicationSchema = z.object({
  code: z.string().describe('Generated application code'),
  version: z.string().describe('Version number'),
  tests: z.array(z.string()).optional().describe('Test cases'),
  dependencies: z.array(z.string()).optional(),
  deploymentReady: z.boolean().default(false),
})

export type Application = z.infer<typeof ApplicationSchema>

/**
 * Code review from Tom
 */
export const CodeReviewSchema = z.object({
  approved: z.boolean().describe('Whether the code is approved'),
  issues: z.array(z.object({
    severity: z.enum(['error', 'warning', 'info']),
    message: z.string(),
    suggestion: z.string().optional(),
  })),
  suggestions: z.array(z.string()).optional(),
  score: z.number().min(0).max(100).optional(),
})

export type CodeReview = z.infer<typeof CodeReviewSchema>

/**
 * QA test results from Quinn
 */
export const QAResultSchema = z.object({
  passed: z.boolean().describe('Whether all tests passed'),
  testsPassed: z.number(),
  testsFailed: z.number(),
  coverage: z.number().describe('Code coverage percentage'),
  criticalBugs: z.array(z.string()),
  minorBugs: z.array(z.string()),
})

export type QAResult = z.infer<typeof QAResultSchema>

/**
 * Launch materials from Mark
 */
export const LaunchMaterialsSchema = z.object({
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

export type LaunchMaterials = z.infer<typeof LaunchMaterialsSchema>

/**
 * Sales strategy from Sally
 */
export const SalesStrategySchema = z.object({
  targetSegments: z.array(z.string()),
  valueProposition: z.string(),
  pricingTiers: z.array(z.object({
    name: z.string(),
    price: z.number(),
    features: z.array(z.string()),
  })),
  objectionHandling: z.record(z.string()).optional(),
})

export type SalesStrategy = z.infer<typeof SalesStrategySchema>

// ============================================================================
// STARTUP STATE
// ============================================================================

export type LaunchPhase =
  | 'hypothesis'
  | 'specification'
  | 'development'
  | 'review'
  | 'qa'
  | 'legal-review'
  | 'ceo-approval'
  | 'marketing'
  | 'sales-prep'
  | 'launched'
  | 'scaling'

export interface StartupState {
  id: string
  phase: LaunchPhase
  hypothesis: Hypothesis
  spec?: ProductSpec
  app?: Application
  review?: CodeReview
  qa?: QAResult
  legalApproved?: boolean
  ceoApproved?: boolean
  launchMaterials?: LaunchMaterials
  salesStrategy?: SalesStrategy
  iterations: number
  maxIterations: number
  events: Array<{ timestamp: string; event: string; data?: unknown }>
  metrics: {
    signups: number
    mrr: number
    customers: number
    churn: number
  }
  errors: Array<{ timestamp: string; phase: LaunchPhase; error: string }>
}

// ============================================================================
// AUTONOMOUS STARTUP CLASS
// ============================================================================

/**
 * AutonomousStartup - A fully autonomous startup that runs itself
 *
 * Implements the complete Business-as-Code pattern from CLAUDE.md:
 * ```typescript
 * export class MyStartup extends Startup {
 *   async launch() {
 *     const spec = priya`define the MVP for ${this.hypothesis}`
 *     let app = ralph`build ${spec}`
 *
 *     do {
 *       app = ralph`improve ${app} per ${tom}`
 *     } while (!await tom.approve(app))
 *
 *     mark`announce the launch`
 *     sally`start selling`
 *   }
 * }
 * ```
 */
export class AutonomousStartup extends Startup {
  static override readonly $type: string = 'AutonomousStartup'

  private launchState: StartupState | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN LAUNCH WORKFLOW
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Launch a startup from hypothesis to revenue
   *
   * This is the main orchestration method that demonstrates:
   * 1. Typed agent invocations with agent.as(Schema)
   * 2. The do/while loop for iterative refinement
   * 3. Human escalation for critical approvals
   * 4. Event handlers and scheduling
   *
   * @param hypothesis - The startup hypothesis
   * @param options - Launch configuration options
   */
  async launch(
    hypothesis: Hypothesis,
    options: {
      maxIterations?: number
      skipHumanApproval?: boolean
      mockMode?: boolean
    } = {}
  ): Promise<StartupState> {
    const { maxIterations = 5, skipHumanApproval = false, mockMode = false } = options

    // Enable mock mode for testing
    if (mockMode) {
      enableMockMode()
      this.setupMockResponses(hypothesis)
    }

    try {
      // Initialize state
      this.launchState = {
        id: crypto.randomUUID(),
        phase: 'hypothesis',
        hypothesis,
        iterations: 0,
        maxIterations,
        events: [],
        metrics: { signups: 0, mrr: 0, customers: 0, churn: 0 },
        errors: [],
      }

      this.logEvent('launch.started', { hypothesis })

      // ─────────────────────────────────────────────────────────────────────────
      // Phase 1: Product Specification (Priya)
      // Uses typed agent result: priya.as(ProductSpecSchema)
      // ─────────────────────────────────────────────────────────────────────────
      this.launchState.phase = 'specification'
      this.logEvent('phase.specification.started')

      try {
        const specResult = await priya.as(ProductSpecSchema)`
          Define the MVP for this startup:
          Customer: ${hypothesis.customer}
          Problem: ${hypothesis.problem}
          Solution: ${hypothesis.solution}
          Differentiator: ${hypothesis.differentiator || 'Not specified'}

          Provide: product name, MVP features (max 5), timeline, priority, and success metrics.
        `

        this.launchState.spec = specResult.content
        this.logEvent('phase.specification.completed', {
          spec: this.launchState.spec,
          parsed: specResult.parsed,
        })
      } catch (error) {
        this.handleError('specification', error)
        throw error
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Phase 2: Development with Review Loop (Ralph + Tom)
      // Demonstrates the do/while pattern from CLAUDE.md
      // ─────────────────────────────────────────────────────────────────────────
      this.launchState.phase = 'development'
      this.logEvent('phase.development.started')

      // Initial build
      let appResult: AgentResult<Application>
      try {
        appResult = await ralph.as(ApplicationSchema)`
          Build the application from this specification:
          ${JSON.stringify(this.launchState.spec, null, 2)}

          Include: code, version number, tests, dependencies.
        `
        this.launchState.app = appResult.content
        this.logEvent('phase.development.initial-build', { version: appResult.content.version })
      } catch (error) {
        this.handleError('development', error)
        throw error
      }

      // The do/while loop: iterate until Tom approves
      let reviewResult: AgentResult<CodeReview>
      do {
        this.launchState.iterations++
        this.logEvent('development.iteration', { iteration: this.launchState.iterations })

        // Tom reviews
        this.launchState.phase = 'review'
        try {
          reviewResult = await tom.as(CodeReviewSchema)`
            Review this application code:
            ${appResult.content.code}

            Check for: code quality, security, performance, architecture.
            Respond with: approved (boolean), issues list, suggestions, and score (0-100).
          `

          this.launchState.review = reviewResult.content
          this.logEvent('phase.review.completed', {
            approved: reviewResult.content.approved,
            score: reviewResult.content.score,
            issueCount: reviewResult.content.issues.length,
          })
        } catch (error) {
          this.handleError('review', error)
          throw error
        }

        if (!reviewResult.content.approved && this.launchState.iterations < maxIterations) {
          this.logEvent('review.changes-requested', { issues: reviewResult.content.issues })

          // Ralph improves based on Tom's feedback
          this.launchState.phase = 'development'
          try {
            appResult = await ralph.as(ApplicationSchema)`
              Improve the application based on this review:
              ${JSON.stringify(reviewResult.content, null, 2)}

              Address all issues and incorporate suggestions.
            `
            this.launchState.app = appResult.content
          } catch (error) {
            this.handleError('development', error)
            throw error
          }
        }
      } while (!reviewResult.content.approved && this.launchState.iterations < maxIterations)

      this.logEvent('phase.development.completed', {
        iterations: this.launchState.iterations,
        approved: reviewResult.content.approved,
      })

      // ─────────────────────────────────────────────────────────────────────────
      // Phase 3: Quality Assurance (Quinn)
      // ─────────────────────────────────────────────────────────────────────────
      this.launchState.phase = 'qa'
      this.logEvent('phase.qa.started')

      try {
        const qaResult = await quinn.as(QAResultSchema)`
          Test this application thoroughly:
          ${appResult.content.code}

          Run: unit tests, integration tests, edge case tests.
          Report: passed (boolean), tests passed/failed counts, coverage, bugs found.
        `

        this.launchState.qa = qaResult.content
        this.logEvent('phase.qa.completed', {
          passed: qaResult.content.passed,
          coverage: qaResult.content.coverage,
        })

        if (!qaResult.content.passed) {
          this.logEvent('qa.failed', { bugs: qaResult.content.criticalBugs })
          // In a real scenario, we might loop back to development
        }
      } catch (error) {
        this.handleError('qa', error)
        // QA errors are non-fatal for demo purposes
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Phase 4: Human Approvals (Legal + CEO)
      // Demonstrates awaitable human escalation from humans.do
      // ─────────────────────────────────────────────────────────────────────────
      if (!skipHumanApproval) {
        // Legal review
        this.launchState.phase = 'legal-review'
        this.logEvent('phase.legal-review.started')

        try {
          const legalResult = await legal`
            Review this product for compliance:
            ${this.launchState.spec?.name}
            Target: ${hypothesis.customer}
            Solution: ${hypothesis.solution}
          `.timeout('4 hours')

          this.launchState.legalApproved = legalResult.approved
          this.logEvent('phase.legal-review.completed', {
            approved: legalResult.approved,
            reason: legalResult.reason,
          })

          if (!legalResult.approved) {
            throw new Error(`Legal review rejected: ${legalResult.reason}`)
          }
        } catch (error) {
          if (error instanceof HumanTimeoutError) {
            this.handleError('legal-review', error)
            // For demo, continue with auto-approval
            this.launchState.legalApproved = true
            this.logEvent('phase.legal-review.auto-approved', { reason: 'timeout' })
          } else {
            throw error
          }
        }

        // CEO approval
        this.launchState.phase = 'ceo-approval'
        this.logEvent('phase.ceo-approval.started')

        try {
          const ceoResult = await ceo`
            Approve the launch of ${this.launchState.spec?.name}:
            - Target: ${hypothesis.customer}
            - Problem: ${hypothesis.problem}
            - Solution: ${hypothesis.solution}
            - Development iterations: ${this.launchState.iterations}
            - QA passed: ${this.launchState.qa?.passed ?? 'pending'}
          `.timeout('24 hours')

          this.launchState.ceoApproved = ceoResult.approved
          this.logEvent('phase.ceo-approval.completed', {
            approved: ceoResult.approved,
            approver: ceoResult.approver,
          })

          if (!ceoResult.approved) {
            throw new Error(`CEO rejected launch: ${ceoResult.reason}`)
          }
        } catch (error) {
          if (error instanceof HumanTimeoutError) {
            this.handleError('ceo-approval', error)
            // For demo, continue with auto-approval
            this.launchState.ceoApproved = true
            this.logEvent('phase.ceo-approval.auto-approved', { reason: 'timeout' })
          } else {
            throw error
          }
        }
      } else {
        // Skip human approvals in test mode
        this.launchState.legalApproved = true
        this.launchState.ceoApproved = true
        this.logEvent('phase.approvals.skipped', { reason: 'skipHumanApproval option' })
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Phase 5: Marketing Preparation (Mark)
      // ─────────────────────────────────────────────────────────────────────────
      this.launchState.phase = 'marketing'
      this.logEvent('phase.marketing.started')

      try {
        const marketingResult = await mark.as(LaunchMaterialsSchema)`
          Create launch materials for ${this.launchState.spec?.name}:
          Target: ${hypothesis.customer}
          Solution: ${hypothesis.solution}
          Differentiator: ${hypothesis.differentiator || 'Best in class'}

          Include: title, press release body, summary, keywords, call-to-action, social posts.
        `

        this.launchState.launchMaterials = marketingResult.content
        this.logEvent('phase.marketing.completed', {
          title: marketingResult.content.title,
        })
      } catch (error) {
        this.handleError('marketing', error)
        // Marketing errors are non-fatal
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Phase 6: Sales Preparation (Sally)
      // ─────────────────────────────────────────────────────────────────────────
      this.launchState.phase = 'sales-prep'
      this.logEvent('phase.sales-prep.started')

      try {
        const salesResult = await sally.as(SalesStrategySchema)`
          Create sales strategy for ${this.launchState.spec?.name}:
          Target customers: ${hypothesis.customer}
          Solution: ${hypothesis.solution}
          Value prop: ${hypothesis.differentiator || 'Saves time and money'}

          Include: target segments, value proposition, pricing tiers, objection handling.
        `

        this.launchState.salesStrategy = salesResult.content
        this.logEvent('phase.sales-prep.completed', {
          segments: salesResult.content.targetSegments.length,
          tiers: salesResult.content.pricingTiers.length,
        })
      } catch (error) {
        this.handleError('sales-prep', error)
        // Sales errors are non-fatal
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Phase 7: Launch!
      // ─────────────────────────────────────────────────────────────────────────
      this.launchState.phase = 'launched'
      this.logEvent('phase.launched', {
        product: this.launchState.spec?.name,
        timestamp: new Date().toISOString(),
      })

      // Register event handlers for business operations
      this.registerEventHandlers()

      // Schedule recurring jobs
      this.registerScheduledJobs()

      return this.launchState
    } finally {
      if (mockMode) {
        disableMockMode()
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT HANDLERS - $.on.Noun.verb Pattern
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register event handlers for business lifecycle events
   *
   * Demonstrates the $.on.Noun.verb pattern from CLAUDE.md:
   * ```typescript
   * $.on.Customer.signup(handler)
   * $.on.Payment.failed(handler)
   * $.on.*.created(handler)    // Wildcards
   * ```
   */
  private registerEventHandlers(): void {
    const context = this.launchState!.id

    // Handle new customer signups
    on.Customer.signup(async (customer: { email: string; plan: string }) => {
      this.logEvent('Customer.signup', customer)
      this.launchState!.metrics.signups++
      this.launchState!.metrics.customers++

      // Agents respond to events
      this.logEvent('action.triggered', {
        agent: 'mark',
        action: `send welcome email to ${customer.email}`,
      })
      this.logEvent('action.triggered', {
        agent: 'sally',
        action: `schedule onboarding call for ${customer.email}`,
      })
    }, { context })

    // Handle payment received
    on.Payment.received(async (payment: { amount: number; customerId: string }) => {
      this.logEvent('Payment.received', payment)
      this.launchState!.metrics.mrr += payment.amount

      if (payment.amount >= 1000) {
        this.logEvent('action.triggered', {
          agent: 'sally',
          action: `send personal thank you to ${payment.customerId}`,
        })
      }
    }, { context })

    // Handle payment failed
    on.Payment.failed(async (payment: { customerId: string; reason: string }) => {
      this.logEvent('Payment.failed', payment)
      this.logEvent('action.triggered', {
        agent: 'sally',
        action: `reach out to ${payment.customerId} about failed payment`,
      })
    }, { context })

    // Handle feature request
    on.Feature.requested(async (request: { feature: string; votes: number }) => {
      this.logEvent('Feature.requested', request)

      if (request.votes >= 10) {
        this.logEvent('action.triggered', {
          agent: 'priya',
          action: `evaluate feature request: ${request.feature}`,
        })
      }
    }, { context })

    // Handle customer churn
    on.Customer.churned(async (customer: { email: string; reason: string }) => {
      this.logEvent('Customer.churned', customer)
      this.launchState!.metrics.churn++
      this.launchState!.metrics.customers = Math.max(0, this.launchState!.metrics.customers - 1)

      this.logEvent('action.triggered', {
        agent: 'mark',
        action: `create win-back campaign for ${customer.email}`,
      })
    }, { context })

    // Handle bug report
    on.Bug.reported(async (bug: { severity: string; description: string }) => {
      this.logEvent('Bug.reported', bug)

      if (bug.severity === 'critical') {
        this.logEvent('action.triggered', {
          agent: 'ralph',
          action: `investigate and fix: ${bug.description}`,
        })
      }
    }, { context })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHEDULED JOBS - $.every Pattern
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register scheduled jobs for ongoing operations
   *
   * Demonstrates the $.every pattern from CLAUDE.md:
   * ```typescript
   * $.every.Monday.at9am(handler)
   * $.every.day.at('6pm')(handler)
   * $.every.hour(handler)
   * ```
   */
  private registerScheduledJobs(): void {
    const context = this.launchState!.id

    // Daily standup at 9am
    every.day.at9am(() => {
      const metrics = this.launchState!.metrics
      this.logEvent('scheduled.daily-standup', {
        metrics,
        phase: this.launchState!.phase,
      })
    }, { context })

    // Weekly retrospective on Monday at 10am
    every.Monday.at10am(() => {
      this.logEvent('scheduled.weekly-retro', {
        eventCount: this.launchState!.events.length,
        errorCount: this.launchState!.errors.length,
      })
    }, { context })

    // Hourly metrics check
    every.hour(() => {
      this.logEvent('scheduled.hourly-check', {
        mrr: this.launchState!.metrics.mrr,
        customers: this.launchState!.metrics.customers,
      })
    }, { context })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // API METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get current launch state
   */
  getState(): StartupState | null {
    return this.launchState
  }

  /**
   * Get launch metrics
   */
  getMetrics(): StartupState['metrics'] | null {
    return this.launchState?.metrics ?? null
  }

  /**
   * Get event history
   */
  getEvents(): StartupState['events'] {
    return this.launchState?.events ?? []
  }

  /**
   * Get error history
   */
  getErrors(): StartupState['errors'] {
    return this.launchState?.errors ?? []
  }

  /**
   * Emit a business event (triggers registered handlers)
   */
  async emit(event: string, data: unknown): Promise<void> {
    this.logEvent(`emit.${event}`, data)
    // In a real implementation, this would trigger the registered handlers
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private logEvent(event: string, data?: unknown): void {
    if (this.launchState) {
      this.launchState.events.push({
        timestamp: new Date().toISOString(),
        event,
        data,
      })
    }
  }

  private handleError(phase: LaunchPhase, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    if (this.launchState) {
      this.launchState.errors.push({
        timestamp: new Date().toISOString(),
        phase,
        error: message,
      })
    }
    this.logEvent('error', { phase, error: message })
  }

  /**
   * Setup mock responses for testing
   */
  private setupMockResponses(hypothesis: Hypothesis): void {
    // Mock Priya's spec response
    setMockResponse('Define the MVP', JSON.stringify({
      name: `${hypothesis.solution.split(' ')[0]}AI`,
      features: ['Core feature 1', 'Core feature 2', 'Core feature 3'],
      timeline: '4 weeks',
      priority: 'high',
      acceptanceCriteria: ['Users can sign up', 'Core workflow works'],
      successMetrics: ['100 signups', '10% conversion'],
    }))

    // Mock Ralph's build response
    setMockResponse('Build the application', JSON.stringify({
      code: 'export function main() { console.log("Hello, World!"); }',
      version: '1.0.0',
      tests: ['test("it works", () => expect(true).toBe(true))'],
      dependencies: ['hono', 'zod'],
      deploymentReady: true,
    }))

    // Mock Tom's review response
    setMockResponse('Review this application', JSON.stringify({
      approved: true,
      issues: [],
      suggestions: ['Consider adding more error handling'],
      score: 85,
    }))

    // Mock Quinn's QA response
    setMockResponse('Test this application', JSON.stringify({
      passed: true,
      testsPassed: 42,
      testsFailed: 0,
      coverage: 87,
      criticalBugs: [],
      minorBugs: ['Minor UI alignment issue'],
    }))

    // Mock Mark's marketing response
    setMockResponse('Create launch materials', JSON.stringify({
      title: `Introducing ${hypothesis.solution}`,
      body: `We are excited to announce ${hypothesis.solution} for ${hypothesis.customer}...`,
      summary: `${hypothesis.solution} solves ${hypothesis.problem}`,
      keywords: ['startup', 'innovation', hypothesis.customer.split(' ')[0]],
      callToAction: 'Sign up today!',
      socialPosts: [
        { platform: 'twitter', content: `Launching ${hypothesis.solution}!` },
        { platform: 'linkedin', content: `Proud to announce ${hypothesis.solution}` },
      ],
    }))

    // Mock Sally's sales response
    setMockResponse('Create sales strategy', JSON.stringify({
      targetSegments: [hypothesis.customer, 'Early adopters', 'Tech enthusiasts'],
      valueProposition: `Save time and money with ${hypothesis.solution}`,
      pricingTiers: [
        { name: 'Starter', price: 29, features: ['Basic features'] },
        { name: 'Pro', price: 99, features: ['All features', 'Priority support'] },
        { name: 'Enterprise', price: 299, features: ['Custom integrations', 'SLA'] },
      ],
      objectionHandling: {
        'Too expensive': 'Consider the ROI - users save 10 hours per week',
        'We use a competitor': 'We integrate with existing tools',
      },
    }))
  }

  /**
   * Cleanup on destroy
   */
  override async destroy(): Promise<void> {
    // Clear event handlers for this startup instance
    if (this.launchState) {
      clearHandlers()
    }
    await super.destroy()
  }
}

export default AutonomousStartup
