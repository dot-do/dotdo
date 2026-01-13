/**
 * [dotdo-6tijv] RED: Tool Permission Enforcement via Graph Tests
 *
 * Failing tests for permission checking via Tool -> Permission relationships.
 * Tests the relationship creation, permission enforcement, role-based permissions,
 * and security level enforcement.
 *
 * Key Features Under Test:
 * - Tool requires Permission relationship
 * - Permission check on invocation (blocks without, allows with)
 * - Role-based permission inheritance
 * - Security level enforcement for restricted tools
 *
 * NO MOCKS - Real graph queries for permission checks
 */
import { describe, it, expect, beforeEach } from 'vitest'

// Production module imports (these don't exist yet - RED phase)
import {
  createPermissionGraph,
  ToolExecutor,
  type PermissionGraph,
  type PermissionGraphClient,
  type Tool,
  type Permission,
  type Agent,
  type Role,
  type InvocationResult,
} from '../src/tool-permissions'

// ============================================================================
// SCHEMA DEFINITION - Permission Graph
// ============================================================================

/**
 * Permission graph schema for testing.
 * Defines Tool, Permission, Agent, and Role node types with their relationships.
 */
interface SecurityGraph extends PermissionGraph {
  Tool: {
    requires: 'Permission'    // Tool -[requires]-> Permission
    usedBy: 'Agent'          // Tool -[usedBy]-> Agent (inverse of uses)
  }
  Permission: {
    requiredBy: 'Tool'       // Permission -[requiredBy]-> Tool
    grantedTo: 'Agent'       // Permission -[grantedTo]-> Agent
    includedIn: 'Role'       // Permission -[includedIn]-> Role
  }
  Agent: {
    hasPermission: 'Permission'  // Agent -[hasPermission]-> Permission
    hasRole: 'Role'              // Agent -[hasRole]-> Role
    uses: 'Tool'                 // Agent -[uses]-> Tool
  }
  Role: {
    includesPermission: 'Permission'  // Role -[includesPermission]-> Permission
    assignedTo: 'Agent'               // Role -[assignedTo]-> Agent
    inheritsFrom: 'Role'              // Role -[inheritsFrom]-> Role (hierarchy)
  }
}

// ============================================================================
// 1. PERMISSION RELATIONSHIPS TESTS
// ============================================================================

