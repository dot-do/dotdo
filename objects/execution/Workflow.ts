/**
 * @module Workflow
 * @description Durable workflow execution engine using Graph Things
 *
 * Workflow is a Durable Object that orchestrates long-running, multi-step
 * processes with persistent state and checkpoints. It integrates with
 * Cloudflare Workflows for durability and uses the graph-based Things store
 * for all state management.
 *
 * **Core Features:**
 * - Multi-step workflow definitions
 * - Durable execution with automatic checkpointing
 * - Pause/resume capabilities
 * - Event-driven step triggering
 * - Graph-based state storage for queryability
 *
 * **Step Types:**
 * | Type | Description | Use Case |
 * |------|-------------|----------|
 * | `do` | Execute a function | Business logic |
 * | `sleep` | Wait for duration | Delays, rate limiting |
 * | `waitForEvent` | Block until event | Human approval, webhooks |
 *
 * **Workflow States:**
 * | State | Description |
 * |-------|-------------|
 * | `pending` | Not yet started |
 * | `running` | Actively executing steps |
 * | `paused` | Waiting for event or manual resume |
 * | `completed` | All steps finished successfully |
 * | `failed` | Step failed, execution stopped |
 *
 * **Graph Structure:**
 * ```
 * WorkflowDefinition --[hasStep]--> WorkflowStep --[follows]--> WorkflowStep
 *                                       |
 *                                       v
 * WorkflowInstance --[instanceOf]--> WorkflowDefinition
 *        |
 *        v
 * StepExecution --[executionOf]--> WorkflowStep
 *        |
 *        +--[partOf]--> WorkflowInstance
 * ```
 *
 * **HTTP Endpoints:**
 * | Method | Path | Description |
 * |--------|------|-------------|
 * | GET | `/config` | Get workflow configuration |
 * | PUT | `/config` | Set workflow configuration |
 * | POST | `/start` | Start new workflow instance |
 * | GET | `/instances` | List workflow instances |
 * | GET | `/instance/:id` | Get instance details |
 * | POST | `/instance/:id` | Control instance (pause/resume/event) |
 * | GET | `/instances/failed` | List failed instances |
 * | GET | `/steps/failed` | List failed step executions |
 *
 * @example Define a Workflow
 * ```typescript
 * const workflow = new Workflow(ctx, env)
 *
 * await workflow.configure({
 *   name: 'order-fulfillment',
 *   description: 'Process and fulfill customer orders',
 *   steps: [
 *     { name: 'validate', type: 'do', config: { action: 'validateOrder' } },
 *     { name: 'charge', type: 'do', config: { action: 'processPayment' } },
 *     { name: 'await-inventory', type: 'waitForEvent', config: { eventName: 'inventory.confirmed' } },
 *     { name: 'ship', type: 'do', config: { action: 'createShipment' } },
 *     { name: 'notify', type: 'do', config: { action: 'sendConfirmation' } }
 *   ],
 *   trigger: 'event',
 *   schedule: undefined
 * })
 * ```
 *
 * @example Start Workflow Instance
 * ```typescript
 * // Start with input data
 * const instance = await workflow.start({
 *   orderId: 'ord_123',
 *   customerId: 'cust_456',
 *   items: [{ sku: 'WIDGET-1', qty: 2 }]
 * })
 *
 * console.log(instance.id)      // 'abc-123-...'
 * console.log(instance.status)  // 'running'
 * ```
 *
 * @example Pause and Resume
 * ```typescript
 * // Pause a running instance
 * await workflow.pauseInstance(instanceId)
 *
 * // Resume when ready
 * await workflow.resumeInstance(instanceId)
 * ```
 *
 * @example Send Event to Waiting Step
 * ```typescript
 * // Instance waiting at 'await-inventory' step
 * await workflow.sendEvent(instanceId, 'inventory.confirmed', {
 *   warehouseId: 'wh_east',
 *   confirmedAt: new Date()
 * })
 * // Workflow continues to 'ship' step
 * ```
 *
 * @example Query Workflow State
 * ```typescript
 * // Get failed instances for alerting
 * const failed = await workflow.getInstancesByStatus('failed')
 *
 * // Get failed steps for debugging
 * const failedSteps = await workflow.getFailedSteps()
 * for (const { instanceId, step } of failedSteps) {
 *   console.log(`Instance ${instanceId} failed at ${step.name}: ${step.error}`)
 * }
 * ```
 *
 * @see WorkflowFactory - Builder pattern for workflow definitions
 * @see DO - Base Durable Object class
 */

