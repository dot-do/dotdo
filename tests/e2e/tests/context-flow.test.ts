/**
 * E2E Tests: $ Context Full Flow - RED Phase
 *
 * These tests verify the FULL flow of $Context operations from client
 * through tenant DOs to parent DOs. This is comprehensive end-to-end
 * testing of the hierarchical DO architecture:
 *
 * - Client creates $Context to tenant: https://crm.example.com.ai/acme
 * - Tenant DO handles CRUD operations
 * - Events automatically stream from tenant to parent (example.com.ai)
 * - Parent DO aggregates events and provides global search
 *
 * IMPORTANT: These tests are designed to FAIL because the full integration
 * is not yet implemented. This is the RED phase of TDD.
 *
 * Test Categories:
 * 1. Client -> Tenant DO connection
 * 2. Tenant CRUD operations via $Context
 * 3. Event streaming from Tenant -> Parent
 * 4. Global search from Parent across Tenants
 * 5. Multi-tenant isolation
 * 6. WebSocket event subscriptions across hierarchy
 * 7. Error handling and edge cases
 *
 * @module tests/e2e/tests/context-flow.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Import $Context from @dotdo/do (client implementation)
// Using relative import for E2E tests which run in node environment
import { $Context } from '../../../do/client'
import type {
  ClientContext,
  Thing,
  ListResult,
  EventPayload,
} from '../../../do/client'

// ============================================================================
// Type Definitions for E2E Testing
// ============================================================================

/**
 * Extended context interface for parent DO with global capabilities
 */
interface ParentContext extends ClientContext {
  query: {
    global: <T = Thing>(options: {
      $type?: string
      filters?: Record<string, unknown>
      limit?: number
      offset?: number
    }) => Promise<ListResult<T>>
  }
  children: {
    list: () => Promise<Array<{ id: string; name: string; lastSeen: number }>>
    count: () => Promise<number>
  }
}

/**
 * Tenant context with parent reference
 */
interface TenantContext extends ClientContext {
  $context: {
    $id: string
    emit: (event: { $type: string; payload: unknown }) => Promise<void>
  }
}

// ============================================================================
// Test Configuration
// ============================================================================

const TENANT_URL = 'https://crm.example.com.ai/acme'
const PARENT_URL = 'https://example.com.ai'
const ALT_TENANT_URL = 'https://crm.example.com.ai/bigcorp'

// Test timeouts
const CONNECTION_TIMEOUT = 5000
const EVENT_TIMEOUT = 10000

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Wait for a condition with timeout
 */
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await condition()) return
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`Condition not met within ${timeout}ms`)
}

/**
 * Generate unique test ID
 */
function testId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// TEST SUITE 1: Client -> Tenant DO Connection
// ============================================================================

describe('E2E: $Context Client -> Tenant Connection', () => {
  let $: ClientContext

  afterEach(async () => {
    if ($ && $.isConnected()) {
      await $.disconnect()
    }
  })

  it('should connect to tenant DO via $Context', async () => {
    // This test will FAIL because the full tenant DO is not implemented
    $ = $Context(TENANT_URL)

    expect($).toBeDefined()
    expect(typeof $).toBe('object')
  })

  it('should establish WebSocket connection to tenant', async () => {
    $ = $Context(TENANT_URL)

    await $.connect()

    expect($.isConnected()).toBe(true)
  })

  it('should parse tenant namespace from URL path', async () => {
    $ = $Context(TENANT_URL)

    expect($._namespace).toBe('acme')
  })

  it('should parse subdomain from URL', async () => {
    $ = $Context(TENANT_URL)

    expect($._tenant).toBe('crm')
  })

  it('should support authentication token', async () => {
    $ = $Context(TENANT_URL, {
      token: 'test-bearer-token',
    })

    expect($._options.token).toBe('test-bearer-token')
  })

  it('should support custom headers', async () => {
    $ = $Context(TENANT_URL, {
      headers: {
        'X-Tenant-ID': 'acme',
        'X-Correlation-ID': 'req-123',
      },
    })

    expect($._options.headers).toEqual({
      'X-Tenant-ID': 'acme',
      'X-Correlation-ID': 'req-123',
    })
  })

  it('should create unique contexts for different tenants', async () => {
    const $acme = $Context(TENANT_URL)
    const $bigcorp = $Context(ALT_TENANT_URL)

    expect($acme._namespace).toBe('acme')
    expect($bigcorp._namespace).toBe('bigcorp')
    expect($acme._namespace).not.toBe($bigcorp._namespace)
  })
})

