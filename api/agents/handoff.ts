/**
 * Agent Handoff Protocol
 *
 * Provides a unified protocol for agent-to-agent handoffs with:
 * - **Handoff Message Format**: Structured messages for handoff initiation, acknowledgment, and completion
 * - **Context Transfer**: Complete state and context preservation during handoffs
 * - **State Preservation**: Ensures no data loss during agent transitions
 * - **Acknowledgment Protocol**: Bidirectional confirmation of handoff receipt and acceptance
 *
 * Consolidates handoff patterns from:
 * - OpenAI Agents SDK (explicit handoffs)
 * - Claude SDK (subagent spawning)
 * - Mastra (workflow handoffs)
 *
 * ## Message Flow
 * ```
 * Source Agent                    Target Agent
 *      |                               |
 *      |------ HandoffMessage -------->|  (initiate)
 *      |<----- HandoffAck -------------|  (acknowledge receipt)
 *      |                               |  (target processes)
 *      |<----- HandoffComplete --------|  (completion notification)
 * ```
 *
 * @module agents/handoff
 */

import type {
  Agent,
  AgentConfig,
  AgentProvider,
  AgentResult,
  Message,
  ToolCall,
  ToolResult,
} from './types'
import type { GraphMessageBus } from './communication'

// ============================================================================
// Handoff Types
// ============================================================================

/**
 * Reason for initiating a handoff
 */
export type HandoffReason =
  | 'specialization' // Target agent has better capabilities
  | 'escalation' // Issue requires higher authority
  | 'delegation' // Parallel task delegation
  | 'completion' // Current agent completed its part
  | 'routing' // Initial routing decision
  | 'error' // Current agent cannot proceed
  | 'custom' // Custom reason with description

/**
 * State of a handoff in progress
 */
export type HandoffState =
  | 'pending' // Handoff initiated but not started
  | 'transferring' // Context being transferred
  | 'acknowledged' // Target agent acknowledged receipt
  | 'active' // Target agent is executing
  | 'completed' // Handoff completed successfully
  | 'failed' // Handoff failed
  | 'cancelled' // Handoff was cancelled
  | 'rejected' // Target agent rejected the handoff

// ============================================================================
// Handoff Message Format (Protocol Messages)
// ============================================================================

/**
 * Message type for handoff protocol communication
 */
export type HandoffMessageType =
  | 'handoff:initiate' // Source -> Target: Request handoff
  | 'handoff:ack' // Target -> Source: Acknowledge receipt
  | 'handoff:accept' // Target -> Source: Accept handoff
  | 'handoff:reject' // Target -> Source: Reject handoff
  | 'handoff:progress' // Target -> Source: Progress update
  | 'handoff:complete' // Target -> Source: Completion notification
  | 'handoff:error' // Either -> Either: Error notification

/**
 * Base structure for all handoff protocol messages
 */
export interface HandoffMessageBase {
  /** Message type identifier */
  type: HandoffMessageType
  /** Unique handoff identifier this message belongs to */
  handoffId: string
  /** Sender agent ID */
  senderId: string
  /** Recipient agent ID */
  recipientId: string
  /** Message timestamp */
  timestamp: Date
  /** Correlation ID for request-response tracking */
  correlationId?: string
  /** Sequence number for ordering */
  sequence?: number
}

/**
 * Handoff initiation message (Source -> Target)
 */
export interface HandoffInitiateMessage extends HandoffMessageBase {
  type: 'handoff:initiate'
  /** Why this handoff is being made */
  reason: HandoffReason
  /** Human-readable description */
  reasonDescription?: string
  /** Full context to transfer */
  context: HandoffContext
  /** Priority level (lower = higher priority) */
  priority?: number
  /** Timeout in milliseconds */
  timeoutMs?: number
  /** Whether target must acknowledge before proceeding */
  requireAck?: boolean
}

/**
 * Handoff acknowledgment message (Target -> Source)
 * Confirms that target received and understood the handoff request
 */
export interface HandoffAckMessage extends HandoffMessageBase {
  type: 'handoff:ack'
  /** Estimated time to process in milliseconds */
  estimatedProcessingMs?: number
  /** Whether the target agent is ready to accept */
  ready: boolean
  /** Optional message from target */
  message?: string
}

/**
 * Handoff acceptance message (Target -> Source)
 * Confirms that target has accepted and will process the handoff
 */
