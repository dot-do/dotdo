/**
 * Tool.ts Unit Tests (RED Phase)
 *
 * Tests for:
 * - tool() - Creates ToolDefinition from options
 * - zodToJsonSchema() - Converts Zod schemas to JSON Schema
 * - validateInput() - Validates input against schema
 * - isZodSchema() - Type guard for Zod schemas
 * - createDelegationTool() - Creates delegation tool
 * - createHandoffTool() - Creates handoff tool
 * - createFinishTool() - Creates finish tool
 * - createEscalationTool() - Creates escalation tool
 */

import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import {
  tool,
  zodToJsonSchema,
  validateInput,
  isZodSchema,
  createDelegationTool,
  createHandoffTool,
  createFinishTool,
  createEscalationTool,
} from './Tool'

// ============================================================================
// tool() Tests
// ============================================================================

describe('tool()', () => {
  it('creates ToolDefinition with all required fields', () => {
    const weatherTool = tool({
      name: 'getWeather',
      description: 'Get weather for a location',
      inputSchema: z.object({
        location: z.string(),
      }),
      execute: async ({ location }) => ({ temp: 22, location }),
    })

    expect(weatherTool.name).toBe('getWeather')
    expect(weatherTool.description).toBe('Get weather for a location')
    expect(weatherTool.inputSchema).toBeDefined()
    expect(weatherTool.execute).toBeInstanceOf(Function)
  })

  it('infers input type from Zod schema', async () => {
    const addTool = tool({
      name: 'add',
      description: 'Add two numbers',
      inputSchema: z.object({
        a: z.number(),
        b: z.number(),
      }),
      execute: async ({ a, b }) => a + b,
    })

    const result = await addTool.execute({ a: 1, b: 2 }, { agentId: 'test' })
    expect(result).toBe(3)
  })

  it('handles optional outputSchema', () => {
    const toolWithOutput = tool({
      name: 'withOutput',
      description: 'Tool with output schema',
      inputSchema: z.object({ input: z.string() }),
      outputSchema: z.object({ result: z.string() }),
      execute: async ({ input }) => ({ result: input.toUpperCase() }),
    })

    expect(toolWithOutput.outputSchema).toBeDefined()

    const toolWithoutOutput = tool({
      name: 'withoutOutput',
      description: 'Tool without output schema',
      inputSchema: z.object({ input: z.string() }),
      execute: async ({ input }) => input.toUpperCase(),
    })

    expect(toolWithoutOutput.outputSchema).toBeUndefined()
  })

  it('passes through permission and interruptible', () => {
    const sensitiveToolWithPermission = tool({
      name: 'sensitiveAction',
      description: 'Requires confirmation',
      inputSchema: z.object({}),
      execute: async () => 'done',
      permission: 'confirm',
      interruptible: true,
    })

    expect(sensitiveToolWithPermission.permission).toBe('confirm')
    expect(sensitiveToolWithPermission.interruptible).toBe(true)

    const autoTool = tool({
      name: 'autoAction',
      description: 'Auto permission',
      inputSchema: z.object({}),
      execute: async () => 'done',
      permission: 'auto',
      interruptible: false,
    })

    expect(autoTool.permission).toBe('auto')
    expect(autoTool.interruptible).toBe(false)
  })

  it('preserves execute function context', async () => {
    const contextTool = tool({
      name: 'contextTool',
      description: 'Uses context',
      inputSchema: z.object({ value: z.string() }),
      execute: async (input, context) => {
        return { agentId: context.agentId, value: input.value }
      },
    })

    const result = await contextTool.execute({ value: 'test' }, { agentId: 'agent-1' })
    expect(result.agentId).toBe('agent-1')
    expect(result.value).toBe('test')
  })
})

// ============================================================================
// zodToJsonSchema() Tests
// ============================================================================