describe('Tool Permission Relationships', () => {
  let graph: PermissionGraphClient<SecurityGraph>

  beforeEach(() => {
    graph = createPermissionGraph<SecurityGraph>({ namespace: 'security' })
  })

  it('creates Tool requires Permission relationship', async () => {
    // Create permission Thing
    const permission = await graph.Permission.create({
      data: {
        type: 'write',
        resource: 'email',
        scope: 'organization',
      },
    })

    // Create tool with permission requirement
    const tool = await graph.Tool.create({
      data: {
        id: 'send-email',
        name: 'Send Email',
        description: 'Sends emails on behalf of the user',
      },
    })

    // Create the requirement relationship
    await graph.createRelationship({
      verb: 'requires',
      from: tool.id,
      to: permission.id,
    })

    // Verify requirement by traversing from tool to permission
    const requiredPermissions = await graph.Tool.get(tool.id).$.requires.toArray()

    expect(requiredPermissions).toHaveLength(1)
    expect(requiredPermissions[0].id).toBe(permission.id)
    expect(requiredPermissions[0].data.type).toBe('write')
    expect(requiredPermissions[0].data.resource).toBe('email')
  })

  it('supports multiple permission requirements', async () => {
    // Create multiple permissions
    const readPermission = await graph.Permission.create({
      data: { type: 'read', resource: 'contacts', scope: 'user' },
    })
    const writePermission = await graph.Permission.create({
      data: { type: 'write', resource: 'email', scope: 'organization' },
    })
    const adminPermission = await graph.Permission.create({
      data: { type: 'admin', resource: 'settings', scope: 'global' },
    })

    // Create tool
    const tool = await graph.Tool.create({
      data: { id: 'bulk-email', name: 'Bulk Email Tool' },
    })

    // Require all permissions
    await graph.createRelationship({ verb: 'requires', from: tool.id, to: readPermission.id })
    await graph.createRelationship({ verb: 'requires', from: tool.id, to: writePermission.id })
    await graph.createRelationship({ verb: 'requires', from: tool.id, to: adminPermission.id })

    // Verify all requirements
    const requiredPermissions = await graph.Tool.get(tool.id).$.requires.toArray()

    expect(requiredPermissions).toHaveLength(3)
    expect(requiredPermissions.map(p => p.data.type)).toContain('read')
    expect(requiredPermissions.map(p => p.data.type)).toContain('write')
    expect(requiredPermissions.map(p => p.data.type)).toContain('admin')
  })

  it('supports optional vs required permissions', async () => {
    // Create permissions with different requirement levels
    const requiredPermission = await graph.Permission.create({
      data: { type: 'write', resource: 'email', required: true },
    })
    const optionalPermission = await graph.Permission.create({
      data: { type: 'read', resource: 'contacts', required: false },
    })

    const tool = await graph.Tool.create({
      data: { id: 'email-with-contacts', name: 'Email with Contacts' },
    })

    // Create relationships with metadata
    await graph.createRelationship({
      verb: 'requires',
      from: tool.id,
      to: requiredPermission.id,
      data: { optional: false },
    })
    await graph.createRelationship({
      verb: 'requires',
      from: tool.id,
      to: optionalPermission.id,
      data: { optional: true },
    })

    // Query required permissions (filtering by relationship data)
    const allPermissions = await graph.Tool.get(tool.id).$.requires.toArray()
    expect(allPermissions).toHaveLength(2)

    // Should be able to filter by required vs optional
    const requiredOnly = await graph.Tool.get(tool.id).$.requires
      .where({ 'relationship.optional': false })
      .toArray()
    expect(requiredOnly).toHaveLength(1)
    expect(requiredOnly[0].data.type).toBe('write')
  })

  it('queries permissions required by a specific tool', async () => {
    // Setup tools and permissions
    const emailPermission = await graph.Permission.create({
      data: { type: 'write', resource: 'email' },
    })
    const filePermission = await graph.Permission.create({
      data: { type: 'read', resource: 'files' },
    })

    const emailTool = await graph.Tool.create({ data: { id: 'send-email' } })
    const fileTool = await graph.Tool.create({ data: { id: 'read-file' } })

    await graph.createRelationship({ verb: 'requires', from: emailTool.id, to: emailPermission.id })
    await graph.createRelationship({ verb: 'requires', from: fileTool.id, to: filePermission.id })

    // Query: What permissions does the email tool need?
    const emailToolPermissions = await graph.Tool.get(emailTool.id).$.requires.toArray()
    expect(emailToolPermissions).toHaveLength(1)
    expect(emailToolPermissions[0].data.resource).toBe('email')

    // Query: What tools need file permission?
    const toolsNeedingFileAccess = await graph.Permission.get(filePermission.id).$.requiredBy.toArray()
    expect(toolsNeedingFileAccess).toHaveLength(1)
    expect(toolsNeedingFileAccess[0].data.id).toBe('read-file')
  })
})

// ============================================================================
// 2. PERMISSION ENFORCEMENT TESTS
// ============================================================================