export interface HandoffAcceptMessage extends HandoffMessageBase {
  type: 'handoff:accept'
  /** Optional message from target */
  message?: string
  /** Accepted at timestamp (may differ from message timestamp) */
  acceptedAt: Date
}

/**
 * Handoff rejection message (Target -> Source)
 * Indicates target cannot or will not handle the handoff
 */
export interface HandoffRejectMessage extends HandoffMessageBase {
  type: 'handoff:reject'
  /** Reason for rejection */
  rejectionReason: string
  /** Rejection code for programmatic handling */
  rejectionCode?: 'busy' | 'unauthorized' | 'unsupported' | 'timeout' | 'error' | 'custom'
  /** Suggested alternative agent ID if available */
  suggestAlternative?: string
}

/**
 * Handoff progress message (Target -> Source)
 * Provides progress updates during long-running handoffs
 */
export interface HandoffProgressMessage extends HandoffMessageBase {
  type: 'handoff:progress'
  /** Progress percentage (0-100) */
  progress?: number
  /** Current step description */
  currentStep?: string
  /** Estimated remaining time in milliseconds */
  estimatedRemainingMs?: number
  /** Partial results if available */
  partialResults?: unknown
}

/**
 * Handoff completion message (Target -> Source)
 * Confirms successful completion with results
 */
export interface HandoffCompleteMessage extends HandoffMessageBase {
  type: 'handoff:complete'
  /** Final result from target agent */
  result: AgentResult
  /** Duration of processing in milliseconds */
  durationMs: number
  /** Completion summary */
  summary?: string
  /** Any follow-up actions needed */
  followUp?: {
    /** Whether another handoff is needed */
    needsHandoff?: boolean
    /** Suggested next agent */
    suggestedAgent?: string
    /** Instructions for next steps */
    instructions?: string
  }
}

/**
 * Handoff error message (Either -> Either)
 * Reports errors during handoff processing
 */
export interface HandoffErrorMessage extends HandoffMessageBase {
  type: 'handoff:error'
  /** Error message */
  error: string
  /** Error code for programmatic handling */
  errorCode?: string
  /** Stack trace if available */
  stack?: string
  /** Whether the handoff can be retried */
  retryable: boolean
  /** Suggested retry delay in milliseconds */
  retryAfterMs?: number
}

/**
 * Union type for all handoff messages
 */
export type HandoffMessage =
  | HandoffInitiateMessage
  | HandoffAckMessage
  | HandoffAcceptMessage
  | HandoffRejectMessage
  | HandoffProgressMessage
  | HandoffCompleteMessage
  | HandoffErrorMessage

// ============================================================================
// State Preservation Types
// ============================================================================

/**
 * Preserved state during handoff
 * Ensures no data loss during agent transitions
 */
export interface PreservedState {
  /** Snapshot of agent's internal state */
  agentState?: Record<string, unknown>
  /** Active conversation/session ID */
  sessionId?: string
  /** User/customer context */
  userContext?: {
    userId?: string
    userProfile?: Record<string, unknown>
    preferences?: Record<string, unknown>
  }
  /** Workflow state if part of a workflow */
  workflowState?: {
    workflowId?: string
    currentStep?: string
    stepHistory?: string[]
    variables?: Record<string, unknown>
  }
  /** Any pending operations */
  pendingOperations?: Array<{
    type: string
    data: unknown
    createdAt: Date
  }>
  /** Checksum for state validation */
  checksum?: string
}

// ============================================================================
// Context Types (Enhanced)
// ============================================================================

/**
 * Context transferred during a handoff
 */
export interface HandoffContext {
  /** Conversation messages to transfer */
  messages: Message[]
  /** Tool calls made by source agent */
  toolCalls?: ToolCall[]
  /** Tool results from source agent */
  toolResults?: ToolResult[]
  /** Arbitrary metadata to preserve across handoffs */
  metadata?: Record<string, unknown>
  /** Summary of work done by source agent */
  summary?: string
  /** Specific instructions for target agent */
  instructions?: string
  /** Variables/state to pass along */
  variables?: Record<string, unknown>
  /** Preserved state for seamless transition */
  preservedState?: PreservedState
  /** Conversation/task ID for tracking */
  conversationId?: string
  /** Files or attachments to transfer */
  attachments?: Array<{
    id: string
    name: string
    mimeType: string
    url?: string
    data?: string
  }>
}

/**
 * Full handoff request with all details
 */
