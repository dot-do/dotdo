/**
 * Tool Execution Tracking as Relationships
 *
 * Issue: dotdo-lycby (RED), dotdo-hi24u (GREEN)
 *
 * Tracks Agent tool executions as graph Relationships using
 * the verb form pattern: use -> using -> used
 *
 * STUB MODULE - This file provides type definitions and a placeholder
 * factory for TDD RED phase tests. Implementation will be added in GREEN phase.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Verb states for tool execution lifecycle
 */
export type ExecutionVerb = 'use' | 'using' | 'used' | 'failed'

/**
 * Cost metrics for an execution
 */
export interface ExecutionCost {
  tokens?: number
  inputTokens?: number
  outputTokens?: number
  credits?: number
  usd?: number
  apiCalls?: number
}

/**
 * Error details for a failed execution
 */
export interface ExecutionError {
  message: string
  code?: string
  stack?: string
  retryable?: boolean
}

/**
 * Execution metadata
 */
export interface ExecutionMetadata {
  input: Record<string, unknown>
  output?: unknown
  duration?: number
  startedAt: number
  completedAt?: number
  success?: boolean
}

/**
 * Verb transition history entry
 */
export interface VerbTransitionHistory {
  verb: ExecutionVerb
  at: number
}

/**
 * Tool execution record
 */
export interface ToolExecution {
  id: string
  verb: ExecutionVerb
  from: string
  to: string
  metadata: ExecutionMetadata
  cost?: ExecutionCost
  error?: ExecutionError
  context?: Record<string, unknown>
  verbHistory: VerbTransitionHistory[]
}

/**
 * Query options for executions
 */
export interface ExecutionQuery {
  agent?: string
  tool?: string
  verb?: ExecutionVerb
  startedAfter?: number
  startedBefore?: number
}

/**
 * Aggregated analytics result
 */
export interface ExecutionAnalytics {
  totalExecutions: number
  successfulExecutions: number
  failedExecutions: number
  successRate: number
  totalDuration: number
  averageDuration: number
  totalCost?: ExecutionCost
}

/**
 * Stored relationship representation
 */
export interface StoredRelationship {
  type: string
  sourceType: string
  targetType: string
  sourceId: string
  targetId: string
}

/**
 * Entity representation
 */
export interface Entity {
  id: string
  name: string
  type: string
}

/**
 * Tool usage statistics
 */
export interface ToolUsageStats {
  toolId: string
  executionCount: number
}

/**
 * Usage over time entry
 */
export interface UsageOverTimeEntry {
  timestamp: number
  count: number
}

/**
 * Execution edge for graph traversal
 */
export interface ExecutionEdge {
  from: string
  to: string
  verb: ExecutionVerb
  metadata: ExecutionMetadata
}

/**
 * Options for creating an execution graph
 */
export interface ToolExecutionGraphOptions {
  namespace: string
}

/**
 * Options for starting an execution
 */
export interface StartExecutionOptions {
  agent: string
  tool: string
  input: Record<string, unknown>
  context?: Record<string, unknown>
}

/**
 * Options for completing an execution
 */
export interface CompleteExecutionOptions {
  output: unknown
  cost?: ExecutionCost
}

/**
 * Options for failing an execution
 */
export interface FailExecutionOptions {
  error: ExecutionError
}

/**
 * Tool execution graph interface
 */
export interface ToolExecutionGraph {
  // Entity creation
  createAgent(data: Record<string, unknown>): Promise<string>
  createTool(data: Record<string, unknown>): Promise<string>

  // Execution lifecycle
  startExecution(options: StartExecutionOptions): Promise<ToolExecution>
  markInProgress(id: string): Promise<ToolExecution>
  completeExecution(id: string, options: CompleteExecutionOptions): Promise<ToolExecution>
  failExecution(id: string, options: FailExecutionOptions): Promise<ToolExecution>
  transitionVerb(id: string, verb: ExecutionVerb): Promise<ToolExecution>

  // Verb state machine
  getValidTransitions(verb: ExecutionVerb): ExecutionVerb[]

  // Queries
  getExecution(id: string): Promise<ToolExecution>
  queryExecutions(query: ExecutionQuery): Promise<ToolExecution[]>
  aggregateStats(query: ExecutionQuery): Promise<ExecutionAnalytics>