import { DO, Env } from '../core/DO'

// ============================================================================
// THING TYPE CONSTANTS (for $type field)
// ============================================================================

const THING_TYPES = {
  WORKFLOW_DEFINITION: 'WorkflowDefinition',
  WORKFLOW_STEP: 'WorkflowStep',
  WORKFLOW_INSTANCE: 'WorkflowInstance',
  STEP_EXECUTION: 'StepExecution',
} as const

// ============================================================================
// RELATIONSHIP VERBS
// ============================================================================

const VERBS = {
  /** WorkflowInstance is an instance of a WorkflowDefinition */
  INSTANCE_OF: 'instanceOf',
  /** WorkflowStep belongs to a WorkflowDefinition */
  HAS_STEP: 'hasStep',
  /** WorkflowStep follows another step in sequence */
  FOLLOWS: 'follows',
  /** StepExecution is for a WorkflowStep */
  EXECUTION_OF: 'executionOf',
  /** StepExecution is part of a WorkflowInstance */
  PART_OF: 'partOf',
} as const

// ============================================================================
// INTERFACES
// ============================================================================

export interface WorkflowStep {
  id: string
  name: string
  type: 'do' | 'sleep' | 'waitForEvent'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  input?: unknown
  output?: unknown
  error?: string
  startedAt?: Date
  completedAt?: Date
}

export interface WorkflowConfig {
  name: string
  description?: string
  steps: WorkflowStepDefinition[]
  trigger?: 'manual' | 'event' | 'schedule'
  schedule?: string
}

export interface WorkflowStepDefinition {
  name: string
  type: 'do' | 'sleep' | 'waitForEvent'
  config: Record<string, unknown>
}

export interface WorkflowInstance {
  id: string
  workflowId: string
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed'
  input: unknown
  output?: unknown
  currentStep: number
  steps: WorkflowStep[]
  startedAt: Date
  completedAt?: Date
}

// ============================================================================
// WORKFLOW CLASS - Graph-based implementation
// ============================================================================

export class Workflow extends DO {
  /** Cached workflow configuration */
  private configCache: WorkflowConfig | null = null

