/**
 * Tool Permission Enforcement via Graph Tests
 *
 * TDD RED Phase: Tests for tool permission checking via Tool -> Permission relationships.
 * Uses graph relationships to model permission enforcement.
 *
 * Domain model:
 * - Tool (node): A callable capability with name, description, security level
 * - Permission (node): An access grant with scope and constraints
 * - Agent (node): An AI agent or human with identity and role
 * - Role (node): A named set of permissions (admin, developer, viewer)
 *
 * Relationships:
 * - Tool -[requires]-> Permission: Tool needs this permission to execute
 * - Agent -[hasRole]-> Role: Agent has this role
 * - Role -[grants]-> Permission: Role includes this permission
 * - Agent -[hasPermission]-> Permission: Direct permission grant to agent
 *
 * Uses real SQLite, NO MOCKS - per project testing philosophy.
 *
 * @see dotdo-m6ymf - [RED] Tool Permission Enforcement via Graph Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GraphEngine, type Node, type Edge } from '../index'

// ============================================================================
// Types for Tool Permission Model
// ============================================================================

/**
 * Security level for tools - determines access restrictions
 */
type SecurityLevel = 'public' | 'internal' | 'restricted' | 'critical'

/**
 * Permission scope - what the permission grants access to
 */
type PermissionScope = 'read' | 'write' | 'execute' | 'admin'

/**
 * Agent type - internal vs external agents have different trust levels
 */
type AgentType = 'internal' | 'external' | 'system'

/**
 * Permission constraints on Tool -> Permission edge relationship
 */
interface PermissionConstraints {
  maxRowsReturned?: number
  allowedTables?: string[]
  deniedColumns?: string[]
}

/**
 * Node representing a permission with an ID
 */
interface PermissionNode {
  id: string
  label: string
  properties: Record<string, unknown>
}

/**
 * Audit log entry for permission check callbacks
 */
interface PermissionCheckAuditLog {
  agentId: string
  toolId: string
  timestamp: number
  allowed: boolean
  reason?: string
}

/**
 * Result of a permission check operation
 */
interface PermissionCheckResult {
  allowed: boolean
  missingPermissions?: string[]
  reason?: string
}

/**
 * Options for ToolPermissionChecker constructor
 */
interface ToolPermissionCheckerOptions {
  cacheEnabled?: boolean
  cacheTtlMs?: number
  onPermissionCheck?: (log: PermissionCheckAuditLog) => void
}

/**
 * Interface for ToolPermissionChecker (TDD - will be implemented)
 */
interface ToolPermissionCheckerInstance {
  canAgentUseTool(agentId: string, toolId: string): Promise<PermissionCheckResult>
  checkPermission(agentId: string, toolId: string): Promise<void>
  getAgentPermissions(agentId: string): Promise<PermissionNode[]>
  getToolRequiredPermissions(toolId: string): Promise<PermissionNode[]>
  invalidateCache(agentId: string): void
}

// ============================================================================
// 1. Tool Permission Relationships Tests
// ============================================================================

describe('Tool Permission Relationships', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  describe('Tool requires Permission relationship', () => {
    it('creates Tool requires Permission relationship', async () => {
      // Create Tool node
      const tool = await graph.createNode('Tool', {
        name: 'file_write',
        description: 'Write content to a file',
        securityLevel: 'internal' as SecurityLevel,
      })

      // Create Permission node
      const permission = await graph.createNode('Permission', {
        name: 'filesystem.write',
        scope: 'write' as PermissionScope,
        resource: 'filesystem',
      })

      // Create requires relationship
      const edge = await graph.createEdge(tool.id, 'requires', permission.id, {
        required: true,
        reason: 'File write operations require filesystem write permission',
      })

      expect(edge).toBeDefined()
      expect(edge.type).toBe('requires')
      expect(edge.from).toBe(tool.id)
      expect(edge.to).toBe(permission.id)
      expect(edge.properties.required).toBe(true)
    })

    it('supports multiple permission requirements', async () => {
      const tool = await graph.createNode('Tool', {
        name: 'git_commit',
        description: 'Commit changes to git repository',
        securityLevel: 'internal' as SecurityLevel,
      })

      const fsWritePermission = await graph.createNode('Permission', {
        name: 'filesystem.write',
        scope: 'write' as PermissionScope,
        resource: 'filesystem',
      })

      const gitPermission = await graph.createNode('Permission', {
        name: 'git.write',
        scope: 'write' as PermissionScope,
        resource: 'git',
      })

      // Tool requires both permissions
      await graph.createEdge(tool.id, 'requires', fsWritePermission.id, { required: true })
      await graph.createEdge(tool.id, 'requires', gitPermission.id, { required: true })

      // Query required permissions
      const requiredEdges = await graph.queryEdges({ from: tool.id, type: 'requires' })

      expect(requiredEdges).toHaveLength(2)
    })

    it('supports optional vs required permissions', async () => {
      const tool = await graph.createNode('Tool', {
        name: 'shell_execute',
        description: 'Execute shell commands',
        securityLevel: 'restricted' as SecurityLevel,
      })

      const shellPermission = await graph.createNode('Permission', {
        name: 'shell.execute',
        scope: 'execute' as PermissionScope,
        resource: 'shell',
      })

      const loggingPermission = await graph.createNode('Permission', {
        name: 'logging.write',
        scope: 'write' as PermissionScope,
        resource: 'logging',
      })

      // Shell permission is required, logging is optional
      await graph.createEdge(tool.id, 'requires', shellPermission.id, {
        required: true,
        reason: 'Shell execution requires shell permission',
      })

      await graph.createEdge(tool.id, 'requires', loggingPermission.id, {
        required: false,
        reason: 'Logging is optional for audit purposes',
      })

      // Query and filter by required status
      const edges = await graph.queryEdges({ from: tool.id, type: 'requires' })
      const requiredPermissions = edges.filter((e) => e.properties.required === true)
      const optionalPermissions = edges.filter((e) => e.properties.required === false)

      expect(requiredPermissions).toHaveLength(1)
      expect(optionalPermissions).toHaveLength(1)
    })

    it('tracks permission constraints on relationship', async () => {
      const tool = await graph.createNode('Tool', {
        name: 'database_query',
        description: 'Query database',
        securityLevel: 'internal' as SecurityLevel,
      })

      const dbPermission = await graph.createNode('Permission', {
        name: 'database.read',
        scope: 'read' as PermissionScope,
        resource: 'database',
      })

      // Permission with constraints
      const edge = await graph.createEdge(tool.id, 'requires', dbPermission.id, {
        required: true,
        constraints: {
          maxRowsReturned: 1000,
          allowedTables: ['users', 'products'],
          deniedColumns: ['password_hash', 'api_key'],
        },
      })

      expect(edge.properties.constraints).toBeDefined()
      const constraints = edge.properties.constraints as PermissionConstraints
      expect(constraints.maxRowsReturned).toBe(1000)
      expect(constraints.allowedTables).toContain('users')
    })
  })
})

