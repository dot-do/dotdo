/**
 * Workflow Engine - n8n-compatible workflow orchestration
 *
 * Implements workflow definition and execution:
 * - Workflow: Definition of nodes and connections
 * - WorkflowEngine: Execution orchestration
 * - WorkflowExecution: Individual execution tracking
 */

import { WebhookTrigger, CronTrigger, PollingTrigger, TriggerEvent } from './triggers'
import { HttpRequestAction, CodeAction, SetAction, FunctionAction } from './actions'
import { IfNode, SwitchNode, LoopNode, MergeNode, SplitNode, FilterNode, NoOpNode, WaitNode } from './nodes'

// ============================================================================
// TYPES
// ============================================================================

export type WorkflowStatus = 'draft' | 'active' | 'inactive' | 'error'
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface WorkflowNodeConfig {
  id: string
  type: string
  config: Record<string, unknown>
  metadata?: {
    position?: { x: number; y: number }
    notes?: string
    [key: string]: unknown
  }
  hooks?: {
    onExecute?: () => void
    onComplete?: () => void
    onError?: (error: Error) => void
  }
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
  inputIndex?: number
}

export interface WorkflowSettings {
  timezone?: string
  errorWorkflow?: string
  saveDataSuccessExecution?: 'all' | 'none'
  executionOrder?: 'v1' | 'v2'
  maxExecutionHistory?: number
}

export interface WorkflowDefinition {
  id?: string
  name: string
  nodes: WorkflowNodeConfig[]
  connections: WorkflowConnection[]
  settings?: WorkflowSettings
}

export interface NodeExecution {
  nodeId: string
  startedAt: number
  completedAt?: number
  input: unknown
  output?: unknown
  error?: string
  retries?: number
}

export interface ExecutionOptions {
  input?: unknown
  idempotencyKey?: string
  startFromNode?: string
}

export interface Storage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
}

export interface WorkflowEngineConfig {
  storage?: Storage
}

// ============================================================================
// WORKFLOW EXECUTION
// ============================================================================

export class WorkflowExecution {
  readonly id: string
  readonly workflowId: string
  readonly workflowVersion: number
  status: ExecutionStatus = 'pending'
  startedAt: number = 0
  completedAt?: number
  triggerType?: string
  input?: unknown
  output?: unknown
  error?: string
  failedNode?: string
  nodeExecutions: Record<string, NodeExecution> = {}

  constructor(workflowId: string, workflowVersion: number) {
    this.id = `exec-${crypto.randomUUID()}`
    this.workflowId = workflowId
    this.workflowVersion = workflowVersion
  }

  start(input?: unknown): void {
    this.status = 'running'
    this.startedAt = Date.now()
    this.input = input
  }

  complete(output: unknown): void {
    this.status = 'completed'
    this.completedAt = Date.now()
    this.output = output
  }

  fail(error: string, nodeId?: string): void {
    this.status = 'failed'
    this.completedAt = Date.now()
    this.error = error
    this.failedNode = nodeId
  }

  cancel(): void {
    this.status = 'cancelled'
    this.completedAt = Date.now()
  }

  recordNodeExecution(nodeId: string, input: unknown): void {
    this.nodeExecutions[nodeId] = {
      nodeId,
      startedAt: Date.now(),
      input,
    }
  }

  completeNodeExecution(nodeId: string, output: unknown): void {
    const nodeExec = this.nodeExecutions[nodeId]
    if (nodeExec) {
      nodeExec.completedAt = Date.now()
      nodeExec.output = output
    }
  }

  failNodeExecution(nodeId: string, error: string): void {
    const nodeExec = this.nodeExecutions[nodeId]
    if (nodeExec) {
      nodeExec.completedAt = Date.now()
      nodeExec.error = error
    }
  }
}

// ============================================================================
// WORKFLOW CLASS
// ============================================================================

