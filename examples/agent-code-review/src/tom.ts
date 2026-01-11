/**
 * Tom - Tech Lead Agent
 *
 * Technical architect who reviews code for quality, security, and correctness.
 * Uses the composable persona system with emphasis on mentoring traits.
 *
 * ## Traits
 * - technical: Understand system architecture and patterns
 * - analytical: Evaluate trade-offs objectively
 * - mentoring: Provide constructive feedback and guidance
 *
 * ## Role Capabilities
 * - Review code for quality and correctness
 * - Design system architecture
 * - Make technical decisions
 * - Identify risks and trade-offs
 * - Mentor and provide feedback
 *
 * ## Review Categories
 * Tom evaluates code across 5 dimensions (0-100 each):
 * 1. Architecture: Design patterns, modularity, separation of concerns
 * 2. Security: Input validation, auth, data protection
 * 3. Performance: Efficiency, memory usage, complexity
 * 4. Style: Naming, formatting, consistency
 * 5. Correctness: Logic, edge cases, error handling
 *
 * @example
 * ```ts
 * import { tom, reviewCode } from './tom'
 *
 * // Review code artifact
 * const review = await reviewCode(artifact, spec, env)
 *
 * if (review.approved) {
 *   console.log('Code is production-ready!')
 * } else {
 *   console.log(`${review.comments.length} issues to address`)
 * }
 * ```
 *
 * @module agent-code-review/tom
 */

import {
  persona,
  TRAITS,
  ROLE_DEFINITIONS,
  type AgentPersona,
} from '../../../agents/named/factory'

// ============================================================================
// PERSONA COMPOSITION
// ============================================================================

/**
 * Tom's composed persona using the trait system.
 *
 * The key differentiator is the **mentoring** trait which ensures:
 * - Feedback is constructive, not critical
 * - Explanations include the "why"
 * - Suggestions are actionable
 * - Balance between perfectionism and pragmatism
 */
export const tomPersona: AgentPersona = persona('Tom', 'tech-lead')
  .withDescription('Technical architect who reviews code and provides mentoring feedback')
  .withPreamble(`Your role is to review code for quality, security, and correctness.

You are a mentor, not just a gatekeeper. Your feedback should help developers grow.

## Review Philosophy
- Be thorough but constructive
- Focus on important issues first
- Explain the "why" behind every piece of feedback
- Provide actionable suggestions
- Balance perfectionism with pragmatism
- Acknowledge good patterns alongside issues

## Approval Criteria
Only approve code that is truly production-ready:
- All critical and major issues must be addressed
- No security vulnerabilities
- Proper error handling
- Reasonable test coverage for edge cases`)
  .withTraits('mentoring') // Add mentoring on top of tech-lead defaults
  .addCapabilities(
    'Score code across 5 quality dimensions',
    'Provide line-level feedback with suggestions',
    'Identify patterns worth learning from'
  )
  .addGuidelines(
    'Every comment should teach something',
    'Praise good patterns alongside critiques',
    'Be specific about how to fix issues',
    'Consider the developer\'s growth, not just the code'
  )
  .build()

/**
 * System prompt for code review
 */
export const TOM_REVIEW_PROMPT = `${tomPersona.instructions}

## Review Categories (score 0-100 each)
1. Architecture: Design patterns, modularity, separation of concerns
2. Security: Input validation, auth, data protection
3. Performance: Efficiency, memory usage, complexity
4. Style: Naming, formatting, consistency
5. Correctness: Logic, edge cases, error handling

## Output Format
Respond with a JSON object:
{
  "approved": boolean,
  "score": number (0-100 overall),
  "summary": "brief summary including both strengths and areas for improvement",
  "categories": {
    "architecture": number,
    "security": number,
    "performance": number,
    "style": number,
    "correctness": number
  },
  "comments": [
    {
      "line": number or null,
      "severity": "critical|major|minor|suggestion",
      "category": "architecture|security|performance|style|correctness|testing",
      "message": "description of issue with explanation of why it matters",
      "suggestion": "specific, actionable fix"
    }
  ],
  "positives": ["list of good patterns worth noting"]
}`

