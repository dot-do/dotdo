/**
 * @dotdo/salesforce - Apex Trigger Simulation Tests
 *
 * Tests for Salesforce Apex trigger simulation including:
 * - Before/After Insert triggers
 * - Before/After Update triggers
 * - Before/After Delete triggers
 * - Before/After Undelete triggers
 * - Trigger context variables (Trigger.new, Trigger.old, Trigger.isInsert, etc.)
 * - Bulk trigger operations
 * - Trigger order of execution
 *
 * TDD RED Phase: These tests define the expected behavior for Apex trigger
 * simulation. They will fail until the implementation is added.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SObject } from '../types'

// =============================================================================
// Expected Types (to be implemented)
// =============================================================================

/**
 * Trigger operation types matching Salesforce Apex trigger events
 */
type TriggerOperation = 'insert' | 'update' | 'delete' | 'undelete'

/**
 * Trigger timing - before or after DML operation
 */
type TriggerTiming = 'before' | 'after'

/**
 * Trigger event combining timing and operation
 */
type TriggerEvent = `${TriggerTiming}_${TriggerOperation}`

/**
 * Trigger context variables available in Apex triggers
 * @see https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_context_variables.htm
 */
interface TriggerContext<T extends SObject = SObject> {
  /** True if fired due to insert operation */
  isInsert: boolean
  /** True if fired due to update operation */
  isUpdate: boolean
  /** True if fired due to delete operation */
  isDelete: boolean
  /** True if fired due to undelete operation */
  isUndelete: boolean
  /** True if before trigger */
  isBefore: boolean
  /** True if after trigger */
  isAfter: boolean
  /** True if trigger was fired from API/Apex */
  isExecuting: boolean
  /** List of new records (available in insert/update triggers) */
  new: T[] | null
  /** Map of new records by ID (available in before update, after insert, after update) */
  newMap: Map<string, T> | null
  /** List of old records (available in update/delete triggers) */
  old: T[] | null
  /** Map of old records by ID (available in update/delete triggers) */
  oldMap: Map<string, T> | null
  /** Number of records in trigger invocation */
  size: number
  /** DML operation that fired the trigger */
  operationType: TriggerOperation
}

/**
 * Trigger handler function signature
 */
type TriggerHandler<T extends SObject = SObject> = (context: TriggerContext<T>) => void | Promise<void>

/**
 * Apex trigger configuration
 */
interface ApexTriggerConfig {
  name: string
  object: string
  events: TriggerEvent[]
  active?: boolean
  order?: number // Execution order when multiple triggers exist
}

/**
 * Apex trigger execution result
 */
interface TriggerExecutionResult {
  triggerName: string
  event: TriggerEvent
  success: boolean
  recordsProcessed: number
  error?: string
  durationMs: number
}

// =============================================================================
// Placeholder imports - these will fail until implementation exists
// =============================================================================

// These imports will fail - this is intentional for TDD RED phase
// Once the implementation is added, these should be imported from '../index'
const ApexTrigger = null as unknown as new (config: ApexTriggerConfig) => {
  readonly name: string
  readonly object: string
  readonly events: TriggerEvent[]
  active: boolean
  order: number
  handler: TriggerHandler | null
  setHandler(handler: TriggerHandler): void
  appliesTo(objectType: string): boolean
  appliesTo(objectType: string, event: TriggerEvent): boolean
  fire(event: TriggerEvent, context: TriggerContext): Promise<TriggerExecutionResult>
}

const TriggerManager = null as unknown as new () => {
  registerTrigger(trigger: InstanceType<typeof ApexTrigger>): void
  unregisterTrigger(triggerName: string): boolean
  getTrigger(triggerName: string): InstanceType<typeof ApexTrigger> | undefined
  listTriggers(objectType?: string): InstanceType<typeof ApexTrigger>[]
  fireInsert(objectType: string, records: SObject[]): Promise<TriggerExecutionResult[]>
  fireUpdate(objectType: string, newRecords: SObject[], oldRecords: SObject[]): Promise<TriggerExecutionResult[]>
  fireDelete(objectType: string, records: SObject[]): Promise<TriggerExecutionResult[]>
  fireUndelete(objectType: string, records: SObject[]): Promise<TriggerExecutionResult[]>
  clear(): void
}

const createTriggerContext = null as unknown as <T extends SObject>(
  operation: TriggerOperation,
  timing: TriggerTiming,
  newRecords?: T[],
  oldRecords?: T[]
) => TriggerContext<T>

// =============================================================================
// Test Helpers
// =============================================================================

function mockAccount(overrides: Partial<SObject> = {}): SObject {
  return {
    Id: `001xx${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`,
    Name: 'Acme Inc',
    Industry: 'Technology',
    AnnualRevenue: 5000000,
    Rating: 'Warm',
    Type: 'Customer',
    Website: 'https://acme.com',
    NumberOfEmployees: 500,
    attributes: { type: 'Account', url: '/services/data/v59.0/sobjects/Account/001xx' },
    ...overrides,
  }
}

function mockContact(overrides: Partial<SObject> = {}): SObject {
  return {
    Id: `003xx${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`,
    FirstName: 'John',
    LastName: 'Doe',
    Email: 'john.doe@acme.com',
    Phone: '555-1234',
    AccountId: '001xx000003DGxYAAW',
    attributes: { type: 'Contact', url: '/services/data/v59.0/sobjects/Contact/003xx' },
    ...overrides,
  }
}

