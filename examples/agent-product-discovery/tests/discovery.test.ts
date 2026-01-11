/**
 * Product Discovery Tests
 *
 * Tests the Priya (Product) and Quinn (QA) workflow for product discovery:
 * - Priya defines MVPs, generates stories, prioritizes, and creates roadmaps
 * - Quinn validates specs are testable
 *
 * @module agent-product-discovery/tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  priya,
  defineMVP,
  generateStories,
  prioritizeBacklog,
  createRoadmap,
  conductUserResearch,
  prioritizeWithRICE,
  prioritizeWithMoSCoW,
  enableMockMode as enablePriyaMockMode,
  disableMockMode as disablePriyaMockMode,
  setMockResponse as setPriyaMockResponse,
} from '../src/agents/priya'
import {
  quinn,
  validateSpec,
  reviewCriteria,
  suggestImprovements,
  validateBatch,
  enableMockMode as enableQuinnMockMode,
  disableMockMode as disableQuinnMockMode,
  setMockResponse as setQuinnMockResponse,
} from '../src/agents/quinn'
import type {
  MVP,
  UserStory,
  PrioritizedBacklog,
  Roadmap,
  SpecValidation,
  AcceptanceCriterion,
} from '../src/ProductDiscoveryDO'

// ============================================================================
// TEST DATA
// ============================================================================

const createTestMVP = (overrides: Partial<MVP> = {}): MVP => ({
  id: 'mvp-001',
  hypothesis: 'Freelancers waste 20+ hours on taxes',
  problem: 'Freelancers spend excessive time on tax preparation',
  targetUser: 'Freelancers earning $50k-$200k annually',
  valueProp: 'Automate tax preparation and maximize deductions',
  coreFeatures: [
    'Automatic expense categorization',
    'Real-time tax estimation',
    'Deduction finder',
  ],
  outOfScope: ['Enterprise features', 'Multi-platform native apps'],
  successMetrics: ['User activation rate > 40%', 'NPS > 30'],
  assumptions: ['Users willing to pay', 'Problem is painful enough'],
  risks: ['Competitive response', 'Longer sales cycle'],
  createdAt: new Date().toISOString(),
  ...overrides,
})

const createTestStory = (overrides: Partial<UserStory> = {}): UserStory => ({
  id: 'story-001',
  mvpId: 'mvp-001',
  title: 'Automatic expense categorization',
  asA: 'freelancer',
  iWant: 'to have my expenses automatically categorized',
  soThat: 'I can save time on tax preparation',
  acceptanceCriteria: [
    {
      id: 'ac-001',
      given: 'I am a logged-in freelancer with connected bank accounts',
      when: 'I upload a new receipt or transaction appears',
      then: 'I should see the expense automatically categorized within 5 seconds',
      isTestable: true,
    },
    {
      id: 'ac-002',
      given: 'An expense has been auto-categorized',
      when: 'I view the expense details',
      then: 'I should see the confidence score and be able to change the category',
      isTestable: true,
    },
  ],
  priority: 'high',
  status: 'draft',
  dependencies: [],
  ...overrides,
})

const createTestAcceptanceCriterion = (
  overrides: Partial<AcceptanceCriterion> = {}
): AcceptanceCriterion => ({
  id: 'ac-001',
  given: 'I am a logged-in user',
  when: 'I perform an action',
  then: 'I should see the expected result',
  isTestable: true,
  ...overrides,
})

// ============================================================================
// PRIYA AGENT TESTS
// ============================================================================

describe('Priya - Product Agent', () => {
  beforeEach(() => {
    enablePriyaMockMode()
  })

  afterEach(() => {
    disablePriyaMockMode()
  })

  describe('defineMVP()', () => {
    it('should define an MVP from a hypothesis', async () => {
      const hypothesis = 'Freelancers waste 20+ hours on taxes'
      const mvp = await defineMVP({ hypothesis })

      expect(mvp.id).toBeDefined()
      expect(mvp.hypothesis).toBe(hypothesis)
      expect(mvp.problem).toBeDefined()
      expect(mvp.targetUser).toBeDefined()
      expect(mvp.valueProp).toBeDefined()
      expect(mvp.coreFeatures).toBeInstanceOf(Array)
      expect(mvp.coreFeatures.length).toBeGreaterThan(0)
    })

    it('should handle strategic mode differently', async () => {
      const hypothesis = 'Remote teams need better async communication'

      const tacticalMVP = await defineMVP({ hypothesis, mode: 'tactical' })
      const strategicMVP = await defineMVP({ hypothesis, mode: 'strategic' })

      expect(tacticalMVP.id).not.toBe(strategicMVP.id)
      expect(tacticalMVP.hypothesis).toBe(strategicMVP.hypothesis)
    })

    it('should use mock response when set', async () => {
      const mockMVP = createTestMVP({
        problem: 'Custom mock problem',
      })
      setPriyaMockResponse('mvp', mockMVP)

      const mvp = await defineMVP({ hypothesis: 'Test hypothesis' })

      expect(mvp.problem).toBe('Custom mock problem')
    })
  })

  describe('generateStories()', () => {
    it('should generate user stories from an MVP', async () => {
      const mvp = createTestMVP()
      const stories = await generateStories({ mvp })

      expect(stories).toBeInstanceOf(Array)
      expect(stories.length).toBeGreaterThan(0)

      const firstStory = stories[0]
      expect(firstStory.mvpId).toBe(mvp.id)
      expect(firstStory.asA).toBeDefined()
      expect(firstStory.iWant).toBeDefined()
      expect(firstStory.soThat).toBeDefined()
      expect(firstStory.acceptanceCriteria).toBeInstanceOf(Array)
    })

    it('should respect maxStories limit', async () => {
      const mvp = createTestMVP()
      const stories = await generateStories({ mvp, maxStories: 3 })

      expect(stories.length).toBeLessThanOrEqual(3)
    })

    it('should include acceptance criteria with Given/When/Then', async () => {
      const mvp = createTestMVP()
      const stories = await generateStories({ mvp })

      const firstStory = stories[0]
      expect(firstStory.acceptanceCriteria.length).toBeGreaterThan(0)

      const criterion = firstStory.acceptanceCriteria[0]
      expect(criterion.given).toBeDefined()
      expect(criterion.when).toBeDefined()
      expect(criterion.then).toBeDefined()
    })
  })

  describe('prioritizeBacklog()', () => {
    it('should prioritize a backlog with reasoning', async () => {
      const mvp = createTestMVP()
      const stories = [
        createTestStory({ id: 'story-1', title: 'Feature 1' }),
        createTestStory({ id: 'story-2', title: 'Feature 2' }),
        createTestStory({ id: 'story-3', title: 'Feature 3' }),
      ]

      const backlog = await prioritizeBacklog({ mvp, stories })

      expect(backlog.mvpId).toBe(mvp.id)
      expect(backlog.stories).toBeInstanceOf(Array)
      expect(backlog.reasoning).toBeInstanceOf(Array)
      expect(backlog.reasoning.length).toBe(stories.length)
    })

    it('should include rationale for each prioritization', async () => {
      const mvp = createTestMVP()
      const stories = [createTestStory()]

      const backlog = await prioritizeBacklog({ mvp, stories })

      const reasoning = backlog.reasoning[0]
      expect(reasoning.storyId).toBe(stories[0].id)
      expect(reasoning.priority).toBeDefined()
      expect(reasoning.rationale).toBeDefined()
      expect(reasoning.impactScore).toBeGreaterThan(0)
    })

    it('should support different prioritization frameworks', async () => {
      const mvp = createTestMVP()
      const stories = [createTestStory()]

      const riceBacklog = await prioritizeBacklog({ mvp, stories, framework: 'RICE' })
      const moscowBacklog = await prioritizeBacklog({ mvp, stories, framework: 'MoSCoW' })
      const impactBacklog = await prioritizeBacklog({ mvp, stories, framework: 'impact' })

      expect(riceBacklog.reasoning[0].rationale).toContain('RICE')
      expect(moscowBacklog.reasoning[0].rationale).toContain('MoSCoW')
      expect(impactBacklog.reasoning[0].rationale).toBeDefined()
    })
  })

  describe('createRoadmap()', () => {
    it('should create a quarterly roadmap', async () => {
      const mvp = createTestMVP()
      const stories = [
        createTestStory({ id: 'story-1', priority: 'high' }),
        createTestStory({ id: 'story-2', priority: 'medium' }),
      ]

      const roadmap = await createRoadmap({ mvp, stories })

      expect(roadmap.id).toBeDefined()
      expect(roadmap.mvpId).toBe(mvp.id)
      expect(roadmap.quarters).toBeInstanceOf(Array)
      expect(roadmap.quarters.length).toBe(4)
    })

    it('should have themes for each quarter', async () => {
      const mvp = createTestMVP()
      const stories = [createTestStory()]

      const roadmap = await createRoadmap({ mvp, stories })

      for (const quarter of roadmap.quarters) {
        expect(quarter.theme).toBeDefined()
        expect(quarter.goals).toBeInstanceOf(Array)
        expect(quarter.milestones).toBeInstanceOf(Array)
      }
    })

    it('should respect planning mode', async () => {
      const mvp = createTestMVP()
      const stories = [createTestStory()]

      const tacticalRoadmap = await createRoadmap({ mvp, stories, mode: 'tactical' })
      const strategicRoadmap = await createRoadmap({ mvp, stories, mode: 'strategic' })

      expect(tacticalRoadmap.mode).toBe('tactical')
      expect(strategicRoadmap.mode).toBe('strategic')
    })
  })

  describe('conductUserResearch()', () => {
    it('should synthesize user research findings', async () => {
      const hypothesis = 'Freelancers need tax help'
      const interviews = [
        {
          userId: 'user-1',
          persona: 'Freelance designer',
          painPoints: ['Tax complexity', 'Time wasted'],
          desires: ['Automation', 'Peace of mind'],
          quotes: ['I hate tax season'],
        },
      ]

      const research = await conductUserResearch(hypothesis, interviews)

      expect(research.targetUsers).toBeInstanceOf(Array)
      expect(research.painPoints).toBeInstanceOf(Array)
      expect(research.competitors).toBeInstanceOf(Array)
    })
  })

  describe('prioritizeWithRICE()', () => {
    it('should calculate RICE scores for features', async () => {
      const features = ['Auto-categorization', 'Tax estimation', 'Deduction finder']

      const prioritization = await prioritizeWithRICE(features, {})

      expect(prioritization).toBeInstanceOf(Array)
      expect(prioritization.length).toBe(features.length)

      const firstFeature = prioritization[0]
      expect(firstFeature.rice).toBeDefined()
      expect(firstFeature.rice?.reach).toBeGreaterThan(0)
      expect(firstFeature.rice?.impact).toBeGreaterThan(0)
      expect(firstFeature.rice?.confidence).toBeGreaterThan(0)
      expect(firstFeature.rice?.effort).toBeGreaterThan(0)
      expect(firstFeature.rice?.score).toBeGreaterThan(0)
    })
  })

  describe('prioritizeWithMoSCoW()', () => {
    it('should categorize features using MoSCoW', async () => {
      const features = ['Core feature', 'Nice to have', 'Future feature']
      const constraints = { timeline: '3 months', budget: '$50k' }

      const prioritization = await prioritizeWithMoSCoW(features, constraints)

      expect(prioritization).toBeInstanceOf(Array)
      expect(prioritization.length).toBe(features.length)

      const categories = prioritization.map(p => p.moscow)
      expect(categories).toContain('must-have')
    })
  })

  describe('priya template literal', () => {
    it('should define MVP via template literal', async () => {
      const hypothesis = 'Users need better onboarding'
      const result = await priya`define MVP for ${hypothesis}`

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
      expect((result as MVP).hypothesis).toBeDefined()
    })

    it('should generate stories via template literal', async () => {
      const mvp = createTestMVP()
      const result = await priya`break ${mvp} into user stories`

      expect(result).toBeDefined()
      expect(Array.isArray(result)).toBe(true)
      expect((result as UserStory[])[0].mvpId).toBe(mvp.id)
    })

    it('should prioritize via template literal', async () => {
      const mvp = createTestMVP()
      const stories = [createTestStory()]
      const result = await priya`prioritize ${stories} by impact for ${mvp}`

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
    })

    it('should create roadmap via template literal', async () => {
      const mvp = createTestMVP()
      const stories = [createTestStory()]
      const result = await priya`create quarterly roadmap from ${stories} for ${mvp}`

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
    })
  })
})

// ============================================================================
// QUINN AGENT TESTS
// ============================================================================

describe('Quinn - QA Agent', () => {
  beforeEach(() => {
    enableQuinnMockMode()
  })

  afterEach(() => {
    disableQuinnMockMode()
  })

  describe('validateSpec()', () => {
    it('should validate a user story for testability', async () => {
      const story = createTestStory()

      const validation = await validateSpec({ story })

      expect(validation.storyId).toBe(story.id)
      expect(typeof validation.isTestable).toBe('boolean')
      expect(validation.issues).toBeInstanceOf(Array)
      expect(validation.suggestions).toBeInstanceOf(Array)
    })

    it('should pass validation for well-defined stories', async () => {
      const story = createTestStory({
        acceptanceCriteria: [
          {
            id: 'ac-1',
            given: 'I am a logged-in user with valid permissions and active session',
            when: 'I click the submit button after filling out the form',
            then: 'I should see a success message displayed within 2 seconds',
            isTestable: true,
          },
        ],
      })

      const validation = await validateSpec({ story })

      expect(validation.isTestable).toBe(true)
      expect(validation.issues.length).toBe(0)
    })

    it('should fail validation for vague criteria', async () => {
      const story = createTestStory({
        acceptanceCriteria: [
          {
            id: 'ac-1',
            given: 'user',
            when: 'action',
            then: 'it works',
            isTestable: false,
          },
        ],
      })

      const validation = await validateSpec({ story, strictness: 'moderate' })

      expect(validation.isTestable).toBe(false)
      expect(validation.issues.length).toBeGreaterThan(0)
    })

    it('should respect strictness levels', async () => {
      const story = createTestStory()

      const lenientValidation = await validateSpec({ story, strictness: 'lenient' })
      const strictValidation = await validateSpec({ story, strictness: 'strict' })

      // Strict validation may find more issues
      expect(strictValidation.issues.length).toBeGreaterThanOrEqual(
        lenientValidation.issues.length
      )
    })

    it('should use mock response when set', async () => {
      const mockValidation: SpecValidation = {
        storyId: 'story-mock',
        isTestable: true,
        issues: [],
        suggestions: ['Custom suggestion'],
        validatedAt: new Date().toISOString(),
      }
      setQuinnMockResponse('validate', mockValidation)

      const story = createTestStory()
      const validation = await validateSpec({ story })

      expect(validation.storyId).toBe('story-mock')
      expect(validation.suggestions).toContain('Custom suggestion')
    })
  })

  describe('reviewCriteria()', () => {
    it('should analyze acceptance criteria', async () => {
      const criteria = [
        createTestAcceptanceCriterion({ id: 'ac-1' }),
        createTestAcceptanceCriterion({ id: 'ac-2' }),
      ]

      const analysis = await reviewCriteria(criteria)

      expect(analysis).toBeInstanceOf(Array)
      expect(analysis.length).toBe(criteria.length)

      const firstAnalysis = analysis[0]
      expect(firstAnalysis.criterionId).toBe('ac-1')
      expect(firstAnalysis.specificity).toBeDefined()
      expect(firstAnalysis.measurability).toBeDefined()
    })

    it('should identify vague criteria', async () => {
      const criteria = [
        createTestAcceptanceCriterion({
          given: 'x',
          when: 'y',
          then: 'z',
        }),
      ]

      const analysis = await reviewCriteria(criteria)

      expect(analysis[0].specificity).toBe('vague')
    })

    it('should identify measurable outcomes', async () => {
      const criteria = [
        createTestAcceptanceCriterion({
          then: 'I should see a confirmation message displayed on the screen',
        }),
      ]

      const analysis = await reviewCriteria(criteria)

      expect(analysis[0].measurability).toBe('measurable')
    })
  })

  describe('suggestImprovements()', () => {
    it('should suggest improvements for a story', async () => {
      const story = createTestStory()

      const review = await suggestImprovements(story)

      expect(review.storyId).toBe(story.id)
      expect(typeof review.score).toBe('number')
      expect(review.suggestions).toBeInstanceOf(Array)
      expect(review.suggestions.length).toBeGreaterThan(0)
    })

    it('should provide improved criteria', async () => {
      const story = createTestStory()

      const review = await suggestImprovements(story)

      expect(review.improvedCriteria).toBeInstanceOf(Array)
      expect(review.improvedCriteria?.length).toBe(story.acceptanceCriteria.length)
    })
  })

  describe('validateBatch()', () => {
    it('should validate multiple stories', async () => {
      const stories = [
        createTestStory({ id: 'story-1' }),
        createTestStory({ id: 'story-2' }),
        createTestStory({ id: 'story-3' }),
      ]

      const validations = await validateBatch(stories)

      expect(validations).toBeInstanceOf(Array)
      expect(validations.length).toBe(stories.length)
    })
  })

  describe('quinn template literal', () => {
    it('should validate via template literal', async () => {
      const story = createTestStory()
      const result = await quinn`validate ${story} is testable`

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
      expect((result as SpecValidation).storyId).toBe(story.id)
    })

    it('should review criteria via template literal', async () => {
      const story = createTestStory()
      const result = await quinn`review criteria for ${story}`

      expect(result).toBeDefined()
      expect(Array.isArray(result)).toBe(true)
    })

    it('should suggest improvements via template literal', async () => {
      const story = createTestStory()
      const result = await quinn`suggest improvements for ${story}`

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
      expect((result as { score: number }).score).toBeDefined()
    })
  })
})

// ============================================================================
// INTEGRATION TESTS - Priya + Quinn Workflow
// ============================================================================

describe('Priya + Quinn Discovery Workflow', () => {
  beforeEach(() => {
    enablePriyaMockMode()
    enableQuinnMockMode()
  })

  afterEach(() => {
    disablePriyaMockMode()
    disableQuinnMockMode()
  })

  it('should complete full discovery flow', async () => {
    // 1. Start with a hypothesis
    const hypothesis = 'Freelancers waste 20+ hours on taxes'

    // 2. Priya defines the MVP
    const mvp = await defineMVP({ hypothesis })
    expect(mvp.id).toBeDefined()
    expect(mvp.coreFeatures.length).toBeGreaterThan(0)

    // 3. Priya generates user stories
    const stories = await generateStories({ mvp })
    expect(stories.length).toBeGreaterThan(0)

    // 4. Priya prioritizes the backlog
    const backlog = await prioritizeBacklog({ mvp, stories })
    expect(backlog.reasoning.length).toBe(stories.length)

    // 5. Quinn validates each story's specs
    const validations = await validateBatch(backlog.stories)
    expect(validations.length).toBe(backlog.stories.length)

    // 6. Priya creates the roadmap
    const roadmap = await createRoadmap({ mvp, stories: backlog.stories })
    expect(roadmap.quarters.length).toBe(4)
  })

  it('should support iterative refinement', async () => {
    const hypothesis = 'Teams need async standups'

    // Initial MVP
    const mvp = await defineMVP({ hypothesis })
    const stories = await generateStories({ mvp })

    // Validate first story
    const validation = await validateSpec({ story: stories[0] })

    // If issues found, get improvement suggestions
    if (!validation.isTestable) {
      const review = await suggestImprovements(stories[0])
      expect(review.improvedCriteria).toBeDefined()
    }
  })

  it('should support template literal workflow', async () => {
    const hypothesis = 'Startups need faster MVP validation'

    // Use template literals throughout
    const mvp = await priya`define MVP for ${hypothesis}` as MVP
    expect(mvp.hypothesis).toBeDefined()

    const stories = await priya`break ${mvp} into user stories` as UserStory[]
    expect(stories.length).toBeGreaterThan(0)

    const validated = await quinn`validate ${stories[0]} is testable` as SpecValidation
    expect(validated.storyId).toBe(stories[0].id)

    // Continue with prioritization
    const backlog = await priya`prioritize ${stories} by impact for ${mvp}` as PrioritizedBacklog
    expect(backlog.reasoning.length).toBeGreaterThan(0)
  })

  it('should handle different prioritization frameworks', async () => {
    const mvp = createTestMVP()
    const stories = [
      createTestStory({ id: 'story-1' }),
      createTestStory({ id: 'story-2' }),
      createTestStory({ id: 'story-3' }),
    ]

    // RICE prioritization
    const riceBacklog = await prioritizeBacklog({ mvp, stories, framework: 'RICE' })
    expect(riceBacklog.reasoning[0].rationale).toContain('RICE')

    // MoSCoW prioritization
    const moscowBacklog = await prioritizeBacklog({ mvp, stories, framework: 'MoSCoW' })
    expect(moscowBacklog.reasoning[0].rationale).toContain('MoSCoW')
  })

  it('should validate all stories before roadmap creation', async () => {
    const mvp = createTestMVP()
    const stories = await generateStories({ mvp })

    // Validate all stories
    const validations = await validateBatch(stories)
    const allTestable = validations.every(v => v.isTestable)

    // Only create roadmap if all specs are testable (or handle failures)
    if (allTestable) {
      const roadmap = await createRoadmap({ mvp, stories })
      expect(roadmap.quarters.length).toBe(4)
    } else {
      // Get suggestions for failing stories
      const failingStories = stories.filter((_, i) => !validations[i].isTestable)
      for (const story of failingStories) {
        const review = await suggestImprovements(story)
        expect(review.improvedCriteria).toBeDefined()
      }
    }
  })
})

// ============================================================================
// PLANNING MODE TESTS
// ============================================================================

describe('Planning Modes', () => {
  beforeEach(() => {
    enablePriyaMockMode()
    enableQuinnMockMode()
  })

  afterEach(() => {
    disablePriyaMockMode()
    disableQuinnMockMode()
  })

  it('should produce different roadmaps for tactical vs strategic', async () => {
    const mvp = createTestMVP()
    const stories = [
      createTestStory({ id: 'story-1', priority: 'high' }),
      createTestStory({ id: 'story-2', priority: 'medium' }),
    ]

    const tacticalRoadmap = await createRoadmap({ mvp, stories, mode: 'tactical' })
    const strategicRoadmap = await createRoadmap({ mvp, stories, mode: 'strategic' })

    expect(tacticalRoadmap.mode).toBe('tactical')
    expect(strategicRoadmap.mode).toBe('strategic')

    // Themes should differ based on mode
    expect(tacticalRoadmap.quarters[0].theme).not.toBe(strategicRoadmap.quarters[0].theme)
  })

  it('should handle MVP definition in both modes', async () => {
    const hypothesis = 'Users need better analytics'

    const tacticalMVP = await defineMVP({ hypothesis, mode: 'tactical' })
    const strategicMVP = await defineMVP({ hypothesis, mode: 'strategic' })

    expect(tacticalMVP.hypothesis).toBe(hypothesis)
    expect(strategicMVP.hypothesis).toBe(hypothesis)
  })
})

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('Edge Cases', () => {
  beforeEach(() => {
    enablePriyaMockMode()
    enableQuinnMockMode()
  })

  afterEach(() => {
    disablePriyaMockMode()
    disableQuinnMockMode()
  })

  it('should handle empty hypothesis gracefully', async () => {
    const mvp = await defineMVP({ hypothesis: '' })
    expect(mvp.id).toBeDefined()
  })

  it('should handle MVP with no core features', async () => {
    const mvp = createTestMVP({ coreFeatures: [] })
    const stories = await generateStories({ mvp })

    // Should still return something, even if empty
    expect(stories).toBeInstanceOf(Array)
  })

  it('should handle story with no acceptance criteria', async () => {
    const story = createTestStory({ acceptanceCriteria: [] })
    const validation = await validateSpec({ story })

    expect(validation.storyId).toBe(story.id)
    expect(validation.suggestions.length).toBeGreaterThan(0)
  })

  it('should handle batch validation with empty array', async () => {
    const validations = await validateBatch([])
    expect(validations).toBeInstanceOf(Array)
    expect(validations.length).toBe(0)
  })
})

// ============================================================================
// RICE AND MOSCOW FRAMEWORK TESTS
// ============================================================================

describe('Prioritization Frameworks', () => {
  beforeEach(() => {
    enablePriyaMockMode()
  })

  afterEach(() => {
    disablePriyaMockMode()
  })

  describe('RICE Framework', () => {
    it('should calculate RICE scores correctly', async () => {
      const features = ['Feature A', 'Feature B', 'Feature C']
      const prioritization = await prioritizeWithRICE(features, {})

      for (const p of prioritization) {
        expect(p.rice).toBeDefined()
        if (p.rice) {
          expect(p.rice.reach).toBeGreaterThan(0)
          expect(p.rice.impact).toBeGreaterThan(0)
          expect(p.rice.confidence).toBeGreaterThan(0)
          expect(p.rice.effort).toBeGreaterThan(0)
          expect(p.rice.score).toBe(
            (p.rice.reach * p.rice.impact * p.rice.confidence) / p.rice.effort
          )
        }
      }
    })

    it('should order features by RICE score', async () => {
      const features = ['Low priority', 'High priority', 'Medium priority']
      const prioritization = await prioritizeWithRICE(features, {})

      // First feature should have highest score
      const scores = prioritization.map(p => p.rice?.score || 0)
      expect(scores[0]).toBeGreaterThanOrEqual(scores[1])
    })
  })

  describe('MoSCoW Framework', () => {
    it('should categorize features correctly', async () => {
      const features = ['Critical', 'Important', 'Nice to have', 'Future']
      const prioritization = await prioritizeWithMoSCoW(features, {
        timeline: '3 months',
        budget: '$50k',
      })

      const categories = prioritization.map(p => p.moscow)
      expect(categories).toContain('must-have')
      expect(categories).toContain('wont-have')
    })

    it('should assign appropriate priorities', async () => {
      const features = ['Feature 1']
      const prioritization = await prioritizeWithMoSCoW(features, {
        timeline: '1 month',
        budget: '$10k',
      })

      expect(prioritization[0].priority).toBe('critical')
      expect(prioritization[0].moscow).toBe('must-have')
    })
  })
})
