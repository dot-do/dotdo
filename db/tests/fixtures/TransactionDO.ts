/**
 * Transaction Test Durable Object
 *
 * Implements Things store with transaction support for testing.
 * Used by transactions.test.ts.
 */
import { DurableObject } from 'cloudflare:workers'

interface ThingRow {
  id: string
  type: string
  data: string
  version: number
  created_at: number
  updated_at: number
}

export class TransactionDO extends DurableObject {
  private sql: SqlStorage

  constructor(state: DurableObjectState, env: Record<string, unknown>) {
    super(state, env)
    this.sql = state.storage.sql

    // Initialize SQLite tables
    state.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS things (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          data TEXT NOT NULL,
          version INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `)
      this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_things_type ON things(type)`)
    })
  }

  private generateId(): string {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  }

  private rowToThing(row: ThingRow): Record<string, unknown> {
    const customData = JSON.parse(row.data)
    return {
      $id: row.id,
      $type: row.type,
      $version: row.version,
      $createdAt: row.created_at,
      $updatedAt: row.updated_at,
      ...customData
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    try {
      // ==== BASIC CRUD ====
      if (path === '/things/create' && method === 'POST') {
        const data = await request.json() as { $type: string; [key: string]: unknown }
        const { $type, ...customData } = data

        if (!$type) {
          return Response.json({ error: '$type is required' }, { status: 400 })
        }

        const id = this.generateId()
        const now = Date.now()
        const dataJson = JSON.stringify(customData)

        this.sql.exec(
          'INSERT INTO things (id, type, data, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
          id, $type, dataJson, now, now
        )

        const result = this.sql.exec('SELECT * FROM things WHERE id = ?', id)
        const row = [...result][0] as unknown as ThingRow
        return Response.json(this.rowToThing(row))
      }

      if (path === '/things/get' && method === 'GET') {
        const id = url.searchParams.get('id')
        const result = this.sql.exec('SELECT * FROM things WHERE id = ?', id)
        const rows = [...result] as unknown as ThingRow[]
        if (rows.length === 0) {
          return Response.json({ error: 'Not found' }, { status: 404 })
        }
        return Response.json(this.rowToThing(rows[0]))
      }

      if (path === '/things/update' && method === 'POST') {
        const body = await request.json() as {
          id: string
          data: Record<string, unknown>
          expectedVersion?: number
        }
        const { id, data, expectedVersion } = body

        const existingResult = this.sql.exec('SELECT * FROM things WHERE id = ?', id)
        const existingRows = [...existingResult] as unknown as ThingRow[]
        const existing = existingRows[0]

        if (!existing) {
          return Response.json({ error: 'Thing not found: ' + id }, { status: 404 })
        }

        // Optimistic locking check
        if (expectedVersion !== undefined && existing.version !== expectedVersion) {
          return Response.json({
            error: 'Version conflict',
            currentVersion: existing.version,
            expectedVersion
          }, { status: 409 })
        }

        const existingData = JSON.parse(existing.data)
        const { $id, $type, $version, $createdAt, $updatedAt, ...updateData } = data as Record<string, unknown>
        const mergedData = { ...existingData, ...updateData }
        const dataJson = JSON.stringify(mergedData)
        const now = Date.now()
        const newVersion = existing.version + 1

        this.sql.exec(
          'UPDATE things SET data = ?, version = ?, updated_at = ? WHERE id = ?',
          dataJson, newVersion, now, id
        )

        const result = this.sql.exec('SELECT * FROM things WHERE id = ?', id)
        const row = [...result][0] as unknown as ThingRow
        return Response.json(this.rowToThing(row))
      }

      if (path === '/things/list' && method === 'GET') {
        const type = url.searchParams.get('type')
        let result
        if (type) {
          result = this.sql.exec('SELECT * FROM things WHERE type = ? ORDER BY created_at DESC', type)
        } else {
          result = this.sql.exec('SELECT * FROM things ORDER BY created_at DESC')
        }
        const rows = [...result] as unknown as ThingRow[]
        return Response.json({ things: rows.map(r => this.rowToThing(r)) })
      }

      // ==== TRANSACTION OPERATIONS ====
      if (path === '/transaction' && method === 'POST') {
        const body = await request.json() as {
          operations: Array<{ type: string; data: { $type: string; [key: string]: unknown } }>
          shouldFail?: boolean
          failAtIndex?: number
        }
        const { operations, shouldFail, failAtIndex } = body
        const results: { id: string; operation: string }[] = []

        try {
          await this.ctx.blockConcurrencyWhile(async () => {
            for (let i = 0; i < operations.length; i++) {
              // Check if we should simulate failure
              if (shouldFail && i === failAtIndex) {
                throw new Error('Intentional rollback')
              }

              const op = operations[i]
              if (op.type === 'create') {
                const id = this.generateId()
                const now = Date.now()
                const { $type, ...customData } = op.data
                const dataJson = JSON.stringify(customData)

                this.sql.exec(
                  'INSERT INTO things (id, type, data, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
                  id, $type, dataJson, now, now
                )
                results.push({ id, operation: 'create' })
              }
            }
          })

          return Response.json({ success: true, results })
        } catch (error) {
          return Response.json({ success: false, error: (error as Error).message, results }, { status: 500 })
        }
      }

      // ==== CONCURRENT INCREMENT ====
      if (path === '/counter/increment' && method === 'POST') {
        const { id } = await request.json() as { id: string }

        await this.ctx.blockConcurrencyWhile(async () => {
          const existingResult = this.sql.exec('SELECT * FROM things WHERE id = ?', id)
          const rows = [...existingResult] as unknown as ThingRow[]
          const existing = rows[0]

          if (!existing) {
            throw new Error('Counter not found')
          }

          const data = JSON.parse(existing.data) as { value?: number }
          const newValue = (data.value || 0) + 1
          const now = Date.now()

          this.sql.exec(
            'UPDATE things SET data = ?, version = version + 1, updated_at = ? WHERE id = ?',
            JSON.stringify({ ...data, value: newValue }), now, id
          )
        })

        const result = this.sql.exec('SELECT * FROM things WHERE id = ?', id)
        const row = [...result][0] as unknown as ThingRow
        return Response.json(this.rowToThing(row))
      }

      // ==== BULK OPERATIONS ====
      if (path === '/things/bulk-create' && method === 'POST') {
        const { items } = await request.json() as { items: Array<{ $type?: string; [key: string]: unknown }> }
        const results: { id: string; $type: string }[] = []

        await this.ctx.blockConcurrencyWhile(async () => {
          // Validate all items first
          for (const item of items) {
            if (!item.$type) {
              throw new Error('$type is required for all items')
            }
          }

          // Then create all
          const now = Date.now()
          for (const item of items) {
            const id = this.generateId()
            const { $type, ...customData } = item
            const dataJson = JSON.stringify(customData)

            this.sql.exec(
              'INSERT INTO things (id, type, data, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
              id, $type!, dataJson, now, now
            )
            results.push({ id, $type: $type! })
          }
        })

        return Response.json({ success: true, created: results })
      }

      // ==== COUNT ====
      if (path === '/things/count' && method === 'GET') {
        const type = url.searchParams.get('type')
        let result
        if (type) {
          result = this.sql.exec('SELECT COUNT(*) as count FROM things WHERE type = ?', type)
        } else {
          result = this.sql.exec('SELECT COUNT(*) as count FROM things')
        }
        const rows = [...result] as Array<{ count: number }>
        return Response.json({ count: rows[0].count })
      }

      // ==== HEALTH CHECK ====
      if (path === '/' || path === '/health') {
        return Response.json({
          status: 'ok',
          id: this.ctx.id.toString(),
          timestamp: Date.now()
        })
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      return Response.json({ error: (error as Error).message, stack: (error as Error).stack }, { status: 500 })
    }
  }
}