describe('zodToJsonSchema()', () => {
  it('converts ZodString to {type: "string"}', () => {
    const schema = z.string()
    const jsonSchema = zodToJsonSchema(schema)
    expect(jsonSchema.type).toBe('string')
  })

  it('converts ZodNumber to {type: "number"}', () => {
    const schema = z.number()
    const jsonSchema = zodToJsonSchema(schema)
    expect(jsonSchema.type).toBe('number')
  })

  it('converts ZodBoolean to {type: "boolean"}', () => {
    const schema = z.boolean()
    const jsonSchema = zodToJsonSchema(schema)
    expect(jsonSchema.type).toBe('boolean')
  })

  it('converts ZodArray to {type: "array", items: ...}', () => {
    const schema = z.array(z.string())
    const jsonSchema = zodToJsonSchema(schema)
    expect(jsonSchema.type).toBe('array')
    expect(jsonSchema.items).toEqual({ type: 'string' })
  })

  it('converts ZodArray of objects', () => {
    const schema = z.array(z.object({ id: z.number() }))
    const jsonSchema = zodToJsonSchema(schema)
    expect(jsonSchema.type).toBe('array')
    expect(jsonSchema.items).toEqual({
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    })
  })

  it('converts ZodObject with required fields', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    })
    const jsonSchema = zodToJsonSchema(schema)

    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema.properties).toEqual({
      name: { type: 'string' },
      age: { type: 'number' },
    })
    expect(jsonSchema.required).toEqual(['name', 'age'])
  })

  it('handles ZodOptional by excluding from required', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    })
    const jsonSchema = zodToJsonSchema(schema)

    expect(jsonSchema.required).toEqual(['required'])
    expect(jsonSchema.properties!.optional).toEqual({ type: 'string' })
  })

  it('handles ZodDefault with default value', () => {
    const schema = z.object({
      count: z.number().default(0),
      name: z.string().default('unnamed'),
    })
    const jsonSchema = zodToJsonSchema(schema)

    // Default fields should not be in required
    expect(jsonSchema.required).toBeUndefined()
    // Default values should be captured
    expect(jsonSchema.properties!.count.default).toBe(0)
    expect(jsonSchema.properties!.name.default).toBe('unnamed')
  })

  it('converts ZodEnum to enum array', () => {
    const schema = z.enum(['red', 'green', 'blue'])
    const jsonSchema = zodToJsonSchema(schema)

    expect(jsonSchema.type).toBe('string')
    expect(jsonSchema.enum).toEqual(['red', 'green', 'blue'])
  })

  it('preserves .describe() as description', () => {
    const schema = z.object({
      location: z.string().describe('City name or coordinates'),
      unit: z.enum(['celsius', 'fahrenheit']).describe('Temperature unit'),
    })
    const jsonSchema = zodToJsonSchema(schema)

    expect(jsonSchema.properties!.location.description).toBe('City name or coordinates')
    expect(jsonSchema.properties!.unit.description).toBe('Temperature unit')
  })

  it('handles nested objects', () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        address: z.object({
          city: z.string(),
          zip: z.string(),
        }),
      }),
    })
    const jsonSchema = zodToJsonSchema(schema)

    expect(jsonSchema.properties!.user.type).toBe('object')
    expect(jsonSchema.properties!.user.properties!.address.type).toBe('object')
    expect(jsonSchema.properties!.user.properties!.address.properties!.city).toEqual({ type: 'string' })
  })

  it('handles ZodNullable', () => {
    const schema = z.object({
      name: z.string().nullable(),
    })
    const jsonSchema = zodToJsonSchema(schema)

    // Nullable should unwrap to the inner type
    expect(jsonSchema.properties!.name.type).toBe('string')
  })

  it('handles empty object', () => {
    const schema = z.object({})
    const jsonSchema = zodToJsonSchema(schema)

    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema.properties).toEqual({})
    expect(jsonSchema.required).toBeUndefined()
  })

  it('handles complex mixed schema', () => {
    const schema = z.object({
      id: z.number(),
      name: z.string().describe('User name'),
      email: z.string().optional(),
      role: z.enum(['admin', 'user']).default('user'),
      tags: z.array(z.string()),
      metadata: z.object({
        createdAt: z.string(),
        updatedAt: z.string().optional(),
      }),
    })
    const jsonSchema = zodToJsonSchema(schema)

    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema.required).toContain('id')
    expect(jsonSchema.required).toContain('name')
    expect(jsonSchema.required).toContain('tags')
    expect(jsonSchema.required).toContain('metadata')
    expect(jsonSchema.required).not.toContain('email')
    expect(jsonSchema.required).not.toContain('role')
  })
})

