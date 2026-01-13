/**
 * Tool Invocation Tracking as Relationships - RED Phase Tests
 *
 * Issue: dotdo-8o4le
 *
 * Tests for tracking tool invocations as graph relationships with:
 * - Verb transitions: invoke -> invoking -> invoked
 * - Input/output/duration/cost metrics
 * - Invocation history queries
 * - Error handling and retry support
 *
 * Uses real SQLite database (no mocks).
 *
 * NOTE: These tests are RED phase - they test the intended API which
 * does not exist yet. Tests should fail until implementation is complete.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// Import the intended API (this will fail to compile until implemented)
import {
  createInvocationGraph,
  type InvocationGraph,
  type ToolInvocation,
  type InvocationVerb,
  type InvocationMetrics,
  type InvocationQuery,
  type InvocationResult,
} from '../src/tool-invocations'

// ============================================================================
// Test Setup
// ============================================================================

describe('Tool Invocation Tracking as Relationships', () => {
  let graph: InvocationGraph
  let agentId: string
  let toolId: string
  let humanId: string

  beforeEach(async () => {
    // Create a real graph instance (no mocks)
    graph = createInvocationGraph({
      namespace: 'test-invocations',
    })

    // Create test entities
    agentId = await graph.createAgent({
      name: 'TestAgent',
      provider: 'anthropic',
      model: 'claude-opus-4-5-20251101',
    })

    toolId = await graph.createTool({
      name: 'SendEmail',
      description: 'Send an email via SendGrid',
      provider: 'sendgrid',
    })

    humanId = await graph.createHuman({
      name: 'John Doe',
      email: 'john@example.com',
      role: 'admin',
    })
  })

  afterEach(async () => {
    await graph.clear()
  })

  // ==========================================================================
  // 1. Invocation Creation Tests
  // ==========================================================================

  describe('Invocation Creation', () => {
    it('creates invoke relationship when tool call starts', async () => {
      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { to: 'user@example.com', subject: 'Hello' },
      })

      expect(invocation.id).toBeDefined()
      expect(invocation.verb).toBe('invoke')
      expect(invocation.from).toBe(agentId)
      expect(invocation.to).toBe(toolId)
      expect(invocation.input).toEqual({ to: 'user@example.com', subject: 'Hello' })
      expect(invocation.startedAt).toBeDefined()
    })

    it('transitions verb from invoke to invoking during execution', async () => {
      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { message: 'test' },
      })

      // Transition to 'invoking' state
      const updated = await graph.transitionVerb(invocation.id, 'invoking')

      expect(updated.verb).toBe('invoking')
      expect(updated.verbHistory).toContainEqual(
        expect.objectContaining({ verb: 'invoke' })
      )
      expect(updated.verbHistory).toContainEqual(
        expect.objectContaining({ verb: 'invoking' })
      )
    })

    it('transitions verb from invoking to invoked on completion', async () => {
      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { query: 'test query' },
      })

      await graph.transitionVerb(invocation.id, 'invoking')

      const completed = await graph.complete(invocation.id, {
        output: { success: true, result: 'Email sent' },
      })

      expect(completed.verb).toBe('invoked')
      expect(completed.output).toEqual({ success: true, result: 'Email sent' })
      expect(completed.completedAt).toBeDefined()
      expect(completed.duration).toBeGreaterThan(0)
    })

    it('records output in relationship data on success', async () => {
      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { to: 'test@example.com' },
      })

      const completed = await graph.complete(invocation.id, {
        output: {
          messageId: 'msg-123',
          accepted: ['test@example.com'],
          rejected: [],
        },
      })

      expect(completed.output).toBeDefined()
      expect(completed.output.messageId).toBe('msg-123')
      expect(completed.output.accepted).toEqual(['test@example.com'])
    })

    it('records duration and cost metrics', async () => {
      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { prompt: 'Generate report' },
      })

      // Simulate execution time
      await new Promise(r => setTimeout(r, 50))

      const completed = await graph.complete(invocation.id, {
        output: { report: 'Generated content...' },
        cost: {
          tokens: 1500,
          credits: 0.15,
          usd: 0.0015,
        },
      })

      expect(completed.duration).toBeGreaterThanOrEqual(50)
      expect(completed.cost.tokens).toBe(1500)
      expect(completed.cost.credits).toBe(0.15)
      expect(completed.cost.usd).toBe(0.0015)
    })
  })

  // ==========================================================================
  // 2. Data Tracking Tests
  // ==========================================================================

  describe('Data Tracking', () => {
    it('stores complex nested input data', async () => {
      const complexInput = {
        recipients: [
          { email: 'a@example.com', name: 'Alice' },
          { email: 'b@example.com', name: 'Bob' },
        ],
        template: {
          id: 'welcome-email',
          variables: {
            company: 'Acme Inc',
            offer: { discount: 20, code: 'SAVE20' },
          },
        },
        options: {
          trackOpens: true,
          trackClicks: true,
          sandbox: false,
        },
      }

      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: complexInput,
      })

      const retrieved = await graph.getInvocation(invocation.id)
      expect(retrieved.input).toEqual(complexInput)
    })

    it('stores large output payloads', async () => {
      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { query: 'SELECT * FROM users' },
      })

      // Simulate large result set
      const largeOutput = {
        rows: Array(100).fill(null).map((_, i) => ({
          id: `user-${i}`,
          name: `User ${i}`,
          email: `user${i}@example.com`,
          metadata: { created: Date.now(), active: i % 2 === 0 },
        })),
        totalCount: 100,
        hasMore: false,
      }

      const completed = await graph.complete(invocation.id, {
        output: largeOutput,
      })

      expect(completed.output.rows.length).toBe(100)
    })

    it('tracks multiple invocations with different cost types', async () => {
      // Create LLM tool with token cost
      const llmToolId = await graph.createTool({
        name: 'GenerateText',
        costType: 'tokens',
      })

      // Create API tool with request cost
      const apiToolId = await graph.createTool({
        name: 'CallAPI',
        costType: 'requests',
      })

      // LLM invocation with token cost
      const llmInvocation = await graph.invoke({
        from: agentId,
        tool: llmToolId,
        input: { prompt: 'Write a story' },
      })

      await graph.complete(llmInvocation.id, {
        output: { text: 'Once upon a time...' },
        cost: { tokens: 500, inputTokens: 50, outputTokens: 450 },
      })

      // API invocation with request cost
      const apiInvocation = await graph.invoke({
        from: agentId,
        tool: apiToolId,
        input: { endpoint: '/users' },
      })

      await graph.complete(apiInvocation.id, {
        output: { data: [] },
        cost: { requests: 1, rateLimit: { remaining: 99, reset: Date.now() + 3600000 } },
      })

      const llmResult = await graph.getInvocation(llmInvocation.id)
      const apiResult = await graph.getInvocation(apiInvocation.id)

      expect(llmResult.cost).toHaveProperty('tokens')
      expect(apiResult.cost).toHaveProperty('requests')
    })
  })

  // ==========================================================================
  // 3. Invocation History Tests
  // ==========================================================================

  describe('Invocation History', () => {
    let searchToolId: string
    let anotherAgentId: string

    beforeEach(async () => {
      anotherAgentId = await graph.createAgent({
        name: 'SearchAgent',
        provider: 'openai',
      })

      searchToolId = await graph.createTool({
        name: 'WebSearch',
        provider: 'google',
      })

      // Create a history of invocations
      const now = Date.now()

      // Agent 1 invokes SendEmail tool - completed 1 hour ago
      const inv1 = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { to: 'a@example.com' },
        startedAt: now - 3600000,
      })
      await graph.complete(inv1.id, { output: { sent: true } })

      // Agent 1 invokes SendEmail tool - completed 30 min ago
      const inv2 = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { to: 'b@example.com' },
        startedAt: now - 1800000,
      })
      await graph.complete(inv2.id, { output: { sent: true } })

      // Agent 2 invokes WebSearch tool - completed 15 min ago
      const inv3 = await graph.invoke({
        from: anotherAgentId,
        tool: searchToolId,
        input: { query: 'weather' },
        startedAt: now - 900000,
      })
      await graph.complete(inv3.id, { output: { results: [] } })

      // Agent 1 invokes WebSearch tool - completed 10 min ago
      const inv4 = await graph.invoke({
        from: agentId,
        tool: searchToolId,
        input: { query: 'news' },
        startedAt: now - 600000,
      })
      await graph.complete(inv4.id, { output: { results: [] } })
    })

    it('queries invocations by tool', async () => {
      const invocations = await graph.queryInvocations({
        tool: toolId,
      })

      expect(invocations.length).toBe(2)
      invocations.forEach(inv => {
        expect(inv.to).toBe(toolId)
      })
    })

    it('queries invocations by agent', async () => {
      const invocations = await graph.queryInvocations({
        from: agentId,
      })

      expect(invocations.length).toBe(3) // 2 email + 1 search
      invocations.forEach(inv => {
        expect(inv.from).toBe(agentId)
      })
    })

    it('queries invocations by time range', async () => {
      const now = Date.now()
      const thirtyMinAgo = now - 1800000

      const invocations = await graph.queryInvocations({
        from: agentId,
        startedAfter: thirtyMinAgo,
      })

      expect(invocations.length).toBe(2) // email at 30min + search at 10min
    })

    it('aggregates metrics by tool', async () => {
      const metrics = await graph.aggregateMetrics({
        tool: searchToolId,
      })

      expect(metrics.invocationCount).toBe(2)
      expect(metrics.totalDuration).toBeGreaterThan(0)
      expect(metrics.averageDuration).toBeGreaterThan(0)
      expect(metrics.successRate).toBe(1.0)
    })

    it('filters successful vs failed invocations', async () => {
      // Add some failed invocations
      const failed1 = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { to: 'invalid-email' },
      })
      await graph.fail(failed1.id, {
        error: { message: 'Invalid email format', code: 'INVALID_EMAIL' },
      })

      const failed2 = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { to: 'blocked@example.com' },
      })
      await graph.fail(failed2.id, {
        error: { message: 'Recipient blocked', code: 'RECIPIENT_BLOCKED' },
      })

      const successful = await graph.queryInvocations({
        tool: toolId,
        verb: 'invoked',
      })

      const failed = await graph.queryInvocations({
        tool: toolId,
        verb: 'failed',
      })

      expect(successful.length).toBe(2)
      expect(failed.length).toBe(2)
    })
  })

  // ==========================================================================
  // 4. Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    it('records error in relationship data on failure', async () => {
      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { to: 'invalid-email' },
      })

      const failed = await graph.fail(invocation.id, {
        error: {
          message: 'Invalid email address format',
          code: 'INVALID_EMAIL',
          stack: 'Error: Invalid email address format\n    at validateEmail...',
        },
      })

      expect(failed.verb).toBe('failed')
      expect(failed.error.message).toBe('Invalid email address format')
      expect(failed.error.code).toBe('INVALID_EMAIL')
      expect(failed.error.stack).toBeDefined()
    })

    it('preserves input for debugging on failure', async () => {
      const originalInput = {
        to: 'invalid@',
        subject: 'Test Subject',
        body: 'Test body content',
        attachments: [{ name: 'file.pdf', size: 1024 }],
      }

      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: originalInput,
      })

      const failed = await graph.fail(invocation.id, {
        error: { message: 'Invalid email format' },
      })

      // Input should be preserved for debugging
      expect(failed.input).toEqual(originalInput)
    })

    it('supports retry with new invocation', async () => {
      // Original failed invocation
      const original = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { to: 'user@example.com' },
      })

      await graph.fail(original.id, {
        error: { message: 'Temporary network error', code: 'NETWORK_ERROR' },
      })

      // Retry invocation with reference to original
      const retry = await graph.retry(original.id)

      expect(retry.retryOf).toBe(original.id)
      expect(retry.retryCount).toBe(1)
      expect(retry.input).toEqual(original.input)

      // Complete the retry successfully
      const completed = await graph.complete(retry.id, {
        output: { success: true },
      })

      expect(completed.verb).toBe('invoked')
    })

    it('tracks multiple retries with retry chain', async () => {
      // First attempt - fails
      const attempt1 = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { query: 'test' },
      })
      await graph.fail(attempt1.id, { error: { message: 'Rate limited' } })

      // Second attempt - fails
      const attempt2 = await graph.retry(attempt1.id)
      await graph.fail(attempt2.id, { error: { message: 'Rate limited' } })

      // Third attempt - succeeds
      const attempt3 = await graph.retry(attempt2.id)
      await graph.complete(attempt3.id, {
        output: { results: ['result1', 'result2'] },
      })

      // Verify retry chain
      const chain = await graph.getRetryChain(attempt1.id)

      expect(chain.length).toBe(3)
      expect(chain[0].id).toBe(attempt1.id)
      expect(chain[0].verb).toBe('failed')
      expect(chain[1].id).toBe(attempt2.id)
      expect(chain[1].verb).toBe('failed')
      expect(chain[2].id).toBe(attempt3.id)
      expect(chain[2].verb).toBe('invoked')
    })

    it('records error context for debugging', async () => {
      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { action: 'send_payment' },
        context: {
          sessionId: 'sess-123',
          requestId: 'req-456',
          traceId: 'trace-789',
        },
      })

      const failed = await graph.fail(invocation.id, {
        error: {
          message: 'Payment gateway timeout',
          code: 'GATEWAY_TIMEOUT',
          httpStatus: 504,
          gatewayResponse: { error: 'Connection timed out after 30s' },
        },
      })

      // Context should be preserved
      expect(failed.context.sessionId).toBe('sess-123')
      expect(failed.context.requestId).toBe('req-456')

      // Error should have full details
      expect(failed.error.httpStatus).toBe(504)
      expect(failed.error.gatewayResponse).toEqual({ error: 'Connection timed out after 30s' })
    })
  })

  // ==========================================================================
  // 5. Human/Agent Executor Tracking Tests
  // ==========================================================================

  describe('Executor Tracking', () => {
    it('tracks invocations from agent executor', async () => {
      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { action: 'automated_task' },
        executorType: 'Agent',
      })

      expect(invocation.executorType).toBe('Agent')
      expect(invocation.from).toBe(agentId)
    })

    it('tracks invocations from human executor', async () => {
      const invocation = await graph.invoke({
        from: humanId,
        tool: toolId,
        input: { action: 'manual_approval' },
        executorType: 'Human',
      })

      expect(invocation.executorType).toBe('Human')
      expect(invocation.from).toBe(humanId)
    })

    it('tracks delegated invocations (agent acting on behalf of human)', async () => {
      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { action: 'send_report' },
        executorType: 'Agent',
        delegatedBy: {
          type: 'Human',
          id: humanId,
        },
      })

      expect(invocation.delegatedBy.type).toBe('Human')
      expect(invocation.delegatedBy.id).toBe(humanId)
    })

    it('queries invocations by executor type', async () => {
      // Agent invocation
      await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { action: 'agent_task' },
        executorType: 'Agent',
      })

      // Human invocation
      await graph.invoke({
        from: humanId,
        tool: toolId,
        input: { action: 'human_task' },
        executorType: 'Human',
      })

      const agentInvocations = await graph.queryInvocations({
        executorType: 'Agent',
      })

      const humanInvocations = await graph.queryInvocations({
        executorType: 'Human',
      })

      expect(agentInvocations.length).toBe(1)
      expect(humanInvocations.length).toBe(1)
    })
  })

  // ==========================================================================
  // 6. Verb Transition Validation Tests
  // ==========================================================================

  describe('Verb Transition Validation', () => {
    it('validates invoke -> invoking transition', async () => {
      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { test: true },
      })

      expect(invocation.verb).toBe('invoke')

      const updated = await graph.transitionVerb(invocation.id, 'invoking')

      expect(updated.verb).toBe('invoking')
    })

    it('validates invoking -> invoked transition', async () => {
      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { test: true },
      })

      await graph.transitionVerb(invocation.id, 'invoking')
      const completed = await graph.complete(invocation.id, {
        output: { result: 'success' },
      })

      expect(completed.verb).toBe('invoked')
    })

    it('validates invoking -> failed transition', async () => {
      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { test: true },
      })

      await graph.transitionVerb(invocation.id, 'invoking')
      const failed = await graph.fail(invocation.id, {
        error: { message: 'Something went wrong' },
      })

      expect(failed.verb).toBe('failed')
    })

    it('rejects invalid verb transitions', async () => {
      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { test: true },
      })

      // Cannot go directly from invoke to invoked (must go through invoking)
      await expect(
        graph.complete(invocation.id, { output: {} })
      ).rejects.toThrow('Invalid verb transition: invoke -> invoked')

      // Cannot go backwards
      await graph.transitionVerb(invocation.id, 'invoking')
      await expect(
        graph.transitionVerb(invocation.id, 'invoke')
      ).rejects.toThrow('Invalid verb transition: invoking -> invoke')
    })

    it('tracks verb transition history', async () => {
      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { test: true },
      })

      await graph.transitionVerb(invocation.id, 'invoking')
      const completed = await graph.complete(invocation.id, {
        output: { success: true },
      })

      expect(completed.verbHistory.length).toBe(3)
      expect(completed.verbHistory[0].verb).toBe('invoke')
      expect(completed.verbHistory[1].verb).toBe('invoking')
      expect(completed.verbHistory[2].verb).toBe('invoked')

      // Each transition should have a timestamp
      completed.verbHistory.forEach(entry => {
        expect(entry.at).toBeDefined()
        expect(typeof entry.at).toBe('number')
      })
    })

    it('validates allowed transitions based on verb state machine', async () => {
      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { test: true },
      })

      // Check valid transitions from 'invoke'
      const validFromInvoke = graph.getValidTransitions('invoke')
      expect(validFromInvoke).toContain('invoking')
      expect(validFromInvoke).not.toContain('invoked')
      expect(validFromInvoke).not.toContain('failed')

      // Check valid transitions from 'invoking'
      const validFromInvoking = graph.getValidTransitions('invoking')
      expect(validFromInvoking).toContain('invoked')
      expect(validFromInvoking).toContain('failed')
      expect(validFromInvoking).not.toContain('invoke')
    })
  })

  // ==========================================================================
  // 7. Relationship Graph Integration Tests
  // ==========================================================================

  describe('Relationship Graph Integration', () => {
    it('stores invocations as proper graph relationships', async () => {
      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { test: true },
      })

      // Should be retrievable as a relationship
      const relationship = await graph.getRelationship(invocation.id)

      expect(relationship.type).toBe('invoke')
      expect(relationship.sourceId).toBe(agentId)
      expect(relationship.targetId).toBe(toolId)
    })

    it('supports traversing invocations from agent', async () => {
      await graph.invoke({ from: agentId, tool: toolId, input: { a: 1 } })
      await graph.invoke({ from: agentId, tool: toolId, input: { b: 2 } })

      // Get all tools invoked by this agent
      const invocations = await graph.getOutgoingInvocations(agentId)

      expect(invocations.length).toBe(2)
    })

    it('supports traversing invocations to tool', async () => {
      await graph.invoke({ from: agentId, tool: toolId, input: { a: 1 } })

      const anotherAgent = await graph.createAgent({ name: 'Agent2' })
      await graph.invoke({ from: anotherAgent, tool: toolId, input: { b: 2 } })

      // Get all agents that invoked this tool
      const invocations = await graph.getIncomingInvocations(toolId)

      expect(invocations.length).toBe(2)
    })

    it('supports time-travel queries on invocations', async () => {
      const invocation = await graph.invoke({
        from: agentId,
        tool: toolId,
        input: { version: 1 },
      })

      const timeAfterCreate = Date.now()
      await new Promise(r => setTimeout(r, 10))

      await graph.complete(invocation.id, {
        output: { result: 'done' },
      })

      // Query at time of creation - should still be in 'invoke' state
      const atCreate = await graph.getInvocation(invocation.id, {
        asOf: timeAfterCreate,
      })

      expect(atCreate.verb).toBe('invoke')
      expect(atCreate.output).toBeUndefined()

      // Query current - should be completed
      const current = await graph.getInvocation(invocation.id)

      expect(current.verb).toBe('invoked')
      expect(current.output).toBeDefined()
    })
  })
})
