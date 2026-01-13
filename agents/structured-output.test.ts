/**
 * Structured Output Parser Tests (TDD)
 *
 * Tests for:
 * - parseStructuredOutput() - Parse AI output against a schema
 * - StructuredOutputError - Custom error for parsing failures
 * - Retry logic for malformed outputs
 * - Type coercion (string -> number, string -> boolean, etc.)
 * - JSON extraction from markdown code blocks
 *
 * @see dotdo-rrl0q - Structured output parser
 * @module agents/structured-output.test.ts
 */

import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import {
  parseStructuredOutput,
  extractJson,
  coerceType,
  StructuredOutputError,
  createStructuredOutputParser,
  type StructuredOutputOptions,
} from './structured-output'

// ============================================================================
// parseStructuredOutput() Tests
// ============================================================================

describe('parseStructuredOutput()', () => {
  describe('basic parsing', () => {
    it('parses valid JSON string against Zod schema', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      })

      const output = '{"name": "Alice", "age": 30}'
      const result = parseStructuredOutput(schema, output)

      expect(result).toEqual({ name: 'Alice', age: 30 })
    })

    it('parses JSON object directly', () => {
      const schema = z.object({
        items: z.array(z.string()),
      })

      const output = { items: ['a', 'b', 'c'] }
      const result = parseStructuredOutput(schema, output)

      expect(result).toEqual({ items: ['a', 'b', 'c'] })
    })

    it('throws StructuredOutputError for invalid JSON', () => {
      const schema = z.object({ name: z.string() })
      const output = 'not valid json {'

      expect(() => parseStructuredOutput(schema, output)).toThrow(StructuredOutputError)
    })

    it('throws StructuredOutputError for schema validation failure', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      })

      const output = '{"name": "Alice", "age": "not a number"}'

      expect(() => parseStructuredOutput(schema, output)).toThrow(StructuredOutputError)
    })

    it('includes path information in validation errors', () => {
      const schema = z.object({
        user: z.object({
          email: z.string().email(),
        }),
      })

      const output = '{"user": {"email": "invalid"}}'

      try {
        parseStructuredOutput(schema, output)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(StructuredOutputError)
        const structuredError = error as StructuredOutputError
        expect(structuredError.path).toContain('email')
      }
    })
  })

  describe('JSON extraction from AI responses', () => {
    it('extracts JSON from markdown code block', () => {
      const schema = z.object({
        approved: z.boolean(),
        feedback: z.string(),
      })

      const output = `
Here's my review:

\`\`\`json
{
  "approved": true,
  "feedback": "Code looks good"
}
\`\`\`

Let me know if you have questions.
      `

      const result = parseStructuredOutput(schema, output)
      expect(result).toEqual({ approved: true, feedback: 'Code looks good' })
    })

    it('extracts JSON from code block without language specifier', () => {
      const schema = z.object({ status: z.string() })

      const output = `
\`\`\`
{"status": "complete"}
\`\`\`
      `

      const result = parseStructuredOutput(schema, output)
      expect(result).toEqual({ status: 'complete' })
    })

    it('extracts bare JSON object from mixed text', () => {
      const schema = z.object({
        task: z.string(),
        priority: z.number(),
      })

      const output = `
Here is the task definition:
{"task": "Implement feature", "priority": 1}
Based on the requirements above.
      `

      const result = parseStructuredOutput(schema, output)
      expect(result).toEqual({ task: 'Implement feature', priority: 1 })
    })

    it('extracts JSON array from response', () => {
      const schema = z.array(z.object({ id: z.number(), name: z.string() }))

      const output = `
Found the following items:
[{"id": 1, "name": "first"}, {"id": 2, "name": "second"}]
      `

      const result = parseStructuredOutput(schema, output)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ id: 1, name: 'first' })
    })

    it('handles multiple JSON blocks - uses first valid one', () => {
      const schema = z.object({ result: z.string() })

      const output = `
First attempt (invalid):
\`\`\`json
{"wrong": "schema"}
\`\`\`

Second attempt (valid):
\`\`\`json
{"result": "success"}
\`\`\`
      `

      // Should try both and use the valid one
      const result = parseStructuredOutput(schema, output)
      expect(result).toEqual({ result: 'success' })
    })
  })

  describe('type coercion', () => {
    it('coerces string to number when schema expects number', () => {
      const schema = z.object({
        count: z.number(),
        price: z.number(),
      })

      const output = '{"count": "42", "price": "19.99"}'
      const result = parseStructuredOutput(schema, output, { coerce: true })

      expect(result).toEqual({ count: 42, price: 19.99 })
    })

    it('coerces string to boolean when schema expects boolean', () => {
      const schema = z.object({
        active: z.boolean(),
        deleted: z.boolean(),
      })

      const output = '{"active": "true", "deleted": "false"}'
      const result = parseStructuredOutput(schema, output, { coerce: true })

      expect(result).toEqual({ active: true, deleted: false })
    })

    it('coerces number to string when schema expects string', () => {
      const schema = z.object({
        id: z.string(),
        code: z.string(),
      })

      const output = '{"id": 123, "code": 456}'
      const result = parseStructuredOutput(schema, output, { coerce: true })

      expect(result).toEqual({ id: '123', code: '456' })
    })

    it('coerces "yes"/"no" to boolean', () => {
      const schema = z.object({ approved: z.boolean() })

      const output1 = '{"approved": "yes"}'
      const output2 = '{"approved": "no"}'

      expect(parseStructuredOutput(schema, output1, { coerce: true })).toEqual({ approved: true })
      expect(parseStructuredOutput(schema, output2, { coerce: true })).toEqual({ approved: false })
    })

    it('coerces null/undefined string to null when schema allows', () => {
      const schema = z.object({
        value: z.string().nullable(),
      })

      const output = '{"value": "null"}'
      const result = parseStructuredOutput(schema, output, { coerce: true })

      expect(result).toEqual({ value: null })
    })

    it('coerces nested object properties', () => {
      const schema = z.object({
        user: z.object({
          age: z.number(),
          verified: z.boolean(),
        }),
      })

      const output = '{"user": {"age": "25", "verified": "true"}}'
      const result = parseStructuredOutput(schema, output, { coerce: true })

      expect(result).toEqual({ user: { age: 25, verified: true } })
    })

    it('coerces array elements', () => {
      const schema = z.object({
        scores: z.array(z.number()),
      })

      const output = '{"scores": ["10", "20", "30"]}'
      const result = parseStructuredOutput(schema, output, { coerce: true })

      expect(result).toEqual({ scores: [10, 20, 30] })
    })

    it('does not coerce when option is disabled', () => {
      const schema = z.object({ count: z.number() })
      const output = '{"count": "42"}'

      expect(() => parseStructuredOutput(schema, output, { coerce: false })).toThrow(StructuredOutputError)
    })
  })

  describe('error handling', () => {
    it('provides raw output in error for debugging', () => {
      const schema = z.object({ name: z.string() })
      const output = '{"invalid": true}'

      try {
        parseStructuredOutput(schema, output)
        expect.fail('Should have thrown')
      } catch (error) {
        const structuredError = error as StructuredOutputError
        expect(structuredError.rawOutput).toBe(output)
      }
    })

    it('provides extracted JSON in error when extraction succeeded', () => {
      const schema = z.object({ name: z.string() })
      const output = `
Some text
\`\`\`json
{"wrong": "schema"}
\`\`\`
      `

      try {
        parseStructuredOutput(schema, output)
        expect.fail('Should have thrown')
      } catch (error) {
        const structuredError = error as StructuredOutputError
        expect(structuredError.extractedJson).toEqual({ wrong: 'schema' })
      }
    })

    it('indicates parsing phase in error (parse vs validate)', () => {
      const schema = z.object({ name: z.string() })

      // Parse failure
      try {
        parseStructuredOutput(schema, 'not json')
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as StructuredOutputError).phase).toBe('parse')
      }

      // Validation failure
      try {
        parseStructuredOutput(schema, '{"wrong": 123}')
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as StructuredOutputError).phase).toBe('validate')
      }
    })
  })
})

