/**
 * ProductDiscoveryDO - AI-powered product discovery Durable Object
 *
 * This DO demonstrates Priya (Product) leading discovery, with Quinn (QA)
 * validating specs. From hypothesis to roadmap in minutes.
 *
 * Features:
 * - MVP definition from hypotheses
 * - User story generation with acceptance criteria
 * - AI-powered prioritization
 * - Spec validation for testability
 * - Quarterly roadmap planning
 * - Strategic vs tactical planning modes
 */

import { DurableObject } from 'cloudflare:workers'
import { priya, quinn } from 'agents.do'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Planning mode determines depth and scope of output
 */
export type PlanningMode = 'strategic' | 'tactical'

/**
 * Priority levels for backlog items
 */
export type Priority = 'critical' | 'high' | 'medium' | 'low'

/**
 * Story status in the development lifecycle
 */
export type StoryStatus = 'draft' | 'validated' | 'ready' | 'in_progress' | 'done'

/**
 * Quarter identifier for roadmap planning
 */
export type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4'

/**
 * Minimum Viable Product definition
 */
export interface MVP {
  id: string
  hypothesis: string
  problem: string
  targetUser: string
  valueProp: string
  coreFeatures: string[]
  outOfScope: string[]
  successMetrics: string[]
  assumptions: string[]
  risks: string[]
  createdAt: string
}

/**
 * User story with acceptance criteria
 */
export interface UserStory {
  id: string
  mvpId: string
  title: string
  asA: string
  iWant: string
  soThat: string
  acceptanceCriteria: AcceptanceCriterion[]
  priority: Priority
  storyPoints?: number
  status: StoryStatus
  dependencies: string[]
  validatedAt?: string
  validationNotes?: string
}

/**
 * Acceptance criterion for a story
 */
export interface AcceptanceCriterion {
  id: string
  given: string
  when: string
  then: string
  isTestable: boolean
}

/**
 * Prioritized backlog with AI reasoning
 */
export interface PrioritizedBacklog {
  mvpId: string
  stories: UserStory[]
  reasoning: PrioritizationReasoning[]
  generatedAt: string
}

/**
 * AI reasoning for prioritization decisions
 */
export interface PrioritizationReasoning {
  storyId: string
  priority: Priority
  rationale: string
  impactScore: number
  effortEstimate: 'xs' | 's' | 'm' | 'l' | 'xl'
  riskFactors: string[]
}

/**
 * Quarterly roadmap with milestones
 */
export interface Roadmap {
  id: string
  mvpId: string
  year: number
  quarters: QuarterPlan[]
  dependencies: RoadmapDependency[]
  mode: PlanningMode
  createdAt: string
}

/**
 * Plan for a single quarter
 */
export interface QuarterPlan {
  quarter: Quarter
  theme: string
  goals: string[]
  stories: string[] // Story IDs
  milestones: Milestone[]
  capacity: number // Story points
}

/**
 * Milestone within a quarter
 */
export interface Milestone {
  id: string
  name: string
  targetDate: string
  deliverables: string[]
  successCriteria: string[]
}

/**
 * Dependency between roadmap items
 */
export interface RoadmapDependency {
  from: string // Story or milestone ID
  to: string
  type: 'blocks' | 'enables' | 'related'
}

/**
 * Spec validation result from Quinn
 */
export interface SpecValidation {
  storyId: string
  isTestable: boolean
  issues: ValidationIssue[]
  suggestions: string[]
  validatedAt: string
}

/**
 * Issue found during spec validation
 */
export interface ValidationIssue {
  criterionId: string
  type: 'ambiguous' | 'untestable' | 'incomplete' | 'contradictory'
  description: string
  suggestion: string
}

/**
 * Discovery session tracking
 */
