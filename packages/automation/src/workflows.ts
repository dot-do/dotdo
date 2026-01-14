/**
 * Workflow Engine - n8n-compatible workflow execution
 *
 * Implements workflow definition, execution, and management:
 * - Workflow: Define workflows with nodes and connections
 * - WorkflowEngine: Register, activate, and execute workflows
 * - WorkflowExecution: Track execution state and history
 */

import { CodeAction, SetAction, FunctionAction, HttpRequestAction } from './actions'
import { MergeNode } from './nodes'

// ============================================================================
// TYPES
// ============================================================================

export interface WorkflowNodeHooks {
  onExecute?: () => void
  onComplete?: () => void
}

export interface WorkflowNode {
  id: string
  type: string
  config: Record<string, unknown>
  metadata?: {
    position?: { x: number; y: number }
    notes?: string
  }
  hooks?: WorkflowNodeHooks
  retry?: {
    maxRetries: number
    backoffMs: number
  }
  continueOnFail?: boolean
}

export interface WorkflowConnection {
  from: string
  to: string
  outputIndex?: number
}

export interface WorkflowSettings {
  timezone?: string
  errorWorkflow?: string
  saveDataSuccessExecution?: 'all' | 'none'
  executionOrder?: 'v1' | 'v0'
  maxExecutionHistory?: number
}

export interface WorkflowConfig {
  name: string
  nodes: WorkflowNode[]
  connections: WorkflowConnection[]
  settings?: WorkflowSettings
}

export interface ExecutionOptions {
  input: Record<string, unknown>
  idempotencyKey?: string
  startFromNode?: string
}

export interface NodeExecution {
  input: unknown
  output: unknown
  startedAt: number
  completedAt: number
  error?: string
}

export interface WorkflowExecution {
  id: string
  workflowId: string
  workflowVersion: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  input: Record<string, unknown>
  output?: unknown
  error?: string
  failedNode?: string
  startedAt: number
  completedAt: number
  triggerType?: 'manual' | 'webhook' | 'cron'
  nodeExecutions: Record<string, NodeExecution>
}

export type ExecutionListener = (execution: WorkflowExecution) => void

export interface WorkflowStorage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
}

export interface WorkflowEngineConfig {
  storage?: WorkflowStorage
}

// ============================================================================
// WORKFLOW
// ============================================================================

export class Workflow {
  readonly id: string
  readonly name: string
  readonly nodes: WorkflowNode[]
  readonly connections: WorkflowConnection[]
  readonly settings?: WorkflowSettings
  readonly version: number

  private previousVersion?: Workflow

  constructor(config: WorkflowConfig, version = 1, id?: string, previous?: Workflow) {
    this.id = id ?? `wf-${crypto.randomUUID()}`
    this.name = config.name
    this.nodes = [...config.nodes]
    this.connections = [...config.connections]
    this.settings = config.settings
    this.version = version
    this.previousVersion = previous

    this.validate()
  }

  private validate(): void {
    // Check for duplicate node IDs
    const nodeIds = new Set<string>()
    for (const node of this.nodes) {
      if (nodeIds.has(node.id)) {
        throw new Error(`Duplicate node ID: ${node.id}`)
      }
      nodeIds.add(node.id)
    }

    // Check connections reference valid nodes
    for (const connection of this.connections) {
      if (!nodeIds.has(connection.from)) {
        throw new Error(`Invalid connection: node ${connection.from} does not exist`)
      }
      if (!nodeIds.has(connection.to)) {
        throw new Error(`Invalid connection: node ${connection.to} does not exist`)
      }
    }
  }

  clone(): Workflow {
    return new Workflow(
      {
        name: this.name,
        nodes: JSON.parse(JSON.stringify(this.nodes)),
        connections: JSON.parse(JSON.stringify(this.connections)),
        settings: this.settings ? { ...this.settings } : undefined,
      },
      1 // New version for clone
    )
  }