// ============================================================================
// extractJson() Tests
// ============================================================================

describe('extractJson()', () => {
  it('extracts JSON object from plain string', () => {
    const result = extractJson('{"key": "value"}')
    expect(result).toEqual([{ key: 'value' }])
  })

  it('extracts JSON array from plain string', () => {
    const result = extractJson('[1, 2, 3]')
    expect(result).toEqual([[1, 2, 3]])
  })

  it('extracts JSON from markdown code block with json tag', () => {
    const input = `
\`\`\`json
{"status": "ok"}
\`\`\`
    `
    const result = extractJson(input)
    expect(result).toContainEqual({ status: 'ok' })
  })

  it('extracts JSON from markdown code block without tag', () => {
    const input = `
\`\`\`
{"status": "ok"}
\`\`\`
    `
    const result = extractJson(input)
    expect(result).toContainEqual({ status: 'ok' })
  })

  it('extracts multiple JSON blocks', () => {
    const input = `
First:
\`\`\`json
{"a": 1}
\`\`\`

Second:
\`\`\`json
{"b": 2}
\`\`\`
    `
    const result = extractJson(input)
    expect(result).toHaveLength(2)
    expect(result).toContainEqual({ a: 1 })
    expect(result).toContainEqual({ b: 2 })
  })

  it('extracts JSON object embedded in text', () => {
    const input = 'The result is {"found": true} as expected.'
    const result = extractJson(input)
    expect(result).toContainEqual({ found: true })
  })

  it('handles nested braces in JSON', () => {
    const input = '{"outer": {"inner": {"deep": "value"}}}'
    const result = extractJson(input)
    expect(result[0]).toEqual({ outer: { inner: { deep: 'value' } } })
  })

  it('returns empty array for no JSON found', () => {
    const input = 'No JSON here, just plain text.'
    const result = extractJson(input)
    expect(result).toEqual([])
  })

  it('ignores invalid JSON that looks like JSON', () => {
    const input = '{invalid json without quotes}'
    const result = extractJson(input)
    expect(result).toEqual([])
  })

  it('handles JSON with escaped quotes', () => {
    const input = '{"message": "Say \\"hello\\" to the world"}'
    const result = extractJson(input)
    expect(result[0]).toEqual({ message: 'Say "hello" to the world' })
  })

  it('prioritizes code blocks over inline JSON', () => {
    const input = `
Inline: {"inline": true}

\`\`\`json
{"block": true}
\`\`\`
    `
    const result = extractJson(input)
    // Code blocks should come first
    expect(result[0]).toEqual({ block: true })
  })
})

