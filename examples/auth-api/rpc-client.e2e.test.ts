/**
 * Authenticated RPC Client E2E Tests
 *
 * Tests the RPC client against a running auth-api worker.
 * Verifies that:
 * - Read operations work without auth
 * - Write operations require valid WorkOS token
 *
 * Run with:
 *   1. Start the dev server: npm run dev
 *   2. In another terminal: npm test
 *
 * For authenticated tests:
 *   TEST_TOKEN=<workos-token> npm test
 */

import { describe, it, expect } from 'vitest'

const TEST_URL = process.env.TEST_URL || 'http://localhost:8787'
const TEST_TOKEN = process.env.TEST_TOKEN || 'test-token-for-e2e'

describe('Auth API E2E Tests', () => {
  describe('Public Read Operations (No Auth)', () => {
    it('should return health status', async () => {
      const response = await fetch(`${TEST_URL}/health`)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.status).toBe('ok')
      expect(data.auth).toBe('enabled')
    })

    it('should list things without auth', async () => {
      const response = await fetch(`${TEST_URL}/things/Customer`)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(Array.isArray(data)).toBe(true)
    })

    it('should get single thing without auth', async () => {
      // First create a thing with auth
      const createResponse = await fetch(`${TEST_URL}/things/Customer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TEST_TOKEN}`,
        },
        body: JSON.stringify({
          $id: 'public-read-test',
          name: 'Public Reader',
        }),
      })

      if (createResponse.status !== 201) {
        console.log('Skipping - need auth to create test data')
        return
      }

      // Now read without auth
      const response = await fetch(`${TEST_URL}/things/Customer/public-read-test`)
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.name).toBe('Public Reader')
    })
  })

  describe('Protected Write Operations (Auth Required)', () => {
    const testId = `auth-test-${Date.now()}`

    it('should reject create without auth', async () => {
      const response = await fetch(`${TEST_URL}/things/Customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ $id: testId, name: 'Unauthorized' }),
      })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should allow create with valid token', async () => {
      const response = await fetch(`${TEST_URL}/things/Customer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TEST_TOKEN}`,
        },
        body: JSON.stringify({ $id: testId, name: 'Authorized User' }),
      })

      expect(response.status).toBe(201)
      const data = await response.json()
      expect(data.$id).toBe(testId)
      expect(data.name).toBe('Authorized User')
    })

    it('should reject update without auth', async () => {
      const response = await fetch(`${TEST_URL}/things/Customer/${testId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Should Fail' }),
      })

      expect(response.status).toBe(401)
    })

    it('should allow update with valid token', async () => {
      const response = await fetch(`${TEST_URL}/things/Customer/${testId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TEST_TOKEN}`,
        },
        body: JSON.stringify({ name: 'Updated Authorized' }),
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.name).toBe('Updated Authorized')
    })

    it('should reject delete without auth', async () => {
      const response = await fetch(`${TEST_URL}/things/Customer/${testId}`, {
        method: 'DELETE',
      })

      expect(response.status).toBe(401)
    })

    it('should allow delete with valid token', async () => {
      const response = await fetch(`${TEST_URL}/things/Customer/${testId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.deleted).toBe(true)
    })
  })

  describe('RPC Pipeline Auth', () => {
    it('should allow read operations without auth', async () => {
      const response = await fetch(`${TEST_URL}/rpc/pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: ['Customer', 'any-id'],
          pipeline: [{ type: 'method', name: 'getProfile', args: [] }],
        }),
      })

      expect(response.status).toBe(200)
    })

    it('should reject write pipeline operations without auth', async () => {
      const response = await fetch(`${TEST_URL}/rpc/pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: ['Customer', 'any-id'],
          pipeline: [{ type: 'method', name: 'create', args: [{ name: 'test' }] }],
        }),
      })

      expect(response.status).toBe(401)
    })

    it('should allow write pipeline operations with auth', async () => {
      const response = await fetch(`${TEST_URL}/rpc/pipeline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TEST_TOKEN}`,
        },
        body: JSON.stringify({
          target: ['Customer', 'any-id'],
          pipeline: [{ type: 'method', name: 'create', args: [{ name: 'test' }] }],
        }),
      })

      expect(response.status).toBe(200)
    })
  })
})
