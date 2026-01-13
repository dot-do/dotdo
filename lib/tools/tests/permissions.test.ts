/**
 * Permission Enforcement Tests
 *
 * Tests for permission checking using Tool -> Permission relationships
 * and enforcement on tool invocation.
 *
 * RED PHASE: These tests define the contract for permission enforcement.
 *
 * @see dotdo-f46aq - [GREEN] Implement Permission Enforcement via Graph
 *
 * Design:
 * - Permission Thing Schema with type, resource, scope, name
 * - Tool -> Permission relationships via 'requires' verb
 * - Executor -> Permission relationships via 'hasPermission' verb
 * - Security level checks for tool access control
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { GraphStore } from '../../../db/graph/types'
import { SQLiteGraphStore } from '../../../db/graph/stores'
import {
  checkToolPermission,
  checkSecurityLevel,
  PermissionCheckResult,
  SecurityLevel,
  SECURITY_LEVELS,
  PermissionDeniedError,
} from '../permissions'
import type { PermissionThingData, ToolThingData } from '../permissions'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a test graph store with proper initialization
 */
async function createTestStore(): Promise<SQLiteGraphStore> {
  const store = new SQLiteGraphStore(':memory:')
  await store.initialize()
  return store
}

/**
 * Create a permission thing in the graph
 */
async function createPermission(
  store: GraphStore,
  id: string,
  data: PermissionThingData
): Promise<void> {
  await store.createThing({
    id,
    typeId: 100, // Permission type
    typeName: 'Permission',
    data,
  })
}

/**
 * Create a tool thing in the graph
 */
async function createTool(
  store: GraphStore,
  id: string,
  data: ToolThingData
): Promise<void> {
  await store.createThing({
    id,
    typeId: 101, // Tool type
    typeName: 'Tool',
    data,
  })
}

/**
 * Create an executor (agent/user) thing in the graph
 */
async function createExecutor(
  store: GraphStore,
  id: string,
  data: { name: string; securityLevel?: SecurityLevel }
): Promise<void> {
  await store.createThing({
    id,
    typeId: 102, // Executor type
    typeName: 'Executor',
    data,
  })
}

/**
 * Link a tool to a required permission
 */
async function linkToolToPermission(
  store: GraphStore,
  toolId: string,
  permissionId: string
): Promise<void> {
  await store.createRelationship({
    id: `${toolId}-requires-${permissionId}`,
    verb: 'requires',
    from: toolId,
    to: permissionId,
  })
}

/**
 * Grant a permission to an executor
 */
async function grantPermission(
  store: GraphStore,
  executorId: string,
  permissionId: string
): Promise<void> {
  await store.createRelationship({
    id: `${executorId}-hasPermission-${permissionId}`,
    verb: 'hasPermission',
    from: executorId,
    to: permissionId,
  })
}

// ============================================================================
// PERMISSION THING INTERFACE TESTS
// ============================================================================

describe('Permission Thing Interface', () => {
  it('exports PermissionThingData interface', () => {
    // Compile-time check - if this compiles, the interface exists
    const permission: PermissionThingData = {
      type: 'read',
      resource: 'email',
      scope: 'organization',
    }
    expect(permission.type).toBe('read')
  })

  it('supports all permission types', () => {
    const types: PermissionThingData['type'][] = [
      'read',
      'write',
      'execute',
      'admin',
      'custom',
    ]

    for (const type of types) {
      const permission: PermissionThingData = { type }
      expect(permission.type).toBe(type)
    }
  })

  it('supports custom permission name', () => {
    const permission: PermissionThingData = {
      type: 'custom',
      name: 'approve-large-refunds',
    }
    expect(permission.name).toBe('approve-large-refunds')
  })

  it('supports resource and scope fields', () => {
    const permission: PermissionThingData = {
      type: 'write',
      resource: 'payment',
      scope: 'user',
    }
    expect(permission.resource).toBe('payment')
    expect(permission.scope).toBe('user')
  })
})

// ============================================================================
// TOOL THING INTERFACE TESTS
// ============================================================================

describe('Tool Thing Interface', () => {
  it('exports ToolThingData interface', () => {
    const tool: ToolThingData = {
      name: 'sendEmail',
      description: 'Send an email to a recipient',
      securityLevel: 'internal',
    }
    expect(tool.name).toBe('sendEmail')
  })

  it('supports security levels', () => {
    const levels: SecurityLevel[] = ['public', 'internal', 'confidential', 'restricted']

    for (const level of levels) {
      const tool: ToolThingData = {
        name: 'testTool',
        securityLevel: level,
      }
      expect(tool.securityLevel).toBe(level)
    }
  })
})