export class Workflow {
  readonly id: string
  readonly name: string
  readonly nodes: WorkflowNodeConfig[]
  readonly connections: WorkflowConnection[]
  readonly settings?: WorkflowSettings
  readonly version: number
  private previousVersions: WorkflowDefinition[] = []

  constructor(definition: WorkflowDefinition) {
    this.id = definition.id ?? `workflow-${crypto.randomUUID()}`
    this.name = definition.name
    this.nodes = definition.nodes
    this.connections = definition.connections
    this.settings = definition.settings
    this.version = 1

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

    // Validate connections reference existing nodes
    for (const connection of this.connections) {
      if (!nodeIds.has(connection.from)) {
        throw new Error(`Invalid connection: source node "${connection.from}" does not exist`)
      }
      if (!nodeIds.has(connection.to)) {
        throw new Error(`Invalid connection: target node "${connection.to}" does not exist`)
      }
    }
  }

  clone(): Workflow {
    const definition: WorkflowDefinition = {
      name: this.name,
      nodes: JSON.parse(JSON.stringify(this.nodes)),
      connections: JSON.parse(JSON.stringify(this.connections)),
      settings: this.settings ? JSON.parse(JSON.stringify(this.settings)) : undefined,
    }

    return new Workflow(definition)
  }

  update(changes: Partial<WorkflowDefinition>): Workflow {
    // Store current version
    this.previousVersions.push({
      id: this.id,
      name: this.name,
      nodes: JSON.parse(JSON.stringify(this.nodes)),
      connections: JSON.parse(JSON.stringify(this.connections)),
      settings: this.settings,
    })

    const newDefinition: WorkflowDefinition = {
      id: this.id,
      name: changes.name ?? this.name,
      nodes: changes.nodes ?? this.nodes,
      connections: changes.connections ?? this.connections,
      settings: changes.settings ?? this.settings,
    }

    const updated = new Workflow(newDefinition)
    ;(updated as unknown as { version: number }).version = this.version + 1
    ;(updated as unknown as { previousVersions: WorkflowDefinition[] }).previousVersions = this.previousVersions

    return updated
  }

  rollback(): Workflow {
    if (this.previousVersions.length === 0) {
      throw new Error('No previous version available')
    }

    const previous = this.previousVersions[this.previousVersions.length - 1]
    const rolled = new Workflow(previous)
    ;(rolled as unknown as { version: number }).version = this.version + 1
    ;(rolled as unknown as { previousVersions: WorkflowDefinition[] }).previousVersions =
      this.previousVersions.slice(0, -1)

    return rolled
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
    const workflow = new Workflow({
      id: data.id,
      name: data.name,
      nodes: data.nodes,
      connections: data.connections,
      settings: data.settings,
    })
    ;(workflow as unknown as { version: number }).version = data.version ?? 1
    return workflow
  }

  getNode(id: string): WorkflowNodeConfig | undefined {
    return this.nodes.find((n) => n.id === id)
  }

  getTriggerNodes(): WorkflowNodeConfig[] {
    const triggerTypes = ['webhook', 'cron', 'polling', 'manual']
    return this.nodes.filter((n) => triggerTypes.includes(n.type))
  }

  getNodeConnections(nodeId: string): {
    incoming: WorkflowConnection[]
    outgoing: WorkflowConnection[]
  } {
    return {
      incoming: this.connections.filter((c) => c.to === nodeId),
      outgoing: this.connections.filter((c) => c.from === nodeId),
    }
  }

  getExecutionOrder(): string[] {
    // Topological sort for execution order
    const inDegree = new Map<string, number>()
    const adjacency = new Map<string, string[]>()

    // Initialize
    for (const node of this.nodes) {
      inDegree.set(node.id, 0)
      adjacency.set(node.id, [])
    }

    // Build graph
    for (const conn of this.connections) {
      const current = inDegree.get(conn.to) ?? 0
      inDegree.set(conn.to, current + 1)
      adjacency.get(conn.from)?.push(conn.to)
    }

    // Find nodes with no incoming edges
    const queue: string[] = []
    inDegree.forEach((degree, nodeId) => {
      if (degree === 0) {
        queue.push(nodeId)
      }
    })

    // Process
    const order: string[] = []
    while (queue.length > 0) {
      const nodeId = queue.shift()!
      order.push(nodeId)

      for (const neighbor of adjacency.get(nodeId) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 0) - 1
        inDegree.set(neighbor, newDegree)
        if (newDegree === 0) {
          queue.push(neighbor)
        }
      }
    }

