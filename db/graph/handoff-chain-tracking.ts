/**
 * Handoff Chain Tracking as Graph Relationships (SQLite Implementation)
 *
 * Tracks agent-to-agent handoffs using the graph relationships table directly
 * with better-sqlite3. Each handoff is modeled as a `handedOffTo` relationship
 * with full context and metadata.
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
 * @module db/graph/handoff-chain-tracking
 */

import type { Database as BetterSqlite3Database } from 'better-sqlite3'

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
export interface HandoffContextData {
  /** Summary of work done by source agent */
  summary?: string
  /** Specific instructions for target agent */
  instructions?: string
  /** Variables/state to pass along */
  variables?: Record<string, unknown>
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>
}

/**
 * Input for creating a handoff relationship
 */
export interface CreateHandoffInput {
  /** Source agent Thing ID (the agent handing off) */
  from: string
  /** Target agent Thing ID (the agent receiving) */
  to: string
  /** Reason for the handoff */
  reason: HandoffReason
  /** Human-readable reason description */
  reasonDescription?: string
  /** Context to transfer */
  context?: HandoffContextData
  /** Conversation/task ID this handoff belongs to */
  conversationId?: string
}

/**
 * Handoff relationship as stored in the graph
 */
export interface HandoffRelationship {
  id: string
  verb: 'handedOffTo'
  from: string
  to: string
  data: {
    reason: HandoffReason
    reasonDescription?: string
    context?: HandoffContextData
    conversationId?: string
    timestamp: string
    durationMs?: number
  }
  createdAt: Date
}

/**
 * Entry in a handoff chain
 */