// ============================================================================
// coerceType() Tests
// ============================================================================

describe('coerceType()', () => {
  it('coerces string "123" to number 123', () => {
    expect(coerceType('123', 'number')).toBe(123)
  })

  it('coerces string "12.5" to number 12.5', () => {
    expect(coerceType('12.5', 'number')).toBe(12.5)
  })

  it('coerces string "true" to boolean true', () => {
    expect(coerceType('true', 'boolean')).toBe(true)
  })

  it('coerces string "false" to boolean false', () => {
    expect(coerceType('false', 'boolean')).toBe(false)
  })

  it('coerces "yes" to true', () => {
    expect(coerceType('yes', 'boolean')).toBe(true)
  })

  it('coerces "no" to false', () => {
    expect(coerceType('no', 'boolean')).toBe(false)
  })

  it('coerces "1" to true for boolean', () => {
    expect(coerceType('1', 'boolean')).toBe(true)
  })

  it('coerces "0" to false for boolean', () => {
    expect(coerceType('0', 'boolean')).toBe(false)
  })

  it('coerces number to string', () => {
    expect(coerceType(123, 'string')).toBe('123')
  })

  it('coerces boolean to string', () => {
    expect(coerceType(true, 'string')).toBe('true')
    expect(coerceType(false, 'string')).toBe('false')
  })

  it('coerces "null" string to null', () => {
    expect(coerceType('null', 'null')).toBeNull()
  })

  it('returns value unchanged if already correct type', () => {
    expect(coerceType(123, 'number')).toBe(123)
    expect(coerceType(true, 'boolean')).toBe(true)
    expect(coerceType('hello', 'string')).toBe('hello')
  })

  it('returns undefined for unconvertible values', () => {
    expect(coerceType('not a number', 'number')).toBeUndefined()
    expect(coerceType('not boolean', 'boolean')).toBeUndefined()
  })
})

