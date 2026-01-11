/**
 * Launch Workflow - Mark + Sally Collaboration
 *
 * Orchestrates the complete product launch workflow:
 * 1. Mark creates the launch narrative
 * 2. Mark generates all content (blog, social, landing page)
 * 3. Sally generates personalized outreach for each lead
 * 4. Campaign launch (publish content, activate sequences)
 * 5. Ongoing optimization based on metrics
 *
 * @example
 * ```ts
 * import { launchWorkflow } from './workflows/launch'
 *
 * const workflow = launchWorkflow(campaign, { ai: env.AI })
 *
 * // Execute full workflow
 * await workflow.execute()
 *
 * // Or step by step
 * await workflow.createNarrative()
 * await workflow.generateContent()
 * await workflow.generateOutreach()
 * await workflow.launch()
 * ```
 *
 * @module agent-launch-campaign/workflows/launch
 */

import { createMark, type MarkAgent } from '../agents/mark'
import { createSally, type SallyAgent } from '../agents/sally'
import type {
  CampaignConfig,
  CampaignState,
  Narrative,
  Content,
  Lead,
  OutreachSequence,
  WorkflowStep,
  LaunchWorkflowState,
} from '../types'

// ============================================================================
// TYPES
// ============================================================================

export interface LaunchWorkflowOptions {
  /** Cloudflare AI binding for real AI responses */
  ai?: Ai
  /** Maximum iterations for content generation */
  maxIterations?: number
  /** Enable A/B testing */
  abTesting?: boolean
  /** Callback for step completion */
  onStepComplete?: (step: WorkflowStep) => void | Promise<void>
  /** Callback for workflow events */
  onEvent?: (event: WorkflowEvent) => void | Promise<void>
}

export interface WorkflowEvent {
  type: 'step_start' | 'step_complete' | 'step_error' | 'workflow_complete' | 'workflow_error'
  step?: string
  data?: unknown
  error?: string
  timestamp: string
}

export interface LaunchWorkflow {
  /** Current workflow state */
  readonly state: LaunchWorkflowState

  /** Execute the complete workflow */
  execute(): Promise<CampaignState>

  /** Step 1: Create launch narrative */
  createNarrative(): Promise<Narrative>

  /** Step 2: Generate all content */
  generateContent(): Promise<Content[]>

  /** Step 3: Generate outreach for all leads */
  generateOutreach(): Promise<OutreachSequence[]>

  /** Step 4: Launch the campaign */
  launch(): Promise<CampaignState>

  /** Step 5: Optimize based on metrics */
  optimize(): Promise<string>

  /** Get workflow progress */
  getProgress(): { completed: number; total: number; percentage: number }
}

// ============================================================================
// WORKFLOW STEPS
// ============================================================================

const WORKFLOW_STEPS: Omit<WorkflowStep, 'status'>[] = [
  {
    id: 'narrative',
    name: 'Create Narrative',
    description: 'Mark creates a StoryBrand-style launch narrative',
  },
  {
    id: 'blog',
    name: 'Generate Blog Post',
    description: 'Mark writes a compelling launch blog post',
  },
  {
    id: 'social',
    name: 'Generate Social Content',
    description: 'Mark creates Twitter thread and LinkedIn post',
  },
  {
    id: 'landing',
    name: 'Generate Landing Page',
    description: 'Mark writes landing page copy',
  },
  {
    id: 'outreach',
    name: 'Generate Outreach',
    description: 'Sally creates personalized email sequences for each lead',
  },
  {
    id: 'launch',
    name: 'Launch Campaign',
    description: 'Publish content and activate outreach sequences',
  },
]

// ============================================================================
// WORKFLOW FACTORY
// ============================================================================

/**
 * Create a launch workflow for a campaign
 *
 * @param campaign - Campaign state to operate on
 * @param options - Workflow options including AI binding
 * @returns Launch workflow instance
 */
