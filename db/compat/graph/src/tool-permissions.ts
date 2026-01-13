/**
 * Tool Permission Enforcement via Graph
 *
 * Implements permission checking for tool invocations using graph relationships:
 * - Tool -[requires]-> Permission
 * - Agent -[hasPermission]-> Permission
 * - Agent -[hasRole]-> Role -[includesPermission]-> Permission
 *
 * Security levels: public < internal < restricted < critical
 *
 * @see dotdo-6tijv - Tool Permission Enforcement via Graph
 * @see dotdo-2hiae - Digital Tools Graph Integration (epic)
 *
 * @module db/compat/graph/src/tool-permissions
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Security levels in ascending order of restriction
 */
export type SecurityLevel = 'public' | 'internal' | 'restricted' | 'critical'

/**
 * Agent clearance levels (maps to security levels)
 */
export type ClearanceLevel = SecurityLevel

/**
 * Permission source type
 */
export type PermissionSource = 'direct' | 'role'

/**
 * Base graph schema interface
 */
export interface PermissionGraph {
  Tool?: Record<string, string>
  Permission?: Record<string, string>
  Agent?: Record<string, string>
  Role?: Record<string, string>
}

/**
 * Tool Thing data
 */
export interface Tool {
  id: string
  name?: string
  description?: string
  securityLevel?: SecurityLevel
  requiredScope?: string
  data?: Record<string, unknown>
}

/**
 * Permission Thing data
 */
export interface Permission {
  id: string
  type?: string
  resource: string
  scope?: string
  action?: 'allow' | 'deny'
  required?: boolean
  data?: Record<string, unknown>
}

/**
 * Agent Thing data
 */
export interface Agent {
  id: string
  name: string
  type?: 'internal' | 'external'
  trustedLevel?: 'trusted' | 'untrusted'
  clearanceLevel?: ClearanceLevel
  data?: Record<string, unknown>
}

/**
 * Role Thing data
 */
export interface Role {
  id: string
  name: string
  description?: string
  data?: Record<string, unknown>
}

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  id: string
  agentId: string
  toolId: string
  type: 'security-denial' | 'permission-denial' | 'invocation'
  reason?: string
  timestamp: number
  severity: 'low' | 'medium' | 'high'
}

/**
 * Permission conflict
 */
export interface PermissionConflict {
  resource: string
  allowPermission: string
  denyPermission: string
}

/**
 * Invocation result
 */
export interface InvocationResult {
  denied?: boolean
  executed: boolean
  reason?: string
  missingPermissions?: string[]
  securityViolation?: boolean
  requiredLevel?: SecurityLevel
  agentLevel?: string
  toolId?: string
  agentId?: string
  permissionSource?: PermissionSource
  roleId?: string
  fromCache?: boolean
  elevated?: boolean
  originalLevel?: ClearanceLevel
}

/**
 * Invoke options
 */
export interface InvokeOptions {
  executorId: string
  elevateLevel?: SecurityLevel
  approvalToken?: string
}

/**
 * Create relationship input
 */
export interface CreateRelationshipInput {
  verb: string
  from: string
  to: string
  data?: Record<string, unknown>
}

/**
 * Node wrapper with traversal capabilities
 */
export interface NodeWrapper<T> {
  id: string
  data: T
  $: TraversalProxy
}

/**
 * Traversal proxy for relationship traversal
 */
export interface TraversalProxy {
  [key: string]: {
    toArray: () => Promise<NodeWrapper<Record<string, unknown>>[]>
    where: (condition: Record<string, unknown>) => {
      toArray: () => Promise<NodeWrapper<Record<string, unknown>>[]>
    }
  }
}

/**
 * Node type accessor
 */
export interface NodeTypeAccessor<T> {
  create: (input: { data: Partial<T> }) => Promise<NodeWrapper<T>>
  get: (id: string) => NodeWrapper<T> & { $: TraversalProxy }
}

/**
 * Permission graph client interface
 */
