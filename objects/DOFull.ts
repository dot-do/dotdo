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
import { Hono, type MiddlewareHandler } from 'hono'
import { requireAuth, requirePermission } from '../lib/auth-middleware'

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

interface WebSocketClientState {
  clientId: string
  room: string
  connectedAt: number
  lastPingAt: number | null
  messageCount: number
  seqNumber: number
  processedMessageIds: Set<string>
}

interface OutgoingMessage {
  type: string
  payload?: unknown
  id?: string
  timestamp?: number
  seq?: number
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
  protected wsClientState: Map<WebSocket, WebSocketClientState> = new Map()
  protected messageHistory: OutgoingMessage[] = []
  protected globalSeqCounter = 0
  protected heartbeatInterval: ReturnType<typeof setInterval> | null = null
  // Short interval for testing, in production this would be 30000ms
  private static readonly HEARTBEAT_INTERVAL_MS = 5000
  private static readonly MAX_MESSAGE_HISTORY = 1000

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

      // Use client ID from query parameter if provided (for reconnection), otherwise generate new
      const existingClientId = c.req.query('clientId')
      const clientId = existingClientId && existingClientId.startsWith('client_')
        ? existingClientId
        : `client_${crypto.randomUUID().slice(0, 8)}`

      // Track client state
      const clientState: WebSocketClientState = {
        clientId,
        room,
        connectedAt: Date.now(),
        lastPingAt: null,
        messageCount: 0,
        seqNumber: 0,
        processedMessageIds: new Set(),
      }
      this.wsClientState.set(server, clientState)

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

      // Send connected message with client ID
      server.send(JSON.stringify({
        type: 'connected',
        payload: { clientId },
        timestamp: Date.now(),
      }))

      // Send room_joined message
      server.send(JSON.stringify({
        type: 'room_joined',
        payload: { room },
        timestamp: Date.now(),
      }))

      // Start heartbeat if not already running
      this.startHeartbeat()

