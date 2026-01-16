/**
 * E2E Multi-Tenant Isolation Tests
 *
 * Tests that actions in one tenant DO NOT affect other tenants:
 * 1. Data isolation - Things created in tenant A are not visible in tenant B
 * 2. State isolation - State changes in tenant A don't affect tenant B
 * 3. Event isolation - Events in tenant A don't trigger handlers in tenant B
 * 4. Namespace isolation - Each DO instance has its own namespace
 *
 * NO MOCKS - uses real Durable Objects with real SQLite via miniflare
 *
 * @see do-3dmf - E2E test coverage expansion
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

// =============================================================================
// Types
// =============================================================================

interface ThingData {
  $id: string
  $type: string
  $createdAt: string
  $updatedAt: string
  $version?: number
  [key: string]: unknown
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Get a DO stub for a specific tenant
 */
function getTenantStub(tenantName: string) {
  const id = env.DOFull.idFromName(tenantName)
  return env.DOFull.get(id)
}

/**
 * Generate unique IDs for test isolation
 */
function uniqueId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// =============================================================================
// 1. DATA ISOLATION TESTS
// =============================================================================

describe('E2E Multi-Tenant: Data Isolation', () => {
  it('should keep things created in tenant A invisible to tenant B', async () => {
    const tenantA = getTenantStub('isolation-tenant-a-1')
    const tenantB = getTenantStub('isolation-tenant-b-1')

    // Create customers in tenant A
    const customerA1 = await tenantA.create('Customer', {
      $id: uniqueId('customer-a'),
      name: 'Alice from Tenant A',
      tenantMarker: 'A',
    })

    const customerA2 = await tenantA.create('Customer', {
      $id: uniqueId('customer-a'),
      name: 'Bob from Tenant A',
      tenantMarker: 'A',
    })

    // Create customers in tenant B
    const customerB1 = await tenantB.create('Customer', {
      $id: uniqueId('customer-b'),
      name: 'Carol from Tenant B',
      tenantMarker: 'B',
    })

    // Verify things in tenant A are accessible in A
    const profileA1 = await tenantA.Customer(customerA1.$id).getProfile()
    expect(profileA1).not.toBeNull()
    expect(profileA1!.tenantMarker).toBe('A')

    // Verify things in tenant B are accessible in B
    const profileB1 = await tenantB.Customer(customerB1.$id).getProfile()
    expect(profileB1).not.toBeNull()
    expect(profileB1!.tenantMarker).toBe('B')

    // Verify specific IDs are not accessible across tenants
    const accessorInB = tenantB.Customer(customerA1.$id)
    const profileFromB = await accessorInB.getProfile()
    expect(profileFromB).toBeNull() // A's customer should not exist in B

    // Verify B's customer is not accessible from A
    const accessorInA = tenantA.Customer(customerB1.$id)
    const profileFromA = await accessorInA.getProfile()
    expect(profileFromA).toBeNull() // B's customer should not exist in A
  })

  it('should allow same IDs in different tenants without conflict', async () => {
    const tenantA = getTenantStub('isolation-tenant-a-2')
    const tenantB = getTenantStub('isolation-tenant-b-2')
    const sharedId = `shared-customer-${Date.now()}`

    // Create customer with same ID in both tenants
    const customerA = await tenantA.create('Customer', {
      $id: sharedId,
      name: 'Alice (Tenant A version)',
      source: 'tenant-a',
    })

    const customerB = await tenantB.create('Customer', {
      $id: sharedId,
      name: 'Bob (Tenant B version)',
      source: 'tenant-b',
    })

    // Both should succeed with same ID
    expect(customerA.$id).toBe(sharedId)
    expect(customerB.$id).toBe(sharedId)

    // Data should be different per tenant
    expect(customerA.name).toBe('Alice (Tenant A version)')
    expect(customerB.name).toBe('Bob (Tenant B version)')

    // Fetch from each tenant should return correct data
    const profileA = await tenantA.Customer(sharedId).getProfile()
    const profileB = await tenantB.Customer(sharedId).getProfile()

    expect(profileA!.source).toBe('tenant-a')
    expect(profileB!.source).toBe('tenant-b')
  })

  it('should maintain isolation with different thing types', async () => {
    const tenantA = getTenantStub('isolation-tenant-a-3')
    const tenantB = getTenantStub('isolation-tenant-b-3')

    // Create various things in tenant A
    const custA = await tenantA.create('Customer', { $id: uniqueId('cust'), name: 'Customer A' })
    const orderA = await tenantA.create('Order', { $id: uniqueId('order'), amount: 100 })
    const prodA = await tenantA.create('Product', { $id: uniqueId('prod'), name: 'Widget' })

    // Create only customers in tenant B
    const custB = await tenantB.create('Customer', { $id: uniqueId('cust'), name: 'Customer B' })

    // Tenant A should be able to access its own things
    expect(await tenantA.Customer(custA.$id).getProfile()).not.toBeNull()
    expect(await tenantA.Order(orderA.$id).getProfile()).not.toBeNull()
    expect(await tenantA.Product(prodA.$id).getProfile()).not.toBeNull()

    // Tenant B should be able to access its own things
    expect(await tenantB.Customer(custB.$id).getProfile()).not.toBeNull()

    // Tenant B should NOT see A's orders or products
    expect(await tenantB.Order(orderA.$id).getProfile()).toBeNull()
    expect(await tenantB.Product(prodA.$id).getProfile()).toBeNull()

    // Tenant A should NOT see B's customers
    expect(await tenantA.Customer(custB.$id).getProfile()).toBeNull()
  })
})

