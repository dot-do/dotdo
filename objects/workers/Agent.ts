/**
 * @module Agent
 * @description AI-powered autonomous worker with tools, memory, and goal-seeking
 *
 * Agent extends Worker with AI capabilities for building autonomous digital workers.
 * Agents can use tools, maintain persistent memory, and pursue goals through
 * an observe-think-act loop. They are the foundation for AI-driven automation
 * in the dotdo framework.
 *
 * **Core Features:**
 * - Tool registration and execution
 * - Persistent memory (short-term, long-term, episodic)
 * - Goal-seeking autonomous execution
 * - Multiple operation modes (autonomous, supervised, manual)
 * - Integration with AI providers via unified memory
 *
 * **Operation Modes:**
 * | Mode | Description | Use Case |
 * |------|-------------|----------|
 * | `autonomous` | Agent makes all decisions | Background tasks |
 * | `supervised` | Agent proposes, human approves | Important decisions |
 * | `manual` | Human controls, agent assists | Learning phase |
 *
 * **Memory Types:**
 * | Type | Description | Example |
 * |------|-------------|---------|
 * | `short-term` | Recent context | Last few interactions |
 * | `long-term` | Persistent knowledge | Customer preferences |
 * | `episodic` | Event sequences | Past conversation flows |
 *
 * **Agent Loop (observe-think-act):**
 * ```
 * 1. observe() - Gather current state and memories
 * 2. think() - Reason about action to take
 * 3. act() - Execute action using tools
 * 4. Repeat until goal achieved or max iterations
 * ```
 *
 * @example Basic Agent with Tools
 * ```typescript
 * class SupportAgent extends Agent {
 *   static override readonly $type = 'SupportAgent'
 *
 *   async onStart() {
 *     // Register tools the agent can use
 *     this.registerTool({
 *       name: 'searchKnowledgeBase',
 *       description: 'Search the knowledge base for relevant articles',
 *       parameters: { query: { type: 'string' } },
 *       handler: async (input) => {
 *         const { query } = input as { query: string }
 *         return this.searchArticles(query)
 *       }
 *     })
 *
 *     this.registerTool({
 *       name: 'createTicket',
 *       description: 'Create a support ticket',
 *       parameters: { subject: { type: 'string' }, description: { type: 'string' } },
 *       handler: async (input) => {
 *         const { subject, description } = input as { subject: string, description: string }
 *         return this.createSupportTicket(subject, description)
 *       }
 *     })
 *   }
 * }
 * ```
 *
 * @example Goal-Seeking Execution
 * ```typescript
 * const agent = new SupportAgent(ctx, env)
 *
 * // Define a goal for the agent to pursue
 * const result = await agent.run({
 *   id: 'resolve-ticket-123',
 *   description: 'Resolve customer complaint about shipping delay',
 *   constraints: [
 *     'Must respond within 4 hours',
 *     'Offer refund if delay > 7 days'
 *   ],
 *   maxIterations: 10
 * })
 *
 * console.log(result.success)    // true
 * console.log(result.iterations) // 3
 * console.log(result.actions)    // ['searchKnowledgeBase', 'createTicket', ...]
 * ```
 *
 * @example Agent Memory
 * ```typescript
 * class PersonalAssistant extends Agent {
 *   async handleConversation(message: string, userId: string) {
 *     // Remember user context
 *     await this.remember(`User ${userId} said: ${message}`, 'short-term')
 *
 *     // Search relevant memories
 *     const context = await this.searchMemories(`${userId} preferences`)
 *
 *     // Generate response using memories
 *     const answer = await this.ask(message, { memories: context })
 *
 *     // Store important findings
 *     if (answer.confidence > 0.8) {
 *       await this.remember(`User ${userId} preference: ${answer.text}`, 'long-term')
 *     }
 *
 *     return answer
 *   }
 * }
 * ```
 *
 * @example Unified Memory System
 * ```typescript
 * import { createGraphMemory } from '../agents/unified-memory'
 *
 * class AdvancedAgent extends Agent {
 *   async onStart() {
 *     // Use graph-backed memory for semantic search
 *     this.setMemory(createGraphMemory({
 *       store: this.graphStore,
 *       agentId: this.ctx.id.toString(),
 *     }))
 *   }
 *
 *   async processQuery(query: string) {
 *     // Now memory operations use semantic search
 *     const memories = await this.searchMemories(query)
 *     // Returns semantically similar memories, not just keyword matches
 *   }
 * }
 * ```
 *
 * @example Named Agents (from agents.do)
 * ```typescript
 * import { priya, ralph, tom, mark, sally } from 'agents.do'
 *
 * // Priya - Product Manager
 * const spec = await priya`define MVP for ${hypothesis}`
 *
 * // Ralph - Engineer
 * const app = await ralph`build ${spec}`
 *
 * // Tom - Tech Lead (review)
 * const approved = await tom.approve(app)
 *
 * // Mark - Marketing
 * await mark`announce the launch`
 *
 * // Sally - Sales
 * await sally`start selling`
 * ```
 *
 * @see Worker - Base class for work-performing entities
 * @see Human - Human worker with approval flows
 * @see agents/named - Named agent implementations (Priya, Ralph, Tom, etc.)
 */

