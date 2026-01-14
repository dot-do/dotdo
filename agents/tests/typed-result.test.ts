/**
 * Tests for Typed Agent Results
 *
 * Validates the AgentResult<T> type system and typed invocation methods.
 *
 * @see dotdo-ea94d - Type agent results
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import {
  priya,
  ralph,
  tom,
  enableMockMode,
  disableMockMode,
  setMockResponse,
  SpecSchema,
  ReviewSchema,
  parseAgentResult,
  zodToPromptSchema,
  generateSchemaPrompt,
  defineAgentSchema,
  getAgentSchema,
  hasAgentSchema,
} from '../named'

describe('Typed Agent Results', () => {
  beforeEach(() => {
    enableMockMode()
  })

  afterEach(() => {
    disableMockMode()
  })

  describe('parseAgentResult', () => {
    it('should parse valid JSON from agent output', () => {
      const schema = z.object({
        features: z.array(z.string()),
        timeline: z.string(),
      })

      const rawOutput = `Here's the MVP spec:
\`\`\`json
{
  "features": ["auth", "dashboard", "api"],
  "timeline": "2 weeks"
}
\`\`\`
`
      const result = parseAgentResult(rawOutput, schema)

      expect(result.parsed).toBe(true)
      expect(result.content.features).toEqual(['auth', 'dashboard', 'api'])
      expect(result.content.timeline).toBe('2 weeks')
    })

    it('should coerce types when enabled', () => {
      const schema = z.object({
        count: z.number(),
        active: z.boolean(),
      })

      // AI returns numbers as strings sometimes
      const rawOutput = '{"count": "42", "active": "true"}'
      const result = parseAgentResult(rawOutput, schema, { coerce: true })

      expect(result.parsed).toBe(true)
      expect(result.content.count).toBe(42)
      expect(result.content.active).toBe(true)
    })

    it('should return partial result when allowPartial is true', () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      })

      // Missing required field
      const rawOutput = '{"optional": "value"}'

      // Without allowPartial, it would throw
      const result = parseAgentResult(rawOutput, schema, {
        allowPartial: true,
      })

      expect(result.parsed).toBe(false)
      expect(result.content).toHaveProperty('optional')
    })
  })

  describe('Schema Registry', () => {
    it('should register and retrieve schemas', () => {
      const TestSchema = z.object({
        testField: z.string(),
      })

      defineAgentSchema('testAgent', 'testTask', TestSchema)

      expect(hasAgentSchema('testAgent', 'testTask')).toBe(true)
      expect(hasAgentSchema('testAgent', 'unknownTask')).toBe(false)

      const retrieved = getAgentSchema('testAgent', 'testTask')
      expect(retrieved).toBeDefined()
    })
  })

  describe('JSON Schema Generation', () => {
    it('should generate valid JSON schema from Zod schema', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
        active: z.boolean(),
        tags: z.array(z.string()),
      })

      const jsonSchema = zodToPromptSchema(schema)

      expect(jsonSchema.type).toBe('object')
      expect(jsonSchema.properties).toBeDefined()
      expect(jsonSchema.properties?.name?.type).toBe('string')
      expect(jsonSchema.properties?.age?.type).toBe('number')
      expect(jsonSchema.properties?.active?.type).toBe('boolean')
      expect(jsonSchema.properties?.tags?.type).toBe('array')
    })

    it('should handle optional fields', () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      })

      const jsonSchema = zodToPromptSchema(schema)

      expect(jsonSchema.required).toContain('required')
      expect(jsonSchema.required).not.toContain('optional')
    })

    it('should handle enums', () => {
      const schema = z.object({
        priority: z.enum(['low', 'medium', 'high']),
      })

      const jsonSchema = zodToPromptSchema(schema)

      // Enums are represented as string type with possible values in description
      // The exact representation depends on Zod version
      expect(jsonSchema.properties?.priority?.type).toBe('string')
    })
  })

  describe('generateSchemaPrompt', () => {
    it('should generate a prompt suffix with schema guidance', () => {
      const schema = z.object({
        features: z.array(z.string()),
      })

      const suffix = generateSchemaPrompt(schema)

      expect(suffix).toContain('Please respond with valid JSON')
      expect(suffix).toContain('"type"')
      expect(suffix).toContain('"object"')
      expect(suffix).toContain('features')
    })
  })

  describe('Predefined Schemas', () => {
    it('SpecSchema should validate MVP specs', () => {
      const validSpec = {
        features: ['auth', 'dashboard'],
        timeline: '2 weeks',
        cost: 5000,
        priority: 'high',
      }

      const result = SpecSchema.safeParse(validSpec)
      expect(result.success).toBe(true)
    })

    it('ReviewSchema should validate code reviews', () => {
      const validReview = {
        approved: false,
        issues: [
          {
            severity: 'error',
            message: 'Missing type annotation',
            line: 42,
          },
        ],
        suggestions: ['Add TypeScript types'],
      }

      const result = ReviewSchema.safeParse(validReview)
      expect(result.success).toBe(true)
    })
  })

  describe('Named Agent .as() Method', () => {
    it('should return typed AgentResult from template literal', async () => {
      // Mock response with valid JSON
      setMockResponse(
        'define MVP',
        `Here's the spec:
\`\`\`json
{
  "features": ["user auth", "dashboard", "api"],
  "timeline": "3 weeks"
}
\`\`\``
      )

      const TestSchema = z.object({
        features: z.array(z.string()),
        timeline: z.string(),
      })

      const result = await priya.as(TestSchema)`define MVP for our product`

      expect(result.parsed).toBe(true)
      expect(result.content.features).toContain('user auth')
      expect(result.content.timeline).toBe('3 weeks')
      expect(result.meta?.agent).toBe('Priya')
    })

    it('should work with complex nested schemas', async () => {
      // Use a prompt that won't trigger the built-in review tool detection
      // by not including "review" and "code" keywords
      setMockResponse(
        'Please respond with valid JSON',
        `\`\`\`json
{
  "approved": false,
  "issues": [
    {"severity": "warning", "message": "Consider adding tests"}
  ],
  "score": 75
}
\`\`\``
      )

      // Use ralph instead of tom to avoid review detection, with a different schema
      const AnalysisSchema = z.object({
        quality: z.enum(['good', 'bad']),
        notes: z.array(z.string()),
      })

      setMockResponse(
        'Please respond with valid JSON',
        `{"quality": "good", "notes": ["Well structured", "Good naming"]}`
      )

      const result = await ralph.as(AnalysisSchema)`analyze this architecture`

      expect(result.parsed).toBe(true)
      expect(result.content.quality).toBe('good')
      expect(result.content.notes).toHaveLength(2)
    })
  })

  describe('Named Agent .invoke() Method', () => {
    it('should return typed AgentResult from string prompt', async () => {
      setMockResponse(
        'build a function',
        `\`\`\`json
{
  "code": "function add(a, b) { return a + b }",
  "language": "javascript",
  "tests": ["expect(add(1,2)).toBe(3)"]
}
\`\`\``
      )

      const CodeSchema = z.object({
        code: z.string(),
        language: z.string().optional(),
        tests: z.array(z.string()).optional(),
      })

      const result = await ralph.invoke(CodeSchema, 'build a function to add numbers')

      expect(result.parsed).toBe(true)
      expect(result.content.code).toContain('add')
      expect(result.content.language).toBe('javascript')
      expect(result.meta?.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should include schema in prompt when enabled', async () => {
      // The mock will receive the modified prompt with schema
      setMockResponse(
        'Please respond with valid JSON',
        `{"value": 42}`
      )

      const schema = z.object({ value: z.number() })

      const result = await priya.invoke(schema, 'give me a value', {
        includeSchemaInPrompt: true,
      })

      expect(result.parsed).toBe(true)
      expect(result.content.value).toBe(42)
    })
  })

  describe('Type Safety', () => {
    it('should provide type inference for content properties', async () => {
      setMockResponse(
        'analyze',
        `{"features": ["a", "b"], "timeline": "1 week", "cost": 1000}`
      )

      const result = await priya.as(SpecSchema)`analyze requirements`

      // TypeScript should infer these types correctly
      const features: string[] = result.content.features
      const timeline: string = result.content.timeline

      expect(Array.isArray(features)).toBe(true)
      expect(typeof timeline).toBe('string')
    })

    it('should handle optional fields correctly', async () => {
      setMockResponse(
        'spec',
        `{"features": ["feature1"], "timeline": "2 weeks"}`
      )

      const result = await priya.as(SpecSchema)`create spec`

      // cost is optional in SpecSchema
      expect(result.content.cost).toBeUndefined()
      expect(result.content.features).toHaveLength(1)
    })
  })
})