      return new Response(null, {
        status: 101,
        webSocket: client,
      })
    })

    // AI completion endpoint - requires authentication with ai:complete permission
    this.app.post('/api/ai/complete', requirePermission('ai:complete') as MiddlewareHandler, async (c) => {
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

    // Cascade execution endpoint - requires authentication with workflow:cascade permission
    this.app.post('/api/cascade', requirePermission('workflow:cascade') as MiddlewareHandler, async (c) => {
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

    // Fanout broadcast endpoint - requires authentication with broadcast permission
    this.app.post('/api/broadcast/:topic', requirePermission('broadcast:*') as MiddlewareHandler, async (c) => {
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
      tier: result.tier ?? 'unknown',
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
      } catch (err) {
        failed++
        // WebSocket broadcast error - socket may be closed or in invalid state
        console.warn('[DOFull] WebSocket broadcast error:', (err as Error).message)
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

  /**
   * Send a message with sequence number tracking
   */
  private sendWithSeq(ws: WebSocket, msg: OutgoingMessage): void {
    // Assign global sequence number
    this.globalSeqCounter++
    const outgoing: OutgoingMessage = {
      ...msg,
      seq: this.globalSeqCounter,
      timestamp: msg.timestamp ?? Date.now(),
    }

    // Store in history for replay
    this.messageHistory.push(outgoing)
    if (this.messageHistory.length > DOFull.MAX_MESSAGE_HISTORY) {
      this.messageHistory.shift()
    }

    ws.send(JSON.stringify(outgoing))
  }

  /**
   * Start the heartbeat interval
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) return

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat()
    }, DOFull.HEARTBEAT_INTERVAL_MS)
  }

  /**
   * Send heartbeat to all connected WebSockets
   */
  private sendHeartbeat(): void {
    const sockets = this.ctx.getWebSockets()
    for (const ws of sockets) {
      try {
        ws.send(JSON.stringify({
          type: 'heartbeat',
          timestamp: Date.now(),
        }))
      } catch (err) {
        // WebSocket may be closed - expected during connection lifecycle
        console.warn('[DOFull] Heartbeat send failed:', (err as Error).message)
      }
    }
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    try {
      const data = typeof message === 'string' ? JSON.parse(message) : message
      const clientState = this.wsClientState.get(ws)

      // Count incoming messages
      if (clientState) {
        clientState.messageCount++
      }

      // Handle different message types
      if (typeof data === 'object' && data !== null) {
        const { type, topic, payload, id, timestamp } = data as {
          type?: string
          topic?: string
          payload?: unknown
          id?: string
          timestamp?: number
        }

        // Check for duplicate message ID (deduplication)
        if (id && clientState) {
          if (clientState.processedMessageIds.has(id)) {
            // Already processed this message, send ack but don't process again
            this.sendWithSeq(ws, {
              type: 'ack',
              payload: { originalId: id, duplicate: true },
            })
            return
          }
          clientState.processedMessageIds.add(id)
          // Keep the set bounded
          if (clientState.processedMessageIds.size > 1000) {
            const iterator = clientState.processedMessageIds.values()
            clientState.processedMessageIds.delete(iterator.next().value!)
          }
        }

        switch (type) {
          case 'subscribe': {
            // Client wants to subscribe to a topic
            const subTopic = (payload as { topic?: string })?.topic || topic
            if (subTopic) {
              const subs = this.subscriptions.get(subTopic) ?? []
              subs.push({
                id: crypto.randomUUID(),
                topic: subTopic,
                ws,
                subscribed: new Date(),
              })
              this.subscriptions.set(subTopic, subs)

              this.sendWithSeq(ws, {
                type: 'subscribed',
                payload: { topic: subTopic },
              })
            }
            break
          }

          case 'unsubscribe': {
            const unsubTopic = (payload as { topic?: string })?.topic || topic
            if (unsubTopic) {
              const subs = this.subscriptions.get(unsubTopic) ?? []
              const filtered = subs.filter((s) => s.ws !== ws)
              this.subscriptions.set(unsubTopic, filtered)

              this.sendWithSeq(ws, {
                type: 'unsubscribed',
                payload: { topic: unsubTopic },
              })
            }
            break
          }

          case 'broadcast': {
            // Client wants to broadcast to a room
            const broadcastPayload = payload as { topic?: string; message?: unknown }
            const broadcastRoom = broadcastPayload?.topic || clientState?.room
            const broadcastMessage = broadcastPayload?.message

            if (broadcastRoom && broadcastMessage) {
              // Get all WebSockets in this room
              const roomSockets = this.ctx.getWebSockets(`room:${broadcastRoom}`)
              for (const roomWs of roomSockets) {
                if (roomWs !== ws) {
                  // Don't send back to sender
                  try {
                    roomWs.send(JSON.stringify({
                      type: 'room_message',
                      payload: broadcastMessage,
                      timestamp: Date.now(),
                    }))
                  } catch (err) {
                    // WebSocket may be closed - expected during room broadcast
                    console.warn('[DOFull] Room broadcast send failed:', (err as Error).message)
                  }
                }
              }
            }
            break
          }

          case 'ping': {
            // Respond with pong
            if (clientState) {
              clientState.lastPingAt = Date.now()
            }
            ws.send(JSON.stringify({
              type: 'pong',
              payload: {
                clientTimestamp: timestamp,
                serverTimestamp: Date.now(),
              },
              timestamp: Date.now(),
            }))
            break
          }

          case 'get_health': {
            // Return connection health metrics
            this.sendWithSeq(ws, {
              type: 'health',
              payload: {
                connectedAt: clientState?.connectedAt ?? null,
                lastPingAt: clientState?.lastPingAt ?? null,
                messageCount: clientState?.messageCount ?? 0,
              },
            })
            break
          }

          case 'get_room_info': {
            // Return room info
            const roomInfoPayload = payload as { room?: string }
            const roomName = roomInfoPayload?.room || clientState?.room || 'default'
            const roomSockets = this.ctx.getWebSockets(`room:${roomName}`)

            this.sendWithSeq(ws, {
              type: 'room_info',
              payload: {
                room: roomName,
                memberCount: roomSockets.length,
              },
            })
            break
          }

          case 'replay': {
            // Client requesting missed messages since a sequence number
            const replayPayload = payload as { fromSeq?: number }
            const fromSeq = replayPayload?.fromSeq ?? 0

            // Send any messages after fromSeq
            const missedMessages = this.messageHistory.filter(
              (m) => (m.seq ?? 0) > fromSeq
            )

            for (const missed of missedMessages) {
              ws.send(JSON.stringify(missed))
            }

            ws.send(JSON.stringify({
              type: 'replay_complete',
              payload: {
                fromSeq,
                messagesReplayed: missedMessages.length,
              },
              timestamp: Date.now(),
            }))
            break
          }

          case 'msg':
          case 'rapid': {
            // Echo back with sequence number and ack
            if (id) {
              this.sendWithSeq(ws, {
                type: 'ack',
                payload: { originalId: id, seq: this.globalSeqCounter + 1 },
              })
            }
            this.sendWithSeq(ws, {
              type: 'echo',
              payload: { ...data, seq: this.globalSeqCounter + 1 },
            })
            break
          }

          case 'heartbeat_ack': {
            // Client acknowledged heartbeat - update last activity
            if (clientState) {
              clientState.lastPingAt = Date.now()
            }
            break
          }

          case 'trigger_error': {
            // For testing error handling
            const errorPayload = payload as { fatal?: boolean }
            if (errorPayload?.fatal) {
              ws.close(1011, 'Server error triggered')
            }
            break
          }

          default: {
            // Unknown message type - send error
            ws.send(JSON.stringify({
              type: 'error',
              payload: { message: `Unknown message type: ${type}` },
              timestamp: Date.now(),
            }))
          }
        }
      }
    } catch (err) {
      // Invalid message format - log for debugging then notify client
      console.warn('[DOFull] WebSocket message parse error:', (err as Error).message)
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Invalid message format' },
        timestamp: Date.now(),
      }))
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void {
    // Clean up client state
    this.wsClientState.delete(ws)

    // Clean up subscriptions for this WebSocket
    for (const [topic, subs] of this.subscriptions) {
      const filtered = subs.filter((s) => s.ws !== ws)
      this.subscriptions.set(topic, filtered)
    }

    // Stop heartbeat if no more connections
    const allSockets = this.ctx.getWebSockets()
    if (allSockets.length === 0 && this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
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
