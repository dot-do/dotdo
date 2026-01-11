/**
 * CodeReviewDO - AI-Powered Code Review Durable Object
 *
 * Demonstrates Ralph (Engineering) and Tom (Tech Lead) collaboration:
 * 1. Ralph generates code from specifications
 * 2. Tom performs structured code review
 * 3. Iterative refinement until approval
 * 4. Auto-generated PR descriptions and commit messages
 *
 * @module agent-code-review
 */

import { DurableObject } from 'cloudflare:workers'

// ============================================================================
// TYPES
// ============================================================================

/** Specification for code generation */
export interface CodeSpec {
  id: string
  title: string
  description: string
  requirements: string[]
  constraints?: string[]
  examples?: string[]
}

/** Generated code artifact */
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

/** Individual review comment */
export interface ReviewComment {
  id: string
  line?: number
  severity: 'critical' | 'major' | 'minor' | 'suggestion'
  category: 'architecture' | 'security' | 'performance' | 'style' | 'correctness' | 'testing'
  message: string
  suggestion?: string
}

/** Code review result from Tom */
export interface CodeReview {
  id: string
  artifactId: string
  version: number
  approved: boolean
  score: number // 0-100
  summary: string
  comments: ReviewComment[]
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

/** Review session tracking full refinement loop */
export interface ReviewSession {
  id: string
  specId: string
  status: 'in_progress' | 'approved' | 'rejected' | 'abandoned'
  artifacts: CodeArtifact[]
  reviews: CodeReview[]
  iterations: number
  startedAt: string
  completedAt?: string
  finalArtifact?: CodeArtifact
  prDescription?: string
  commitMessage?: string
}

/** PR description generated after approval */
export interface PRDescription {
  title: string
  summary: string
  changes: string[]
  testPlan: string[]
  reviewNotes: string[]
}

// ============================================================================
// AGENT SYSTEM PROMPTS
// ============================================================================

const RALPH_SYSTEM_PROMPT = `You are Ralph, a senior software engineer.

Your role is to generate clean, production-ready TypeScript code based on specifications.

## Guidelines
- Write TypeScript with proper type annotations
- Include comprehensive error handling
- Add JSDoc comments for public APIs
- Follow modern best practices and patterns
- Generate tests alongside implementation when appropriate
- Structure code for maintainability and testability

## Output Format
Respond with a JSON object containing:
{
  "code": "the generated TypeScript code",
  "filename": "suggested-filename.ts",
  "imports": ["list of imports used"],
  "exports": ["list of exports"],
  "explanation": "brief explanation of implementation decisions"
}`

const TOM_REVIEW_PROMPT = `You are Tom, a technical lead performing code review.

Your role is to review code for quality, security, and correctness.

## Review Categories (score 0-100 each)
1. Architecture: Design patterns, modularity, separation of concerns
2. Security: Input validation, auth, data protection
3. Performance: Efficiency, memory usage, complexity
4. Style: Naming, formatting, consistency
5. Correctness: Logic, edge cases, error handling

## Guidelines
- Be thorough but constructive
- Focus on important issues first
- Explain the "why" behind feedback
- Provide actionable suggestions
- Balance perfectionism with pragmatism

## Output Format
Respond with a JSON object:
{
  "approved": boolean,
  "score": number (0-100 overall),
  "summary": "brief summary of review",
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
      "message": "description of issue",
      "suggestion": "how to fix (optional)"
    }
  ]
}`

const RALPH_IMPROVE_PROMPT = `You are Ralph, a senior software engineer addressing code review feedback.

You will receive:
1. The original code
2. Review feedback with specific comments

Your task is to improve the code addressing ALL feedback points while:
- Preserving existing functionality unless explicitly asked to change it
- Explaining what changed and why
- Maintaining code quality and consistency

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
// HELPER FUNCTIONS
// ============================================================================

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function parseJsonResponse<T>(text: string): T | null {
  try {
    // Try to extract JSON from markdown code blocks if present
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                      text.match(/\{[\s\S]*\}/)
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
// CODE REVIEW DURABLE OBJECT
// ============================================================================

interface Env {
  AI: Ai
  ENVIRONMENT?: string
}

export class CodeReviewDO extends DurableObject<Env> {
  private sessions: Map<string, ReviewSession> = new Map()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Restore sessions from storage on initialization
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<Map<string, ReviewSession>>('sessions')
      if (stored) {
        this.sessions = stored
      }
    })
  }

  private async saveState(): Promise<void> {
    await this.ctx.storage.put('sessions', this.sessions)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RALPH - Code Generation
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate code from a specification using Ralph
   */
  async generateCode(spec: CodeSpec): Promise<CodeArtifact> {
    const prompt = `Generate TypeScript code for the following specification:

## Title
${spec.title}

## Description
${spec.description}

## Requirements
${spec.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

${spec.constraints ? `## Constraints\n${spec.constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : ''}

${spec.examples ? `## Examples\n${spec.examples.join('\n\n')}` : ''}`

    const response = await this.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<Ai['run']>[0], {
      messages: [
        { role: 'system', content: RALPH_SYSTEM_PROMPT },
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

    const artifact: CodeArtifact = {
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

    return artifact
  }

  /**
   * Improve code based on review feedback using Ralph
   */
  async improveCode(artifact: CodeArtifact, review: CodeReview): Promise<CodeArtifact> {
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

    const response = await this.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<Ai['run']>[0], {
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

    const improvedArtifact: CodeArtifact = {
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

    return improvedArtifact
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOM - Code Review
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Review code using Tom
   */
  async reviewCode(artifact: CodeArtifact, spec: CodeSpec): Promise<CodeReview> {
    const prompt = `Review the following TypeScript code:

## Specification
Title: ${spec.title}
Description: ${spec.description}
Requirements:
${spec.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

## Code to Review
Filename: ${artifact.filename}
\`\`\`typescript
${artifact.content}
\`\`\`

Provide a thorough code review covering architecture, security, performance, style, and correctness.
Approve only if the code meets production standards.`

    const response = await this.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<Ai['run']>[0], {
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
    }>(responseText)

    const review: CodeReview = {
      id: generateId(),
      artifactId: artifact.id,
      version: artifact.version,
      approved: parsed?.approved ?? false,
      score: parsed?.score ?? 50,
      summary: parsed?.summary ?? 'Review completed',
      comments: (parsed?.comments || []).map(c => ({
        id: generateId(),
        ...c,
      })),
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

    return review
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REVIEW SESSION - Full Refinement Loop
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start a new code review session
   *
   * This implements the full Ralph + Tom collaboration loop:
   * 1. Ralph generates initial code from spec
   * 2. Tom reviews the code
   * 3. If not approved, Ralph improves based on feedback
   * 4. Repeat until approved or max iterations reached
   */
  async startReviewSession(
    spec: CodeSpec,
    options: { maxIterations?: number } = {}
  ): Promise<ReviewSession> {
    const maxIterations = options.maxIterations ?? 5
    const sessionId = generateId()

    const session: ReviewSession = {
      id: sessionId,
      specId: spec.id,
      status: 'in_progress',
      artifacts: [],
      reviews: [],
      iterations: 0,
      startedAt: new Date().toISOString(),
    }

    this.sessions.set(sessionId, session)
    await this.saveState()

    // Step 1: Ralph generates initial code
    let artifact = await this.generateCode(spec)
    session.artifacts.push(artifact)

    // Iterative refinement loop
    while (session.iterations < maxIterations) {
      session.iterations++

      // Step 2: Tom reviews the code
      const review = await this.reviewCode(artifact, spec)
      session.reviews.push(review)

      // Step 3: Check if approved
      if (review.approved) {
        session.status = 'approved'
        session.finalArtifact = artifact
        session.completedAt = new Date().toISOString()

        // Generate PR description and commit message
        session.prDescription = await this.generatePRDescription(artifact, review, spec)
        session.commitMessage = this.generateCommitMessage(artifact, spec)

        break
      }

      // Step 4: Ralph improves based on feedback
      if (session.iterations < maxIterations) {
        artifact = await this.improveCode(artifact, review)
        session.artifacts.push(artifact)
      } else {
        // Max iterations reached without approval
        session.status = 'rejected'
        session.completedAt = new Date().toISOString()
      }

      await this.saveState()
    }

    await this.saveState()
    return session
  }

  /**
   * Get a review session by ID
   */
  getSession(sessionId: string): ReviewSession | null {
    return this.sessions.get(sessionId) ?? null
  }

  /**
   * List all review sessions
   */
  listSessions(): ReviewSession[] {
    return Array.from(this.sessions.values())
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PR & COMMIT GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate PR description after approval
   */
  private async generatePRDescription(
    artifact: CodeArtifact,
    review: CodeReview,
    spec: CodeSpec
  ): Promise<string> {
    const description: PRDescription = {
      title: `feat: ${spec.title}`,
      summary: spec.description,
      changes: [
        `Add ${artifact.filename}`,
        ...artifact.exports.map(e => `Export: ${e}`),
      ],
      testPlan: [
        'Unit tests included',
        'Manual testing performed',
        'Edge cases validated',
      ],
      reviewNotes: [
        `AI Review Score: ${review.score}/100`,
        review.summary,
      ],
    }

    return `## Summary
${description.summary}

## Changes
${description.changes.map(c => `- ${c}`).join('\n')}

## Test Plan
${description.testPlan.map(t => `- [ ] ${t}`).join('\n')}

## Review Notes
${description.reviewNotes.map(n => `- ${n}`).join('\n')}

---
Generated with Ralph (Engineering) + Tom (Tech Lead) code review`
  }

  /**
   * Generate commit message
   */
  private generateCommitMessage(artifact: CodeArtifact, spec: CodeSpec): string {
    return `feat(${artifact.filename.replace('.ts', '')}): ${spec.title}

${spec.description}

- Implements ${spec.requirements.length} requirements
- AI-reviewed and approved

Co-Authored-By: Ralph <ralph@agents.do>
Reviewed-By: Tom <tom@agents.do>`
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
          return Response.json(
            {
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: `Method '${method}' not found` },
            },
            { status: 400 }
          )
        }

        const result = await methodFn.apply(this, params)
        return Response.json({ jsonrpc: '2.0', id, result })
      } catch (error) {
        return Response.json(
          {
            jsonrpc: '2.0',
            id: 0,
            error: { code: -32603, message: String(error) },
          },
          { status: 500 }
        )
      }
    }

    return new Response('Not Found', { status: 404 })
  }
}

export default CodeReviewDO
