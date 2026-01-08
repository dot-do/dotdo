/**
 * BatchProcessingWorkflow Example
 *
 * Demonstrates:
 * - Magic map for batch operations (record-replay pattern)
 * - No Promise.all needed for array operations
 * - Conditional processing with $.when
 */

import { Workflow } from '../workflows/workflow'

interface Order {
  id: string
  customerId: string
  items: OrderItem[]
}

interface OrderItem {
  sku: string
  quantity: number
  price: number
}

interface InventoryCheck {
  sku: string
  available: boolean
  quantity: number
}

interface Reservation {
  id: string
  sku: string
  quantity: number
  expiresAt: Date
}

/**
 * Batch Order Processing Workflow
 *
 * Processes all items in an order using magic map.
 * The .map() uses record-replay: callback runs once to capture operations,
 * then replays for each item server-side.
 */
export const BatchProcessingWorkflow = Workflow('batch-order-processing', ($, order: Order) => {
  // Magic map: checks ALL items in a single workflow step
  // Callback runs once with placeholder, captures the pattern,
  // then replays for each item server-side
  const inventoryChecks = order.items.map((item) => $.Inventory({ sku: item.sku }).check())

  // Process each item based on availability
  const reservations = order.items.map((item, index) =>
    $.when(inventoryChecks[index].available, {
      then: () => $.Inventory({ sku: item.sku }).reserve({ quantity: item.quantity }),
      else: () =>
        $.Backorder({ sku: item.sku }).create({
          quantity: item.quantity,
          customerId: order.customerId,
        }),
    }),
  )

  // Calculate totals using map
  const itemTotals = order.items.map((item) => $.Pricing({ sku: item.sku }).calculate({ quantity: item.quantity }))

  // Notify customer
  $.Email({ customerId: order.customerId }).sendOrderConfirmation({
    orderId: order.id,
    items: order.items,
    reservations: reservations,
  })

  return {
    orderId: order.id,
    inventoryChecks,
    reservations,
    itemTotals,
    status: 'processed',
  }
})

/**
 * Warehouse Inventory Audit Workflow
 *
 * Another example showing nested maps
 */
export const WarehouseAuditWorkflow = Workflow('warehouse-audit', ($, warehouseId: string) => {
  // Get all sections in warehouse
  const sections = $.Warehouse({ id: warehouseId }).getSections()

  // For each section, get items and check each one
  const auditResults = sections.map((section) => ({
    sectionId: section.id,
    items: section.items.map((item) => ({
      sku: item.sku,
      expected: item.expectedQuantity,
      actual: $.Inventory({ sku: item.sku }).count(),
      discrepancy: $.Inventory({ sku: item.sku }).checkDiscrepancy(),
    })),
  }))

  // Aggregate results
  const summary = $.Audit({ warehouseId }).summarize({ results: auditResults })

  return {
    warehouseId,
    auditResults,
    summary,
  }
})
