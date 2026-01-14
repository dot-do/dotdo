/**
 * TriggerRegistry tests - Universal trigger registration and management
 *
 * Tests the trigger registry functionality:
 * - Register triggers (webhook, polling, schedule, event)
 * - Unregister triggers
 * - List triggers by type/status
 * - Get triggers by ID
 * - Enable/disable triggers
 * - Trigger metadata and tags
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  TriggerRegistry,
  createTriggerRegistry,
  type TriggerDefinition,
  type WebhookTrigger,
  type PollingTrigger,
  type EventTrigger,
  type ScheduleTrigger,
  type TriggerType,
  type TriggerFilter,
  TriggerNotFoundError,
  TriggerAlreadyExistsError,
} from '../trigger-registry'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createWebhookTrigger(overrides: Partial<WebhookTrigger> = {}): WebhookTrigger {
  return {
    id: `webhook-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: 'Test Webhook',
    type: 'webhook',
    enabled: true,
    config: {
      path: '/webhooks/test',
      method: 'POST',
      secret: 'test-secret',
    },
    handler: 'handleWebhook',
    metadata: {},
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function createPollingTrigger(overrides: Partial<PollingTrigger> = {}): PollingTrigger {
  return {
    id: `polling-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: 'Test Polling',
    type: 'polling',
    enabled: true,
    config: {
      interval: 60000, // 1 minute
      endpoint: 'https://api.example.com/data',
      headers: { Authorization: 'Bearer token' },
    },
    handler: 'handlePolling',
    metadata: {},
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function createEventTrigger(overrides: Partial<EventTrigger> = {}): EventTrigger {
  return {
    id: `event-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: 'Test Event',
    type: 'event',
    enabled: true,
    config: {
      eventType: 'user.created',
      filter: { source: 'auth' },
    },
    handler: 'handleEvent',
    metadata: {},
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function createScheduleTrigger(overrides: Partial<ScheduleTrigger> = {}): ScheduleTrigger {
  return {
    id: `schedule-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: 'Test Schedule',
    type: 'schedule',
    enabled: true,
    config: {
      cron: '0 9 * * *', // Daily at 9am
      timezone: 'UTC',
    },
    handler: 'handleSchedule',
    metadata: {},
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

// ============================================================================
// REGISTRY CREATION TESTS
// ============================================================================

describe('TriggerRegistry Creation', () => {
  it('should create a registry with factory function', () => {
    const registry = createTriggerRegistry()
    expect(registry).toBeDefined()
    expect(registry.register).toBeDefined()
    expect(registry.unregister).toBeDefined()
    expect(registry.list).toBeDefined()
    expect(registry.get).toBeDefined()
  })

  it('should create an empty registry', async () => {
    const registry = createTriggerRegistry()
    const triggers = await registry.list()
    expect(triggers).toEqual([])
  })
})

// ============================================================================
// REGISTER TRIGGER TESTS
// ============================================================================

describe('TriggerRegistry.register', () => {
  let registry: TriggerRegistry

  beforeEach(() => {
    registry = createTriggerRegistry()
  })

  describe('Webhook Triggers', () => {
    it('should register a webhook trigger', async () => {
      const trigger = createWebhookTrigger({ id: 'webhook-1' })
      const registered = await registry.register(trigger)

      expect(registered.id).toBe('webhook-1')
      expect(registered.type).toBe('webhook')
      expect(registered.name).toBe('Test Webhook')
      expect(registered.enabled).toBe(true)
    })

    it('should store webhook config correctly', async () => {
      const trigger = createWebhookTrigger({
        id: 'webhook-config',
        config: {
          path: '/hooks/stripe',
          method: 'POST',
          secret: 'whsec_xxx',
          headers: { 'X-Custom': 'value' },
        },
      })

      await registry.register(trigger)
      const retrieved = await registry.get('webhook-config')

      expect(retrieved?.config).toEqual({
        path: '/hooks/stripe',
        method: 'POST',
        secret: 'whsec_xxx',
        headers: { 'X-Custom': 'value' },
      })
    })
  })

  describe('Polling Triggers', () => {
    it('should register a polling trigger', async () => {
      const trigger = createPollingTrigger({ id: 'polling-1' })
      const registered = await registry.register(trigger)

      expect(registered.id).toBe('polling-1')
      expect(registered.type).toBe('polling')
    })

    it('should store polling config with interval', async () => {
      const trigger = createPollingTrigger({
        id: 'polling-config',
        config: {
          interval: 300000, // 5 minutes
          endpoint: 'https://api.example.com/status',
          headers: {},
        },
      })

      await registry.register(trigger)
      const retrieved = await registry.get('polling-config')

      expect(retrieved?.config.interval).toBe(300000)
      expect(retrieved?.config.endpoint).toBe('https://api.example.com/status')
    })
  })

  describe('Event Triggers', () => {
    it('should register an event trigger', async () => {
      const trigger = createEventTrigger({ id: 'event-1' })
      const registered = await registry.register(trigger)

      expect(registered.id).toBe('event-1')
      expect(registered.type).toBe('event')
    })

    it('should store event filter configuration', async () => {
      const trigger = createEventTrigger({
        id: 'event-filter',
        config: {
          eventType: 'order.*',
          filter: { status: 'completed', amount: { $gt: 100 } },
        },
      })

      await registry.register(trigger)
      const retrieved = await registry.get('event-filter')

      expect(retrieved?.config.eventType).toBe('order.*')
      expect(retrieved?.config.filter).toEqual({
        status: 'completed',
        amount: { $gt: 100 },
      })
    })
  })

  describe('Schedule Triggers', () => {
    it('should register a schedule trigger', async () => {
      const trigger = createScheduleTrigger({ id: 'schedule-1' })
      const registered = await registry.register(trigger)

      expect(registered.id).toBe('schedule-1')
      expect(registered.type).toBe('schedule')
    })

    it('should store cron expression and timezone', async () => {
      const trigger = createScheduleTrigger({
        id: 'schedule-cron',
        config: {
          cron: '*/15 * * * *', // Every 15 minutes
          timezone: 'America/New_York',
        },
      })

      await registry.register(trigger)
      const retrieved = await registry.get('schedule-cron')

      expect(retrieved?.config.cron).toBe('*/15 * * * *')
      expect(retrieved?.config.timezone).toBe('America/New_York')
    })
  })

  describe('Registration Errors', () => {
    it('should throw if trigger with same ID already exists', async () => {
      const trigger1 = createWebhookTrigger({ id: 'duplicate-id' })
      const trigger2 = createPollingTrigger({ id: 'duplicate-id' })

      await registry.register(trigger1)

      await expect(registry.register(trigger2)).rejects.toThrow(TriggerAlreadyExistsError)
    })

    it('should allow registering triggers with different IDs', async () => {
      const trigger1 = createWebhookTrigger({ id: 'unique-1' })
      const trigger2 = createWebhookTrigger({ id: 'unique-2' })

      await registry.register(trigger1)
      await registry.register(trigger2)

      const triggers = await registry.list()
      expect(triggers).toHaveLength(2)
    })
  })

  describe('Metadata and Tags', () => {
    it('should store metadata', async () => {
      const trigger = createWebhookTrigger({
        id: 'with-metadata',
        metadata: {
          source: 'stripe',
          version: '2023-10-16',
          customField: { nested: 'value' },
        },
      })

      await registry.register(trigger)
      const retrieved = await registry.get('with-metadata')

      expect(retrieved?.metadata).toEqual({
        source: 'stripe',
        version: '2023-10-16',
        customField: { nested: 'value' },
      })
    })

    it('should store tags', async () => {
      const trigger = createWebhookTrigger({
        id: 'with-tags',
        tags: ['payment', 'stripe', 'production'],
      })

      await registry.register(trigger)
      const retrieved = await registry.get('with-tags')

      expect(retrieved?.tags).toEqual(['payment', 'stripe', 'production'])
    })
  })

  describe('Timestamps', () => {
    it('should set createdAt on registration', async () => {
      const before = Date.now()
      const trigger = createWebhookTrigger({ id: 'timestamp-test' })
      delete (trigger as any).createdAt
      delete (trigger as any).updatedAt

      const registered = await registry.register(trigger)
      const after = Date.now()

      expect(registered.createdAt).toBeGreaterThanOrEqual(before)
      expect(registered.createdAt).toBeLessThanOrEqual(after)
    })

    it('should set updatedAt on registration', async () => {
      const before = Date.now()
      const trigger = createWebhookTrigger({ id: 'updated-test' })
      delete (trigger as any).createdAt
      delete (trigger as any).updatedAt

      const registered = await registry.register(trigger)
      const after = Date.now()

      expect(registered.updatedAt).toBeGreaterThanOrEqual(before)
      expect(registered.updatedAt).toBeLessThanOrEqual(after)
    })
  })
})

