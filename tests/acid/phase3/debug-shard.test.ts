/**
 * Debug test for shard mock
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockDO, createMockDONamespace, MockDOResult, MockEnv } from '../../do'
import { DO } from '../../../objects/DO'

describe('debug shard mock', () => {
  it('should properly store and retrieve shard data', async () => {
    const shardData = new Map<number, unknown[]>()
    for (let i = 0; i < 4; i++) {
      shardData.set(i, [])
    }

    const mockNamespace = createMockDONamespace()
    mockNamespace.stubFactory = (id) => {
      const name = (id as { name?: string }).name || id.toString()
      console.log('stubFactory called with id:', id.toString(), 'name:', name)
      const shardMatch = name.match(/-shard-(\d+)$/)
      const shardIndex = shardMatch ? parseInt(shardMatch[1], 10) : -1
      console.log('Parsed shard index:', shardIndex)

      return {
        id,
        fetch: vi.fn().mockImplementation(async (request: Request) => {
          // The URL may be malformed due to namespace having protocol
          // Extract path from the end of the URL
          const urlStr = request.url
          const path = urlStr.match(/\/(init|transfer|query)$/)?.[0] || ''
          console.log('Mock fetch called:', 'url:', urlStr, 'extracted path:', path, 'for shard:', shardIndex)

          if (path === '/init') {
            return new Response(JSON.stringify({ success: true }), {
              headers: { 'Content-Type': 'application/json' },
            })
          }

          if (path === '/transfer') {
            const body = await request.json() as { things: unknown[] }
            console.log('Transfer received for shard', shardIndex, 'items:', body.things?.length)
            shardData.set(shardIndex, body.things || [])
            return new Response(JSON.stringify({ success: true }), {
              headers: { 'Content-Type': 'application/json' },
            })
          }

          if (path === '/query') {
            const data = shardData.get(shardIndex) || []
            console.log('Query returning', data.length, 'items from shard', shardIndex)
            return new Response(JSON.stringify({ data }), {
              headers: { 'Content-Type': 'application/json' },
            })
          }

          return new Response('OK')
        }),
      }
    }

    const things = Array.from({ length: 100 }, (_, i) => ({
      id: `thing-${i}`,
      type: 1,
      branch: null,
      name: `Item ${i}`,
      data: { tenantId: `tenant-${i % 5}` },
      deleted: false,
      visibility: 'user',
    }))

    const result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', things],
        ['branches', [{ name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() }]],
      ]),
      env: { DO: mockNamespace } as unknown as Partial<MockEnv>,
    })

    // Shard the DO
    console.log('Calling shard()...')
    const shardResult = await result.instance.shard({
      key: 'tenantId',
      count: 4,
    })
    console.log('Shard result:', JSON.stringify(shardResult, null, 2))

    // Check what data was stored
    console.log('Shard data after sharding:')
    for (let i = 0; i < 4; i++) {
      console.log(`  Shard ${i}: ${shardData.get(i)?.length || 0} items`)
    }

    // Query shards
    console.log('Calling queryShards...')
    const queryResult = await (result.instance as any).queryShards({
      query: 'SELECT * FROM things',
      aggregation: 'merge',
    })
    console.log('Query result total:', queryResult.totalItems)
    console.log('Query result data length:', queryResult.data.length)

    expect(queryResult.totalItems).toBe(100)
  })
})
