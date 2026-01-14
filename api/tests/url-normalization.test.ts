import { describe, it, expect, beforeEach } from 'vitest'
import { normalizePathSegment } from '../utils/url'

// Conditionally import cloudflare:test - it's only available in the Workers pool
let env: any
let cloudflareTestAvailable = false

try {
  const cloudflareTest = await import('cloudflare:test')
  env = cloudflareTest.env
  cloudflareTestAvailable = true
} catch {
  // cloudflare:test not available - DO tests will be skipped
  cloudflareTestAvailable = false
}

describe('URL Normalization', () => {
  describe('normalizePathSegment', () => {
    it('converts single underscore to space', () => {
      const result = normalizePathSegment('John_Doe')
      expect(result).toBe('John Doe')
    })

    it('handles double underscores as single space', () => {
      const result = normalizePathSegment('John__Doe')
      expect(result).toBe('John Doe')
    })

    it('converts multiple underscores to spaces', () => {
      const result = normalizePathSegment('no_spaces_here')
      expect(result).toBe('no spaces here')
    })

    it('returns string unchanged when no underscores', () => {
      const result = normalizePathSegment('NoUnderscores')
      expect(result).toBe('NoUnderscores')
    })

    it('handles mixed consecutive underscores', () => {
      const result = normalizePathSegment('foo___bar____baz')
      expect(result).toBe('foo bar baz')
    })
  })

  describe.skipIf(!cloudflareTestAvailable)('REST API endpoint with underscore paths', () => {
    it('matches customer by name with underscores in URL path', async () => {
      // Get real DO instance
      const stub = env.DO.get(env.DO.idFromName('test-url-norm'))

      // Create a customer with name "John Doe"
      const created = await stub.things.create({
        $type: 'Customer',
        name: 'John Doe',
      })
      expect(created.$id).toBeDefined()

      // Query via REST endpoint with underscore path
      const res = await stub.fetch('https://test.api.dotdo.dev/customers/John_Doe')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.name).toBe('John Doe')
      expect(data.$id).toBe(created.$id)
    })

    it('handles multiple space segments in URL path', async () => {
      const stub = env.DO.get(env.DO.idFromName('test-url-norm-multi'))

      // Create customer with multiple word name
      const created = await stub.things.create({
        $type: 'Customer',
        name: 'Jane Marie Smith',
      })
      expect(created.$id).toBeDefined()

      // Query with underscores replacing spaces
      const res = await stub.fetch(
        'https://test.api.dotdo.dev/customers/Jane_Marie_Smith'
      )
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.name).toBe('Jane Marie Smith')
      expect(data.$id).toBe(created.$id)
    })
  })
})