// ============================================================================
// UNREGISTER TRIGGER TESTS
// ============================================================================

describe('TriggerRegistry.unregister', () => {
  let registry: TriggerRegistry

  beforeEach(() => {
    registry = createTriggerRegistry()
  })

  it('should unregister an existing trigger', async () => {
    const trigger = createWebhookTrigger({ id: 'to-unregister' })
    await registry.register(trigger)

    await registry.unregister('to-unregister')

    const triggers = await registry.list()
    expect(triggers).toHaveLength(0)
  })

  it('should throw when unregistering non-existent trigger', async () => {
    await expect(registry.unregister('non-existent')).rejects.toThrow(TriggerNotFoundError)
  })

  it('should return the unregistered trigger', async () => {
    const trigger = createWebhookTrigger({ id: 'return-unregister' })
    await registry.register(trigger)

    const unregistered = await registry.unregister('return-unregister')

    expect(unregistered.id).toBe('return-unregister')
  })

  it('should allow re-registering after unregister', async () => {
    const trigger = createWebhookTrigger({ id: 're-register' })
    await registry.register(trigger)
    await registry.unregister('re-register')

    const newTrigger = createPollingTrigger({ id: 're-register' })
    const registered = await registry.register(newTrigger)

    expect(registered.type).toBe('polling')
  })
})