  update(changes: Partial<WorkflowConfig>): Workflow {
    return new Workflow(
      {
        name: changes.name ?? this.name,
        nodes: changes.nodes ?? this.nodes,
        connections: changes.connections ?? this.connections,
        settings: changes.settings ?? this.settings,
      },
      this.version + 1,
      this.id,
      this
    )
  }

  rollback(): Workflow {
    if (!this.previousVersion) {
      throw new Error('No previous version to rollback to')
    }

    return new Workflow(
      {
        name: this.previousVersion.name,
        nodes: this.previousVersion.nodes,
        connections: this.previousVersion.connections,
        settings: this.previousVersion.settings,
      },
      this.version + 1,
      this.id,
      this
    )
  }

  toJSON(): string {
    return JSON.stringify({
      id: this.id,
      name: this.name,
      nodes: this.nodes,
      connections: this.connections,
      settings: this.settings,
      version: this.version,
    })
  }

  static fromJSON(json: string): Workflow {
    const data = JSON.parse(json)
    return new Workflow(
      {
        name: data.name,
        nodes: data.nodes,
        connections: data.connections,
        settings: data.settings,
      },
      data.version,
      data.id
    )
  }
}

// ============================================================================
// WORKFLOW ENGINE
// ============================================================================

export class WorkflowEngine {
  private workflows = new Map<string, Workflow>()
  private activeWorkflows = new Set<string>()
  private executionHistory = new Map<string, WorkflowExecution[]>()
  private idempotencyKeys = new Map<string, string>()
  private executionListeners = new Set<ExecutionListener>()
  private webhookHandlers = new Map<string, { workflowId: string; nodeId: string }>()
  private globals = new Map<string, Function>()
  private storage?: WorkflowStorage
  private disposed = false

  constructor(config: WorkflowEngineConfig = {}) {
    this.storage = config.storage
  }

  register(workflow: Workflow): void {
    this.workflows.set(workflow.id, workflow)

    // Register webhook handlers
    for (const node of workflow.nodes) {
      if (node.type === 'webhook') {
        const path = node.config.path as string
        const method = (node.config.method as string) ?? 'POST'
        const key = `${method}:${path}`
        this.webhookHandlers.set(key, { workflowId: workflow.id, nodeId: node.id })
      }
    }
  }

  unregister(workflowId: string): void {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) return

    // Remove webhook handlers
    for (const node of workflow.nodes) {
      if (node.type === 'webhook') {
        const path = node.config.path as string
        const method = (node.config.method as string) ?? 'POST'
        const key = `${method}:${path}`
        this.webhookHandlers.delete(key)
      }
    }

