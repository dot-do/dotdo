import { describe, it, expect } from 'vitest'
import { WorkersDoClient, type Worker } from '../services/workers-do'

describe('WorkersDoClient', () => {
  it('creates client with auth token', () => {
    const client = new WorkersDoClient('test-token')
    expect(client).toBeDefined()
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
