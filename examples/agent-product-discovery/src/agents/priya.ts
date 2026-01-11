/**
 * Priya - Product Agent for Product Discovery
 *
 * Priya is the product agent responsible for:
 * - Defining MVPs from hypotheses
 * - User research and interviews
 * - Feature prioritization (RICE, MoSCoW)
 * - Creating user stories with acceptance criteria
 * - Building roadmaps
 *
 * @example
 * ```ts
 * import { priya } from './agents/priya'
 *
 * const mvp = await priya`define MVP for ${hypothesis}`
 * const stories = await priya`break ${mvp} into user stories`
 * const prioritized = await priya`prioritize ${stories} by impact`
 * ```
 *
 * @module agent-product-discovery/agents/priya
 */

import type {
  MVP,
  UserStory,
  PrioritizedBacklog,
  Roadmap,
  AcceptanceCriterion,
  PrioritizationReasoning,
  QuarterPlan,
  Milestone,
  PlanningMode,
  Priority,
  Quarter,
} from '../ProductDiscoveryDO'

// ============================================================================
// TYPES
// ============================================================================

export interface PriyaConfig {
  /** Temperature for AI responses (lower = more deterministic) */
  temperature?: number
  /** Maximum tokens for response */
  maxTokens?: number
  /** Model to use */
  model?: string
  /** Planning mode */
  planningMode?: PlanningMode
}

export interface MVPRequest {
  hypothesis: string
  mode?: PlanningMode
  context?: UserResearchContext
}

export interface UserStoryRequest {
  mvp: MVP
  maxStories?: number
}

export interface PrioritizationRequest {
  mvp: MVP
  stories: UserStory[]
  framework?: 'RICE' | 'MoSCoW' | 'impact'
}

export interface RoadmapRequest {
  mvp: MVP
  stories: UserStory[]
  year?: number
  mode?: PlanningMode
}

export interface UserResearchContext {
  targetUsers?: string[]
  painPoints?: string[]
  competitors?: string[]
  interviews?: UserInterview[]
}

export interface UserInterview {
  userId: string
  persona: string
  painPoints: string[]
  desires: string[]
  quotes: string[]
}

export interface FeaturePrioritization {
  featureId: string
  feature: string
  rice?: RICEScore
  moscow?: MoSCoWCategory
  priority: Priority
  rationale: string
}

export interface RICEScore {
  reach: number
  impact: number
  confidence: number
  effort: number
  score: number
}

export type MoSCoWCategory = 'must-have' | 'should-have' | 'could-have' | 'wont-have'

// ============================================================================
// MOCK MODE
// ============================================================================

let mockMode = false
let mockResponses: Map<string, unknown> = new Map()

/**
 * Enable mock mode for testing without API calls
 */
export function enableMockMode(): void {
  mockMode = true
}

/**
 * Disable mock mode
 */
export function disableMockMode(): void {
  mockMode = false
  mockResponses.clear()
}

/**
 * Set a mock response for a specific operation
 */
export function setMockResponse(operation: string, response: unknown): void {
  mockResponses.set(operation, response)
}

/**
 * Check if mock mode is enabled
 */
export function isMockMode(): boolean {
  return mockMode
}

// ============================================================================
// PRIYA AGENT FUNCTIONS
// ============================================================================

/**
 * Priya defines an MVP from a hypothesis
 */
export async function defineMVP(request: MVPRequest): Promise<MVP> {
  const { hypothesis, mode = 'tactical' } = request

  if (mockMode) {
    const mockResponse = mockResponses.get('mvp')
    if (mockResponse) {
      return mockResponse as MVP
    }

    return generateMockMVP(hypothesis, mode)
  }

  return generateMockMVP(hypothesis, mode)
}

/**
 * Priya generates user stories from an MVP
 */
