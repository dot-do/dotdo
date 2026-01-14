/**
 * Handoff Chain as Relationships - Tests
 *
 * TDD RED Phase: Tests for tracking Agent handoffs as graph Relationships.
 * Handoff chains are modeled as `handedOffTo` relationships between Agent Things.
 *
 * Key Tests:
 * 1. Handoff creates `handedOffTo` relationship with context
 * 2. Handoff chain traversal (forward and backward)
 * 3. Handoff reason and context preservation in relationship data
 * 4. Circular handoff prevention via graph query
 * 5. Handoff chain analytics (count by reason, agent participation)
 *
 * Uses REAL SQLite - NO MOCKS - per project testing philosophy.
 *
 * @see dotdo-jdofw - [RED] Handoff Chain Tracking - Tests
 * @see dotdo-ucolo - Agents as Graph Things (parent epic)
 * @module agents/tests/handoff-chain
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { GraphStore, GraphThing, GraphRelationship } from '../../db/graph/types'

// ============================================================================
// Types for Handoff Chain as Relationships
// ============================================================================

/**
 * Handoff reason types - why the handoff occurred
 */
type HandoffReason =
  | 'specialization' // Target agent has better capabilities for the task
  | 'escalation'     // Issue requires higher authority or expertise
  | 'delegation'     // Parallel task delegation
  | 'completion'     // Current agent completed its part, passing along
  | 'routing'        // Initial routing decision by router agent
  | 'error'          // Current agent cannot proceed
  | 'custom'         // Custom reason with description

/**
 * Context data transferred during a handoff
 */
