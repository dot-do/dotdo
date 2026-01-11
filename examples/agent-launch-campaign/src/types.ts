/**
 * Agent Launch Campaign - Type Definitions
 *
 * Shared types for the Mark + Sally launch campaign system.
 *
 * @module agent-launch-campaign/types
 */

// ============================================================================
// PRODUCT TYPES
// ============================================================================

/**
 * Product being launched
 */
export interface Product {
  name: string
  tagline: string
  description?: string
  features?: string[]
  targetAudience?: string
  pricing?: string
  websiteUrl?: string
}

// ============================================================================
// NARRATIVE TYPES
// ============================================================================

/**
 * Launch narrative - the core story (StoryBrand-style)
 */
export interface Narrative {
  /** Attention-grabbing opener */
  hook: string
  /** The pain point */
  problem: string
  /** How the product solves it */
  solution: string
  /** The before/after */
  transformation: string
  /** What to do next */
  callToAction: string
  /** 3-5 core messages */
  keyMessages: string[]
}

// ============================================================================
// CONTENT TYPES
// ============================================================================

/**
 * Content type options
 */
export type ContentType =
  | 'blog'
  | 'landing-page'
  | 'email'
  | 'twitter-thread'
  | 'linkedin-post'
  | 'press-release'

/**
 * Content status
 */
export type ContentStatus = 'draft' | 'published' | 'scheduled'

/**
 * A/B test variant
 */
export type Variant = 'A' | 'B'

/**
 * Content piece (blog post, landing page, etc.)
 */
export interface Content {
  $id: string
  type: ContentType
  title: string
  body: string
  variant?: Variant
  status: ContentStatus
  publishedAt?: string
  metrics?: ContentMetrics
}

/**
 * Content performance metrics
 */
export interface ContentMetrics {
  views: number
  clicks: number
  shares: number
  conversions: number
  engagementRate: number
}

// ============================================================================
// LEAD TYPES
// ============================================================================

/**
 * Company size categories
 */
export type CompanySize = 'startup' | 'smb' | 'mid-market' | 'enterprise'

/**
 * Lead status in the funnel
 */
export type LeadStatus =
  | 'new'
  | 'qualified'
  | 'contacted'
  | 'responded'
  | 'converted'
  | 'unsubscribed'

/**
 * Lead for outreach
 */
export interface Lead {
  $id: string
  email: string
  name: string
  company?: string
  title?: string
  industry?: string
  companySize?: CompanySize
  status: LeadStatus
  source?: string
  notes?: string
}

// ============================================================================
// OUTREACH TYPES
// ============================================================================

/**
 * Outreach sequence status
 */
export type OutreachStatus = 'pending' | 'active' | 'completed' | 'paused'

/**
 * Single email in an outreach sequence
 */
export interface OutreachEmail {
  step: number
  subject: string
  body: string
  variant?: Variant
  scheduledFor?: string
  sentAt?: string
  openedAt?: string
  clickedAt?: string
  repliedAt?: string
}

/**
 * Personalized outreach sequence for a lead
 */
export interface OutreachSequence {
  $id: string
  leadId: string
  emails: OutreachEmail[]
  status: OutreachStatus
  startedAt?: string
  completedAt?: string
}

// ============================================================================
// CAMPAIGN TYPES
// ============================================================================

/**
 * Campaign status
 */
export type CampaignStatus = 'draft' | 'preparing' | 'ready' | 'launched' | 'completed'

/**
 * Campaign configuration
 */
export interface CampaignConfig {
  product: Product
  launchDate?: string
  targetLeadCount?: number
  abTestingEnabled?: boolean
  /** Days between follow-ups [0, 3, 7, 14] */
  followUpDays?: number[]
}

/**
 * Overall campaign metrics
 */
export interface CampaignMetrics {
  totalLeads: number
  emailsSent: number
  emailsOpened: number
  emailsClicked: number
  replies: number
  conversions: number
  openRate: number
  clickRate: number
  replyRate: number
  conversionRate: number
}

/**
 * Full campaign state
 */
export interface CampaignState {
  config: CampaignConfig
  narrative?: Narrative
  content: Content[]
  leads: Lead[]
  outreach: OutreachSequence[]
  metrics: CampaignMetrics
  status: CampaignStatus
  createdAt: string
  launchedAt?: string
}

// ============================================================================
// A/B TEST TYPES
// ============================================================================

/**
 * Content A/B test results
 */
export interface ContentABResult {
  variant: string
  views: number
  conversions: number
}

/**
 * Outreach A/B test results
 */
export interface OutreachABResult {
  variant: string
  opens: number
  clicks: number
  replies: number
}

/**
 * Combined A/B test results
 */
export interface ABTestResults {
  content: ContentABResult[]
  outreach: OutreachABResult[]
}

// ============================================================================
// WORKFLOW TYPES
// ============================================================================

/**
 * Workflow step status
 */
export type WorkflowStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

/**
 * Individual workflow step
 */
export interface WorkflowStep {
  id: string
  name: string
  description: string
  status: WorkflowStepStatus
  startedAt?: string
  completedAt?: string
  result?: unknown
  error?: string
}

/**
 * Launch workflow state
 */
export interface LaunchWorkflowState {
  campaignId: string
  steps: WorkflowStep[]
  currentStep: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  startedAt?: string
  completedAt?: string
}
