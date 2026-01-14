/**
 * Typed Agent Results
 *
 * Provides a generic AgentResult<T> type that allows developers to get
 * typed structured outputs from AI agents.
 *
 * Uses the same module augmentation pattern as EventPayloadMap for extensibility.
 *
 * @module agents/typed-result
 *
 * @example
 * ```ts
 * // Define typed agent response schemas
 * import { z } from 'zod'
 * import { defineAgentSchema, invoke } from './typed-result'
 *
 * const SpecSchema = z.object({
 *   features: z.array(z.string()),
 *   timeline: z.string(),
 *   cost: z.number(),
 * })
 *
 * // Register schema for type inference
 * defineAgentSchema('priya', 'define-mvp', SpecSchema)
 *
 * // Now get typed results
 * const spec = await priya.as(SpecSchema)`define the MVP for ${hypothesis}`
 * // spec.features is string[], spec.cost is number
 * ```
 */

import { z } from 'zod'
import { parseStructuredOutput, StructuredOutputError } from './structured-output'
import type { Schema, JsonSchema } from './types'

// ============================================================================
// Core Types
// ============================================================================

/**
 * AgentResult<T> - Typed result from an agent invocation
 *
 * Contains both the raw text output and the parsed/validated structured data.
 *
 * @typeParam T - The type of the structured content
 */
export interface AgentResult<T = unknown> {
  /** Raw text output from the agent */
  text: string

  /** Parsed and validated structured content */
  content: T

  /** Whether structured parsing was successful */
  parsed: boolean

  /** Tool calls made during execution (if any) */
  toolCalls?: ToolCallRecord[]

  /** Metadata about the invocation */
  meta?: AgentResultMeta
}

/**
 * Tool call record for tracking execution
 */
export interface ToolCallRecord {
  name: string
  input: Record<string, unknown>
  result: unknown
}

/**
 * Metadata about an agent result
 */
export interface AgentResultMeta {
  /** Agent name that produced the result */
  agent?: string
  /** Model used (if known) */
  model?: string
  /** Execution time in milliseconds */
  durationMs?: number
  /** Token usage (if available) */
  tokens?: {
    prompt: number
    completion: number
    total: number
  }
}

// ============================================================================
// Schema Registry - Module Augmentation Pattern
// ============================================================================

/**
 * AgentSchemaRegistry - Interface for registering agent schemas
 *
 * This interface is designed for module augmentation. Extend it in your
 * domain code to register typed schemas for agent invocations.
 *
 * The key format is: `${agentName}.${taskType}`
 *
 * @example
 * ```typescript
 * // In your domain types:
 * declare module 'dotdo/agents/typed-result' {
 *   interface AgentSchemaRegistry {
 *     'priya.define-mvp': { features: string[]; timeline: string; cost: number }
 *     'priya.roadmap': { quarters: Quarter[]; milestones: Milestone[] }
 *     'ralph.implement': { code: string; tests: string[]; dependencies: string[] }
 *     'tom.review': { approved: boolean; issues: Issue[]; suggestions: string[] }
 *   }
 * }
 * ```
 *
 * After registration, typed invocations will provide full autocomplete:
 * ```typescript
 * const spec = await priya.invoke<'define-mvp'>(`define MVP`)
 * spec.content.features // string[]
 * spec.content.cost     // number
 * ```
 */
export interface AgentSchemaRegistry {
  // Default: unknown - extend via module augmentation
  [key: string]: unknown
}

/**
 * Extract the content type for a given agent.task combination
 */
export type AgentTaskResult<
  Agent extends string,
  Task extends string
> = `${Agent}.${Task}` extends keyof AgentSchemaRegistry
  ? AgentSchemaRegistry[`${Agent}.${Task}`]
  : unknown

// ============================================================================
// Schema Storage and Registration
// ============================================================================

/**
 * Runtime schema storage for validation
 */
const schemaRegistry = new Map<string, z.ZodType<unknown>>()