// ============================================================================
// TEST SUITE 2: Tenant CRUD Operations via $Context
// ============================================================================

describe('E2E: $Context Tenant CRUD Operations', () => {
  let $: ClientContext

  beforeEach(() => {
    $ = $Context(TENANT_URL)
  })

  afterEach(async () => {
    if ($.isConnected()) {
      await $.disconnect()
    }
  })

  describe('$.things.create()', () => {
    it('should create a thing in tenant DO', async () => {
      // This test will FAIL because tenant DO doesn't implement things store yet
      const customer = await $.things.create({
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
      })

      expect(customer.$id).toBeDefined()
      expect(customer.$type).toBe('Customer')
      expect(customer.name).toBe('Alice')
      expect(customer.email).toBe('alice@example.com')
      expect(customer.$createdAt).toBeDefined()
    })

    it('should auto-generate unique $id', async () => {
      const c1 = await $.things.create({ $type: 'Customer', name: 'Alice' })
      const c2 = await $.things.create({ $type: 'Customer', name: 'Bob' })

      expect(c1.$id).not.toBe(c2.$id)
    })

    it('should validate $type is required', async () => {
      // @ts-expect-error - Testing runtime validation
      await expect($.things.create({ name: 'Alice' })).rejects.toThrow()
    })
  })

  describe('$.things.get()', () => {
    it('should get a thing by ID', async () => {
      const created = await $.things.create({
        $type: 'Customer',
        name: 'Bob',
      })

      const retrieved = await $.things.get(created.$id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.$id).toBe(created.$id)
      expect(retrieved!.name).toBe('Bob')
    })

    it('should return null for non-existent ID', async () => {
      const result = await $.things.get('nonexistent-id-12345')

      expect(result).toBeNull()
    })
  })

  describe('$.things.list()', () => {
    it('should list things by type', async () => {
      const id = testId()
      await $.things.create({ $type: 'Lead', name: `Lead 1 ${id}` })
      await $.things.create({ $type: 'Lead', name: `Lead 2 ${id}` })
      await $.things.create({ $type: 'Customer', name: `Customer ${id}` })

      const leads = await $.things.list({ $type: 'Lead' })

      expect(leads.items.length).toBeGreaterThanOrEqual(2)
      expect(leads.items.every((l) => l.$type === 'Lead')).toBe(true)
    })

    it('should support pagination', async () => {
      const id = testId()
      for (let i = 0; i < 5; i++) {
        await $.things.create({ $type: 'Contact', name: `Contact ${i} ${id}` })
      }

      const page1 = await $.things.list({ $type: 'Contact', limit: 2, offset: 0 })
      const page2 = await $.things.list({ $type: 'Contact', limit: 2, offset: 2 })

      expect(page1.items.length).toBe(2)
      expect(page2.items.length).toBe(2)
    })

    it('should support filtering', async () => {
      const id = testId()
      await $.things.create({ $type: 'Lead', name: `Active ${id}`, status: 'active' })
      await $.things.create({ $type: 'Lead', name: `Inactive ${id}`, status: 'inactive' })

      const activeLeads = await $.things.list({
        $type: 'Lead',
        where: { status: 'active' },
      })

      expect(activeLeads.items.every((l) => l.status === 'active')).toBe(true)
    })
  })

  describe('$.things.update()', () => {
    it('should update a thing by ID', async () => {
      const created = await $.things.create({
        $type: 'Customer',
        name: 'Charlie',
        status: 'new',
      })

      const updated = await $.things.update(created.$id, {
        status: 'qualified',
      })

      expect(updated.status).toBe('qualified')
      expect(updated.$updatedAt).toBeDefined()
    })

    it('should throw when updating non-existent thing', async () => {
      await expect(
        $.things.update('nonexistent-id-12345', { name: 'Test' })
      ).rejects.toThrow()
    })
  })

  describe('$.things.delete()', () => {
    it('should delete a thing by ID', async () => {
      const created = await $.things.create({
        $type: 'Customer',
        name: 'Diana',
      })

      const result = await $.things.delete(created.$id)
      expect(result.deleted).toBe(true)

      const retrieved = await $.things.get(created.$id)
      expect(retrieved).toBeNull()
    })

    it('should return false for non-existent thing', async () => {
      const result = await $.things.delete('nonexistent-id-12345')
      expect(result.deleted).toBe(false)
    })
  })
})

