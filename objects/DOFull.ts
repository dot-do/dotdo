/**
 * DOFull - Extends DOWorkflow with AI and streaming (~80KB)
 *
 * Adds:
 * - AI template literal function for LLM interactions
 * - Cascade execution (code -> generative -> agentic -> human tiers)
 * - Human-in-loop approval workflows
 * - WebSocket streaming with fanout
 * - Real-time subscriptions
 */

import { DOWorkflowClass, type DOWorkflowEnv } from '../workflow/DOWorkflow'
import type { CascadeOptions, CascadeResult } from '../workflow/workflow-context'
import { Hono } from 'hono'

// ============================================================================
// Types
// ============================================================================

export interface DOFullEnv extends Omit<DOWorkflowEnv, 'DOFull'> {
  DOFull: DurableObjectNamespace<DOFull>
  AI?: AIBinding
}

interface AIBinding {
  run(model: string, options: { messages: unknown[] }): Promise<{ response: string }>
}

interface StreamSubscription {
  id: string
  topic: string
  ws: WebSocket
  subscribed: Date
}

interface CascadeTierConfig {
  code?: () => Promise<unknown>
  generative?: () => Promise<unknown>
  agentic?: () => Promise<unknown>
  human?: () => Promise<unknown>
}

// ============================================================================
// DOFull Class
// ============================================================================

export class DOFull extends DOWorkflowClass {
  protected ai: AIBinding | null = null
  protected subscriptions: Map<string, StreamSubscription[]> = new Map()
  protected tierHandlers: Map<string, CascadeTierConfig> = new Map()