// ============================================================================
// 2. Permission Enforcement Tests
// ============================================================================

describe('Permission Enforcement', () => {
  let graph: GraphEngine
  let fileWriteTool: Node
  let fsWritePermission: Node
  let internalAgent: Node
  let externalAgent: Node
  let developerRole: Node

  beforeEach(async () => {
    graph = new GraphEngine()

    // Create tool
    fileWriteTool = await graph.createNode('Tool', {
      name: 'file_write',
      description: 'Write content to files',
      securityLevel: 'internal' as SecurityLevel,
    })

    // Create permission
    fsWritePermission = await graph.createNode('Permission', {
      name: 'filesystem.write',
      scope: 'write' as PermissionScope,
      resource: 'filesystem',
    })

    // Tool requires permission
    await graph.createEdge(fileWriteTool.id, 'requires', fsWritePermission.id, {
      required: true,
    })

    // Create role
    developerRole = await graph.createNode('Role', {
      name: 'developer',
      description: 'Software developer with write access',
    })

    // Role grants permission
    await graph.createEdge(developerRole.id, 'grants', fsWritePermission.id)

    // Create agents
    internalAgent = await graph.createNode('Agent', {
      name: 'ralph',
      type: 'internal' as AgentType,
      description: 'Internal development agent',
    })

    externalAgent = await graph.createNode('Agent', {
      name: 'external-api-agent',
      type: 'external' as AgentType,
      description: 'External API integration agent',
    })

    // Internal agent has developer role
    await graph.createEdge(internalAgent.id, 'hasRole', developerRole.id)
  })

  it('blocks invocation without permission', async () => {
    // External agent has no roles or permissions
    // Check if agent can use tool by traversing graph

    // Get required permissions for tool
    const requiredEdges = await graph.queryEdges({
      from: fileWriteTool.id,
      type: 'requires',
    })
    const requiredPermissionIds = requiredEdges
      .filter((e) => e.properties.required === true)
      .map((e) => e.to)

    // Get agent's direct permissions
    const directPermissionEdges = await graph.queryEdges({
      from: externalAgent.id,
      type: 'hasPermission',
    })
    const directPermissionIds = directPermissionEdges.map((e) => e.to)

    // Get agent's role-based permissions
    const roleEdges = await graph.queryEdges({
      from: externalAgent.id,
      type: 'hasRole',
    })
    const roleIds = roleEdges.map((e) => e.to)

    let rolePermissionIds: string[] = []
    for (const roleId of roleIds) {
      const grantEdges = await graph.queryEdges({ from: roleId, type: 'grants' })
      rolePermissionIds = [...rolePermissionIds, ...grantEdges.map((e) => e.to)]
    }

    // Combine all agent permissions
    const agentPermissionIds = [...directPermissionIds, ...rolePermissionIds]

    // Check if agent has all required permissions
    const hasAllPermissions = requiredPermissionIds.every((permId) =>
      agentPermissionIds.includes(permId)
    )

    // External agent should NOT have permission
    expect(hasAllPermissions).toBe(false)
  })

  it('allows invocation with permission', async () => {
    // Internal agent has developer role -> grants filesystem.write permission

    // Get required permissions for tool
    const requiredEdges = await graph.queryEdges({
      from: fileWriteTool.id,
      type: 'requires',
    })
    const requiredPermissionIds = requiredEdges
      .filter((e) => e.properties.required === true)
      .map((e) => e.to)

    // Get agent's role-based permissions
    const roleEdges = await graph.queryEdges({
      from: internalAgent.id,
      type: 'hasRole',
    })
    const roleIds = roleEdges.map((e) => e.to)

    let rolePermissionIds: string[] = []
    for (const roleId of roleIds) {
      const grantEdges = await graph.queryEdges({ from: roleId, type: 'grants' })
      rolePermissionIds = [...rolePermissionIds, ...grantEdges.map((e) => e.to)]
    }

    // Check if agent has all required permissions
    const hasAllPermissions = requiredPermissionIds.every((permId) =>
      rolePermissionIds.includes(permId)
    )

    // Internal agent should have permission
    expect(hasAllPermissions).toBe(true)
  })

  it('checks inherited permissions via roles', async () => {
    // Create a role hierarchy: admin -> developer
    const adminRole = await graph.createNode('Role', {
      name: 'admin',
      description: 'Administrator with all permissions',
    })

    // Admin role includes developer role
    await graph.createEdge(adminRole.id, 'includes', developerRole.id)

    // Create admin permission
    const adminPermission = await graph.createNode('Permission', {
      name: 'admin.manage',
      scope: 'admin' as PermissionScope,
      resource: 'system',
    })

    // Admin role grants admin permission
    await graph.createEdge(adminRole.id, 'grants', adminPermission.id)

    // Assign admin role to internal agent
    await graph.createEdge(internalAgent.id, 'hasRole', adminRole.id)

    // Check if agent has inherited permissions through role hierarchy
    // Agent -> hasRole -> admin -> includes -> developer -> grants -> fsWritePermission

    const roleEdges = await graph.queryEdges({
      from: internalAgent.id,
      type: 'hasRole',
    })
    const directRoleIds = roleEdges.map((e) => e.to)

    // Get included roles (role hierarchy)
    let allRoleIds = [...directRoleIds]
    for (const roleId of directRoleIds) {
      const includesEdges = await graph.queryEdges({ from: roleId, type: 'includes' })
      allRoleIds = [...allRoleIds, ...includesEdges.map((e) => e.to)]
    }

    // Get all permissions from all roles
    let allPermissionIds: string[] = []
    for (const roleId of allRoleIds) {
      const grantEdges = await graph.queryEdges({ from: roleId, type: 'grants' })
      allPermissionIds = [...allPermissionIds, ...grantEdges.map((e) => e.to)]
    }

    // Agent should have both admin and filesystem permissions
    expect(allPermissionIds).toContain(adminPermission.id)
    expect(allPermissionIds).toContain(fsWritePermission.id)
  })

  it('supports direct permission grants to agents', async () => {
    // Grant permission directly to external agent (bypassing roles)
    await graph.createEdge(externalAgent.id, 'hasPermission', fsWritePermission.id, {
      grantedBy: 'system',
      grantedAt: Date.now(),
      expiresAt: Date.now() + 86400000, // 24 hours
      reason: 'Temporary access for migration',
    })

    // Get direct permissions
    const directPermissionEdges = await graph.queryEdges({
      from: externalAgent.id,
      type: 'hasPermission',
    })

    expect(directPermissionEdges).toHaveLength(1)
    expect(directPermissionEdges[0].to).toBe(fsWritePermission.id)
    expect(directPermissionEdges[0].properties.expiresAt).toBeDefined()
  })

  it('validates permission expiration', async () => {
    // Grant expired permission
    const pastTime = Date.now() - 86400000 // 24 hours ago
    await graph.createEdge(externalAgent.id, 'hasPermission', fsWritePermission.id, {
      grantedAt: pastTime - 86400000,
      expiresAt: pastTime,
      reason: 'Expired temporary access',
    })

    // Get direct permissions and check expiration
    const directPermissionEdges = await graph.queryEdges({
      from: externalAgent.id,
      type: 'hasPermission',
    })

    const now = Date.now()
    const validPermissions = directPermissionEdges.filter((e) => {
      const expiresAt = e.properties.expiresAt as number | undefined
      return !expiresAt || expiresAt > now
    })

    // Expired permission should not be valid
    expect(validPermissions).toHaveLength(0)
  })
})

