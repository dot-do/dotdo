/**
 * Function Schema - Four Implementation Types
 *
 * Functions have four implementation types:
 * - code: Deterministic TypeScript (fastest, cheapest)
 * - generative: Single AI completion
 * - agentic: AI + tools in a loop
 * - human: Human-in-the-loop (slowest, most expensive)
 *
 * @module schemas/function
 */

import { z } from 'zod'

/**
 * Function type discriminant
 */
export const FunctionTypeSchema = z.enum(['code', 'generative', 'agentic', 'human'])
export type FunctionType = z.infer<typeof FunctionTypeSchema>

/**
 * Backoff strategy for retries
 */
export const BackoffStrategySchema = z.enum(['fixed', 'exponential', 'exponential-jitter', 'linear'])
export type BackoffStrategy = z.infer<typeof BackoffStrategySchema>

/**
 * Retry configuration schema
 */
export const RetryConfigSchema = z.object({
  /** Maximum number of retry attempts */
  maxAttempts: z.number().int().positive(),
  /** Base delay between retries in ms */
  delay: z.number().int().nonnegative(),
  /** Backoff strategy */
  backoff: BackoffStrategySchema.optional(),
  /** Increment for linear backoff in ms */
  increment: z.number().int().nonnegative().optional(),
  /** Maximum delay cap in ms */
  maxDelay: z.number().int().nonnegative().optional(),
  /** Whether to retry on timeout errors */
  retryOnTimeout: z.boolean().optional(),
})

export type RetryConfigType = z.infer<typeof RetryConfigSchema>

/**
 * Base function configuration (shared by all types)
 */
export const BaseFunctionSchema = z.object({
  /** Unique function name */
  name: z.string().min(1, 'name is required'),
  /** Human-readable description */
  description: z.string().optional(),
  /** Execution timeout in ms */
  timeout: z.number().int().positive().optional(),
  /** Retry configuration */
  retries: RetryConfigSchema.optional(),
})

/**
 * Code function configuration
 */
export const CodeFunctionSchema = BaseFunctionSchema.extend({
  type: z.literal('code'),
  /** Handler source code or reference */
  handler: z.string().optional(),
  /** Whether to run in sandboxed environment */
  sandboxed: z.boolean().optional(),
})

/**
 * Generative (AI completion) function configuration
 */
export const GenerativeFunctionSchema = BaseFunctionSchema.extend({
  type: z.literal('generative'),
  /** AI model identifier */
  model: z.string().min(1, 'model is required'),
  /** Prompt template */
  prompt: z.string().min(1, 'prompt is required'),
  /** Temperature for generation (0-2) */
  temperature: z.number().min(0).max(2).optional(),
  /** Maximum tokens to generate */
  maxTokens: z.number().int().positive().optional(),
  /** JSON schema for structured output */
  schema: z.record(z.string(), z.unknown()).optional(),
})

/**
 * Agentic (AI + tools) function configuration
 */
export const AgenticFunctionSchema = BaseFunctionSchema.extend({
  type: z.literal('agentic'),
  /** AI model identifier */
  model: z.string().min(1, 'model is required'),
  /** Available tool names */
  tools: z.array(z.string()),
  /** Goal/objective for the agent */
  goal: z.string().min(1, 'goal is required'),
  /** Maximum tool-use iterations */
  maxIterations: z.number().int().positive().optional(),
  /** System prompt */
  systemPrompt: z.string().optional(),
})

/**
 * Human-in-the-loop function configuration
 */
export const HumanFunctionSchema = BaseFunctionSchema.extend({
  type: z.literal('human'),
  /** Communication channel (slack, email, sms, web, discord) */
  channel: z.string().min(1, 'channel is required'),
  /** Prompt template shown to human */
  prompt: z.string().min(1, 'prompt is required'),
  /** Available action buttons/options */
  actions: z.array(z.string()).optional(),
  /** Form schema for structured input */
  form: z.record(z.string(), z.unknown()).optional(),
})

/**
 * Discriminated union of all function types
 */
export const FunctionSchema = z.discriminatedUnion('type', [
  CodeFunctionSchema,
  GenerativeFunctionSchema,
  AgenticFunctionSchema,
  HumanFunctionSchema,
])

export type FunctionSchemaType = z.infer<typeof FunctionSchema>
export type CodeFunctionType = z.infer<typeof CodeFunctionSchema>
export type GenerativeFunctionType = z.infer<typeof GenerativeFunctionSchema>
export type AgenticFunctionType = z.infer<typeof AgenticFunctionSchema>
export type HumanFunctionType = z.infer<typeof HumanFunctionSchema>

/**
 * Type guards for function types
 */
export function isCodeFunction(config: FunctionSchemaType): config is CodeFunctionType {
  return config.type === 'code'
}

export function isGenerativeFunction(config: FunctionSchemaType): config is GenerativeFunctionType {
  return config.type === 'generative'
}

export function isAgenticFunction(config: FunctionSchemaType): config is AgenticFunctionType {
  return config.type === 'agentic'
}

export function isHumanFunction(config: FunctionSchemaType): config is HumanFunctionType {
  return config.type === 'human'
}
