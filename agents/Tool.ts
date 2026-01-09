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
// Schema Conversion Utilities
// ============================================================================

/**
 * Convert a Zod schema to JSON Schema
 */
export function zodToJsonSchema(schema: z.ZodType<unknown>): JsonSchema {
  // Use zod's built-in toJsonSchema if available (Zod 4+)
  if ('_def' in schema && schema._def) {
    return zodDefToJsonSchema(schema._def)
  }

  // Fallback for older Zod versions
  return { type: 'object' }
}

function zodDefToJsonSchema(def: z.ZodTypeDef): JsonSchema {
  const typeName = (def as { typeName?: string }).typeName

  switch (typeName) {
    case 'ZodString':
      return { type: 'string', description: (def as { description?: string }).description }
    case 'ZodNumber':
      return { type: 'number', description: (def as { description?: string }).description }
    case 'ZodBoolean':
      return { type: 'boolean', description: (def as { description?: string }).description }
    case 'ZodArray': {
      const arrayDef = def as { type?: z.ZodTypeDef }
      return {
        type: 'array',
        items: arrayDef.type ? zodDefToJsonSchema(arrayDef.type) : {},
        description: (def as { description?: string }).description,
      }
    }
    case 'ZodObject': {
      const objectDef = def as {
        shape?: () => Record<string, z.ZodType<unknown>>
        description?: string
      }
      const shape = objectDef.shape?.() ?? {}
      const properties: Record<string, JsonSchema> = {}
      const required: string[] = []

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value)
        if (!isOptional(value)) {
          required.push(key)
        }
      }

      return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
        description: objectDef.description,
      }
    }
    case 'ZodEnum': {
      const enumDef = def as { values?: string[]; description?: string }
      return {
        type: 'string',
        enum: enumDef.values,
        description: enumDef.description,
      }
    }
    case 'ZodOptional':
    case 'ZodNullable': {
      const innerDef = def as { innerType?: z.ZodType<unknown> }
      if (innerDef.innerType) {
        return zodToJsonSchema(innerDef.innerType)
      }
      return { type: 'string' }
    }
    case 'ZodDefault': {
      const defaultDef = def as { innerType?: z.ZodType<unknown>; defaultValue?: () => unknown }
      if (defaultDef.innerType) {
        const schema = zodToJsonSchema(defaultDef.innerType)
        schema.default = defaultDef.defaultValue?.()
        return schema
      }
      return { type: 'string' }
    }
    default:
      return { type: 'string' }
  }
}

function isOptional(schema: z.ZodType<unknown>): boolean {
  const def = schema._def as { typeName?: string }
  return def.typeName === 'ZodOptional' || def.typeName === 'ZodDefault'
}

/**
 * Check if a schema is a Zod schema
 */
export function isZodSchema(schema: unknown): schema is z.ZodType<unknown> {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    '_def' in schema &&
    'parse' in schema
  )
}

/**
 * Validate input against a schema
 */
export function validateInput<T>(
  schema: Schema<T>,
  input: unknown
): { success: true; data: T } | { success: false; error: Error } {
  if (isZodSchema(schema)) {
    const result = schema.safeParse(input)
    if (result.success) {
      return { success: true, data: result.data }
    }
    return { success: false, error: new Error(result.error.message) }
  }

  // For JSON Schema, we'd use a validator like ajv
  // For now, just pass through
  return { success: true, data: input as T }
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
