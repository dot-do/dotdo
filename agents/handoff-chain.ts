/**
 * Handoff Chain Tracking as Graph Relationships
 *
 * Tracks agent-to-agent handoffs using the graph store's Relationship model.
 * Each handoff is modeled as a `handedOffTo` relationship with context and metadata.
 *
 * Key Features:
 * 1. handedOffTo relationships with full context preservation
 * 2. Chain traversal via graph queries
 * 3. Circular handoff prevention
 * 4. Handoff analytics (by reason, agent participation, common pairs)
 * 5. Integration with HandoffProtocol via hooks
 *
 * @see dotdo-5tdt3 - [GREEN] Handoff Chain Tracking - Implementation
 * @see dotdo-jdofw - [RED] Handoff Chain Tracking - Tests
 * @see dotdo-ucolo - Agents as Graph Things (parent epic)
 *
 * @module agents/handoff-chain
 */

import type { GraphStore, GraphRelationship } from '../db/graph/types'
import type { HandoffHooks, HandoffRequest, HandoffResult } from './handoff'

// ============================================================================
// Constants
// ============================================================================

/**
 * The verb used for handoff relationships in the graph
 */
export const HANDED_OFF_TO = 'handedOffTo'

// ============================================================================
// Types
// ============================================================================

/**
 * Handoff reason types - why the handoff occurred
 */
export type HandoffReason =
  | 'specialization' // Target agent has better capabilities for the task
  | 'escalation' // Issue requires higher authority or expertise
  | 'delegation' // Parallel task delegation
  | 'completion' // Current agent completed its part, passing along
  | 'routing' // Initial routing decision by router agent
  | 'error' // Current agent cannot proceed
  | 'custom' // Custom reason with description

/**
 * Context data transferred during a handoff
 */
export interface HandoffContext {
  /** Summary of work done by source agent */
  summary?: string
  /** Specific instructions for target agent */
  instructions?: string
  /** Variables/state to pass along */
  variables?: Record<string, unknown>
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>
  /** Conversation history as messages */
  messages?: Array<{ role: string; content: string }>
}

/**
 * Input for creating a handoff relationship
 */
export interface CreateHandoffRelationshipInput {
  /** Source agent $id (the agent handing off) */
  from: string
  /** Target agent $id (the agent receiving) */
  to: string
  /** Reason for the handoff */
  reason: HandoffReason
  /** Human-readable reason description */
  reasonDescription?: string
  /** Context to transfer */
  context?: HandoffContext
  /** Conversation/task ID this handoff belongs to */
  conversationId?: string
}

/**
 * Handoff relationship as stored in the graph
 */
export interface HandoffRelationship extends GraphRelationship {
  verb: 'handedOffTo'
  data: {
    reason: HandoffReason
    reasonDescription?: string
    context?: HandoffContext
    conversationId?: string
    timestamp: string
    durationMs?: number
  } | null
}

/**
 * Entry in a handoff chain
 */
export interface HandoffChainEntry {
  agentId: string
  agentName?: string
  handoffReason?: HandoffReason
  receivedAt: Date
  handedOffAt?: Date
  summary?: string
}

/**
 * Result of circular handoff detection
 */
export interface CircularHandoffCheckResult {
  isCircular: boolean
  existingChain: string[]
  wouldCreateCycle: boolean
}

/**
 * Analytics for handoff patterns
 */
export interface HandoffAnalytics {
  /** Total handoffs in the system */
  totalHandoffs: number
  /** Handoffs grouped by reason */
  byReason: Record<HandoffReason, number>
  /** Most common handoff pairs (from -> to) */
  topHandoffPairs: Array<{ from: string; to: string; count: number }>
  /** Agents ranked by handoff participation */
  agentParticipation: Array<{ agentId: string; asSource: number; asTarget: number }>
  /** Average chain length */
  averageChainLength?: number
}

/**
 * Options for getHandoffChain function
 */
export interface GetHandoffChainOptions {
  /** Maximum depth to traverse (default: 100) */
  maxDepth?: number
  /** Include deleted relationships */
  includeDeleted?: boolean
}

/**
 * Options for getHandoffAnalytics function
 */