describe('Permission Enforcement', () => {
  let graph: PermissionGraphClient<SecurityGraph>
  let toolExecutor: ToolExecutor<SecurityGraph>
  let emailPermissionId: string
  let sendEmailToolId: string

  beforeEach(async () => {
    graph = createPermissionGraph<SecurityGraph>({ namespace: 'security' })
    toolExecutor = new ToolExecutor(graph)

    // Setup: Create permission and tool
    const emailPermission = await graph.Permission.create({
      data: { type: 'write', resource: 'email', scope: 'organization' },
    })
    emailPermissionId = emailPermission.id

    const sendEmailTool = await graph.Tool.create({
      data: { id: 'send-email', name: 'Send Email' },
    })
    sendEmailToolId = sendEmailTool.id

    // Link tool to permission requirement
    await graph.createRelationship({
      verb: 'requires',
      from: sendEmailToolId,
      to: emailPermissionId,
    })
  })

  it('blocks invocation without permission', async () => {
    // Create agent WITHOUT email permission
    const agent = await graph.Agent.create({
      data: { name: 'limited-agent', type: 'internal' },
    })
    // Note: No hasPermission relationship to email permission

    // Attempt to invoke email tool
    const result = await toolExecutor.invoke(
      'send-email',
      { to: 'user@example.com', subject: 'Test', body: 'Hello' },
      { executorId: agent.id }
    )

    expect(result.denied).toBe(true)
    expect(result.executed).toBe(false)
    expect(result.reason).toContain('permission')
    expect(result.reason).toContain('email')
    expect(result.missingPermissions).toBeDefined()
    expect(result.missingPermissions).toContain(emailPermissionId)
  })

  it('allows invocation with permission', async () => {
    // Create agent WITH email permission
    const agent = await graph.Agent.create({
      data: { name: 'email-agent', type: 'internal' },
    })

    // Grant permission to agent
    await graph.createRelationship({
      verb: 'hasPermission',
      from: agent.id,
      to: emailPermissionId,
    })

    // Attempt to invoke email tool
    const result = await toolExecutor.invoke(
      'send-email',
      { to: 'user@example.com', subject: 'Test', body: 'Hello' },
      { executorId: agent.id }
    )

    expect(result.denied).toBeFalsy()
    expect(result.executed).toBe(true)
    expect(result.missingPermissions).toBeUndefined()
  })

  it('blocks with partial permissions when multiple required', async () => {
    // Create additional permission requirement
    const contactsPermission = await graph.Permission.create({
      data: { type: 'read', resource: 'contacts' },
    })

    await graph.createRelationship({
      verb: 'requires',
      from: sendEmailToolId,
      to: contactsPermission.id,
    })

    // Create agent with only email permission (missing contacts)
    const agent = await graph.Agent.create({
      data: { name: 'partial-agent', type: 'internal' },
    })
    await graph.createRelationship({
      verb: 'hasPermission',
      from: agent.id,
      to: emailPermissionId,
    })
    // Note: NOT granting contacts permission

    const result = await toolExecutor.invoke(
      'send-email',
      { to: 'user@example.com' },
      { executorId: agent.id }
    )

    expect(result.denied).toBe(true)
    expect(result.missingPermissions).toContain(contactsPermission.id)
    expect(result.missingPermissions).not.toContain(emailPermissionId)
  })

  it('allows with all required permissions', async () => {
    // Create additional permission requirement
    const contactsPermission = await graph.Permission.create({
      data: { type: 'read', resource: 'contacts' },
    })

    await graph.createRelationship({
      verb: 'requires',
      from: sendEmailToolId,
      to: contactsPermission.id,
    })

    // Create agent with BOTH permissions
    const agent = await graph.Agent.create({
      data: { name: 'full-agent', type: 'internal' },
    })
    await graph.createRelationship({
      verb: 'hasPermission',
      from: agent.id,
      to: emailPermissionId,
    })
    await graph.createRelationship({
      verb: 'hasPermission',
      from: agent.id,
      to: contactsPermission.id,
    })

    const result = await toolExecutor.invoke(
      'send-email',
      { to: 'user@example.com' },
      { executorId: agent.id }
    )

    expect(result.denied).toBeFalsy()
    expect(result.executed).toBe(true)
  })

  it('provides detailed denial reason', async () => {
    const agent = await graph.Agent.create({
      data: { name: 'denied-agent', type: 'internal' },
    })

    const result = await toolExecutor.invoke(
      'send-email',
      { to: 'user@example.com' },
      { executorId: agent.id }
    )

    expect(result.denied).toBe(true)
    expect(result.reason).toBeDefined()
    expect(result.reason).toMatch(/missing.*permission/i)
    expect(result.toolId).toBe('send-email')
    expect(result.agentId).toBe(agent.id)
  })

  it('caches permission checks for performance', async () => {
    const agent = await graph.Agent.create({
      data: { name: 'cached-agent', type: 'internal' },
    })
    await graph.createRelationship({
      verb: 'hasPermission',
      from: agent.id,
      to: emailPermissionId,
    })

    // First invocation - should query graph
    const result1 = await toolExecutor.invoke(
      'send-email',
      { to: 'user@example.com' },
      { executorId: agent.id }
    )

    // Second invocation - should use cache
    const result2 = await toolExecutor.invoke(
      'send-email',
      { to: 'another@example.com' },
      { executorId: agent.id }
    )

    expect(result1.executed).toBe(true)
    expect(result2.executed).toBe(true)
    expect(result2.fromCache).toBe(true)
  })
})

