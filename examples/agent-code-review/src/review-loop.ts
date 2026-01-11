/**
 * Review Loop - Iterative Refinement Orchestration
 *
 * Orchestrates the Ralph + Tom collaboration loop:
 * 1. Ralph generates code from spec
 * 2. Tom reviews with structured feedback
 * 3. Ralph improves based on feedback
 * 4. Repeat until approved or max iterations
 *
 * This demonstrates the core pattern from the dotdo framework:
 * ```typescript
 * let app = await ralph`build ${spec}`
 * do {
 *   app = await ralph`improve ${app} per ${tom}`
 * } while (!await tom.approve(app))
 * ```
 *
 * @example
 * ```ts
 * import { runReviewLoop, ReviewLoopConfig } from './review-loop'
 *
 * const session = await runReviewLoop(spec, env, {
 *   maxIterations: 5,
 *   minScore: 85,
 *   onIteration: (iteration, review) => {
 *     console.log(`Iteration ${iteration}: Score ${review.score}`)
 *   }
 * })
 *
 * if (session.status === 'approved') {
 *   console.log('Production-ready code generated!')
 * }
 * ```
 *
 * @module agent-code-review/review-loop
 */

import { generateCode, improveCode, type CodeSpec, type CodeArtifact, type CodeReview } from './ralph'
import { reviewCode, formatReviewForLearning } from './tom'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Review session status
 */
export type ReviewStatus = 'in_progress' | 'approved' | 'rejected' | 'abandoned'

/**
 * Full review session tracking the refinement loop
 */
export interface ReviewSession {
  id: string
  specId: string
  status: ReviewStatus
  artifacts: CodeArtifact[]
  reviews: CodeReview[]
  iterations: number
  startedAt: string
  completedAt?: string
  finalArtifact?: CodeArtifact
  prDescription?: string
  commitMessage?: string
  /** Time spent in each phase */
  timing?: {
    totalMs: number
    generateMs: number
    reviewMs: number
    improveMs: number
  }
}

/**
 * Configuration for the review loop
 */
export interface ReviewLoopConfig {
  /** Maximum iterations before giving up (default: 5) */
  maxIterations?: number
  /** Minimum score to accept (default: 80) */
  minScore?: number
  /** Auto-approve on first iteration if score above this threshold */
  autoApproveThreshold?: number
  /** Callback after each iteration */
  onIteration?: (iteration: number, review: CodeReview, artifact: CodeArtifact) => void | Promise<void>
  /** Callback on approval */
  onApproval?: (session: ReviewSession) => void | Promise<void>
  /** Callback on rejection */
  onRejection?: (session: ReviewSession) => void | Promise<void>
}

/**
 * PR description structure
 */
export interface PRDescription {
  title: string
  summary: string
  changes: string[]
  testPlan: string[]
  reviewNotes: string[]
}

/**
 * AI environment bindings
 */