// ============================================================================
// 3. Security Level Enforcement Tests
// ============================================================================

describe('Security Level Enforcement', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  it('blocks restricted tools for external agents', async () => {
    // Create restricted tool
    const restrictedTool = await graph.createNode('Tool', {
      name: 'shell_execute',
      description: 'Execute shell commands',
      securityLevel: 'restricted' as SecurityLevel,
    })

    // Create external agent
    const externalAgent = await graph.createNode('Agent', {
      name: 'api-agent',
      type: 'external' as AgentType,
    })

    // Check security level constraint
    const toolSecurityLevel = restrictedTool.properties.securityLevel as SecurityLevel
    const agentType = externalAgent.properties.type as AgentType

    // Security policy: external agents cannot use restricted tools
    const securityLevelAllowed = !(
      agentType === 'external' &&
      (toolSecurityLevel === 'restricted' || toolSecurityLevel === 'critical')
    )

    expect(securityLevelAllowed).toBe(false)
  })

  it('allows restricted tools for internal agents', async () => {
    // Create restricted tool
    const restrictedTool = await graph.createNode('Tool', {
      name: 'shell_execute',
      description: 'Execute shell commands',
      securityLevel: 'restricted' as SecurityLevel,
    })

    // Create internal agent
    const internalAgent = await graph.createNode('Agent', {
      name: 'ralph',
      type: 'internal' as AgentType,
    })

    // Check security level constraint
    const toolSecurityLevel = restrictedTool.properties.securityLevel as SecurityLevel
    const agentType = internalAgent.properties.type as AgentType

    // Security policy: internal agents can use restricted tools
    const securityLevelAllowed = !(
      agentType === 'external' &&
      (toolSecurityLevel === 'restricted' || toolSecurityLevel === 'critical')
    )

    expect(securityLevelAllowed).toBe(true)
  })

  it('blocks critical tools for non-system agents', async () => {
    // Create critical tool
    const criticalTool = await graph.createNode('Tool', {
      name: 'database_migrate',
      description: 'Run database migrations',
      securityLevel: 'critical' as SecurityLevel,
    })

    // Create internal agent (not system)
    const internalAgent = await graph.createNode('Agent', {
      name: 'ralph',
      type: 'internal' as AgentType,
    })

    // Create system agent
    const systemAgent = await graph.createNode('Agent', {
      name: 'migration-service',
      type: 'system' as AgentType,
    })

    const toolSecurityLevel = criticalTool.properties.securityLevel as SecurityLevel

    // Security policy: only system agents can use critical tools
    const internalAllowed = !(
      toolSecurityLevel === 'critical' &&
      (internalAgent.properties.type as AgentType) !== 'system'
    )

    const systemAllowed = !(
      toolSecurityLevel === 'critical' &&
      (systemAgent.properties.type as AgentType) !== 'system'
    )

    expect(internalAllowed).toBe(false)
    expect(systemAllowed).toBe(true)
  })

  it('allows public tools for all agents', async () => {
    // Create public tool
    const publicTool = await graph.createNode('Tool', {
      name: 'text_format',
      description: 'Format text content',
      securityLevel: 'public' as SecurityLevel,
    })

    // Create agents of each type
    const externalAgent = await graph.createNode('Agent', {
      name: 'api-agent',
      type: 'external' as AgentType,
    })

    const internalAgent = await graph.createNode('Agent', {
      name: 'ralph',
      type: 'internal' as AgentType,
    })

    const systemAgent = await graph.createNode('Agent', {
      name: 'formatter-service',
      type: 'system' as AgentType,
    })

    const toolSecurityLevel = publicTool.properties.securityLevel as SecurityLevel

    // Security policy: public tools are available to all
    const checkAccess = (agentType: AgentType) => toolSecurityLevel === 'public'

    expect(checkAccess(externalAgent.properties.type as AgentType)).toBe(true)
    expect(checkAccess(internalAgent.properties.type as AgentType)).toBe(true)
    expect(checkAccess(systemAgent.properties.type as AgentType)).toBe(true)
  })

  it('logs security denials for audit', async () => {
    // Create restricted tool
    const restrictedTool = await graph.createNode('Tool', {
      name: 'shell_execute',
      description: 'Execute shell commands',
      securityLevel: 'restricted' as SecurityLevel,
    })

    // Create external agent
    const externalAgent = await graph.createNode('Agent', {
      name: 'api-agent',
      type: 'external' as AgentType,
    })

    // Simulate access attempt and denial
    const accessAttempt = {
      timestamp: Date.now(),
      agentId: externalAgent.id,
      toolId: restrictedTool.id,
      allowed: false,
      reason: 'External agents cannot use restricted tools',
    }

    // Create audit log node
    const auditLog = await graph.createNode('AuditLog', {
      ...accessAttempt,
      eventType: 'security_denial',
    })

    // Link audit log to agent and tool
    await graph.createEdge(auditLog.id, 'attemptedBy', externalAgent.id)
    await graph.createEdge(auditLog.id, 'attemptedTool', restrictedTool.id)

    // Query audit logs for this agent
    const auditEdges = await graph.queryEdges({ to: externalAgent.id, type: 'attemptedBy' })

    expect(auditEdges).toHaveLength(1)

    const auditNode = await graph.getNode(auditEdges[0].from)
    expect(auditNode?.properties.eventType).toBe('security_denial')
    expect(auditNode?.properties.allowed).toBe(false)
  })
})