// ============================================================================
// TEST SUITE 3: Event Streaming from Tenant -> Parent
// ============================================================================

describe('E2E: Event Streaming Tenant -> Parent', () => {
  let tenant$: TenantContext
  let parent$: ParentContext

  beforeEach(() => {
    tenant$ = $Context(TENANT_URL) as TenantContext
    parent$ = $Context(PARENT_URL) as ParentContext
  })

  afterEach(async () => {
    if (tenant$.isConnected()) await tenant$.disconnect()
    if (parent$.isConnected()) await parent$.disconnect()
  })

  it('should emit events from tenant to parent via $context.emit()', async () => {
    // This test will FAIL because $context.emit is not implemented
    await parent$.connect()

    const receivedEvents: EventPayload[] = []
    parent$.on['*']['*']((event) => {
      receivedEvents.push(event)
    })

    // Wait for subscription to be established
    await new Promise((r) => setTimeout(r, 100))

    // Emit event from tenant's $context to parent
    await tenant$.$context.emit({
      $type: 'Tenant.activated',
      payload: { tenantId: 'acme', timestamp: Date.now() },
    })

    // Wait for event propagation
    await waitFor(() => receivedEvents.length > 0, EVENT_TIMEOUT)

    expect(receivedEvents.length).toBeGreaterThan(0)
    expect(receivedEvents[0].type).toBe('Tenant.activated')
  })

  it('should automatically stream CRUD events to parent', async () => {
    // When a thing is created in tenant, parent should receive the event
    await parent$.connect()

    const receivedEvents: EventPayload[] = []
    parent$.on['*']['*']((event) => {
      receivedEvents.push(event)
    })

    await new Promise((r) => setTimeout(r, 100))

    // Create thing in tenant - should auto-stream to parent
    await tenant$.things.create({
      $type: 'Lead',
      name: 'Auto-stream Test',
    })

    await waitFor(() => receivedEvents.length > 0, EVENT_TIMEOUT)

    expect(receivedEvents.length).toBeGreaterThan(0)
    // Event should indicate source tenant
    const leadEvent = receivedEvents.find((e) => e.type.includes('Lead'))
    expect(leadEvent).toBeDefined()
  })

  it('should include tenant metadata in streamed events', async () => {
    await parent$.connect()

    const receivedEvents: EventPayload[] = []
    parent$.on['*']['*']((event) => {
      receivedEvents.push(event)
    })

    await new Promise((r) => setTimeout(r, 100))

    await tenant$.events.emit({
      type: 'Order.placed',
      payload: { orderId: 'ord-123', total: 99.99 },
    })

    await waitFor(() => receivedEvents.length > 0, EVENT_TIMEOUT)

    const event = receivedEvents[0]
    expect(event).toBeDefined()
    // Event should include tenant info
    expect((event.payload as Record<string, unknown>).tenantId || event.$id).toBeDefined()
  })

  it('should support specific event type subscriptions on parent', async () => {
    await parent$.connect()

    const customerEvents: EventPayload[] = []
    parent$.on.Customer.created((event) => {
      customerEvents.push(event)
    })

    await new Promise((r) => setTimeout(r, 100))

    // Create customer in tenant
    await tenant$.things.create({
      $type: 'Customer',
      name: 'Event Filter Test',
    })

    // Create lead in tenant (should NOT trigger Customer.created)
    await tenant$.things.create({
      $type: 'Lead',
      name: 'Not a Customer',
    })

    await waitFor(() => customerEvents.length > 0, EVENT_TIMEOUT)

    // Should only have Customer events
    expect(customerEvents.every((e) => e.type.includes('Customer'))).toBe(true)
  })
})