export interface DiscoverySession {
  id: string
  startedAt: string
  hypothesis: string
  mvp?: MVP
  stories: UserStory[]
  backlog?: PrioritizedBacklog
  roadmap?: Roadmap
  mode: PlanningMode
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function parseJSON<T>(text: string, fallback: T): T {
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim())
    }
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

// ============================================================================
// PRODUCT DISCOVERY DO
// ============================================================================

interface Env {
  ENVIRONMENT?: string
}

export class ProductDiscoveryDO extends DurableObject<Env> {
  private sessions: Map<string, DiscoverySession> = new Map()
  private mvps: Map<string, MVP> = new Map()
  private stories: Map<string, UserStory> = new Map()
  private roadmaps: Map<string, Roadmap> = new Map()

  // ═══════════════════════════════════════════════════════════════════════════
  // MVP DEFINITION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Define an MVP from a hypothesis
   *
   * Priya analyzes the hypothesis and produces a structured MVP definition
   * including problem statement, target user, value proposition, and scope.
   */
  async defineMVP(hypothesis: string, mode: PlanningMode = 'tactical'): Promise<MVP> {
    const prompt = `
Define an MVP for the following hypothesis:

"${hypothesis}"

Planning mode: ${mode}
${mode === 'strategic' ? '(Focus on long-term vision and market positioning)' : '(Focus on immediate execution and quick wins)'}

Respond with a JSON object containing:
{
  "problem": "The core problem being solved",
  "targetUser": "Specific user persona",
  "valueProp": "Clear value proposition",
  "coreFeatures": ["feature1", "feature2", ...], // 3-5 essential features
  "outOfScope": ["item1", "item2", ...], // What we're NOT building
  "successMetrics": ["metric1", "metric2", ...], // How we measure success
  "assumptions": ["assumption1", ...], // What we're assuming is true
  "risks": ["risk1", ...] // Key risks to monitor
}

Be specific and actionable. Focus on the minimum needed to validate the hypothesis.
`

    const response = await priya`${prompt}`

    const parsed = parseJSON(response.toString(), {
      problem: hypothesis,
      targetUser: 'Early adopters',
      valueProp: 'Solve the core problem',
      coreFeatures: ['Core feature'],
      outOfScope: [],
      successMetrics: ['User adoption'],
      assumptions: [],
      risks: [],
    })

    const mvp: MVP = {
      id: generateId('mvp'),
      hypothesis,
      ...parsed,
      createdAt: new Date().toISOString(),
    }

    this.mvps.set(mvp.id, mvp)
    return mvp
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // USER STORY GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate user stories from an MVP
   *
   * Priya breaks down the MVP into actionable user stories with
   * acceptance criteria in Given/When/Then format.
   */
  async generateStories(mvpId: string): Promise<UserStory[]> {
    const mvp = this.mvps.get(mvpId)
    if (!mvp) {
      throw new Error(`MVP not found: ${mvpId}`)
    }

    const prompt = `
Break down this MVP into user stories:

Problem: ${mvp.problem}
Target User: ${mvp.targetUser}
Value Prop: ${mvp.valueProp}
Core Features: ${mvp.coreFeatures.join(', ')}

For each feature, create 1-3 user stories. Respond with a JSON array:
[
  {
    "title": "Short descriptive title",
    "asA": "user role",
    "iWant": "capability or feature",
    "soThat": "benefit or value",
    "acceptanceCriteria": [
      {
        "given": "initial context",
        "when": "action taken",
        "then": "expected outcome"
      }
    ],
    "dependencies": [] // IDs of stories this depends on (use index like "story-0")
  }
]

Make acceptance criteria specific and testable.
`

    const response = await priya`${prompt}`

    const parsed = parseJSON<Array<{
      title: string
      asA: string
      iWant: string
      soThat: string
      acceptanceCriteria: Array<{ given: string; when: string; then: string }>
      dependencies: string[]
    }>>(response.toString(), [])

    const stories: UserStory[] = parsed.map((s, index) => {
      const story: UserStory = {
        id: generateId('story'),
        mvpId,
        title: s.title,
        asA: s.asA,
        iWant: s.iWant,
        soThat: s.soThat,
        acceptanceCriteria: s.acceptanceCriteria.map(ac => ({
          id: generateId('ac'),
          given: ac.given,
          when: ac.when,
          then: ac.then,
          isTestable: true, // Will be validated by Quinn
        })),
        priority: 'medium',
        status: 'draft',
        dependencies: s.dependencies,
      }
      this.stories.set(story.id, story)
      return story
    })

    return stories
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORITIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Prioritize backlog with AI reasoning
   *
   * Priya analyzes stories and prioritizes by impact, considering
   * dependencies, risk, and strategic alignment.
   */
  async prioritizeBacklog(mvpId: string): Promise<PrioritizedBacklog> {
    const mvp = this.mvps.get(mvpId)
    if (!mvp) {
      throw new Error(`MVP not found: ${mvpId}`)
    }

    const stories = Array.from(this.stories.values()).filter(s => s.mvpId === mvpId)

    if (stories.length === 0) {
      throw new Error('No stories found for this MVP. Generate stories first.')
    }

    const prompt = `
Prioritize these user stories for the MVP:

MVP Context:
- Problem: ${mvp.problem}
- Target User: ${mvp.targetUser}
- Success Metrics: ${mvp.successMetrics.join(', ')}

Stories to prioritize:
${stories.map(s => `- ${s.id}: "${s.title}" (As a ${s.asA}, I want ${s.iWant})`).join('\n')}

Respond with a JSON object:
{
  "prioritization": [
    {
      "storyId": "story-id",
      "priority": "critical|high|medium|low",
      "rationale": "Why this priority",
      "impactScore": 1-10,
      "effortEstimate": "xs|s|m|l|xl",
      "riskFactors": ["risk1", ...]
    }
  ]
}

Prioritize by:
1. Impact on success metrics
2. Dependencies (blockers first)
3. Risk reduction
4. User value
`

    const response = await priya`${prompt}`

    const parsed = parseJSON<{
      prioritization: PrioritizationReasoning[]
    }>(response.toString(), { prioritization: [] })

    // Update stories with priorities
    for (const p of parsed.prioritization) {
      const story = this.stories.get(p.storyId)
      if (story) {
        story.priority = p.priority
        this.stories.set(p.storyId, story)
      }
    }

    // Sort by priority
    const priorityOrder: Record<Priority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    }

    const sortedStories = [...stories].sort((a, b) =>
      priorityOrder[a.priority] - priorityOrder[b.priority]
    )

    return {
      mvpId,
      stories: sortedStories,
      reasoning: parsed.prioritization,
      generatedAt: new Date().toISOString(),
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SPEC VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validate specs with Quinn
   *
   * Quinn reviews acceptance criteria for testability, identifies
   * ambiguities, and suggests improvements.
   */
  async validateSpec(storyId: string): Promise<SpecValidation> {
    const story = this.stories.get(storyId)
    if (!story) {
      throw new Error(`Story not found: ${storyId}`)
    }

    const prompt = `
Validate this user story for testability:

Title: ${story.title}
As a: ${story.asA}
I want: ${story.iWant}
So that: ${story.soThat}

Acceptance Criteria:
${story.acceptanceCriteria.map((ac, i) => `
${i + 1}. Given: ${ac.given}
   When: ${ac.when}
   Then: ${ac.then}
`).join('\n')}

Analyze each criterion and respond with JSON:
{
  "isTestable": true|false,
  "issues": [
    {
      "criterionIndex": 0,
      "type": "ambiguous|untestable|incomplete|contradictory",
      "description": "What's wrong",
      "suggestion": "How to fix it"
    }
  ],
  "suggestions": ["General improvements"]
}

Focus on:
1. Can this be automated tested?
2. Are the conditions specific enough?
3. Are expected outcomes measurable?
`

    const response = await quinn`${prompt}`

    const parsed = parseJSON<{
      isTestable: boolean
      issues: Array<{
        criterionIndex: number
        type: 'ambiguous' | 'untestable' | 'incomplete' | 'contradictory'
        description: string
        suggestion: string
      }>
      suggestions: string[]
    }>(response.toString(), { isTestable: true, issues: [], suggestions: [] })

    // Update story validation status
    story.status = parsed.isTestable ? 'validated' : 'draft'
    story.validatedAt = new Date().toISOString()
    story.validationNotes = parsed.issues.length > 0
      ? `${parsed.issues.length} issue(s) found`
      : 'All criteria are testable'

    // Update acceptance criteria testability
    for (const issue of parsed.issues) {
      if (story.acceptanceCriteria[issue.criterionIndex]) {
        story.acceptanceCriteria[issue.criterionIndex].isTestable = false
      }
    }

    this.stories.set(storyId, story)

    return {
      storyId,
      isTestable: parsed.isTestable,
      issues: parsed.issues.map(i => ({
        criterionId: story.acceptanceCriteria[i.criterionIndex]?.id || 'unknown',
        type: i.type,
        description: i.description,
        suggestion: i.suggestion,
      })),
      suggestions: parsed.suggestions,
      validatedAt: new Date().toISOString(),
    }
  }

  /**
   * Validate all specs for an MVP
   */
  async validateAllSpecs(mvpId: string): Promise<SpecValidation[]> {
    const stories = Array.from(this.stories.values()).filter(s => s.mvpId === mvpId)
    const validations = await Promise.all(stories.map(s => this.validateSpec(s.id)))
    return validations
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROADMAP PLANNING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create quarterly roadmap from validated stories
   *
   * Priya organizes stories into quarters with themes, milestones,
   * and dependencies. Supports strategic and tactical modes.
   */
  async createRoadmap(
    mvpId: string,
    year: number = new Date().getFullYear(),
    mode: PlanningMode = 'tactical'
  ): Promise<Roadmap> {
    const mvp = this.mvps.get(mvpId)
    if (!mvp) {
      throw new Error(`MVP not found: ${mvpId}`)
    }

    const stories = Array.from(this.stories.values())
      .filter(s => s.mvpId === mvpId && s.status === 'validated')

    if (stories.length === 0) {
      throw new Error('No validated stories. Validate specs first.')
    }

    const prompt = `
Create a ${mode} quarterly roadmap for ${year}:

MVP: ${mvp.valueProp}
Success Metrics: ${mvp.successMetrics.join(', ')}

Validated Stories:
${stories.map(s => `- ${s.id}: "${s.title}" [${s.priority}]`).join('\n')}

${mode === 'strategic'
  ? 'Focus on long-term positioning, market fit, and competitive advantage.'
  : 'Focus on quick wins, user feedback loops, and iterative delivery.'}

Respond with JSON:
{
  "quarters": [
    {
      "quarter": "Q1|Q2|Q3|Q4",
      "theme": "Quarter theme",
      "goals": ["goal1", "goal2"],
      "storyIds": ["story-id1", ...],
      "milestones": [
        {
          "name": "Milestone name",
          "targetDate": "YYYY-MM-DD",
          "deliverables": ["deliverable1"],
          "successCriteria": ["criterion1"]
        }
      ],
      "capacity": 20 // Story points
    }
  ],
  "dependencies": [
    {
      "from": "story-id or milestone",
      "to": "story-id or milestone",
      "type": "blocks|enables|related"
    }
  ]
}

Ensure dependencies are respected and capacity is realistic.
`

    const response = await priya`${prompt}`

    const parsed = parseJSON<{
      quarters: Array<{
        quarter: Quarter
        theme: string
        goals: string[]
        storyIds: string[]
        milestones: Array<{
          name: string
          targetDate: string
          deliverables: string[]
          successCriteria: string[]
        }>
        capacity: number
      }>
      dependencies: RoadmapDependency[]
    }>(response.toString(), { quarters: [], dependencies: [] })

    const roadmap: Roadmap = {
      id: generateId('roadmap'),
      mvpId,
      year,
      quarters: parsed.quarters.map(q => ({
        quarter: q.quarter,
        theme: q.theme,
        goals: q.goals,
        stories: q.storyIds,
        milestones: q.milestones.map(m => ({
          id: generateId('ms'),
          name: m.name,
          targetDate: m.targetDate,
          deliverables: m.deliverables,
          successCriteria: m.successCriteria,
        })),
        capacity: q.capacity,
      })),
      dependencies: parsed.dependencies,
      mode,
      createdAt: new Date().toISOString(),
    }

    this.roadmaps.set(roadmap.id, roadmap)
    return roadmap
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DISCOVERY SESSION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Run a complete discovery session
   *
   * Orchestrates the full flow from hypothesis to roadmap:
   * 1. Define MVP
   * 2. Generate stories
   * 3. Prioritize backlog
   * 4. Validate specs (Quinn)
   * 5. Create roadmap
   */
  async runDiscovery(
    hypothesis: string,
    mode: PlanningMode = 'tactical'
  ): Promise<DiscoverySession> {
    const sessionId = generateId('session')

    const session: DiscoverySession = {
      id: sessionId,
      startedAt: new Date().toISOString(),
      hypothesis,
      stories: [],
      mode,
    }

    // Step 1: Define MVP
    session.mvp = await this.defineMVP(hypothesis, mode)

    // Step 2: Generate stories
    session.stories = await this.generateStories(session.mvp.id)

    // Step 3: Prioritize
    session.backlog = await this.prioritizeBacklog(session.mvp.id)

    // Step 4: Validate specs
    await this.validateAllSpecs(session.mvp.id)

    // Step 5: Create roadmap
    session.roadmap = await this.createRoadmap(session.mvp.id, new Date().getFullYear(), mode)

    this.sessions.set(sessionId, session)
    return session
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QUERIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get an MVP by ID
   */
  getMVP(id: string): MVP | null {
    return this.mvps.get(id) || null
  }

  /**
   * Get all MVPs
   */
  getMVPs(): MVP[] {
    return Array.from(this.mvps.values())
  }

  /**
   * Get a story by ID
   */
  getStory(id: string): UserStory | null {
    return this.stories.get(id) || null
  }

  /**
   * Get stories for an MVP
   */
  getStories(mvpId: string): UserStory[] {
    return Array.from(this.stories.values()).filter(s => s.mvpId === mvpId)
  }

  /**
   * Get a roadmap by ID
   */
  getRoadmap(id: string): Roadmap | null {
    return this.roadmaps.get(id) || null
  }

  /**
   * Get a discovery session by ID
   */
  getSession(id: string): DiscoverySession | null {
    return this.sessions.get(id) || null
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Handle RPC endpoint
    if (url.pathname === '/rpc' && request.method === 'POST') {
      try {
        const body = await request.json() as {
          jsonrpc: string
          id: number
          method: string
          params?: unknown[]
        }
        const { method, params = [], id } = body

        // Call the method on this DO
        const methodFn = (this as unknown as Record<string, (...args: unknown[]) => unknown>)[method]
        if (typeof methodFn !== 'function') {
          return Response.json({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method '${method}' not found` },
          }, { status: 400 })
        }

        const result = await methodFn.apply(this, params)
        return Response.json({ jsonrpc: '2.0', id, result })
      } catch (error) {
        return Response.json({
          jsonrpc: '2.0',
          id: 0,
          error: { code: -32603, message: String(error) },
        }, { status: 500 })
      }
    }

    return new Response('Not Found', { status: 404 })
  }
}

export default ProductDiscoveryDO