// ============================================================================
// 4. Role-Based Access Control Tests
// ============================================================================

describe('Role-Based Access Control', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  it('creates role hierarchy with inheritance', async () => {
    // Create role hierarchy: super_admin -> admin -> developer -> viewer
    const viewerRole = await graph.createNode('Role', {
      name: 'viewer',
      description: 'Read-only access',
      level: 0,
    })

    const developerRole = await graph.createNode('Role', {
      name: 'developer',
      description: 'Development access',
      level: 1,
    })

    const adminRole = await graph.createNode('Role', {
      name: 'admin',
      description: 'Administrative access',
      level: 2,
    })

    const superAdminRole = await graph.createNode('Role', {
      name: 'super_admin',
      description: 'Full system access',
      level: 3,
    })

    // Create hierarchy
    await graph.createEdge(developerRole.id, 'inherits', viewerRole.id)
    await graph.createEdge(adminRole.id, 'inherits', developerRole.id)
    await graph.createEdge(superAdminRole.id, 'inherits', adminRole.id)

    // Query inheritance chain from super_admin
    const getInheritedRoles = async (roleId: string): Promise<string[]> => {
      const roles: string[] = [roleId]
      const edges = await graph.queryEdges({ from: roleId, type: 'inherits' })

      for (const edge of edges) {
        const inherited = await getInheritedRoles(edge.to)
        roles.push(...inherited)
      }

      return roles
    }

    const allRoles = await getInheritedRoles(superAdminRole.id)

    expect(allRoles).toHaveLength(4)
    expect(allRoles).toContain(superAdminRole.id)
    expect(allRoles).toContain(adminRole.id)
    expect(allRoles).toContain(developerRole.id)
    expect(allRoles).toContain(viewerRole.id)
  })

  it('aggregates permissions from role hierarchy', async () => {
    // Create roles
    const viewerRole = await graph.createNode('Role', { name: 'viewer' })
    const developerRole = await graph.createNode('Role', { name: 'developer' })
    const adminRole = await graph.createNode('Role', { name: 'admin' })

    // Create permissions
    const readPermission = await graph.createNode('Permission', {
      name: 'data.read',
      scope: 'read',
    })
    const writePermission = await graph.createNode('Permission', {
      name: 'data.write',
      scope: 'write',
    })
    const adminPermission = await graph.createNode('Permission', {
      name: 'system.admin',
      scope: 'admin',
    })

    // Grant permissions to roles
    await graph.createEdge(viewerRole.id, 'grants', readPermission.id)
    await graph.createEdge(developerRole.id, 'grants', writePermission.id)
    await graph.createEdge(adminRole.id, 'grants', adminPermission.id)

    // Create hierarchy
    await graph.createEdge(developerRole.id, 'inherits', viewerRole.id)
    await graph.createEdge(adminRole.id, 'inherits', developerRole.id)

    // Function to get all permissions for a role including inherited
    const getAllPermissions = async (roleId: string): Promise<string[]> => {
      const permissions: string[] = []

      // Get direct grants
      const grantEdges = await graph.queryEdges({ from: roleId, type: 'grants' })
      permissions.push(...grantEdges.map((e) => e.to))

      // Get inherited roles
      const inheritEdges = await graph.queryEdges({ from: roleId, type: 'inherits' })
      for (const edge of inheritEdges) {
        const inherited = await getAllPermissions(edge.to)
        permissions.push(...inherited)
      }

      return permissions
    }

    // Admin should have all three permissions
    const adminPermissions = await getAllPermissions(adminRole.id)

    expect(adminPermissions).toHaveLength(3)
    expect(adminPermissions).toContain(readPermission.id)
    expect(adminPermissions).toContain(writePermission.id)
    expect(adminPermissions).toContain(adminPermission.id)
  })

  it('supports multiple role assignment to agents', async () => {
    // Create agent
    const agent = await graph.createNode('Agent', {
      name: 'multi-role-agent',
      type: 'internal',
    })

    // Create independent roles (not hierarchical)
    const developerRole = await graph.createNode('Role', { name: 'developer' })
    const reviewerRole = await graph.createNode('Role', { name: 'reviewer' })
    const deployerRole = await graph.createNode('Role', { name: 'deployer' })

    // Assign multiple roles
    await graph.createEdge(agent.id, 'hasRole', developerRole.id)
    await graph.createEdge(agent.id, 'hasRole', reviewerRole.id)
    await graph.createEdge(agent.id, 'hasRole', deployerRole.id)

    // Query agent's roles
    const roleEdges = await graph.queryEdges({ from: agent.id, type: 'hasRole' })

    expect(roleEdges).toHaveLength(3)
  })

  it('checks permission across multiple roles', async () => {
    // Create agent
    const agent = await graph.createNode('Agent', { name: 'agent', type: 'internal' })

    // Create roles with different permissions
    const role1 = await graph.createNode('Role', { name: 'role1' })
    const role2 = await graph.createNode('Role', { name: 'role2' })

    // Create permissions
    const perm1 = await graph.createNode('Permission', { name: 'perm1' })
    const perm2 = await graph.createNode('Permission', { name: 'perm2' })
    const perm3 = await graph.createNode('Permission', { name: 'perm3' })

    // Role1 grants perm1, Role2 grants perm2 and perm3
    await graph.createEdge(role1.id, 'grants', perm1.id)
    await graph.createEdge(role2.id, 'grants', perm2.id)
    await graph.createEdge(role2.id, 'grants', perm3.id)

    // Agent has both roles
    await graph.createEdge(agent.id, 'hasRole', role1.id)
    await graph.createEdge(agent.id, 'hasRole', role2.id)

    // Get all permissions
    const roleEdges = await graph.queryEdges({ from: agent.id, type: 'hasRole' })
    const allPermissions: string[] = []

    for (const roleEdge of roleEdges) {
      const grantEdges = await graph.queryEdges({ from: roleEdge.to, type: 'grants' })
      allPermissions.push(...grantEdges.map((e) => e.to))
    }

    // Agent should have all 3 permissions
    expect(allPermissions).toHaveLength(3)
    expect(allPermissions).toContain(perm1.id)
    expect(allPermissions).toContain(perm2.id)
    expect(allPermissions).toContain(perm3.id)
  })
})

