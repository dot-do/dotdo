/**
 * Tool Execution Tracking as Relationships - RED Phase Tests
 *
 * Issue: dotdo-lycby
 *
 * Tests for tracking Agent tool executions as graph Relationships using
 * the verb form pattern: use -> using -> used
 *
 * Key Features Under Test:
 * - Agent `used` Tool relationship creation
 * - Verb form state transitions (use -> using -> used)
 * - Execution metadata (input, output, duration, cost)
 * - Failed execution recording with error details
 * - Tool usage analytics queries
 *
 * NO MOCKS - Uses real SQLite database.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// Production module imports (these don't exist yet - that's the RED phase)
import {
  createToolExecutionGraph,
  type ToolExecutionGraph,
  type ToolExecution,
  type ExecutionVerb,
  type ExecutionMetadata,
  type ExecutionCost,
  type ExecutionError,
  type ExecutionQuery,
  type ExecutionAnalytics,
  type VerbTransitionHistory,
} from '../src/tool-execution-tracking'

// ============================================================================
// TYPE DEFINITIONS - Expected types for Tool Execution Tracking
// ============================================================================

/**
 * Verb states for tool execution lifecycle
 * Following the pattern: intent -> in-progress -> completed
 */
type ExpectedExecutionVerb = 'use' | 'using' | 'used' | 'failed'

/**
 * Expected execution metadata structure
 */
interface ExpectedExecutionMetadata {
  input: Record<string, unknown>
  output?: unknown
  duration?: number
  startedAt: number
  completedAt?: number
  success?: boolean
}

/**
 * Expected execution cost tracking
 */
interface ExpectedExecutionCost {
  tokens?: number
  inputTokens?: number
  outputTokens?: number
  credits?: number
  usd?: number
  apiCalls?: number
}

/**
 * Expected error structure for failed executions
 */
interface ExpectedExecutionError {
  message: string
  code?: string
  stack?: string
  retryable?: boolean
}

// ============================================================================
// Test Setup
// ============================================================================

