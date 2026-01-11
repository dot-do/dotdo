import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * $created Lifecycle Handler Tests - RED PHASE TDD
 *
 * Comprehensive tests for the $created lifecycle hook.
 * This hook is called after an entity is created and persisted.
 *
 * Key behaviors:
 * - Called AFTER entity creation (entity has $id)
 * - Receives (entity, $) parameters
 * - Can trigger cascade generation of related entities
 * - Supports async operations
 * - Can access transaction context
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
  type CascadeResult,
} from '../lifecycle/manager'

// ============================================================================
// TEST FIXTURES
// ============================================================================

interface Customer extends Entity {
  name: string
  email: string
  tier: 'free' | 'pro' | 'enterprise'
  signupDate: Date
}

interface Order extends Entity {
  customerId: string
  items: Array<{ productId: string; quantity: number; price: number }>
  total: number
  status: 'pending' | 'paid' | 'shipped' | 'delivered'
}

interface Notification extends Entity {
  recipientId: string
  type: 'email' | 'sms' | 'push'
  subject: string
  body: string
  sentAt: Date | null
}

interface WelcomePackage extends Entity {
  customerId: string
  items: string[]
  createdAt: Date
}

interface AuditLog extends Entity {
  action: string
  entityType: string
  entityId: string
  timestamp: Date
  metadata: Record<string, unknown>
}

interface Startup extends Entity {
  name: string
  idea: string
  founders: string[]
}

interface IdealCustomerProfile extends Entity {
  startupId: string
  demographics: {
    ageRange: string
    income: string
    location: string
  }
  painPoints: string[]
}

interface LeanCanvas extends Entity {
  startupId: string
  problem: string[]
  solution: string[]
  uniqueValueProp: string
  channels: string[]
  revenueStreams: string[]
}

// ============================================================================
// BASIC $created HANDLER TESTS
// ============================================================================

