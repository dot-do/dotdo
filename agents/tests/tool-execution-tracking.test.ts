/**
 * Tool Execution Tracking Tests - Agent Tool Invocations as Relationships
 *
 * TDD RED Phase: Tests for tracking Agent tool executions as Relationships in the DO Graph.
 *
 * @see dotdo-lycby - [RED] Tool Execution Tracking - Tests
 *
 * Design:
 * - Tool invocations are modeled as Relationships between Agent and Tool Things
 * - Verb forms encode execution state: invoke (intent) -> invoking (executing) -> invoked (completed)
 * - Execution metadata (input, output, duration, cost) stored in relationship data
 * - Failed executions recorded with error information
 * - Analytics queries for tool usage patterns
 *
 * The key insight: verb form IS the state, no separate status column needed:
 * - invoke (action form) = intent/pending
 * - invoking (activity form) = in-progress
 * - invoked (event form) = completed
 *
 * Uses real SQLite, NO MOCKS per CLAUDE.md testing philosophy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../../db/graph/stores/sqlite'
import type { GraphThing, GraphRelationship } from '../../db/graph/types'

// ============================================================================
// TYPE DEFINITIONS FOR TOOL EXECUTION TRACKING
// ============================================================================

/**
 * Tool execution metadata stored in relationship data
 */
interface ToolExecutionData {
  /** Tool input parameters */
  input?: Record<string, unknown>
  /** Tool output result */
  output?: unknown
  /** Execution duration in milliseconds */
  duration?: number
  /** Execution cost (tokens, API calls, etc.) */
  cost?: {
    inputTokens?: number
    outputTokens?: number
    apiCalls?: number
    estimatedCost?: number
  }
  /** Error information for failed executions */
  error?: {
    message: string
    code?: string
    stack?: string
  }
  /** Whether the execution succeeded */
  success?: boolean
  /** Timestamp when execution started */
  startedAt?: number
  /** Timestamp when execution completed */
  completedAt?: number
  /** Retry count if execution was retried */
  retryCount?: number
}

/**
 * Agent Thing data structure (simplified for testing)
 */
interface AgentThingData {
  name: string
  model: string
  mode: 'autonomous' | 'supervised' | 'interactive'
}

/**
 * Tool Thing data structure (simplified for testing)
 */
interface ToolThingData {
  name: string
  description: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
}

// ============================================================================
// CONSTANTS
// ============================================================================

const TYPE_ID_AGENT = 100
const TYPE_ID_TOOL = 101

// ============================================================================
// TEST SUITE: Tool Execution as Relationships
// ============================================================================