export interface PermissionGraphClient<T extends PermissionGraph> {
  Tool: NodeTypeAccessor<Tool>
  Permission: NodeTypeAccessor<Permission>
  Agent: NodeTypeAccessor<Agent>
  Role: NodeTypeAccessor<Role>
  createRelationship: (input: CreateRelationshipInput) => Promise<void>
  getAvailableTools: (agentId: string) => Promise<NodeWrapper<Tool>[]>
  getAuditLog: (query: { agentId?: string; toolId?: string; type?: string }) => Promise<AuditLogEntry[]>
  checkPermissionConflicts: (agentId: string) => Promise<PermissionConflict[]>
}

/**
 * Permission graph options
 */
export interface PermissionGraphOptions {
  namespace: string
}

// ============================================================================
// SECURITY LEVEL ORDERING
// ============================================================================

const SECURITY_LEVEL_ORDER: Record<SecurityLevel, number> = {
  public: 0,
  internal: 1,
  restricted: 2,
  critical: 3,
}

function hasRequiredSecurityLevel(agentLevel: ClearanceLevel, toolLevel: SecurityLevel): boolean {
  return SECURITY_LEVEL_ORDER[agentLevel] >= SECURITY_LEVEL_ORDER[toolLevel]
}

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

interface StoredNode {
  id: string
  type: string
  data: Record<string, unknown>
}

interface StoredRelationship {
  id: string
  verb: string
  from: string
  to: string
  data?: Record<string, unknown>
}

// ============================================================================
// PERMISSION GRAPH FACTORY
// ============================================================================

/**
 * Create a permission graph client for managing tool permissions
 */