// ============================================================================
// SECURITY LEVEL CONSTANTS TESTS
// ============================================================================

describe('Security Level Constants', () => {
  it('exports SECURITY_LEVELS in correct order', () => {
    expect(SECURITY_LEVELS).toEqual(['public', 'internal', 'confidential', 'restricted'])
  })

  it('public has lowest index (0)', () => {
    expect(SECURITY_LEVELS.indexOf('public')).toBe(0)
  })

  it('restricted has highest index (3)', () => {
    expect(SECURITY_LEVELS.indexOf('restricted')).toBe(3)
  })
})

// ============================================================================
// CHECK TOOL PERMISSION TESTS
// ============================================================================

describe('checkToolPermission', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = await createTestStore()
  })

  describe('tool with no required permissions', () => {
    it('allows access when tool has no required permissions', async () => {
      // Create tool with no permission requirements
      await createTool(store, 'tool-1', { name: 'publicTool' })
      await createExecutor(store, 'executor-1', { name: 'Agent' })

      const result = await checkToolPermission(store, 'tool-1', 'executor-1')

      expect(result.allowed).toBe(true)
      expect(result.reason).toBeUndefined()
    })
  })

  describe('tool with single required permission', () => {
    beforeEach(async () => {
      // Create permission
      await createPermission(store, 'perm-email-read', {
        type: 'read',
        resource: 'email',
      })

      // Create tool that requires the permission
      await createTool(store, 'tool-read-email', { name: 'readEmail' })
      await linkToolToPermission(store, 'tool-read-email', 'perm-email-read')
    })

    it('allows access when executor has the required permission', async () => {
      // Create executor with permission
      await createExecutor(store, 'executor-1', { name: 'EmailAgent' })
      await grantPermission(store, 'executor-1', 'perm-email-read')

      const result = await checkToolPermission(store, 'tool-read-email', 'executor-1')

      expect(result.allowed).toBe(true)
    })

    it('denies access when executor lacks the required permission', async () => {
      // Create executor without permission
      await createExecutor(store, 'executor-2', { name: 'NoPermAgent' })

      const result = await checkToolPermission(store, 'tool-read-email', 'executor-2')

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Missing permission')
      expect(result.reason).toContain('email')
      expect(result.reason).toContain('read')
    })
  })

  describe('tool with multiple required permissions', () => {
    beforeEach(async () => {
      // Create multiple permissions
      await createPermission(store, 'perm-payment-read', {
        type: 'read',
        resource: 'payment',
      })
      await createPermission(store, 'perm-payment-write', {
        type: 'write',
        resource: 'payment',
      })

      // Create tool that requires both
      await createTool(store, 'tool-process-refund', { name: 'processRefund' })
      await linkToolToPermission(store, 'tool-process-refund', 'perm-payment-read')
      await linkToolToPermission(store, 'tool-process-refund', 'perm-payment-write')
    })

    it('allows access when executor has all required permissions', async () => {
      await createExecutor(store, 'executor-full', { name: 'PaymentAgent' })
      await grantPermission(store, 'executor-full', 'perm-payment-read')
      await grantPermission(store, 'executor-full', 'perm-payment-write')

      const result = await checkToolPermission(store, 'tool-process-refund', 'executor-full')

      expect(result.allowed).toBe(true)
    })

    it('denies access when executor has only some permissions', async () => {
      await createExecutor(store, 'executor-partial', { name: 'ReadOnlyAgent' })
      await grantPermission(store, 'executor-partial', 'perm-payment-read')
      // Missing: perm-payment-write

      const result = await checkToolPermission(store, 'tool-process-refund', 'executor-partial')

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Missing permission')
      expect(result.reason).toContain('write')
    })

    it('denies access when executor has no permissions', async () => {
      await createExecutor(store, 'executor-none', { name: 'NoPermAgent' })

      const result = await checkToolPermission(store, 'tool-process-refund', 'executor-none')

      expect(result.allowed).toBe(false)
    })
  })

  describe('permission inheritance via multiple grants', () => {
    it('executor can have permissions from multiple sources', async () => {
      // Create permissions
      await createPermission(store, 'perm-a', { type: 'read', resource: 'a' })
      await createPermission(store, 'perm-b', { type: 'read', resource: 'b' })

      // Create tool requiring both
      await createTool(store, 'tool-ab', { name: 'toolAB' })
      await linkToolToPermission(store, 'tool-ab', 'perm-a')
      await linkToolToPermission(store, 'tool-ab', 'perm-b')

      // Executor has both permissions (from different grants)
      await createExecutor(store, 'executor-multi', { name: 'MultiAgent' })
      await grantPermission(store, 'executor-multi', 'perm-a')
      await grantPermission(store, 'executor-multi', 'perm-b')

      const result = await checkToolPermission(store, 'tool-ab', 'executor-multi')

      expect(result.allowed).toBe(true)
    })
  })

  describe('missing entities', () => {
    it('returns denied for non-existent tool', async () => {
      await createExecutor(store, 'executor-1', { name: 'Agent' })

      const result = await checkToolPermission(store, 'non-existent-tool', 'executor-1')

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Tool not found')
    })

    it('returns denied for non-existent executor', async () => {
      await createTool(store, 'tool-1', { name: 'someTool' })

      const result = await checkToolPermission(store, 'tool-1', 'non-existent-executor')

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Executor not found')
    })
  })
})