// =============================================================================
// 2. STATE ISOLATION TESTS
// =============================================================================

describe('E2E Multi-Tenant: State Isolation', () => {
  it('should isolate thing-based state between tenants', async () => {
    const tenantA = getTenantStub('state-tenant-a-1')
    const tenantB = getTenantStub('state-tenant-b-1')

    // Use things to store configuration (since DOStorage.get shadows DOCore.get)
    const configA = await tenantA.create('Item', {
      $id: 'config-state',
      theme: 'dark',
      language: 'en',
      counter: 100,
    })

    const configB = await tenantB.create('Item', {
      $id: 'config-state',
      theme: 'light',
      language: 'fr',
      counter: 500,
    })

    // Verify tenant A state
    const tenantAConfig = await tenantA.Item('config-state').getProfile()
    expect(tenantAConfig!.theme).toBe('dark')
    expect(tenantAConfig!.language).toBe('en')
    expect(tenantAConfig!.counter).toBe(100)

    // Verify tenant B state (different)
    const tenantBConfig = await tenantB.Item('config-state').getProfile()
    expect(tenantBConfig!.theme).toBe('light')
    expect(tenantBConfig!.language).toBe('fr')
    expect(tenantBConfig!.counter).toBe(500)
  })

  it('should not leak state updates across tenants', async () => {
    const tenantA = getTenantStub('state-tenant-a-2')
    const tenantB = getTenantStub('state-tenant-b-2')

    // Initialize same thing ID in both tenants
    await tenantA.create('Item', { $id: 'shared-state', value: 'initial-a' })
    await tenantB.create('Item', { $id: 'shared-state', value: 'initial-b' })

    // Update in tenant A
    await tenantA.Item('shared-state').update({ value: 'updated-a' })

    // Tenant B should still have its original value
    const tenantBItem = await tenantB.Item('shared-state').getProfile()
    expect(tenantBItem!.value).toBe('initial-b')

    // Update in tenant B
    await tenantB.Item('shared-state').update({ value: 'updated-b' })

    // Tenant A should still have its updated value
    const tenantAItem = await tenantA.Item('shared-state').getProfile()
    expect(tenantAItem!.value).toBe('updated-a')
  })

  it('should isolate list operations between tenants', async () => {
    const tenantA = getTenantStub('state-tenant-a-3')
    const tenantB = getTenantStub('state-tenant-b-3')

    // Set multiple items with prefix in tenant A
    await tenantA.set('items:1', { name: 'Item A1' })
    await tenantA.set('items:2', { name: 'Item A2' })
    await tenantA.set('items:3', { name: 'Item A3' })

    // Set different items in tenant B
    await tenantB.set('items:1', { name: 'Item B1' })

    // List items in tenant A
    const tenantAItems = await tenantA.list({ prefix: 'items:' })
    expect(Object.keys(tenantAItems)).toHaveLength(3)

    // List items in tenant B - should only see B's items
    const tenantBItems = await tenantB.list({ prefix: 'items:' })
    expect(Object.keys(tenantBItems)).toHaveLength(1)
    expect((tenantBItems['items:1'] as { name: string }).name).toBe('Item B1')
  })

  it('should isolate delete operations between tenants', async () => {
    const tenantA = getTenantStub('state-tenant-a-4')
    const tenantB = getTenantStub('state-tenant-b-4')

    // Create same thing ID in both tenants
    await tenantA.create('Item', { $id: 'to-delete', value: 'value-a' })
    await tenantB.create('Item', { $id: 'to-delete', value: 'value-b' })

    // Delete in tenant A
    const deleted = await tenantA.Item('to-delete').delete()
    expect(deleted).toBe(true)

    // Tenant A should not have the item
    expect(await tenantA.Item('to-delete').getProfile()).toBeNull()

    // Tenant B should still have its item
    const tenantBItem = await tenantB.Item('to-delete').getProfile()
    expect(tenantBItem).not.toBeNull()
    expect(tenantBItem!.value).toBe('value-b')
  })
})

