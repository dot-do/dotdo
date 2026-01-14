/**
 * Tests for Auth0 Tickets and Jobs Managers
 *
 * These tests verify:
 * - Password reset tickets
 * - Email verification tickets
 * - Email verification jobs
 * - User import/export jobs
 * - Job status tracking
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TicketsManager } from '../tickets-manager'
import { JobsManager } from '../jobs-manager'
import type { UserRecord } from '../types'

// ============================================================================
// MOCK SETUP
// ============================================================================

vi.stubGlobal('crypto', {
  getRandomValues: (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256)
    }
    return arr
  },
})

// ============================================================================
// TICKETS MANAGER TESTS
// ============================================================================

describe('TicketsManager', () => {
  let ticketsManager: TicketsManager
  let usersStore: Map<string, UserRecord>

  beforeEach(() => {
    usersStore = new Map()

    // Add test user
    usersStore.set('auth0|user123', {
      user_id: 'auth0|user123',
      email: 'user@example.com',
      email_verified: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    ticketsManager = new TicketsManager({
      domain: 'test.auth0.com',
      getUser: (userId) => usersStore.get(userId),
    })
  })

  // ============================================================================
  // PASSWORD RESET TICKETS
  // ============================================================================

  describe('changePassword', () => {
    it('should create a password reset ticket', async () => {
      const ticket = await ticketsManager.changePassword({
        user_id: 'auth0|user123',
      })

      expect(ticket).toBeDefined()
      expect(ticket.ticket).toBeDefined()
      expect(ticket.ticket).toContain('https://test.auth0.com')
      expect(ticket.ticket).toContain('/lo/reset')
      expect(ticket.ticket).toContain('ticket=')
    })

    it('should include result_url in ticket', async () => {
      const ticket = await ticketsManager.changePassword({
        user_id: 'auth0|user123',
        result_url: 'https://myapp.com/reset-complete',
      })

      expect(ticket.ticket).toContain('redirectTo=')
      expect(ticket.ticket).toContain(encodeURIComponent('https://myapp.com/reset-complete'))
    })

    it('should include email in redirect when requested', async () => {
      const ticket = await ticketsManager.changePassword({
        user_id: 'auth0|user123',
        includeEmailInRedirect: true,
      })

      expect(ticket.ticket).toContain('email=')
      expect(ticket.ticket).toContain(encodeURIComponent('user@example.com'))
    })

    it('should throw for non-existent user', async () => {
      await expect(
        ticketsManager.changePassword({
          user_id: 'auth0|nonexistent',
        })
      ).rejects.toThrow('not found')
    })

    it('should respect custom TTL', async () => {
      const ticket = await ticketsManager.changePassword({
        user_id: 'auth0|user123',
        ttl_sec: 7200, // 2 hours
      })

      expect(ticket.ticket).toBeDefined()
    })
  })

  // ============================================================================
  // EMAIL VERIFICATION TICKETS
  // ============================================================================

  describe('verifyEmail', () => {
    it('should create an email verification ticket', async () => {
      const ticket = await ticketsManager.verifyEmail({
        user_id: 'auth0|user123',
      })

      expect(ticket).toBeDefined()
      expect(ticket.ticket).toBeDefined()
      expect(ticket.ticket).toContain('https://test.auth0.com')
      expect(ticket.ticket).toContain('/lo/verify')
      expect(ticket.ticket).toContain('ticket=')
    })

    it('should include result_url in ticket', async () => {
      const ticket = await ticketsManager.verifyEmail({
        user_id: 'auth0|user123',
        result_url: 'https://myapp.com/verified',
      })

      expect(ticket.ticket).toContain('redirectTo=')
      expect(ticket.ticket).toContain(encodeURIComponent('https://myapp.com/verified'))
    })

    it('should include email in redirect when requested', async () => {
      const ticket = await ticketsManager.verifyEmail({
        user_id: 'auth0|user123',
        includeEmailInRedirect: true,
      })

      expect(ticket.ticket).toContain('email=')
    })

    it('should throw for non-existent user', async () => {
      await expect(
        ticketsManager.verifyEmail({
          user_id: 'auth0|nonexistent',
        })
      ).rejects.toThrow('not found')
    })

    it('should respect custom TTL', async () => {
      const ticket = await ticketsManager.verifyEmail({
        user_id: 'auth0|user123',
        ttl_sec: 86400, // 24 hours
      })

      expect(ticket.ticket).toBeDefined()
    })
  })

  // ============================================================================
  // CUSTOM TTL DEFAULTS
  // ============================================================================

  describe('custom TTL defaults', () => {
    it('should use custom password reset TTL', async () => {
      const customTicketsManager = new TicketsManager({
        domain: 'test.auth0.com',
        getUser: (userId) => usersStore.get(userId),
        passwordResetTTL: 1800, // 30 minutes
      })

      const ticket = await customTicketsManager.changePassword({
        user_id: 'auth0|user123',
      })

      expect(ticket.ticket).toBeDefined()
    })

    it('should use custom email verification TTL', async () => {
      const customTicketsManager = new TicketsManager({
        domain: 'test.auth0.com',
        getUser: (userId) => usersStore.get(userId),
        emailVerificationTTL: 259200, // 3 days
      })

      const ticket = await customTicketsManager.verifyEmail({
        user_id: 'auth0|user123',
      })

      expect(ticket.ticket).toBeDefined()
    })
  })
})

// ============================================================================
// JOBS MANAGER TESTS
// ============================================================================

describe('JobsManager', () => {
  let jobsManager: JobsManager
  let usersStore: Map<string, UserRecord>

  beforeEach(() => {
    usersStore = new Map()

    // Add test users
    usersStore.set('auth0|user123', {
      user_id: 'auth0|user123',
      email: 'user@example.com',
      email_verified: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    usersStore.set('auth0|noemail', {
      user_id: 'auth0|noemail',
      // No email
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    jobsManager = new JobsManager({
      domain: 'test.auth0.com',
      getUser: (userId) => usersStore.get(userId),
    })
  })

  // ============================================================================
  // EMAIL VERIFICATION JOBS
  // ============================================================================

  describe('verifyEmail', () => {
    it('should create a verification email job', async () => {
      const job = await jobsManager.verifyEmail({
        user_id: 'auth0|user123',
      })

      expect(job).toBeDefined()
      expect(job.id).toBeDefined()
      expect(job.id).toMatch(/^job_/)
      expect(job.type).toBe('verification_email')
      expect(job.status).toBe('completed')
      expect(job.created_at).toBeDefined()
    })

    it('should throw for non-existent user', async () => {
      await expect(
        jobsManager.verifyEmail({
          user_id: 'auth0|nonexistent',
        })
      ).rejects.toThrow('not found')
    })

    it('should throw for user without email', async () => {
      await expect(
        jobsManager.verifyEmail({
          user_id: 'auth0|noemail',
        })
      ).rejects.toThrow('no email')
    })

    it('should accept optional client_id', async () => {
      const job = await jobsManager.verifyEmail({
        user_id: 'auth0|user123',
        client_id: 'my-client-id',
      })

      expect(job.id).toBeDefined()
    })

    it('should accept identity parameter', async () => {
      const job = await jobsManager.verifyEmail({
        user_id: 'auth0|user123',
        identity: {
          user_id: 'user123',
          provider: 'auth0',
        },
      })

      expect(job.id).toBeDefined()
    })
  })

  // ============================================================================
  // GET JOB STATUS
  // ============================================================================

  describe('get', () => {
    it('should get a job by ID', async () => {
      const created = await jobsManager.verifyEmail({
        user_id: 'auth0|user123',
      })

      const job = await jobsManager.get({ id: created.id })

      expect(job).toBeDefined()
      expect(job?.id).toBe(created.id)
      expect(job?.type).toBe('verification_email')
    })

    it('should return null for non-existent job', async () => {
      const job = await jobsManager.get({ id: 'job_nonexistent' })
      expect(job).toBeNull()
    })
  })

  // ============================================================================
  // USER IMPORT JOBS
  // ============================================================================

  describe('importUsers', () => {
    it('should create a user import job', async () => {
      const users = JSON.stringify([
        { email: 'import1@example.com', email_verified: true },
        { email: 'import2@example.com', email_verified: false },
      ])

      const job = await jobsManager.importUsers({
        connection_id: 'con_12345',
        users,
      })

      expect(job).toBeDefined()
      expect(job.id).toMatch(/^job_/)
      expect(job.type).toBe('users_import')
      expect(job.status).toBe('pending')
      expect(job.connection_id).toBe('con_12345')
    })

    it('should accept upsert option', async () => {
      const job = await jobsManager.importUsers({
        connection_id: 'con_12345',
        users: '[]',
        upsert: true,
      })

      expect(job.id).toBeDefined()
    })

    it('should accept external_id', async () => {
      const job = await jobsManager.importUsers({
        connection_id: 'con_12345',
        users: '[]',
        external_id: 'my-import-123',
      })

      expect(job.id).toBeDefined()
    })

    it('should accept send_completion_email option', async () => {
      const job = await jobsManager.importUsers({
        connection_id: 'con_12345',
        users: '[]',
        send_completion_email: true,
      })

      expect(job.id).toBeDefined()
    })
  })

  // ============================================================================
  // USER EXPORT JOBS
  // ============================================================================

  describe('exportUsers', () => {
    it('should create a user export job', async () => {
      const job = await jobsManager.exportUsers({})

      expect(job).toBeDefined()
      expect(job.id).toMatch(/^job_/)
      expect(job.type).toBe('users_export')
      expect(job.status).toBe('pending')
    })

    it('should accept connection_id filter', async () => {
      const job = await jobsManager.exportUsers({
        connection_id: 'con_12345',
      })

      expect(job.connection_id).toBe('con_12345')
    })

    it('should accept format option', async () => {
      const csvJob = await jobsManager.exportUsers({
        format: 'csv',
      })
      expect(csvJob.id).toBeDefined()

      const jsonJob = await jobsManager.exportUsers({
        format: 'json',
      })
      expect(jsonJob.id).toBeDefined()
    })

    it('should accept fields option', async () => {
      const job = await jobsManager.exportUsers({
        fields: [
          { name: 'email' },
          { name: 'user_id', export_as: 'id' },
          { name: 'created_at' },
        ],
      })

      expect(job.id).toBeDefined()
    })

    it('should accept limit option', async () => {
      const job = await jobsManager.exportUsers({
        limit: 1000,
      })

      expect(job.id).toBeDefined()
    })
  })

  // ============================================================================
  // JOB STATUS TRACKING
  // ============================================================================

  describe('job status tracking', () => {
    it('should track multiple jobs', async () => {
      const job1 = await jobsManager.verifyEmail({ user_id: 'auth0|user123' })
      const job2 = await jobsManager.importUsers({ connection_id: 'con_1', users: '[]' })
      const job3 = await jobsManager.exportUsers({})

      const retrieved1 = await jobsManager.get({ id: job1.id })
      const retrieved2 = await jobsManager.get({ id: job2.id })
      const retrieved3 = await jobsManager.get({ id: job3.id })

      expect(retrieved1?.type).toBe('verification_email')
      expect(retrieved2?.type).toBe('users_import')
      expect(retrieved3?.type).toBe('users_export')
    })

    it('should have unique job IDs', async () => {
      const jobs = await Promise.all([
        jobsManager.verifyEmail({ user_id: 'auth0|user123' }),
        jobsManager.importUsers({ connection_id: 'con_1', users: '[]' }),
        jobsManager.exportUsers({}),
      ])

      const ids = jobs.map((j) => j.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(3)
    })
  })
})
