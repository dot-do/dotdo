/**
 * Tool Permission Checker
 *
 * Graph-based permission checking for tool access control. Uses GraphEngine
 * to traverse Tool -> Permission -> Role -> Agent relationships.
 *
 * @module db/graph/tool-permission-checker
 * @see dotdo-2hiae - Digital Tools Graph Integration
 *
 * Permission model:
 * - Tool -[requires]-> Permission: Tool needs this permission
 * - Role -[grants]-> Permission: Role includes this permission
 * - Agent -[hasRole]-> Role: Agent has this role
 * - Agent -[hasPermission]-> Permission: Direct permission grant
 *
 * Security levels:
 * - public: All agents can use
 * - internal: Internal and system agents only
 * - restricted: Internal and system agents only (external blocked)
 * - critical: Only system agents
 */

import type { GraphEngine, Node, Edge } from './graph-engine'
import { GraphError } from './errors'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Security level for tools
 */
export type ToolSecurityLevel = 'public' | 'internal' | 'restricted' | 'critical'

/**
 * Agent type for security checks
 */
export type AgentType = 'internal' | 'external' | 'system'

/**
 * Result of a permission check
 */
export interface PermissionCheckResult {
  allowed: boolean
  missingPermissions?: string[]
  reason?: string
}

/**
 * Permission node with metadata
 */
export interface PermissionNode {
  id: string
  label: string
  properties: Record<string, unknown>
}

/**
 * Audit log entry for permission checks
 */
export interface PermissionCheckAuditLog {
  agentId: string
  toolId: string
  timestamp: number
  allowed: boolean
  reason?: string
}

/**
 * Options for ToolPermissionChecker constructor
 */
export interface ToolPermissionCheckerOptions {
  cacheEnabled?: boolean
  cacheTtlMs?: number
  onPermissionCheck?: (log: PermissionCheckAuditLog) => void
}

// ============================================================================
// ERROR
// ============================================================================

/**
 * Error thrown when permission is denied
 */
export class PermissionDeniedError extends GraphError {
  readonly agentId: string
  readonly toolId: string
  readonly missingPermissions?: string[]

  constructor(agentId: string, toolId: string, missingPermissions?: string[], reason?: string) {
    super(
      reason ?? `Permission denied: agent ${agentId} cannot use tool ${toolId}`,
      'PERMISSION_DENIED'
    )
    this.name = 'PermissionDeniedError'
    this.agentId = agentId
    this.toolId = toolId
    this.missingPermissions = missingPermissions
  }
}

// ============================================================================
// CACHE
// ============================================================================

interface CacheEntry {
  permissions: PermissionNode[]
  expiry: number
}

// ============================================================================
// TOOL PERMISSION CHECKER
// ============================================================================

/**
 * ToolPermissionChecker provides graph-based permission checking for tool access.
 *
 * It traverses the graph to determine if an agent has the required permissions
 * to use a tool based on:
 * 1. Direct permissions (Agent -[hasPermission]-> Permission)
 * 2. Role-based permissions (Agent -[hasRole]-> Role -[grants]-> Permission)
 * 3. Security level restrictions (Tool.securityLevel vs Agent.type)
 *
 * @example
 * ```typescript
 * const checker = new ToolPermissionChecker(graph)
 *
 * const result = await checker.canAgentUseTool('agent-1', 'tool:file_write')
 * if (!result.allowed) {
 *   console.log('Denied:', result.reason)
 * }
 * ```
 */
export class ToolPermissionChecker {
  private graph: GraphEngine
  private cacheEnabled: boolean
  private cacheTtlMs: number
  private cache: Map<string, CacheEntry>
  private onPermissionCheck?: (log: PermissionCheckAuditLog) => void

  constructor(graph: GraphEngine, options?: ToolPermissionCheckerOptions) {
    this.graph = graph
    this.cacheEnabled = options?.cacheEnabled ?? false
    this.cacheTtlMs = options?.cacheTtlMs ?? 60000
    this.cache = new Map()
    this.onPermissionCheck = options?.onPermissionCheck
  }