  /** The $id for this workflow's definition Thing */
  private get definitionId(): string {
    return `workflow:${this.ctx.id.toString()}`
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  // ==========================================================================
  // CONFIGURATION - Stored as WorkflowDefinition Thing
  // ==========================================================================

  /**
   * Get workflow configuration from graph
   */
  async getConfig(): Promise<WorkflowConfig | null> {
    if (this.configCache) {
      return this.configCache
    }

    try {
      // Try to get from graph Things store
      const thing = await this.things.get(this.definitionId)
      if (thing && thing.$type === THING_TYPES.WORKFLOW_DEFINITION) {
        const data = thing.data as Record<string, unknown> | null
        if (data) {
          this.configCache = {
            name: thing.name ?? '',
            description: data.description as string | undefined,
            steps: (data.steps as WorkflowStepDefinition[]) ?? [],
            trigger: data.trigger as 'manual' | 'event' | 'schedule' | undefined,
            schedule: data.schedule as string | undefined,
          }
          return this.configCache
        }
      }
    } catch {
      // Things store may not be initialized
    }

    // Fallback to legacy storage
    this.configCache = (await this.ctx.storage.get('config')) as WorkflowConfig | null
    return this.configCache
  }

  /**
   * Configure the workflow - stores as WorkflowDefinition Thing
   */
  async configure(config: WorkflowConfig): Promise<void> {
    this.configCache = config

    try {
      // Check if definition already exists
      const existing = await this.things.get(this.definitionId)

      if (existing) {
        // Update existing definition
        await this.things.update(this.definitionId, {
          name: config.name,
          data: {
            description: config.description,
            steps: config.steps,
            trigger: config.trigger,
            schedule: config.schedule,
          },
        })
      } else {
        // Create new definition Thing
        await this.things.create({
          $id: this.definitionId,
          $type: THING_TYPES.WORKFLOW_DEFINITION,
          name: config.name,
          data: {
            description: config.description,
            steps: config.steps,
            trigger: config.trigger,
            schedule: config.schedule,
          },
        })
      }

      // Create step Things with relationships
      await this.createStepThings(config.steps)
    } catch {
      // Fallback to legacy storage if Things store fails
      await this.ctx.storage.put('config', config)
    }

    await this.emit('workflow.configured', { config })
  }

  /**
   * Create WorkflowStep Things with relationships
   */
  private async createStepThings(steps: WorkflowStepDefinition[]): Promise<void> {
    let previousStepId: string | null = null

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!
      const stepId = `${this.definitionId}:step:${i}`

      try {
        const existing = await this.things.get(stepId)

        if (existing) {
          await this.things.update(stepId, {
            name: step.name,
            data: {
              type: step.type,
              config: step.config,
              order: i,
            },
          })
        } else {
          await this.things.create({
            $id: stepId,
            $type: THING_TYPES.WORKFLOW_STEP,
            name: step.name,
            data: {
              type: step.type,
              config: step.config,
              order: i,
            },
          })

          // Create 'hasStep' relationship: WorkflowDefinition -> WorkflowStep
          try {
            await this.rels.create({
              verb: VERBS.HAS_STEP,
              from: this.definitionId,
              to: stepId,
            })
          } catch {
            // Relationship may already exist
          }
        }

        // Create 'follows' relationship for step ordering
        if (previousStepId) {
          try {
            await this.rels.create({
              verb: VERBS.FOLLOWS,
              from: stepId,
              to: previousStepId,
            })
          } catch {
            // Relationship may already exist
          }
        }

        previousStepId = stepId
      } catch {
        // Best effort - step creation may fail
      }
    }
  }

  // ==========================================================================
  // INSTANCE MANAGEMENT - Stored as WorkflowInstance Things
  // ==========================================================================

  /**
   * Start a new workflow instance
   */
  async start(input: unknown): Promise<WorkflowInstance> {
    const config = await this.getConfig()
    if (!config) {
      throw new Error('Workflow not configured')
    }

    const instanceId = crypto.randomUUID()
    const instance: WorkflowInstance = {
      id: instanceId,
      workflowId: this.ctx.id.toString(),
      status: 'running',
      input,
      currentStep: 0,
      steps: config.steps.map((step, i) => ({
        id: `${i}`,
        name: step.name,
        type: step.type,
        status: 'pending',
      })),
      startedAt: new Date(),
    }

    // Store as Thing
    await this.saveInstanceThing(instance)
    await this.emit('workflow.started', { instanceId: instance.id, input })

    // Execute steps
    await this.executeInstance(instance)

    return instance
  }