export interface HandoffRequest {
  /** Unique identifier for this handoff */
  id: string
  /** Source agent initiating the handoff */
  sourceAgentId: string
  /** Target agent to receive the handoff */
  targetAgentId: string
  /** Why this handoff is being made */
  reason: HandoffReason
  /** Human-readable description of the handoff reason */
  reasonDescription?: string
  /** Context to transfer to target agent */
  context: HandoffContext
  /** When the handoff was initiated */
  initiatedAt: Date
  /** Priority level (lower = higher priority) */
  priority?: number
  /** Maximum time allowed for the handoff */
  timeoutMs?: number
}

/**
 * Result of a completed handoff
 */
export interface HandoffResult {
  /** The handoff request that was executed */
  request: HandoffRequest
  /** Current state of the handoff */
  state: HandoffState
  /** Result from target agent (if successful) */
  result?: AgentResult
  /** Error if handoff failed */
  error?: Error
  /** When the handoff completed */
  completedAt?: Date
  /** Duration of the handoff in milliseconds */
  durationMs?: number
  /** Next handoff if target agent initiated one */
  chainedHandoff?: HandoffResult

  // Acknowledgment Protocol Fields
  /** Acknowledgment received from target */
  acknowledgment?: HandoffAckMessage
  /** Acceptance message from target */
  acceptance?: HandoffAcceptMessage
  /** Rejection message if handoff was rejected */
  rejection?: HandoffRejectMessage
  /** Protocol messages exchanged during handoff */
  protocolMessages?: HandoffMessage[]
}

/**
 * Entry in the handoff chain
 */
export interface HandoffChainEntry {
  /** Agent ID */
  agentId: string
  /** When this agent started processing */
  startedAt: Date
  /** When this agent completed */
  completedAt?: Date
  /** Summary of what this agent did */
  summary?: string
  /** Reason for passing to next agent */
  handoffReason?: HandoffReason
}

// ============================================================================
// Handoff Hooks
// ============================================================================

/**
 * Hooks for customizing handoff behavior
 */
export interface HandoffHooks {
  /** Called before handoff is initiated */
  onBeforeHandoff?: (request: HandoffRequest) => Promise<HandoffRequest | null>
  /** Called when context is being transferred */
  onContextTransfer?: (context: HandoffContext) => Promise<HandoffContext>
  /** Called when target agent starts processing */
  onHandoffStart?: (request: HandoffRequest) => Promise<void>
  /** Called when handoff completes */
  onHandoffComplete?: (result: HandoffResult) => Promise<void>
  /** Called when handoff fails */
  onHandoffError?: (request: HandoffRequest, error: Error) => Promise<void>
  /** Called to validate if handoff is allowed */
  validateHandoff?: (request: HandoffRequest) => Promise<boolean>

  // Acknowledgment Protocol Hooks
  /** Called when acknowledgment is received from target */
  onAckReceived?: (ack: HandoffAckMessage) => Promise<void>
  /** Called when handoff is accepted by target */
  onAccepted?: (accept: HandoffAcceptMessage) => Promise<void>
  /** Called when handoff is rejected by target */
  onRejected?: (reject: HandoffRejectMessage) => Promise<void>
  /** Called when progress update is received */
  onProgress?: (progress: HandoffProgressMessage) => Promise<void>
  /** Called when protocol message is sent */
  onMessageSent?: (message: HandoffMessage) => Promise<void>
  /** Called when protocol message is received */
  onMessageReceived?: (message: HandoffMessage) => Promise<void>
}

// ============================================================================
// Handoff Protocol Implementation
// ============================================================================

/**
 * Configuration for the handoff protocol
 */
export interface HandoffProtocolConfig {
  /** Provider to use for creating target agents */
  provider: AgentProvider
  /** Available agents that can be handed off to */
  agents: AgentConfig[]
  /** Hooks for customizing behavior */
  hooks?: HandoffHooks
  /** Default timeout for handoffs */
  defaultTimeoutMs?: number
  /** Maximum chain depth to prevent infinite loops */
  maxChainDepth?: number
  /** Whether to include full message history in context */
  includeFullHistory?: boolean

  // Acknowledgment Protocol Options
  /** Whether to require acknowledgment before proceeding (default: true) */
  requireAcknowledgment?: boolean
  /** Timeout for waiting on acknowledgment in ms (default: 5000) */
  ackTimeoutMs?: number
  /** Whether to preserve state during handoffs (default: true) */
  preserveState?: boolean
  /** Whether to emit protocol messages via hooks (default: true) */
  emitProtocolMessages?: boolean

