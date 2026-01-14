import { describe, it, expect, beforeEach } from 'vitest'
import { Catalog, PushdownOptimizer, FederatedExecutor, createMemoryAdapter, type FederatedQuery } from '../index'

// This replicates the EXACT setup from federated-query.test.ts
describe('Debug Integration', () => {
  let catalog: Catalog
  let optimizer: PushdownOptimizer
  let executor: FederatedExecutor

  beforeEach(() => {
    catalog = new Catalog()
    optimizer = new PushdownOptimizer(catalog)
    executor = new FederatedExecutor(catalog)

    // Setup test environment with multiple sources
    catalog.registerSource({ name: 'customers', type: 'memory', config: {} })
    catalog.registerSource({ name: 'orders', type: 'memory', config: {} })
    catalog.registerSource({ name: 'products', type: 'memory', config: {} })

    catalog.attachAdapter('customers', createMemoryAdapter({
      customers: [
        { id: 1, name: 'Acme Corp', tier: 'enterprise' },
        { id: 2, name: 'Startup Inc', tier: 'basic' },
        { id: 3, name: 'BigCo', tier: 'enterprise' },
      ],
    }))

    catalog.attachAdapter('orders', createMemoryAdapter({
      orders: [
        { id: 101, customer_id: 1, product_id: 1, quantity: 10, total: 1000 },
        { id: 102, customer_id: 1, product_id: 2, quantity: 5, total: 250 },
        { id: 103, customer_id: 2, product_id: 1, quantity: 2, total: 200 },
        { id: 104, customer_id: 3, product_id: 3, quantity: 100, total: 5000 },
      ],
    }))

    catalog.attachAdapter('products', createMemoryAdapter({
      products: [
        { id: 1, name: 'Widget', price: 100 },
        { id: 2, name: 'Gadget', price: 50 },
        { id: 3, name: 'Enterprise Suite', price: 50 },
      ],
    }))
  })

  it('should execute full federated query pipeline', async () => {
    const query: FederatedQuery = {
      from: [
        { source: 'customers', table: 'customers' },
        { source: 'orders', table: 'orders' },
      ],
      columns: ['customers.name', 'orders.total'],
      predicates: [
        { column: 'customers.tier', op: '=', value: 'enterprise' },
      ],
      join: {
        type: 'INNER',
        on: { left: 'customers.id', right: 'orders.customer_id' },
      },
    }

    const plan = optimizer.optimize(query)
    console.log('Plan fragments:', JSON.stringify(plan.fragments, null, 2))
    console.log('Residual predicates:', plan.residualPredicates)
    console.log('Join:', plan.join)

    const result = await executor.execute(plan)
    console.log('Result rows:', result.rows.length)
    console.log('All rows:', JSON.stringify(result.rows, null, 2))

    // Should filter to only enterprise tier customers (Acme Corp id=1, BigCo id=3)
    // Acme has 2 orders (id=101, 102), BigCo has 1 order (id=104) = 3 rows total
    expect(result.rows.length).toBe(3)
    // After join, rows contain merged columns - 'name' comes from customers table
    expect(result.rows.every(r => r.name === 'Acme Corp' || r.name === 'BigCo')).toBe(true)
    // Verify order totals are present
    expect(result.rows.every(r => typeof r.total === 'number')).toBe(true)
  })
})
