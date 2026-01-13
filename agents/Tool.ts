/**
 * Tool - Unified tool definition helper
 *
 * Supports multiple schema formats:
 * - Zod schemas (Vercel AI SDK, Mastra)
 * - JSON Schema (OpenAI, Devin)
 * - MCP-compatible (Claude SDK)
 */

import { z } from 'zod'
import type {
  ToolDefinition,
  ToolContext,
  Schema,
  JsonSchema,
} from './types'

// Import schema utilities from centralized module
import {
  zodToJsonSchema,
  isZodSchema,
  isJsonSchema,
  validateInput,
  ValidationError,
  type ValidationResult,
} from './schema'

// Re-export for backwards compatibility
export {
  zodToJsonSchema,
  isZodSchema,
  isJsonSchema,
  validateInput,
  ValidationError,
  type ValidationResult,
}

// ============================================================================
// Tool Creation Helper
// ============================================================================

export interface ToolOptions<TInput, TOutput> {
  name: string
  description: string
  inputSchema: z.ZodType<TInput> | JsonSchema
  outputSchema?: z.ZodType<TOutput> | JsonSchema
  execute: (input: TInput, context: ToolContext) => Promise<TOutput>
  interruptible?: boolean
  permission?: 'auto' | 'confirm' | 'deny'
}

/**
 * Create a tool definition with type inference
 *
 * @example
 * ```ts
 * const weatherTool = tool({
 *   name: 'getWeather',
 *   description: 'Get the current weather for a location',
 *   inputSchema: z.object({
 *     location: z.string().describe('City name or coordinates'),
 *     unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
 *   }),
 *   execute: async ({ location, unit }) => {
 *     // Fetch weather data...
 *     return { temperature: 22, condition: 'sunny' }
 *   },
 * })
 * ```
 */
export function tool<TInput, TOutput>(
  options: ToolOptions<TInput, TOutput>
): ToolDefinition<TInput, TOutput> {
  return {
    name: options.name,
    description: options.description,
    inputSchema: options.inputSchema as Schema<TInput>,
    outputSchema: options.outputSchema as Schema<TOutput> | undefined,
    execute: options.execute,
    interruptible: options.interruptible,
    permission: options.permission,
  }
}

// ============================================================================
// Common Tool Factories
// ============================================================================

/**
 * Create a delegation tool for spawning subagents (Claude pattern)
 */
export function createDelegationTool(
  spawnFn: (prompt: string, agentId?: string) => Promise<string>
): ToolDefinition<{ task: string; agentId?: string }, { result: string }> {
  return tool({
    name: 'delegate',
    description: 'Delegate a task to a subagent for parallel execution',
    inputSchema: z.object({
      task: z.string().describe('The task description for the subagent'),
      agentId: z.string().optional().describe('Specific agent to delegate to'),
    }),
    execute: async ({ task, agentId }) => {
      const result = await spawnFn(task, agentId)
      return { result }
    },
  })
}

/**
 * Create a handoff tool for transferring to another agent (OpenAI pattern)
 */
export function createHandoffTool(
  agents: { id: string; name: string; description: string }[],
  handoffFn: (agentId: string, reason: string) => Promise<void>
): ToolDefinition<{ agentId: string; reason: string }, { success: boolean }> {
  const agentDescriptions = agents
    .map((a) => `- ${a.id}: ${a.name} - ${a.description}`)
    .join('\n')

  return tool({
    name: 'handoff',
    description: `Transfer the conversation to another specialized agent.\n\nAvailable agents:\n${agentDescriptions}`,
    inputSchema: z.object({
      agentId: z.enum(agents.map((a) => a.id) as [string, ...string[]]).describe('The agent to hand off to'),
      reason: z.string().describe('Why this handoff is needed'),
    }),
    execute: async ({ agentId, reason }) => {
      await handoffFn(agentId, reason)
      return { success: true }
    },
  })
}

/**
 * Create a finish/complete tool for signaling task completion
 */
export function createFinishTool(): ToolDefinition<{ summary: string }, { finished: true }> {
  return tool({
    name: 'finish',
    description: 'Signal that the task is complete. Call this when you have finished all required work.',
    inputSchema: z.object({
      summary: z.string().describe('Brief summary of what was accomplished'),
    }),
    execute: async () => {
      return { finished: true }
    },
  })
}

/**
 * Create a human escalation tool (HumanFunction pattern)
 */
export function createEscalationTool(
  escalateFn: (question: string, context: Record<string, unknown>) => Promise<string>
): ToolDefinition<{ question: string; context?: Record<string, unknown> }, { answer: string }> {
  return tool({
    name: 'escalate_to_human',
    description: 'Escalate to a human for decisions requiring approval, sensitive operations, or edge cases',
    inputSchema: z.object({
      question: z.string().describe('The question or decision needed from a human'),
      context: z.record(z.unknown()).optional().describe('Additional context for the human'),
    }),
    permission: 'auto',
    execute: async ({ question, context }) => {
      const answer = await escalateFn(question, context ?? {})
      return { answer }
    },
  })
}

export default tool