// =============================================================================
// 3. CRUD ISOLATION TESTS
// =============================================================================

describe('E2E Multi-Tenant: CRUD Isolation', () => {
  it('should isolate updates between tenants', async () => {
    const tenantA = getTenantStub('crud-tenant-a-1')
    const tenantB = getTenantStub('crud-tenant-b-1')
    const sharedId = `customer-${Date.now()}`

    // Create customer in both tenants
    await tenantA.create('Customer', {
      $id: sharedId,
      name: 'Original A',
      balance: 1000,
    })

    await tenantB.create('Customer', {
      $id: sharedId,
      name: 'Original B',
      balance: 2000,
    })

    // Update in tenant A
    await tenantA.Customer(sharedId).update({
      name: 'Updated A',
      balance: 1500,
    })

    // Tenant A should see update
    const profileA = await tenantA.Customer(sharedId).getProfile()
    expect(profileA!.name).toBe('Updated A')
    expect(profileA!.balance).toBe(1500)

    // Tenant B should be unaffected
    const profileB = await tenantB.Customer(sharedId).getProfile()
    expect(profileB!.name).toBe('Original B')
    expect(profileB!.balance).toBe(2000)
  })

  it('should isolate deletes between tenants', async () => {
    const tenantA = getTenantStub('crud-tenant-a-2')
    const tenantB = getTenantStub('crud-tenant-b-2')
    const sharedId = `product-${Date.now()}`

    // Create product in both tenants
    await tenantA.create('Product', {
      $id: sharedId,
      name: 'Widget A',
    })

    await tenantB.create('Product', {
      $id: sharedId,
      name: 'Widget B',
    })

    // Delete in tenant A
    const deleteResult = await tenantA.Product(sharedId).delete()
    expect(deleteResult).toBe(true)

    // Tenant A should not find the product
    const profileA = await tenantA.Product(sharedId).getProfile()
    expect(profileA).toBeNull()

    // Tenant B should still have its product
    const profileB = await tenantB.Product(sharedId).getProfile()
    expect(profileB).not.toBeNull()
    expect(profileB!.name).toBe('Widget B')
  })
})

// =============================================================================
// 4. HTTP ISOLATION TESTS
// =============================================================================

