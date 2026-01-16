/**
 * DO Class Hierarchy Tests
 *
 * Tests for the progressive enhancement class hierarchy:
 * DOCore      (~5KB)   State, alarms, routing
 * DOSemantic  (~20KB)  Nouns, Verbs, Things, Actions, operators
 * DOStorage   (~40KB)  InMemory + Pipeline + SQLite + Iceberg
 * DOWorkflow  (~60KB)  WorkflowContext ($), cascade, scheduling
 * DOFull      (~80KB)  AI, human-in-loop, fanout, streaming
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { createTestDO } from './utils'

// ============================================================================
// 1. DOCore Tests - Base class with state, alarms, routing
// ============================================================================

describe('DOCore - Base class', () => {
  function getCore(name = 'test') {
    return createTestDO(env.DOCore, name)
  }

  describe('state management', () => {
    it('should get/set values via RPC', async () => {
      const core = getCore('core-state-1')
      await core.set('key1', 'value1')
      const result = await core.get('key1')
      expect(result).toBe('value1')
    })

    it('should delete values via RPC', async () => {
      const core = getCore('core-state-2')
      await core.set('to-delete', 'value')
      await core.delete('to-delete')
      expect(await core.get('to-delete')).toBeUndefined()
    })

    it('should list values with prefix', async () => {
      const core = getCore('core-state-3')
      await core.setMany({
        'prefix:a': 1,
        'prefix:b': 2,
        'other:c': 3,
      })
      const entries = await core.list({ prefix: 'prefix:' })
      expect(Object.keys(entries)).toHaveLength(2)
    })
  })

  describe('alarm scheduling', () => {
    it('should set an alarm', async () => {
      const core = getCore('core-alarm-1')
      const alarmTime = new Date(Date.now() + 60000)
      await core.setAlarm(alarmTime)
      const alarm = await core.getAlarm()
      expect(alarm).not.toBeNull()
    })

    it('should delete an alarm', async () => {
      const core = getCore('core-alarm-2')
      await core.setAlarm(Date.now() + 60000)
      await core.deleteAlarm()
      expect(await core.getAlarm()).toBeNull()
    })
  })

  describe('fetch routing', () => {
    it('should route GET requests', async () => {
      const core = getCore('core-route-1')
      const response = await core.fetch('https://test.local/health')
      expect(response.status).toBe(200)
    })

    it('should return 404 for unknown routes', async () => {
      const core = getCore('core-route-2')
      const response = await core.fetch('https://test.local/unknown-route')
      expect(response.status).toBe(404)
    })
  })

  describe('RPC methods', () => {
    it('should expose ping RPC method', async () => {
      const core = getCore('core-rpc-1')
      expect(await core.ping()).toBe('pong')
    })

    it('should expose add RPC method', async () => {
      const core = getCore('core-rpc-2')
      expect(await core.add(2, 3)).toBe(5)
    })
  })
})

// ============================================================================
// 2. DOSemantic Tests - Extends DOCore with semantic types
// ============================================================================

describe('DOSemantic - Semantic layer', () => {
  function getSemantic(name = 'test') {
    const id = env.DOSemantic.idFromName(name)
    return env.DOSemantic.get(id)
  }

  describe('inherits from DOCore', () => {
    it('should have state management from DOCore', async () => {
      const semantic = getSemantic('semantic-inherit-1')
      await semantic.set('key', 'value')
      expect(await semantic.get('key')).toBe('value')
    })

    it('should have alarm scheduling from DOCore', async () => {
      const semantic = getSemantic('semantic-inherit-2')
      await semantic.setAlarm(Date.now() + 60000)
      expect(await semantic.getAlarm()).not.toBeNull()
      await semantic.deleteAlarm()
    })

    it('should have fetch routing from DOCore', async () => {
      const semantic = getSemantic('semantic-inherit-3')
      const response = await semantic.fetch('https://test.local/health')
      expect(response.status).toBe(200)
    })
  })

  describe('noun operations', () => {
    it('should define and retrieve nouns', async () => {
      const semantic = getSemantic('semantic-noun-1')
      const customer = await semantic.defineNoun('Customer')
      expect(customer.singular).toBe('Customer')
      expect(customer.plural).toBe('Customers')
    })

    it('should handle irregular plurals', async () => {
      const semantic = getSemantic('semantic-noun-2')
      const person = await semantic.defineNoun('Person', { plural: 'People' })
      expect(person.plural).toBe('People')
    })
  })

  describe('verb operations', () => {
    it('should define and retrieve verbs', async () => {
      const semantic = getSemantic('semantic-verb-1')
      const create = await semantic.defineVerb('create')
      expect(create.base).toBe('create')
      expect(create.past).toBe('created')
      expect(create.present).toBe('creates')
      expect(create.gerund).toBe('creating')
    })
  })

  describe('thing operations', () => {
    it('should create things with auto-generated $id', async () => {
      const semantic = getSemantic('semantic-thing-1')
      await semantic.defineNoun('Customer')
      const alice = await semantic.createThing('Customer', { name: 'Alice' })
      expect(alice.$id).toBeDefined()
      expect(alice.$type).toBe('Customer')
      expect(alice.name).toBe('Alice')
    })

    it('should create things with explicit $id', async () => {
      const semantic = getSemantic('semantic-thing-2')
      await semantic.defineNoun('Customer')
      const bob = await semantic.createThing('Customer', { name: 'Bob' }, 'bob-123')
      expect(bob.$id).toBe('bob-123')
    })
  })

  describe('action operations', () => {
    it('should create actions with event, edge, and audit', async () => {
      const semantic = getSemantic('semantic-action-1')
      await semantic.defineNoun('Customer')
      await semantic.defineNoun('Product')
      await semantic.defineVerb('purchase')

      const alice = await semantic.createThing('Customer', { name: 'Alice' }, 'alice')
      const macbook = await semantic.createThing('Product', { name: 'MacBook' }, 'macbook')

      const result = await semantic.createAction('alice', 'purchase', 'macbook')

      expect(result.success).toBe(true)
      expect(result.event.type).toBe('purchased')
      expect(result.edge.from).toBe('alice')
      expect(result.edge.to).toBe('macbook')
    })
  })

  describe('relationship traversal', () => {
    it('should traverse forward relationships', async () => {
      const semantic = getSemantic('semantic-rel-1')
      await semantic.defineNoun('Customer')
      await semantic.defineNoun('Order')
      await semantic.defineVerb('place')

      const alice = await semantic.createThing('Customer', { name: 'Alice' }, 'alice')
      const order1 = await semantic.createThing('Order', { total: 100 }, 'order-1')
      await semantic.createAction('alice', 'place', 'order-1')

      const orders = await semantic.forward('alice', 'Order')
      expect(orders).toHaveLength(1)
      expect(orders[0].$id).toBe('order-1')
    })

    it('should traverse backward relationships', async () => {
      const semantic = getSemantic('semantic-rel-2')
      await semantic.defineNoun('Customer')
      await semantic.defineNoun('Product')
      await semantic.defineVerb('purchase')

      const alice = await semantic.createThing('Customer', { name: 'Alice' }, 'alice')
      const macbook = await semantic.createThing('Product', { name: 'MacBook' }, 'macbook')
      await semantic.createAction('alice', 'purchase', 'macbook')

      const customers = await semantic.backward('macbook', 'Customer')
      expect(customers).toHaveLength(1)
      expect(customers[0].$id).toBe('alice')
    })
  })
})

// ============================================================================
// 3. DOStorage Tests - Extends DOSemantic with 4-layer storage
// ============================================================================

describe('DOStorage - Storage layer', () => {
  function getStorage(name = 'test') {
    const id = env.DOStorage.idFromName(name)
    return env.DOStorage.get(id)
  }

  describe('inherits from DOSemantic', () => {
    it('should have state management from DOCore', async () => {
      const storage = getStorage('storage-inherit-1')
      await storage.set('key', 'value')
      expect(await storage.get('key')).toBe('value')
    })

    it('should have semantic operations from DOSemantic', async () => {
      const storage = getStorage('storage-inherit-2')
      const noun = await storage.defineNoun('Item')
      expect(noun.singular).toBe('Item')
    })
  })

  describe('L0: InMemory operations', () => {
    it('should create things in memory', async () => {
      const storage = getStorage('storage-l0-1')
      const thing = await storage.memCreate({ $type: 'Customer', name: 'Alice' })
      expect(thing.$id).toBeDefined()
      // memGet returns synchronously but we're calling via RPC stub, so await
      const retrieved = await storage.memGet(thing.$id)
      expect(retrieved?.name).toBe('Alice')
    })

    it('should track dirty entries', async () => {
      const storage = getStorage('storage-l0-2')
      const thing = await storage.memCreate({ $type: 'Customer', name: 'Bob' })
      expect(await storage.isDirty(thing.$id)).toBe(true)
    })
  })

  describe('L2: SQLite checkpoint', () => {
    it('should checkpoint dirty entries to SQLite', async () => {
      const storage = getStorage('storage-l2-1')
      const thing = await storage.memCreate({ $type: 'Customer', name: 'Charlie' })

      await storage.checkpoint()

      expect(await storage.isDirty(thing.$id)).toBe(false)
    })
  })

  describe('cold start recovery', () => {
    it('should recover state on cold start', async () => {
      const storage = getStorage('storage-recovery-1')

      // Create and checkpoint
      const thing = await storage.memCreate({ $type: 'Customer', name: 'Dave' })
      await storage.checkpoint()

      // Simulate recovery
      const recovered = await storage.recover()
      expect(recovered.thingsLoaded).toBeGreaterThanOrEqual(1)
    })
  })
})

// ============================================================================
// 4. DOWorkflow Tests - Extends DOStorage with WorkflowContext
// ============================================================================

describe('DOWorkflow - Workflow layer', () => {
  function getWorkflow(name = 'test') {
    const id = env.DOWorkflow.idFromName(name)
    return env.DOWorkflow.get(id)
  }

  describe('inherits from DOStorage', () => {
    it('should have state management from DOCore', async () => {
      const workflow = getWorkflow('workflow-inherit-1')
      await workflow.set('key', 'value')
      expect(await workflow.get('key')).toBe('value')
    })

    it('should have semantic operations from DOSemantic', async () => {
      const workflow = getWorkflow('workflow-inherit-2')
      const noun = await workflow.defineNoun('Task')
      expect(noun.singular).toBe('Task')
    })

    it('should have storage operations from DOStorage', async () => {
      const workflow = getWorkflow('workflow-inherit-3')
      const thing = await workflow.memCreate({ $type: 'Task', name: 'Test' })
      expect(thing.$id).toBeDefined()
    })
  })

  describe('WorkflowContext ($)', () => {
    it('should provide $ context', async () => {
      const workflow = getWorkflow('workflow-ctx-1')
      const ctx = await workflow.getContext()
      expect(ctx).toBeDefined()
    })
  })

  describe('event handlers via $.on', () => {
    it('should register event handlers', async () => {
      const workflow = getWorkflow('workflow-event-1')
      const handlerCount = await workflow.registerHandler('Customer.signup', 'handler-1')
      expect(handlerCount).toBe(1)
    })

    it('should dispatch events to handlers', async () => {
      const workflow = getWorkflow('workflow-event-2')
      await workflow.registerHandler('Order.created', 'handler-1')
      const dispatched = await workflow.dispatchEvent('Order.created', { orderId: '123' })
      expect(dispatched).toBe(true)
    })
  })

  describe('scheduling via $.every', () => {
    it('should register scheduled handlers', async () => {
      const workflow = getWorkflow('workflow-schedule-1')
      const cron = await workflow.registerSchedule('Monday', 'at9am', 'handler-1')
      expect(cron).toBe('0 9 * * 1')
    })
  })

  describe('durable execution', () => {
    it('should execute with $.do and retries', async () => {
      const workflow = getWorkflow('workflow-do-1')
      const result = await workflow.doAction('step-1', 'test-action')
      expect(result.status).toBe('completed')
    })

    it('should send fire-and-forget events with $.send', async () => {
      const workflow = getWorkflow('workflow-send-1')
      const eventId = await workflow.sendEvent('Customer.signup', { email: 'test@example.com' })
      expect(eventId).toMatch(/^evt_/)
    })
  })
})

// ============================================================================
// 5. DOFull Tests - Extends DOWorkflow with AI and streaming
// ============================================================================

describe('DOFull - Full featured DO', () => {
  function getFull(name = 'test') {
    const id = env.DOFull.idFromName(name)
    return env.DOFull.get(id)
  }

  describe('inherits from DOWorkflow', () => {
    it('should have state management from DOCore', async () => {
      const full = getFull('full-inherit-1')
      await full.set('key', 'value')
      expect(await full.get('key')).toBe('value')
    })

    it('should have semantic operations from DOSemantic', async () => {
      const full = getFull('full-inherit-2')
      const noun = await full.defineNoun('Document')
      expect(noun.singular).toBe('Document')
    })

    it('should have storage operations from DOStorage', async () => {
      const full = getFull('full-inherit-3')
      const thing = await full.memCreate({ $type: 'Document', title: 'Test' })
      expect(thing.$id).toBeDefined()
    })

    it('should have workflow operations from DOWorkflow', async () => {
      const full = getFull('full-inherit-4')
      const eventId = await full.sendEvent('Document.created', { docId: '123' })
      expect(eventId).toMatch(/^evt_/)
    })
  })

  describe('AI operations', () => {
    it('should provide ai template literal function', async () => {
      const full = getFull('full-ai-1')
      const hasAI = await full.hasAI()
      expect(hasAI).toBe(true)
    })
  })

  describe('cascade execution', () => {
    it('should execute cascade through tiers', async () => {
      const full = getFull('full-cascade-1')
      const result = await full.cascade({
        task: 'test-task',
        tiers: ['code', 'generative'],
      })
      expect(result.tier).toBeDefined()
    })
  })

  describe('streaming', () => {
    it('should support WebSocket connections', async () => {
      const full = getFull('full-stream-1')
      const response = await full.fetch('https://test.local/ws', {
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
        },
      })
      expect(response.status).toBe(101)
    })
  })
})

// ============================================================================
// Class Hierarchy Verification
// ============================================================================

describe('Class Hierarchy', () => {
  it('DOCore is the base class', async () => {
    const core = env.DOCore.get(env.DOCore.idFromName('hierarchy-1'))
    // DOCore should have state, alarms, routing
    expect(typeof core.get).toBe('function')
    expect(typeof core.set).toBe('function')
    expect(typeof core.setAlarm).toBe('function')
    expect(typeof core.fetch).toBe('function')
  })

  it('DOSemantic extends DOCore', async () => {
    const semantic = env.DOSemantic.get(env.DOSemantic.idFromName('hierarchy-2'))
    // Should have DOCore methods
    expect(typeof semantic.get).toBe('function')
    expect(typeof semantic.setAlarm).toBe('function')
    // Should have DOSemantic methods
    expect(typeof semantic.defineNoun).toBe('function')
    expect(typeof semantic.defineVerb).toBe('function')
  })

  it('DOStorage extends DOSemantic', async () => {
    const storage = env.DOStorage.get(env.DOStorage.idFromName('hierarchy-3'))
    // Should have DOCore methods
    expect(typeof storage.get).toBe('function')
    // Should have DOSemantic methods
    expect(typeof storage.defineNoun).toBe('function')
    // Should have DOStorage methods
    expect(typeof storage.memCreate).toBe('function')
    expect(typeof storage.checkpoint).toBe('function')
  })

  it('DOWorkflow extends DOStorage', async () => {
    const workflow = env.DOWorkflow.get(env.DOWorkflow.idFromName('hierarchy-4'))
    // Should have DOCore methods
    expect(typeof workflow.get).toBe('function')
    // Should have DOSemantic methods
    expect(typeof workflow.defineNoun).toBe('function')
    // Should have DOStorage methods
    expect(typeof workflow.memCreate).toBe('function')
    // Should have DOWorkflow methods
    expect(typeof workflow.getContext).toBe('function')
    expect(typeof workflow.sendEvent).toBe('function')
  })

  it('DOFull extends DOWorkflow', async () => {
    const full = env.DOFull.get(env.DOFull.idFromName('hierarchy-5'))
    // Should have DOCore methods
    expect(typeof full.get).toBe('function')
    // Should have DOSemantic methods
    expect(typeof full.defineNoun).toBe('function')
    // Should have DOStorage methods
    expect(typeof full.memCreate).toBe('function')
    // Should have DOWorkflow methods
    expect(typeof full.sendEvent).toBe('function')
    // Should have DOFull methods
    expect(typeof full.hasAI).toBe('function')
    expect(typeof full.cascade).toBe('function')
  })
})