describe('Tool Execution as Relationships', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // 1. Tool Invocation Creates Relationship
  // ==========================================================================

  describe('Tool Invocation Creates Relationship', () => {
    it('creates invoke relationship between Agent and Tool', async () => {
      // Create Agent Thing
      const agent = await store.createThing({
        id: 'agent-ralph',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: {
          name: 'Ralph',
          model: 'claude-sonnet-4-20250514',
          mode: 'autonomous',
        } satisfies AgentThingData,
      })

      // Create Tool Thing
      const tool = await store.createThing({
        id: 'tool-read-file',
        typeId: TYPE_ID_TOOL,
        typeName: 'Tool',
        data: {
          name: 'read_file',
          description: 'Read contents of a file',
        } satisfies ToolThingData,
      })

      // Create invocation relationship with verb in action form (intent)
      const invocation = await store.createRelationship({
        id: 'exec-001',
        verb: 'invoke', // Action form = intent/pending
        from: agent.id,
        to: tool.id,
        data: {
          input: { path: '/path/to/file.ts' },
        } satisfies ToolExecutionData,
      })

      expect(invocation.id).toBe('exec-001')
      expect(invocation.verb).toBe('invoke')
      expect(invocation.from).toBe('agent-ralph')
      expect(invocation.to).toBe('tool-read-file')
    })

    it('generates unique relationship ID for each invocation', async () => {
      // Create Agent and Tool
      await store.createThing({
        id: 'agent-ralph',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: { name: 'Ralph', model: 'claude-sonnet-4-20250514', mode: 'autonomous' },
      })
      await store.createThing({
        id: 'tool-read-file',
        typeId: TYPE_ID_TOOL,
        typeName: 'Tool',
        data: { name: 'read_file', description: 'Read file' },
      })

      // Create first invocation
      const invocation1 = await store.createRelationship({
        id: 'exec-001',
        verb: 'invoke',
        from: 'agent-ralph',
        to: 'tool-read-file',
      })

      // Note: unique constraint on (verb, from, to) means we need different verb form
      // or different tool/agent for truly separate invocations
      // In practice, completed invocations use 'invoked' verb

      // Complete first invocation
      // (This simulates the verb transition to 'invoked')
      const invocation2 = await store.createRelationship({
        id: 'exec-002',
        verb: 'invoked', // Different verb form allows same from/to pair
        from: 'agent-ralph',
        to: 'tool-read-file',
      })

      expect(invocation1.id).not.toBe(invocation2.id)
    })

    it('stores tool input parameters in relationship data', async () => {
      await store.createThing({
        id: 'agent-ralph',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: { name: 'Ralph', model: 'claude-sonnet-4-20250514', mode: 'autonomous' },
      })
      await store.createThing({
        id: 'tool-bash',
        typeId: TYPE_ID_TOOL,
        typeName: 'Tool',
        data: { name: 'bash', description: 'Execute shell command' },
      })

      const toolInput = {
        command: 'git status',
        timeout: 30000,
        cwd: '/project',
      }

      const invocation = await store.createRelationship({
        id: 'exec-bash-001',
        verb: 'invoke',
        from: 'agent-ralph',
        to: 'tool-bash',
        data: {
          input: toolInput,
        } satisfies ToolExecutionData,
      })

      const data = invocation.data as ToolExecutionData
      expect(data.input).toEqual(toolInput)
    })

    it('sets startedAt timestamp on invocation', async () => {
      await store.createThing({
        id: 'agent-ralph',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: { name: 'Ralph', model: 'claude-sonnet-4-20250514', mode: 'autonomous' },
      })
      await store.createThing({
        id: 'tool-write-file',
        typeId: TYPE_ID_TOOL,
        typeName: 'Tool',
        data: { name: 'write_file', description: 'Write to file' },
      })

      const before = Date.now()

      const invocation = await store.createRelationship({
        id: 'exec-write-001',
        verb: 'invoke',
        from: 'agent-ralph',
        to: 'tool-write-file',
        data: {
          input: { path: '/file.ts', content: 'hello' },
          startedAt: Date.now(),
        } satisfies ToolExecutionData,
      })

      const after = Date.now()
      const data = invocation.data as ToolExecutionData

      expect(data.startedAt).toBeGreaterThanOrEqual(before)
      expect(data.startedAt).toBeLessThanOrEqual(after)
    })
  })

  // ==========================================================================
  // 2. Verb Form State Encoding: invoke -> invoking -> invoked
  // ==========================================================================

  describe('Verb Form State Encoding', () => {
    beforeEach(async () => {
      await store.createThing({
        id: 'agent-ralph',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: { name: 'Ralph', model: 'claude-sonnet-4-20250514', mode: 'autonomous' },
      })
      await store.createThing({
        id: 'tool-search',
        typeId: TYPE_ID_TOOL,
        typeName: 'Tool',
        data: { name: 'search', description: 'Search codebase' },
      })
    })

    it('invoke verb form represents intent/pending state', async () => {
      const intent = await store.createRelationship({
        id: 'exec-intent',
        verb: 'invoke', // Action form = intent
        from: 'agent-ralph',
        to: 'tool-search',
        data: { input: { query: 'function foo' } },
      })

      expect(intent.verb).toBe('invoke')
      // Action form indicates the execution has been requested but not yet started
    })

    it('invoking verb form represents in-progress state', async () => {
      const inProgress = await store.createRelationship({
        id: 'exec-progress',
        verb: 'invoking', // Activity form = in-progress
        from: 'agent-ralph',
        to: 'tool-search',
        data: {
          input: { query: 'function foo' },
          startedAt: Date.now(),
        },
      })

      expect(inProgress.verb).toBe('invoking')
      // Activity form indicates the execution is currently running
    })

    it('invoked verb form represents completed state', async () => {
      const completed = await store.createRelationship({
        id: 'exec-completed',
        verb: 'invoked', // Event form = completed
        from: 'agent-ralph',
        to: 'tool-search',
        data: {
          input: { query: 'function foo' },
          output: { files: ['a.ts', 'b.ts'], matches: 5 },
          duration: 150,
          success: true,
          completedAt: Date.now(),
        },
      })

      expect(completed.verb).toBe('invoked')
      // Event form indicates the execution has finished
    })

    it('transitions from invoke to invoking (start execution)', async () => {
      // Create initial intent
      const intent = await store.createRelationship({
        id: 'exec-lifecycle-1',
        verb: 'invoke',
        from: 'agent-ralph',
        to: 'tool-search',
        data: { input: { query: 'function foo' } },
      })

      expect(intent.verb).toBe('invoke')

      // Delete the invoke relationship and create invoking
      // (In a real implementation, this would be an atomic update)
      await store.deleteRelationship(intent.id)

      const inProgress = await store.createRelationship({
        id: 'exec-lifecycle-1',
        verb: 'invoking',
        from: 'agent-ralph',
        to: 'tool-search',
        data: {
          input: { query: 'function foo' },
          startedAt: Date.now(),
        },
      })

      expect(inProgress.verb).toBe('invoking')
    })

    it('transitions from invoking to invoked (complete execution)', async () => {
      const startTime = Date.now()

      // Create in-progress execution
      const inProgress = await store.createRelationship({
        id: 'exec-complete-1',
        verb: 'invoking',
        from: 'agent-ralph',
        to: 'tool-search',
        data: { input: { query: 'function foo' }, startedAt: startTime },
      })

      expect(inProgress.verb).toBe('invoking')

      // Delete and recreate as completed
      await store.deleteRelationship(inProgress.id)

      const endTime = Date.now()
      const completed = await store.createRelationship({
        id: 'exec-complete-1',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-search',
        data: {
          input: { query: 'function foo' },
          output: { matches: 10 },
          startedAt: startTime,
          completedAt: endTime,
          duration: endTime - startTime,
          success: true,
        },
      })

      expect(completed.verb).toBe('invoked')
      const data = completed.data as ToolExecutionData
      expect(data.success).toBe(true)
      expect(data.duration).toBeGreaterThanOrEqual(0)
    })

    it('full lifecycle: invoke -> invoking -> invoked', async () => {
      const input = { query: 'class MyClass' }

      // Step 1: Intent (invoke)
      let rel = await store.createRelationship({
        id: 'exec-full-lifecycle',
        verb: 'invoke',
        from: 'agent-ralph',
        to: 'tool-search',
        data: { input },
      })
      expect(rel.verb).toBe('invoke')

      // Step 2: In-progress (invoking)
      await store.deleteRelationship(rel.id)
      const startTime = Date.now()
      rel = await store.createRelationship({
        id: 'exec-full-lifecycle',
        verb: 'invoking',
        from: 'agent-ralph',
        to: 'tool-search',
        data: { input, startedAt: startTime },
      })
      expect(rel.verb).toBe('invoking')

      // Step 3: Completed (invoked)
      await store.deleteRelationship(rel.id)
      const endTime = Date.now()
      rel = await store.createRelationship({
        id: 'exec-full-lifecycle',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-search',
        data: {
          input,
          output: { results: ['found.ts'] },
          startedAt: startTime,
          completedAt: endTime,
          duration: endTime - startTime,
          success: true,
        },
      })

      expect(rel.verb).toBe('invoked')
      const data = rel.data as ToolExecutionData
      expect(data.output).toEqual({ results: ['found.ts'] })
    })
  })

  // ==========================================================================
  // 3. Tool Execution Metadata
  // ==========================================================================

  describe('Tool Execution Metadata', () => {
    beforeEach(async () => {
      await store.createThing({
        id: 'agent-ralph',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: { name: 'Ralph', model: 'claude-sonnet-4-20250514', mode: 'autonomous' },
      })
      await store.createThing({
        id: 'tool-llm-query',
        typeId: TYPE_ID_TOOL,
        typeName: 'Tool',
        data: { name: 'llm_query', description: 'Query an LLM' },
      })
    })

    it('stores input parameters', async () => {
      const input = {
        prompt: 'Write a function to sort an array',
        model: 'gpt-4',
        temperature: 0.7,
      }

      const execution = await store.createRelationship({
        id: 'exec-input',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-llm-query',
        data: {
          input,
          output: { response: 'function sort(arr) { ... }' },
          success: true,
        },
      })

      const data = execution.data as ToolExecutionData
      expect(data.input).toEqual(input)
    })

    it('stores output result', async () => {
      const output = {
        response: 'function sort(arr) { return arr.sort((a, b) => a - b); }',
        model: 'gpt-4',
        finishReason: 'stop',
      }

      const execution = await store.createRelationship({
        id: 'exec-output',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-llm-query',
        data: {
          input: { prompt: 'Write sort function' },
          output,
          success: true,
        },
      })

      const data = execution.data as ToolExecutionData
      expect(data.output).toEqual(output)
    })

    it('stores execution duration', async () => {
      const execution = await store.createRelationship({
        id: 'exec-duration',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-llm-query',
        data: {
          input: { prompt: 'Hello' },
          output: { response: 'Hi!' },
          duration: 1250, // 1.25 seconds
          success: true,
        },
      })

      const data = execution.data as ToolExecutionData
      expect(data.duration).toBe(1250)
    })

    it('stores execution cost (tokens, API calls)', async () => {
      const cost = {
        inputTokens: 150,
        outputTokens: 75,
        apiCalls: 1,
        estimatedCost: 0.002,
      }

      const execution = await store.createRelationship({
        id: 'exec-cost',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-llm-query',
        data: {
          input: { prompt: 'Explain TypeScript' },
          output: { response: 'TypeScript is...' },
          duration: 2000,
          cost,
          success: true,
        },
      })

      const data = execution.data as ToolExecutionData
      expect(data.cost).toEqual(cost)
      expect(data.cost!.inputTokens).toBe(150)
      expect(data.cost!.outputTokens).toBe(75)
      expect(data.cost!.estimatedCost).toBe(0.002)
    })

    it('stores startedAt and completedAt timestamps', async () => {
      const startedAt = Date.now()
      const completedAt = startedAt + 500

      const execution = await store.createRelationship({
        id: 'exec-timestamps',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-llm-query',
        data: {
          input: { prompt: 'Hello' },
          output: { response: 'Hi' },
          startedAt,
          completedAt,
          duration: completedAt - startedAt,
          success: true,
        },
      })

      const data = execution.data as ToolExecutionData
      expect(data.startedAt).toBe(startedAt)
      expect(data.completedAt).toBe(completedAt)
      expect(data.duration).toBe(500)
    })

    it('calculates duration from timestamps', async () => {
      const startedAt = Date.now()
      const completedAt = startedAt + 1234

      const execution = await store.createRelationship({
        id: 'exec-calc-duration',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-llm-query',
        data: {
          input: { prompt: 'Test' },
          output: { response: 'Response' },
          startedAt,
          completedAt,
          duration: completedAt - startedAt,
          success: true,
        },
      })

      const data = execution.data as ToolExecutionData
      expect(data.completedAt! - data.startedAt!).toBe(data.duration)
    })
  })

  // ==========================================================================
  // 4. Failed Tool Executions
  // ==========================================================================

  describe('Failed Tool Executions', () => {
    beforeEach(async () => {
      await store.createThing({
        id: 'agent-ralph',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: { name: 'Ralph', model: 'claude-sonnet-4-20250514', mode: 'autonomous' },
      })
      await store.createThing({
        id: 'tool-api-call',
        typeId: TYPE_ID_TOOL,
        typeName: 'Tool',
        data: { name: 'api_call', description: 'Make HTTP request' },
      })
    })

    it('records failed execution with success=false', async () => {
      const execution = await store.createRelationship({
        id: 'exec-failed-1',
        verb: 'invoked', // Even failed executions are 'invoked' (completed)
        from: 'agent-ralph',
        to: 'tool-api-call',
        data: {
          input: { url: 'https://api.example.com/broken', method: 'GET' },
          success: false,
          error: {
            message: 'Connection refused',
            code: 'ECONNREFUSED',
          },
          duration: 5000, // Timeout duration
        },
      })

      const data = execution.data as ToolExecutionData
      expect(data.success).toBe(false)
      expect(data.output).toBeUndefined()
    })

    it('stores error message', async () => {
      const execution = await store.createRelationship({
        id: 'exec-error-msg',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-api-call',
        data: {
          input: { url: 'https://api.example.com/notfound' },
          success: false,
          error: {
            message: 'Resource not found',
          },
        },
      })

      const data = execution.data as ToolExecutionData
      expect(data.error?.message).toBe('Resource not found')
    })

    it('stores error code', async () => {
      const execution = await store.createRelationship({
        id: 'exec-error-code',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-api-call',
        data: {
          input: { url: 'https://api.example.com/error' },
          success: false,
          error: {
            message: 'Internal server error',
            code: 'HTTP_500',
          },
        },
      })

      const data = execution.data as ToolExecutionData
      expect(data.error?.code).toBe('HTTP_500')
    })

    it('stores error stack trace', async () => {
      const stack = `Error: Connection timeout
    at HttpClient.request (http.ts:45)
    at Tool.execute (tool.ts:23)
    at Agent.invoke (agent.ts:100)`

      const execution = await store.createRelationship({
        id: 'exec-error-stack',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-api-call',
        data: {
          input: { url: 'https://slow.api.com' },
          success: false,
          error: {
            message: 'Connection timeout',
            code: 'ETIMEDOUT',
            stack,
          },
        },
      })

      const data = execution.data as ToolExecutionData
      expect(data.error?.stack).toBe(stack)
    })

    it('records duration even for failed executions', async () => {
      const execution = await store.createRelationship({
        id: 'exec-failed-duration',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-api-call',
        data: {
          input: { url: 'https://timeout.api.com' },
          success: false,
          error: {
            message: 'Request timeout after 30s',
            code: 'ETIMEDOUT',
          },
          duration: 30000, // Timed out after 30 seconds
        },
      })

      const data = execution.data as ToolExecutionData
      expect(data.duration).toBe(30000)
      expect(data.success).toBe(false)
    })

    it('stores retry count for retried executions', async () => {
      const execution = await store.createRelationship({
        id: 'exec-retried',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-api-call',
        data: {
          input: { url: 'https://flaky.api.com' },
          output: { status: 200, body: 'success' },
          success: true,
          retryCount: 3, // Succeeded on 4th attempt
          duration: 1500,
        },
      })

      const data = execution.data as ToolExecutionData
      expect(data.retryCount).toBe(3)
      expect(data.success).toBe(true)
    })

    it('records final failure after max retries', async () => {
      const execution = await store.createRelationship({
        id: 'exec-max-retries',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-api-call',
        data: {
          input: { url: 'https://down.api.com' },
          success: false,
          error: {
            message: 'Max retries exceeded',
            code: 'MAX_RETRIES',
          },
          retryCount: 5, // Failed all 5 retries
          duration: 150000, // Total time including retries
        },
      })

      const data = execution.data as ToolExecutionData
      expect(data.success).toBe(false)
      expect(data.retryCount).toBe(5)
    })
  })

  // ==========================================================================
  // 5. Tool Usage Analytics Queries
  // ==========================================================================

  describe('Tool Usage Analytics Queries', () => {
    beforeEach(async () => {
      // Create multiple agents
      await store.createThing({
        id: 'agent-ralph',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: { name: 'Ralph', model: 'claude-sonnet-4-20250514', mode: 'autonomous' },
      })
      await store.createThing({
        id: 'agent-priya',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: { name: 'Priya', model: 'claude-opus-4-20250514', mode: 'supervised' },
      })

      // Create multiple tools
      await store.createThing({
        id: 'tool-read-file',
        typeId: TYPE_ID_TOOL,
        typeName: 'Tool',
        data: { name: 'read_file', description: 'Read file' },
      })
      await store.createThing({
        id: 'tool-write-file',
        typeId: TYPE_ID_TOOL,
        typeName: 'Tool',
        data: { name: 'write_file', description: 'Write file' },
      })
      await store.createThing({
        id: 'tool-bash',
        typeId: TYPE_ID_TOOL,
        typeName: 'Tool',
        data: { name: 'bash', description: 'Execute shell' },
      })

      // Create executions for analytics
      // NOTE: Since relationships have unique constraint on (verb, from, to),
      // we model each execution as a unique "to" URL that includes execution context.
      // Format: tool-{name}/executions/{execution-id}
      // This allows multiple invocations of the same tool by the same agent.

      // Ralph uses read_file 3 times
      for (let i = 0; i < 3; i++) {
        await store.createRelationship({
          id: `exec-ralph-read-${i}`,
          verb: 'invoked',
          from: 'agent-ralph',
          to: `tool-read-file/executions/exec-ralph-read-${i}`, // Unique execution URL
          data: {
            input: { path: `/file${i}.ts` },
            output: { content: 'content' },
            success: true,
            duration: 50 + i * 10,
            toolId: 'tool-read-file', // Store original tool ID for analytics
          },
        })
      }

      // Ralph uses write_file 2 times
      for (let i = 0; i < 2; i++) {
        await store.createRelationship({
          id: `exec-ralph-write-${i}`,
          verb: 'invoked',
          from: 'agent-ralph',
          to: `tool-write-file/executions/exec-ralph-write-${i}`,
          data: {
            input: { path: `/output${i}.ts`, content: 'code' },
            success: true,
            duration: 100 + i * 20,
            toolId: 'tool-write-file',
          },
        })
      }

      // Priya uses bash 1 time (failed)
      await store.createRelationship({
        id: 'exec-priya-bash-0',
        verb: 'invoked',
        from: 'agent-priya',
        to: 'tool-bash/executions/exec-priya-bash-0',
        data: {
          input: { command: 'npm test' },
          success: false,
          error: { message: 'Test failed' },
          duration: 5000,
          toolId: 'tool-bash',
        },
      })

      // Priya uses read_file 1 time
      await store.createRelationship({
        id: 'exec-priya-read-0',
        verb: 'invoked',
        from: 'agent-priya',
        to: 'tool-read-file/executions/exec-priya-read-0',
        data: {
          input: { path: '/spec.md' },
          output: { content: '# Spec' },
          success: true,
          duration: 30,
          toolId: 'tool-read-file',
        },
      })
    })

    it('queries all tool usages by a specific agent', async () => {
      const ralphUsages = await store.queryRelationshipsFrom('agent-ralph', { verb: 'invoked' })

      expect(ralphUsages.length).toBe(5) // 3 read + 2 write
      expect(ralphUsages.every((r) => r.from === 'agent-ralph')).toBe(true)
    })

    it('queries tool usage for a specific tool', async () => {
      // With the execution URL pattern, we need to query by verb and filter by toolId in data
      const allInvoked = await store.queryRelationshipsByVerb('invoked')

      // Filter to find read_file usages by checking toolId in data
      const readFileUsages = allInvoked.filter((r) => {
        const data = r.data as ToolExecutionData & { toolId?: string }
        return data.toolId === 'tool-read-file'
      })

      expect(readFileUsages.length).toBe(4) // 3 by Ralph + 1 by Priya
    })

    it('queries all invoked relationships (completed executions)', async () => {
      const allInvoked = await store.queryRelationshipsByVerb('invoked')

      expect(allInvoked.length).toBe(7) // Total executions
    })

    it('can filter successful executions', async () => {
      const allInvoked = await store.queryRelationshipsByVerb('invoked')

      const successful = allInvoked.filter((r) => {
        const data = r.data as ToolExecutionData
        return data.success === true
      })

      expect(successful.length).toBe(6) // All except Priya's bash failure
    })

    it('can filter failed executions', async () => {
      const allInvoked = await store.queryRelationshipsByVerb('invoked')

      const failed = allInvoked.filter((r) => {
        const data = r.data as ToolExecutionData
        return data.success === false
      })

      expect(failed.length).toBe(1) // Only Priya's bash failure
      expect(failed[0]!.from).toBe('agent-priya')
      // Check toolId in data since 'to' now includes execution context
      const failedData = failed[0]!.data as ToolExecutionData & { toolId?: string }
      expect(failedData.toolId).toBe('tool-bash')
    })

    it('calculates total execution time for an agent', async () => {
      const ralphUsages = await store.queryRelationshipsFrom('agent-ralph', { verb: 'invoked' })

      const totalDuration = ralphUsages.reduce((sum, r) => {
        const data = r.data as ToolExecutionData
        return sum + (data.duration || 0)
      }, 0)

      // read: 50 + 60 + 70 = 180
      // write: 100 + 120 = 220
      // Total: 400
      expect(totalDuration).toBe(400)
    })

    it('calculates average execution time per tool', async () => {
      // Query all invoked and filter by toolId
      const allInvoked = await store.queryRelationshipsByVerb('invoked')
      const readFileUsages = allInvoked.filter((r) => {
        const data = r.data as ToolExecutionData & { toolId?: string }
        return data.toolId === 'tool-read-file'
      })

      const durations = readFileUsages.map((r) => {
        const data = r.data as ToolExecutionData
        return data.duration || 0
      })

      const average = durations.reduce((a, b) => a + b, 0) / durations.length

      // Ralph: 50 + 60 + 70 = 180, Priya: 30
      // Total: 210, Count: 4, Average: 52.5
      expect(average).toBe(52.5)
    })

    it('identifies most-used tool', async () => {
      const allInvoked = await store.queryRelationshipsByVerb('invoked')

      // Count usages per tool using toolId from data
      const toolCounts: Record<string, number> = {}
      for (const rel of allInvoked) {
        const data = rel.data as ToolExecutionData & { toolId?: string }
        const toolId = data.toolId || rel.to
        toolCounts[toolId] = (toolCounts[toolId] || 0) + 1
      }

      // Find most used
      let mostUsedTool = ''
      let maxCount = 0
      for (const [tool, count] of Object.entries(toolCounts)) {
        if (count > maxCount) {
          maxCount = count
          mostUsedTool = tool
        }
      }

      expect(mostUsedTool).toBe('tool-read-file')
      expect(maxCount).toBe(4)
    })

    it('identifies agent with most tool invocations', async () => {
      const allInvoked = await store.queryRelationshipsByVerb('invoked')

      // Count usages per agent
      const agentCounts: Record<string, number> = {}
      for (const rel of allInvoked) {
        agentCounts[rel.from] = (agentCounts[rel.from] || 0) + 1
      }

      let mostActiveAgent = ''
      let maxCount = 0
      for (const [agent, count] of Object.entries(agentCounts)) {
        if (count > maxCount) {
          maxCount = count
          mostActiveAgent = agent
        }
      }

      expect(mostActiveAgent).toBe('agent-ralph')
      expect(maxCount).toBe(5)
    })

    it('calculates success rate per tool', async () => {
      // Query all invoked and filter by toolId
      const allInvoked = await store.queryRelationshipsByVerb('invoked')
      const bashUsages = allInvoked.filter((r) => {
        const data = r.data as ToolExecutionData & { toolId?: string }
        return data.toolId === 'tool-bash'
      })

      const total = bashUsages.length
      const successful = bashUsages.filter((r) => (r.data as ToolExecutionData).success === true).length
      const successRate = total > 0 ? (successful / total) * 100 : 0

      expect(total).toBe(1)
      expect(successRate).toBe(0) // 0% success rate for bash (1 failure)
    })

    it('calculates success rate per agent', async () => {
      const priyaUsages = await store.queryRelationshipsFrom('agent-priya', { verb: 'invoked' })

      const total = priyaUsages.length
      const successful = priyaUsages.filter((r) => (r.data as ToolExecutionData).success === true).length
      const successRate = total > 0 ? (successful / total) * 100 : 0

      expect(total).toBe(2)
      expect(successful).toBe(1) // 1 success (read_file), 1 failure (bash)
      expect(successRate).toBe(50)
    })
  })

  // ==========================================================================
  // 6. Edge Cases and Error Handling
  // ==========================================================================

  describe('Edge Cases and Error Handling', () => {
    beforeEach(async () => {
      await store.createThing({
        id: 'agent-ralph',
        typeId: TYPE_ID_AGENT,
        typeName: 'Agent',
        data: { name: 'Ralph', model: 'claude-sonnet-4-20250514', mode: 'autonomous' },
      })
      await store.createThing({
        id: 'tool-complex',
        typeId: TYPE_ID_TOOL,
        typeName: 'Tool',
        data: { name: 'complex_tool', description: 'Complex operations' },
      })
    })

    it('handles large input parameters', async () => {
      const largeInput = {
        content: 'x'.repeat(10000), // 10KB of content
        files: Array.from({ length: 100 }, (_, i) => `/file${i}.ts`),
        nested: { deep: { data: { value: 123 } } },
      }

      const execution = await store.createRelationship({
        id: 'exec-large-input',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-complex',
        data: {
          input: largeInput,
          output: { result: 'processed' },
          success: true,
        },
      })

      const data = execution.data as ToolExecutionData
      expect((data.input as Record<string, unknown>).content).toBe('x'.repeat(10000))
    })

    it('handles large output results', async () => {
      const largeOutput = {
        results: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `result-${i}`,
          data: { value: i * 2 },
        })),
      }

      const execution = await store.createRelationship({
        id: 'exec-large-output',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-complex',
        data: {
          input: { query: 'find all' },
          output: largeOutput,
          success: true,
        },
      })

      const data = execution.data as ToolExecutionData
      const output = data.output as { results: unknown[] }
      expect(output.results.length).toBe(1000)
    })

    it('handles null/undefined output for void tools', async () => {
      const execution = await store.createRelationship({
        id: 'exec-void-output',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-complex',
        data: {
          input: { action: 'cleanup' },
          // output is intentionally undefined - tool has no return value
          success: true,
        },
      })

      const data = execution.data as ToolExecutionData
      expect(data.output).toBeUndefined()
      expect(data.success).toBe(true)
    })

    it('handles special characters in input/output', async () => {
      const execution = await store.createRelationship({
        id: 'exec-special-chars',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-complex',
        data: {
          input: {
            query: "SELECT * FROM users WHERE name = 'O''Brien'",
            emoji: '🚀💻',
            unicode: 'Привет мир 你好世界',
          },
          output: {
            message: 'Processed "quoted" and \'single-quoted\' strings',
          },
          success: true,
        },
      })

      const data = execution.data as ToolExecutionData
      const input = data.input as Record<string, unknown>
      expect(input.emoji).toBe('🚀💻')
      expect(input.unicode).toBe('Привет мир 你好世界')
    })

    it('handles very long execution duration', async () => {
      const execution = await store.createRelationship({
        id: 'exec-long-duration',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-complex',
        data: {
          input: { task: 'long running' },
          output: { completed: true },
          duration: 3600000, // 1 hour in milliseconds
          success: true,
        },
      })

      const data = execution.data as ToolExecutionData
      expect(data.duration).toBe(3600000)
    })

    it('handles zero duration for instant operations', async () => {
      const execution = await store.createRelationship({
        id: 'exec-zero-duration',
        verb: 'invoked',
        from: 'agent-ralph',
        to: 'tool-complex',
        data: {
          input: { cache: true },
          output: { cached: true },
          duration: 0, // Cached result, instant
          success: true,
        },
      })

      const data = execution.data as ToolExecutionData
      expect(data.duration).toBe(0)
    })

    it('handles concurrent tool executions by same agent', async () => {
      // Create multiple in-progress executions
      const exec1 = await store.createRelationship({
        id: 'exec-concurrent-1',
        verb: 'invoking',
        from: 'agent-ralph',
        to: 'tool-complex',
        data: { input: { task: 'task1' }, startedAt: Date.now() },
      })

      // Create a different tool execution
      await store.createThing({
        id: 'tool-other',
        typeId: TYPE_ID_TOOL,
        typeName: 'Tool',
        data: { name: 'other_tool', description: 'Other' },
      })

      const exec2 = await store.createRelationship({
        id: 'exec-concurrent-2',
        verb: 'invoking',
        from: 'agent-ralph',
        to: 'tool-other',
        data: { input: { task: 'task2' }, startedAt: Date.now() },
      })

      // Both should exist
      const inProgress = await store.queryRelationshipsFrom('agent-ralph', { verb: 'invoking' })
      expect(inProgress.length).toBe(2)
    })
  })
})