interface HandoffContext {
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
interface CreateHandoffRelationshipInput {
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
interface HandoffRelationship extends GraphRelationship {
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
interface HandoffChainEntry {
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
interface CircularHandoffCheckResult {
  isCircular: boolean
  existingChain: string[]
  wouldCreateCycle: boolean
}

/**
 * Analytics for handoff patterns
 */
interface HandoffAnalytics {
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

// ============================================================================
// Test Constants
// ============================================================================

const AGENT_TYPE_ID = 50
const AGENT_TYPE_NAME = 'Agent'

// Named agent fixtures based on agents/named/
const AGENTS = {
  ralph: { id: 'agent:ralph', name: 'Ralph', persona: 'Engineering' },
  tom: { id: 'agent:tom', name: 'Tom', persona: 'Tech Lead' },
  priya: { id: 'agent:priya', name: 'Priya', persona: 'Product' },
  mark: { id: 'agent:mark', name: 'Mark', persona: 'Marketing' },
  sally: { id: 'agent:sally', name: 'Sally', persona: 'Sales' },
  quinn: { id: 'agent:quinn', name: 'Quinn', persona: 'QA' },
  rae: { id: 'agent:rae', name: 'Rae', persona: 'Frontend' },
} as const

// ============================================================================
// Helper Functions - Reference implementations for GREEN phase
//
// These implementations live in the test file as a reference for what needs
// to be implemented in production code (agents/handoff-chain.ts).
//
// For proper TDD workflow:
// 1. RED: Tests fail because production module doesn't exist
// 2. GREEN: Copy these implementations to agents/handoff-chain.ts
// 3. REFACTOR: Optimize and integrate with GraphStore properly
// ============================================================================

/**
 * Extract agent ID from a URL that may include conversation context
 * e.g., "do://agents/agent:ralph/conv:123" -> "agent:ralph"
 */
function extractAgentId(url: string): string {
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
 * Create a handoff relationship between two agents
 * This is the primary function being tested
 *
 * NOTE: The relationship ID includes conversationId to allow multiple handoffs
 * between the same agent pair in different conversations. This is a key design
 * decision - handoffs are per-conversation, not globally unique per agent pair.
 */
async function createHandoffRelationship(
  store: GraphStore,
  input: CreateHandoffRelationshipInput
): Promise<HandoffRelationship> {
  const uniquePart = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const id = input.conversationId
    ? `handoff-${input.conversationId}-${uniquePart}`
    : `handoff-${uniquePart}`
  const timestamp = new Date().toISOString()

  // Include conversationId in the "from" URL to make relationships unique per conversation
  // This allows the same agent pair to have multiple handoffs in different conversations
  const fromUrl = input.conversationId
    ? `do://agents/${input.from}/${input.conversationId}`
    : `do://agents/${input.from}`
  const toUrl = input.conversationId
    ? `do://agents/${input.to}/${input.conversationId}`
    : `do://agents/${input.to}`

  const relationship = await store.createRelationship({
    id,
    verb: 'handedOffTo',
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
 */
async function getHandoffChain(
  store: GraphStore,
  startAgentId: string,
  conversationId?: string,
  options?: { maxDepth?: number; includeDeleted?: boolean }
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
    const queryUrl = conversationId
      ? `do://agents/${currentAgentId}/${conversationId}`
      : `do://agents/${currentAgentId}`

    const relationships = await store.queryRelationshipsFrom(queryUrl, {
      verb: 'handedOffTo',
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
 */
async function checkCircularHandoff(
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
    const queryUrl = conversationId
      ? `do://agents/${currentId}/${conversationId}`
      : `do://agents/${currentId}`

    const incoming = await store.queryRelationshipsTo(queryUrl, {
      verb: 'handedOffTo',
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
 */
async function getHandoffAnalytics(
  store: GraphStore,
  options?: {
    from?: Date
    to?: Date
    conversationId?: string
  }
): Promise<HandoffAnalytics> {
  const allHandoffs = await store.queryRelationshipsByVerb('handedOffTo')

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
    .sort((a, b) => (b.asSource + b.asTarget) - (a.asSource + a.asTarget))

  return {
    totalHandoffs: filtered.length,
    byReason,
    topHandoffPairs,
    agentParticipation,
  }
}

/**
 * Get handoffs between two specific agents
 */
async function getHandoffsBetweenAgents(
  store: GraphStore,
  fromAgentId: string,
  toAgentId: string,
  conversationId?: string
): Promise<HandoffRelationship[]> {
  // Query all handoffs from this agent (across all conversations)
  const allHandoffs = await store.queryRelationshipsByVerb('handedOffTo')

  return allHandoffs.filter((r) => {
    const matchesSource = extractAgentId(r.from) === fromAgentId
    const matchesTarget = extractAgentId(r.to) === toAgentId
    const matchesConversation = !conversationId || (r.data as any)?.conversationId === conversationId
    return matchesSource && matchesTarget && matchesConversation
  }) as HandoffRelationship[]
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Handoff Chain as Relationships', () => {
  let store: GraphStore

  beforeEach(async () => {
    // Import and create a fresh SQLite store for each test
    const { SQLiteGraphStore } = await import('../../db/graph/stores')
    store = new SQLiteGraphStore(':memory:')

    // Initialize the store
    if ((store as any).initialize) {
      await (store as any).initialize()
    }

    // Create test agent Things
    for (const agent of Object.values(AGENTS)) {
      await store.createThing({
        id: agent.id,
        typeId: AGENT_TYPE_ID,
        typeName: AGENT_TYPE_NAME,
        data: { name: agent.name, persona: agent.persona },
      })
    }
  })

  afterEach(async () => {
    if (store && (store as any).close) {
      await (store as any).close()
    }
  })

  // ==========================================================================
  // 1. Handoff Creates Relationship with Context
  // ==========================================================================

  describe('Handoff creates handedOffTo relationship', () => {
    it('creates relationship with verb handedOffTo', async () => {
      const handoff = await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'specialization',
      })

      expect(handoff.verb).toBe('handedOffTo')
    })

    it('stores source and target agent IDs correctly', async () => {
      const handoff = await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'specialization',
      })

      expect(handoff.from).toContain(AGENTS.ralph.id)
      expect(handoff.to).toContain(AGENTS.tom.id)
    })

    it('preserves handoff reason in relationship data', async () => {
      const handoff = await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'escalation',
        reasonDescription: 'Architecture decision required',
      })

      expect(handoff.data?.reason).toBe('escalation')
      expect(handoff.data?.reasonDescription).toBe('Architecture decision required')
    })

    it('preserves handoff context with summary', async () => {
      const handoff = await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'completion',
        context: {
          summary: 'Code implementation complete, needs review',
        },
      })

      expect(handoff.data?.context?.summary).toBe('Code implementation complete, needs review')
    })

    it('preserves handoff context with instructions', async () => {
      const handoff = await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'delegation',
        context: {
          instructions: 'Focus on error handling in auth module',
        },
      })

      expect(handoff.data?.context?.instructions).toBe('Focus on error handling in auth module')
    })

    it('preserves handoff context with variables', async () => {
      const handoff = await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'completion',
        context: {
          variables: {
            prNumber: 123,
            branch: 'feature/auth',
            linesChanged: 450,
          },
        },
      })

      expect(handoff.data?.context?.variables?.prNumber).toBe(123)
      expect(handoff.data?.context?.variables?.branch).toBe('feature/auth')
    })

    it('preserves handoff context with arbitrary metadata', async () => {
      const handoff = await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'completion',
        context: {
          metadata: {
            filesModified: ['auth.ts', 'user.ts'],
            testsPassing: true,
            coverage: 95.5,
          },
        },
      })

      expect(handoff.data?.context?.metadata?.filesModified).toEqual(['auth.ts', 'user.ts'])
      expect(handoff.data?.context?.metadata?.testsPassing).toBe(true)
      expect(handoff.data?.context?.metadata?.coverage).toBe(95.5)
    })