  /**
   * Check if an agent can use a tool.
   *
   * Performs comprehensive permission checking including:
   * - Security level validation
   * - Permission expiration checks
   * - Role-based permission aggregation
   *
   * @param agentId - The agent ID to check
   * @param toolId - The tool ID to check access for
   * @returns Permission check result
   */
  async canAgentUseTool(agentId: string, toolId: string): Promise<PermissionCheckResult> {
    const now = Date.now()

    // Get tool and agent nodes
    const tool = await this.graph.getNode(toolId)
    const agent = await this.graph.getNode(agentId)

    if (!tool) {
      const result: PermissionCheckResult = {
        allowed: false,
        reason: `Tool not found: ${toolId}`,
      }
      this.logCheck(agentId, toolId, result)
      return result
    }

    if (!agent) {
      const result: PermissionCheckResult = {
        allowed: false,
        reason: `Agent not found: ${agentId}`,
      }
      this.logCheck(agentId, toolId, result)
      return result
    }

    // Check security level first
    const securityResult = this.checkSecurityLevel(tool, agent)
    if (!securityResult.allowed) {
      this.logCheck(agentId, toolId, securityResult)
      return securityResult
    }

    // Get required permissions for tool
    const requiredPermissions = await this.getToolRequiredPermissions(toolId)

    // If tool has no required permissions, allow access
    if (requiredPermissions.length === 0) {
      const result: PermissionCheckResult = { allowed: true }
      this.logCheck(agentId, toolId, result)
      return result
    }

    // Check for expired permissions first
    const expiredPermissions = await this.getExpiredPermissions(agentId, requiredPermissions)
    if (expiredPermissions.length > 0) {
      const result: PermissionCheckResult = {
        allowed: false,
        missingPermissions: expiredPermissions,
        reason: `Permission expired for: ${expiredPermissions.join(', ')}`,
      }
      this.logCheck(agentId, toolId, result)
      return result
    }

    // Get agent's permissions
    const agentPermissions = await this.getAgentPermissions(agentId)
    const agentPermissionIds = new Set(agentPermissions.map((p) => p.id))

    // Check if agent has all required permissions
    const missingPermissions: string[] = []
    for (const required of requiredPermissions) {
      if (!agentPermissionIds.has(required.id)) {
        missingPermissions.push(required.id)
      }
    }

    if (missingPermissions.length > 0) {
      const result: PermissionCheckResult = {
        allowed: false,
        missingPermissions,
        reason: `Missing required permissions: ${missingPermissions.join(', ')}`,
      }
      this.logCheck(agentId, toolId, result)
      return result
    }

    const result: PermissionCheckResult = { allowed: true }
    this.logCheck(agentId, toolId, result)
    return result
  }

  /**
   * Check permission and throw if denied.
   *
   * @param agentId - The agent ID to check
   * @param toolId - The tool ID to check access for
   * @throws PermissionDeniedError if permission is denied
   */
  async checkPermission(agentId: string, toolId: string): Promise<void> {
    const result = await this.canAgentUseTool(agentId, toolId)
    if (!result.allowed) {
      throw new PermissionDeniedError(agentId, toolId, result.missingPermissions, result.reason)
    }
  }

  /**
   * Get all permissions for an agent.
   *
   * Aggregates permissions from:
   * - Direct grants (Agent -[hasPermission]-> Permission)
   * - Role grants (Agent -[hasRole]-> Role -[grants]-> Permission)
   * - Inherited roles (Role -[inherits]-> Role -[grants]-> Permission)
   *
   * Filters out expired permissions.
   *
   * @param agentId - The agent ID
   * @returns Array of permission nodes
   */
  async getAgentPermissions(agentId: string): Promise<PermissionNode[]> {
    // Check cache first
    if (this.cacheEnabled) {
      const cached = this.cache.get(agentId)
      if (cached && cached.expiry > Date.now()) {
        return cached.permissions
      }
    }

    const now = Date.now()
    const permissionIds = new Set<string>()
    const permissions: PermissionNode[] = []

    // Get direct permissions
    const directPermissionEdges = await this.graph.queryEdges({
      from: agentId,
      type: 'hasPermission',
    })

    for (const edge of directPermissionEdges) {
      // Check expiration
      const expiresAt = edge.properties?.expiresAt as number | undefined
      if (expiresAt && expiresAt <= now) {
        continue // Skip expired permission
      }

      if (!permissionIds.has(edge.to)) {
        permissionIds.add(edge.to)
        const permNode = await this.graph.getNode(edge.to)
        if (permNode) {
          permissions.push({
            id: permNode.id,
            label: permNode.label,
            properties: permNode.properties,
          })
        }
      }
    }

    // Get role-based permissions
    const roleIds = await this.getAgentRoles(agentId)
    for (const roleId of roleIds) {
      const rolePermissions = await this.getRolePermissions(roleId)
      for (const perm of rolePermissions) {
        if (!permissionIds.has(perm.id)) {
          permissionIds.add(perm.id)
          permissions.push(perm)
        }
      }
    }

    // Cache result
    if (this.cacheEnabled) {
      this.cache.set(agentId, {
        permissions,
        expiry: Date.now() + this.cacheTtlMs,
      })
    }

    return permissions
  }

  /**
   * Get required permissions for a tool.
   *
   * @param toolId - The tool ID
   * @returns Array of required permission nodes
   */
  async getToolRequiredPermissions(toolId: string): Promise<PermissionNode[]> {
    const permissions: PermissionNode[] = []

    const requiresEdges = await this.graph.queryEdges({
      from: toolId,
      type: 'requires',
    })

    for (const edge of requiresEdges) {
      // Only include required permissions (not optional)
      if (edge.properties?.required === false) {
        continue
      }

      const permNode = await this.graph.getNode(edge.to)
      if (permNode) {
        permissions.push({
          id: permNode.id,
          label: permNode.label,
          properties: permNode.properties,
        })
      }
    }

    return permissions
  }