function mockOpportunity(overrides: Partial<SObject> = {}): SObject {
  return {
    Id: `006xx${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`,
    Name: 'Acme - Enterprise Deal',
    StageName: 'Prospecting',
    Amount: 100000,
    CloseDate: '2024-12-31',
    Probability: 20,
    AccountId: '001xx000003DGxYAAW',
    attributes: { type: 'Opportunity', url: '/services/data/v59.0/sobjects/Opportunity/006xx' },
    ...overrides,
  }
}

// =============================================================================
// ApexTrigger Class Tests
// =============================================================================

describe('@dotdo/salesforce - ApexTrigger', () => {
  describe('constructor', () => {
    it('should create a trigger with basic configuration', () => {
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_insert', 'after_insert'],
      })

      expect(trigger.name).toBe('AccountTrigger')
      expect(trigger.object).toBe('Account')
      expect(trigger.events).toEqual(['before_insert', 'after_insert'])
      expect(trigger.active).toBe(true)
      expect(trigger.order).toBe(0)
    })

    it('should allow custom order and active state', () => {
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_insert'],
        active: false,
        order: 10,
      })

      expect(trigger.active).toBe(false)
      expect(trigger.order).toBe(10)
    })

    it('should support all trigger events', () => {
      const allEvents: TriggerEvent[] = [
        'before_insert',
        'after_insert',
        'before_update',
        'after_update',
        'before_delete',
        'after_delete',
        'before_undelete',
        'after_undelete',
      ]

      const trigger = new ApexTrigger({
        name: 'ComprehensiveTrigger',
        object: 'Account',
        events: allEvents,
      })

      expect(trigger.events).toHaveLength(8)
      expect(trigger.events).toEqual(allEvents)
    })
  })

  describe('setHandler', () => {
    it('should set a handler function', () => {
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_insert'],
      })

      const handler = vi.fn()
      trigger.setHandler(handler)

      expect(trigger.handler).toBe(handler)
    })
  })

  describe('appliesTo', () => {
    it('should match object type case-insensitively', () => {
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_insert'],
      })

      expect(trigger.appliesTo('Account')).toBe(true)
      expect(trigger.appliesTo('account')).toBe(true)
      expect(trigger.appliesTo('ACCOUNT')).toBe(true)
      expect(trigger.appliesTo('Contact')).toBe(false)
    })

    it('should check both object type and event', () => {
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_insert', 'after_insert'],
      })

      expect(trigger.appliesTo('Account', 'before_insert')).toBe(true)
      expect(trigger.appliesTo('Account', 'after_insert')).toBe(true)
      expect(trigger.appliesTo('Account', 'before_update')).toBe(false)
      expect(trigger.appliesTo('Contact', 'before_insert')).toBe(false)
    })

    it('should not match when trigger is inactive', () => {
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_insert'],
        active: false,
      })

      expect(trigger.appliesTo('Account')).toBe(false)
      expect(trigger.appliesTo('Account', 'before_insert')).toBe(false)
    })
  })

  describe('fire', () => {
    it('should execute handler and return result', async () => {
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_insert'],
      })

      const handler = vi.fn()
      trigger.setHandler(handler)

      const account = mockAccount()
      const context: TriggerContext = {
        isInsert: true,
        isUpdate: false,
        isDelete: false,
        isUndelete: false,
        isBefore: true,
        isAfter: false,
        isExecuting: true,
        new: [account],
        newMap: new Map([[account.Id!, account]]),
        old: null,
        oldMap: null,
        size: 1,
        operationType: 'insert',
      }

      const result = await trigger.fire('before_insert', context)

      expect(handler).toHaveBeenCalledWith(context)
      expect(result.triggerName).toBe('AccountTrigger')
      expect(result.event).toBe('before_insert')
      expect(result.success).toBe(true)
      expect(result.recordsProcessed).toBe(1)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should capture handler errors', async () => {
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_insert'],
      })

      trigger.setHandler(() => {
        throw new Error('Validation failed')
      })

      const context: TriggerContext = {
        isInsert: true,
        isUpdate: false,
        isDelete: false,
        isUndelete: false,
        isBefore: true,
        isAfter: false,
        isExecuting: true,
        new: [mockAccount()],
        newMap: null,
        old: null,
        oldMap: null,
        size: 1,
        operationType: 'insert',
      }

      const result = await trigger.fire('before_insert', context)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Validation failed')
    })

    it('should support async handlers', async () => {
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['after_insert'],
      })

      const asyncHandler = vi.fn().mockResolvedValue(undefined)
      trigger.setHandler(asyncHandler)

      const context: TriggerContext = {
        isInsert: true,
        isUpdate: false,
        isDelete: false,
        isUndelete: false,
        isBefore: false,
        isAfter: true,
        isExecuting: true,
        new: [mockAccount()],
        newMap: new Map(),
        old: null,
        oldMap: null,
        size: 1,
        operationType: 'insert',
      }

      const result = await trigger.fire('after_insert', context)

      expect(asyncHandler).toHaveBeenCalled()
      expect(result.success).toBe(true)
    })
  })
})

