import { describe, it, expect } from 'vitest'
import { createWorkflowProxy, isPipelinePromise } from '../workflows/pipeline-promise'

describe('BatchProcessingWorkflow Example', () => {
  it('uses magic map for batch inventory checks', () => {
    const $ = createWorkflowProxy()

    // When source is a PipelinePromise, .map() uses record-replay
    const orderItems = $.Orders({ id: 'order-123' }).getItems()
    const inventoryChecks = orderItems.map((item) => $.Inventory({ sku: item.sku }).check())

    expect(isPipelinePromise(inventoryChecks)).toBe(true)
    expect(inventoryChecks.__expr.type).toBe('map')
  })

  it('captures mapper instructions correctly', () => {
    const $ = createWorkflowProxy()

    const items = $.Orders({ id: 'order-1' }).getItems()
    const checked = items.map((item) => $.Inventory(item.product).check())

    expect(checked.__expr.type).toBe('map')
    expect(checked.__expr.mapper).toBeDefined()
    // Mapper should reference item.product path
  })

  it('works with conditional inside map', () => {
    const $ = createWorkflowProxy()

    // When source is PipelinePromise, .map() returns PipelinePromise
    const items = $.Warehouse({ id: 'wh-1' }).getItems()
    const checks = items.map((item) => $.Inventory({ sku: item.sku }).check())

    const reservations = checks.map((check, i) =>
      $.when(check.available, {
        then: () => $.Inventory({ sku: items[i].sku }).reserve(),
      }),
    )

    expect(isPipelinePromise(reservations)).toBe(true)
  })

  it('plain array map returns array of PipelinePromises', () => {
    const $ = createWorkflowProxy()

    // When source is a plain JS array, .map() returns plain array
    const skus = ['SKU-A', 'SKU-B', 'SKU-C']
    const checks = skus.map((sku) => $.Inventory({ sku }).check())

    // Result is an array (not PipelinePromise)
    expect(Array.isArray(checks)).toBe(true)
    expect(checks.length).toBe(3)
    // But each element IS a PipelinePromise
    expect(isPipelinePromise(checks[0])).toBe(true)
    expect(isPipelinePromise(checks[1])).toBe(true)
    expect(isPipelinePromise(checks[2])).toBe(true)
  })
})
