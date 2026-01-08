/**
 * Workflow - Durable workflow execution
 *
 * Represents a long-running workflow with steps, state, and checkpoints.
 * Integrates with Cloudflare Workflows for durability.
 */

import { DO, Env } from './DO'

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

export class Workflow extends DO {
  private config: WorkflowConfig | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Get workflow configuration
   */
  async getConfig(): Promise<WorkflowConfig | null> {
    if (!this.config) {
      this.config = await this.ctx.storage.get('config') as WorkflowConfig | null
    }
    return this.config
  }

  /**
   * Configure the workflow
   */
  async configure(config: WorkflowConfig): Promise<void> {
    this.config = config
    await this.ctx.storage.put('config', config)
    await this.emit('workflow.configured', { config })
  }

  /**
   * Start a new workflow instance
   */
  async start(input: unknown): Promise<WorkflowInstance> {
    const config = await this.getConfig()
    if (!config) {
      throw new Error('Workflow not configured')
    }

    const instance: WorkflowInstance = {
      id: crypto.randomUUID(),
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

    await this.ctx.storage.put(`instance:${instance.id}`, instance)
    await this.emit('workflow.started', { instanceId: instance.id, input })

    // Execute steps
    await this.executeInstance(instance)

    return instance
  }

  /**
   * Execute workflow instance steps
   */
  protected async executeInstance(instance: WorkflowInstance): Promise<void> {
    const config = await this.getConfig()
    if (!config) return

    while (instance.currentStep < instance.steps.length) {
      const step = instance.steps[instance.currentStep]
      const stepDef = config.steps[instance.currentStep]

      step.status = 'running'
      step.startedAt = new Date()
      await this.ctx.storage.put(`instance:${instance.id}`, instance)
      await this.emit('step.started', { instanceId: instance.id, stepName: step.name })

      try {
        const result = await this.executeStep(stepDef)
        step.output = result
        step.status = 'completed'
        step.completedAt = new Date()

        await this.emit('step.completed', { instanceId: instance.id, stepName: step.name, output: result })
      } catch (error) {
        step.error = error instanceof Error ? error.message : String(error)
        step.status = 'failed'
        step.completedAt = new Date()
        instance.status = 'failed'

        await this.ctx.storage.put(`instance:${instance.id}`, instance)
        await this.emit('step.failed', { instanceId: instance.id, stepName: step.name, error: step.error })
        await this.emit('workflow.failed', { instanceId: instance.id, error: step.error })
        return
      }

      instance.currentStep++
      await this.ctx.storage.put(`instance:${instance.id}`, instance)
    }

    instance.status = 'completed'
    instance.completedAt = new Date()
    instance.output = instance.steps[instance.steps.length - 1]?.output

    await this.ctx.storage.put(`instance:${instance.id}`, instance)
    await this.emit('workflow.completed', { instanceId: instance.id, output: instance.output })
  }

  /**
   * Execute a single step (stub - integrate with Cloudflare Workflows)
   */
  protected async executeStep(stepDef: WorkflowStepDefinition): Promise<unknown> {
    switch (stepDef.type) {
      case 'do':
        // In production, execute via step.do()
        return { executed: stepDef.name, config: stepDef.config }

      case 'sleep':
        // In production, use step.sleep()
        const duration = (stepDef.config.duration as number) || 1000
        await new Promise(resolve => setTimeout(resolve, Math.min(duration, 100)))
        return { slept: duration }

      case 'waitForEvent':
        // In production, use step.waitForEvent()
        return { waiting: stepDef.config.eventName }

      default:
        throw new Error(`Unknown step type: ${stepDef.type}`)
    }
  }

  /**
   * Send event to a waiting workflow
   */
  async sendEvent(instanceId: string, eventType: string, payload: unknown): Promise<void> {
    const instance = await this.ctx.storage.get(`instance:${instanceId}`) as WorkflowInstance | undefined
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

        await this.ctx.storage.put(`instance:${instanceId}`, instance)
        await this.executeInstance(instance)
      }
    }
  }

  /**
   * Get workflow instance
   */
  async getInstance(instanceId: string): Promise<WorkflowInstance | null> {
    return await this.ctx.storage.get(`instance:${instanceId}`) as WorkflowInstance | null
  }

  /**
   * List workflow instances
   */
  async listInstances(limit: number = 10): Promise<WorkflowInstance[]> {
    const map = await this.ctx.storage.list({ prefix: 'instance:' })
    const instances = Array.from(map.values()) as WorkflowInstance[]
    return instances
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit)
  }

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
        const config = await request.json() as WorkflowConfig
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

    if (url.pathname.startsWith('/instance/')) {
      const instanceId = url.pathname.split('/')[2]
      const instance = await this.getInstance(instanceId)
      return new Response(JSON.stringify(instance), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return super.fetch(request)
  }
}

export default Workflow