// =============================================================================
// TriggerContext Tests
// =============================================================================

describe('@dotdo/salesforce - TriggerContext', () => {
  describe('createTriggerContext', () => {
    describe('before_insert', () => {
      it('should create correct context for before insert', () => {
        const records = [mockAccount(), mockAccount()]
        const context = createTriggerContext('insert', 'before', records)

        expect(context.isInsert).toBe(true)
        expect(context.isUpdate).toBe(false)
        expect(context.isDelete).toBe(false)
        expect(context.isUndelete).toBe(false)
        expect(context.isBefore).toBe(true)
        expect(context.isAfter).toBe(false)
        expect(context.isExecuting).toBe(true)
        expect(context.operationType).toBe('insert')
        expect(context.size).toBe(2)
      })

      it('should have Trigger.new but no Trigger.newMap in before insert', () => {
        const records = [mockAccount()]
        const context = createTriggerContext('insert', 'before', records)

        expect(context.new).toEqual(records)
        expect(context.newMap).toBeNull() // IDs not assigned yet in before insert
      })

      it('should have no Trigger.old in insert', () => {
        const records = [mockAccount()]
        const context = createTriggerContext('insert', 'before', records)

        expect(context.old).toBeNull()
        expect(context.oldMap).toBeNull()
      })
    })

    describe('after_insert', () => {
      it('should create correct context for after insert', () => {
        const records = [mockAccount(), mockAccount()]
        const context = createTriggerContext('insert', 'after', records)

        expect(context.isInsert).toBe(true)
        expect(context.isBefore).toBe(false)
        expect(context.isAfter).toBe(true)
      })

      it('should have both Trigger.new and Trigger.newMap in after insert', () => {
        const record1 = mockAccount({ Id: '001xx000001' })
        const record2 = mockAccount({ Id: '001xx000002' })
        const records = [record1, record2]

        const context = createTriggerContext('insert', 'after', records)

        expect(context.new).toEqual(records)
        expect(context.newMap).toBeInstanceOf(Map)
        expect(context.newMap!.get('001xx000001')).toBe(record1)
        expect(context.newMap!.get('001xx000002')).toBe(record2)
      })

      it('should have read-only records in after triggers (conceptually)', () => {
        // In Salesforce, after trigger records are read-only
        // Our implementation should document/enforce this behavior
        const records = [mockAccount()]
        const context = createTriggerContext('insert', 'after', records)

        // The records should be frozen or marked as read-only
        expect(context.new).toBeDefined()
        expect(Object.isFrozen(context.new![0])).toBe(true)
      })
    })

    describe('before_update', () => {
      it('should create correct context for before update', () => {
        const oldRecords = [mockAccount({ Name: 'Old Name' })]
        const newRecords = [mockAccount({ Name: 'New Name' })]

        const context = createTriggerContext('update', 'before', newRecords, oldRecords)

        expect(context.isInsert).toBe(false)
        expect(context.isUpdate).toBe(true)
        expect(context.isBefore).toBe(true)
        expect(context.isAfter).toBe(false)
        expect(context.operationType).toBe('update')
      })

      it('should have Trigger.new, Trigger.newMap, Trigger.old, Trigger.oldMap', () => {
        const oldRecord = mockAccount({ Id: '001xx000001', Name: 'Old Name' })
        const newRecord = mockAccount({ Id: '001xx000001', Name: 'New Name' })

        const context = createTriggerContext('update', 'before', [newRecord], [oldRecord])

        expect(context.new).toEqual([newRecord])
        expect(context.newMap!.get('001xx000001')).toBe(newRecord)
        expect(context.old).toEqual([oldRecord])
        expect(context.oldMap!.get('001xx000001')).toBe(oldRecord)
      })

      it('should allow modifications to Trigger.new in before update', () => {
        const oldRecord = mockAccount({ Id: '001xx000001', Name: 'Old' })
        const newRecord = mockAccount({ Id: '001xx000001', Name: 'New' })

        const context = createTriggerContext('update', 'before', [newRecord], [oldRecord])

        // In before triggers, we can modify the new record
        expect(Object.isFrozen(context.new![0])).toBe(false)
      })
    })

    describe('after_update', () => {
      it('should create correct context for after update', () => {
        const oldRecords = [mockAccount()]
        const newRecords = [mockAccount()]

        const context = createTriggerContext('update', 'after', newRecords, oldRecords)

        expect(context.isUpdate).toBe(true)
        expect(context.isAfter).toBe(true)
      })

      it('should have all context variables with read-only new records', () => {
        const oldRecord = mockAccount({ Id: '001xx000001', Name: 'Old' })
        const newRecord = mockAccount({ Id: '001xx000001', Name: 'New' })

        const context = createTriggerContext('update', 'after', [newRecord], [oldRecord])

        expect(context.new).toBeDefined()
        expect(context.newMap).toBeDefined()
        expect(context.old).toBeDefined()
        expect(context.oldMap).toBeDefined()
        expect(Object.isFrozen(context.new![0])).toBe(true)
      })
    })

    describe('before_delete', () => {
      it('should create correct context for before delete', () => {
        const records = [mockAccount()]

        const context = createTriggerContext('delete', 'before', undefined, records)

        expect(context.isDelete).toBe(true)
        expect(context.isBefore).toBe(true)
        expect(context.operationType).toBe('delete')
      })

      it('should have Trigger.old and Trigger.oldMap, no Trigger.new', () => {
        const record = mockAccount({ Id: '001xx000001' })

        const context = createTriggerContext('delete', 'before', undefined, [record])

        expect(context.new).toBeNull()
        expect(context.newMap).toBeNull()
        expect(context.old).toEqual([record])
        expect(context.oldMap!.get('001xx000001')).toBe(record)
      })
    })

    describe('after_delete', () => {
      it('should create correct context for after delete', () => {
        const records = [mockAccount()]

        const context = createTriggerContext('delete', 'after', undefined, records)

        expect(context.isDelete).toBe(true)
        expect(context.isAfter).toBe(true)
      })

      it('should have read-only old records', () => {
        const record = mockAccount({ Id: '001xx000001' })

        const context = createTriggerContext('delete', 'after', undefined, [record])

        expect(context.old).toBeDefined()
        expect(Object.isFrozen(context.old![0])).toBe(true)
      })
    })

    describe('undelete', () => {
      it('should create correct context for before undelete', () => {
        const records = [mockAccount()]

        const context = createTriggerContext('undelete', 'before', records)

        expect(context.isUndelete).toBe(true)
        expect(context.isBefore).toBe(true)
      })

      it('should create correct context for after undelete', () => {
        const records = [mockAccount()]

        const context = createTriggerContext('undelete', 'after', records)

        expect(context.isUndelete).toBe(true)
        expect(context.isAfter).toBe(true)
        expect(context.new).toEqual(records)
      })
    })
  })
})