// ============================================================================
// StructuredOutputError Tests
// ============================================================================

describe('StructuredOutputError', () => {
  it('extends Error', () => {
    const error = new StructuredOutputError({
      message: 'Test error',
      phase: 'parse',
      rawOutput: '{}',
    })

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(StructuredOutputError)
  })

  it('includes all context properties', () => {
    const error = new StructuredOutputError({
      message: 'Validation failed',
      phase: 'validate',
      rawOutput: 'raw output',
      extractedJson: { test: true },
      path: ['user', 'email'],
      expected: 'email',
      received: 'not-an-email',
    })

    expect(error.message).toBe('Validation failed')
    expect(error.phase).toBe('validate')
    expect(error.rawOutput).toBe('raw output')
    expect(error.extractedJson).toEqual({ test: true })
    expect(error.path).toEqual(['user', 'email'])
    expect(error.expected).toBe('email')
    expect(error.received).toBe('not-an-email')
  })

  it('has name StructuredOutputError', () => {
    const error = new StructuredOutputError({
      message: 'Test',
      phase: 'parse',
      rawOutput: '',
    })

    expect(error.name).toBe('StructuredOutputError')
  })

  it('generates helpful toString() output', () => {
    const error = new StructuredOutputError({
      message: 'Invalid type',
      phase: 'validate',
      rawOutput: '{"age": "twenty"}',
      path: ['age'],
      expected: 'number',
      received: '"twenty"',
    })

    const str = error.toString()
    expect(str).toContain('StructuredOutputError')
    expect(str).toContain('age')
  })
})

// ============================================================================
// createStructuredOutputParser() - Factory with Retry Logic
// ============================================================================

