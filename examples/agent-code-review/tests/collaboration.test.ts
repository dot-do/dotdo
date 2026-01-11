/**
 * Ralph + Tom Collaboration Tests
 *
 * Tests the code review collaboration pattern:
 * - Ralph generates code from specifications
 * - Tom performs AI code review with specific feedback
 * - Demonstrates persona composition and mentoring traits
 * - Shows iterative refinement loop
 *
 * @module agent-code-review/tests/collaboration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import the modular agents
import {
  ralphPersona,
  generateCode,
  improveCode,
  getRalphTraits,
  getTraitDetails as getRalphTraitDetails,
  type CodeSpec,
  type CodeArtifact,
} from '../src/ralph'

import {
  tomPersona,
  reviewCode,
  quickCheck,
  getTomTraits,
  getMentoringTrait,
  formatReviewForLearning,
  type CodeReview,
} from '../src/tom'

import {
  runReviewLoop,
  runSingleIteration,
  generatePRDescription,
  generateCommitMessage,
  getSessionStats,
  formatSessionSummary,
  type ReviewSession,
  type ReviewLoopConfig,
} from '../src/review-loop'

// ============================================================================
// MOCK SETUP
// ============================================================================

// Mock AI environment
const createMockAIEnv = () => {
  let callCount = 0
  const responses: Array<{ response: string }> = []

  return {
    AI: {
      run: vi.fn().mockImplementation(async () => {
        const response = responses[callCount] || { response: '{}' }
        callCount++
        return response
      }),
    },
    addResponse: (response: string) => {
      responses.push({ response })
    },
    addJsonResponse: (obj: object) => {
      responses.push({ response: JSON.stringify(obj) })
    },
    reset: () => {
      callCount = 0
      responses.length = 0
    },
  }
}

// ============================================================================
// PERSONA COMPOSITION TESTS
// ============================================================================

describe('Persona Composition', () => {
  describe('Ralph Persona', () => {
    it('has engineering role', () => {
      expect(ralphPersona.role).toBe('engineering')
    })

    it('has correct name', () => {
      expect(ralphPersona.name).toBe('Ralph')
    })

    it('includes code generation in instructions', () => {
      expect(ralphPersona.instructions.toLowerCase()).toContain('code')
    })

    it('includes improvement capability in instructions', () => {
      expect(ralphPersona.instructions.toLowerCase()).toContain('improve')
    })

    it('has expected traits', () => {
      const traits = getRalphTraits()
      expect(traits).toContain('technical')
      expect(traits).toContain('analytical')
      expect(traits).toContain('detail_oriented')
    })

    it('trait details include capabilities', () => {
      const details = getRalphTraitDetails()
      expect(details.length).toBeGreaterThan(0)
      expect(details[0]).toHaveProperty('capabilities')
      expect(details[0]).toHaveProperty('guidelines')
    })
  })

  describe('Tom Persona', () => {
    it('has tech-lead role', () => {
      expect(tomPersona.role).toBe('tech-lead')
    })

    it('has correct name', () => {
      expect(tomPersona.name).toBe('Tom')
    })

    it('includes review in instructions', () => {
      expect(tomPersona.instructions.toLowerCase()).toContain('review')
    })

    it('includes mentoring philosophy', () => {
      // Tom's persona emphasizes mentoring
      expect(tomPersona.instructions.toLowerCase()).toContain('mentor')
    })

    it('has mentoring trait', () => {
      const traits = getTomTraits()
      expect(traits).toContain('mentoring')
    })

    it('mentoring trait has constructive feedback capability', () => {
      const mentoring = getMentoringTrait()
      expect(mentoring).toBeDefined()
      expect(mentoring?.capabilities).toContain('Provide constructive feedback')
    })
  })

  describe('Trait Composition', () => {
    it('Ralph and Tom share analytical trait', () => {
      const ralphTraits = getRalphTraits()
      const tomTraits = getTomTraits()

      // Both should have analytical
      expect(ralphTraits).toContain('analytical')
      expect(tomTraits).toContain('analytical')
    })

    it('Ralph and Tom share technical trait', () => {
      const ralphTraits = getRalphTraits()
      const tomTraits = getTomTraits()

      expect(ralphTraits).toContain('technical')
      expect(tomTraits).toContain('technical')
    })

    it('Tom has unique mentoring trait', () => {
      const ralphTraits = getRalphTraits()
      const tomTraits = getTomTraits()

      // Only Tom has mentoring
      expect(tomTraits).toContain('mentoring')
      // Ralph does not have mentoring by default
      expect(ralphTraits).not.toContain('mentoring')
    })

    it('Ralph has unique detail_oriented trait', () => {
      const ralphTraits = getRalphTraits()
      const tomTraits = getTomTraits()

      // Ralph has detail_oriented
      expect(ralphTraits).toContain('detail_oriented')
    })
  })
})

// ============================================================================
// CODE GENERATION TESTS (Ralph)
// ============================================================================

describe('Code Generation (Ralph)', () => {
  const mockEnv = createMockAIEnv()

  beforeEach(() => {
    mockEnv.reset()
  })

  it('generates code artifact from spec', async () => {
    mockEnv.addJsonResponse({
      code: 'export function hello() { return "Hello" }',
      filename: 'hello.ts',
      imports: [],
      exports: ['hello'],
    })

    const spec: CodeSpec = {
      id: 'test-spec',
      title: 'Hello Function',
      description: 'A simple hello function',
      requirements: ['Return greeting string'],
    }

    const artifact = await generateCode(spec, mockEnv)

    expect(artifact).toBeDefined()
    expect(artifact.specId).toBe('test-spec')
    expect(artifact.version).toBe(1)
    expect(artifact.generatedBy).toBe('ralph')
    expect(artifact.filename).toBe('hello.ts')
    expect(artifact.content).toContain('hello')
  })

  it('improves code based on review feedback', async () => {
    mockEnv.addJsonResponse({
      code: 'export function hello(): string { return "Hello" }',
      filename: 'hello.ts',
      imports: [],
      exports: ['hello'],
      changesApplied: ['Added return type annotation'],
    })

    const artifact: CodeArtifact = {
      id: 'artifact-1',
      specId: 'test-spec',
      version: 1,
      language: 'typescript',
      filename: 'hello.ts',
      content: 'export function hello() { return "Hello" }',
      imports: [],
      exports: ['hello'],
      generatedAt: new Date().toISOString(),
      generatedBy: 'ralph',
    }

    const review: CodeReview = {
      id: 'review-1',
      artifactId: 'artifact-1',
      version: 1,
      approved: false,
      score: 75,
      summary: 'Missing type annotation',
      comments: [
        {
          id: 'comment-1',
          severity: 'major',
          category: 'style',
          message: 'Missing return type annotation',
          suggestion: 'Add : string return type',
        },
      ],
      positives: [],
      categories: {
        architecture: 80,
        security: 90,
        performance: 85,
        style: 60,
        correctness: 80,
      },
      reviewedAt: new Date().toISOString(),
      reviewedBy: 'tom',
    }

    const improved = await improveCode(artifact, review, mockEnv)

    expect(improved).toBeDefined()
    expect(improved.version).toBe(2) // Version incremented
    expect(improved.specId).toBe('test-spec')
    expect(improved.content).toContain('string') // Type annotation added
  })

  it('handles constraints in spec', async () => {
    mockEnv.addJsonResponse({
      code: '// Strict TypeScript\nexport const x: number = 1',
      filename: 'strict.ts',
      imports: [],
      exports: ['x'],
    })

    const spec: CodeSpec = {
      id: 'strict-spec',
      title: 'Strict TypeScript',
      description: 'Code with strict mode',
      requirements: ['Export a number'],
      constraints: ['Use strict TypeScript', 'No any types'],
    }

    const artifact = await generateCode(spec, mockEnv)

    expect(mockEnv.AI.run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining('Constraints'),
          }),
        ]),
      })
    )
  })
})

// ============================================================================
// CODE REVIEW TESTS (Tom)
// ============================================================================

describe('Code Review (Tom)', () => {
  const mockEnv = createMockAIEnv()

  beforeEach(() => {
    mockEnv.reset()
  })

  it('reviews code and returns structured feedback', async () => {
    mockEnv.addJsonResponse({
      approved: false,
      score: 72,
      summary: 'Good structure but needs error handling',
      categories: {
        architecture: 80,
        security: 60,
        performance: 75,
        style: 70,
        correctness: 75,
      },
      comments: [
        {
          severity: 'major',
          category: 'security',
          message: 'Missing input validation',
          suggestion: 'Add input validation using zod',
        },
      ],
      positives: ['Clean code structure', 'Good naming conventions'],
    })

    const artifact: CodeArtifact = {
      id: 'artifact-1',
      specId: 'test-spec',
      version: 1,
      language: 'typescript',
      filename: 'auth.ts',
      content: 'export function login(user) { return true }',
      imports: [],
      exports: ['login'],
      generatedAt: new Date().toISOString(),
      generatedBy: 'ralph',
    }

    const spec: CodeSpec = {
      id: 'test-spec',
      title: 'Auth Service',
      description: 'User authentication',
      requirements: ['Login functionality'],
    }

    const review = await reviewCode(artifact, spec, mockEnv)

    expect(review).toBeDefined()
    expect(review.approved).toBe(false)
    expect(review.score).toBe(72)
    expect(review.reviewedBy).toBe('tom')
    expect(review.comments.length).toBeGreaterThan(0)
    expect(review.categories.security).toBe(60)
    expect(review.positives).toContain('Clean code structure')
  })

  it('approves code that meets standards', async () => {
    mockEnv.addJsonResponse({
      approved: true,
      score: 92,
      summary: 'Excellent implementation',
      categories: {
        architecture: 90,
        security: 95,
        performance: 90,
        style: 90,
        correctness: 95,
      },
      comments: [
        {
          severity: 'suggestion',
          category: 'performance',
          message: 'Could add caching',
          suggestion: 'Consider memoization',
        },
      ],
      positives: ['Comprehensive error handling', 'Well documented'],
    })

    const artifact: CodeArtifact = {
      id: 'artifact-2',
      specId: 'test-spec',
      version: 2,
      language: 'typescript',
      filename: 'auth.ts',
      content: `
        import { z } from 'zod'
        const userSchema = z.object({ email: z.string().email() })
        export function login(user: unknown): boolean {
          const validated = userSchema.parse(user)
          // Implementation...
          return true
        }
      `,
      imports: ['zod'],
      exports: ['login'],
      generatedAt: new Date().toISOString(),
      generatedBy: 'ralph',
    }

    const spec: CodeSpec = {
      id: 'test-spec',
      title: 'Auth Service',
      description: 'User authentication',
      requirements: ['Login functionality'],
    }

    const review = await reviewCode(artifact, spec, mockEnv)

    expect(review.approved).toBe(true)
    expect(review.score).toBeGreaterThanOrEqual(90)
  })

  it('performs quick check for critical issues', async () => {
    mockEnv.addJsonResponse({
      passesBasicChecks: false,
      issues: ['SQL injection vulnerability', 'No error handling'],
    })

    const code = `
      export function query(id) {
        return db.exec("SELECT * FROM users WHERE id = " + id)
      }
    `

    const result = await quickCheck(code, mockEnv)

    expect(result.passesBasicChecks).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('formats review for learning', () => {
    const review: CodeReview = {
      id: 'review-1',
      artifactId: 'artifact-1',
      version: 1,
      approved: false,
      score: 68,
      summary: 'Needs improvement in security and error handling',
      comments: [
        {
          id: 'c1',
          severity: 'critical',
          category: 'security',
          message: 'SQL injection vulnerability',
          suggestion: 'Use parameterized queries',
        },
        {
          id: 'c2',
          severity: 'major',
          category: 'correctness',
          message: 'No error handling',
        },
        {
          id: 'c3',
          severity: 'suggestion',
          category: 'style',
          message: 'Could use const instead of let',
        },
      ],
      positives: ['Good function naming', 'Clear purpose'],
      categories: {
        architecture: 70,
        security: 40,
        performance: 75,
        style: 70,
        correctness: 60,
      },
      reviewedAt: new Date().toISOString(),
      reviewedBy: 'tom',
    }

    const formatted = formatReviewForLearning(review)

    // Should have clear sections
    expect(formatted).toContain('Score: 68/100')
    expect(formatted).toContain("What's Working Well")
    expect(formatted).toContain('Critical Issues (Must Fix)')
    expect(formatted).toContain('Major Issues')
    expect(formatted).toContain('Suggestions for Improvement')
    expect(formatted).toContain('Category Scores')

    // Positives come first (mentoring approach)
    const positivesIndex = formatted.indexOf("What's Working Well")
    const criticalIndex = formatted.indexOf('Critical Issues')
    expect(positivesIndex).toBeLessThan(criticalIndex)
  })
})

// ============================================================================
// REVIEW LOOP TESTS
// ============================================================================

describe('Review Loop (Ralph + Tom Collaboration)', () => {
  const mockEnv = createMockAIEnv()

  beforeEach(() => {
    mockEnv.reset()
  })

  it('completes review loop with approval', async () => {
    // First: Ralph generates
    mockEnv.addJsonResponse({
      code: 'export function add(a, b) { return a + b }',
      filename: 'math.ts',
      imports: [],
      exports: ['add'],
    })

    // Second: Tom reviews (not approved)
    mockEnv.addJsonResponse({
      approved: false,
      score: 70,
      summary: 'Missing type annotations',
      categories: {
        architecture: 80,
        security: 90,
        performance: 80,
        style: 50,
        correctness: 75,
      },
      comments: [
        {
          severity: 'major',
          category: 'style',
          message: 'Missing type annotations',
          suggestion: 'Add number types',
        },
      ],
    })

    // Third: Ralph improves
    mockEnv.addJsonResponse({
      code: 'export function add(a: number, b: number): number { return a + b }',
      filename: 'math.ts',
      imports: [],
      exports: ['add'],
    })

    // Fourth: Tom reviews (approved)
    mockEnv.addJsonResponse({
      approved: true,
      score: 92,
      summary: 'Clean implementation',
      categories: {
        architecture: 90,
        security: 95,
        performance: 90,
        style: 90,
        correctness: 95,
      },
      comments: [],
      positives: ['Good type safety'],
    })

    const spec: CodeSpec = {
      id: 'math-spec',
      title: 'Math Functions',
      description: 'Basic math utilities',
      requirements: ['Add function'],
    }

    const session = await runReviewLoop(spec, mockEnv, { maxIterations: 3 })

    expect(session.status).toBe('approved')
    expect(session.iterations).toBe(2)
    expect(session.artifacts.length).toBe(2)
    expect(session.reviews.length).toBe(2)
    expect(session.finalArtifact).toBeDefined()
    expect(session.prDescription).toBeDefined()
    expect(session.commitMessage).toBeDefined()
  })

  it('respects max iterations', async () => {
    // Generate
    mockEnv.addJsonResponse({
      code: 'export function bad() {}',
      filename: 'bad.ts',
      imports: [],
      exports: ['bad'],
    })

    // Review 1 (not approved)
    mockEnv.addJsonResponse({
      approved: false,
      score: 40,
      summary: 'Many issues',
      categories: {
        architecture: 40,
        security: 40,
        performance: 40,
        style: 40,
        correctness: 40,
      },
      comments: [{ severity: 'critical', category: 'correctness', message: 'Empty function' }],
    })

    // Improve
    mockEnv.addJsonResponse({
      code: 'export function bad() { return null }',
      filename: 'bad.ts',
      imports: [],
      exports: ['bad'],
    })

    // Review 2 (still not approved)
    mockEnv.addJsonResponse({
      approved: false,
      score: 50,
      summary: 'Still has issues',
      categories: {
        architecture: 50,
        security: 50,
        performance: 50,
        style: 50,
        correctness: 50,
      },
      comments: [{ severity: 'major', category: 'correctness', message: 'Returns null' }],
    })

    const spec: CodeSpec = {
      id: 'bad-spec',
      title: 'Bad Function',
      description: 'This will fail',
      requirements: ['Something'],
    }

    const session = await runReviewLoop(spec, mockEnv, { maxIterations: 2 })

    expect(session.status).toBe('rejected')
    expect(session.iterations).toBe(2)
  })

  it('calls iteration callback', async () => {
    mockEnv.addJsonResponse({
      code: 'export const x = 1',
      filename: 'x.ts',
      imports: [],
      exports: ['x'],
    })

    mockEnv.addJsonResponse({
      approved: true,
      score: 95,
      summary: 'Perfect',
      categories: {
        architecture: 95,
        security: 95,
        performance: 95,
        style: 95,
        correctness: 95,
      },
      comments: [],
    })

    const iterations: number[] = []
    const scores: number[] = []

    const config: ReviewLoopConfig = {
      onIteration: (iteration, review) => {
        iterations.push(iteration)
        scores.push(review.score)
      },
    }

    const spec: CodeSpec = {
      id: 'callback-spec',
      title: 'Test Callbacks',
      description: 'Test',
      requirements: ['X'],
    }

    await runReviewLoop(spec, mockEnv, config)

    expect(iterations).toEqual([1])
    expect(scores).toEqual([95])
  })

  it('generates PR description on approval', async () => {
    mockEnv.addJsonResponse({
      code: 'export function feature() {}',
      filename: 'feature.ts',
      imports: [],
      exports: ['feature'],
    })

    mockEnv.addJsonResponse({
      approved: true,
      score: 90,
      summary: 'Good implementation',
      categories: {
        architecture: 90,
        security: 90,
        performance: 90,
        style: 90,
        correctness: 90,
      },
      comments: [],
      positives: ['Clean code'],
    })

    const spec: CodeSpec = {
      id: 'pr-spec',
      title: 'New Feature',
      description: 'Adds a new feature',
      requirements: ['Feature requirement'],
    }

    const session = await runReviewLoop(spec, mockEnv)

    expect(session.prDescription).toContain('Summary')
    expect(session.prDescription).toContain('Changes')
    expect(session.prDescription).toContain('Test Plan')
    expect(session.prDescription).toContain('Review Notes')
    expect(session.prDescription).toContain('Ralph')
    expect(session.prDescription).toContain('Tom')
  })

  it('generates commit message with co-authors', async () => {
    mockEnv.addJsonResponse({
      code: 'export const auth = {}',
      filename: 'auth.ts',
      imports: [],
      exports: ['auth'],
    })

    mockEnv.addJsonResponse({
      approved: true,
      score: 88,
      summary: 'Approved',
      categories: {
        architecture: 88,
        security: 88,
        performance: 88,
        style: 88,
        correctness: 88,
      },
      comments: [],
    })

    const spec: CodeSpec = {
      id: 'commit-spec',
      title: 'Authentication',
      description: 'User auth system',
      requirements: ['Login', 'Logout'],
    }

    const session = await runReviewLoop(spec, mockEnv)

    expect(session.commitMessage).toContain('feat(auth)')
    expect(session.commitMessage).toContain('Authentication')
    expect(session.commitMessage).toContain('Co-Authored-By: Ralph')
    expect(session.commitMessage).toContain('Reviewed-By: Tom')
  })
})

// ============================================================================
// SESSION ANALYSIS TESTS
// ============================================================================

describe('Session Analysis', () => {
  it('calculates session statistics', () => {
    const session: ReviewSession = {
      id: 'session-1',
      specId: 'spec-1',
      status: 'approved',
      artifacts: [
        {
          id: 'a1',
          specId: 'spec-1',
          version: 1,
          language: 'typescript',
          filename: 'test.ts',
          content: 'v1',
          imports: [],
          exports: [],
          generatedAt: new Date().toISOString(),
          generatedBy: 'ralph',
        },
        {
          id: 'a2',
          specId: 'spec-1',
          version: 2,
          language: 'typescript',
          filename: 'test.ts',
          content: 'v2',
          imports: [],
          exports: [],
          generatedAt: new Date().toISOString(),
          generatedBy: 'ralph',
        },
      ],
      reviews: [
        {
          id: 'r1',
          artifactId: 'a1',
          version: 1,
          approved: false,
          score: 65,
          summary: 'Needs work',
          comments: [
            { id: 'c1', severity: 'critical', category: 'security', message: 'Issue 1' },
            { id: 'c2', severity: 'major', category: 'style', message: 'Issue 2' },
          ],
          positives: [],
          categories: {
            architecture: 70,
            security: 50,
            performance: 70,
            style: 60,
            correctness: 75,
          },
          reviewedAt: new Date().toISOString(),
          reviewedBy: 'tom',
        },
        {
          id: 'r2',
          artifactId: 'a2',
          version: 2,
          approved: true,
          score: 90,
          summary: 'Approved',
          comments: [],
          positives: ['Good'],
          categories: {
            architecture: 90,
            security: 90,
            performance: 90,
            style: 90,
            correctness: 90,
          },
          reviewedAt: new Date().toISOString(),
          reviewedBy: 'tom',
        },
      ],
      iterations: 2,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      timing: {
        totalMs: 5000,
        generateMs: 2000,
        reviewMs: 2000,
        improveMs: 1000,
      },
    }

    const stats = getSessionStats(session)

    expect(stats.totalIterations).toBe(2)
    expect(stats.scoreProgression).toEqual([65, 90])
    expect(stats.improvementRate).toBe(25) // (90 - 65) / 1
    expect(stats.averageTimePerIteration).toBe(2500) // 5000 / 2
    expect(stats.criticalIssuesResolved).toBe(1)
  })

  it('formats session summary', () => {
    const session: ReviewSession = {
      id: 'session-1',
      specId: 'spec-1',
      status: 'approved',
      artifacts: [],
      reviews: [],
      iterations: 3,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      finalArtifact: {
        id: 'final',
        specId: 'spec-1',
        version: 3,
        language: 'typescript',
        filename: 'feature.ts',
        content: 'done',
        imports: [],
        exports: [],
        generatedAt: new Date().toISOString(),
        generatedBy: 'ralph',
      },
      commitMessage: 'feat(feature): Add feature\n\nDescription',
      timing: {
        totalMs: 10000,
        generateMs: 3000,
        reviewMs: 4000,
        improveMs: 3000,
      },
    }

    const summary = formatSessionSummary(session)

    expect(summary).toContain('APPROVED')
    expect(summary).toContain('Iterations: 3')
    expect(summary).toContain('feature.ts')
    expect(summary).toContain('10000ms')
  })
})

// ============================================================================
// INTEGRATION PATTERN TESTS
// ============================================================================

describe('Integration Patterns', () => {
  const mockEnv = createMockAIEnv()

  beforeEach(() => {
    mockEnv.reset()
  })

  it('demonstrates the do-while approval pattern', async () => {
    // This test demonstrates the core dotdo pattern:
    // do { app = ralph`improve per ${tom}` } while (!tom.approve)

    mockEnv.addJsonResponse({
      code: 'v1',
      filename: 'app.ts',
      imports: [],
      exports: [],
    })

    mockEnv.addJsonResponse({
      approved: false,
      score: 60,
      summary: 'Not ready',
      categories: {
        architecture: 60,
        security: 60,
        performance: 60,
        style: 60,
        correctness: 60,
      },
      comments: [{ severity: 'major', category: 'correctness', message: 'Fix needed' }],
    })

    mockEnv.addJsonResponse({
      code: 'v2',
      filename: 'app.ts',
      imports: [],
      exports: [],
    })

    mockEnv.addJsonResponse({
      approved: true,
      score: 90,
      summary: 'Ready',
      categories: {
        architecture: 90,
        security: 90,
        performance: 90,
        style: 90,
        correctness: 90,
      },
      comments: [],
    })

    const spec: CodeSpec = {
      id: 'pattern-spec',
      title: 'Pattern Demo',
      description: 'Demonstrates the pattern',
      requirements: ['Works'],
    }

    // This is the pattern in action
    const session = await runReviewLoop(spec, mockEnv)

    // The loop ran until approval
    expect(session.status).toBe('approved')
    expect(session.iterations).toBe(2)

    // Both agents participated
    expect(session.artifacts.every((a) => a.generatedBy === 'ralph')).toBe(true)
    expect(session.reviews.every((r) => r.reviewedBy === 'tom')).toBe(true)
  })

  it('supports single iteration for manual control', async () => {
    mockEnv.addJsonResponse({
      approved: false,
      score: 75,
      summary: 'Feedback',
      categories: {
        architecture: 75,
        security: 75,
        performance: 75,
        style: 75,
        correctness: 75,
      },
      comments: [{ severity: 'minor', category: 'style', message: 'Style issue' }],
    })

    mockEnv.addJsonResponse({
      code: 'improved',
      filename: 'x.ts',
      imports: [],
      exports: [],
    })

    const artifact: CodeArtifact = {
      id: 'a1',
      specId: 'spec-1',
      version: 1,
      language: 'typescript',
      filename: 'x.ts',
      content: 'original',
      imports: [],
      exports: [],
      generatedAt: new Date().toISOString(),
      generatedBy: 'ralph',
    }

    const spec: CodeSpec = {
      id: 'spec-1',
      title: 'Test',
      description: 'Test',
      requirements: ['X'],
    }

    // Manual single iteration
    const result = await runSingleIteration(artifact, spec, mockEnv)

    expect(result.review).toBeDefined()
    expect(result.formattedFeedback).toContain('Score: 75/100')
    expect(result.improvedArtifact).toBeDefined() // Not approved, so improvement exists
  })
})