// ============================================================================
// validateInput() Tests
// ============================================================================

describe('validateInput()', () => {
  it('returns {success: true, data} for valid input', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    })

    const result = validateInput(schema, { name: 'Alice', age: 30 })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ name: 'Alice', age: 30 })
    }
  })

  it('returns {success: false, error} for invalid input', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    })

    const result = validateInput(schema, { name: 'Alice', age: 'not a number' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toBeTruthy()
    }
  })

  it('returns {success: false, error} for missing required fields', () => {
    const schema = z.object({
      required: z.string(),
    })

    const result = validateInput(schema, {})

    expect(result.success).toBe(false)
  })

  it('applies defaults for ZodDefault', () => {
    const schema = z.object({
      count: z.number().default(0),
    })

    const result = validateInput(schema, {})

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.count).toBe(0)
    }
  })

  it('works with JSON Schema (passthrough)', () => {
    const jsonSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    }

    // JSON Schema should pass through without validation
    const result = validateInput(jsonSchema as any, { name: 'test', extra: 'field' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ name: 'test', extra: 'field' })
    }
  })

  it('handles nested validation errors', () => {
    const schema = z.object({
      user: z.object({
        email: z.string().email(),
      }),
    })

    const result = validateInput(schema, { user: { email: 'not-an-email' } })

    expect(result.success).toBe(false)
  })

  it('handles array validation', () => {
    const schema = z.object({
      items: z.array(z.number()),
    })

    const validResult = validateInput(schema, { items: [1, 2, 3] })
    expect(validResult.success).toBe(true)

    const invalidResult = validateInput(schema, { items: [1, 'two', 3] })
    expect(invalidResult.success).toBe(false)
  })
})

// ============================================================================
// isZodSchema() Tests
// ============================================================================