describe('$created Handler - Basic Behavior', () => {
  let manager: LifecycleManager
  let mockContext: LifecycleContext

  beforeEach(() => {
    manager = new LifecycleManager()
    mockContext = createMockContext()
  })

  describe('Handler Invocation', () => {
    it('calls $created handler after entity creation', async () => {
      const createdHandler = vi.fn()

      manager.register('Customer', {
        $created: createdHandler,
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'John Doe',
        email: 'john@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      await manager.onCreated(entity, mockContext)

      expect(createdHandler).toHaveBeenCalledTimes(1)
    })

    it('does not call $created if no handler registered', async () => {
      // No handler registered for 'Order'
      const entity: Order = {
        $id: 'order-001',
        $type: 'Order',
        customerId: 'cust-001',
        items: [],
        total: 0,
        status: 'pending',
      }

      // Should not throw
      await expect(manager.onCreated(entity, mockContext)).resolves.not.toThrow()
    })

    it('only calls handler for matching type', async () => {
      const customerHandler = vi.fn()
      const orderHandler = vi.fn()

      manager.register('Customer', { $created: customerHandler })
      manager.register('Order', { $created: orderHandler })

      const customer: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      await manager.onCreated(customer, mockContext)

      expect(customerHandler).toHaveBeenCalledTimes(1)
      expect(orderHandler).not.toHaveBeenCalled()
    })
  })

  describe('Handler Parameters', () => {
    it('receives (entity, $) parameters', async () => {
      let receivedEntity: unknown
      let receivedContext: unknown

      manager.register('Customer', {
        $created: (entity, $) => {
          receivedEntity = entity
          receivedContext = $
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'John Doe',
        email: 'john@example.com.ai',
        tier: 'pro',
        signupDate: new Date(),
      }

      await manager.onCreated(entity, mockContext)

      expect(receivedEntity).toEqual(entity)
      expect(receivedContext).toBe(mockContext)
    })

    it('entity has $id after creation', async () => {
      let entityId: string | undefined

      manager.register('Customer', {
        $created: (entity) => {
          entityId = entity.$id
        },
      })

      const entity: Customer = {
        $id: 'cust-generated-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      await manager.onCreated(entity, mockContext)

      expect(entityId).toBe('cust-generated-001')
    })

    it('entity has $type set correctly', async () => {
      let entityType: string | undefined

      manager.register('Customer', {
        $created: (entity) => {
          entityType = entity.$type
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      await manager.onCreated(entity, mockContext)

      expect(entityType).toBe('Customer')
    })
  })
})

// ============================================================================
// CASCADE GENERATION TESTS
// ============================================================================

describe('$created Handler - Cascade Generation', () => {
  let manager: LifecycleManager
  let mockContext: LifecycleContext

  beforeEach(() => {
    manager = new LifecycleManager()
    mockContext = createMockContext()
  })

  describe('Trigger Single Cascade', () => {
    it('can create related entity on $created', async () => {
      const createdEntities: Array<{ type: string; id: string }> = []

      mockContext.WelcomePackage = vi.fn(async (id, data) => {
        createdEntities.push({ type: 'WelcomePackage', id })
        return { $id: id, $type: 'WelcomePackage', ...data } as Entity
      })

      manager.register('Customer', {
        $created: async (entity, $) => {
          // Create welcome package for new customer
          await $.WelcomePackage($.generateId(), {
            customerId: entity.$id,
            items: ['Welcome Guide', 'Getting Started Video', 'Community Access'],
            createdAt: new Date(),
          })
        },
      })

      const customer: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'New Customer',
        email: 'new@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      await manager.onCreated(customer, mockContext)

      expect(createdEntities).toHaveLength(1)
      expect(createdEntities[0].type).toBe('WelcomePackage')
    })

    it('passes parent entity data to cascade', async () => {
      let capturedCustomerId: string | undefined

      mockContext.WelcomePackage = vi.fn(async (id, data) => {
        capturedCustomerId = (data as any).customerId
        return { $id: id, $type: 'WelcomePackage', ...data } as Entity
      })

      manager.register('Customer', {
        $created: async (entity, $) => {
          await $.WelcomePackage('wp-001', {
            customerId: entity.$id,
            items: ['Guide'],
            createdAt: new Date(),
          })
        },
      })

      const customer: Customer = {
        $id: 'cust-specific-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      await manager.onCreated(customer, mockContext)

      expect(capturedCustomerId).toBe('cust-specific-001')
    })
  })

  describe('Trigger Multiple Cascades', () => {
    it('can create multiple related entities', async () => {
      const createdEntities: Array<{ type: string; id: string }> = []

      mockContext.Notification = vi.fn(async (id, data) => {
        createdEntities.push({ type: 'Notification', id })
        return { $id: id, $type: 'Notification', ...data } as Entity
      })

      mockContext.AuditLog = vi.fn(async (id, data) => {
        createdEntities.push({ type: 'AuditLog', id })
        return { $id: id, $type: 'AuditLog', ...data } as Entity
      })

      mockContext.WelcomePackage = vi.fn(async (id, data) => {
        createdEntities.push({ type: 'WelcomePackage', id })
        return { $id: id, $type: 'WelcomePackage', ...data } as Entity
      })

      manager.register('Customer', {
        $created: async (entity, $) => {
          // Create multiple cascaded entities
          await $.Notification($.generateId(), {
            recipientId: entity.$id,
            type: 'email',
            subject: 'Welcome!',
            body: 'Thanks for signing up',
            sentAt: null,
          })

          await $.AuditLog($.generateId(), {
            action: 'customer_created',
            entityType: 'Customer',
            entityId: entity.$id,
            timestamp: new Date(),
            metadata: { tier: (entity as Customer).tier },
          })

          await $.WelcomePackage($.generateId(), {
            customerId: entity.$id,
            items: ['Guide'],
            createdAt: new Date(),
          })
        },
      })

      const customer: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Multi Cascade',
        email: 'multi@example.com.ai',
        tier: 'pro',
        signupDate: new Date(),
      }

      await manager.onCreated(customer, mockContext)

      expect(createdEntities).toHaveLength(3)
      expect(createdEntities.map((e) => e.type)).toContain('Notification')
      expect(createdEntities.map((e) => e.type)).toContain('AuditLog')
      expect(createdEntities.map((e) => e.type)).toContain('WelcomePackage')
    })

    it('cascades execute in sequence', async () => {
      const executionOrder: string[] = []

      mockContext.Notification = vi.fn(async () => {
        executionOrder.push('Notification')
        return { $id: 'n1', $type: 'Notification' } as Entity
      })

      mockContext.AuditLog = vi.fn(async () => {
        executionOrder.push('AuditLog')
        return { $id: 'a1', $type: 'AuditLog' } as Entity
      })

      manager.register('Customer', {
        $created: async (entity, $) => {
          await $.Notification('n1', {})
          await $.AuditLog('a1', {})
        },
      })

      const customer: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Sequence Test',
        email: 'seq@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      await manager.onCreated(customer, mockContext)

      expect(executionOrder).toEqual(['Notification', 'AuditLog'])
    })
  })

  describe('Nested Cascade Generation', () => {
    it('cascaded entity can trigger its own $created', async () => {
      const createdOrder: string[] = []

      // When Startup is created, it creates IdealCustomerProfile
      // When IdealCustomerProfile is created, it creates LeanCanvas
      mockContext.IdealCustomerProfile = vi.fn(async (id, data) => {
        const entity = { $id: id, $type: 'IdealCustomerProfile', ...data } as Entity
        createdOrder.push('IdealCustomerProfile')
        // Trigger nested $created
        await manager.onCreated(entity, mockContext)
        return entity
      })

      mockContext.LeanCanvas = vi.fn(async (id, data) => {
        const entity = { $id: id, $type: 'LeanCanvas', ...data } as Entity
        createdOrder.push('LeanCanvas')
        return entity
      })

      manager.register('Startup', {
        $created: async (entity, $) => {
          createdOrder.push('Startup')
          await $.IdealCustomerProfile($.generateId(), {
            startupId: entity.$id,
            demographics: { ageRange: '25-45', income: 'high', location: 'urban' },
            painPoints: [],
          })
        },
      })

      manager.register('IdealCustomerProfile', {
        $created: async (entity, $) => {
          await $.LeanCanvas($.generateId(), {
            startupId: (entity as IdealCustomerProfile).startupId,
            problem: [],
            solution: [],
            uniqueValueProp: 'TBD',
            channels: [],
            revenueStreams: [],
          })
        },
      })

      const startup: Startup = {
        $id: 'startup-001',
        $type: 'Startup',
        name: 'TechCo',
        idea: 'AI-powered productivity',
        founders: ['Alice', 'Bob'],
      }

      await manager.onCreated(startup, mockContext)

      expect(createdOrder).toEqual(['Startup', 'IdealCustomerProfile', 'LeanCanvas'])
    })

    it('deep cascade chain executes correctly', async () => {
      const depth: number[] = []

      const createNestedHandler = (level: number) => async (entity: Entity, $: LifecycleContext) => {
        depth.push(level)
        if (level < 5) {
          const nextEntity = { $id: `level-${level + 1}`, $type: `Level${level + 1}` } as Entity
          await manager.onCreated(nextEntity, $)
        }
      }

      for (let i = 1; i <= 5; i++) {
        manager.register(`Level${i}`, { $created: createNestedHandler(i) })
      }

      const rootEntity = { $id: 'level-1', $type: 'Level1' } as Entity
      await manager.onCreated(rootEntity, mockContext)

      expect(depth).toEqual([1, 2, 3, 4, 5])
    })
  })

  describe('Conditional Cascade', () => {
    it('can conditionally trigger cascade based on entity data', async () => {
      const notificationsSent: string[] = []

      mockContext.Notification = vi.fn(async (id, data) => {
        notificationsSent.push((data as any).type)
        return { $id: id, $type: 'Notification', ...data } as Entity
      })

      manager.register('Customer', {
        $created: async (entity, $) => {
          const customer = entity as Customer

          // Only send welcome email to paying customers
          if (customer.tier !== 'free') {
            await $.Notification($.generateId(), {
              recipientId: entity.$id,
              type: 'email',
              subject: 'Welcome to Premium!',
              body: 'Enjoy your benefits',
              sentAt: null,
            })
          }
        },
      })

      // Free customer - no notification
      const freeCustomer: Customer = {
        $id: 'cust-free',
        $type: 'Customer',
        name: 'Free User',
        email: 'free@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      await manager.onCreated(freeCustomer, mockContext)
      expect(notificationsSent).toHaveLength(0)

      // Pro customer - notification sent
      const proCustomer: Customer = {
        $id: 'cust-pro',
        $type: 'Customer',
        name: 'Pro User',
        email: 'pro@example.com.ai',
        tier: 'pro',
        signupDate: new Date(),
      }

      await manager.onCreated(proCustomer, mockContext)
      expect(notificationsSent).toHaveLength(1)
      expect(notificationsSent[0]).toBe('email')
    })

    it('can branch cascade based on entity properties', async () => {
      const actions: string[] = []

      mockContext.WelcomePackage = vi.fn(async () => {
        actions.push('welcome_package')
        return { $id: 'wp', $type: 'WelcomePackage' } as Entity
      })

      mockContext.Notification = vi.fn(async (id, data) => {
        actions.push(`notification_${(data as any).type}`)
        return { $id: id, $type: 'Notification' } as Entity
      })

      manager.register('Customer', {
        $created: async (entity, $) => {
          const customer = entity as Customer

          switch (customer.tier) {
            case 'enterprise':
              await $.WelcomePackage($.generateId(), { customerId: entity.$id })
              await $.Notification($.generateId(), {
                recipientId: entity.$id,
                type: 'email',
              })
              await $.Notification($.generateId(), {
                recipientId: entity.$id,
                type: 'sms',
              })
              break
            case 'pro':
              await $.WelcomePackage($.generateId(), { customerId: entity.$id })
              await $.Notification($.generateId(), {
                recipientId: entity.$id,
                type: 'email',
              })
              break
            case 'free':
              await $.Notification($.generateId(), {
                recipientId: entity.$id,
                type: 'email',
              })
              break
          }
        },
      })

      // Test enterprise tier
      const enterprise: Customer = {
        $id: 'ent-001',
        $type: 'Customer',
        name: 'Enterprise',
        email: 'ent@example.com.ai',
        tier: 'enterprise',
        signupDate: new Date(),
      }

      await manager.onCreated(enterprise, mockContext)

      expect(actions).toContain('welcome_package')
      expect(actions).toContain('notification_email')
      expect(actions).toContain('notification_sms')
    })
  })
})

// ============================================================================
// ASYNC SUPPORT TESTS
// ============================================================================

describe('$created Handler - Async Support', () => {
  let manager: LifecycleManager
  let mockContext: LifecycleContext

  beforeEach(() => {
    manager = new LifecycleManager()
    mockContext = createMockContext()
  })

  describe('Async Handler Execution', () => {
    it('supports async $created handlers', async () => {
      const executionOrder: string[] = []

      manager.register('Customer', {
        $created: async (entity) => {
          executionOrder.push('start')
          await new Promise((resolve) => setTimeout(resolve, 10))
          executionOrder.push('middle')
          await new Promise((resolve) => setTimeout(resolve, 10))
          executionOrder.push('end')
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Async Test',
        email: 'async@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      await manager.onCreated(entity, mockContext)

      expect(executionOrder).toEqual(['start', 'middle', 'end'])
    })

    it('awaits async operations before completing', async () => {
      let operationComplete = false

      manager.register('Customer', {
        $created: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          operationComplete = true
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      await manager.onCreated(entity, mockContext)

      expect(operationComplete).toBe(true)
    })

    it('handles async errors properly', async () => {
      manager.register('Customer', {
        $created: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          throw new Error('Async operation failed')
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Error Test',
        email: 'error@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      await expect(manager.onCreated(entity, mockContext)).rejects.toThrow('Async operation failed')
    })
  })

  describe('Parallel Async Operations', () => {
    it('can run parallel operations with Promise.all', async () => {
      const startTimes: number[] = []
      const endTimes: number[] = []

      mockContext.Notification = vi.fn(async () => {
        startTimes.push(Date.now())
        await new Promise((resolve) => setTimeout(resolve, 50))
        endTimes.push(Date.now())
        return { $id: 'n', $type: 'Notification' } as Entity
      })

      manager.register('Customer', {
        $created: async (entity, $) => {
          // Run 3 notifications in parallel
          await Promise.all([
            $.Notification('n1', {}),
            $.Notification('n2', {}),
            $.Notification('n3', {}),
          ])
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Parallel',
        email: 'parallel@example.com.ai',
        tier: 'pro',
        signupDate: new Date(),
      }

      const start = Date.now()
      await manager.onCreated(entity, mockContext)
      const duration = Date.now() - start

      // If running in parallel, total time should be ~50ms not ~150ms
      expect(duration).toBeLessThan(100)
      expect(startTimes).toHaveLength(3)
    })

    it('parallel operations all complete before handler returns', async () => {
      const completedOps: string[] = []

      mockContext.Notification = vi.fn(async (id) => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 20))
        completedOps.push(id)
        return { $id: id, $type: 'Notification' } as Entity
      })

      manager.register('Customer', {
        $created: async (entity, $) => {
          await Promise.all([
            $.Notification('fast', {}),
            $.Notification('medium', {}),
            $.Notification('slow', {}),
          ])
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      await manager.onCreated(entity, mockContext)

      expect(completedOps).toHaveLength(3)
    })
  })

  describe('Async with External Services', () => {
    it('can make async calls to external services', async () => {
      const externalCalls: unknown[] = []

      mockContext.callExternal = vi.fn(async (service: string, data: unknown) => {
        externalCalls.push({ service, data })
        return { success: true }
      })

      manager.register('Customer', {
        $created: async (entity, $) => {
          // Simulate calling external CRM
          await ($ as any).callExternal('crm', {
            action: 'create_contact',
            email: (entity as Customer).email,
            name: (entity as Customer).name,
          })

          // Simulate calling analytics
          await ($ as any).callExternal('analytics', {
            event: 'customer_created',
            customerId: entity.$id,
          })
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'External Test',
        email: 'ext@example.com.ai',
        tier: 'pro',
        signupDate: new Date(),
      }

      await manager.onCreated(entity, mockContext)

      expect(externalCalls).toHaveLength(2)
      expect(externalCalls[0]).toMatchObject({ service: 'crm' })
      expect(externalCalls[1]).toMatchObject({ service: 'analytics' })
    })
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('$created Handler - Error Handling', () => {
  let manager: LifecycleManager
  let mockContext: LifecycleContext

  beforeEach(() => {
    manager = new LifecycleManager()
    mockContext = createMockContext()
  })

  describe('Handler Errors', () => {
    it('propagates errors from handler', async () => {
      manager.register('Customer', {
        $created: () => {
          throw new Error('Handler error')
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      await expect(manager.onCreated(entity, mockContext)).rejects.toThrow('Handler error')
    })

    it('propagates custom error types', async () => {
      class ValidationError extends Error {
        constructor(
          public field: string,
          message: string
        ) {
          super(message)
          this.name = 'ValidationError'
        }
      }

      manager.register('Customer', {
        $created: (entity) => {
          const customer = entity as Customer
          if (!customer.email.includes('@')) {
            throw new ValidationError('email', 'Invalid email format')
          }
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'invalid-email',
        tier: 'free',
        signupDate: new Date(),
      }

      try {
        await manager.onCreated(entity, mockContext)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        expect((error as ValidationError).field).toBe('email')
      }
    })
  })

  describe('Cascade Errors', () => {
    it('propagates errors from cascade creation', async () => {
      mockContext.WelcomePackage = vi.fn().mockRejectedValue(new Error('Failed to create package'))

      manager.register('Customer', {
        $created: async (entity, $) => {
          await $.WelcomePackage($.generateId(), { customerId: entity.$id })
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      await expect(manager.onCreated(entity, mockContext)).rejects.toThrow('Failed to create package')
    })

    it('partial cascade failure stops remaining operations', async () => {
      const createdEntities: string[] = []

      mockContext.Notification = vi.fn(async () => {
        createdEntities.push('notification')
        return { $id: 'n', $type: 'Notification' } as Entity
      })

      mockContext.WelcomePackage = vi.fn().mockRejectedValue(new Error('Package creation failed'))

      mockContext.AuditLog = vi.fn(async () => {
        createdEntities.push('audit')
        return { $id: 'a', $type: 'AuditLog' } as Entity
      })

      manager.register('Customer', {
        $created: async (entity, $) => {
          await $.Notification('n1', {}) // This succeeds
          await $.WelcomePackage('wp1', {}) // This fails
          await $.AuditLog('a1', {}) // This should not execute
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      await expect(manager.onCreated(entity, mockContext)).rejects.toThrow()

      expect(createdEntities).toContain('notification')
      expect(createdEntities).not.toContain('audit')
    })
  })

  describe('Error Recovery', () => {
    it('can catch and handle errors within handler', async () => {
      const handledErrors: Error[] = []
      let fallbackExecuted = false

      mockContext.WelcomePackage = vi.fn().mockRejectedValue(new Error('Package service down'))

      mockContext.AuditLog = vi.fn(async () => {
        return { $id: 'a', $type: 'AuditLog' } as Entity
      })

      manager.register('Customer', {
        $created: async (entity, $) => {
          try {
            await $.WelcomePackage($.generateId(), { customerId: entity.$id })
          } catch (error) {
            handledErrors.push(error as Error)
            // Fallback: log the failure instead
            await $.AuditLog($.generateId(), {
              action: 'welcome_package_failed',
              entityId: entity.$id,
              error: (error as Error).message,
            })
            fallbackExecuted = true
          }
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      // Should not throw because error is caught
      await expect(manager.onCreated(entity, mockContext)).resolves.not.toThrow()

      expect(handledErrors).toHaveLength(1)
      expect(fallbackExecuted).toBe(true)
    })
  })
})

// ============================================================================
// MULTIPLE HANDLERS TESTS
// ============================================================================

describe('$created Handler - Multiple Handlers', () => {
  let manager: LifecycleManager
  let mockContext: LifecycleContext

  beforeEach(() => {
    manager = new LifecycleManager()
    mockContext = createMockContext()
  })

  describe('Handler Chaining', () => {
    it('can register multiple handlers for same type', async () => {
      const callOrder: string[] = []

      manager.register('Customer', {
        $created: () => {
          callOrder.push('handler1')
        },
      })

      // This might replace or add - depends on implementation
      manager.addHandler('Customer', '$created', () => {
        callOrder.push('handler2')
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      await manager.onCreated(entity, mockContext)

      expect(callOrder).toContain('handler1')
      expect(callOrder).toContain('handler2')
    })

    it('all handlers receive same entity and context', async () => {
      const receivedEntities: Entity[] = []
      const receivedContexts: LifecycleContext[] = []

      manager.register('Customer', {
        $created: (entity, $) => {
          receivedEntities.push(entity)
          receivedContexts.push($)
        },
      })

      manager.addHandler('Customer', '$created', (entity, $) => {
        receivedEntities.push(entity)
        receivedContexts.push($)
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      await manager.onCreated(entity, mockContext)

      expect(receivedEntities[0]).toEqual(receivedEntities[1])
      expect(receivedContexts[0]).toBe(receivedContexts[1])
    })
  })
})

// ============================================================================
// RETURN VALUE TESTS
// ============================================================================

describe('$created Handler - Return Values', () => {
  let manager: LifecycleManager
  let mockContext: LifecycleContext

  beforeEach(() => {
    manager = new LifecycleManager()
    mockContext = createMockContext()
  })

  describe('Handler Return Value', () => {
    it('can return void (most common)', async () => {
      manager.register('Customer', {
        $created: () => {
          // No return
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      await expect(manager.onCreated(entity, mockContext)).resolves.not.toThrow()
    })

    it('can return cascade result with created entities', async () => {
      mockContext.WelcomePackage = vi.fn().mockResolvedValue({
        $id: 'wp-001',
        $type: 'WelcomePackage',
        customerId: 'cust-001',
      })

      manager.register('Customer', {
        $created: async (entity, $): Promise<CascadeResult> => {
          const pkg = await $.WelcomePackage($.generateId(), {
            customerId: entity.$id,
          })

          return {
            cascaded: [pkg],
          }
        },
      })

      const entity: Customer = {
        $id: 'cust-001',
        $type: 'Customer',
        name: 'Test',
        email: 'test@example.com.ai',
        tier: 'free',
        signupDate: new Date(),
      }

      const result = await manager.onCreated(entity, mockContext)

      expect(result?.cascaded).toHaveLength(1)
      expect(result?.cascaded[0].$type).toBe('WelcomePackage')
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
    generateId: vi.fn(() => `mock-id-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    getChangedFields: vi.fn(() => []),
    hasChanged: vi.fn(() => false),
  } as unknown as LifecycleContext
}