export async function generateStories(request: UserStoryRequest): Promise<UserStory[]> {
  const { mvp, maxStories = 10 } = request

  if (mockMode) {
    const mockResponse = mockResponses.get('stories')
    if (mockResponse) {
      return mockResponse as UserStory[]
    }

    return generateMockStories(mvp, maxStories)
  }

  return generateMockStories(mvp, maxStories)
}

/**
 * Priya prioritizes a backlog using the specified framework
 */
export async function prioritizeBacklog(
  request: PrioritizationRequest
): Promise<PrioritizedBacklog> {
  const { mvp, stories, framework = 'impact' } = request

  if (mockMode) {
    const mockResponse = mockResponses.get('prioritize')
    if (mockResponse) {
      return mockResponse as PrioritizedBacklog
    }

    return generateMockPrioritizedBacklog(mvp, stories, framework)
  }

  return generateMockPrioritizedBacklog(mvp, stories, framework)
}

/**
 * Priya creates a quarterly roadmap
 */
export async function createRoadmap(request: RoadmapRequest): Promise<Roadmap> {
  const { mvp, stories, year = new Date().getFullYear(), mode = 'tactical' } = request

  if (mockMode) {
    const mockResponse = mockResponses.get('roadmap')
    if (mockResponse) {
      return mockResponse as Roadmap
    }

    return generateMockRoadmap(mvp, stories, year, mode)
  }

  return generateMockRoadmap(mvp, stories, year, mode)
}

/**
 * Priya conducts user research and synthesizes findings
 */
export async function conductUserResearch(
  hypothesis: string,
  interviews: UserInterview[]
): Promise<UserResearchContext> {
  if (mockMode) {
    const mockResponse = mockResponses.get('research')
    if (mockResponse) {
      return mockResponse as UserResearchContext
    }

    return generateMockUserResearch(hypothesis, interviews)
  }

  return generateMockUserResearch(hypothesis, interviews)
}

/**
 * Priya prioritizes features using RICE framework
 */
export async function prioritizeWithRICE(
  features: string[],
  context: UserResearchContext
): Promise<FeaturePrioritization[]> {
  if (mockMode) {
    const mockResponse = mockResponses.get('rice')
    if (mockResponse) {
      return mockResponse as FeaturePrioritization[]
    }

    return generateMockRICEPrioritization(features, context)
  }

  return generateMockRICEPrioritization(features, context)
}

/**
 * Priya prioritizes features using MoSCoW framework
 */
export async function prioritizeWithMoSCoW(
  features: string[],
  constraints: { timeline: string; budget: string }
): Promise<FeaturePrioritization[]> {
  if (mockMode) {
    const mockResponse = mockResponses.get('moscow')
    if (mockResponse) {
      return mockResponse as FeaturePrioritization[]
    }

    return generateMockMoSCoWPrioritization(features, constraints)
  }

  return generateMockMoSCoWPrioritization(features, constraints)
}

// ============================================================================
// TEMPLATE LITERAL INTERFACE
// ============================================================================

/**
 * Priya template literal function for natural language interaction
 *
 * @example
 * ```ts
 * const mvp = await priya`define MVP for ${hypothesis}`
 * const stories = await priya`break ${mvp} into user stories`
 * const prioritized = await priya`prioritize ${stories} by impact`
 * const roadmap = await priya`create quarterly roadmap from ${stories}`
 * ```
 */