// ============================================================================
// TYPES
// ============================================================================

/**
 * Specification for code generation
 */
export interface CodeSpec {
  id: string
  title: string
  description: string
  requirements: string[]
  constraints?: string[]
  examples?: string[]
}

/**
 * Generated code artifact
 */
export interface CodeArtifact {
  id: string
  specId: string
  version: number
  language: string
  filename: string
  content: string
  imports: string[]
  exports: string[]
  generatedAt: string
  generatedBy: 'ralph'
}

/**
 * Individual review comment
 */
export interface ReviewComment {
  id: string
  line?: number
  severity: 'critical' | 'major' | 'minor' | 'suggestion'
  category: 'architecture' | 'security' | 'performance' | 'style' | 'correctness' | 'testing'
  message: string
  suggestion?: string
}

/**
 * Code review result from Tom
 */
export interface CodeReview {
  id: string
  artifactId: string
  version: number
  approved: boolean
  score: number
  summary: string
  comments: ReviewComment[]
  positives: string[]
  categories: {
    architecture: number
    security: number
    performance: number
    style: number
    correctness: number
  }
  reviewedAt: string
  reviewedBy: 'tom'
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

function parseJsonResponse<T>(text: string): T | null {
  try {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const jsonStr = jsonMatch[1] || jsonMatch[0]
      return JSON.parse(jsonStr.trim())
    }
    return null
  } catch {
    return null
  }
}

// ============================================================================
// CODE REVIEW
// ============================================================================

/**
 * Review code using Tom's mentoring approach
 *
 * Tom evaluates code across 5 dimensions and provides:
 * - Overall approval decision
 * - Score (0-100)
 * - Line-level comments with suggestions
 * - Positive patterns worth noting
 *
 * @example
 * ```ts
 * const review = await reviewCode(artifact, spec, env)
 *
 * // Check categories
 * console.log(`Security: ${review.categories.security}/100`)
 *
 * // Get critical issues
 * const critical = review.comments.filter(c => c.severity === 'critical')
 * ```
 */
export async function reviewCode(
  artifact: CodeArtifact,
  spec: CodeSpec,
  env: AIEnv
): Promise<CodeReview> {
  const prompt = `Review the following TypeScript code:

## Specification
Title: ${spec.title}
Description: ${spec.description}
Requirements:
${spec.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

## Code to Review
Filename: ${artifact.filename}
Version: ${artifact.version}
\`\`\`typescript
${artifact.content}
\`\`\`

Provide a thorough code review covering architecture, security, performance, style, and correctness.
Include both issues and positive patterns. Approve only if the code meets production standards.`

  const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<Ai['run']>[0], {
    messages: [
      { role: 'system', content: TOM_REVIEW_PROMPT },
      { role: 'user', content: prompt },
    ],
  })

  const responseText = typeof response === 'string' ? response : (response as { response: string }).response
  const parsed = parseJsonResponse<{
    approved: boolean
    score: number
    summary: string
    categories: {
      architecture: number
      security: number
      performance: number
      style: number
      correctness: number
    }
    comments: Array<{
      line?: number
      severity: 'critical' | 'major' | 'minor' | 'suggestion'
      category: 'architecture' | 'security' | 'performance' | 'style' | 'correctness' | 'testing'
      message: string
      suggestion?: string
    }>
    positives?: string[]
  }>(responseText)

  return {
    id: generateId(),
    artifactId: artifact.id,
    version: artifact.version,
    approved: parsed?.approved ?? false,
    score: parsed?.score ?? 50,
    summary: parsed?.summary ?? 'Review completed',
    comments: (parsed?.comments || []).map((c) => ({
      id: generateId(),
      ...c,
    })),
    positives: parsed?.positives || [],
    categories: parsed?.categories ?? {
      architecture: 70,
      security: 70,
      performance: 70,
      style: 70,
      correctness: 70,
    },
    reviewedAt: new Date().toISOString(),
    reviewedBy: 'tom',
  }
}

/**
 * Quick approval check (without full review)
 *
 * Useful for checking if code meets a minimum quality threshold
 * before running a full review.
 */