/**
 * Define a schema for a specific agent.task combination
 *
 * This registers the schema both for runtime validation and enables
 * TypeScript type inference via module augmentation.
 *
 * @param agent - Agent name (e.g., 'priya', 'ralph')
 * @param task - Task identifier (e.g., 'define-mvp', 'review')
 * @param schema - Zod schema for validation
 *
 * @example
 * ```typescript
 * const SpecSchema = z.object({
 *   features: z.array(z.string()),
 *   timeline: z.string(),
 *   cost: z.number(),
 * })
 *
 * defineAgentSchema('priya', 'define-mvp', SpecSchema)
 * ```
 */
export function defineAgentSchema<T>(
  agent: string,
  task: string,
  schema: z.ZodType<T>
): void {
  schemaRegistry.set(`${agent}.${task}`, schema as z.ZodType<unknown>)
}

/**
 * Get a registered schema for an agent.task combination
 */
export function getAgentSchema<T>(
  agent: string,
  task: string
): z.ZodType<T> | undefined {
  return schemaRegistry.get(`${agent}.${task}`) as z.ZodType<T> | undefined
}

/**
 * Check if a schema is registered for an agent.task
 */
export function hasAgentSchema(agent: string, task: string): boolean {
  return schemaRegistry.has(`${agent}.${task}`)
}

// ============================================================================
// Common Predefined Schemas
// ============================================================================

/**
 * Common schema for product specifications (Priya)
 */
export const SpecSchema = z.object({
  features: z.array(z.string()).describe('List of MVP features'),
  timeline: z.string().describe('Estimated timeline'),
  cost: z.number().optional().describe('Estimated cost'),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  dependencies: z.array(z.string()).optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
})

export type Spec = z.infer<typeof SpecSchema>

/**
 * Common schema for code review results (Tom)
 */
export const ReviewSchema = z.object({
  approved: z.boolean().describe('Whether the code is approved'),
  issues: z.array(z.object({
    severity: z.enum(['error', 'warning', 'info']),
    message: z.string(),
    line: z.number().optional(),
    file: z.string().optional(),
    suggestion: z.string().optional(),
  })).describe('List of issues found'),
  suggestions: z.array(z.string()).optional().describe('General suggestions'),
  score: z.number().min(0).max(100).optional().describe('Code quality score'),
})

export type Review = z.infer<typeof ReviewSchema>

/**
 * Common schema for implementation results (Ralph)
 */
export const ImplementationSchema = z.object({
  code: z.string().describe('Generated code'),
  language: z.string().optional().describe('Programming language'),
  tests: z.array(z.string()).optional().describe('Generated test cases'),
  dependencies: z.array(z.string()).optional().describe('Required dependencies'),
  notes: z.string().optional().describe('Implementation notes'),
})

export type Implementation = z.infer<typeof ImplementationSchema>

/**
 * Common schema for test results (Quinn)
 */
export const TestResultSchema = z.object({
  passed: z.boolean().describe('Whether all tests passed'),
  testCases: z.array(z.object({
    name: z.string(),
    status: z.enum(['pass', 'fail', 'skip']),
    error: z.string().optional(),
    duration: z.number().optional(),
  })).describe('Individual test results'),
  coverage: z.number().optional().describe('Code coverage percentage'),
  summary: z.string().optional(),
})

export type TestResult = z.infer<typeof TestResultSchema>

/**
 * Common schema for marketing content (Mark)
 */
export const ContentSchema = z.object({
  title: z.string().describe('Content title'),
  body: z.string().describe('Main content body'),
  summary: z.string().optional().describe('Brief summary'),
  keywords: z.array(z.string()).optional().describe('SEO keywords'),
  callToAction: z.string().optional().describe('Call to action text'),
  tone: z.enum(['professional', 'casual', 'technical', 'friendly']).optional(),
})

export type Content = z.infer<typeof ContentSchema>

/**
 * Common schema for financial analysis (Finn)
 */
export const FinancialAnalysisSchema = z.object({
  totalCost: z.number().describe('Total estimated cost'),
  breakdown: z.array(z.object({
    category: z.string(),
    amount: z.number(),
    notes: z.string().optional(),
  })).describe('Cost breakdown by category'),
  timeline: z.string().optional().describe('Financial timeline'),
  roi: z.number().optional().describe('Estimated ROI percentage'),
  risks: z.array(z.string()).optional().describe('Financial risks'),
  recommendations: z.array(z.string()).optional(),
})

