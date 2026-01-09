import { describe, it, expect, beforeEach } from 'vitest'
import { createPayloadAdapterHarness } from '../../../src'
import type { PayloadAdapterHarness } from '../../../src'

/**
 * PayloadAdapter Migration Operations Tests
 *
 * These tests verify the adapter's migration operations, including:
 * - Running pending migrations (migrate)
 * - Checking migration status (migrate:status)
 * - Rolling back migrations (migrate:down)
 * - Refreshing migrations (migrate:refresh)
 * - Creating new migrations (migrate:create)
 * - Fresh migrations (migrate:fresh)
 * - Migration hooks (beforeSchemaInit, afterSchemaInit)
 * - Transaction safety and error handling
 *
 * Payload CMS migrations are critical for managing database schema changes
 * in production environments. All database adapters implement similar patterns
 * with adapter-specific variations.
 *
 * Reference: Payload CMS Migration Documentation
 * https://payloadcms.com/docs/database/migrations
 *
 * This is RED phase TDD - tests should FAIL until migrations are implemented.
 */

// ============================================================================
// TEST FIXTURES
// ============================================================================

/** Sample migration definition */
interface Migration {
  name: string
  timestamp: number
  batch?: number
  up: () => Promise<void>
  down: () => Promise<void>
}

/** Sample migration for creating a posts table */
const createPostsMigration: Migration = {
  name: '20260109_create_posts_table',
  timestamp: Date.parse('2026-01-09T00:00:00Z'),
  up: async () => {
    // Would execute: CREATE TABLE posts (...)
  },
  down: async () => {
    // Would execute: DROP TABLE posts
  },
}

/** Sample migration for adding a views column */
const addViewsColumnMigration: Migration = {
  name: '20260109_add_views_column',
  timestamp: Date.parse('2026-01-09T01:00:00Z'),
  up: async () => {
    // Would execute: ALTER TABLE posts ADD COLUMN views INTEGER
  },
  down: async () => {
    // Would execute: ALTER TABLE posts DROP COLUMN views
  },
}

/** Sample migration for adding an index */
const addSlugIndexMigration: Migration = {
  name: '20260109_add_slug_index',
  timestamp: Date.parse('2026-01-09T02:00:00Z'),
  up: async () => {
    // Would execute: CREATE INDEX idx_posts_slug ON posts(slug)
  },
  down: async () => {
    // Would execute: DROP INDEX idx_posts_slug
  },
}

/** Sample migration for adding categories table */
const createCategoriesMigration: Migration = {
  name: '20260110_create_categories',
  timestamp: Date.parse('2026-01-10T00:00:00Z'),
  up: async () => {
    // Would execute: CREATE TABLE categories (...)
  },
  down: async () => {
    // Would execute: DROP TABLE categories
  },
}

// ============================================================================
// MIGRATION OPERATIONS TESTS
// ============================================================================

