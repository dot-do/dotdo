/**
 * Function Ownership and Access Control Tests
 *
 * Tests for Function ownership via belongsTo relationships and access control
 * via canRead, canExecute, canAdmin relationships.
 *
 * Uses real SQLite via SQLiteGraphStore - NO MOCKS.
 *
 * @see dotdo-d0054 - [RED] Function Ownership and Access Control Tests
 * @see dotdo-mfil2 - [GREEN] Function Ownership and Access Control Implementation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores'
import {
  FunctionGraphAdapter,
  type FunctionData,
} from '../adapters/function-graph-adapter'

describe('Function Ownership via Relationships', () => {
  let store: SQLiteGraphStore
  let adapter: FunctionGraphAdapter

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    adapter = new FunctionGraphAdapter(store)
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // 1. Org Ownership (belongsTo)
  // ==========================================================================

  describe('Org Ownership', () => {
    it('links Function to Org via setOwner', async () => {
      const func = await adapter.createFunction({
        name: 'processOrder',
        type: 'code',
      })

      const rel = await adapter.setOwner(func.id, 'acme-corp')

      expect(rel.verb).toBe('ownedBy')
      expect(rel.from).toContain(func.id)
      expect(rel.to).toBe('do://orgs/acme-corp')
    })

    it('queries all functions for an org via getFunctionsByOrg', async () => {
      // Create functions for different orgs
      const fn1 = await adapter.createFunction({ name: 'fn1', type: 'code' })
      const fn2 = await adapter.createFunction({ name: 'fn2', type: 'generative' })
      const fn3 = await adapter.createFunction({ name: 'fn3', type: 'code' })
      const fn4 = await adapter.createFunction({ name: 'fn4', type: 'agentic' })

      // Assign to orgs
      await adapter.setOwner(fn1.id, 'acme-corp')
      await adapter.setOwner(fn2.id, 'acme-corp')
      await adapter.setOwner(fn3.id, 'other-org')
      // fn4 has no owner

      // Query functions by org
      const acmeFunctions = await adapter.getFunctionsByOrg('acme-corp')
      const otherFunctions = await adapter.getFunctionsByOrg('other-org')
      const noOwnerFunctions = await adapter.getFunctionsByOrg('nonexistent-org')

      expect(acmeFunctions).toHaveLength(2)
      expect(acmeFunctions.map((f) => f.id)).toContain(fn1.id)
      expect(acmeFunctions.map((f) => f.id)).toContain(fn2.id)

      expect(otherFunctions).toHaveLength(1)
      expect(otherFunctions[0].id).toBe(fn3.id)

      expect(noOwnerFunctions).toHaveLength(0)
    })

    it('handles function transfer between orgs', async () => {
      const func = await adapter.createFunction({ name: 'transferMe', type: 'code' })

      // Initially owned by org1
      await adapter.setOwner(func.id, 'org-1')
      let owner = await adapter.getOwner(func.id)
      expect(owner).toBe('org-1')

      // Transfer to org2
      await adapter.setOwner(func.id, 'org-2')
      owner = await adapter.getOwner(func.id)
      expect(owner).toBe('org-2')

      // Verify org1 no longer has the function
      const org1Functions = await adapter.getFunctionsByOrg('org-1')
      expect(org1Functions).toHaveLength(0)

      // Verify org2 has the function
      const org2Functions = await adapter.getFunctionsByOrg('org-2')
      expect(org2Functions).toHaveLength(1)
      expect(org2Functions[0].id).toBe(func.id)
    })
  })

  // ==========================================================================
  // 2. Interface Implementation (implements)
  // ==========================================================================

  describe('Interface Implementation', () => {
    it('links Function to Interface via setInterface', async () => {
      const func = await adapter.createFunction({
        name: 'processPayment',
        type: 'code',
      })

      const rel = await adapter.setInterface(func.id, 'PaymentProcessor')

      expect(rel.verb).toBe('implements')
      expect(rel.from).toContain(func.id)
      expect(rel.to).toBe('do://interfaces/PaymentProcessor')
    })

    it('queries all functions implementing interface via getFunctionsByInterface', async () => {
      // Create functions
      const fn1 = await adapter.createFunction({ name: 'stripeProcessor', type: 'code' })
      const fn2 = await adapter.createFunction({ name: 'paypalProcessor', type: 'code' })
      const fn3 = await adapter.createFunction({ name: 'emailNotifier', type: 'code' })
      const fn4 = await adapter.createFunction({ name: 'slackNotifier', type: 'code' })

      // Assign interfaces
      await adapter.setInterface(fn1.id, 'PaymentProcessor')
      await adapter.setInterface(fn2.id, 'PaymentProcessor')
      await adapter.setInterface(fn3.id, 'Notifier')
      await adapter.setInterface(fn4.id, 'Notifier')
      await adapter.setInterface(fn4.id, 'SlackIntegration') // Multiple interfaces

      // Query functions by interface
      const paymentFunctions = await adapter.getFunctionsByInterface('PaymentProcessor')
      const notifierFunctions = await adapter.getFunctionsByInterface('Notifier')
      const slackFunctions = await adapter.getFunctionsByInterface('SlackIntegration')
      const noFunctions = await adapter.getFunctionsByInterface('NonExistent')

      expect(paymentFunctions).toHaveLength(2)
      expect(paymentFunctions.map((f) => f.id)).toContain(fn1.id)
      expect(paymentFunctions.map((f) => f.id)).toContain(fn2.id)

      expect(notifierFunctions).toHaveLength(2)

      expect(slackFunctions).toHaveLength(1)
      expect(slackFunctions[0].id).toBe(fn4.id)

      expect(noFunctions).toHaveLength(0)
    })

    it('supports functions with multiple interfaces', async () => {
      const func = await adapter.createFunction({
        name: 'multiInterfaceFunc',
        type: 'code',
      })

      await adapter.setInterface(func.id, 'Interface1')
      await adapter.setInterface(func.id, 'Interface2')
      await adapter.setInterface(func.id, 'Interface3')

      const interfaces = await adapter.getInterfaces(func.id)

      expect(interfaces).toHaveLength(3)
      expect(interfaces).toContain('Interface1')
      expect(interfaces).toContain('Interface2')
      expect(interfaces).toContain('Interface3')
    })
  })

  // ==========================================================================
  // 3. Access Control
  // ==========================================================================

  describe('Access Control', () => {
    describe('grantAccess', () => {
      it('grants read access via canRead relationship', async () => {
        const func = await adapter.createFunction({ name: 'readableFunc', type: 'code' })

        const rel = await adapter.grantAccess(func.id, 'user-123', 'read')

        expect(rel.verb).toBe('canRead')
        expect(rel.to).toContain(func.id)
        expect(rel.from).toBe('do://principals/user-123')
      })

      it('grants execute access via canExecute relationship', async () => {
        const func = await adapter.createFunction({ name: 'executableFunc', type: 'code' })

        const rel = await adapter.grantAccess(func.id, 'user-456', 'execute')

        expect(rel.verb).toBe('canExecute')
        expect(rel.to).toContain(func.id)
        expect(rel.from).toBe('do://principals/user-456')
      })

      it('grants admin access via canAdmin relationship', async () => {
        const func = await adapter.createFunction({ name: 'adminFunc', type: 'code' })

        const rel = await adapter.grantAccess(func.id, 'admin-user', 'admin')

        expect(rel.verb).toBe('canAdmin')
        expect(rel.to).toContain(func.id)
        expect(rel.from).toBe('do://principals/admin-user')
      })

      it('throws error for invalid function', async () => {
        await expect(
          adapter.grantAccess('nonexistent-func', 'user-123', 'read')
        ).rejects.toThrow("Function 'nonexistent-func' not found")
      })
    })

    describe('hasAccess', () => {
      it('returns true when principal has read access', async () => {
        const func = await adapter.createFunction({ name: 'func', type: 'code' })
        await adapter.grantAccess(func.id, 'reader-user', 'read')

        const hasRead = await adapter.hasAccess(func.id, 'reader-user', 'read')

        expect(hasRead).toBe(true)
      })

      it('returns true when principal has execute access', async () => {
        const func = await adapter.createFunction({ name: 'func', type: 'code' })
        await adapter.grantAccess(func.id, 'executor-user', 'execute')

        const hasExecute = await adapter.hasAccess(func.id, 'executor-user', 'execute')

        expect(hasExecute).toBe(true)
      })

      it('returns true when principal has admin access', async () => {
        const func = await adapter.createFunction({ name: 'func', type: 'code' })
        await adapter.grantAccess(func.id, 'admin-user', 'admin')

        const hasAdmin = await adapter.hasAccess(func.id, 'admin-user', 'admin')

        expect(hasAdmin).toBe(true)
      })

      it('returns false when principal lacks the specific permission', async () => {
        const func = await adapter.createFunction({ name: 'func', type: 'code' })
        await adapter.grantAccess(func.id, 'reader-user', 'read')

        // User has read but not execute
        const hasExecute = await adapter.hasAccess(func.id, 'reader-user', 'execute')

        expect(hasExecute).toBe(false)
      })

      it('returns false when no relationship exists', async () => {
        const func = await adapter.createFunction({ name: 'func', type: 'code' })

        const hasRead = await adapter.hasAccess(func.id, 'random-user', 'read')

        expect(hasRead).toBe(false)
      })

      it('admin access implies read and execute access', async () => {
        const func = await adapter.createFunction({ name: 'func', type: 'code' })
        await adapter.grantAccess(func.id, 'admin-user', 'admin')

        // Admin should have implied read and execute
        const hasRead = await adapter.hasAccess(func.id, 'admin-user', 'read')
        const hasExecute = await adapter.hasAccess(func.id, 'admin-user', 'execute')
        const hasAdmin = await adapter.hasAccess(func.id, 'admin-user', 'admin')

        expect(hasRead).toBe(true)
        expect(hasExecute).toBe(true)
        expect(hasAdmin).toBe(true)
      })

      it('execute access implies read access', async () => {
        const func = await adapter.createFunction({ name: 'func', type: 'code' })
        await adapter.grantAccess(func.id, 'executor-user', 'execute')

        // Execute should imply read
        const hasRead = await adapter.hasAccess(func.id, 'executor-user', 'read')
        const hasExecute = await adapter.hasAccess(func.id, 'executor-user', 'execute')
        const hasAdmin = await adapter.hasAccess(func.id, 'executor-user', 'admin')

        expect(hasRead).toBe(true)
        expect(hasExecute).toBe(true)
        expect(hasAdmin).toBe(false)
      })
    })

    describe('multiple principals', () => {
      it('grants access to multiple principals', async () => {
        const func = await adapter.createFunction({ name: 'sharedFunc', type: 'code' })

        await adapter.grantAccess(func.id, 'user-1', 'read')
        await adapter.grantAccess(func.id, 'user-2', 'execute')
        await adapter.grantAccess(func.id, 'user-3', 'admin')

        expect(await adapter.hasAccess(func.id, 'user-1', 'read')).toBe(true)
        expect(await adapter.hasAccess(func.id, 'user-1', 'execute')).toBe(false)

        expect(await adapter.hasAccess(func.id, 'user-2', 'read')).toBe(true) // implied
        expect(await adapter.hasAccess(func.id, 'user-2', 'execute')).toBe(true)
        expect(await adapter.hasAccess(func.id, 'user-2', 'admin')).toBe(false)

        expect(await adapter.hasAccess(func.id, 'user-3', 'read')).toBe(true) // implied
        expect(await adapter.hasAccess(func.id, 'user-3', 'execute')).toBe(true) // implied
        expect(await adapter.hasAccess(func.id, 'user-3', 'admin')).toBe(true)
      })
    })

    describe('org-based access', () => {
      it('org members have access to org functions', async () => {
        const func = await adapter.createFunction({ name: 'orgFunc', type: 'code' })
        await adapter.setOwner(func.id, 'acme-corp')

        // Grant access to org
        await adapter.grantAccess(func.id, 'org:acme-corp', 'execute')

        // Check access (org principal format)
        const hasAccess = await adapter.hasAccess(func.id, 'org:acme-corp', 'execute')

        expect(hasAccess).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 4. Combined Ownership and Access
  // ==========================================================================

  describe('Combined Ownership and Access', () => {
    it('function with owner, interfaces, and access control', async () => {
      // Create a function
      const func = await adapter.createFunction({
        name: 'enterpriseFunction',
        type: 'generative',
        description: 'Enterprise-grade AI function',
      })

      // Set ownership
      await adapter.setOwner(func.id, 'enterprise-corp')

      // Set interfaces
      await adapter.setInterface(func.id, 'AIProcessor')
      await adapter.setInterface(func.id, 'Auditable')

      // Set access control
      await adapter.grantAccess(func.id, 'dev-team', 'execute')
      await adapter.grantAccess(func.id, 'admin-team', 'admin')
      await adapter.grantAccess(func.id, 'viewer-team', 'read')

      // Verify all relationships
      const owner = await adapter.getOwner(func.id)
      expect(owner).toBe('enterprise-corp')

      const interfaces = await adapter.getInterfaces(func.id)
      expect(interfaces).toHaveLength(2)
      expect(interfaces).toContain('AIProcessor')
      expect(interfaces).toContain('Auditable')

      expect(await adapter.hasAccess(func.id, 'dev-team', 'execute')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'admin-team', 'admin')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'viewer-team', 'read')).toBe(true)

      // Verify queries work
      const orgFunctions = await adapter.getFunctionsByOrg('enterprise-corp')
      expect(orgFunctions).toHaveLength(1)
      expect(orgFunctions[0].id).toBe(func.id)

      const aiProcessorFunctions = await adapter.getFunctionsByInterface('AIProcessor')
      expect(aiProcessorFunctions).toHaveLength(1)
      expect(aiProcessorFunctions[0].id).toBe(func.id)
    })
  })
})