// ============================================================================
// CHECK SECURITY LEVEL TESTS
// ============================================================================

describe('checkSecurityLevel', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = await createTestStore()
  })

  describe('security level hierarchy', () => {
    it('public executor can access public tools', async () => {
      await createTool(store, 'tool-public', { name: 'publicTool', securityLevel: 'public' })
      await createExecutor(store, 'exec-public', { name: 'PublicAgent', securityLevel: 'public' })

      const result = await checkSecurityLevel(store, 'tool-public', 'exec-public')

      expect(result.allowed).toBe(true)
    })

    it('public executor cannot access internal tools', async () => {
      await createTool(store, 'tool-internal', { name: 'internalTool', securityLevel: 'internal' })
      await createExecutor(store, 'exec-public', { name: 'PublicAgent', securityLevel: 'public' })

      const result = await checkSecurityLevel(store, 'tool-internal', 'exec-public')

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Security level')
      expect(result.reason).toContain('public')
      expect(result.reason).toContain('internal')
    })

    it('internal executor can access public tools', async () => {
      await createTool(store, 'tool-public', { name: 'publicTool', securityLevel: 'public' })
      await createExecutor(store, 'exec-internal', { name: 'InternalAgent', securityLevel: 'internal' })

      const result = await checkSecurityLevel(store, 'tool-public', 'exec-internal')

      expect(result.allowed).toBe(true)
    })

    it('internal executor can access internal tools', async () => {
      await createTool(store, 'tool-internal', { name: 'internalTool', securityLevel: 'internal' })
      await createExecutor(store, 'exec-internal', { name: 'InternalAgent', securityLevel: 'internal' })

      const result = await checkSecurityLevel(store, 'tool-internal', 'exec-internal')

      expect(result.allowed).toBe(true)
    })

    it('internal executor cannot access confidential tools', async () => {
      await createTool(store, 'tool-confidential', { name: 'confidentialTool', securityLevel: 'confidential' })
      await createExecutor(store, 'exec-internal', { name: 'InternalAgent', securityLevel: 'internal' })

      const result = await checkSecurityLevel(store, 'tool-confidential', 'exec-internal')

      expect(result.allowed).toBe(false)
    })

    it('confidential executor can access all except restricted', async () => {
      await createExecutor(store, 'exec-confidential', { name: 'ConfidentialAgent', securityLevel: 'confidential' })

      // Can access public
      await createTool(store, 'tool-public', { name: 'publicTool', securityLevel: 'public' })
      expect((await checkSecurityLevel(store, 'tool-public', 'exec-confidential')).allowed).toBe(true)

      // Can access internal
      await createTool(store, 'tool-internal', { name: 'internalTool', securityLevel: 'internal' })
      expect((await checkSecurityLevel(store, 'tool-internal', 'exec-confidential')).allowed).toBe(true)

      // Can access confidential
      await createTool(store, 'tool-confidential', { name: 'confidentialTool', securityLevel: 'confidential' })
      expect((await checkSecurityLevel(store, 'tool-confidential', 'exec-confidential')).allowed).toBe(true)

      // Cannot access restricted
      await createTool(store, 'tool-restricted', { name: 'restrictedTool', securityLevel: 'restricted' })
      expect((await checkSecurityLevel(store, 'tool-restricted', 'exec-confidential')).allowed).toBe(false)
    })

    it('restricted executor can access all tools', async () => {
      await createExecutor(store, 'exec-restricted', { name: 'RestrictedAgent', securityLevel: 'restricted' })

      for (const level of SECURITY_LEVELS) {
        await createTool(store, `tool-${level}`, { name: `${level}Tool`, securityLevel: level })
        const result = await checkSecurityLevel(store, `tool-${level}`, 'exec-restricted')
        expect(result.allowed).toBe(true)
      }
    })
  })

  describe('default security levels', () => {
    it('tool without securityLevel defaults to internal', async () => {
      await createTool(store, 'tool-default', { name: 'defaultTool' }) // No securityLevel
      await createExecutor(store, 'exec-public', { name: 'PublicAgent', securityLevel: 'public' })

      const result = await checkSecurityLevel(store, 'tool-default', 'exec-public')

      expect(result.allowed).toBe(false) // public cannot access internal (default)
    })

    it('executor without securityLevel defaults to public', async () => {
      await createTool(store, 'tool-internal', { name: 'internalTool', securityLevel: 'internal' })
      await createExecutor(store, 'exec-default', { name: 'DefaultAgent' }) // No securityLevel

      const result = await checkSecurityLevel(store, 'tool-internal', 'exec-default')

      expect(result.allowed).toBe(false) // public (default) cannot access internal
    })

    it('both default to public can access internal tool defaults', async () => {
      await createTool(store, 'tool-public', { name: 'publicTool', securityLevel: 'public' })
      await createExecutor(store, 'exec-default', { name: 'DefaultAgent' }) // defaults to public

      const result = await checkSecurityLevel(store, 'tool-public', 'exec-default')

      expect(result.allowed).toBe(true)
    })
  })
})

