/**
 * StartupLaunchDO - Complete Startup Launch Orchestrated by AI Agents
 *
 * Demonstrates the full power of dotdo's Business-as-Code framework:
 * - All 6 named agents (Priya, Ralph, Tom, Mark, Sally, Quinn)
 * - Human escalation for critical decisions (CEO, Legal)
 * - Promise pipelining for efficient multi-agent coordination
 * - The do/while loop pattern for iterative refinement
 * - Event handlers for business lifecycle
 * - Scheduled jobs for ongoing operations
 *
 * @see https://platform.do
 * @module examples/agent-startup-launch
 */

import { DurableObject } from 'cloudflare:workers'

// Import agent system prompts and helpers
import {
  PRIYA_SYSTEM_PROMPT,
  RALPH_SYSTEM_PROMPT,
  TOM_SYSTEM_PROMPT,
  MARK_SYSTEM_PROMPT,
  SALLY_SYSTEM_PROMPT,
  parseProductSpec as parseProductSpecFromAI,
  parseBuildResult,
  parseReviewResult,
  parseLaunchContent,
  parseSalesStrategy as parseSalesStrategyFromAI,
} from './agents'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Startup hypothesis - the foundation of every business
 */
interface Hypothesis {
  customer: string
  problem: string
  solution: string
  differentiator: string
}

/**
 * Product specification from Priya
 */
interface ProductSpec {
  name: string
  hypothesis: Hypothesis
  mvpFeatures: string[]
  userStories: Array<{
    as: string
    iWant: string
    soThat: string
    acceptanceCriteria: string[]
  }>
  priorities: Array<{ feature: string; priority: 'must-have' | 'should-have' | 'nice-to-have' }>
  timeline: string
  successMetrics: string[]
}

/**
 * Application code from Ralph
 */
interface Application {
  version: string
  spec: ProductSpec
  codebase: {
    api: string[]
    frontend: string[]
    database: string[]
    infrastructure: string[]
  }
  testCoverage: number
  buildStatus: 'passing' | 'failing'
  deploymentReady: boolean
}

/**
 * Code review from Tom
 */
interface CodeReview {
  approved: boolean
  issues: string[]
  suggestions: string[]
  securityConcerns: string[]
  performanceNotes: string[]
  architectureScore: number
}

/**
 * QA test results from Quinn
 */
interface QAResults {
  passed: boolean
  testsPassed: number
  testsFailed: number
  coverage: number
  criticalBugs: string[]
  minorBugs: string[]
  edgeCases: string[]
  performanceMetrics: {
    p50Latency: number
    p99Latency: number
    throughput: number
  }
}

/**
 * Launch materials from Mark
 */
interface LaunchMaterials {
  pressRelease: string
  blogPost: string
  socialPosts: { platform: string; content: string }[]
  emailCampaign: {
    subject: string
    body: string
    segments: string[]
  }
  landingPageCopy: string
  productHuntSubmission: {
    tagline: string
    description: string
    topics: string[]
  }
}

/**
 * Sales strategy from Sally
 */
interface SalesStrategy {
  targetSegments: string[]
  valueProposition: string
  pricingTiers: Array<{
    name: string
    price: number
    features: string[]
  }>
  objectionHandling: Record<string, string>
  outreachTemplates: {
    cold: string
    warm: string
    demo: string
    followUp: string
  }
  pipeline: {
    leads: number
    qualified: number
    proposals: number
    negotiations: number
  }
}

/**
 * Launch state machine
 */
type LaunchPhase =
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

/**
 * Complete launch state
 */
interface LaunchState {
  id: string
  phase: LaunchPhase
  hypothesis: Hypothesis
  spec?: ProductSpec
  app?: Application
  review?: CodeReview
  qa?: QAResults
  legalApproved?: boolean
  ceoApproved?: boolean
  launchMaterials?: LaunchMaterials
  salesStrategy?: SalesStrategy
  iterations: number
  events: Array<{ timestamp: string; event: string; data?: unknown }>
  metrics: {
    signups: number
    mrr: number
    customers: number
    churn: number
  }
}

// ============================================================================
// ENVIRONMENT
// ============================================================================