// ============================================================================
// 5. Scope Enforcement Tests
// ============================================================================

describe('Scope Enforcement', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  it('enforces resource-specific permissions', async () => {
    // Create tool that operates on specific resource
    const tool = await graph.createNode('Tool', {
      name: 'user_update',
      description: 'Update user data',
      targetResource: 'users',
    })

    // Create resource-scoped permission
    const permission = await graph.createNode('Permission', {
      name: 'users.write',
      scope: 'write',
      resource: 'users',
    })

    // Create unrelated permission
    const wrongPermission = await graph.createNode('Permission', {
      name: 'products.write',
      scope: 'write',
      resource: 'products',
    })

    // Tool requires users.write
    await graph.createEdge(tool.id, 'requires', permission.id, {
      resourceMatch: true,
    })

    // Agent with wrong permission
    const agent = await graph.createNode('Agent', { name: 'agent', type: 'internal' })
    await graph.createEdge(agent.id, 'hasPermission', wrongPermission.id)

    // Check if agent has correct permission
    const agentPermEdges = await graph.queryEdges({
      from: agent.id,
      type: 'hasPermission',
    })
    const agentPermissionIds = agentPermEdges.map((e) => e.to)

    const toolRequiresEdges = await graph.queryEdges({
      from: tool.id,
      type: 'requires',
    })
    const requiredPermissionIds = toolRequiresEdges.map((e) => e.to)

    const hasRequiredPermission = requiredPermissionIds.some((id) =>
      agentPermissionIds.includes(id)
    )

    expect(hasRequiredPermission).toBe(false)
  })

  it('validates scope level (read vs write vs admin)', async () => {
    // Create permission with read scope
    const readPermission = await graph.createNode('Permission', {
      name: 'data.read',
      scope: 'read' as PermissionScope,
      resource: 'data',
    })

    // Create permission with write scope
    const writePermission = await graph.createNode('Permission', {
      name: 'data.write',
      scope: 'write' as PermissionScope,
      resource: 'data',
    })

    // Create tool requiring write scope
    const writeTool = await graph.createNode('Tool', {
      name: 'data_update',
      requiredScope: 'write' as PermissionScope,
    })

    await graph.createEdge(writeTool.id, 'requires', writePermission.id)

    // Agent with only read permission
    const agent = await graph.createNode('Agent', { name: 'reader', type: 'internal' })
    await graph.createEdge(agent.id, 'hasPermission', readPermission.id)

    // Check scope compatibility
    const agentPermEdges = await graph.queryEdges({
      from: agent.id,
      type: 'hasPermission',
    })

    const agentPermissions = await Promise.all(
      agentPermEdges.map((e) => graph.getNode(e.to))
    )

    const hasWriteScope = agentPermissions.some(
      (p) => p?.properties.scope === 'write' || p?.properties.scope === 'admin'
    )

    expect(hasWriteScope).toBe(false)
  })

  it('admin scope includes all other scopes', async () => {
    // Create admin permission
    const adminPermission = await graph.createNode('Permission', {
      name: 'data.admin',
      scope: 'admin' as PermissionScope,
      resource: 'data',
    })

    // Create agent with admin permission
    const agent = await graph.createNode('Agent', { name: 'admin', type: 'internal' })
    await graph.createEdge(agent.id, 'hasPermission', adminPermission.id)

    // Check if admin scope satisfies read, write, execute requirements
    const agentPermEdges = await graph.queryEdges({
      from: agent.id,
      type: 'hasPermission',
    })

    const agentPermissions = await Promise.all(
      agentPermEdges.map((e) => graph.getNode(e.to))
    )

    const hasAdminScope = agentPermissions.some((p) => p?.properties.scope === 'admin')

    // Admin scope should satisfy any scope requirement
    const satisfiesRead = hasAdminScope
    const satisfiesWrite = hasAdminScope
    const satisfiesExecute = hasAdminScope

    expect(satisfiesRead).toBe(true)
    expect(satisfiesWrite).toBe(true)
    expect(satisfiesExecute).toBe(true)
  })
})

