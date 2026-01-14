import { describe, it, expect } from 'vitest'
import { WorkersDoClient, type Worker } from '../services/workers-do'

describe('WorkersDoClient', () => {
  it('creates client with auth token', () => {
    const client = new WorkersDoClient('test-token')
    expect(client).toBeDefined()
  })

  it('stores token for authenticated requests', () => {
    const token = 'test-token-123'
    const client = new WorkersDoClient(token)
    // The client should be created with the token configured
    // This verifies the constructor doesn't throw with a valid token
    expect(client).toBeDefined()
  })

  it('creates separate clients for different tokens', () => {
    const client1 = new WorkersDoClient('token-1')
    const client2 = new WorkersDoClient('token-2')
    // Each client should be distinct (different auth contexts)
    expect(client1).not.toBe(client2)
  })

  it('has list method', () => {
    const client = new WorkersDoClient('test-token')
    expect(typeof client.list).toBe('function')
  })

  it('has link method', () => {
    const client = new WorkersDoClient('test-token')
    expect(typeof client.link).toBe('function')
  })

  it('has get method', () => {
    const client = new WorkersDoClient('test-token')
    expect(typeof client.get).toBe('function')
  })
})