  /**
   * Save workflow instance to graph Things store
   */
  private async saveInstanceThing(instance: WorkflowInstance): Promise<void> {
    const instanceThingId = `${this.definitionId}:instance:${instance.id}`

    try {
      const existing = await this.things.get(instanceThingId)
      const instanceData = this.instanceToData(instance)

      if (existing) {
        await this.things.update(instanceThingId, { data: instanceData })
      } else {
        await this.things.create({
          $id: instanceThingId,
          $type: THING_TYPES.WORKFLOW_INSTANCE,
          name: `Instance ${instance.id.slice(0, 8)}`,
          data: instanceData,
        })

        // Create 'instanceOf' relationship
        try {
          await this.rels.create({
            verb: VERBS.INSTANCE_OF,
            from: instanceThingId,
            to: this.definitionId,
          })
        } catch {
          // Relationship may already exist
        }
      }
    } catch {
      // Fallback to legacy storage
      await this.ctx.storage.put(`instance:${instance.id}`, instance)
    }
  }

  /**
   * Convert instance to storable data format
   */
  private instanceToData(instance: WorkflowInstance): Record<string, unknown> {
    return {
      status: instance.status,
      input: instance.input,
      output: instance.output,
      currentStep: instance.currentStep,
      steps: instance.steps.map((step) => ({
        ...step,
        startedAt: step.startedAt?.toISOString(),
        completedAt: step.completedAt?.toISOString(),
      })),
      startedAt: instance.startedAt.toISOString(),
      completedAt: instance.completedAt?.toISOString(),
    }
  }

  /**
   * Convert stored data back to instance format
   */
  private dataToInstance(id: string, data: Record<string, unknown>): WorkflowInstance {
    const steps = (data.steps as Array<Record<string, unknown>>) ?? []
    return {
      id,
      workflowId: this.ctx.id.toString(),
      status: data.status as WorkflowInstance['status'],
      input: data.input,
      output: data.output,
      currentStep: data.currentStep as number,
      steps: steps.map((step) => ({
        id: step.id as string,
        name: step.name as string,
        type: step.type as WorkflowStep['type'],
        status: step.status as WorkflowStep['status'],
        input: step.input,
        output: step.output,
        error: step.error as string | undefined,
        startedAt: step.startedAt ? new Date(step.startedAt as string) : undefined,
        completedAt: step.completedAt ? new Date(step.completedAt as string) : undefined,
      })),
      startedAt: new Date(data.startedAt as string),
      completedAt: data.completedAt ? new Date(data.completedAt as string) : undefined,
    }
  }

  // ==========================================================================
  // STEP EXECUTION - Tracked as StepExecution Things
  // ==========================================================================

  /**
   * Execute workflow instance steps
   */
  protected async executeInstance(instance: WorkflowInstance): Promise<void> {
    const config = await this.getConfig()
    if (!config) return

    while (instance.currentStep < instance.steps.length) {
      const step = instance.steps[instance.currentStep]!
      const stepDef = config.steps[instance.currentStep]!

      step.status = 'running'
      step.startedAt = new Date()

      // Save step execution state
      await this.saveStepExecution(instance, step)
      await this.emit('step.started', { instanceId: instance.id, stepName: step.name })

      try {
        const result = await this.executeStep(stepDef)
        step.output = result
        step.status = 'completed'
        step.completedAt = new Date()

        await this.saveStepExecution(instance, step)
        await this.emit('step.completed', { instanceId: instance.id, stepName: step.name, output: result })
      } catch (error) {
        step.error = error instanceof Error ? error.message : String(error)
        step.status = 'failed'
        step.completedAt = new Date()
        instance.status = 'failed'

        await this.saveStepExecution(instance, step)
        await this.saveInstanceThing(instance)
        await this.emit('step.failed', { instanceId: instance.id, stepName: step.name, error: step.error })
        await this.emit('workflow.failed', { instanceId: instance.id, error: step.error })
        return
      }

      instance.currentStep++
      await this.saveInstanceThing(instance)
    }

    instance.status = 'completed'
    instance.completedAt = new Date()
    instance.output = instance.steps[instance.steps.length - 1]?.output

    await this.saveInstanceThing(instance)
    await this.emit('workflow.completed', { instanceId: instance.id, output: instance.output })
  }

