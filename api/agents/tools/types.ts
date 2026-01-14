/**
 * Agent Tool Type Definitions
 *
 * Core type definitions for the agent tool system.
 *
 * @module agents/tools/types
 */

/**
 * Interface for agent tools.
 *
 * Each tool has a name, description, input schema, and execute function.
 * Tools are designed to be compatible with Claude's tool use API.
 *
 * @example
 * ```typescript
 * const myTool: AgentTool = {
 *   name: 'my_tool',
 *   description: 'Does something useful',
 *   inputSchema: {
 *     type: 'object',
 *     properties: {
 *       input: { type: 'string', description: 'The input' }
 *     },
 *     required: ['input']
 *   },
 *   execute: async (input) => {
 *     return { success: true, result: input.input }
 *   }
 * }
 * ```
 */
export interface AgentTool {
  /** Unique identifier for the tool (e.g., 'write_file', 'bash') */
  name: string
  /** Human-readable description of what the tool does */
  description: string
  /** JSON Schema for the tool's input parameters */
  inputSchema: {
    type: string
    properties: Record<string, { type: string; description: string }>
    required?: string[]
  }
  /** Function that executes the tool with given input */
  execute: (input: Record<string, unknown>) => Promise<unknown>
}