export interface AIEnv {
  AI: Ai
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// REVIEW LOOP
// ============================================================================

/**
 * Run the full Ralph + Tom review loop
 *
 * This is the core collaboration pattern:
 * 1. Ralph generates initial code from the specification
 * 2. Tom reviews and provides structured feedback
 * 3. If not approved, Ralph improves based on feedback
 * 4. Loop continues until approved or max iterations reached
 *
 * @param spec - The code specification to implement
 * @param env - AI environment with bindings
 * @param config - Loop configuration options
 * @returns The complete review session with all artifacts and reviews
 *
 * @example
 * ```ts
 * // Basic usage
 * const session = await runReviewLoop(spec, env)
 *
 * // With configuration
 * const session = await runReviewLoop(spec, env, {
 *   maxIterations: 3,
 *   minScore: 90,
 *   onIteration: (i, r) => console.log(`Iteration ${i}: ${r.score}`)
 * })
 * ```
 */
export async function runReviewLoop(
  spec: CodeSpec,
  env: AIEnv,
  config: ReviewLoopConfig = {}
): Promise<ReviewSession> {
  const {
    maxIterations = 5,
    minScore = 80,
    autoApproveThreshold,
    onIteration,
    onApproval,
    onRejection,
  } = config

  const startTime = Date.now()
  const sessionId = generateId()

  const session: ReviewSession = {
    id: sessionId,
    specId: spec.id,
    status: 'in_progress',
    artifacts: [],
    reviews: [],
    iterations: 0,
    startedAt: new Date().toISOString(),
    timing: {
      totalMs: 0,
      generateMs: 0,
      reviewMs: 0,
      improveMs: 0,
    },
  }

  // Step 1: Ralph generates initial code
  const generateStart = Date.now()
  let artifact = await generateCode(spec, env)
  session.timing!.generateMs += Date.now() - generateStart
  session.artifacts.push(artifact)

  // Iterative refinement loop
  while (session.iterations < maxIterations) {
    session.iterations++

    // Step 2: Tom reviews the code
    const reviewStart = Date.now()
    const review = await reviewCode(artifact, spec, env)
    session.timing!.reviewMs += Date.now() - reviewStart
    session.reviews.push(review)

    // Callback
    if (onIteration) {
      await onIteration(session.iterations, review, artifact)
    }

    // Step 3: Check approval conditions
    const isApproved = review.approved || review.score >= (autoApproveThreshold ?? 100)
    const meetsMinScore = review.score >= minScore

    if (isApproved && meetsMinScore) {
      session.status = 'approved'
      session.finalArtifact = artifact
      session.completedAt = new Date().toISOString()

      // Generate PR artifacts
      session.prDescription = generatePRDescription(artifact, review, spec)
      session.commitMessage = generateCommitMessage(artifact, spec)

      // Callback
      if (onApproval) {
        await onApproval(session)
      }

      break
    }

    // Step 4: Ralph improves based on feedback
    if (session.iterations < maxIterations) {
      const improveStart = Date.now()
      artifact = await improveCode(artifact, review, env)
      session.timing!.improveMs += Date.now() - improveStart
      session.artifacts.push(artifact)
    } else {
      // Max iterations reached without approval
      session.status = 'rejected'
      session.completedAt = new Date().toISOString()

      if (onRejection) {
        await onRejection(session)
      }
    }
  }

  session.timing!.totalMs = Date.now() - startTime
  return session
}

/**
 * Run a single iteration of the review loop
 *
 * Useful for manual stepping through the process or
 * when you want fine-grained control over the loop.
 *
 * @example
 * ```ts
 * let artifact = await generateCode(spec, env)
 *
 * for (let i = 0; i < 5; i++) {
 *   const result = await runSingleIteration(artifact, spec, env)
 *
 *   if (result.review.approved) {
 *     console.log('Approved!')
 *     break
 *   }
 *
 *   artifact = result.improvedArtifact!
 * }
 * ```
 */
export async function runSingleIteration(
  artifact: CodeArtifact,
  spec: CodeSpec,
  env: AIEnv
): Promise<{
  review: CodeReview
  improvedArtifact?: CodeArtifact
  formattedFeedback: string
}> {
  // Tom reviews
  const review = await reviewCode(artifact, spec, env)

  // Format feedback for learning
  const formattedFeedback = formatReviewForLearning(review)

  // If not approved, Ralph improves
  let improvedArtifact: CodeArtifact | undefined
  if (!review.approved) {
    improvedArtifact = await improveCode(artifact, review, env)
  }

  return {
    review,
    improvedArtifact,
    formattedFeedback,
  }
}

// ============================================================================
// PR AND COMMIT GENERATION
// ============================================================================

/**
 * Generate a PR description from the review session
 */
export function generatePRDescription(
  artifact: CodeArtifact,
  review: CodeReview,
  spec: CodeSpec
): string {
  const description: PRDescription = {
    title: `feat: ${spec.title}`,
    summary: spec.description,
    changes: [
      `Add ${artifact.filename}`,
      ...artifact.exports.map((e) => `Export: ${e}`),
    ],
    testPlan: [
      'Unit tests included',
      'Manual testing performed',
      'Edge cases validated',
    ],
    reviewNotes: [
      `AI Review Score: ${review.score}/100`,
      review.summary,
      ...(review.positives || []).map((p) => `Positive: ${p}`),
    ],
  }

  return `## Summary
${description.summary}

## Changes
${description.changes.map((c) => `- ${c}`).join('\n')}

## Test Plan
${description.testPlan.map((t) => `- [ ] ${t}`).join('\n')}

## Review Notes
${description.reviewNotes.map((n) => `- ${n}`).join('\n')}

## Category Scores
| Category | Score |
|----------|-------|
| Architecture | ${review.categories.architecture}/100 |
| Security | ${review.categories.security}/100 |
| Performance | ${review.categories.performance}/100 |
| Style | ${review.categories.style}/100 |
| Correctness | ${review.categories.correctness}/100 |

---
Generated with Ralph (Engineering) + Tom (Tech Lead) code review
Iterations: ${artifact.version} | Final Score: ${review.score}/100`
}

/**
 * Generate a commit message from the artifact
 */
export function generateCommitMessage(artifact: CodeArtifact, spec: CodeSpec): string {
  const filename = artifact.filename.replace('.ts', '')
  return `feat(${filename}): ${spec.title}

${spec.description}

- Implements ${spec.requirements.length} requirements
- AI-reviewed and approved (v${artifact.version})

Co-Authored-By: Ralph <ralph@agents.do>
Reviewed-By: Tom <tom@agents.do>`
}

// ============================================================================
// SESSION ANALYSIS
// ============================================================================

/**
 * Get statistics about the review session
 */
export function getSessionStats(session: ReviewSession): {
  totalIterations: number
  scoreProgression: number[]
  improvementRate: number
  averageTimePerIteration: number
  criticalIssuesResolved: number
  totalCommentsAddressed: number
} {
  const scores = session.reviews.map((r) => r.score)
  const firstScore = scores[0] ?? 0
  const lastScore = scores[scores.length - 1] ?? 0
  const improvement = lastScore - firstScore

  // Count issues resolved
  let totalComments = 0
  let criticalResolved = 0

  session.reviews.forEach((review, i) => {
    totalComments += review.comments.length

    if (i < session.reviews.length - 1) {
      // Count critical issues that were resolved
      const nextReview = session.reviews[i + 1]
      const criticalCount = review.comments.filter((c) => c.severity === 'critical').length
      const nextCriticalCount = nextReview.comments.filter((c) => c.severity === 'critical').length
      criticalResolved += Math.max(0, criticalCount - nextCriticalCount)
    }
  })

  return {
    totalIterations: session.iterations,
    scoreProgression: scores,
    improvementRate: session.iterations > 1 ? improvement / (session.iterations - 1) : 0,
    averageTimePerIteration: session.timing?.totalMs
      ? session.timing.totalMs / session.iterations
      : 0,
    criticalIssuesResolved: criticalResolved,
    totalCommentsAddressed: totalComments,
  }
}

/**
 * Format session summary for logging
 */
export function formatSessionSummary(session: ReviewSession): string {
  const stats = getSessionStats(session)
  const status = session.status.toUpperCase()
  const statusEmoji = session.status === 'approved' ? '' : session.status === 'rejected' ? '' : ''

  const lines = [
    `${statusEmoji} Review Session: ${status}`,
    `Spec: ${session.specId}`,
    `Iterations: ${session.iterations}`,
    `Score Progression: ${stats.scoreProgression.join(' -> ')}`,
    `Time: ${session.timing?.totalMs ?? 0}ms`,
    '',
  ]

  if (session.status === 'approved' && session.finalArtifact) {
    lines.push(`Final Artifact: ${session.finalArtifact.filename} (v${session.finalArtifact.version})`)
    lines.push(`Commit: ${session.commitMessage?.split('\n')[0]}`)
  }

  if (session.status === 'rejected') {
    const lastReview = session.reviews[session.reviews.length - 1]
    if (lastReview) {
      lines.push(`Final Score: ${lastReview.score}/100`)
      lines.push(`Remaining Issues: ${lastReview.comments.length}`)
    }
  }

  return lines.join('\n')
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  runReviewLoop,
  runSingleIteration,
  generatePRDescription,
  generateCommitMessage,
  getSessionStats,
  formatSessionSummary,
}