// ============================================================================
// GET TRIGGER TESTS
// ============================================================================

describe('TriggerRegistry.get', () => {
  let registry: TriggerRegistry

  beforeEach(() => {
    registry = createTriggerRegistry()
  })

  it('should get a trigger by ID', async () => {
    const trigger = createWebhookTrigger({ id: 'get-test' })
    await registry.register(trigger)

    const retrieved = await registry.get('get-test')

    expect(retrieved).toBeDefined()
    expect(retrieved?.id).toBe('get-test')
  })

  it('should return undefined for non-existent ID', async () => {
    const retrieved = await registry.get('does-not-exist')
    expect(retrieved).toBeUndefined()
  })

  it('should return the full trigger definition', async () => {
    const trigger = createWebhookTrigger({
      id: 'full-trigger',
      name: 'Full Webhook',
      enabled: false,
      config: { path: '/test', method: 'POST', secret: 'secret' },
      handler: 'myHandler',
      metadata: { key: 'value' },
      tags: ['test'],
    })
    await registry.register(trigger)

    const retrieved = await registry.get('full-trigger')

    expect(retrieved?.name).toBe('Full Webhook')
    expect(retrieved?.enabled).toBe(false)
    expect(retrieved?.handler).toBe('myHandler')
  })
})

// ============================================================================
// LIST TRIGGERS TESTS
// ============================================================================

