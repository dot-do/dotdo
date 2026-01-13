/**
 * Permission Enforcement via Graph
 *
 * Implements permission checking using Tool -> Permission relationships
 * and enforcement on tool invocation.
 *
 * @module lib/tools/permissions
 *
 * @see dotdo-f46aq - [GREEN] Implement Permission Enforcement via Graph
 *
 * Design:
 * - Tools link to required Permissions via 'requires' relationships
 * - Executors link to granted Permissions via 'hasPermission' relationships
 * - Security levels provide additional access control layer
 * - All permission data is stored in the graph for consistency
 *
 * @example
 * ```typescript
 * // Check if executor has permission to use a tool
 * const result = await checkToolPermission(graph, 'tool-send-email', 'agent-cs')
 * if (!result.allowed) {
 *   console.error(result.reason)
 * }
 *
 * // Check security level access
 * const secResult = await checkSecurityLevel(graph, 'tool-admin', 'agent-public')
 * if (!secResult.allowed) {
 *   console.error(secResult.reason)
 * }
 * ```
 */

import type { GraphStore, GraphThing, GraphRelationship } from '../../db/graph/types'

// ============================================================================
// RE-EXPORT TYPES FROM types/Permission.ts
// ============================================================================

export type {
  PermissionType,
  PermissionScope,
  PermissionThingData,
  SecurityLevel,
  ToolThingData,
  ExecutorThingData,
} from '../../types/Permission'

export { SECURITY_LEVELS, getSecurityLevelIndex, canAccessSecurityLevel } from '../../types/Permission'

// ============================================================================
// RESULT TYPES
// ============================================================================

/**
 * Result of a permission check.
 */
export interface PermissionCheckResult {
  /** Whether access is allowed */
  allowed: boolean
  /** Reason for denial (only present if allowed is false) */
  reason?: string
  /** IDs of missing permissions (only present if permission check failed) */
  missingPermissions?: string[]
}

// ============================================================================
// ERRORS
// ============================================================================

/**
 * Error thrown when permission is denied.
 */
export class PermissionDeniedError extends Error {
  name = 'PermissionDeniedError'
  details: {
    toolId?: string
    executorId?: string
    missingPermissions?: string[]
  }

  constructor(message: string, details: PermissionDeniedError['details'] = {}) {
    super(message)
    this.details = details
  }
}

// ============================================================================
// PERMISSION CHECK FUNCTIONS
// ============================================================================

/**
 * Check if an executor has all required permissions to use a tool.
 *
 * This function:
 * 1. Gets the tool's required permissions via 'requires' relationships
 * 2. Gets the executor's granted permissions via 'hasPermission' relationships
 * 3. Checks if all required permissions are granted
 *
 * @param graph - GraphStore to query
 * @param toolId - ID of the tool to check
 * @param executorId - ID of the executor (agent/user) to check
 * @returns Promise<PermissionCheckResult> with allowed status and reason
 *
 * @example
 * ```typescript
 * const result = await checkToolPermission(graph, 'tool-send-email', 'agent-cs')
 * if (!result.allowed) {
 *   throw new PermissionDeniedError(result.reason!, {
 *     toolId: 'tool-send-email',
 *     executorId: 'agent-cs',
 *     missingPermissions: result.missingPermissions,
 *   })
 * }
 * ```
 */
export async function checkToolPermission(
  graph: GraphStore,
  toolId: string,
  executorId: string
): Promise<PermissionCheckResult> {
  // Check if tool exists
  const tool = await graph.getThing(toolId)
  if (!tool) {
    return {
      allowed: false,
      reason: `Tool not found: ${toolId}`,
    }
  }

  // Check if executor exists
  const executor = await graph.getThing(executorId)
  if (!executor) {
    return {
      allowed: false,
      reason: `Executor not found: ${executorId}`,
    }
  }

  // Get tool's required permissions
  const requirements = await graph.queryRelationshipsFrom(toolId, { verb: 'requires' })

  // If no permissions required, allow access
  if (requirements.length === 0) {
    return { allowed: true }
  }

  // Get executor's granted permissions
  const executorPermissions = await graph.queryRelationshipsFrom(executorId, {
    verb: 'hasPermission',
  })

  // Build set of granted permission IDs
  const grantedPermissionIds = new Set(executorPermissions.map((rel) => rel.to))

  // Check each requirement
  const missingPermissions: string[] = []

  for (const req of requirements) {
    if (!grantedPermissionIds.has(req.to)) {
      missingPermissions.push(req.to)
    }
  }

  if (missingPermissions.length > 0) {
    // Get details of missing permissions for error message
    const missingDetails = await Promise.all(
      missingPermissions.map(async (permId) => {
        const perm = await graph.getThing(permId)
        if (perm?.data) {
          const data = perm.data as { type?: string; resource?: string; name?: string }
          if (data.name) {
            return data.name
          }
          return `${data.resource ?? 'unknown'} ${data.type ?? 'unknown'}`
        }
        return permId
      })
    )

    return {
      allowed: false,
      reason: `Missing permission: ${missingDetails.join(', ')}`,
      missingPermissions,
    }
  }

  return { allowed: true }
}

/**
 * Check if an executor's security level is sufficient for a tool.
 *
 * Security levels form a hierarchy (public < internal < confidential < restricted).
 * An executor can only access tools with equal or lower security level.
 *
 * @param graph - GraphStore to query
 * @param toolId - ID of the tool to check
 * @param executorId - ID of the executor (agent/user) to check
 * @returns Promise<PermissionCheckResult> with allowed status and reason
 *
 * @example
 * ```typescript
 * const result = await checkSecurityLevel(graph, 'tool-admin-panel', 'agent-cs')
 * if (!result.allowed) {
 *   console.error(result.reason) // "Security level public cannot access confidential tools"
 * }
 * ```
 */
