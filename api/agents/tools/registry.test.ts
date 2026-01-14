/**
 * Tool Registry Tests
 *
 * Tests for the ToolRegistry with schema validation and sandboxed execution.
 * Implements:
 * - Tool registration with definition schemas
 * - Schema validation on execute
 * - Sandboxed execution with timeout/permission controls
 * - Result handling
 *
 * @see dotdo-apow1 - [GREEN] Tool registry with execution
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import type { ToolContext } from '../types'

// ============================================================================
// Import ToolRegistry (will be implemented)
// ============================================================================

import {
  ToolRegistry,
  createToolRegistry,
  RegistryExecutionError,
  ToolNotFoundError,
  ToolValidationError,
  ToolTimeoutError,
  ToolPermissionError,
  type ToolRegistryOptions,
  type ExecutionOptions,
  type ExecutionResult,
} from './registry'

// ============================================================================
// Test Helpers
// ============================================================================

function createToolContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    agentId: 'test-agent',
    sessionId: 'test-session',
    ...overrides,
  }
}

// ============================================================================
// ToolRegistry Tests
// ============================================================================

describe('ToolRegistry', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = createToolRegistry()
  })

  // ==========================================================================
  // Construction
  // ==========================================================================

  describe('construction', () => {
    it('creates an empty registry', () => {
      const reg = createToolRegistry()
      expect(reg.list()).toEqual([])
    })

    it('accepts initial tools', () => {
      const tool = {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object' as const,
          properties: {
            input: { type: 'string', description: 'Input value' },
          },
          required: ['input'] as string[],
        },
        execute: async () => ({ result: 'ok' }),
      }

      const reg = createToolRegistry({ tools: [tool] })
      expect(reg.list()).toHaveLength(1)
      expect(reg.has('test_tool')).toBe(true)
    })

    it('accepts default timeout option', () => {
      const reg = createToolRegistry({ defaultTimeout: 5000 })
      expect(reg.options.defaultTimeout).toBe(5000)
    })

    it('accepts max timeout option', () => {
      const reg = createToolRegistry({ maxTimeout: 60000 })
      expect(reg.options.maxTimeout).toBe(60000)
    })

    it('accepts sandboxed option', () => {
      const reg = createToolRegistry({ sandboxed: true })
      expect(reg.options.sandboxed).toBe(true)
    })
  })

  // ==========================================================================
  // Tool Registration
  // ==========================================================================

  describe('register()', () => {
    it('registers a tool with JSON Schema', () => {
      registry.register({
        name: 'json_schema_tool',
        description: 'Tool with JSON Schema',
        inputSchema: {
          type: 'object',
          properties: {
            value: { type: 'string', description: 'A string value' },
          },
          required: ['value'],
        },
        execute: async ({ value }) => ({ echo: value }),
      })

      expect(registry.has('json_schema_tool')).toBe(true)
    })

    it('registers a tool with Zod schema', () => {
      registry.register({
        name: 'zod_tool',
        description: 'Tool with Zod schema',
        inputSchema: z.object({
          name: z.string().describe('User name'),
          age: z.number().optional(),
        }),
        execute: async ({ name, age }) => ({ name, age }),
      })

      expect(registry.has('zod_tool')).toBe(true)
    })

    it('throws on duplicate tool name', () => {
      const tool = {
        name: 'duplicate_tool',
        description: 'First tool',
        inputSchema: { type: 'object' as const, properties: {} },
        execute: async () => ({}),
      }

      registry.register(tool)

      expect(() => registry.register(tool)).toThrow(/already registered/)
    })

    it('allows force option to override existing tool', () => {
      const tool1 = {
        name: 'override_tool',
        description: 'First version',
        inputSchema: { type: 'object' as const, properties: {} },
        execute: async () => ({ version: 1 }),
      }

      const tool2 = {
        name: 'override_tool',
        description: 'Second version',
        inputSchema: { type: 'object' as const, properties: {} },
        execute: async () => ({ version: 2 }),
      }

      registry.register(tool1)
      registry.register(tool2, { force: true })

      expect(registry.get('override_tool')?.description).toBe('Second version')
    })
  })

  // ==========================================================================
  // Tool Retrieval
  // ==========================================================================

  describe('get()', () => {
    beforeEach(() => {
      registry.register({
        name: 'get_test',
        description: 'Test tool for get()',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({}),
      })
    })

    it('returns tool by name', () => {
      const tool = registry.get('get_test')
      expect(tool).toBeDefined()
      expect(tool?.name).toBe('get_test')
    })

    it('returns undefined for unknown tool', () => {
      const tool = registry.get('nonexistent')
      expect(tool).toBeUndefined()
    })
  })

  describe('has()', () => {
    it('returns true for registered tool', () => {
      registry.register({
        name: 'exists',
        description: 'Existing tool',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({}),
      })

      expect(registry.has('exists')).toBe(true)
    })

    it('returns false for unregistered tool', () => {
      expect(registry.has('does_not_exist')).toBe(false)
    })
  })

  describe('list()', () => {
    it('returns empty array when no tools registered', () => {
      expect(registry.list()).toEqual([])
    })

    it('returns all registered tools', () => {
      registry.register({
        name: 'tool_a',
        description: 'Tool A',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({}),
      })

      registry.register({
        name: 'tool_b',
        description: 'Tool B',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({}),
      })

      const tools = registry.list()
      expect(tools).toHaveLength(2)
      expect(tools.map((t) => t.name)).toContain('tool_a')
      expect(tools.map((t) => t.name)).toContain('tool_b')
    })
  })

  describe('unregister()', () => {
    it('removes a registered tool', () => {
      registry.register({
        name: 'to_remove',
        description: 'Tool to remove',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({}),
      })

      expect(registry.has('to_remove')).toBe(true)
      registry.unregister('to_remove')
      expect(registry.has('to_remove')).toBe(false)
    })

    it('returns true when tool was removed', () => {
      registry.register({
        name: 'removable',
        description: 'Removable tool',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({}),
      })

      expect(registry.unregister('removable')).toBe(true)
    })

    it('returns false when tool did not exist', () => {
      expect(registry.unregister('never_existed')).toBe(false)
    })
  })

  // ==========================================================================
  // Schema Validation
  // ==========================================================================

  describe('schema validation', () => {
    beforeEach(() => {
      registry.register({
        name: 'validated_tool',
        description: 'Tool with required fields',
        inputSchema: z.object({
          required_field: z.string(),
          optional_field: z.number().optional(),
        }),
        execute: async (input) => input,
      })
    })

    it('validates input before execution', async () => {
      const result = await registry.execute(
        'validated_tool',
        { required_field: 'value' },
        createToolContext()
      )

      expect(result.success).toBe(true)
    })

    it('throws ToolValidationError for invalid input', async () => {
      await expect(
        registry.execute('validated_tool', {}, createToolContext())
      ).rejects.toThrow(ToolValidationError)
    })

    it('includes field path in validation error', async () => {
      try {
        await registry.execute('validated_tool', {}, createToolContext())
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ToolValidationError)
        expect((error as ToolValidationError).path).toContain('required_field')
      }
    })

    it('validates type mismatches', async () => {
      await expect(
        registry.execute(
          'validated_tool',
          { required_field: 123 }, // Should be string
          createToolContext()
        )
      ).rejects.toThrow(ToolValidationError)
    })

    it('applies defaults from schema', async () => {
      registry.register({
        name: 'default_tool',
        description: 'Tool with defaults',
        inputSchema: z.object({
          count: z.number().default(10),
        }),
        execute: async (input) => input,
      })

      const result = await registry.execute(
        'default_tool',
        {},
        createToolContext()
      )

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ count: 10 })
    })

    it('skips validation with validate: false option', async () => {
      // This would normally fail validation
      const result = await registry.execute(
        'validated_tool',
        { required_field: 123 },
        createToolContext(),
        { validate: false }
      )

      expect(result.success).toBe(true)
    })
  })

  // ==========================================================================
  // Execution
  // ==========================================================================

  describe('execute()', () => {
    it('executes tool and returns result', async () => {
      registry.register({
        name: 'echo_tool',
        description: 'Echoes input',
        inputSchema: z.object({ message: z.string() }),
        execute: async ({ message }) => ({ echoed: message }),
      })

      const result = await registry.execute(
        'echo_tool',
        { message: 'hello' },
        createToolContext()
      )

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ echoed: 'hello' })
    })

    it('throws ToolNotFoundError for unknown tool', async () => {
      await expect(
        registry.execute('unknown_tool', {}, createToolContext())
      ).rejects.toThrow(ToolNotFoundError)
    })

    it('passes context to execute function', async () => {
      const contextCapture = vi.fn()

      registry.register({
        name: 'context_tool',
        description: 'Captures context',
        inputSchema: z.object({}),
        execute: async (_, ctx) => {
          contextCapture(ctx)
          return {}
        },
      })

      const ctx = createToolContext({ agentId: 'custom-agent' })
      await registry.execute('context_tool', {}, ctx)

      expect(contextCapture).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'custom-agent' })
      )
    })

    it('catches execution errors and wraps in RegistryExecutionError', async () => {
      registry.register({
        name: 'error_tool',
        description: 'Throws error',
        inputSchema: z.object({}),
        execute: async () => {
          throw new Error('Execution failed')
        },
      })

      await expect(
        registry.execute('error_tool', {}, createToolContext())
      ).rejects.toThrow(RegistryExecutionError)
    })

    it('includes original error in RegistryExecutionError', async () => {
      registry.register({
        name: 'cause_error_tool',
        description: 'Throws error with cause',
        inputSchema: z.object({}),
        execute: async () => {
          throw new Error('Original error')
        },
      })

      try {
        await registry.execute('cause_error_tool', {}, createToolContext())
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(RegistryExecutionError)
        expect((error as RegistryExecutionError).cause).toBeInstanceOf(Error)
        expect(((error as RegistryExecutionError).cause as Error).message).toBe(
          'Original error'
        )
      }
    })

    it('returns ExecutionResult with timing information', async () => {
      registry.register({
        name: 'timed_tool',
        description: 'Tool with timing',
        inputSchema: z.object({}),
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return { done: true }
        },
      })

      const result = await registry.execute(
        'timed_tool',
        {},
        createToolContext()
      )

      expect(result.durationMs).toBeGreaterThanOrEqual(10)
      expect(result.toolName).toBe('timed_tool')
    })
  })

  // ==========================================================================
  // Sandboxed Execution
  // ==========================================================================

  describe('sandboxed execution', () => {
    describe('timeout', () => {
      it('respects timeout option', async () => {
        registry.register({
          name: 'slow_tool',
          description: 'Slow tool',
          inputSchema: z.object({}),
          execute: async () => {
            await new Promise((resolve) => setTimeout(resolve, 1000))
            return {}
          },
        })

        await expect(
          registry.execute('slow_tool', {}, createToolContext(), { timeout: 50 })
        ).rejects.toThrow(ToolTimeoutError)
      })

      it('uses default timeout when not specified', async () => {
        const reg = createToolRegistry({ defaultTimeout: 50 })

        reg.register({
          name: 'default_timeout_tool',
          description: 'Tool with default timeout',
          inputSchema: z.object({}),
          execute: async () => {
            await new Promise((resolve) => setTimeout(resolve, 1000))
            return {}
          },
        })

        await expect(
          reg.execute('default_timeout_tool', {}, createToolContext())
        ).rejects.toThrow(ToolTimeoutError)
      })

      it('caps timeout at maxTimeout', async () => {
        const reg = createToolRegistry({ maxTimeout: 100 })

        reg.register({
          name: 'max_timeout_tool',
          description: 'Tool testing max timeout',
          inputSchema: z.object({}),
          execute: async () => {
            await new Promise((resolve) => setTimeout(resolve, 500))
            return {}
          },
        })

        // Request 1000ms but max is 100ms
        await expect(
          reg.execute('max_timeout_tool', {}, createToolContext(), {
            timeout: 1000,
          })
        ).rejects.toThrow(ToolTimeoutError)
      })

      it('includes timeout value in error', async () => {
        registry.register({
          name: 'timeout_info_tool',
          description: 'Tool for timeout info',
          inputSchema: z.object({}),
          execute: async () => {
            await new Promise((resolve) => setTimeout(resolve, 1000))
            return {}
          },
        })

        try {
          await registry.execute('timeout_info_tool', {}, createToolContext(), {
            timeout: 50,
          })
          expect.fail('Should have thrown')
        } catch (error) {
          expect(error).toBeInstanceOf(ToolTimeoutError)
          expect((error as ToolTimeoutError).timeoutMs).toBe(50)
        }
      })
    })

    describe('permission', () => {
      it('allows execution when permission is "auto"', async () => {
        registry.register({
          name: 'auto_permission_tool',
          description: 'Auto permission tool',
          inputSchema: z.object({}),
          permission: 'auto',
          execute: async () => ({ allowed: true }),
        })

        const result = await registry.execute(
          'auto_permission_tool',
          {},
          createToolContext()
        )

        expect(result.success).toBe(true)
      })

      it('throws ToolPermissionError when permission is "deny"', async () => {
        registry.register({
          name: 'denied_tool',
          description: 'Denied tool',
          inputSchema: z.object({}),
          permission: 'deny',
          execute: async () => ({}),
        })

        await expect(
          registry.execute('denied_tool', {}, createToolContext())
        ).rejects.toThrow(ToolPermissionError)
      })

      it('calls permission handler for "confirm" permission', async () => {
        const permissionHandler = vi.fn().mockResolvedValue(true)

        const reg = createToolRegistry({
          onPermissionRequest: permissionHandler,
        })

        reg.register({
          name: 'confirm_tool',
          description: 'Requires confirmation',
          inputSchema: z.object({}),
          permission: 'confirm',
          execute: async () => ({ confirmed: true }),
        })

        const result = await reg.execute(
          'confirm_tool',
          {},
          createToolContext()
        )

        expect(permissionHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'tool_use',
            resource: 'confirm_tool',
            action: 'execute',
          })
        )
        expect(result.success).toBe(true)
      })

      it('throws ToolPermissionError when permission handler returns false', async () => {
        const permissionHandler = vi.fn().mockResolvedValue(false)

        const reg = createToolRegistry({
          onPermissionRequest: permissionHandler,
        })

        reg.register({
          name: 'rejected_tool',
          description: 'Will be rejected',
          inputSchema: z.object({}),
          permission: 'confirm',
          execute: async () => ({}),
        })

        await expect(
          reg.execute('rejected_tool', {}, createToolContext())
        ).rejects.toThrow(ToolPermissionError)
      })

      it('allows bypass with skipPermission option', async () => {
        registry.register({
          name: 'bypass_permission_tool',
          description: 'Bypass permission',
          inputSchema: z.object({}),
          permission: 'deny',
          execute: async () => ({ bypassed: true }),
        })

        const result = await registry.execute(
          'bypass_permission_tool',
          {},
          createToolContext(),
          { skipPermission: true }
        )

        expect(result.success).toBe(true)
      })
    })

    describe('abort signal', () => {
      it('respects abort signal', async () => {
        registry.register({
          name: 'abortable_tool',
          description: 'Abortable tool',
          inputSchema: z.object({}),
          execute: async (_, ctx) => {
            // Simulate checking abort signal
            if (ctx.abortSignal?.aborted) {
              throw new Error('Aborted')
            }
            await new Promise((resolve) => setTimeout(resolve, 100))
            return {}
          },
        })

        const controller = new AbortController()
        const ctx = createToolContext({ abortSignal: controller.signal })

        // Abort immediately
        controller.abort()

        await expect(
          registry.execute('abortable_tool', {}, ctx)
        ).rejects.toThrow()
      })

      it('passes abort signal to tool context', async () => {
        const signalCapture = vi.fn()

        registry.register({
          name: 'signal_capture_tool',
          description: 'Captures signal',
          inputSchema: z.object({}),
          execute: async (_, ctx) => {
            signalCapture(ctx.abortSignal)
            return {}
          },
        })

        const controller = new AbortController()
        const ctx = createToolContext({ abortSignal: controller.signal })

        await registry.execute('signal_capture_tool', {}, ctx)

        expect(signalCapture).toHaveBeenCalledWith(controller.signal)
      })
    })

    describe('isolation', () => {
      it('isolates tool state between executions', async () => {
        let callCount = 0

        registry.register({
          name: 'stateful_tool',
          description: 'Has internal state',
          inputSchema: z.object({}),
          execute: async () => {
            callCount++
            return { count: callCount }
          },
        })

        const result1 = await registry.execute(
          'stateful_tool',
          {},
          createToolContext()
        )
        const result2 = await registry.execute(
          'stateful_tool',
          {},
          createToolContext()
        )

        // Both should succeed, state should be tracked
        expect(result1.success).toBe(true)
        expect(result2.success).toBe(true)
        expect(result2.data).toEqual({ count: 2 })
      })

      it('does not share errors between executions', async () => {
        let shouldFail = true

        registry.register({
          name: 'flaky_tool',
          description: 'Sometimes fails',
          inputSchema: z.object({}),
          execute: async () => {
            if (shouldFail) {
              shouldFail = false
              throw new Error('First call fails')
            }
            return { success: true }
          },
        })

        await expect(
          registry.execute('flaky_tool', {}, createToolContext())
        ).rejects.toThrow()

        // Second call should succeed
        const result = await registry.execute(
          'flaky_tool',
          {},
          createToolContext()
        )
        expect(result.success).toBe(true)
      })
    })
  })

  // ==========================================================================
  // Result Handling
  // ==========================================================================

  describe('result handling', () => {
    it('returns success result with data', async () => {
      registry.register({
        name: 'success_result_tool',
        description: 'Returns success',
        inputSchema: z.object({}),
        execute: async () => ({ key: 'value' }),
      })

      const result = await registry.execute(
        'success_result_tool',
        {},
        createToolContext()
      )

      expect(result).toMatchObject({
        success: true,
        data: { key: 'value' },
        toolName: 'success_result_tool',
      })
    })

    it('includes input in result', async () => {
      registry.register({
        name: 'input_result_tool',
        description: 'Tool with input in result',
        inputSchema: z.object({ value: z.string() }),
        execute: async ({ value }) => ({ processed: value }),
      })

      const result = await registry.execute(
        'input_result_tool',
        { value: 'test' },
        createToolContext()
      )

      expect(result.input).toEqual({ value: 'test' })
    })

    it('handles null result', async () => {
      registry.register({
        name: 'null_result_tool',
        description: 'Returns null',
        inputSchema: z.object({}),
        execute: async () => null as any,
      })

      const result = await registry.execute(
        'null_result_tool',
        {},
        createToolContext()
      )

      expect(result.success).toBe(true)
      expect(result.data).toBeNull()
    })

    it('handles undefined result', async () => {
      registry.register({
        name: 'undefined_result_tool',
        description: 'Returns undefined',
        inputSchema: z.object({}),
        execute: async () => undefined as any,
      })

      const result = await registry.execute(
        'undefined_result_tool',
        {},
        createToolContext()
      )

      expect(result.success).toBe(true)
      expect(result.data).toBeUndefined()
    })

    it('serializes complex result objects', async () => {
      registry.register({
        name: 'complex_result_tool',
        description: 'Returns complex object',
        inputSchema: z.object({}),
        execute: async () => ({
          nested: {
            array: [1, 2, 3],
            object: { a: 'b' },
          },
          date: new Date('2024-01-01'),
        }),
      })

      const result = await registry.execute(
        'complex_result_tool',
        {},
        createToolContext()
      )

      expect(result.success).toBe(true)
      expect(result.data.nested.array).toEqual([1, 2, 3])
    })
  })

  // ==========================================================================
  // Hooks
  // ==========================================================================

  describe('hooks', () => {
    it('calls onPreToolUse before execution', async () => {
      const preHook = vi.fn()

      const reg = createToolRegistry({ onPreToolUse: preHook })

      reg.register({
        name: 'pre_hook_tool',
        description: 'Tool with pre hook',
        inputSchema: z.object({ value: z.string() }),
        execute: async () => ({}),
      })

      await reg.execute(
        'pre_hook_tool',
        { value: 'test' },
        createToolContext()
      )

      expect(preHook).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'pre_hook_tool',
          input: { value: 'test' },
        })
      )
    })

    it('calls onPostToolUse after execution', async () => {
      const postHook = vi.fn()

      const reg = createToolRegistry({ onPostToolUse: postHook })

      reg.register({
        name: 'post_hook_tool',
        description: 'Tool with post hook',
        inputSchema: z.object({}),
        execute: async () => ({ result: 'done' }),
      })

      await reg.execute('post_hook_tool', {}, createToolContext())

      expect(postHook).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'post_hook_tool',
          result: expect.objectContaining({ data: { result: 'done' } }),
        })
      )
    })

    it('allows pre hook to modify input', async () => {
      const preHook = vi.fn().mockResolvedValue({
        action: 'modify',
        input: { value: 'modified' },
      })

      const reg = createToolRegistry({ onPreToolUse: preHook })

      reg.register({
        name: 'modify_input_tool',
        description: 'Tool with modified input',
        inputSchema: z.object({ value: z.string() }),
        execute: async ({ value }) => ({ received: value }),
      })

      const result = await reg.execute(
        'modify_input_tool',
        { value: 'original' },
        createToolContext()
      )

      expect(result.data).toEqual({ received: 'modified' })
    })

    it('allows pre hook to deny execution', async () => {
      const preHook = vi.fn().mockResolvedValue({
        action: 'deny',
        reason: 'Not allowed',
      })

      const reg = createToolRegistry({ onPreToolUse: preHook })

      reg.register({
        name: 'denied_by_hook_tool',
        description: 'Tool denied by hook',
        inputSchema: z.object({}),
        execute: async () => ({}),
      })

      await expect(
        reg.execute('denied_by_hook_tool', {}, createToolContext())
      ).rejects.toThrow(/Not allowed/)
    })
  })

  // ==========================================================================
  // Batch Execution
  // ==========================================================================

  describe('executeBatch()', () => {
    beforeEach(() => {
      registry.register({
        name: 'batch_tool',
        description: 'Batch tool',
        inputSchema: z.object({ id: z.number() }),
        execute: async ({ id }) => ({ processed: id }),
      })
    })

    it('executes multiple tools in sequence', async () => {
      const results = await registry.executeBatch(
        [
          { tool: 'batch_tool', input: { id: 1 } },
          { tool: 'batch_tool', input: { id: 2 } },
          { tool: 'batch_tool', input: { id: 3 } },
        ],
        createToolContext()
      )

      expect(results).toHaveLength(3)
      expect(results.every((r) => r.success)).toBe(true)
    })

    it('returns partial results on failure when stopOnError is false', async () => {
      registry.register({
        name: 'failing_batch_tool',
        description: 'Fails',
        inputSchema: z.object({}),
        execute: async () => {
          throw new Error('Failed')
        },
      })

      const results = await registry.executeBatch(
        [
          { tool: 'batch_tool', input: { id: 1 } },
          { tool: 'failing_batch_tool', input: {} },
          { tool: 'batch_tool', input: { id: 3 } },
        ],
        createToolContext(),
        { stopOnError: false }
      )

      expect(results).toHaveLength(3)
      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(false)
      expect(results[2].success).toBe(true)
    })

    it('stops on first error when stopOnError is true', async () => {
      registry.register({
        name: 'stop_batch_tool',
        description: 'Fails',
        inputSchema: z.object({}),
        execute: async () => {
          throw new Error('Failed')
        },
      })

      const results = await registry.executeBatch(
        [
          { tool: 'batch_tool', input: { id: 1 } },
          { tool: 'stop_batch_tool', input: {} },
          { tool: 'batch_tool', input: { id: 3 } },
        ],
        createToolContext(),
        { stopOnError: true }
      )

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(false)
    })
  })

  // ==========================================================================
  // JSON Schema Export
  // ==========================================================================

  describe('toJsonSchema()', () => {
    it('exports tool definitions as JSON Schema', () => {
      registry.register({
        name: 'export_tool',
        description: 'Tool for export',
        inputSchema: z.object({
          name: z.string().describe('Name field'),
          count: z.number().optional(),
        }),
        execute: async () => ({}),
      })

      const schemas = registry.toJsonSchema()

      expect(schemas).toHaveLength(1)
      expect(schemas[0]).toMatchObject({
        name: 'export_tool',
        description: 'Tool for export',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name field' },
            count: { type: 'number' },
          },
          required: ['name'],
        },
      })
    })

    it('converts Zod schemas to JSON Schema format', () => {
      registry.register({
        name: 'zod_export_tool',
        description: 'Zod tool for export',
        inputSchema: z.object({
          items: z.array(z.string()),
          config: z.object({
            enabled: z.boolean().default(true),
          }),
        }),
        execute: async () => ({}),
      })

      const schemas = registry.toJsonSchema()
      const schema = schemas.find((s) => s.name === 'zod_export_tool')

      expect(schema?.inputSchema.properties.items).toMatchObject({
        type: 'array',
        items: { type: 'string' },
      })
    })
  })

  // ==========================================================================
  // Clear/Reset
  // ==========================================================================

  describe('clear()', () => {
    it('removes all registered tools', () => {
      registry.register({
        name: 'tool_to_clear',
        description: 'Will be cleared',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({}),
      })

      expect(registry.list().length).toBeGreaterThan(0)

      registry.clear()

      expect(registry.list()).toEqual([])
    })
  })
})