// ============================================================================
// TEST SUITE 4: Global Search from Parent across Tenants
// ============================================================================

describe('E2E: Global Search from Parent', () => {
  let parent$: ParentContext
  let tenant1$: TenantContext
  let tenant2$: TenantContext

  beforeEach(() => {
    parent$ = $Context(PARENT_URL) as ParentContext
    tenant1$ = $Context(TENANT_URL) as TenantContext
    tenant2$ = $Context(ALT_TENANT_URL) as TenantContext
  })

  afterEach(async () => {
    if (parent$.isConnected()) await parent$.disconnect()
    if (tenant1$.isConnected()) await tenant1$.disconnect()
    if (tenant2$.isConnected()) await tenant2$.disconnect()
  })

  it('should support global search from parent across all tenants', async () => {
    // This test will FAIL because parent$.query.global is not implemented
    const uniqueTag = testId('global-search')

    // Create customers in both tenants
    await tenant1$.things.create({
      $type: 'Customer',
      name: `Acme Customer ${uniqueTag}`,
      tag: uniqueTag,
    })

    await tenant2$.things.create({
      $type: 'Customer',
      name: `BigCorp Customer ${uniqueTag}`,
      tag: uniqueTag,
    })

    // Global search from parent should find both
    const results = await parent$.query.global({
      $type: 'Customer',
      filters: { tag: uniqueTag },
    })

    expect(results.items.length).toBeGreaterThanOrEqual(2)
  })

  it('should support pagination in global search', async () => {
    const uniqueTag = testId('pagination')

    // Create multiple customers across tenants
    for (let i = 0; i < 3; i++) {
      await tenant1$.things.create({
        $type: 'Customer',
        name: `T1 Customer ${i} ${uniqueTag}`,
        tag: uniqueTag,
      })
    }
    for (let i = 0; i < 3; i++) {
      await tenant2$.things.create({
        $type: 'Customer',
        name: `T2 Customer ${i} ${uniqueTag}`,
        tag: uniqueTag,
      })
    }

    const page1 = await parent$.query.global({
      $type: 'Customer',
      filters: { tag: uniqueTag },
      limit: 2,
      offset: 0,
    })

    const page2 = await parent$.query.global({
      $type: 'Customer',
      filters: { tag: uniqueTag },
      limit: 2,
      offset: 2,
    })

    expect(page1.items.length).toBe(2)
    expect(page2.items.length).toBe(2)
    expect(page1.items[0].$id).not.toBe(page2.items[0].$id)
  })

  it('should list all child tenants', async () => {
    const children = await parent$.children.list()

    expect(Array.isArray(children)).toBe(true)
    expect(children.length).toBeGreaterThanOrEqual(2)

    // Should include our test tenants
    const tenantNames = children.map((c) => c.name || c.id)
    expect(tenantNames.some((n) => n.includes('acme'))).toBe(true)
    expect(tenantNames.some((n) => n.includes('bigcorp'))).toBe(true)
  })

  it('should count child tenants', async () => {
    const count = await parent$.children.count()

    expect(typeof count).toBe('number')
    expect(count).toBeGreaterThanOrEqual(2)
  })
})

// ============================================================================
// TEST SUITE 5: Multi-tenant Isolation
// ============================================================================