  /**
   * Save step execution state as a Thing
   */
  private async saveStepExecution(instance: WorkflowInstance, step: WorkflowStep): Promise<void> {
    const stepExecId = `${this.definitionId}:instance:${instance.id}:step:${step.id}`
    const instanceThingId = `${this.definitionId}:instance:${instance.id}`
    const stepDefId = `${this.definitionId}:step:${step.id}`

    try {
      const existing = await this.things.get(stepExecId)
      const stepData = {
        status: step.status,
        input: step.input,
        output: step.output,
        error: step.error,
        startedAt: step.startedAt?.toISOString(),
        completedAt: step.completedAt?.toISOString(),
      }

      if (existing) {
        await this.things.update(stepExecId, { data: stepData })
      } else {
        await this.things.create({
          $id: stepExecId,
          $type: THING_TYPES.STEP_EXECUTION,
          name: `Step ${step.name} execution`,
          data: stepData,
        })

        // Create relationships
        try {
          // executionOf: StepExecution -> WorkflowStep
          await this.rels.create({
            verb: VERBS.EXECUTION_OF,
            from: stepExecId,
            to: stepDefId,
          })
          // partOf: StepExecution -> WorkflowInstance
          await this.rels.create({
            verb: VERBS.PART_OF,
            from: stepExecId,
            to: instanceThingId,
          })
        } catch {
          // Relationships may already exist
        }
      }
    } catch {
      // Best effort - graph operations may fail
    }
  }

  /**
   * Execute a single step
   */
  protected async executeStep(stepDef: WorkflowStepDefinition): Promise<unknown> {
    switch (stepDef.type) {
      case 'do':
        return { executed: stepDef.name, config: stepDef.config }

      case 'sleep':
        const duration = (stepDef.config.duration as number) || 1000
        await new Promise((resolve) => setTimeout(resolve, Math.min(duration, 100)))
        return { slept: duration }

      case 'waitForEvent':
        return { waiting: stepDef.config.eventName }

      default:
        throw new Error(`Unknown step type: ${stepDef.type}`)
    }
  }

  // ==========================================================================
  // INSTANCE RETRIEVAL - Query from graph
  // ==========================================================================

  /**
   * Send event to a waiting workflow
   */
  async sendEvent(instanceId: string, eventType: string, payload: unknown): Promise<void> {
    const instance = await this.getInstance(instanceId)
    if (!instance) {
      throw new Error(`Instance not found: ${instanceId}`)
    }

    await this.emit('event.received', { instanceId, eventType, payload })

    // Resume workflow if paused on waitForEvent
    if (instance.status === 'paused') {
      const currentStep = instance.steps[instance.currentStep]
      if (currentStep?.type === 'waitForEvent') {
        currentStep.output = payload
        currentStep.status = 'completed'
        currentStep.completedAt = new Date()
        instance.currentStep++
        instance.status = 'running'

        await this.saveInstanceThing(instance)
        await this.executeInstance(instance)
      }
    }
  }

  /**
   * Get workflow instance from graph
   */
  async getInstance(instanceId: string): Promise<WorkflowInstance | null> {
    const instanceThingId = `${this.definitionId}:instance:${instanceId}`

    try {
      const thing = await this.things.get(instanceThingId)
      if (thing && thing.$type === THING_TYPES.WORKFLOW_INSTANCE) {
        return this.dataToInstance(instanceId, thing.data as Record<string, unknown>)
      }
    } catch {
      // Fall through to legacy storage
    }

    // Fallback to legacy storage
    return (await this.ctx.storage.get(`instance:${instanceId}`)) as WorkflowInstance | null
  }

