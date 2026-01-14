/**
 * Tool Registry - Tool registration, validation, and execution
 *
 * Provides:
 * - Tool registration and lookup
 * - JSON Schema and Zod validation
 * - Execution with context and abort signal
 * - Retry with exponential backoff
 * - Result caching (optional)
 *
 * @module db/primitives/agent-runtime
 */

import { z } from 'zod'
import type {
  ToolDefinition,
  ToolResult,
  ToolContext,
  ToolSchema,
  RetryConfig,
  JsonSchemaProperty,
} from './types'

// ============================================================================
// Type Guards
// ============================================================================

function isZodSchema(schema: unknown): schema is z.ZodType<unknown> {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    '_def' in schema &&
    'parse' in schema
  )
}

// ============================================================================
// Tool Creation
// ============================================================================

export interface CreateToolOptions<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  inputSchema: ToolSchema | z.ZodType<TInput>
  outputSchema?: ToolSchema | z.ZodType<TOutput>
  execute: (input: TInput, context: ToolContext) => Promise<TOutput>
  cacheable?: boolean
  cacheTtl?: number
  timeout?: number
  retry?: RetryConfig
}

/**
 * Create a tool definition with type inference
 */
export function createTool<TInput = unknown, TOutput = unknown>(
  options: CreateToolOptions<TInput, TOutput>
): ToolDefinition<TInput, TOutput> {
  return {
    name: options.name,
    description: options.description,
    inputSchema: options.inputSchema,
    outputSchema: options.outputSchema,
    execute: options.execute,
    cacheable: options.cacheable,
    cacheTtl: options.cacheTtl,
    timeout: options.timeout,
    retry: options.retry,
  }
}

// ============================================================================
// Schema Validation
// ============================================================================

export interface ValidationResult<T = unknown> {
  valid: boolean
  data?: T
  error?: string
}

/**
 * Validate input against a tool schema (JSON Schema or Zod)
 */
export function validateToolInput<T = unknown>(
  schema: ToolSchema | z.ZodType<T>,
  input: unknown
): ValidationResult<T> {
  if (isZodSchema(schema)) {
    return validateZodSchema(schema, input)
  }
  return validateJsonSchema(schema as ToolSchema, input) as ValidationResult<T>
}

function validateZodSchema<T>(schema: z.ZodType<T>, input: unknown): ValidationResult<T> {
  const result = schema.safeParse(input)

  if (result.success) {
    return { valid: true, data: result.data }
  }

  const errorMessages = result.error.issues.map((issue) => {
    const path = issue.path.join('.')
    return path ? `${path}: ${issue.message}` : issue.message
  })

  return {
    valid: false,
    error: errorMessages.join('; '),
  }
}

function validateJsonSchema(schema: ToolSchema, input: unknown): ValidationResult {
  if (typeof input !== 'object' || input === null) {
    if (schema.type === 'object') {
      return { valid: false, error: 'Input must be an object' }
    }
  }

  const obj = input as Record<string, unknown>
  const errors: string[] = []

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in obj) || obj[field] === undefined) {
        errors.push(`Missing required field: ${field}`)
      }
    }
  }

  // Validate property types
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in obj) {
        const propError = validateProperty(obj[key], propSchema, key)
        if (propError) {
          errors.push(propError)
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, error: errors.join('; ') }
  }

  return { valid: true, data: input }
}

function validateProperty(
  value: unknown,
  schema: JsonSchemaProperty,
  path: string
): string | null {
  // Type checking
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') {
        return `${path}: Expected string, got ${typeof value}`
      }
      if (schema.enum && !schema.enum.includes(value)) {
        return `${path}: Value must be one of: ${schema.enum.join(', ')}`
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        return `${path}: String must be at least ${schema.minLength} characters`
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        return `${path}: String must be at most ${schema.maxLength} characters`
      }
      break

    case 'number':
    case 'integer':
      if (typeof value !== 'number') {
        return `${path}: Expected number, got ${typeof value}`
      }
      if (schema.type === 'integer' && !Number.isInteger(value)) {
        return `${path}: Expected integer, got decimal`
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        return `${path}: Value must be >= ${schema.minimum}`
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        return `${path}: Value must be <= ${schema.maximum}`
      }
      break

    case 'boolean':
      if (typeof value !== 'boolean') {
        return `${path}: Expected boolean, got ${typeof value}`
      }
      break

    case 'array':
      if (!Array.isArray(value)) {
        return `${path}: Expected array, got ${typeof value}`
      }
      // Could validate items schema here
      break

    case 'object':
      if (typeof value !== 'object' || value === null) {
        return `${path}: Expected object, got ${typeof value}`
      }
      // Could recursively validate nested properties
      break
  }

  return null
}

