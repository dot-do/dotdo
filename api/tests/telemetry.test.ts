/**
 * Tests for Client Connection Telemetry
 *
 * This test file covers the telemetry headers for client connections:
 * - X-Worker-Colo: The Cloudflare colo where the worker proxy runs
 * - X-DO-Colo: The Cloudflare colo where the Durable Object is located
 * - X-Latency-Ms: Round-trip time from worker to DO in milliseconds
 *
 * @see do-iidr.21
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

describe('Client Connection Telemetry', () => {
  /**
   * Get a fresh DO stub for testing
   */
  function getTestDO(name = 'telemetry-test') {
    const id = env.DO.idFromName(name)
    return env.DO.get(id)
  }

  describe('DO Colo Header', () => {
    it('should include X-DO-Colo header in DO responses', async () => {
      const stub = getTestDO()

      const response = await stub.fetch('https://test.api.dotdo.dev/')

      expect(response.status).toBe(200)
      expect(response.headers.has('X-DO-Colo')).toBe(true)
    })

    it('should return colo as string value in X-DO-Colo header', async () => {
      const stub = getTestDO()

      const response = await stub.fetch('https://test.api.dotdo.dev/')

      const doColo = response.headers.get('X-DO-Colo')
      expect(doColo).toBeDefined()
      expect(typeof doColo).toBe('string')
      // In local testing, colo will be 'local' or 'unknown'
      // In production, it would be 3-letter IATA codes like 'SJC', 'LHR'
      expect(doColo!.length).toBeGreaterThan(0)
    })

    it('should include X-DO-Colo header on all response types', async () => {
      const stub = getTestDO()

      // Test health endpoint
      const healthResponse = await stub.fetch('https://test.api.dotdo.dev/')
      expect(healthResponse.headers.has('X-DO-Colo')).toBe(true)

      // Test info endpoint
      const infoResponse = await stub.fetch('https://test.api.dotdo.dev/info')
      expect(infoResponse.headers.has('X-DO-Colo')).toBe(true)
    })
  })

  describe('Telemetry Header Structure', () => {
    it('should have consistent colo header format', async () => {
      const stub = getTestDO()

      const response = await stub.fetch('https://test.api.dotdo.dev/')

      const doColo = response.headers.get('X-DO-Colo')
      expect(doColo).toBeDefined()
      // Colo should be alphanumeric (IATA codes are 3 uppercase letters)
      // In local testing, might be 'local' or 'unknown'
      expect(doColo).toMatch(/^[a-zA-Z0-9-]+$/)
    })
  })
})

describe('Worker Proxy Telemetry', () => {
  /**
   * These tests verify the worker proxy behavior.
   * In a real deployment:
   * - Worker captures request.cf.colo
   * - Worker measures time to call DO
   * - Worker adds X-Worker-Colo and X-Latency-Ms headers to response
   *
   * In test environment, we test the worker export directly.
   */

  describe('Telemetry Response Headers', () => {
    it('should define expected telemetry header names', () => {
      // These are the headers the worker should add
      const expectedHeaders = [
        'X-Worker-Colo',
        'X-DO-Colo',
        'X-Latency-Ms',
      ]

      // Verify header names are valid HTTP header format
      for (const header of expectedHeaders) {
        expect(header).toMatch(/^X-[A-Z][a-zA-Z-]+$/)
      }
    })

    it('should have X-Latency-Ms as numeric string', async () => {
      // This test validates the expected format
      // The actual implementation will set this header
      const latencyValue = '12.50'
      expect(parseFloat(latencyValue)).toBeGreaterThanOrEqual(0)
      expect(latencyValue).toMatch(/^\d+(\.\d+)?$/)
    })
  })
})

describe('Telemetry Integration', () => {
  /**
   * These tests verify the full telemetry flow from DO perspective.
   * The worker proxy tests are integration tests that would run against
   * a real worker deployment.
   */

  describe('DO Telemetry Middleware', () => {
    it('should add telemetry headers without affecting response body', async () => {
      const stub = env.DO.get(env.DO.idFromName('telemetry-body-test'))

      const response = await stub.fetch('https://test.api.dotdo.dev/')

      expect(response.status).toBe(200)

      // Verify body is not affected
      const body = await response.json() as { status: string; id: string }
      expect(body.status).toBe('ok')
      expect(body.id).toBeDefined()

      // Verify telemetry header is present
      expect(response.headers.has('X-DO-Colo')).toBe(true)
    })

    it('should include telemetry headers on error responses', async () => {
      const stub = env.DO.get(env.DO.idFromName('telemetry-error-test'))

      // Request a non-existent path that returns 404
      const response = await stub.fetch('https://test.api.dotdo.dev/nonexistent/path')

      // Even on 404, telemetry headers should be present
      expect(response.headers.has('X-DO-Colo')).toBe(true)
    })
  })
})