export function createLaunchWorkflow(
  campaign: CampaignState,
  options: LaunchWorkflowOptions = {}
): LaunchWorkflow {
  // Create agents with AI binding
  const mark = createMark(options.ai)
  const sally = createSally(options.ai)

  // Initialize workflow state
  const state: LaunchWorkflowState = {
    campaignId: `campaign-${Date.now()}`,
    steps: WORKFLOW_STEPS.map(step => ({ ...step, status: 'pending' as const })),
    currentStep: 0,
    status: 'pending',
  }

  // Helper to emit events
  const emit = async (event: Omit<WorkflowEvent, 'timestamp'>) => {
    if (options.onEvent) {
      await options.onEvent({ ...event, timestamp: new Date().toISOString() })
    }
  }

  // Helper to update step status
  const updateStep = async (
    stepId: string,
    status: WorkflowStep['status'],
    result?: unknown,
    error?: string
  ) => {
    const step = state.steps.find(s => s.id === stepId)
    if (!step) return

    step.status = status

    if (status === 'running') {
      step.startedAt = new Date().toISOString()
      await emit({ type: 'step_start', step: stepId })
    } else if (status === 'completed') {
      step.completedAt = new Date().toISOString()
      step.result = result
      await emit({ type: 'step_complete', step: stepId, data: result })
      if (options.onStepComplete) {
        await options.onStepComplete(step)
      }
    } else if (status === 'failed') {
      step.completedAt = new Date().toISOString()
      step.error = error
      await emit({ type: 'step_error', step: stepId, error })
    }
  }

  // Create narrative
  const createNarrative = async (): Promise<Narrative> => {
    await updateStep('narrative', 'running')

    try {
      const narrative = await mark.generateNarrative(campaign.config.product)
      campaign.narrative = narrative
      await updateStep('narrative', 'completed', narrative)
      return narrative
    } catch (error) {
      await updateStep('narrative', 'failed', undefined, String(error))
      throw error
    }
  }

  // Generate content
  const generateContent = async (): Promise<Content[]> => {
    if (!campaign.narrative) {
      await createNarrative()
    }

    const content: Content[] = []

    // Blog post
    await updateStep('blog', 'running')
    try {
      const blog = await mark.generateBlogPost(
        campaign.config.product,
        campaign.narrative!,
        'A'
      )
      content.push(blog)
      campaign.content.push(blog)

      // A/B variant if enabled
      if (options.abTesting || campaign.config.abTestingEnabled) {
        const blogB = await mark.generateBlogPost(
          campaign.config.product,
          campaign.narrative!,
          'B'
        )
        content.push(blogB)
        campaign.content.push(blogB)
      }

      await updateStep('blog', 'completed', blog)
    } catch (error) {
      await updateStep('blog', 'failed', undefined, String(error))
      throw error
    }

    // Social content
    await updateStep('social', 'running')
    try {
      const twitter = await mark.generateTwitterThread(
        campaign.config.product,
        campaign.narrative!
      )
      content.push(twitter)
      campaign.content.push(twitter)

      const linkedin = await mark.generateLinkedInPost(
        campaign.config.product,
        campaign.narrative!
      )
      content.push(linkedin)
      campaign.content.push(linkedin)

      await updateStep('social', 'completed', { twitter, linkedin })
    } catch (error) {
      await updateStep('social', 'failed', undefined, String(error))
      throw error
    }

    // Landing page
    await updateStep('landing', 'running')
    try {
      const landing = await mark.generateLandingPage(
        campaign.config.product,
        campaign.narrative!
      )
      content.push(landing)
      campaign.content.push(landing)

      await updateStep('landing', 'completed', landing)
    } catch (error) {
      await updateStep('landing', 'failed', undefined, String(error))
      throw error
    }

    campaign.status = 'preparing'
    return content
  }

  // Generate outreach
  const generateOutreach = async (): Promise<OutreachSequence[]> => {
    await updateStep('outreach', 'running')

    try {
      const qualifiedLeads = campaign.leads.filter(
        l => l.status === 'new' || l.status === 'qualified'
      )

      const sequences: OutreachSequence[] = []

      for (const lead of qualifiedLeads) {
        const sequence = await sally.generateOutreachSequence(
          lead,
          campaign.config.product,
          campaign.narrative || null,
          campaign.config.followUpDays
        )
        sequences.push(sequence)
        campaign.outreach.push(sequence)

        // Update lead status
        lead.status = 'qualified'
      }

      campaign.status = 'ready'
      await updateStep('outreach', 'completed', { count: sequences.length })
      return sequences
    } catch (error) {
      await updateStep('outreach', 'failed', undefined, String(error))
      throw error
    }
  }

  // Launch campaign
  const launchCampaign = async (): Promise<CampaignState> => {
    await updateStep('launch', 'running')

    try {
      // Publish all content
      for (const content of campaign.content) {
        if (content.status === 'draft') {
          content.status = 'published'
          content.publishedAt = new Date().toISOString()
        }
      }

      // Activate all outreach sequences
      for (const sequence of campaign.outreach) {
        if (sequence.status === 'pending') {
          sequence.status = 'active'
          sequence.startedAt = new Date().toISOString()
        }
      }

      // Update campaign status
      campaign.status = 'launched'
      campaign.launchedAt = new Date().toISOString()

      await updateStep('launch', 'completed', {
        contentPublished: campaign.content.filter(c => c.status === 'published').length,
        outreachActive: campaign.outreach.filter(o => o.status === 'active').length,
      })

      return campaign
    } catch (error) {
      await updateStep('launch', 'failed', undefined, String(error))
      throw error
    }
  }

  // Optimize messaging
  const optimize = async (): Promise<string> => {
    const metrics = campaign.metrics
    const abResults = {
      content: campaign.content
        .filter(c => c.metrics)
        .map(c => ({
          variant: c.variant || 'default',
          views: c.metrics!.views,
          conversions: c.metrics!.conversions,
        })),
      outreach: campaign.outreach.flatMap(seq =>
        seq.emails
          .filter(e => e.variant)
          .map(e => ({
            variant: e.variant!,
            opens: e.openedAt ? 1 : 0,
            clicks: e.clickedAt ? 1 : 0,
            replies: e.repliedAt ? 1 : 0,
          }))
      ),
    }

    return mark.optimizeMessaging(
      {
        views: campaign.content.reduce((sum, c) => sum + (c.metrics?.views || 0), 0),
        clicks: campaign.content.reduce((sum, c) => sum + (c.metrics?.clicks || 0), 0),
        shares: campaign.content.reduce((sum, c) => sum + (c.metrics?.shares || 0), 0),
        conversions: metrics.conversions,
        engagementRate: metrics.clickRate,
      },
      abResults
    )
  }

  // Execute full workflow
  const execute = async (): Promise<CampaignState> => {
    state.status = 'running'
    state.startedAt = new Date().toISOString()

    try {
      await createNarrative()
      await generateContent()

      if (campaign.leads.length > 0) {
        await generateOutreach()
      }

      await launchCampaign()

      state.status = 'completed'
      state.completedAt = new Date().toISOString()
      await emit({ type: 'workflow_complete', data: campaign })

      return campaign
    } catch (error) {
      state.status = 'failed'
      state.completedAt = new Date().toISOString()
      await emit({ type: 'workflow_error', error: String(error) })
      throw error
    }
  }

  // Get progress
  const getProgress = () => {
    const completed = state.steps.filter(s => s.status === 'completed').length
    const total = state.steps.length
    return {
      completed,
      total,
      percentage: Math.round((completed / total) * 100),
    }
  }

  return {
    get state() {
      return state
    },
    execute,
    createNarrative,
    generateContent,
    generateOutreach,
    launch: launchCampaign,
    optimize,
    getProgress,
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { createLaunchWorkflow as launchWorkflow }
export default createLaunchWorkflow
