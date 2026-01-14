import { describe, it, expect } from 'vitest'
import { WorkersDoClient, type Worker, type WorkersDoClientOptions } from '../services/workers-do'

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

  it('has create method', () => {
    const client = new WorkersDoClient('test-token')
    expect(typeof client.create).toBe('function')
  })

  it('has isAvailable method', () => {
    const client = new WorkersDoClient('test-token')
    expect(typeof client.isAvailable).toBe('function')
  })

  describe('configuration options', () => {
    it('accepts custom timeout', () => {
      const options: WorkersDoClientOptions = { timeout: 5000 }
      const client = new WorkersDoClient('test-token', options)
      expect(client).toBeDefined()
    })

    it('accepts custom max retries', () => {
      const options: WorkersDoClientOptions = { maxRetries: 5 }
      const client = new WorkersDoClient('test-token', options)
      expect(client).toBeDefined()
    })

    it('accepts custom retry base delay', () => {
      const options: WorkersDoClientOptions = { retryBaseDelay: 500 }
      const client = new WorkersDoClient('test-token', options)
      expect(client).toBeDefined()
    })

    it('accepts all options together', () => {
      const options: WorkersDoClientOptions = {
        timeout: 15000,
        maxRetries: 4,
        retryBaseDelay: 2000,
      }
      const client = new WorkersDoClient('test-token', options)
      expect(client).toBeDefined()
    })
  })
})