// ============================================================================
// 3. ROLE-BASED PERMISSIONS TESTS
// ============================================================================

describe('Role-based Permissions', () => {
  let graph: PermissionGraphClient<SecurityGraph>
  let toolExecutor: ToolExecutor<SecurityGraph>

  beforeEach(() => {
    graph = createPermissionGraph<SecurityGraph>({ namespace: 'security' })
    toolExecutor = new ToolExecutor(graph)
  })

  it('inherits permissions via roles', async () => {
    // Create permissions
    const emailPermission = await graph.Permission.create({
      data: { type: 'write', resource: 'email' },
    })
    const calendarPermission = await graph.Permission.create({
      data: { type: 'write', resource: 'calendar' },
    })

    // Create role with permissions
    const assistantRole = await graph.Role.create({
      data: { name: 'assistant', description: 'Can manage email and calendar' },
    })

    // Grant permissions to role
    await graph.createRelationship({
      verb: 'includesPermission',
      from: assistantRole.id,
      to: emailPermission.id,
    })
    await graph.createRelationship({
      verb: 'includesPermission',
      from: assistantRole.id,
      to: calendarPermission.id,
    })

    // Create agent with role (but no direct permissions)
    const agent = await graph.Agent.create({
      data: { name: 'assistant-agent', type: 'internal' },
    })
    await graph.createRelationship({
      verb: 'hasRole',
      from: agent.id,
      to: assistantRole.id,
    })

    // Create tool requiring email permission
    const emailTool = await graph.Tool.create({
      data: { id: 'send-email', name: 'Send Email' },
    })
    await graph.createRelationship({
      verb: 'requires',
      from: emailTool.id,
      to: emailPermission.id,
    })

    // Agent should have permission through role
    const result = await toolExecutor.invoke(
      'send-email',
      { to: 'user@example.com' },
      { executorId: agent.id }
    )

    expect(result.denied).toBeFalsy()
    expect(result.executed).toBe(true)
    expect(result.permissionSource).toBe('role')
    expect(result.roleId).toBe(assistantRole.id)
  })

  it('queries effective permissions including role grants', async () => {
    // Setup: permissions, role, agent
    const permission1 = await graph.Permission.create({ data: { resource: 'email' } })
    const permission2 = await graph.Permission.create({ data: { resource: 'files' } })
    const permission3 = await graph.Permission.create({ data: { resource: 'calendar' } })

    const role = await graph.Role.create({ data: { name: 'worker' } })
    await graph.createRelationship({ verb: 'includesPermission', from: role.id, to: permission1.id })
    await graph.createRelationship({ verb: 'includesPermission', from: role.id, to: permission2.id })

    const agent = await graph.Agent.create({ data: { name: 'test-agent' } })
    await graph.createRelationship({ verb: 'hasRole', from: agent.id, to: role.id })
    // Direct permission grant
    await graph.createRelationship({ verb: 'hasPermission', from: agent.id, to: permission3.id })

    // Query: Get all effective permissions for agent (direct + via roles)
    const effectivePermissions = await toolExecutor.getEffectivePermissions(agent.id)

    expect(effectivePermissions).toHaveLength(3)
    expect(effectivePermissions.map(p => p.data.resource)).toContain('email')
    expect(effectivePermissions.map(p => p.data.resource)).toContain('files')
    expect(effectivePermissions.map(p => p.data.resource)).toContain('calendar')
  })

  it('supports role hierarchy (role inherits from role)', async () => {
    // Create permissions
    const basicPermission = await graph.Permission.create({
      data: { resource: 'read-only' },
    })
    const advancedPermission = await graph.Permission.create({
      data: { resource: 'read-write' },
    })
    const adminPermission = await graph.Permission.create({
      data: { resource: 'admin' },
    })

    // Create role hierarchy: admin -> manager -> viewer
    const viewerRole = await graph.Role.create({ data: { name: 'viewer' } })
    const managerRole = await graph.Role.create({ data: { name: 'manager' } })
    const adminRole = await graph.Role.create({ data: { name: 'admin' } })

    // Assign permissions to roles
    await graph.createRelationship({ verb: 'includesPermission', from: viewerRole.id, to: basicPermission.id })
    await graph.createRelationship({ verb: 'includesPermission', from: managerRole.id, to: advancedPermission.id })
    await graph.createRelationship({ verb: 'includesPermission', from: adminRole.id, to: adminPermission.id })

    // Setup hierarchy: admin inherits from manager, manager inherits from viewer
    await graph.createRelationship({ verb: 'inheritsFrom', from: managerRole.id, to: viewerRole.id })
    await graph.createRelationship({ verb: 'inheritsFrom', from: adminRole.id, to: managerRole.id })

    // Create agent with admin role only
    const adminAgent = await graph.Agent.create({ data: { name: 'admin-agent' } })
    await graph.createRelationship({ verb: 'hasRole', from: adminAgent.id, to: adminRole.id })

    // Admin should have ALL permissions through hierarchy
    const effectivePermissions = await toolExecutor.getEffectivePermissions(adminAgent.id)

    expect(effectivePermissions).toHaveLength(3)
    expect(effectivePermissions.map(p => p.data.resource)).toContain('read-only')
    expect(effectivePermissions.map(p => p.data.resource)).toContain('read-write')
    expect(effectivePermissions.map(p => p.data.resource)).toContain('admin')
  })

  it('prioritizes direct permission over role permission', async () => {
    // Create permission with scope
    const limitedEmailPermission = await graph.Permission.create({
      data: { resource: 'email', scope: 'self-only' },
    })
    const fullEmailPermission = await graph.Permission.create({
      data: { resource: 'email', scope: 'organization' },
    })

    // Role has limited permission
    const role = await graph.Role.create({ data: { name: 'basic' } })
    await graph.createRelationship({
      verb: 'includesPermission',
      from: role.id,
      to: limitedEmailPermission.id,
    })

    // Agent has role AND direct full permission
    const agent = await graph.Agent.create({ data: { name: 'upgraded-agent' } })
    await graph.createRelationship({ verb: 'hasRole', from: agent.id, to: role.id })
    await graph.createRelationship({
      verb: 'hasPermission',
      from: agent.id,
      to: fullEmailPermission.id,
    })

    // Create tool requiring organization-scope email
    const bulkEmailTool = await graph.Tool.create({
      data: {
        id: 'bulk-email',
        name: 'Bulk Email',
        requiredScope: 'organization',
      },
    })
    await graph.createRelationship({
      verb: 'requires',
      from: bulkEmailTool.id,
      to: fullEmailPermission.id,
    })

    // Should be allowed via direct permission (not blocked by role's limited scope)
    const result = await toolExecutor.invoke(
      'bulk-email',
      { to: ['all@org.com'] },
      { executorId: agent.id }
    )

    expect(result.denied).toBeFalsy()
    expect(result.executed).toBe(true)
    expect(result.permissionSource).toBe('direct')
  })
})

