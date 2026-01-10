/**
 * Debug test for mock DO SQL
 */
import { describe, it, expect } from 'vitest'
import { createMockDO, MockEnv } from '../../do'
import { DO } from '../../../objects/DO'
import * as schema from '../../../db'

describe('debug mock sql', () => {
  it('should check sql data access', async () => {
    const things = [
      { id: 'thing-0', type: 1, branch: null, name: 'Item 0', data: { tenantId: 'tenant-a' }, deleted: false },
    ]

    const result = createMockDO(DO, {
      ns: 'https://test.do',
      sqlData: new Map([
        ['things', things],
        ['branches', [{ name: 'main', head: 1, forkedFrom: null, createdAt: new Date().toISOString() }]],
      ]),
    })

    // Check if sqlData exists
    console.log('sqlData things:', result.sqlData.get('things'))

    // Raw SQL query through mock
    const cursor = result.storage.sql.exec('SELECT * FROM things')
    console.log('Raw SQL result:', cursor.toArray())
    console.log('Raw SQL raw():', cursor.raw())

    // Track sql operations
    console.log('SQL operations:', result.storage.sql.operations)

    // Check if the things exist
    expect(result.sqlData.get('things')).toEqual(things)
    expect(cursor.toArray()).toEqual(things)
  })

  it('should check drizzle db access through DO instance', async () => {
    const things = [
      { id: 'thing-0', type: 1, branch: null, name: 'Item 0', data: { tenantId: 'tenant-a' }, deleted: false, visibility: 'user', createdAt: new Date(), updatedAt: new Date() },
    ]

    const result = createMockDO(DO, {
      ns: 'https://test.do',
      sqlData: new Map([
        ['things', things],
        ['branches', [{ name: 'main', head: 1, forkedFrom: null, createdAt: new Date().toISOString() }]],
      ]),
    })

    // Access db through the instance
    const db = (result.instance as any).db
    console.log('DB instance:', db)
    console.log('DB $client:', db.$client)
    console.log('DB $client.sql:', db.$client?.sql)
    console.log('ctx.storage:', result.ctx.storage)
    console.log('ctx.storage.sql:', result.ctx.storage.sql)
    console.log('Same storage?', db.$client === result.ctx.storage)

    // Try a drizzle query
    try {
      const dbThings = await db.select().from(schema.things)
      console.log('Drizzle things result:', dbThings)
    } catch (e) {
      console.log('Drizzle query error:', e)
    }

    // Check SQL operations after drizzle query
    console.log('SQL operations after drizzle:', result.storage.sql.operations)
  })
})