    return order
  }
}

// ============================================================================
// WORKFLOW ENGINE
// ============================================================================

export class WorkflowEngine {
  private workflows = new Map<string, Workflow>()
  private activeWorkflows = new Set<string>()
  private executionHistory = new Map<string, WorkflowExecution[]>()
  private idempotencyKeys = new Set<string>()
  private executionListeners: Array<(execution: WorkflowExecution) => void> = []
  private globals = new Map<string, () => unknown>()
  private storage?: Storage
  private triggers = new Map<string, WebhookTrigger | CronTrigger | PollingTrigger>()
  private webhookHandlers = new Map<string, (method: string, data: unknown) => Promise<void>>()

  constructor(config?: WorkflowEngineConfig) {
    this.storage = config?.storage
  }

  // ============================================================================
  // WORKFLOW MANAGEMENT
  // ============================================================================

  register(workflow: Workflow): void {
    this.workflows.set(workflow.id, workflow)

    // Initialize execution history
    if (!this.executionHistory.has(workflow.id)) {
      this.executionHistory.set(workflow.id, [])
    }
  }

  unregister(workflowId: string): void {
    this.deactivate(workflowId)
    this.workflows.delete(workflowId)
    this.executionHistory.delete(workflowId)
  }

  getWorkflow(id: string): Workflow | undefined {
    return this.workflows.get(id)
  }

  listWorkflows(): Workflow[] {
    return Array.from(this.workflows.values())
  }

  // ============================================================================
  // ACTIVATION
  // ============================================================================

  activate(workflowId: string): void {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    this.activeWorkflows.add(workflowId)

    // Set up triggers
    for (const triggerNode of workflow.getTriggerNodes()) {
      this.setupTrigger(workflow, triggerNode)
    }
  }

  deactivate(workflowId: string): void {
    this.activeWorkflows.delete(workflowId)

    // Stop triggers
    const triggersToDelete: string[] = []
    this.triggers.forEach((trigger, key) => {
      if (key.startsWith(`${workflowId}:`)) {
        if (trigger instanceof CronTrigger || trigger instanceof PollingTrigger) {
          trigger.stop()
        }
        triggersToDelete.push(key)
      }
    })
    triggersToDelete.forEach((key) => this.triggers.delete(key))

    // Remove webhook handlers
    const handlersToDelete: string[] = []
    this.webhookHandlers.forEach((_, path) => {
      if (path.includes(workflowId)) {
        handlersToDelete.push(path)
      }
    })
    handlersToDelete.forEach((path) => this.webhookHandlers.delete(path))
  }

  isActive(workflowId: string): boolean {
    return this.activeWorkflows.has(workflowId)
  }