// =============================================================================
// TriggerManager Tests
// =============================================================================

describe('@dotdo/salesforce - TriggerManager', () => {
  let manager: InstanceType<typeof TriggerManager>

  beforeEach(() => {
    manager = new TriggerManager()
  })

  afterEach(() => {
    manager.clear()
  })

  describe('registerTrigger / unregisterTrigger', () => {
    it('should register and retrieve triggers', () => {
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_insert'],
      })

      manager.registerTrigger(trigger)

      expect(manager.getTrigger('AccountTrigger')).toBe(trigger)
    })

    it('should unregister triggers', () => {
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_insert'],
      })

      manager.registerTrigger(trigger)
      expect(manager.getTrigger('AccountTrigger')).toBeDefined()

      const result = manager.unregisterTrigger('AccountTrigger')
      expect(result).toBe(true)
      expect(manager.getTrigger('AccountTrigger')).toBeUndefined()
    })

    it('should return false when unregistering non-existent trigger', () => {
      const result = manager.unregisterTrigger('NonExistent')
      expect(result).toBe(false)
    })
  })

  describe('listTriggers', () => {
    it('should list all triggers', () => {
      manager.registerTrigger(new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_insert'],
      }))
      manager.registerTrigger(new ApexTrigger({
        name: 'ContactTrigger',
        object: 'Contact',
        events: ['after_insert'],
      }))

      const triggers = manager.listTriggers()
      expect(triggers).toHaveLength(2)
    })

    it('should filter triggers by object type', () => {
      manager.registerTrigger(new ApexTrigger({
        name: 'AccountTrigger1',
        object: 'Account',
        events: ['before_insert'],
      }))
      manager.registerTrigger(new ApexTrigger({
        name: 'AccountTrigger2',
        object: 'Account',
        events: ['after_insert'],
      }))
      manager.registerTrigger(new ApexTrigger({
        name: 'ContactTrigger',
        object: 'Contact',
        events: ['before_insert'],
      }))

      expect(manager.listTriggers('Account')).toHaveLength(2)
      expect(manager.listTriggers('Contact')).toHaveLength(1)
      expect(manager.listTriggers('Opportunity')).toHaveLength(0)
    })
  })

  describe('fireInsert', () => {
    it('should fire before_insert triggers', async () => {
      const handler = vi.fn()
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_insert'],
      })
      trigger.setHandler(handler)
      manager.registerTrigger(trigger)

      const records = [mockAccount(), mockAccount()]
      await manager.fireInsert('Account', records)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        isInsert: true,
        isBefore: true,
        new: records,
      }))
    })

    it('should fire after_insert triggers', async () => {
      const handler = vi.fn()
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['after_insert'],
      })
      trigger.setHandler(handler)
      manager.registerTrigger(trigger)

      const records = [mockAccount()]
      await manager.fireInsert('Account', records)

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        isInsert: true,
        isAfter: true,
      }))
    })

    it('should fire both before and after insert triggers in order', async () => {
      const order: string[] = []

      const beforeTrigger = new ApexTrigger({
        name: 'BeforeAccountTrigger',
        object: 'Account',
        events: ['before_insert'],
      })
      beforeTrigger.setHandler(() => { order.push('before') })

      const afterTrigger = new ApexTrigger({
        name: 'AfterAccountTrigger',
        object: 'Account',
        events: ['after_insert'],
      })
      afterTrigger.setHandler(() => { order.push('after') })

      manager.registerTrigger(afterTrigger) // Register in wrong order
      manager.registerTrigger(beforeTrigger)

      await manager.fireInsert('Account', [mockAccount()])

      expect(order).toEqual(['before', 'after'])
    })

    it('should allow before trigger to modify records', async () => {
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_insert'],
      })
      trigger.setHandler((context) => {
        for (const record of context.new!) {
          record.Rating = 'Hot'
          record.CreatedDate = new Date().toISOString()
        }
      })
      manager.registerTrigger(trigger)

      const records = [mockAccount({ Rating: 'Cold' })]
      await manager.fireInsert('Account', records)

      expect(records[0].Rating).toBe('Hot')
      expect(records[0].CreatedDate).toBeDefined()
    })

    it('should return execution results for all triggers', async () => {
      manager.registerTrigger(new ApexTrigger({
        name: 'Trigger1',
        object: 'Account',
        events: ['before_insert'],
      }))
      manager.registerTrigger(new ApexTrigger({
        name: 'Trigger2',
        object: 'Account',
        events: ['after_insert'],
      }))

      const results = await manager.fireInsert('Account', [mockAccount()])

      expect(results).toHaveLength(2)
      expect(results[0].event).toBe('before_insert')
      expect(results[1].event).toBe('after_insert')
    })
  })

  describe('fireUpdate', () => {
    it('should fire before_update triggers with old and new records', async () => {
      const handler = vi.fn()
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_update'],
      })
      trigger.setHandler(handler)
      manager.registerTrigger(trigger)

      const oldRecords = [mockAccount({ Id: '001', Name: 'Old Name' })]
      const newRecords = [mockAccount({ Id: '001', Name: 'New Name' })]

      await manager.fireUpdate('Account', newRecords, oldRecords)

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        isUpdate: true,
        isBefore: true,
        new: newRecords,
        old: oldRecords,
      }))
    })

    it('should fire after_update triggers', async () => {
      const handler = vi.fn()
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['after_update'],
      })
      trigger.setHandler(handler)
      manager.registerTrigger(trigger)

      const oldRecords = [mockAccount({ Id: '001' })]
      const newRecords = [mockAccount({ Id: '001' })]

      await manager.fireUpdate('Account', newRecords, oldRecords)

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        isUpdate: true,
        isAfter: true,
      }))
    })

    it('should provide oldMap and newMap for field comparison', async () => {
      const handler = vi.fn()
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_update'],
      })
      trigger.setHandler(handler)
      manager.registerTrigger(trigger)

      const oldRecord = mockAccount({ Id: '001xx000001', Rating: 'Cold' })
      const newRecord = mockAccount({ Id: '001xx000001', Rating: 'Hot' })

      await manager.fireUpdate('Account', [newRecord], [oldRecord])

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        oldMap: expect.any(Map),
        newMap: expect.any(Map),
      }))

      const context = handler.mock.calls[0][0] as TriggerContext
      expect(context.oldMap!.get('001xx000001')!.Rating).toBe('Cold')
      expect(context.newMap!.get('001xx000001')!.Rating).toBe('Hot')
    })

    it('should allow detecting field changes', async () => {
      const changedFields: string[] = []
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_update'],
      })
      trigger.setHandler((context) => {
        for (const newRecord of context.new!) {
          const oldRecord = context.oldMap!.get(newRecord.Id!)!
          if (newRecord.Name !== oldRecord.Name) {
            changedFields.push('Name')
          }
          if (newRecord.Rating !== oldRecord.Rating) {
            changedFields.push('Rating')
          }
        }
      })
      manager.registerTrigger(trigger)

      const oldRecord = mockAccount({ Id: '001', Name: 'Old', Rating: 'Cold' })
      const newRecord = mockAccount({ Id: '001', Name: 'New', Rating: 'Cold' })

      await manager.fireUpdate('Account', [newRecord], [oldRecord])

      expect(changedFields).toEqual(['Name'])
    })
  })

  describe('fireDelete', () => {
    it('should fire before_delete triggers', async () => {
      const handler = vi.fn()
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_delete'],
      })
      trigger.setHandler(handler)
      manager.registerTrigger(trigger)

      const records = [mockAccount()]
      await manager.fireDelete('Account', records)

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        isDelete: true,
        isBefore: true,
        old: records,
        new: null,
      }))
    })

    it('should fire after_delete triggers', async () => {
      const handler = vi.fn()
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['after_delete'],
      })
      trigger.setHandler(handler)
      manager.registerTrigger(trigger)

      const records = [mockAccount()]
      await manager.fireDelete('Account', records)

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        isDelete: true,
        isAfter: true,
      }))
    })

    it('should provide oldMap for deleted records', async () => {
      const handler = vi.fn()
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_delete'],
      })
      trigger.setHandler(handler)
      manager.registerTrigger(trigger)

      const record = mockAccount({ Id: '001xx000001' })
      await manager.fireDelete('Account', [record])

      const context = handler.mock.calls[0][0] as TriggerContext
      expect(context.oldMap!.get('001xx000001')).toBe(record)
    })
  })

  describe('fireUndelete', () => {
    it('should fire before_undelete triggers', async () => {
      const handler = vi.fn()
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_undelete'],
      })
      trigger.setHandler(handler)
      manager.registerTrigger(trigger)

      const records = [mockAccount()]
      await manager.fireUndelete('Account', records)

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        isUndelete: true,
        isBefore: true,
        new: records,
      }))
    })

    it('should fire after_undelete triggers', async () => {
      const handler = vi.fn()
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['after_undelete'],
      })
      trigger.setHandler(handler)
      manager.registerTrigger(trigger)

      const records = [mockAccount()]
      await manager.fireUndelete('Account', records)

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        isUndelete: true,
        isAfter: true,
      }))
    })
  })

  describe('bulk operations', () => {
    it('should handle bulk insert with 200 records', async () => {
      const recordCount = { value: 0 }
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_insert'],
      })
      trigger.setHandler((context) => {
        recordCount.value = context.size
      })
      manager.registerTrigger(trigger)

      const records = Array.from({ length: 200 }, () => mockAccount())
      await manager.fireInsert('Account', records)

      expect(recordCount.value).toBe(200)
    })

    it('should handle bulk update with correct mappings', async () => {
      const handler = vi.fn()
      const trigger = new ApexTrigger({
        name: 'AccountTrigger',
        object: 'Account',
        events: ['before_update'],
      })
      trigger.setHandler(handler)
      manager.registerTrigger(trigger)

      const oldRecords = Array.from({ length: 50 }, (_, i) =>
        mockAccount({ Id: `001xx${i.toString().padStart(6, '0')}`, Name: `Account ${i}` })
      )
      const newRecords = oldRecords.map(r =>
        ({ ...r, Name: `Updated ${r.Name}` })
      )

      await manager.fireUpdate('Account', newRecords, oldRecords)

      const context = handler.mock.calls[0][0] as TriggerContext
      expect(context.size).toBe(50)
      expect(context.newMap!.size).toBe(50)
      expect(context.oldMap!.size).toBe(50)
    })
  })

  describe('trigger ordering', () => {
    it('should execute triggers in order property sequence', async () => {
      const executionOrder: string[] = []

      const trigger1 = new ApexTrigger({
        name: 'Trigger1',
        object: 'Account',
        events: ['before_insert'],
        order: 20,
      })
      trigger1.setHandler(() => { executionOrder.push('trigger1') })

      const trigger2 = new ApexTrigger({
        name: 'Trigger2',
        object: 'Account',
        events: ['before_insert'],
        order: 10,
      })
      trigger2.setHandler(() => { executionOrder.push('trigger2') })

      const trigger3 = new ApexTrigger({
        name: 'Trigger3',
        object: 'Account',
        events: ['before_insert'],
        order: 30,
      })
      trigger3.setHandler(() => { executionOrder.push('trigger3') })

      manager.registerTrigger(trigger1)
      manager.registerTrigger(trigger2)
      manager.registerTrigger(trigger3)

      await manager.fireInsert('Account', [mockAccount()])

      expect(executionOrder).toEqual(['trigger2', 'trigger1', 'trigger3'])
    })

    it('should maintain insertion order for same order value', async () => {
      const executionOrder: string[] = []

      const trigger1 = new ApexTrigger({
        name: 'Trigger1',
        object: 'Account',
        events: ['before_insert'],
        order: 0,
      })
      trigger1.setHandler(() => { executionOrder.push('trigger1') })

      const trigger2 = new ApexTrigger({
        name: 'Trigger2',
        object: 'Account',
        events: ['before_insert'],
        order: 0,
      })
      trigger2.setHandler(() => { executionOrder.push('trigger2') })

      manager.registerTrigger(trigger1)
      manager.registerTrigger(trigger2)

      await manager.fireInsert('Account', [mockAccount()])

      expect(executionOrder).toEqual(['trigger1', 'trigger2'])
    })
  })

  describe('error handling', () => {
    it('should stop execution on before trigger error by default', async () => {
      const trigger1 = new ApexTrigger({
        name: 'FailingTrigger',
        object: 'Account',
        events: ['before_insert'],
        order: 1,
      })
      trigger1.setHandler(() => {
        throw new Error('Validation error')
      })

      const trigger2Handler = vi.fn()
      const trigger2 = new ApexTrigger({
        name: 'SecondTrigger',
        object: 'Account',
        events: ['before_insert'],
        order: 2,
      })
      trigger2.setHandler(trigger2Handler)

      manager.registerTrigger(trigger1)
      manager.registerTrigger(trigger2)

      const results = await manager.fireInsert('Account', [mockAccount()])

      expect(results[0].success).toBe(false)
      expect(trigger2Handler).not.toHaveBeenCalled()
    })

    it('should report all trigger errors in results', async () => {
      const trigger = new ApexTrigger({
        name: 'FailingTrigger',
        object: 'Account',
        events: ['before_insert'],
      })
      trigger.setHandler(() => {
        throw new Error('Custom validation error')
      })
      manager.registerTrigger(trigger)

      const results = await manager.fireInsert('Account', [mockAccount()])

      expect(results[0].error).toBe('Custom validation error')
    })
  })

  describe('clear', () => {
    it('should clear all triggers', () => {
      manager.registerTrigger(new ApexTrigger({
        name: 'Trigger1',
        object: 'Account',
        events: ['before_insert'],
      }))
      manager.registerTrigger(new ApexTrigger({
        name: 'Trigger2',
        object: 'Contact',
        events: ['after_insert'],
      }))

      expect(manager.listTriggers()).toHaveLength(2)

      manager.clear()

      expect(manager.listTriggers()).toHaveLength(0)
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('@dotdo/salesforce - Apex Trigger Integration', () => {
  let manager: InstanceType<typeof TriggerManager>

  beforeEach(() => {
    manager = new TriggerManager()
  })

  afterEach(() => {
    manager.clear()
  })

  it('should simulate Account validation trigger', async () => {
    const trigger = new ApexTrigger({
      name: 'AccountValidation',
      object: 'Account',
      events: ['before_insert', 'before_update'],
    })

    trigger.setHandler((context) => {
      for (const account of context.new!) {
        // Require Name
        if (!account.Name || (account.Name as string).trim() === '') {
          throw new Error('Account Name is required')
        }

        // Auto-populate fields
        if (!account.Type) {
          account.Type = 'Prospect'
        }
      }
    })

    manager.registerTrigger(trigger)

    // Test valid insert
    const validAccount = mockAccount({ Name: 'Valid Account', Type: undefined })
    const results = await manager.fireInsert('Account', [validAccount])

    expect(results[0].success).toBe(true)
    expect(validAccount.Type).toBe('Prospect')

    // Test invalid insert
    const invalidAccount = mockAccount({ Name: '' })
    const invalidResults = await manager.fireInsert('Account', [invalidAccount])

    expect(invalidResults[0].success).toBe(false)
    expect(invalidResults[0].error).toContain('Name is required')
  })

  it('should simulate Contact roll-up to Account', async () => {
    const contactCounts = new Map<string, number>()

    const trigger = new ApexTrigger({
      name: 'ContactRollup',
      object: 'Contact',
      events: ['after_insert', 'after_delete'],
    })

    trigger.setHandler((context) => {
      const accountIds = new Set<string>()

      if (context.isInsert) {
        for (const contact of context.new!) {
          if (contact.AccountId) {
            accountIds.add(contact.AccountId as string)
          }
        }
      } else if (context.isDelete) {
        for (const contact of context.old!) {
          if (contact.AccountId) {
            accountIds.add(contact.AccountId as string)
          }
        }
      }

      // Simulate roll-up calculation
      for (const accountId of accountIds) {
        const currentCount = contactCounts.get(accountId) ?? 0
        if (context.isInsert) {
          contactCounts.set(accountId, currentCount + context.size)
        } else if (context.isDelete) {
          contactCounts.set(accountId, Math.max(0, currentCount - context.size))
        }
      }
    })

    manager.registerTrigger(trigger)

    // Insert contacts
    const accountId = '001xx000001'
    const contacts = [
      mockContact({ AccountId: accountId }),
      mockContact({ AccountId: accountId }),
    ]

    await manager.fireInsert('Contact', contacts)
    expect(contactCounts.get(accountId)).toBe(2)

    // Delete one contact
    await manager.fireDelete('Contact', [contacts[0]])
    expect(contactCounts.get(accountId)).toBe(1)
  })

  it('should simulate Opportunity stage tracking', async () => {
    const stageHistory: Array<{ oppId: string; oldStage: string; newStage: string }> = []

    const trigger = new ApexTrigger({
      name: 'OpportunityStageTracking',
      object: 'Opportunity',
      events: ['after_update'],
    })

    trigger.setHandler((context) => {
      for (const newOpp of context.new!) {
        const oldOpp = context.oldMap!.get(newOpp.Id!)!

        if (oldOpp.StageName !== newOpp.StageName) {
          stageHistory.push({
            oppId: newOpp.Id!,
            oldStage: oldOpp.StageName as string,
            newStage: newOpp.StageName as string,
          })
        }
      }
    })

    manager.registerTrigger(trigger)

    const oldOpp = mockOpportunity({ Id: '006xx000001', StageName: 'Prospecting' })
    const newOpp = mockOpportunity({ Id: '006xx000001', StageName: 'Qualification' })

    await manager.fireUpdate('Opportunity', [newOpp], [oldOpp])

    expect(stageHistory).toHaveLength(1)
    expect(stageHistory[0]).toEqual({
      oppId: '006xx000001',
      oldStage: 'Prospecting',
      newStage: 'Qualification',
    })
  })

  it('should simulate trigger calling another service', async () => {
    const externalCalls: Array<{ method: string; payload: unknown }> = []

    const trigger = new ApexTrigger({
      name: 'AccountExternalSync',
      object: 'Account',
      events: ['after_insert', 'after_update'],
    })

    trigger.setHandler(async (context) => {
      for (const account of context.new!) {
        externalCalls.push({
          method: context.isInsert ? 'POST' : 'PUT',
          payload: {
            id: account.Id,
            name: account.Name,
            industry: account.Industry,
          },
        })
      }
    })

    manager.registerTrigger(trigger)

    // Insert
    const account = mockAccount({ Id: '001xx000001' })
    await manager.fireInsert('Account', [account])

    expect(externalCalls[0].method).toBe('POST')

    // Update
    await manager.fireUpdate('Account', [{ ...account, Name: 'Updated' }], [account])

    expect(externalCalls[1].method).toBe('PUT')
  })

  it('should simulate complex multi-object trigger scenario', async () => {
    const auditLog: string[] = []

    // Account trigger - validation and audit
    const accountTrigger = new ApexTrigger({
      name: 'AccountAudit',
      object: 'Account',
      events: ['before_insert', 'before_update', 'after_insert', 'after_update'],
    })
    accountTrigger.setHandler((context) => {
      const timing = context.isBefore ? 'before' : 'after'
      const operation = context.operationType
      auditLog.push(`Account.${timing}_${operation}: ${context.size} records`)

      if (context.isBefore && context.isInsert) {
        for (const account of context.new!) {
          if (!account.CreatedDate) {
            account.CreatedDate = new Date().toISOString()
          }
        }
      }
    })

    // Contact trigger - validation
    const contactTrigger = new ApexTrigger({
      name: 'ContactAudit',
      object: 'Contact',
      events: ['before_insert', 'after_insert'],
    })
    contactTrigger.setHandler((context) => {
      const timing = context.isBefore ? 'before' : 'after'
      auditLog.push(`Contact.${timing}_insert: ${context.size} records`)
    })

    manager.registerTrigger(accountTrigger)
    manager.registerTrigger(contactTrigger)

    // Simulate Account insert
    await manager.fireInsert('Account', [mockAccount()])
    expect(auditLog).toContain('Account.before_insert: 1 records')
    expect(auditLog).toContain('Account.after_insert: 1 records')

    // Simulate Contact insert
    await manager.fireInsert('Contact', [mockContact(), mockContact()])
    expect(auditLog).toContain('Contact.before_insert: 2 records')
    expect(auditLog).toContain('Contact.after_insert: 2 records')

    expect(auditLog).toHaveLength(4)
  })
})

// =============================================================================
// Edge Cases and Special Scenarios
// =============================================================================

describe('@dotdo/salesforce - Apex Trigger Edge Cases', () => {
  let manager: InstanceType<typeof TriggerManager>

  beforeEach(() => {
    manager = new TriggerManager()
  })

  afterEach(() => {
    manager.clear()
  })

  it('should handle empty record list', async () => {
    const handler = vi.fn()
    const trigger = new ApexTrigger({
      name: 'AccountTrigger',
      object: 'Account',
      events: ['before_insert'],
    })
    trigger.setHandler(handler)
    manager.registerTrigger(trigger)

    const results = await manager.fireInsert('Account', [])

    expect(results).toHaveLength(0)
    expect(handler).not.toHaveBeenCalled()
  })

  it('should handle triggers with no handler set', async () => {
    const trigger = new ApexTrigger({
      name: 'AccountTrigger',
      object: 'Account',
      events: ['before_insert'],
    })
    // No handler set
    manager.registerTrigger(trigger)

    const results = await manager.fireInsert('Account', [mockAccount()])

    expect(results[0].success).toBe(true)
  })

  it('should handle records without Id in before insert', async () => {
    const handler = vi.fn()
    const trigger = new ApexTrigger({
      name: 'AccountTrigger',
      object: 'Account',
      events: ['before_insert'],
    })
    trigger.setHandler(handler)
    manager.registerTrigger(trigger)

    const recordWithoutId = { ...mockAccount() }
    delete recordWithoutId.Id

    await manager.fireInsert('Account', [recordWithoutId])

    const context = handler.mock.calls[0][0] as TriggerContext
    expect(context.newMap).toBeNull() // No IDs available yet
  })

  it('should not fire inactive triggers', async () => {
    const handler = vi.fn()
    const trigger = new ApexTrigger({
      name: 'AccountTrigger',
      object: 'Account',
      events: ['before_insert'],
      active: false,
    })
    trigger.setHandler(handler)
    manager.registerTrigger(trigger)

    await manager.fireInsert('Account', [mockAccount()])

    expect(handler).not.toHaveBeenCalled()
  })

  it('should only fire triggers for matching object type', async () => {
    const accountHandler = vi.fn()
    const contactHandler = vi.fn()

    const accountTrigger = new ApexTrigger({
      name: 'AccountTrigger',
      object: 'Account',
      events: ['before_insert'],
    })
    accountTrigger.setHandler(accountHandler)

    const contactTrigger = new ApexTrigger({
      name: 'ContactTrigger',
      object: 'Contact',
      events: ['before_insert'],
    })
    contactTrigger.setHandler(contactHandler)

    manager.registerTrigger(accountTrigger)
    manager.registerTrigger(contactTrigger)

    await manager.fireInsert('Account', [mockAccount()])

    expect(accountHandler).toHaveBeenCalled()
    expect(contactHandler).not.toHaveBeenCalled()
  })

  it('should maintain record reference across before/after triggers', async () => {
    const recordRef = { captured: null as SObject | null }

    const beforeTrigger = new ApexTrigger({
      name: 'BeforeTrigger',
      object: 'Account',
      events: ['before_insert'],
    })
    beforeTrigger.setHandler((context) => {
      context.new![0].CustomField__c = 'set in before'
      recordRef.captured = context.new![0]
    })

    const afterTrigger = new ApexTrigger({
      name: 'AfterTrigger',
      object: 'Account',
      events: ['after_insert'],
    })
    afterTrigger.setHandler((context) => {
      // After trigger should see the value set in before trigger
      expect(context.new![0].CustomField__c).toBe('set in before')
    })

    manager.registerTrigger(beforeTrigger)
    manager.registerTrigger(afterTrigger)

    const record = mockAccount()
    await manager.fireInsert('Account', [record])

    expect(record.CustomField__c).toBe('set in before')
  })
})