  // Graph operations
  getRelationship(id: string): Promise<StoredRelationship>
  getEntity(id: string): Promise<Entity>

  // Analytics
  getTopToolsByAgent(agentId: string, options: { limit: number }): Promise<ToolUsageStats[]>
  getUsageOverTime(options: { tool: string; interval: string }): Promise<UsageOverTimeEntry[]>

  // Traversal
  getToolsUsedByAgent(agentId: string): Promise<Entity[]>
  getAgentsUsingTool(toolId: string): Promise<Entity[]>
  getExecutionCount(agentId: string, toolId: string): Promise<number>
  getRecentExecutionEdges(options: { agent: string; limit: number }): Promise<ExecutionEdge[]>

  // Maintenance
  clear(): Promise<void>
}

// ============================================================================
// Verb State Machine
// ============================================================================

/**
 * Valid verb transitions for tool execution lifecycle.
 *
 * State machine:
 *   use -> using -> used
 *            |
 *            v
 *          failed
 */
const VERB_TRANSITIONS: Record<ExecutionVerb, ExecutionVerb[]> = {
  use: ['using'],
  using: ['used', 'failed'],
  used: [],
  failed: [],
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a tool execution graph instance
 *
 * GREEN PHASE: Full implementation for tracking Agent tool executions
 * as graph Relationships using verb form pattern: use -> using -> used
 */
export function createToolExecutionGraph(_options: ToolExecutionGraphOptions): ToolExecutionGraph {
  // In-memory storage (no SQLite mocking - this is the real store)
  const entities = new Map<string, Entity & { data?: Record<string, unknown> }>()
  const executions = new Map<string, ToolExecution>()
  const relationships = new Map<string, StoredRelationship>()

  let idCounter = 0
  const generateId = (): string => {
    idCounter++
    return `exec-${idCounter}-${Date.now()}`
  }

  const generateEntityId = (type: string): string => {
    idCounter++
    return `${type.toLowerCase()}-${idCounter}-${Date.now()}`
  }

  return {
    // ========================================================================
    // Entity Creation
    // ========================================================================

    async createAgent(data: Record<string, unknown>): Promise<string> {
      const id = generateEntityId('agent')
      entities.set(id, {
        id,
        name: (data.name as string) || 'Unknown Agent',
        type: 'Agent',
        data,
      })
      return id
    },

    async createTool(data: Record<string, unknown>): Promise<string> {
      const id = generateEntityId('tool')
      entities.set(id, {
        id,
        name: (data.name as string) || 'Unknown Tool',
        type: 'Tool',
        data,
      })
      return id
    },

    // ========================================================================
    // Execution Lifecycle
    // ========================================================================

    async startExecution(options: StartExecutionOptions): Promise<ToolExecution> {
      const id = generateId()
      const now = Date.now()

      const execution: ToolExecution = {
        id,
        verb: 'use',
        from: options.agent,
        to: options.tool,
        metadata: {
          input: options.input,
          startedAt: now,
        },
        context: options.context,
        verbHistory: [{ verb: 'use', at: now }],
      }

      executions.set(id, execution)

      // Create relationship record
      relationships.set(id, {
        type: 'used',
        sourceType: 'Agent',
        targetType: 'Tool',
        sourceId: options.agent,
        targetId: options.tool,
      })

      return execution
    },

    async markInProgress(id: string): Promise<ToolExecution> {
      const execution = executions.get(id)
      if (!execution) {
        throw new Error(`Execution ${id} not found`)
      }

      if (execution.verb !== 'use') {
        throw new Error(`Invalid verb transition: ${execution.verb} -> using`)
      }

      const now = Date.now()
      execution.verb = 'using'
      execution.verbHistory.push({ verb: 'using', at: now })

      return execution
    },

    async completeExecution(id: string, options: CompleteExecutionOptions): Promise<ToolExecution> {
      const execution = executions.get(id)
      if (!execution) {
        throw new Error(`Execution ${id} not found`)
      }

      if (execution.verb !== 'using') {
        throw new Error(`Invalid verb transition: ${execution.verb} -> used`)
      }

      const now = Date.now()
      execution.verb = 'used'
      execution.metadata.output = options.output
      execution.metadata.completedAt = now
      execution.metadata.success = true
      execution.metadata.duration = now - execution.metadata.startedAt
      execution.verbHistory.push({ verb: 'used', at: now })

      if (options.cost) {
        execution.cost = options.cost
      }

      return execution
    },

    async failExecution(id: string, options: FailExecutionOptions): Promise<ToolExecution> {
      const execution = executions.get(id)
      if (!execution) {
        throw new Error(`Execution ${id} not found`)
      }

      if (execution.verb !== 'using') {
        throw new Error(`Invalid verb transition: ${execution.verb} -> failed`)
      }

      const now = Date.now()
      execution.verb = 'failed'
      execution.metadata.completedAt = now
      execution.metadata.success = false
      execution.metadata.duration = now - execution.metadata.startedAt
      execution.error = options.error
      execution.verbHistory.push({ verb: 'failed', at: now })

      return execution
    },

    async transitionVerb(id: string, verb: ExecutionVerb): Promise<ToolExecution> {
      const execution = executions.get(id)
      if (!execution) {
        throw new Error(`Execution ${id} not found`)
      }

      const validTransitions = VERB_TRANSITIONS[execution.verb]
      if (!validTransitions.includes(verb)) {
        throw new Error(`Invalid verb transition: ${execution.verb} -> ${verb}`)
      }

      const now = Date.now()
      execution.verb = verb
      execution.verbHistory.push({ verb, at: now })

      return execution
    },

    // ========================================================================
    // Verb State Machine
    // ========================================================================

    getValidTransitions(verb: ExecutionVerb): ExecutionVerb[] {
      return VERB_TRANSITIONS[verb] || []
    },

    // ========================================================================
    // Queries
    // ========================================================================

    async getExecution(id: string): Promise<ToolExecution> {
      const execution = executions.get(id)
      if (!execution) {
        throw new Error(`Execution ${id} not found`)
      }
      return execution
    },

    async queryExecutions(query: ExecutionQuery): Promise<ToolExecution[]> {
      let results = Array.from(executions.values())

      if (query.agent) {
        results = results.filter((e) => e.from === query.agent)
      }
      if (query.tool) {
        results = results.filter((e) => e.to === query.tool)
      }
      if (query.verb) {
        results = results.filter((e) => e.verb === query.verb)
      }
      if (query.startedAfter !== undefined) {
        results = results.filter((e) => e.metadata.startedAt >= query.startedAfter!)
      }
      if (query.startedBefore !== undefined) {
        results = results.filter((e) => e.metadata.startedAt <= query.startedBefore!)
      }

      return results
    },

    async aggregateStats(query: ExecutionQuery): Promise<ExecutionAnalytics> {
      const matchingExecutions = await this.queryExecutions(query)

      const successful = matchingExecutions.filter((e) => e.verb === 'used')
      const failed = matchingExecutions.filter((e) => e.verb === 'failed')
      const completed = [...successful, ...failed]

      const totalDuration = completed.reduce(
        (sum, e) => sum + (e.metadata.duration || 0),
        0
      )

      // Aggregate cost metrics
      let totalCost: ExecutionCost | undefined
      const executionsWithCost = matchingExecutions.filter((e) => e.cost)
      if (executionsWithCost.length > 0) {
        totalCost = {
          tokens: executionsWithCost.reduce((sum, e) => sum + (e.cost?.tokens || 0), 0),
          inputTokens: executionsWithCost.reduce((sum, e) => sum + (e.cost?.inputTokens || 0), 0),
          outputTokens: executionsWithCost.reduce((sum, e) => sum + (e.cost?.outputTokens || 0), 0),
          credits: executionsWithCost.reduce((sum, e) => sum + (e.cost?.credits || 0), 0),
          usd: executionsWithCost.reduce((sum, e) => sum + (e.cost?.usd || 0), 0),
          apiCalls: executionsWithCost.reduce((sum, e) => sum + (e.cost?.apiCalls || 0), 0),
        }
      }

      return {
        totalExecutions: matchingExecutions.length,
        successfulExecutions: successful.length,
        failedExecutions: failed.length,
        successRate: matchingExecutions.length > 0
          ? successful.length / matchingExecutions.length
          : 0,
        totalDuration,
        averageDuration: completed.length > 0 ? totalDuration / completed.length : 0,
        totalCost,
      }
    },

    // ========================================================================
    // Graph Operations
    // ========================================================================

    async getRelationship(id: string): Promise<StoredRelationship> {
      const relationship = relationships.get(id)
      if (!relationship) {
        throw new Error(`Relationship ${id} not found`)
      }
      return relationship
    },

    async getEntity(id: string): Promise<Entity> {
      const entity = entities.get(id)
      if (!entity) {
        throw new Error(`Entity ${id} not found`)
      }
      return { id: entity.id, name: entity.name, type: entity.type }
    },

    // ========================================================================
    // Analytics
    // ========================================================================

    async getTopToolsByAgent(agentId: string, options: { limit: number }): Promise<ToolUsageStats[]> {
      const agentExecutions = Array.from(executions.values()).filter(
        (e) => e.from === agentId
      )

      // Count executions per tool
      const toolCounts = new Map<string, number>()
      for (const exec of agentExecutions) {
        const count = toolCounts.get(exec.to) || 0
        toolCounts.set(exec.to, count + 1)
      }

      // Sort by count descending
      const sorted = Array.from(toolCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, options.limit)

      return sorted.map(([toolId, executionCount]) => ({
        toolId,
        executionCount,
      }))
    },

    async getUsageOverTime(options: { tool: string; interval: string }): Promise<UsageOverTimeEntry[]> {
      const toolExecutions = Array.from(executions.values()).filter(
        (e) => e.to === options.tool
      )

      // Group by interval (simplified - just by hour for now)
      const groups = new Map<number, number>()
      const intervalMs = options.interval === 'hour' ? 3600000 : 86400000

      for (const exec of toolExecutions) {
        const bucket = Math.floor(exec.metadata.startedAt / intervalMs) * intervalMs
        const count = groups.get(bucket) || 0
        groups.set(bucket, count + 1)
      }

      return Array.from(groups.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([timestamp, count]) => ({ timestamp, count }))
    },

    // ========================================================================
    // Traversal
    // ========================================================================

    async getToolsUsedByAgent(agentId: string): Promise<Entity[]> {
      const agentExecutions = Array.from(executions.values()).filter(
        (e) => e.from === agentId
      )

      // Get unique tool IDs
      const toolIds = new Set(agentExecutions.map((e) => e.to))

      const tools: Entity[] = []
      for (const toolId of toolIds) {
        const entity = entities.get(toolId)
        if (entity) {
          tools.push({ id: entity.id, name: entity.name, type: entity.type })
        }
      }

      return tools
    },

    async getAgentsUsingTool(toolId: string): Promise<Entity[]> {
      const toolExecutions = Array.from(executions.values()).filter(
        (e) => e.to === toolId
      )

      // Get unique agent IDs
      const agentIds = new Set(toolExecutions.map((e) => e.from))

      const agents: Entity[] = []
      for (const agentId of agentIds) {
        const entity = entities.get(agentId)
        if (entity) {
          agents.push({ id: entity.id, name: entity.name, type: entity.type })
        }
      }

      return agents
    },

    async getExecutionCount(agentId: string, toolId: string): Promise<number> {
      return Array.from(executions.values()).filter(
        (e) => e.from === agentId && e.to === toolId
      ).length
    },

    async getRecentExecutionEdges(options: { agent: string; limit: number }): Promise<ExecutionEdge[]> {
      const agentExecutions = Array.from(executions.values())
        .filter((e) => e.from === options.agent)
        .sort((a, b) => b.metadata.startedAt - a.metadata.startedAt)
        .slice(0, options.limit)

      return agentExecutions.map((e) => ({
        from: e.from,
        to: e.to,
        verb: e.verb,
        metadata: e.metadata,
      }))
    },

    // ========================================================================
    // Maintenance
    // ========================================================================

    async clear(): Promise<void> {
      entities.clear()
      executions.clear()
      relationships.clear()
      idCounter = 0
    },
  }
}