describe('TriggerRegistry.list', () => {
  let registry: TriggerRegistry

  beforeEach(async () => {
    registry = createTriggerRegistry()

    // Register various triggers for testing
    await registry.register(createWebhookTrigger({ id: 'webhook-1', tags: ['payment'] }))
    await registry.register(createWebhookTrigger({ id: 'webhook-2', enabled: false, tags: ['auth'] }))
    await registry.register(createPollingTrigger({ id: 'polling-1', tags: ['monitoring'] }))
    await registry.register(createEventTrigger({ id: 'event-1', tags: ['payment'] }))
    await registry.register(createScheduleTrigger({ id: 'schedule-1', enabled: false }))
  })

  describe('Without Filter', () => {
    it('should list all triggers', async () => {
      const triggers = await registry.list()
      expect(triggers).toHaveLength(5)
    })

    it('should return triggers with all properties', async () => {
      const triggers = await registry.list()
      for (const trigger of triggers) {
        expect(trigger.id).toBeDefined()
        expect(trigger.name).toBeDefined()
        expect(trigger.type).toBeDefined()
        expect(trigger.enabled).toBeDefined()
        expect(trigger.config).toBeDefined()
        expect(trigger.handler).toBeDefined()
      }
    })
  })

  describe('Filter by Type', () => {
    it('should filter by webhook type', async () => {
      const triggers = await registry.list({ type: 'webhook' })
      expect(triggers).toHaveLength(2)
      expect(triggers.every((t) => t.type === 'webhook')).toBe(true)
    })

    it('should filter by polling type', async () => {
      const triggers = await registry.list({ type: 'polling' })
      expect(triggers).toHaveLength(1)
      expect(triggers[0].type).toBe('polling')
    })

    it('should filter by event type', async () => {
      const triggers = await registry.list({ type: 'event' })
      expect(triggers).toHaveLength(1)
      expect(triggers[0].type).toBe('event')
    })

    it('should filter by schedule type', async () => {
      const triggers = await registry.list({ type: 'schedule' })
      expect(triggers).toHaveLength(1)
      expect(triggers[0].type).toBe('schedule')
    })
  })

  describe('Filter by Enabled Status', () => {
    it('should filter enabled triggers', async () => {
      const triggers = await registry.list({ enabled: true })
      expect(triggers).toHaveLength(3)
      expect(triggers.every((t) => t.enabled)).toBe(true)
    })

    it('should filter disabled triggers', async () => {
      const triggers = await registry.list({ enabled: false })
      expect(triggers).toHaveLength(2)
      expect(triggers.every((t) => !t.enabled)).toBe(true)
    })
  })

  describe('Filter by Tags', () => {
    it('should filter by single tag', async () => {
      const triggers = await registry.list({ tags: ['payment'] })
      expect(triggers).toHaveLength(2)
    })

    it('should filter by multiple tags (OR logic)', async () => {
      const triggers = await registry.list({ tags: ['payment', 'monitoring'] })
      expect(triggers).toHaveLength(3)
    })

    it('should return empty array for non-matching tags', async () => {
      const triggers = await registry.list({ tags: ['nonexistent'] })
      expect(triggers).toHaveLength(0)
    })
  })

  describe('Combined Filters', () => {
    it('should filter by type and enabled', async () => {
      const triggers = await registry.list({ type: 'webhook', enabled: true })
      expect(triggers).toHaveLength(1)
      expect(triggers[0].id).toBe('webhook-1')
    })

    it('should filter by type and tags', async () => {
      const triggers = await registry.list({ type: 'webhook', tags: ['payment'] })
      expect(triggers).toHaveLength(1)
      expect(triggers[0].id).toBe('webhook-1')
    })

    it('should filter by all criteria', async () => {
      const triggers = await registry.list({
        type: 'webhook',
        enabled: true,
        tags: ['payment'],
      })
      expect(triggers).toHaveLength(1)
    })
  })
})

// ============================================================================
// ENABLE/DISABLE TESTS
// ============================================================================

describe('TriggerRegistry Enable/Disable', () => {
  let registry: TriggerRegistry

  beforeEach(() => {
    registry = createTriggerRegistry()
  })

  it('should enable a disabled trigger', async () => {
    const trigger = createWebhookTrigger({ id: 'enable-test', enabled: false })
    await registry.register(trigger)

    await registry.enable('enable-test')

    const retrieved = await registry.get('enable-test')
    expect(retrieved?.enabled).toBe(true)
  })

  it('should disable an enabled trigger', async () => {
    const trigger = createWebhookTrigger({ id: 'disable-test', enabled: true })
    await registry.register(trigger)

    await registry.disable('disable-test')

    const retrieved = await registry.get('disable-test')
    expect(retrieved?.enabled).toBe(false)
  })

  it('should throw when enabling non-existent trigger', async () => {
    await expect(registry.enable('non-existent')).rejects.toThrow(TriggerNotFoundError)
  })

  it('should throw when disabling non-existent trigger', async () => {
    await expect(registry.disable('non-existent')).rejects.toThrow(TriggerNotFoundError)
  })

  it('should update updatedAt when enabling', async () => {
    const trigger = createWebhookTrigger({
      id: 'enable-timestamp',
      enabled: false,
      updatedAt: 1000,
    })
    await registry.register(trigger)

    const before = Date.now()
    await registry.enable('enable-timestamp')
    const after = Date.now()

    const retrieved = await registry.get('enable-timestamp')
    expect(retrieved?.updatedAt).toBeGreaterThanOrEqual(before)
    expect(retrieved?.updatedAt).toBeLessThanOrEqual(after)
  })

  it('should update updatedAt when disabling', async () => {
    const trigger = createWebhookTrigger({
      id: 'disable-timestamp',
      enabled: true,
      updatedAt: 1000,
    })
    await registry.register(trigger)

    const before = Date.now()
    await registry.disable('disable-timestamp')
    const after = Date.now()

    const retrieved = await registry.get('disable-timestamp')
    expect(retrieved?.updatedAt).toBeGreaterThanOrEqual(before)
    expect(retrieved?.updatedAt).toBeLessThanOrEqual(after)
  })
})

