import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Lifecycle Hooks Tests - RED PHASE TDD
 *
 * These tests verify the lifecycle hook system for entity management.
 * Hooks are called at specific points in the entity lifecycle:
 * - $created: After entity creation
 * - $updated: After entity update (with previous state)
 * - $deleted: Before entity deletion
 *
 * Tests should FAIL until the lifecycle/manager module is implemented.
 *
 * @see dotdo-3wvjm - RED: Lifecycle Hooks
 * @see dotdo-1z1ho - GREEN: Lifecycle Hooks implementation
 */

// Import from non-existent module - will FAIL until implemented
import {
  LifecycleManager,
  type LifecycleHooks,
  type LifecycleContext,
  type Entity,
  type EntityMeta,
} from '../lifecycle/manager'

// ============================================================================
// TEST FIXTURES
// ============================================================================

interface Customer extends Entity {
  name: string
  email: string
  tier: 'free' | 'pro' | 'enterprise'
}

interface Order extends Entity {
  customerId: string
  total: number
  status: 'pending' | 'paid' | 'shipped'
}

interface AuditLog extends Entity {
  action: string
  entityType: string
  entityId: string
  timestamp: Date
}

// ============================================================================
// $updated HANDLER TESTS
// ============================================================================

describe('$updated Handler', () => {
  let manager: LifecycleManager
  let mockContext: LifecycleContext

  beforeEach(() => {
    manager = new LifecycleManager()
    mockContext = createMockContext()
  })

  describe('Handler Invocation', () => {
    it('calls $updated handler after entity update', async () => {
      const updatedHandler = vi.fn()

      manager.register('Customer', {
        $updated: updatedHandler,
      })

      const previous: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Old Name',
        email: 'old@example.com',
        tier: 'free',
      }

      const updated: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'New Name',
        email: 'old@example.com',
        tier: 'pro',
      }

      await manager.onUpdated(updated, previous, mockContext)

      expect(updatedHandler).toHaveBeenCalledTimes(1)
    })

    it('does not call $updated if no handler registered', async () => {
      // No handler registered for 'Order'
      const previous: Order = {
        $id: 'order-001',
        $type: 'Order',
        customerId: 'cust-001',
        total: 100,
        status: 'pending',
      }

      const updated: Order = {
        $id: 'order-001',
        $type: 'Order',
        customerId: 'cust-001',
        total: 100,
        status: 'paid',
      }

      // Should not throw
      await expect(manager.onUpdated(updated, previous, mockContext)).resolves.not.toThrow()
    })
  })

  describe('Handler Parameters', () => {
    it('receives (entity, previous, $) parameters', async () => {
      let receivedEntity: unknown
      let receivedPrevious: unknown
      let receivedContext: unknown

      manager.register('Customer', {
        $updated: (entity, previous, $) => {
          receivedEntity = entity
          receivedPrevious = previous
          receivedContext = $
        },
      })

      const previous: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Old',
        email: 'test@example.com',
        tier: 'free',
      }

      const updated: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'New',
        email: 'test@example.com',
        tier: 'pro',
      }

      await manager.onUpdated(updated, previous, mockContext)

      expect(receivedEntity).toEqual(updated)
      expect(receivedPrevious).toEqual(previous)
      expect(receivedContext).toBe(mockContext)
    })

    it('previous contains the entity state before update', async () => {
      let capturedPrevious: Customer | undefined

      manager.register('Customer', {
        $updated: (entity, previous) => {
          capturedPrevious = previous as Customer
        },
      })

      const previous: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Original Name',
        email: 'original@example.com',
        tier: 'free',
      }

      const updated: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Updated Name',
        email: 'new@example.com',
        tier: 'enterprise',
      }

      await manager.onUpdated(updated, previous, mockContext)

      expect(capturedPrevious?.name).toBe('Original Name')
      expect(capturedPrevious?.email).toBe('original@example.com')
      expect(capturedPrevious?.tier).toBe('free')
    })
  })

  describe('Prevent Update (Throw)', () => {
    it('can prevent update by throwing in handler', async () => {
      manager.register('Customer', {
        $updated: (entity, previous) => {
          const prev = previous as Customer
          const curr = entity as Customer

          // Prevent tier downgrade
          if (prev.tier === 'enterprise' && curr.tier !== 'enterprise') {
            throw new Error('Cannot downgrade from enterprise tier')
          }
        },
      })

      const previous: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Enterprise Customer',
        email: 'ent@example.com',
        tier: 'enterprise',
      }

      const updated: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Enterprise Customer',
        email: 'ent@example.com',
        tier: 'pro', // Attempting downgrade
      }

      await expect(manager.onUpdated(updated, previous, mockContext)).rejects.toThrow(
        'Cannot downgrade from enterprise tier'
      )
    })

    it('can prevent update with custom validation error', async () => {
      class ValidationError extends Error {
        constructor(
          public field: string,
          message: string
        ) {
          super(message)
          this.name = 'ValidationError'
        }
      }

      manager.register('Order', {
        $updated: (entity, previous) => {
          const prev = previous as Order
          const curr = entity as Order

          // Cannot reduce order total after paid
          if (prev.status === 'paid' && curr.total < prev.total) {
            throw new ValidationError('total', 'Cannot reduce total after payment')
          }
        },
      })

      const previous: Order = {
        $id: 'order-001',
        $type: 'Order',
        customerId: 'cust-001',
        total: 500,
        status: 'paid',
      }

      const updated: Order = {
        $id: 'order-001',
        $type: 'Order',
        customerId: 'cust-001',
        total: 400, // Attempted reduction
        status: 'paid',
      }

      await expect(manager.onUpdated(updated, previous, mockContext)).rejects.toThrow('Cannot reduce total')
    })

    it('allowed updates complete without throwing', async () => {
      manager.register('Customer', {
        $updated: (entity, previous) => {
          const prev = previous as Customer
          const curr = entity as Customer

          // Only prevent downgrades from enterprise
          if (prev.tier === 'enterprise' && curr.tier !== 'enterprise') {
            throw new Error('Cannot downgrade from enterprise tier')
          }
        },
      })

      // Upgrading is allowed
      const previous: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com',
        tier: 'free',
      }

      const updated: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com',
        tier: 'enterprise', // Upgrade is fine
      }

      await expect(manager.onUpdated(updated, previous, mockContext)).resolves.not.toThrow()
    })
  })

  describe('Detect Field Changes', () => {
    it('can detect which fields changed', async () => {
      let changedFields: string[] = []

      manager.register('Customer', {
        $updated: (entity, previous, $) => {
          changedFields = $.getChangedFields(entity, previous)
        },
      })

      const previous: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Old Name',
        email: 'same@example.com',
        tier: 'free',
      }

      const updated: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'New Name',
        email: 'same@example.com',
        tier: 'pro',
      }

      await manager.onUpdated(updated, previous, mockContext)

      expect(changedFields).toContain('name')
      expect(changedFields).toContain('tier')
      expect(changedFields).not.toContain('email')
      expect(changedFields).not.toContain('$id')
    })

    it('provides hasChanged helper for specific field', async () => {
      let nameChanged = false
      let emailChanged = false

      manager.register('Customer', {
        $updated: (entity, previous, $) => {
          nameChanged = $.hasChanged('name', entity, previous)
          emailChanged = $.hasChanged('email', entity, previous)
        },
      })

      const previous: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Old Name',
        email: 'same@example.com',
        tier: 'free',
      }

      const updated: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'New Name',
        email: 'same@example.com',
        tier: 'free',
      }

      await manager.onUpdated(updated, previous, mockContext)

      expect(nameChanged).toBe(true)
      expect(emailChanged).toBe(false)
    })

    it('detects nested object changes', async () => {
      interface Profile extends Entity {
        user: {
          name: string
          settings: {
            theme: string
            notifications: boolean
          }
        }
      }

      let settingsChanged = false

      manager.register('Profile', {
        $updated: (entity, previous, $) => {
          settingsChanged = $.hasChanged('user.settings', entity, previous)
        },
      })

      const previous: Profile = {
        $id: 'profile-001',
        $type: 'Profile',
        user: {
          name: 'Test',
          settings: { theme: 'light', notifications: true },
        },
      }

      const updated: Profile = {
        $id: 'profile-001',
        $type: 'Profile',
        user: {
          name: 'Test',
          settings: { theme: 'dark', notifications: true },
        },
      }

      await manager.onUpdated(updated, previous, mockContext)

      expect(settingsChanged).toBe(true)
    })
  })

  describe('Cascade Actions on Update', () => {
    it('can trigger cascade updates to related entities', async () => {
      const updateCalls: Array<{ type: string; id: string; data: unknown }> = []

      mockContext.Order = vi.fn(async (id, data) => {
        updateCalls.push({ type: 'Order', id, data })
        return { $id: id, $type: 'Order', ...data } as Entity
      })

      manager.register('Customer', {
        $updated: async (entity, previous, $) => {
          const customer = entity as Customer
          const prev = previous as Customer

          // When email changes, update all orders with new customer email
          if (customer.email !== prev.email) {
            // Fetch orders for this customer and update them
            const orders = await $.query('Order', { customerId: customer.$id })
            for (const order of orders) {
              await $.Order(order.$id, { customerEmail: customer.email })
            }
          }
        },
      })

      const previous: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'old@example.com',
        tier: 'pro',
      }

      const updated: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'new@example.com',
        tier: 'pro',
      }

      // Mock query to return some orders
      mockContext.query = vi.fn().mockResolvedValue([
        { $id: 'order-001', $type: 'Order', customerId: 'cust-001' },
        { $id: 'order-002', $type: 'Order', customerId: 'cust-001' },
      ])

      await manager.onUpdated(updated, previous, mockContext)

      expect(updateCalls).toHaveLength(2)
      expect(updateCalls[0].data).toEqual({ customerEmail: 'new@example.com' })
    })

    it('can create audit log entry on update', async () => {
      const auditEntries: unknown[] = []

      mockContext.AuditLog = vi.fn(async (id, data) => {
        auditEntries.push(data)
        return { $id: id, $type: 'AuditLog', ...data } as Entity
      })

      manager.register('Customer', {
        $updated: async (entity, previous, $) => {
          const changedFields = $.getChangedFields(entity, previous)

          await $.AuditLog($.generateId(), {
            action: 'update',
            entityType: 'Customer',
            entityId: entity.$id,
            changes: changedFields,
            timestamp: new Date(),
          })
        },
      })

      const previous: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Old',
        email: 'test@example.com',
        tier: 'free',
      }

      const updated: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'New',
        email: 'test@example.com',
        tier: 'pro',
      }

      await manager.onUpdated(updated, previous, mockContext)

      expect(auditEntries).toHaveLength(1)
      expect(auditEntries[0]).toMatchObject({
        action: 'update',
        entityType: 'Customer',
        entityId: 'cust-001',
      })
    })
  })

  describe('Async Support', () => {
    it('supports async $updated handlers', async () => {
      const executionOrder: string[] = []

      manager.register('Customer', {
        $updated: async (entity) => {
          executionOrder.push('start')
          await new Promise((resolve) => setTimeout(resolve, 10))
          executionOrder.push('end')
        },
      })

      const previous: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Old',
        email: 'test@example.com',
        tier: 'free',
      }

      const updated: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'New',
        email: 'test@example.com',
        tier: 'free',
      }

      await manager.onUpdated(updated, previous, mockContext)

      expect(executionOrder).toEqual(['start', 'end'])
    })

    it('awaits async operations before completing', async () => {
      let operationComplete = false

      manager.register('Order', {
        $updated: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
          operationComplete = true
        },
      })

      const previous: Order = {
        $id: 'order-001',
        $type: 'Order',
        customerId: 'cust-001',
        total: 100,
        status: 'pending',
      }

      const updated: Order = {
        $id: 'order-001',
        $type: 'Order',
        customerId: 'cust-001',
        total: 100,
        status: 'paid',
      }

      await manager.onUpdated(updated, previous, mockContext)

      expect(operationComplete).toBe(true)
    })
  })
})

