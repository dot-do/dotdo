/**
 * Structured JSON Schema Validation Tests
 *
 * Comprehensive tests for structured JSON output validation:
 * - JSON schema validation with Zod
 * - Structured response parsing from AI models
 * - Schema enforcement with strict validation
 * - Error recovery with detailed diagnostics
 * - Nested object handling with deep validation
 *
 * These tests verify the existing implementation in structured-output.ts
 * with additional coverage for edge cases and real-world scenarios.
 *
 * @module agents/tests/structured-json-schema-validation.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import {
  parseStructuredOutput,
  extractJson,
  coerceType,
  StructuredOutputError,
  createStructuredOutputParser,
} from '../structured-output'
import { zodToJsonSchema, validateInput, isZodSchema, isJsonSchema } from '../schema'

// ============================================================================
// JSON Schema Validation Tests
// ============================================================================

describe('JSON Schema Validation', () => {
  describe('basic schema types', () => {
    it('validates string schema', () => {
      const schema = z.string()
      const result = parseStructuredOutput(schema, '"hello world"')
      expect(result).toBe('hello world')
    })

    it('validates number schema', () => {
      const schema = z.number()
      const result = parseStructuredOutput(schema, '42')
      expect(result).toBe(42)
    })

    it('validates boolean schema', () => {
      const schema = z.boolean()
      expect(parseStructuredOutput(schema, 'true')).toBe(true)
      expect(parseStructuredOutput(schema, 'false')).toBe(false)
    })

    it('validates null schema', () => {
      const schema = z.null()
      const result = parseStructuredOutput(schema, 'null')
      expect(result).toBeNull()
    })

    it('validates array schema', () => {
      const schema = z.array(z.number())
      const result = parseStructuredOutput(schema, '[1, 2, 3, 4, 5]')
      expect(result).toEqual([1, 2, 3, 4, 5])
    })

    it('validates object schema', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      })
      const result = parseStructuredOutput(schema, '{"name": "Alice", "age": 30}')
      expect(result).toEqual({ name: 'Alice', age: 30 })
    })
  })

  describe('enum validation', () => {
    it('validates enum values', () => {
      const schema = z.enum(['low', 'medium', 'high'])
      expect(parseStructuredOutput(schema, '"low"')).toBe('low')
      expect(parseStructuredOutput(schema, '"medium"')).toBe('medium')
      expect(parseStructuredOutput(schema, '"high"')).toBe('high')
    })

    it('rejects invalid enum values', () => {
      const schema = z.enum(['low', 'medium', 'high'])
      expect(() => parseStructuredOutput(schema, '"invalid"')).toThrow(StructuredOutputError)
    })

    it('validates native enum', () => {
      enum Status {
        Active = 'active',
        Inactive = 'inactive',
      }
      const schema = z.nativeEnum(Status)
      expect(parseStructuredOutput(schema, '"active"')).toBe(Status.Active)
    })
  })

  describe('optional and nullable fields', () => {
    it('handles optional fields', () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      })

      const withOptional = parseStructuredOutput(schema, '{"required": "value", "optional": "present"}')
      expect(withOptional).toEqual({ required: 'value', optional: 'present' })

      const withoutOptional = parseStructuredOutput(schema, '{"required": "value"}')
      expect(withoutOptional).toEqual({ required: 'value' })
    })

    it('handles nullable fields', () => {
      const schema = z.object({
        value: z.string().nullable(),
      })

      const withValue = parseStructuredOutput(schema, '{"value": "present"}')
      expect(withValue).toEqual({ value: 'present' })

      const withNull = parseStructuredOutput(schema, '{"value": null}')
      expect(withNull).toEqual({ value: null })
    })

    it('handles optional nullable combination', () => {
      const schema = z.object({
        field: z.string().nullable().optional(),
      })

      expect(parseStructuredOutput(schema, '{"field": "value"}')).toEqual({ field: 'value' })
      expect(parseStructuredOutput(schema, '{"field": null}')).toEqual({ field: null })
      expect(parseStructuredOutput(schema, '{}')).toEqual({})
    })
  })

  describe('default values', () => {
    it('uses default values when field is missing', () => {
      const schema = z.object({
        name: z.string(),
        count: z.number().default(0),
        enabled: z.boolean().default(true),
      })

      const result = parseStructuredOutput(schema, '{"name": "test"}')
      expect(result).toEqual({ name: 'test', count: 0, enabled: true })
    })

    it('overrides default when value is provided', () => {
      const schema = z.object({
        count: z.number().default(0),
      })

      const result = parseStructuredOutput(schema, '{"count": 42}')
      expect(result).toEqual({ count: 42 })
    })
  })

  describe('number constraints', () => {
    it('validates min constraint', () => {
      const schema = z.number().min(0)
      expect(parseStructuredOutput(schema, '0')).toBe(0)
      expect(parseStructuredOutput(schema, '100')).toBe(100)
      expect(() => parseStructuredOutput(schema, '-1')).toThrow(StructuredOutputError)
    })

    it('validates max constraint', () => {
      const schema = z.number().max(100)
      expect(parseStructuredOutput(schema, '100')).toBe(100)
      expect(parseStructuredOutput(schema, '0')).toBe(0)
      expect(() => parseStructuredOutput(schema, '101')).toThrow(StructuredOutputError)
    })

    it('validates int constraint', () => {
      const schema = z.number().int()
      expect(parseStructuredOutput(schema, '42')).toBe(42)
      expect(() => parseStructuredOutput(schema, '42.5')).toThrow(StructuredOutputError)
    })

    it('validates positive constraint', () => {
      const schema = z.number().positive()
      expect(parseStructuredOutput(schema, '1')).toBe(1)
      expect(() => parseStructuredOutput(schema, '0')).toThrow(StructuredOutputError)
      expect(() => parseStructuredOutput(schema, '-1')).toThrow(StructuredOutputError)
    })

    it('validates negative constraint', () => {
      const schema = z.number().negative()
      expect(parseStructuredOutput(schema, '-1')).toBe(-1)
      expect(() => parseStructuredOutput(schema, '0')).toThrow(StructuredOutputError)
      expect(() => parseStructuredOutput(schema, '1')).toThrow(StructuredOutputError)
    })

    it('validates multipleOf constraint', () => {
      const schema = z.number().multipleOf(5)
      expect(parseStructuredOutput(schema, '10')).toBe(10)
      expect(parseStructuredOutput(schema, '0')).toBe(0)
      expect(() => parseStructuredOutput(schema, '7')).toThrow(StructuredOutputError)
    })
  })

  describe('string constraints', () => {
    it('validates min length', () => {
      const schema = z.string().min(3)
      expect(parseStructuredOutput(schema, '"abc"')).toBe('abc')
      expect(() => parseStructuredOutput(schema, '"ab"')).toThrow(StructuredOutputError)
    })

    it('validates max length', () => {
      const schema = z.string().max(5)
      expect(parseStructuredOutput(schema, '"hello"')).toBe('hello')
      expect(() => parseStructuredOutput(schema, '"hello world"')).toThrow(StructuredOutputError)
    })

    it('validates email format', () => {
      const schema = z.string().email()
      expect(parseStructuredOutput(schema, '"test@example.com"')).toBe('test@example.com')
      expect(() => parseStructuredOutput(schema, '"not-an-email"')).toThrow(StructuredOutputError)
    })

    it('validates url format', () => {
      const schema = z.string().url()
      expect(parseStructuredOutput(schema, '"https://example.com"')).toBe('https://example.com')
      expect(() => parseStructuredOutput(schema, '"not-a-url"')).toThrow(StructuredOutputError)
    })

    it('validates uuid format', () => {
      const schema = z.string().uuid()
      expect(parseStructuredOutput(schema, '"123e4567-e89b-12d3-a456-426614174000"')).toBe('123e4567-e89b-12d3-a456-426614174000')
      expect(() => parseStructuredOutput(schema, '"not-a-uuid"')).toThrow(StructuredOutputError)
    })

    it('validates regex pattern', () => {
      const schema = z.string().regex(/^[A-Z]{3}-\d{3}$/)
      expect(parseStructuredOutput(schema, '"ABC-123"')).toBe('ABC-123')
      expect(() => parseStructuredOutput(schema, '"invalid"')).toThrow(StructuredOutputError)
    })

    it('validates startsWith', () => {
      const schema = z.string().startsWith('prefix_')
      expect(parseStructuredOutput(schema, '"prefix_value"')).toBe('prefix_value')
      expect(() => parseStructuredOutput(schema, '"value"')).toThrow(StructuredOutputError)
    })

    it('validates endsWith', () => {
      const schema = z.string().endsWith('_suffix')
      expect(parseStructuredOutput(schema, '"value_suffix"')).toBe('value_suffix')
      expect(() => parseStructuredOutput(schema, '"value"')).toThrow(StructuredOutputError)
    })
  })

  describe('array constraints', () => {
    it('validates min items', () => {
      const schema = z.array(z.number()).min(2)
      expect(parseStructuredOutput(schema, '[1, 2]')).toEqual([1, 2])
      expect(() => parseStructuredOutput(schema, '[1]')).toThrow(StructuredOutputError)
    })

    it('validates max items', () => {
      const schema = z.array(z.number()).max(3)
      expect(parseStructuredOutput(schema, '[1, 2, 3]')).toEqual([1, 2, 3])
      expect(() => parseStructuredOutput(schema, '[1, 2, 3, 4]')).toThrow(StructuredOutputError)
    })

    it('validates nonempty', () => {
      const schema = z.array(z.string()).nonempty()
      expect(parseStructuredOutput(schema, '["item"]')).toEqual(['item'])
      expect(() => parseStructuredOutput(schema, '[]')).toThrow(StructuredOutputError)
    })

    it('validates length', () => {
      const schema = z.array(z.number()).length(3)
      expect(parseStructuredOutput(schema, '[1, 2, 3]')).toEqual([1, 2, 3])
      expect(() => parseStructuredOutput(schema, '[1, 2]')).toThrow(StructuredOutputError)
      expect(() => parseStructuredOutput(schema, '[1, 2, 3, 4]')).toThrow(StructuredOutputError)
    })
  })
})

// ============================================================================
// Structured Response Parsing Tests
// ============================================================================

describe('Structured Response Parsing', () => {
  describe('AI response extraction', () => {
    it('extracts JSON from conversational response', () => {
      const schema = z.object({
        decision: z.string(),
        confidence: z.number(),
      })

      const aiResponse = `
Based on my analysis, here is my decision:

\`\`\`json
{
  "decision": "approve",
  "confidence": 0.95
}
\`\`\`

This is based on the factors mentioned above.
      `

      const result = parseStructuredOutput(schema, aiResponse)
      expect(result).toEqual({ decision: 'approve', confidence: 0.95 })
    })

    it('extracts JSON from response with thinking process', () => {
      const schema = z.object({
        answer: z.string(),
        steps: z.array(z.string()),
      })

      const aiResponse = `
Let me think through this step by step...

First, I need to consider X.
Then, I should evaluate Y.
Finally, I can conclude Z.

Here's my structured answer:

\`\`\`json
{
  "answer": "The result is 42",
  "steps": [
    "Considered X",
    "Evaluated Y",
    "Concluded Z"
  ]
}
\`\`\`
      `

      const result = parseStructuredOutput(schema, aiResponse)
      expect(result.answer).toBe('The result is 42')
      expect(result.steps).toHaveLength(3)
    })

    it('handles response with multiple code blocks (different languages)', () => {
      const schema = z.object({
        name: z.string(),
        code: z.string(),
      })

      const aiResponse = `
Here's the implementation:

\`\`\`typescript
function hello() {
  return "world";
}
\`\`\`

And the configuration:

\`\`\`json
{
  "name": "hello-world",
  "code": "implemented"
}
\`\`\`
      `

      const result = parseStructuredOutput(schema, aiResponse)
      expect(result.name).toBe('hello-world')
    })

    it('prefers code block JSON over inline JSON', () => {
      const schema = z.object({ source: z.string() })

      const aiResponse = `
Consider this example: {"source": "inline"}

But the actual answer is:
\`\`\`json
{"source": "codeblock"}
\`\`\`
      `

      const result = parseStructuredOutput(schema, aiResponse)
      expect(result.source).toBe('codeblock')
    })

    it('handles escaped characters in JSON strings', () => {
      const schema = z.object({
        code: z.string(),
        path: z.string(),
      })

      const aiResponse = `
\`\`\`json
{
  "code": "console.log(\\"Hello\\nWorld\\");",
  "path": "C:\\\\Users\\\\test"
}
\`\`\`
      `

      const result = parseStructuredOutput(schema, aiResponse)
      expect(result.code).toContain('Hello')
      expect(result.path).toBe('C:\\Users\\test')
    })

    it('handles unicode in JSON', () => {
      const schema = z.object({
        message: z.string(),
        symbols: z.array(z.string()),
      })

      const result = parseStructuredOutput(
        schema,
        '{"message": "Hello, World!", "symbols": ["alpha", "beta", "gamma"]}'
      )
      expect(result.message).toBe('Hello, World!')
      expect(result.symbols).toContain('alpha')
    })
  })

  describe('malformed response handling', () => {
    it('handles truncated JSON gracefully', () => {
      const schema = z.object({ status: z.string() })
      const truncated = '{"status": "partial'

      expect(() => parseStructuredOutput(schema, truncated)).toThrow(StructuredOutputError)
    })

    it('handles JSON with trailing comma (common AI mistake)', () => {
      const schema = z.object({
        items: z.array(z.string()),
      })

      // Standard JSON parsing will fail with trailing commas
      const withTrailingComma = '{"items": ["a", "b", "c",]}'
      expect(() => parseStructuredOutput(schema, withTrailingComma)).toThrow(StructuredOutputError)
    })

    it('handles response with no JSON at all', () => {
      const schema = z.object({ result: z.string() })
      const noJson = 'This is just a plain text response without any JSON.'

      expect(() => parseStructuredOutput(schema, noJson)).toThrow(StructuredOutputError)
    })

    it('extracts valid JSON from partial response', () => {
      const schema = z.object({ status: z.string() })

      const partialResponse = `
Here's the... {"status": "complete"}

[connection lost]
      `

      const result = parseStructuredOutput(schema, partialResponse)
      expect(result.status).toBe('complete')
    })
  })
})

// ============================================================================
// Schema Enforcement Tests
// ============================================================================

describe('Schema Enforcement', () => {
  describe('strict type checking', () => {
    it('rejects extra properties by default with strict schema', () => {
      const schema = z.object({
        expected: z.string(),
      }).strict()

      const withExtra = '{"expected": "value", "unexpected": "extra"}'
      expect(() => parseStructuredOutput(schema, withExtra)).toThrow(StructuredOutputError)
    })

    it('allows extra properties with passthrough', () => {
      const schema = z.object({
        expected: z.string(),
      }).passthrough()

      const withExtra = '{"expected": "value", "unexpected": "extra"}'
      const result = parseStructuredOutput(schema, withExtra) as { expected: string; unexpected: string }
      expect(result.expected).toBe('value')
      expect(result.unexpected).toBe('extra')
    })

    it('strips extra properties with strip', () => {
      const schema = z.object({
        expected: z.string(),
      })

      const withExtra = '{"expected": "value", "unexpected": "extra"}'
      const result = parseStructuredOutput(schema, withExtra) as Record<string, unknown>
      expect(result.expected).toBe('value')
      expect(result.unexpected).toBeUndefined()
    })
  })

  describe('type coercion enforcement', () => {
    it('coerces stringified numbers when enabled', () => {
      const schema = z.object({
        price: z.number(),
        quantity: z.number(),
      })

      const stringified = '{"price": "19.99", "quantity": "5"}'
      const result = parseStructuredOutput(schema, stringified, { coerce: true })
      expect(result.price).toBe(19.99)
      expect(result.quantity).toBe(5)
    })

    it('coerces stringified booleans when enabled', () => {
      const schema = z.object({
        active: z.boolean(),
        verified: z.boolean(),
      })

      const stringified = '{"active": "true", "verified": "false"}'
      const result = parseStructuredOutput(schema, stringified, { coerce: true })
      expect(result.active).toBe(true)
      expect(result.verified).toBe(false)
    })

    it('rejects stringified values when coercion disabled', () => {
      const schema = z.object({
        count: z.number(),
      })

      const stringified = '{"count": "42"}'
      expect(() => parseStructuredOutput(schema, stringified, { coerce: false })).toThrow(StructuredOutputError)
    })

    it('coerces nested values', () => {
      const schema = z.object({
        user: z.object({
          age: z.number(),
          active: z.boolean(),
        }),
        scores: z.array(z.number()),
      })

      const stringified = '{"user": {"age": "25", "active": "yes"}, "scores": ["10", "20", "30"]}'
      const result = parseStructuredOutput(schema, stringified, { coerce: true })
      expect(result.user.age).toBe(25)
      expect(result.user.active).toBe(true)
      expect(result.scores).toEqual([10, 20, 30])
    })
  })

  describe('union type handling', () => {
    it('validates union of primitives', () => {
      const schema = z.union([z.string(), z.number()])

      expect(parseStructuredOutput(schema, '"text"')).toBe('text')
      expect(parseStructuredOutput(schema, '42')).toBe(42)
    })

    it('validates union of objects', () => {
      const schema = z.union([
        z.object({ type: z.literal('text'), content: z.string() }),
        z.object({ type: z.literal('image'), url: z.string() }),
      ])

      const textResult = parseStructuredOutput(schema, '{"type": "text", "content": "hello"}')
      expect(textResult).toEqual({ type: 'text', content: 'hello' })

      const imageResult = parseStructuredOutput(schema, '{"type": "image", "url": "https://example.com/img.png"}')
      expect(imageResult).toEqual({ type: 'image', url: 'https://example.com/img.png' })
    })

    it('validates discriminated union', () => {
      const schema = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('user'), name: z.string() }),
        z.object({ kind: z.literal('bot'), model: z.string() }),
      ])

      const userResult = parseStructuredOutput(schema, '{"kind": "user", "name": "Alice"}')
      expect(userResult).toEqual({ kind: 'user', name: 'Alice' })

      const botResult = parseStructuredOutput(schema, '{"kind": "bot", "model": "gpt-4"}')
      expect(botResult).toEqual({ kind: 'bot', model: 'gpt-4' })
    })
  })

  describe('literal value enforcement', () => {
    it('validates literal string', () => {
      const schema = z.literal('exact')
      expect(parseStructuredOutput(schema, '"exact"')).toBe('exact')
      expect(() => parseStructuredOutput(schema, '"different"')).toThrow(StructuredOutputError)
    })

    it('validates literal number', () => {
      const schema = z.literal(42)
      expect(parseStructuredOutput(schema, '42')).toBe(42)
      expect(() => parseStructuredOutput(schema, '43')).toThrow(StructuredOutputError)
    })

    it('validates literal boolean', () => {
      const schema = z.literal(true)
      expect(parseStructuredOutput(schema, 'true')).toBe(true)
      expect(() => parseStructuredOutput(schema, 'false')).toThrow(StructuredOutputError)
    })
  })
})

// ============================================================================
// Error Recovery Tests
// ============================================================================

describe('Error Recovery', () => {
  describe('retry mechanism', () => {
    it('retries parsing with fixed output', async () => {
      const schema = z.object({ value: z.number() })
      let attempts = 0

      const parser = createStructuredOutputParser(schema, {
        maxRetries: 2,
        onError: async (error) => {
          attempts++
          // Simulate AI fixing the response
          return '{"value": 42}'
        },
      })

      const result = await parser('invalid json')
      expect(result).toEqual({ value: 42 })
      expect(attempts).toBe(1)
    })

    it('provides error context for retry attempts', async () => {
      const schema = z.object({ name: z.string() })
      let capturedError: StructuredOutputError | null = null

      const parser = createStructuredOutputParser(schema, {
        maxRetries: 1,
        onError: async (error) => {
          capturedError = error
          return '{"name": "fixed"}'
        },
      })

      await parser('{"wrong": "field"}')

      expect(capturedError).not.toBeNull()
      expect(capturedError?.phase).toBe('validate')
      expect(capturedError?.rawOutput).toBe('{"wrong": "field"}')
    })

    it('fails after max retries exceeded', async () => {
      const schema = z.object({ value: z.number() })
      let attempts = 0

      const parser = createStructuredOutputParser(schema, {
        maxRetries: 2,
        onError: async () => {
          attempts++
          return 'still invalid'
        },
      })

      await expect(parser('initial invalid')).rejects.toThrow(StructuredOutputError)
      expect(attempts).toBe(2)
    })

    it('includes retry count in final error', async () => {
      const schema = z.object({ value: z.number() })

      const parser = createStructuredOutputParser(schema, {
        maxRetries: 3,
        onError: async () => 'invalid',
      })

      try {
        await parser('bad')
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as StructuredOutputError).retryCount).toBe(3)
      }
    })
  })

  describe('error diagnostics', () => {
    it('provides path to invalid field', () => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            email: z.string().email(),
          }),
        }),
      })

      const invalid = '{"user": {"profile": {"email": "not-valid"}}}'

      try {
        parseStructuredOutput(schema, invalid)
        expect.fail('Should have thrown')
      } catch (error) {
        const structuredError = error as StructuredOutputError
        expect(structuredError.path).toBeDefined()
        expect(structuredError.path?.join('.')).toContain('email')
      }
    })

    it('shows expected vs received values', () => {
      const schema = z.object({
        count: z.number(),
      })

      try {
        parseStructuredOutput(schema, '{"count": "not a number"}')
        expect.fail('Should have thrown')
      } catch (error) {
        const structuredError = error as StructuredOutputError
        expect(structuredError.extractedJson).toBeDefined()
        expect(structuredError.phase).toBe('validate')
      }
    })

    it('distinguishes parse errors from validation errors', () => {
      const schema = z.object({ value: z.number() })

      // Parse error (invalid JSON)
      try {
        parseStructuredOutput(schema, 'not json at all')
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as StructuredOutputError).phase).toBe('parse')
      }

      // Validation error (valid JSON, invalid schema)
      try {
        parseStructuredOutput(schema, '{"value": "string instead of number"}')
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as StructuredOutputError).phase).toBe('validate')
      }
    })
  })

  describe('graceful degradation', () => {
    it('uses first valid candidate from multiple JSON blocks', () => {
      const schema = z.object({ status: z.string() })

      const response = `
Invalid first:
\`\`\`json
{"wrong": 123}
\`\`\`

Valid second:
\`\`\`json
{"status": "ok"}
\`\`\`
      `

      const result = parseStructuredOutput(schema, response)
      expect(result.status).toBe('ok')
    })

    it('handles mixed valid/invalid candidates gracefully', () => {
      const schema = z.object({
        items: z.array(z.string()),
      })

      const response = `
First attempt: {"items": 123}
Second attempt: {"items": ["a", "b", "c"]}
      `

      const result = parseStructuredOutput(schema, response)
      expect(result.items).toEqual(['a', 'b', 'c'])
    })
  })
})

// ============================================================================
// Nested Object Handling Tests
// ============================================================================

describe('Nested Object Handling', () => {
  describe('deep object structures', () => {
    it('validates deeply nested objects', () => {
      const schema = z.object({
        level1: z.object({
          level2: z.object({
            level3: z.object({
              level4: z.object({
                value: z.string(),
              }),
            }),
          }),
        }),
      })

      const deep = '{"level1": {"level2": {"level3": {"level4": {"value": "deep"}}}}}'
      const result = parseStructuredOutput(schema, deep)
      expect(result.level1.level2.level3.level4.value).toBe('deep')
    })

    it('handles arrays of nested objects', () => {
      const schema = z.object({
        users: z.array(z.object({
          id: z.number(),
          profile: z.object({
            name: z.string(),
            settings: z.object({
              theme: z.string(),
              notifications: z.boolean(),
            }),
          }),
        })),
      })

      const data = {
        users: [
          {
            id: 1,
            profile: {
              name: 'Alice',
              settings: { theme: 'dark', notifications: true },
            },
          },
          {
            id: 2,
            profile: {
              name: 'Bob',
              settings: { theme: 'light', notifications: false },
            },
          },
        ],
      }

      const result = parseStructuredOutput(schema, JSON.stringify(data))
      expect(result.users).toHaveLength(2)
      expect(result.users[0].profile.name).toBe('Alice')
      expect(result.users[1].profile.settings.theme).toBe('light')
    })

    it('handles nested arrays', () => {
      const schema = z.object({
        matrix: z.array(z.array(z.number())),
      })

      const data = '{"matrix": [[1, 2, 3], [4, 5, 6], [7, 8, 9]]}'
      const result = parseStructuredOutput(schema, data)
      expect(result.matrix).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9]])
    })

    it('coerces values in deeply nested structures', () => {
      const schema = z.object({
        config: z.object({
          settings: z.object({
            features: z.object({
              enabled: z.boolean(),
              count: z.number(),
            }),
          }),
        }),
      })

      const data = '{"config": {"settings": {"features": {"enabled": "true", "count": "42"}}}}'
      const result = parseStructuredOutput(schema, data, { coerce: true })
      expect(result.config.settings.features.enabled).toBe(true)
      expect(result.config.settings.features.count).toBe(42)
    })
  })

  describe('recursive structures', () => {
    it('handles self-referential schemas', () => {
      interface TreeNode {
        value: string
        children?: TreeNode[]
      }

      const TreeNodeSchema: z.ZodType<TreeNode> = z.lazy(() =>
        z.object({
          value: z.string(),
          children: z.array(TreeNodeSchema).optional(),
        })
      )

      const tree = {
        value: 'root',
        children: [
          { value: 'child1', children: [{ value: 'grandchild' }] },
          { value: 'child2' },
        ],
      }

      const result = parseStructuredOutput(TreeNodeSchema, JSON.stringify(tree))
      expect(result.value).toBe('root')
      expect(result.children).toHaveLength(2)
      expect(result.children![0].children![0].value).toBe('grandchild')
    })
  })

  describe('complex real-world schemas', () => {
    const CodeReviewSchema = z.object({
      summary: z.string(),
      decision: z.enum(['approve', 'request_changes', 'comment']),
      confidence: z.number().min(0).max(1),
      files: z.array(z.object({
        path: z.string(),
        status: z.enum(['added', 'modified', 'deleted']),
        comments: z.array(z.object({
          line: z.number().optional(),
          severity: z.enum(['error', 'warning', 'suggestion', 'info']),
          message: z.string(),
          suggestedFix: z.string().optional(),
        })),
      })),
      overallIssues: z.array(z.string()),
      securityConcerns: z.array(z.object({
        severity: z.enum(['critical', 'high', 'medium', 'low']),
        description: z.string(),
        affectedFiles: z.array(z.string()),
      })).optional(),
    })

    it('validates complex code review response', () => {
      const review = {
        summary: 'Overall good implementation with minor issues',
        decision: 'request_changes',
        confidence: 0.85,
        files: [
          {
            path: 'src/utils.ts',
            status: 'modified',
            comments: [
              {
                line: 42,
                severity: 'error',
                message: 'Missing null check',
                suggestedFix: 'if (value != null) { ... }',
              },
              {
                severity: 'suggestion',
                message: 'Consider using optional chaining',
              },
            ],
          },
        ],
        overallIssues: ['Missing tests', 'Incomplete documentation'],
        securityConcerns: [
          {
            severity: 'medium',
            description: 'Potential SQL injection',
            affectedFiles: ['src/db.ts'],
          },
        ],
      }

      const result = parseStructuredOutput(CodeReviewSchema, JSON.stringify(review))
      expect(result.decision).toBe('request_changes')
      expect(result.files[0].comments).toHaveLength(2)
      expect(result.securityConcerns?.[0].severity).toBe('medium')
    })

    const DataExtractionSchema = z.object({
      entities: z.array(z.object({
        name: z.string(),
        type: z.enum(['person', 'organization', 'location', 'product', 'event']),
        confidence: z.number().min(0).max(1),
        mentions: z.array(z.object({
          text: z.string(),
          startIndex: z.number(),
          endIndex: z.number(),
        })),
        relationships: z.array(z.object({
          targetEntity: z.string(),
          relationshipType: z.string(),
          confidence: z.number(),
        })).optional(),
      })),
      dates: z.array(z.object({
        value: z.string(),
        normalized: z.string().optional(),
        context: z.string(),
      })),
      amounts: z.array(z.object({
        value: z.number(),
        currency: z.string().optional(),
        unit: z.string().optional(),
        context: z.string(),
      })),
    })

    it('validates complex data extraction response', () => {
      const extraction = {
        entities: [
          {
            name: 'Acme Corp',
            type: 'organization',
            confidence: 0.95,
            mentions: [
              { text: 'Acme Corp', startIndex: 0, endIndex: 9 },
              { text: 'Acme', startIndex: 50, endIndex: 54 },
            ],
            relationships: [
              { targetEntity: 'John Smith', relationshipType: 'employs', confidence: 0.8 },
            ],
          },
          {
            name: 'John Smith',
            type: 'person',
            confidence: 0.9,
            mentions: [
              { text: 'John Smith', startIndex: 20, endIndex: 30 },
            ],
          },
        ],
        dates: [
          { value: 'January 15, 2025', normalized: '2025-01-15', context: 'Meeting scheduled for' },
        ],
        amounts: [
          { value: 1000000, currency: 'USD', context: 'Contract value' },
          { value: 50, unit: 'employees', context: 'Team size' },
        ],
      }

      const result = parseStructuredOutput(DataExtractionSchema, JSON.stringify(extraction))
      expect(result.entities).toHaveLength(2)
      expect(result.entities[0].relationships?.[0].targetEntity).toBe('John Smith')
      expect(result.amounts[0].value).toBe(1000000)
    })
  })
})

// ============================================================================
// Various Schema Edge Cases
// ============================================================================

describe('Schema Edge Cases', () => {
  describe('tuple types', () => {
    it('validates fixed-length tuples', () => {
      const schema = z.tuple([z.string(), z.number(), z.boolean()])
      const result = parseStructuredOutput(schema, '["hello", 42, true]')
      expect(result).toEqual(['hello', 42, true])
    })

    it('validates tuple with rest element', () => {
      const schema = z.tuple([z.string(), z.number()]).rest(z.boolean())
      const result = parseStructuredOutput(schema, '["hello", 42, true, false, true]')
      expect(result).toEqual(['hello', 42, true, false, true])
    })
  })

  describe('record types', () => {
    it('validates string key records', () => {
      const schema = z.record(z.string(), z.number())
      const result = parseStructuredOutput(schema, '{"a": 1, "b": 2, "c": 3}')
      expect(result).toEqual({ a: 1, b: 2, c: 3 })
    })

    it('validates records with complex values', () => {
      const schema = z.record(z.string(), z.object({ value: z.number(), label: z.string() }))
      const result = parseStructuredOutput(
        schema,
        '{"item1": {"value": 1, "label": "first"}, "item2": {"value": 2, "label": "second"}}'
      )
      expect(result.item1).toEqual({ value: 1, label: 'first' })
    })
  })

  describe('intersection types', () => {
    it('validates intersection of objects', () => {
      const A = z.object({ a: z.string() })
      const B = z.object({ b: z.number() })
      const schema = z.intersection(A, B)

      const result = parseStructuredOutput(schema, '{"a": "hello", "b": 42}')
      expect(result).toEqual({ a: 'hello', b: 42 })
    })
  })

  describe('brand types', () => {
    it('validates branded types', () => {
      const UserId = z.string().brand<'UserId'>()
      const result = parseStructuredOutput(UserId, '"user-123"')
      expect(result).toBe('user-123')
    })
  })

  describe('catch/transform/refine', () => {
    it('uses catch default on parse failure', () => {
      const schema = z.object({
        value: z.number().catch(0),
      })

      // Note: catch only works during parse, not validation
      // This tests that the schema itself works correctly
      const result = schema.parse({ value: 'invalid' })
      expect(result.value).toBe(0)
    })

    it('applies transform after validation', () => {
      const schema = z.object({
        date: z.string().transform((s) => new Date(s)),
      })

      const result = parseStructuredOutput(schema, '{"date": "2025-01-15T00:00:00Z"}')
      expect(result.date).toBeInstanceOf(Date)
    })

    it('validates with refine', () => {
      const schema = z.object({
        password: z.string().refine((p) => p.length >= 8, 'Password must be at least 8 characters'),
      })

      expect(parseStructuredOutput(schema, '{"password": "secure123"}')).toBeDefined()
      expect(() => parseStructuredOutput(schema, '{"password": "short"}')).toThrow(StructuredOutputError)
    })

    it('validates with superRefine', () => {
      const schema = z.object({
        password: z.string(),
        confirmPassword: z.string(),
      }).superRefine((data, ctx) => {
        if (data.password !== data.confirmPassword) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Passwords do not match',
            path: ['confirmPassword'],
          })
        }
      })

      expect(parseStructuredOutput(schema, '{"password": "test123", "confirmPassword": "test123"}')).toBeDefined()
      expect(() => parseStructuredOutput(schema, '{"password": "test123", "confirmPassword": "different"}')).toThrow()
    })
  })
})

// ============================================================================
// Schema Type Guards and Utilities
// ============================================================================

describe('Schema Type Guards', () => {
  it('identifies Zod schemas', () => {
    expect(isZodSchema(z.string())).toBe(true)
    expect(isZodSchema(z.object({ name: z.string() }))).toBe(true)
    expect(isZodSchema({ type: 'string' })).toBe(false)
    expect(isZodSchema(null)).toBe(false)
  })

  it('identifies JSON schemas', () => {
    expect(isJsonSchema({ type: 'string' })).toBe(true)
    expect(isJsonSchema({ type: 'object', properties: {} })).toBe(true)
    expect(isJsonSchema(z.string())).toBe(false)
    expect(isJsonSchema(null)).toBe(false)
  })
})

describe('Zod to JSON Schema Conversion', () => {
  it('converts simple types', () => {
    expect(zodToJsonSchema(z.string())).toEqual({ type: 'string' })
    expect(zodToJsonSchema(z.number())).toEqual({ type: 'number' })
    expect(zodToJsonSchema(z.boolean())).toEqual({ type: 'boolean' })
  })

  it('converts arrays', () => {
    const jsonSchema = zodToJsonSchema(z.array(z.string()))
    expect(jsonSchema.type).toBe('array')
    expect(jsonSchema.items).toEqual({ type: 'string' })
  })

  it('converts objects with required fields', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    })

    const jsonSchema = zodToJsonSchema(schema)
    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema.properties?.required).toEqual({ type: 'string' })
    expect(jsonSchema.required).toContain('required')
    expect(jsonSchema.required).not.toContain('optional')
  })

  it('includes descriptions', () => {
    const schema = z.string().describe('A user name')
    const jsonSchema = zodToJsonSchema(schema)
    expect(jsonSchema.description).toBe('A user name')
  })
})

// ============================================================================
// Input Validation Tests
// ============================================================================

describe('Input Validation', () => {
  it('validates and returns typed data', () => {
    const schema = z.object({ name: z.string(), age: z.number() })
    const result = validateInput(schema, { name: 'Alice', age: 30 })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Alice')
      expect(result.data.age).toBe(30)
    }
  })

  it('returns validation error with path', () => {
    const schema = z.object({
      user: z.object({
        email: z.string().email(),
      }),
    })

    const result = validateInput(schema, { user: { email: 'invalid' } })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.path).toContain('email')
    }
  })
})