describe('createStructuredOutputParser()', () => {
  describe('basic parsing', () => {
    it('returns parser function that validates against schema', async () => {
      const schema = z.object({ name: z.string() })
      const parser = createStructuredOutputParser(schema)

      const result = await parser('{"name": "Alice"}')
      expect(result).toEqual({ name: 'Alice' })
    })

    it('throws StructuredOutputError for invalid output', async () => {
      const schema = z.object({ name: z.string() })
      const parser = createStructuredOutputParser(schema)

      await expect(parser('{"wrong": "field"}')).rejects.toThrow(StructuredOutputError)
    })
  })

  describe('retry logic', () => {
    it('retries with fix function on parse failure', async () => {
      const schema = z.object({ name: z.string() })
      const fixFn = vi.fn().mockResolvedValue('{"name": "Fixed"}')

      const parser = createStructuredOutputParser(schema, {
        onError: fixFn,
        maxRetries: 3,
      })

      const result = await parser('invalid json')

      expect(fixFn).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ name: 'Fixed' })
    })

    it('passes error context to fix function', async () => {
      const schema = z.object({ name: z.string() })
      let capturedError: StructuredOutputError | null = null

      const fixFn = vi.fn().mockImplementation(async (error: StructuredOutputError) => {
        capturedError = error
        return '{"name": "Fixed"}'
      })

      const parser = createStructuredOutputParser(schema, {
        onError: fixFn,
        maxRetries: 1,
      })

      await parser('bad json')

      expect(capturedError).toBeInstanceOf(StructuredOutputError)
      expect(capturedError?.rawOutput).toBe('bad json')
    })

    it('retries up to maxRetries times', async () => {
      const schema = z.object({ name: z.string() })
      const fixFn = vi.fn()
        .mockResolvedValueOnce('still invalid')
        .mockResolvedValueOnce('still invalid 2')
        .mockResolvedValueOnce('{"name": "Finally"}')

      const parser = createStructuredOutputParser(schema, {
        onError: fixFn,
        maxRetries: 3,
      })

      const result = await parser('initial invalid')

      expect(fixFn).toHaveBeenCalledTimes(3)
      expect(result).toEqual({ name: 'Finally' })
    })

    it('throws after maxRetries exhausted', async () => {
      const schema = z.object({ name: z.string() })
      const fixFn = vi.fn().mockResolvedValue('always invalid')

      const parser = createStructuredOutputParser(schema, {
        onError: fixFn,
        maxRetries: 2,
      })

      await expect(parser('initial invalid')).rejects.toThrow(StructuredOutputError)
      expect(fixFn).toHaveBeenCalledTimes(2)
    })

    it('does not retry when maxRetries is 0', async () => {
      const schema = z.object({ name: z.string() })
      const fixFn = vi.fn()

      const parser = createStructuredOutputParser(schema, {
        onError: fixFn,
        maxRetries: 0,
      })

      await expect(parser('invalid')).rejects.toThrow(StructuredOutputError)
      expect(fixFn).not.toHaveBeenCalled()
    })

    it('includes retry count in error on final failure', async () => {
      const schema = z.object({ name: z.string() })
      const fixFn = vi.fn().mockResolvedValue('invalid')

      const parser = createStructuredOutputParser(schema, {
        onError: fixFn,
        maxRetries: 2,
      })

      try {
        await parser('initial invalid')
        expect.fail('Should have thrown')
      } catch (error) {
        const structuredError = error as StructuredOutputError
        expect(structuredError.retryCount).toBe(2)
      }
    })
  })

  describe('with coercion enabled', () => {
    it('applies type coercion before validation', async () => {
      const schema = z.object({
        count: z.number(),
        active: z.boolean(),
      })

      const parser = createStructuredOutputParser(schema, { coerce: true })
      const result = await parser('{"count": "42", "active": "true"}')

      expect(result).toEqual({ count: 42, active: true })
    })
  })

  describe('with transform function', () => {
    it('applies transform after successful parse', async () => {
      const schema = z.object({
        firstName: z.string(),
        lastName: z.string(),
      })

      const parser = createStructuredOutputParser(schema, {
        transform: (data) => ({
          ...data,
          fullName: `${data.firstName} ${data.lastName}`,
        }),
      })

      const result = await parser('{"firstName": "Alice", "lastName": "Smith"}')

      expect(result).toEqual({
        firstName: 'Alice',
        lastName: 'Smith',
        fullName: 'Alice Smith',
      })
    })
  })
})

// ============================================================================
// Integration with Agent Runtime
// ============================================================================

describe('Integration with Agent types', () => {
  it('works with AgentResult structured output', async () => {
    const reviewSchema = z.object({
      approved: z.boolean(),
      feedback: z.string(),
      issues: z.array(z.string()),
    })

    // Simulate AI response with structured output
    const aiResponse = `
Based on my review, here is my assessment:

\`\`\`json
{
  "approved": false,
  "feedback": "Code needs improvement",
  "issues": ["Missing error handling", "No input validation"]
}
\`\`\`

Please address these issues before merging.
    `

    const parser = createStructuredOutputParser(reviewSchema)
    const result = await parser(aiResponse)

    expect(result.approved).toBe(false)
    expect(result.issues).toHaveLength(2)
  })

  it('handles JSON Schema format', async () => {
    // JSON Schema format (used by OpenAI)
    const jsonSchema = {
      type: 'object',
      properties: {
        decision: { type: 'string', enum: ['approve', 'reject', 'review'] },
        confidence: { type: 'number' },
      },
      required: ['decision', 'confidence'],
    } as const

    // For JSON Schema, we convert to Zod internally or pass through
    const schema = z.object({
      decision: z.enum(['approve', 'reject', 'review']),
      confidence: z.number(),
    })

    const parser = createStructuredOutputParser(schema)
    const result = await parser('{"decision": "approve", "confidence": 0.95}')

    expect(result.decision).toBe('approve')
    expect(result.confidence).toBe(0.95)
  })
})