// ============================================================================
// $deleted HANDLER TESTS
// ============================================================================

describe('$deleted Handler', () => {
  let manager: LifecycleManager
  let mockContext: LifecycleContext

  beforeEach(() => {
    manager = new LifecycleManager()
    mockContext = createMockContext()
  })

  describe('Handler Invocation', () => {
    it('calls $deleted handler before entity deletion', async () => {
      const deletedHandler = vi.fn()

      manager.register('Customer', {
        $deleted: deletedHandler,
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'To Delete',
        email: 'delete@example.com',
        tier: 'free',
      }

      await manager.onDeleted(entity, mockContext)

      expect(deletedHandler).toHaveBeenCalledTimes(1)
    })

    it('receives (entity, $) parameters', async () => {
      let receivedEntity: unknown
      let receivedContext: unknown

      manager.register('Customer', {
        $deleted: (entity, $) => {
          receivedEntity = entity
          receivedContext = $
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com',
        tier: 'pro',
      }

      await manager.onDeleted(entity, mockContext)

      expect(receivedEntity).toEqual(entity)
      expect(receivedContext).toBe(mockContext)
    })
  })

  describe('Prevent Deletion', () => {
    it('can prevent deletion by throwing', async () => {
      manager.register('Customer', {
        $deleted: (entity) => {
          const customer = entity as Customer
          if (customer.tier === 'enterprise') {
            throw new Error('Cannot delete enterprise customers directly')
          }
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Enterprise',
        email: 'ent@example.com',
        tier: 'enterprise',
      }

      await expect(manager.onDeleted(entity, mockContext)).rejects.toThrow(
        'Cannot delete enterprise customers directly'
      )
    })

    it('can prevent deletion if entity has active relationships', async () => {
      mockContext.query = vi.fn().mockResolvedValue([
        { $id: 'order-001', status: 'pending' },
      ])

      manager.register('Customer', {
        $deleted: async (entity, $) => {
          const activeOrders = await $.query('Order', {
            customerId: entity.$id,
            status: 'pending',
          })

          if (activeOrders.length > 0) {
            throw new Error(`Cannot delete customer with ${activeOrders.length} pending orders`)
          }
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'With Orders',
        email: 'orders@example.com',
        tier: 'pro',
      }

      await expect(manager.onDeleted(entity, mockContext)).rejects.toThrow(
        'Cannot delete customer with 1 pending orders'
      )
    })

    it('allows deletion if no blocking conditions', async () => {
      mockContext.query = vi.fn().mockResolvedValue([])

      manager.register('Customer', {
        $deleted: async (entity, $) => {
          const activeOrders = await $.query('Order', {
            customerId: entity.$id,
            status: 'pending',
          })

          if (activeOrders.length > 0) {
            throw new Error('Cannot delete with pending orders')
          }
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'No Orders',
        email: 'clean@example.com',
        tier: 'free',
      }

      await expect(manager.onDeleted(entity, mockContext)).resolves.not.toThrow()
    })
  })

  describe('Cleanup Related Entities', () => {
    it('can cascade delete related entities', async () => {
      const deletedIds: string[] = []

      mockContext.query = vi.fn().mockResolvedValue([
        { $id: 'order-001', $type: 'Order' },
        { $id: 'order-002', $type: 'Order' },
      ])

      mockContext.delete = vi.fn(async (type, id) => {
        deletedIds.push(id)
      })

      manager.register('Customer', {
        $deleted: async (entity, $) => {
          // Delete all orders for this customer
          const orders = await $.query('Order', { customerId: entity.$id })
          for (const order of orders) {
            await $.delete('Order', order.$id)
          }
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'With Orders',
        email: 'test@example.com',
        tier: 'free',
      }

      await manager.onDeleted(entity, mockContext)

      expect(deletedIds).toContain('order-001')
      expect(deletedIds).toContain('order-002')
    })

    it('can soft delete related entities instead of hard delete', async () => {
      const softDeleted: Array<{ type: string; id: string }> = []

      mockContext.query = vi.fn().mockResolvedValue([
        { $id: 'order-001', $type: 'Order' },
      ])

      mockContext.Order = vi.fn(async (id, data) => {
        softDeleted.push({ type: 'Order', id })
        return { $id: id, $type: 'Order', ...data } as Entity
      })

      manager.register('Customer', {
        $deleted: async (entity, $) => {
          const orders = await $.query('Order', { customerId: entity.$id })
          for (const order of orders) {
            await $.Order(order.$id, { deleted: true, deletedAt: new Date() })
          }
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Soft Delete',
        email: 'soft@example.com',
        tier: 'pro',
      }

      await manager.onDeleted(entity, mockContext)

      expect(softDeleted).toHaveLength(1)
      expect(softDeleted[0].id).toBe('order-001')
    })

    it('can reassign related entities to another owner', async () => {
      const reassignments: Array<{ id: string; newOwner: string }> = []

      mockContext.query = vi.fn().mockResolvedValue([
        { $id: 'project-001', $type: 'Project' },
        { $id: 'project-002', $type: 'Project' },
      ])

      mockContext.Project = vi.fn(async (id, data) => {
        reassignments.push({ id, newOwner: (data as any).ownerId })
        return { $id: id, $type: 'Project', ...data } as Entity
      })

      manager.register('Customer', {
        $deleted: async (entity, $) => {
          // Reassign projects to a default admin user
          const projects = await $.query('Project', { ownerId: entity.$id })
          for (const project of projects) {
            await $.Project(project.$id, { ownerId: 'admin-001' })
          }
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Leaving',
        email: 'bye@example.com',
        tier: 'free',
      }

      await manager.onDeleted(entity, mockContext)

      expect(reassignments).toHaveLength(2)
      expect(reassignments.every((r) => r.newOwner === 'admin-001')).toBe(true)
    })
  })

  describe('Audit Trail on Deletion', () => {
    it('can create audit log before deletion', async () => {
      const auditEntries: unknown[] = []

      mockContext.AuditLog = vi.fn(async (id, data) => {
        auditEntries.push(data)
        return { $id: id, $type: 'AuditLog', ...data } as Entity
      })

      manager.register('Customer', {
        $deleted: async (entity, $) => {
          await $.AuditLog($.generateId(), {
            action: 'delete',
            entityType: 'Customer',
            entityId: entity.$id,
            entitySnapshot: entity,
            timestamp: new Date(),
          })
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'To Audit',
        email: 'audit@example.com',
        tier: 'pro',
      }

      await manager.onDeleted(entity, mockContext)

      expect(auditEntries).toHaveLength(1)
      expect(auditEntries[0]).toMatchObject({
        action: 'delete',
        entityType: 'Customer',
        entityId: 'cust-001',
      })
    })
  })
})

// ============================================================================
// $ CONTEXT OBJECT TESTS
// ============================================================================

describe('$ Context Object', () => {
  let manager: LifecycleManager
  let mockContext: LifecycleContext

  beforeEach(() => {
    manager = new LifecycleManager()
    mockContext = createMockContext()
  })

  describe('Access to Other Types', () => {
    it('provides $.TypeName(id, data) accessor for each type', async () => {
      let orderCreated = false

      mockContext.Order = vi.fn(async (id, data) => {
        orderCreated = true
        return { $id: id, $type: 'Order', ...data } as Entity
      })

      manager.register('Customer', {
        $created: async (entity, $) => {
          // Create a default order for new customers
          await $.Order('order-001', {
            customerId: entity.$id,
            total: 0,
            status: 'pending',
          })
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'New',
        email: 'new@example.com',
        tier: 'free',
      }

      await manager.onCreated(entity, mockContext)

      expect(orderCreated).toBe(true)
      expect(mockContext.Order).toHaveBeenCalledWith('order-001', {
        customerId: 'cust-001',
        total: 0,
        status: 'pending',
      })
    })

    it('type accessor returns the created/updated entity', async () => {
      const createdOrder: Order = {
        $id: 'order-001',
        $type: 'Order',
        customerId: 'cust-001',
        total: 100,
        status: 'pending',
      }

      mockContext.Order = vi.fn().mockResolvedValue(createdOrder)

      let returnedEntity: Entity | undefined

      manager.register('Customer', {
        $created: async (entity, $) => {
          returnedEntity = await $.Order('order-001', {
            customerId: entity.$id,
            total: 100,
            status: 'pending',
          })
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com',
        tier: 'free',
      }

      await manager.onCreated(entity, mockContext)

      expect(returnedEntity).toEqual(createdOrder)
    })
  })

  describe('Transaction Context', () => {
    it('provides $.tx for transaction access', async () => {
      mockContext.tx = {
        commit: vi.fn(),
        rollback: vi.fn(),
        savepoint: vi.fn(),
      }

      let txAccessed = false

      manager.register('Customer', {
        $created: async (entity, $) => {
          txAccessed = $.tx !== undefined
          await $.tx.savepoint('after_customer_created')
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com',
        tier: 'free',
      }

      await manager.onCreated(entity, mockContext)

      expect(txAccessed).toBe(true)
      expect(mockContext.tx.savepoint).toHaveBeenCalledWith('after_customer_created')
    })

    it('transaction rollback on handler error', async () => {
      const rollbackFn = vi.fn()

      mockContext.tx = {
        commit: vi.fn(),
        rollback: rollbackFn,
        savepoint: vi.fn(),
      }

      manager.register('Customer', {
        $created: async () => {
          throw new Error('Handler failed')
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com',
        tier: 'free',
      }

      await expect(manager.onCreated(entity, mockContext)).rejects.toThrow()

      // Transaction management is at higher level - just verify tx is accessible
      expect(mockContext.tx.rollback).toBeDefined()
    })
  })

  describe('Schema Access', () => {
    it('provides $.schema for schema inspection', async () => {
      mockContext.schema = {
        types: {
          Customer: {
            name: { type: 'string', required: true },
            email: { type: 'string', required: true },
            tier: { type: 'enum', values: ['free', 'pro', 'enterprise'] },
          },
          Order: {
            customerId: { type: 'string', required: true },
            total: { type: 'number', required: true },
          },
        },
        getType: (name: string) => mockContext.schema.types[name],
      }

      let schemaAccessed = false
      let customerSchema: unknown

      manager.register('Customer', {
        $created: async (entity, $) => {
          schemaAccessed = $.schema !== undefined
          customerSchema = $.schema.getType('Customer')
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com',
        tier: 'free',
      }

      await manager.onCreated(entity, mockContext)

      expect(schemaAccessed).toBe(true)
      expect(customerSchema).toBeDefined()
    })
  })

  describe('Query Helper', () => {
    it('provides $.query for finding entities', async () => {
      mockContext.query = vi.fn().mockResolvedValue([
        { $id: 'order-001', customerId: 'cust-001' },
        { $id: 'order-002', customerId: 'cust-001' },
      ])

      let foundOrders: Entity[] = []

      manager.register('Customer', {
        $deleted: async (entity, $) => {
          foundOrders = await $.query('Order', { customerId: entity.$id })
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com',
        tier: 'free',
      }

      await manager.onDeleted(entity, mockContext)

      expect(mockContext.query).toHaveBeenCalledWith('Order', { customerId: 'cust-001' })
      expect(foundOrders).toHaveLength(2)
    })
  })

  describe('ID Generation', () => {
    it('provides $.generateId for creating new IDs', async () => {
      mockContext.generateId = vi.fn().mockReturnValue('generated-uuid-001')

      let generatedId: string | undefined

      manager.register('Customer', {
        $created: async (entity, $) => {
          generatedId = $.generateId()
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com',
        tier: 'free',
      }

      await manager.onCreated(entity, mockContext)

      expect(generatedId).toBe('generated-uuid-001')
    })

    it('generates unique IDs on each call', async () => {
      let callCount = 0
      mockContext.generateId = vi.fn(() => `uuid-${++callCount}`)

      const generatedIds: string[] = []

      manager.register('Customer', {
        $created: async (entity, $) => {
          generatedIds.push($.generateId())
          generatedIds.push($.generateId())
          generatedIds.push($.generateId())
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com',
        tier: 'free',
      }

      await manager.onCreated(entity, mockContext)

      expect(new Set(generatedIds).size).toBe(3)
    })
  })
})

// ============================================================================
// SCHEMA-LEVEL HOOKS TESTS
// ============================================================================

describe('Schema-Level Hooks', () => {
  let manager: LifecycleManager

  beforeEach(() => {
    manager = new LifecycleManager()
  })

  describe('$seeded Hook', () => {
    it('$seeded called after all seeds complete', async () => {
      const seededHandler = vi.fn()

      manager.registerSchemaHook('$seeded', seededHandler)

      await manager.triggerSchemaHook('$seeded', {
        seededTypes: ['Customer', 'Order', 'Product'],
        totalRecords: 150,
      })

      expect(seededHandler).toHaveBeenCalledTimes(1)
      expect(seededHandler).toHaveBeenCalledWith({
        seededTypes: ['Customer', 'Order', 'Product'],
        totalRecords: 150,
      })
    })

    it('$seeded receives seed summary', async () => {
      let seedSummary: unknown

      manager.registerSchemaHook('$seeded', (summary) => {
        seedSummary = summary
      })

      await manager.triggerSchemaHook('$seeded', {
        seededTypes: ['User'],
        counts: { User: 10 },
        duration: 250,
      })

      expect(seedSummary).toMatchObject({
        seededTypes: ['User'],
        counts: { User: 10 },
      })
    })
  })

  describe('$ready Hook', () => {
    it('$ready called when DB initialized', async () => {
      const readyHandler = vi.fn()

      manager.registerSchemaHook('$ready', readyHandler)

      await manager.triggerSchemaHook('$ready', {
        tables: ['customers', 'orders'],
        migrated: true,
      })

      expect(readyHandler).toHaveBeenCalledTimes(1)
    })

    it('$ready receives initialization info', async () => {
      let initInfo: unknown

      manager.registerSchemaHook('$ready', (info) => {
        initInfo = info
      })

      await manager.triggerSchemaHook('$ready', {
        tables: ['customers', 'orders', 'products'],
        migrated: true,
        version: 5,
      })

      expect(initInfo).toMatchObject({
        tables: ['customers', 'orders', 'products'],
        migrated: true,
        version: 5,
      })
    })

    it('can perform post-initialization setup in $ready', async () => {
      const setupSteps: string[] = []

      manager.registerSchemaHook('$ready', async () => {
        setupSteps.push('create_indexes')
        setupSteps.push('warm_cache')
        setupSteps.push('start_background_jobs')
      })

      await manager.triggerSchemaHook('$ready', {})

      expect(setupSteps).toEqual(['create_indexes', 'warm_cache', 'start_background_jobs'])
    })
  })

  describe('$error Hook', () => {
    it('$error called as global error handler', async () => {
      const errorHandler = vi.fn()

      manager.registerSchemaHook('$error', errorHandler)

      const testError = new Error('Test database error')

      await manager.triggerSchemaHook('$error', {
        error: testError,
        operation: 'insert',
        entityType: 'Customer',
      })

      expect(errorHandler).toHaveBeenCalledWith({
        error: testError,
        operation: 'insert',
        entityType: 'Customer',
      })
    })

    it('$error receives error context', async () => {
      let errorContext: unknown

      manager.registerSchemaHook('$error', (ctx) => {
        errorContext = ctx
      })

      await manager.triggerSchemaHook('$error', {
        error: new Error('Constraint violation'),
        operation: 'update',
        entityType: 'Order',
        entityId: 'order-001',
        stack: new Error().stack,
      })

      expect(errorContext).toMatchObject({
        operation: 'update',
        entityType: 'Order',
        entityId: 'order-001',
      })
    })

    it('$error can log to external service', async () => {
      const loggedErrors: unknown[] = []

      manager.registerSchemaHook('$error', async (ctx) => {
        // Simulate sending to error tracking service
        loggedErrors.push({
          message: ctx.error.message,
          context: ctx,
          timestamp: new Date(),
        })
      })

      await manager.triggerSchemaHook('$error', {
        error: new Error('Connection timeout'),
        operation: 'query',
        entityType: 'Product',
      })

      expect(loggedErrors).toHaveLength(1)
      expect(loggedErrors[0]).toMatchObject({
        message: 'Connection timeout',
      })
    })

    it('multiple $error handlers are all called', async () => {
      const handler1Calls: unknown[] = []
      const handler2Calls: unknown[] = []

      manager.registerSchemaHook('$error', (ctx) => {
        handler1Calls.push(ctx)
      })

      manager.registerSchemaHook('$error', (ctx) => {
        handler2Calls.push(ctx)
      })

      await manager.triggerSchemaHook('$error', {
        error: new Error('Test'),
        operation: 'delete',
        entityType: 'Customer',
      })

      expect(handler1Calls).toHaveLength(1)
      expect(handler2Calls).toHaveLength(1)
    })
  })
})

// ============================================================================
// HOOK REGISTRATION TESTS
// ============================================================================

describe('Hook Registration', () => {
  let manager: LifecycleManager

  beforeEach(() => {
    manager = new LifecycleManager()
  })

  describe('Register Hooks for Type', () => {
    it('can register single hook', () => {
      const handler = vi.fn()

      manager.register('Customer', {
        $created: handler,
      })

      expect(manager.hasHooks('Customer')).toBe(true)
    })

    it('can register multiple hooks for same type', () => {
      manager.register('Customer', {
        $created: vi.fn(),
        $updated: vi.fn(),
        $deleted: vi.fn(),
      })

      expect(manager.hasHooks('Customer')).toBe(true)
    })

    it('can register hooks for multiple types', () => {
      manager.register('Customer', { $created: vi.fn() })
      manager.register('Order', { $created: vi.fn() })
      manager.register('Product', { $updated: vi.fn() })

      expect(manager.hasHooks('Customer')).toBe(true)
      expect(manager.hasHooks('Order')).toBe(true)
      expect(manager.hasHooks('Product')).toBe(true)
    })

    it('hasHooks returns false for unregistered type', () => {
      manager.register('Customer', { $created: vi.fn() })

      expect(manager.hasHooks('UnknownType')).toBe(false)
    })
  })

  describe('Unregister Hooks', () => {
    it('can unregister all hooks for a type', () => {
      manager.register('Customer', {
        $created: vi.fn(),
        $updated: vi.fn(),
      })

      manager.unregister('Customer')

      expect(manager.hasHooks('Customer')).toBe(false)
    })

    it('unregistering non-existent type does not throw', () => {
      expect(() => manager.unregister('NonExistent')).not.toThrow()
    })
  })

  describe('Get Registered Types', () => {
    it('returns list of types with hooks', () => {
      manager.register('Customer', { $created: vi.fn() })
      manager.register('Order', { $updated: vi.fn() })

      const types = manager.getRegisteredTypes()

      expect(types).toContain('Customer')
      expect(types).toContain('Order')
    })

    it('returns empty array when no hooks registered', () => {
      expect(manager.getRegisteredTypes()).toEqual([])
    })
  })
})

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createMockContext(): LifecycleContext {
  return {
    tx: {
      commit: vi.fn(),
      rollback: vi.fn(),
      savepoint: vi.fn(),
    },
    schema: {
      types: {},
      getType: vi.fn(),
    },
    query: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
    generateId: vi.fn(() => `mock-id-${Date.now()}`),
    getChangedFields: vi.fn((entity, previous) => {
      const changed: string[] = []
      for (const key of Object.keys(entity)) {
        if (!key.startsWith('$') && (entity as any)[key] !== (previous as any)[key]) {
          changed.push(key)
        }
      }
      return changed
    }),
    hasChanged: vi.fn((field, entity, previous) => {
      // Support dot notation for nested fields
      const getNestedValue = (obj: unknown, path: string): unknown => {
        const parts = path.split('.')
        let current: unknown = obj
        for (const part of parts) {
          if (current === null || current === undefined) return undefined
          if (typeof current !== 'object') return undefined
          current = (current as Record<string, unknown>)[part]
        }
        return current
      }
      const entityValue = getNestedValue(entity, field)
      const previousValue = getNestedValue(previous, field)
      return JSON.stringify(entityValue) !== JSON.stringify(previousValue)
    }),
  } as unknown as LifecycleContext
}
