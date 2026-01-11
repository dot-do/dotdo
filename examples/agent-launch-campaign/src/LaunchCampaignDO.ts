/**
 * LaunchCampaignDO - AI-Powered Product Launch Campaign
 *
 * Mark (Marketing) + Sally (Sales) teamwork:
 * - Mark creates launch narrative, blog posts, social content
 * - Sally generates personalized outreach sequences
 * - A/B testing of messaging variants
 * - Automated follow-ups and conversion tracking
 *
 * @example
 * ```ts
 * const campaign = await $.Campaign.create({
 *   product: { name: 'TaxAI', tagline: 'Taxes done while you code' }
 * })
 *
 * // Mark creates all content
 * await campaign.generateContent()
 *
 * // Sally creates outreach for each lead
 * await campaign.generateOutreach()
 *
 * // Launch!
 * await campaign.launch()
 * ```
 *
 * @module agent-launch-campaign
 */

import { DurableObject } from 'cloudflare:workers'

// Import modular agents
import { createMark, type MarkAgent } from './agents/mark'
import { createSally, type SallyAgent } from './agents/sally'

// Import workflow
import { createLaunchWorkflow, type LaunchWorkflow } from './workflows/launch'

// Import types
import type {
  Product,
  Narrative,
  Content,
  ContentMetrics,
  Lead,
  OutreachSequence,
  OutreachEmail,
  CampaignConfig,
  CampaignState,
  CampaignMetrics,
  ABTestResults,
} from './types'

// Re-export types for external use
export type {
  Product,
  Narrative,
  Content,
  ContentMetrics,
  Lead,
  OutreachSequence,
  OutreachEmail,
  CampaignConfig,
  CampaignState,
  CampaignMetrics,
}

// ============================================================================
// ENVIRONMENT
// ============================================================================

interface Env {
  CAMPAIGN: DurableObjectNamespace
  AI?: Ai
}

// ============================================================================
// LAUNCH CAMPAIGN DO
// ============================================================================

