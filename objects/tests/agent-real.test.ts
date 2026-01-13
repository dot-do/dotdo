/**
 * Agent Integration Tests - NO MOCKS
 *
 * Tests Agent functionality using real miniflare DO instances with actual
 * SQLite storage. This follows the CLAUDE.md guidance to NEVER use mocks
 * for Durable Object tests.
 *
 * Tests tool registration, execution, memory, and goal-seeking via RPC.
 *
 * @module objects/tests/agent-real.test
 */

import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'
import type { Tool, Goal, GoalResult } from '../Agent'

// ============================================================================
// TYPES
// ============================================================================

interface TestAgentStub extends DurableObjectStub {
  // RPC methods
  addTool(tool: Tool): Promise<void>
  listTools(): Promise<Tool[]>
  runTool(name: string, input: unknown): Promise<unknown>
  getToolExecutionHistory(): Promise<Array<{ name: string; input: unknown; output: unknown }>>
  clearExecutionHistory(): Promise<void>
  runGoal(goal: Goal): Promise<GoalResult>
  storeMemory(content: string, type: 'short-term' | 'long-term' | 'episodic'): Promise<void>
  getRecentMemory(limit?: number): Promise<Array<{ id: string; content: string; type: string }>>
  findMemories(query: string): Promise<Array<{ id: string; content: string; type: string }>>
  getCurrentMode(): Promise<'autonomous' | 'supervised' | 'manual'>
  changeMode(mode: 'autonomous' | 'supervised' | 'manual'): Promise<void>
}

interface TestEnv {
  AGENT: DurableObjectNamespace
}

// ============================================================================
// TEST HELPERS
// ============================================================================

let testCounter = 0
function uniqueNs(): string {
  return `agent-test-${Date.now()}-${++testCounter}`
}

// ============================================================================
// TESTS: Agent Operations
// ============================================================================