export interface GetHandoffAnalyticsOptions {
  /** Filter by start date */
  from?: Date
  /** Filter by end date */
  to?: Date
  /** Filter by conversation ID */
  conversationId?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract agent ID from a URL that may include conversation context
 * e.g., "do://agents/agent:ralph/conv:123" -> "agent:ralph"
 */
export function extractAgentId(url: string): string {
  // Remove the "do://agents/" prefix and any trailing conversation ID
  const withoutPrefix = url.replace('do://agents/', '')
  // If there's a conversation suffix (starts with conv:), remove it
  // Format: "agent:ralph/conv:123" or just "agent:ralph"
  const slashIndex = withoutPrefix.indexOf('/')
  if (slashIndex === -1) {
    return withoutPrefix
  }
  return withoutPrefix.substring(0, slashIndex)
}

/**
 * Build a URL for an agent with optional conversation context
 */
function buildAgentUrl(agentId: string, conversationId?: string): string {
  if (conversationId) {
    return `do://agents/${agentId}/${conversationId}`
  }
  return `do://agents/${agentId}`
}

/**
 * Generate a unique handoff relationship ID
 */
function generateHandoffId(conversationId?: string): string {
  const uniquePart = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  if (conversationId) {
    return `handoff-${conversationId}-${uniquePart}`
  }
  return `handoff-${uniquePart}`
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Create a handoff relationship between two agents
 *
 * This is the primary function for recording agent-to-agent handoffs.
 * The relationship ID includes conversationId to allow multiple handoffs
 * between the same agent pair in different conversations.
 *
 * @param store - The GraphStore instance
 * @param input - Handoff details (from, to, reason, context, etc.)
 * @returns The created handoff relationship
 *
 * @example
 * ```typescript
 * const handoff = await createHandoffRelationship(store, {
 *   from: 'agent:ralph',
 *   to: 'agent:tom',
 *   reason: 'completion',
 *   context: { summary: 'Code implementation complete' },
 *   conversationId: 'conv:task-123'
 * })
 * ```
 */
export async function createHandoffRelationship(
  store: GraphStore,
  input: CreateHandoffRelationshipInput
): Promise<HandoffRelationship> {
  const id = generateHandoffId(input.conversationId)
  const timestamp = new Date().toISOString()

  // Include conversationId in the "from" URL to make relationships unique per conversation
  const fromUrl = buildAgentUrl(input.from, input.conversationId)
  const toUrl = buildAgentUrl(input.to, input.conversationId)

  const relationship = await store.createRelationship({
    id,
    verb: HANDED_OFF_TO,
    from: fromUrl,
    to: toUrl,
    data: {
      reason: input.reason,
      reasonDescription: input.reasonDescription,
      context: input.context,
      conversationId: input.conversationId,
      timestamp,
    },
  })

  return relationship as HandoffRelationship
}

/**
 * Get the complete handoff chain starting from a given agent
 *
 * Traverses the graph to find all handoffs in a chain, following
 * `handedOffTo` relationships from the starting agent.
 *
 * @param store - The GraphStore instance
 * @param startAgentId - The agent ID to start from
 * @param conversationId - Optional conversation ID to filter by
 * @param options - Optional traversal options (maxDepth, includeDeleted)
 * @returns Array of chain entries in traversal order
 *
 * @example
 * ```typescript
 * const chain = await getHandoffChain(store, 'agent:ralph', 'conv:123')
 * // Returns: [{ agentId: 'agent:ralph' }, { agentId: 'agent:tom' }, ...]
 * ```
 */
export async function getHandoffChain(
  store: GraphStore,
  startAgentId: string,
  conversationId?: string,
  options?: GetHandoffChainOptions
): Promise<HandoffChainEntry[]> {
  const maxDepth = options?.maxDepth ?? 100
  const chain: HandoffChainEntry[] = []
  const visited = new Set<string>()
  let currentAgentId = startAgentId
  let depth = 0

  // Add starting agent
  chain.push({
    agentId: currentAgentId,
    receivedAt: new Date(),
  })
  visited.add(currentAgentId)

  while (depth < maxDepth) {
    // Build URL with or without conversation context
    const queryUrl = buildAgentUrl(currentAgentId, conversationId)

    const relationships = await store.queryRelationshipsFrom(queryUrl, {
      verb: HANDED_OFF_TO,
    })

    // Filter by conversation if specified (for backwards compatibility)
    const filtered = conversationId
      ? relationships.filter((r) => (r.data as any)?.conversationId === conversationId)
      : relationships

    if (filtered.length === 0) break

    // Get the most recent handoff
    const sortedHandoffs = filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    const handoff = sortedHandoffs[0]!
    const nextAgentId = extractAgentId(handoff.to)

    if (visited.has(nextAgentId)) break
    visited.add(nextAgentId)

    // Update previous entry with handoff info
    chain[chain.length - 1]!.handedOffAt = handoff.createdAt
    chain[chain.length - 1]!.handoffReason = (handoff.data as any)?.reason

    // Add next agent
    chain.push({
      agentId: nextAgentId,
      receivedAt: handoff.createdAt,
      summary: (handoff.data as any)?.context?.summary,
    })

    currentAgentId = nextAgentId
    depth++
  }

  return chain
}

/**
 * Check if a proposed handoff would create a circular chain
 *
 * Traverses backwards from the source agent to find the existing chain,
 * then checks if the target agent is already in that chain.
 *
 * @param store - The GraphStore instance
 * @param fromAgentId - The agent initiating the handoff
 * @param toAgentId - The proposed target agent
 * @param conversationId - Optional conversation ID to filter by
 * @returns Result with isCircular flag and existing chain
 *
 * @example
 * ```typescript
 * const check = await checkCircularHandoff(store, 'agent:tom', 'agent:ralph', 'conv:123')
 * if (check.isCircular) {
 *   throw new Error('Circular handoff detected')
 * }
 * ```
 */
export async function checkCircularHandoff(
  store: GraphStore,
  fromAgentId: string,
  toAgentId: string,
  conversationId?: string
): Promise<CircularHandoffCheckResult> {
  // Self-handoff is always circular
  if (fromAgentId === toAgentId) {
    return {
      isCircular: true,
      existingChain: [fromAgentId],
      wouldCreateCycle: true,
    }
  }

  // Build the existing chain by traversing backwards from fromAgentId
  const backwardChain: string[] = []
  let currentId = fromAgentId
  const visitedBackward = new Set<string>()

  while (!visitedBackward.has(currentId)) {
    visitedBackward.add(currentId)
    backwardChain.unshift(currentId)

    // Build URL with or without conversation context
    const queryUrl = buildAgentUrl(currentId, conversationId)

    const incoming = await store.queryRelationshipsTo(queryUrl, {
      verb: HANDED_OFF_TO,
    })

    const filtered = conversationId
      ? incoming.filter((r) => (r.data as any)?.conversationId === conversationId)
      : incoming

    if (filtered.length === 0) break

    const sortedIncoming = filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    currentId = extractAgentId(sortedIncoming[0]!.from)
  }

  // Check if toAgentId is already in the chain
  const isCircular = backwardChain.includes(toAgentId)

  return {
    isCircular,
    existingChain: backwardChain,
    wouldCreateCycle: isCircular,
  }
}

/**
 * Get analytics about handoff patterns
 *
 * Analyzes all handoff relationships to provide insights about:
 * - Total handoffs
 * - Distribution by reason
 * - Most common handoff pairs
 * - Agent participation as source and target
 *
 * @param store - The GraphStore instance
 * @param options - Optional filters (date range, conversation ID)
 * @returns Analytics object with statistics
 *
 * @example
 * ```typescript
 * const analytics = await getHandoffAnalytics(store, {
 *   conversationId: 'conv:123'
 * })
 * console.log(`Total handoffs: ${analytics.totalHandoffs}`)
 * console.log(`Top pair: ${analytics.topHandoffPairs[0]?.from} -> ${analytics.topHandoffPairs[0]?.to}`)
 * ```
 */
export async function getHandoffAnalytics(
  store: GraphStore,
  options?: GetHandoffAnalyticsOptions
): Promise<HandoffAnalytics> {
  const allHandoffs = await store.queryRelationshipsByVerb(HANDED_OFF_TO)

  // Filter by options
  let filtered = allHandoffs
  if (options?.conversationId) {
    filtered = filtered.filter((h) => (h.data as any)?.conversationId === options.conversationId)
  }
  if (options?.from) {
    filtered = filtered.filter((h) => h.createdAt.getTime() >= options.from!.getTime())
  }
  if (options?.to) {
    filtered = filtered.filter((h) => h.createdAt.getTime() <= options.to!.getTime())
  }

  // Count by reason
  const byReason: Record<HandoffReason, number> = {
    specialization: 0,
    escalation: 0,
    delegation: 0,
    completion: 0,
    routing: 0,
    error: 0,
    custom: 0,
  }

  for (const handoff of filtered) {
    const reason = (handoff.data as any)?.reason as HandoffReason
    if (reason && byReason[reason] !== undefined) {
      byReason[reason]++
    }
  }

  // Count handoff pairs - use extractAgentId to normalize URLs
  // Use "|" as separator since agent IDs contain ":"
  const pairCounts = new Map<string, number>()
  for (const handoff of filtered) {
    const fromId = extractAgentId(handoff.from)
    const toId = extractAgentId(handoff.to)
    const key = `${fromId}|${toId}`
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
  }

  const topHandoffPairs = Array.from(pairCounts.entries())
    .map(([key, count]) => {
      const [from, to] = key.split('|')
      return { from: from!, to: to!, count }
    })
    .sort((a, b) => b.count - a.count)

  // Count agent participation - use extractAgentId to normalize URLs
  const agentStats = new Map<string, { asSource: number; asTarget: number }>()

  for (const handoff of filtered) {
    const fromId = extractAgentId(handoff.from)
    const toId = extractAgentId(handoff.to)

    if (!agentStats.has(fromId)) {
      agentStats.set(fromId, { asSource: 0, asTarget: 0 })
    }
    if (!agentStats.has(toId)) {
      agentStats.set(toId, { asSource: 0, asTarget: 0 })
    }

    agentStats.get(fromId)!.asSource++
    agentStats.get(toId)!.asTarget++
  }

  const agentParticipation = Array.from(agentStats.entries())
    .map(([agentId, stats]) => ({ agentId, ...stats }))
    .sort((a, b) => b.asSource + b.asTarget - (a.asSource + a.asTarget))

  return {
    totalHandoffs: filtered.length,
    byReason,
    topHandoffPairs,
    agentParticipation,
  }
}

/**
 * Get handoffs between two specific agents
 *
 * Finds all handoff relationships where the source and target match
 * the specified agent IDs, optionally filtered by conversation.
 *
 * @param store - The GraphStore instance
 * @param fromAgentId - The source agent ID
 * @param toAgentId - The target agent ID
 * @param conversationId - Optional conversation ID to filter by
 * @returns Array of matching handoff relationships
 *
 * @example
 * ```typescript
 * const handoffs = await getHandoffsBetweenAgents(store, 'agent:ralph', 'agent:tom')
 * console.log(`Found ${handoffs.length} handoffs from Ralph to Tom`)
 * ```
 */
export async function getHandoffsBetweenAgents(
  store: GraphStore,
  fromAgentId: string,
  toAgentId: string,
  conversationId?: string
): Promise<HandoffRelationship[]> {
  // Query all handoffs from this agent (across all conversations)
  const allHandoffs = await store.queryRelationshipsByVerb(HANDED_OFF_TO)

  return allHandoffs.filter((r) => {
    const matchesSource = extractAgentId(r.from) === fromAgentId
    const matchesTarget = extractAgentId(r.to) === toAgentId
    const matchesConversation = !conversationId || (r.data as any)?.conversationId === conversationId
    return matchesSource && matchesTarget && matchesConversation
  }) as HandoffRelationship[]
}

// ============================================================================
// HandoffProtocol Integration
// ============================================================================

/**
 * Create graph-backed handoff hooks for integration with HandoffProtocol
 *
 * This function returns hooks that can be passed to HandoffProtocol to
 * automatically track handoffs in the graph store.
 *
 * @param store - The GraphStore instance
 * @param options - Optional configuration (enableCircularCheck, etc.)
 * @returns Partial HandoffHooks that can be merged with other hooks
 *
 * @example
 * ```typescript
 * const graphHooks = createGraphBackedHandoffHooks(store)
 * const protocol = new HandoffProtocol({
 *   provider,
 *   agents,
 *   hooks: {
 *     ...graphHooks,
 *     // Additional custom hooks...
 *   }
 * })
 * ```
 */
export function createGraphBackedHandoffHooks(
  store: GraphStore,
  options?: {
    /** Enable circular handoff detection (default: true) */
    enableCircularCheck?: boolean
    /** Default conversation ID if not specified in request */
    defaultConversationId?: string
  }
): Partial<HandoffHooks> {
  const enableCircularCheck = options?.enableCircularCheck ?? true

  return {
    /**
     * Validate handoff - check for circular chains if enabled
     */
    validateHandoff: enableCircularCheck
      ? async (request: HandoffRequest): Promise<boolean> => {
          // Extract conversation ID from first message or use default
          const conversationId =
            options?.defaultConversationId ??
            (request.context.metadata?.conversationId as string | undefined)

          const check = await checkCircularHandoff(
            store,
            request.sourceAgentId,
            request.targetAgentId,
            conversationId
          )

          return !check.isCircular
        }
      : undefined,

    /**
     * Record handoff when it completes
     */
    onHandoffComplete: async (result: HandoffResult): Promise<void> => {
      const { request } = result

      // Extract conversation ID from context metadata or generate from first message
      const conversationId =
        options?.defaultConversationId ??
        (request.context.metadata?.conversationId as string | undefined)

      // Record the handoff relationship
      await createHandoffRelationship(store, {
        from: request.sourceAgentId,
        to: request.targetAgentId,
        reason: request.reason,
        reasonDescription: request.reasonDescription,
        context: {
          summary: request.context.summary,
          instructions: request.context.instructions,
          variables: request.context.variables,
          metadata: request.context.metadata,
        },
        conversationId,
      })
    },
  }
}

// ============================================================================
// Exports
// ============================================================================

export default {
  HANDED_OFF_TO,
  createHandoffRelationship,
  getHandoffChain,
  checkCircularHandoff,
  getHandoffAnalytics,
  getHandoffsBetweenAgents,
  createGraphBackedHandoffHooks,
  extractAgentId,
}
