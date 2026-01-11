/**
 * Named Agents - Re-exports for the agent-startup-launch example
 *
 * All agents from agents.do:
 * - Priya: Product manager (specs, roadmaps)
 * - Ralph: Engineering (builds code)
 * - Tom: Tech Lead (architecture, review)
 * - Mark: Marketing (content, launches)
 * - Sally: Sales (outreach, closing)
 *
 * @module agent-startup-launch/agents
 */

// Export system prompts and helpers
export { PRIYA_SYSTEM_PROMPT, parseProductSpec, formatProductSpec } from './priya'
export type { ProductSpec } from './priya'

export { RALPH_SYSTEM_PROMPT, parseBuildResult, formatBuildResult } from './ralph'
export type { BuildResult, CodeFile } from './ralph'

export { TOM_SYSTEM_PROMPT, parseReviewResult, formatReviewResult, hasCriticalIssues } from './tom'
export type { ReviewResult, ReviewIssue } from './tom'

export { MARK_SYSTEM_PROMPT, parseLaunchContent, formatLaunchContent } from './mark'
export type { LaunchContent, SocialPosts } from './mark'

export { SALLY_SYSTEM_PROMPT, parseSalesStrategy, formatSalesStrategy } from './sally'
export type { SalesStrategy, TargetSegment, Pricing, OutreachPlan, ObjectionHandling } from './sally'

// ============================================================================
// AGENT ROLES
// ============================================================================

export type AgentRole = 'product' | 'engineering' | 'tech-lead' | 'marketing' | 'sales'

export interface AgentConfig {
  name: string
  role: AgentRole
  systemPrompt: string
}

export const AGENTS: Record<string, AgentConfig> = {
  priya: {
    name: 'Priya',
    role: 'product',
    systemPrompt: 'priya',
  },
  ralph: {
    name: 'Ralph',
    role: 'engineering',
    systemPrompt: 'ralph',
  },
  tom: {
    name: 'Tom',
    role: 'tech-lead',
    systemPrompt: 'tom',
  },
  mark: {
    name: 'Mark',
    role: 'marketing',
    systemPrompt: 'mark',
  },
  sally: {
    name: 'Sally',
    role: 'sales',
    systemPrompt: 'sally',
  },
}
