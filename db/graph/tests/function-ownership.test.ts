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

  // ==========================================================================
  // 5. Permission Inheritance (RED PHASE)
  // ==========================================================================

  describe('Permission Inheritance', () => {
    it('role-based permission inheritance via hasRole relationship', async () => {
      const func = await adapter.createFunction({ name: 'roleBasedFunc', type: 'code' })

      // Create a role with execute permission
      // Role -> grants -> execute permission on function
      // User -> hasRole -> Role
      // Therefore User has execute access (and implied read)
      await adapter.createRole('developer-role')
      await adapter.grantRoleAccess('developer-role', func.id, 'execute')
      await adapter.assignRole('user-dev', 'developer-role')

      // User should have execute access through role
      const hasExecute = await adapter.hasAccess(func.id, 'user-dev', 'execute')
      const hasRead = await adapter.hasAccess(func.id, 'user-dev', 'read') // implied
      const hasAdmin = await adapter.hasAccess(func.id, 'user-dev', 'admin')

      expect(hasExecute).toBe(true)
      expect(hasRead).toBe(true)
      expect(hasAdmin).toBe(false)
    })

    it('nested role inheritance (admin role includes developer role)', async () => {
      const func = await adapter.createFunction({ name: 'nestedRoleFunc', type: 'code' })

      // Create role hierarchy: admin -> developer -> viewer
      await adapter.createRole('viewer-role')
      await adapter.createRole('developer-role')
      await adapter.createRole('admin-role')

      // Set role inheritance
      await adapter.setRoleInheritance('developer-role', 'viewer-role')
      await adapter.setRoleInheritance('admin-role', 'developer-role')

      // Grant permissions at each level
      await adapter.grantRoleAccess('viewer-role', func.id, 'read')
      await adapter.grantRoleAccess('developer-role', func.id, 'execute')
      await adapter.grantRoleAccess('admin-role', func.id, 'admin')

      // Assign admin role to user
      await adapter.assignRole('super-user', 'admin-role')

      // Super user should have all permissions through inheritance
      expect(await adapter.hasAccess(func.id, 'super-user', 'read')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'super-user', 'execute')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'super-user', 'admin')).toBe(true)
    })

    it('org membership implies access to org-owned functions', async () => {
      const func = await adapter.createFunction({ name: 'orgOwnedFunc', type: 'code' })
      await adapter.setOwner(func.id, 'tech-corp')

      // Set org-level default permission
      await adapter.setOrgDefaultAccess('tech-corp', 'read')

      // Add user to org
      await adapter.addOrgMember('tech-corp', 'employee-1')

      // Employee should have read access through org membership
      const hasRead = await adapter.hasAccess(func.id, 'employee-1', 'read')
      const hasExecute = await adapter.hasAccess(func.id, 'employee-1', 'execute')

      expect(hasRead).toBe(true)
      expect(hasExecute).toBe(false)
    })

    it('team-based permission inheritance', async () => {
      const func = await adapter.createFunction({ name: 'teamFunc', type: 'code' })

      // Create team and add members
      await adapter.createTeam('backend-team', 'tech-corp')
      await adapter.addTeamMember('backend-team', 'dev-1')
      await adapter.addTeamMember('backend-team', 'dev-2')

      // Grant team-level access
      await adapter.grantAccess(func.id, 'team:backend-team', 'execute')

      // Team members should inherit access
      expect(await adapter.hasAccess(func.id, 'dev-1', 'execute')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'dev-2', 'execute')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'dev-3', 'execute')).toBe(false) // not a member
    })

    it('combined direct and inherited permissions', async () => {
      const func = await adapter.createFunction({ name: 'combinedFunc', type: 'code' })

      // User has direct read access
      await adapter.grantAccess(func.id, 'hybrid-user', 'read')

      // User also has role with execute permission
      await adapter.createRole('executor-role')
      await adapter.grantRoleAccess('executor-role', func.id, 'execute')
      await adapter.assignRole('hybrid-user', 'executor-role')

      // User should have both direct and inherited permissions
      expect(await adapter.hasAccess(func.id, 'hybrid-user', 'read')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'hybrid-user', 'execute')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'hybrid-user', 'admin')).toBe(false)
    })

    it('getEffectivePermissions returns all permissions from all sources', async () => {
      const func = await adapter.createFunction({ name: 'multiSourceFunc', type: 'code' })

      // Direct permission
      await adapter.grantAccess(func.id, 'complex-user', 'read')

      // Role permission
      await adapter.createRole('worker-role')
      await adapter.grantRoleAccess('worker-role', func.id, 'execute')
      await adapter.assignRole('complex-user', 'worker-role')

      // Get all effective permissions
      const permissions = await adapter.getEffectivePermissions(func.id, 'complex-user')

      expect(permissions).toContain('read')
      expect(permissions).toContain('execute')
      expect(permissions).not.toContain('admin')
    })
  })

  // ==========================================================================
  // 6. Multi-Owner Scenarios (RED PHASE)
  // ==========================================================================

  describe('Multi-Owner Scenarios', () => {
    it('supports co-ownership by multiple orgs', async () => {
      const func = await adapter.createFunction({ name: 'sharedOwnershipFunc', type: 'code' })

      // Add multiple owners
      await adapter.addOwner(func.id, 'org-alpha')
      await adapter.addOwner(func.id, 'org-beta')

      // Both orgs should be owners
      const owners = await adapter.getOwners(func.id)

      expect(owners).toHaveLength(2)
      expect(owners).toContain('org-alpha')
      expect(owners).toContain('org-beta')
    })

    it('queries functions by any owner', async () => {
      const fn1 = await adapter.createFunction({ name: 'fn1', type: 'code' })
      const fn2 = await adapter.createFunction({ name: 'fn2', type: 'code' })
      const fn3 = await adapter.createFunction({ name: 'fn3', type: 'code' })

      // fn1 owned by alpha and beta
      await adapter.addOwner(fn1.id, 'org-alpha')
      await adapter.addOwner(fn1.id, 'org-beta')

      // fn2 owned only by alpha
      await adapter.addOwner(fn2.id, 'org-alpha')

      // fn3 owned only by gamma
      await adapter.addOwner(fn3.id, 'org-gamma')

      // Query by org
      const alphaFunctions = await adapter.getFunctionsByOrg('org-alpha')
      const betaFunctions = await adapter.getFunctionsByOrg('org-beta')
      const gammaFunctions = await adapter.getFunctionsByOrg('org-gamma')

      expect(alphaFunctions).toHaveLength(2)
      expect(alphaFunctions.map((f) => f.id)).toContain(fn1.id)
      expect(alphaFunctions.map((f) => f.id)).toContain(fn2.id)

      expect(betaFunctions).toHaveLength(1)
      expect(betaFunctions[0].id).toBe(fn1.id)

      expect(gammaFunctions).toHaveLength(1)
      expect(gammaFunctions[0].id).toBe(fn3.id)
    })

    it('tracks ownership percentage/shares', async () => {
      const func = await adapter.createFunction({ name: 'sharedFunc', type: 'code' })

      // Add owners with shares
      await adapter.addOwner(func.id, 'org-majority', { shares: 60 })
      await adapter.addOwner(func.id, 'org-minority', { shares: 40 })

      const ownershipDetails = await adapter.getOwnershipDetails(func.id)

      expect(ownershipDetails).toHaveLength(2)
      expect(ownershipDetails.find((o) => o.orgId === 'org-majority')?.shares).toBe(60)
      expect(ownershipDetails.find((o) => o.orgId === 'org-minority')?.shares).toBe(40)
    })

    it('primary owner has elevated privileges', async () => {
      const func = await adapter.createFunction({ name: 'primaryOwnerFunc', type: 'code' })

      // Add primary and secondary owners
      await adapter.addOwner(func.id, 'org-primary', { isPrimary: true })
      await adapter.addOwner(func.id, 'org-secondary', { isPrimary: false })

      const primaryOwner = await adapter.getPrimaryOwner(func.id)
      expect(primaryOwner).toBe('org-primary')

      // Primary owner should be able to transfer ownership
      const canTransfer = await adapter.canTransferOwnership(func.id, 'org-primary')
      const cannotTransfer = await adapter.canTransferOwnership(func.id, 'org-secondary')

      expect(canTransfer).toBe(true)
      expect(cannotTransfer).toBe(false)
    })

    it('removes co-owner while preserving other owners', async () => {
      const func = await adapter.createFunction({ name: 'removeCoOwnerFunc', type: 'code' })

      await adapter.addOwner(func.id, 'org-a')
      await adapter.addOwner(func.id, 'org-b')
      await adapter.addOwner(func.id, 'org-c')

      // Remove one owner
      await adapter.removeOwner(func.id, 'org-b')

      const owners = await adapter.getOwners(func.id)
      expect(owners).toHaveLength(2)
      expect(owners).toContain('org-a')
      expect(owners).toContain('org-c')
      expect(owners).not.toContain('org-b')
    })

    it('prevents removing last owner', async () => {
      const func = await adapter.createFunction({ name: 'lastOwnerFunc', type: 'code' })

      await adapter.addOwner(func.id, 'sole-owner')

      // Attempting to remove the last owner should fail
      await expect(
        adapter.removeOwner(func.id, 'sole-owner')
      ).rejects.toThrow('Cannot remove the last owner')
    })

    it('ownership transfer audit trail', async () => {
      const func = await adapter.createFunction({ name: 'auditTrailFunc', type: 'code' })

      // Initial owner
      await adapter.addOwner(func.id, 'org-original')

      // Transfer ownership
      await adapter.addOwner(func.id, 'org-new')
      await adapter.removeOwner(func.id, 'org-original')

      // Get ownership history
      const history = await adapter.getOwnershipHistory(func.id)

      expect(history).toHaveLength(3) // add original, add new, remove original
      expect(history[0].action).toBe('added')
      expect(history[0].orgId).toBe('org-original')
      expect(history[1].action).toBe('added')
      expect(history[1].orgId).toBe('org-new')
      expect(history[2].action).toBe('removed')
      expect(history[2].orgId).toBe('org-original')
    })
  })

  // ==========================================================================
  // 7. Revocation Handling (RED PHASE)
  // ==========================================================================

  describe('Revocation Handling', () => {
    it('revokes direct access permission', async () => {
      const func = await adapter.createFunction({ name: 'revocableFunc', type: 'code' })

      // Grant access
      await adapter.grantAccess(func.id, 'temp-user', 'execute')
      expect(await adapter.hasAccess(func.id, 'temp-user', 'execute')).toBe(true)

      // Revoke access
      await adapter.revokeAccess(func.id, 'temp-user', 'execute')
      expect(await adapter.hasAccess(func.id, 'temp-user', 'execute')).toBe(false)
    })

    it('revokes all access for a principal', async () => {
      const func = await adapter.createFunction({ name: 'fullRevokeFunc', type: 'code' })

      // Grant multiple permissions
      await adapter.grantAccess(func.id, 'doomed-user', 'read')
      await adapter.grantAccess(func.id, 'doomed-user', 'execute')
      await adapter.grantAccess(func.id, 'doomed-user', 'admin')

      // Revoke all
      await adapter.revokeAllAccess(func.id, 'doomed-user')

      expect(await adapter.hasAccess(func.id, 'doomed-user', 'read')).toBe(false)
      expect(await adapter.hasAccess(func.id, 'doomed-user', 'execute')).toBe(false)
      expect(await adapter.hasAccess(func.id, 'doomed-user', 'admin')).toBe(false)
    })

    it('revokes role assignment', async () => {
      const func = await adapter.createFunction({ name: 'roleRevokeFunc', type: 'code' })

      // Set up role with permission
      await adapter.createRole('temp-role')
      await adapter.grantRoleAccess('temp-role', func.id, 'execute')
      await adapter.assignRole('role-user', 'temp-role')

      expect(await adapter.hasAccess(func.id, 'role-user', 'execute')).toBe(true)

      // Revoke role assignment
      await adapter.revokeRole('role-user', 'temp-role')

      expect(await adapter.hasAccess(func.id, 'role-user', 'execute')).toBe(false)
    })

    it('cascading revocation when role is deleted', async () => {
      const func = await adapter.createFunction({ name: 'cascadeRevokeFunc', type: 'code' })

      await adapter.createRole('deletable-role')
      await adapter.grantRoleAccess('deletable-role', func.id, 'admin')
      await adapter.assignRole('user-a', 'deletable-role')
      await adapter.assignRole('user-b', 'deletable-role')

      // Both users have access
      expect(await adapter.hasAccess(func.id, 'user-a', 'admin')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'user-b', 'admin')).toBe(true)

      // Delete role
      await adapter.deleteRole('deletable-role')

      // Both users lose access
      expect(await adapter.hasAccess(func.id, 'user-a', 'admin')).toBe(false)
      expect(await adapter.hasAccess(func.id, 'user-b', 'admin')).toBe(false)
    })

    it('revocation with immediate effect (no caching)', async () => {
      const func = await adapter.createFunction({ name: 'noCacheFunc', type: 'code' })

      await adapter.grantAccess(func.id, 'cached-user', 'execute')

      // Access should be granted
      expect(await adapter.hasAccess(func.id, 'cached-user', 'execute')).toBe(true)

      // Revoke and immediately check (no stale cache)
      await adapter.revokeAccess(func.id, 'cached-user', 'execute')

      // Access should be denied immediately
      expect(await adapter.hasAccess(func.id, 'cached-user', 'execute')).toBe(false)
    })

    it('revocation event emitted for audit', async () => {
      const func = await adapter.createFunction({ name: 'auditRevokeFunc', type: 'code' })

      await adapter.grantAccess(func.id, 'audited-user', 'execute')

      // Capture revocation event
      const events: Array<{ type: string; functionId: string; principalId: string }> = []
      adapter.onAccessRevoked((event) => events.push(event))

      await adapter.revokeAccess(func.id, 'audited-user', 'execute')

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('access_revoked')
      expect(events[0].functionId).toBe(func.id)
      expect(events[0].principalId).toBe('audited-user')
    })

    it('timed revocation (access expires after duration)', async () => {
      const func = await adapter.createFunction({ name: 'timedAccessFunc', type: 'code' })

      // Grant access with expiration
      const expiresAt = Date.now() + 1000 // 1 second from now
      await adapter.grantAccess(func.id, 'timed-user', 'execute', { expiresAt })

      // Access is valid now
      expect(await adapter.hasAccess(func.id, 'timed-user', 'execute')).toBe(true)

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100))

      // Access should be expired
      expect(await adapter.hasAccess(func.id, 'timed-user', 'execute')).toBe(false)
    })

    it('revokes access from team when member is removed', async () => {
      const func = await adapter.createFunction({ name: 'teamRevokeFunc', type: 'code' })

      // Set up team access
      await adapter.createTeam('removable-team', 'org')
      await adapter.addTeamMember('removable-team', 'team-member')
      await adapter.grantAccess(func.id, 'team:removable-team', 'execute')

      // Member has access through team
      expect(await adapter.hasAccess(func.id, 'team-member', 'execute')).toBe(true)

      // Remove member from team
      await adapter.removeTeamMember('removable-team', 'team-member')

      // Member no longer has access
      expect(await adapter.hasAccess(func.id, 'team-member', 'execute')).toBe(false)
    })

    it('revokes org-level access when member leaves org', async () => {
      const func = await adapter.createFunction({ name: 'orgRevokeFunc', type: 'code' })
      await adapter.setOwner(func.id, 'leaving-org')

      // Set org-level default access
      await adapter.setOrgDefaultAccess('leaving-org', 'read')
      await adapter.addOrgMember('leaving-org', 'leaving-employee')

      // Employee has access through org
      expect(await adapter.hasAccess(func.id, 'leaving-employee', 'read')).toBe(true)

      // Remove from org
      await adapter.removeOrgMember('leaving-org', 'leaving-employee')

      // Employee no longer has access
      expect(await adapter.hasAccess(func.id, 'leaving-employee', 'read')).toBe(false)
    })

    it('getAccessList returns all principals with access', async () => {
      const func = await adapter.createFunction({ name: 'listAccessFunc', type: 'code' })

      await adapter.grantAccess(func.id, 'user-read', 'read')
      await adapter.grantAccess(func.id, 'user-exec', 'execute')
      await adapter.grantAccess(func.id, 'user-admin', 'admin')

      const accessList = await adapter.getAccessList(func.id)

      expect(accessList).toHaveLength(3)
      expect(accessList.find((a) => a.principalId === 'user-read')?.permission).toBe('read')
      expect(accessList.find((a) => a.principalId === 'user-exec')?.permission).toBe('execute')
      expect(accessList.find((a) => a.principalId === 'user-admin')?.permission).toBe('admin')
    })

    it('bulk revocation for multiple functions', async () => {
      const fn1 = await adapter.createFunction({ name: 'bulk1', type: 'code' })
      const fn2 = await adapter.createFunction({ name: 'bulk2', type: 'code' })
      const fn3 = await adapter.createFunction({ name: 'bulk3', type: 'code' })

      // Grant access to all
      await adapter.grantAccess(fn1.id, 'bulk-user', 'execute')
      await adapter.grantAccess(fn2.id, 'bulk-user', 'execute')
      await adapter.grantAccess(fn3.id, 'bulk-user', 'execute')

      // Bulk revoke
      await adapter.bulkRevokeAccess([fn1.id, fn2.id, fn3.id], 'bulk-user')

      expect(await adapter.hasAccess(fn1.id, 'bulk-user', 'execute')).toBe(false)
      expect(await adapter.hasAccess(fn2.id, 'bulk-user', 'execute')).toBe(false)
      expect(await adapter.hasAccess(fn3.id, 'bulk-user', 'execute')).toBe(false)
    })
  })

  // ==========================================================================
  // 8. Access List Queries (RED PHASE)
  // ==========================================================================

  describe('Access List Queries', () => {
    it('getPrincipalsWithAccess returns all principals for a function', async () => {
      const func = await adapter.createFunction({ name: 'queryableFunc', type: 'code' })

      await adapter.grantAccess(func.id, 'user-1', 'read')
      await adapter.grantAccess(func.id, 'user-2', 'execute')
      await adapter.grantAccess(func.id, 'team:engineering', 'admin')

      const principals = await adapter.getPrincipalsWithAccess(func.id)

      expect(principals).toHaveLength(3)
      expect(principals.map((p) => p.id)).toContain('user-1')
      expect(principals.map((p) => p.id)).toContain('user-2')
      expect(principals.map((p) => p.id)).toContain('team:engineering')
    })

    it('getPrincipalsWithAccess filters by permission level', async () => {
      const func = await adapter.createFunction({ name: 'filteredQueryFunc', type: 'code' })

      await adapter.grantAccess(func.id, 'reader', 'read')
      await adapter.grantAccess(func.id, 'executor', 'execute')
      await adapter.grantAccess(func.id, 'admin', 'admin')

      const admins = await adapter.getPrincipalsWithAccess(func.id, { permission: 'admin' })
      const executors = await adapter.getPrincipalsWithAccess(func.id, { permission: 'execute' })

      expect(admins).toHaveLength(1)
      expect(admins[0].id).toBe('admin')

      // Execute filter should include admin (implied)
      expect(executors).toHaveLength(2)
      expect(executors.map((p) => p.id)).toContain('executor')
      expect(executors.map((p) => p.id)).toContain('admin')
    })

    it('getFunctionsAccessibleBy returns all functions for a principal', async () => {
      const fn1 = await adapter.createFunction({ name: 'accessible1', type: 'code' })
      const fn2 = await adapter.createFunction({ name: 'accessible2', type: 'code' })
      const fn3 = await adapter.createFunction({ name: 'inaccessible', type: 'code' })

      await adapter.grantAccess(fn1.id, 'query-user', 'read')
      await adapter.grantAccess(fn2.id, 'query-user', 'execute')
      // fn3 has no access for query-user

      const accessible = await adapter.getFunctionsAccessibleBy('query-user')

      expect(accessible).toHaveLength(2)
      expect(accessible.map((f) => f.id)).toContain(fn1.id)
      expect(accessible.map((f) => f.id)).toContain(fn2.id)
      expect(accessible.map((f) => f.id)).not.toContain(fn3.id)
    })

    it('getFunctionsAccessibleBy includes inherited access', async () => {
      const fn1 = await adapter.createFunction({ name: 'inherited1', type: 'code' })
      const fn2 = await adapter.createFunction({ name: 'inherited2', type: 'code' })

      // Direct access to fn1
      await adapter.grantAccess(fn1.id, 'inherit-user', 'read')

      // Role-based access to fn2
      await adapter.createRole('access-role')
      await adapter.grantRoleAccess('access-role', fn2.id, 'execute')
      await adapter.assignRole('inherit-user', 'access-role')

      const accessible = await adapter.getFunctionsAccessibleBy('inherit-user')

      expect(accessible).toHaveLength(2)
      expect(accessible.map((f) => f.id)).toContain(fn1.id)
      expect(accessible.map((f) => f.id)).toContain(fn2.id)
    })
  })

  // ==========================================================================
  // 9. Creator Tracking (RED PHASE)
  // ==========================================================================

  describe('Creator Tracking', () => {
    it('tracks function creator on creation', async () => {
      const func = await adapter.createFunction(
        { name: 'trackedFunc', type: 'code' },
        { createdBy: 'user-creator-123' }
      )

      const creator = await adapter.getCreator(func.id)

      expect(creator).toBe('user-creator-123')
    })

    it('creator is different from owner', async () => {
      // A user creates a function, but the org owns it
      const func = await adapter.createFunction(
        { name: 'orgFunc', type: 'code' },
        { createdBy: 'employee-jane' }
      )
      await adapter.setOwner(func.id, 'acme-corp')

      const creator = await adapter.getCreator(func.id)
      const owner = await adapter.getOwner(func.id)

      expect(creator).toBe('employee-jane')
      expect(owner).toBe('acme-corp')
      expect(creator).not.toBe(owner)
    })

    it('creator relationship persists through ownership transfer', async () => {
      const func = await adapter.createFunction(
        { name: 'transferredFunc', type: 'code' },
        { createdBy: 'original-creator' }
      )
      await adapter.setOwner(func.id, 'org-1')
      await adapter.setOwner(func.id, 'org-2')

      const creator = await adapter.getCreator(func.id)

      expect(creator).toBe('original-creator')
    })

    it('queries functions by creator', async () => {
      const fn1 = await adapter.createFunction(
        { name: 'fn1', type: 'code' },
        { createdBy: 'alice' }
      )
      const fn2 = await adapter.createFunction(
        { name: 'fn2', type: 'generative' },
        { createdBy: 'alice' }
      )
      const fn3 = await adapter.createFunction(
        { name: 'fn3', type: 'code' },
        { createdBy: 'bob' }
      )

      const aliceFunctions = await adapter.getFunctionsByCreator('alice')
      const bobFunctions = await adapter.getFunctionsByCreator('bob')

      expect(aliceFunctions).toHaveLength(2)
      expect(aliceFunctions.map((f) => f.id)).toContain(fn1.id)
      expect(aliceFunctions.map((f) => f.id)).toContain(fn2.id)

      expect(bobFunctions).toHaveLength(1)
      expect(bobFunctions[0].id).toBe(fn3.id)
    })

    it('creator has implicit read access to their functions', async () => {
      const func = await adapter.createFunction(
        { name: 'creatorReadFunc', type: 'code' },
        { createdBy: 'creator-user' }
      )

      // Creator should have read access implicitly
      const hasRead = await adapter.hasAccess(func.id, 'creator-user', 'read')

      expect(hasRead).toBe(true)
    })

    it('tracks creation timestamp', async () => {
      const beforeCreate = Date.now()
      const func = await adapter.createFunction(
        { name: 'timestampFunc', type: 'code' },
        { createdBy: 'timestamp-user' }
      )
      const afterCreate = Date.now()

      const creationInfo = await adapter.getCreationInfo(func.id)

      expect(creationInfo.createdBy).toBe('timestamp-user')
      expect(creationInfo.createdAt).toBeGreaterThanOrEqual(beforeCreate)
      expect(creationInfo.createdAt).toBeLessThanOrEqual(afterCreate)
    })
  })

  // ==========================================================================
  // 10. Cross-Organization Sharing (RED PHASE)
  // ==========================================================================

  describe('Cross-Organization Sharing', () => {
    it('shares function with another organization', async () => {
      const func = await adapter.createFunction({ name: 'sharedFunc', type: 'code' })
      await adapter.setOwner(func.id, 'owner-org')

      // Share with another org
      const share = await adapter.shareWithOrg(func.id, 'partner-org', 'execute')

      expect(share.verb).toBe('sharedWith')
      expect(share.to).toContain('partner-org')
    })

    it('shared org members get specified permission level', async () => {
      const func = await adapter.createFunction({ name: 'sharedFunc', type: 'code' })
      await adapter.setOwner(func.id, 'owner-org')
      await adapter.shareWithOrg(func.id, 'partner-org', 'execute')

      // Add member to partner org
      await adapter.addOrgMember('partner-org', 'partner-employee')

      // Partner employee should have execute access
      const hasExecute = await adapter.hasAccess(func.id, 'partner-employee', 'execute')
      const hasAdmin = await adapter.hasAccess(func.id, 'partner-employee', 'admin')

      expect(hasExecute).toBe(true)
      expect(hasAdmin).toBe(false) // Only execute was shared
    })

    it('owner org retains full control over shared function', async () => {
      const func = await adapter.createFunction({ name: 'ownerControlFunc', type: 'code' })
      await adapter.setOwner(func.id, 'owner-org')
      await adapter.shareWithOrg(func.id, 'partner-org', 'execute')

      // Owner org should still have admin
      await adapter.grantAccess(func.id, 'org:owner-org', 'admin')
      const ownerHasAdmin = await adapter.hasAccess(func.id, 'org:owner-org', 'admin')

      expect(ownerHasAdmin).toBe(true)
    })

    it('revokes sharing with organization', async () => {
      const func = await adapter.createFunction({ name: 'revokableShareFunc', type: 'code' })
      await adapter.setOwner(func.id, 'owner-org')
      await adapter.shareWithOrg(func.id, 'partner-org', 'execute')
      await adapter.addOrgMember('partner-org', 'partner-user')

      // Verify access before revocation
      expect(await adapter.hasAccess(func.id, 'partner-user', 'execute')).toBe(true)

      // Revoke sharing
      await adapter.revokeOrgShare(func.id, 'partner-org')

      // Access should be revoked
      expect(await adapter.hasAccess(func.id, 'partner-user', 'execute')).toBe(false)
    })

    it('lists all orgs a function is shared with', async () => {
      const func = await adapter.createFunction({ name: 'multiShareFunc', type: 'code' })
      await adapter.setOwner(func.id, 'owner-org')

      await adapter.shareWithOrg(func.id, 'partner-org-1', 'read')
      await adapter.shareWithOrg(func.id, 'partner-org-2', 'execute')
      await adapter.shareWithOrg(func.id, 'partner-org-3', 'admin')

      const shares = await adapter.getOrgShares(func.id)

      expect(shares).toHaveLength(3)
      expect(shares.find((s) => s.orgId === 'partner-org-1')?.permission).toBe('read')
      expect(shares.find((s) => s.orgId === 'partner-org-2')?.permission).toBe('execute')
      expect(shares.find((s) => s.orgId === 'partner-org-3')?.permission).toBe('admin')
    })

    it('updates share permission level', async () => {
      const func = await adapter.createFunction({ name: 'updateShareFunc', type: 'code' })
      await adapter.setOwner(func.id, 'owner-org')
      await adapter.shareWithOrg(func.id, 'partner-org', 'read')

      // Upgrade to execute
      await adapter.updateOrgShare(func.id, 'partner-org', 'execute')

      const shares = await adapter.getOrgShares(func.id)
      const partnerShare = shares.find((s) => s.orgId === 'partner-org')

      expect(partnerShare?.permission).toBe('execute')
    })

    it('queries all functions shared with an org', async () => {
      const fn1 = await adapter.createFunction({ name: 'shared1', type: 'code' })
      const fn2 = await adapter.createFunction({ name: 'shared2', type: 'code' })
      const fn3 = await adapter.createFunction({ name: 'notShared', type: 'code' })

      await adapter.setOwner(fn1.id, 'org-a')
      await adapter.setOwner(fn2.id, 'org-b')
      await adapter.setOwner(fn3.id, 'org-c')

      await adapter.shareWithOrg(fn1.id, 'recipient-org', 'read')
      await adapter.shareWithOrg(fn2.id, 'recipient-org', 'execute')
      // fn3 is not shared

      const sharedWithRecipient = await adapter.getFunctionsSharedWith('recipient-org')

      expect(sharedWithRecipient).toHaveLength(2)
      expect(sharedWithRecipient.map((f) => f.id)).toContain(fn1.id)
      expect(sharedWithRecipient.map((f) => f.id)).toContain(fn2.id)
      expect(sharedWithRecipient.map((f) => f.id)).not.toContain(fn3.id)
    })
  })

  // ==========================================================================
  // 11. Modify Permission (RED PHASE)
  // ==========================================================================

  describe('Modify Permission', () => {
    it('grants modify access via canModify relationship', async () => {
      const func = await adapter.createFunction({ name: 'modifiableFunc', type: 'code' })

      const rel = await adapter.grantAccess(func.id, 'modifier-user', 'modify')

      expect(rel.verb).toBe('canModify')
      expect(rel.to).toContain(func.id)
    })

    it('modify permission implies execute and read', async () => {
      const func = await adapter.createFunction({ name: 'modifyImpliesFunc', type: 'code' })
      await adapter.grantAccess(func.id, 'modifier-user', 'modify')

      expect(await adapter.hasAccess(func.id, 'modifier-user', 'read')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'modifier-user', 'execute')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'modifier-user', 'modify')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'modifier-user', 'admin')).toBe(false)
    })

    it('admin implies modify permission', async () => {
      const func = await adapter.createFunction({ name: 'adminModifyFunc', type: 'code' })
      await adapter.grantAccess(func.id, 'admin-user', 'admin')

      expect(await adapter.hasAccess(func.id, 'admin-user', 'modify')).toBe(true)
    })

    it('modify allows updating function code but not deleting', async () => {
      const func = await adapter.createFunction({ name: 'modifyOnlyFunc', type: 'code' })
      await adapter.grantAccess(func.id, 'developer', 'modify')

      // Modifier should be able to update
      const canUpdate = await adapter.canPerformAction(func.id, 'developer', 'update')
      // But not delete
      const canDelete = await adapter.canPerformAction(func.id, 'developer', 'delete')

      expect(canUpdate).toBe(true)
      expect(canDelete).toBe(false)
    })

    it('permission hierarchy: read < execute < modify < admin', async () => {
      const func = await adapter.createFunction({ name: 'hierarchyFunc', type: 'code' })

      await adapter.grantAccess(func.id, 'reader', 'read')
      await adapter.grantAccess(func.id, 'executor', 'execute')
      await adapter.grantAccess(func.id, 'modifier', 'modify')
      await adapter.grantAccess(func.id, 'admin', 'admin')

      // Reader can only read
      expect(await adapter.hasAccess(func.id, 'reader', 'read')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'reader', 'execute')).toBe(false)

      // Executor can read and execute
      expect(await adapter.hasAccess(func.id, 'executor', 'read')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'executor', 'execute')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'executor', 'modify')).toBe(false)

      // Modifier can read, execute, and modify
      expect(await adapter.hasAccess(func.id, 'modifier', 'read')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'modifier', 'execute')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'modifier', 'modify')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'modifier', 'admin')).toBe(false)

      // Admin has all permissions
      expect(await adapter.hasAccess(func.id, 'admin', 'read')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'admin', 'execute')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'admin', 'modify')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'admin', 'admin')).toBe(true)
    })
  })

  // ==========================================================================
  // 12. Access Control Edge Cases (RED PHASE)
  // ==========================================================================

  describe('Access Control Edge Cases', () => {
    it('handles circular role references gracefully', async () => {
      const func = await adapter.createFunction({ name: 'circularFunc', type: 'code' })

      // Create circular role reference: role-a includes role-b, role-b includes role-a
      await adapter.createRole('circular-role-a')
      await adapter.createRole('circular-role-b')
      await adapter.setRoleInheritance('circular-role-a', 'circular-role-b')
      await adapter.setRoleInheritance('circular-role-b', 'circular-role-a')

      // Grant permission to role-a
      await adapter.grantRoleAccess('circular-role-a', func.id, 'execute')

      // Assign role to user
      await adapter.assignRole('circular-user', 'circular-role-a')

      // Should not infinite loop, should resolve permissions correctly
      const hasAccess = await adapter.hasAccess(func.id, 'circular-user', 'execute')

      expect(hasAccess).toBe(true)
    })

    it('handles deleted function gracefully', async () => {
      const func = await adapter.createFunction({ name: 'deletedFunc', type: 'code' })
      await adapter.grantAccess(func.id, 'user', 'execute')

      // Delete the function
      await adapter.deleteFunction(func.id)

      // Access check on deleted function should return false or throw
      const hasAccess = await adapter.hasAccess(func.id, 'user', 'execute')

      expect(hasAccess).toBe(false)
    })

    it('handles non-existent principal gracefully', async () => {
      const func = await adapter.createFunction({ name: 'existingFunc', type: 'code' })

      // Check access for non-existent principal
      const hasAccess = await adapter.hasAccess(func.id, 'non-existent-user', 'read')

      expect(hasAccess).toBe(false)
    })

    it('prevents duplicate permission grants', async () => {
      const func = await adapter.createFunction({ name: 'dupePermFunc', type: 'code' })

      await adapter.grantAccess(func.id, 'user', 'execute')
      await adapter.grantAccess(func.id, 'user', 'execute') // Duplicate

      // Should not create duplicate relationships
      const accessList = await adapter.getAccessList(func.id)
      const userEntries = accessList.filter(
        (a) => a.principalId === 'user' && a.permission === 'execute'
      )

      expect(userEntries).toHaveLength(1)
    })

    it('handles access check for function with no permissions', async () => {
      const func = await adapter.createFunction({ name: 'noPermsFunc', type: 'code' })

      // No permissions granted to anyone
      const hasAccess = await adapter.hasAccess(func.id, 'random-user', 'read')

      expect(hasAccess).toBe(false)
    })

    it('distinguishes between user and org principal types', async () => {
      const func = await adapter.createFunction({ name: 'principalTypesFunc', type: 'code' })

      await adapter.grantAccess(func.id, 'user:alice', 'read')
      await adapter.grantAccess(func.id, 'org:acme-corp', 'execute')
      await adapter.grantAccess(func.id, 'team:engineering', 'admin')

      expect(await adapter.hasAccess(func.id, 'user:alice', 'read')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'user:alice', 'execute')).toBe(false)

      expect(await adapter.hasAccess(func.id, 'org:acme-corp', 'execute')).toBe(true)
      expect(await adapter.hasAccess(func.id, 'org:acme-corp', 'admin')).toBe(false)

      expect(await adapter.hasAccess(func.id, 'team:engineering', 'admin')).toBe(true)
    })
  })
})