describe('Tool Execution Tracking as Relationships', () => {
  let graph: ToolExecutionGraph
  let agentId: string
  let toolId: string

  beforeEach(async () => {
    // Create graph instance with real SQLite (no mocks)
    graph = createToolExecutionGraph({
      namespace: 'tool-execution-test',
    })

    // Create test entities
    agentId = await graph.createAgent({
      name: 'TestAgent',
      type: 'Agent',
      provider: 'anthropic',
      model: 'claude-opus-4-5-20251101',
    })

    toolId = await graph.createTool({
      name: 'SendEmail',
      type: 'Tool',
      description: 'Send an email via SendGrid',
      provider: 'sendgrid',
      category: 'communication',
    })
  })

  afterEach(async () => {
    await graph.clear()
  })

  // ==========================================================================
  // 1. Relationship Creation Tests (Agent used Tool)
  // ==========================================================================

  describe('Tool Execution Creates Relationship', () => {
    it('creates relationship with verb "use" when execution starts', async () => {
      const execution = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { to: 'user@example.com', subject: 'Hello' },
      })

      expect(execution.id).toBeDefined()
      expect(execution.verb).toBe('use')
      expect(execution.from).toBe(agentId)
      expect(execution.to).toBe(toolId)
      expect(execution.metadata.input).toEqual({ to: 'user@example.com', subject: 'Hello' })
      expect(execution.metadata.startedAt).toBeDefined()
    })

    it('relationship type is "used" (Agent used Tool)', async () => {
      const execution = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { action: 'test' },
      })

      const relationship = await graph.getRelationship(execution.id)

      expect(relationship.type).toBe('used')
      expect(relationship.sourceType).toBe('Agent')
      expect(relationship.targetType).toBe('Tool')
      expect(relationship.sourceId).toBe(agentId)
      expect(relationship.targetId).toBe(toolId)
    })

    it('multiple executions create multiple relationships', async () => {
      await graph.startExecution({ agent: agentId, tool: toolId, input: { a: 1 } })
      await graph.startExecution({ agent: agentId, tool: toolId, input: { b: 2 } })
      await graph.startExecution({ agent: agentId, tool: toolId, input: { c: 3 } })

      const executions = await graph.queryExecutions({ agent: agentId })

      expect(executions.length).toBe(3)
      // Each execution is a unique relationship
      const ids = new Set(executions.map((e) => e.id))
      expect(ids.size).toBe(3)
    })

    it('stores agent and tool references correctly', async () => {
      const execution = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { test: true },
      })

      const retrieved = await graph.getExecution(execution.id)

      expect(retrieved.from).toBe(agentId)
      expect(retrieved.to).toBe(toolId)

      // Should be able to resolve to actual entities
      const agent = await graph.getEntity(retrieved.from)
      const tool = await graph.getEntity(retrieved.to)

      expect(agent.name).toBe('TestAgent')
      expect(tool.name).toBe('SendEmail')
    })
  })

  // ==========================================================================
  // 2. Verb Form State Encoding Tests
  // ==========================================================================

  describe('Verb Form State Transitions', () => {
    it('transitions from use -> using when execution begins processing', async () => {
      const execution = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { query: 'test' },
      })

      expect(execution.verb).toBe('use')

      const inProgress = await graph.markInProgress(execution.id)

      expect(inProgress.verb).toBe('using')
    })

    it('transitions from using -> used on successful completion', async () => {
      const execution = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { to: 'test@example.com' },
      })

      await graph.markInProgress(execution.id)

      const completed = await graph.completeExecution(execution.id, {
        output: { success: true, messageId: 'msg-123' },
      })

      expect(completed.verb).toBe('used')
      expect(completed.metadata.output).toEqual({ success: true, messageId: 'msg-123' })
      expect(completed.metadata.completedAt).toBeDefined()
      expect(completed.metadata.success).toBe(true)
    })

    it('tracks verb transition history', async () => {
      const execution = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { action: 'track' },
      })

      await graph.markInProgress(execution.id)

      const completed = await graph.completeExecution(execution.id, {
        output: { result: 'done' },
      })

      expect(completed.verbHistory).toBeDefined()
      expect(completed.verbHistory.length).toBe(3)
      expect(completed.verbHistory[0].verb).toBe('use')
      expect(completed.verbHistory[1].verb).toBe('using')
      expect(completed.verbHistory[2].verb).toBe('used')

      // Each transition should have a timestamp
      completed.verbHistory.forEach((entry: VerbTransitionHistory) => {
        expect(entry.at).toBeDefined()
        expect(typeof entry.at).toBe('number')
      })
    })

    it('rejects invalid verb transitions', async () => {
      const execution = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { test: true },
      })

      // Cannot go directly from use to used (must go through using)
      await expect(
        graph.completeExecution(execution.id, { output: {} })
      ).rejects.toThrow('Invalid verb transition: use -> used')

      // Cannot go backwards from using to use
      await graph.markInProgress(execution.id)
      await expect(graph.transitionVerb(execution.id, 'use')).rejects.toThrow(
        'Invalid verb transition: using -> use'
      )
    })

    it('validates verb state machine transitions', async () => {
      // Valid transitions from 'use'
      const validFromUse = graph.getValidTransitions('use')
      expect(validFromUse).toContain('using')
      expect(validFromUse).not.toContain('used')

      // Valid transitions from 'using'
      const validFromUsing = graph.getValidTransitions('using')
      expect(validFromUsing).toContain('used')
      expect(validFromUsing).toContain('failed')
      expect(validFromUsing).not.toContain('use')

      // No valid transitions from terminal states
      const validFromUsed = graph.getValidTransitions('used')
      expect(validFromUsed).toEqual([])

      const validFromFailed = graph.getValidTransitions('failed')
      expect(validFromFailed).toEqual([])
    })
  })

  // ==========================================================================
  // 3. Execution Metadata Tests
  // ==========================================================================

  describe('Execution Metadata Recording', () => {
    it('stores complex nested input data', async () => {
      const complexInput = {
        recipients: [
          { email: 'alice@example.com', name: 'Alice' },
          { email: 'bob@example.com', name: 'Bob' },
        ],
        template: {
          id: 'welcome-template',
          variables: {
            company: 'Acme Corp',
            offer: { discount: 20, code: 'WELCOME20' },
          },
        },
        options: {
          trackOpens: true,
          trackClicks: true,
          sandbox: false,
        },
      }

      const execution = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: complexInput,
      })

      const retrieved = await graph.getExecution(execution.id)
      expect(retrieved.metadata.input).toEqual(complexInput)
    })

    it('stores output data on completion', async () => {
      const execution = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { to: 'user@example.com' },
      })

      await graph.markInProgress(execution.id)

      const output = {
        messageId: 'msg-456',
        accepted: ['user@example.com'],
        rejected: [],
        response: {
          headers: { 'x-message-id': 'msg-456' },
          statusCode: 202,
        },
      }

      const completed = await graph.completeExecution(execution.id, { output })

      expect(completed.metadata.output).toEqual(output)
    })

    it('calculates duration automatically', async () => {
      const execution = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { action: 'slow' },
      })

      await graph.markInProgress(execution.id)

      // Simulate some execution time
      await new Promise((r) => setTimeout(r, 50))

      const completed = await graph.completeExecution(execution.id, {
        output: { done: true },
      })

      expect(completed.metadata.duration).toBeDefined()
      expect(completed.metadata.duration).toBeGreaterThanOrEqual(50)
    })

    it('records cost metrics for token-based tools', async () => {
      const llmTool = await graph.createTool({
        name: 'GenerateText',
        type: 'Tool',
        costType: 'tokens',
        provider: 'anthropic',
      })

      const execution = await graph.startExecution({
        agent: agentId,
        tool: llmTool,
        input: { prompt: 'Write a story about a robot' },
      })

      await graph.markInProgress(execution.id)

      const completed = await graph.completeExecution(execution.id, {
        output: { text: 'Once upon a time, there was a robot...' },
        cost: {
          tokens: 1500,
          inputTokens: 50,
          outputTokens: 1450,
          credits: 0.15,
          usd: 0.0015,
        },
      })

      expect(completed.cost).toBeDefined()
      expect(completed.cost!.tokens).toBe(1500)
      expect(completed.cost!.inputTokens).toBe(50)
      expect(completed.cost!.outputTokens).toBe(1450)
      expect(completed.cost!.usd).toBe(0.0015)
    })

    it('records cost metrics for API-based tools', async () => {
      const apiTool = await graph.createTool({
        name: 'CallExternalAPI',
        type: 'Tool',
        costType: 'requests',
        provider: 'external',
      })

      const execution = await graph.startExecution({
        agent: agentId,
        tool: apiTool,
        input: { endpoint: '/users', method: 'GET' },
      })

      await graph.markInProgress(execution.id)

      const completed = await graph.completeExecution(execution.id, {
        output: { users: [] },
        cost: {
          apiCalls: 1,
          credits: 0.001,
        },
      })

      expect(completed.cost!.apiCalls).toBe(1)
    })

    it('stores execution context for tracing', async () => {
      const execution = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { action: 'traced' },
        context: {
          sessionId: 'sess-abc',
          requestId: 'req-123',
          traceId: 'trace-xyz',
          spanId: 'span-001',
        },
      })

      const retrieved = await graph.getExecution(execution.id)

      expect(retrieved.context).toBeDefined()
      expect(retrieved.context!.sessionId).toBe('sess-abc')
      expect(retrieved.context!.requestId).toBe('req-123')
      expect(retrieved.context!.traceId).toBe('trace-xyz')
    })
  })

  // ==========================================================================
  // 4. Failed Execution Recording Tests
  // ==========================================================================

  describe('Failed Tool Execution Recording', () => {
    it('transitions from using -> failed on error', async () => {
      const execution = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { to: 'invalid-email' },
      })

      await graph.markInProgress(execution.id)

      const failed = await graph.failExecution(execution.id, {
        error: {
          message: 'Invalid email address format',
          code: 'INVALID_EMAIL',
        },
      })

      expect(failed.verb).toBe('failed')
      expect(failed.error).toBeDefined()
      expect(failed.error!.message).toBe('Invalid email address format')
      expect(failed.error!.code).toBe('INVALID_EMAIL')
    })

    it('records full error stack trace', async () => {
      const execution = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { action: 'fail' },
      })

      await graph.markInProgress(execution.id)

      const errorStack = `Error: Connection timeout
    at EmailClient.send (/path/to/email-client.ts:42:15)
    at ToolExecutor.execute (/path/to/executor.ts:88:20)
    at async Agent.useTool (/path/to/agent.ts:156:12)`

      const failed = await graph.failExecution(execution.id, {
        error: {
          message: 'Connection timeout',
          code: 'TIMEOUT',
          stack: errorStack,
        },
      })

      expect(failed.error!.stack).toBe(errorStack)
    })

    it('preserves input data for debugging failed executions', async () => {
      const originalInput = {
        to: 'blocked@example.com',
        subject: 'Test',
        body: 'This will fail',
        attachments: [{ name: 'file.pdf', size: 1024 }],
      }

      const execution = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: originalInput,
      })

      await graph.markInProgress(execution.id)

      const failed = await graph.failExecution(execution.id, {
        error: { message: 'Recipient is blocked' },
      })

      // Input should be preserved for debugging
      expect(failed.metadata.input).toEqual(originalInput)
    })

    it('records retryable flag for transient errors', async () => {
      const execution = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { action: 'retry-test' },
      })

      await graph.markInProgress(execution.id)

      const failed = await graph.failExecution(execution.id, {
        error: {
          message: 'Rate limit exceeded',
          code: 'RATE_LIMITED',
          retryable: true,
        },
      })

      expect(failed.error!.retryable).toBe(true)
    })

    it('records non-retryable flag for permanent errors', async () => {
      const execution = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { action: 'permanent-fail' },
      })

      await graph.markInProgress(execution.id)

      const failed = await graph.failExecution(execution.id, {
        error: {
          message: 'Invalid API key',
          code: 'UNAUTHORIZED',
          retryable: false,
        },
      })

      expect(failed.error!.retryable).toBe(false)
    })

    it('calculates duration even for failed executions', async () => {
      const execution = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { action: 'slow-fail' },
      })

      await graph.markInProgress(execution.id)

      await new Promise((r) => setTimeout(r, 30))

      const failed = await graph.failExecution(execution.id, {
        error: { message: 'Timeout after 30ms' },
      })

      expect(failed.metadata.duration).toBeGreaterThanOrEqual(30)
      expect(failed.metadata.completedAt).toBeDefined()
    })
  })

  // ==========================================================================
  // 5. Tool Usage Analytics Queries
  // ==========================================================================

  describe('Tool Usage Analytics Queries', () => {
    let searchTool: string
    let anotherAgent: string

    beforeEach(async () => {
      // Create additional test entities
      searchTool = await graph.createTool({
        name: 'WebSearch',
        type: 'Tool',
        provider: 'google',
        category: 'data',
      })

      anotherAgent = await graph.createAgent({
        name: 'SearchAgent',
        type: 'Agent',
        provider: 'openai',
      })

      // Create execution history
      // Agent 1 uses SendEmail - success
      const e1 = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { to: 'a@example.com' },
      })
      await graph.markInProgress(e1.id)
      await graph.completeExecution(e1.id, { output: { sent: true } })

      // Agent 1 uses SendEmail - success
      const e2 = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { to: 'b@example.com' },
      })
      await graph.markInProgress(e2.id)
      await graph.completeExecution(e2.id, { output: { sent: true } })

      // Agent 2 uses WebSearch - success
      const e3 = await graph.startExecution({
        agent: anotherAgent,
        tool: searchTool,
        input: { query: 'weather' },
      })
      await graph.markInProgress(e3.id)
      await graph.completeExecution(e3.id, { output: { results: [] } })

      // Agent 1 uses SendEmail - failed
      const e4 = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { to: 'invalid' },
      })
      await graph.markInProgress(e4.id)
      await graph.failExecution(e4.id, { error: { message: 'Invalid email' } })
    })

    it('queries executions by tool', async () => {
      const executions = await graph.queryExecutions({ tool: toolId })

      expect(executions.length).toBe(3) // 2 successful + 1 failed
      executions.forEach((e) => {
        expect(e.to).toBe(toolId)
      })
    })

    it('queries executions by agent', async () => {
      const executions = await graph.queryExecutions({ agent: agentId })

      expect(executions.length).toBe(3) // 2 email + 1 failed email
      executions.forEach((e) => {
        expect(e.from).toBe(agentId)
      })
    })

    it('queries executions by verb (successful vs failed)', async () => {
      const successful = await graph.queryExecutions({
        tool: toolId,
        verb: 'used',
      })

      const failed = await graph.queryExecutions({
        tool: toolId,
        verb: 'failed',
      })

      expect(successful.length).toBe(2)
      expect(failed.length).toBe(1)
    })

    it('queries executions by time range', async () => {
      const now = Date.now()
      const tenSecondsAgo = now - 10000

      const recentExecutions = await graph.queryExecutions({
        agent: agentId,
        startedAfter: tenSecondsAgo,
      })

      expect(recentExecutions.length).toBeGreaterThan(0)
    })

    it('aggregates execution statistics by tool', async () => {
      const stats = await graph.aggregateStats({ tool: toolId })

      expect(stats.totalExecutions).toBe(3)
      expect(stats.successfulExecutions).toBe(2)
      expect(stats.failedExecutions).toBe(1)
      expect(stats.successRate).toBeCloseTo(0.667, 2)
    })

    it('aggregates execution statistics by agent', async () => {
      const stats = await graph.aggregateStats({ agent: agentId })

      expect(stats.totalExecutions).toBe(3)
      expect(stats.successfulExecutions).toBe(2)
      expect(stats.failedExecutions).toBe(1)
    })

    it('calculates average duration by tool', async () => {
      const stats = await graph.aggregateStats({ tool: toolId })

      expect(stats.totalDuration).toBeDefined()
      expect(stats.averageDuration).toBeDefined()
      expect(stats.averageDuration).toBeGreaterThanOrEqual(0)
    })

    it('aggregates cost metrics by agent', async () => {
      // Create executions with cost data
      const e1 = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { action: 'cost1' },
      })
      await graph.markInProgress(e1.id)
      await graph.completeExecution(e1.id, {
        output: {},
        cost: { tokens: 100, usd: 0.001 },
      })

      const e2 = await graph.startExecution({
        agent: agentId,
        tool: toolId,
        input: { action: 'cost2' },
      })
      await graph.markInProgress(e2.id)
      await graph.completeExecution(e2.id, {
        output: {},
        cost: { tokens: 200, usd: 0.002 },
      })

      const stats = await graph.aggregateStats({ agent: agentId })

      expect(stats.totalCost).toBeDefined()
      expect(stats.totalCost!.tokens).toBe(300)
      expect(stats.totalCost!.usd).toBeCloseTo(0.003, 4)
    })

    it('gets top tools used by agent', async () => {
      const topTools = await graph.getTopToolsByAgent(agentId, { limit: 5 })

      expect(topTools.length).toBeGreaterThan(0)
      expect(topTools[0].toolId).toBe(toolId) // SendEmail should be top
      expect(topTools[0].executionCount).toBe(3)
    })

    it('gets tool usage over time', async () => {
      const usage = await graph.getUsageOverTime({
        tool: toolId,
        interval: 'hour',
      })

      expect(usage.length).toBeGreaterThan(0)
      expect(usage[0]).toHaveProperty('timestamp')
      expect(usage[0]).toHaveProperty('count')
    })
  })

  // ==========================================================================
  // 6. Graph Traversal Integration Tests
  // ==========================================================================

  describe('Graph Traversal Integration', () => {
    it('traverses from Agent to all tools used', async () => {
      // Create multiple tool executions
      const tool2 = await graph.createTool({
        name: 'Tool2',
        type: 'Tool',
        category: 'data',
      })

      await completeExecution(graph, agentId, toolId, { action: 'use1' })
      await completeExecution(graph, agentId, toolId, { action: 'use2' })
      await completeExecution(graph, agentId, tool2, { action: 'use3' })

      const toolsUsed = await graph.getToolsUsedByAgent(agentId)

      expect(toolsUsed.length).toBe(2)
      expect(toolsUsed.map((t) => t.id)).toContain(toolId)
      expect(toolsUsed.map((t) => t.id)).toContain(tool2)
    })

    it('traverses from Tool to all agents that used it', async () => {
      const agent2 = await graph.createAgent({
        name: 'Agent2',
        type: 'Agent',
      })

      await completeExecution(graph, agentId, toolId, { action: 'a1' })
      await completeExecution(graph, agent2, toolId, { action: 'a2' })

      const agentsUsing = await graph.getAgentsUsingTool(toolId)

      expect(agentsUsing.length).toBe(2)
      expect(agentsUsing.map((a) => a.id)).toContain(agentId)
      expect(agentsUsing.map((a) => a.id)).toContain(agent2)
    })

    it('gets execution count between agent and tool', async () => {
      await completeExecution(graph, agentId, toolId, { n: 1 })
      await completeExecution(graph, agentId, toolId, { n: 2 })
      await completeExecution(graph, agentId, toolId, { n: 3 })

      const count = await graph.getExecutionCount(agentId, toolId)

      expect(count).toBe(3)
    })

    it('gets recent executions as relationship edges', async () => {
      await completeExecution(graph, agentId, toolId, { recent: true })

      const edges = await graph.getRecentExecutionEdges({
        agent: agentId,
        limit: 10,
      })

      expect(edges.length).toBeGreaterThan(0)
      expect(edges[0]).toHaveProperty('from')
      expect(edges[0]).toHaveProperty('to')
      expect(edges[0]).toHaveProperty('verb')
      expect(edges[0]).toHaveProperty('metadata')
    })
  })
})

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Helper to complete an execution through all states
 */
async function completeExecution(
  graph: ToolExecutionGraph,
  agentId: string,
  toolId: string,
  input: Record<string, unknown>
): Promise<ToolExecution> {
  const execution = await graph.startExecution({
    agent: agentId,
    tool: toolId,
    input,
  })
  await graph.markInProgress(execution.id)
  return graph.completeExecution(execution.id, {
    output: { completed: true },
  })
}