describe('isZodSchema()', () => {
  it('returns true for Zod string schema', () => {
    expect(isZodSchema(z.string())).toBe(true)
  })

  it('returns true for Zod object schema', () => {
    expect(isZodSchema(z.object({ name: z.string() }))).toBe(true)
  })

  it('returns true for Zod array schema', () => {
    expect(isZodSchema(z.array(z.number()))).toBe(true)
  })

  it('returns false for plain object (JSON Schema)', () => {
    const jsonSchema = { type: 'string' }
    expect(isZodSchema(jsonSchema)).toBe(false)
  })

  it('returns false for null', () => {
    expect(isZodSchema(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isZodSchema(undefined)).toBe(false)
  })

  it('returns false for primitives', () => {
    expect(isZodSchema('string')).toBe(false)
    expect(isZodSchema(123)).toBe(false)
    expect(isZodSchema(true)).toBe(false)
  })

  it('returns false for objects without _def', () => {
    expect(isZodSchema({ parse: () => {} })).toBe(false)
  })

  it('returns false for objects without parse', () => {
    expect(isZodSchema({ _def: {} })).toBe(false)
  })
})

// ============================================================================
// createDelegationTool() Tests
// ============================================================================

describe('createDelegationTool()', () => {
  it('creates tool with correct name and description', () => {
    const spawnFn = vi.fn()
    const tool = createDelegationTool(spawnFn)

    expect(tool.name).toBe('delegate')
    expect(tool.description).toContain('subagent')
  })

  it('calls spawn function with task and agentId', async () => {
    const spawnFn = vi.fn().mockResolvedValue('task completed')
    const delegateTool = createDelegationTool(spawnFn)

    const result = await delegateTool.execute(
      { task: 'Do something', agentId: 'worker-1' },
      { agentId: 'main' }
    )

    expect(spawnFn).toHaveBeenCalledWith('Do something', 'worker-1')
    expect(result).toEqual({ result: 'task completed' })
  })

  it('works without agentId', async () => {
    const spawnFn = vi.fn().mockResolvedValue('done')
    const delegateTool = createDelegationTool(spawnFn)

    await delegateTool.execute({ task: 'Do task' }, { agentId: 'main' })

    expect(spawnFn).toHaveBeenCalledWith('Do task', undefined)
  })
})

// ============================================================================
// createHandoffTool() Tests
// ============================================================================

describe('createHandoffTool()', () => {
  const agents = [
    { id: 'support', name: 'Support Agent', description: 'Handles support requests' },
    { id: 'sales', name: 'Sales Agent', description: 'Handles sales inquiries' },
  ]

  it('creates tool with agent descriptions in description', () => {
    const handoffFn = vi.fn()
    const handoffTool = createHandoffTool(agents, handoffFn)

    expect(handoffTool.name).toBe('handoff')
    expect(handoffTool.description).toContain('support')
    expect(handoffTool.description).toContain('sales')
    expect(handoffTool.description).toContain('Support Agent')
    expect(handoffTool.description).toContain('Sales Agent')
  })

  it('calls handoff function with agentId and reason', async () => {
    const handoffFn = vi.fn().mockResolvedValue(undefined)
    const handoffTool = createHandoffTool(agents, handoffFn)

    const result = await handoffTool.execute(
      { agentId: 'support', reason: 'User needs help' },
      { agentId: 'main' }
    )

    expect(handoffFn).toHaveBeenCalledWith('support', 'User needs help')
    expect(result).toEqual({ success: true })
  })

  it('schema enforces valid agentId from list', () => {
    const handoffFn = vi.fn()
    const handoffTool = createHandoffTool(agents, handoffFn)

    // The schema should be a Zod schema with enum
    expect(isZodSchema(handoffTool.inputSchema)).toBe(true)
  })
})

// ============================================================================
// createFinishTool() Tests
// ============================================================================

describe('createFinishTool()', () => {
  it('creates tool named "finish"', () => {
    const finishTool = createFinishTool()
    expect(finishTool.name).toBe('finish')
  })

  it('returns {finished: true} on execute', async () => {
    const finishTool = createFinishTool()
    const result = await finishTool.execute({ summary: 'All done!' }, { agentId: 'test' })
    expect(result).toEqual({ finished: true })
  })

  it('accepts summary in input', async () => {
    const finishTool = createFinishTool()
    // Should not throw
    await finishTool.execute({ summary: 'Completed all tasks' }, { agentId: 'test' })
  })
})

// ============================================================================
// createEscalationTool() Tests
// ============================================================================

describe('createEscalationTool()', () => {
  it('creates tool named "escalate_to_human"', () => {
    const escalateFn = vi.fn()
    const escalateTool = createEscalationTool(escalateFn)
    expect(escalateTool.name).toBe('escalate_to_human')
  })

  it('has permission set to auto', () => {
    const escalateFn = vi.fn()
    const escalateTool = createEscalationTool(escalateFn)
    expect(escalateTool.permission).toBe('auto')
  })

  it('calls escalate function with question and context', async () => {
    const escalateFn = vi.fn().mockResolvedValue('Approved')
    const escalateTool = createEscalationTool(escalateFn)

    const result = await escalateTool.execute(
      { question: 'Should we proceed?', context: { amount: 10000 } },
      { agentId: 'agent' }
    )

    expect(escalateFn).toHaveBeenCalledWith('Should we proceed?', { amount: 10000 })
    expect(result).toEqual({ answer: 'Approved' })
  })

  it('handles missing context', async () => {
    const escalateFn = vi.fn().mockResolvedValue('Yes')
    const escalateTool = createEscalationTool(escalateFn)

    await escalateTool.execute({ question: 'Continue?' }, { agentId: 'agent' })

    expect(escalateFn).toHaveBeenCalledWith('Continue?', {})
  })
})