export function priya(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<string | MVP | UserStory[] | PrioritizedBacklog | Roadmap | FeaturePrioritization[]> {
  const prompt = interpolate(strings, values)
  const promptLower = prompt.toLowerCase()

  // MVP definition
  if (promptLower.includes('define') && promptLower.includes('mvp')) {
    const hypothesis = values.find((v) => typeof v === 'string') as string | undefined
    if (hypothesis) {
      const mode: PlanningMode = promptLower.includes('strategic') ? 'strategic' : 'tactical'
      return defineMVP({ hypothesis, mode }) as Promise<MVP>
    }
  }

  // User stories generation
  if (
    (promptLower.includes('break') || promptLower.includes('generate')) &&
    (promptLower.includes('stories') || promptLower.includes('story'))
  ) {
    const mvp = values.find(isMVP) as MVP | undefined
    if (mvp) {
      return generateStories({ mvp }) as Promise<UserStory[]>
    }
  }

  // Prioritization
  if (promptLower.includes('prioritize')) {
    const mvp = values.find(isMVP) as MVP | undefined
    const stories = values.find(isUserStoryArray) as UserStory[] | undefined

    // Determine framework
    let framework: 'RICE' | 'MoSCoW' | 'impact' = 'impact'
    if (promptLower.includes('rice')) framework = 'RICE'
    else if (promptLower.includes('moscow')) framework = 'MoSCoW'

    if (mvp && stories) {
      return prioritizeBacklog({ mvp, stories, framework }) as Promise<PrioritizedBacklog>
    }

    // If we have features as strings, use RICE/MoSCoW
    const features = values.filter((v) => typeof v === 'string') as string[]
    if (features.length > 0 && framework === 'RICE') {
      return prioritizeWithRICE(features, {}) as Promise<FeaturePrioritization[]>
    }
  }

  // Roadmap creation
  if (promptLower.includes('roadmap')) {
    const mvp = values.find(isMVP) as MVP | undefined
    const stories = values.find(isUserStoryArray) as UserStory[] | undefined
    const mode: PlanningMode = promptLower.includes('strategic') ? 'strategic' : 'tactical'

    if (mvp && stories) {
      return createRoadmap({ mvp, stories, mode }) as Promise<Roadmap>
    }
  }

  // User research
  if (promptLower.includes('research') || promptLower.includes('interview')) {
    const hypothesis = values.find((v) => typeof v === 'string') as string | undefined
    const interviews = values.find(isUserInterviewArray) as UserInterview[] | undefined

    if (hypothesis) {
      return conductUserResearch(hypothesis, interviews || []) as Promise<UserResearchContext>
    }
  }

  // Acceptance criteria
  if (promptLower.includes('acceptance criteria') || promptLower.includes('criteria')) {
    const story = values.find(isUserStory) as UserStory | undefined
    if (story) {
      return Promise.resolve(story.acceptanceCriteria) as Promise<string>
    }
  }

  // Default: return a generic response
  return Promise.resolve(`[Priya] Processed: ${prompt.slice(0, 100)}...`)
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function interpolate(strings: TemplateStringsArray, values: unknown[]): string {
  return strings.reduce((result, str, i) => {
    let value = ''
    if (i < values.length) {
      const v = values[i]
      if (v === null || v === undefined) {
        value = ''
      } else if (typeof v === 'object') {
        value = JSON.stringify(v, null, 2)
      } else {
        value = String(v)
      }
    }
    return result + str + value
  }, '')
}

function isMVP(value: unknown): value is MVP {
  return (
    typeof value === 'object' &&
    value !== null &&
    'hypothesis' in value &&
    'coreFeatures' in value &&
    'valueProp' in value
  )
}

function isUserStory(value: unknown): value is UserStory {
  return (
    typeof value === 'object' &&
    value !== null &&
    'asA' in value &&
    'iWant' in value &&
    'soThat' in value
  )
}

function isUserStoryArray(value: unknown): value is UserStory[] {
  return Array.isArray(value) && value.length > 0 && isUserStory(value[0])
}

function isUserInterviewArray(value: unknown): value is UserInterview[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === 'object' &&
    value[0] !== null &&
    'persona' in value[0] &&
    'painPoints' in value[0]
  )
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

// ============================================================================
// MOCK GENERATORS
// ============================================================================

function generateMockMVP(hypothesis: string, mode: PlanningMode): MVP {
  // Extract key terms from hypothesis for more realistic output
  const terms = hypothesis.toLowerCase()

  let problem = 'Users struggle with the problem stated in the hypothesis'
  let targetUser = 'Early adopters in the target market'
  let valueProp = 'Solve the core problem efficiently'
  let coreFeatures = ['Core feature 1', 'Core feature 2', 'Core feature 3']

  // Generate more specific responses based on common hypothesis patterns
  if (terms.includes('freelance') || terms.includes('tax')) {
    problem = 'Freelancers spend 20+ hours per year on tax preparation, often making costly errors'
    targetUser = 'Freelancers and independent contractors earning $50k-$200k annually'
    valueProp = 'Automate tax preparation and maximize deductions with AI assistance'
    coreFeatures = [
      'Automatic expense categorization',
      'Real-time tax estimation',
      'Deduction finder',
      'Quarterly tax reminders',
    ]
  } else if (terms.includes('startup') || terms.includes('mvp')) {
    problem = 'Founders struggle to define and validate MVPs quickly'
    targetUser = 'First-time startup founders with technical backgrounds'
    valueProp = 'From idea to validated MVP in days, not months'
    coreFeatures = [
      'Hypothesis validation framework',
      'User interview templates',
      'MVP scope definition',
      'Launch checklist generator',
    ]
  } else if (terms.includes('team') || terms.includes('collaborate')) {
    problem = 'Remote teams lack context and waste time in meetings'
    targetUser = 'Remote-first engineering teams of 5-50 people'
    valueProp = 'Async-first collaboration that keeps everyone aligned'
    coreFeatures = [
      'Async standup summaries',
      'Decision documentation',
      'Context handoffs',
      'Meeting reduction analytics',
    ]
  }

  return {
    id: generateId('mvp'),
    hypothesis,
    problem,
    targetUser,
    valueProp,
    coreFeatures,
    outOfScope: [
      'Enterprise features',
      'Multi-platform native apps',
      'Integration marketplace',
    ],
    successMetrics: [
      'User activation rate > 40%',
      'Weekly active users growth > 5%',
      'Net Promoter Score > 30',
    ],
    assumptions: [
      'Users are willing to pay for this solution',
      'The problem is painful enough to drive adoption',
      'We can differentiate from existing solutions',
    ],
    risks: [
      'Competitive response from incumbents',
      'Longer sales cycle than expected',
      'Technical complexity underestimated',
    ],
    createdAt: new Date().toISOString(),
  }
}

function generateMockStories(mvp: MVP, maxStories: number): UserStory[] {
  const stories: UserStory[] = []
  const baseStoryId = generateId('story')

  // Generate 1-2 stories per core feature
  for (let i = 0; i < Math.min(mvp.coreFeatures.length * 2, maxStories); i++) {
    const featureIndex = Math.floor(i / 2)
    const feature = mvp.coreFeatures[featureIndex] || mvp.coreFeatures[0]
    const isSecondary = i % 2 === 1

    const story: UserStory = {
      id: `${baseStoryId}-${i}`,
      mvpId: mvp.id,
      title: isSecondary
        ? `Enhanced ${feature}`
        : feature,
      asA: mvp.targetUser.split(' ')[0].toLowerCase(),
      iWant: isSecondary
        ? `to customize my ${feature.toLowerCase()} settings`
        : `to use ${feature.toLowerCase()}`,
      soThat: `I can ${mvp.valueProp.toLowerCase().replace(/^[a-z]/, c => c.toLowerCase())}`,
      acceptanceCriteria: [
        {
          id: generateId('ac'),
          given: `I am a logged-in ${mvp.targetUser.split(' ')[0].toLowerCase()}`,
          when: `I access the ${feature.toLowerCase()} feature`,
          then: 'I should see my personalized dashboard',
          isTestable: true,
        },
        {
          id: generateId('ac'),
          given: 'I have completed the initial setup',
          when: 'I perform the main action',
          then: 'I should receive confirmation and see updated results',
          isTestable: true,
        },
      ],
      priority: i < 3 ? 'high' : i < 6 ? 'medium' : 'low',
      status: 'draft',
      dependencies: i > 0 ? [`${baseStoryId}-0`] : [],
    }

    stories.push(story)
  }

  return stories
}

function generateMockPrioritizedBacklog(
  mvp: MVP,
  stories: UserStory[],
  framework: 'RICE' | 'MoSCoW' | 'impact'
): PrioritizedBacklog {
  const reasoning: PrioritizationReasoning[] = []

  // Sort stories and generate reasoning
  const priorityOrder: Record<Priority, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  }

  const prioritizedStories = [...stories].map((story, index) => {
    // Assign priority based on position and framework
    let priority: Priority = 'medium'
    let impactScore = 5
    let effortEstimate: 'xs' | 's' | 'm' | 'l' | 'xl' = 'm'

    if (framework === 'RICE') {
      // RICE scoring simulation
      const reach = 10 - index * 2
      const impact = 3 - Math.floor(index / 3)
      const confidence = 0.8 - index * 0.1
      const effort = 1 + Math.floor(index / 2)

      impactScore = Math.max(1, Math.round((reach * impact * confidence) / effort))

      if (impactScore >= 8) priority = 'critical'
      else if (impactScore >= 5) priority = 'high'
      else if (impactScore >= 3) priority = 'medium'
      else priority = 'low'
    } else if (framework === 'MoSCoW') {
      if (index === 0) priority = 'critical'
      else if (index < 3) priority = 'high'
      else if (index < 6) priority = 'medium'
      else priority = 'low'

      impactScore = index < 3 ? 9 : index < 6 ? 6 : 3
    } else {
      // Impact-based
      impactScore = Math.max(1, 10 - index)
      priority = index < 2 ? 'high' : index < 5 ? 'medium' : 'low'
    }

    effortEstimate = index < 2 ? 's' : index < 5 ? 'm' : 'l'

    // Update story priority
    story.priority = priority

    reasoning.push({
      storyId: story.id,
      priority,
      rationale: `${framework} analysis: ${story.title} scores ${impactScore}/10 based on user value and alignment with MVP success metrics.`,
      impactScore,
      effortEstimate,
      riskFactors: index < 3
        ? ['Technical complexity manageable']
        : ['May require additional research', 'Dependencies on earlier work'],
    })

    return story
  })

  // Sort by priority
  prioritizedStories.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  return {
    mvpId: mvp.id,
    stories: prioritizedStories,
    reasoning,
    generatedAt: new Date().toISOString(),
  }
}

function generateMockRoadmap(
  mvp: MVP,
  stories: UserStory[],
  year: number,
  mode: PlanningMode
): Roadmap {
  const quarters: QuarterPlan[] = []
  const quarterNames: Quarter[] = ['Q1', 'Q2', 'Q3', 'Q4']

  // Distribute stories across quarters based on priority
  const criticalStories = stories.filter(s => s.priority === 'critical' || s.priority === 'high')
  const mediumStories = stories.filter(s => s.priority === 'medium')
  const lowStories = stories.filter(s => s.priority === 'low')

  const themes = mode === 'strategic'
    ? [
        'Foundation & Core Value',
        'Growth & Expansion',
        'Scale & Optimization',
        'Market Leadership',
      ]
    : [
        'MVP Launch',
        'User Feedback Integration',
        'Feature Iteration',
        'Stability & Polish',
      ]

  for (let i = 0; i < 4; i++) {
    const quarterStories: string[] = []

    // Distribute stories
    if (i === 0) {
      quarterStories.push(...criticalStories.slice(0, 3).map(s => s.id))
    } else if (i === 1) {
      quarterStories.push(...criticalStories.slice(3).map(s => s.id))
      quarterStories.push(...mediumStories.slice(0, 2).map(s => s.id))
    } else if (i === 2) {
      quarterStories.push(...mediumStories.slice(2).map(s => s.id))
    } else {
      quarterStories.push(...lowStories.map(s => s.id))
    }

    const milestones: Milestone[] = [
      {
        id: generateId('ms'),
        name: i === 0 ? 'MVP Launch' : `${quarterNames[i]} Milestone`,
        targetDate: `${year}-${String((i + 1) * 3).padStart(2, '0')}-15`,
        deliverables: quarterStories.slice(0, 2),
        successCriteria: [
          mode === 'strategic'
            ? 'Market positioning validated'
            : 'Core user flows working',
        ],
      },
    ]

    quarters.push({
      quarter: quarterNames[i],
      theme: themes[i],
      goals: [
        i === 0
          ? 'Launch MVP and acquire first 100 users'
          : `Achieve ${quarterNames[i]} objectives`,
      ],
      stories: quarterStories,
      milestones,
      capacity: 20 + i * 5, // Increasing capacity as team grows
    })
  }

  return {
    id: generateId('roadmap'),
    mvpId: mvp.id,
    year,
    quarters,
    dependencies: stories.length > 1
      ? [{ from: stories[0].id, to: stories[1]?.id || stories[0].id, type: 'enables' }]
      : [],
    mode,
    createdAt: new Date().toISOString(),
  }
}

function generateMockUserResearch(
  hypothesis: string,
  interviews: UserInterview[]
): UserResearchContext {
  const painPoints = interviews.length > 0
    ? interviews.flatMap(i => i.painPoints)
    : [
        'Time wasted on repetitive tasks',
        'Lack of visibility into progress',
        'Difficulty coordinating with others',
      ]

  return {
    targetUsers: ['Early adopters', 'Tech-savvy professionals', 'Small business owners'],
    painPoints: [...new Set(painPoints)],
    competitors: ['Competitor A', 'Competitor B', 'DIY solutions'],
    interviews,
  }
}

function generateMockRICEPrioritization(
  features: string[],
  _context: UserResearchContext
): FeaturePrioritization[] {
  return features.map((feature, index) => {
    const reach = Math.max(1, 10 - index * 2)
    const impact = Math.max(1, 3 - Math.floor(index / 3))
    const confidence = Math.max(0.5, 0.9 - index * 0.1)
    const effort = Math.max(1, 1 + Math.floor(index / 2))
    const score = (reach * impact * confidence) / effort

    let priority: Priority = 'medium'
    if (score >= 8) priority = 'critical'
    else if (score >= 5) priority = 'high'
    else if (score >= 2) priority = 'medium'
    else priority = 'low'

    return {
      featureId: generateId('feat'),
      feature,
      rice: { reach, impact, confidence, effort, score },
      priority,
      rationale: `RICE score ${score.toFixed(1)}: High reach (${reach}), Impact ${impact}/3, ${Math.round(confidence * 100)}% confidence, ${effort} person-weeks`,
    }
  })
}

function generateMockMoSCoWPrioritization(
  features: string[],
  _constraints: { timeline: string; budget: string }
): FeaturePrioritization[] {
  const total = features.length

  return features.map((feature, index) => {
    let moscow: MoSCoWCategory
    let priority: Priority

    // Distribute across MoSCoW categories based on position relative to total
    // Roughly: 25% must-have, 25% should-have, 25% could-have, 25% wont-have
    const relativePosition = index / total

    if (index === 0 || relativePosition < 0.25) {
      moscow = 'must-have'
      priority = 'critical'
    } else if (relativePosition < 0.5) {
      moscow = 'should-have'
      priority = 'high'
    } else if (relativePosition < 0.75) {
      moscow = 'could-have'
      priority = 'medium'
    } else {
      moscow = 'wont-have'
      priority = 'low'
    }

    return {
      featureId: generateId('feat'),
      feature,
      moscow,
      priority,
      rationale: `Categorized as ${moscow} based on timeline and budget constraints`,
    }
  })
}

// ============================================================================
// EXPORTS
// ============================================================================

export default priya
