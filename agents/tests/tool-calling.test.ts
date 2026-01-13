/**
 * Tool Calling Tests (RED Phase)
 *
 * Tests for the tool calling lifecycle within agents:
 * - Function schema formatting for provider APIs (OpenAI, Anthropic)
 * - Tool execution within the agent loop
 * - Tool result handling (success, errors, validation)
 * - Multi-step tool calling and agentic loops
 *
 * These tests should FAIL until tool calling is fully implemented.
 *
 * @see dotdo-6t9m4 - [RED] Tool calling tests
 * @module agents/tests/tool-calling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { tool, zodToJsonSchema, validateInput } from '../Tool'
import { BaseAgent } from '../Agent'
import type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolContext,
  Message,
  StepResult,
  AgentConfig,
} from '../types'

// ============================================================================
// Function Schema Formatting Tests
// ============================================================================

describe('Function Schema Formatting', () => {
  describe('OpenAI Function Format', () => {
    it('should convert tool definition to OpenAI function format', () => {
      const weatherTool = tool({
        name: 'get_weather',
        description: 'Get the current weather for a location',
        inputSchema: z.object({
          location: z.string().describe('City name'),
          unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
        }),
        execute: async () => ({ temp: 22 }),
      })

      // Expected OpenAI format:
      // { type: 'function', function: { name, description, parameters } }
      const openAIFormat = convertToOpenAIFormat(weatherTool)

      expect(openAIFormat.type).toBe('function')
      expect(openAIFormat.function.name).toBe('get_weather')
      expect(openAIFormat.function.description).toBe('Get the current weather for a location')
      expect(openAIFormat.function.parameters.type).toBe('object')
      expect(openAIFormat.function.parameters.properties.location.type).toBe('string')
      expect(openAIFormat.function.parameters.properties.location.description).toBe('City name')
      expect(openAIFormat.function.parameters.properties.unit.enum).toEqual(['celsius', 'fahrenheit'])
      expect(openAIFormat.function.parameters.required).toContain('location')
      expect(openAIFormat.function.parameters.required).not.toContain('unit')
    })

    it('should handle nested object schemas for OpenAI', () => {
      const createUserTool = tool({
        name: 'create_user',
        description: 'Create a new user',
        inputSchema: z.object({
          user: z.object({
            name: z.string(),
            address: z.object({
              city: z.string(),
              country: z.string(),
            }),
          }),
        }),
        execute: async () => ({ id: '123' }),
      })

      const openAIFormat = convertToOpenAIFormat(createUserTool)

      expect(openAIFormat.function.parameters.properties.user.type).toBe('object')
      expect(openAIFormat.function.parameters.properties.user.properties.address.type).toBe('object')
      expect(openAIFormat.function.parameters.properties.user.properties.address.properties.city.type).toBe('string')
    })

    it('should handle array schemas for OpenAI', () => {
      const batchTool = tool({
        name: 'batch_process',
        description: 'Process multiple items',
        inputSchema: z.object({
          items: z.array(z.object({
            id: z.string(),
            action: z.enum(['create', 'update', 'delete']),
          })),
        }),
        execute: async () => ({ processed: 0 }),
      })

      const openAIFormat = convertToOpenAIFormat(batchTool)

      expect(openAIFormat.function.parameters.properties.items.type).toBe('array')
      expect(openAIFormat.function.parameters.properties.items.items.type).toBe('object')
      expect(openAIFormat.function.parameters.properties.items.items.properties.action.enum).toEqual(['create', 'update', 'delete'])
    })

    it('should preserve strict mode for OpenAI function calling', () => {
      const strictTool = tool({
        name: 'strict_tool',
        description: 'A tool with strict schema',
        inputSchema: z.object({
          required_field: z.string(),
        }),
        execute: async () => ({}),
      })

      const openAIFormat = convertToOpenAIFormat(strictTool, { strict: true })

      expect(openAIFormat.function.strict).toBe(true)
      // Strict mode requires additionalProperties: false
      expect(openAIFormat.function.parameters.additionalProperties).toBe(false)
    })
  })

  describe('Anthropic/Claude Tool Format', () => {
    it('should convert tool definition to Claude format', () => {
      const searchTool = tool({
        name: 'search_database',
        description: 'Search the database',
        inputSchema: z.object({
          query: z.string().describe('Search query'),
          limit: z.number().default(10),
        }),
        execute: async () => ({ results: [] }),
      })

      // Expected Claude format:
      // { name, description, input_schema }
      const claudeFormat = convertToClaudeFormat(searchTool)

      expect(claudeFormat.name).toBe('search_database')
      expect(claudeFormat.description).toBe('Search the database')
      expect(claudeFormat.input_schema.type).toBe('object')
      expect(claudeFormat.input_schema.properties.query.description).toBe('Search query')
    })

    it('should handle cache_control for Claude tools', () => {
      const expensiveTool = tool({
        name: 'expensive_lookup',
        description: 'A tool result that should be cached',
        inputSchema: z.object({ key: z.string() }),
        execute: async () => ({ value: 'cached' }),
      })

      const claudeFormat = convertToClaudeFormat(expensiveTool, { cacheControl: { type: 'ephemeral' } })

      expect(claudeFormat.cache_control).toEqual({ type: 'ephemeral' })
    })
  })

  describe('Provider-agnostic Tool Conversion', () => {
    it('should auto-detect and convert to correct provider format', () => {
      const genericTool = tool({
        name: 'generic_tool',
        description: 'Works with any provider',
        inputSchema: z.object({ input: z.string() }),
        execute: async () => ({}),
      })

      const openAI = convertToolForProvider(genericTool, 'openai')
      const claude = convertToolForProvider(genericTool, 'claude')
      const vercel = convertToolForProvider(genericTool, 'vercel')

      // Each format should be correct for its provider
      expect(openAI.type).toBe('function')
      expect(openAI.function.name).toBe('generic_tool')

      expect(claude.name).toBe('generic_tool')
      expect(claude.input_schema).toBeDefined()

      // Vercel uses same format as internal tool definition
      expect(vercel.name).toBe('generic_tool')
      expect(vercel.parameters).toBeDefined()
    })
  })
})

// ============================================================================
// Tool Execution Tests
// ============================================================================

describe('Tool Execution', () => {
  describe('Single Tool Execution', () => {
    it('should execute tool and return result', async () => {
      const addTool = tool({
        name: 'add',
        description: 'Add two numbers',
        inputSchema: z.object({
          a: z.number(),
          b: z.number(),
        }),
        execute: async ({ a, b }) => ({ sum: a + b }),
      })

      const toolCall: ToolCall = {
        id: 'call_123',
        name: 'add',
        arguments: { a: 5, b: 3 },
      }

      const result = await executeToolCall(addTool, toolCall)

      expect(result.toolCallId).toBe('call_123')
      expect(result.toolName).toBe('add')
      expect(result.result).toEqual({ sum: 8 })
      expect(result.error).toBeUndefined()
    })

    it('should handle async tool execution', async () => {
      const asyncTool = tool({
        name: 'async_fetch',
        description: 'Fetch data asynchronously',
        inputSchema: z.object({ url: z.string() }),
        execute: async ({ url }) => {
          // Simulate async operation
          await new Promise(resolve => setTimeout(resolve, 10))
          return { data: `fetched from ${url}` }
        },
      })

      const result = await executeToolCall(asyncTool, {
        id: 'call_async',
        name: 'async_fetch',
        arguments: { url: 'https://example.com' },
      })

      expect(result.result).toEqual({ data: 'fetched from https://example.com' })
    })

    it('should pass ToolContext to execute function', async () => {
      const contextCapture = vi.fn()

      const contextTool = tool({
        name: 'context_tool',
        description: 'Captures context',
        inputSchema: z.object({}),
        execute: async (_, context) => {
          contextCapture(context)
          return { received: true }
        },
      })

      const context: ToolContext = {
        agentId: 'agent-001',
        sessionId: 'session-abc',
        userId: 'user-xyz',
        metadata: { custom: 'value' },
      }

      await executeToolCall(contextTool, { id: 'call', name: 'context_tool', arguments: {} }, context)

      expect(contextCapture).toHaveBeenCalledWith(context)
    })

    it('should respect abort signal during execution', async () => {
      const slowTool = tool({
        name: 'slow_tool',
        description: 'Takes a long time',
        inputSchema: z.object({}),
        execute: async (_, context) => {
          // Check abort signal periodically
          for (let i = 0; i < 100; i++) {
            if (context.abortSignal?.aborted) {
              throw new Error('Operation aborted')
            }
            await new Promise(resolve => setTimeout(resolve, 10))
          }
          return { completed: true }
        },
      })

      const controller = new AbortController()
      setTimeout(() => controller.abort(), 50)

      const result = await executeToolCall(
        slowTool,
        { id: 'call', name: 'slow_tool', arguments: {} },
        { agentId: 'test', abortSignal: controller.signal }
      )

      expect(result.error).toContain('abort')
    })
  })

  describe('Tool Validation', () => {
    it('should validate input before execution', async () => {
      const strictTool = tool({
        name: 'strict',
        description: 'Has strict input requirements',
        inputSchema: z.object({
          email: z.string().email(),
          age: z.number().min(0).max(150),
        }),
        execute: async () => ({ valid: true }),
      })

      // Invalid email
      const result1 = await executeToolCall(strictTool, {
        id: 'call1',
        name: 'strict',
        arguments: { email: 'not-an-email', age: 25 },
      })

      expect(result1.error).toBeDefined()
      expect(result1.error).toContain('email')

      // Invalid age
      const result2 = await executeToolCall(strictTool, {
        id: 'call2',
        name: 'strict',
        arguments: { email: 'test@example.com', age: 200 },
      })

      expect(result2.error).toBeDefined()
      expect(result2.error).toContain('age')
    })

    it('should apply default values during validation', async () => {
      const inputCapture = vi.fn()

      const defaultsTool = tool({
        name: 'with_defaults',
        description: 'Has default values',
        inputSchema: z.object({
          required: z.string(),
          optional: z.string().default('default_value'),
          count: z.number().default(10),
        }),
        execute: async (input) => {
          inputCapture(input)
          return input
        },
      })

      await executeToolCall(defaultsTool, {
        id: 'call',
        name: 'with_defaults',
        arguments: { required: 'test' },
      })

      expect(inputCapture).toHaveBeenCalledWith({
        required: 'test',
        optional: 'default_value',
        count: 10,
      })
    })

    it('should handle missing required fields', async () => {
      const requiredTool = tool({
        name: 'required_fields',
        description: 'Has required fields',
        inputSchema: z.object({
          field1: z.string(),
          field2: z.number(),
        }),
        execute: async () => ({}),
      })

      const result = await executeToolCall(requiredTool, {
        id: 'call',
        name: 'required_fields',
        arguments: { field1: 'only this' }, // missing field2
      })

      expect(result.error).toBeDefined()
      expect(result.error).toContain('field2')
    })
  })

  describe('Tool Error Handling', () => {
    it('should catch and report execution errors', async () => {
      const failingTool = tool({
        name: 'failing_tool',
        description: 'Always fails',
        inputSchema: z.object({}),
        execute: async () => {
          throw new Error('Intentional failure')
        },
      })

      const result = await executeToolCall(failingTool, {
        id: 'call',
        name: 'failing_tool',
        arguments: {},
      })

      expect(result.error).toBe('Intentional failure')
      expect(result.result).toBeNull()
    })

    it('should handle non-Error throws', async () => {
      const throwStringTool = tool({
        name: 'throw_string',
        description: 'Throws a string',
        inputSchema: z.object({}),
        execute: async () => {
          throw 'String error'
        },
      })

      const result = await executeToolCall(throwStringTool, {
        id: 'call',
        name: 'throw_string',
        arguments: {},
      })

      expect(result.error).toBe('String error')
    })

    it('should report unknown tool error', async () => {
      const tools = [
        tool({
          name: 'known_tool',
          description: 'A known tool',
          inputSchema: z.object({}),
          execute: async () => ({}),
        }),
      ]

      const result = await executeToolCallFromList(tools, {
        id: 'call',
        name: 'unknown_tool',
        arguments: {},
      })

      expect(result.error).toContain('Unknown tool')
      expect(result.error).toContain('unknown_tool')
    })
  })
})

// ============================================================================
// Agent Tool Loop Tests
// ============================================================================

describe('Agent Tool Loop', () => {
  let mockGenerate: ReturnType<typeof vi.fn>
  let testAgent: BaseAgent

  beforeEach(() => {
    mockGenerate = vi.fn()
  })

  const createTestAgent = (tools: ToolDefinition[], responses: StepResult[]) => {
    let callCount = 0
    mockGenerate.mockImplementation(async () => {
      return responses[callCount++] ?? { text: 'Done', finishReason: 'stop' }
    })

    const config: AgentConfig = {
      id: 'test-agent',
      name: 'Test Agent',
      instructions: 'You are a test agent',
      model: 'test-model',
      tools,
      maxSteps: 10,
    }

    return new BaseAgent({
      config,
      provider: { name: 'test', version: '1.0', createAgent: () => null as any },
      generate: mockGenerate,
    })
  }

  describe('Single Tool Call', () => {
    it('should execute tool and continue conversation', async () => {
      const calculatorTool = tool({
        name: 'calculate',
        description: 'Perform calculation',
        inputSchema: z.object({ expression: z.string() }),
        execute: async ({ expression }) => ({ result: eval(expression) }),
      })

      const agent = createTestAgent([calculatorTool], [
        // Step 1: Model wants to call tool
        {
          text: 'Let me calculate that for you.',
          toolCalls: [{ id: 'calc1', name: 'calculate', arguments: { expression: '2 + 2' } }],
          finishReason: 'tool_calls',
        },
        // Step 2: Model responds with final answer
        {
          text: 'The result is 4.',
          finishReason: 'stop',
        },
      ])

      const result = await agent.run({ prompt: 'What is 2 + 2?' })

      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls[0].name).toBe('calculate')
      expect(result.toolResults).toHaveLength(1)
      expect(result.toolResults[0].result).toEqual({ result: 4 })
      expect(result.text).toBe('The result is 4.')
      expect(result.steps).toBe(2)
    })
  })

  describe('Multiple Sequential Tool Calls', () => {
    it('should handle chain of tool calls', async () => {
      const readTool = tool({
        name: 'read_file',
        description: 'Read a file',
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => ({ content: `Contents of ${path}` }),
      })

      const writeTool = tool({
        name: 'write_file',
        description: 'Write a file',
        inputSchema: z.object({ path: z.string(), content: z.string() }),
        execute: async ({ path, content }) => ({ written: true, path }),
      })

      const agent = createTestAgent([readTool, writeTool], [
        // Step 1: Read the file
        {
          toolCalls: [{ id: 'read1', name: 'read_file', arguments: { path: 'input.txt' } }],
          finishReason: 'tool_calls',
        },
        // Step 2: Write the transformed file
        {
          toolCalls: [{ id: 'write1', name: 'write_file', arguments: { path: 'output.txt', content: 'Transformed' } }],
          finishReason: 'tool_calls',
        },
        // Step 3: Final response
        {
          text: 'I have read the input file and written the output.',
          finishReason: 'stop',
        },
      ])

      const result = await agent.run({ prompt: 'Copy input.txt to output.txt' })

      expect(result.toolCalls).toHaveLength(2)
      expect(result.toolCalls[0].name).toBe('read_file')
      expect(result.toolCalls[1].name).toBe('write_file')
      expect(result.steps).toBe(3)
    })
  })

  describe('Parallel Tool Calls', () => {
    it('should handle multiple tool calls in single step', async () => {
      const fetchTool = tool({
        name: 'fetch_data',
        description: 'Fetch data from API',
        inputSchema: z.object({ endpoint: z.string() }),
        execute: async ({ endpoint }) => ({ data: `Data from ${endpoint}` }),
      })

      const agent = createTestAgent([fetchTool], [
        // Step 1: Multiple parallel tool calls
        {
          text: 'Fetching data from multiple sources...',
          toolCalls: [
            { id: 'fetch1', name: 'fetch_data', arguments: { endpoint: '/users' } },
            { id: 'fetch2', name: 'fetch_data', arguments: { endpoint: '/posts' } },
            { id: 'fetch3', name: 'fetch_data', arguments: { endpoint: '/comments' } },
          ],
          finishReason: 'tool_calls',
        },
        // Step 2: Final response
        {
          text: 'I have fetched data from users, posts, and comments endpoints.',
          finishReason: 'stop',
        },
      ])

      const result = await agent.run({ prompt: 'Fetch all data' })

      expect(result.toolCalls).toHaveLength(3)
      expect(result.toolResults).toHaveLength(3)
      // All tool results should be present
      expect(result.toolResults.map(r => r.result)).toEqual([
        { data: 'Data from /users' },
        { data: 'Data from /posts' },
        { data: 'Data from /comments' },
      ])
    })

    it('should continue even if some parallel calls fail', async () => {
      let callCount = 0
      const sometimesFails = tool({
        name: 'sometimes_fails',
        description: 'May fail',
        inputSchema: z.object({ id: z.string() }),
        execute: async ({ id }) => {
          callCount++
          if (id === 'fail') throw new Error('Intentional failure')
          return { success: true, id }
        },
      })

      const agent = createTestAgent([sometimesFails], [
        {
          toolCalls: [
            { id: 'call1', name: 'sometimes_fails', arguments: { id: 'success1' } },
            { id: 'call2', name: 'sometimes_fails', arguments: { id: 'fail' } },
            { id: 'call3', name: 'sometimes_fails', arguments: { id: 'success2' } },
          ],
          finishReason: 'tool_calls',
        },
        {
          text: 'Two calls succeeded, one failed.',
          finishReason: 'stop',
        },
      ])

      const result = await agent.run({ prompt: 'Run all' })

      expect(result.toolResults).toHaveLength(3)
      expect(result.toolResults[0].result).toEqual({ success: true, id: 'success1' })
      expect(result.toolResults[1].error).toBe('Intentional failure')
      expect(result.toolResults[2].result).toEqual({ success: true, id: 'success2' })
    })
  })

  describe('Tool Result in Messages', () => {
    it('should include tool results in message history', async () => {
      const echoTool = tool({
        name: 'echo',
        description: 'Echo input',
        inputSchema: z.object({ text: z.string() }),
        execute: async ({ text }) => ({ echo: text }),
      })

      const agent = createTestAgent([echoTool], [
        {
          toolCalls: [{ id: 'echo1', name: 'echo', arguments: { text: 'hello' } }],
          finishReason: 'tool_calls',
        },
        {
          text: 'Done',
          finishReason: 'stop',
        },
      ])

      const result = await agent.run({ prompt: 'Echo hello' })

      // Check message history includes tool result
      const toolMessages = result.messages.filter(m => m.role === 'tool')
      expect(toolMessages).toHaveLength(1)
      expect(toolMessages[0].toolCallId).toBe('echo1')
      expect(toolMessages[0].content).toEqual({ echo: 'hello' })
    })

    it('should include error in tool result message', async () => {
      const failTool = tool({
        name: 'fail',
        description: 'Always fails',
        inputSchema: z.object({}),
        execute: async () => { throw new Error('Tool error') },
      })

      const agent = createTestAgent([failTool], [
        {
          toolCalls: [{ id: 'fail1', name: 'fail', arguments: {} }],
          finishReason: 'tool_calls',
        },
        {
          text: 'The tool failed.',
          finishReason: 'stop',
        },
      ])

      const result = await agent.run({ prompt: 'Run fail' })

      const toolMessages = result.messages.filter(m => m.role === 'tool')
      expect(toolMessages).toHaveLength(1)
      expect(toolMessages[0].content).toEqual({ error: 'Tool error' })
    })
  })

  describe('Max Steps Limit', () => {
    it('should stop after max steps', async () => {
      const infiniteTool = tool({
        name: 'infinite',
        description: 'Keeps calling itself',
        inputSchema: z.object({}),
        execute: async () => ({ continue: true }),
      })

      // Always returns tool call
      const infiniteResponses = Array(20).fill({
        toolCalls: [{ id: 'inf', name: 'infinite', arguments: {} }],
        finishReason: 'tool_calls',
      })

      const agent = createTestAgent([infiniteTool], infiniteResponses)
      // Override maxSteps
      ;(agent as any).config.maxSteps = 5

      const result = await agent.run({ prompt: 'Loop forever' })

      expect(result.steps).toBeLessThanOrEqual(5)
      expect(result.finishReason).toBe('max_steps')
    })
  })
})

// ============================================================================
// Tool Hooks Tests
// ============================================================================

describe('Tool Hooks', () => {
  describe('onPreToolUse', () => {
    it('should allow denying tool execution', async () => {
      const deleteTool = tool({
        name: 'delete_all',
        description: 'Dangerous delete',
        inputSchema: z.object({}),
        execute: async () => ({ deleted: true }),
      })

      const mockGenerate = vi.fn().mockResolvedValueOnce({
        toolCalls: [{ id: 'del1', name: 'delete_all', arguments: {} }],
        finishReason: 'tool_calls',
      }).mockResolvedValueOnce({
        text: 'Could not delete.',
        finishReason: 'stop',
      })

      const agent = new BaseAgent({
        config: {
          id: 'test',
          name: 'Test',
          instructions: '',
          model: 'test',
          tools: [deleteTool],
        },
        provider: { name: 'test', version: '1.0', createAgent: () => null as any },
        generate: mockGenerate,
        hooks: {
          onPreToolUse: async (toolCall) => {
            if (toolCall.name === 'delete_all') {
              return { action: 'deny', reason: 'Dangerous operation not allowed' }
            }
            return { action: 'allow' }
          },
        },
      })

      const result = await agent.run({ prompt: 'Delete everything' })

      // Tool should have been denied
      expect(result.toolResults[0].error).toBe('Dangerous operation not allowed')
      expect(result.toolResults[0].result).toBeNull()
    })

    it('should allow modifying tool arguments', async () => {
      const capturedArgs = vi.fn()

      const searchTool = tool({
        name: 'search',
        description: 'Search',
        inputSchema: z.object({
          query: z.string(),
          limit: z.number(),
        }),
        execute: async (input) => {
          capturedArgs(input)
          return { results: [] }
        },
      })

      const mockGenerate = vi.fn().mockResolvedValueOnce({
        toolCalls: [{ id: 's1', name: 'search', arguments: { query: 'test', limit: 1000 } }],
        finishReason: 'tool_calls',
      }).mockResolvedValueOnce({
        text: 'Done',
        finishReason: 'stop',
      })

      const agent = new BaseAgent({
        config: {
          id: 'test',
          name: 'Test',
          instructions: '',
          model: 'test',
          tools: [searchTool],
        },
        provider: { name: 'test', version: '1.0', createAgent: () => null as any },
        generate: mockGenerate,
        hooks: {
          onPreToolUse: async (toolCall) => {
            // Limit to max 100 results
            if (toolCall.name === 'search' && toolCall.arguments.limit > 100) {
              return {
                action: 'modify',
                arguments: { ...toolCall.arguments, limit: 100 },
              }
            }
            return { action: 'allow' }
          },
        },
      })

      await agent.run({ prompt: 'Search for test' })

      expect(capturedArgs).toHaveBeenCalledWith({ query: 'test', limit: 100 })
    })
  })

  describe('onPostToolUse', () => {
    it('should receive tool call and result', async () => {
      const postHook = vi.fn()

      const simpleTool = tool({
        name: 'simple',
        description: 'Simple',
        inputSchema: z.object({ value: z.string() }),
        execute: async ({ value }) => ({ processed: value.toUpperCase() }),
      })

      const mockGenerate = vi.fn().mockResolvedValueOnce({
        toolCalls: [{ id: 't1', name: 'simple', arguments: { value: 'test' } }],
        finishReason: 'tool_calls',
      }).mockResolvedValueOnce({
        text: 'Done',
        finishReason: 'stop',
      })

      const agent = new BaseAgent({
        config: {
          id: 'test',
          name: 'Test',
          instructions: '',
          model: 'test',
          tools: [simpleTool],
        },
        provider: { name: 'test', version: '1.0', createAgent: () => null as any },
        generate: mockGenerate,
        hooks: {
          onPostToolUse: postHook,
        },
      })

      await agent.run({ prompt: 'Process test' })

      expect(postHook).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'simple', arguments: { value: 'test' } }),
        expect.objectContaining({ result: { processed: 'TEST' } })
      )
    })
  })
})

// ============================================================================
// Tool Permission Tests
// ============================================================================

describe('Tool Permissions', () => {
  it('should respect permission: deny', async () => {
    const deniedTool = tool({
      name: 'denied',
      description: 'This tool is denied',
      inputSchema: z.object({}),
      permission: 'deny',
      execute: async () => ({ should: 'not run' }),
    })

    const result = await executeToolWithPermissionCheck(deniedTool, {
      id: 'call',
      name: 'denied',
      arguments: {},
    })

    expect(result.error).toContain('denied')
    expect(result.result).toBeNull()
  })

  it('should auto-approve permission: auto', async () => {
    const autoTool = tool({
      name: 'auto',
      description: 'Auto approved',
      inputSchema: z.object({}),
      permission: 'auto',
      execute: async () => ({ ran: true }),
    })

    const result = await executeToolWithPermissionCheck(autoTool, {
      id: 'call',
      name: 'auto',
      arguments: {},
    })

    expect(result.result).toEqual({ ran: true })
    expect(result.error).toBeUndefined()
  })

  it('should request confirmation for permission: confirm', async () => {
    const confirmTool = tool({
      name: 'confirm',
      description: 'Needs confirmation',
      inputSchema: z.object({ action: z.string() }),
      permission: 'confirm',
      execute: async () => ({ confirmed: true }),
    })

    // With approval
    const approved = await executeToolWithPermissionCheck(
      confirmTool,
      { id: 'call', name: 'confirm', arguments: { action: 'delete' } },
      { onConfirm: async () => true }
    )
    expect(approved.result).toEqual({ confirmed: true })

    // Without approval
    const denied = await executeToolWithPermissionCheck(
      confirmTool,
      { id: 'call', name: 'confirm', arguments: { action: 'delete' } },
      { onConfirm: async () => false }
    )
    expect(denied.error).toContain('denied')
  })
})

// ============================================================================
// Helper Functions (to be implemented in GREEN phase)
// ============================================================================

/**
 * Convert tool definition to OpenAI function format
 * @param tool - Tool definition
 * @param options - Conversion options
 */