// ============================================================================
// INTEGRATION TEST: Complete Tool Execution Workflow
// ============================================================================

describe('Complete Tool Execution Workflow', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    // Setup agent and tool
    await store.createThing({
      id: 'agent-ralph',
      typeId: TYPE_ID_AGENT,
      typeName: 'Agent',
      data: { name: 'Ralph', model: 'claude-sonnet-4-20250514', mode: 'autonomous' },
    })
    await store.createThing({
      id: 'tool-edit-file',
      typeId: TYPE_ID_TOOL,
      typeName: 'Tool',
      data: { name: 'edit_file', description: 'Edit a file' },
    })
  })

  afterEach(async () => {
    await store.close()
  })

  it('demonstrates full tool execution workflow with state transitions', async () => {
    const executionId = 'exec-workflow-demo'
    const input = {
      path: '/src/index.ts',
      oldString: 'console.log',
      newString: 'logger.info',
    }

    // Step 1: Create intent (invoke)
    // This represents the agent deciding to use a tool
    let execution = await store.createRelationship({
      id: executionId,
      verb: 'invoke',
      from: 'agent-ralph',
      to: 'tool-edit-file',
      data: { input } satisfies ToolExecutionData,
    })
    expect(execution.verb).toBe('invoke')

    // Verify intent is queryable
    let intents = await store.queryRelationshipsFrom('agent-ralph', { verb: 'invoke' })
    expect(intents.some((r) => r.id === executionId)).toBe(true)

    // Step 2: Start execution (transition to invoking)
    // This represents the tool beginning to execute
    await store.deleteRelationship(executionId)
    const startTime = Date.now()

    execution = await store.createRelationship({
      id: executionId,
      verb: 'invoking',
      from: 'agent-ralph',
      to: 'tool-edit-file',
      data: {
        input,
        startedAt: startTime,
      } satisfies ToolExecutionData,
    })
    expect(execution.verb).toBe('invoking')

    // Verify in-progress is queryable
    let inProgress = await store.queryRelationshipsFrom('agent-ralph', { verb: 'invoking' })
    expect(inProgress.some((r) => r.id === executionId)).toBe(true)

    // Step 3: Complete execution (transition to invoked)
    // This represents the tool finishing successfully
    await store.deleteRelationship(executionId)
    const endTime = Date.now()

    execution = await store.createRelationship({
      id: executionId,
      verb: 'invoked',
      from: 'agent-ralph',
      to: 'tool-edit-file',
      data: {
        input,
        output: { replacements: 3, file: '/src/index.ts' },
        startedAt: startTime,
        completedAt: endTime,
        duration: endTime - startTime,
        success: true,
      } satisfies ToolExecutionData,
    })
    expect(execution.verb).toBe('invoked')

    // Verify completed is queryable
    let completed = await store.queryRelationshipsFrom('agent-ralph', { verb: 'invoked' })
    expect(completed.some((r) => r.id === executionId)).toBe(true)

    // Verify full execution data
    const finalData = execution.data as ToolExecutionData
    expect(finalData.input).toEqual(input)
    expect(finalData.output).toEqual({ replacements: 3, file: '/src/index.ts' })
    expect(finalData.success).toBe(true)
    expect(finalData.duration).toBeGreaterThanOrEqual(0)
  })

  it('demonstrates failed tool execution workflow', async () => {
    const executionId = 'exec-failed-demo'
    const input = {
      path: '/nonexistent/file.ts',
      oldString: 'foo',
      newString: 'bar',
    }

    // Start execution
    const startTime = Date.now()
    await store.createRelationship({
      id: executionId,
      verb: 'invoking',
      from: 'agent-ralph',
      to: 'tool-edit-file',
      data: { input, startedAt: startTime },
    })

    // Simulate failure and complete with error
    await store.deleteRelationship(executionId)
    const endTime = Date.now()

    const execution = await store.createRelationship({
      id: executionId,
      verb: 'invoked',
      from: 'agent-ralph',
      to: 'tool-edit-file',
      data: {
        input,
        success: false,
        error: {
          message: 'File not found: /nonexistent/file.ts',
          code: 'ENOENT',
        },
        startedAt: startTime,
        completedAt: endTime,
        duration: endTime - startTime,
      } satisfies ToolExecutionData,
    })

    expect(execution.verb).toBe('invoked')
    const data = execution.data as ToolExecutionData
    expect(data.success).toBe(false)
    expect(data.error?.code).toBe('ENOENT')
  })
})