// ============================================================================
// 6. ToolPermissionChecker Interface Tests (API Design)
// ============================================================================

describe('ToolPermissionChecker Interface', () => {
  it('exports ToolPermissionChecker from db/graph', async () => {
    // This will fail until ToolPermissionChecker is implemented
    // The interface should provide a high-level API for permission checking
    const graphModule = await import('../index')

    expect(graphModule.ToolPermissionChecker).toBeDefined()
  })

  it('has checkPermission method', async () => {
    const graphModule = await import('../index')

    expect(graphModule.ToolPermissionChecker.prototype.checkPermission).toBeDefined()
  })

  it('has canAgentUseTool method', async () => {
    const graphModule = await import('../index')

    expect(graphModule.ToolPermissionChecker.prototype.canAgentUseTool).toBeDefined()
  })

  it('has getAgentPermissions method', async () => {
    const graphModule = await import('../index')

    expect(graphModule.ToolPermissionChecker.prototype.getAgentPermissions).toBeDefined()
  })

  it('has getToolRequiredPermissions method', async () => {
    const graphModule = await import('../index')

    expect(graphModule.ToolPermissionChecker.prototype.getToolRequiredPermissions).toBeDefined()
  })
})

// ============================================================================
// 7. ToolPermissionChecker Functional Tests
// ============================================================================