export class LaunchCampaignDO extends DurableObject<Env> {
  private state!: CampaignState
  private mark: MarkAgent
  private sally: SallyAgent

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize agents with AI binding (if available)
    this.mark = createMark(env.AI)
    this.sally = createSally(env.AI)
  }

  /**
   * Initialize the campaign with product info
   */
  async create(config: CampaignConfig): Promise<CampaignState> {
    this.state = {
      config,
      content: [],
      leads: [],
      outreach: [],
      metrics: {
        totalLeads: 0,
        emailsSent: 0,
        emailsOpened: 0,
        emailsClicked: 0,
        replies: 0,
        conversions: 0,
        openRate: 0,
        clickRate: 0,
        replyRate: 0,
        conversionRate: 0,
      },
      status: 'draft',
      createdAt: new Date().toISOString(),
    }

    await this.saveState()
    return this.state
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORKFLOW EXECUTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute the complete launch workflow
   */
  async executeWorkflow(): Promise<CampaignState> {
    await this.ensureState()

    const workflow = createLaunchWorkflow(this.state, {
      ai: this.env.AI,
      abTesting: this.state.config.abTestingEnabled,
      onStepComplete: async (step) => {
        // Save state after each step
        await this.saveState()
        console.log(`[Workflow] Step completed: ${step.name}`)
      },
    })

    const result = await workflow.execute()
    await this.saveState()

    return result
  }

  /**
   * Get workflow progress
   */
  async getWorkflowProgress(): Promise<{ completed: number; total: number; percentage: number }> {
    await this.ensureState()

    const workflow = createLaunchWorkflow(this.state, { ai: this.env.AI })
    return workflow.getProgress()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MARK - CONTENT GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate the core launch narrative using Mark
   */
  async generateNarrative(): Promise<Narrative> {
    await this.ensureState()

    const narrative = await this.mark.generateNarrative(this.state.config.product)
    this.state.narrative = narrative
    await this.saveState()

    return narrative
  }

  /**
   * Generate blog post content
   */
  async generateBlogPost(options?: { variant?: 'A' | 'B' }): Promise<Content> {
    await this.ensureState()

    if (!this.state.narrative) {
      await this.generateNarrative()
    }

    const content = await this.mark.generateBlogPost(
      this.state.config.product,
      this.state.narrative!,
      options?.variant
    )

    this.state.content.push(content)
    await this.saveState()

    return content
  }

  /**
   * Generate social media content
   */
  async generateSocialContent(): Promise<Content[]> {
    await this.ensureState()

    if (!this.state.narrative) {
      await this.generateNarrative()
    }

    const twitter = await this.mark.generateTwitterThread(
      this.state.config.product,
      this.state.narrative!
    )
    const linkedin = await this.mark.generateLinkedInPost(
      this.state.config.product,
      this.state.narrative!
    )

    const socialContent = [twitter, linkedin]
    this.state.content.push(...socialContent)
    await this.saveState()

    return socialContent
  }

  /**
   * Generate landing page copy
   */
  async generateLandingPage(): Promise<Content> {
    await this.ensureState()

    if (!this.state.narrative) {
      await this.generateNarrative()
    }

    const content = await this.mark.generateLandingPage(
      this.state.config.product,
      this.state.narrative!
    )

    this.state.content.push(content)
    await this.saveState()

    return content
  }

  /**
   * Generate all content at once
   */
  async generateAllContent(): Promise<Content[]> {
    await this.ensureState()

    // Generate narrative first
    if (!this.state.narrative) {
      await this.generateNarrative()
    }

    // Generate all content in parallel
    const [blog, social, landing] = await Promise.all([
      this.generateBlogPost(),
      this.generateSocialContent(),
      this.generateLandingPage(),
    ])

    // If A/B testing is enabled, generate variants
    if (this.state.config.abTestingEnabled) {
      await this.generateBlogPost({ variant: 'B' })
    }

    this.state.status = 'preparing'
    await this.saveState()

    return this.state.content
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SALLY - OUTREACH GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add leads to the campaign
   */
  async addLeads(leads: Omit<Lead, '$id' | 'status'>[]): Promise<Lead[]> {
    await this.ensureState()

    const newLeads: Lead[] = leads.map((lead, i) => ({
      ...lead,
      $id: `lead-${Date.now()}-${i}`,
      status: 'new' as const,
    }))

    this.state.leads.push(...newLeads)
    this.state.metrics.totalLeads = this.state.leads.length
    await this.saveState()

    return newLeads
  }

  /**
   * Generate personalized outreach for a lead
   */
  async generateOutreachForLead(leadId: string): Promise<OutreachSequence> {
    await this.ensureState()

    const lead = this.state.leads.find(l => l.$id === leadId)
    if (!lead) {
      throw new Error(`Lead not found: ${leadId}`)
    }

    const sequence = await this.sally.generateOutreachSequence(
      lead,
      this.state.config.product,
      this.state.narrative || null,
      this.state.config.followUpDays
    )

    this.state.outreach.push(sequence)
    await this.saveState()

    return sequence
  }

  /**
   * Generate outreach for all qualified leads
   */
  async generateAllOutreach(): Promise<OutreachSequence[]> {
    await this.ensureState()

    const qualifiedLeads = this.state.leads.filter(
      l => l.status === 'new' || l.status === 'qualified'
    )

    const sequences: OutreachSequence[] = []

    for (const lead of qualifiedLeads) {
      const sequence = await this.generateOutreachForLead(lead.$id)
      sequences.push(sequence)

      // Update lead status
      lead.status = 'qualified'
    }

    this.state.status = 'ready'
    await this.saveState()

    return sequences
  }

  /**
   * Generate A/B test variants for outreach
   */
  async generateOutreachVariants(leadId: string): Promise<OutreachSequence[]> {
    await this.ensureState()

    const lead = this.state.leads.find(l => l.$id === leadId)
    if (!lead) {
      throw new Error(`Lead not found: ${leadId}`)
    }

    const { variantA, variantB } = await this.sally.generateOutreachVariants(
      lead,
      this.state.config.product,
      this.state.narrative || null
    )

    const sequenceA: OutreachSequence = {
      $id: `outreach-${leadId}-A-${Date.now()}`,
      leadId,
      emails: [variantA],
      status: 'pending',
    }

    const sequenceB: OutreachSequence = {
      $id: `outreach-${leadId}-B-${Date.now()}`,
      leadId,
      emails: [variantB],
      status: 'pending',
    }

    this.state.outreach.push(sequenceA, sequenceB)
    await this.saveState()

    return [sequenceA, sequenceB]
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMPAIGN EXECUTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Launch the campaign
   */
  async launch(): Promise<CampaignState> {
    await this.ensureState()

    if (this.state.status === 'launched') {
      throw new Error('Campaign already launched')
    }

    // Publish all content
    for (const content of this.state.content) {
      if (content.status === 'draft') {
        content.status = 'published'
        content.publishedAt = new Date().toISOString()
      }
    }

    // Activate all outreach sequences
    for (const sequence of this.state.outreach) {
      if (sequence.status === 'pending') {
        sequence.status = 'active'
        sequence.startedAt = new Date().toISOString()
      }
    }

    // Update campaign status
    this.state.status = 'launched'
    this.state.launchedAt = new Date().toISOString()

    await this.saveState()

    // Set up scheduled follow-ups
    await this.scheduleFollowUps()

    return this.state
  }

  /**
   * Set up scheduled alarms for follow-up emails
   */
  private async scheduleFollowUps(): Promise<void> {
    const now = new Date()
    let nextEmail: { sequence: OutreachSequence; email: OutreachEmail } | null = null
    let nextTime = Infinity

    for (const sequence of this.state.outreach) {
      if (sequence.status !== 'active') continue

      for (const email of sequence.emails) {
        if (email.sentAt) continue
        if (!email.scheduledFor) continue

        const scheduled = new Date(email.scheduledFor).getTime()
        if (scheduled > now.getTime() && scheduled < nextTime) {
          nextTime = scheduled
          nextEmail = { sequence, email }
        }
      }
    }

    if (nextEmail) {
      await this.ctx.storage.setAlarm(new Date(nextTime))
    }
  }

  /**
   * Handle scheduled alarm (send follow-up emails)
   */
  async alarm(): Promise<void> {
    await this.ensureState()
    const now = new Date()

    for (const sequence of this.state.outreach) {
      if (sequence.status !== 'active') continue

      for (const email of sequence.emails) {
        if (email.sentAt) continue
        if (!email.scheduledFor) continue

        const scheduled = new Date(email.scheduledFor)
        if (scheduled <= now) {
          await this.sendEmail(sequence, email)
          email.sentAt = now.toISOString()
          this.state.metrics.emailsSent++
        }
      }

      // Check if sequence is complete
      if (sequence.emails.every(e => e.sentAt)) {
        sequence.status = 'completed'
        sequence.completedAt = now.toISOString()
      }
    }

    await this.saveState()
    await this.scheduleFollowUps()
  }

  /**
   * Send an email (integrate with email service)
   */
  private async sendEmail(sequence: OutreachSequence, email: OutreachEmail): Promise<void> {
    const lead = this.state.leads.find(l => l.$id === sequence.leadId)
    if (!lead) return

    // Update lead status
    if (lead.status === 'qualified') {
      lead.status = 'contacted'
    }

    // In production, integrate with email service (SendGrid, Postmark, etc.)
    console.log('Email.sent', {
      to: lead.email,
      subject: email.subject,
      sequenceId: sequence.$id,
      step: email.step,
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // METRICS & OPTIMIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Record an email open
   */
  async recordOpen(sequenceId: string, step: number): Promise<void> {
    await this.ensureState()

    const sequence = this.state.outreach.find(s => s.$id === sequenceId)
    if (!sequence) return

    const email = sequence.emails.find(e => e.step === step)
    if (!email || email.openedAt) return

    email.openedAt = new Date().toISOString()
    this.state.metrics.emailsOpened++
    this.updateRates()
    await this.saveState()
  }

  /**
   * Record an email click
   */
  async recordClick(sequenceId: string, step: number): Promise<void> {
    await this.ensureState()

    const sequence = this.state.outreach.find(s => s.$id === sequenceId)
    if (!sequence) return

    const email = sequence.emails.find(e => e.step === step)
    if (!email || email.clickedAt) return

    email.clickedAt = new Date().toISOString()
    this.state.metrics.emailsClicked++
    this.updateRates()
    await this.saveState()
  }

  /**
   * Record a reply
   */
  async recordReply(sequenceId: string, step: number): Promise<void> {
    await this.ensureState()

    const sequence = this.state.outreach.find(s => s.$id === sequenceId)
    if (!sequence) return

    const email = sequence.emails.find(e => e.step === step)
    if (!email) return

    email.repliedAt = new Date().toISOString()
    this.state.metrics.replies++

    // Update lead status
    const lead = this.state.leads.find(l => l.$id === sequence.leadId)
    if (lead) {
      lead.status = 'responded'
    }

    // Pause the sequence (no more automated follow-ups)
    sequence.status = 'paused'

    this.updateRates()
    await this.saveState()
  }

  /**
   * Record a conversion
   */
  async recordConversion(leadId: string): Promise<void> {
    await this.ensureState()

    const lead = this.state.leads.find(l => l.$id === leadId)
    if (!lead) return

    lead.status = 'converted'
    this.state.metrics.conversions++
    this.updateRates()
    await this.saveState()
  }

  /**
   * Update calculated rates
   */
  private updateRates(): void {
    const m = this.state.metrics
    m.openRate = m.emailsSent > 0 ? (m.emailsOpened / m.emailsSent) * 100 : 0
    m.clickRate = m.emailsSent > 0 ? (m.emailsClicked / m.emailsSent) * 100 : 0
    m.replyRate = m.emailsSent > 0 ? (m.replies / m.emailsSent) * 100 : 0
    m.conversionRate = m.totalLeads > 0 ? (m.conversions / m.totalLeads) * 100 : 0
  }

  /**
   * Get campaign metrics
   */
  async getMetrics(): Promise<CampaignMetrics> {
    await this.ensureState()
    return this.state.metrics
  }

  /**
   * Get A/B test results
   */
  async getABTestResults(): Promise<ABTestResults> {
    await this.ensureState()

    const contentResults = new Map<string, { views: number; conversions: number }>()
    const outreachResults = new Map<string, { opens: number; clicks: number; replies: number }>()

    // Aggregate content metrics by variant
    for (const content of this.state.content) {
      const variant = content.variant || 'default'
      const current = contentResults.get(variant) || { views: 0, conversions: 0 }
      if (content.metrics) {
        current.views += content.metrics.views
        current.conversions += content.metrics.conversions
      }
      contentResults.set(variant, current)
    }

    // Aggregate outreach metrics by variant
    for (const sequence of this.state.outreach) {
      for (const email of sequence.emails) {
        const variant = email.variant || 'default'
        const current = outreachResults.get(variant) || { opens: 0, clicks: 0, replies: 0 }
        if (email.openedAt) current.opens++
        if (email.clickedAt) current.clicks++
        if (email.repliedAt) current.replies++
        outreachResults.set(variant, current)
      }
    }

    return {
      content: Array.from(contentResults.entries()).map(([variant, data]) => ({ variant, ...data })),
      outreach: Array.from(outreachResults.entries()).map(([variant, data]) => ({ variant, ...data })),
    }
  }

  /**
   * Optimize messaging based on metrics (Mark's job)
   */
  async optimizeMessaging(): Promise<string> {
    await this.ensureState()

    const contentMetrics = {
      views: this.state.content.reduce((sum, c) => sum + (c.metrics?.views || 0), 0),
      clicks: this.state.content.reduce((sum, c) => sum + (c.metrics?.clicks || 0), 0),
      shares: this.state.content.reduce((sum, c) => sum + (c.metrics?.shares || 0), 0),
      conversions: this.state.metrics.conversions,
      engagementRate: this.state.metrics.clickRate,
    }

    const abResults = await this.getABTestResults()

    return this.mark.optimizeMessaging(contentMetrics, abResults)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get current campaign state
   */
  async getState(): Promise<CampaignState> {
    await this.ensureState()
    return this.state
  }

  /**
   * Ensure state is loaded
   */
  private async ensureState(): Promise<void> {
    if (!this.state) {
      await this.loadState()
    }
  }

  /**
   * Load state from storage
   */
  private async loadState(): Promise<void> {
    const stored = await this.ctx.storage.get<CampaignState>('state')
    if (stored) {
      this.state = stored
    }
  }

  /**
   * Save state to storage
   */
  private async saveState(): Promise<void> {
    await this.ctx.storage.put('state', this.state)
  }
}

export default LaunchCampaignDO