// ============================================================================
// [RED] TOOL EXECUTION TRACKER API TESTS - NOT YET IMPLEMENTED
// ============================================================================
// These tests define the expected API for a ToolExecutionTracker helper class
// that provides type-safe tool execution tracking with automatic state transitions.
// Currently expected to FAIL until the implementation is created.

describe('[RED] ToolExecutionTracker API (Not Yet Implemented)', () => {
  it('exports ToolExecutionTracker from agents/tool-execution-tracker', async () => {
    // This test will FAIL until ToolExecutionTracker is implemented
    const trackerModule = await import('../tool-execution-tracker').catch(() => null)

    expect(trackerModule).not.toBeNull()
    expect(trackerModule?.ToolExecutionTracker).toBeDefined()
  })

  it('ToolExecutionTracker.start() creates invoke relationship and returns execution handle', async () => {
    // This test will FAIL until ToolExecutionTracker is implemented
    const trackerModule = await import('../tool-execution-tracker').catch(() => null)
    if (!trackerModule?.ToolExecutionTracker) {
      throw new Error('ToolExecutionTracker not implemented - waiting for agents/tool-execution-tracker.ts')
    }

    const store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    try {
      const tracker = new trackerModule.ToolExecutionTracker(store)

      const execution = await tracker.start({
        agentId: 'agent-ralph',
        toolId: 'tool-read-file',
        input: { path: '/file.ts' },
      })

      expect(execution.id).toBeDefined()
      expect(execution.state).toBe('pending')

      // Should create relationship with 'invoke' verb
      const relationships = await store.queryRelationshipsFrom('agent-ralph', { verb: 'invoke' })
      expect(relationships.length).toBe(1)
    } finally {
      await store.close()
    }
  })

  it('execution.begin() transitions from invoke to invoking', async () => {
    // This test will FAIL until ToolExecutionTracker is implemented
    const trackerModule = await import('../tool-execution-tracker').catch(() => null)
    if (!trackerModule?.ToolExecutionTracker) {
      throw new Error('ToolExecutionTracker not implemented')
    }

    const store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    try {
      const tracker = new trackerModule.ToolExecutionTracker(store)

      const execution = await tracker.start({
        agentId: 'agent-ralph',
        toolId: 'tool-read-file',
        input: { path: '/file.ts' },
      })

      await execution.begin()

      expect(execution.state).toBe('in_progress')

      // Should now have 'invoking' relationship
      const relationships = await store.queryRelationshipsFrom('agent-ralph', { verb: 'invoking' })
      expect(relationships.length).toBe(1)
    } finally {
      await store.close()
    }
  })

  it('execution.complete() transitions from invoking to invoked with output', async () => {
    // This test will FAIL until ToolExecutionTracker is implemented
    const trackerModule = await import('../tool-execution-tracker').catch(() => null)
    if (!trackerModule?.ToolExecutionTracker) {
      throw new Error('ToolExecutionTracker not implemented')
    }

    const store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    try {
      const tracker = new trackerModule.ToolExecutionTracker(store)

      const execution = await tracker.start({
        agentId: 'agent-ralph',
        toolId: 'tool-read-file',
        input: { path: '/file.ts' },
      })

      await execution.begin()
      await execution.complete({ content: 'file contents', size: 1024 })

      expect(execution.state).toBe('completed')
      expect(execution.output).toEqual({ content: 'file contents', size: 1024 })
      expect(execution.success).toBe(true)
      expect(execution.duration).toBeGreaterThanOrEqual(0)

      // Should now have 'invoked' relationship
      const relationships = await store.queryRelationshipsFrom('agent-ralph', { verb: 'invoked' })
      expect(relationships.length).toBe(1)
    } finally {
      await store.close()
    }
  })

  it('execution.fail() transitions to invoked with error', async () => {
    // This test will FAIL until ToolExecutionTracker is implemented
    const trackerModule = await import('../tool-execution-tracker').catch(() => null)
    if (!trackerModule?.ToolExecutionTracker) {
      throw new Error('ToolExecutionTracker not implemented')
    }

    const store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    try {
      const tracker = new trackerModule.ToolExecutionTracker(store)

      const execution = await tracker.start({
        agentId: 'agent-ralph',
        toolId: 'tool-read-file',
        input: { path: '/nonexistent.ts' },
      })

      await execution.begin()
      await execution.fail(new Error('File not found'))

      expect(execution.state).toBe('completed')
      expect(execution.success).toBe(false)
      expect(execution.error?.message).toBe('File not found')

      // Should have 'invoked' relationship with error data
      const relationships = await store.queryRelationshipsFrom('agent-ralph', { verb: 'invoked' })
      expect(relationships.length).toBe(1)
      const data = relationships[0]!.data as ToolExecutionData
      expect(data.success).toBe(false)
    } finally {
      await store.close()
    }
  })

  it('execution.run() executes callback and auto-transitions states', async () => {
    // This test will FAIL until ToolExecutionTracker is implemented
    // This is a convenience method that handles begin/complete/fail automatically
    const trackerModule = await import('../tool-execution-tracker').catch(() => null)
    if (!trackerModule?.ToolExecutionTracker) {
      throw new Error('ToolExecutionTracker not implemented')
    }

    const store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    try {
      const tracker = new trackerModule.ToolExecutionTracker(store)

      const execution = await tracker.start({
        agentId: 'agent-ralph',
        toolId: 'tool-read-file',
        input: { path: '/file.ts' },
      })

      // run() handles begin/complete automatically
      const result = await execution.run(async () => {
        return { content: 'file contents' }
      })

      expect(result).toEqual({ content: 'file contents' })
      expect(execution.state).toBe('completed')
      expect(execution.success).toBe(true)
    } finally {
      await store.close()
    }
  })

  it('execution.run() auto-fails on exception', async () => {
    // This test will FAIL until ToolExecutionTracker is implemented
    const trackerModule = await import('../tool-execution-tracker').catch(() => null)
    if (!trackerModule?.ToolExecutionTracker) {
      throw new Error('ToolExecutionTracker not implemented')
    }

    const store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    try {
      const tracker = new trackerModule.ToolExecutionTracker(store)

      const execution = await tracker.start({
        agentId: 'agent-ralph',
        toolId: 'tool-bash',
        input: { command: 'exit 1' },
      })

      await expect(
        execution.run(async () => {
          throw new Error('Command failed')
        })
      ).rejects.toThrow('Command failed')

      expect(execution.state).toBe('completed')
      expect(execution.success).toBe(false)
      expect(execution.error?.message).toBe('Command failed')
    } finally {
      await store.close()
    }
  })

  it('tracker.getByAgent() returns all executions for an agent', async () => {
    // This test will FAIL until ToolExecutionTracker is implemented
    const trackerModule = await import('../tool-execution-tracker').catch(() => null)
    if (!trackerModule?.ToolExecutionTracker) {
      throw new Error('ToolExecutionTracker not implemented')
    }

    const store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    try {
      const tracker = new trackerModule.ToolExecutionTracker(store)

      // Create multiple executions
      const exec1 = await tracker.start({ agentId: 'agent-ralph', toolId: 'tool-1', input: {} })
      await exec1.run(async () => ({ result: 1 }))

      const exec2 = await tracker.start({ agentId: 'agent-ralph', toolId: 'tool-2', input: {} })
      await exec2.run(async () => ({ result: 2 }))

      const executions = await tracker.getByAgent('agent-ralph')
      expect(executions.length).toBe(2)
    } finally {
      await store.close()
    }
  })

  it('tracker.getByTool() returns all executions for a tool', async () => {
    // This test will FAIL until ToolExecutionTracker is implemented
    const trackerModule = await import('../tool-execution-tracker').catch(() => null)
    if (!trackerModule?.ToolExecutionTracker) {
      throw new Error('ToolExecutionTracker not implemented')
    }

    const store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    try {
      const tracker = new trackerModule.ToolExecutionTracker(store)

      // Create executions from different agents
      const exec1 = await tracker.start({ agentId: 'agent-ralph', toolId: 'tool-read', input: {} })
      await exec1.run(async () => ({}))

      const exec2 = await tracker.start({ agentId: 'agent-priya', toolId: 'tool-read', input: {} })
      await exec2.run(async () => ({}))

      const executions = await tracker.getByTool('tool-read')
      expect(executions.length).toBe(2)
    } finally {
      await store.close()
    }
  })

  it('tracker.getStats() returns aggregate statistics', async () => {
    // This test will FAIL until ToolExecutionTracker is implemented
    const trackerModule = await import('../tool-execution-tracker').catch(() => null)
    if (!trackerModule?.ToolExecutionTracker) {
      throw new Error('ToolExecutionTracker not implemented')
    }

    const store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    try {
      const tracker = new trackerModule.ToolExecutionTracker(store)

      // Create some successful executions
      for (let i = 0; i < 5; i++) {
        const exec = await tracker.start({ agentId: 'agent-ralph', toolId: 'tool-read', input: {} })
        await exec.run(async () => ({}))
      }

      // Create a failed execution
      const failExec = await tracker.start({ agentId: 'agent-ralph', toolId: 'tool-read', input: {} })
      await failExec.begin()
      await failExec.fail(new Error('Failed'))

      const stats = await tracker.getStats()
      expect(stats.totalExecutions).toBe(6)
      expect(stats.successfulExecutions).toBe(5)
      expect(stats.failedExecutions).toBe(1)
      expect(stats.successRate).toBeCloseTo(83.33, 1)
    } finally {
      await store.close()
    }
  })

  it('tracker integrates with VerbFormStateMachine for transitions', async () => {
    // This test will FAIL until ToolExecutionTracker is implemented
    // Verifies the tracker uses the verb-forms module internally
    const trackerModule = await import('../tool-execution-tracker').catch(() => null)
    if (!trackerModule?.ToolExecutionTracker) {
      throw new Error('ToolExecutionTracker not implemented')
    }

    const store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    try {
      const tracker = new trackerModule.ToolExecutionTracker(store)

      const execution = await tracker.start({
        agentId: 'agent-ralph',
        toolId: 'tool-read',
        input: {},
      })

      // Internal verb form should be 'invoke'
      expect(execution.verbForm).toBe('invoke')

      await execution.begin()
      // Internal verb form should transition to 'invoking'
      expect(execution.verbForm).toBe('invoking')

      await execution.complete({})
      // Internal verb form should transition to 'invoked'
      expect(execution.verbForm).toBe('invoked')
    } finally {
      await store.close()
    }
  })

  it('execution tracks cost metrics when provided', async () => {
    // This test will FAIL until ToolExecutionTracker is implemented
    const trackerModule = await import('../tool-execution-tracker').catch(() => null)
    if (!trackerModule?.ToolExecutionTracker) {
      throw new Error('ToolExecutionTracker not implemented')
    }

    const store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    try {
      const tracker = new trackerModule.ToolExecutionTracker(store)

      const execution = await tracker.start({
        agentId: 'agent-ralph',
        toolId: 'tool-llm',
        input: { prompt: 'Hello' },
      })

      await execution.begin()
      await execution.complete(
        { response: 'Hi there!' },
        {
          cost: {
            inputTokens: 5,
            outputTokens: 3,
            estimatedCost: 0.0001,
          },
        }
      )

      expect(execution.cost).toEqual({
        inputTokens: 5,
        outputTokens: 3,
        estimatedCost: 0.0001,
      })

      // Stats should include cost aggregation
      const stats = await tracker.getStats()
      expect(stats.totalInputTokens).toBe(5)
      expect(stats.totalOutputTokens).toBe(3)
      expect(stats.totalCost).toBe(0.0001)
    } finally {
      await store.close()
    }
  })
})
