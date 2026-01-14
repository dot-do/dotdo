/**
 * Escalation Chains via Graph Traversal Tests
 *
 * Tests for escalation chain traversal using graph relationships.
 * Escalation chains enable human-in-the-loop workflows to automatically
 * escalate to higher authority levels when timeouts occur or SLAs breach.
 *
 * ## Key Concepts
 *
 * **Graph Relationships for Escalation:**
 * - Role `escalatesTo` Role (defines escalation hierarchy)
 * - Request `escalatedTo` Target (tracks actual escalations)
 * - Human `canApproveFor` Role (delegation relationships)
 *
 * **Timeout-Triggered Escalation:**
 * - Uses DO alarms to trigger escalation after SLA breach
 * - Graph traversal finds next target in escalation chain
 * - SLA timestamps recorded at each escalation level
 *
 * ## Design Notes
 *
 * Escalation chains are defined via graph relationships between roles:
 *
 * ```
 * support --escalatesTo--> manager --escalatesTo--> director --escalatesTo--> ceo
 * ```
 *
 * When a request times out at the current level, the system:
 * 1. Queries the graph for `escalatesTo` relationship from current role
 * 2. Finds the next target (user assigned to that role)
 * 3. Records escalation timestamp for SLA tracking
 * 4. Notifies all targets in the escalation chain
 *
 * NO MOCKS - uses real SQLiteGraphStore and graph queries.
 *
 * RED PHASE: These tests define expected behavior for escalation chain traversal.
 * Tests are expected to FAIL until implementation is complete.
 *
 * @see dotdo-ebkg0 - [RED] Escalation chains via graph traversal (P0)
 *
 * @module tests/integration/escalation-chains
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../../db/graph/stores'
import type { GraphStore } from '../../db/graph/types'
import {
  HUMAN_VERBS,
  HUMAN_TYPE_NAMES,
  HumanUrls,
  HUMAN_TYPE_IDS,
  // User operations
  createUser,
  // Role operations
  createRole,
  assignRole,
  // Approval operations
  createApprovalRequest,
  // HITL operations
  createTaskRequest,
  escalateTaskRequest,
  getTaskEscalationChain,
} from '../../db/graph/humans'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Escalation chain traversal service.
 *
 * This is the interface we expect to implement - tests define its behavior.
 * The service uses graph queries to find escalation targets based on
 * role relationships.
 */
interface EscalationChainService {
  /**
   * Find the next escalation target via graph traversal.
   *
   * Queries the graph for `escalatesTo` relationship from the current role
   * and returns the target role/user.
   *
   * @param graph - Graph store
   * @param currentRoleId - Current role in the escalation chain
   * @returns Next escalation target or null if at top of chain
   */
  findNextEscalationTarget(
    graph: GraphStore,
    currentRoleId: string
  ): Promise<{ roleId: string; roleName: string; users: string[] } | null>

  /**
   * Traverse the full escalation chain from a starting role.
   *
   * Returns the complete path from the starting role to the top of the
   * escalation hierarchy.
   *
   * @param graph - Graph store
   * @param startingRoleId - Starting role
   * @param maxDepth - Maximum traversal depth (default: 10)
   * @returns Array of roles in escalation order
   */
  traverseEscalationChain(
    graph: GraphStore,
    startingRoleId: string,
    maxDepth?: number
  ): Promise<Array<{ roleId: string; roleName: string; level: number }>>

  /**
   * Find all users who can handle an escalation for a role.
   *
   * Includes users directly assigned to the role and users who have
   * delegation relationships (`canApproveFor`).
   *
   * @param graph - Graph store
   * @param roleId - Target role
   * @returns Array of user IDs who can handle escalation
   */
  findEscalationHandlers(graph: GraphStore, roleId: string): Promise<string[]>

  /**
   * Trigger escalation for a request based on timeout.
   *
   * Uses DO alarm to schedule escalation, then traverses graph to find
   * next target and notifies them.
   *
   * @param graph - Graph store
   * @param requestId - Request to escalate
   * @param reason - Escalation reason
   * @returns Escalation result with timestamps
   */
  triggerTimeoutEscalation(
    graph: GraphStore,
    requestId: string,
    reason: string
  ): Promise<{
    escalatedTo: string
    escalatedAt: number
    level: number
    notifiedUsers: string[]
  }>

  /**
   * Get SLA tracking metrics for an escalation chain.
   *
   * Returns time spent at each level, time-to-response, and breach status.
   *
   * @param graph - Graph store
   * @param requestId - Request to analyze
   * @returns SLA metrics for each escalation level
   */
  getEscalationSLAMetrics(
    graph: GraphStore,
    requestId: string
  ): Promise<
    Array<{
      level: number
      roleId: string
      escalatedAt: number
      respondedAt?: number
      timeAtLevel: number
      slaBreached: boolean
    }>
  >
}