interface Env {
  STARTUP_LAUNCH_DO: DurableObjectNamespace
  ENVIRONMENT?: string
  AI: Ai
}

// ============================================================================
// STARTUP LAUNCH DURABLE OBJECT
// ============================================================================

/**
 * StartupLaunchDO orchestrates the complete startup launch lifecycle
 *
 * This is Business-as-Code: your entire launch process defined in TypeScript,
 * executed by AI agents, with human oversight for critical decisions.
 */
export class StartupLaunchDO extends DurableObject<Env> {
  private state: LaunchState | null = null

  // ═══════════════════════════════════════════════════════════════════════════
  // AI AGENT CALLS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Call an AI agent with a system prompt and user message
   */
  private async callAgent(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await this.env.AI.run('@cf/meta/llama-3.1-70b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    })

    return typeof response === 'string'
      ? response
      : (response as { response: string }).response
  }

  /**
   * Template literal helper for Priya (Product)
   */
  private async priya(prompt: string): Promise<string> {
    return this.callAgent(PRIYA_SYSTEM_PROMPT, prompt)
  }

  /**
   * Template literal helper for Ralph (Engineering)
   */
  private async ralph(prompt: string): Promise<string> {
    return this.callAgent(RALPH_SYSTEM_PROMPT, prompt)
  }

  /**
   * Template literal helper for Tom (Tech Lead)
   */
  private async tom(prompt: string): Promise<string> {
    return this.callAgent(TOM_SYSTEM_PROMPT, prompt)
  }

  /**
   * Template literal helper for Mark (Marketing)
   */
  private async mark(prompt: string): Promise<string> {
    return this.callAgent(MARK_SYSTEM_PROMPT, prompt)
  }

  /**
   * Template literal helper for Sally (Sales)
   */
  private async sally(prompt: string): Promise<string> {
    return this.callAgent(SALLY_SYSTEM_PROMPT, prompt)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CORE LAUNCH WORKFLOW
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Launch a startup from hypothesis to revenue
   *
   * This is the main orchestration method that coordinates all 6 agents
   * through the complete startup launch lifecycle.
   *
   * @example
   * ```typescript
   * const result = await startup.launch({
   *   customer: 'Freelance developers',
   *   problem: 'Tax season takes 20+ hours',
   *   solution: 'AI-powered tax automation',
   *   differentiator: 'AI does 95%, human CPA reviews edge cases',
   * })
   * ```
   */
  async launch(hypothesis: Hypothesis): Promise<LaunchState> {
    // Initialize state
    this.state = {
      id: crypto.randomUUID(),
      phase: 'hypothesis',
      hypothesis,
      iterations: 0,
      events: [],
      metrics: { signups: 0, mrr: 0, customers: 0, churn: 0 },
    }

    this.logEvent('launch.started', { hypothesis })

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1: Product Specification (Priya)
    // ─────────────────────────────────────────────────────────────────────────
    this.state.phase = 'specification'
    this.logEvent('phase.specification.started')

    // Priya defines the MVP specification
    const specPrompt = `
      Define the MVP for this startup hypothesis:

      Customer: ${hypothesis.customer}
      Problem: ${hypothesis.problem}
      Solution: ${hypothesis.solution}
      Differentiator: ${hypothesis.differentiator}

      Provide:
      1. Product name
      2. MVP features (max 5)
      3. User stories with acceptance criteria
      4. Priority matrix
      5. 4-week timeline
      6. Success metrics
    `

    const specResponse = await this.priya(specPrompt)
    this.state.spec = await this.parseProductSpec(specResponse)
    this.logEvent('phase.specification.completed', { spec: this.state.spec })

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2: Development with Review Loop (Ralph + Tom)
    // ─────────────────────────────────────────────────────────────────────────
    this.state.phase = 'development'
    this.logEvent('phase.development.started')

    // Initial build
    let appCode = await this.ralph(`build ${JSON.stringify(this.state.spec)}`)

    // The do/while loop: iterate until Tom approves
    let reviewResult: CodeReview
    do {
      this.state.iterations++
      this.logEvent('development.iteration', { iteration: this.state.iterations })

      // Tom reviews
      this.state.phase = 'review'
      const reviewPrompt = `
        Review this application:
        ${appCode}

        Check for:
        1. Code quality and best practices
        2. Security vulnerabilities
        3. Performance issues
        4. Architecture concerns
        5. Test coverage
      `

      const reviewResponse = await this.tom(reviewPrompt)
      reviewResult = await this.parseCodeReview(reviewResponse)
      this.state.review = reviewResult

      if (!reviewResult.approved) {
        this.logEvent('review.changes-requested', { issues: reviewResult.issues })

        // Ralph improves based on Tom's feedback
        this.state.phase = 'development'
        const improvePrompt = `
          improve ${appCode} per ${JSON.stringify(reviewResult)}

          Address these issues:
          ${reviewResult.issues.join('\n')}

          Consider these suggestions:
          ${reviewResult.suggestions.join('\n')}
        `
        appCode = await this.ralph(improvePrompt)
      }
    } while (!reviewResult.approved && this.state.iterations < 5)

    this.state.app = await this.parseApplication(appCode, this.state.spec)
    this.logEvent('phase.development.completed', { iterations: this.state.iterations })

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 3: Quality Assurance (skipped for demo - using Tom as reviewer)
    // ─────────────────────────────────────────────────────────────────────────
    this.state.phase = 'qa'
    this.logEvent('phase.qa.started')

    // In production, Quinn (QA agent) would test thoroughly
    // For this demo, we use the review result as QA indicator
    this.state.qa = {
      passed: reviewResult.approved,
      testsPassed: reviewResult.approved ? 142 : 130,
      testsFailed: reviewResult.approved ? 0 : 12,
      coverage: reviewResult.architectureScore * 10,
      criticalBugs: [],
      minorBugs: reviewResult.issues.slice(0, 2),
      edgeCases: ['Handled: empty input', 'Handled: special characters'],
      performanceMetrics: { p50Latency: 45, p99Latency: 180, throughput: 1200 },
    }
    this.logEvent('phase.qa.completed', { qa: this.state.qa })

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 4: Human Approvals (simulated for demo)
    // ─────────────────────────────────────────────────────────────────────────

    // In production, these would be real human approval workflows
    // For demo, we auto-approve
    this.state.phase = 'legal-review'
    this.logEvent('phase.legal-review.started')
    this.state.legalApproved = true
    this.logEvent('phase.legal-review.completed', { approved: true })

    this.state.phase = 'ceo-approval'
    this.logEvent('phase.ceo-approval.started')
    this.state.ceoApproved = true
    this.logEvent('phase.ceo-approval.completed', { approved: true })

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 5: Marketing Preparation (Mark)
    // ─────────────────────────────────────────────────────────────────────────
    this.state.phase = 'marketing'
    this.logEvent('phase.marketing.started')

    // Mark prepares all launch materials
    const marketingPrompt = `
      Prepare launch for ${this.state.spec?.name}

      Target: ${hypothesis.customer}
      Value: ${hypothesis.solution}
      Differentiator: ${hypothesis.differentiator}

      Create:
      1. Press release (newsworthy angle)
      2. Blog post (founder's story)
      3. Social posts (Twitter, LinkedIn, Reddit)
      4. Email campaign (3-email sequence)
      5. Landing page copy
      6. Product Hunt submission
    `

    const marketingResponse = await this.mark(marketingPrompt)
    this.state.launchMaterials = await this.parseLaunchMaterials(marketingResponse)
    this.logEvent('phase.marketing.completed', { materials: this.state.launchMaterials })

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 6: Sales Preparation (Sally)
    // ─────────────────────────────────────────────────────────────────────────
    this.state.phase = 'sales-prep'
    this.logEvent('phase.sales-prep.started')

    const salesPrompt = `
      Create sales strategy for ${this.state.spec?.name}

      Target customers: ${hypothesis.customer}
      Solution: ${hypothesis.solution}
      Differentiator: ${hypothesis.differentiator}

      Define:
      1. Target segments (3 primary)
      2. Value proposition (one sentence)
      3. Pricing tiers (starter, pro, enterprise)
      4. Objection handling guide
      5. Outreach templates (cold, warm, demo, follow-up)
      6. Initial pipeline targets
    `

    const salesResponse = await this.sally(salesPrompt)
    this.state.salesStrategy = await this.parseSalesStrategy(salesResponse)
    this.logEvent('phase.sales-prep.completed', { strategy: this.state.salesStrategy })

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 7: Launch!
    // ─────────────────────────────────────────────────────────────────────────
    this.state.phase = 'launched'
    this.logEvent('phase.launched', {
      product: this.state.spec?.name,
      timestamp: new Date().toISOString(),
    })

    // In a full implementation, these would execute launch actions in parallel
    // For demo, we log completion
    this.logEvent('launch.actions', {
      announcements: ['Twitter', 'LinkedIn', 'ProductHunt'],
      campaigns: ['early-adopters'],
      sales: ['pipeline outreach started'],
    })

    // Register event handlers for business operations
    this.registerEventHandlers()

    // Schedule recurring jobs
    this.scheduleJobs()

    return this.state
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT HANDLERS - $.on.Noun.verb Pattern
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register event handlers for business lifecycle events
   *
   * These handlers trigger automatically when business events occur.
   * In production, these would call the actual agent methods.
   */
  private registerEventHandlers(): void {
    // Handle new customer signups
    this.on('Customer.signup', async (customer: { email: string; plan: string }) => {
      this.logEvent('customer.signup', customer)
      this.state!.metrics.signups++
      this.state!.metrics.customers++

      // In production: mark and sally would handle welcome sequence
      this.logEvent('action.scheduled', { agent: 'mark', action: `send welcome email to ${customer.email}` })
      this.logEvent('action.scheduled', { agent: 'sally', action: `schedule onboarding call for ${customer.email}` })
    })

    // Handle payment received
    this.on('Payment.received', async (payment: { amount: number; customerId: string }) => {
      this.logEvent('payment.received', payment)
      this.state!.metrics.mrr += payment.amount

      if (payment.amount >= 1000) {
        this.logEvent('action.scheduled', { agent: 'sally', action: `send personal thank you to ${payment.customerId}` })
      }
    })

    // Handle payment failed
    this.on('Payment.failed', async (payment: { customerId: string; reason: string }) => {
      this.logEvent('payment.failed', payment)
      this.logEvent('action.scheduled', { agent: 'sally', action: `reach out to ${payment.customerId} about failed payment` })
    })

    // Handle feature request
    this.on('Feature.requested', async (request: { feature: string; customerId: string; votes: number }) => {
      this.logEvent('feature.requested', request)

      if (request.votes >= 10) {
        this.logEvent('action.scheduled', { agent: 'priya', action: `evaluate feature request: ${request.feature} with ${request.votes} votes` })
      }
    })

    // Handle churn event
    this.on('Customer.churned', async (customer: { email: string; reason: string }) => {
      this.logEvent('customer.churned', customer)
      this.state!.metrics.churn++

      this.logEvent('action.scheduled', { agent: 'mark', action: `create win-back campaign for ${customer.email}` })
      this.logEvent('action.scheduled', { agent: 'sally', action: `schedule exit interview with ${customer.email}` })
    })

    // Handle bug report
    this.on('Bug.reported', async (bug: { severity: string; description: string; reporter: string }) => {
      this.logEvent('bug.reported', bug)

      if (bug.severity === 'critical') {
        this.logEvent('action.scheduled', { agent: 'ralph', action: `investigate and fix: ${bug.description}` })
        this.logEvent('action.scheduled', { agent: 'mark', action: `notify affected users about ${bug.description}` })
      }
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHEDULED JOBS - $.every Pattern
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Schedule recurring jobs for ongoing operations
   * In production, these would use Cloudflare's scheduled handlers
   */
  private scheduleJobs(): void {
    // Daily standup report
    this.every('day', '9am', async () => {
      const metrics = this.state!.metrics
      this.logEvent('scheduled.daily-standup', { metrics })
    })

    // Weekly retrospective
    this.every('monday', '10am', async () => {
      this.logEvent('scheduled.weekly-retro', { eventCount: this.state!.events.length })
    })

    // Monthly investor update
    this.every('first monday', '9am', async () => {
      this.logEvent('scheduled.investor-update', { metrics: this.state!.metrics })
    })

    // Quarterly roadmap review
    this.every('first monday of quarter', '9am', async () => {
      this.logEvent('scheduled.quarterly-roadmap', { phase: this.state!.phase })
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // API METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get current launch state
   */
  getState(): LaunchState | null {
    return this.state
  }

  /**
   * Get launch metrics
   */
  getMetrics(): LaunchState['metrics'] | null {
    return this.state?.metrics ?? null
  }

  /**
   * Emit a business event (triggers registered handlers)
   */
  async emit(event: string, data: unknown): Promise<void> {
    this.logEvent(event, data)
    const handler = this.eventHandlers.get(event)
    if (handler) {
      await handler(data)
    }
  }

  /**
   * Get event history
   */
  getEvents(): LaunchState['events'] {
    return this.state?.events ?? []
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private eventHandlers = new Map<string, (data: unknown) => Promise<void>>()
  private scheduledJobs: Array<{ schedule: string; handler: () => Promise<void> }> = []

  private on(event: string, handler: (data: unknown) => Promise<void>): void {
    this.eventHandlers.set(event, handler)
  }

  private every(schedule: string, time: string | (() => Promise<void>), handler?: () => Promise<void>): void {
    if (typeof time === 'function') {
      this.scheduledJobs.push({ schedule, handler: time })
    } else {
      this.scheduledJobs.push({ schedule: `${schedule} at ${time}`, handler: handler! })
    }
  }

  private logEvent(event: string, data?: unknown): void {
    if (this.state) {
      this.state.events.push({
        timestamp: new Date().toISOString(),
        event,
        data,
      })
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PARSING HELPERS (simulate AI response parsing)
  // ─────────────────────────────────────────────────────────────────────────

  private async parseProductSpec(response: string): Promise<ProductSpec> {
    // In production, this would parse the AI response
    // For demo, return structured mock data
    return {
      name: 'TaxAI',
      hypothesis: this.state!.hypothesis,
      mvpFeatures: [
        'Expense categorization',
        'Tax deduction finder',
        'Receipt scanning',
        'Quarterly estimates',
        'CPA review integration',
      ],
      userStories: [
        {
          as: 'a freelance developer',
          iWant: 'to automatically categorize my expenses',
          soThat: 'I maximize my tax deductions',
          acceptanceCriteria: [
            'System categorizes 95% of expenses correctly',
            'User can override categorization',
            'Learns from corrections',
          ],
        },
      ],
      priorities: [
        { feature: 'Expense categorization', priority: 'must-have' },
        { feature: 'Tax deduction finder', priority: 'must-have' },
        { feature: 'Receipt scanning', priority: 'should-have' },
        { feature: 'Quarterly estimates', priority: 'should-have' },
        { feature: 'CPA review integration', priority: 'nice-to-have' },
      ],
      timeline: '4 weeks',
      successMetrics: [
        '1000 signups in first month',
        '10% conversion to paid',
        'NPS > 50',
        '< 2 min average categorization time',
      ],
    }
  }

  private async parseCodeReview(response: string): Promise<CodeReview> {
    // Simulate code review result
    const approved = Math.random() > 0.3 || this.state!.iterations >= 3
    return {
      approved,
      issues: approved ? [] : ['Missing input validation', 'No rate limiting on API'],
      suggestions: ['Consider caching for performance', 'Add structured logging'],
      securityConcerns: approved ? [] : ['API keys exposed in client'],
      performanceNotes: ['P50 latency acceptable', 'Consider lazy loading'],
      architectureScore: approved ? 8.5 : 6.5,
    }
  }

  private async parseApplication(response: string, spec: ProductSpec): Promise<Application> {
    return {
      version: '1.0.0',
      spec,
      codebase: {
        api: ['routes.ts', 'handlers.ts', 'middleware.ts'],
        frontend: ['App.tsx', 'Dashboard.tsx', 'ExpenseList.tsx'],
        database: ['schema.sql', 'migrations.ts'],
        infrastructure: ['wrangler.jsonc', 'deploy.ts'],
      },
      testCoverage: 85,
      buildStatus: 'passing',
      deploymentReady: true,
    }
  }

  private async parseQAResults(response: string): Promise<QAResults> {
    return {
      passed: true,
      testsPassed: 142,
      testsFailed: 3,
      coverage: 85,
      criticalBugs: [],
      minorBugs: ['Tooltip alignment issue on mobile'],
      edgeCases: ['Handled: empty expense list', 'Handled: very long descriptions'],
      performanceMetrics: {
        p50Latency: 45,
        p99Latency: 180,
        throughput: 1200,
      },
    }
  }

  private async parseLaunchMaterials(response: string): Promise<LaunchMaterials> {
    const name = this.state!.spec?.name ?? 'TaxAI'
    return {
      pressRelease: `${name} launches AI-powered tax automation for freelancers`,
      blogPost: `How we built ${name}: From idea to launch in 4 weeks`,
      socialPosts: [
        { platform: 'twitter', content: `Introducing ${name}: Tax season in 5 minutes, not 5 hours` },
        { platform: 'linkedin', content: `Proud to announce ${name}, the AI tax assistant for freelancers` },
        { platform: 'reddit', content: `We built an AI that does your freelance taxes. AMA!` },
      ],
      emailCampaign: {
        subject: `${name} is here: Never dread tax season again`,
        body: `We built ${name} because we know the pain of freelance taxes...`,
        segments: ['early-adopters', 'waitlist', 'beta-users'],
      },
      landingPageCopy: `Stop dreading tax season. ${name} uses AI to categorize expenses, find deductions, and prepare your taxes in minutes. Human CPA review included.`,
      productHuntSubmission: {
        tagline: 'AI-powered taxes for freelancers. Human CPA backup.',
        description: `${name} is the tax assistant that understands freelancer finances...`,
        topics: ['Artificial Intelligence', 'Fintech', 'Productivity'],
      },
    }
  }

  private async parseSalesStrategy(response: string): Promise<SalesStrategy> {
    return {
      targetSegments: ['Solo freelancers', 'Small agencies', 'Content creators'],
      valueProposition: 'Save 20 hours on taxes with AI that does 95% of the work',
      pricingTiers: [
        { name: 'Starter', price: 99, features: ['AI categorization', '50 transactions/month'] },
        { name: 'Pro', price: 299, features: ['Unlimited transactions', 'Quarterly estimates', 'Priority support'] },
        { name: 'Enterprise', price: 999, features: ['Team access', 'CPA review', 'Custom integrations'] },
      ],
      objectionHandling: {
        'Too expensive': 'How much is 20 hours of your time worth? Our Pro users save an average of $3,000 in found deductions.',
        'I use spreadsheets': 'Spreadsheets are great but they miss deductions. Our AI catches 15% more on average.',
        'I have an accountant': 'We work with your accountant. They review the AI work instead of doing data entry.',
      },
      outreachTemplates: {
        cold: 'Hi {name}, I noticed you run a {business}. Quick question: how much time do you spend on tax prep?',
        warm: 'Thanks for checking out TaxAI! I wanted to personally reach out...',
        demo: 'Great chatting yesterday. Here is your personalized demo link...',
        followUp: 'Following up on our conversation about TaxAI...',
      },
      pipeline: {
        leads: 500,
        qualified: 100,
        proposals: 25,
        negotiations: 10,
      },
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Handle RPC endpoint
    if (url.pathname === '/rpc' && request.method === 'POST') {
      try {
        const body = (await request.json()) as {
          jsonrpc: string
          id: number
          method: string
          params?: unknown[]
        }
        const { method, params = [], id } = body

        // Call the method on this DO
        const methodFn = (this as unknown as Record<string, (...args: unknown[]) => unknown>)[method]
        if (typeof methodFn !== 'function') {
          return Response.json(
            { jsonrpc: '2.0', id, error: { code: -32601, message: `Method '${method}' not found` } },
            { status: 400 }
          )
        }

        const result = await methodFn.apply(this, params)
        return Response.json({ jsonrpc: '2.0', id, result })
      } catch (error) {
        return Response.json(
          { jsonrpc: '2.0', id: 0, error: { code: -32603, message: String(error) } },
          { status: 500 }
        )
      }
    }

    return new Response('Not Found', { status: 404 })
  }
}