// ============================================================================
// UPDATE TRIGGER TESTS
// ============================================================================

describe('TriggerRegistry.update', () => {
  let registry: TriggerRegistry

  beforeEach(() => {
    registry = createTriggerRegistry()
  })

  it('should update trigger name', async () => {
    const trigger = createWebhookTrigger({ id: 'update-name', name: 'Original' })
    await registry.register(trigger)

    await registry.update('update-name', { name: 'Updated' })

    const retrieved = await registry.get('update-name')
    expect(retrieved?.name).toBe('Updated')
  })

  it('should update trigger config', async () => {
    const trigger = createWebhookTrigger({
      id: 'update-config',
      config: { path: '/old', method: 'POST', secret: 'old' },
    })
    await registry.register(trigger)

    await registry.update('update-config', {
      config: { path: '/new', method: 'PUT', secret: 'new' },
    })

    const retrieved = await registry.get('update-config')
    expect(retrieved?.config.path).toBe('/new')
    expect(retrieved?.config.method).toBe('PUT')
  })

  it('should update handler reference', async () => {
    const trigger = createWebhookTrigger({ id: 'update-handler', handler: 'oldHandler' })
    await registry.register(trigger)

    await registry.update('update-handler', { handler: 'newHandler' })

    const retrieved = await registry.get('update-handler')
    expect(retrieved?.handler).toBe('newHandler')
  })

  it('should update metadata', async () => {
    const trigger = createWebhookTrigger({
      id: 'update-metadata',
      metadata: { old: 'value' },
    })
    await registry.register(trigger)

    await registry.update('update-metadata', { metadata: { new: 'data' } })

    const retrieved = await registry.get('update-metadata')
    expect(retrieved?.metadata).toEqual({ new: 'data' })
  })

  it('should update tags', async () => {
    const trigger = createWebhookTrigger({
      id: 'update-tags',
      tags: ['old'],
    })
    await registry.register(trigger)

    await registry.update('update-tags', { tags: ['new', 'tags'] })

    const retrieved = await registry.get('update-tags')
    expect(retrieved?.tags).toEqual(['new', 'tags'])
  })

  it('should throw when updating non-existent trigger', async () => {
    await expect(registry.update('non-existent', { name: 'New' })).rejects.toThrow(
      TriggerNotFoundError
    )
  })

  it('should update updatedAt timestamp', async () => {
    const trigger = createWebhookTrigger({ id: 'update-timestamp', updatedAt: 1000 })
    await registry.register(trigger)

    const before = Date.now()
    await registry.update('update-timestamp', { name: 'Updated' })
    const after = Date.now()

    const retrieved = await registry.get('update-timestamp')
    expect(retrieved?.updatedAt).toBeGreaterThanOrEqual(before)
    expect(retrieved?.updatedAt).toBeLessThanOrEqual(after)
  })

  it('should preserve fields not being updated', async () => {
    const trigger = createWebhookTrigger({
      id: 'partial-update',
      name: 'Original',
      handler: 'originalHandler',
      tags: ['original'],
    })
    await registry.register(trigger)

    await registry.update('partial-update', { name: 'Updated' })

    const retrieved = await registry.get('partial-update')
    expect(retrieved?.name).toBe('Updated')
    expect(retrieved?.handler).toBe('originalHandler')
    expect(retrieved?.tags).toEqual(['original'])
  })
})