import { Worker, Task, Context, Answer, Option, Decision, ApprovalRequest, ApprovalResult } from './Worker'
import { Env } from '../core/DO'
import type { AgentMemory as UnifiedAgentMemory, MemoryThing, MemoryType } from '../../api/agents/unified-memory'
import { Agent as AgentNoun } from '../../nouns/workers/Agent'
import type { AnyNoun } from '../../nouns/types'

export interface Tool {
  name: string
  description: string
  parameters: Record<string, unknown>
  handler: (input: unknown) => Promise<unknown>
}

export interface Goal {
  id: string
  description: string
  constraints?: string[]
  maxIterations?: number
}

export interface GoalResult {
  success: boolean
  result?: unknown
  iterations: number
  actions: string[]
}

/**
 * Legacy Memory interface for ctx.storage-based memory.
 * New code should use the unified AgentMemory via setMemory().
 */
export interface Memory {
  id: string
  type: 'short-term' | 'long-term' | 'episodic'
  content: string
  embedding?: number[]
  createdAt: Date
}

export class Agent extends Worker {
  // Override with Agent-specific noun (compatible via AnyNoun base type)
  static override readonly noun: AnyNoun = AgentNoun
  static override readonly $type: string = AgentNoun.$type

  protected mode: 'autonomous' | 'supervised' | 'manual' = 'autonomous'
  private tools: Map<string, Tool> = new Map()

  /**
   * Unified memory system (opt-in).
   * When set, memory operations delegate to this instead of ctx.storage.
   */
  private unifiedMemory?: UnifiedAgentMemory

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Set the unified memory system for this agent.
   * When set, remember(), getRecentMemories(), and searchMemories()
   * will use the unified memory instead of ctx.storage.
   *
   * @example
   * ```ts
   * import { createGraphMemory } from '../agents/unified-memory'
   *
   * // In agent initialization
   * this.setMemory(createGraphMemory({
   *   store: this.graphStore,
   *   agentId: this.ctx.id.toString(),
   * }))
   * ```
   */
  setMemory(memory: UnifiedAgentMemory): void {
    this.unifiedMemory = memory
  }

  /**
   * Get the unified memory system, if set.
   */
  getMemory(): UnifiedAgentMemory | undefined {
    return this.unifiedMemory
  }

  /**
   * Check if unified memory is enabled.
   */
  hasUnifiedMemory(): boolean {
    return this.unifiedMemory !== undefined
  }

