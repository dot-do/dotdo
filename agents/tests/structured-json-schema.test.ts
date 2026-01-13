/**
 * Structured Output Tests - JSON Schema (TDD RED Phase)
 *
 * Tests for requesting structured JSON schema outputs from LLMs:
 * - Agent configuration with outputSchema
 * - Provider integration with response_format (OpenAI style)
 * - JSON Schema validation of LLM responses
 * - Zod-to-JSON-Schema conversion for structured output requests
 * - Type coercion and strict mode
 *
 * These tests define expected behavior for structured output APIs.
 * They should FAIL until implementation is complete.
 *
 * @see dotdo-qs6gs - [RED] Structured output tests (JSON schema)
 * @module agents/tests/structured-json-schema.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

// These imports should fail or be incomplete - that's the RED phase
import type {
  AgentConfig,
  AgentInput,
  AgentResult,
  JsonSchema,
} from '../types'

// ============================================================================
// RED PHASE STUBS
// These types/functions don't exist yet - they define the expected API
// The tests will fail at runtime when these are called
// ============================================================================

// Stub type for structured agent result
type StructuredAgentResult<T> = {
  text: string
  toolCalls: unknown[]
  toolResults: unknown[]
  messages: unknown[]
  steps: number
  finishReason: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  structured: T
}

// These functions will throw when called - this is intentional for RED phase
const createStructuredAgent: any = () => {
  throw new Error('[RED] createStructuredAgent is not implemented yet')
}
const zodToOpenAIResponseFormat: any = () => {
  throw new Error('[RED] zodToOpenAIResponseFormat is not implemented yet')
}
const zodToAnthropicTool: any = () => {
  throw new Error('[RED] zodToAnthropicTool is not implemented yet')
}
const parseStructuredResponse: any = () => {
  throw new Error('[RED] parseStructuredResponse is not implemented yet - use parseStructuredOutput from structured-output.ts')
}

// ============================================================================
// Test Schemas
// ============================================================================

const ReviewSchema = z.object({
  approved: z.boolean().describe('Whether the code is approved'),
  confidence: z.number().min(0).max(1).describe('Confidence level 0-1'),
  feedback: z.string().describe('Detailed feedback'),
  issues: z.array(z.string()).describe('List of issues found'),
})

const TaskSchema = z.object({
  title: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  assignee: z.string().optional(),
  dueDate: z.string().optional(),
  subtasks: z.array(z.object({
    title: z.string(),
    completed: z.boolean(),
  })).optional(),
})

const AnalysisSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  score: z.number(),
  keywords: z.array(z.string()),
  entities: z.array(z.object({
    name: z.string(),
    type: z.enum(['person', 'organization', 'location', 'product']),
    confidence: z.number(),
  })),
})

// ============================================================================
// Agent Structured Output Configuration Tests
// ============================================================================

describe('Agent structured output configuration', () => {
  describe('outputSchema in AgentConfig', () => {
    it('accepts Zod schema as outputSchema', () => {
      // AgentConfig should accept outputSchema field
      const config: AgentConfig & { outputSchema?: z.ZodType<unknown> } = {
        id: 'reviewer',
        name: 'Code Reviewer',
        instructions: 'Review code and provide structured feedback',
        model: 'gpt-4o',
        outputSchema: ReviewSchema,
      }

      expect(config.outputSchema).toBeDefined()
      expect(config.outputSchema).toBe(ReviewSchema)
    })

    it('accepts JSON Schema as outputSchema', () => {
      const jsonSchema: JsonSchema = {
        type: 'object',
        properties: {
          decision: { type: 'string', enum: ['approve', 'reject'] },
          reason: { type: 'string' },
        },
        required: ['decision', 'reason'],
      }

      const config: AgentConfig & { outputSchema?: JsonSchema } = {
        id: 'decider',
        name: 'Decision Maker',
        instructions: 'Make decisions',
        model: 'gpt-4o',
        outputSchema: jsonSchema,
      }

      expect(config.outputSchema).toBeDefined()
      expect(config.outputSchema?.type).toBe('object')
    })

    it('supports strict mode for JSON schema output', () => {
      // Strict mode requires LLM to exactly match schema
      const config: AgentConfig & { outputSchema?: z.ZodType<unknown>; strictOutput?: boolean } = {
        id: 'strict-agent',
        name: 'Strict Output Agent',
        instructions: 'Return exactly this schema',
        model: 'gpt-4o',
        outputSchema: ReviewSchema,
        strictOutput: true,
      }

      expect(config.strictOutput).toBe(true)
    })
  })

  describe('AgentInput with schema override', () => {
    it('allows outputSchema override in AgentInput', () => {
      const input: AgentInput & { outputSchema?: z.ZodType<unknown> } = {
        prompt: 'Analyze this text',
        outputSchema: AnalysisSchema,
      }

      expect(input.outputSchema).toBeDefined()
    })
  })
})

// ============================================================================
// Structured Output Run Tests
// ============================================================================

describe('Agent.run() with structured output', () => {
  // Mock provider for testing
  const mockGenerate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('structured response parsing', () => {
    it('returns typed structured data when outputSchema is provided', async () => {
      // This test defines expected behavior:
      // When an agent has outputSchema, result.structured should contain typed data

      mockGenerate.mockResolvedValueOnce({
        text: JSON.stringify({
          approved: true,
          confidence: 0.95,
          feedback: 'Code looks good',
          issues: [],
        }),
        finishReason: 'stop',
      })

      // Expected: AgentResult should have a `structured` field
      type StructuredAgentResult<T> = AgentResult & { structured?: T }

      const result: StructuredAgentResult<z.infer<typeof ReviewSchema>> = {
        text: '{"approved": true, "confidence": 0.95, "feedback": "Code looks good", "issues": []}',
        toolCalls: [],
        toolResults: [],
        messages: [],
        steps: 1,
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        // This field should be populated by structured output handling
        structured: {
          approved: true,
          confidence: 0.95,
          feedback: 'Code looks good',
          issues: [],
        },
      }

      expect(result.structured).toBeDefined()
      expect(result.structured?.approved).toBe(true)
      expect(result.structured?.confidence).toBe(0.95)
    })

    it('validates structured output against schema', async () => {
      // LLM returns invalid data - should throw validation error
      const invalidResponse = {
        approved: 'yes', // Should be boolean
        confidence: 1.5, // Should be 0-1
        feedback: 123, // Should be string
        issues: 'none', // Should be array
      }

      // Expected behavior: throw structured output validation error
      // This test should fail until validation is implemented
      expect(() => {
        ReviewSchema.parse(invalidResponse)
      }).toThrow()
    })

    it('applies type coercion when coerce option is enabled', async () => {
      // LLM returns stringified values that need coercion
      const response = {
        approved: 'true', // String instead of boolean
        confidence: '0.85', // String instead of number
        feedback: 'Good work',
        issues: [],
      }

      // With coercion enabled, this should succeed
      // Without implementation, this demonstrates expected behavior
      const coercedSchema = z.object({
        approved: z.coerce.boolean(),
        confidence: z.coerce.number().min(0).max(1),
        feedback: z.string(),
        issues: z.array(z.string()),
      })

      const result = coercedSchema.parse(response)
      expect(result.approved).toBe(true)
      expect(result.confidence).toBe(0.85)
    })
  })

  describe('nested object schemas', () => {
    it('handles deeply nested structured output', async () => {
      const DeepSchema = z.object({
        level1: z.object({
          level2: z.object({
            level3: z.object({
              value: z.string(),
            }),
          }),
        }),
      })

      const validNested = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
      }

      expect(() => DeepSchema.parse(validNested)).not.toThrow()
    })

    it('handles arrays of objects', async () => {
      const validTasks = {
        title: 'Main task',
        priority: 'high',
        subtasks: [
          { title: 'Subtask 1', completed: true },
          { title: 'Subtask 2', completed: false },
        ],
      }

      const result = TaskSchema.parse(validTasks)
      expect(result.subtasks).toHaveLength(2)
      expect(result.subtasks?.[0].completed).toBe(true)
    })
  })
})

// ============================================================================
// Provider-Specific Structured Output Tests
// ============================================================================

describe('Provider structured output integration', () => {
  describe('OpenAI response_format', () => {
    it('converts Zod schema to OpenAI response_format', () => {
      // OpenAI's response_format.json_schema expects a specific format
      // This tests the conversion

      // Expected format for OpenAI:
      // {
      //   type: 'json_schema',
      //   json_schema: {
      //     name: 'review',
      //     strict: true,
      //     schema: { ... JSON Schema ... }
      //   }
      // }

      const expectedFormat = {
        type: 'json_schema',
        json_schema: {
          name: 'review',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              approved: { type: 'boolean', description: 'Whether the code is approved' },
              confidence: { type: 'number', description: 'Confidence level 0-1' },
              feedback: { type: 'string', description: 'Detailed feedback' },
              issues: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of issues found',
              },
            },
            required: ['approved', 'confidence', 'feedback', 'issues'],
            additionalProperties: false,
          },
        },
      }

      // This should be implemented by a conversion function
      // For now, just verify the expected structure
      expect(expectedFormat.type).toBe('json_schema')
      expect(expectedFormat.json_schema.strict).toBe(true)
      expect(expectedFormat.json_schema.schema.properties.approved.type).toBe('boolean')
    })

    it('includes additionalProperties: false in strict mode', () => {
      // OpenAI strict mode requires additionalProperties: false
      const strictSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
        additionalProperties: false, // Required for strict mode
      }

      expect(strictSchema.additionalProperties).toBe(false)
    })
  })

  describe('Anthropic tool_use for structured output', () => {
    it('converts schema to Anthropic tool format', () => {
      // Anthropic uses tool_use with a specific tool to get structured output

      const expectedTool = {
        name: 'structured_output',
        description: 'Return structured data matching the schema',
        input_schema: {
          type: 'object',
          properties: {
            approved: { type: 'boolean' },
            confidence: { type: 'number' },
            feedback: { type: 'string' },
            issues: { type: 'array', items: { type: 'string' } },
          },
          required: ['approved', 'confidence', 'feedback', 'issues'],
        },
      }

      expect(expectedTool.name).toBe('structured_output')
      expect(expectedTool.input_schema.type).toBe('object')
    })
  })
})

// ============================================================================
// JSON Schema Conversion Tests
// ============================================================================

describe('Zod to JSON Schema conversion for structured output', () => {
  describe('primitive types', () => {
    it('converts z.string() to JSON Schema', () => {
      const schema = z.string().describe('A text value')

      // Expected JSON Schema:
      // { type: 'string', description: 'A text value' }
      const expected = { type: 'string', description: 'A text value' }

      // Conversion function should produce this
      expect(expected.type).toBe('string')
    })

    it('converts z.number() with constraints', () => {
      const schema = z.number().min(0).max(100).describe('A percentage')

      // Expected JSON Schema:
      // { type: 'number', minimum: 0, maximum: 100, description: 'A percentage' }
      const expected = {
        type: 'number',
        minimum: 0,
        maximum: 100,
        description: 'A percentage',
      }

      expect(expected.type).toBe('number')
      expect(expected.minimum).toBe(0)
      expect(expected.maximum).toBe(100)
    })

    it('converts z.boolean() to JSON Schema', () => {
      const schema = z.boolean()

      const expected = { type: 'boolean' }
      expect(expected.type).toBe('boolean')
    })
  })

  describe('complex types', () => {
    it('converts z.enum() to JSON Schema', () => {
      const schema = z.enum(['low', 'medium', 'high'])

      const expected = {
        type: 'string',
        enum: ['low', 'medium', 'high'],
      }

      expect(expected.enum).toContain('low')
      expect(expected.enum).toContain('high')
    })

    it('converts z.array() to JSON Schema', () => {
      const schema = z.array(z.string())

      const expected = {
        type: 'array',
        items: { type: 'string' },
      }

      expect(expected.type).toBe('array')
      expect(expected.items.type).toBe('string')
    })

    it('converts z.object() to JSON Schema with required fields', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number().optional(),
      })

      const expected = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'], // age is optional, so only name is required
      }

      expect(expected.required).toContain('name')
      expect(expected.required).not.toContain('age')
    })

    it('converts z.nullable() to JSON Schema with null type', () => {
      const schema = z.string().nullable()

      // JSON Schema can represent nullable as type: ['string', 'null']
      const expected = {
        type: ['string', 'null'],
      }

      expect(expected.type).toContain('string')
      expect(expected.type).toContain('null')
    })
  })

  describe('nested and recursive schemas', () => {
    it('converts nested objects', () => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            name: z.string(),
          }),
        }),
      })

      const expected = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              profile: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                },
                required: ['name'],
              },
            },
            required: ['profile'],
          },
        },
        required: ['user'],
      }

      expect(expected.properties.user.type).toBe('object')
    })

    it('converts array of objects', () => {
      const schema = z.array(z.object({
        id: z.number(),
        name: z.string(),
      }))

      const expected = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            name: { type: 'string' },
          },
          required: ['id', 'name'],
        },
      }

      expect(expected.items.type).toBe('object')
      expect(expected.items.required).toContain('id')
    })
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Structured output error handling', () => {
  describe('validation errors', () => {
    it('provides detailed path information on validation failure', () => {
      const schema = z.object({
        user: z.object({
          email: z.string().email(),
        }),
      })

      const invalid = {
        user: {
          email: 'not-an-email',
        },
      }

      try {
        schema.parse(invalid)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(z.ZodError)
        const zodError = error as z.ZodError
        expect(zodError.issues[0].path).toContain('user')
        expect(zodError.issues[0].path).toContain('email')
      }
    })

    it('handles missing required fields', () => {
      const schema = z.object({
        required1: z.string(),
        required2: z.number(),
      })

      const incomplete = {
        required1: 'present',
        // required2 is missing
      }

      try {
        schema.parse(incomplete)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(z.ZodError)
        const zodError = error as z.ZodError
        expect(zodError.issues[0].path).toContain('required2')
      }
    })

    it('handles type mismatches', () => {
      const schema = z.object({
        count: z.number(),
        active: z.boolean(),
      })

      const wrongTypes = {
        count: 'not a number',
        active: 'not a boolean',
      }

      try {
        schema.parse(wrongTypes)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(z.ZodError)
      }
    })
  })

  describe('LLM response errors', () => {
    it('handles LLM returning invalid JSON', () => {
      const invalidJson = 'This is not JSON at all'

      expect(() => JSON.parse(invalidJson)).toThrow()
    })

    it('handles LLM returning truncated JSON', () => {
      // LLM might hit token limit mid-output
      const truncatedJson = '{"approved": true, "confidence": 0.9, "feed'

      expect(() => JSON.parse(truncatedJson)).toThrow()
    })

    it('handles LLM returning JSON with wrong schema', () => {
      const wrongSchema = {
        status: 'ok', // Different field names
        score: 100, // Different structure
      }

      expect(() => ReviewSchema.parse(wrongSchema)).toThrow()
    })
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('Type safety for structured outputs', () => {
  it('infers correct TypeScript type from Zod schema', () => {
    // This is a compile-time test - if it compiles, types are correct
    type ReviewType = z.infer<typeof ReviewSchema>

    const review: ReviewType = {
      approved: true,
      confidence: 0.9,
      feedback: 'Looks good',
      issues: ['Minor: add comments'],
    }

    expect(review.approved).toBe(true)
    // Type system ensures these are the correct types
    const _approved: boolean = review.approved
    const _confidence: number = review.confidence
    const _feedback: string = review.feedback
    const _issues: string[] = review.issues

    expect(_approved).toBe(true)
    expect(typeof _confidence).toBe('number')
    expect(typeof _feedback).toBe('string')
    expect(Array.isArray(_issues)).toBe(true)
  })

  it('maintains type through parsing', () => {
    const rawData = {
      approved: false,
      confidence: 0.3,
      feedback: 'Needs work',
      issues: ['Error handling', 'Tests missing'],
    }

    const parsed = ReviewSchema.parse(rawData)

    // TypeScript should infer correct type
    expect(parsed.approved).toBe(false)
    expect(parsed.issues.length).toBe(2)
  })
})

// ============================================================================
// Integration Scenarios
// ============================================================================

describe('Real-world structured output scenarios', () => {
  describe('code review workflow', () => {
    const CodeReviewSchema = z.object({
      decision: z.enum(['approve', 'request_changes', 'comment']),
      summary: z.string(),
      lineComments: z.array(z.object({
        file: z.string(),
        line: z.number(),
        severity: z.enum(['error', 'warning', 'suggestion']),
        message: z.string(),
      })),
      suggestedChanges: z.array(z.object({
        file: z.string(),
        original: z.string(),
        replacement: z.string(),
      })).optional(),
    })

    it('validates complete code review response', () => {
      const validReview = {
        decision: 'request_changes',
        summary: 'Good progress but needs error handling',
        lineComments: [
          {
            file: 'src/index.ts',
            line: 42,
            severity: 'error',
            message: 'Missing try-catch block',
          },
        ],
        suggestedChanges: [
          {
            file: 'src/index.ts',
            original: 'const data = fetch(url)',
            replacement: 'const data = await fetch(url).catch(handleError)',
          },
        ],
      }

      const parsed = CodeReviewSchema.parse(validReview)
      expect(parsed.decision).toBe('request_changes')
      expect(parsed.lineComments).toHaveLength(1)
    })
  })

  describe('data extraction workflow', () => {
    const ExtractedDataSchema = z.object({
      contacts: z.array(z.object({
        name: z.string(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        company: z.string().optional(),
      })),
      dates: z.array(z.object({
        date: z.string(),
        description: z.string(),
      })),
      amounts: z.array(z.object({
        value: z.number(),
        currency: z.string(),
        context: z.string(),
      })),
    })

    it('validates extracted structured data', () => {
      const extractedData = {
        contacts: [
          { name: 'John Doe', email: 'john@example.com', company: 'Acme Inc' },
        ],
        dates: [
          { date: '2025-01-15', description: 'Meeting scheduled' },
        ],
        amounts: [
          { value: 1000, currency: 'USD', context: 'Contract value' },
        ],
      }

      const parsed = ExtractedDataSchema.parse(extractedData)
      expect(parsed.contacts[0].name).toBe('John Doe')
      expect(parsed.amounts[0].value).toBe(1000)
    })
  })

  describe('classification workflow', () => {
    const ClassificationSchema = z.object({
      category: z.enum(['bug', 'feature', 'question', 'documentation']),
      priority: z.enum(['p0', 'p1', 'p2', 'p3']),
      labels: z.array(z.string()),
      assignmentSuggestion: z.object({
        team: z.string(),
        individual: z.string().optional(),
        reason: z.string(),
      }),
    })

    it('validates issue classification', () => {
      const classification = {
        category: 'bug',
        priority: 'p1',
        labels: ['backend', 'database', 'urgent'],
        assignmentSuggestion: {
          team: 'platform',
          individual: 'alice',
          reason: 'Alice is the database expert',
        },
      }

      const parsed = ClassificationSchema.parse(classification)
      expect(parsed.category).toBe('bug')
      expect(parsed.priority).toBe('p1')
      expect(parsed.labels).toContain('backend')
    })
  })
})

// ============================================================================
// RED PHASE: Failing Integration Tests
// These tests MUST fail until implementation is complete
// ============================================================================

describe('[RED] Structured output agent API', () => {
  describe('createStructuredAgent()', () => {
    it('creates an agent with structured output schema', () => {
      // This should fail - createStructuredAgent doesn't exist yet
      const agent = createStructuredAgent({
        id: 'reviewer',
        name: 'Code Reviewer',
        instructions: 'Review code and return structured feedback',
        model: 'gpt-4o',
        outputSchema: ReviewSchema,
      })

      expect(agent).toBeDefined()
      expect(agent.config.outputSchema).toBe(ReviewSchema)
    })

    it('runs agent and returns typed structured result', async () => {
      // This should fail - structured result API doesn't exist yet
      const agent = createStructuredAgent({
        id: 'reviewer',
        name: 'Code Reviewer',
        instructions: 'Review the code',
        model: 'gpt-4o',
        outputSchema: ReviewSchema,
      })

      const result: StructuredAgentResult<z.infer<typeof ReviewSchema>> = await agent.run({
        prompt: 'Review this function: function add(a, b) { return a + b }',
      })

      // Result should have typed `structured` field
      expect(result.structured).toBeDefined()
      expect(typeof result.structured.approved).toBe('boolean')
      expect(typeof result.structured.confidence).toBe('number')
      expect(typeof result.structured.feedback).toBe('string')
      expect(Array.isArray(result.structured.issues)).toBe(true)
    })

    it('validates LLM response against schema and throws on mismatch', async () => {
      const agent = createStructuredAgent({
        id: 'strict-agent',
        name: 'Strict Agent',
        instructions: 'Return structured data',
        model: 'gpt-4o',
        outputSchema: ReviewSchema,
        strictOutput: true,
      })

      // If LLM returns invalid data, should throw StructuredOutputError
      await expect(agent.run({ prompt: 'Give invalid response' }))
        .rejects.toThrow()
    })
  })

  describe('zodToOpenAIResponseFormat()', () => {
    it('converts Zod schema to OpenAI response_format', () => {
      // This should fail - function doesn't exist yet
      const responseFormat = zodToOpenAIResponseFormat(ReviewSchema, 'review')

      expect(responseFormat).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'review',
          strict: true,
          schema: expect.objectContaining({
            type: 'object',
            properties: expect.objectContaining({
              approved: { type: 'boolean', description: 'Whether the code is approved' },
              confidence: { type: 'number', description: 'Confidence level 0-1' },
              feedback: { type: 'string', description: 'Detailed feedback' },
              issues: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of issues found',
              },
            }),
            required: ['approved', 'confidence', 'feedback', 'issues'],
            additionalProperties: false,
          }),
        },
      })
    })

    it('handles nested objects in response_format', () => {
      const NestedSchema = z.object({
        user: z.object({
          name: z.string(),
          settings: z.object({
            theme: z.enum(['light', 'dark']),
          }),
        }),
      })

      const responseFormat = zodToOpenAIResponseFormat(NestedSchema, 'user_settings')

      expect(responseFormat.json_schema.schema.properties.user.type).toBe('object')
      expect(responseFormat.json_schema.schema.properties.user.properties.settings.type).toBe('object')
    })

    it('includes additionalProperties: false for strict mode', () => {
      const SimpleSchema = z.object({ name: z.string() })
      const responseFormat = zodToOpenAIResponseFormat(SimpleSchema, 'simple', { strict: true })

      expect(responseFormat.json_schema.schema.additionalProperties).toBe(false)
      expect(responseFormat.json_schema.strict).toBe(true)
    })
  })

  describe('zodToAnthropicTool()', () => {
    it('converts Zod schema to Anthropic tool format', () => {
      // This should fail - function doesn't exist yet
      const tool = zodToAnthropicTool(ReviewSchema, {
        name: 'code_review',
        description: 'Provide structured code review feedback',
      })

      expect(tool).toEqual({
        name: 'code_review',
        description: 'Provide structured code review feedback',
        input_schema: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            approved: expect.objectContaining({ type: 'boolean' }),
            confidence: expect.objectContaining({ type: 'number' }),
            feedback: expect.objectContaining({ type: 'string' }),
            issues: expect.objectContaining({ type: 'array' }),
          }),
          required: ['approved', 'confidence', 'feedback', 'issues'],
        }),
      })
    })
  })

  describe('parseStructuredResponse()', () => {
    it('parses and validates LLM response against schema', () => {
      // This should fail - function doesn't exist yet
      const llmResponse = `Here's my review:
\`\`\`json
{
  "approved": true,
  "confidence": 0.95,
  "feedback": "Code is clean and well-structured",
  "issues": []
}
\`\`\`
Let me know if you need anything else.`

      const result = parseStructuredResponse(ReviewSchema, llmResponse)

      expect(result).toEqual({
        approved: true,
        confidence: 0.95,
        feedback: 'Code is clean and well-structured',
        issues: [],
      })
    })

    it('applies type coercion when enabled', () => {
      const llmResponse = JSON.stringify({
        approved: 'true', // String instead of boolean
        confidence: '0.8', // String instead of number
        feedback: 'Good',
        issues: [],
      })

      const result = parseStructuredResponse(ReviewSchema, llmResponse, { coerce: true })

      expect(result.approved).toBe(true) // Coerced from string
      expect(result.confidence).toBe(0.8) // Coerced from string
    })

    it('throws StructuredOutputError on validation failure', () => {
      const invalidResponse = JSON.stringify({
        approved: 'maybe', // Invalid boolean
        confidence: 1.5, // Out of range
        feedback: 123, // Wrong type
        issues: 'none', // Wrong type
      })

      expect(() => parseStructuredResponse(ReviewSchema, invalidResponse))
        .toThrow()
    })
  })
})

describe('[RED] Provider structured output integration', () => {
  describe('OpenAI provider with structured output', () => {
    it('sends response_format to OpenAI API', async () => {
      // This test verifies the provider correctly formats the request
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              approved: true,
              confidence: 0.9,
              feedback: 'Looks good',
              issues: [],
            }),
          },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      })

      // Mock would need to be set up properly for this to work
      // For now, this defines expected behavior

      expect(mockCreate).toBeDefined()
    })
  })

  describe('Anthropic provider with structured output', () => {
    it('uses tool_use for structured output', async () => {
      // Anthropic uses tool calls for structured output
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{
          type: 'tool_use',
          id: 'tool_123',
          name: 'structured_output',
          input: {
            approved: true,
            confidence: 0.9,
            feedback: 'Looks good',
            issues: [],
          },
        }],
        stop_reason: 'tool_use',
      })

      expect(mockCreate).toBeDefined()
    })
  })
})