// ============================================================================
// COUNT AND STATS TESTS
// ============================================================================

describe('TriggerRegistry Stats', () => {
  let registry: TriggerRegistry

  beforeEach(async () => {
    registry = createTriggerRegistry()

    await registry.register(createWebhookTrigger({ id: 'w1', enabled: true }))
    await registry.register(createWebhookTrigger({ id: 'w2', enabled: false }))
    await registry.register(createPollingTrigger({ id: 'p1', enabled: true }))
    await registry.register(createEventTrigger({ id: 'e1', enabled: true }))
    await registry.register(createScheduleTrigger({ id: 's1', enabled: false }))
  })

  it('should count total triggers', async () => {
    const count = await registry.count()
    expect(count).toBe(5)
  })

  it('should count triggers by type', async () => {
    expect(await registry.count({ type: 'webhook' })).toBe(2)
    expect(await registry.count({ type: 'polling' })).toBe(1)
    expect(await registry.count({ type: 'event' })).toBe(1)
    expect(await registry.count({ type: 'schedule' })).toBe(1)
  })

  it('should count enabled triggers', async () => {
    expect(await registry.count({ enabled: true })).toBe(3)
  })

  it('should count disabled triggers', async () => {
    expect(await registry.count({ enabled: false })).toBe(2)
  })

  it('should get stats summary', async () => {
    const stats = await registry.stats()

    expect(stats.total).toBe(5)
    expect(stats.enabled).toBe(3)
    expect(stats.disabled).toBe(2)
    expect(stats.byType.webhook).toBe(2)
    expect(stats.byType.polling).toBe(1)
    expect(stats.byType.event).toBe(1)
    expect(stats.byType.schedule).toBe(1)
  })
})

// ============================================================================
// CLEAR REGISTRY TESTS
// ============================================================================

describe('TriggerRegistry.clear', () => {
  let registry: TriggerRegistry

  beforeEach(async () => {
    registry = createTriggerRegistry()

    await registry.register(createWebhookTrigger({ id: 'w1' }))
    await registry.register(createPollingTrigger({ id: 'p1' }))
  })

  it('should clear all triggers', async () => {
    await registry.clear()

    const triggers = await registry.list()
    expect(triggers).toHaveLength(0)
  })

  it('should allow registering after clear', async () => {
    await registry.clear()

    await registry.register(createWebhookTrigger({ id: 'new' }))

    const triggers = await registry.list()
    expect(triggers).toHaveLength(1)
  })
})

// ============================================================================
// WEBHOOK URL GENERATION TESTS
// ============================================================================

describe('TriggerRegistry Webhook URLs', () => {
  let registry: TriggerRegistry

  beforeEach(() => {
    registry = createTriggerRegistry({ baseUrl: 'https://api.example.com' })
  })

  it('should generate webhook URL for webhook trigger', async () => {
    const trigger = createWebhookTrigger({
      id: 'webhook-url-test',
      config: { path: '/webhooks/stripe', method: 'POST', secret: 'xxx' },
    })
    await registry.register(trigger)

    const url = await registry.getWebhookUrl('webhook-url-test')
    expect(url).toBe('https://api.example.com/webhooks/stripe')
  })

  it('should return undefined for non-webhook triggers', async () => {
    const trigger = createPollingTrigger({ id: 'polling-url-test' })
    await registry.register(trigger)

    const url = await registry.getWebhookUrl('polling-url-test')
    expect(url).toBeUndefined()
  })

  it('should throw for non-existent trigger', async () => {
    await expect(registry.getWebhookUrl('non-existent')).rejects.toThrow(TriggerNotFoundError)
  })
})

// ============================================================================
// TYPE GUARDS AND VALIDATION TESTS
// ============================================================================