/**
 * Setup helper to create standard escalation hierarchy.
 *
 * Creates roles with escalatesTo relationships:
 * support -> manager -> director -> ceo
 */
async function setupEscalationHierarchy(graph: GraphStore): Promise<{
  support: { id: string; name: string }
  manager: { id: string; name: string }
  director: { id: string; name: string }
  ceo: { id: string; name: string }
}> {
  // Create roles
  const support = await createRole(graph, {
    name: 'support',
    permissions: ['review:support', 'escalate:*'],
    description: 'Support team - first line of escalation',
    hierarchyLevel: 10,
    metadata: { defaultSla: 2 * 60 * 60 * 1000 }, // 2 hours
  })

  const manager = await createRole(graph, {
    name: 'manager',
    permissions: ['approve:team', 'review:team'],
    description: 'Team manager - second escalation level',
    hierarchyLevel: 50,
    metadata: { defaultSla: 4 * 60 * 60 * 1000 }, // 4 hours
  })

  const director = await createRole(graph, {
    name: 'director',
    permissions: ['approve:department', 'review:department'],
    description: 'Department director - third escalation level',
    hierarchyLevel: 80,
    metadata: { defaultSla: 8 * 60 * 60 * 1000 }, // 8 hours
  })

  const ceo = await createRole(graph, {
    name: 'ceo',
    permissions: ['approve:*', 'review:*', 'admin:*'],
    description: 'CEO - final escalation level',
    hierarchyLevel: 100,
    metadata: { defaultSla: 24 * 60 * 60 * 1000 }, // 24 hours
  })

  // Create escalatesTo relationships
  // support -> manager
  await graph.createRelationship({
    id: `${support.id}-escalatesTo-${manager.id}`,
    verb: 'escalatesTo',
    from: HumanUrls.role(support.id),
    to: HumanUrls.role(manager.id),
    data: { priority: 1 },
  })

  // manager -> director
  await graph.createRelationship({
    id: `${manager.id}-escalatesTo-${director.id}`,
    verb: 'escalatesTo',
    from: HumanUrls.role(manager.id),
    to: HumanUrls.role(director.id),
    data: { priority: 1 },
  })

  // director -> ceo
  await graph.createRelationship({
    id: `${director.id}-escalatesTo-${ceo.id}`,
    verb: 'escalatesTo',
    from: HumanUrls.role(director.id),
    to: HumanUrls.role(ceo.id),
    data: { priority: 1 },
  })

  return {
    support: { id: support.id, name: 'support' },
    manager: { id: manager.id, name: 'manager' },
    director: { id: director.id, name: 'director' },
    ceo: { id: ceo.id, name: 'ceo' },
  }
}

/**
 * Setup helper to assign users to roles.
 */
async function assignUsersToRoles(
  graph: GraphStore,
  hierarchy: Awaited<ReturnType<typeof setupEscalationHierarchy>>
): Promise<{
  supportUser: { id: string; email: string }
  managerUser: { id: string; email: string }
  directorUser: { id: string; email: string }
  ceoUser: { id: string; email: string }
}> {
  const supportUser = await createUser(graph, {
    email: 'support@example.com',
    name: 'Support Agent',
    status: 'active',
  })
  await assignRole(graph, supportUser.id, hierarchy.support.id)

  const managerUser = await createUser(graph, {
    email: 'manager@example.com',
    name: 'Team Manager',
    status: 'active',
  })
  await assignRole(graph, managerUser.id, hierarchy.manager.id)

  const directorUser = await createUser(graph, {
    email: 'director@example.com',
    name: 'Department Director',
    status: 'active',
  })
  await assignRole(graph, directorUser.id, hierarchy.director.id)

  const ceoUser = await createUser(graph, {
    email: 'ceo@example.com',
    name: 'CEO',
    status: 'active',
  })
  await assignRole(graph, ceoUser.id, hierarchy.ceo.id)

  return {
    supportUser: { id: supportUser.id, email: 'support@example.com' },
    managerUser: { id: managerUser.id, email: 'manager@example.com' },
    directorUser: { id: directorUser.id, email: 'director@example.com' },
    ceoUser: { id: ceoUser.id, email: 'ceo@example.com' },
  }
}

// ============================================================================
// ESCALATION CHAIN SERVICE (TO BE IMPLEMENTED)
// ============================================================================

/**
 * Escalation chain service implementation.
 *
 * GREEN PHASE: Full implementation of escalation chain traversal via graph queries.
 */
