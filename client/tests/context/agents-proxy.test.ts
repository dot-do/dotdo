/**
 * RED Phase Tests for $.agents[name].run() Pattern
 *
 * Tests for the agents proxy that enables named agent execution through
 * the workflow context:
 *
 *   const result = await $.agents.priya.run({ prompt: 'Define MVP' })
 *   const code = await $.agents.ralph.run({ prompt: 'Build the feature' })
 *
 * Named agents:
 * - priya: Product - specs, roadmaps
 * - ralph: Engineering - builds code
 * - tom: Tech Lead - architecture, review
 * - mark: Marketing - content, launches
 * - sally: Sales - outreach, closing
 * - quinn: QA - testing, quality
 *
 * These tests should FAIL initially (RED phase of TDD).
 * The proxy factory should be createAgentsProxy(config).
 *
 * @see agents/named/ for agent implementations
 * @see Issue: dotdo-1bkyw
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The import that should fail until implementation exists
import { createAgentsProxy, type AgentsProxyConfig, type AgentRunInput, type AgentRunResult } from '../../../client/context/agents-proxy'

// ============================================================================
// Test Mocks & Setup
// ============================================================================

interface MockContext {
  db: {
    query: ReturnType<typeof vi.fn>
    insert: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  api: {
    call: ReturnType<typeof vi.fn>
    fetch: ReturnType<typeof vi.fn>
  }
  escalate: ReturnType<typeof vi.fn>
}

function createMockContext(): MockContext {
  return {
    db: {
      query: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockResolvedValue({ id: 'test-id' }),
      update: vi.fn().mockResolvedValue({ updated: true }),
    },
    api: {
      call: vi.fn().mockResolvedValue({ success: true }),
      fetch: vi.fn().mockResolvedValue({ data: {} }),
    },
    escalate: vi.fn().mockResolvedValue({ approved: true, by: 'human' }),
  }
}

function createMockAgentRunner() {
  return vi.fn().mockResolvedValue({
    text: 'Agent response',
    toolCalls: [],
    toolResults: [],
    steps: 1,
    finishReason: 'stop' as const,
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  })
}

// ============================================================================
// $.agents.priya.run(input) executes agent
// ============================================================================

describe('$.agents[name].run() executes agent', () => {
  let mockContext: MockContext
  let mockRunner: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockContext = createMockContext()
    mockRunner = createMockAgentRunner()
  })

  it('$.agents returns a proxy object', () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    expect(agents).toBeDefined()
    expect(typeof agents).toBe('object')
  })

  it('$.agents.priya returns an agent proxy', () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    expect(agents.priya).toBeDefined()
  })

  it('$.agents.priya.run is a function', () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    expect(typeof agents.priya.run).toBe('function')
  })

  it('$.agents.priya.run(input) returns a Promise', () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    const result = agents.priya.run({ prompt: 'Define the MVP' })

    expect(result).toBeInstanceOf(Promise)
  })

  it('$.agents.priya.run(input) executes the agent runner', async () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    await agents.priya.run({ prompt: 'Define the MVP for our product' })

    expect(mockRunner).toHaveBeenCalled()
  })

  it('$.agents.priya.run passes agent name to runner', async () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    await agents.priya.run({ prompt: 'Define requirements' })

    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({ agentName: 'priya' }),
      expect.anything()
    )
  })

  it('$.agents.ralph.run passes agent name for ralph', async () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    await agents.ralph.run({ prompt: 'Build the feature' })

    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({ agentName: 'ralph' }),
      expect.anything()
    )
  })

  it('all named agents are accessible', () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    // All six named agents should be accessible
    expect(agents.priya).toBeDefined()
    expect(agents.ralph).toBeDefined()
    expect(agents.tom).toBeDefined()
    expect(agents.mark).toBeDefined()
    expect(agents.sally).toBeDefined()
    expect(agents.quinn).toBeDefined()
  })

  it('returns agent result from runner', async () => {
    const expectedResult: AgentRunResult = {
      text: 'MVP specification complete',
      toolCalls: [],
      toolResults: [],
      steps: 2,
      finishReason: 'stop',
      usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
    }
    mockRunner.mockResolvedValue(expectedResult)

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    const result = await agents.priya.run({ prompt: 'Define MVP' })

    expect(result).toEqual(expectedResult)
  })
})

// ============================================================================
// Agent receives tools from context
// ============================================================================

describe('Agent receives tools from context', () => {
  let mockContext: MockContext
  let mockRunner: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockContext = createMockContext()
    mockRunner = createMockAgentRunner()
  })

  it('agent runner receives context with tools', async () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    await agents.priya.run({ prompt: 'Create spec' })

    expect(mockRunner).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        context: expect.objectContaining({
          db: expect.anything(),
          api: expect.anything(),
        }),
      })
    )
  })

  it('custom tools can be passed in run input', async () => {
    const customTool = {
      name: 'customTool',
      description: 'A custom tool',
      inputSchema: { type: 'object' as const, properties: {} },
      execute: vi.fn().mockResolvedValue({ result: 'custom' }),
    }

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    await agents.ralph.run({
      prompt: 'Build feature',
      tools: [customTool],
    })

    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([customTool]),
      }),
      expect.anything()
    )
  })

  it('tools from config are merged with run input tools', async () => {
    const configTool = {
      name: 'configTool',
      description: 'A config tool',
      inputSchema: { type: 'object' as const, properties: {} },
      execute: vi.fn(),
    }
    const inputTool = {
      name: 'inputTool',
      description: 'An input tool',
      inputSchema: { type: 'object' as const, properties: {} },
      execute: vi.fn(),
    }

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      defaultTools: [configTool],
    }
    const agents = createAgentsProxy(config)

    await agents.tom.run({
      prompt: 'Review architecture',
      tools: [inputTool],
    })

    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([configTool, inputTool]),
      }),
      expect.anything()
    )
  })
})

// ============================================================================
// Agent can call $.db operations
// ============================================================================

describe('Agent can call $.db operations', () => {
  let mockContext: MockContext
  let mockRunner: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockContext = createMockContext()
    mockRunner = createMockAgentRunner()
  })

  it('agent receives db tools for querying', async () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      enableDbTools: true,
    }
    const agents = createAgentsProxy(config)

    await agents.priya.run({ prompt: 'Query existing specs' })

    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'db_query' }),
        ]),
      }),
      expect.anything()
    )
  })

  it('agent receives db tools for mutations', async () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      enableDbTools: true,
    }
    const agents = createAgentsProxy(config)

    await agents.ralph.run({ prompt: 'Save the code' })

    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'db_insert' }),
          expect.objectContaining({ name: 'db_update' }),
        ]),
      }),
      expect.anything()
    )
  })

  it('db tools are bound to context.db', async () => {
    mockRunner.mockImplementation(async (input, ctx) => {
      // Simulate agent calling the db_query tool
      const dbQueryTool = input.tools?.find((t: { name: string }) => t.name === 'db_query')
      if (dbQueryTool) {
        await dbQueryTool.execute({ query: 'SELECT * FROM specs' }, {})
      }
      return {
        text: 'Queried database',
        toolCalls: [],
        toolResults: [],
        steps: 1,
        finishReason: 'stop' as const,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      }
    })

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      enableDbTools: true,
    }
    const agents = createAgentsProxy(config)

    await agents.priya.run({ prompt: 'Query specs' })

    expect(mockContext.db.query).toHaveBeenCalled()
  })
})

// ============================================================================
// Agent can call $.api integrations
// ============================================================================

describe('Agent can call $.api integrations', () => {
  let mockContext: MockContext
  let mockRunner: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockContext = createMockContext()
    mockRunner = createMockAgentRunner()
  })

  it('agent receives api tools when enabled', async () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      enableApiTools: true,
    }
    const agents = createAgentsProxy(config)

    await agents.mark.run({ prompt: 'Post to social media' })

    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'api_call' }),
        ]),
      }),
      expect.anything()
    )
  })

  it('agent can make HTTP requests through api tools', async () => {
    mockRunner.mockImplementation(async (input, ctx) => {
      const apiTool = input.tools?.find((t: { name: string }) => t.name === 'api_fetch')
      if (apiTool) {
        await apiTool.execute({ url: 'https://api.example.com/data' }, {})
      }
      return {
        text: 'Fetched data',
        toolCalls: [],
        toolResults: [],
        steps: 1,
        finishReason: 'stop' as const,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      }
    })

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      enableApiTools: true,
    }
    const agents = createAgentsProxy(config)

    await agents.sally.run({ prompt: 'Fetch customer data' })

    expect(mockContext.api.fetch).toHaveBeenCalled()
  })

  it('api tools respect allowed domains configuration', async () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      enableApiTools: true,
      apiAllowedDomains: ['api.example.com', 'internal.corp'],
    }
    const agents = createAgentsProxy(config)

    await agents.sally.run({ prompt: 'Call API' })

    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        apiAllowedDomains: ['api.example.com', 'internal.corp'],
      }),
      expect.anything()
    )
  })
})

// ============================================================================
// Streaming agent output (async iterator)
// ============================================================================

describe('Streaming agent output (async iterator)', () => {
  let mockContext: MockContext
  let mockRunner: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockContext = createMockContext()
    mockRunner = createMockAgentRunner()
  })

  it('$.agents.priya.stream returns an async iterable', () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    const stream = agents.priya.stream({ prompt: 'Define MVP' })

    expect(stream[Symbol.asyncIterator]).toBeDefined()
    expect(typeof stream[Symbol.asyncIterator]).toBe('function')
  })

  it('stream yields text-delta events', async () => {
    const mockStream = async function* () {
      yield { type: 'text-delta', data: { textDelta: 'Hello' }, timestamp: new Date() }
      yield { type: 'text-delta', data: { textDelta: ' World' }, timestamp: new Date() }
      yield { type: 'done', data: { finalResult: {} }, timestamp: new Date() }
    }
    mockRunner.mockReturnValue({
      [Symbol.asyncIterator]: mockStream,
      result: Promise.resolve({ text: 'Hello World' }),
      text: Promise.resolve('Hello World'),
      toolCalls: Promise.resolve([]),
      usage: Promise.resolve({ promptTokens: 50, completionTokens: 25, totalTokens: 75 }),
    })

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      streamingEnabled: true,
    }
    const agents = createAgentsProxy(config)

    const stream = agents.ralph.stream({ prompt: 'Build feature' })
    const events = []

    for await (const event of stream) {
      events.push(event)
    }

    expect(events.length).toBeGreaterThan(0)
    expect(events.some(e => e.type === 'text-delta')).toBe(true)
  })

  it('stream provides result promise', async () => {
    const expectedResult = {
      text: 'Complete response',
      toolCalls: [],
      toolResults: [],
      steps: 1,
      finishReason: 'stop' as const,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    }

    mockRunner.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'done', data: { finalResult: expectedResult }, timestamp: new Date() }
      },
      result: Promise.resolve(expectedResult),
      text: Promise.resolve('Complete response'),
      toolCalls: Promise.resolve([]),
      usage: Promise.resolve({ promptTokens: 100, completionTokens: 50, totalTokens: 150 }),
    })

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      streamingEnabled: true,
    }
    const agents = createAgentsProxy(config)

    const stream = agents.tom.stream({ prompt: 'Review code' })
    const result = await stream.result

    expect(result).toEqual(expectedResult)
  })

  it('stream yields tool-call events', async () => {
    const mockStream = async function* () {
      yield { type: 'tool-call-start', data: { toolCallId: 'tc-1', toolName: 'db_query' }, timestamp: new Date() }
      yield { type: 'tool-call-end', data: { toolCall: { id: 'tc-1', name: 'db_query', arguments: {} } }, timestamp: new Date() }
      yield { type: 'tool-result', data: { result: { toolCallId: 'tc-1', toolName: 'db_query', result: [] } }, timestamp: new Date() }
      yield { type: 'done', data: { finalResult: {} }, timestamp: new Date() }
    }
    mockRunner.mockReturnValue({
      [Symbol.asyncIterator]: mockStream,
      result: Promise.resolve({ text: '' }),
      text: Promise.resolve(''),
      toolCalls: Promise.resolve([]),
      usage: Promise.resolve({ promptTokens: 50, completionTokens: 25, totalTokens: 75 }),
    })

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      streamingEnabled: true,
    }
    const agents = createAgentsProxy(config)

    const stream = agents.quinn.stream({ prompt: 'Run tests' })
    const events = []

    for await (const event of stream) {
      events.push(event)
    }

    expect(events.some(e => e.type === 'tool-call-start')).toBe(true)
    expect(events.some(e => e.type === 'tool-result')).toBe(true)
  })
})

// ============================================================================
// Agent timeout handling
// ============================================================================

describe('Agent timeout handling', () => {
  let mockContext: MockContext
  let mockRunner: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockContext = createMockContext()
    mockRunner = createMockAgentRunner()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('agent run respects timeout option', async () => {
    vi.useFakeTimers()

    mockRunner.mockImplementation(async () => {
      // Simulate a long-running agent
      await new Promise(resolve => setTimeout(resolve, 10000))
      return { text: 'done', toolCalls: [], toolResults: [], steps: 1, finishReason: 'stop' as const, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
    })

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    const runPromise = agents.priya.run({
      prompt: 'Long task',
      timeout: 5000,
    })

    vi.advanceTimersByTime(5000)

    await expect(runPromise).rejects.toThrow(/timeout/i)
  })

  it('agent run uses default timeout from config', async () => {
    vi.useFakeTimers()

    mockRunner.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 60000))
      return { text: 'done', toolCalls: [], toolResults: [], steps: 1, finishReason: 'stop' as const, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
    })

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      defaultTimeout: 30000,
    }
    const agents = createAgentsProxy(config)

    const runPromise = agents.ralph.run({ prompt: 'Build feature' })

    vi.advanceTimersByTime(30000)

    await expect(runPromise).rejects.toThrow(/timeout/i)
  })

  it('agent passes AbortSignal to runner', async () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    await agents.tom.run({
      prompt: 'Review code',
      timeout: 10000,
    })

    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
      expect.anything()
    )
  })

  it('external AbortSignal can cancel agent run', async () => {
    const controller = new AbortController()

    mockRunner.mockImplementation(async (input) => {
      // Check signal and wait
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, 5000)
        input.signal?.addEventListener('abort', () => {
          clearTimeout(timeout)
          reject(new Error('Aborted'))
        })
      })
      return { text: 'done', toolCalls: [], toolResults: [], steps: 1, finishReason: 'stop' as const, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
    })

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    const runPromise = agents.mark.run({
      prompt: 'Create content',
      signal: controller.signal,
    })

    // Abort immediately
    controller.abort()

    await expect(runPromise).rejects.toThrow(/abort/i)
  })
})

// ============================================================================
// Agent error recovery
// ============================================================================

describe('Agent error recovery', () => {
  let mockContext: MockContext
  let mockRunner: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockContext = createMockContext()
    mockRunner = createMockAgentRunner()
  })

  it('agent run propagates errors from runner', async () => {
    mockRunner.mockRejectedValue(new Error('Agent execution failed'))

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    await expect(agents.priya.run({ prompt: 'Fail' })).rejects.toThrow('Agent execution failed')
  })

  it('agent run supports retry option', async () => {
    let attempts = 0
    mockRunner.mockImplementation(async () => {
      attempts++
      if (attempts < 3) {
        throw new Error('Transient error')
      }
      return { text: 'Success on retry', toolCalls: [], toolResults: [], steps: 1, finishReason: 'stop' as const, usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } }
    })

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    const result = await agents.ralph.run({
      prompt: 'Flaky task',
      retries: 3,
    })

    expect(result.text).toBe('Success on retry')
    expect(attempts).toBe(3)
  })

  it('agent run respects retryDelay option', async () => {
    vi.useFakeTimers()

    let attempts = 0
    const attemptTimes: number[] = []

    mockRunner.mockImplementation(async () => {
      attempts++
      attemptTimes.push(Date.now())
      if (attempts < 2) {
        throw new Error('Transient error')
      }
      return { text: 'Success', toolCalls: [], toolResults: [], steps: 1, finishReason: 'stop' as const, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
    })

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    const runPromise = agents.tom.run({
      prompt: 'Retry with delay',
      retries: 2,
      retryDelay: 1000,
    })

    // First attempt
    await vi.advanceTimersByTimeAsync(0)
    // Wait for retry delay
    await vi.advanceTimersByTimeAsync(1000)

    const result = await runPromise

    expect(result.text).toBe('Success')
    expect(attemptTimes.length).toBe(2)

    vi.useRealTimers()
  })

  it('agent run calls onError hook on failure', async () => {
    const onError = vi.fn()
    mockRunner.mockRejectedValue(new Error('Test error'))

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      hooks: { onError },
    }
    const agents = createAgentsProxy(config)

    await expect(agents.quinn.run({ prompt: 'Fail' })).rejects.toThrow('Test error')

    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      agentName: 'quinn',
    }))
  })
})

// ============================================================================
// Human escalation from agent
// ============================================================================

describe('Human escalation from agent', () => {
  let mockContext: MockContext
  let mockRunner: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockContext = createMockContext()
    mockRunner = createMockAgentRunner()
  })

  it('agent receives escalation tool', async () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      enableEscalation: true,
    }
    const agents = createAgentsProxy(config)

    await agents.sally.run({ prompt: 'Large deal negotiation' })

    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'escalate_to_human' }),
        ]),
      }),
      expect.anything()
    )
  })

  it('escalation tool calls context.escalate', async () => {
    mockRunner.mockImplementation(async (input, ctx) => {
      const escalateTool = input.tools?.find((t: { name: string }) => t.name === 'escalate_to_human')
      if (escalateTool) {
        await escalateTool.execute({
          reason: 'High-value decision',
          role: 'manager',
          context: { amount: 100000 },
        }, {})
      }
      return {
        text: 'Escalated successfully',
        toolCalls: [],
        toolResults: [],
        steps: 1,
        finishReason: 'stop' as const,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      }
    })

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      enableEscalation: true,
    }
    const agents = createAgentsProxy(config)

    await agents.sally.run({ prompt: 'Need approval for large deal' })

    expect(mockContext.escalate).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'High-value decision',
        role: 'manager',
      })
    )
  })

  it('escalation returns human response to agent', async () => {
    mockContext.escalate.mockResolvedValue({
      approved: true,
      by: 'ceo@company.com',
      notes: 'Approved with conditions',
    })

    let escalationResult: unknown
    mockRunner.mockImplementation(async (input) => {
      const escalateTool = input.tools?.find((t: { name: string }) => t.name === 'escalate_to_human')
      if (escalateTool) {
        escalationResult = await escalateTool.execute({
          reason: 'Need CEO approval',
          role: 'ceo',
        }, {})
      }
      return {
        text: 'Proceeding with approval',
        toolCalls: [],
        toolResults: [],
        steps: 1,
        finishReason: 'stop' as const,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      }
    })

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      enableEscalation: true,
    }
    const agents = createAgentsProxy(config)

    await agents.priya.run({ prompt: 'Major product decision' })

    expect(escalationResult).toEqual({
      approved: true,
      by: 'ceo@company.com',
      notes: 'Approved with conditions',
    })
  })

  it('escalation respects SLA configuration', async () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      enableEscalation: true,
      escalationSLA: '4 hours',
    }
    const agents = createAgentsProxy(config)

    await agents.mark.run({ prompt: 'Campaign approval needed' })

    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        escalationConfig: expect.objectContaining({
          sla: '4 hours',
        }),
      }),
      expect.anything()
    )
  })
})

// ============================================================================
// Multi-step agent reasoning
// ============================================================================

describe('Multi-step agent reasoning', () => {
  let mockContext: MockContext
  let mockRunner: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockContext = createMockContext()
    mockRunner = createMockAgentRunner()
  })

  it('agent run returns number of steps taken', async () => {
    mockRunner.mockResolvedValue({
      text: 'Complete',
      toolCalls: [],
      toolResults: [],
      steps: 5,
      finishReason: 'stop' as const,
      usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
    })

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    const result = await agents.ralph.run({ prompt: 'Complex build task' })

    expect(result.steps).toBe(5)
  })

  it('agent respects maxSteps option', async () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    await agents.tom.run({
      prompt: 'Limited reasoning',
      maxSteps: 3,
    })

    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        maxSteps: 3,
      }),
      expect.anything()
    )
  })

  it('agent uses default maxSteps from config', async () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      defaultMaxSteps: 10,
    }
    const agents = createAgentsProxy(config)

    await agents.quinn.run({ prompt: 'Test task' })

    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        maxSteps: 10,
      }),
      expect.anything()
    )
  })

  it('agent can have custom stopWhen conditions', async () => {
    const customStopCondition = { type: 'hasToolCall' as const, toolName: 'submit_result' }

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    await agents.priya.run({
      prompt: 'Run until submission',
      stopWhen: customStopCondition,
    })

    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        stopWhen: customStopCondition,
      }),
      expect.anything()
    )
  })

  it('agent hooks are called for each step', async () => {
    const onStepStart = vi.fn()
    const onStepFinish = vi.fn()

    mockRunner.mockResolvedValue({
      text: 'Done',
      toolCalls: [],
      toolResults: [],
      steps: 3,
      finishReason: 'stop' as const,
      usage: { promptTokens: 300, completionTokens: 100, totalTokens: 400 },
    })

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      hooks: {
        onStepStart,
        onStepFinish,
      },
    }
    const agents = createAgentsProxy(config)

    await agents.ralph.run({ prompt: 'Multi-step task' })

    // Hooks should be passed to runner for it to call
    expect(mockRunner).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        hooks: expect.objectContaining({
          onStepStart,
          onStepFinish,
        }),
      })
    )
  })
})

// ============================================================================
// Agent handoffs between named agents
// ============================================================================

describe('Agent handoffs between named agents', () => {
  let mockContext: MockContext
  let mockRunner: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockContext = createMockContext()
    mockRunner = createMockAgentRunner()
  })

  it('agent receives handoff tool when enabled', async () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      enableHandoffs: true,
    }
    const agents = createAgentsProxy(config)

    await agents.priya.run({ prompt: 'Define spec then build' })

    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'handoff_to_agent' }),
        ]),
      }),
      expect.anything()
    )
  })

  it('handoff tool can transfer to ralph', async () => {
    let handoffExecuted = false
    let handoffTarget: string | undefined

    mockRunner.mockImplementation(async (input) => {
      const handoffTool = input.tools?.find((t: { name: string }) => t.name === 'handoff_to_agent')
      if (handoffTool && !handoffExecuted) {
        handoffExecuted = true
        const result = await handoffTool.execute({
          targetAgent: 'ralph',
          reason: 'Spec complete, ready for implementation',
          context: { spec: { features: ['auth', 'dashboard'] } },
        }, {})
        handoffTarget = result.targetAgent
      }
      return {
        text: 'Handed off to ralph',
        toolCalls: [],
        toolResults: [],
        steps: 1,
        finishReason: 'stop' as const,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      }
    })

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      enableHandoffs: true,
    }
    const agents = createAgentsProxy(config)

    await agents.priya.run({ prompt: 'Define and delegate' })

    expect(handoffTarget).toBe('ralph')
  })

  it('handoff includes conversation context', async () => {
    let handoffContext: unknown

    mockRunner.mockImplementation(async (input) => {
      const handoffTool = input.tools?.find((t: { name: string }) => t.name === 'handoff_to_agent')
      if (handoffTool) {
        const result = await handoffTool.execute({
          targetAgent: 'tom',
          reason: 'Code ready for review',
          context: {
            codeChanges: ['file1.ts', 'file2.ts'],
            prNumber: 123,
          },
        }, {})
        handoffContext = result.context
      }
      return {
        text: 'Handed off to tom',
        toolCalls: [],
        toolResults: [],
        steps: 1,
        finishReason: 'stop' as const,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      }
    })

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      enableHandoffs: true,
    }
    const agents = createAgentsProxy(config)

    await agents.ralph.run({ prompt: 'Build and submit for review' })

    expect(handoffContext).toEqual({
      codeChanges: ['file1.ts', 'file2.ts'],
      prNumber: 123,
    })
  })

  it('handoff only allows named agents as targets', async () => {
    mockRunner.mockImplementation(async (input) => {
      const handoffTool = input.tools?.find((t: { name: string }) => t.name === 'handoff_to_agent')
      if (handoffTool) {
        await expect(handoffTool.execute({
          targetAgent: 'unknown_agent',
          reason: 'Invalid handoff',
        }, {})).rejects.toThrow(/invalid.*agent/i)
      }
      return {
        text: 'Done',
        toolCalls: [],
        toolResults: [],
        steps: 1,
        finishReason: 'stop' as const,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      }
    })

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      enableHandoffs: true,
    }
    const agents = createAgentsProxy(config)

    await agents.priya.run({ prompt: 'Try invalid handoff' })

    expect(mockRunner).toHaveBeenCalled()
  })

  it('handoff chain: priya -> ralph -> tom -> quinn', async () => {
    const handoffChain: string[] = []

    mockRunner.mockImplementation(async (input) => {
      const agentName = input.agentName
      handoffChain.push(agentName)

      const handoffTool = input.tools?.find((t: { name: string }) => t.name === 'handoff_to_agent')
      if (handoffTool) {
        const nextAgent = {
          priya: 'ralph',
          ralph: 'tom',
          tom: 'quinn',
          quinn: null,
        }[agentName]

        if (nextAgent) {
          await handoffTool.execute({
            targetAgent: nextAgent,
            reason: `Completed ${agentName} work`,
          }, {})
        }
      }

      return {
        text: `${agentName} complete`,
        toolCalls: [],
        toolResults: [],
        steps: 1,
        finishReason: 'stop' as const,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      }
    })

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      enableHandoffs: true,
    }
    const agents = createAgentsProxy(config)

    await agents.priya.run({ prompt: 'Full product lifecycle' })

    expect(handoffChain).toContain('priya')
  })

  it('concurrent handoffs are prevented', async () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
      enableHandoffs: true,
      preventConcurrentHandoffs: true,
    }
    const agents = createAgentsProxy(config)

    await agents.mark.run({ prompt: 'Marketing task with handoff' })

    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        handoffConfig: expect.objectContaining({
          preventConcurrent: true,
        }),
      }),
      expect.anything()
    )
  })
})

// ============================================================================
// Edge Cases and Integration
// ============================================================================

describe('Edge cases and integration', () => {
  let mockContext: MockContext
  let mockRunner: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockContext = createMockContext()
    mockRunner = createMockAgentRunner()
  })

  it('accessing unknown agent property returns undefined', () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    // Type-safe named agents only
    expect((agents as Record<string, unknown>).unknownAgent).toBeUndefined()
  })

  it('agent proxy is reusable for multiple runs', async () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    await agents.priya.run({ prompt: 'First run' })
    await agents.priya.run({ prompt: 'Second run' })
    await agents.priya.run({ prompt: 'Third run' })

    expect(mockRunner).toHaveBeenCalledTimes(3)
  })

  it('different agents can run concurrently', async () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    const [result1, result2, result3] = await Promise.all([
      agents.priya.run({ prompt: 'Product spec' }),
      agents.ralph.run({ prompt: 'Build feature' }),
      agents.tom.run({ prompt: 'Review code' }),
    ])

    expect(mockRunner).toHaveBeenCalledTimes(3)
    expect(result1).toBeDefined()
    expect(result2).toBeDefined()
    expect(result3).toBeDefined()
  })

  it('agent run includes metadata in result', async () => {
    mockRunner.mockResolvedValue({
      text: 'Done',
      toolCalls: [],
      toolResults: [],
      steps: 1,
      finishReason: 'stop' as const,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      metadata: {
        agentName: 'priya',
        duration: 1500,
        model: 'claude-sonnet-4-20250514',
      },
    })

    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    const result = await agents.priya.run({ prompt: 'Task with metadata' })

    expect(result.metadata).toBeDefined()
    expect(result.metadata?.agentName).toBe('priya')
  })

  it('Symbol.toStringTag returns descriptive name', () => {
    const config: AgentsProxyConfig = {
      context: mockContext,
      runner: mockRunner,
    }
    const agents = createAgentsProxy(config)

    expect(String(agents)).toContain('AgentsProxy')
  })
})
