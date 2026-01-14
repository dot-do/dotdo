/**
 * Tests for Auth0 Management Client - Token Handling & API Authorization
 *
 * These tests verify:
 * - Token-based authentication
 * - Client credentials grant
 * - API authorization patterns
 * - Error handling for authentication failures
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ManagementClient } from '../management-client'
import { Auth0ManagementError } from '../types'

// ============================================================================
// MOCK SETUP
// ============================================================================

vi.stubGlobal('crypto', {
  randomUUID: () => 'test-uuid-1234',
  getRandomValues: (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256)
    }
    return arr
  },
  subtle: {
    importKey: vi.fn().mockResolvedValue({}),
    deriveBits: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
    digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
  },
})

describe('ManagementClient', () => {
  // ============================================================================
  // CLIENT INITIALIZATION
  // ============================================================================

  describe('initialization', () => {
    it('should create client with management API token', () => {
      const client = new ManagementClient({
        domain: 'tenant.auth0.com',
        token: 'mgmt-api-token',
      })

      expect(client).toBeDefined()
      expect(client.getDomain()).toBe('tenant.auth0.com')
    })

    it('should create client with client credentials', () => {
      const client = new ManagementClient({
        domain: 'tenant.auth0.com',
        clientId: 'my-client-id',
        clientSecret: 'my-client-secret',
      })

      expect(client).toBeDefined()
      expect(client.getDomain()).toBe('tenant.auth0.com')
    })

    it('should create client without credentials for in-memory use', () => {
      // Edge environment allows creation without credentials
      const client = new ManagementClient({
        domain: 'tenant.auth0.com',
      })

      expect(client).toBeDefined()
    })

    it('should expose users manager', () => {
      const client = new ManagementClient({
        domain: 'tenant.auth0.com',
        token: 'token',
      })

      expect(client.users).toBeDefined()
      expect(typeof client.users.create).toBe('function')
      expect(typeof client.users.get).toBe('function')
      expect(typeof client.users.update).toBe('function')
      expect(typeof client.users.delete).toBe('function')
      expect(typeof client.users.getAll).toBe('function')
      expect(typeof client.users.getByEmail).toBe('function')
    })

    it('should expose tickets manager', () => {
      const client = new ManagementClient({
        domain: 'tenant.auth0.com',
        token: 'token',
      })

      expect(client.tickets).toBeDefined()
      expect(typeof client.tickets.changePassword).toBe('function')
      expect(typeof client.tickets.verifyEmail).toBe('function')
    })

    it('should expose jobs manager', () => {
      const client = new ManagementClient({
        domain: 'tenant.auth0.com',
        token: 'token',
      })

      expect(client.jobs).toBeDefined()
      expect(typeof client.jobs.verifyEmail).toBe('function')
      expect(typeof client.jobs.get).toBe('function')
      expect(typeof client.jobs.importUsers).toBe('function')
      expect(typeof client.jobs.exportUsers).toBe('function')
    })
  })

  // ============================================================================
  // TOKEN HANDLING
  // ============================================================================

  describe('token handling', () => {
    it('should return token when configured with token', async () => {
      const client = new ManagementClient({
        domain: 'tenant.auth0.com',
        token: 'my-management-token',
      })

      const token = await client.getAccessToken()
      expect(token).toBe('my-management-token')
    })

    it('should throw when getting token without credentials', async () => {
      const client = new ManagementClient({
        domain: 'tenant.auth0.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        // No token provided
      })

      await expect(client.getAccessToken()).rejects.toThrow(
        'Token retrieval with client credentials not implemented'
      )
    })
  })

  // ============================================================================
  // DOMAIN CONFIGURATION
  // ============================================================================

  describe('domain configuration', () => {
    it('should return configured domain', () => {
      const client = new ManagementClient({
        domain: 'my-tenant.auth0.com',
        token: 'token',
      })

      expect(client.getDomain()).toBe('my-tenant.auth0.com')
    })

    it('should handle custom domains', () => {
      const client = new ManagementClient({
        domain: 'auth.mycompany.com',
        token: 'token',
      })

      expect(client.getDomain()).toBe('auth.mycompany.com')
    })
  })

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('manager integration', () => {
    let client: ManagementClient

    beforeEach(() => {
      client = new ManagementClient({
        domain: 'test.auth0.com',
        token: 'test-token',
      })
    })

    it('should create user and then get password reset ticket', async () => {
      const user = await client.users.create({
        connection: 'Username-Password-Authentication',
        email: 'integration@example.com',
        password: 'SecurePass123!',
      })

      const ticket = await client.tickets.changePassword({
        user_id: user.user_id,
        result_url: 'https://example.com/reset',
      })

      expect(ticket.ticket).toBeDefined()
      expect(ticket.ticket).toContain('https://test.auth0.com')
    })

    it('should create user and send verification email job', async () => {
      const user = await client.users.create({
        connection: 'Username-Password-Authentication',
        email: 'verification@example.com',
        password: 'SecurePass123!',
        email_verified: false,
      })

      const job = await client.jobs.verifyEmail({
        user_id: user.user_id,
      })

      expect(job.id).toBeDefined()
      expect(job.type).toBe('verification_email')
      expect(job.status).toBe('completed')
    })

    it('should share user store between managers', async () => {
      // Create user
      const user = await client.users.create({
        connection: 'Username-Password-Authentication',
        email: 'shared@example.com',
        password: 'SecurePass123!',
      })

      // Tickets manager should see the user
      const ticket = await client.tickets.verifyEmail({
        user_id: user.user_id,
      })
      expect(ticket.ticket).toBeDefined()

      // Jobs manager should see the user
      const job = await client.jobs.verifyEmail({
        user_id: user.user_id,
      })
      expect(job.id).toBeDefined()
    })

    it('should fail for non-existent user in tickets manager', async () => {
      await expect(
        client.tickets.changePassword({
          user_id: 'auth0|nonexistent',
        })
      ).rejects.toThrow('not found')
    })

    it('should fail for non-existent user in jobs manager', async () => {
      await expect(
        client.jobs.verifyEmail({
          user_id: 'auth0|nonexistent',
        })
      ).rejects.toThrow('not found')
    })
  })
})