export type FinancialAnalysis = z.infer<typeof FinancialAnalysisSchema>

/**
 * Common schema for data analysis (Dana)
 */
export const DataAnalysisSchema = z.object({
  insights: z.array(z.object({
    finding: z.string(),
    confidence: z.number().min(0).max(1).optional(),
    impact: z.enum(['low', 'medium', 'high']).optional(),
  })).describe('Key insights from data'),
  metrics: z.record(z.string(), z.number()).optional().describe('Key metrics'),
  trends: z.array(z.string()).optional().describe('Identified trends'),
  recommendations: z.array(z.string()).optional(),
  visualization: z.string().optional().describe('Suggested visualization type'),
})

export type DataAnalysis = z.infer<typeof DataAnalysisSchema>

// ============================================================================
// Typed Invocation Helper
// ============================================================================

/**
 * Parse agent output into a typed result
 *
 * @param text - Raw text output from agent
 * @param schema - Zod schema for validation
 * @param options - Parsing options
 * @returns Typed AgentResult<T>
 */
export function parseAgentResult<T>(
  text: string,
  schema: z.ZodType<T>,
  options: {
    agent?: string
    coerce?: boolean
    allowPartial?: boolean
  } = {}
): AgentResult<T> {
  const { agent = 'unknown', coerce = true, allowPartial = false } = options

  try {
    const content = parseStructuredOutput(schema, text, { coerce })
    return {
      text,
      content,
      parsed: true,
      meta: { agent },
    }
  } catch (error) {
    if (allowPartial && error instanceof StructuredOutputError) {
      // Return partial result with raw text
      return {
        text,
        content: (error.extractedJson ?? {}) as T,
        parsed: false,
        meta: { agent },
      }
    }
    throw error
  }
}

/**
 * Create a typed invocation function for an agent
 *
 * @param agentName - Name of the agent
 * @param executeFn - Function that executes the agent and returns raw text
 * @returns Typed invoke function
 *
 * @example
 * ```typescript
 * const invokeTyped = createTypedInvoke('priya', async (prompt) => {
 *   return await priya(prompt)
 * })
 *
 * const spec = await invokeTyped(SpecSchema, 'define the MVP')
 * // spec.content.features is string[]
 * ```
 */
export function createTypedInvoke(
  agentName: string,
  executeFn: (prompt: string) => Promise<string>
): <T>(schema: z.ZodType<T>, prompt: string) => Promise<AgentResult<T>> {
  return async <T>(schema: z.ZodType<T>, prompt: string): Promise<AgentResult<T>> => {
    const startTime = Date.now()
    const text = await executeFn(prompt)
    const durationMs = Date.now() - startTime

    const result = parseAgentResult(text, schema, {
      agent: agentName,
      coerce: true,
    })

    result.meta = {
      ...result.meta,
      agent: agentName,
      durationMs,
    }

    return result
  }
}

// ============================================================================
// TypedAgent Interface
// ============================================================================

/**
 * Options for typed agent invocation
 */
export interface TypedInvokeOptions<T> {
  /** Schema for validation */
  schema: z.ZodType<T>
  /** Enable type coercion (default: true) */
  coerce?: boolean
  /** Allow partial results on parse failure */
  allowPartial?: boolean
  /** JSON schema to inject into prompt for better AI output */
  includeSchemaInPrompt?: boolean
}

/**
 * Enhanced template literal function that returns typed results
 */
export interface TypedTemplateLiteral<T> {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<AgentResult<T>>
}

/**
 * Create a typed template literal function
 *
 * @param executeFn - Raw agent execution function
 * @param schema - Zod schema for output validation
 * @param options - Additional options
 * @returns Typed template literal function
 *
 * @example
 * ```typescript
 * const typedPriya = createTypedTemplateLiteral(
 *   priya,
 *   SpecSchema,
 *   { agent: 'priya' }
 * )
 *
 * const spec = await typedPriya`define MVP for ${hypothesis}`
 * // spec.content.features is string[]
 * ```
 */