  // Message Bus Integration
  /** Optional message bus for tracking handoffs in graph storage */
  messageBus?: GraphMessageBus
}

/**
 * HandoffProtocol - Manages agent-to-agent handoffs
 *
 * Provides a structured way to:
 * - Transfer context between agents
 * - Track handoff chains
 * - Hook into handoff lifecycle
 * - Prevent circular handoffs
 *
 * @example
 * ```ts
 * const protocol = new HandoffProtocol({
 *   provider: createOpenAIProvider(),
 *   agents: [supportAgent, salesAgent, techAgent],
 *   hooks: {
 *     onHandoffComplete: async (result) => {
 *       console.log(`Handoff to ${result.request.targetAgentId} completed`)
 *     },
 *   },
 * })
 *
 * const result = await protocol.handoff({
 *   sourceAgentId: 'router',
 *   targetAgentId: 'support',
 *   reason: 'routing',
 *   context: {
 *     messages: conversationHistory,
 *     summary: 'Customer asking about billing',
 *   },
 * })
 * ```
 */
export class HandoffProtocol {
  private config: HandoffProtocolConfig
  private agentMap: Map<string, AgentConfig>
  private activeHandoffs: Map<string, HandoffRequest>
  private handoffChains: Map<string, HandoffChainEntry[]>

  constructor(config: HandoffProtocolConfig) {
    this.config = {
      defaultTimeoutMs: 60000,
      maxChainDepth: 10,
      includeFullHistory: true,
      ...config,
    }
    this.agentMap = new Map(config.agents.map((a) => [a.id, a]))
    this.activeHandoffs = new Map()
    this.handoffChains = new Map()
  }