  /**
   * Register a tool for the agent to use
   */
  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool)
  }

  /**
   * Get available tools
   */
  getTools(): Tool[] {
    return Array.from(this.tools.values())
  }

  /**
   * Execute a tool by name
   */
  async executeTool(name: string, input: unknown): Promise<unknown> {
    const tool = this.tools.get(name)
    if (!tool) {
      throw new Error(`Tool not found: ${name}`)
    }

    await this.emit('tool.executed', { name, input })
    return tool.handler(input)
  }

  /**
   * Run an autonomous goal-seeking loop
   */
  async run(goal: Goal): Promise<GoalResult> {
    const maxIterations = goal.maxIterations || 10
    const actions: string[] = []
    let iteration = 0

    await this.emit('goal.started', { goal })

    while (iteration < maxIterations) {
      iteration++

      // Observe current state
      const observation = await this.observe(goal)

      // Think about what action to take
      const action = await this.think(goal, observation, actions)

      if (action.type === 'complete') {
        await this.emit('goal.completed', { goal, result: action.result, iterations: iteration })
        return {
          success: true,
          result: action.result,
          iterations: iteration,
          actions,
        }
      }

      // Execute the action
      actions.push(action.description)
      await this.act(action)
    }

    await this.emit('goal.failed', { goal, reason: 'max_iterations', iterations: iteration })
    return {
      success: false,
      iterations: iteration,
      actions,
    }
  }

  /**
   * Observe current state for the goal
   */
  protected async observe(goal: Goal): Promise<Record<string, unknown>> {
    // Override in subclasses for custom observation logic
    const memories = await this.getRecentMemories(5)
    return {
      goal: goal.description,
      memories: memories.map((m) => m.content),
      tools: this.getTools().map((t) => t.name),
    }
  }

  /**
   * Think about what action to take
   */
  protected async think(
    goal: Goal,
    observation: Record<string, unknown>,
    previousActions: string[],
  ): Promise<{ type: 'action' | 'complete'; description: string; tool?: string; input?: unknown; result?: unknown }> {
    // Override in subclasses with actual AI reasoning
    // This is a stub that completes immediately
    return {
      type: 'complete',
      description: 'Completed goal',
      result: { message: 'Goal completed (stub implementation)' },
    }
  }

  /**
   * Execute an action
   */
  protected async act(action: { tool?: string; input?: unknown; description: string }): Promise<void> {
    if (action.tool) {
      await this.executeTool(action.tool, action.input)
    }
    await this.emit('action.executed', { action })
  }

  /**
   * Store a memory.
   *
   * If unified memory is set via setMemory(), delegates to the unified system.
   * Otherwise uses ctx.storage (legacy behavior).
   */
  async remember(content: string, type: Memory['type'] = 'short-term'): Promise<Memory> {
    // Use unified memory if available
    if (this.unifiedMemory) {
      const memoryThing = await this.unifiedMemory.remember(content, { type })
      return this.memoryThingToLegacy(memoryThing)
    }

    // Legacy ctx.storage path
    const memory: Memory = {
      id: crypto.randomUUID(),
      type,
      content,
      createdAt: new Date(),
    }
    await this.ctx.storage.put(`memory:${memory.id}`, memory)
    return memory
  }

  /**
   * Get recent memories.
   *
   * If unified memory is set via setMemory(), delegates to the unified system.
   * Otherwise uses ctx.storage (legacy behavior).
   */
  async getRecentMemories(limit: number = 10): Promise<Memory[]> {
    // Use unified memory if available
    if (this.unifiedMemory) {
      const memories = await this.unifiedMemory.getRecentMemories(limit)
      return memories.map(this.memoryThingToLegacy)
    }

    // Legacy ctx.storage path
    const map = await this.ctx.storage.list({ prefix: 'memory:' })
    const memories = Array.from(map.values()) as Memory[]
    return memories.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit)
  }

  /**
   * Search memories by content.
   *
   * If unified memory is set via setMemory(), delegates to the unified system.
   * Otherwise uses ctx.storage (legacy behavior).
   */
  async searchMemories(query: string): Promise<Memory[]> {
    // Use unified memory if available
    if (this.unifiedMemory) {
      const memories = await this.unifiedMemory.searchMemories(query)
      return memories.map(this.memoryThingToLegacy)
    }

    // Legacy ctx.storage path
    const memories = await this.getRecentMemories(100)
    const lowerQuery = query.toLowerCase()
    return memories.filter((m) => m.content.toLowerCase().includes(lowerQuery))
  }

  /**
   * Convert a MemoryThing from unified memory to the legacy Memory interface.
   */
  private memoryThingToLegacy = (thing: MemoryThing): Memory => {
    return {
      id: thing.id,
      type: thing.type === 'semantic' ? 'long-term' : thing.type, // Map 'semantic' to 'long-term' for compatibility
      content: thing.content,
      embedding: thing.embedding,
      createdAt: thing.createdAt,
    }
  }

  // Worker interface implementations
  protected async executeTask(task: Task, context?: Context): Promise<unknown> {
    return this.run({
      id: task.id,
      description: task.description,
      maxIterations: 10,
    })
  }

  protected async generateAnswer(question: string, context?: Context): Promise<Answer> {
    // Override with AI-powered answer generation
    const memories = await this.searchMemories(question)
    return {
      text: `Agent answer to: ${question}`,
      sources: memories.map((m) => m.id),
    }
  }

  protected async makeDecision(question: string, options: Option[], context?: Context): Promise<Decision> {
    // Override with AI-powered decision making
    return {
      selectedOption: options[0]!,
      reasoning: 'Selected first option (stub implementation)',
    }
  }

  protected async processApproval(request: ApprovalRequest): Promise<ApprovalResult> {
    // Agents can auto-approve in autonomous mode
    if (this.mode === 'autonomous') {
      return {
        approved: true,
        approver: this.ctx.id.toString(),
        approvedAt: new Date(),
      }
    }
    // Otherwise defer to supervised/manual workflow
    return {
      approved: false,
      approver: this.ctx.id.toString(),
      reason: 'Requires human approval',
    }
  }

  protected async generateOutput<T>(prompt: string, schema?: unknown): Promise<T> {
    // Override with AI-powered generation
    throw new Error('generateOutput requires AI integration')
  }
}

export default Agent