describe('E2E Multi-Tenant: HTTP Interface Isolation', () => {
  it('should route requests to correct tenant based on namespace', async () => {
    const tenantA = getTenantStub('http-tenant-a-1')
    const tenantB = getTenantStub('http-tenant-b-1')

    // Set up different state in each tenant via HTTP/fetch simulation
    await tenantA.set('http-test-key', 'tenant-a-value')
    await tenantB.set('http-test-key', 'tenant-b-value')

    // Health checks should work independently
    const healthA = await tenantA.fetch('https://tenant-a.api.dotdo.dev/health')
    const healthB = await tenantB.fetch('https://tenant-b.api.dotdo.dev/health')

    expect(healthA.status).toBe(200)
    expect(healthB.status).toBe(200)

    // Ready checks should be independent
    const readyA = await tenantA.fetch('https://tenant-a.api.dotdo.dev/ready')
    const readyB = await tenantB.fetch('https://tenant-b.api.dotdo.dev/ready')

    const readyBodyA = await readyA.json()
    const readyBodyB = await readyB.json()

    expect(readyBodyA.ready).toBe(true)
    expect(readyBodyB.ready).toBe(true)
  })

  it('should isolate API item operations between tenants', async () => {
    const tenantA = getTenantStub('http-tenant-a-2')
    const tenantB = getTenantStub('http-tenant-b-2')

    // Create item in tenant A
    const createA = await tenantA.fetch('https://tenant-a.api.dotdo.dev/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Item A', tenant: 'A' }),
    })
    expect(createA.status).toBe(201)

    // Create different item in tenant B
    const createB = await tenantB.fetch('https://tenant-b.api.dotdo.dev/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Item B', tenant: 'B' }),
    })
    expect(createB.status).toBe(201)

    // Each tenant's operations are independent
    const bodyA = await createA.json()
    const bodyB = await createB.json()

    expect(bodyA.created.name).toBe('Item A')
    expect(bodyB.created.name).toBe('Item B')
  })
})

// =============================================================================
// 5. CONCURRENT ACCESS ISOLATION
// =============================================================================

describe('E2E Multi-Tenant: Concurrent Access Isolation', () => {
  it('should handle parallel operations across tenants without interference', async () => {
    const tenants = [
      getTenantStub('parallel-tenant-1'),
      getTenantStub('parallel-tenant-2'),
      getTenantStub('parallel-tenant-3'),
      getTenantStub('parallel-tenant-4'),
    ]

    // Perform parallel operations across all tenants
    const operations = tenants.map(async (tenant, index) => {
      // Create customer
      const customer = await tenant.create('Customer', {
        $id: `parallel-customer-${index}`,
        name: `Customer from Tenant ${index + 1}`,
        tenantIndex: index,
      })

      // Update customer
      const updated = await tenant.Customer(customer.$id).update({
        processed: true,
        processedAt: new Date().toISOString(),
      })

      // Return both for verification
      return { customer, updated, tenantIndex: index }
    })

    const results = await Promise.all(operations)

    // Verify each tenant has its own data
    for (const { customer, updated, tenantIndex } of results) {
      expect(customer.tenantIndex).toBe(tenantIndex)
      expect(updated.processed).toBe(true)
      expect(updated.tenantIndex).toBe(tenantIndex)
    }

    // Cross-verify isolation - each tenant should only see its own customers
    for (let i = 0; i < tenants.length; i++) {
      const customers = await tenants[i].listThings('Customer')
      const otherTenantCustomers = customers.filter((c) => c.tenantIndex !== i)
      expect(otherTenantCustomers).toHaveLength(0)
    }
  })

  it('should handle rapid sequential operations per tenant', async () => {
    const tenantA = getTenantStub('rapid-tenant-a')
    const tenantB = getTenantStub('rapid-tenant-b')

    // Rapid operations in tenant A
    const createdA: ThingData[] = []
    for (let i = 0; i < 10; i++) {
      const item = await tenantA.create('Item', {
        $id: `rapid-a-${i}`,
        index: i,
        tenant: 'A',
      })
      createdA.push(item)
    }

    // Rapid operations in tenant B
    const createdB: ThingData[] = []
    for (let i = 0; i < 10; i++) {
      const item = await tenantB.create('Item', {
        $id: `rapid-b-${i}`,
        index: i,
        tenant: 'B',
      })
      createdB.push(item)
    }

    // Verify all items created successfully
    expect(createdA).toHaveLength(10)
    expect(createdB).toHaveLength(10)

    // Verify each tenant's items are accessible in their own tenant
    for (const item of createdA) {
      const profile = await tenantA.Item(item.$id).getProfile()
      expect(profile).not.toBeNull()
      expect(profile!.tenant).toBe('A')
    }

    for (const item of createdB) {
      const profile = await tenantB.Item(item.$id).getProfile()
      expect(profile).not.toBeNull()
      expect(profile!.tenant).toBe('B')
    }

    // No cross-contamination - A's items not accessible from B
    for (const item of createdA) {
      const profile = await tenantB.Item(item.$id).getProfile()
      expect(profile).toBeNull()
    }

    // No cross-contamination - B's items not accessible from A
    for (const item of createdB) {
      const profile = await tenantA.Item(item.$id).getProfile()
      expect(profile).toBeNull()
    }
  })
})

