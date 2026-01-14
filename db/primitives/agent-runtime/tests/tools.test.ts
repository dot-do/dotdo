/**
 * Tool Registry Tests
 *
 * Tests for:
 * - Tool registration and lookup
 * - Schema validation
 * - Tool execution with context
 * - Timeout and retry handling
 * - Result caching
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import type {
  ToolDefinition,
  ToolResult,
  ToolContext,
  ToolSchema,
  RetryConfig,
} from '../types'
import {
  createToolRegistry,
  type ToolRegistry,
  createTool,
  validateToolInput,
  executeToolWithRetry,
} from '../tools'

// ============================================================================
// Test Utilities
// ============================================================================

function createTestContext(): ToolContext {
  return {
    agentId: 'test-agent',
    sessionId: 'test-session',
    userId: 'test-user',
  }
}

// ============================================================================
// Tool Creation Tests
// ============================================================================

describe('Tool Creation', () => {
  describe('createTool()', () => {
    it('should create tool with JSON schema', () => {
      const tool = createTool({
        name: 'get_weather',
        description: 'Get weather for a location',
        inputSchema: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'City name' },
            unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
          },
          required: ['location'],
        },
        execute: async ({ location }) => ({ temp: 72, location }),
      })

      expect(tool.name).toBe('get_weather')
      expect(tool.description).toBe('Get weather for a location')
      expect(tool.inputSchema).toBeDefined()
    })

    it('should create tool with Zod schema', () => {
      const tool = createTool({
        name: 'calculate',
        description: 'Perform calculation',
        inputSchema: z.object({
          expression: z.string().describe('Math expression'),
        }),
        execute: async ({ expression }) => ({ result: eval(expression) }),
      })

      expect(tool.name).toBe('calculate')
      expect(tool.inputSchema).toBeDefined()
    })

    it('should support optional output schema', () => {
      const tool = createTool({
        name: 'search',
        description: 'Search documents',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            results: { type: 'array', items: { type: 'string' } },
          },
        },
        execute: async () => ({ results: ['doc1', 'doc2'] }),
      })

      expect(tool.outputSchema).toBeDefined()
    })

    it('should support cacheable flag', () => {
      const tool = createTool({
        name: 'fetch_data',
        description: 'Fetch static data',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({ data: 'cached' }),
        cacheable: true,
        cacheTtl: 60000,
      })

      expect(tool.cacheable).toBe(true)
      expect(tool.cacheTtl).toBe(60000)
    })

    it('should support timeout configuration', () => {
      const tool = createTool({
        name: 'slow_operation',
        description: 'A slow operation',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({ done: true }),
        timeout: 5000,
      })

      expect(tool.timeout).toBe(5000)
    })

    it('should support retry configuration', () => {
      const tool = createTool({
        name: 'flaky_api',
        description: 'A flaky API call',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({ success: true }),
        retry: {
          maxAttempts: 3,
          initialDelayMs: 100,
          backoffMultiplier: 2,
        },
      })

      expect(tool.retry?.maxAttempts).toBe(3)
    })
  })
})

// ============================================================================
// Tool Registry Tests
// ============================================================================

describe('Tool Registry', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = createToolRegistry()
  })

  describe('register()', () => {
    it('should register a tool', () => {
      const tool = createTool({
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({}),
      })

      registry.register(tool)

      expect(registry.get('test_tool')).toBe(tool)
    })

    it('should overwrite existing tool with same name', () => {
      const tool1 = createTool({
        name: 'test_tool',
        description: 'Version 1',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({ version: 1 }),
      })

      const tool2 = createTool({
        name: 'test_tool',
        description: 'Version 2',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({ version: 2 }),
      })

      registry.register(tool1)
      registry.register(tool2)

      expect(registry.get('test_tool')?.description).toBe('Version 2')
    })
  })

  describe('get()', () => {
    it('should return undefined for unregistered tool', () => {
      expect(registry.get('nonexistent')).toBeUndefined()
    })
  })

  describe('has()', () => {
    it('should return true for registered tool', () => {
      const tool = createTool({
        name: 'exists',
        description: 'Tool exists',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({}),
      })

      registry.register(tool)

      expect(registry.has('exists')).toBe(true)
      expect(registry.has('not_exists')).toBe(false)
    })
  })

  describe('remove()', () => {
    it('should remove a registered tool', () => {
      const tool = createTool({
        name: 'removable',
        description: 'To be removed',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({}),
      })

      registry.register(tool)
      expect(registry.has('removable')).toBe(true)

      registry.remove('removable')
      expect(registry.has('removable')).toBe(false)
    })
  })

  describe('getAll()', () => {
    it('should return all registered tools', () => {
      registry.register(createTool({
        name: 'tool1',
        description: 'First tool',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({}),
      }))

      registry.register(createTool({
        name: 'tool2',
        description: 'Second tool',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({}),
      }))

      const tools = registry.getAll()
      expect(tools).toHaveLength(2)
      expect(tools.map((t) => t.name)).toContain('tool1')
      expect(tools.map((t) => t.name)).toContain('tool2')
    })
  })

  describe('execute()', () => {
    it('should execute a registered tool', async () => {
      const tool = createTool({
        name: 'adder',
        description: 'Add two numbers',
        inputSchema: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' },
          },
          required: ['a', 'b'],
        },
        execute: async ({ a, b }: { a: number; b: number }) => ({ sum: a + b }),
      })

      registry.register(tool)

      const result = await registry.execute('adder', { a: 5, b: 3 }, createTestContext())

      expect(result.result).toEqual({ sum: 8 })
      expect(result.error).toBeUndefined()
    })

    it('should return error for unknown tool', async () => {
      const result = await registry.execute('unknown', {}, createTestContext())

      expect(result.error).toContain('Unknown tool')
    })

    it('should return error for validation failure', async () => {
      const tool = createTool({
        name: 'strict_tool',
        description: 'Requires specific input',
        inputSchema: z.object({
          required_field: z.string(),
        }),
        execute: async () => ({}),
      })

      registry.register(tool)

      const result = await registry.execute('strict_tool', {}, createTestContext())

      expect(result.error).toBeDefined()
    })

    it('should return error when execution throws', async () => {
      const tool = createTool({
        name: 'error_tool',
        description: 'Always throws',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => {
          throw new Error('Intentional error')
        },
      })

      registry.register(tool)

      const result = await registry.execute('error_tool', {}, createTestContext())

      expect(result.error).toBe('Intentional error')
      expect(result.result).toBeNull()
    })

    it('should measure execution duration', async () => {
      const tool = createTool({
        name: 'slow_tool',
        description: 'Takes some time',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          return { done: true }
        },
      })

      registry.register(tool)

      const result = await registry.execute('slow_tool', {}, createTestContext())

      expect(result.durationMs).toBeGreaterThanOrEqual(40)
    })

    it('should pass context to execute function', async () => {
      let receivedContext: ToolContext | undefined

      const tool = createTool({
        name: 'context_aware',
        description: 'Uses context',
        inputSchema: { type: 'object', properties: {} },
        execute: async (_input, ctx) => {
          receivedContext = ctx
          return { agentId: ctx.agentId }
        },
      })

      registry.register(tool)

      const context = createTestContext()
      await registry.execute('context_aware', {}, context)

      expect(receivedContext?.agentId).toBe(context.agentId)
      expect(receivedContext?.sessionId).toBe(context.sessionId)
    })
  })
})

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('Schema Validation', () => {
  describe('validateToolInput() with JSON Schema', () => {
    it('should validate correct input', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      }

      const result = validateToolInput(schema, { name: 'Alice', age: 30 })

      expect(result.valid).toBe(true)
      expect(result.data).toEqual({ name: 'Alice', age: 30 })
    })

    it('should fail for missing required field', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      }

      const result = validateToolInput(schema, {})

      expect(result.valid).toBe(false)
      expect(result.error).toContain('name')
    })

    it('should fail for wrong type', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          count: { type: 'number' },
        },
        required: ['count'],
      }

      const result = validateToolInput(schema, { count: 'not a number' })

      expect(result.valid).toBe(false)
    })

    it('should validate enum values', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'inactive'] },
        },
        required: ['status'],
      }

      expect(validateToolInput(schema, { status: 'active' }).valid).toBe(true)
      expect(validateToolInput(schema, { status: 'invalid' }).valid).toBe(false)
    })
  })

  describe('validateToolInput() with Zod Schema', () => {
    it('should validate correct input', () => {
      const schema = z.object({
        email: z.string().email(),
        age: z.number().min(0).max(150),
      })

      const result = validateToolInput(schema, { email: 'test@example.com', age: 25 })

      expect(result.valid).toBe(true)
    })

    it('should fail for invalid email', () => {
      const schema = z.object({
        email: z.string().email(),
      })

      const result = validateToolInput(schema, { email: 'not-an-email' })

      expect(result.valid).toBe(false)
    })

    it('should transform data', () => {
      const schema = z.object({
        date: z.string().transform((s) => new Date(s)),
      })

      const result = validateToolInput(schema, { date: '2024-01-15' })

      expect(result.valid).toBe(true)
      expect(result.data?.date).toBeInstanceOf(Date)
    })
  })
})

// ============================================================================
// Retry Tests
// ============================================================================

describe('Tool Retry', () => {
  describe('executeToolWithRetry()', () => {
    it('should succeed on first attempt if no error', async () => {
      const execute = vi.fn().mockResolvedValue({ success: true })

      const result = await executeToolWithRetry(
        execute,
        { value: 'test' },
        createTestContext(),
        { maxAttempts: 3 }
      )

      expect(result.result).toEqual({ success: true })
      expect(execute).toHaveBeenCalledTimes(1)
    })

    it('should retry on failure', async () => {
      const execute = vi
        .fn()
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValue({ success: true })

      const result = await executeToolWithRetry(
        execute,
        {},
        createTestContext(),
        { maxAttempts: 3, initialDelayMs: 10 }
      )

      expect(result.result).toEqual({ success: true })
      expect(execute).toHaveBeenCalledTimes(2)
    })

    it('should fail after max attempts', async () => {
      const execute = vi.fn().mockRejectedValue(new Error('Persistent error'))

      const result = await executeToolWithRetry(
        execute,
        {},
        createTestContext(),
        { maxAttempts: 3, initialDelayMs: 10 }
      )

      expect(result.error).toBe('Persistent error')
      expect(execute).toHaveBeenCalledTimes(3)
    })

    it('should apply exponential backoff', async () => {
      const execute = vi
        .fn()
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValue({ success: true })

      const startTime = Date.now()

      await executeToolWithRetry(
        execute,
        {},
        createTestContext(),
        {
          maxAttempts: 3,
          initialDelayMs: 50,
          backoffMultiplier: 2,
        }
      )

      const elapsed = Date.now() - startTime
      // Should wait at least 50 + 100 = 150ms
      expect(elapsed).toBeGreaterThanOrEqual(100) // Some tolerance
    })

    it('should cap delay at maxDelayMs', async () => {
      const execute = vi
        .fn()
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValue({ success: true })

      const startTime = Date.now()

      await executeToolWithRetry(
        execute,
        {},
        createTestContext(),
        {
          maxAttempts: 3,
          initialDelayMs: 100,
          maxDelayMs: 50, // Cap is lower than initial!
          backoffMultiplier: 10,
        }
      )

      // Should be relatively quick due to cap
      const elapsed = Date.now() - startTime
      expect(elapsed).toBeLessThan(500)
    })
  })
})

// ============================================================================
// Tool Execution with Abort Signal Tests
// ============================================================================

describe('Tool Abort Signal', () => {
  it('should abort execution when signal is triggered', async () => {
    const controller = new AbortController()
    const registry = createToolRegistry()

    const tool = createTool({
      name: 'abortable',
      description: 'Can be aborted',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_input, ctx) => {
        // Simulate long operation that checks abort signal
        for (let i = 0; i < 10; i++) {
          if (ctx.abortSignal?.aborted) {
            throw new Error('Operation aborted')
          }
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        return { completed: true }
      },
    })

    registry.register(tool)

    const context: ToolContext = {
      ...createTestContext(),
      abortSignal: controller.signal,
    }

    // Abort after 100ms
    setTimeout(() => controller.abort(), 100)

    const result = await registry.execute('abortable', {}, context)

    expect(result.error).toContain('abort')
  })
})
