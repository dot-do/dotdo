/**
 * Agent Tool Registry
 *
 * Central registry for all agent tools. Tools are organized into categories:
 * - File tools: read, write, edit files
 * - Shell tools: bash, glob, grep
 * - Git tools: add, commit
 *
 * @see dotdo-a7nx3 - GREEN phase: Implement tool binding for agents
 * @see dotdo-5ro2l - REFACTOR phase: Clean up tool registry
 * @module agents/tools/registry
 */

// ============================================================================
// Tool Interface (re-exported from types)
// ============================================================================

import type { AgentTool } from './types'
export type { AgentTool } from './types'

// ============================================================================
// Import Tools from Category Modules
// ============================================================================

// File operation tools
import { writeFileTool, readFileTool, editFileTool, FILE_TOOLS } from './file-tools'

// Shell execution and code search tools
import { bashTool, globTool, grepTool, SHELL_TOOLS } from './shell-tools'

// Git operation tools
import { gitAddTool, gitCommitTool, GIT_TOOLS } from './git-tools'

// Re-export individual tools for direct access
export { writeFileTool, readFileTool, editFileTool } from './file-tools'
export { bashTool, globTool, grepTool } from './shell-tools'
export { gitAddTool, gitCommitTool } from './git-tools'

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * All available agent tools, organized by category.
 *
 * Categories:
 * - FILE_TOOLS: write_file, read_file, edit_file
 * - SHELL_TOOLS: bash, glob, grep
 * - GIT_TOOLS: git_add, git_commit
 */
export const AGENT_TOOLS: AgentTool[] = [...FILE_TOOLS, ...SHELL_TOOLS, ...GIT_TOOLS]

/**
 * Get a tool by name.
 *
 * @param name - The name of the tool to find
 * @returns The tool if found, undefined otherwise
 *
 * @example
 * ```typescript
 * const tool = getTool('write_file')
 * if (tool) {
 *   await tool.execute({ path: '/tmp/test.txt', content: 'hello' })
 * }
 * ```
 */
export function getTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.name === name)
}

/**
 * Execute a tool by name with input.
 *
 * @param name - The name of the tool to execute
 * @param input - The input parameters for the tool
 * @returns The tool's output
 * @throws Error if the tool is not found
 *
 * @example
 * ```typescript
 * const result = await executeTool('bash', { command: 'echo hello' })
 * // result.stdout === 'hello\n'
 * ```
 */
export async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  const tool = getTool(name)
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`)
  }
  return tool.execute(input)
}

export default AGENT_TOOLS