// ============================================================================
// 4. SECURITY LEVEL ENFORCEMENT TESTS
// ============================================================================

describe('Security Level Enforcement', () => {
  let graph: PermissionGraphClient<SecurityGraph>
  let toolExecutor: ToolExecutor<SecurityGraph>

  beforeEach(() => {
    graph = createPermissionGraph<SecurityGraph>({ namespace: 'security' })
    toolExecutor = new ToolExecutor(graph)
  })

  it('blocks restricted tools for external agents', async () => {
    // Create restricted tool
    const adminTool = await graph.Tool.create({
      data: {
        id: 'admin-action',
        name: 'Admin Action',
        securityLevel: 'restricted',
        description: 'Performs admin-only operations',
      },
    })

    // Create external agent
    const externalAgent = await graph.Agent.create({
      data: {
        name: 'external-service',
        type: 'external',
        trustedLevel: 'untrusted',
      },
    })

    // Even if permission exists, security level should block
    const permission = await graph.Permission.create({
      data: { resource: 'admin' },
    })
    await graph.createRelationship({ verb: 'requires', from: adminTool.id, to: permission.id })
    await graph.createRelationship({ verb: 'hasPermission', from: externalAgent.id, to: permission.id })

    // Attempt invocation
    const result = await toolExecutor.invoke(
      'admin-action',
      {},
      { executorId: externalAgent.id }
    )

    expect(result.denied).toBe(true)
    expect(result.reason).toContain('security level')
    expect(result.securityViolation).toBe(true)
    expect(result.requiredLevel).toBe('restricted')
    expect(result.agentLevel).toBe('external')
  })

  it('allows restricted tools for internal agents', async () => {
    // Create restricted tool
    const adminTool = await graph.Tool.create({
      data: {
        id: 'admin-action',
        name: 'Admin Action',
        securityLevel: 'restricted',
      },
    })

    const permission = await graph.Permission.create({
      data: { resource: 'admin' },
    })
    await graph.createRelationship({ verb: 'requires', from: adminTool.id, to: permission.id })

    // Create internal agent with permission
    const internalAgent = await graph.Agent.create({
      data: {
        name: 'internal-service',
        type: 'internal',
        trustedLevel: 'trusted',
      },
    })
    await graph.createRelationship({ verb: 'hasPermission', from: internalAgent.id, to: permission.id })

    const result = await toolExecutor.invoke(
      'admin-action',
      {},
      { executorId: internalAgent.id }
    )

    expect(result.denied).toBeFalsy()
    expect(result.executed).toBe(true)
    expect(result.securityViolation).toBeFalsy()
  })

  it('logs security denials for audit', async () => {
    // Create restricted tool
    const dangerousTool = await graph.Tool.create({
      data: {
        id: 'delete-all',
        name: 'Delete All',
        securityLevel: 'restricted',
      },
    })

    // External agent attempts access
    const externalAgent = await graph.Agent.create({
      data: { name: 'attacker', type: 'external' },
    })

    await toolExecutor.invoke(
      'delete-all',
      { confirm: true },
      { executorId: externalAgent.id }
    )

    // Verify audit log was created
    const auditLogs = await graph.getAuditLog({
      agentId: externalAgent.id,
      toolId: 'delete-all',
      type: 'security-denial',
    })

    expect(auditLogs).toHaveLength(1)
    expect(auditLogs[0].reason).toContain('security level')
    expect(auditLogs[0].timestamp).toBeDefined()
    expect(auditLogs[0].severity).toBe('high')
  })

  it('enforces security levels: public < internal < restricted < critical', async () => {
    // Create tools at each level
    const publicTool = await graph.Tool.create({
      data: { id: 'public-api', securityLevel: 'public' },
    })
    const internalTool = await graph.Tool.create({
      data: { id: 'internal-api', securityLevel: 'internal' },
    })
    const restrictedTool = await graph.Tool.create({
      data: { id: 'restricted-api', securityLevel: 'restricted' },
    })
    const criticalTool = await graph.Tool.create({
      data: { id: 'critical-api', securityLevel: 'critical' },
    })

    // Create agents at different trust levels
    const untrustedAgent = await graph.Agent.create({
      data: { name: 'untrusted', type: 'external', clearanceLevel: 'public' },
    })
    const basicAgent = await graph.Agent.create({
      data: { name: 'basic', type: 'internal', clearanceLevel: 'internal' },
    })
    const trustedAgent = await graph.Agent.create({
      data: { name: 'trusted', type: 'internal', clearanceLevel: 'restricted' },
    })
    const superAgent = await graph.Agent.create({
      data: { name: 'super', type: 'internal', clearanceLevel: 'critical' },
    })

    // Test access matrix
    // Untrusted: only public
    expect((await toolExecutor.invoke('public-api', {}, { executorId: untrustedAgent.id })).denied).toBeFalsy()
    expect((await toolExecutor.invoke('internal-api', {}, { executorId: untrustedAgent.id })).denied).toBe(true)
    expect((await toolExecutor.invoke('restricted-api', {}, { executorId: untrustedAgent.id })).denied).toBe(true)
    expect((await toolExecutor.invoke('critical-api', {}, { executorId: untrustedAgent.id })).denied).toBe(true)

    // Basic: public + internal
    expect((await toolExecutor.invoke('public-api', {}, { executorId: basicAgent.id })).denied).toBeFalsy()
    expect((await toolExecutor.invoke('internal-api', {}, { executorId: basicAgent.id })).denied).toBeFalsy()
    expect((await toolExecutor.invoke('restricted-api', {}, { executorId: basicAgent.id })).denied).toBe(true)
    expect((await toolExecutor.invoke('critical-api', {}, { executorId: basicAgent.id })).denied).toBe(true)

    // Trusted: public + internal + restricted
    expect((await toolExecutor.invoke('public-api', {}, { executorId: trustedAgent.id })).denied).toBeFalsy()
    expect((await toolExecutor.invoke('internal-api', {}, { executorId: trustedAgent.id })).denied).toBeFalsy()
    expect((await toolExecutor.invoke('restricted-api', {}, { executorId: trustedAgent.id })).denied).toBeFalsy()
    expect((await toolExecutor.invoke('critical-api', {}, { executorId: trustedAgent.id })).denied).toBe(true)

    // Super: all levels
    expect((await toolExecutor.invoke('public-api', {}, { executorId: superAgent.id })).denied).toBeFalsy()
    expect((await toolExecutor.invoke('internal-api', {}, { executorId: superAgent.id })).denied).toBeFalsy()
    expect((await toolExecutor.invoke('restricted-api', {}, { executorId: superAgent.id })).denied).toBeFalsy()
    expect((await toolExecutor.invoke('critical-api', {}, { executorId: superAgent.id })).denied).toBeFalsy()
  })

  it('allows elevating security level temporarily with approval', async () => {
    // Create restricted tool
    const restrictedTool = await graph.Tool.create({
      data: { id: 'sensitive-op', securityLevel: 'restricted' },
    })

    // Basic agent (internal clearance only)
    const basicAgent = await graph.Agent.create({
      data: { name: 'basic', type: 'internal', clearanceLevel: 'internal' },
    })

    // Without elevation - should fail
    const deniedResult = await toolExecutor.invoke(
      'sensitive-op',
      {},
      { executorId: basicAgent.id }
    )
    expect(deniedResult.denied).toBe(true)

    // With temporary elevation approval
    const elevatedResult = await toolExecutor.invoke(
      'sensitive-op',
      {},
      {
        executorId: basicAgent.id,
        elevateLevel: 'restricted',
        approvalToken: 'valid-approval-token',
      }
    )
    expect(elevatedResult.denied).toBeFalsy()
    expect(elevatedResult.executed).toBe(true)
    expect(elevatedResult.elevated).toBe(true)
    expect(elevatedResult.originalLevel).toBe('internal')
  })
})