export function createPermissionGraph<T extends PermissionGraph>(
  _options: PermissionGraphOptions
): PermissionGraphClient<T> {
  // In-memory storage
  const nodes = new Map<string, StoredNode>()
  const relationships = new Map<string, StoredRelationship>()
  const auditLog: AuditLogEntry[] = []

  let nodeIdCounter = 0
  let relIdCounter = 0

  function generateNodeId(type: string): string {
    nodeIdCounter++
    return `${type.toLowerCase()}-${Date.now()}-${nodeIdCounter}`
  }

  function generateRelId(): string {
    relIdCounter++
    return `rel-${Date.now()}-${relIdCounter}`
  }

  /**
   * Create a node wrapper with traversal capabilities
   */
  function createNodeWrapper<N>(node: StoredNode): NodeWrapper<N> {
    const traversalProxy = new Proxy({} as TraversalProxy, {
      get: (_target, prop: string) => {
        return {
          toArray: async () => {
            const results: NodeWrapper<Record<string, unknown>>[] = []

            for (const rel of relationships.values()) {
              if (rel.from === node.id && rel.verb === prop) {
                const targetNode = nodes.get(rel.to)
                if (targetNode) {
                  results.push(createNodeWrapper(targetNode))
                }
              }
              // Reverse relationship (e.g., grantedTo is reverse of hasPermission)
              if (rel.to === node.id && getReverseVerb(rel.verb) === prop) {
                const sourceNode = nodes.get(rel.from)
                if (sourceNode) {
                  results.push(createNodeWrapper(sourceNode))
                }
              }
            }

            return results
          },
          where: (condition: Record<string, unknown>) => ({
            toArray: async () => {
              const results: NodeWrapper<Record<string, unknown>>[] = []

              for (const rel of relationships.values()) {
                if (rel.from === node.id && rel.verb === prop) {
                  // Check relationship data condition
                  const relDataMatch = Object.entries(condition).every(([key, value]) => {
                    if (key.startsWith('relationship.')) {
                      const relKey = key.replace('relationship.', '')
                      return rel.data?.[relKey] === value
                    }
                    return true
                  })

                  if (relDataMatch) {
                    const targetNode = nodes.get(rel.to)
                    if (targetNode) {
                      results.push(createNodeWrapper(targetNode))
                    }
                  }
                }
              }

              return results
            },
          }),
        }
      },
    })

    return {
      id: node.id,
      data: node.data as N,
      $: traversalProxy,
    }
  }

  /**
   * Get reverse verb for bidirectional traversal
   */
  function getReverseVerb(verb: string): string {
    const reverseMap: Record<string, string> = {
      requires: 'requiredBy',
      hasPermission: 'grantedTo',
      hasRole: 'assignedTo',
      includesPermission: 'includedIn',
      inheritsFrom: 'inheritsFrom', // Symmetric
    }
    return reverseMap[verb] || verb
  }

  /**
   * Create a node type accessor
   */
  function createNodeTypeAccessor<N>(typeName: string): NodeTypeAccessor<N> {
    return {
      create: async (input: { data: Partial<N> }) => {
        const id = (input.data as Record<string, unknown>).id as string || generateNodeId(typeName)
        const node: StoredNode = {
          id,
          type: typeName,
          data: { id, ...input.data },
        }
        nodes.set(id, node)
        return createNodeWrapper<N>(node)
      },
      get: (id: string) => {
        const node = nodes.get(id)
        if (!node) {
          // Return a wrapper that will work for traversal even if node doesn't exist
          const emptyNode: StoredNode = { id, type: typeName, data: { id } }
          return createNodeWrapper<N>(emptyNode)
        }
        return createNodeWrapper<N>(node)
      },
    }
  }

  /**
   * Get all permissions for an agent (direct + via roles)
   */
  async function getEffectivePermissions(agentId: string): Promise<Permission[]> {
    const permissions = new Map<string, Permission>()

    // Direct permissions
    for (const rel of relationships.values()) {
      if (rel.from === agentId && rel.verb === 'hasPermission') {
        const permNode = nodes.get(rel.to)
        if (permNode) {
          permissions.set(permNode.id, permNode.data as Permission)
        }
      }
    }

    // Permissions via roles (with hierarchy)
    const visitedRoles = new Set<string>()
    const rolesToProcess: string[] = []

    // Find direct roles
    for (const rel of relationships.values()) {
      if (rel.from === agentId && rel.verb === 'hasRole') {
        rolesToProcess.push(rel.to)
      }
    }

    // Process role hierarchy
    while (rolesToProcess.length > 0) {
      const roleId = rolesToProcess.pop()!
      if (visitedRoles.has(roleId)) continue
      visitedRoles.add(roleId)

      // Get permissions from this role
      for (const rel of relationships.values()) {
        if (rel.from === roleId && rel.verb === 'includesPermission') {
          const permNode = nodes.get(rel.to)
          if (permNode && !permissions.has(permNode.id)) {
            permissions.set(permNode.id, permNode.data as Permission)
          }
        }

        // Check for inherited roles
        if (rel.from === roleId && rel.verb === 'inheritsFrom') {
          if (!visitedRoles.has(rel.to)) {
            rolesToProcess.push(rel.to)
          }
        }
      }
    }

    return Array.from(permissions.values())
  }

  /**
   * Get available tools for an agent based on permissions
   */
  async function getAvailableTools(agentId: string): Promise<NodeWrapper<Tool>[]> {
    const agentPermissions = await getEffectivePermissions(agentId)
    const agentPermissionIds = new Set(agentPermissions.map(p => p.id))
    const availableTools: NodeWrapper<Tool>[] = []

    // Check each tool
    for (const node of nodes.values()) {
      if (node.type !== 'Tool') continue

      // Get required permissions for this tool
      const requiredPermissions: string[] = []
      for (const rel of relationships.values()) {
        if (rel.from === node.id && rel.verb === 'requires') {
          requiredPermissions.push(rel.to)
        }
      }

      // Check if agent has all required permissions
      const hasAllPermissions = requiredPermissions.every(permId =>
        agentPermissionIds.has(permId)
      )

      if (hasAllPermissions || requiredPermissions.length === 0) {
        availableTools.push(createNodeWrapper<Tool>(node))
      }
    }

    return availableTools
  }

  return {
    Tool: createNodeTypeAccessor<Tool>('Tool'),
    Permission: createNodeTypeAccessor<Permission>('Permission'),
    Agent: createNodeTypeAccessor<Agent>('Agent'),
    Role: createNodeTypeAccessor<Role>('Role'),

    createRelationship: async (input: CreateRelationshipInput) => {
      const rel: StoredRelationship = {
        id: generateRelId(),
        verb: input.verb,
        from: input.from,
        to: input.to,
        data: input.data,
      }
      relationships.set(rel.id, rel)
    },

    getAvailableTools,

    getAuditLog: async (query: { agentId?: string; toolId?: string; type?: string }) => {
      return auditLog.filter(entry => {
        if (query.agentId && entry.agentId !== query.agentId) return false
        if (query.toolId && entry.toolId !== query.toolId) return false
        if (query.type && entry.type !== query.type) return false
        return true
      })
    },

    checkPermissionConflicts: async (agentId: string) => {
      const permissions = await getEffectivePermissions(agentId)
      const conflicts: PermissionConflict[] = []

      // Group by resource
      const byResource = new Map<string, Permission[]>()
      for (const perm of permissions) {
        const resource = perm.resource
        if (!byResource.has(resource)) {
          byResource.set(resource, [])
        }
        byResource.get(resource)!.push(perm)
      }

      // Check for allow/deny conflicts
      for (const [resource, perms] of byResource) {
        const allows = perms.filter(p => p.action === 'allow')
        const denies = perms.filter(p => p.action === 'deny')

        for (const allow of allows) {
          for (const deny of denies) {
            conflicts.push({
              resource,
              allowPermission: allow.id,
              denyPermission: deny.id,
            })
          }
        }
      }

      return conflicts
    },
  }
}

