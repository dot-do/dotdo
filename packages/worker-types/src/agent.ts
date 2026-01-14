/**
 * @module agent
 * @description AI agent interfaces and types
 *
 * Defines interfaces for AI-powered autonomous workers with tools,
 * memory, and goal-seeking capabilities.
 */

import type { IWorker, WorkerConfig, Task, Context, Answer, Option, Decision, ApprovalRequest, ApprovalResult, Channel, WorkerMode } from './worker'

// =============================================================================
// TOOL TYPES
// =============================================================================

/**
 * Tool definition for agent use
 */
export interface Tool {
  /** Tool name (unique identifier) */
  name: string
  /** Human-readable description */
  description: string
  /** Parameter schema */
  parameters: Record<string, unknown>
  /** Tool handler function */
  handler: (input: unknown) => Promise<unknown>
}

/**
 * Tool definition without handler (for external tools)
 */
export interface ToolDefinition {
  /** Tool name */
  name: string
  /** Human-readable description */
  description: string
  /** Parameter schema */
  parameters: Record<string, unknown>
}

// =============================================================================
// GOAL TYPES
// =============================================================================

/**
 * Goal definition for autonomous execution
 */
export interface Goal {
  /** Unique goal identifier */
  id: string
  /** Goal description */
  description: string
  /** Constraints on goal execution */
  constraints?: string[]
  /** Maximum iterations before giving up */
  maxIterations?: number
}

/**
 * Result of goal execution
 */
export interface GoalResult {
  /** Whether goal was achieved */
  success: boolean
  /** Final result (if successful) */
  result?: unknown
  /** Number of iterations taken */
  iterations: number
  /** Actions taken during execution */
  actions: string[]
}

// =============================================================================
// MEMORY TYPES
// =============================================================================

/**
 * Memory type classification
 */
export type MemoryType = 'short-term' | 'long-term' | 'episodic'

/**
 * Memory entry
 */
export interface Memory {
  /** Unique memory identifier */
  id: string
  /** Memory type */
  type: MemoryType
  /** Memory content */
  content: string
  /** Vector embedding for semantic search */
  embedding?: number[]
  /** When memory was created */
  createdAt: Date
}

/**
 * Memory search options
 */
export interface MemorySearchOptions {
  /** Limit results */
  limit?: number
  /** Memory types to search */
  types?: MemoryType[]
  /** Minimum similarity score */
  minSimilarity?: number
}

// =============================================================================
// AGENT INTERFACE
// =============================================================================

/**
 * Agent interface extending worker with AI capabilities
 *
 * Agents can:
 * - Register and execute tools
 * - Maintain persistent memory
 * - Pursue goals through autonomous loops
 * - Make AI-powered decisions
 */
export interface IAgent extends IWorker {
  /**
   * Register a tool for the agent to use
   * @param tool - Tool to register
   */
  registerTool(tool: Tool): void

  /**
   * Get all registered tools
   */
  getTools(): Tool[]

  /**
   * Execute a tool by name
   * @param name - Tool name
   * @param input - Tool input
   * @returns Tool output
   */
  executeTool(name: string, input: unknown): Promise<unknown>

  /**
   * Run an autonomous goal-seeking loop
   * @param goal - Goal to pursue
   * @returns Goal result
   */
  run(goal: Goal): Promise<GoalResult>

  /**
   * Store a memory
   * @param content - Memory content
   * @param type - Memory type
   * @returns Stored memory
   */
  remember(content: string, type?: MemoryType): Promise<Memory>

  /**
   * Get recent memories
   * @param limit - Maximum memories to return
   * @returns Recent memories
   */
  getRecentMemories(limit?: number): Promise<Memory[]>

  /**
   * Search memories by content
   * @param query - Search query
   * @param options - Search options
   * @returns Matching memories
   */
  searchMemories(query: string, options?: MemorySearchOptions): Promise<Memory[]>
}

// =============================================================================
// AGENT CONFIG
// =============================================================================

/**
 * Configuration for creating an agent
 */
export interface AgentConfig extends WorkerConfig {
  /** Pre-registered tools */
  tools?: Tool[]
  /** Default memory type for remember() */
  defaultMemoryType?: MemoryType
  /** Maximum memory entries to retain */
  memoryLimit?: number
  /** AI provider configuration */
  provider?: {
    name: string
    model?: string
    apiKey?: string
  }
}

// =============================================================================
// AGENT LOOP TYPES
// =============================================================================

/**
 * Agent loop step
 */
export interface AgentLoopStep {
  /** Step number */
  step: number
  /** Observation gathered */
  observation: Record<string, unknown>
  /** Reasoning/thinking */
  reasoning?: string
  /** Action taken */
  action: {
    type: 'tool' | 'complete' | 'wait'
    tool?: string
    input?: unknown
    result?: unknown
  }
  /** When step started */
  startedAt: Date
  /** When step completed */
  completedAt?: Date
}

/**
 * Agent loop state
 */
export interface AgentLoopState {
  /** Current goal */
  goal: Goal
  /** Completed steps */
  steps: AgentLoopStep[]
  /** Current status */
  status: 'running' | 'completed' | 'failed' | 'paused'
  /** Error (if failed) */
  error?: string
}