export interface HandoffChainEntry {
  agentId: string
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
 * Agent handoff history
 */
export interface AgentHandoffHistory {
  outgoing: HandoffRelationship[]
  incoming: HandoffRelationship[]
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

/**
 * Options for getHandoffChain function
 */
export interface GetHandoffChainOptions {
  /** Maximum depth to traverse (default: 100) */
  maxDepth?: number
  /** Include soft-deleted agents in chain */
  includeDeleted?: boolean
}

// ============================================================================
// HandoffHooks types for integration
// ============================================================================

/**
 * Handoff request from HandoffProtocol
 */
export interface HandoffRequest {
  id: string
  sourceAgentId: string
  targetAgentId: string
  reason: HandoffReason
  reasonDescription?: string
  context: {
    messages: unknown[]
    summary?: string
    instructions?: string
    variables?: Record<string, unknown>
    metadata?: Record<string, unknown>
  }
  initiatedAt: Date
}

/**
 * Handoff result from HandoffProtocol
 */
export interface HandoffResult {
  request: HandoffRequest
  state: 'completed' | 'failed' | 'cancelled' | 'rejected'
  result?: { text: string; messages: unknown[]; steps: number }
  completedAt?: Date
  durationMs?: number
}

/**
 * Hooks for HandoffProtocol integration
 */
export interface HandoffHooks {
  onHandoffComplete?: (result: HandoffResult) => Promise<void>
  validateHandoff?: (request: HandoffRequest) => Promise<boolean>
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique handoff relationship ID
 */
function generateHandoffId(): string {
  const uniquePart = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return `handoff-${uniquePart}`
}

/**
 * Build a relationship endpoint that includes conversationId for uniqueness
 * This allows multiple handoffs between the same agent pair in different conversations
 */
function buildEndpoint(agentId: string, conversationId?: string): string {
  if (conversationId) {
    return `${agentId}/${conversationId}`
  }
  return agentId
}

/**
 * Extract the agent ID from an endpoint (removes conversationId suffix if present)
 */
function extractAgentId(endpoint: string): string {
  const slashIndex = endpoint.indexOf('/')
  if (slashIndex === -1) {
    return endpoint
  }
  return endpoint.substring(0, slashIndex)
}

/**
 * Parse relationship data from JSON string
 */
function parseRelationshipData(dataStr: string | null): Record<string, unknown> | null {
  if (!dataStr) return null
  try {
    return JSON.parse(dataStr)
  } catch {
    return null
  }
}

/**
 * Check if an agent exists in the graph_things table
 */
function agentExists(db: BetterSqlite3Database, agentId: string): boolean {
  const result = db.prepare('SELECT id FROM graph_things WHERE id = ? AND deleted_at IS NULL').get(agentId) as
    | { id: string }
    | undefined
  return !!result
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Create a handoff relationship between two agents
 *
 * This is the primary function for recording agent-to-agent handoffs.
 * Validates that both source and target agents exist, checks for circular
 * handoffs, and creates the relationship in the database.
 *
 * @param db - The better-sqlite3 database instance
 * @param input - Handoff details (from, to, reason, context, etc.)
 * @returns The created handoff relationship
 * @throws Error if source or target agent not found
 * @throws Error if circular handoff detected
 *
 * @example
 * ```typescript
 * const handoff = await createHandoffRelationship(db, {
 *   from: 'agent:ralph',
 *   to: 'agent:tom',
 *   reason: 'completion',
 *   context: { summary: 'Code implementation complete' },
 *   conversationId: 'conv:task-123'
 * })
 * ```
 */
export async function createHandoffRelationship(
  db: BetterSqlite3Database,
  input: CreateHandoffInput
): Promise<HandoffRelationship> {
  // Validate source agent exists
  if (!agentExists(db, input.from)) {
    throw new Error(`Source agent not found: ${input.from}`)
  }

  // Validate target agent exists
  if (!agentExists(db, input.to)) {
    throw new Error(`Target agent not found: ${input.to}`)
  }

  // Check for self-handoff (circular)
  if (input.from === input.to) {
    throw new Error('Circular handoff detected: cannot hand off to self')
  }

  // Check for circular handoff in conversation
  if (input.conversationId) {
    const circularCheck = await checkCircularHandoff(db, input.from, input.to, input.conversationId)
    if (circularCheck.isCircular) {
      throw new Error(`Circular handoff detected: ${input.to} already in chain`)
    }
  }

  const id = generateHandoffId()
  const timestamp = new Date().toISOString()
  const now = Date.now()

  // Build endpoints with conversationId for uniqueness (allows multiple handoffs
  // between same agent pair in different conversations)
  const fromEndpoint = buildEndpoint(input.from, input.conversationId)
  const toEndpoint = buildEndpoint(input.to, input.conversationId)

  const data = {
    reason: input.reason,
    reasonDescription: input.reasonDescription,
    context: input.context,
    conversationId: input.conversationId,
    timestamp,
  }

  db.prepare(
    `INSERT INTO relationships (id, verb, "from", "to", data, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, HANDED_OFF_TO, fromEndpoint, toEndpoint, JSON.stringify(data), now)

  return {
    id,
    verb: HANDED_OFF_TO,
    from: input.from,
    to: input.to,
    data,
    createdAt: new Date(now),
  }
}

/**
 * Get the complete handoff chain starting from a given agent
 *
 * Traverses the graph to find all handoffs in a chain, following
 * `handedOffTo` relationships from the starting agent.
 *
 * @param db - The better-sqlite3 database instance
 * @param startAgentId - The agent ID to start from
 * @param conversationId - Optional conversation ID to filter by (when string)
 * @param options - Optional traversal options (maxDepth, includeDeleted)
 * @returns Array of chain entries in traversal order
 *
 * @example
 * ```typescript
 * const chain = await getHandoffChain(db, 'agent:ralph', 'conv:123')
 * // Returns: [{ agentId: 'agent:ralph' }, { agentId: 'agent:tom' }, ...]
 * ```
 */
export async function getHandoffChain(
  db: BetterSqlite3Database,
  startAgentId: string,
  conversationId?: string,
  options?: GetHandoffChainOptions
): Promise<HandoffChainEntry[]> {
  const maxDepth = options?.maxDepth ?? 100
  const chain: HandoffChainEntry[] = []
  const visited = new Set<string>()
  let currentAgentId = startAgentId
  let depth = 0

  // Find the first handoff from this agent to get the receivedAt time
  // For the starting agent, we need to find if they received a handoff
  let initialReceivedAt = new Date()

  if (conversationId) {
    // Try endpoint format first, then legacy
    const toEndpoint = buildEndpoint(startAgentId, conversationId)
    let incomingHandoff = db
      .prepare(
        `SELECT data, created_at FROM relationships
       WHERE verb = ? AND "to" = ?
       ORDER BY created_at ASC LIMIT 1`
      )
      .get(HANDED_OFF_TO, toEndpoint) as { data: string; created_at: number } | undefined

    // Fallback to legacy format
    if (!incomingHandoff) {
      const legacyRows = db
        .prepare(
          `SELECT data, created_at FROM relationships
         WHERE verb = ? AND "to" = ?
         ORDER BY created_at ASC`
        )
        .all(HANDED_OFF_TO, startAgentId) as Array<{ data: string; created_at: number }>

      for (const row of legacyRows) {
        const data = parseRelationshipData(row.data)
        if (data?.conversationId === conversationId) {
          incomingHandoff = row
          break
        }
      }
    }

    if (incomingHandoff) {
      initialReceivedAt = new Date(incomingHandoff.created_at)
    }
  }

  // Add starting agent
  chain.push({
    agentId: currentAgentId,
    receivedAt: initialReceivedAt,
  })
  visited.add(currentAgentId)

  while (depth < maxDepth) {
    let matchingHandoff: { id: string; from: string; to: string; data: string; created_at: number } | undefined

    if (conversationId) {
      // Try endpoint format first
      const fromEndpoint = buildEndpoint(currentAgentId, conversationId)
      const endpointRows = db
        .prepare(
          `SELECT id, "from", "to", data, created_at FROM relationships
         WHERE verb = ? AND "from" = ?
         ORDER BY created_at ASC`
        )
        .all(HANDED_OFF_TO, fromEndpoint) as Array<{
        id: string
        from: string
        to: string
        data: string
        created_at: number
      }>

      if (endpointRows.length > 0) {
        matchingHandoff = endpointRows[0]
      } else {
        // Fallback to legacy format - query with plain agentId and filter by data.conversationId
        const legacyRows = db
          .prepare(
            `SELECT id, "from", "to", data, created_at FROM relationships
           WHERE verb = ? AND "from" = ?
           ORDER BY created_at ASC`
          )
          .all(HANDED_OFF_TO, currentAgentId) as Array<{
          id: string
          from: string
          to: string
          data: string
          created_at: number
        }>

        for (const row of legacyRows) {
          const data = parseRelationshipData(row.data)
          if (data?.conversationId === conversationId) {
            matchingHandoff = row
            break
          }
        }
      }
    } else {
      // No conversationId - query with plain agentId
      const rows = db
        .prepare(
          `SELECT id, "from", "to", data, created_at FROM relationships
         WHERE verb = ? AND "from" = ?
         ORDER BY created_at ASC LIMIT 1`
        )
        .all(HANDED_OFF_TO, currentAgentId) as Array<{
        id: string
        from: string
        to: string
        data: string
        created_at: number
      }>

      if (rows.length > 0) {
        matchingHandoff = rows[0]
      }
    }

    if (!matchingHandoff) break

    // Extract agent ID from endpoint (removes /conversationId suffix if present)
    const nextAgentId = extractAgentId(matchingHandoff.to)
    const handoffData = parseRelationshipData(matchingHandoff.data)

    if (visited.has(nextAgentId)) break
    visited.add(nextAgentId)

    // Update previous entry with handoff info
    const lastEntry = chain[chain.length - 1]!
    lastEntry.handedOffAt = new Date(matchingHandoff.created_at)
    lastEntry.handoffReason = handoffData?.reason as HandoffReason | undefined

    // Add next agent
    chain.push({
      agentId: nextAgentId,
      receivedAt: new Date(matchingHandoff.created_at),
      summary: (handoffData?.context as HandoffContextData | undefined)?.summary,
    })

    currentAgentId = nextAgentId
    depth++
  }

  return chain
}

/**
 * Get handoff chain for a specific conversation
 *
 * Finds the first agent in the conversation's handoff chain and returns
 * the complete chain.
 *
 * @param db - The better-sqlite3 database instance
 * @param conversationId - The conversation ID to get the chain for
 * @returns Array of chain entries in traversal order, or empty array if no chain
 */
export async function getHandoffChainForConversation(
  db: BetterSqlite3Database,
  conversationId: string
): Promise<HandoffChainEntry[]> {
  // Find all handoffs in this conversation by filtering on data.conversationId
  const rows = db
    .prepare(
      `SELECT "from", "to", data, created_at FROM relationships
     WHERE verb = ?
     ORDER BY created_at ASC`
    )
    .all(HANDED_OFF_TO) as Array<{
    from: string
    to: string
    data: string
    created_at: number
  }>

  // Filter to this conversation
  const conversationHandoffs = rows.filter((row) => {
    const data = parseRelationshipData(row.data)
    return data?.conversationId === conversationId
  })

  if (conversationHandoffs.length === 0) return []

  // Extract agent IDs from endpoints and find the first agent
  // (one that is a source but wasn't handed off from anyone in this conversation)
  const targetAgentIds = new Set(conversationHandoffs.map((h) => extractAgentId(h.to)))
  const sourceAgentIds = new Set(conversationHandoffs.map((h) => extractAgentId(h.from)))

  // First agent is a source that isn't a target
  let firstAgent: string | undefined
  for (const source of sourceAgentIds) {
    if (!targetAgentIds.has(source)) {
      firstAgent = source
      break
    }
  }

  if (!firstAgent) {
    // Circular chain, just use the first source
    firstAgent = extractAgentId(conversationHandoffs[0]!.from)
  }

  return getHandoffChain(db, firstAgent, conversationId)
}

/**
 * Find who an agent received a handoff from (backward traversal)
 *
 * @param db - The better-sqlite3 database instance
 * @param agentId - The agent ID to find the source for
 * @param conversationId - Optional conversation ID to filter by
 * @returns The source agent ID, or null if no incoming handoff
 */
export async function getHandoffSource(
  db: BetterSqlite3Database,
  agentId: string,
  conversationId?: string
): Promise<string | null> {
  if (conversationId) {
    // First try with endpoint format (agentId/conversationId)
    const toEndpoint = buildEndpoint(agentId, conversationId)
    const endpointRows = db
      .prepare(
        `SELECT "from" FROM relationships
       WHERE verb = ? AND "to" = ?
       ORDER BY created_at DESC LIMIT 1`
      )
      .all(HANDED_OFF_TO, toEndpoint) as Array<{ from: string }>

    if (endpointRows.length > 0) {
      return extractAgentId(endpointRows[0]!.from)
    }

    // Fallback: query with plain agentId and filter by data.conversationId
    const legacyRows = db
      .prepare(
        `SELECT "from", data FROM relationships
       WHERE verb = ? AND "to" = ?
       ORDER BY created_at DESC`
      )
      .all(HANDED_OFF_TO, agentId) as Array<{ from: string; data: string }>

    for (const row of legacyRows) {
      const data = parseRelationshipData(row.data)
      if (data?.conversationId === conversationId) {
        return extractAgentId(row.from)
      }
    }

    return null
  }

  // No conversationId - query with plain agentId
  const rows = db
    .prepare(
      `SELECT "from" FROM relationships
     WHERE verb = ? AND "to" = ?
     ORDER BY created_at DESC LIMIT 1`
    )
    .all(HANDED_OFF_TO, agentId) as Array<{ from: string }>

  if (rows.length > 0) {
    return extractAgentId(rows[0]!.from)
  }

  return null
}

/**
 * Find who an agent handed off to (forward traversal)
 *
 * @param db - The better-sqlite3 database instance
 * @param agentId - The agent ID to find the target for
 * @param conversationId - Optional conversation ID to filter by
 * @returns The target agent ID, or null if no outgoing handoff
 */
export async function getHandoffTarget(
  db: BetterSqlite3Database,
  agentId: string,
  conversationId?: string
): Promise<string | null> {
  if (conversationId) {
    // First try with endpoint format (agentId/conversationId)
    const fromEndpoint = buildEndpoint(agentId, conversationId)
    const endpointRows = db
      .prepare(
        `SELECT "to" FROM relationships
       WHERE verb = ? AND "from" = ?
       ORDER BY created_at DESC LIMIT 1`
      )
      .all(HANDED_OFF_TO, fromEndpoint) as Array<{ to: string }>

    if (endpointRows.length > 0) {
      return extractAgentId(endpointRows[0]!.to)
    }

    // Fallback: query with plain agentId and filter by data.conversationId
    const legacyRows = db
      .prepare(
        `SELECT "to", data FROM relationships
       WHERE verb = ? AND "from" = ?
       ORDER BY created_at DESC`
      )
      .all(HANDED_OFF_TO, agentId) as Array<{ to: string; data: string }>

    for (const row of legacyRows) {
      const data = parseRelationshipData(row.data)
      if (data?.conversationId === conversationId) {
        return extractAgentId(row.to)
      }
    }

    return null
  }

  // No conversationId - query with plain agentId
  const rows = db
    .prepare(
      `SELECT "to" FROM relationships
     WHERE verb = ? AND "from" = ?
     ORDER BY created_at DESC LIMIT 1`
    )
    .all(HANDED_OFF_TO, agentId) as Array<{ to: string }>

  if (rows.length > 0) {
    return extractAgentId(rows[0]!.to)
  }

  return null
}

/**
 * Check if a proposed handoff would create a circular chain
 *
 * Traverses backwards from the source agent to find the existing chain,
 * then checks if the target agent is already in that chain.
 *
 * @param db - The better-sqlite3 database instance
 * @param fromAgentId - The agent initiating the handoff
 * @param toAgentId - The proposed target agent
 * @param conversationId - Optional conversation ID to filter by
 * @returns Result with isCircular flag and existing chain
 */
export async function checkCircularHandoff(
  db: BetterSqlite3Database,
  fromAgentId: string,
  toAgentId: string,
  conversationId?: string
): Promise<CircularHandoffCheckResult> {
  // Self-handoff is always circular
  if (fromAgentId === toAgentId) {
    return {
      isCircular: true,
      existingChain: [fromAgentId],
    }
  }

  // Build the existing chain by traversing backwards from fromAgentId
  const backwardChain: string[] = []
  let currentId = fromAgentId
  const visitedBackward = new Set<string>()

  while (!visitedBackward.has(currentId)) {
    visitedBackward.add(currentId)
    backwardChain.unshift(currentId)

    const source = await getHandoffSource(db, currentId, conversationId)
    if (!source) break
    currentId = source
  }

  // Check if toAgentId is already in the chain
  const isCircular = backwardChain.includes(toAgentId)

  return {
    isCircular,
    existingChain: backwardChain,
  }
}

/**
 * Get handoffs between two specific agents
 *
 * Finds all handoff relationships where the source and target match
 * the specified agent IDs, optionally filtered by conversation.
 *
 * @param db - The better-sqlite3 database instance
 * @param fromAgentId - The source agent ID
 * @param toAgentId - The target agent ID
 * @param conversationId - Optional conversation ID to filter by
 * @returns Array of matching handoff relationships
 */
export async function getHandoffsBetweenAgents(
  db: BetterSqlite3Database,
  fromAgentId: string,
  toAgentId: string,
  conversationId?: string
): Promise<HandoffRelationship[]> {
  // Query all handoffs and filter by agent IDs
  // We need to handle both endpoint format (agent:id/conv:id) and plain agent IDs
  const rows = db
    .prepare(
      `SELECT id, verb, "from", "to", data, created_at FROM relationships
     WHERE verb = ?
     ORDER BY created_at DESC`
    )
    .all(HANDED_OFF_TO) as Array<{
    id: string
    verb: string
    from: string
    to: string
    data: string
    created_at: number
  }>

  const results: HandoffRelationship[] = []
  for (const row of rows) {
    const data = parseRelationshipData(row.data) as HandoffRelationship['data']
    const rowFromAgentId = extractAgentId(row.from)
    const rowToAgentId = extractAgentId(row.to)

    // Match on agent IDs
    if (rowFromAgentId !== fromAgentId || rowToAgentId !== toAgentId) {
      continue
    }

    // Filter by conversationId if specified
    if (conversationId && data?.conversationId !== conversationId) {
      continue
    }

    results.push({
      id: row.id,
      verb: 'handedOffTo',
      from: rowFromAgentId,
      to: rowToAgentId,
      data,
      createdAt: new Date(row.created_at),
    })
  }

  return results
}

/**
 * Get analytics about handoff patterns
 *
 * Analyzes all handoff relationships to provide insights about:
 * - Total handoffs
 * - Distribution by reason
 * - Most common handoff pairs
 * - Agent participation as source and target
 * - Average chain length
 *
 * @param db - The better-sqlite3 database instance
 * @param options - Optional filters (date range, conversation ID)
 * @returns Analytics object with statistics
 */
export async function getHandoffAnalytics(
  db: BetterSqlite3Database,
  options?: GetHandoffAnalyticsOptions
): Promise<HandoffAnalytics> {
  const rows = db
    .prepare(
      `SELECT id, "from", "to", data, created_at FROM relationships
     WHERE verb = ?
     ORDER BY created_at ASC`
    )
    .all(HANDED_OFF_TO) as Array<{
    id: string
    from: string
    to: string
    data: string
    created_at: number
  }>

  // Filter by options
  let filtered = rows
  if (options?.conversationId) {
    filtered = filtered.filter((row) => {
      const data = parseRelationshipData(row.data)
      return data?.conversationId === options.conversationId
    })
  }
  if (options?.from) {
    const fromTime = options.from.getTime()
    filtered = filtered.filter((row) => row.created_at >= fromTime)
  }
  if (options?.to) {
    const toTime = options.to.getTime()
    filtered = filtered.filter((row) => row.created_at <= toTime)
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

  for (const row of filtered) {
    const data = parseRelationshipData(row.data)
    const reason = data?.reason as HandoffReason
    if (reason && byReason[reason] !== undefined) {
      byReason[reason]++
    }
  }

  // Count handoff pairs (use extracted agent IDs)
  const pairCounts = new Map<string, number>()
  for (const row of filtered) {
    const fromAgentId = extractAgentId(row.from)
    const toAgentId = extractAgentId(row.to)
    const key = `${fromAgentId}|${toAgentId}`
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
  }

  const topHandoffPairs = Array.from(pairCounts.entries())
    .map(([key, count]) => {
      const [from, to] = key.split('|')
      return { from: from!, to: to!, count }
    })
    .sort((a, b) => b.count - a.count)

  // Count agent participation (use extracted agent IDs)
  const agentStats = new Map<string, { asSource: number; asTarget: number }>()

  for (const row of filtered) {
    const fromAgentId = extractAgentId(row.from)
    const toAgentId = extractAgentId(row.to)

    if (!agentStats.has(fromAgentId)) {
      agentStats.set(fromAgentId, { asSource: 0, asTarget: 0 })
    }
    if (!agentStats.has(toAgentId)) {
      agentStats.set(toAgentId, { asSource: 0, asTarget: 0 })
    }

    agentStats.get(fromAgentId)!.asSource++
    agentStats.get(toAgentId)!.asTarget++
  }

  const agentParticipation = Array.from(agentStats.entries())
    .map(([agentId, stats]) => ({ agentId, ...stats }))
    .sort((a, b) => b.asSource + b.asTarget - (a.asSource + a.asTarget))

  // Calculate average chain length
  // Group by conversationId and calculate chain lengths
  const conversationIds = new Set<string>()
  for (const row of filtered) {
    const data = parseRelationshipData(row.data)
    if (data?.conversationId) {
      conversationIds.add(data.conversationId as string)
    }
  }

  let totalChainLength = 0
  let chainCount = 0
  for (const convId of conversationIds) {
    // Count handoffs in this conversation
    const convHandoffs = filtered.filter((row) => {
      const data = parseRelationshipData(row.data)
      return data?.conversationId === convId
    })
    if (convHandoffs.length > 0) {
      totalChainLength += convHandoffs.length
      chainCount++
    }
  }

  const averageChainLength = chainCount > 0 ? totalChainLength / chainCount : 0

  return {
    totalHandoffs: filtered.length,
    byReason,
    topHandoffPairs,
    agentParticipation,
    averageChainLength,
  }
}

/**
 * Get handoff history for a specific agent
 *
 * Returns both incoming (as target) and outgoing (as source) handoffs
 * for the specified agent.
 *
 * @param db - The better-sqlite3 database instance
 * @param agentId - The agent ID to get history for
 * @returns History object with outgoing and incoming arrays
 */
export async function getAgentHandoffHistory(
  db: BetterSqlite3Database,
  agentId: string
): Promise<AgentHandoffHistory> {
  // Query all handoffs and filter by extracted agent ID
  // (handles endpoint format like agent:id/conv:id)
  const allRows = db
    .prepare(
      `SELECT id, verb, "from", "to", data, created_at FROM relationships
     WHERE verb = ?
     ORDER BY created_at DESC`
    )
    .all(HANDED_OFF_TO) as Array<{
    id: string
    verb: string
    from: string
    to: string
    data: string
    created_at: number
  }>

  const mapRow = (row: (typeof allRows)[0]): HandoffRelationship => ({
    id: row.id,
    verb: 'handedOffTo',
    from: extractAgentId(row.from),
    to: extractAgentId(row.to),
    data: parseRelationshipData(row.data) as HandoffRelationship['data'],
    createdAt: new Date(row.created_at),
  })

  const outgoing = allRows.filter((row) => extractAgentId(row.from) === agentId).map(mapRow)
  const incoming = allRows.filter((row) => extractAgentId(row.to) === agentId).map(mapRow)

  return {
    outgoing,
    incoming,
  }
}

/**
 * Create graph-backed handoff hooks for integration with HandoffProtocol
 *
 * This function returns hooks that can be passed to HandoffProtocol to
 * automatically track handoffs in the graph store.
 *
 * @param db - The better-sqlite3 database instance
 * @param options - Optional configuration
 * @returns Partial HandoffHooks that can be merged with other hooks
 */
export function createGraphBackedHandoffHooks(
  db: BetterSqlite3Database,
  options?: {
    /** Enable circular handoff detection (default: true) */
    enableCircularCheck?: boolean
  }
): Partial<HandoffHooks> {
  const enableCircularCheck = options?.enableCircularCheck ?? true

  return {
    /**
     * Validate handoff - check for circular chains if enabled
     */
    validateHandoff: enableCircularCheck
      ? async (request: HandoffRequest): Promise<boolean> => {
          const conversationId = request.context.metadata?.conversationId as string | undefined

          const check = await checkCircularHandoff(
            db,
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

      const conversationId = request.context.metadata?.conversationId as string | undefined

      // Record the handoff relationship with duration
      const id = generateHandoffId()
      const timestamp = new Date().toISOString()
      const now = Date.now()

      const data = {
        reason: request.reason,
        reasonDescription: request.reasonDescription,
        context: {
          summary: request.context.summary,
          instructions: request.context.instructions,
          variables: request.context.variables,
          metadata: request.context.metadata,
        },
        conversationId,
        timestamp,
        durationMs: result.durationMs,
      }

      db.prepare(
        `INSERT INTO relationships (id, verb, "from", "to", data, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, HANDED_OFF_TO, request.sourceAgentId, request.targetAgentId, JSON.stringify(data), now)
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
  getHandoffChainForConversation,
  getHandoffSource,
  getHandoffTarget,
  checkCircularHandoff,
  getHandoffsBetweenAgents,
  getHandoffAnalytics,
  getAgentHandoffHistory,
  createGraphBackedHandoffHooks,
}
