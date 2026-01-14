/**
 * @module Worker
 * @description Base class for work-performing entities (Agents and Humans)
 *
 * Worker defines the common interface for all work-performing entities in the
 * dotdo framework. Both AI Agents and Humans extend this class, enabling a
 * unified API for task execution, question answering, decision making, and
 * approval workflows. This is the foundation of the digital-workers pattern.
 *
 * **Core Capabilities:**
 * - Task execution with result tracking
 * - Question answering with confidence scores
 * - Decision making from options
 * - Approval request/response workflows
 * - Structured output generation
 * - Multi-channel notifications
 *
 * **Operation Modes:**
 * | Mode | Description | Behavior |
 * |------|-------------|----------|
 * | `autonomous` | Fully independent | Executes without human oversight |
 * | `supervised` | Human oversight | May require approval for actions |
 * | `manual` | Human-controlled | Requires human direction |
 *
 * **Worker Interface Methods:**
 * | Method | Description | Returns |
 * |--------|-------------|---------|
 * | `executeWork()` | Execute a task | `TaskResult` |
 * | `ask()` | Ask a question | `Answer` |
 * | `decide()` | Choose from options | `Decision` |
 * | `approve()` | Request approval | `ApprovalResult` |
 * | `generate()` | Generate structured output | `T` |
 * | `notify()` | Send notifications | `void` |
 *
 * **Events Emitted:**
 * | Event | When |
 * |-------|------|
 * | `task.completed` | Task finished successfully |
 * | `task.failed` | Task failed with error |
 * | `question.asked` | Question submitted |
 * | `question.answered` | Answer generated |
 * | `decision.requested` | Decision needed |
 * | `decision.made` | Decision completed |
 * | `approval.requested` | Approval needed |
 * | `approval.processed` | Approval handled |
 * | `notification.sent` | Notification dispatched |
 * | `mode.changed` | Operation mode changed |
 *
 * @example Implementing a Worker
 * ```typescript
 * class MyWorker extends Worker {
 *   static override readonly $type = 'MyWorker'
 *
 *   protected async executeTask(task: Task, context?: Context): Promise<unknown> {
 *     // Implement task execution logic
 *     return { completed: true }
 *   }
 *
 *   protected async generateAnswer(question: string, context?: Context): Promise<Answer> {
 *     // Implement question answering
 *     return { text: 'My answer', confidence: 0.9 }
 *   }
 *
 *   protected async makeDecision(question: string, options: Option[], context?: Context): Promise<Decision> {
 *     // Implement decision logic
 *     return { selectedOption: options[0], reasoning: 'Best fit' }
 *   }
 *
 *   protected async processApproval(request: ApprovalRequest): Promise<ApprovalResult> {
 *     // Implement approval logic
 *     return { approved: true, approver: this.ctx.id.toString() }
 *   }
 * }
 * ```
 *
 * @example Using Worker Interface
 * ```typescript
 * const worker = new MyWorker(ctx, env)
 *
 * // Execute a task
 * const result = await worker.executeWork({
 *   id: 'task_123',
 *   type: 'data-processing',
 *   description: 'Process customer data',
 *   input: { customerId: 'cust_456' }
 * })
 *
 * // Ask a question
 * const answer = await worker.ask('What is the customer status?', {
 *   conversationId: 'conv_789'
 * })
 *
 * // Make a decision
 * const decision = await worker.decide(
 *   'Which pricing tier?',
 *   [
 *     { id: 'basic', label: 'Basic', description: '$10/mo' },
 *     { id: 'pro', label: 'Pro', description: '$25/mo' }
 *   ]
 * )
 *
 * // Request approval
 * const approval = await worker.approve({
 *   id: 'approval_123',
 *   type: 'budget',
 *   description: 'Approve $5000 expense',
 *   requester: 'user_456',
 *   data: { amount: 5000 }
 * })
 * ```
 *
 * @example Notification Channels
 * ```typescript
 * // Notify across multiple channels
 * await worker.notify('Task completed successfully', [
 *   { type: 'email', target: 'admin@example.com' },
 *   { type: 'slack', target: '#notifications' },
 *   { type: 'webhook', target: 'https://hook.example.com' }
 * ])
 * ```
 *
 * @see Agent - AI-powered Worker implementation
 * @see Human - Human Worker with approval flows
 * @see DO - Base Durable Object class
 */

import { DO, Env } from '../core/DO'
import { Worker as WorkerNoun } from '../../nouns/workers/Worker'
import type { AnyNoun } from '../../nouns/types'

export type WorkerMode = 'autonomous' | 'supervised' | 'manual'

export interface Task {
  id: string
  type: string
  description: string
  input: Record<string, unknown>
  priority?: number
  deadline?: Date
}

export interface TaskResult {
  success: boolean
  output?: unknown
  error?: string
  duration?: number
}