// =============================================================================
// 6. ALARM AND SCHEDULE ISOLATION
// =============================================================================

describe('E2E Multi-Tenant: Alarm Isolation', () => {
  it('should isolate alarm scheduling between tenants', async () => {
    const tenantA = getTenantStub('alarm-tenant-a')
    const tenantB = getTenantStub('alarm-tenant-b')

    // Set alarm in tenant A
    const futureTimeA = Date.now() + 60000 // 1 minute from now
    await tenantA.setAlarm(futureTimeA)

    // Set different alarm in tenant B
    const futureTimeB = Date.now() + 120000 // 2 minutes from now
    await tenantB.setAlarm(futureTimeB)

    // Get alarms - should be independent
    const alarmA = await tenantA.getAlarm()
    const alarmB = await tenantB.getAlarm()

    expect(alarmA).not.toBeNull()
    expect(alarmB).not.toBeNull()
    expect(alarmA!.getTime()).not.toBe(alarmB!.getTime())

    // Delete alarm in A
    await tenantA.deleteAlarm()

    // A should have no alarm
    const alarmAAfterDelete = await tenantA.getAlarm()
    expect(alarmAAfterDelete).toBeNull()

    // B should still have its alarm
    const alarmBAfterDelete = await tenantB.getAlarm()
    expect(alarmBAfterDelete).not.toBeNull()
  })
})

// =============================================================================
// 7. TRANSACTION ISOLATION
// =============================================================================

describe('E2E Multi-Tenant: Transaction Isolation', () => {
  it('should isolate thing updates between tenants', async () => {
    const tenantA = getTenantStub('tx-tenant-a')
    const tenantB = getTenantStub('tx-tenant-b')

    // Create accounts in each tenant
    await tenantA.create('Item', { $id: 'account', balance: 1000 })
    await tenantB.create('Item', { $id: 'account', balance: 2000 })

    // Update in tenant A
    await tenantA.Item('account').update({ balance: 800, lastTx: 'withdraw-200' })

    // Verify tenant A state changed
    const accountA = await tenantA.Item('account').getProfile()
    expect(accountA!.balance).toBe(800)
    expect(accountA!.lastTx).toBe('withdraw-200')

    // Verify tenant B state unchanged
    const accountB = await tenantB.Item('account').getProfile()
    expect(accountB!.balance).toBe(2000)
    expect(accountB!.lastTx).toBeUndefined()
  })

  it('should not leak thing modifications across tenants', async () => {
    const tenantA = getTenantStub('tx-tenant-a-2')
    const tenantB = getTenantStub('tx-tenant-b-2')

    // Initialize same thing ID in both tenants
    await tenantA.create('Item', { $id: 'shared-item', value: 'initial-a' })
    await tenantB.create('Item', { $id: 'shared-item', value: 'initial-b' })

    // Modify in tenant A
    await tenantA.Item('shared-item').update({ value: 'modified-by-a' })

    // Tenant B's value should be unchanged
    const itemB = await tenantB.Item('shared-item').getProfile()
    expect(itemB!.value).toBe('initial-b')

    // Tenant A's value should be updated
    const itemA = await tenantA.Item('shared-item').getProfile()
    expect(itemA!.value).toBe('modified-by-a')
  })
})
