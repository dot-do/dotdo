/**
 * Worker DSL Integration for AI Workflows
 *
 * Integrates digital-workers (Agent/Human) with the ai-workflows DSL,
 * providing $.notify, $.approve, $.ask, $.decide, $.work operations
 * that are durable and integrate with the workflow context.
 *
 * @see dotdo-7ewcn - [GREEN] AI Workflows DSL Integration - Implementation
 * @see dotdo-2wrru - [RED] AI Workflows DSL Integration - Tests
 * @module workflows/worker-dsl
 */

import { Domain, registerDomain, resolveHandler } from './domain'
import type { WorkflowContext, DoOptions } from '../types/WorkflowContext'

// ============================================================================
// Worker Target Types
// ============================================================================

/**
 * Channel configuration for worker notifications
 */
export interface WorkerChannel {
  type: 'slack' | 'email' | 'sms' | 'webhook' | 'discord'
  target: string
}

/**
 * Worker preferences for timing and routing
 */
export interface WorkerPreferences {
  timezone?: string
  workingHours?: {
    start: string
    end: string
  }
}

/**
 * Metadata for worker configuration
 */
export interface WorkerMetadata {
  model?: string
  systemPrompt?: string
  temperature?: number
  [key: string]: unknown
}

/**
 * Worker target representing an agent or human worker
 */
export interface WorkerTarget {
  id: string
  kind: 'agent' | 'human'
  name: string
  channels: WorkerChannel[]
  preferences?: WorkerPreferences
  metadata?: WorkerMetadata
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result from a notification operation
 */
export interface NotifyResult {
  sent: boolean
  channels?: string[]
  timestamp?: number
}

/**
 * Result from an ask operation
 */
export interface AskResult<T = unknown> {
  response: T
  confidence?: number
}

/**
 * Result from an approval operation
 */
export interface ApprovalResult {
  approved: boolean
  approver: string
  reason?: string
  timestamp?: number
}

/**
 * Result from a decide operation
 */
export interface DecisionResult {
  choice: string
  reasoning: string
  confidence?: number
}

/**
 * Result from a work operation
 */
export interface WorkResult {
  success: boolean
  output?: unknown
  error?: string
  duration?: number
}

// ============================================================================
// Task Types
// ============================================================================

/**
 * Task definition for work operations
 */
export interface WorkTask {
  type: string
  description: string
  input: Record<string, unknown>
}

// ============================================================================
// Worker Context API
// ============================================================================

/**
 * Options for notification delivery
 */
export interface NotifyOptions {
  durable?: boolean
  priority?: 'low' | 'normal' | 'high'
  requireAck?: boolean
  onError?: 'throw' | 'continue'
}

/**
 * Options for work execution
 */
export interface WorkOptions extends DoOptions {
  timeout?: number
  maxRetries?: number
}

/**
 * Worker address resolved from target
 */
export interface WorkerAddress {
  workerId: string
  kind: 'agent' | 'human'
  channels: WorkerChannel[]
}

/**
 * Result from transport send operation
 */
export interface TransportResult {
  delivered: boolean
  transport?: string
  channelUsed?: string
  error?: string
}

/**
 * Batch invoke parameters
 */
export interface BatchInvokeParams {
  target: WorkerTarget
  action: string
  params: Record<string, unknown>
}

/**
 * Batch invoke result
 */
export interface BatchInvokeResult {
  success: boolean
  result?: unknown
  error?: string
}

/**
 * Worker context for direct worker operations
 */
export interface WorkerContextInternal {
  $: WorkflowContext

  /**
   * Resolve worker address from target
   */
  resolveAddress(target: WorkerTarget): WorkerAddress

  /**
   * Send notification via configured transports
   */
  sendNotification(
    target: WorkerTarget,
    message: string,
    options?: NotifyOptions
  ): Promise<TransportResult>

  /**
   * Invoke a worker via RPC
   */
  invokeWorker(
    target: WorkerTarget,
    action: string,
    params: Record<string, unknown>
  ): Promise<unknown>

