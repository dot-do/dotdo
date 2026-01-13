/**
 * Structured Output Parser
 *
 * Parses AI model outputs into structured data with:
 * - JSON extraction from markdown code blocks and mixed text
 * - Schema validation using Zod
 * - Type coercion for common AI output quirks
 * - Retry logic for malformed outputs
 *
 * @module agents/structured-output
 *
 * @example
 * ```ts
 * import { createStructuredOutputParser } from './structured-output'
 * import { z } from 'zod'
 *
 * const reviewSchema = z.object({
 *   approved: z.boolean(),
 *   feedback: z.string(),
 *   issues: z.array(z.string()),
 * })
 *
 * const parser = createStructuredOutputParser(reviewSchema, {
 *   coerce: true,
 *   maxRetries: 2,
 *   onError: async (error) => {
 *     // Ask AI to fix the output
 *     return await askAIToFix(error.rawOutput, error.message)
 *   },
 * })
 *
 * const result = await parser(aiResponse)
 * ```
 */

import { z } from 'zod'
import { isZodSchema } from './schema'
import type { Schema } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Phase where parsing failed
 */
export type ParsePhase = 'extract' | 'parse' | 'validate' | 'coerce'

/**
 * Structured output error with context for debugging and retry
 */
export class StructuredOutputError extends Error {
  readonly name = 'StructuredOutputError'
  /** Phase where parsing failed */
  readonly phase: ParsePhase
  /** Original raw output from AI */
  readonly rawOutput: string
  /** Extracted JSON before validation (if extraction succeeded) */
  readonly extractedJson?: unknown
  /** Path to the invalid field (for validation errors) */
  readonly path?: (string | number)[]
  /** Expected type or value */
  readonly expected?: string
  /** Received value */
  readonly received?: unknown
  /** Number of retry attempts made */
  readonly retryCount?: number

  constructor(options: {
    message: string
    phase: ParsePhase
    rawOutput: string
    extractedJson?: unknown
    path?: (string | number)[]
    expected?: string
    received?: unknown
    retryCount?: number
  }) {
    super(options.message)
    this.phase = options.phase
    this.rawOutput = options.rawOutput
    this.extractedJson = options.extractedJson
    this.path = options.path
    this.expected = options.expected
    this.received = options.received
    this.retryCount = options.retryCount
  }

  toString(): string {
    const parts = [`StructuredOutputError [${this.phase}]: ${this.message}`]
    if (this.path && this.path.length > 0) {
      parts.push(`  at path: ${this.path.join('.')}`)
    }
    if (this.expected) {
      parts.push(`  expected: ${this.expected}`)
    }
    if (this.received !== undefined) {
      parts.push(`  received: ${JSON.stringify(this.received)}`)
    }
    return parts.join('\n')
  }
}

/**
 * Options for structured output parsing
 */
export interface StructuredOutputOptions<T = unknown> {
  /** Enable type coercion for common AI output quirks */
  coerce?: boolean
  /** Maximum retry attempts when parsing fails */
  maxRetries?: number
  /** Callback to fix malformed output (e.g., ask AI to correct) */
  onError?: (error: StructuredOutputError) => Promise<string>
  /** Transform the parsed data after validation */
  transform?: (data: T) => unknown
}

// ============================================================================
// JSON Extraction
// ============================================================================

/**
 * Extract JSON objects/arrays from a string
 *
 * Handles:
 * - Markdown code blocks (```json ... ```)
 * - Bare JSON objects/arrays in text
 * - Multiple JSON blocks (returns all)
 *
 * @param input - String that may contain JSON
 * @returns Array of extracted JSON values (parsed)
 */