describe('PayloadAdapter Migration Operations', () => {
  let harness: PayloadAdapterHarness

  beforeEach(() => {
    harness = createPayloadAdapterHarness({
      namespace: 'https://test.do',
    })
  })

  // ==========================================================================
  // migrate - Run pending migrations
  // ==========================================================================

  describe('migrate', () => {
    it('should expose migrate method', () => {
      const adapter = harness.adapter as any

      expect(adapter.migrate).toBeDefined()
      expect(typeof adapter.migrate).toBe('function')
    })

    it('should run all pending migrations', async () => {
      const adapter = harness.adapter as any

      // Register migrations
      adapter.registerMigrations([
        createPostsMigration,
        addViewsColumnMigration,
      ])

      // Run migrate
      const result = await adapter.migrate()

      expect(result).toBeDefined()
      expect(result.ran).toHaveLength(2)
      expect(result.ran[0].name).toBe('20260109_create_posts_table')
      expect(result.ran[1].name).toBe('20260109_add_views_column')
    })

    it('should run migrations in timestamp order', async () => {
      const adapter = harness.adapter as any

      // Register migrations out of order
      adapter.registerMigrations([
        addSlugIndexMigration, // timestamp: 02:00
        createPostsMigration, // timestamp: 00:00
        addViewsColumnMigration, // timestamp: 01:00
      ])

      const result = await adapter.migrate()

      expect(result.ran).toHaveLength(3)
      expect(result.ran[0].name).toBe('20260109_create_posts_table')
      expect(result.ran[1].name).toBe('20260109_add_views_column')
      expect(result.ran[2].name).toBe('20260109_add_slug_index')
    })

    it('should skip already-run migrations', async () => {
      const adapter = harness.adapter as any

      // Register and run initial migrations
      adapter.registerMigrations([createPostsMigration])
      await adapter.migrate()

      // Register more migrations
      adapter.registerMigrations([addViewsColumnMigration, addSlugIndexMigration])

      // Run migrate again
      const result = await adapter.migrate()

      // Should only run new migrations
      expect(result.ran).toHaveLength(2)
      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0].name).toBe('20260109_create_posts_table')
    })

    it('should record migration in migrations table', async () => {
      const adapter = harness.adapter as any

      adapter.registerMigrations([createPostsMigration])
      await adapter.migrate()

      // Check migrations table
      const history = await adapter.getMigrationHistory()

      expect(history).toHaveLength(1)
      expect(history[0].name).toBe('20260109_create_posts_table')
      expect(history[0].batch).toBe(1)
      expect(history[0].ranAt).toBeDefined()
    })

    it('should assign batch number to migrations run together', async () => {
      const adapter = harness.adapter as any

      // First batch
      adapter.registerMigrations([createPostsMigration, addViewsColumnMigration])
      await adapter.migrate()

      // Second batch
      adapter.registerMigrations([addSlugIndexMigration, createCategoriesMigration])
      await adapter.migrate()

      const history = await adapter.getMigrationHistory()

      // First batch
      const batch1 = history.filter((m: any) => m.batch === 1)
      expect(batch1).toHaveLength(2)

      // Second batch
      const batch2 = history.filter((m: any) => m.batch === 2)
      expect(batch2).toHaveLength(2)
    })

    it('should return empty result when no pending migrations', async () => {
      const adapter = harness.adapter as any

      adapter.registerMigrations([createPostsMigration])
      await adapter.migrate()

      // Run again
      const result = await adapter.migrate()

      expect(result.ran).toHaveLength(0)
      expect(result.pending).toHaveLength(0)
    })

    it('should handle migration with no up function gracefully', async () => {
      const adapter = harness.adapter as any

      const emptyMigration = {
        name: '20260109_empty',
        timestamp: Date.now(),
        up: async () => {},
        down: async () => {},
      }

      adapter.registerMigrations([emptyMigration])

      const result = await adapter.migrate()

      expect(result.ran).toHaveLength(1)
    })
  })

  // ==========================================================================
  // migrate:status - Check migration status
  // ==========================================================================

  describe('migrateStatus', () => {
    it('should expose migrateStatus method', () => {
      const adapter = harness.adapter as any

      expect(adapter.migrateStatus).toBeDefined()
      expect(typeof adapter.migrateStatus).toBe('function')
    })

    it('should return status of all migrations', async () => {
      const adapter = harness.adapter as any

      adapter.registerMigrations([
        createPostsMigration,
        addViewsColumnMigration,
        addSlugIndexMigration,
      ])

      // Run only first migration
      await adapter.migrate({ only: '20260109_create_posts_table' })

      const status = await adapter.migrateStatus()

      expect(status.total).toBe(3)
      expect(status.ran).toBe(1)
      expect(status.pending).toBe(2)
    })

    it('should include migration details in status', async () => {
      const adapter = harness.adapter as any

      adapter.registerMigrations([createPostsMigration, addViewsColumnMigration])
      await adapter.migrate()

      const status = await adapter.migrateStatus()

      expect(status.migrations).toBeDefined()
      expect(status.migrations).toHaveLength(2)

      const first = status.migrations[0]
      expect(first.name).toBe('20260109_create_posts_table')
      expect(first.status).toBe('ran')
      expect(first.batch).toBe(1)
      expect(first.ranAt).toBeDefined()
    })

    it('should mark pending migrations correctly', async () => {
      const adapter = harness.adapter as any

      adapter.registerMigrations([
        createPostsMigration,
        addViewsColumnMigration,
      ])

      // Don't run any migrations
      const status = await adapter.migrateStatus()

      expect(status.migrations.every((m: any) => m.status === 'pending')).toBe(true)
    })

    it('should return empty status when no migrations registered', async () => {
      const adapter = harness.adapter as any

      const status = await adapter.migrateStatus()

      expect(status.total).toBe(0)
      expect(status.ran).toBe(0)
      expect(status.pending).toBe(0)
      expect(status.migrations).toHaveLength(0)
    })
  })

  // ==========================================================================
  // migrate:down - Roll back last batch
  // ==========================================================================

  describe('migrateDown', () => {
    it('should expose migrateDown method', () => {
      const adapter = harness.adapter as any

      expect(adapter.migrateDown).toBeDefined()
      expect(typeof adapter.migrateDown).toBe('function')
    })

    it('should roll back the last batch of migrations', async () => {
      const adapter = harness.adapter as any

      // Run first batch
      adapter.registerMigrations([createPostsMigration, addViewsColumnMigration])
      await adapter.migrate()

      // Run second batch
      adapter.registerMigrations([addSlugIndexMigration])
      await adapter.migrate()

      // Roll back last batch
      const result = await adapter.migrateDown()

      expect(result.rolledBack).toHaveLength(1)
      expect(result.rolledBack[0].name).toBe('20260109_add_slug_index')

      // Check status
      const status = await adapter.migrateStatus()
      expect(status.ran).toBe(2) // First batch still applied
      expect(status.pending).toBe(1) // Last migration now pending
    })

    it('should roll back migrations in reverse order', async () => {
      const adapter = harness.adapter as any
      const executionOrder: string[] = []

      const migration1 = {
        ...createPostsMigration,
        down: async () => {
          executionOrder.push('posts_down')
        },
      }

      const migration2 = {
        ...addViewsColumnMigration,
        down: async () => {
          executionOrder.push('views_down')
        },
      }

      adapter.registerMigrations([migration1, migration2])
      await adapter.migrate()

      await adapter.migrateDown()

      // Should roll back in reverse order (views first, then posts)
      expect(executionOrder).toEqual(['views_down', 'posts_down'])
    })

    it('should remove migration records from history', async () => {
      const adapter = harness.adapter as any

      adapter.registerMigrations([createPostsMigration])
      await adapter.migrate()

      expect((await adapter.getMigrationHistory()).length).toBe(1)

      await adapter.migrateDown()

      expect((await adapter.getMigrationHistory()).length).toBe(0)
    })

    it('should return empty result when no migrations to roll back', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.migrateDown()

      expect(result.rolledBack).toHaveLength(0)
    })

    it('should support rolling back specific number of steps', async () => {
      const adapter = harness.adapter as any

      adapter.registerMigrations([
        createPostsMigration,
        addViewsColumnMigration,
        addSlugIndexMigration,
      ])
      await adapter.migrate()

      // Roll back 2 steps
      const result = await adapter.migrateDown({ steps: 2 })

      expect(result.rolledBack).toHaveLength(2)
      expect(result.rolledBack[0].name).toBe('20260109_add_slug_index')
      expect(result.rolledBack[1].name).toBe('20260109_add_views_column')

      const status = await adapter.migrateStatus()
      expect(status.ran).toBe(1)
    })
  })

  // ==========================================================================
  // migrate:refresh - Roll back and re-run all
  // ==========================================================================

  describe('migrateRefresh', () => {
    it('should expose migrateRefresh method', () => {
      const adapter = harness.adapter as any

      expect(adapter.migrateRefresh).toBeDefined()
      expect(typeof adapter.migrateRefresh).toBe('function')
    })

    it('should roll back all and re-run migrations', async () => {
      const adapter = harness.adapter as any
      const executionOrder: string[] = []

      const migration1 = {
        ...createPostsMigration,
        up: async () => {
          executionOrder.push('posts_up')
        },
        down: async () => {
          executionOrder.push('posts_down')
        },
      }

      const migration2 = {
        ...addViewsColumnMigration,
        up: async () => {
          executionOrder.push('views_up')
        },
        down: async () => {
          executionOrder.push('views_down')
        },
      }

      adapter.registerMigrations([migration1, migration2])
      await adapter.migrate()

      executionOrder.length = 0 // Clear execution order

      await adapter.migrateRefresh()

      // Should roll back in reverse, then re-run in order
      expect(executionOrder).toEqual([
        'views_down',
        'posts_down',
        'posts_up',
        'views_up',
      ])
    })

    it('should reset batch numbers after refresh', async () => {
      const adapter = harness.adapter as any

      // Run in two batches
      adapter.registerMigrations([createPostsMigration])
      await adapter.migrate()

      adapter.registerMigrations([addViewsColumnMigration])
      await adapter.migrate()

      // Refresh
      await adapter.migrateRefresh()

      const history = await adapter.getMigrationHistory()

      // All should be in batch 1 now
      expect(history.every((m: any) => m.batch === 1)).toBe(true)
    })

    it('should return refresh result', async () => {
      const adapter = harness.adapter as any

      adapter.registerMigrations([createPostsMigration, addViewsColumnMigration])
      await adapter.migrate()

      const result = await adapter.migrateRefresh()

      expect(result.rolledBack).toHaveLength(2)
      expect(result.ran).toHaveLength(2)
    })

    it('should handle empty migration list', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.migrateRefresh()

      expect(result.rolledBack).toHaveLength(0)
      expect(result.ran).toHaveLength(0)
    })
  })

  // ==========================================================================
  // migrate:fresh - Drop all and re-run
  // ==========================================================================

  describe('migrateFresh', () => {
    it('should expose migrateFresh method', () => {
      const adapter = harness.adapter as any

      expect(adapter.migrateFresh).toBeDefined()
      expect(typeof adapter.migrateFresh).toBe('function')
    })

    it('should drop all entities and re-run migrations', async () => {
      const adapter = harness.adapter as any

      // Create some data
      await adapter.create({
        collection: 'posts',
        data: { title: 'Test Post', slug: 'test-post' },
      })

      adapter.registerMigrations([createPostsMigration])
      await adapter.migrate()

      // Fresh should drop everything
      const result = await adapter.migrateFresh()

      expect(result.dropped).toBe(true)
      expect(result.ran).toHaveLength(1)

      // Data should be gone
      const posts = await adapter.find({ collection: 'posts' })
      expect(posts.docs).toHaveLength(0)
    })

    it('should clear migration history before running', async () => {
      const adapter = harness.adapter as any

      adapter.registerMigrations([createPostsMigration, addViewsColumnMigration])
      await adapter.migrate()

      const beforeHistory = await adapter.getMigrationHistory()
      expect(beforeHistory).toHaveLength(2)

      await adapter.migrateFresh()

      const afterHistory = await adapter.getMigrationHistory()
      // Should have new history (re-run migrations)
      expect(afterHistory).toHaveLength(2)
      // But batch should be reset to 1
      expect(afterHistory.every((m: any) => m.batch === 1)).toBe(true)
    })

    it('should call drop hooks', async () => {
      const adapter = harness.adapter as any
      let dropCalled = false

      adapter.hooks = {
        beforeFresh: async () => {
          dropCalled = true
        },
      }

      adapter.registerMigrations([createPostsMigration])
      await adapter.migrateFresh()

      expect(dropCalled).toBe(true)
    })

    it('should support --seed option', async () => {
      const adapter = harness.adapter as any
      let seedCalled = false

      adapter.registerMigrations([createPostsMigration])
      adapter.setSeedFunction(async () => {
        seedCalled = true
      })

      await adapter.migrateFresh({ seed: true })

      expect(seedCalled).toBe(true)
    })
  })

  // ==========================================================================
  // migrate:create - Create new migration file
  // ==========================================================================

  describe('migrateCreate', () => {
    it('should expose migrateCreate method', () => {
      const adapter = harness.adapter as any

      expect(adapter.migrateCreate).toBeDefined()
      expect(typeof adapter.migrateCreate).toBe('function')
    })

    it('should create a new migration with timestamp', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.migrateCreate({ name: 'add_users_table' })

      expect(result).toBeDefined()
      expect(result.name).toMatch(/^\d{8}_\d{6}_add_users_table$/)
      expect(result.path).toBeDefined()
    })

    it('should generate migration template', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.migrateCreate({ name: 'add_users_table' })

      expect(result.template).toBeDefined()
      expect(result.template).toContain('up')
      expect(result.template).toContain('down')
    })

    it('should use custom migration directory', async () => {
      const adapter = harness.adapter as any

      // Set custom migration directory
      adapter.setMigrationDir('/custom/migrations')

      const result = await adapter.migrateCreate({ name: 'test_migration' })

      expect(result.path).toContain('/custom/migrations')
    })

    it('should sanitize migration name', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.migrateCreate({ name: 'Add Users Table!!' })

      expect(result.name).toMatch(/add_users_table/)
      expect(result.name).not.toContain(' ')
      expect(result.name).not.toContain('!')
    })

    it('should support blank migration', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.migrateCreate({ name: 'custom', blank: true })

      expect(result.template).not.toContain('sql')
      expect(result.template).toContain('up')
      expect(result.template).toContain('down')
    })
  })

  // ==========================================================================
  // Migration Directory Configuration
  // ==========================================================================

  describe('migration directory', () => {
    it('should use default migration directory', async () => {
      const adapter = harness.adapter as any

      const dir = adapter.getMigrationDir()

      // Should be one of the common locations
      expect(dir).toMatch(/migrations/)
    })

    it('should allow setting custom migration directory', async () => {
      const adapter = harness.adapter as any

      adapter.setMigrationDir('/app/database/migrations')

      const dir = adapter.getMigrationDir()
      expect(dir).toBe('/app/database/migrations')
    })

    it('should search common locations for migrations', async () => {
      const adapter = harness.adapter as any

      const searchPaths = adapter.getMigrationSearchPaths()

      expect(searchPaths).toContain('./src/migrations')
      expect(searchPaths).toContain('./dist/migrations')
      expect(searchPaths).toContain('./migrations')
    })

    it('should auto-discover migrations from directory', async () => {
      const adapter = harness.adapter as any

      // Mock migration files in directory
      adapter.setMigrationFiles([
        { name: '20260109_001_create_posts', path: '/migrations/20260109_001_create_posts.ts' },
        { name: '20260109_002_add_views', path: '/migrations/20260109_002_add_views.ts' },
      ])

      const discovered = await adapter.discoverMigrations()

      expect(discovered).toHaveLength(2)
      expect(discovered[0].name).toBe('20260109_001_create_posts')
    })
  })

  // ==========================================================================
  // Schema Hooks
  // ==========================================================================

  describe('schema hooks', () => {
    describe('beforeSchemaInit', () => {
      it('should call beforeSchemaInit before building schema', async () => {
        const adapter = harness.adapter as any
        const callOrder: string[] = []

        adapter.hooks = {
          beforeSchemaInit: async ({ schema }: { schema: any }) => {
            callOrder.push('beforeSchemaInit')
            return schema
          },
        }

        adapter.registerMigrations([createPostsMigration])
        await adapter.migrate()

        expect(callOrder[0]).toBe('beforeSchemaInit')
      })

      it('should allow extending schema with custom tables', async () => {
        const adapter = harness.adapter as any
        let customTableAdded = false

        adapter.hooks = {
          beforeSchemaInit: async ({ schema, extendTable }: { schema: any; extendTable: any }) => {
            // Add custom table not managed by Payload
            extendTable('audit_logs', {
              id: 'serial primary key',
              action: 'text not null',
              timestamp: 'timestamp default now()',
            })
            customTableAdded = true
            return schema
          },
        }

        await adapter.initSchema()

        expect(customTableAdded).toBe(true)
      })

      it('should receive Drizzle schema in hook', async () => {
        const adapter = harness.adapter as any
        let receivedSchema: any

        adapter.hooks = {
          beforeSchemaInit: async ({ schema }: { schema: any }) => {
            receivedSchema = schema
            return schema
          },
        }

        await adapter.initSchema()

        expect(receivedSchema).toBeDefined()
      })
    })

    describe('afterSchemaInit', () => {
      it('should call afterSchemaInit after building schema', async () => {
        const adapter = harness.adapter as any
        const callOrder: string[] = []

        adapter.hooks = {
          beforeSchemaInit: async ({ schema }: { schema: any }) => {
            callOrder.push('beforeSchemaInit')
            return schema
          },
          afterSchemaInit: async ({ schema }: { schema: any }) => {
            callOrder.push('afterSchemaInit')
            return schema
          },
        }

        await adapter.initSchema()

        expect(callOrder).toEqual(['beforeSchemaInit', 'afterSchemaInit'])
      })

      it('should allow modifying schema after init', async () => {
        const adapter = harness.adapter as any
        let columnsAdded = false

        adapter.hooks = {
          afterSchemaInit: async ({ schema, addColumn }: { schema: any; addColumn: any }) => {
            // Add custom column not in Payload config
            addColumn('posts', 'custom_field', 'text')
            columnsAdded = true
            return schema
          },
        }

        await adapter.initSchema()

        expect(columnsAdded).toBe(true)
      })

      it('should receive final schema in hook', async () => {
        const adapter = harness.adapter as any
        let finalSchema: any

        adapter.hooks = {
          afterSchemaInit: async ({ schema }: { schema: any }) => {
            finalSchema = schema
            return schema
          },
        }

        await adapter.initSchema()

        expect(finalSchema).toBeDefined()
      })
    })
  })

  // ==========================================================================
  // Transaction Safety
  // ==========================================================================

  describe('transaction safety', () => {
    it('should run each migration in a transaction', async () => {
      const adapter = harness.adapter as any
      let transactionStarted = false
      let transactionCommitted = false

      const migrationWithTx = {
        ...createPostsMigration,
        up: async () => {
          // Check if we're in a transaction
          const inTx = await adapter.isInTransaction()
          transactionStarted = inTx
        },
      }

      adapter.registerMigrations([migrationWithTx])
      adapter.on('transactionCommit', () => {
        transactionCommitted = true
      })

      await adapter.migrate()

      expect(transactionStarted).toBe(true)
      expect(transactionCommitted).toBe(true)
    })

    it('should rollback on migration failure', async () => {
      const adapter = harness.adapter as any

      const failingMigration = {
        name: '20260109_failing',
        timestamp: Date.now(),
        up: async () => {
          throw new Error('Migration failed!')
        },
        down: async () => {},
      }

      adapter.registerMigrations([createPostsMigration, failingMigration])

      await expect(adapter.migrate()).rejects.toThrow('Migration failed!')

      // First migration should also be rolled back
      const status = await adapter.migrateStatus()
      expect(status.ran).toBe(0)
    })

    it('should not record failed migration in history', async () => {
      const adapter = harness.adapter as any

      const failingMigration = {
        name: '20260109_failing',
        timestamp: Date.now(),
        up: async () => {
          throw new Error('Failed!')
        },
        down: async () => {},
      }

      adapter.registerMigrations([failingMigration])

      try {
        await adapter.migrate()
      } catch {
        // Expected to fail
      }

      const history = await adapter.getMigrationHistory()
      expect(history).toHaveLength(0)
    })

    it('should support manual transaction control', async () => {
      const adapter = harness.adapter as any

      adapter.registerMigrations([createPostsMigration, addViewsColumnMigration])

      // Run with manual transaction control
      const result = await adapter.migrate({
        transaction: false, // Don't auto-wrap in transaction
      })

      expect(result.ran).toHaveLength(2)
    })
  })

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    it('should throw descriptive error for missing migration', async () => {
      const adapter = harness.adapter as any

      // Try to roll back non-existent migration
      await expect(
        adapter.migrateDown({ migration: 'non_existent_migration' })
      ).rejects.toThrow(/not found|does not exist/i)
    })

    it('should throw error for duplicate migration names', async () => {
      const adapter = harness.adapter as any

      const duplicate1 = { ...createPostsMigration }
      const duplicate2 = { ...createPostsMigration }

      expect(() => {
        adapter.registerMigrations([duplicate1, duplicate2])
      }).toThrow(/duplicate|already registered/i)
    })

    it('should handle missing down function gracefully', async () => {
      const adapter = harness.adapter as any

      const noDownMigration = {
        name: '20260109_no_down',
        timestamp: Date.now(),
        up: async () => {},
        // No down function
      }

      adapter.registerMigrations([noDownMigration])
      await adapter.migrate()

      await expect(adapter.migrateDown()).rejects.toThrow(/no down|cannot rollback/i)
    })

    it('should provide detailed error context', async () => {
      const adapter = harness.adapter as any

      const failingMigration = {
        name: '20260109_detailed_error',
        timestamp: Date.now(),
        up: async () => {
          const error = new Error('SQL syntax error near "SELEC"')
          ;(error as any).sql = 'SELEC * FROM posts'
          ;(error as any).code = 'SQLITE_ERROR'
          throw error
        },
        down: async () => {},
      }

      adapter.registerMigrations([failingMigration])

      try {
        await adapter.migrate()
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.migration).toBe('20260109_detailed_error')
        expect(error.sql).toBeDefined()
        expect(error.code).toBeDefined()
      }
    })

    it('should support continuing on error with force flag', async () => {
      const adapter = harness.adapter as any
      const ranMigrations: string[] = []

      const failingMigration = {
        name: '20260109_001_failing',
        timestamp: Date.parse('2026-01-09T00:00:00Z'),
        up: async () => {
          throw new Error('Failed!')
        },
        down: async () => {},
      }

      const successMigration = {
        name: '20260109_002_success',
        timestamp: Date.parse('2026-01-09T01:00:00Z'),
        up: async () => {
          ranMigrations.push('success')
        },
        down: async () => {},
      }

      adapter.registerMigrations([failingMigration, successMigration])

      const result = await adapter.migrate({ force: true })

      expect(result.errors).toHaveLength(1)
      expect(result.ran).toHaveLength(1)
      expect(ranMigrations).toContain('success')
    })
  })

  // ==========================================================================
  // Dry Run
  // ==========================================================================

  describe('dry run', () => {
    it('should support dry run mode', async () => {
      const adapter = harness.adapter as any

      adapter.registerMigrations([createPostsMigration, addViewsColumnMigration])

      const result = await adapter.migrate({ dryRun: true })

      expect(result.ran).toHaveLength(0)
      expect(result.wouldRun).toHaveLength(2)
    })

    it('should not modify database in dry run', async () => {
      const adapter = harness.adapter as any

      adapter.registerMigrations([createPostsMigration])
      await adapter.migrate({ dryRun: true })

      const status = await adapter.migrateStatus()
      expect(status.ran).toBe(0)
      expect(status.pending).toBe(1)
    })

    it('should show SQL in dry run', async () => {
      const adapter = harness.adapter as any

      const migrationWithSql = {
        ...createPostsMigration,
        getSql: () => 'CREATE TABLE posts (id INTEGER PRIMARY KEY)',
      }

      adapter.registerMigrations([migrationWithSql])

      const result = await adapter.migrate({ dryRun: true, showSql: true })

      expect(result.wouldRun[0].sql).toBe('CREATE TABLE posts (id INTEGER PRIMARY KEY)')
    })
  })

  // ==========================================================================
  // Locking
  // ==========================================================================

  describe('migration locking', () => {
    it('should acquire lock before running migrations', async () => {
      const adapter = harness.adapter as any
      let lockAcquired = false

      adapter.on('lockAcquired', () => {
        lockAcquired = true
      })

      adapter.registerMigrations([createPostsMigration])
      await adapter.migrate()

      expect(lockAcquired).toBe(true)
    })

    it('should release lock after migrations complete', async () => {
      const adapter = harness.adapter as any
      let lockReleased = false

      adapter.on('lockReleased', () => {
        lockReleased = true
      })

      adapter.registerMigrations([createPostsMigration])
      await adapter.migrate()

      expect(lockReleased).toBe(true)
    })

    it('should release lock on migration failure', async () => {
      const adapter = harness.adapter as any
      let lockReleased = false

      adapter.on('lockReleased', () => {
        lockReleased = true
      })

      const failingMigration = {
        name: '20260109_failing',
        timestamp: Date.now(),
        up: async () => {
          throw new Error('Failed!')
        },
        down: async () => {},
      }

      adapter.registerMigrations([failingMigration])

      try {
        await adapter.migrate()
      } catch {
        // Expected
      }

      expect(lockReleased).toBe(true)
    })

    it('should prevent concurrent migrations', async () => {
      const adapter = harness.adapter as any

      adapter.registerMigrations([createPostsMigration])

      // Simulate lock already held
      adapter.setLockHeld(true)

      await expect(adapter.migrate()).rejects.toThrow(/lock|already running|concurrent/i)
    })

    it('should support lock timeout', async () => {
      const adapter = harness.adapter as any

      adapter.registerMigrations([createPostsMigration])
      adapter.setLockHeld(true)

      await expect(adapter.migrate({ lockTimeout: 100 })).rejects.toThrow(/timeout/i)
    })
  })

  // ==========================================================================
  // Operation Tracking
  // ==========================================================================

  describe('operation tracking', () => {
    it('should track migrate operations', async () => {
      const adapter = harness.adapter as any

      adapter.registerMigrations([createPostsMigration])
      await adapter.migrate()

      const migrationOps = harness.operations.filter((op) => (op as any).type === 'migrate')
      expect(migrationOps.length).toBeGreaterThan(0)
    })

    it('should track migration rollback operations', async () => {
      const adapter = harness.adapter as any

      adapter.registerMigrations([createPostsMigration])
      await adapter.migrate()
      await adapter.migrateDown()

      const rollbackOps = harness.operations.filter((op) => (op as any).type === 'migrateDown')
      expect(rollbackOps.length).toBeGreaterThan(0)
    })

    it('should include migration name in operation data', async () => {
      const adapter = harness.adapter as any

      adapter.registerMigrations([createPostsMigration])
      await adapter.migrate()

      const migrateOp = harness.operations.find((op) => (op as any).type === 'migrate') as any
      expect(migrateOp?.data?.migrations).toContain('20260109_create_posts_table')
    })
  })

  // ==========================================================================
  // Push Mode (Development)
  // ==========================================================================

  describe('push mode (development)', () => {
    it('should expose push method', () => {
      const adapter = harness.adapter as any

      expect(adapter.push).toBeDefined()
      expect(typeof adapter.push).toBe('function')
    })

    it('should push schema changes directly in development', async () => {
      const adapter = harness.adapter as any

      // Enable development mode
      adapter.setMode('development')

      // Define schema change
      const result = await adapter.push({
        collections: [
          {
            slug: 'posts',
            fields: [
              { type: 'text', name: 'title', required: true },
              { type: 'text', name: 'newField' }, // New field
            ],
          },
        ],
      })

      expect(result.pushed).toBe(true)
      expect(result.changes).toContain('added column: newField')
    })

    it('should reject push in production mode', async () => {
      const adapter = harness.adapter as any

      // Set production mode
      adapter.setMode('production')

      await expect(adapter.push({ collections: [] })).rejects.toThrow(
        /production|not allowed|use migrations/i
      )
    })

    it('should warn about mixing push and migrations', async () => {
      const adapter = harness.adapter as any
      const warnings: string[] = []

      adapter.setMode('development')
      adapter.on('warning', (msg: string) => warnings.push(msg))

      // Run a migration first
      adapter.registerMigrations([createPostsMigration])
      await adapter.migrate()

      // Then try to push
      await adapter.push({ collections: [] })

      expect(warnings.some((w) => w.includes('mixing') || w.includes('push'))).toBe(true)
    })
  })
})