export function createTypedTemplateLiteral<T>(
  executeFn: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<string>,
  schema: z.ZodType<T>,
  options: { agent?: string; coerce?: boolean } = {}
): TypedTemplateLiteral<T> {
  const { agent = 'unknown', coerce = true } = options

  return async (strings: TemplateStringsArray, ...values: unknown[]): Promise<AgentResult<T>> => {
    const startTime = Date.now()
    const text = await executeFn(strings, ...values)
    const durationMs = Date.now() - startTime

    const result = parseAgentResult(text, schema, { agent, coerce })
    result.meta = { ...result.meta, durationMs }

    return result
  }
}

// ============================================================================
// JSON Schema Generation for Prompt Injection
// ============================================================================

/**
 * Internal Zod schema definition structure (simplified for JSON schema generation)
 * This is an internal API and may change between Zod versions
 */
interface ZodDef {
  type?: string
  typeName?: string
  description?: string
  element?: { _def: ZodDef }
  shape?: (() => Record<string, { _def: ZodDef }>) | Record<string, { _def: ZodDef }>
  innerType?: { _def: ZodDef }
  valueType?: { _def: ZodDef }
  values?: string[]
}

/**
 * Convert a Zod schema to JSON schema for prompt injection
 *
 * This generates a JSON schema that can be included in prompts to guide
 * the AI model to produce correctly structured output.
 */
export function zodToPromptSchema<T>(schema: z.ZodType<T>): JsonSchema {
  // Use the schema's internal representation to build JSON schema
  // Note: _def is an internal Zod API, typed here for safety
  const def = (schema as unknown as { _def: ZodDef })._def

  return convertZodDefToJsonSchema(def)
}

function convertZodDefToJsonSchema(def: ZodDef): JsonSchema {
  const type = def?.type ?? def?.typeName

  switch (type) {
    case 'ZodString':
    case 'string':
      return { type: 'string', description: def.description }

    case 'ZodNumber':
    case 'number':
      return { type: 'number', description: def.description }

    case 'ZodBoolean':
    case 'boolean':
      return { type: 'boolean', description: def.description }

    case 'ZodArray':
    case 'array':
      return {
        type: 'array',
        items: def.element ? convertZodDefToJsonSchema(def.element._def) : { type: 'string' },
        description: def.description,
      }

    case 'ZodObject':
    case 'object': {
      const shape = typeof def.shape === 'function' ? def.shape() : (def.shape ?? {})
      const properties: Record<string, JsonSchema> = {}
      const required: string[] = []

      for (const [key, propSchema] of Object.entries(shape)) {
        const propDef = (propSchema as { _def: ZodDef })._def
        properties[key] = convertZodDefToJsonSchema(propDef)
        // Check if required (not optional/nullable)
        if (propDef?.typeName !== 'ZodOptional' && propDef?.type !== 'optional') {
          required.push(key)
        }
      }

      return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
        description: def.description,
      }
    }

    case 'ZodOptional':
    case 'optional':
      return def.innerType ? convertZodDefToJsonSchema(def.innerType._def) : { type: 'string' }

    case 'ZodEnum':
    case 'enum':
      return {
        type: 'string',
        enum: def.values,
        description: def.description,
      }

    case 'ZodRecord':
    case 'record':
      return {
        type: 'object',
        additionalProperties: def.valueType ? convertZodDefToJsonSchema(def.valueType._def) : { type: 'string' },
        description: def.description,
      }

    default:
      return { type: 'string' }
  }
}

/**
 * Generate a prompt suffix that instructs the AI to output valid JSON
 *
 * @param schema - Zod schema defining expected output
 * @returns Prompt suffix string
 */
export function generateSchemaPrompt<T>(schema: z.ZodType<T>): string {
  const jsonSchema = zodToPromptSchema(schema)
  return `

Please respond with valid JSON matching this schema:
\`\`\`json
${JSON.stringify(jsonSchema, null, 2)}
\`\`\`

Output only the JSON object, no additional text.`
}

// ============================================================================
// Exports
// ============================================================================

export { z }
export type { Schema, JsonSchema }