  /**
   * Initiate a handoff to another agent
   */
  async handoff(
    request: Omit<HandoffRequest, 'id' | 'initiatedAt'>
  ): Promise<HandoffResult> {
    // Generate unique ID
    const handoffId = `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const fullRequest: HandoffRequest = {
      ...request,
      id: handoffId,
      initiatedAt: new Date(),
      timeoutMs: request.timeoutMs ?? this.config.defaultTimeoutMs,
    }

    // Check chain depth
    const chainId = this.getChainId(fullRequest)
    const chain = this.handoffChains.get(chainId) ?? []
    if (chain.length >= (this.config.maxChainDepth ?? 10)) {
      return {
        request: fullRequest,
        state: 'failed',
        error: new Error(`Maximum handoff chain depth (${this.config.maxChainDepth}) exceeded`),
        completedAt: new Date(),
      }
    }

    // Check for circular handoffs
    if (chain.some((entry) => entry.agentId === fullRequest.targetAgentId)) {
      return {
        request: fullRequest,
        state: 'failed',
        error: new Error(`Circular handoff detected: ${fullRequest.targetAgentId} already in chain`),
        completedAt: new Date(),
      }
    }

    // Validate handoff is allowed
    if (this.config.hooks?.validateHandoff) {
      const allowed = await this.config.hooks.validateHandoff(fullRequest)
      if (!allowed) {
        return {
          request: fullRequest,
          state: 'cancelled',
          error: new Error('Handoff rejected by validation hook'),
          completedAt: new Date(),
        }
      }
    }

    // Call before hook (can modify or cancel)
    if (this.config.hooks?.onBeforeHandoff) {
      const modifiedRequest = await this.config.hooks.onBeforeHandoff(fullRequest)
      if (!modifiedRequest) {
        return {
          request: fullRequest,
          state: 'cancelled',
          completedAt: new Date(),
        }
      }
      Object.assign(fullRequest, modifiedRequest)
    }

    // Get target agent config
    const targetConfig = this.agentMap.get(fullRequest.targetAgentId)
    if (!targetConfig) {
      return {
        request: fullRequest,
        state: 'failed',
        error: new Error(`Target agent not found: ${fullRequest.targetAgentId}`),
        completedAt: new Date(),
      }
    }

    // Track active handoff
    this.activeHandoffs.set(handoffId, fullRequest)

    // Add to chain
    chain.push({
      agentId: fullRequest.sourceAgentId,
      startedAt: new Date(),
      handoffReason: fullRequest.reason,
    })
    this.handoffChains.set(chainId, chain)

    // Send handoff message through message bus if configured
    if (this.config.messageBus) {
      const conversationId = fullRequest.context.metadata?.conversationId as string | undefined
      await this.config.messageBus.send({
        id: `handoff-msg-${handoffId}`,
        sender: fullRequest.sourceAgentId,
        recipient: fullRequest.targetAgentId,
        type: 'handoff',
        payload: {
          reason: fullRequest.reason,
          reasonDescription: fullRequest.reasonDescription,
        },
        timestamp: new Date(),
        metadata: {
          handoffId,
          conversationId,
          ...fullRequest.context.metadata,
        },
      })
    }

    try {
      // Transform context through hook if provided
      let context = fullRequest.context
      if (this.config.hooks?.onContextTransfer) {
        context = await this.config.hooks.onContextTransfer(context)
      }

      // Call start hook
      await this.config.hooks?.onHandoffStart?.(fullRequest)

      // Create target agent
      const targetAgent = this.config.provider.createAgent({
        ...targetConfig,
        instructions: this.buildHandoffInstructions(targetConfig, fullRequest, context),
      })

      // Build messages for target agent
      const messages = this.buildHandoffMessages(fullRequest, context)

      // Execute with timeout
      const startTime = Date.now()
      const result = await this.executeWithTimeout(
        targetAgent.run({ messages }),
        fullRequest.timeoutMs ?? this.config.defaultTimeoutMs ?? 60000
      )
      const durationMs = Date.now() - startTime

      // Update chain
      const chainEntry = chain[chain.length - 1]
      chainEntry.completedAt = new Date()
      chainEntry.summary = result.text?.slice(0, 200)

      const handoffResult: HandoffResult = {
        request: fullRequest,
        state: 'completed',
        result,
        completedAt: new Date(),
        durationMs,
      }

      // Call complete hook
      await this.config.hooks?.onHandoffComplete?.(handoffResult)

      return handoffResult
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      // Call error hook
      await this.config.hooks?.onHandoffError?.(fullRequest, err)

      return {
        request: fullRequest,
        state: 'failed',
        error: err,
        completedAt: new Date(),
      }
    } finally {
      // Clean up
      this.activeHandoffs.delete(handoffId)
    }
  }

  /**
   * Get the current handoff chain for a conversation
   */
  getChain(conversationId: string): HandoffChainEntry[] {
    return this.handoffChains.get(conversationId) ?? []
  }

  /**
   * Clear handoff chain for a conversation
   */
  clearChain(conversationId: string): void {
    this.handoffChains.delete(conversationId)
  }

  /**
   * Get available agents for handoff
   */
  getAvailableAgents(): AgentConfig[] {
    return Array.from(this.agentMap.values())
  }

  /**
   * Check if an agent is available for handoff
   */
  isAgentAvailable(agentId: string): boolean {
    return this.agentMap.has(agentId)
  }

  /**
   * Add an agent to the available pool
   */
  addAgent(config: AgentConfig): void {
    this.agentMap.set(config.id, config)
  }

  /**
   * Remove an agent from the available pool
   */
  removeAgent(agentId: string): void {
    this.agentMap.delete(agentId)
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private getChainId(request: HandoffRequest): string {
    // Use first message content hash as conversation ID, or generate one
    const firstMessage = request.context.messages[0]
    if (firstMessage?.content) {
      const content = typeof firstMessage.content === 'string'
        ? firstMessage.content
        : JSON.stringify(firstMessage.content)
      return `chain-${this.hashCode(content)}`
    }
    return `chain-${request.id}`
  }

  private hashCode(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36)
  }

  private buildHandoffInstructions(
    targetConfig: AgentConfig,
    request: HandoffRequest,
    context: HandoffContext
  ): string {
    const parts: string[] = []

    // Start with original instructions
    if (targetConfig.instructions) {
      parts.push(targetConfig.instructions)
    }

    // Add handoff context
    parts.push('\n\n## Handoff Context')
    parts.push(`You are receiving a handoff from agent "${request.sourceAgentId}".`)
    parts.push(`Reason: ${request.reasonDescription ?? request.reason}`)

    // Add summary if provided
    if (context.summary) {
      parts.push(`\nPrevious agent summary: ${context.summary}`)
    }

    // Add specific instructions if provided
    if (context.instructions) {
      parts.push(`\nSpecific instructions: ${context.instructions}`)
    }

    // Add variables if provided
    if (context.variables && Object.keys(context.variables).length > 0) {
      parts.push(`\nContext variables: ${JSON.stringify(context.variables, null, 2)}`)
    }

    return parts.join('\n')
  }

  private buildHandoffMessages(
    request: HandoffRequest,
    context: HandoffContext
  ): Message[] {
    const messages: Message[] = []

    // Include conversation history
    if (this.config.includeFullHistory) {
      messages.push(...context.messages)
    } else {
      // Only include recent messages
      const recentMessages = context.messages.slice(-10)
      messages.push(...recentMessages)
    }

    // Add handoff notification as system message
    messages.push({
      role: 'system',
      content: `[Handoff from ${request.sourceAgentId}] ${request.reasonDescription ?? `Reason: ${request.reason}`}`,
    })

    return messages
  }

  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Handoff timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ])
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a handoff protocol instance
 */
export function createHandoffProtocol(config: HandoffProtocolConfig): HandoffProtocol {
  return new HandoffProtocol(config)
}

/**
 * Create a simple handoff request
 */
export function createHandoffRequest(
  sourceAgentId: string,
  targetAgentId: string,
  context: HandoffContext,
  reason: HandoffReason = 'delegation',
  reasonDescription?: string
): Omit<HandoffRequest, 'id' | 'initiatedAt'> {
  return {
    sourceAgentId,
    targetAgentId,
    reason,
    reasonDescription,
    context,
  }
}

/**
 * Create handoff context from an agent result
 */
export function createHandoffContext(
  result: AgentResult,
  options: {
    summary?: string
    instructions?: string
    variables?: Record<string, unknown>
    metadata?: Record<string, unknown>
  } = {}
): HandoffContext {
  return {
    messages: result.messages,
    toolCalls: result.toolCalls,
    toolResults: result.toolResults,
    summary: options.summary,
    instructions: options.instructions,
    variables: options.variables,
    metadata: options.metadata,
  }
}

// ============================================================================
// Handoff Tool Factory
// ============================================================================

import { tool } from './Tool'
import { z } from 'zod'

/**
 * Create a typed handoff tool for an agent
 *
 * This creates a tool that agents can use to initiate handoffs.
 * When the tool is called, it triggers the handoff protocol.
 */
export function createProtocolHandoffTool(
  protocol: HandoffProtocol,
  sourceAgentId: string
) {
  const availableAgents = protocol.getAvailableAgents()

  if (availableAgents.length === 0) {
    throw new Error('No agents available for handoff')
  }

  const agentIds = availableAgents.map((a) => a.id) as [string, ...string[]]
  const agentDescriptions = availableAgents
    .map((a) => `- ${a.id}: ${a.name} - ${a.instructions?.slice(0, 100)}...`)
    .join('\n')

  return tool({
    name: 'handoff_to_agent',
    description: `Transfer the conversation to another specialized agent.\n\nAvailable agents:\n${agentDescriptions}`,
    inputSchema: z.object({
      targetAgentId: z.enum(agentIds).describe('The agent to hand off to'),
      reason: z
        .enum(['specialization', 'escalation', 'delegation', 'completion', 'routing', 'error', 'custom'])
        .describe('Why this handoff is needed'),
      reasonDescription: z.string().optional().describe('Detailed explanation for the handoff'),
      summary: z.string().optional().describe('Summary of work done so far'),
      instructions: z.string().optional().describe('Specific instructions for the target agent'),
    }),
    execute: async (input, context) => {
      // Get the conversation context from the tool context metadata
      const messages = (context.metadata?.messages as Message[]) ?? []

      const result = await protocol.handoff({
        sourceAgentId,
        targetAgentId: input.targetAgentId,
        reason: input.reason,
        reasonDescription: input.reasonDescription,
        context: {
          messages,
          summary: input.summary,
          instructions: input.instructions,
        },
      })

      if (result.state === 'completed' && result.result) {
        return {
          success: true,
          agentId: input.targetAgentId,
          response: result.result.text,
        }
      }

      return {
        success: false,
        error: result.error?.message ?? 'Handoff failed',
      }
    },
  })
}

// ============================================================================
// Message Factory Functions (Acknowledgment Protocol)
// ============================================================================

/**
 * Generate a unique handoff ID
 */
export function generateHandoffId(): string {
  return `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Generate a correlation ID for request-response tracking
 */
export function generateCorrelationId(): string {
  return `corr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Create a handoff initiation message
 */
export function createInitiateMessage(
  handoffId: string,
  sourceAgentId: string,
  targetAgentId: string,
  reason: HandoffReason,
  context: HandoffContext,
  options: {
    reasonDescription?: string
    priority?: number
    timeoutMs?: number
    requireAck?: boolean
    correlationId?: string
  } = {}
): HandoffInitiateMessage {
  return {
    type: 'handoff:initiate',
    handoffId,
    senderId: sourceAgentId,
    recipientId: targetAgentId,
    timestamp: new Date(),
    correlationId: options.correlationId ?? generateCorrelationId(),
    reason,
    reasonDescription: options.reasonDescription,
    context,
    priority: options.priority,
    timeoutMs: options.timeoutMs,
    requireAck: options.requireAck ?? true,
  }
}

/**
 * Create an acknowledgment message (Target -> Source)
 */
export function createAckMessage(
  initiateMessage: HandoffInitiateMessage,
  ready: boolean,
  options: {
    estimatedProcessingMs?: number
    message?: string
  } = {}
): HandoffAckMessage {
  return {
    type: 'handoff:ack',
    handoffId: initiateMessage.handoffId,
    senderId: initiateMessage.recipientId,
    recipientId: initiateMessage.senderId,
    timestamp: new Date(),
    correlationId: initiateMessage.correlationId,
    ready,
    estimatedProcessingMs: options.estimatedProcessingMs,
    message: options.message,
  }
}

/**
 * Create an acceptance message (Target -> Source)
 */
export function createAcceptMessage(
  initiateMessage: HandoffInitiateMessage,
  message?: string
): HandoffAcceptMessage {
  return {
    type: 'handoff:accept',
    handoffId: initiateMessage.handoffId,
    senderId: initiateMessage.recipientId,
    recipientId: initiateMessage.senderId,
    timestamp: new Date(),
    correlationId: initiateMessage.correlationId,
    acceptedAt: new Date(),
    message,
  }
}

/**
 * Create a rejection message (Target -> Source)
 */
export function createRejectMessage(
  initiateMessage: HandoffInitiateMessage,
  rejectionReason: string,
  options: {
    rejectionCode?: 'busy' | 'unauthorized' | 'unsupported' | 'timeout' | 'error' | 'custom'
    suggestAlternative?: string
  } = {}
): HandoffRejectMessage {
  return {
    type: 'handoff:reject',
    handoffId: initiateMessage.handoffId,
    senderId: initiateMessage.recipientId,
    recipientId: initiateMessage.senderId,
    timestamp: new Date(),
    correlationId: initiateMessage.correlationId,
    rejectionReason,
    rejectionCode: options.rejectionCode,
    suggestAlternative: options.suggestAlternative,
  }
}

/**
 * Create a progress message (Target -> Source)
 */
export function createProgressMessage(
  handoffId: string,
  sourceAgentId: string,
  targetAgentId: string,
  options: {
    progress?: number
    currentStep?: string
    estimatedRemainingMs?: number
    partialResults?: unknown
    correlationId?: string
  } = {}
): HandoffProgressMessage {
  return {
    type: 'handoff:progress',
    handoffId,
    senderId: targetAgentId,
    recipientId: sourceAgentId,
    timestamp: new Date(),
    correlationId: options.correlationId,
    progress: options.progress,
    currentStep: options.currentStep,
    estimatedRemainingMs: options.estimatedRemainingMs,
    partialResults: options.partialResults,
  }
}

/**
 * Create a completion message (Target -> Source)
 */
export function createCompleteMessage(
  initiateMessage: HandoffInitiateMessage,
  result: AgentResult,
  durationMs: number,
  options: {
    summary?: string
    followUp?: {
      needsHandoff?: boolean
      suggestedAgent?: string
      instructions?: string
    }
  } = {}
): HandoffCompleteMessage {
  return {
    type: 'handoff:complete',
    handoffId: initiateMessage.handoffId,
    senderId: initiateMessage.recipientId,
    recipientId: initiateMessage.senderId,
    timestamp: new Date(),
    correlationId: initiateMessage.correlationId,
    result,
    durationMs,
    summary: options.summary,
    followUp: options.followUp,
  }
}

/**
 * Create an error message (Either -> Either)
 */
export function createErrorMessage(
  handoffId: string,
  senderId: string,
  recipientId: string,
  error: string | Error,
  options: {
    errorCode?: string
    retryable?: boolean
    retryAfterMs?: number
    correlationId?: string
  } = {}
): HandoffErrorMessage {
  const err = error instanceof Error ? error : new Error(error)
  return {
    type: 'handoff:error',
    handoffId,
    senderId,
    recipientId,
    timestamp: new Date(),
    correlationId: options.correlationId,
    error: err.message,
    errorCode: options.errorCode,
    stack: err.stack,
    retryable: options.retryable ?? false,
    retryAfterMs: options.retryAfterMs,
  }
}

// ============================================================================
// State Preservation Utilities
// ============================================================================

/**
 * Create a checksum for state validation
 */
function createStateChecksum(state: Record<string, unknown>): string {
  const str = JSON.stringify(state)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

/**
 * Create a preserved state snapshot
 */
export function createPreservedState(
  options: {
    agentState?: Record<string, unknown>
    sessionId?: string
    userContext?: PreservedState['userContext']
    workflowState?: PreservedState['workflowState']
    pendingOperations?: PreservedState['pendingOperations']
  } = {}
): PreservedState {
  const state: PreservedState = {
    agentState: options.agentState,
    sessionId: options.sessionId,
    userContext: options.userContext,
    workflowState: options.workflowState,
    pendingOperations: options.pendingOperations,
  }

  // Calculate checksum for validation
  state.checksum = createStateChecksum({
    agentState: state.agentState,
    sessionId: state.sessionId,
    userContext: state.userContext,
    workflowState: state.workflowState,
  })

  return state
}

/**
 * Validate preserved state using checksum
 */
export function validatePreservedState(state: PreservedState): boolean {
  if (!state.checksum) return true // No checksum to validate

  const expectedChecksum = createStateChecksum({
    agentState: state.agentState,
    sessionId: state.sessionId,
    userContext: state.userContext,
    workflowState: state.workflowState,
  })

  return state.checksum === expectedChecksum
}

/**
 * Merge preserved states (for chained handoffs)
 */
export function mergePreservedStates(
  current: PreservedState,
  incoming: PreservedState
): PreservedState {
  const merged: PreservedState = {
    agentState: { ...current.agentState, ...incoming.agentState },
    sessionId: incoming.sessionId ?? current.sessionId,
    userContext: {
      ...current.userContext,
      ...incoming.userContext,
    },
    workflowState: incoming.workflowState ?? current.workflowState,
    pendingOperations: [
      ...(current.pendingOperations ?? []),
      ...(incoming.pendingOperations ?? []),
    ],
  }

  merged.checksum = createStateChecksum({
    agentState: merged.agentState,
    sessionId: merged.sessionId,
    userContext: merged.userContext,
    workflowState: merged.workflowState,
  })

  return merged
}

// ============================================================================
// Context Transfer Utilities
// ============================================================================

/**
 * Create a complete handoff context from an agent result with state preservation
 */
export function createCompleteHandoffContext(
  result: AgentResult,
  options: {
    summary?: string
    instructions?: string
    variables?: Record<string, unknown>
    metadata?: Record<string, unknown>
    preservedState?: PreservedState
    conversationId?: string
    attachments?: HandoffContext['attachments']
  } = {}
): HandoffContext {
  return {
    messages: result.messages,
    toolCalls: result.toolCalls,
    toolResults: result.toolResults,
    summary: options.summary,
    instructions: options.instructions,
    variables: options.variables,
    metadata: options.metadata,
    preservedState: options.preservedState,
    conversationId: options.conversationId,
    attachments: options.attachments,
  }
}

/**
 * Extract preserved state from handoff context
 */
export function extractPreservedState(context: HandoffContext): PreservedState | undefined {
  return context.preservedState
}

/**
 * Serialize context for transport (e.g., over network)
 */
export function serializeContext(context: HandoffContext): string {
  return JSON.stringify(context, (key, value) => {
    if (value instanceof Date) {
      return { __type: 'Date', value: value.toISOString() }
    }
    return value
  })
}

/**
 * Deserialize context from transport
 */
export function deserializeContext(serialized: string): HandoffContext {
  return JSON.parse(serialized, (key, value) => {
    if (value && typeof value === 'object' && value.__type === 'Date') {
      return new Date(value.value)
    }
    return value
  })
}

export default HandoffProtocol
