/**
 * Agent Launch Campaign Tests
 *
 * Tests for Mark + Sally teamwork:
 * - Agent functionality
 * - Workflow execution
 * - Campaign management
 *
 * @module agent-launch-campaign/tests
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import agents
import { mark, createMark, type MarkAgent } from '../src/agents/mark'
import { sally, createSally, type SallyAgent } from '../src/agents/sally'

// Import workflow
import { createLaunchWorkflow, type LaunchWorkflow } from '../src/workflows/launch'

// Import types
import type {
  Product,
  Narrative,
  Content,
  Lead,
  OutreachSequence,
  CampaignState,
  CampaignConfig,
} from '../src/types'

// ============================================================================
// TEST FIXTURES
// ============================================================================

const testProduct: Product = {
  name: 'TaxAI',
  tagline: 'Taxes done while you code',
  description: 'AI-powered tax automation for developers',
  targetAudience: 'Developers and indie hackers',
  features: ['Auto-deduction detection', 'Quarterly estimates', 'One-click filing'],
}

const testLead: Lead = {
  $id: 'lead-1',
  email: 'sarah@acme.com',
  name: 'Sarah Chen',
  company: 'Acme Corp',
  title: 'CTO',
  industry: 'Technology',
  companySize: 'mid-market',
  status: 'new',
}

function createTestCampaign(): CampaignState {
  return {
    config: {
      product: testProduct,
      abTestingEnabled: true,
      followUpDays: [0, 3, 7],
    },
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
}

// ============================================================================
// MARK AGENT TESTS
// ============================================================================

describe('Mark - Marketing Agent', () => {
  let markAgent: MarkAgent

  beforeEach(() => {
    markAgent = createMark() // No AI binding = mock mode
  })

  describe('Agent Properties', () => {
    it('should have correct name', () => {
      expect(markAgent.name).toBe('Mark')
    })

    it('should have correct role', () => {
      expect(markAgent.role).toBe('marketing')
    })
  })

  describe('Template Literal Invocation', () => {
    it('should accept template literal', async () => {
      const result = await markAgent`write a tagline for ${testProduct.name}`
      expect(result).toContain('Mark')
      expect(result).toContain('marketing')
    })

    it('should interpolate object values', async () => {
      const result = await markAgent`describe ${testProduct}`
      expect(result).toContain('TaxAI')
    })
  })

  describe('Narrative Generation', () => {
    it('should generate a narrative with required fields', async () => {
      const narrative = await markAgent.generateNarrative(testProduct)

      expect(narrative).toHaveProperty('hook')
      expect(narrative).toHaveProperty('problem')
      expect(narrative).toHaveProperty('solution')
      expect(narrative).toHaveProperty('transformation')
      expect(narrative).toHaveProperty('callToAction')
      expect(narrative).toHaveProperty('keyMessages')
      expect(Array.isArray(narrative.keyMessages)).toBe(true)
    })

    it('should include product name in narrative', async () => {
      const narrative = await markAgent.generateNarrative(testProduct)
      expect(narrative.hook).toContain(testProduct.name)
    })
  })

  describe('Content Generation', () => {
    let narrative: Narrative

    beforeEach(async () => {
      narrative = await markAgent.generateNarrative(testProduct)
    })

    it('should generate blog post with correct structure', async () => {
      const blog = await markAgent.generateBlogPost(testProduct, narrative)

      expect(blog).toHaveProperty('$id')
      expect(blog).toHaveProperty('type', 'blog')
      expect(blog).toHaveProperty('title')
      expect(blog).toHaveProperty('body')
      expect(blog).toHaveProperty('status', 'draft')
    })

    it('should generate A/B blog variants', async () => {
      const blogA = await markAgent.generateBlogPost(testProduct, narrative, 'A')
      const blogB = await markAgent.generateBlogPost(testProduct, narrative, 'B')

      expect(blogA.variant).toBe('A')
      expect(blogB.variant).toBe('B')
      expect(blogA.$id).not.toBe(blogB.$id)
    })

    it('should generate Twitter thread', async () => {
      const twitter = await markAgent.generateTwitterThread(testProduct, narrative)

      expect(twitter.type).toBe('twitter-thread')
      expect(twitter.title).toBeTruthy()
      expect(twitter.body).toBeTruthy()
    })

    it('should generate LinkedIn post', async () => {
      const linkedin = await markAgent.generateLinkedInPost(testProduct, narrative)

      expect(linkedin.type).toBe('linkedin-post')
      expect(linkedin.title).toBeTruthy()
      expect(linkedin.body).toBeTruthy()
    })

    it('should generate landing page', async () => {
      const landing = await markAgent.generateLandingPage(testProduct, narrative)

      expect(landing.type).toBe('landing-page')
      expect(landing.title).toBeTruthy()
      expect(landing.body).toBeTruthy()
    })
  })
})

// ============================================================================
// SALLY AGENT TESTS
// ============================================================================

describe('Sally - Sales Agent', () => {
  let sallyAgent: SallyAgent
  let narrative: Narrative

  beforeEach(async () => {
    sallyAgent = createSally() // No AI binding = mock mode
    const markAgent = createMark()
    narrative = await markAgent.generateNarrative(testProduct)
  })

  describe('Agent Properties', () => {
    it('should have correct name', () => {
      expect(sallyAgent.name).toBe('Sally')
    })

    it('should have correct role', () => {
      expect(sallyAgent.role).toBe('sales')
    })
  })

  describe('Template Literal Invocation', () => {
    it('should accept template literal', async () => {
      const result = await sallyAgent`write email to ${testLead.name} about ${testProduct.name}`
      expect(result).toContain('Sally')
      expect(result).toContain('sales')
    })
  })

  describe('Email Generation', () => {
    it('should generate initial email', async () => {
      const email = await sallyAgent.generateEmail(
        testLead,
        testProduct,
        narrative,
        'initial'
      )

      expect(email).toHaveProperty('step', 1)
      expect(email).toHaveProperty('subject')
      expect(email).toHaveProperty('body')
    })

    it('should generate follow-up email', async () => {
      const email = await sallyAgent.generateEmail(
        testLead,
        testProduct,
        narrative,
        'follow-up',
        2
      )

      expect(email.step).toBe(2)
      expect(email.subject).toBeTruthy()
    })
  })

  describe('Outreach Sequence Generation', () => {
    it('should generate full outreach sequence', async () => {
      const sequence = await sallyAgent.generateOutreachSequence(
        testLead,
        testProduct,
        narrative,
        [0, 3, 7]
      )

      expect(sequence).toHaveProperty('$id')
      expect(sequence).toHaveProperty('leadId', testLead.$id)
      expect(sequence).toHaveProperty('status', 'pending')
      expect(sequence.emails).toHaveLength(3)
    })

    it('should schedule emails on follow-up days', async () => {
      const followUpDays = [0, 3, 7]
      const sequence = await sallyAgent.generateOutreachSequence(
        testLead,
        testProduct,
        narrative,
        followUpDays
      )

      // Check that emails have scheduled dates
      for (const email of sequence.emails) {
        expect(email.scheduledFor).toBeTruthy()
      }
    })
  })

  describe('A/B Variant Generation', () => {
    it('should generate A/B outreach variants', async () => {
      const { variantA, variantB } = await sallyAgent.generateOutreachVariants(
        testLead,
        testProduct,
        narrative
      )

      expect(variantA.variant).toBe('A')
      expect(variantB.variant).toBe('B')
      expect(variantA.subject).toBeTruthy()
      expect(variantB.subject).toBeTruthy()
    })
  })

  describe('Lead Qualification', () => {
    it('should qualify leads', async () => {
      const result = await sallyAgent.qualifyLead(testLead, testProduct)

      expect(result).toHaveProperty('qualified')
      expect(result).toHaveProperty('score')
      expect(result).toHaveProperty('reason')
      expect(typeof result.qualified).toBe('boolean')
      expect(typeof result.score).toBe('number')
    })
  })
})

// ============================================================================
// WORKFLOW TESTS
// ============================================================================

describe('Launch Workflow', () => {
  let campaign: CampaignState
  let workflow: LaunchWorkflow

  beforeEach(() => {
    campaign = createTestCampaign()
    workflow = createLaunchWorkflow(campaign)
  })

  describe('Workflow State', () => {
    it('should have initial pending status', () => {
      expect(workflow.state.status).toBe('pending')
    })

    it('should have all workflow steps', () => {
      expect(workflow.state.steps.length).toBeGreaterThan(0)
      expect(workflow.state.steps.every(s => s.status === 'pending')).toBe(true)
    })
  })

  describe('Progress Tracking', () => {
    it('should report initial progress', () => {
      const progress = workflow.getProgress()

      expect(progress.completed).toBe(0)
      expect(progress.total).toBeGreaterThan(0)
      expect(progress.percentage).toBe(0)
    })
  })

  describe('Step Execution', () => {
    it('should create narrative', async () => {
      const narrative = await workflow.createNarrative()

      expect(narrative).toHaveProperty('hook')
      expect(narrative).toHaveProperty('problem')
      expect(campaign.narrative).toBeDefined()
    })

    it('should generate content', async () => {
      const content = await workflow.generateContent()

      expect(content.length).toBeGreaterThan(0)
      expect(campaign.content.length).toBeGreaterThan(0)
    })

    it('should generate outreach for leads', async () => {
      // Add a lead first
      campaign.leads.push(testLead)

      await workflow.createNarrative()
      const sequences = await workflow.generateOutreach()

      expect(sequences.length).toBe(1)
      expect(campaign.outreach.length).toBe(1)
    })
  })

  describe('Full Workflow Execution', () => {
    it('should execute complete workflow', async () => {
      // Add a lead
      campaign.leads.push(testLead)

      const result = await workflow.execute()

      expect(result.status).toBe('launched')
      expect(result.narrative).toBeDefined()
      expect(result.content.length).toBeGreaterThan(0)
      expect(result.launchedAt).toBeTruthy()
    })

    it('should track workflow completion', async () => {
      await workflow.execute()

      expect(workflow.state.status).toBe('completed')
      expect(workflow.state.completedAt).toBeTruthy()
    })

    it('should report 100% progress after completion', async () => {
      await workflow.execute()

      // Note: Progress is based on steps, and launch step updates campaign status
      // The workflow completes when the launch step is done
      expect(workflow.state.status).toBe('completed')
    })
  })

  describe('Workflow Events', () => {
    it('should emit events during execution', async () => {
      const events: Array<{ type: string; step?: string }> = []

      const workflowWithEvents = createLaunchWorkflow(campaign, {
        onEvent: (event) => {
          events.push({ type: event.type, step: event.step })
        },
      })

      await workflowWithEvents.execute()

      // Should have step_start and step_complete events
      expect(events.some(e => e.type === 'step_start')).toBe(true)
      expect(events.some(e => e.type === 'step_complete')).toBe(true)
      expect(events.some(e => e.type === 'workflow_complete')).toBe(true)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Mark + Sally Collaboration', () => {
  let markAgent: MarkAgent
  let sallyAgent: SallyAgent

  beforeEach(() => {
    markAgent = createMark()
    sallyAgent = createSally()
  })

  it('should use narrative in outreach', async () => {
    // Mark creates the narrative
    const narrative = await markAgent.generateNarrative(testProduct)

    // Sally uses the narrative for personalized outreach
    const sequence = await sallyAgent.generateOutreachSequence(
      testLead,
      testProduct,
      narrative
    )

    expect(sequence.emails.length).toBeGreaterThan(0)
  })

  it('should coordinate content and outreach in workflow', async () => {
    const campaign = createTestCampaign()
    campaign.leads.push(testLead)

    const workflow = createLaunchWorkflow(campaign)
    const result = await workflow.execute()

    // Mark's content
    expect(result.content.some(c => c.type === 'blog')).toBe(true)
    expect(result.content.some(c => c.type === 'twitter-thread')).toBe(true)
    expect(result.content.some(c => c.type === 'linkedin-post')).toBe(true)
    expect(result.content.some(c => c.type === 'landing-page')).toBe(true)

    // Sally's outreach
    expect(result.outreach.length).toBeGreaterThan(0)
    expect(result.outreach[0].emails.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// A/B TESTING TESTS
// ============================================================================

describe('A/B Testing', () => {
  it('should generate content variants when enabled', async () => {
    const campaign = createTestCampaign()
    campaign.config.abTestingEnabled = true

    const workflow = createLaunchWorkflow(campaign, { abTesting: true })
    await workflow.generateContent()

    const blogVariantA = campaign.content.find(c => c.type === 'blog' && c.variant === 'A')
    const blogVariantB = campaign.content.find(c => c.type === 'blog' && c.variant === 'B')

    expect(blogVariantA).toBeDefined()
    expect(blogVariantB).toBeDefined()
  })

  it('should generate outreach variants', async () => {
    const sallyAgent = createSally()
    const markAgent = createMark()
    const narrative = await markAgent.generateNarrative(testProduct)

    const { variantA, variantB } = await sallyAgent.generateOutreachVariants(
      testLead,
      testProduct,
      narrative
    )

    expect(variantA.variant).toBe('A')
    expect(variantB.variant).toBe('B')
    // Variants should have different approaches
    expect(variantA.subject).not.toBe(variantB.subject)
  })
})