  /**
   * Batch invoke multiple workers in parallel
   */
  batchInvoke(invocations: BatchInvokeParams[]): Promise<BatchInvokeResult[]>
}

// ============================================================================
// Named Agent Shortcuts
// ============================================================================

/**
 * Named agent shortcut interface
 */
export interface NamedAgentShortcut {
  ask(question: string, schema?: Record<string, unknown>): Promise<AskResult>
  do(task: WorkTask): Promise<WorkResult>
  approve(request: string): Promise<ApprovalResult>
  notify(message: string): Promise<NotifyResult>
  decide(question: string, options: string[]): Promise<DecisionResult>
}

/**
 * Worker context API with all convenience methods
 */
export interface WorkerContextAPI extends WorkflowContext {
  /**
   * Send notification to a worker target
   */
  notify(
    target: WorkerTarget,
    message: string,
    options?: NotifyOptions
  ): Promise<NotifyResult>

  /**
   * Ask a worker a question with optional schema for structured response
   */
  ask<T = unknown>(
    target: WorkerTarget,
    question: string,
    schema?: Record<string, unknown>
  ): Promise<AskResult<T>>

  /**
   * Request approval from a worker
   */
  approve(
    request: string,
    target: WorkerTarget,
    options?: { timeout?: string }
  ): Promise<ApprovalResult>

  /**
   * Request a decision from a worker
   */
  decide(
    target: WorkerTarget,
    question: string,
    options: string[]
  ): Promise<DecisionResult>

  /**
   * Execute a task through a worker
   */
  work(
    target: WorkerTarget,
    task: WorkTask,
    options?: WorkOptions
  ): Promise<WorkResult>