export async function quickCheck(
  code: string,
  env: AIEnv
): Promise<{ passesBasicChecks: boolean; issues: string[] }> {
  const prompt = `Quick check this TypeScript code for critical issues only:

\`\`\`typescript
${code}
\`\`\`

Respond with JSON:
{
  "passesBasicChecks": boolean,
  "issues": ["list of critical issues only"]
}`

  const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<Ai['run']>[0], {
    messages: [
      { role: 'system', content: 'You are Tom, a tech lead doing a quick code check.' },
      { role: 'user', content: prompt },
    ],
  })

  const responseText = typeof response === 'string' ? response : (response as { response: string }).response
  const parsed = parseJsonResponse<{
    passesBasicChecks: boolean
    issues: string[]
  }>(responseText)

  return {
    passesBasicChecks: parsed?.passesBasicChecks ?? true,
    issues: parsed?.issues || [],
  }
}

// ============================================================================
// MENTORING TRAIT HELPERS
// ============================================================================

/**
 * Get Tom's trait composition
 */
export function getTomTraits(): string[] {
  const role = ROLE_DEFINITIONS['tech-lead']
  return [...role.traits, 'mentoring'] // Tech-lead + explicit mentoring
}

/**
 * Get detailed trait information
 */
export function getTraitDetails() {
  const traits = getTomTraits()
  return traits.map((id) => TRAITS[id]).filter(Boolean)
}

/**
 * Get the mentoring trait specifically
 */
export function getMentoringTrait() {
  return TRAITS['mentoring']
}

/**
 * Format review for developer learning
 *
 * Organizes feedback to maximize learning opportunity:
 * 1. Start with positives (what's working)
 * 2. Critical issues (must fix)
 * 3. Suggestions (could improve)
 */
export function formatReviewForLearning(review: CodeReview): string {
  const sections: string[] = []

  // Score overview
  sections.push(`## Code Review - Score: ${review.score}/100`)
  sections.push('')
  sections.push(review.summary)
  sections.push('')

  // Positives first (mentoring approach)
  if (review.positives.length > 0) {
    sections.push('### What\'s Working Well')
    review.positives.forEach((p) => sections.push(`- ${p}`))
    sections.push('')
  }

  // Critical issues
  const critical = review.comments.filter((c) => c.severity === 'critical')
  if (critical.length > 0) {
    sections.push('### Critical Issues (Must Fix)')
    critical.forEach((c) => {
      sections.push(`- **${c.category}**${c.line ? ` (line ${c.line})` : ''}: ${c.message}`)
      if (c.suggestion) sections.push(`  - Fix: ${c.suggestion}`)
    })
    sections.push('')
  }

  // Major issues
  const major = review.comments.filter((c) => c.severity === 'major')
  if (major.length > 0) {
    sections.push('### Major Issues')
    major.forEach((c) => {
      sections.push(`- **${c.category}**${c.line ? ` (line ${c.line})` : ''}: ${c.message}`)
      if (c.suggestion) sections.push(`  - Suggestion: ${c.suggestion}`)
    })
    sections.push('')
  }

  // Suggestions
  const suggestions = review.comments.filter((c) => c.severity === 'suggestion' || c.severity === 'minor')
  if (suggestions.length > 0) {
    sections.push('### Suggestions for Improvement')
    suggestions.forEach((c) => {
      sections.push(`- ${c.message}`)
      if (c.suggestion) sections.push(`  - ${c.suggestion}`)
    })
    sections.push('')
  }

  // Category breakdown
  sections.push('### Category Scores')
  sections.push(`- Architecture: ${review.categories.architecture}/100`)
  sections.push(`- Security: ${review.categories.security}/100`)
  sections.push(`- Performance: ${review.categories.performance}/100`)
  sections.push(`- Style: ${review.categories.style}/100`)
  sections.push(`- Correctness: ${review.categories.correctness}/100`)

  return sections.join('\n')
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  persona: tomPersona,
  reviewCode,
  quickCheck,
  getTomTraits,
  getTraitDetails,
  getMentoringTrait,
  formatReviewForLearning,
}
