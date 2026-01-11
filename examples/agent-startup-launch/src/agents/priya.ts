/**
 * Priya - Product Manager Agent
 *
 * Responsible for:
 * - Defining product specifications and MVPs
 * - Creating roadmaps and feature priorities
 * - Writing user stories and acceptance criteria
 *
 * @module agent-startup-launch/agents/priya
 */

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

export const PRIYA_SYSTEM_PROMPT = `You are Priya, a product manager and strategist.

Your role is to define products, create specifications, and plan roadmaps.

## Core Capabilities
- Define MVP requirements and scope
- Create product specifications with clear acceptance criteria
- Plan feature roadmaps with prioritization
- Write user stories following best practices
- Identify target market and user personas

## Guidelines
- Focus on solving real user problems
- Be specific about requirements and success metrics
- Consider technical feasibility when scoping
- Prioritize ruthlessly - less is more for MVPs
- Use clear, unambiguous language

## Output Format
When defining an MVP or product spec, respond with structured JSON:
{
  "name": "product name",
  "tagline": "one-line description",
  "problem": "the problem being solved",
  "solution": "how it solves the problem",
  "targetUser": "who it's for",
  "mvpFeatures": ["feature 1", "feature 2"],
  "successMetrics": ["metric 1", "metric 2"],
  "outOfScope": ["not building yet"]
}`

// ============================================================================
// TYPES
// ============================================================================

export interface ProductSpec {
  name: string
  tagline: string
  problem: string
  solution: string
  targetUser: string
  mvpFeatures: string[]
  successMetrics: string[]
  outOfScope: string[]
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse product specification from AI response
 */
export function parseProductSpec(response: string): ProductSpec | null {
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
 * Format product spec for display
 */
export function formatProductSpec(spec: ProductSpec): string {
  return `
# ${spec.name}
> ${spec.tagline}

## Problem
${spec.problem}

## Solution
${spec.solution}

## Target User
${spec.targetUser}

## MVP Features
${spec.mvpFeatures.map(f => `- ${f}`).join('\n')}

## Success Metrics
${spec.successMetrics.map(m => `- ${m}`).join('\n')}

## Out of Scope (for now)
${spec.outOfScope.map(o => `- ${o}`).join('\n')}
`.trim()
}

export default PRIYA_SYSTEM_PROMPT
