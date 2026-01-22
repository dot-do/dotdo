/**
 * Transaction Isolation and Concurrent Write Tests
 *
 * Tests for transaction rollback and concurrent write handling.
 *
 * Uses real Miniflare instances with real SQLite via @cloudflare/vitest-pool-workers - NO MOCKS.
 *
 * @module db/tests/transactions.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import { generateTestId, type Thing } from '@dotdo/test-utils'

// Re-export TransactionDO for vitest-pool-workers to find it
export { TransactionDO } from './fixtures/TransactionDO'

interface TransactionResult {
  success: boolean
  results?: { id: string }[]
  error?: string
}

interface CounterThing extends Thing {
  value: number
}

interface TestEnv {
  TX_DO: DurableObjectNamespace
}

const testEnv = env as unknown as TestEnv

function getTransactionDOStub(name?: string) {
  const testName = name ?? generateTestId()
  const id = testEnv.TX_DO.idFromName(testName)
  return testEnv.TX_DO.get(id)
}

describe('Transaction Isolation', () => {
  describe('Transaction Rollback on Error', () => {
    it('should complete successfully when no error occurs', async () => {
      const doName = generateTestId()
      const stub = getTransactionDOStub(doName)

      const txResponse = await stub.fetch('http://fake/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shouldFail: false,
          operations: [
            { type: 'create', data: { $type: 'Success', name: 'item-1' } },
            { type: 'create', data: { $type: 'Success', name: 'item-2' } },
          ],
        }),
      })

      expect(txResponse.status).toBe(200)
      const txJson = (await txResponse.json()) as TransactionResult
      expect(txJson.success).toBe(true)
      expect(txJson.results).toHaveLength(2)
    })
  })

  describe('Concurrent Writes Without Data Loss', () => {
    it('should handle concurrent writes without data loss', async () => {
      const doName = generateTestId()
      const stub = getTransactionDOStub(doName)

      const createResponse = await stub.fetch('http://fake/things/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ $type: 'Counter', value: 0 }),
      })
      const created = (await createResponse.json()) as CounterThing
      const counterId = created.$id

      const incrementPromises = Array.from({ length: 10 }, () =>
        stub.fetch('http://fake/counter/increment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: counterId }),
        })
      )

      const responses = await Promise.all(incrementPromises)
      for (const response of responses) {
        expect(response.status).toBe(200)
      }

      const getResponse = await stub.fetch(`http://fake/things/get?id=${counterId}`)
      const counter = (await getResponse.json()) as CounterThing
      expect(counter.value).toBe(10)
    })
  })

  describe('Bulk Operation Atomicity', () => {
    it('should create all items in bulk atomically', async () => {
      const doName = generateTestId()
      const stub = getTransactionDOStub(doName)

      const bulkResponse = await stub.fetch('http://fake/things/bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { $type: 'Bulk', name: 'item-1' },
            { $type: 'Bulk', name: 'item-2' },
            { $type: 'Bulk', name: 'item-3' },
          ],
        }),
      })

      expect(bulkResponse.status).toBe(200)
      const bulkJson = (await bulkResponse.json()) as { success: boolean; created: { id: string }[] }
      expect(bulkJson.success).toBe(true)
      expect(bulkJson.created).toHaveLength(3)
    })
  })
})