export async function checkSecurityLevel(
  graph: GraphStore,
  toolId: string,
  executorId: string
): Promise<PermissionCheckResult> {
  // Import security level utilities
  const { SECURITY_LEVELS } = await import('../../types/Permission')

  // Get tool
  const tool = await graph.getThing(toolId)
  if (!tool) {
    return {
      allowed: false,
      reason: `Tool not found: ${toolId}`,
    }
  }

  // Get executor
  const executor = await graph.getThing(executorId)
  if (!executor) {
    return {
      allowed: false,
      reason: `Executor not found: ${executorId}`,
    }
  }

  // Extract security levels from data (with defaults)
  const toolData = tool.data as { securityLevel?: string } | null
  const executorData = executor.data as { securityLevel?: string } | null

  const toolLevel = (toolData?.securityLevel ?? 'internal') as typeof SECURITY_LEVELS[number]
  const executorLevel = (executorData?.securityLevel ?? 'public') as typeof SECURITY_LEVELS[number]

  // Get indices in security level hierarchy
  const toolIdx = SECURITY_LEVELS.indexOf(toolLevel)
  const executorIdx = SECURITY_LEVELS.indexOf(executorLevel)

  // Executor level must be >= tool level
  if (executorIdx < toolIdx) {
    return {
      allowed: false,
      reason: `Security level ${executorLevel} cannot access ${toolLevel} tools`,
    }
  }

  return { allowed: true }
}

/**
 * Full permission check combining both permission requirements and security level.
 *
 * This function performs both checks and returns the first failure, or success
 * if both checks pass.
 *
 * @param graph - GraphStore to query
 * @param toolId - ID of the tool to check
 * @param executorId - ID of the executor (agent/user) to check
 * @returns Promise<PermissionCheckResult> with allowed status and reason
 */
export async function checkFullPermission(
  graph: GraphStore,
  toolId: string,
  executorId: string
): Promise<PermissionCheckResult> {
  // Check security level first (cheaper check)
  const securityResult = await checkSecurityLevel(graph, toolId, executorId)
  if (!securityResult.allowed) {
    return securityResult
  }

  // Check tool permissions
  const permissionResult = await checkToolPermission(graph, toolId, executorId)
  return permissionResult
}

// ============================================================================
// PERMISSION MANAGEMENT HELPERS
// ============================================================================

/**
 * Grant a permission to an executor.
 *
 * Creates a 'hasPermission' relationship from executor to permission.
 *
 * @param graph - GraphStore to modify
 * @param executorId - ID of the executor
 * @param permissionId - ID of the permission to grant
 */
export async function grantPermission(
  graph: GraphStore,
  executorId: string,
  permissionId: string
): Promise<void> {
  await graph.createRelationship({
    id: `${executorId}-hasPermission-${permissionId}-${Date.now()}`,
    verb: 'hasPermission',
    from: executorId,
    to: permissionId,
  })
}

/**
 * Revoke a permission from an executor.
 *
 * Finds and deletes the 'hasPermission' relationship.
 *
 * @param graph - GraphStore to modify
 * @param executorId - ID of the executor
 * @param permissionId - ID of the permission to revoke
 * @returns true if permission was revoked, false if not found
 */
export async function revokePermission(
  graph: GraphStore,
  executorId: string,
  permissionId: string
): Promise<boolean> {
  const relationships = await graph.queryRelationshipsFrom(executorId, {
    verb: 'hasPermission',
  })

  const toRevoke = relationships.find((rel) => rel.to === permissionId)
  if (!toRevoke) {
    return false
  }

  return await graph.deleteRelationship(toRevoke.id)
}

/**
 * Add a permission requirement to a tool.
 *
 * Creates a 'requires' relationship from tool to permission.
 *
 * @param graph - GraphStore to modify
 * @param toolId - ID of the tool
 * @param permissionId - ID of the required permission
 */
export async function requirePermission(
  graph: GraphStore,
  toolId: string,
  permissionId: string
): Promise<void> {
  await graph.createRelationship({
    id: `${toolId}-requires-${permissionId}-${Date.now()}`,
    verb: 'requires',
    from: toolId,
    to: permissionId,
  })
}

/**
 * Get all permissions granted to an executor.
 *
 * @param graph - GraphStore to query
 * @param executorId - ID of the executor
 * @returns Array of permission Things
 */
export async function getExecutorPermissions(
  graph: GraphStore,
  executorId: string
): Promise<GraphThing[]> {
  const relationships = await graph.queryRelationshipsFrom(executorId, {
    verb: 'hasPermission',
  })

  const permissions: GraphThing[] = []
  for (const rel of relationships) {
    const perm = await graph.getThing(rel.to)
    if (perm) {
      permissions.push(perm)
    }
  }

  return permissions
}

/**
 * Get all permissions required by a tool.
 *
 * @param graph - GraphStore to query
 * @param toolId - ID of the tool
 * @returns Array of permission Things
 */
export async function getToolPermissions(
  graph: GraphStore,
  toolId: string
): Promise<GraphThing[]> {
  const relationships = await graph.queryRelationshipsFrom(toolId, { verb: 'requires' })

  const permissions: GraphThing[] = []
  for (const rel of relationships) {
    const perm = await graph.getThing(rel.to)
    if (perm) {
      permissions.push(perm)
    }
  }

  return permissions
}