describe('E2E: Multi-tenant Isolation', () => {
  let tenant1$: ClientContext
  let tenant2$: ClientContext

  beforeEach(() => {
    tenant1$ = $Context(TENANT_URL)
    tenant2$ = $Context(ALT_TENANT_URL)
  })

  afterEach(async () => {
    if (tenant1$.isConnected()) await tenant1$.disconnect()
    if (tenant2$.isConnected()) await tenant2$.disconnect()
  })

  it('should isolate things between tenants', async () => {
    const uniqueTag = testId('isolation')

    // Create thing in tenant 1
    const t1Thing = await tenant1$.things.create({
      $type: 'Secret',
      name: `Acme Secret ${uniqueTag}`,
      tag: uniqueTag,
    })

    // Create thing in tenant 2
    const t2Thing = await tenant2$.things.create({
      $type: 'Secret',
      name: `BigCorp Secret ${uniqueTag}`,
      tag: uniqueTag,
    })

    // Tenant 1 should only see their own things
    const t1List = await tenant1$.things.list({
      $type: 'Secret',
      where: { tag: uniqueTag },
    })
    expect(t1List.items.length).toBe(1)
    expect(t1List.items[0].$id).toBe(t1Thing.$id)

    // Tenant 2 should only see their own things
    const t2List = await tenant2$.things.list({
      $type: 'Secret',
      where: { tag: uniqueTag },
    })
    expect(t2List.items.length).toBe(1)
    expect(t2List.items[0].$id).toBe(t2Thing.$id)
  })

  it('should not allow cross-tenant access to things', async () => {
    // Create thing in tenant 1
    const t1Thing = await tenant1$.things.create({
      $type: 'PrivateData',
      name: 'Acme Private',
    })

    // Tenant 2 should NOT be able to access tenant 1's thing
    const crossAccess = await tenant2$.things.get(t1Thing.$id)

    expect(crossAccess).toBeNull()
  })

  it('should isolate events between tenants', async () => {
    const uniqueTag = testId('event-isolation')

    await tenant1$.connect()
    await tenant2$.connect()

    const t1Events: EventPayload[] = []
    const t2Events: EventPayload[] = []

    tenant1$.on.Deal.closed((event) => {
      t1Events.push(event)
    })

    tenant2$.on.Deal.closed((event) => {
      t2Events.push(event)
    })

    await new Promise((r) => setTimeout(r, 100))

    // Emit event in tenant 1
    await tenant1$.events.emit({
      type: 'Deal.closed',
      payload: { dealId: `deal-1-${uniqueTag}`, tenant: 'acme' },
    })

    // Emit event in tenant 2
    await tenant2$.events.emit({
      type: 'Deal.closed',
      payload: { dealId: `deal-2-${uniqueTag}`, tenant: 'bigcorp' },
    })

    await waitFor(() => t1Events.length > 0 && t2Events.length > 0, EVENT_TIMEOUT)

    // Each tenant should only receive their own events
    expect(t1Events.every((e) => (e.payload as { tenant: string }).tenant === 'acme')).toBe(
      true
    )
    expect(t2Events.every((e) => (e.payload as { tenant: string }).tenant === 'bigcorp')).toBe(
      true
    )
  })
})

// ============================================================================
// TEST SUITE 6: WebSocket Event Subscriptions across Hierarchy
// ============================================================================