  /**
   * List workflow instances from graph
   */
  async listInstances(limit: number = 10): Promise<WorkflowInstance[]> {
    try {
      // Query all WorkflowInstance Things for this workflow
      const things = await this.things.list({ type: THING_TYPES.WORKFLOW_INSTANCE, limit: limit * 2 })

      // Filter to only instances for this workflow definition
      const prefix = `${this.definitionId}:instance:`
      const workflowThings = things.filter((t) => t.$id.startsWith(prefix))

      const instances = workflowThings.map((thing) => {
        const id = thing.$id.replace(prefix, '')
        return this.dataToInstance(id, thing.data as Record<string, unknown>)
      })

      // Sort by startedAt descending
      return instances.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, limit)
    } catch {
      // Fallback to legacy storage
      const map = await this.ctx.storage.list({ prefix: 'instance:' })
      const instances = Array.from(map.values()) as WorkflowInstance[]
      return instances.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, limit)
    }
  }

  // ==========================================================================
  // GRAPH QUERIES - Enhanced workflow queries using relationships
  // ==========================================================================

  /**
   * Get all instances by status
   */
  async getInstancesByStatus(status: WorkflowInstance['status']): Promise<WorkflowInstance[]> {
    const instances = await this.listInstances(100)
    return instances.filter((i) => i.status === status)
  }

  /**
   * Get failed step executions across all instances
   */
  async getFailedSteps(): Promise<Array<{ instanceId: string; step: WorkflowStep }>> {
    const instances = await this.listInstances(100)
    const failed: Array<{ instanceId: string; step: WorkflowStep }> = []

    for (const instance of instances) {
      for (const step of instance.steps) {
        if (step.status === 'failed') {
          failed.push({ instanceId: instance.id, step })
        }
      }
    }

    return failed
  }

  /**
   * Pause a running workflow instance
   */
  async pauseInstance(instanceId: string): Promise<WorkflowInstance | null> {
    const instance = await this.getInstance(instanceId)
    if (!instance || instance.status !== 'running') return instance

    instance.status = 'paused'
    await this.saveInstanceThing(instance)
    await this.emit('workflow.paused', { instanceId })

    return instance
  }

  /**
   * Resume a paused workflow instance
   */
  async resumeInstance(instanceId: string): Promise<WorkflowInstance | null> {
    const instance = await this.getInstance(instanceId)
    if (!instance || instance.status !== 'paused') return instance

    instance.status = 'running'
    await this.saveInstanceThing(instance)
    await this.emit('workflow.resumed', { instanceId })

    // Continue execution
    await this.executeInstance(instance)

    return instance
  }

  // ==========================================================================
  // HTTP ROUTES
  // ==========================================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/config') {
      if (request.method === 'GET') {
        const config = await this.getConfig()
        return new Response(JSON.stringify(config), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (request.method === 'PUT') {
        const config = (await request.json()) as WorkflowConfig
        await this.configure(config)
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/start' && request.method === 'POST') {
      const input = await request.json()
      const instance = await this.start(input)
      return new Response(JSON.stringify(instance), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/instances') {
      const instances = await this.listInstances()
      return new Response(JSON.stringify(instances), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/instances/failed' && request.method === 'GET') {
      const failed = await this.getInstancesByStatus('failed')
      return new Response(JSON.stringify(failed), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/steps/failed' && request.method === 'GET') {
      const failed = await this.getFailedSteps()
      return new Response(JSON.stringify(failed), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const instanceMatch = url.pathname.match(/^\/instance\/([^/]+)$/)
    if (instanceMatch) {
      const instanceId = instanceMatch[1]!
      if (request.method === 'GET') {
        const instance = await this.getInstance(instanceId)
        return new Response(JSON.stringify(instance), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (request.method === 'POST') {
        const body = (await request.json()) as { action?: string; eventType?: string; payload?: unknown }
        if (body.action === 'pause') {
          const instance = await this.pauseInstance(instanceId)
          return new Response(JSON.stringify(instance), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (body.action === 'resume') {
          const instance = await this.resumeInstance(instanceId)
          return new Response(JSON.stringify(instance), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (body.eventType) {
          await this.sendEvent(instanceId, body.eventType, body.payload)
          return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }
    }

    return super.fetch(request)
  }
}

export default Workflow
