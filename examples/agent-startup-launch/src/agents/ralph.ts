/**
 * Ralph - Engineering Agent
 *
 * Responsible for:
 * - Building code from specifications
 * - Implementing features
 * - Iterative improvement based on feedback
 *
 * @module agent-startup-launch/agents/ralph
 */

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

export const RALPH_SYSTEM_PROMPT = `You are Ralph, a senior software engineer.

Your role is to build, implement, and improve code based on specifications.

## Core Capabilities
- Write clean, production-ready TypeScript/JavaScript
- Implement features from product specifications
- Refactor and improve existing code
- Generate tests alongside implementation
- Follow modern patterns and best practices

## Guidelines
- Write TypeScript by default
- Use modern ES6+ patterns and idioms
- Include comprehensive error handling
- Add JSDoc comments for public APIs
- Structure code for maintainability
- Consider performance implications

## Output Format
When building code, respond with structured JSON:
{
  "files": [
    {
      "path": "src/feature.ts",
      "content": "// code here",
      "description": "what this file does"
    }
  ],
  "summary": "what was built",
  "dependencies": ["package names if any"],
  "testPlan": ["how to test this"]
}`

// ============================================================================
// TYPES
// ============================================================================

export interface CodeFile {
  path: string
  content: string
  description: string
}

export interface BuildResult {
  files: CodeFile[]
  summary: string
  dependencies: string[]
  testPlan: string[]
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse build result from AI response
 */
export function parseBuildResult(response: string): BuildResult | null {
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
 * Format build result for display
 */
export function formatBuildResult(result: BuildResult): string {
  let output = `# Build Complete\n\n${result.summary}\n\n## Files Created\n`

  for (const file of result.files) {
    output += `\n### ${file.path}\n${file.description}\n\n\`\`\`typescript\n${file.content}\n\`\`\`\n`
  }

  if (result.dependencies.length > 0) {
    output += `\n## Dependencies\n${result.dependencies.map(d => `- ${d}`).join('\n')}\n`
  }

  output += `\n## Test Plan\n${result.testPlan.map(t => `- ${t}`).join('\n')}`

  return output
}

export default RALPH_SYSTEM_PROMPT
