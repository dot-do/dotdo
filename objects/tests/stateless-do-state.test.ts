// objects/tests/stateless-do-state.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StatelessDOState } from '../StatelessDOState'

// Mock R2 bucket
const createMockR2 = () => ({
  put: vi.fn().mockResolvedValue({}),
  get: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue({ objects: [] }),
  delete: vi.fn().mockResolvedValue(undefined)
})

const createTestJwt = (claims: Record<string, any> = {}) => {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = btoa(JSON.stringify({
    org_id: 'org_123',
    tenant_id: 'tenant_456',
    ...claims,
    exp: Math.floor(Date.now() / 1000) + 3600
  }))
  return `${header}.${payload}.signature`
}

describe('StatelessDOState', () => {
  let mockR2: any
  let mockEnv: any

  beforeEach(() => {
    mockR2 = createMockR2()
    mockEnv = { R2: mockR2 }
  })

  it('should implement DurableObjectState interface', () => {
    const state = new StatelessDOState('do_123', mockEnv)

    expect(state.id).toBeDefined()
    expect(state.storage).toBeDefined()
    expect(typeof state.storage.get).toBe('function')
    expect(typeof state.storage.put).toBe('function')
    expect(typeof state.storage.delete).toBe('function')
    expect(typeof state.storage.list).toBe('function')
  })

  it('should have working sql interface', () => {
    const state = new StatelessDOState('do_123', mockEnv)

    expect(state.storage.sql).toBeDefined()
    expect(typeof state.storage.sql.exec).toBe('function')
  })

  it('should execute SQL queries', async () => {
    const state = new StatelessDOState('do_123', mockEnv)
    await state.init()

    state.storage.sql.exec('CREATE TABLE test (id TEXT, name TEXT)')
    state.storage.sql.exec("INSERT INTO test VALUES ('1', 'Test')")

    const result = state.storage.sql.exec('SELECT * FROM test').toArray()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Test')
  })

  it('should load state from Iceberg on init', async () => {
    const testJwt = createTestJwt()
    const state = new StatelessDOState('do_123', mockEnv, { jwt: testJwt })
    await state.init()

    // Should have called R2 to look for snapshots
    expect(mockR2.list).toHaveBeenCalled()
  })

  it('should checkpoint on waitUntil', async () => {
    const testJwt = createTestJwt()
    const state = new StatelessDOState('do_123', mockEnv, { jwt: testJwt })
    await state.init()

    state.storage.sql.exec("INSERT INTO things VALUES ('t1', 'Test', '{}')")

    await state.waitUntil(Promise.resolve())
    await state.flush()

    // Should have saved to Iceberg
    expect(mockR2.put).toHaveBeenCalled()
  })

  it('should provide unique id', () => {
    const state1 = new StatelessDOState('do_123', mockEnv)
    const state2 = new StatelessDOState('do_456', mockEnv)

    expect(state1.id.toString()).toBe('do_123')
    expect(state2.id.toString()).toBe('do_456')
    expect(state1.id.equals(state2.id)).toBe(false)
  })
})