    this.workflows.delete(workflowId)
    this.activeWorkflows.delete(workflowId)
  }

  getWorkflow(workflowId: string): Workflow | undefined {
    return this.workflows.get(workflowId)
  }

  listWorkflows(): Workflow[] {
    return Array.from(this.workflows.values())
  }

  activate(workflowId: string): void {
    if (!this.workflows.has(workflowId)) {
      throw new Error(`Workflow ${workflowId} not found`)
    }
    this.activeWorkflows.add(workflowId)
  }

  deactivate(workflowId: string): void {
    this.activeWorkflows.delete(workflowId)
  }

  isActive(workflowId: string): boolean {
    return this.activeWorkflows.has(workflowId)
  }

  onExecution(listener: ExecutionListener): () => void {
    this.executionListeners.add(listener)
    return () => this.executionListeners.delete(listener)
  }

  setGlobal(name: string, fn: Function): void {
    this.globals.set(name, fn)
  }

  async execute(workflowId: string, options: ExecutionOptions): Promise<WorkflowExecution> {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`)
    }

    // Check idempotency
    if (options.idempotencyKey) {
      const existingExecutionId = this.idempotencyKeys.get(options.idempotencyKey)
      if (existingExecutionId) {
        const history = this.executionHistory.get(workflowId) ?? []
        const existing = history.find((e) => e.id === existingExecutionId)
        if (existing) {
          return existing
        }
      }
    }

    const execution: WorkflowExecution = {
      id: `exec-${crypto.randomUUID()}`,
      workflowId,
      workflowVersion: workflow.version,
      status: 'running',
      input: options.input,
      startedAt: Date.now(),
      completedAt: 0,
      triggerType: 'manual',
      nodeExecutions: {},
    }

    // Store idempotency key
    if (options.idempotencyKey) {
      this.idempotencyKeys.set(options.idempotencyKey, execution.id)
    }

    let currentNodeId: string | undefined

    try {
      // Build execution graph
      const nodeOutputs = new Map<string, unknown>()
      const executionOrder = this.topologicalSort(workflow)

      // Find start node index if resuming
      let startIndex = 0
      if (options.startFromNode) {
        startIndex = executionOrder.findIndex((node) => node.id === options.startFromNode)
        if (startIndex === -1) startIndex = 0
      }

      // Execute nodes in order
      let currentInput: unknown = options.input

      for (let i = startIndex; i < executionOrder.length; i++) {
        const node = executionOrder[i]
        currentNodeId = node.id

        // Call onExecute hook
        if (node.hooks?.onExecute) {
          node.hooks.onExecute()
        }

        const nodeStartTime = Date.now()

        // Get input from parent nodes
        const parentConnections = workflow.connections.filter((c) => c.to === node.id)
        if (parentConnections.length > 0) {
          if (parentConnections.length === 1) {
            currentInput = nodeOutputs.get(parentConnections[0].from) ?? currentInput
          } else {
            // Multiple parents - use merge logic
            const mergeNode = new MergeNode({ mode: 'combine', inputCount: parentConnections.length })
            for (let j = 0; j < parentConnections.length; j++) {
              const parentOutput = nodeOutputs.get(parentConnections[j].from)
              await mergeNode.addInput(j, { data: parentOutput })
            }
            const mergeResult = await mergeNode.addInput(parentConnections.length - 1, {
              data: nodeOutputs.get(parentConnections[parentConnections.length - 1].from),
            })
            currentInput = mergeResult.output
          }
        }

        try {
          const output = await this.executeNode(node, currentInput as Record<string, unknown>)
          nodeOutputs.set(node.id, output)

          execution.nodeExecutions[node.id] = {
            input: currentInput,
            output,
            startedAt: nodeStartTime,
            completedAt: Date.now(),
          }

          // Call onComplete hook
          if (node.hooks?.onComplete) {
            node.hooks.onComplete()
          }

          currentInput = output
        } catch (error) {
          if (node.continueOnFail) {
            execution.nodeExecutions[node.id] = {
              input: currentInput,
              output: null,
              startedAt: nodeStartTime,
              completedAt: Date.now(),
              error: error instanceof Error ? error.message : String(error),
            }
            continue
          }

          throw error
        }
      }

      execution.status = 'completed'
      execution.output = currentInput
      execution.completedAt = Date.now()
    } catch (error) {
      execution.status = 'failed'
      execution.error = error instanceof Error ? error.message : String(error)
      execution.failedNode = currentNodeId
      execution.completedAt = Date.now()
    }

    // Store execution
    await this.storeExecution(workflowId, execution)

    // Notify listeners
    this.notifyListeners(execution)

    return execution
  }

  async handleWebhook(path: string, method: string, data: Record<string, unknown>): Promise<void> {
    const key = `${method}:${path}`
    const handler = this.webhookHandlers.get(key)

    if (!handler) {
      return
    }

    if (!this.isActive(handler.workflowId)) {
      return
    }

    await this.execute(handler.workflowId, { input: data })
  }

  getExecutionHistory(workflowId: string): WorkflowExecution[] {
    return this.executionHistory.get(workflowId) ?? []
  }

  dispose(): void {
    this.disposed = true
    this.workflows.clear()
    this.activeWorkflows.clear()
    this.executionHistory.clear()
    this.idempotencyKeys.clear()
    this.executionListeners.clear()
    this.webhookHandlers.clear()
  }

  private async executeNode(node: WorkflowNode, input: Record<string, unknown>): Promise<unknown> {
    switch (node.type) {
      case 'manual':
        return input

      case 'code': {
        const action = new CodeAction({
          language: (node.config.language as 'javascript') ?? 'javascript',
          code: node.config.code as string,
          mode: node.config.mode as 'each' | 'all',
          async: node.config.async as boolean,
        })
        const result = await action.execute(input)
        if (!result.success) {
          throw new Error(result.error)
        }
        return result.data
      }

      case 'set': {
        const action = new SetAction({
          values: node.config.values as Array<{ name: string; value: unknown }>,
          mode: node.config.mode as 'merge' | 'replace',
        })
        const result = await action.execute(input)
        if (!result.success) {
          throw new Error(result.error)
        }
        return result.data
      }

      case 'function': {
        const action = new FunctionAction({
          name: node.config.name as string,
          fn: node.config.fn as any,
        })
        const result = await action.execute(input)
        if (!result.success) {
          throw new Error(result.error)
        }
        return result.data
      }

      case 'http': {
        const action = new HttpRequestAction({
          method: node.config.method as any,
          url: node.config.url as string,
          headers: node.config.headers as Record<string, string>,
          body: node.config.body,
          queryParameters: node.config.queryParameters as Record<string, string>,
          authentication: node.config.authentication as any,
          timeout: node.config.timeout as number,
          retry: node.config.retry as any,
        })
        const result = await action.execute(input)
        if (!result.success) {
          throw new Error(result.error)
        }
        return result.data
      }

      case 'merge': {
        const mergeNode = new MergeNode({
          mode: (node.config.mode as any) ?? 'combine',
          inputCount: node.config.inputCount as number,
        })
        // For single input, just pass through
        const result = await mergeNode.addInput(0, { data: input })
        return result.output ?? input
      }

      case 'execute-workflow': {
        const childWorkflowId = node.config.workflowId as string
        const childExecution = await this.execute(childWorkflowId, { input })
        if (childExecution.status === 'failed') {
          throw new Error(childExecution.error)
        }
        return childExecution.output
      }

      case 'webhook':
        return input

      default:
        return input
    }
  }

  private topologicalSort(workflow: Workflow): WorkflowNode[] {
    const nodes = new Map<string, WorkflowNode>()
    const inDegree = new Map<string, number>()
    const adjacencyList = new Map<string, string[]>()

    // Initialize
    for (const node of workflow.nodes) {
      nodes.set(node.id, node)
      inDegree.set(node.id, 0)
      adjacencyList.set(node.id, [])
    }

    // Build graph
    for (const connection of workflow.connections) {
      adjacencyList.get(connection.from)?.push(connection.to)
      inDegree.set(connection.to, (inDegree.get(connection.to) ?? 0) + 1)
    }

    // Find nodes with no incoming edges
    const queue: string[] = []
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(nodeId)
      }
    }

    // Process nodes
    const result: WorkflowNode[] = []
    while (queue.length > 0) {
      const nodeId = queue.shift()!
      result.push(nodes.get(nodeId)!)

      for (const neighbor of adjacencyList.get(nodeId) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 0) - 1
        inDegree.set(neighbor, newDegree)
        if (newDegree === 0) {
          queue.push(neighbor)
        }
      }
    }

    return result
  }

  private findFailedNode(_workflow: Workflow, error: unknown): string | undefined {
    // Could be enhanced to track which node actually failed
    return undefined
  }

  private async storeExecution(workflowId: string, execution: WorkflowExecution): Promise<void> {
    // In-memory storage
    const history = this.executionHistory.get(workflowId) ?? []
    history.push(execution)

    // Limit history size
    const workflow = this.workflows.get(workflowId)
    const maxHistory = workflow?.settings?.maxExecutionHistory ?? 100
    while (history.length > maxHistory) {
      history.shift()
    }

    this.executionHistory.set(workflowId, history)

    // Persist to storage if available
    if (this.storage) {
      await this.storage.set(`workflow:${workflowId}:executions`, history)
    }
  }

  private notifyListeners(execution: WorkflowExecution): void {
    for (const listener of this.executionListeners) {
      try {
        listener(execution)
      } catch {
        // Ignore listener errors
      }
    }
  }
}