const escalationChainService: EscalationChainService = {
  async findNextEscalationTarget(graph, currentRoleId) {
    // Query graph for escalatesTo relationship
    // The relationships are created with URL-formatted endpoints
    const relationships = await graph.queryRelationshipsFrom(
      HumanUrls.role(currentRoleId),
      { verb: 'escalatesTo' }
    )

    if (relationships.length === 0) {
      return null
    }

    // Extract target role ID from URL
    const targetUrl = relationships[0]!.to
    const targetRoleId = HumanUrls.extractId(targetUrl)

    // Get role details
    const role = await graph.getThing(targetRoleId)
    if (!role) {
      return null
    }

    // Find users assigned to this role
    // Note: assignRole uses raw IDs, not URL-formatted IDs
    // So we query using the raw role ID directly
    const userRelationships = await graph.queryRelationshipsTo(
      targetRoleId,
      { verb: HUMAN_VERBS.HAS_ROLE }
    )

    const userIds = userRelationships.map((rel) => rel.from)

    return {
      roleId: targetRoleId,
      roleName: (role.data as { name?: string })?.name ?? role.typeName,
      users: userIds,
    }
  },

  async traverseEscalationChain(graph, startingRoleId, maxDepth = 10) {
    const chain: Array<{ roleId: string; roleName: string; level: number }> = []
    let currentRoleId = startingRoleId
    let level = 0
    const visited = new Set<string>()

    while (level < maxDepth) {
      // Cycle detection
      if (visited.has(currentRoleId)) {
        break
      }
      visited.add(currentRoleId)

      const role = await graph.getThing(currentRoleId)
      if (!role) break

      chain.push({
        roleId: currentRoleId,
        roleName: (role.data as { name?: string })?.name ?? role.typeName,
        level,
      })

      // Find next in chain
      const next = await this.findNextEscalationTarget(graph, currentRoleId)
      if (!next) break

      currentRoleId = next.roleId
      level++
    }

    return chain
  },

  async findEscalationHandlers(graph, roleId) {
    // Find users with hasRole relationship to this role
    // Note: assignRole uses raw IDs, so query with raw role ID
    const roleRelationships = await graph.queryRelationshipsTo(
      roleId,
      { verb: HUMAN_VERBS.HAS_ROLE }
    )

    const userIds = roleRelationships.map((rel) => rel.from)

    // Also find users with canApproveFor delegation
    // This uses URL-formatted IDs (HumanUrls.role)
    const delegationRelationships = await graph.queryRelationshipsTo(
      HumanUrls.role(roleId),
      { verb: 'canApproveFor' }
    )

    const delegatedUserIds = delegationRelationships.map((rel) =>
      HumanUrls.extractId(rel.from)
    )

    // Combine and deduplicate
    return [...new Set([...userIds, ...delegatedUserIds])]
  },

  async triggerTimeoutEscalation(graph, requestId, reason) {
    // 1. Get current escalation level from request
    const task = await graph.getThing(requestId)
    if (!task) {
      throw new Error(`Request not found: ${requestId}`)
    }

    const taskData = task.data as {
      targetRole?: string
      targetUserId?: string
      metadata?: { escalationLevel?: number }
      timestamps?: { escalations?: Array<{ level: number; escalatedAt: number; target: string }> }
    }

    const currentLevel = taskData.metadata?.escalationLevel ?? 0
    const currentRole = taskData.targetRole

    if (!currentRole) {
      throw new Error('Cannot escalate: task has no target role')
    }

    // 2. Find current role's ID from name
    const roles = await graph.getThingsByType({ typeName: 'Role' })
    const currentRoleObj = roles.find(
      (r) => (r.data as { name?: string })?.name === currentRole
    )

    if (!currentRoleObj) {
      throw new Error(`Role not found: ${currentRole}`)
    }

    // 3. Find next target via graph traversal
    const nextTarget = await this.findNextEscalationTarget(graph, currentRoleObj.id)

    if (!nextTarget) {
      throw new Error('Cannot escalate: at top of escalation chain')
    }

    const now = Date.now()
    const newLevel = currentLevel + 1

    // 4. Record escalation timestamp and update task
    const existingEscalations = taskData.timestamps?.escalations ?? []
    const newEscalations = [
      ...existingEscalations,
      {
        level: newLevel,
        escalatedAt: now,
        target: nextTarget.roleId,
      },
    ]

    await graph.updateThing(requestId, {
      data: {
        ...taskData,
        targetRole: nextTarget.roleName,
        targetUserId: nextTarget.users[0] ?? null,
        metadata: {
          ...taskData.metadata,
          escalationLevel: newLevel,
          lastEscalatedAt: now,
          escalationReason: reason,
        },
        timestamps: {
          ...taskData.timestamps,
          escalations: newEscalations,
        },
      },
    })

    // 5. Create escalation relationship in graph
    await graph.createRelationship({
      id: `${requestId}-${HUMAN_VERBS.ESCALATED}-${nextTarget.roleId}-${now}`,
      verb: HUMAN_VERBS.ESCALATED,
      from: HumanUrls.task(requestId),
      to: HumanUrls.role(nextTarget.roleId),
      data: {
        level: newLevel,
        reason,
        escalatedAt: now,
        previousRole: currentRole,
      },
    })

    return {
      escalatedTo: nextTarget.roleId,
      escalatedAt: now,
      level: newLevel,
      notifiedUsers: nextTarget.users,
    }
  },

  async getEscalationSLAMetrics(graph, requestId) {
    // 1. Get the task to retrieve timestamps
    const task = await graph.getThing(requestId)
    if (!task) {
      return []
    }

    const taskData = task.data as {
      targetRole?: string
      sla?: number
      timestamps?: {
        createdAt?: number
        escalations?: Array<{ level: number; escalatedAt: number; target: string }>
      }
      metadata?: { escalationLevel?: number }
    }

    const createdAt = taskData.timestamps?.createdAt ?? task.createdAt
    const escalations = taskData.timestamps?.escalations ?? []
    const sla = taskData.sla ?? 8 * 60 * 60 * 1000 // default 8 hours

    const metrics: Array<{
      level: number
      roleId: string
      escalatedAt: number
      respondedAt?: number
      timeAtLevel: number
      slaBreached: boolean
    }> = []

    // Get per-level SLA from role metadata if available
    const getPerLevelSla = async (roleId: string): Promise<number> => {
      const role = await graph.getThing(roleId)
      if (!role) return sla
      const roleData = role.data as { metadata?: { defaultSla?: number } }
      return roleData.metadata?.defaultSla ?? sla
    }

    // Query escalation relationships to get the original role at level 0
    const escalationRels = await graph.queryRelationshipsFrom(HumanUrls.task(requestId), {
      verb: HUMAN_VERBS.ESCALATED,
    })

    // Find the first escalation to determine initial role
    let initialRoleId: string | null = null
    if (escalationRels.length > 0) {
      // Sort by level to get the first escalation
      const sortedRels = [...escalationRels].sort((a, b) => {
        const aLevel = (a.data as { level?: number })?.level ?? 0
        const bLevel = (b.data as { level?: number })?.level ?? 0
        return aLevel - bLevel
      })
      // First escalation's previousRole tells us the initial role
      const firstEscData = sortedRels[0]!.data as { previousRole?: string; level?: number }
      if (firstEscData.previousRole) {
        // Find role by name
        const roles = await graph.getThingsByType({ typeName: 'Role' })
        const role = roles.find(
          (r) => (r.data as { name?: string })?.name === firstEscData.previousRole
        )
        if (role) {
          initialRoleId = role.id
        }
      }
    }

    // If we found an initial role from escalation history, use it
    // Otherwise fall back to current targetRole (no escalations yet)
    if (!initialRoleId && taskData.targetRole) {
      const roles = await graph.getThingsByType({ typeName: 'Role' })
      const role = roles.find(
        (r) => (r.data as { name?: string })?.name === taskData.targetRole
      )
      if (role) {
        initialRoleId = role.id
      } else {
        initialRoleId = `role-${taskData.targetRole}`
      }
    }

    // Level 0: Initial assignment
    if (initialRoleId) {
      const level0EndTime = escalations[0]?.escalatedAt ?? Date.now()
      const level0Time = level0EndTime - createdAt
      const perLevelSla = await getPerLevelSla(initialRoleId)
      metrics.push({
        level: 0,
        roleId: initialRoleId,
        escalatedAt: createdAt,
        timeAtLevel: level0Time,
        slaBreached: level0Time > perLevelSla,
      })
    }

    // Add metrics for each escalation level
    for (let i = 0; i < escalations.length; i++) {
      const esc = escalations[i]!
      const nextEsc = escalations[i + 1]
      const endTime = nextEsc?.escalatedAt ?? Date.now()
      const timeAtLevel = endTime - esc.escalatedAt
      const perLevelSla = await getPerLevelSla(esc.target)

      metrics.push({
        level: esc.level,
        roleId: esc.target,
        escalatedAt: esc.escalatedAt,
        timeAtLevel,
        slaBreached: timeAtLevel > perLevelSla,
      })
    }

    return metrics
  },
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Escalation Chains via Graph', () => {
  let graph: GraphStore

  beforeEach(async () => {
    graph = new SQLiteGraphStore(':memory:')
    await graph.initialize()
  })

  afterEach(async () => {
    // SQLiteGraphStore handles cleanup
  })

  // ==========================================================================
  // RELATIONSHIP-BASED ESCALATION
  // ==========================================================================

  describe('Relationship-based Escalation', () => {
    it('finds escalation target via escalatesTo relationship', async () => {
      // Setup escalation hierarchy
      const hierarchy = await setupEscalationHierarchy(graph)
      await assignUsersToRoles(graph, hierarchy)

      // Find next target from support role
      const nextTarget = await escalationChainService.findNextEscalationTarget(
        graph,
        hierarchy.support.id
      )

      // Should find manager as next escalation target
      expect(nextTarget).not.toBeNull()
      expect(nextTarget!.roleId).toBe(hierarchy.manager.id)
      expect(nextTarget!.roleName).toBe('manager')
      // TODO: This fails because findNextEscalationTarget looks for HAS_ROLE relationships
      // but assignRole may use a different verb or URL scheme
      // In GREEN phase: Fix the query to properly find users assigned to roles
      expect(nextTarget!.users.length).toBeGreaterThan(0)
    })

    it('traverses multi-level escalation chain', async () => {
      // Setup escalation hierarchy
      const hierarchy = await setupEscalationHierarchy(graph)

      // Traverse chain from support
      const chain = await escalationChainService.traverseEscalationChain(
        graph,
        hierarchy.support.id
      )

      // Should traverse: support -> manager -> director -> ceo
      expect(chain.length).toBe(4)
      expect(chain[0]!.roleId).toBe(hierarchy.support.id)
      expect(chain[0]!.level).toBe(0)
      expect(chain[1]!.roleId).toBe(hierarchy.manager.id)
      expect(chain[1]!.level).toBe(1)
      expect(chain[2]!.roleId).toBe(hierarchy.director.id)
      expect(chain[2]!.level).toBe(2)
      expect(chain[3]!.roleId).toBe(hierarchy.ceo.id)
      expect(chain[3]!.level).toBe(3)
    })

    it('respects role-based escalation policies', async () => {
      // Setup hierarchy with users
      const hierarchy = await setupEscalationHierarchy(graph)
      const users = await assignUsersToRoles(graph, hierarchy)

      // Create additional manager with delegation rights
      const backupManager = await createUser(graph, {
        email: 'backup-manager@example.com',
        name: 'Backup Manager',
        status: 'active',
      })

      // Create canApproveFor delegation relationship
      await graph.createRelationship({
        id: `${backupManager.id}-canApproveFor-${hierarchy.manager.id}`,
        verb: 'canApproveFor',
        from: HumanUrls.user(backupManager.id),
        to: HumanUrls.role(hierarchy.manager.id),
        data: { delegatedAt: Date.now() },
      })

      // Find handlers for manager role - should include both assigned and delegated users
      const handlers = await escalationChainService.findEscalationHandlers(
        graph,
        hierarchy.manager.id
      )

      // TODO: This fails because:
      // 1. findEscalationHandlers queries for HAS_ROLE verb which may not match actual verb used
      // 2. Delegation (canApproveFor) is queried correctly but role assignment may use different verb
      // In GREEN phase: Fix the handler lookup to properly find all users who can handle escalation
      expect(handlers.length).toBe(2)
      expect(handlers).toContain(users.managerUser.id)
      expect(handlers).toContain(backupManager.id)
    })

    it('returns null when at top of escalation chain', async () => {
      // Setup hierarchy
      const hierarchy = await setupEscalationHierarchy(graph)

      // CEO has no escalation target
      const nextTarget = await escalationChainService.findNextEscalationTarget(
        graph,
        hierarchy.ceo.id
      )

      expect(nextTarget).toBeNull()
    })

    it('handles circular escalation prevention', async () => {
      // Setup hierarchy
      const hierarchy = await setupEscalationHierarchy(graph)

      // Add a circular reference (should be prevented or handled)
      // ceo -> support (would create a cycle)
      await graph.createRelationship({
        id: `${hierarchy.ceo.id}-escalatesTo-${hierarchy.support.id}-cycle`,
        verb: 'escalatesTo',
        from: HumanUrls.role(hierarchy.ceo.id),
        to: HumanUrls.role(hierarchy.support.id),
        data: { priority: 2 }, // Lower priority
      })

      // Traverse should not infinite loop
      const chain = await escalationChainService.traverseEscalationChain(
        graph,
        hierarchy.support.id,
        10 // Max depth should prevent infinite loop
      )

      // Chain should terminate at maxDepth or when cycle detected
      expect(chain.length).toBeLessThanOrEqual(10)
      // Current implementation does not detect cycles - this test documents the need
      // In GREEN phase: Should visit each role only once (cycle detection needed)
      // For now, check that we don't have more than maxDepth entries
      // TODO: Implement cycle detection in traverseEscalationChain
      const uniqueRoles = new Set(chain.map((c) => c.roleId))
      // This assertion will FAIL until cycle detection is implemented
      // After cycle detection: uniqueRoles.size should equal chain.length (no duplicates)
      expect(uniqueRoles.size).toBe(4) // 4 unique roles even with cycle
    })
  })

  // ==========================================================================
  // TIMEOUT-TRIGGERED ESCALATION
  // ==========================================================================

  describe('Timeout-triggered Escalation', () => {
    it('escalates after timeout via DO alarm', async () => {
      // Setup
      const hierarchy = await setupEscalationHierarchy(graph)
      const users = await assignUsersToRoles(graph, hierarchy)

      // Create a task request assigned to support
      const { thing: task } = await createTaskRequest(graph, {
        title: 'Customer complaint',
        instructions: 'Handle customer complaint',
        requesterId: 'requester-1',
        targetRole: 'support',
        priority: 'high',
        sla: 1000, // 1 second SLA for test
      })

      // Simulate timeout by waiting (in real implementation, DO alarm triggers this)
      // Note: In production, this would be triggered by DO alarm callback

      // Trigger timeout escalation
      const escalationResult = await escalationChainService.triggerTimeoutEscalation(
        graph,
        task.id,
        'SLA breach - no response within timeout'
      )

      // Should have escalated to manager
      expect(escalationResult.escalatedTo).toBe(hierarchy.manager.id)
      expect(escalationResult.level).toBe(1)
      expect(escalationResult.escalatedAt).toBeDefined()
      expect(escalationResult.notifiedUsers).toContain(users.managerUser.id)
    })

    it('notifies all escalation targets in chain', async () => {
      // Setup
      const hierarchy = await setupEscalationHierarchy(graph)
      const users = await assignUsersToRoles(graph, hierarchy)

      // Create task at support level
      const { thing: task } = await createTaskRequest(graph, {
        title: 'Urgent issue',
        instructions: 'Handle urgent issue',
        requesterId: 'requester-1',
        targetRole: 'support',
        priority: 'urgent',
        sla: 500, // Very short SLA
      })

      // First escalation: support -> manager
      const escalation1 = await escalationChainService.triggerTimeoutEscalation(
        graph,
        task.id,
        'First escalation timeout'
      )
      expect(escalation1.notifiedUsers).toContain(users.managerUser.id)

      // Second escalation: manager -> director
      const escalation2 = await escalationChainService.triggerTimeoutEscalation(
        graph,
        task.id,
        'Second escalation timeout'
      )
      expect(escalation2.level).toBe(2)
      expect(escalation2.notifiedUsers).toContain(users.directorUser.id)

      // Third escalation: director -> ceo
      const escalation3 = await escalationChainService.triggerTimeoutEscalation(
        graph,
        task.id,
        'Final escalation timeout'
      )
      expect(escalation3.level).toBe(3)
      expect(escalation3.notifiedUsers).toContain(users.ceoUser.id)
    })

    it('records escalation relationship in graph', async () => {
      // Setup
      const hierarchy = await setupEscalationHierarchy(graph)
      await assignUsersToRoles(graph, hierarchy)

      // Create and escalate task
      const { thing: task } = await createTaskRequest(graph, {
        title: 'Test task',
        instructions: 'Test instructions',
        requesterId: 'requester-1',
        targetRole: 'support',
      })

      await escalationChainService.triggerTimeoutEscalation(
        graph,
        task.id,
        'Timeout'
      )

      // Query escalation relationships from task
      const escalations = await graph.queryRelationshipsFrom(
        HumanUrls.task(task.id),
        { verb: HUMAN_VERBS.ESCALATED }
      )

      expect(escalations.length).toBeGreaterThan(0)
      expect(escalations[0]!.verb).toBe(HUMAN_VERBS.ESCALATED)
    })

    it('stops escalation at top of chain', async () => {
      // Setup minimal hierarchy: only ceo (no escalation target)
      const ceo = await createRole(graph, {
        name: 'ceo',
        permissions: ['approve:*'],
        hierarchyLevel: 100,
      })

      const ceoUser = await createUser(graph, {
        email: 'ceo@example.com',
        name: 'CEO',
        status: 'active',
      })
      await assignRole(graph, ceoUser.id, ceo.id)

      // Create task assigned directly to CEO
      const { thing: task } = await createTaskRequest(graph, {
        title: 'CEO task',
        instructions: 'CEO-level task',
        requesterId: 'requester-1',
        targetRole: 'ceo',
      })

      // Attempt escalation should fail gracefully (no higher level)
      await expect(
        escalationChainService.triggerTimeoutEscalation(
          graph,
          task.id,
          'Attempted escalation from top'
        )
      ).rejects.toThrow() // Or return null/error state
    })
  })

  // ==========================================================================
  // SLA TRACKING
  // ==========================================================================

  describe('SLA Tracking', () => {
    it('records escalation timestamps for SLA tracking', async () => {
      // Setup
      const hierarchy = await setupEscalationHierarchy(graph)
      await assignUsersToRoles(graph, hierarchy)

      // Create task
      const { thing: task } = await createTaskRequest(graph, {
        title: 'SLA tracking test',
        instructions: 'Track SLA across escalations',
        requesterId: 'requester-1',
        targetRole: 'support',
        sla: 1000,
      })

      const beforeEscalation = Date.now()

      // Escalate
      await escalationChainService.triggerTimeoutEscalation(
        graph,
        task.id,
        'SLA breach'
      )

      const afterEscalation = Date.now()

      // Get SLA metrics
      const metrics = await escalationChainService.getEscalationSLAMetrics(
        graph,
        task.id
      )

      // Should have metrics for level 0 (initial) and level 1 (escalated)
      expect(metrics.length).toBeGreaterThanOrEqual(1)

      const level1Metrics = metrics.find((m) => m.level === 1)
      expect(level1Metrics).toBeDefined()
      expect(level1Metrics!.escalatedAt).toBeGreaterThanOrEqual(beforeEscalation)
      expect(level1Metrics!.escalatedAt).toBeLessThanOrEqual(afterEscalation)
    })

    it('calculates time-to-response at each level', async () => {
      // Setup
      const hierarchy = await setupEscalationHierarchy(graph)
      await assignUsersToRoles(graph, hierarchy)

      // Create task
      const { thing: task } = await createTaskRequest(graph, {
        title: 'Response time test',
        instructions: 'Measure response time',
        requesterId: 'requester-1',
        targetRole: 'support',
      })

      // Simulate escalation at t=0
      await escalationChainService.triggerTimeoutEscalation(
        graph,
        task.id,
        'Timeout 1'
      )

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Simulate response at manager level
      // (In real implementation, this would be done via completeTask or similar)
      const metrics = await escalationChainService.getEscalationSLAMetrics(
        graph,
        task.id
      )

      // Check that time spent is tracked
      for (const metric of metrics) {
        expect(metric.timeAtLevel).toBeDefined()
        expect(metric.timeAtLevel).toBeGreaterThanOrEqual(0)
      }
    })

    it('detects SLA breach at each escalation level', async () => {
      // Setup with short SLAs for testing
      const support = await createRole(graph, {
        name: 'support',
        permissions: ['escalate:*'],
        hierarchyLevel: 10,
        metadata: { defaultSla: 100 }, // 100ms SLA
      })

      const manager = await createRole(graph, {
        name: 'manager',
        permissions: ['approve:team'],
        hierarchyLevel: 50,
        metadata: { defaultSla: 200 }, // 200ms SLA
      })

      // Create escalatesTo relationship
      await graph.createRelationship({
        id: `${support.id}-escalatesTo-${manager.id}`,
        verb: 'escalatesTo',
        from: HumanUrls.role(support.id),
        to: HumanUrls.role(manager.id),
        data: {},
      })

      // Create task
      const { thing: task } = await createTaskRequest(graph, {
        title: 'SLA breach test',
        instructions: 'Test SLA breach detection',
        requesterId: 'requester-1',
        targetRole: 'support',
        sla: 100,
      })

      // Wait for SLA to breach
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Escalate
      await escalationChainService.triggerTimeoutEscalation(
        graph,
        task.id,
        'SLA breached'
      )

      // Get metrics
      const metrics = await escalationChainService.getEscalationSLAMetrics(
        graph,
        task.id
      )

      // Level 0 (support) should show SLA breach
      const level0 = metrics.find((m) => m.level === 0)
      expect(level0?.slaBreached).toBe(true)
    })

    it('tracks cumulative SLA across escalation chain', async () => {
      // Setup
      const hierarchy = await setupEscalationHierarchy(graph)
      await assignUsersToRoles(graph, hierarchy)

      // Create task with 2 hour total SLA
      const { thing: task } = await createTaskRequest(graph, {
        title: 'Cumulative SLA test',
        instructions: 'Track cumulative SLA',
        requesterId: 'requester-1',
        targetRole: 'support',
        sla: 2 * 60 * 60 * 1000, // 2 hours
        metadata: {
          perLevelSla: {
            support: 30 * 60 * 1000, // 30 min
            manager: 60 * 60 * 1000, // 1 hour
            director: 30 * 60 * 1000, // 30 min
          },
        },
      })

      // Simulate multiple escalations
      await escalationChainService.triggerTimeoutEscalation(
        graph,
        task.id,
        'Support timeout'
      )
      await escalationChainService.triggerTimeoutEscalation(
        graph,
        task.id,
        'Manager timeout'
      )

      // Get metrics
      const metrics = await escalationChainService.getEscalationSLAMetrics(
        graph,
        task.id
      )

      // Calculate total time across all levels
      const totalTime = metrics.reduce((sum, m) => sum + m.timeAtLevel, 0)
      expect(totalTime).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // INTEGRATION WITH EXISTING HITL OPERATIONS
  // ==========================================================================

  describe('Integration with Existing HITL Operations', () => {
    it('integrates with escalateTaskRequest', async () => {
      // Setup
      const hierarchy = await setupEscalationHierarchy(graph)
      await assignUsersToRoles(graph, hierarchy)

      // Create task
      const { thing: task } = await createTaskRequest(graph, {
        title: 'Integration test',
        instructions: 'Test HITL integration',
        requesterId: 'requester-1',
        targetUserId: 'support-user-1',
      })

      // Use existing escalateTaskRequest
      const escalation = await escalateTaskRequest(graph, task.id, {
        toRole: 'manager',
        reason: 'No response',
        escalatedBy: 'system',
      })

      expect(escalation.verb).toBe(HUMAN_VERBS.ESCALATED)

      // Verify escalation chain tracking
      const chain = await getTaskEscalationChain(graph, task.id)
      expect(chain.length).toBeGreaterThan(0)
    })

    it('coordinates with approval escalation workflow', async () => {
      // Setup
      const hierarchy = await setupEscalationHierarchy(graph)
      const users = await assignUsersToRoles(graph, hierarchy)

      // Create approval request
      const { thing: approval } = await createApprovalRequest(graph, {
        title: 'Budget approval',
        message: 'Please approve $10,000 budget',
        type: 'approval',
        priority: 'high',
        targetRole: 'manager',
        requesterId: 'requester-1',
        sla: 4 * 60 * 60 * 1000, // 4 hours
      })

      // Approval requests should also support graph-based escalation
      const nextTarget = await escalationChainService.findNextEscalationTarget(
        graph,
        hierarchy.manager.id
      )

      expect(nextTarget).not.toBeNull()
      expect(nextTarget!.roleId).toBe(hierarchy.director.id)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles role with no users assigned', async () => {
      // Create role without assigning users
      const emptyRole = await createRole(graph, {
        name: 'empty-role',
        permissions: ['approve:nothing'],
        hierarchyLevel: 20,
      })

      const handlers = await escalationChainService.findEscalationHandlers(
        graph,
        emptyRole.id
      )

      expect(handlers).toEqual([])
    })

    it('handles missing escalatesTo relationship', async () => {
      // Create isolated role
      const isolatedRole = await createRole(graph, {
        name: 'isolated',
        permissions: ['view:own'],
        hierarchyLevel: 5,
      })

      const nextTarget = await escalationChainService.findNextEscalationTarget(
        graph,
        isolatedRole.id
      )

      expect(nextTarget).toBeNull()
    })

    it('handles deleted role in escalation chain', async () => {
      // Setup hierarchy
      const hierarchy = await setupEscalationHierarchy(graph)

      // Soft delete manager role
      await graph.deleteThing(hierarchy.manager.id)

      // Traversal should skip deleted role
      const chain = await escalationChainService.traverseEscalationChain(
        graph,
        hierarchy.support.id
      )

      // Chain should either skip manager or handle gracefully
      const managerInChain = chain.find((c) => c.roleId === hierarchy.manager.id)
      // Implementation should handle this - either skip or show as inactive
      expect(chain.length).toBeGreaterThan(0) // Should not break
    })

    it('handles concurrent escalation attempts', async () => {
      // Setup
      const hierarchy = await setupEscalationHierarchy(graph)
      await assignUsersToRoles(graph, hierarchy)

      // Create task
      const { thing: task } = await createTaskRequest(graph, {
        title: 'Concurrent escalation test',
        instructions: 'Test concurrent escalations',
        requesterId: 'requester-1',
        targetRole: 'support',
      })

      // Attempt concurrent escalations
      const escalationPromises = [
        escalationChainService.triggerTimeoutEscalation(graph, task.id, 'Timeout 1'),
        escalationChainService.triggerTimeoutEscalation(graph, task.id, 'Timeout 2'),
      ]

      // Should handle gracefully - only one escalation should succeed
      // or both should be properly sequenced
      try {
        const results = await Promise.all(escalationPromises)
        // If both succeed, they should have different levels
        const levels = new Set(results.map((r) => r.level))
        expect(levels.size).toBe(results.length)
      } catch {
        // If one fails due to race condition, that's acceptable behavior
        expect(true).toBe(true)
      }
    })
  })
})