export interface Context {
  conversationId?: string
  userId?: string
  metadata?: Record<string, unknown>
}

export interface Answer {
  text: string
  confidence?: number
  sources?: string[]
}

export interface Option {
  id: string
  label: string
  description?: string
}

export interface Decision {
  selectedOption: Option
  reasoning?: string
  confidence?: number
}

export interface ApprovalRequest {
  id: string
  type: string
  description: string
  requester: string
  data: Record<string, unknown>
  deadline?: Date
}

export interface ApprovalResult {
  approved: boolean
  approver: string
  reason?: string
  approvedAt?: Date
}

export interface Channel {
  type: 'email' | 'slack' | 'sms' | 'webhook'
  target: string
}

/**
 * Worker - Common interface for AI and Human workers
 */
export class Worker extends DO {
  static override readonly $type: string = WorkerNoun.$type
  // Use AnyNoun to allow subclasses (Agent, Human) to override with their own noun types
  static readonly noun: AnyNoun = WorkerNoun

  protected mode: WorkerMode = 'supervised'

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Execute a task
   */
  async executeWork(task: Task, context?: Context): Promise<TaskResult> {
    const startTime = Date.now()
    const action = await this.createAction({
      type: 'task',
      target: task.id,
      actor: this.ctx.id.toString(),
      data: { task, context },
    })

    try {
      const output = await this.executeTask(task, context)
      const duration = Date.now() - startTime

      await this.completeAction(action.id, { output, duration })
      await this.emit('task.completed', { taskId: task.id, output, duration })

      return { success: true, output, duration }
    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)

      await this.failAction(action.id, {
        message: errorMessage,
        name: error instanceof Error ? error.name : 'Error',
        stack: error instanceof Error ? error.stack : undefined
      })
      await this.emit('task.failed', { taskId: task.id, error: errorMessage, duration })

      return { success: false, error: errorMessage, duration }
    }
  }

  /**
   * Override in subclasses to implement task execution
   */
  protected async executeTask(task: Task, context?: Context): Promise<unknown> {
    throw new Error('executeTask must be implemented by subclass')
  }

  /**
   * Ask a question and get an answer
   */
  async ask(question: string, context?: Context): Promise<Answer> {
    await this.emit('question.asked', { question, context })

    const answer = await this.generateAnswer(question, context)

    await this.emit('question.answered', { question, answer })
    return answer
  }

  /**
   * Override in subclasses to implement answer generation
   */
  protected async generateAnswer(question: string, context?: Context): Promise<Answer> {
    throw new Error('generateAnswer must be implemented by subclass')
  }

  /**
   * Make a decision between options
   */
  async decide(question: string, options: Option[], context?: Context): Promise<Decision> {
    await this.emit('decision.requested', { question, options, context })

    const decision = await this.makeDecision(question, options, context)

    await this.emit('decision.made', { question, decision })
    return decision
  }

  /**
   * Override in subclasses to implement decision making
   */
  protected async makeDecision(question: string, options: Option[], context?: Context): Promise<Decision> {
    throw new Error('makeDecision must be implemented by subclass')
  }

  /**
   * Request approval for an action
   */
  async approve(request: ApprovalRequest): Promise<ApprovalResult> {
    await this.emit('approval.requested', { request })

    const result = await this.processApproval(request)

    await this.emit('approval.processed', { request, result })
    return result
  }

  /**
   * Override in subclasses to implement approval processing
   */
  protected async processApproval(request: ApprovalRequest): Promise<ApprovalResult> {
    throw new Error('processApproval must be implemented by subclass')
  }

  /**
   * Generate structured output
   */
  async generate<T>(prompt: string, schema?: unknown): Promise<T> {
    await this.emit('generation.requested', { prompt, hasSchema: !!schema })

    const result = await this.generateOutput<T>(prompt, schema)

    await this.emit('generation.completed', { prompt })
    return result
  }

  /**
   * Override in subclasses to implement generation
   */
  protected async generateOutput<T>(prompt: string, schema?: unknown): Promise<T> {
    throw new Error('generateOutput must be implemented by subclass')
  }

  /**
   * Send notification to channels
   */
  async notify(message: string, channels: Channel[]): Promise<void> {
    await this.emit('notification.sent', { message, channels })

    for (const channel of channels) {
      await this.sendToChannel(message, channel)
    }
  }

  /**
   * Override in subclasses to implement channel-specific sending
   */
  protected async sendToChannel(message: string, channel: Channel): Promise<void> {
    // Default implementation - override in subclasses
    console.log(`[${channel.type}] ${channel.target}: ${message}`)
  }

  /**
   * Get current worker mode
   */
  getMode(): WorkerMode {
    return this.mode
  }

  /**
   * Set worker mode
   */
  setMode(mode: WorkerMode): void {
    this.mode = mode
    this.emit('mode.changed', { mode })
  }
}

export default Worker
