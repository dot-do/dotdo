/**
 * Agent - AI-powered autonomous worker
 *
 * Extends Worker with AI capabilities: tools, memory, sandbox execution.
 * Examples: 'support-agent', 'sales-assistant'
 */

import { Worker, Task, Context, Answer, Option, Decision, ApprovalRequest, ApprovalResult } from './Worker'
import { Env } from './DO'

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

export interface Memory {
  id: string
  type: 'short-term' | 'long-term' | 'episodic'
  content: string
  embedding?: number[]
  createdAt: Date
}

export class Agent extends Worker {
  static override readonly $type = 'Agent'

  protected mode: 'autonomous' | 'supervised' | 'manual' = 'autonomous'
  private tools: Map<string, Tool> = new Map()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
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
   * Store a memory
   */
  async remember(content: string, type: Memory['type'] = 'short-term'): Promise<Memory> {
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
   * Get recent memories
   */
  async getRecentMemories(limit: number = 10): Promise<Memory[]> {
    const map = await this.ctx.storage.list({ prefix: 'memory:' })
    const memories = Array.from(map.values()) as Memory[]
    return memories.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit)
  }

  /**
   * Search memories by content
   */
  async searchMemories(query: string): Promise<Memory[]> {
    const memories = await this.getRecentMemories(100)
    const lowerQuery = query.toLowerCase()
    return memories.filter((m) => m.content.toLowerCase().includes(lowerQuery))
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
