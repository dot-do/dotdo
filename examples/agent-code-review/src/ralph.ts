/**
 * Ralph - Engineering Agent
 *
 * Senior software engineer who generates production-ready code.
 * Uses the composable persona system for trait-based configuration.
 *
 * ## Traits
 * - technical: Write clean, maintainable code
 * - analytical: Break down problems systematically
 * - detail_oriented: Catch edge cases and ensure completeness
 *
 * ## Role Capabilities
 * - Write clean, production-ready code
 * - Implement features from specifications
 * - Refactor and improve based on feedback
 * - Generate tests alongside implementation
 *
 * @example
 * ```ts
 * import { ralph, generateCode, improveCode } from './ralph'
 *
 * // Template literal usage
 * const code = await ralph`implement user authentication`
 *
 * // Structured generation
 * const artifact = await generateCode(spec, env)
 *
 * // Improve based on feedback
 * const improved = await improveCode(artifact, review, env)
 * ```
 *
 * @module agent-code-review/ralph
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
 * Ralph's composed persona using the trait system.
 *
 * Extends the base engineering role with additional capabilities:
 * - Focus on addressing review feedback
 * - Iterative improvement mindset
 * - Clear change documentation
 */
export const ralphPersona: AgentPersona = persona('Ralph', 'engineering')
  .withDescription('Senior software engineer who generates production-ready code')
  .withPreamble(`Your role is to build, implement, and improve code based on specifications and feedback.

When generating code:
- Write TypeScript with proper type annotations
- Include comprehensive error handling
- Add JSDoc comments for public APIs
- Structure code for maintainability and testability

When improving code based on feedback:
- Address ALL feedback points
- Explain what changed and why
- Preserve existing functionality unless asked to change it
- Maintain code quality and consistency`)
  .addCapabilities(
    'Address code review feedback precisely',
    'Document changes clearly',
    'Iterate rapidly on improvements'
  )
  .addGuidelines(
    'Never argue with feedback - just improve',
    'Explain implementation decisions briefly',
    'Make code immediately usable'
  )
  .build()

/**
 * System prompt for code generation
 */
export const RALPH_GENERATE_PROMPT = `${ralphPersona.instructions}

## Output Format
Respond with a JSON object containing:
{
  "code": "the generated TypeScript code",
  "filename": "suggested-filename.ts",
  "imports": ["list of imports used"],
  "exports": ["list of exports"],
  "explanation": "brief explanation of implementation decisions"
}`

/**
 * System prompt for code improvement
 */
export const RALPH_IMPROVE_PROMPT = `${ralphPersona.instructions}

You will receive:
1. The original code
2. Review feedback with specific comments

Your task is to improve the code addressing ALL feedback points.

## Output Format
Respond with a JSON object containing:
{
  "code": "the improved TypeScript code",
  "filename": "filename.ts",
  "imports": ["list of imports used"],
  "exports": ["list of exports"],
  "changesApplied": ["list of changes made to address feedback"]
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
 * Code review result (from Tom)
 */
export interface CodeReview {
  id: string
  artifactId: string
  version: number
  approved: boolean
  score: number
  summary: string
  comments: ReviewComment[]
  positives?: string[]
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
// CODE GENERATION
// ============================================================================

/**
 * Generate code from a specification using Ralph
 *
 * @example
 * ```ts
 * const artifact = await generateCode({
 *   id: 'spec-1',
 *   title: 'User Auth',
 *   description: 'JWT-based authentication',
 *   requirements: ['Login', 'Logout', 'Token refresh']
 * }, env)
 * ```
 */
export async function generateCode(spec: CodeSpec, env: AIEnv): Promise<CodeArtifact> {
  const prompt = `Generate TypeScript code for the following specification:

## Title
${spec.title}

## Description
${spec.description}

## Requirements
${spec.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

${spec.constraints ? `## Constraints\n${spec.constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : ''}

${spec.examples ? `## Examples\n${spec.examples.join('\n\n')}` : ''}`

  const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<Ai['run']>[0], {
    messages: [
      { role: 'system', content: RALPH_GENERATE_PROMPT },
      { role: 'user', content: prompt },
    ],
  })

  const responseText = typeof response === 'string' ? response : (response as { response: string }).response
  const parsed = parseJsonResponse<{
    code: string
    filename: string
    imports: string[]
    exports: string[]
  }>(responseText)

  return {
    id: generateId(),
    specId: spec.id,
    version: 1,
    language: 'typescript',
    filename: parsed?.filename || 'generated.ts',
    content: parsed?.code || responseText,
    imports: parsed?.imports || [],
    exports: parsed?.exports || [],
    generatedAt: new Date().toISOString(),
    generatedBy: 'ralph',
  }
}

/**
 * Improve code based on review feedback using Ralph
 *
 * Ralph addresses ALL feedback points while:
 * - Preserving existing functionality
 * - Explaining what changed and why
 * - Maintaining code quality
 *
 * @example
 * ```ts
 * const improved = await improveCode(artifact, review, env)
 * console.log(`v${improved.version} addresses ${review.comments.length} comments`)
 * ```
 */
export async function improveCode(
  artifact: CodeArtifact,
  review: CodeReview,
  env: AIEnv
): Promise<CodeArtifact> {
  const prompt = `Improve the following code based on the review feedback:

## Original Code
\`\`\`typescript
${artifact.content}
\`\`\`

## Review Feedback
Score: ${review.score}/100
Summary: ${review.summary}

## Comments to Address
${review.comments.map((c, i) => `
${i + 1}. [${c.severity.toUpperCase()}] (${c.category})${c.line ? ` Line ${c.line}:` : ':'}
   ${c.message}
   ${c.suggestion ? `Suggestion: ${c.suggestion}` : ''}
`).join('\n')}

Please address ALL the feedback and improve the code.`

  const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<Ai['run']>[0], {
    messages: [
      { role: 'system', content: RALPH_IMPROVE_PROMPT },
      { role: 'user', content: prompt },
    ],
  })

  const responseText = typeof response === 'string' ? response : (response as { response: string }).response
  const parsed = parseJsonResponse<{
    code: string
    filename: string
    imports: string[]
    exports: string[]
  }>(responseText)

  return {
    id: generateId(),
    specId: artifact.specId,
    version: artifact.version + 1,
    language: 'typescript',
    filename: parsed?.filename || artifact.filename,
    content: parsed?.code || responseText,
    imports: parsed?.imports || artifact.imports,
    exports: parsed?.exports || artifact.exports,
    generatedAt: new Date().toISOString(),
    generatedBy: 'ralph',
  }
}

// ============================================================================
// TRAIT INFORMATION
// ============================================================================

/**
 * Get Ralph's trait composition
 */
export function getRalphTraits(): string[] {
  const role = ROLE_DEFINITIONS['engineering']
  return role.traits
}

/**
 * Get detailed trait information
 */
export function getTraitDetails() {
  const traits = getRalphTraits()
  return traits.map((id) => TRAITS[id]).filter(Boolean)
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  persona: ralphPersona,
  generateCode,
  improveCode,
  getRalphTraits,
  getTraitDetails,
}
