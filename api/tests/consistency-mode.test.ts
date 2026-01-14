import { describe, it, expect } from 'vitest'
import {
  parseConsistencyMode,
  shouldRouteToReplica,
} from '../utils/consistency'

describe('parseConsistencyMode', () => {
  it('returns mode from request header X-Consistency-Mode', () => {
    const request = new Request('http://api.dotdo.dev/customers', {
      headers: {
        'X-Consistency-Mode': 'strong',
      },
    })
    const nounConfig = { consistencyMode: 'eventual' }

    const mode = parseConsistencyMode(request, nounConfig)
    expect(mode).toBe('strong')
  })

  it('returns mode from query param ?consistency=...', () => {
    const request = new Request(
      'http://api.dotdo.dev/customers?consistency=causal',
    )
    const nounConfig = { consistencyMode: 'eventual' }

    const mode = parseConsistencyMode(request, nounConfig)
    expect(mode).toBe('causal')
  })

  it('prefers request header over query param', () => {
    const request = new Request(
      'http://api.dotdo.dev/customers?consistency=eventual',
      {
        headers: {
          'X-Consistency-Mode': 'strong',
        },
      },
    )
    const nounConfig = { consistencyMode: 'causal' }

    const mode = parseConsistencyMode(request, nounConfig)
    expect(mode).toBe('strong')
  })

  it('falls back to noun config default when no request params', () => {
    const request = new Request('http://api.dotdo.dev/customers')
    const nounConfig = { consistencyMode: 'causal' }

    const mode = parseConsistencyMode(request, nounConfig)
    expect(mode).toBe('causal')
  })

  it('defaults to "eventual" if nothing specified', () => {
    const request = new Request('http://api.dotdo.dev/customers')
    const nounConfig = {}

    const mode = parseConsistencyMode(request, nounConfig)
    expect(mode).toBe('eventual')
  })
})

describe('shouldRouteToReplica', () => {
  it('returns false for POST requests regardless of consistency mode', () => {
    expect(shouldRouteToReplica('POST', 'eventual')).toBe(false)
    expect(shouldRouteToReplica('POST', 'strong')).toBe(false)
    expect(shouldRouteToReplica('POST', 'causal')).toBe(false)
  })

  it('returns false for PUT requests regardless of consistency mode', () => {
    expect(shouldRouteToReplica('PUT', 'eventual')).toBe(false)
    expect(shouldRouteToReplica('PUT', 'strong')).toBe(false)
    expect(shouldRouteToReplica('PUT', 'causal')).toBe(false)
  })

  it('returns false for DELETE requests regardless of consistency mode', () => {
    expect(shouldRouteToReplica('DELETE', 'eventual')).toBe(false)
    expect(shouldRouteToReplica('DELETE', 'strong')).toBe(false)
    expect(shouldRouteToReplica('DELETE', 'causal')).toBe(false)
  })

  it('returns false for GET requests with "strong" consistency', () => {
    expect(shouldRouteToReplica('GET', 'strong')).toBe(false)
  })

  it('returns true for GET requests with "eventual" consistency', () => {
    expect(shouldRouteToReplica('GET', 'eventual')).toBe(true)
  })

  it('returns false for GET requests with "causal" consistency', () => {
    expect(shouldRouteToReplica('GET', 'causal')).toBe(false)
  })
})