  private setupTrigger(workflow: Workflow, triggerNode: WorkflowNodeConfig): void {
    const triggerKey = `${workflow.id}:${triggerNode.id}`

    switch (triggerNode.type) {
      case 'webhook': {
        const trigger = new WebhookTrigger({
          path: triggerNode.config.path as string,
          method: triggerNode.config.method as 'POST' | undefined,
        })

        trigger.onTrigger((event) => {
          this.executeFromTrigger(workflow, triggerNode.id, event)
        })

        this.triggers.set(triggerKey, trigger)

        // Register webhook handler that executes directly and notifies listeners
        this.webhookHandlers.set(triggerNode.config.path as string, async (method, data) => {
          // Execute workflow directly instead of going through trigger
          const execution = await this.execute(workflow.id, {
            input: data,
            startFromNode: triggerNode.id,
          })
          execution.triggerType = 'webhook'
          this.notifyListeners(execution)
        })
        break
      }

      case 'cron': {
        const trigger = new CronTrigger({
          expression: triggerNode.config.expression as string,
          timezone: triggerNode.config.timezone as string | undefined,
        })

        trigger.onTrigger((event) => {
          this.executeFromTrigger(workflow, triggerNode.id, event)
        })

        trigger.start()
        this.triggers.set(triggerKey, trigger)
        break
      }

      case 'polling': {
        const trigger = new PollingTrigger({
          interval: triggerNode.config.interval as string,
          pollFunction: triggerNode.config.pollFunction as () => Promise<{ data: unknown[] }>,
        })

        trigger.onTrigger((event) => {
          this.executeFromTrigger(workflow, triggerNode.id, event)
        })

        trigger.start()
        this.triggers.set(triggerKey, trigger)
        break
      }
    }
  }

  private async executeFromTrigger(
    workflow: Workflow,
    triggerNodeId: string,
    event: TriggerEvent
  ): Promise<WorkflowExecution> {
    const execution = await this.execute(workflow.id, {
      input: event.data,
      startFromNode: triggerNodeId,
    })

    execution.triggerType = event.source
    this.notifyListeners(execution)
    return execution
  }

  // ============================================================================
  // EXECUTION
  // ============================================================================