// ============================================================================
// PERMISSION DENIED ERROR TESTS
// ============================================================================

describe('PermissionDeniedError', () => {
  it('creates error with correct properties', () => {
    const error = new PermissionDeniedError('Missing read permission on email', {
      toolId: 'tool-1',
      executorId: 'executor-1',
      missingPermissions: ['perm-email-read'],
    })

    expect(error.message).toBe('Missing read permission on email')
    expect(error.name).toBe('PermissionDeniedError')
    expect(error.details.toolId).toBe('tool-1')
    expect(error.details.executorId).toBe('executor-1')
    expect(error.details.missingPermissions).toContain('perm-email-read')
  })

  it('is instanceof Error', () => {
    const error = new PermissionDeniedError('test')

    expect(error).toBeInstanceOf(Error)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Permission Enforcement Integration', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = await createTestStore()
  })

  describe('complete permission check flow', () => {
    beforeEach(async () => {
      // Create a realistic permission hierarchy
      await createPermission(store, 'perm-customer-read', {
        type: 'read',
        resource: 'customer',
        scope: 'organization',
      })
      await createPermission(store, 'perm-payment-execute', {
        type: 'execute',
        resource: 'payment',
        scope: 'organization',
      })

      // Create tools with different security levels and permission requirements
      await createTool(store, 'tool-view-customer', {
        name: 'viewCustomer',
        description: 'View customer details',
        securityLevel: 'internal',
      })
      await linkToolToPermission(store, 'tool-view-customer', 'perm-customer-read')

      await createTool(store, 'tool-process-payment', {
        name: 'processPayment',
        description: 'Process a payment',
        securityLevel: 'confidential',
      })
      await linkToolToPermission(store, 'tool-process-payment', 'perm-customer-read')
      await linkToolToPermission(store, 'tool-process-payment', 'perm-payment-execute')
    })

    it('customer service agent can view customers but not process payments', async () => {
      // Create customer service agent
      await createExecutor(store, 'agent-cs', {
        name: 'CustomerServiceAgent',
        securityLevel: 'internal',
      })
      await grantPermission(store, 'agent-cs', 'perm-customer-read')

      // Can view customer
      const viewResult = await checkToolPermission(store, 'tool-view-customer', 'agent-cs')
      expect(viewResult.allowed).toBe(true)

      // Cannot process payment (missing permission)
      const paymentResult = await checkToolPermission(store, 'tool-process-payment', 'agent-cs')
      expect(paymentResult.allowed).toBe(false)
    })

    it('payment agent with all permissions can process payments', async () => {
      // Create payment agent with all required permissions
      await createExecutor(store, 'agent-payment', {
        name: 'PaymentAgent',
        securityLevel: 'confidential',
      })
      await grantPermission(store, 'agent-payment', 'perm-customer-read')
      await grantPermission(store, 'agent-payment', 'perm-payment-execute')

      const result = await checkToolPermission(store, 'tool-process-payment', 'agent-payment')

      expect(result.allowed).toBe(true)
    })

    it('public agent cannot access internal tools regardless of permissions', async () => {
      // Create public agent with all permissions
      await createExecutor(store, 'agent-public', {
        name: 'PublicAgent',
        securityLevel: 'public',
      })
      await grantPermission(store, 'agent-public', 'perm-customer-read')

      // Permission check passes...
      const permResult = await checkToolPermission(store, 'tool-view-customer', 'agent-public')
      expect(permResult.allowed).toBe(true)

      // ...but security level check fails
      const secResult = await checkSecurityLevel(store, 'tool-view-customer', 'agent-public')
      expect(secResult.allowed).toBe(false)
    })
  })
})