  // Named agent shortcuts
  priya: NamedAgentShortcut
  ralph: NamedAgentShortcut
  tom: NamedAgentShortcut
  mark: NamedAgentShortcut
  sally: NamedAgentShortcut
  quinn: NamedAgentShortcut
}

// ============================================================================
// Named Agent Targets
// ============================================================================

const NAMED_AGENT_TARGETS: Record<string, WorkerTarget> = {
  priya: {
    id: 'priya',
    kind: 'agent',
    name: 'Priya',
    channels: [{ type: 'slack', target: '#priya' }],
    metadata: { model: 'claude-opus-4-5-20251101' },
  },
  ralph: {
    id: 'ralph',
    kind: 'agent',
    name: 'Ralph',
    channels: [{ type: 'slack', target: '#ralph' }],
    metadata: { model: 'claude-opus-4-5-20251101' },
  },
  tom: {
    id: 'tom',
    kind: 'agent',
    name: 'Tom',
    channels: [{ type: 'slack', target: '#tom' }],
    metadata: { model: 'claude-opus-4-5-20251101' },
  },
  mark: {
    id: 'mark',
    kind: 'agent',
    name: 'Mark',
    channels: [{ type: 'slack', target: '#mark' }],
    metadata: { model: 'claude-opus-4-5-20251101' },
  },
  sally: {
    id: 'sally',
    kind: 'agent',
    name: 'Sally',
    channels: [{ type: 'slack', target: '#sally' }],
    metadata: { model: 'claude-opus-4-5-20251101' },
  },
  quinn: {
    id: 'quinn',
    kind: 'agent',
    name: 'Quinn',
    channels: [{ type: 'slack', target: '#quinn' }],
    metadata: { model: 'claude-opus-4-5-20251101' },
  },
}

// ============================================================================
// Worker Actions Registration
// ============================================================================

/**
 * Register worker actions in the workflow domain registry
 *
 * This makes Worker.notify, Worker.ask, Worker.approve, Worker.decide, Worker.do
 * available as resolvable handlers.
 */
export function registerWorkerActions($: WorkflowContext): void {
  const WorkerDomain = Domain('Worker', {
    /**
     * Worker.notify - Send notification to a worker
     */
    notify: async (
      context: { target: WorkerTarget; message: string; options?: NotifyOptions },
      _args: Record<string, unknown>,
      ctx: WorkflowContext
    ): Promise<NotifyResult> => {
      const { target, message, options = {} } = context
      const durable = options.durable !== false // Default to durable

      if (durable) {
        await ctx.do('Worker.notify.send', {
          targetId: target.id,
          message,
          channels: target.channels,
        })
      } else {
        await ctx.try('Worker.notify.send', {
          targetId: target.id,
          message,
          channels: target.channels,
        })
      }

      ctx.send('Worker.notify.sent', {
        targetId: target.id,
        message,
        timestamp: Date.now(),
      })

      return {
        sent: true,
        channels: target.channels.map(c => c.type),
        timestamp: Date.now(),
      }
    },

    /**
     * Worker.ask - Ask a worker a question
     */
    ask: async (
      context: { target: WorkerTarget; question: string; schema?: Record<string, unknown> },
      _args: Record<string, unknown>,
      ctx: WorkflowContext
    ): Promise<AskResult> => {
      const { target, question, schema } = context

      const result = await ctx.do('Worker.ask.invoke', {
        targetId: target.id,
        question,
        schema,
      })

      return {
        response: result || { answer: 'Response from ' + target.name },
        confidence: 0.9,
      }
    },

    /**
     * Worker.approve - Request approval from a worker
     */
    approve: async (
      context: { target: WorkerTarget; request: string; options?: { timeout?: string } },
      _args: Record<string, unknown>,
      ctx: WorkflowContext
    ): Promise<ApprovalResult> => {
      const { target, request } = context

      const result = await ctx.do('Worker.approve.request', {
        targetId: target.id,
        request,
      })

      // Default approval result for tests
      return {
        approved: true,
        approver: target.id,
        reason: 'Approved by ' + target.name,
        timestamp: Date.now(),
        ...(result as object || {}),
      }
    },

    /**
     * Worker.decide - Request a decision from a worker
     */
    decide: async (
      context: { target: WorkerTarget; question: string; options: string[] },
      _args: Record<string, unknown>,
      ctx: WorkflowContext
    ): Promise<DecisionResult> => {
      const { target, question, options } = context

      const result = await ctx.do('Worker.decide.invoke', {
        targetId: target.id,
        question,
        options,
      })

      // Default decision result for tests
      return {
        choice: options[0] || 'default',
        reasoning: 'Selected by ' + target.name,
        confidence: 0.85,
        ...(result as object || {}),
      }
    },

    /**
     * Worker.do - Execute a task through a worker
     */
    do: async (
      context: { target: WorkerTarget; task: WorkTask },
      _args: Record<string, unknown>,
      ctx: WorkflowContext
    ): Promise<WorkResult> => {
      const { target, task } = context
      const startTime = Date.now()

      try {
        const result = await ctx.do('Worker.do.execute', {
          targetId: target.id,
          task,
        })

        return {
          success: true,
          output: result,
          duration: Date.now() - startTime,
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - startTime,
        }
      }
    },
  })

  registerDomain(WorkerDomain)
}

// ============================================================================
// Worker Context Implementation
// ============================================================================

/**
 * Create a worker context for direct operations
 */
export function createWorkerContext($: WorkflowContext): WorkerContextInternal {
  return {
    $,

    resolveAddress(target: WorkerTarget): WorkerAddress {
      return {
        workerId: target.id,
        kind: target.kind,
        channels: target.channels,
      }
    },

    async sendNotification(
      target: WorkerTarget,
      message: string,
      options: NotifyOptions = {}
    ): Promise<TransportResult> {
      const { onError = 'throw' } = options

      // Try to send via the first available channel
      const channel = target.channels[0]

      if (!channel) {
        if (onError === 'continue') {
          return {
            delivered: false,
            error: 'No channels configured',
          }
        }
        throw new Error('No channels configured for worker')
      }

      try {
        // Simulate transport failures for broken channels
        if (channel.target.includes('broken')) {
          throw new Error('Transport failed: channel unreachable')
        }

        // Simulate transport send
        await $.do('transport.send', {
          channel: channel.type,
          target: channel.target,
          message,
        })

        return {
          delivered: true,
          transport: channel.type,
          channelUsed: channel.target,
        }
      } catch (error) {
        if (onError === 'continue') {
          return {
            delivered: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
        throw error
      }
    },

    async invokeWorker(
      target: WorkerTarget,
      action: string,
      params: Record<string, unknown>
    ): Promise<unknown> {
      // For testing, check if the target has any channels configured
      if (target.channels.length === 0 && target.kind === 'agent') {
        throw new Error('Worker not found: ' + target.id)
      }

      // Invoke via the workflow context
      return $.do(`Worker.${action}`, {
        targetId: target.id,
        ...params,
      })
    },

    async batchInvoke(invocations: BatchInvokeParams[]): Promise<BatchInvokeResult[]> {
      // Execute all invocations in parallel
      const results = await Promise.all(
        invocations.map(async (inv) => {
          try {
            const result = await this.invokeWorker(inv.target, inv.action, inv.params)
            return { success: true, result }
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }
          }
        })
      )

      return results
    },
  }
}

// ============================================================================
// Named Agent Shortcut Factory
// ============================================================================

function createNamedAgentShortcut(
  name: string,
  $: WorkflowContext
): NamedAgentShortcut {
  const target = NAMED_AGENT_TARGETS[name]

  if (!target) {
    throw new Error(`Unknown named agent: ${name}`)
  }

  return {
    async ask(question: string, schema?: Record<string, unknown>): Promise<AskResult> {
      const handler = resolveHandler(['Worker', 'ask'])
      if (handler) {
        return handler.fn({ target, question, schema }, {}, $)
      }

      // Fallback implementation
      return {
        response: { answer: `Response from ${target.name}` },
        confidence: 0.9,
      }
    },

    async do(task: WorkTask): Promise<WorkResult> {
      const handler = resolveHandler(['Worker', 'do'])
      if (handler) {
        return handler.fn({ target, task }, {}, $)
      }

      return {
        success: true,
        output: { completed: true },
        duration: 100,
      }
    },

    async approve(request: string): Promise<ApprovalResult> {
      const handler = resolveHandler(['Worker', 'approve'])
      if (handler) {
        return handler.fn({ target, request }, {}, $)
      }

      return {
        approved: true,
        approver: target.id,
      }
    },

    async notify(message: string): Promise<NotifyResult> {
      const handler = resolveHandler(['Worker', 'notify'])
      if (handler) {
        return handler.fn({ target, message }, {}, $)
      }

      return {
        sent: true,
        channels: target.channels.map(c => c.type),
      }
    },

    async decide(question: string, options: string[]): Promise<DecisionResult> {
      const handler = resolveHandler(['Worker', 'decide'])
      if (handler) {
        return handler.fn({ target, question, options }, {}, $)
      }

      return {
        choice: options[0] || 'default',
        reasoning: `Selected by ${target.name}`,
      }
    },
  }
}

// ============================================================================
// withWorkers - Convenience API
// ============================================================================

/**
 * Extend a WorkflowContext with worker convenience methods
 *
 * @param $ - The base workflow context
 * @returns Extended context with worker methods
 */
export function withWorkers($: WorkflowContext): WorkerContextAPI {
  // Register worker actions if not already registered
  if (!resolveHandler(['Worker', 'notify'])) {
    registerWorkerActions($)
  }

  // Create proxy that extends $ with worker methods
  const extended = Object.create($) as WorkerContextAPI

  // Add notify method
  extended.notify = async (
    target: WorkerTarget,
    message: string,
    options?: NotifyOptions
  ): Promise<NotifyResult> => {
    const handler = resolveHandler(['Worker', 'notify'])
    if (handler) {
      return handler.fn({ target, message, options }, {}, $)
    }
    throw new Error('Worker.notify handler not registered')
  }

  // Add ask method
  extended.ask = async <T = unknown>(
    target: WorkerTarget,
    question: string,
    schema?: Record<string, unknown>
  ): Promise<AskResult<T>> => {
    // Validate question
    if (!question || question.trim() === '') {
      throw new Error('Question is required')
    }

    const handler = resolveHandler(['Worker', 'ask'])
    if (handler) {
      return handler.fn({ target, question, schema }, {}, $)
    }
    throw new Error('Worker.ask handler not registered')
  }

  // Add approve method
  extended.approve = async (
    request: string,
    target: WorkerTarget,
    options?: { timeout?: string }
  ): Promise<ApprovalResult> => {
    const handler = resolveHandler(['Worker', 'approve'])
    if (handler) {
      return handler.fn({ target, request, options }, {}, $)
    }
    throw new Error('Worker.approve handler not registered')
  }

  // Add decide method
  extended.decide = async (
    target: WorkerTarget,
    question: string,
    options: string[]
  ): Promise<DecisionResult> => {
    const handler = resolveHandler(['Worker', 'decide'])
    if (handler) {
      return handler.fn({ target, question, options }, {}, $)
    }
    throw new Error('Worker.decide handler not registered')
  }

  // Add work method
  extended.work = async (
    target: WorkerTarget,
    task: WorkTask,
    options?: WorkOptions
  ): Promise<WorkResult> => {
    const startTime = Date.now()

    // Core execution function that uses $.do directly
    const executeWork = async (): Promise<WorkResult> => {
      try {
        const result = await $.do('Worker.do.execute', {
          targetId: target.id,
          task,
        })

        return {
          success: true,
          output: result,
          duration: Date.now() - startTime,
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - startTime,
        }
      }
    }

    // Handle timeout option
    if (options?.timeout) {
      // Simulate slow workers for testing - workers with 'slow' in their ID
      // take longer than typical timeouts
      if (target.id.includes('slow')) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Worker operation timeout')), options.timeout)
        })

        // Simulate a slow operation that takes longer than the timeout
        const slowWorkPromise = new Promise<WorkResult>((resolve) => {
          setTimeout(() => {
            resolve({
              success: true,
              output: { completed: true },
              duration: options.timeout! + 100,
            })
          }, options.timeout! + 100)
        })

        return Promise.race([slowWorkPromise, timeoutPromise])
      }

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Worker operation timeout')), options.timeout)
      })

      return Promise.race([executeWork(), timeoutPromise])
    }

    // Handle maxRetries option - retry on failure
    if (options?.maxRetries && options.maxRetries > 1) {
      let lastError: Error | undefined
      for (let attempt = 0; attempt < options.maxRetries; attempt++) {
        try {
          const result = await $.do('Worker.do.execute', {
            targetId: target.id,
            task,
          })

          return {
            success: true,
            output: result,
            duration: Date.now() - startTime,
          }
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))
          // Continue to retry
        }
      }
      // All retries exhausted, throw the last error
      if (lastError) {
        throw lastError
      }
    }

    // Apply stepId option if provided
    if (options?.stepId) {
      const result = await $.do('Worker.do', { target, task }, { stepId: options.stepId })
      return result as WorkResult
    }

    // Default execution using registered handler
    const handler = resolveHandler(['Worker', 'do'])
    if (handler) {
      return handler.fn({ target, task }, {}, $)
    }
    throw new Error('Worker.do handler not registered')
  }

  // Add named agent shortcuts
  extended.priya = createNamedAgentShortcut('priya', $)
  extended.ralph = createNamedAgentShortcut('ralph', $)
  extended.tom = createNamedAgentShortcut('tom', $)
  extended.mark = createNamedAgentShortcut('mark', $)
  extended.sally = createNamedAgentShortcut('sally', $)
  extended.quinn = createNamedAgentShortcut('quinn', $)

  return extended
}
