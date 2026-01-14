/**
 * bashx MCP Tool
 *
 * ONE tool: bash
 *
 * That's it. One tool that does everything.
 */

import type { BashMcpTool, BashResult } from '../types.js'

/**
 * The single bash MCP tool
 */
export const BASH_TOOL: BashMcpTool = {
  name: 'bash',
  description: `Execute bash commands with AI-enhanced safety and AST-based validation.

Provide either:
- A bash command to execute (e.g., "ls -la", "git status")
- A natural language description of what you want (e.g., "find large files", "count lines of code")

The tool will:
1. Parse the input to determine if it's a command or intent
2. If intent, generate the appropriate command
3. Parse the command into an AST for structural analysis
4. Classify safety (read/write/delete/system) and impact level
5. Block critical operations unless confirm=true
6. Execute and return results with undo capability if reversible

Dangerous commands (rm -rf /, chmod -R 777 /, etc.) require confirm=true.`,
  inputSchema: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'A bash command OR a natural language description of what you want to do',
      },
      confirm: {
        type: 'boolean',
        description: 'Set to true to execute dangerous/critical operations that would otherwise be blocked',
      },
    },
    required: ['input'],
  },
}

/**
 * Get the MCP tool definition
 */
export function getToolDefinition(): BashMcpTool {
  return BASH_TOOL
}

/**
 * Handle bash tool invocation
 */
export async function handleBash(_params: { input: string; confirm?: boolean }): Promise<BashResult> {
  // This is a stub - actual implementation in the Durable Object backend
  throw new Error('Not implemented: handleBash requires backend service')
}