describe('ToolPermissionChecker Functional Tests', () => {
  let graph: GraphEngine
  let checker: ToolPermissionCheckerInstance | undefined

  beforeEach(async () => {
    graph = new GraphEngine()

    // Try to instantiate ToolPermissionChecker
    const graphModule = await import('../index')
    if (graphModule.ToolPermissionChecker) {
      checker = new graphModule.ToolPermissionChecker(graph) as ToolPermissionCheckerInstance
    }
  })

  describe('canAgentUseTool', () => {
    it('returns true when agent has required permission via role', async () => {
      // Setup: Create tool, permission, role, agent
      const tool = await graph.createNode('Tool', { name: 'file_write' })
      const permission = await graph.createNode('Permission', { name: 'fs.write' })
      const role = await graph.createNode('Role', { name: 'developer' })
      const agent = await graph.createNode('Agent', { name: 'ralph', type: 'internal' })

      // Link: tool -requires-> permission, role -grants-> permission, agent -hasRole-> role
      await graph.createEdge(tool.id, 'requires', permission.id, { required: true })
      await graph.createEdge(role.id, 'grants', permission.id)
      await graph.createEdge(agent.id, 'hasRole', role.id)

      // This will fail until ToolPermissionChecker is implemented
      const graphModule = await import('../index')
      expect(graphModule.ToolPermissionChecker).toBeDefined()

      const permChecker = new graphModule.ToolPermissionChecker(graph)
      const result = await permChecker.canAgentUseTool(agent.id, tool.id)

      expect(result.allowed).toBe(true)
    })

    it('returns false when agent lacks required permission', async () => {
      const tool = await graph.createNode('Tool', { name: 'shell_execute' })
      const permission = await graph.createNode('Permission', { name: 'shell.execute' })
      const agent = await graph.createNode('Agent', { name: 'external-agent', type: 'external' })

      await graph.createEdge(tool.id, 'requires', permission.id, { required: true })
      // Agent has no roles or permissions

      const graphModule = await import('../index')
      expect(graphModule.ToolPermissionChecker).toBeDefined()

      const permChecker = new graphModule.ToolPermissionChecker(graph)
      const result = await permChecker.canAgentUseTool(agent.id, tool.id)

      expect(result.allowed).toBe(false)
      expect(result.missingPermissions).toContain(permission.id)
    })

    it('returns false when agent has expired permission', async () => {
      const tool = await graph.createNode('Tool', { name: 'file_write' })
      const permission = await graph.createNode('Permission', { name: 'fs.write' })
      const agent = await graph.createNode('Agent', { name: 'temp-agent', type: 'internal' })

      await graph.createEdge(tool.id, 'requires', permission.id, { required: true })
      await graph.createEdge(agent.id, 'hasPermission', permission.id, {
        expiresAt: Date.now() - 86400000, // Expired 24 hours ago
      })

      const graphModule = await import('../index')
      expect(graphModule.ToolPermissionChecker).toBeDefined()

      const permChecker = new graphModule.ToolPermissionChecker(graph)
      const result = await permChecker.canAgentUseTool(agent.id, tool.id)

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('expired')
    })

    it('respects security level restrictions', async () => {
      const tool = await graph.createNode('Tool', {
        name: 'critical_operation',
        securityLevel: 'critical',
      })
      const agent = await graph.createNode('Agent', {
        name: 'internal-agent',
        type: 'internal', // Not system
      })

      const graphModule = await import('../index')
      expect(graphModule.ToolPermissionChecker).toBeDefined()

      const permChecker = new graphModule.ToolPermissionChecker(graph)
      const result = await permChecker.canAgentUseTool(agent.id, tool.id)

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('security level')
    })
  })

  describe('checkPermission', () => {
    it('throws PermissionDeniedError when permission check fails', async () => {
      const tool = await graph.createNode('Tool', { name: 'restricted_tool' })
      const permission = await graph.createNode('Permission', { name: 'restricted.access' })
      const agent = await graph.createNode('Agent', { name: 'unauthorized', type: 'external' })

      await graph.createEdge(tool.id, 'requires', permission.id, { required: true })

      const graphModule = await import('../index')
      expect(graphModule.ToolPermissionChecker).toBeDefined()
      expect(graphModule.PermissionDeniedError).toBeDefined()

      const permChecker = new graphModule.ToolPermissionChecker(graph)

      await expect(
        permChecker.checkPermission(agent.id, tool.id)
      ).rejects.toThrow(graphModule.PermissionDeniedError)
    })

    it('returns void when permission check passes', async () => {
      const tool = await graph.createNode('Tool', { name: 'allowed_tool' })
      const permission = await graph.createNode('Permission', { name: 'basic.access' })
      const role = await graph.createNode('Role', { name: 'user' })
      const agent = await graph.createNode('Agent', { name: 'authorized', type: 'internal' })

      await graph.createEdge(tool.id, 'requires', permission.id, { required: true })
      await graph.createEdge(role.id, 'grants', permission.id)
      await graph.createEdge(agent.id, 'hasRole', role.id)

      const graphModule = await import('../index')
      expect(graphModule.ToolPermissionChecker).toBeDefined()

      const permChecker = new graphModule.ToolPermissionChecker(graph)

      // Should not throw
      await expect(
        permChecker.checkPermission(agent.id, tool.id)
      ).resolves.toBeUndefined()
    })
  })

  describe('getAgentPermissions', () => {
    it('returns all permissions including inherited via roles', async () => {
      const perm1 = await graph.createNode('Permission', { name: 'perm1' })
      const perm2 = await graph.createNode('Permission', { name: 'perm2' })
      const perm3 = await graph.createNode('Permission', { name: 'perm3' })
      const role1 = await graph.createNode('Role', { name: 'role1' })
      const role2 = await graph.createNode('Role', { name: 'role2' })
      const agent = await graph.createNode('Agent', { name: 'multi-role-agent' })

      await graph.createEdge(role1.id, 'grants', perm1.id)
      await graph.createEdge(role2.id, 'grants', perm2.id)
      await graph.createEdge(agent.id, 'hasPermission', perm3.id) // Direct permission
      await graph.createEdge(agent.id, 'hasRole', role1.id)
      await graph.createEdge(agent.id, 'hasRole', role2.id)

      const graphModule = await import('../index')
      expect(graphModule.ToolPermissionChecker).toBeDefined()

      const permChecker = new graphModule.ToolPermissionChecker(graph)
      const permissions = await permChecker.getAgentPermissions(agent.id)

      expect(permissions).toHaveLength(3)
      expect(permissions.map((p: PermissionNode) => p.id)).toContain(perm1.id)
      expect(permissions.map((p: PermissionNode) => p.id)).toContain(perm2.id)
      expect(permissions.map((p: PermissionNode) => p.id)).toContain(perm3.id)
    })

    it('filters out expired permissions', async () => {
      const validPerm = await graph.createNode('Permission', { name: 'valid' })
      const expiredPerm = await graph.createNode('Permission', { name: 'expired' })
      const agent = await graph.createNode('Agent', { name: 'agent' })

      await graph.createEdge(agent.id, 'hasPermission', validPerm.id, {
        expiresAt: Date.now() + 86400000, // Valid for 24 hours
      })
      await graph.createEdge(agent.id, 'hasPermission', expiredPerm.id, {
        expiresAt: Date.now() - 1000, // Expired
      })

      const graphModule = await import('../index')
      expect(graphModule.ToolPermissionChecker).toBeDefined()

      const permChecker = new graphModule.ToolPermissionChecker(graph)
      const permissions = await permChecker.getAgentPermissions(agent.id)

      expect(permissions).toHaveLength(1)
      expect(permissions[0].id).toBe(validPerm.id)
    })
  })

  describe('getToolRequiredPermissions', () => {
    it('returns all required permissions for a tool', async () => {
      const tool = await graph.createNode('Tool', { name: 'complex_tool' })
      const perm1 = await graph.createNode('Permission', { name: 'perm1' })
      const perm2 = await graph.createNode('Permission', { name: 'perm2' })
      const optionalPerm = await graph.createNode('Permission', { name: 'optional' })

      await graph.createEdge(tool.id, 'requires', perm1.id, { required: true })
      await graph.createEdge(tool.id, 'requires', perm2.id, { required: true })
      await graph.createEdge(tool.id, 'requires', optionalPerm.id, { required: false })

      const graphModule = await import('../index')
      expect(graphModule.ToolPermissionChecker).toBeDefined()

      const permChecker = new graphModule.ToolPermissionChecker(graph)
      const required = await permChecker.getToolRequiredPermissions(tool.id)

      expect(required).toHaveLength(2)
      expect(required.map((p: PermissionNode) => p.id)).toContain(perm1.id)
      expect(required.map((p: PermissionNode) => p.id)).toContain(perm2.id)
      expect(required.map((p: PermissionNode) => p.id)).not.toContain(optionalPerm.id)
    })

    it('returns empty array for tools with no permission requirements', async () => {
      const tool = await graph.createNode('Tool', { name: 'public_tool' })

      const graphModule = await import('../index')
      expect(graphModule.ToolPermissionChecker).toBeDefined()

      const permChecker = new graphModule.ToolPermissionChecker(graph)
      const required = await permChecker.getToolRequiredPermissions(tool.id)

      expect(required).toHaveLength(0)
    })
  })
})