    it('includes timestamp in relationship data', async () => {
      const before = new Date()

      const handoff = await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'routing',
      })

      const after = new Date()
      const timestamp = new Date(handoff.data!.timestamp)

      expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('associates handoff with conversation ID', async () => {
      const handoff = await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'routing',
        conversationId: 'conv:task-123',
      })

      expect(handoff.data?.conversationId).toBe('conv:task-123')
    })

    it('generates unique handoff relationship IDs', async () => {
      const handoff1 = await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'specialization',
        conversationId: 'conv:1',
      })

      const handoff2 = await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.priya.id,
        reason: 'completion',
        conversationId: 'conv:2',
      })

      expect(handoff1.id).toBeDefined()
      expect(handoff2.id).toBeDefined()
      expect(handoff1.id).not.toBe(handoff2.id)
    })
  })

  // ==========================================================================
  // 2. Handoff Chain Traversal
  // ==========================================================================

  describe('Handoff chain traversal', () => {
    beforeEach(async () => {
      // Create a handoff chain: ralph -> tom -> priya
      await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'specialization',
        conversationId: 'conv:chain-test',
        context: { summary: 'Code done, needs review' },
      })

      // Small delay for timestamp ordering
      await new Promise((r) => setTimeout(r, 10))

      await createHandoffRelationship(store, {
        from: AGENTS.tom.id,
        to: AGENTS.priya.id,
        reason: 'completion',
        conversationId: 'conv:chain-test',
        context: { summary: 'Review complete, needs product sign-off' },
      })
    })

    it('tracks handoff chain from starting agent', async () => {
      const chain = await getHandoffChain(store, AGENTS.ralph.id, 'conv:chain-test')

      expect(chain).toHaveLength(3)
      expect(chain[0]!.agentId).toBe(AGENTS.ralph.id)
      expect(chain[1]!.agentId).toBe(AGENTS.tom.id)
      expect(chain[2]!.agentId).toBe(AGENTS.priya.id)
    })

    it('returns single agent when no handoffs exist', async () => {
      const chain = await getHandoffChain(store, AGENTS.mark.id, 'conv:other')

      expect(chain).toHaveLength(1)
      expect(chain[0]!.agentId).toBe(AGENTS.mark.id)
    })

    it('tracks handoff reasons in chain entries', async () => {
      const chain = await getHandoffChain(store, AGENTS.ralph.id, 'conv:chain-test')

      expect(chain[0]!.handoffReason).toBe('specialization') // ralph -> tom
      expect(chain[1]!.handoffReason).toBe('completion') // tom -> priya
      expect(chain[2]!.handoffReason).toBeUndefined() // priya (end of chain)
    })

    it('preserves summary from handoff context in chain entries', async () => {
      const chain = await getHandoffChain(store, AGENTS.ralph.id, 'conv:chain-test')

      expect(chain[1]!.summary).toBe('Code done, needs review')
      expect(chain[2]!.summary).toBe('Review complete, needs product sign-off')
    })

    it('tracks timestamps for handoff timing analysis', async () => {
      const chain = await getHandoffChain(store, AGENTS.ralph.id, 'conv:chain-test')

      // First agent received at chain start
      expect(chain[0]!.receivedAt).toBeInstanceOf(Date)
      // First agent handed off to second
      expect(chain[0]!.handedOffAt).toBeInstanceOf(Date)
      // Third agent received but hasn't handed off
      expect(chain[2]!.receivedAt).toBeInstanceOf(Date)
      expect(chain[2]!.handedOffAt).toBeUndefined()
    })

    it('respects maxDepth option', async () => {
      // Add more handoffs to make a longer chain
      await createHandoffRelationship(store, {
        from: AGENTS.priya.id,
        to: AGENTS.mark.id,
        reason: 'routing',
        conversationId: 'conv:chain-test',
      })

      await new Promise((r) => setTimeout(r, 10))

      await createHandoffRelationship(store, {
        from: AGENTS.mark.id,
        to: AGENTS.sally.id,
        reason: 'delegation',
        conversationId: 'conv:chain-test',
      })

      // With maxDepth: 2, should only get 3 agents (start + 2 hops)
      const chain = await getHandoffChain(store, AGENTS.ralph.id, 'conv:chain-test', {
        maxDepth: 2,
      })

      expect(chain).toHaveLength(3)
    })

    it('filters chain by conversation ID', async () => {
      // Create handoff in different conversation
      await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.mark.id,
        reason: 'delegation',
        conversationId: 'conv:other',
      })

      const chain = await getHandoffChain(store, AGENTS.ralph.id, 'conv:chain-test')

      // Should only include chain-test conversation
      expect(chain).toHaveLength(3)
      expect(chain.map((e) => e.agentId)).toEqual([
        AGENTS.ralph.id,
        AGENTS.tom.id,
        AGENTS.priya.id,
      ])
    })
  })

  // ==========================================================================
  // 3. Circular Handoff Prevention
  // ==========================================================================

  describe('Circular handoff prevention', () => {
    beforeEach(async () => {
      // Set up a chain: ralph -> tom
      await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'specialization',
        conversationId: 'conv:circular-test',
      })
    })

    it('detects direct circular handoff (A -> B -> A)', async () => {
      const result = await checkCircularHandoff(
        store,
        AGENTS.tom.id,
        AGENTS.ralph.id,
        'conv:circular-test'
      )

      expect(result.isCircular).toBe(true)
      expect(result.existingChain).toContain(AGENTS.ralph.id)
      expect(result.existingChain).toContain(AGENTS.tom.id)
    })

    it('detects transitive circular handoff (A -> B -> C -> A)', async () => {
      // Extend chain: ralph -> tom -> priya
      await createHandoffRelationship(store, {
        from: AGENTS.tom.id,
        to: AGENTS.priya.id,
        reason: 'completion',
        conversationId: 'conv:circular-test',
      })

      // Check if priya -> ralph would be circular
      const result = await checkCircularHandoff(
        store,
        AGENTS.priya.id,
        AGENTS.ralph.id,
        'conv:circular-test'
      )

      expect(result.isCircular).toBe(true)
      expect(result.existingChain).toEqual([AGENTS.ralph.id, AGENTS.tom.id, AGENTS.priya.id])
    })

    it('returns false for non-circular handoff', async () => {
      // tom -> priya is not circular (priya not in chain yet)
      const result = await checkCircularHandoff(
        store,
        AGENTS.tom.id,
        AGENTS.priya.id,
        'conv:circular-test'
      )

      expect(result.isCircular).toBe(false)
    })

    it('self-handoff is considered circular', async () => {
      const result = await checkCircularHandoff(
        store,
        AGENTS.ralph.id,
        AGENTS.ralph.id,
        'conv:any'
      )

      expect(result.isCircular).toBe(true)
      expect(result.wouldCreateCycle).toBe(true)
    })

    it('allows same agent in different conversations (not circular)', async () => {
      // In a different conversation, tom -> ralph should be allowed
      const result = await checkCircularHandoff(
        store,
        AGENTS.tom.id,
        AGENTS.ralph.id,
        'conv:different'
      )

      expect(result.isCircular).toBe(false)
    })

    it('provides existing chain in result', async () => {
      const result = await checkCircularHandoff(
        store,
        AGENTS.tom.id,
        AGENTS.ralph.id,
        'conv:circular-test'
      )

      expect(result.existingChain).toBeDefined()
      expect(result.existingChain.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // 4. Handoff Chain Analytics
  // ==========================================================================

  describe('Handoff chain analytics', () => {
    beforeEach(async () => {
      // Create multiple handoffs for analytics
      // Conversation 1: ralph -> tom -> priya
      await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'specialization',
        conversationId: 'conv:1',
      })
      await new Promise((r) => setTimeout(r, 5))
      await createHandoffRelationship(store, {
        from: AGENTS.tom.id,
        to: AGENTS.priya.id,
        reason: 'completion',
        conversationId: 'conv:1',
      })

      // Conversation 2: ralph -> tom (same pair again)
      await new Promise((r) => setTimeout(r, 5))
      await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'specialization',
        conversationId: 'conv:2',
      })

      // Conversation 3: ralph -> mark -> sally
      await new Promise((r) => setTimeout(r, 5))
      await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.mark.id,
        reason: 'delegation',
        conversationId: 'conv:3',
      })
      await new Promise((r) => setTimeout(r, 5))
      await createHandoffRelationship(store, {
        from: AGENTS.mark.id,
        to: AGENTS.sally.id,
        reason: 'routing',
        conversationId: 'conv:3',
      })

      // Conversation 4: priya -> tom (escalation)
      await new Promise((r) => setTimeout(r, 5))
      await createHandoffRelationship(store, {
        from: AGENTS.priya.id,
        to: AGENTS.tom.id,
        reason: 'escalation',
        conversationId: 'conv:4',
      })
    })

    it('counts total handoffs', async () => {
      const analytics = await getHandoffAnalytics(store)

      expect(analytics.totalHandoffs).toBe(6)
    })

    it('groups handoffs by reason', async () => {
      const analytics = await getHandoffAnalytics(store)

      expect(analytics.byReason.specialization).toBe(2)
      expect(analytics.byReason.completion).toBe(1)
      expect(analytics.byReason.delegation).toBe(1)
      expect(analytics.byReason.routing).toBe(1)
      expect(analytics.byReason.escalation).toBe(1)
    })

    it('identifies most common handoff pairs', async () => {
      const analytics = await getHandoffAnalytics(store)

      // ralph -> tom appears twice, should be top
      const topPair = analytics.topHandoffPairs[0]
      expect(topPair?.from).toBe(AGENTS.ralph.id)
      expect(topPair?.to).toBe(AGENTS.tom.id)
      expect(topPair?.count).toBe(2)
    })

    it('ranks agents by handoff participation', async () => {
      const analytics = await getHandoffAnalytics(store)

      // ralph handed off 3 times (as source)
      const ralph = analytics.agentParticipation.find((a) => a.agentId === AGENTS.ralph.id)
      expect(ralph?.asSource).toBe(3)
      expect(ralph?.asTarget).toBe(0)

      // tom received 3 times (as target)
      const tom = analytics.agentParticipation.find((a) => a.agentId === AGENTS.tom.id)
      expect(tom?.asSource).toBe(1)
      expect(tom?.asTarget).toBe(3)
    })

    it('filters analytics by conversation', async () => {
      const analytics = await getHandoffAnalytics(store, {
        conversationId: 'conv:1',
      })

      expect(analytics.totalHandoffs).toBe(2)
    })

    it('filters analytics by time range', async () => {
      const now = Date.now()

      // Only get handoffs from last 20ms (should get most recent ones)
      const analytics = await getHandoffAnalytics(store, {
        from: new Date(now - 20),
        to: new Date(now),
      })

      // Should include fewer than all handoffs
      expect(analytics.totalHandoffs).toBeLessThanOrEqual(6)
    })

    it('returns empty analytics when no handoffs match', async () => {
      const analytics = await getHandoffAnalytics(store, {
        conversationId: 'conv:nonexistent',
      })

      expect(analytics.totalHandoffs).toBe(0)
      expect(analytics.topHandoffPairs).toHaveLength(0)
      expect(analytics.agentParticipation).toHaveLength(0)
    })
  })

  // ==========================================================================
  // 5. Integration with Named Agents
  // ==========================================================================

  describe('Integration with named agents', () => {
    it('works with ralph -> tom code review handoff pattern', async () => {
      const handoff = await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'completion',
        context: {
          summary: 'Feature implementation complete',
          instructions: 'Please review the authentication changes',
          variables: {
            prNumber: 456,
            filesChanged: ['auth.ts', 'user.ts', 'session.ts'],
          },
        },
        conversationId: 'conv:pr-456-review',
      })

      expect(handoff.verb).toBe('handedOffTo')
      expect(handoff.data?.reason).toBe('completion')
      expect(handoff.data?.context?.variables?.prNumber).toBe(456)
    })

    it('works with priya -> ralph product spec handoff', async () => {
      const handoff = await createHandoffRelationship(store, {
        from: AGENTS.priya.id,
        to: AGENTS.ralph.id,
        reason: 'routing',
        context: {
          summary: 'Product spec approved, ready for implementation',
          instructions: 'Implement the user dashboard feature',
          metadata: {
            specId: 'spec-dashboard-v1',
            priority: 'high',
            deadline: '2026-02-01',
          },
        },
        conversationId: 'conv:dashboard-feature',
      })

      expect(handoff.verb).toBe('handedOffTo')
      expect(handoff.data?.context?.metadata?.specId).toBe('spec-dashboard-v1')
    })

    it('tracks full workflow: priya -> ralph -> tom -> quinn', async () => {
      const convId = 'conv:full-workflow'

      // 1. Priya hands off spec to Ralph for implementation
      await createHandoffRelationship(store, {
        from: AGENTS.priya.id,
        to: AGENTS.ralph.id,
        reason: 'routing',
        context: { summary: 'Spec ready for implementation' },
        conversationId: convId,
      })

      await new Promise((r) => setTimeout(r, 10))

      // 2. Ralph hands off to Tom for review
      await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'completion',
        context: { summary: 'Implementation complete, needs review' },
        conversationId: convId,
      })

      await new Promise((r) => setTimeout(r, 10))

      // 3. Tom hands off to Quinn for QA
      await createHandoffRelationship(store, {
        from: AGENTS.tom.id,
        to: AGENTS.quinn.id,
        reason: 'completion',
        context: { summary: 'Review approved, needs QA testing' },
        conversationId: convId,
      })

      const chain = await getHandoffChain(store, AGENTS.priya.id, convId)

      expect(chain).toHaveLength(4)
      expect(chain.map((e) => e.agentId)).toEqual([
        AGENTS.priya.id,
        AGENTS.ralph.id,
        AGENTS.tom.id,
        AGENTS.quinn.id,
      ])
    })
  })

  // ==========================================================================
  // 6. Edge Cases and Error Handling
  // ==========================================================================

  describe('Edge cases and error handling', () => {
    it('handles empty context gracefully', async () => {
      const handoff = await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'routing',
        // No context provided
      })

      expect(handoff.data?.context).toBeUndefined()
    })

    it('handles very long context summary', async () => {
      const longSummary = 'A'.repeat(10000)

      const handoff = await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'completion',
        context: { summary: longSummary },
      })

      expect(handoff.data?.context?.summary?.length).toBe(10000)
    })

    it('handles special characters in context', async () => {
      const handoff = await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'delegation',
        context: {
          summary: "User's request: <script>alert('xss')</script> & unicode: enu",
          instructions: 'Handle "quoted" values and \\backslashes\\',
          variables: { json: '{"nested": "value"}' },
        },
      })

      expect(handoff.data?.context?.summary).toContain('<script>')
      expect(handoff.data?.context?.summary).toContain('e')
      expect(handoff.data?.context?.instructions).toContain('"quoted"')
    })

    it('handles concurrent handoff creations', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        createHandoffRelationship(store, {
          from: AGENTS.ralph.id,
          to: AGENTS.tom.id,
          reason: 'delegation',
          conversationId: `conv:concurrent-${i}`,
        })
      )

      const results = await Promise.all(promises)

      // All should succeed with unique IDs
      const ids = results.map((r) => r.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(10)
    })

    it('retrieves handoffs between specific agents', async () => {
      // Create multiple handoffs
      await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'specialization',
        conversationId: 'conv:1',
      })

      await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'delegation',
        conversationId: 'conv:2',
      })

      await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.priya.id,
        reason: 'routing',
        conversationId: 'conv:3',
      })

      const handoffs = await getHandoffsBetweenAgents(
        store,
        AGENTS.ralph.id,
        AGENTS.tom.id
      )

      expect(handoffs).toHaveLength(2)
      expect(handoffs.every((h) => h.to.includes(AGENTS.tom.id))).toBe(true)
    })

    it('retrieves handoffs filtered by conversation', async () => {
      await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'specialization',
        conversationId: 'conv:target',
      })

      await createHandoffRelationship(store, {
        from: AGENTS.ralph.id,
        to: AGENTS.tom.id,
        reason: 'delegation',
        conversationId: 'conv:other',
      })

      const handoffs = await getHandoffsBetweenAgents(
        store,
        AGENTS.ralph.id,
        AGENTS.tom.id,
        'conv:target'
      )

      expect(handoffs).toHaveLength(1)
      expect(handoffs[0]!.data?.conversationId).toBe('conv:target')
    })

    it('returns empty array when no handoffs between agents', async () => {
      const handoffs = await getHandoffsBetweenAgents(
        store,
        AGENTS.ralph.id,
        AGENTS.quinn.id
      )

      expect(handoffs).toHaveLength(0)
    })
  })

  // ==========================================================================
  // 7. Handoff Reason Coverage
  // ==========================================================================

  describe('All handoff reasons are supported', () => {
    const reasons: HandoffReason[] = [
      'specialization',
      'escalation',
      'delegation',
      'completion',
      'routing',
      'error',
      'custom',
    ]

    for (const reason of reasons) {
      it(`creates handoff with reason: ${reason}`, async () => {
        const handoff = await createHandoffRelationship(store, {
          from: AGENTS.ralph.id,
          to: AGENTS.tom.id,
          reason,
          reasonDescription: `Testing ${reason} reason`,
        })

        expect(handoff.data?.reason).toBe(reason)
        expect(handoff.verb).toBe('handedOffTo')
      })
    }
  })
})