export function extractJson(input: string): unknown[] {
  const results: unknown[] = []
  const codeBlockResults: unknown[] = []
  const inlineResults: unknown[] = []

  // Strategy 1: Extract from markdown code blocks
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g
  let match: RegExpExecArray | null

  while ((match = codeBlockRegex.exec(input)) !== null) {
    const content = match[1].trim()
    try {
      const parsed = JSON.parse(content)
      codeBlockResults.push(parsed)
    } catch {
      // Not valid JSON, skip
    }
  }

  // Strategy 2: Find bare JSON objects/arrays
  // Look for { ... } or [ ... ] patterns
  const jsonPatterns = [
    // JSON objects - match from { to matching }
    /\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g,
    // JSON arrays - match from [ to matching ]
    /\[(?:[^\[\]]|\[(?:[^\[\]]|\[[^\[\]]*\])*\])*\]/g,
  ]

  for (const pattern of jsonPatterns) {
    // Reset lastIndex to search from beginning
    pattern.lastIndex = 0
    while ((match = pattern.exec(input)) !== null) {
      const content = match[0]
      // Skip if this is inside a code block (already handled)
      const beforeMatch = input.slice(0, match.index)
      const unclosedCodeBlocks = (beforeMatch.match(/```/g) || []).length % 2

      if (unclosedCodeBlocks === 0) {
        try {
          const parsed = JSON.parse(content)
          inlineResults.push(parsed)
        } catch {
          // Not valid JSON, skip
        }
      }
    }
  }

  // Prioritize code blocks over inline JSON
  results.push(...codeBlockResults, ...inlineResults)

  // Deduplicate by JSON string comparison
  const seen = new Set<string>()
  const deduped: unknown[] = []
  for (const result of results) {
    const key = JSON.stringify(result)
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(result)
    }
  }

  return deduped
}

// ============================================================================
// Type Coercion
// ============================================================================

/**
 * Target types for coercion
 */
export type CoercionTarget = 'string' | 'number' | 'boolean' | 'null'

/**
 * Coerce a value to a target type
 *
 * Handles common AI output quirks:
 * - "123" -> 123 (string to number)
 * - "true"/"false" -> true/false (string to boolean)
 * - "yes"/"no" -> true/false
 * - "1"/"0" -> true/false
 * - 123 -> "123" (number to string)
 * - "null" -> null
 *
 * @param value - Value to coerce
 * @param target - Target type
 * @returns Coerced value or undefined if coercion not possible
 */
export function coerceType(value: unknown, target: CoercionTarget): unknown {
  if (value === null || value === undefined) {
    return target === 'null' ? null : undefined
  }

  const valueType = typeof value

  // Already correct type
  if (target === 'string' && valueType === 'string') return value
  if (target === 'number' && valueType === 'number') return value
  if (target === 'boolean' && valueType === 'boolean') return value

  switch (target) {
    case 'number': {
      if (valueType === 'string') {
        const str = (value as string).trim()
        const num = Number(str)
        if (!isNaN(num) && str !== '') {
          return num
        }
      }
      if (valueType === 'boolean') {
        return value ? 1 : 0
      }
      return undefined
    }

    case 'boolean': {
      if (valueType === 'string') {
        const str = (value as string).toLowerCase().trim()
        if (str === 'true' || str === 'yes' || str === '1') return true
        if (str === 'false' || str === 'no' || str === '0') return false
        return undefined
      }
      if (valueType === 'number') {
        return value !== 0
      }
      return undefined
    }

    case 'string': {
      if (valueType === 'number' || valueType === 'boolean') {
        return String(value)
      }
      return undefined
    }

    case 'null': {
      if (valueType === 'string' && (value as string).toLowerCase().trim() === 'null') {
        return null
      }
      return undefined
    }

    default:
      return undefined
  }
}

/**
 * Get the expected Zod type name from a schema
 */
function getZodTypeName(schema: z.ZodType<unknown>): CoercionTarget | null {
  const def = (schema as any)._def
  // Zod stores type in _def.type (not _def.typeName in some versions)
  const type = def?.type ?? def?.typeName

  switch (type) {
    case 'string':
    case 'ZodString':
      return 'string'
    case 'number':
    case 'ZodNumber':
      return 'number'
    case 'boolean':
    case 'ZodBoolean':
      return 'boolean'
    case 'null':
    case 'ZodNull':
      return 'null'
    case 'optional':
    case 'nullable':
    case 'default':
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
      return def.innerType ? getZodTypeName(def.innerType) : null
    default:
      return null
  }
}

/**
 * Recursively coerce values in an object to match schema types
 */
function coerceToSchema(value: unknown, schema: z.ZodType<unknown>): unknown {
  const def = (schema as any)._def
  const type = def?.type ?? def?.typeName

  // Handle nullable/optional wrappers FIRST (before primitives)
  // This ensures "null" string gets coerced to null for nullable schemas
  if (type === 'optional' || type === 'nullable' || type === 'default' ||
      type === 'ZodOptional' || type === 'ZodNullable' || type === 'ZodDefault') {
    if (value === null || value === undefined) {
      return value
    }
    // Handle "null" string - coerce to null for nullable schemas
    if (typeof value === 'string' && value.toLowerCase().trim() === 'null') {
      if (type === 'nullable' || type === 'ZodNullable') {
        return null
      }
    }
    return def.innerType ? coerceToSchema(value, def.innerType) : value
  }

  // Handle primitives
  const targetType = getZodTypeName(schema)
  if (targetType && (typeof value !== 'object' || value === null)) {
    const coerced = coerceType(value, targetType)
    return coerced !== undefined ? coerced : value
  }

  // Handle objects
  if ((type === 'object' || type === 'ZodObject') && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    // def.shape can be a function or an object depending on Zod version
    const shape = typeof def.shape === 'function' ? def.shape() : (def.shape ?? {})
    const result: Record<string, unknown> = {}

    for (const [key, propSchema] of Object.entries(shape)) {
      if (key in (value as Record<string, unknown>)) {
        result[key] = coerceToSchema((value as Record<string, unknown>)[key], propSchema as z.ZodType<unknown>)
      }
    }

    // Copy over any extra properties not in schema
    for (const key of Object.keys(value as object)) {
      if (!(key in result)) {
        result[key] = (value as Record<string, unknown>)[key]
      }
    }

    return result
  }

  // Handle arrays
  if ((type === 'array' || type === 'ZodArray') && Array.isArray(value)) {
    const elementSchema = def.element
    if (elementSchema) {
      return value.map((item) => coerceToSchema(item, elementSchema))
    }
  }

  return value
}

// ============================================================================
// Main Parsing Functions
// ============================================================================

/**
 * Parse structured output from AI response
 *
 * Extracts JSON from the response, validates against schema,
 * and optionally coerces types.
 *
 * @param schema - Zod schema to validate against
 * @param output - Raw AI output (string or already parsed object)
 * @param options - Parsing options
 * @returns Validated and typed data
 * @throws StructuredOutputError on parse or validation failure
 */
export function parseStructuredOutput<T>(
  schema: z.ZodType<T>,
  output: string | unknown,
  options: { coerce?: boolean } = {}
): T {
  let rawOutput: string
  let candidates: unknown[]

  // Handle already parsed input
  if (typeof output !== 'string') {
    rawOutput = JSON.stringify(output)
    candidates = [output]
  } else {
    rawOutput = output

    // Try direct JSON parse first
    try {
      candidates = [JSON.parse(output)]
    } catch {
      // Extract JSON from mixed text
      candidates = extractJson(output)
    }
  }

  if (candidates.length === 0) {
    throw new StructuredOutputError({
      message: 'No valid JSON found in output',
      phase: 'parse',
      rawOutput,
    })
  }

  // Try each candidate against the schema
  let lastError: StructuredOutputError | null = null

  for (const candidate of candidates) {
    let value = candidate

    // Apply type coercion if enabled
    if (options.coerce) {
      value = coerceToSchema(value, schema)
    }

    // Validate against schema
    const result = schema.safeParse(value)

    if (result.success) {
      return result.data
    }

    // Store error for last candidate
    const firstIssue = result.error.issues[0]
    lastError = new StructuredOutputError({
      message: result.error.issues.map((i) => i.message).join('; '),
      phase: 'validate',
      rawOutput,
      extractedJson: candidate,
      path: firstIssue?.path.map((p) => (typeof p === 'number' ? p : String(p))),
      expected: firstIssue?.message,
      received: value,
    })
  }

  // No candidate matched the schema
  throw lastError ?? new StructuredOutputError({
    message: 'No JSON candidate matched schema',
    phase: 'validate',
    rawOutput,
  })
}

// ============================================================================
// Parser Factory with Retry Logic
// ============================================================================

/**
 * Create a structured output parser with retry logic
 *
 * @param schema - Zod schema to validate against
 * @param options - Parser options including retry configuration
 * @returns Async parser function
 *
 * @example
 * ```ts
 * const parser = createStructuredOutputParser(reviewSchema, {
 *   coerce: true,
 *   maxRetries: 2,
 *   onError: async (error) => {
 *     // Ask AI to fix the malformed output
 *     return await askAI(`Fix this JSON: ${error.rawOutput}\nError: ${error.message}`)
 *   },
 * })
 *
 * const result = await parser(aiResponse)
 * ```
 */
export function createStructuredOutputParser<T, TOutput = T>(
  schema: z.ZodType<T>,
  options: StructuredOutputOptions<T> = {}
): (output: string | unknown) => Promise<TOutput> {
  const { coerce = false, maxRetries = 0, onError, transform } = options

  return async (output: string | unknown): Promise<TOutput> => {
    let currentOutput = output
    let retryCount = 0

    while (true) {
      try {
        const result = parseStructuredOutput(schema, currentOutput, { coerce })

        // Apply transform if provided
        if (transform) {
          return transform(result) as TOutput
        }

        return result as unknown as TOutput
      } catch (error) {
        if (!(error instanceof StructuredOutputError)) {
          throw error
        }

        // Check if we can retry
        if (retryCount >= maxRetries || !onError) {
          // Add retry count to error and rethrow
          throw new StructuredOutputError({
            message: error.message,
            phase: error.phase,
            rawOutput: error.rawOutput,
            extractedJson: error.extractedJson,
            path: error.path,
            expected: error.expected,
            received: error.received,
            retryCount,
          })
        }

        // Try to fix the output
        retryCount++
        try {
          currentOutput = await onError(error)
        } catch (fixError) {
          // Fix function failed, rethrow original error
          throw new StructuredOutputError({
            message: error.message,
            phase: error.phase,
            rawOutput: error.rawOutput,
            extractedJson: error.extractedJson,
            path: error.path,
            expected: error.expected,
            received: error.received,
            retryCount,
          })
        }
      }
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

export { z }