  /**
   * Check if agent has expired permissions that match required ones.
   * This detects the specific case where agent had the permission but it expired.
   *
   * @param agentId - The agent ID
   * @param requiredPermissions - Required permissions to check
   * @returns Array of permission IDs that have expired
   */
  async getExpiredPermissions(agentId: string, requiredPermissions: PermissionNode[]): Promise<string[]> {
    const now = Date.now()
    const expired: string[] = []
    const requiredIds = new Set(requiredPermissions.map((p) => p.id))

    // Check direct permissions for expiration
    const directPermissionEdges = await this.graph.queryEdges({
      from: agentId,
      type: 'hasPermission',
    })

    for (const edge of directPermissionEdges) {
      // Only check if this is a required permission
      if (!requiredIds.has(edge.to)) continue

      const expiresAt = edge.properties?.expiresAt as number | undefined
      if (expiresAt && expiresAt <= now) {
        expired.push(edge.to)
      }
    }

    return expired
  }

  /**
   * Invalidate cache for an agent.
   *
   * Call this when permissions change.
   *
   * @param agentId - The agent ID to invalidate
   */
  invalidateCache(agentId: string): void {
    this.cache.delete(agentId)
  }

  /**
   * Clear all cached data.
   */
  clearCache(): void {
    this.cache.clear()
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  /**
   * Check security level restrictions.
   */
  private checkSecurityLevel(tool: Node, agent: Node): PermissionCheckResult {
    const toolSecurityLevel = (tool.properties?.securityLevel as ToolSecurityLevel) ?? 'public'
    const agentType = (agent.properties?.type as AgentType) ?? 'external'

    // Public tools are accessible to all
    if (toolSecurityLevel === 'public') {
      return { allowed: true }
    }

    // Internal tools: block external agents
    if (toolSecurityLevel === 'internal') {
      if (agentType === 'external') {
        return {
          allowed: false,
          reason: 'External agents cannot use internal tools (security level restriction)',
        }
      }
      return { allowed: true }
    }

    // Restricted tools: block external agents
    if (toolSecurityLevel === 'restricted') {
      if (agentType === 'external') {
        return {
          allowed: false,
          reason: 'External agents cannot use restricted tools (security level restriction)',
        }
      }
      return { allowed: true }
    }

    // Critical tools: only system agents
    if (toolSecurityLevel === 'critical') {
      if (agentType !== 'system') {
        return {
          allowed: false,
          reason: 'Only system agents can use critical tools (security level restriction)',
        }
      }
      return { allowed: true }
    }

    return { allowed: true }
  }

  /**
   * Get all roles for an agent, including inherited roles.
   */
  private async getAgentRoles(agentId: string): Promise<string[]> {
    const roleIds = new Set<string>()

    // Get direct roles
    const roleEdges = await this.graph.queryEdges({
      from: agentId,
      type: 'hasRole',
    })

    for (const edge of roleEdges) {
      roleIds.add(edge.to)
    }

    // Expand inherited roles (BFS)
    const queue = Array.from(roleIds)
    while (queue.length > 0) {
      const roleId = queue.shift()!
      const inheritEdges = await this.graph.queryEdges({
        from: roleId,
        type: 'inherits',
      })

      for (const edge of inheritEdges) {
        if (!roleIds.has(edge.to)) {
          roleIds.add(edge.to)
          queue.push(edge.to)
        }
      }

      // Also check 'includes' relationship (role hierarchy)
      const includesEdges = await this.graph.queryEdges({
        from: roleId,
        type: 'includes',
      })

      for (const edge of includesEdges) {
        if (!roleIds.has(edge.to)) {
          roleIds.add(edge.to)
          queue.push(edge.to)
        }
      }
    }

    return Array.from(roleIds)
  }

  /**
   * Get permissions granted by a role.
   */
  private async getRolePermissions(roleId: string): Promise<PermissionNode[]> {
    const permissions: PermissionNode[] = []

    const grantEdges = await this.graph.queryEdges({
      from: roleId,
      type: 'grants',
    })

    for (const edge of grantEdges) {
      const permNode = await this.graph.getNode(edge.to)
      if (permNode) {
        permissions.push({
          id: permNode.id,
          label: permNode.label,
          properties: permNode.properties,
        })
      }
    }

    return permissions
  }

  /**
   * Log permission check for audit.
   */
  private logCheck(agentId: string, toolId: string, result: PermissionCheckResult): void {
    if (this.onPermissionCheck) {
      this.onPermissionCheck({
        agentId,
        toolId,
        timestamp: Date.now(),
        allowed: result.allowed,
        reason: result.reason,
      })
    }
  }
}
