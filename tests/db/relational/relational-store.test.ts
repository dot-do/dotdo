/**
 * RelationalStore Tests (RED)
 *
 * These tests define the API for RelationalStore before implementation.
 * They should FAIL until the implementation is complete.
 *
 * Tests cover:
 * - Drizzle schema integration
 * - CRUD with type safety
 * - Joins and transactions
 * - Migrations
 * - CDC event emission
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RelationalStore } from '../../../db/relational'
import { migrate, SchemaEvolution } from '../../../db/relational/migrate'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { eq, and, gt, sql } from 'drizzle-orm'

// =============================================================================
// Test Schema Definitions
// =============================================================================

const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  total: integer('total').notNull(),
  status: text('status').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

const orderItems = sqliteTable('order_items', {
  id: text('id').primaryKey(),
  orderId: text('order_id').references(() => orders.id),
  productId: text('product_id').notNull(),
  quantity: integer('quantity').notNull(),
  price: integer('price').notNull(),
})

// Type inference from schema
type User = typeof users.$inferSelect
type NewUser = typeof users.$inferInsert
type Order = typeof orders.$inferSelect
type NewOrder = typeof orders.$inferInsert

// =============================================================================
// Mock Database
// =============================================================================

// Mock SQLite database for testing (would be DO storage in real implementation)
const createMockDb = () => ({
  run: vi.fn(),
  prepare: vi.fn(),
  exec: vi.fn(),
})

describe('RelationalStore', () => {
  let db: ReturnType<typeof createMockDb>
  let store: RelationalStore<{ users: typeof users; orders: typeof orders; orderItems: typeof orderItems }>

  beforeEach(() => {
    db = createMockDb()
    // This should fail - RelationalStore not yet implemented
    store = new RelationalStore(db as unknown as Parameters<typeof RelationalStore>[0], {
      users,
      orders,
      orderItems,
    })
  })

  // ===========================================================================
  // 1. Drizzle Schema Integration
  // ===========================================================================

  describe('Drizzle Schema Integration', () => {
    it('should accept Drizzle table definitions', () => {
      expect(store).toBeDefined()
      expect(store.schema).toBeDefined()
      expect(store.schema.users).toBe(users)
      expect(store.schema.orders).toBe(orders)
    })

    it('should expose table schemas for introspection', () => {
      const tableNames = Object.keys(store.schema)
      expect(tableNames).toContain('users')
      expect(tableNames).toContain('orders')
      expect(tableNames).toContain('orderItems')
    })

    it('should provide column metadata', () => {
      const userColumns = store.getColumns(users)
      expect(userColumns).toContain('id')
      expect(userColumns).toContain('email')
      expect(userColumns).toContain('name')
      expect(userColumns).toContain('created_at')
    })

    it('should detect foreign key relationships', () => {
      const orderRefs = store.getReferences(orders)
      expect(orderRefs).toHaveLength(1)
      expect(orderRefs[0]).toMatchObject({
        column: 'user_id',
        references: {
          table: 'users',
          column: 'id',
        },
      })
    })

    it('should validate schema constraints', () => {
      const constraints = store.getConstraints(users)
      expect(constraints.primaryKey).toBe('id')
      expect(constraints.unique).toContain('email')
      expect(constraints.notNull).toContain('email')
      expect(constraints.notNull).toContain('name')
    })
  })

  // ===========================================================================
  // 2. CRUD with Type Safety
  // ===========================================================================

  describe('CRUD Operations', () => {
    describe('Insert', () => {
      it('should insert a single row with returning', async () => {
        const newUser: NewUser = {
          id: 'user_123',
          email: 'alice@example.com',
          name: 'Alice',
          createdAt: new Date(),
        }

        const [insertedUser] = await store
          .insert(users)
          .values(newUser)
          .returning()

        expect(insertedUser).toBeDefined()
        expect(insertedUser.id).toBe('user_123')
        expect(insertedUser.email).toBe('alice@example.com')
        expect(insertedUser.name).toBe('Alice')
      })

      it('should insert multiple rows', async () => {
        const newUsers: NewUser[] = [
          { id: 'user_1', email: 'a@example.com', name: 'A', createdAt: new Date() },
          { id: 'user_2', email: 'b@example.com', name: 'B', createdAt: new Date() },
          { id: 'user_3', email: 'c@example.com', name: 'C', createdAt: new Date() },
        ]

        const inserted = await store.insert(users).values(newUsers).returning()

        expect(inserted).toHaveLength(3)
        expect(inserted.map((u) => u.id)).toEqual(['user_1', 'user_2', 'user_3'])
      })

      it('should support insert with onConflict do nothing', async () => {
        const user: NewUser = {
          id: 'user_123',
          email: 'alice@example.com',
          name: 'Alice',
          createdAt: new Date(),
        }

        // First insert
        await store.insert(users).values(user).returning()

        // Duplicate insert should not throw
        const result = await store
          .insert(users)
          .values(user)
          .onConflictDoNothing()
          .returning()

        expect(result).toHaveLength(0)
      })

      it('should support insert with onConflict do update', async () => {
        const user: NewUser = {
          id: 'user_123',
          email: 'alice@example.com',
          name: 'Alice',
          createdAt: new Date(),
        }

        await store.insert(users).values(user).returning()

        const [updated] = await store
          .insert(users)
          .values({ ...user, name: 'Alice Smith' })
          .onConflictDoUpdate({
            target: users.id,
            set: { name: 'Alice Smith' },
          })
          .returning()

        expect(updated.name).toBe('Alice Smith')
      })

      it('should enforce type safety on insert values', () => {
        // @ts-expect-error - missing required field 'email'
        store.insert(users).values({ id: 'user_123', name: 'Alice' })

        // @ts-expect-error - wrong type for 'total' field
        store.insert(orders).values({
          id: 'order_1',
          userId: 'user_1',
          total: 'not a number', // should be integer
          status: 'pending',
          createdAt: new Date(),
        })
      })
    })

    describe('Select', () => {
      it('should select all rows from a table', async () => {
        const allUsers = await store.select().from(users)

        expect(Array.isArray(allUsers)).toBe(true)
      })

      it('should select with where clause', async () => {
        const pendingOrders = await store
          .select()
          .from(orders)
          .where(eq(orders.status, 'pending'))

        expect(Array.isArray(pendingOrders)).toBe(true)
      })

      it('should select specific columns', async () => {
        const userEmails = await store
          .select({ id: users.id, email: users.email })
          .from(users)

        // Should only have id and email, not name
        if (userEmails.length > 0) {
          expect(userEmails[0]).toHaveProperty('id')
          expect(userEmails[0]).toHaveProperty('email')
          expect(userEmails[0]).not.toHaveProperty('name')
        }
      })

      it('should support compound where clauses', async () => {
        const recentPending = await store
          .select()
          .from(orders)
          .where(
            and(
              eq(orders.status, 'pending'),
              gt(orders.total, 100)
            )
          )

        expect(Array.isArray(recentPending)).toBe(true)
      })

      it('should support orderBy', async () => {
        const orderedUsers = await store
          .select()
          .from(users)
          .orderBy(users.createdAt)

        expect(Array.isArray(orderedUsers)).toBe(true)
      })

      it('should support limit and offset', async () => {
        const paginatedUsers = await store
          .select()
          .from(users)
          .limit(10)
          .offset(20)

        expect(Array.isArray(paginatedUsers)).toBe(true)
      })
    })

    describe('Update', () => {
      it('should update rows with set and where', async () => {
        const result = await store
          .update(users)
          .set({ name: 'Alice Smith' })
          .where(eq(users.id, 'user_123'))
          .returning()

        expect(Array.isArray(result)).toBe(true)
      })

      it('should update multiple fields', async () => {
        const result = await store
          .update(orders)
          .set({ status: 'completed', total: 150 })
          .where(eq(orders.id, 'order_123'))
          .returning()

        expect(Array.isArray(result)).toBe(true)
      })

      it('should enforce type safety on set values', () => {
        // @ts-expect-error - wrong type for 'total' field
        store.update(orders).set({ total: 'not a number' })
      })
    })

    describe('Delete', () => {
      it('should delete rows with where clause', async () => {
        const result = await store
          .delete(orders)
          .where(eq(orders.id, 'order_456'))
          .returning()

        expect(Array.isArray(result)).toBe(true)
      })

      it('should support compound delete conditions', async () => {
        const result = await store
          .delete(orders)
          .where(
            and(
              eq(orders.status, 'cancelled'),
              gt(orders.createdAt, new Date('2024-01-01'))
            )
          )
          .returning()

        expect(Array.isArray(result)).toBe(true)
      })
    })
  })

  // ===========================================================================
  // 3. Joins and Transactions
  // ===========================================================================

  describe('Joins', () => {
    it('should support left join', async () => {
      const ordersWithUser = await store
        .select()
        .from(orders)
        .leftJoin(users, eq(orders.userId, users.id))

      expect(Array.isArray(ordersWithUser)).toBe(true)
    })

    it('should support inner join', async () => {
      const ordersWithUser = await store
        .select()
        .from(orders)
        .innerJoin(users, eq(orders.userId, users.id))

      expect(Array.isArray(ordersWithUser)).toBe(true)
    })

    it('should support multiple joins', async () => {
      const fullOrderDetails = await store
        .select()
        .from(orders)
        .leftJoin(users, eq(orders.userId, users.id))
        .leftJoin(orderItems, eq(orders.id, orderItems.orderId))

      expect(Array.isArray(fullOrderDetails)).toBe(true)
    })

    it('should support join with where clause', async () => {
      const pendingOrdersWithUser = await store
        .select()
        .from(orders)
        .leftJoin(users, eq(orders.userId, users.id))
        .where(eq(orders.status, 'pending'))

      expect(Array.isArray(pendingOrdersWithUser)).toBe(true)
    })

    it('should return typed join results', async () => {
      const result = await store
        .select({
          orderId: orders.id,
          orderTotal: orders.total,
          userName: users.name,
          userEmail: users.email,
        })
        .from(orders)
        .leftJoin(users, eq(orders.userId, users.id))

      // Type inference should work
      if (result.length > 0) {
        const first = result[0]
        expect(typeof first.orderId).toBe('string')
        expect(typeof first.orderTotal).toBe('number')
        // userName might be null from left join
        expect(['string', 'object'].includes(typeof first.userName)).toBe(true) // string or null
      }
    })
  })

  describe('Transactions', () => {
    it('should execute operations within a transaction', async () => {
      await store.transaction(async (tx) => {
        await tx.insert(users).values({
          id: 'user_tx_1',
          email: 'tx@example.com',
          name: 'TX User',
          createdAt: new Date(),
        })

        await tx.insert(orders).values({
          id: 'order_tx_1',
          userId: 'user_tx_1',
          total: 100,
          status: 'pending',
          createdAt: new Date(),
        })
      })

      // Verify both were committed
      const user = await store
        .select()
        .from(users)
        .where(eq(users.id, 'user_tx_1'))

      expect(user).toHaveLength(1)
    })

    it('should rollback on error', async () => {
      const initialCount = (await store.select().from(users)).length

      try {
        await store.transaction(async (tx) => {
          await tx.insert(users).values({
            id: 'user_fail',
            email: 'fail@example.com',
            name: 'Fail User',
            createdAt: new Date(),
          })

          throw new Error('Simulated failure')
        })
      } catch {
        // Expected error
      }

      // User should not have been inserted
      const afterCount = (await store.select().from(users)).length
      expect(afterCount).toBe(initialCount)
    })

    it('should support nested transactions (savepoints)', async () => {
      await store.transaction(async (tx) => {
        await tx.insert(users).values({
          id: 'user_outer',
          email: 'outer@example.com',
          name: 'Outer User',
          createdAt: new Date(),
        })

        try {
          await tx.transaction(async (innerTx) => {
            await innerTx.insert(users).values({
              id: 'user_inner',
              email: 'inner@example.com',
              name: 'Inner User',
              createdAt: new Date(),
            })

            throw new Error('Inner failure')
          })
        } catch {
          // Inner transaction rolled back
        }

        // Outer should still work
        await tx.insert(orders).values({
          id: 'order_outer',
          userId: 'user_outer',
          total: 50,
          status: 'pending',
          createdAt: new Date(),
        })
      })

      // Outer user and order should exist, inner user should not
      const outerUser = await store.select().from(users).where(eq(users.id, 'user_outer'))
      const innerUser = await store.select().from(users).where(eq(users.id, 'user_inner'))

      expect(outerUser).toHaveLength(1)
      expect(innerUser).toHaveLength(0)
    })

    it('should isolate transaction from concurrent reads', async () => {
      // Start transaction but don't commit yet
      const txPromise = store.transaction(async (tx) => {
        await tx.insert(users).values({
          id: 'user_isolated',
          email: 'isolated@example.com',
          name: 'Isolated User',
          createdAt: new Date(),
        })

        // Simulate some work
        await new Promise((resolve) => setTimeout(resolve, 50))

        return tx.select().from(users).where(eq(users.id, 'user_isolated'))
      })

      // Read outside transaction should not see uncommitted data
      const outsideRead = await store
        .select()
        .from(users)
        .where(eq(users.id, 'user_isolated'))

      expect(outsideRead).toHaveLength(0)

      // Wait for transaction to complete
      const insideTx = await txPromise
      expect(insideTx).toHaveLength(1)
    })
  })

  // ===========================================================================
  // 4. Migrations
  // ===========================================================================

  describe('Migrations', () => {
    describe('File-based migrations', () => {
      it('should run migrations from folder', async () => {
        await migrate(db as unknown as Parameters<typeof migrate>[0], {
          migrationsFolder: './migrations',
        })

        // Migration tracking table should exist
        expect(db.run).toHaveBeenCalled()
      })

      it('should track migration history', async () => {
        await migrate(db as unknown as Parameters<typeof migrate>[0], {
          migrationsFolder: './migrations',
        })

        const history = await store.getMigrationHistory()
        expect(Array.isArray(history)).toBe(true)
      })

      it('should skip already-applied migrations', async () => {
        await migrate(db as unknown as Parameters<typeof migrate>[0], {
          migrationsFolder: './migrations',
        })

        // Run again
        await migrate(db as unknown as Parameters<typeof migrate>[0], {
          migrationsFolder: './migrations',
        })

        // Should not re-run migrations
        const history = await store.getMigrationHistory()
        const uniqueVersions = new Set(history.map((m: { version: number }) => m.version))
        expect(history.length).toBe(uniqueVersions.size)
      })
    })

    describe('Inline migrations', () => {
      it('should run inline migration with up/down', async () => {
        await store.migrate({
          version: 2,
          up: async (db) => {
            await db.run(sql`ALTER TABLE users ADD COLUMN avatar_url TEXT`)
          },
          down: async (db) => {
            await db.run(sql`ALTER TABLE users DROP COLUMN avatar_url`)
          },
        })

        // Verify column was added
        const columns = store.getColumns(users)
        // Note: this would need schema refresh in real implementation
        expect(columns).toContain('avatar_url')
      })

      it('should support migration rollback', async () => {
        // Apply migration
        await store.migrate({
          version: 3,
          up: async (db) => {
            await db.run(sql`ALTER TABLE orders ADD COLUMN notes TEXT`)
          },
          down: async (db) => {
            await db.run(sql`ALTER TABLE orders DROP COLUMN notes`)
          },
        })

        // Rollback
        await store.rollback(3)

        const columns = store.getColumns(orders)
        expect(columns).not.toContain('notes')
      })

      it('should validate migration version ordering', async () => {
        await store.migrate({
          version: 5,
          up: async () => {},
          down: async () => {},
        })

        // Trying to apply an earlier version should fail
        await expect(
          store.migrate({
            version: 4,
            up: async () => {},
            down: async () => {},
          })
        ).rejects.toThrow(/migration version 4 is less than current version 5/i)
      })
    })

    describe('Schema Evolution', () => {
      it('should check backward compatibility', async () => {
        const evolution = new SchemaEvolution(db as unknown as Parameters<typeof SchemaEvolution>[0], {
          mode: 'BACKWARD',
        })

        // Adding a nullable column is backward compatible
        const addNullable = await evolution.checkCompatibility({
          type: 'ADD_COLUMN',
          table: 'users',
          column: { name: 'nickname', type: 'TEXT', nullable: true },
        })
        expect(addNullable.ok).toBe(true)

        // Adding a required column is NOT backward compatible
        const addRequired = await evolution.checkCompatibility({
          type: 'ADD_COLUMN',
          table: 'users',
          column: { name: 'required_field', type: 'TEXT', nullable: false },
        })
        expect(addRequired.ok).toBe(false)
        expect(addRequired.errors).toContain('required column breaks backward compatibility')
      })

      it('should check forward compatibility', async () => {
        const evolution = new SchemaEvolution(db as unknown as Parameters<typeof SchemaEvolution>[0], {
          mode: 'FORWARD',
        })

        // Removing a column is forward compatible
        const removeColumn = await evolution.checkCompatibility({
          type: 'DROP_COLUMN',
          table: 'users',
          column: 'nickname',
        })
        expect(removeColumn.ok).toBe(true)

        // Renaming a column is NOT forward compatible
        const renameColumn = await evolution.checkCompatibility({
          type: 'RENAME_COLUMN',
          table: 'users',
          from: 'name',
          to: 'full_name',
        })
        expect(renameColumn.ok).toBe(false)
      })

      it('should check full (bidirectional) compatibility', async () => {
        const evolution = new SchemaEvolution(db as unknown as Parameters<typeof SchemaEvolution>[0], {
          mode: 'FULL',
        })

        // Only additive, optional changes are fully compatible
        const addOptional = await evolution.checkCompatibility({
          type: 'ADD_COLUMN',
          table: 'users',
          column: { name: 'bio', type: 'TEXT', nullable: true, default: '' },
        })
        expect(addOptional.ok).toBe(true)
      })
    })
  })

  // ===========================================================================
  // 5. CDC Event Emission
  // ===========================================================================

  describe('CDC Events', () => {
    let emittedEvents: unknown[]

    beforeEach(() => {
      emittedEvents = []
      store.onCDCEvent((event) => {
        emittedEvents.push(event)
      })
    })

    it('should emit insert event', async () => {
      await store
        .insert(users)
        .values({
          id: 'user_cdc_1',
          email: 'cdc@example.com',
          name: 'CDC User',
          createdAt: new Date(),
        })
        .returning()

      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toMatchObject({
        type: 'cdc.insert',
        op: 'c',
        store: 'relational',
        table: 'users',
        key: 'user_cdc_1',
        after: expect.objectContaining({
          id: 'user_cdc_1',
          email: 'cdc@example.com',
          name: 'CDC User',
        }),
      })
    })

    it('should emit update event with before/after', async () => {
      // Insert first
      await store
        .insert(users)
        .values({
          id: 'user_cdc_2',
          email: 'update@example.com',
          name: 'Original Name',
          createdAt: new Date(),
        })
        .returning()

      emittedEvents = [] // Reset

      // Update
      await store
        .update(users)
        .set({ name: 'Updated Name' })
        .where(eq(users.id, 'user_cdc_2'))
        .returning()

      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toMatchObject({
        type: 'cdc.update',
        op: 'u',
        store: 'relational',
        table: 'users',
        key: 'user_cdc_2',
        before: expect.objectContaining({
          name: 'Original Name',
        }),
        after: expect.objectContaining({
          name: 'Updated Name',
        }),
      })
    })

    it('should emit delete event with before', async () => {
      // Insert first
      await store
        .insert(users)
        .values({
          id: 'user_cdc_3',
          email: 'delete@example.com',
          name: 'To Be Deleted',
          createdAt: new Date(),
        })
        .returning()

      emittedEvents = [] // Reset

      // Delete
      await store
        .delete(users)
        .where(eq(users.id, 'user_cdc_3'))
        .returning()

      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toMatchObject({
        type: 'cdc.delete',
        op: 'd',
        store: 'relational',
        table: 'users',
        key: 'user_cdc_3',
        before: expect.objectContaining({
          id: 'user_cdc_3',
          email: 'delete@example.com',
        }),
      })
    })

    it('should emit events for batch operations', async () => {
      await store
        .insert(users)
        .values([
          { id: 'batch_1', email: 'a@test.com', name: 'A', createdAt: new Date() },
          { id: 'batch_2', email: 'b@test.com', name: 'B', createdAt: new Date() },
          { id: 'batch_3', email: 'c@test.com', name: 'C', createdAt: new Date() },
        ])
        .returning()

      expect(emittedEvents).toHaveLength(3)
      expect(emittedEvents.map((e: { key?: string }) => e.key)).toEqual(['batch_1', 'batch_2', 'batch_3'])
    })

    it('should include sequence number for ordering', async () => {
      await store.insert(users).values({
        id: 'seq_1',
        email: 'seq@test.com',
        name: 'Seq',
        createdAt: new Date(),
      })

      await store.update(users).set({ name: 'Seq Updated' }).where(eq(users.id, 'seq_1'))

      expect(emittedEvents).toHaveLength(2)

      const insertEvent = emittedEvents[0] as { seq?: number }
      const updateEvent = emittedEvents[1] as { seq?: number }

      expect(typeof insertEvent.seq).toBe('number')
      expect(typeof updateEvent.seq).toBe('number')
      expect(updateEvent.seq).toBeGreaterThan(insertEvent.seq!)
    })

    it('should emit events within transactions atomically', async () => {
      await store.transaction(async (tx) => {
        await tx.insert(users).values({
          id: 'tx_event_1',
          email: 'tx@test.com',
          name: 'TX',
          createdAt: new Date(),
        })

        await tx.insert(orders).values({
          id: 'tx_order_1',
          userId: 'tx_event_1',
          total: 100,
          status: 'pending',
          createdAt: new Date(),
        })
      })

      // All events should have same transaction ID
      const txIds = new Set(emittedEvents.map((e: { txId?: string }) => e.txId))
      expect(txIds.size).toBe(1)
    })

    it('should not emit events for rolled back transactions', async () => {
      try {
        await store.transaction(async (tx) => {
          await tx.insert(users).values({
            id: 'rollback_user',
            email: 'rollback@test.com',
            name: 'Rollback',
            createdAt: new Date(),
          })

          throw new Error('Force rollback')
        })
      } catch {
        // Expected
      }

      // No events should have been emitted for the rolled back insert
      const rollbackEvents = emittedEvents.filter((e: { key?: string }) => e.key === 'rollback_user')
      expect(rollbackEvents).toHaveLength(0)
    })

    it('should include timestamp in events', async () => {
      const before = Date.now()

      await store.insert(users).values({
        id: 'time_1',
        email: 'time@test.com',
        name: 'Time',
        createdAt: new Date(),
      })

      const after = Date.now()

      const event = emittedEvents[0] as { ts?: number }
      expect(event.ts).toBeGreaterThanOrEqual(before)
      expect(event.ts).toBeLessThanOrEqual(after)
    })
  })

  // ===========================================================================
  // Additional Integration Tests
  // ===========================================================================

  describe('Raw SQL Support', () => {
    it('should support raw SQL queries', async () => {
      const result = await store.execute(sql`SELECT COUNT(*) as count FROM users`)
      expect(result).toBeDefined()
    })

    it('should support parameterized raw SQL', async () => {
      const status = 'pending'
      const result = await store.execute(sql`SELECT * FROM orders WHERE status = ${status}`)
      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('Aggregate Functions', () => {
    it('should support count', async () => {
      const [result] = await store
        .select({ count: sql<number>`COUNT(*)` })
        .from(users)

      expect(typeof result.count).toBe('number')
    })

    it('should support sum', async () => {
      const [result] = await store
        .select({ total: sql<number>`SUM(${orders.total})` })
        .from(orders)
        .where(eq(orders.status, 'completed'))

      expect(typeof result.total).toBe('number')
    })

    it('should support group by', async () => {
      const result = await store
        .select({
          status: orders.status,
          count: sql<number>`COUNT(*)`,
          total: sql<number>`SUM(${orders.total})`,
        })
        .from(orders)
        .groupBy(orders.status)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('Subqueries', () => {
    it('should support subqueries in where clause', async () => {
      const highValueUsers = await store
        .select()
        .from(users)
        .where(
          sql`${users.id} IN (
            SELECT ${orders.userId} FROM orders WHERE ${orders.total} > 1000
          )`
        )

      expect(Array.isArray(highValueUsers)).toBe(true)
    })
  })
})