function convertToOpenAIFormat(
  tool: ToolDefinition,
  options?: { strict?: boolean }
): {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: any
    strict?: boolean
  }
} {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented: convertToOpenAIFormat')
}

/**
 * Convert tool definition to Claude/Anthropic format
 * @param tool - Tool definition
 * @param options - Conversion options
 */
function convertToClaudeFormat(
  tool: ToolDefinition,
  options?: { cacheControl?: { type: string } }
): {
  name: string
  description: string
  input_schema: any
  cache_control?: { type: string }
} {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented: convertToClaudeFormat')
}

/**
 * Convert tool definition to provider-specific format
 * @param tool - Tool definition
 * @param provider - Provider name
 */
function convertToolForProvider(
  tool: ToolDefinition,
  provider: 'openai' | 'claude' | 'vercel'
): any {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented: convertToolForProvider')
}

/**
 * Execute a tool call
 * @param tool - Tool definition
 * @param toolCall - Tool call from model
 * @param context - Execution context
 */
async function executeToolCall(
  tool: ToolDefinition,
  toolCall: ToolCall,
  context?: ToolContext
): Promise<ToolResult> {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented: executeToolCall')
}

/**
 * Execute a tool call from a list of tools
 * @param tools - Available tools
 * @param toolCall - Tool call from model
 * @param context - Execution context
 */
async function executeToolCallFromList(
  tools: ToolDefinition[],
  toolCall: ToolCall,
  context?: ToolContext
): Promise<ToolResult> {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented: executeToolCallFromList')
}

/**
 * Execute tool with permission checking
 * @param tool - Tool definition
 * @param toolCall - Tool call from model
 * @param options - Permission check options
 */
async function executeToolWithPermissionCheck(
  tool: ToolDefinition,
  toolCall: ToolCall,
  options?: { onConfirm?: () => Promise<boolean> }
): Promise<ToolResult> {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented: executeToolWithPermissionCheck')
}