describe('Trigger Type Guards', () => {
  let registry: TriggerRegistry

  beforeEach(() => {
    registry = createTriggerRegistry()
  })

  it('should validate webhook trigger type', async () => {
    const trigger = createWebhookTrigger({ id: 'type-guard-webhook' })
    await registry.register(trigger)

    const retrieved = await registry.get('type-guard-webhook')
    expect(retrieved?.type).toBe('webhook')
    expect((retrieved as WebhookTrigger).config.path).toBeDefined()
  })

  it('should validate polling trigger type', async () => {
    const trigger = createPollingTrigger({ id: 'type-guard-polling' })
    await registry.register(trigger)

    const retrieved = await registry.get('type-guard-polling')
    expect(retrieved?.type).toBe('polling')
    expect((retrieved as PollingTrigger).config.interval).toBeDefined()
  })

  it('should validate event trigger type', async () => {
    const trigger = createEventTrigger({ id: 'type-guard-event' })
    await registry.register(trigger)

    const retrieved = await registry.get('type-guard-event')
    expect(retrieved?.type).toBe('event')
    expect((retrieved as EventTrigger).config.eventType).toBeDefined()
  })

  it('should validate schedule trigger type', async () => {
    const trigger = createScheduleTrigger({ id: 'type-guard-schedule' })
    await registry.register(trigger)

    const retrieved = await registry.get('type-guard-schedule')
    expect(retrieved?.type).toBe('schedule')
    expect((retrieved as ScheduleTrigger).config.cron).toBeDefined()
  })
})

// ============================================================================
// STORAGE PERSISTENCE TESTS (with mock storage)
// ============================================================================

describe('TriggerRegistry Storage', () => {
  it('should work with in-memory storage by default', async () => {
    const registry = createTriggerRegistry()

    await registry.register(createWebhookTrigger({ id: 'mem-1' }))
    await registry.register(createPollingTrigger({ id: 'mem-2' }))

    const triggers = await registry.list()
    expect(triggers).toHaveLength(2)
  })

  it('should support custom storage adapter', async () => {
    const storage = new Map<string, TriggerDefinition>()

    const registry = createTriggerRegistry({
      storage: {
        get: async (id) => storage.get(id),
        set: async (id, trigger) => {
          storage.set(id, trigger)
        },
        delete: async (id) => storage.delete(id),
        list: async () => Array.from(storage.values()),
        clear: async () => storage.clear(),
      },
    })

    await registry.register(createWebhookTrigger({ id: 'custom-1' }))

    expect(storage.has('custom-1')).toBe(true)
    expect(storage.get('custom-1')?.id).toBe('custom-1')
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('TriggerRegistry Edge Cases', () => {
  let registry: TriggerRegistry

  beforeEach(() => {
    registry = createTriggerRegistry()
  })

  it('should handle empty tags array', async () => {
    const trigger = createWebhookTrigger({ id: 'empty-tags', tags: [] })
    await registry.register(trigger)

    const retrieved = await registry.get('empty-tags')
    expect(retrieved?.tags).toEqual([])
  })

  it('should handle empty metadata object', async () => {
    const trigger = createWebhookTrigger({ id: 'empty-metadata', metadata: {} })
    await registry.register(trigger)

    const retrieved = await registry.get('empty-metadata')
    expect(retrieved?.metadata).toEqual({})
  })

  it('should handle special characters in ID', async () => {
    const trigger = createWebhookTrigger({ id: 'webhook:stripe/payments_v2' })
    await registry.register(trigger)

    const retrieved = await registry.get('webhook:stripe/payments_v2')
    expect(retrieved?.id).toBe('webhook:stripe/payments_v2')
  })

  it('should handle long handler function references', async () => {
    const handler = 'handlers.webhooks.stripe.payments.handlePaymentIntent'
    const trigger = createWebhookTrigger({ id: 'long-handler', handler })
    await registry.register(trigger)

    const retrieved = await registry.get('long-handler')
    expect(retrieved?.handler).toBe(handler)
  })

  it('should handle complex nested config', async () => {
    const trigger = createWebhookTrigger({
      id: 'complex-config',
      config: {
        path: '/webhooks/complex',
        method: 'POST',
        secret: 'secret',
        headers: {
          'X-Custom-Header': 'value',
          'X-Another': 'another-value',
        },
        validation: {
          signatureHeader: 'X-Signature',
          algorithm: 'sha256',
          encoding: 'hex' as const,
        },
      } as any,
    })
    await registry.register(trigger)

    const retrieved = await registry.get('complex-config')
    expect((retrieved?.config as any).validation?.algorithm).toBe('sha256')
  })
})