describe('E2E: WebSocket Event Subscriptions', () => {
  let tenant$: ClientContext
  let parent$: ClientContext

  beforeEach(() => {
    tenant$ = $Context(TENANT_URL)
    parent$ = $Context(PARENT_URL)
  })

  afterEach(async () => {
    if (tenant$.isConnected()) await tenant$.disconnect()
    if (parent$.isConnected()) await parent$.disconnect()
  })

  it('should subscribe to specific events via $.on.Noun.verb', async () => {
    await tenant$.connect()

    const signupEvents: EventPayload[] = []
    tenant$.on.Customer.signup((event) => {
      signupEvents.push(event)
    })

    await new Promise((r) => setTimeout(r, 100))

    // Emit signup event
    await tenant$.events.emit({
      type: 'Customer.signup',
      payload: { email: 'newuser@example.com' },
    })

    await waitFor(() => signupEvents.length > 0, EVENT_TIMEOUT)

    expect(signupEvents.length).toBe(1)
    expect(signupEvents[0].type).toBe('Customer.signup')
  })

  it('should support wildcard subscriptions $.on.Noun.*', async () => {
    await tenant$.connect()

    const customerEvents: EventPayload[] = []
    tenant$.on.Customer['*']((event) => {
      customerEvents.push(event)
    })

    await new Promise((r) => setTimeout(r, 100))

    // Emit various customer events
    await tenant$.events.emit({
      type: 'Customer.created',
      payload: { name: 'Alice' },
    })
    await tenant$.events.emit({
      type: 'Customer.updated',
      payload: { name: 'Alice Updated' },
    })

    await waitFor(() => customerEvents.length >= 2, EVENT_TIMEOUT)

    expect(customerEvents.length).toBeGreaterThanOrEqual(2)
    expect(customerEvents.every((e) => e.type.startsWith('Customer.'))).toBe(true)
  })

  it('should support global wildcard subscriptions $.on.*.*', async () => {
    await parent$.connect()

    const allEvents: EventPayload[] = []
    parent$.on['*']['*']((event) => {
      allEvents.push(event)
    })

    await new Promise((r) => setTimeout(r, 100))

    // Emit various events from tenant
    await tenant$.events.emit({
      type: 'Lead.created',
      payload: { name: 'Test Lead' },
    })
    await tenant$.events.emit({
      type: 'Order.placed',
      payload: { total: 100 },
    })

    await waitFor(() => allEvents.length >= 2, EVENT_TIMEOUT)

    // Should receive all event types
    const eventTypes = allEvents.map((e) => e.type)
    expect(eventTypes.some((t) => t.includes('Lead'))).toBe(true)
    expect(eventTypes.some((t) => t.includes('Order'))).toBe(true)
  })

  it('should support unsubscribe function', async () => {
    await tenant$.connect()

    const events: EventPayload[] = []
    const unsubscribe = tenant$.on.Test.event((event) => {
      events.push(event)
    })

    await new Promise((r) => setTimeout(r, 100))

    // Emit event before unsubscribe
    await tenant$.events.emit({
      type: 'Test.event',
      payload: { before: true },
    })

    await waitFor(() => events.length > 0, EVENT_TIMEOUT)

    const countBefore = events.length

    // Unsubscribe
    unsubscribe()

    // Emit event after unsubscribe
    await tenant$.events.emit({
      type: 'Test.event',
      payload: { after: true },
    })

    // Wait a bit to ensure event would have been received
    await new Promise((r) => setTimeout(r, 500))

    // Should not have received the second event
    expect(events.length).toBe(countBefore)
  })

  it('should handle reconnection and resubscription', async () => {
    await tenant$.connect()

    const events: EventPayload[] = []
    tenant$.on.Reconnect.test((event) => {
      events.push(event)
    })

    await new Promise((r) => setTimeout(r, 100))

    // Simulate disconnect
    await tenant$.disconnect()

    // Reconnect
    await tenant$.connect()

    await new Promise((r) => setTimeout(r, 100))

    // Emit event after reconnection
    await tenant$.events.emit({
      type: 'Reconnect.test',
      payload: { afterReconnect: true },
    })

    await waitFor(() => events.length > 0, EVENT_TIMEOUT)

    expect(events.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// TEST SUITE 7: Error Handling and Edge Cases
// ============================================================================

describe('E2E: Error Handling', () => {
  let $: ClientContext

  beforeEach(() => {
    $ = $Context(TENANT_URL)
  })

  afterEach(async () => {
    if ($.isConnected()) await $.disconnect()
  })

  it('should throw typed error for validation failures', async () => {
    try {
      // @ts-expect-error - Testing runtime validation
      await $.things.create({ name: 'No type' })
      expect.fail('Should have thrown')
    } catch (error: unknown) {
      expect((error as { code?: string }).code).toBeDefined()
    }
  })

  it('should throw typed error for not found', async () => {
    try {
      await $.things.update('nonexistent-id', { name: 'Test' })
      expect.fail('Should have thrown')
    } catch (error: unknown) {
      expect((error as { code?: string }).code).toBe('NOT_FOUND')
    }
  })

  it('should handle network errors gracefully', async () => {
    const badContext = $Context('https://nonexistent.invalid.domain.ai')

    await expect(badContext.things.list({ $type: 'Customer' })).rejects.toThrow()
  })

  it('should support timeout configuration', async () => {
    const timeoutContext = $Context(TENANT_URL, { timeout: 100 })

    // This should timeout if server takes too long
    // Test will pass if timeout mechanism works
    expect(timeoutContext._options.timeout).toBe(100)
  })

  it('should handle event handler errors without crashing', async () => {
    await $.connect()

    const errorHandler = vi.fn(() => {
      throw new Error('Handler error')
    })
    const successHandler = vi.fn()

    $.on.Error.test(errorHandler)
    $.on.Error.test(successHandler)

    await new Promise((r) => setTimeout(r, 100))

    await $.events.emit({
      type: 'Error.test',
      payload: {},
    })

    await new Promise((r) => setTimeout(r, 200))

    // Both handlers should have been called (error should not prevent second handler)
    expect(errorHandler).toHaveBeenCalled()
    expect(successHandler).toHaveBeenCalled()
  })
})

// ============================================================================
// TEST SUITE 8: Integration - Full Parent-Child Lifecycle
// ============================================================================

describe('E2E: Full Parent-Child Lifecycle', () => {
  let parent$: ParentContext
  let tenant$: TenantContext

  beforeEach(() => {
    parent$ = $Context(PARENT_URL) as ParentContext
    tenant$ = $Context(TENANT_URL) as TenantContext
  })

  afterEach(async () => {
    if (parent$.isConnected()) await parent$.disconnect()
    if (tenant$.isConnected()) await tenant$.disconnect()
  })

  it('should handle complete lifecycle: create -> event -> search -> delete', async () => {
    const uniqueTag = testId('lifecycle')

    // 1. Subscribe to events on parent before creating
    await parent$.connect()
    const receivedEvents: EventPayload[] = []
    parent$.on.Customer.created((event) => {
      receivedEvents.push(event)
    })
    await new Promise((r) => setTimeout(r, 100))

    // 2. Create customer in tenant
    const customer = await tenant$.things.create({
      $type: 'Customer',
      name: `Lifecycle Test ${uniqueTag}`,
      email: 'lifecycle@example.com',
      tag: uniqueTag,
    })

    expect(customer.$id).toBeDefined()

    // 3. Wait for event to propagate to parent
    await waitFor(() => receivedEvents.length > 0, EVENT_TIMEOUT)
    expect(receivedEvents.length).toBeGreaterThan(0)

    // 4. Search for customer from parent
    const searchResults = await parent$.query.global({
      $type: 'Customer',
      filters: { tag: uniqueTag },
    })
    expect(searchResults.items.length).toBeGreaterThanOrEqual(1)

    // 5. Update customer in tenant
    const updated = await tenant$.things.update(customer.$id, {
      name: `Lifecycle Test ${uniqueTag} Updated`,
    })
    expect(updated.name).toContain('Updated')

    // 6. Delete customer
    const deleted = await tenant$.things.delete(customer.$id)
    expect(deleted.deleted).toBe(true)

    // 7. Verify deletion
    const afterDelete = await tenant$.things.get(customer.$id)
    expect(afterDelete).toBeNull()
  })

  it('should maintain consistency between tenant and parent views', async () => {
    const uniqueTag = testId('consistency')

    // Create several items in tenant
    const items = []
    for (let i = 0; i < 5; i++) {
      const item = await tenant$.things.create({
        $type: 'Order',
        name: `Order ${i} ${uniqueTag}`,
        tag: uniqueTag,
      })
      items.push(item)
    }

    // Wait for events to propagate
    await new Promise((r) => setTimeout(r, 2000))

    // Query from tenant
    const tenantView = await tenant$.things.list({
      $type: 'Order',
      where: { tag: uniqueTag },
    })

    // Query from parent
    const parentView = await parent$.query.global({
      $type: 'Order',
      filters: { tag: uniqueTag },
    })

    // Both should have same count
    expect(tenantView.items.length).toBe(items.length)
    expect(parentView.items.length).toBe(items.length)
  })
})
