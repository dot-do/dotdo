/**
 * @fileoverview Basic CRUD Example for Unified Storage
 *
 * This example demonstrates the fundamental Create, Read, Update, Delete
 * operations using the InMemoryStateManager component.
 *
 * Run: npx tsx objects/unified-storage/examples/basic-crud.ts
 *
 * @example
 * ```bash
 * npx tsx objects/unified-storage/examples/basic-crud.ts
 * ```
 */

import { InMemoryStateManager } from '../in-memory-state-manager'

// ============================================================================
// BASIC CRUD OPERATIONS
// ============================================================================

/**
 * Demonstrates basic CRUD operations with InMemoryStateManager.
 *
 * Key concepts:
 * - All operations are O(1) performance
 * - Every write marks the entity as "dirty"
 * - Dirty entries are batched for SQLite persistence
 */
function basicCrudExample() {
  console.log('=== Basic CRUD Example ===\n')

  // Initialize the state manager with optional limits
  const manager = new InMemoryStateManager({
    maxEntries: 10000, // LRU eviction after 10k entries
    maxBytes: 50 * 1024 * 1024, // 50MB memory limit
    onEvict: (entries) => {
      console.log(`[Eviction] ${entries.length} entries evicted`)
    },
  })

  // --------------------------------------------------------------------------
  // CREATE
  // --------------------------------------------------------------------------

  console.log('--- CREATE ---')

  // Create a customer (ID auto-generated as customer_{uuid})
  const customer = manager.create({
    $type: 'Customer',
    name: 'Alice Smith',
    email: 'alice@example.com',
    plan: 'enterprise',
  })

  console.log('Created customer:', customer.$id)
  console.log('  $type:', customer.$type)
  console.log('  $version:', customer.$version) // Always 1 for new entities
  console.log('  name:', customer.name)

  // Create with explicit ID
  const order = manager.create({
    $id: 'order_001',
    $type: 'Order',
    customerId: customer.$id,
    total: 99.99,
    status: 'pending',
  })

  console.log('Created order:', order.$id)
  console.log('')

  // --------------------------------------------------------------------------
  // READ
  // --------------------------------------------------------------------------

  console.log('--- READ (O(1)) ---')

  // Read by ID - O(1) lookup, never touches SQLite
  const retrieved = manager.get(customer.$id)
  console.log('Retrieved customer:', retrieved?.name)

  // Check existence
  console.log('Customer exists:', manager.has(customer.$id))
  console.log('Non-existent:', manager.has('fake_id'))
  console.log('')

  // --------------------------------------------------------------------------
  // UPDATE
  // --------------------------------------------------------------------------

  console.log('--- UPDATE ---')

  // Update merges fields and increments $version
  const updated = manager.update(customer.$id, {
    plan: 'enterprise-plus',
    lastLogin: new Date().toISOString(),
  })

  console.log('Updated customer:')
  console.log('  $version:', updated.$version) // Now 2
  console.log('  plan:', updated.plan)
  console.log('  lastLogin:', updated.lastLogin)
  console.log('  name:', updated.name) // Preserved from original
  console.log('')

  // --------------------------------------------------------------------------
  // DELETE
  // --------------------------------------------------------------------------

  console.log('--- DELETE ---')

  // Delete returns the deleted entity
  const deleted = manager.delete(order.$id)
  console.log('Deleted order:', deleted?.$id)
  console.log('Order still exists:', manager.has(order.$id))
  console.log('')

  // --------------------------------------------------------------------------
  // DIRTY TRACKING
  // --------------------------------------------------------------------------

  console.log('--- DIRTY TRACKING ---')

  // Check which entities need to be checkpointed
  const dirtyIds = manager.getDirtyEntries()
  console.log('Dirty entries:', dirtyIds.size)
  console.log('Dirty IDs:', Array.from(dirtyIds))

  // After checkpointing to SQLite, mark as clean
  manager.markClean(Array.from(dirtyIds))
  console.log('After marking clean:', manager.getDirtyCount())
  console.log('')

  // --------------------------------------------------------------------------
  // STATISTICS
  // --------------------------------------------------------------------------

  console.log('--- STATISTICS ---')
  const stats = manager.getStats()
  console.log('Entry count:', stats.entryCount)
  console.log('Dirty count:', stats.dirtyCount)
  console.log('Estimated bytes:', stats.estimatedBytes)
  console.log('Memory usage ratio:', stats.memoryUsageRatio)
}

// ============================================================================
// BULK OPERATIONS (COLD START RECOVERY)
// ============================================================================

/**
 * Demonstrates bulk loading for cold start recovery.
 *
 * Key concept: loadBulk() does NOT mark entries as dirty because
 * they're being restored from persisted storage.
 */
function bulkLoadExample() {
  console.log('\n=== Bulk Load Example (Cold Start) ===\n')

  const manager = new InMemoryStateManager()

  // Simulate data loaded from SQLite during cold start
  const persistedData = [
    { $id: 'customer_123', $type: 'Customer', $version: 5, name: 'Bob' },
    { $id: 'customer_456', $type: 'Customer', $version: 3, name: 'Carol' },
    { $id: 'order_789', $type: 'Order', $version: 1, total: 150 },
  ]

  // Load in bulk - NOT marked dirty since already persisted
  manager.loadBulk(persistedData)

  console.log('Loaded entries:', manager.size())
  console.log('Dirty after load:', manager.getDirtyCount()) // 0 - not dirty!

  // Now make a change
  manager.update('customer_123', { lastLogin: new Date().toISOString() })
  console.log('Dirty after update:', manager.getDirtyCount()) // 1 - only the changed one
}

// ============================================================================
// TYPE-BASED FILTERING
// ============================================================================

/**
 * Demonstrates exporting entities by type.
 */
function typeFilterExample() {
  console.log('\n=== Type Filter Example ===\n')

  const manager = new InMemoryStateManager()

  // Create mixed entity types
  manager.create({ $type: 'Customer', name: 'Alice' })
  manager.create({ $type: 'Customer', name: 'Bob' })
  manager.create({ $type: 'Order', total: 100 })
  manager.create({ $type: 'Order', total: 200 })
  manager.create({ $type: 'Product', sku: 'ABC123' })

  // Export all
  const all = manager.exportAll()
  console.log('All entities:', all.length)

  // Export by type
  const customers = manager.exportByType('Customer')
  console.log('Customers:', customers.length)
  console.log('Customer names:', customers.map((c) => c.name).join(', '))

  const orders = manager.exportByType('Order')
  console.log('Orders:', orders.length)
  console.log(
    'Order totals:',
    orders.map((o) => o.total).join(', ')
  )
}

// ============================================================================
// RUN EXAMPLES
// ============================================================================

basicCrudExample()
bulkLoadExample()
typeFilterExample()

console.log('\n=== Examples Complete ===')