// ============================================================================
// TOOL EXECUTOR CLASS
// ============================================================================

/**
 * Executes tool invocations with permission checking
 */
export class ToolExecutor<T extends PermissionGraph> {
  private graph: PermissionGraphClient<T>
  private permissionCache = new Map<string, { permissions: Permission[]; timestamp: number }>()
  private auditLog: AuditLogEntry[] = []
  private static CACHE_TTL = 60000 // 1 minute cache

  constructor(graph: PermissionGraphClient<T>) {
    this.graph = graph
  }

  /**
   * Invoke a tool with permission checking
   */
  async invoke(
    toolId: string,
    _input: Record<string, unknown>,
    options: InvokeOptions
  ): Promise<InvocationResult> {
    const { executorId, elevateLevel, approvalToken } = options

    // Get tool
    const tool = this.graph.Tool.get(toolId)
    const toolData = tool.data as Tool

    // Get agent
    const agent = this.graph.Agent.get(executorId)
    const agentData = agent.data as Agent

    // Check security level first
    const toolSecurityLevel = toolData.securityLevel || 'public'
    let agentClearanceLevel = agentData.clearanceLevel ||
      (agentData.type === 'external' ? 'public' : 'internal')

    // Handle elevation
    if (elevateLevel && approvalToken) {
      // Validate approval token (simplified - in production would verify signature)
      if (approvalToken === 'valid-approval-token') {
        agentClearanceLevel = elevateLevel

        return {
          denied: false,
          executed: true,
          elevated: true,
          originalLevel: agentData.clearanceLevel || 'public',
          toolId,
          agentId: executorId,
        }
      }
    }

    if (!hasRequiredSecurityLevel(agentClearanceLevel, toolSecurityLevel)) {
      // Log security denial
      this.auditLog.push({
        id: `audit-${Date.now()}`,
        agentId: executorId,
        toolId,
        type: 'security-denial',
        reason: `Agent clearance level '${agentClearanceLevel}' insufficient for tool security level '${toolSecurityLevel}'`,
        timestamp: Date.now(),
        severity: 'high',
      })

      return {
        denied: true,
        executed: false,
        reason: `Security level violation: tool requires '${toolSecurityLevel}' but agent has '${agentClearanceLevel}'`,
        securityViolation: true,
        requiredLevel: toolSecurityLevel,
        agentLevel: agentData.type || 'unknown',
        toolId,
        agentId: executorId,
      }
    }

    // Get required permissions for tool
    const requiredPermissions = await tool.$.requires.toArray()

    if (requiredPermissions.length === 0) {
      // No permissions required
      return {
        denied: false,
        executed: true,
        toolId,
        agentId: executorId,
      }
    }

    // Check permission cache
    const cached = this.permissionCache.get(executorId)
    let agentPermissions: Permission[]
    let fromCache = false

    if (cached && Date.now() - cached.timestamp < ToolExecutor.CACHE_TTL) {
      agentPermissions = cached.permissions
      fromCache = true
    } else {
      agentPermissions = await this.getEffectivePermissions(executorId)
      this.permissionCache.set(executorId, {
        permissions: agentPermissions,
        timestamp: Date.now(),
      })
    }

    const agentPermissionIds = new Set(agentPermissions.map(p => p.id))

    // Check for missing permissions
    const missingPermissions: string[] = []
    let permissionSource: PermissionSource = 'direct'
    let roleId: string | undefined

    for (const reqPerm of requiredPermissions) {
      if (!agentPermissionIds.has(reqPerm.id)) {
        missingPermissions.push(reqPerm.id)
      }
    }

    if (missingPermissions.length > 0) {
      return {
        denied: true,
        executed: false,
        reason: `Missing required permissions for tool '${toolId}'`,
        missingPermissions,
        toolId,
        agentId: executorId,
      }
    }

    // Check if permission came from a role
    const directPermissions = await this.getDirectPermissions(executorId)
    const directPermissionIds = new Set(directPermissions.map(p => p.id))

    for (const reqPerm of requiredPermissions) {
      if (!directPermissionIds.has(reqPerm.id)) {
        permissionSource = 'role'
        // Find which role provided this permission
        roleId = await this.findRoleWithPermission(executorId, reqPerm.id)
        break
      }
    }

    return {
      denied: false,
      executed: true,
      permissionSource,
      roleId,
      fromCache,
      toolId,
      agentId: executorId,
    }
  }