// ============================================================================
// 8. Permission Caching Tests
// ============================================================================

describe('Permission Caching', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  it('caches permission checks for performance', async () => {
    const tool = await graph.createNode('Tool', { name: 'cached_tool' })
    const permission = await graph.createNode('Permission', { name: 'cached.perm' })
    const role = await graph.createNode('Role', { name: 'cached_role' })
    const agent = await graph.createNode('Agent', { name: 'cached_agent' })

    await graph.createEdge(tool.id, 'requires', permission.id, { required: true })
    await graph.createEdge(role.id, 'grants', permission.id)
    await graph.createEdge(agent.id, 'hasRole', role.id)

    const graphModule = await import('../index')
    expect(graphModule.ToolPermissionChecker).toBeDefined()

    const permChecker = new graphModule.ToolPermissionChecker(graph, {
      cacheEnabled: true,
      cacheTtlMs: 60000,
    })

    // First call - should query graph
    const start1 = performance.now()
    await permChecker.canAgentUseTool(agent.id, tool.id)
    const duration1 = performance.now() - start1

    // Second call - should use cache
    const start2 = performance.now()
    await permChecker.canAgentUseTool(agent.id, tool.id)
    const duration2 = performance.now() - start2

    // Cached call should be significantly faster
    // (This is a behavioral test - actual performance may vary)
    expect(duration2).toBeLessThanOrEqual(duration1)
  })

  it('invalidates cache when permissions change', async () => {
    const tool = await graph.createNode('Tool', { name: 'tool' })
    const permission = await graph.createNode('Permission', { name: 'perm' })
    const agent = await graph.createNode('Agent', { name: 'agent' })

    await graph.createEdge(tool.id, 'requires', permission.id, { required: true })

    const graphModule = await import('../index')
    expect(graphModule.ToolPermissionChecker).toBeDefined()

    const permChecker = new graphModule.ToolPermissionChecker(graph, {
      cacheEnabled: true,
    })

    // First check - no permission
    const result1 = await permChecker.canAgentUseTool(agent.id, tool.id)
    expect(result1.allowed).toBe(false)

    // Grant permission
    await graph.createEdge(agent.id, 'hasPermission', permission.id)

    // Invalidate cache
    permChecker.invalidateCache(agent.id)

    // Second check - should reflect new permission
    const result2 = await permChecker.canAgentUseTool(agent.id, tool.id)
    expect(result2.allowed).toBe(true)
  })
})

// ============================================================================
// 9. Audit Trail Tests
// ============================================================================

describe('Audit Trail', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  it('logs permission check attempts', async () => {
    const tool = await graph.createNode('Tool', { name: 'audited_tool' })
    const agent = await graph.createNode('Agent', { name: 'audited_agent' })

    const graphModule = await import('../index')
    expect(graphModule.ToolPermissionChecker).toBeDefined()

    const auditLogs: PermissionCheckAuditLog[] = []
    const permChecker = new graphModule.ToolPermissionChecker(graph, {
      onPermissionCheck: (log: PermissionCheckAuditLog) => auditLogs.push(log),
    })

    await permChecker.canAgentUseTool(agent.id, tool.id)

    expect(auditLogs).toHaveLength(1)
    expect(auditLogs[0].agentId).toBe(agent.id)
    expect(auditLogs[0].toolId).toBe(tool.id)
    expect(auditLogs[0].timestamp).toBeDefined()
  })

  it('records denial reasons in audit log', async () => {
    const tool = await graph.createNode('Tool', {
      name: 'restricted',
      securityLevel: 'restricted',
    })
    const agent = await graph.createNode('Agent', { name: 'external', type: 'external' })

    const graphModule = await import('../index')
    expect(graphModule.ToolPermissionChecker).toBeDefined()

    const auditLogs: PermissionCheckAuditLog[] = []
    const permChecker = new graphModule.ToolPermissionChecker(graph, {
      onPermissionCheck: (log: PermissionCheckAuditLog) => auditLogs.push(log),
    })

    await permChecker.canAgentUseTool(agent.id, tool.id)

    expect(auditLogs[0].allowed).toBe(false)
    expect(auditLogs[0].reason).toBeDefined()
    expect(auditLogs[0].reason).not.toBe('')
  })
})