// ============================================================================
// Tool Registry
// ============================================================================

export interface ToolRegistry {
  /** Register a tool */
  register<TInput = unknown, TOutput = unknown>(tool: ToolDefinition<TInput, TOutput>): void

  /** Get a tool by name */
  get<TInput = unknown, TOutput = unknown>(name: string): ToolDefinition<TInput, TOutput> | undefined

  /** Check if a tool is registered */
  has(name: string): boolean

  /** Remove a tool */
  remove(name: string): void

  /** Get all registered tools */
  getAll(): ToolDefinition[]

  /** Execute a tool by name */
  execute(name: string, input: unknown, context: ToolContext): Promise<ToolResult>
}

class ToolRegistryImpl implements ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map()
  private cache: Map<string, { result: unknown; timestamp: number }> = new Map()

  register<TInput = unknown, TOutput = unknown>(tool: ToolDefinition<TInput, TOutput>): void {
    this.tools.set(tool.name, tool as ToolDefinition)
  }

  get<TInput = unknown, TOutput = unknown>(name: string): ToolDefinition<TInput, TOutput> | undefined {
    return this.tools.get(name) as ToolDefinition<TInput, TOutput> | undefined
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  remove(name: string): void {
    this.tools.delete(name)
    // Clear any cached results for this tool
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${name}:`)) {
        this.cache.delete(key)
      }
    }
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  async execute(name: string, input: unknown, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name)

    if (!tool) {
      return {
        toolCallId: '',
        toolName: name,
        result: null,
        error: `Unknown tool: ${name}`,
      }
    }

    // Validate input
    const validation = validateToolInput(tool.inputSchema, input)
    if (!validation.valid) {
      return {
        toolCallId: '',
        toolName: name,
        result: null,
        error: validation.error,
      }
    }

    // Check cache for cacheable tools
    if (tool.cacheable) {
      const cacheKey = `${name}:${JSON.stringify(input)}`
      const cached = this.cache.get(cacheKey)
      if (cached) {
        const age = Date.now() - cached.timestamp
        const ttl = tool.cacheTtl ?? 60000
        if (age < ttl) {
          return {
            toolCallId: '',
            toolName: name,
            result: cached.result,
            cached: true,
            durationMs: 0,
          }
        }
        // Expired, remove from cache
        this.cache.delete(cacheKey)
      }
    }

    // Execute with retry if configured
    const startTime = performance.now()

    try {
      let result: ToolResult

      if (tool.retry) {
        result = await executeToolWithRetry(
          tool.execute as (input: unknown, ctx: ToolContext) => Promise<unknown>,
          validation.data,
          context,
          tool.retry
        )
      } else {
        try {
          const output = await tool.execute(validation.data, context)
          result = {
            toolCallId: '',
            toolName: name,
            result: output,
          }
        } catch (error) {
          result = {
            toolCallId: '',
            toolName: name,
            result: null,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      }

      const durationMs = Math.round(performance.now() - startTime)
      result.durationMs = durationMs
      result.toolName = name

      // Cache successful results for cacheable tools
      if (tool.cacheable && !result.error) {
        const cacheKey = `${name}:${JSON.stringify(input)}`
        this.cache.set(cacheKey, {
          result: result.result,
          timestamp: Date.now(),
        })
      }

      return result
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime)
      return {
        toolCallId: '',
        toolName: name,
        result: null,
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      }
    }
  }
}

// ============================================================================
// Retry Logic
// ============================================================================

/**
 * Execute a tool function with retry and exponential backoff
 */
export async function executeToolWithRetry(
  execute: (input: unknown, ctx: ToolContext) => Promise<unknown>,
  input: unknown,
  context: ToolContext,
  config: RetryConfig
): Promise<ToolResult> {
  const {
    maxAttempts = 3,
    initialDelayMs = 100,
    maxDelayMs = 10000,
    backoffMultiplier = 2,
    jitter = true,
  } = config

  let lastError: Error | undefined
  let delay = initialDelayMs

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await execute(input, context)
      return {
        toolCallId: '',
        toolName: '',
        result,
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't delay after the last attempt
      if (attempt < maxAttempts) {
        // Apply jitter
        const actualDelay = jitter
          ? delay * (0.5 + Math.random())
          : delay

        // Cap at maxDelayMs
        const cappedDelay = Math.min(actualDelay, maxDelayMs)

        await new Promise((resolve) => setTimeout(resolve, cappedDelay))

        // Increase delay for next attempt
        delay = delay * backoffMultiplier
      }
    }
  }

  return {
    toolCallId: '',
    toolName: '',
    result: null,
    error: lastError?.message ?? 'Unknown error',
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistryImpl()
}