  /**
   * Get all effective permissions for an agent (direct + via roles with hierarchy)
   */
  async getEffectivePermissions(agentId: string): Promise<Permission[]> {
    const permissions = new Map<string, Permission>()

    // Direct permissions
    const agent = this.graph.Agent.get(agentId)
    const directPerms = await agent.$.hasPermission.toArray()
    for (const perm of directPerms) {
      permissions.set(perm.id, perm.data as Permission)
    }

    // Permissions via roles (with hierarchy)
    const roles = await agent.$.hasRole.toArray()
    const visitedRoles = new Set<string>()
    const rolesToProcess = roles.map(r => r.id)

    while (rolesToProcess.length > 0) {
      const roleId = rolesToProcess.pop()!
      if (visitedRoles.has(roleId)) continue
      visitedRoles.add(roleId)

      const role = this.graph.Role.get(roleId)
      const rolePerms = await role.$.includesPermission.toArray()

      for (const perm of rolePerms) {
        if (!permissions.has(perm.id)) {
          permissions.set(perm.id, perm.data as Permission)
        }
      }

      // Check for inherited roles
      const inheritedRoles = await role.$.inheritsFrom.toArray()
      for (const inherited of inheritedRoles) {
        if (!visitedRoles.has(inherited.id)) {
          rolesToProcess.push(inherited.id)
        }
      }
    }

    return Array.from(permissions.values())
  }

  /**
   * Get only direct permissions (not via roles)
   */
  private async getDirectPermissions(agentId: string): Promise<Permission[]> {
    const agent = this.graph.Agent.get(agentId)
    const perms = await agent.$.hasPermission.toArray()
    return perms.map(p => p.data as Permission)
  }

  /**
   * Find which role provides a specific permission
   */
  private async findRoleWithPermission(agentId: string, permissionId: string): Promise<string | undefined> {
    const agent = this.graph.Agent.get(agentId)
    const roles = await agent.$.hasRole.toArray()

    for (const role of roles) {
      const rolePerms = await this.graph.Role.get(role.id).$.includesPermission.toArray()
      if (rolePerms.some(p => p.id === permissionId)) {
        return role.id
      }
    }

    return undefined
  }
}