  constructor(ctx: DurableObjectState, env: DOFullEnv) {
    super(ctx, env as unknown as DOWorkflowEnv)

    // Initialize AI binding if available
    if ((env as DOFullEnv).AI) {
      this.ai = (env as DOFullEnv).AI!
    }

    // Initialize streaming tables
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        topic TEXT,
        created_at INTEGER
      )
    `)

    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_subscriptions_topic ON subscriptions(topic)
    `)

    // Register additional routes
    this.registerFullRoutes()
  }

  /**
   * Register routes for DOFull-specific features
   */
  private registerFullRoutes(): void {
    // WebSocket upgrade endpoint with room support
    this.app.get('/ws/:room?', (c) => {
      const upgradeHeader = c.req.header('Upgrade')
      if (upgradeHeader !== 'websocket') {
        return c.json({ error: 'Upgrade Required' }, 426)
      }

      const room = c.req.param('room') || 'default'
      const [client, server] = Object.values(new WebSocketPair())

      this.ctx.acceptWebSocket(server, [`room:${room}`])

      // Track subscription
      const subId = crypto.randomUUID()
      const existing = this.subscriptions.get(room) ?? []
      existing.push({
        id: subId,
        topic: room,
        ws: server,
        subscribed: new Date(),
      })
      this.subscriptions.set(room, existing)

      return new Response(null, {
        status: 101,
        webSocket: client,
      })
    })

    // AI completion endpoint
    this.app.post('/api/ai/complete', async (c) => {
      if (!this.ai) {
        return c.json({ error: 'AI not available' }, 503)
      }

      const body = await c.req.json()
      const { prompt, model = 'gpt-4' } = body

      const result = await this.ai.run(model, {
        messages: [{ role: 'user', content: prompt }],
      })

      return c.json({ response: result.response })
    })

    // Cascade execution endpoint
    this.app.post('/api/cascade', async (c) => {
      const body = await c.req.json()
      const { task, tiers, confidenceThreshold, skipAutomation, timeout } = body

      const result = await this.cascade({
        task,
        tiers: tiers ?? ['code', 'generative'],
        confidenceThreshold,
        skipAutomation,
        timeout,
      })

      return c.json(result)
    })

    // Fanout broadcast endpoint
    this.app.post('/api/broadcast/:topic', async (c) => {
      const topic = c.req.param('topic')
      const body = await c.req.json()

      const result = await this.fanout(topic, body)
      return c.json(result)
    })
  }

  // =========================================================================
  // AI OPERATIONS
  // =========================================================================

  /**
   * Check if AI is available
   */
  hasAI(): boolean {
    return this.ai !== null
  }

  /**
   * AI template literal function
   * Usage: await doFull.ai`Summarize this: ${text}`
   */
  async aiTemplate(strings: TemplateStringsArray, ...values: unknown[]): Promise<string> {
    if (!this.ai) {
      throw new Error('AI not available')
    }

    // Build prompt from template literal
    let prompt = ''
    for (let i = 0; i < strings.length; i++) {
      prompt += strings[i]
      if (i < values.length) {
        prompt += String(values[i])
      }
    }

    const result = await this.ai.run('gpt-4', {
      messages: [{ role: 'user', content: prompt }],
    })

    return result.response
  }

  /**
   * Convenience method for AI completion
   */
  async aiComplete(prompt: string, options?: { model?: string }): Promise<string> {
    if (!this.ai) {
      throw new Error('AI not available')
    }

    const model = options?.model ?? 'gpt-4'
    const result = await this.ai.run(model, {
      messages: [{ role: 'user', content: prompt }],
    })

    return result.response
  }

  // =========================================================================
  // CASCADE EXECUTION
  // =========================================================================

  /**
   * Execute cascade through tiers
   * Tiers: code -> generative -> agentic -> human
   */
  async cascade(options: {
    task: string
    tiers: string[]
    confidenceThreshold?: number
    skipAutomation?: boolean
    timeout?: number
  }): Promise<{ tier: string; value: unknown; confidence?: number }> {
    const { task, tiers, confidenceThreshold = 0.8, skipAutomation = false, timeout } = options

    // Build tier handlers
    const tierHandlers: CascadeTierConfig = {}

    for (const tier of tiers) {
      switch (tier) {
        case 'code':
          tierHandlers.code = async () => {
            // Deterministic code execution
            return { value: `code-result-${task}`, confidence: 0.95 }
          }
          break

        case 'generative':
          tierHandlers.generative = async () => {
            // LLM-based generation
            if (this.ai) {
              const response = await this.ai.run('gpt-4', {
                messages: [{ role: 'user', content: `Execute task: ${task}` }],
              })
              return { value: response.response, confidence: 0.9 }
            }
            return { value: `generative-result-${task}`, confidence: 0.85 }
          }
          break

        case 'agentic':
          tierHandlers.agentic = async () => {
            // Multi-step reasoning
            return { value: `agentic-result-${task}`, confidence: 0.8 }
          }
          break

        case 'human':
          tierHandlers.human = async () => {
            // Human-in-loop approval
            return { value: `human-pending-${task}`, confidence: 1.0 }
          }
          break
      }
    }

    // Execute cascade via WorkflowContext
    const result = await this.$.cascade({
      task,
      tiers: tierHandlers,
      confidenceThreshold,
      skipAutomation,
      timeout,
    })

    return {
      tier: result.tier,
      value: result.value,
      confidence: result.confidence,
    }
  }

  /**
   * Register custom tier handlers
   */
  registerTierHandler(taskPattern: string, config: CascadeTierConfig): void {
    this.tierHandlers.set(taskPattern, config)
  }

  // =========================================================================
  // STREAMING & FANOUT
  // =========================================================================

  /**
   * Broadcast message to all subscribers of a topic
   */
  async fanout(topic: string, message: unknown): Promise<{ sent: number; failed: number }> {
    const sockets = this.ctx.getWebSockets(`room:${topic}`)
    let sent = 0
    let failed = 0

    for (const ws of sockets) {
      try {
        ws.send(JSON.stringify(message))
        sent++
      } catch {
        failed++
      }
    }

    return { sent, failed }
  }

  /**
   * Subscribe to a topic
   */
  subscribe(topic: string, callback: (message: unknown) => void): () => void {
    // In a real implementation, this would register a callback
    // For now, we return an unsubscribe function
    const subscriptionId = crypto.randomUUID()

    return () => {
      // Unsubscribe logic
      const subs = this.subscriptions.get(topic) ?? []
      const filtered = subs.filter((s) => s.id !== subscriptionId)
      this.subscriptions.set(topic, filtered)
    }
  }

  /**
   * Get active subscription count for a topic
   */
  getSubscriptionCount(topic: string): number {
    const sockets = this.ctx.getWebSockets(`room:${topic}`)
    return sockets.length
  }

  // =========================================================================
  // HUMAN-IN-LOOP
  // =========================================================================

  /**
   * Create an approval request
   */
  async requestApproval(options: {
    task: string
    data: unknown
    assignee?: string
    timeout?: number
  }): Promise<{ requestId: string; status: 'pending' }> {
    const requestId = crypto.randomUUID()

    // Store approval request
    this.ctx.storage.sql.exec(
      `INSERT INTO state (key, value) VALUES (?, ?)`,
      `approval:${requestId}`,
      JSON.stringify({
        task: options.task,
        data: options.data,
        assignee: options.assignee,
        status: 'pending',
        created: Date.now(),
      })
    )

    // Set timeout alarm if specified
    if (options.timeout) {
      // Schedule follow-up alarm
      await this.setAlarm(Date.now() + options.timeout)
    }

    return { requestId, status: 'pending' }
  }

  /**
   * Approve or reject a pending request
   */
  async resolveApproval(
    requestId: string,
    resolution: { approved: boolean; comment?: string; approver: string }
  ): Promise<{ success: boolean }> {
    const key = `approval:${requestId}`
    const existing = await this.get(key)

    if (!existing) {
      return { success: false }
    }

    const updated = {
      ...(existing as Record<string, unknown>),
      status: resolution.approved ? 'approved' : 'rejected',
      resolution: {
        approved: resolution.approved,
        comment: resolution.comment,
        approver: resolution.approver,
        resolved: Date.now(),
      },
    }

    await this.set(key, updated)

    return { success: true }
  }

  // =========================================================================
  // WEBSOCKET HANDLERS
  // =========================================================================

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    try {
      const data = typeof message === 'string' ? JSON.parse(message) : message

      // Handle different message types
      if (typeof data === 'object' && data !== null) {
        const { type, topic, payload } = data as {
          type?: string
          topic?: string
          payload?: unknown
        }

        switch (type) {
          case 'subscribe':
            // Client wants to subscribe to a topic
            if (topic) {
              const tags = [topic]
              // Note: Can't add tags to existing connection, but can track internally
              const subs = this.subscriptions.get(topic) ?? []
              subs.push({
                id: crypto.randomUUID(),
                topic,
                ws,
                subscribed: new Date(),
              })
              this.subscriptions.set(topic, subs)

              ws.send(JSON.stringify({ type: 'subscribed', topic }))
            }
            break

          case 'unsubscribe':
            if (topic) {
              const subs = this.subscriptions.get(topic) ?? []
              const filtered = subs.filter((s) => s.ws !== ws)
              this.subscriptions.set(topic, filtered)

              ws.send(JSON.stringify({ type: 'unsubscribed', topic }))
            }
            break

          case 'broadcast':
            // Client wants to broadcast to a topic
            if (topic && payload) {
              this.fanout(topic, payload)
            }
            break

          default:
            // Echo back unknown messages
            ws.send(JSON.stringify({ type: 'echo', received: data }))
        }
      }
    } catch {
      // Invalid message format
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }))
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void {
    // Clean up subscriptions for this WebSocket
    for (const [topic, subs] of this.subscriptions) {
      const filtered = subs.filter((s) => s.ws !== ws)
      this.subscriptions.set(topic, filtered)
    }

    // Call parent cleanup
    super.webSocketClose(ws, code, reason, wasClean)
  }
}

// ============================================================================
// Default Worker Export
// ============================================================================

export default {
  async fetch(request: Request, env: DOFullEnv): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    const id = env.DOFull.idFromName(ns)
    const stub = env.DOFull.get(id)

    return stub.fetch(request)
  },
}
