/**
 * AI Agent Fallback Tests (TDD RED Phase)
 *
 * Tests for AI SDK 6 ToolLoopAgent integration with DO's MCP endpoint.
 * These tests are written BEFORE implementation exists and should FAIL.
 *
 * The agent provides:
 * - Connection to DO's MCP via HTTP transport
 * - ToolLoopAgent with MCP tools for natural language processing
 * - Execution limiting via stepCountIs stop condition
 * - Console output for agent responses
 * - Graceful error handling for MCP failures
 *
 * Implementation location: cli/agent.ts
 *
 * @see https://ai-sdk.dev/docs/agents/tool-loop-agent
 * @see https://modelcontextprotocol.io/docs/concepts/transports
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Mock Setup - Mock external dependencies before importing module under test
// ============================================================================

// Mock the 'ai' package - these exports don't exist yet but we're testing against them
vi.mock('ai', () => ({
  ToolLoopAgent: vi.fn(),
  createMCPClient: vi.fn(),
  stepCountIs: vi.fn(),
}))

// Mock the '@ai-sdk/cloudflare' package
vi.mock('@ai-sdk/cloudflare', () => ({
  cloudflare: vi.fn(),
}))

// ============================================================================
// Import the agent module (will fail - module doesn't exist yet)
// ============================================================================

import { runAgent, createAgentWithMCP, AgentConfig } from '../agent'

// Import mocked modules for assertions
import { ToolLoopAgent, createMCPClient, stepCountIs } from 'ai'
import { cloudflare } from '@ai-sdk/cloudflare'

// ============================================================================
// Type Definitions for Tests
// ============================================================================

interface MockMCPClient {
  tools: () => Promise<MockTool[]>
  close: () => Promise<void>
}

interface MockTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

interface MockAgentResult {
  text: string
  steps: number
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>
}

interface MockAgent {
  generate: (options: { prompt: string }) => Promise<MockAgentResult>
}

// ============================================================================
// Helper Functions
// ============================================================================

function createMockMCPClient(tools: MockTool[] = []): MockMCPClient {
  return {
    tools: vi.fn().mockResolvedValue(tools),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

function createMockAgent(result: Partial<MockAgentResult> = {}): MockAgent {
  return {
    generate: vi.fn().mockResolvedValue({
      text: result.text ?? 'Agent response',
      steps: result.steps ?? 1,
      toolCalls: result.toolCalls ?? [],
    }),
  }
}

// ============================================================================
// MCP Client Connection Tests
// ============================================================================

describe('MCP Client Connection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createMCPClient configuration', () => {
    it('creates MCP client with DO URL', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
      vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

      const doUrl = 'https://my-app.do.dev'
      await runAgent('list users', doUrl)

      expect(createMCPClient).toHaveBeenCalled()
      const callArgs = vi.mocked(createMCPClient).mock.calls[0][0]
      expect(callArgs).toHaveProperty('transport')
    })

    it('uses HTTP transport for MCP client', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
      vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

      await runAgent('test input', 'https://example.do.dev')

      const callArgs = vi.mocked(createMCPClient).mock.calls[0][0]
      expect(callArgs.transport).toBeDefined()
      expect(typeof callArgs.transport.send).toBe('function')
    })

    it('transport sends POST request to DO /mcp endpoint', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
      vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

      const mockFetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ result: {} }),
      })
      global.fetch = mockFetch

      await runAgent('test', 'https://api.do.dev')

      // Verify transport was configured to use fetch
      const transport = vi.mocked(createMCPClient).mock.calls[0][0].transport
      await transport.send({ method: 'test' })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.do.dev/mcp',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )
    })

    it('transport serializes messages as JSON', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
      vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

      const mockFetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ result: {} }),
      })
      global.fetch = mockFetch

      await runAgent('test', 'https://api.do.dev')

      const transport = vi.mocked(createMCPClient).mock.calls[0][0].transport
      const testMessage = { jsonrpc: '2.0', method: 'tools/list', id: 1 }
      await transport.send(testMessage)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(testMessage),
        })
      )
    })
  })

  describe('tool retrieval', () => {
    it('retrieves tools from MCP client', async () => {
      const mockTools: MockTool[] = [
        { name: 'create_user', description: 'Creates a user', inputSchema: {} },
        { name: 'list_users', description: 'Lists all users', inputSchema: {} },
      ]
      const mockClient = createMockMCPClient(mockTools)
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
      vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

      await runAgent('list all users', 'https://api.do.dev')

      expect(mockClient.tools).toHaveBeenCalled()
    })

    it('passes retrieved tools to ToolLoopAgent', async () => {
      const mockTools: MockTool[] = [
        { name: 'echo', description: 'Echoes input', inputSchema: { type: 'object' } },
      ]
      const mockClient = createMockMCPClient(mockTools)
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
      vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

      await runAgent('echo hello', 'https://api.do.dev')

      expect(ToolLoopAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: mockTools,
        })
      )
    })
  })

  describe('client cleanup', () => {
    it('closes MCP client after agent execution', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
      vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

      await runAgent('test', 'https://api.do.dev')

      expect(mockClient.close).toHaveBeenCalled()
    })

    it('closes MCP client even if agent throws', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)

      const failingAgent = {
        generate: vi.fn().mockRejectedValue(new Error('Agent failed')),
      }
      vi.mocked(ToolLoopAgent).mockReturnValue(failingAgent as unknown as InstanceType<typeof ToolLoopAgent>)

      await expect(runAgent('test', 'https://api.do.dev')).rejects.toThrow()

      expect(mockClient.close).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// ToolLoopAgent Creation Tests
// ============================================================================

describe('ToolLoopAgent Creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('agent configuration', () => {
    it('creates ToolLoopAgent with cloudflare model', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
      vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

      const mockModel = { id: 'llama-3.3-70b-instruct-fp8-fast' }
      vi.mocked(cloudflare).mockReturnValue(mockModel as ReturnType<typeof cloudflare>)

      await runAgent('test prompt', 'https://api.do.dev')

      expect(cloudflare).toHaveBeenCalledWith('llama-3.3-70b-instruct-fp8-fast')
      expect(ToolLoopAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: mockModel,
        })
      )
    })

    it('provides system instructions to agent', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
      vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

      await runAgent('help me', 'https://api.do.dev')

      expect(ToolLoopAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          instructions: expect.any(String),
        })
      )

      const instructions = vi.mocked(ToolLoopAgent).mock.calls[0][0].instructions
      expect(instructions.length).toBeGreaterThan(0)
    })

    it('configures stopWhen with stepCountIs', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
      vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

      const mockStopCondition = { type: 'stepCount', count: 10 }
      vi.mocked(stepCountIs).mockReturnValue(mockStopCondition as ReturnType<typeof stepCountIs>)

      await runAgent('test', 'https://api.do.dev')

      expect(stepCountIs).toHaveBeenCalledWith(10)
      expect(ToolLoopAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          stopWhen: mockStopCondition,
        })
      )
    })

    it('defaults to 10 max steps', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
      vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

      await runAgent('test', 'https://api.do.dev')

      expect(stepCountIs).toHaveBeenCalledWith(10)
    })
  })

  describe('custom configuration', () => {
    it('allows custom max steps via config', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
      vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

      const config: AgentConfig = { maxSteps: 5 }
      await runAgent('test', 'https://api.do.dev', config)

      expect(stepCountIs).toHaveBeenCalledWith(5)
    })

    it('allows custom model via config', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
      vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

      const config: AgentConfig = { model: 'gpt-4o' }
      await runAgent('test', 'https://api.do.dev', config)

      expect(cloudflare).toHaveBeenCalledWith('gpt-4o')
    })

    it('allows custom instructions via config', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
      vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

      const customInstructions = 'You are a helpful database assistant.'
      const config: AgentConfig = { instructions: customInstructions }
      await runAgent('test', 'https://api.do.dev', config)

      expect(ToolLoopAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          instructions: customInstructions,
        })
      )
    })
  })
})

// ============================================================================
// Agent Execution Tests
// ============================================================================

describe('Agent Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generate call', () => {
    it('calls agent.generate with user input', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)

      const mockAgent = createMockAgent()
      vi.mocked(ToolLoopAgent).mockReturnValue(mockAgent as unknown as InstanceType<typeof ToolLoopAgent>)

      await runAgent('create a new user named John', 'https://api.do.dev')

      expect(mockAgent.generate).toHaveBeenCalledWith({
        prompt: 'create a new user named John',
      })
    })

    it('passes exact user input without modification', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)

      const mockAgent = createMockAgent()
      vi.mocked(ToolLoopAgent).mockReturnValue(mockAgent as unknown as InstanceType<typeof ToolLoopAgent>)

      const complexInput = 'Create a user with email "test@example.com" and role "admin"'
      await runAgent(complexInput, 'https://api.do.dev')

      expect(mockAgent.generate).toHaveBeenCalledWith({
        prompt: complexInput,
      })
    })
  })

  describe('result handling', () => {
    it('returns agent result text', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)

      const mockAgent = createMockAgent({ text: 'User created successfully!' })
      vi.mocked(ToolLoopAgent).mockReturnValue(mockAgent as unknown as InstanceType<typeof ToolLoopAgent>)

      const result = await runAgent('create user', 'https://api.do.dev')

      expect(result).toBe('User created successfully!')
    })

    it('handles multi-step agent execution', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)

      const mockAgent = createMockAgent({
        text: 'Task completed',
        steps: 3,
        toolCalls: [
          { name: 'list_users', args: {} },
          { name: 'create_user', args: { name: 'John' } },
          { name: 'notify', args: { message: 'Done' } },
        ],
      })
      vi.mocked(ToolLoopAgent).mockReturnValue(mockAgent as unknown as InstanceType<typeof ToolLoopAgent>)

      const result = await runAgent('create user and notify', 'https://api.do.dev')

      expect(result).toBe('Task completed')
    })
  })
})

// ============================================================================
// Console Output Tests
// ============================================================================

describe('Console Output', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('prints agent result text to console', async () => {
    const mockClient = createMockMCPClient()
    vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)

    const mockAgent = createMockAgent({ text: 'Here is the result' })
    vi.mocked(ToolLoopAgent).mockReturnValue(mockAgent as unknown as InstanceType<typeof ToolLoopAgent>)

    await runAgent('test query', 'https://api.do.dev')

    expect(consoleSpy).toHaveBeenCalledWith('Here is the result')
  })

  it('handles empty result text', async () => {
    const mockClient = createMockMCPClient()
    vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)

    const mockAgent = createMockAgent({ text: '' })
    vi.mocked(ToolLoopAgent).mockReturnValue(mockAgent as unknown as InstanceType<typeof ToolLoopAgent>)

    await runAgent('test', 'https://api.do.dev')

    // Should still call console.log, even with empty string
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('handles multiline result text', async () => {
    const mockClient = createMockMCPClient()
    vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)

    const multilineText = 'Line 1\nLine 2\nLine 3'
    const mockAgent = createMockAgent({ text: multilineText })
    vi.mocked(ToolLoopAgent).mockReturnValue(mockAgent as unknown as InstanceType<typeof ToolLoopAgent>)

    await runAgent('test', 'https://api.do.dev')

    expect(consoleSpy).toHaveBeenCalledWith(multilineText)
  })
})

// ============================================================================
// Stop Condition Tests
// ============================================================================

describe('Stop Conditions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stops execution at max step count', async () => {
    const mockClient = createMockMCPClient()
    vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)

    const mockStopCondition = { type: 'stepCount', count: 10 }
    vi.mocked(stepCountIs).mockReturnValue(mockStopCondition as ReturnType<typeof stepCountIs>)

    const mockAgent = createMockAgent()
    vi.mocked(ToolLoopAgent).mockReturnValue(mockAgent as unknown as InstanceType<typeof ToolLoopAgent>)

    await runAgent('complex task', 'https://api.do.dev')

    // Verify stopWhen was passed to agent
    expect(ToolLoopAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        stopWhen: mockStopCondition,
      })
    )
  })

  it('uses stepCountIs helper for stop condition', async () => {
    const mockClient = createMockMCPClient()
    vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
    vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

    await runAgent('test', 'https://api.do.dev')

    expect(stepCountIs).toHaveBeenCalled()
  })

  it('respects custom maxSteps configuration', async () => {
    const mockClient = createMockMCPClient()
    vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
    vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

    await runAgent('test', 'https://api.do.dev', { maxSteps: 20 })

    expect(stepCountIs).toHaveBeenCalledWith(20)
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('MCP connection failures', () => {
    it('throws when MCP client creation fails', async () => {
      vi.mocked(createMCPClient).mockRejectedValue(new Error('Connection refused'))

      await expect(runAgent('test', 'https://invalid.do.dev')).rejects.toThrow(
        'Connection refused'
      )
    })

    it('throws descriptive error for network failures', async () => {
      vi.mocked(createMCPClient).mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(runAgent('test', 'https://api.do.dev')).rejects.toThrow()
    })

    it('handles timeout errors', async () => {
      vi.mocked(createMCPClient).mockRejectedValue(new Error('Request timeout'))

      await expect(runAgent('test', 'https://slow.do.dev')).rejects.toThrow(
        'timeout'
      )
    })
  })

  describe('tool retrieval failures', () => {
    it('throws when tools() call fails', async () => {
      const mockClient = {
        tools: vi.fn().mockRejectedValue(new Error('Failed to fetch tools')),
        close: vi.fn().mockResolvedValue(undefined),
      }
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)

      await expect(runAgent('test', 'https://api.do.dev')).rejects.toThrow(
        'Failed to fetch tools'
      )
    })

    it('still closes client when tools() fails', async () => {
      const mockClient = {
        tools: vi.fn().mockRejectedValue(new Error('Tools error')),
        close: vi.fn().mockResolvedValue(undefined),
      }
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)

      await expect(runAgent('test', 'https://api.do.dev')).rejects.toThrow()

      expect(mockClient.close).toHaveBeenCalled()
    })
  })

  describe('agent execution failures', () => {
    it('throws when agent.generate fails', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)

      const mockAgent = {
        generate: vi.fn().mockRejectedValue(new Error('Model error')),
      }
      vi.mocked(ToolLoopAgent).mockReturnValue(mockAgent as unknown as InstanceType<typeof ToolLoopAgent>)

      await expect(runAgent('test', 'https://api.do.dev')).rejects.toThrow(
        'Model error'
      )
    })

    it('handles rate limiting errors', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)

      const mockAgent = {
        generate: vi.fn().mockRejectedValue(new Error('Rate limit exceeded')),
      }
      vi.mocked(ToolLoopAgent).mockReturnValue(mockAgent as unknown as InstanceType<typeof ToolLoopAgent>)

      await expect(runAgent('test', 'https://api.do.dev')).rejects.toThrow(
        'Rate limit'
      )
    })

    it('handles tool execution errors gracefully', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)

      const mockAgent = {
        generate: vi.fn().mockRejectedValue(new Error('Tool execution failed: create_user')),
      }
      vi.mocked(ToolLoopAgent).mockReturnValue(mockAgent as unknown as InstanceType<typeof ToolLoopAgent>)

      await expect(runAgent('test', 'https://api.do.dev')).rejects.toThrow(
        'Tool execution failed'
      )
    })
  })

  describe('invalid input handling', () => {
    it('handles empty input string', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)

      const mockAgent = createMockAgent({ text: 'Please provide a query' })
      vi.mocked(ToolLoopAgent).mockReturnValue(mockAgent as unknown as InstanceType<typeof ToolLoopAgent>)

      const result = await runAgent('', 'https://api.do.dev')

      expect(result).toBeDefined()
    })

    it('handles whitespace-only input', async () => {
      const mockClient = createMockMCPClient()
      vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)

      const mockAgent = createMockAgent()
      vi.mocked(ToolLoopAgent).mockReturnValue(mockAgent as unknown as InstanceType<typeof ToolLoopAgent>)

      await expect(runAgent('   ', 'https://api.do.dev')).resolves.not.toThrow()
    })

    it('throws for invalid DO URL', async () => {
      vi.mocked(createMCPClient).mockRejectedValue(new Error('Invalid URL'))

      await expect(runAgent('test', 'not-a-url')).rejects.toThrow()
    })
  })
})

// ============================================================================
// createAgentWithMCP Factory Tests
// ============================================================================

describe('createAgentWithMCP Factory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports createAgentWithMCP function', () => {
    expect(createAgentWithMCP).toBeDefined()
    expect(typeof createAgentWithMCP).toBe('function')
  })

  it('returns agent instance with pre-configured MCP', async () => {
    const mockClient = createMockMCPClient()
    vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
    vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

    const agent = await createAgentWithMCP('https://api.do.dev')

    expect(agent).toBeDefined()
    expect(typeof agent.generate).toBe('function')
  })

  it('allows multiple generate calls on same agent', async () => {
    const mockClient = createMockMCPClient()
    vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)

    const mockAgent = createMockAgent()
    vi.mocked(ToolLoopAgent).mockReturnValue(mockAgent as unknown as InstanceType<typeof ToolLoopAgent>)

    const agent = await createAgentWithMCP('https://api.do.dev')

    await agent.generate({ prompt: 'first query' })
    await agent.generate({ prompt: 'second query' })

    expect(mockAgent.generate).toHaveBeenCalledTimes(2)
  })

  it('provides close method to cleanup MCP connection', async () => {
    const mockClient = createMockMCPClient()
    vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
    vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

    const agent = await createAgentWithMCP('https://api.do.dev')

    expect(agent.close).toBeDefined()
    await agent.close()

    expect(mockClient.close).toHaveBeenCalled()
  })
})

// ============================================================================
// AgentConfig Type Tests
// ============================================================================

describe('AgentConfig Type', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts empty config object', async () => {
    const mockClient = createMockMCPClient()
    vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
    vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

    await expect(runAgent('test', 'https://api.do.dev', {})).resolves.not.toThrow()
  })

  it('accepts partial config with only maxSteps', async () => {
    const mockClient = createMockMCPClient()
    vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
    vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

    await expect(
      runAgent('test', 'https://api.do.dev', { maxSteps: 5 })
    ).resolves.not.toThrow()
  })

  it('accepts partial config with only model', async () => {
    const mockClient = createMockMCPClient()
    vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
    vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

    await expect(
      runAgent('test', 'https://api.do.dev', { model: 'custom-model' })
    ).resolves.not.toThrow()
  })

  it('accepts full config object', async () => {
    const mockClient = createMockMCPClient()
    vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)
    vi.mocked(ToolLoopAgent).mockReturnValue(createMockAgent() as unknown as InstanceType<typeof ToolLoopAgent>)

    const fullConfig: AgentConfig = {
      maxSteps: 15,
      model: 'gpt-4o',
      instructions: 'Custom instructions here',
    }

    await expect(
      runAgent('test', 'https://api.do.dev', fullConfig)
    ).resolves.not.toThrow()
  })
})

// ============================================================================
// Integration Flow Tests
// ============================================================================

describe('Integration Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('complete flow: connect -> get tools -> create agent -> generate -> close', async () => {
    // Setup mocks
    const mockTools: MockTool[] = [
      { name: 'echo', description: 'Echo tool', inputSchema: {} },
    ]
    const mockClient = createMockMCPClient(mockTools)
    vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)

    const mockStopCondition = { type: 'stepCount', count: 10 }
    vi.mocked(stepCountIs).mockReturnValue(mockStopCondition as ReturnType<typeof stepCountIs>)

    const mockModel = { id: 'test-model' }
    vi.mocked(cloudflare).mockReturnValue(mockModel as ReturnType<typeof cloudflare>)

    const mockAgent = createMockAgent({ text: 'Success!' })
    vi.mocked(ToolLoopAgent).mockReturnValue(mockAgent as unknown as InstanceType<typeof ToolLoopAgent>)

    // Execute
    const result = await runAgent('test input', 'https://api.do.dev')

    // Verify flow
    expect(createMCPClient).toHaveBeenCalledTimes(1)
    expect(mockClient.tools).toHaveBeenCalledTimes(1)
    expect(ToolLoopAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mockModel,
        tools: mockTools,
        stopWhen: mockStopCondition,
      })
    )
    expect(mockAgent.generate).toHaveBeenCalledWith({ prompt: 'test input' })
    expect(mockClient.close).toHaveBeenCalledTimes(1)
    expect(result).toBe('Success!')
  })

  it('handles natural language CLI fallback scenario', async () => {
    const mockTools: MockTool[] = [
      { name: 'create_user', description: 'Creates a new user', inputSchema: {} },
      { name: 'list_users', description: 'Lists all users', inputSchema: {} },
    ]
    const mockClient = createMockMCPClient(mockTools)
    vi.mocked(createMCPClient).mockResolvedValue(mockClient as unknown as ReturnType<typeof createMCPClient>)

    const mockAgent = createMockAgent({
      text: 'Created user John with ID 123',
      toolCalls: [{ name: 'create_user', args: { name: 'John' } }],
    })
    vi.mocked(ToolLoopAgent).mockReturnValue(mockAgent as unknown as InstanceType<typeof ToolLoopAgent>)

    // This simulates the CLI fallback: unknown command -> AI agent
    const result = await runAgent('create a user named John', 'https://my-app.do.dev')

    expect(result).toContain('John')
    expect(mockAgent.generate).toHaveBeenCalledWith({
      prompt: 'create a user named John',
    })
  })
})