  async execute(workflowId: string, options?: ExecutionOptions): Promise<WorkflowExecution> {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    // Check idempotency
    if (options?.idempotencyKey) {
      if (this.idempotencyKeys.has(options.idempotencyKey)) {
        // Return existing execution
        const history = this.executionHistory.get(workflowId) ?? []
        const existing = history.find((e) => e.id === options.idempotencyKey)
        if (existing) return existing

        // Return first execution as fallback
        if (history.length > 0) return history[history.length - 1]
      }
      this.idempotencyKeys.add(options.idempotencyKey)
    }

    const execution = new WorkflowExecution(workflowId, workflow.version)
    execution.start(options?.input)

    // Persist initial state
    await this.persistExecution(execution)

    try {
      // Get execution order
      let executionOrder = workflow.getExecutionOrder()

      // If starting from specific node, skip earlier nodes
      if (options?.startFromNode) {
        const startIndex = executionOrder.indexOf(options.startFromNode)
        if (startIndex > 0) {
          executionOrder = executionOrder.slice(startIndex)
        }
      }

      // Build maps for parallel execution support
      // nodeOutputs: stores the output of each executed node
      const nodeOutputs = new Map<string, unknown>()

      // incomingConnections: map of nodeId -> array of source node IDs
      const incomingConnections = new Map<string, string[]>()
      for (const conn of workflow.connections) {
        const existing = incomingConnections.get(conn.to) ?? []
        existing.push(conn.from)
        incomingConnections.set(conn.to, existing)
      }

      // Execute nodes
      const initialInput = options?.input ?? {}

      for (const nodeId of executionOrder) {
        const node = workflow.getNode(nodeId)
        if (!node) continue

        // Determine input for this node
        const incoming = incomingConnections.get(nodeId) ?? []
        let nodeInput: unknown

        if (incoming.length === 0) {
          // No incoming connections - use initial input
          nodeInput = initialInput
        } else if (incoming.length === 1) {
          // Single incoming connection
          nodeInput = nodeOutputs.get(incoming[0]) ?? initialInput
        } else {
          // Multiple incoming connections (parallel branches) - for merge nodes
          if (node.type === 'merge') {
            // Collect outputs from all incoming branches for merge node
            nodeInput = incoming.map((sourceId, index) => ({
              index,
              sourceId,
              data: nodeOutputs.get(sourceId),
            }))
          } else {
            // For non-merge nodes with multiple inputs, use first available
            nodeInput = nodeOutputs.get(incoming[0]) ?? initialInput
          }
        }

        // Call onExecute hook
        node.hooks?.onExecute?.()

        // Record execution start
        execution.recordNodeExecution(nodeId, nodeInput)

        try {
          // Execute node with proper input handling
          const result = await this.executeNodeWithMerge(node, nodeInput, execution, incoming.length)

          // Store output for downstream nodes
          nodeOutputs.set(nodeId, result)

          // Complete node execution
          execution.completeNodeExecution(nodeId, result)

          // Call onComplete hook
          node.hooks?.onComplete?.()
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)

          // Handle retries
          if (node.retry && node.retry.maxRetries > 0) {
            let succeeded = false
            for (let attempt = 1; attempt <= node.retry.maxRetries; attempt++) {
              await this.sleep(node.retry.backoffMs * attempt)
              try {
                const result = await this.executeNodeWithMerge(node, nodeInput, execution, incoming.length)
                nodeOutputs.set(nodeId, result)
                execution.completeNodeExecution(nodeId, result)
                succeeded = true
                break
              } catch {
                // Continue retrying
              }
            }
            if (succeeded) continue
          }

          // Call onError hook
          node.hooks?.onError?.(error instanceof Error ? error : new Error(errorMessage))

          // Handle continueOnFail
          if (node.continueOnFail) {
            execution.failNodeExecution(nodeId, errorMessage)
            nodeOutputs.set(nodeId, nodeInput) // Pass through input on failure
            continue
          }

          // Fail execution
          execution.failNodeExecution(nodeId, errorMessage)
          execution.fail(errorMessage, nodeId)
          await this.persistExecution(execution)
          this.addToHistory(execution)
          return execution
        }
      }

      // Get final output from last executed node
      const lastNodeId = executionOrder[executionOrder.length - 1]
      const finalOutput = nodeOutputs.get(lastNodeId) ?? initialInput

      // Complete execution
      execution.complete(finalOutput)
      await this.persistExecution(execution)
      this.addToHistory(execution)

      return execution
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      execution.fail(errorMessage)
      await this.persistExecution(execution)
      this.addToHistory(execution)
      return execution
    }
  }

  private async executeNodeWithMerge(
    node: WorkflowNodeConfig,
    input: unknown,
    execution: WorkflowExecution,
    inputCount: number
  ): Promise<unknown> {
    // Special handling for merge nodes with multiple inputs
    if (node.type === 'merge' && Array.isArray(input)) {
      const mergeNode = new MergeNode({
        ...node.config as any,
        inputCount,
      })

      // Add all inputs to merge node
      for (const { index, data } of input as Array<{ index: number; data: unknown }>) {
        await mergeNode.addInput(index, { data })
      }

      const result = await mergeNode.getResult()
      return result.output
    }

    // Regular node execution
    return this.executeNode(node, input, execution)
  }

  private async executeNode(
    node: WorkflowNodeConfig,
    input: unknown,
    execution: WorkflowExecution
  ): Promise<unknown> {
    switch (node.type) {
      case 'manual':
        return input

      case 'webhook':
      case 'cron':
      case 'polling':
        return input

      case 'http': {
        const action = new HttpRequestAction(node.config as any)
        const result = await action.execute(input as Record<string, unknown>)
        if (!result.success) {
          throw new Error(result.error ?? 'HTTP request failed')
        }
        return result.data
      }

      case 'code': {
        const action = new CodeAction(node.config as any)
        const result = await action.execute(input)
        if (!result.success) {
          throw new Error(result.error ?? 'Code execution failed')
        }
        return result.data
      }

      case 'set': {
        const action = new SetAction(node.config as any)
        const result = await action.execute(input as Record<string, unknown>)
        if (!result.success) {
          throw new Error(result.error ?? 'Set action failed')
        }
        return result.data
      }

      case 'function': {
        const action = new FunctionAction(node.config as any)
        const result = await action.execute(input, undefined, {
          nodeId: node.id,
          workflowId: execution.workflowId,
          executionId: execution.id,
        })
        if (!result.success) {
          throw new Error(result.error ?? 'Function execution failed')
        }
        return result.data
      }

      case 'if': {
        const ifNode = new IfNode(node.config as any)
        const result = await ifNode.execute(input)
        return result.output
      }

      case 'switch': {
        const switchNode = new SwitchNode(node.config as any)
        const result = await switchNode.execute(input)
        return result.output
      }

      case 'merge': {
        const mergeNode = new MergeNode(node.config as any)
        await mergeNode.addInput(0, { data: input })
        const result = await mergeNode.getResult()
        return result.output
      }

      case 'split': {
        const splitNode = new SplitNode(node.config as any)
        const result = await splitNode.execute(input as Record<string, unknown>)
        return result.items
      }

      case 'filter': {
        const filterNode = new FilterNode(node.config as any)
        const result = await filterNode.execute(input)
        return result.kept
      }

      case 'noOp': {
        const noOpNode = new NoOpNode(node.config as any)
        const result = await noOpNode.execute(input)
        return result.output
      }

      case 'wait': {
        const waitNode = new WaitNode(node.config as any)
        await waitNode.execute(input)
        return input
      }

      case 'execute-workflow': {
        const childWorkflowId = node.config.workflowId as string
        const childExecution = await this.execute(childWorkflowId, { input })
        if (childExecution.status === 'failed') {
          throw new Error(childExecution.error ?? 'Child workflow failed')
        }
        return childExecution.output
      }

      default:
        return input
    }
  }

  // ============================================================================
  // WEBHOOK HANDLING
  // ============================================================================

  async handleWebhook(path: string, method: string, data: unknown): Promise<void> {
    const handler = this.webhookHandlers.get(path)
    if (handler) {
      await handler(method, data)
    }
  }

  // ============================================================================
  // HISTORY & PERSISTENCE
  // ============================================================================

  getExecutionHistory(workflowId: string): WorkflowExecution[] {
    return this.executionHistory.get(workflowId) ?? []
  }

  private addToHistory(execution: WorkflowExecution): void {
    const history = this.executionHistory.get(execution.workflowId) ?? []
    history.push(execution)

    // Trim history if needed
    const workflow = this.workflows.get(execution.workflowId)
    const maxHistory = workflow?.settings?.maxExecutionHistory ?? 100

    while (history.length > maxHistory) {
      history.shift()
    }

    this.executionHistory.set(execution.workflowId, history)
  }

  private async persistExecution(execution: WorkflowExecution): Promise<void> {
    if (!this.storage) return

    try {
      await this.storage.set(`execution:${execution.id}`, {
        id: execution.id,
        workflowId: execution.workflowId,
        workflowVersion: execution.workflowVersion,
        status: execution.status,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
        input: execution.input,
        output: execution.output,
        error: execution.error,
        failedNode: execution.failedNode,
        nodeExecutions: execution.nodeExecutions,
      })
    } catch {
      // Ignore persistence errors
    }
  }

  // ============================================================================
  // LISTENERS
  // ============================================================================

  onExecution(listener: (execution: WorkflowExecution) => void): () => void {
    this.executionListeners.push(listener)
    return () => {
      const index = this.executionListeners.indexOf(listener)
      if (index >= 0) {
        this.executionListeners.splice(index, 1)
      }
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

  // ============================================================================
  // GLOBALS
  // ============================================================================

  setGlobal(name: string, factory: () => unknown): void {
    this.globals.set(name, factory)
  }

  getGlobal(name: string): unknown {
    const factory = this.globals.get(name)
    return factory?.()
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  dispose(): void {
    // Stop all triggers
    this.triggers.forEach((trigger) => {
      if (trigger instanceof CronTrigger || trigger instanceof PollingTrigger) {
        trigger.stop()
      }
    })

    this.triggers.clear()
    this.webhookHandlers.clear()
    this.activeWorkflows.clear()
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
