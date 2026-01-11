/**
 * Tom - Tech Lead Agent
 *
 * Responsible for:
 * - Code review and architecture decisions
 * - Technical guidance and mentoring
 * - Approving code for production
 *
 * @module agent-startup-launch/agents/tom
 */

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

export const TOM_SYSTEM_PROMPT = `You are Tom, a technical lead and architect.

Your role is to review code, make architectural decisions, and ensure quality.

## Core Capabilities
- Review code for quality, security, and correctness
- Design system architecture
- Make technical decisions with clear rationale
- Identify risks, issues, and trade-offs
- Provide constructive feedback with suggestions

## Review Categories (score 0-100 each)
1. Architecture: Design patterns, modularity, separation of concerns
2. Security: Input validation, auth, data protection
3. Performance: Efficiency, memory usage, complexity
4. Style: Naming, formatting, consistency, documentation
5. Correctness: Logic, edge cases, error handling

## Guidelines
- Be thorough but constructive
- Focus on important issues first
- Explain the "why" behind feedback
- Provide actionable suggestions
- Balance perfectionism with pragmatism
- Approve only when code meets production standards

## Output Format
When reviewing code, respond with structured JSON:
{
  "approved": boolean,
  "score": number (0-100 overall),
  "summary": "brief review summary",
  "categories": {
    "architecture": number,
    "security": number,
    "performance": number,
    "style": number,
    "correctness": number
  },
  "issues": [
    {
      "severity": "critical|major|minor|suggestion",
      "category": "architecture|security|performance|style|correctness",
      "message": "description of issue",
      "suggestion": "how to fix"
    }
  ],
  "strengths": ["things done well"]
}`

// ============================================================================
// TYPES
// ============================================================================

export interface ReviewIssue {
  severity: 'critical' | 'major' | 'minor' | 'suggestion'
  category: 'architecture' | 'security' | 'performance' | 'style' | 'correctness'
  message: string
  suggestion: string
}

export interface ReviewResult {
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
  issues: ReviewIssue[]
  strengths: string[]
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse review result from AI response
 */
export function parseReviewResult(response: string): ReviewResult | null {
  try {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                      response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const jsonStr = jsonMatch[1] || jsonMatch[0]
      return JSON.parse(jsonStr.trim())
    }
    return null
  } catch {
    return null
  }
}

/**
 * Format review result for display
 */
export function formatReviewResult(result: ReviewResult): string {
  const status = result.approved ? 'APPROVED' : 'CHANGES REQUESTED'
  let output = `# Code Review: ${status}\n\n**Score: ${result.score}/100**\n\n${result.summary}\n\n`

  output += `## Category Scores\n`
  output += `- Architecture: ${result.categories.architecture}/100\n`
  output += `- Security: ${result.categories.security}/100\n`
  output += `- Performance: ${result.categories.performance}/100\n`
  output += `- Style: ${result.categories.style}/100\n`
  output += `- Correctness: ${result.categories.correctness}/100\n\n`

  if (result.strengths.length > 0) {
    output += `## Strengths\n${result.strengths.map(s => `- ${s}`).join('\n')}\n\n`
  }

  if (result.issues.length > 0) {
    output += `## Issues\n`
    for (const issue of result.issues) {
      output += `\n### [${issue.severity.toUpperCase()}] ${issue.category}\n`
      output += `${issue.message}\n`
      output += `> Suggestion: ${issue.suggestion}\n`
    }
  }

  return output
}

/**
 * Check if result has critical issues
 */
export function hasCriticalIssues(result: ReviewResult): boolean {
  return result.issues.some(i => i.severity === 'critical')
}

export default TOM_SYSTEM_PROMPT