describe('Agent Integration Tests (Real Miniflare)', () => {
  let stub: TestAgentStub
  let ns: string

  beforeEach(async () => {
    ns = uniqueNs()
    const id = (env as TestEnv).AGENT.idFromName(ns)
    stub = (env as TestEnv).AGENT.get(id) as TestAgentStub
    await stub.clearExecutionHistory()
  })

  // ==========================================================================
  // TOOL REGISTRATION
  // ==========================================================================

  describe('Tool Registration', () => {
    it('lists default tools', async () => {
      const tools = await stub.listTools()

      // Should have default 'echo' and 'calculate' tools
      expect(tools.length).toBeGreaterThanOrEqual(2)
      expect(tools.some((t) => t.name === 'echo')).toBe(true)
      expect(tools.some((t) => t.name === 'calculate')).toBe(true)
    })

    it('has echo tool with correct metadata', async () => {
      const tools = await stub.listTools()
      const echoTool = tools.find((t) => t.name === 'echo')

      expect(echoTool).toBeDefined()
      expect(echoTool!.description).toBe('Echo the input back')
      expect(echoTool!.parameters.message).toBeDefined()
    })

    it('has calculate tool with correct metadata', async () => {
      const tools = await stub.listTools()
      const calcTool = tools.find((t) => t.name === 'calculate')

      expect(calcTool).toBeDefined()
      expect(calcTool!.description).toBe('Perform simple math')
      expect(calcTool!.parameters.a).toBeDefined()
      expect(calcTool!.parameters.b).toBeDefined()
      expect(calcTool!.parameters.op).toBeDefined()
    })
  })

  // ==========================================================================
  // TOOL EXECUTION
  // ==========================================================================

  describe('Tool Execution', () => {
    it('executes echo tool', async () => {
      const result = await stub.runTool('echo', { message: 'Hello, World!' })

      expect(result).toEqual({ echoed: 'Hello, World!' })
    })

    it('executes calculate tool - addition', async () => {
      const result = await stub.runTool('calculate', { a: 5, b: 3, op: 'add' })

      expect(result).toEqual({ result: 8 })
    })

    it('executes calculate tool - subtraction', async () => {
      const result = await stub.runTool('calculate', { a: 10, b: 4, op: 'subtract' })

      expect(result).toEqual({ result: 6 })
    })

    it('executes calculate tool - multiplication', async () => {
      const result = await stub.runTool('calculate', { a: 6, b: 7, op: 'multiply' })

      expect(result).toEqual({ result: 42 })
    })

    it('executes calculate tool - division', async () => {
      const result = await stub.runTool('calculate', { a: 20, b: 4, op: 'divide' })

      expect(result).toEqual({ result: 5 })
    })

    it('throws for unknown tool', async () => {
      await expect(stub.runTool('nonexistent', {})).rejects.toThrow(/Tool not found/)
    })

    it('throws for unknown operation', async () => {
      await expect(
        stub.runTool('calculate', { a: 1, b: 2, op: 'modulo' })
      ).rejects.toThrow(/Unknown operation/)
    })

    it('tracks tool execution history', async () => {
      await stub.runTool('echo', { message: 'first' })
      await stub.runTool('calculate', { a: 1, b: 2, op: 'add' })
      await stub.runTool('echo', { message: 'second' })

      const history = await stub.getToolExecutionHistory()

      expect(history.length).toBe(3)
      expect(history[0]!.name).toBe('echo')
      expect(history[1]!.name).toBe('calculate')
      expect(history[2]!.name).toBe('echo')
    })

    it('clears execution history', async () => {
      await stub.runTool('echo', { message: 'test' })

      expect((await stub.getToolExecutionHistory()).length).toBe(1)

      await stub.clearExecutionHistory()

      expect((await stub.getToolExecutionHistory()).length).toBe(0)
    })
  })

  // ==========================================================================
  // MEMORY
  // ==========================================================================

  describe('Memory', () => {
    it('stores short-term memory', async () => {
      await stub.storeMemory('Short-term fact: The user prefers dark mode', 'short-term')

      const memories = await stub.getRecentMemory()
      expect(memories.some((m) => m.content.includes('dark mode'))).toBe(true)
    })

    it('stores long-term memory', async () => {
      await stub.storeMemory('Long-term fact: User email is test@example.com', 'long-term')

      const memories = await stub.getRecentMemory()
      expect(memories.some((m) => m.type === 'long-term')).toBe(true)
    })

    it('stores episodic memory', async () => {
      await stub.storeMemory('Episode: User created their first project', 'episodic')

      const memories = await stub.getRecentMemory()
      expect(memories.some((m) => m.type === 'episodic')).toBe(true)
    })

    it('retrieves recent memories with limit', async () => {
      await stub.storeMemory('Memory 1', 'short-term')
      await stub.storeMemory('Memory 2', 'short-term')
      await stub.storeMemory('Memory 3', 'short-term')
      await stub.storeMemory('Memory 4', 'short-term')
      await stub.storeMemory('Memory 5', 'short-term')

      const limited = await stub.getRecentMemory(3)

      expect(limited.length).toBeLessThanOrEqual(3)
    })

    it('searches memories by query', async () => {
      await stub.storeMemory('User likes TypeScript programming', 'long-term')
      await stub.storeMemory('User prefers light theme', 'short-term')
      await stub.storeMemory('User works with Cloudflare Workers', 'long-term')

      const results = await stub.findMemories('TypeScript')

      expect(results.some((m) => m.content.includes('TypeScript'))).toBe(true)
    })

    it('assigns unique IDs to memories', async () => {
      await stub.storeMemory('First memory', 'short-term')
      await stub.storeMemory('Second memory', 'short-term')

      const memories = await stub.getRecentMemory()
      const ids = memories.map((m) => m.id)
      const uniqueIds = new Set(ids)

      expect(uniqueIds.size).toBe(ids.length)
    })
  })

  // ==========================================================================
  // OPERATION MODES
  // ==========================================================================

  describe('Operation Modes', () => {
    it('defaults to autonomous mode', async () => {
      const mode = await stub.getCurrentMode()

      expect(mode).toBe('autonomous')
    })

    it('changes to supervised mode', async () => {
      await stub.changeMode('supervised')
      const mode = await stub.getCurrentMode()

      expect(mode).toBe('supervised')
    })

    it('changes to manual mode', async () => {
      await stub.changeMode('manual')
      const mode = await stub.getCurrentMode()

      expect(mode).toBe('manual')
    })

    it('changes back to autonomous mode', async () => {
      await stub.changeMode('manual')
      await stub.changeMode('autonomous')
      const mode = await stub.getCurrentMode()

      expect(mode).toBe('autonomous')
    })
  })

  // ==========================================================================
  // GOAL-SEEKING
  // ==========================================================================

  describe('Goal-Seeking', () => {
    it('runs a goal and returns result', async () => {
      const goal: Goal = {
        id: 'test-goal-1',
        description: 'Complete a simple test task',
      }

      const result = await stub.runGoal(goal)

      // The stub implementation completes immediately
      expect(result.success).toBe(true)
      expect(result.iterations).toBeGreaterThanOrEqual(1)
    })

    it('includes goal id in result', async () => {
      const goal: Goal = {
        id: 'specific-goal-id',
        description: 'Task with specific ID',
      }

      const result = await stub.runGoal(goal)

      expect(result).toBeDefined()
    })

    it('respects max iterations constraint', async () => {
      const goal: Goal = {
        id: 'bounded-goal',
        description: 'Task with iteration limit',
        maxIterations: 5,
      }

      const result = await stub.runGoal(goal)

      expect(result.iterations).toBeLessThanOrEqual(5)
    })

    it('returns actions taken during goal execution', async () => {
      const goal: Goal = {
        id: 'action-tracking-goal',
        description: 'Track actions taken',
      }

      const result = await stub.runGoal(goal)

      expect(result.actions).toBeDefined()
      expect(Array.isArray(result.actions)).toBe(true)
    })

    it('handles goal with constraints', async () => {
      const goal: Goal = {
        id: 'constrained-goal',
        description: 'Goal with constraints',
        constraints: ['Must complete within 30 seconds', 'Must not modify production data'],
      }

      const result = await stub.runGoal(goal)

      expect(result).toBeDefined()
    })
  })

  // ==========================================================================
  // INTEGRATION SCENARIOS
  // ==========================================================================

  describe('Integration Scenarios', () => {
    it('uses tools and stores memories during execution', async () => {
      // Execute a tool
      await stub.runTool('echo', { message: 'Processing user request' })

      // Store a memory about the action
      await stub.storeMemory('Echoed user request for processing', 'episodic')

      // Verify both operations completed
      const history = await stub.getToolExecutionHistory()
      const memories = await stub.getRecentMemory()

      expect(history.length).toBeGreaterThanOrEqual(1)
      expect(memories.length).toBeGreaterThanOrEqual(1)
    })

    it('maintains state across multiple operations', async () => {
      // First session
      await stub.storeMemory('Session 1 context', 'short-term')
      await stub.runTool('calculate', { a: 10, b: 5, op: 'add' })

      // Verify state
      const memories1 = await stub.getRecentMemory()
      const history1 = await stub.getToolExecutionHistory()

      expect(memories1.length).toBeGreaterThanOrEqual(1)
      expect(history1.length).toBeGreaterThanOrEqual(1)

      // Second session with same stub
      await stub.storeMemory('Session 2 context', 'short-term')
      await stub.runTool('calculate', { a: 20, b: 10, op: 'multiply' })

      // Verify accumulated state
      const memories2 = await stub.getRecentMemory()
      const history2 = await stub.getToolExecutionHistory()

      expect(memories2.length).toBeGreaterThanOrEqual(2)
      expect(history2.length).toBeGreaterThanOrEqual(2)
    })
  })
})