// ============================================================================
// 5. GRAPH QUERY INTEGRATION TESTS
// ============================================================================

describe('Permission Graph Queries', () => {
  let graph: PermissionGraphClient<SecurityGraph>

  beforeEach(() => {
    graph = createPermissionGraph<SecurityGraph>({ namespace: 'security' })
  })

  it('finds all agents with a specific permission', async () => {
    const permission = await graph.Permission.create({
      data: { resource: 'email', type: 'write' },
    })

    const agent1 = await graph.Agent.create({ data: { name: 'agent-1' } })
    const agent2 = await graph.Agent.create({ data: { name: 'agent-2' } })
    const agent3 = await graph.Agent.create({ data: { name: 'agent-3' } })

    // Only agent1 and agent2 have permission
    await graph.createRelationship({ verb: 'hasPermission', from: agent1.id, to: permission.id })
    await graph.createRelationship({ verb: 'hasPermission', from: agent2.id, to: permission.id })

    // Query: Who has email write permission?
    const agentsWithPermission = await graph.Permission.get(permission.id).$.grantedTo.toArray()

    expect(agentsWithPermission).toHaveLength(2)
    expect(agentsWithPermission.map(a => a.data.name)).toContain('agent-1')
    expect(agentsWithPermission.map(a => a.data.name)).toContain('agent-2')
    expect(agentsWithPermission.map(a => a.data.name)).not.toContain('agent-3')
  })

  it('finds all tools an agent can use', async () => {
    // Setup permissions and tools
    const emailPerm = await graph.Permission.create({ data: { resource: 'email' } })
    const filePerm = await graph.Permission.create({ data: { resource: 'files' } })
    const adminPerm = await graph.Permission.create({ data: { resource: 'admin' } })

    const emailTool = await graph.Tool.create({ data: { id: 'email-tool' } })
    const fileTool = await graph.Tool.create({ data: { id: 'file-tool' } })
    const adminTool = await graph.Tool.create({ data: { id: 'admin-tool' } })

    await graph.createRelationship({ verb: 'requires', from: emailTool.id, to: emailPerm.id })
    await graph.createRelationship({ verb: 'requires', from: fileTool.id, to: filePerm.id })
    await graph.createRelationship({ verb: 'requires', from: adminTool.id, to: adminPerm.id })

    // Agent has email and file permissions (not admin)
    const agent = await graph.Agent.create({ data: { name: 'regular-agent' } })
    await graph.createRelationship({ verb: 'hasPermission', from: agent.id, to: emailPerm.id })
    await graph.createRelationship({ verb: 'hasPermission', from: agent.id, to: filePerm.id })

    // Query: What tools can this agent use?
    const availableTools = await graph.getAvailableTools(agent.id)

    expect(availableTools).toHaveLength(2)
    expect(availableTools.map(t => t.data.id)).toContain('email-tool')
    expect(availableTools.map(t => t.data.id)).toContain('file-tool')
    expect(availableTools.map(t => t.data.id)).not.toContain('admin-tool')
  })

  it('detects permission conflicts', async () => {
    // Create conflicting permissions
    const allowEmail = await graph.Permission.create({
      data: { resource: 'email', action: 'allow', scope: 'organization' },
    })
    const denyEmail = await graph.Permission.create({
      data: { resource: 'email', action: 'deny', scope: 'external' },
    })

    const agent = await graph.Agent.create({ data: { name: 'conflicted-agent' } })
    await graph.createRelationship({ verb: 'hasPermission', from: agent.id, to: allowEmail.id })
    await graph.createRelationship({ verb: 'hasPermission', from: agent.id, to: denyEmail.id })

    // Check for conflicts
    const conflicts = await graph.checkPermissionConflicts(agent.id)

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].resource).toBe('email')
    expect(conflicts[0].allowPermission).toBe(allowEmail.id)
    expect(conflicts[0].denyPermission).toBe(denyEmail.id)
  })
})
