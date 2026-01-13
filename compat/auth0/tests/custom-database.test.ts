/**
 * Tests for Auth0 Custom Database Connections
 *
 * These tests verify:
 * - Connection CRUD operations
 * - Custom database script execution
 * - Password policy validation
 * - Import mode (lazy migration)
 * - Client management for connections
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ConnectionsManager, type CustomDatabaseUser } from '../custom-database'

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

describe('ConnectionsManager', () => {
  let connectionsManager: ConnectionsManager

  beforeEach(() => {
    connectionsManager = new ConnectionsManager({
      domain: 'test.auth0.com',
    })
  })

  // ============================================================================
  // CONNECTION CRUD
  // ============================================================================

  describe('connection CRUD', () => {
    it('should have default Username-Password-Authentication connection', () => {
      const conn = connectionsManager.getByName('Username-Password-Authentication')
      expect(conn).toBeDefined()
      expect(conn?.strategy).toBe('auth0')
    })

    it('should create a new connection', () => {
      const conn = connectionsManager.create({
        name: 'my-custom-db',
        strategy: 'auth0',
      })

      expect(conn.id).toMatch(/^con_/)
      expect(conn.name).toBe('my-custom-db')
      expect(conn.strategy).toBe('auth0')
      expect(conn.is_domain_connection).toBe(false)
      expect(conn.created_at).toBeDefined()
      expect(conn.updated_at).toBeDefined()
    })

    it('should create connection with custom options', () => {
      const conn = connectionsManager.create({
        name: 'enterprise-db',
        strategy: 'auth0',
        display_name: 'Enterprise Database',
        options: {
          requires_username: true,
          brute_force_protection: true,
          import_mode: true,
        },
      })

      expect(conn.display_name).toBe('Enterprise Database')
      expect(conn.options.requires_username).toBe(true)
      expect(conn.options.brute_force_protection).toBe(true)
      expect(conn.options.import_mode).toBe(true)
    })

    it('should get connection by ID', () => {
      const created = connectionsManager.create({
        name: 'test-conn',
        strategy: 'auth0',
      })

      const retrieved = connectionsManager.get(created.id)
      expect(retrieved).toEqual(created)
    })

    it('should get connection by name', () => {
      const created = connectionsManager.create({
        name: 'named-conn',
        strategy: 'auth0',
      })

      const retrieved = connectionsManager.getByName('named-conn')
      expect(retrieved?.id).toBe(created.id)
    })

    it('should return null for non-existent connection', () => {
      expect(connectionsManager.get('con_nonexistent')).toBeNull()
      expect(connectionsManager.getByName('nonexistent')).toBeNull()
    })

    it('should throw on duplicate connection name', () => {
      connectionsManager.create({ name: 'unique-name', strategy: 'auth0' })

      expect(() =>
        connectionsManager.create({ name: 'unique-name', strategy: 'auth0' })
      ).toThrow('already exists')
    })

    it('should update a connection', () => {
      const conn = connectionsManager.create({
        name: 'to-update',
        strategy: 'auth0',
      })

      const updated = connectionsManager.update(conn.id, {
        display_name: 'Updated Display Name',
        options: {
          disable_signup: true,
        },
      })

      expect(updated.display_name).toBe('Updated Display Name')
      expect(updated.options.disable_signup).toBe(true)
      expect(updated.updated_at).not.toBe(conn.updated_at)
    })

    it('should throw when updating non-existent connection', () => {
      expect(() =>
        connectionsManager.update('con_nonexistent', { display_name: 'Test' })
      ).toThrow('not found')
    })

    it('should delete a connection', () => {
      const conn = connectionsManager.create({
        name: 'to-delete',
        strategy: 'auth0',
      })

      connectionsManager.delete(conn.id)
      expect(connectionsManager.get(conn.id)).toBeNull()
      expect(connectionsManager.getByName('to-delete')).toBeNull()
    })
  })

  // ============================================================================
  // GET ALL CONNECTIONS
  // ============================================================================

  describe('getAll', () => {
    beforeEach(() => {
      connectionsManager.create({ name: 'db-conn-1', strategy: 'auth0' })
      connectionsManager.create({ name: 'db-conn-2', strategy: 'auth0' })
      connectionsManager.create({ name: 'google-conn', strategy: 'google-oauth2' })
    })

    it('should list all connections', () => {
      const result = connectionsManager.getAll()
      // Default + 3 created
      expect(result.connections.length).toBeGreaterThanOrEqual(4)
    })

    it('should filter by strategy', () => {
      const result = connectionsManager.getAll({ strategy: 'google-oauth2' })
      expect(result.connections).toHaveLength(1)
      expect(result.connections[0].name).toBe('google-conn')
    })

    it('should filter by name (partial match)', () => {
      const result = connectionsManager.getAll({ name: 'db-conn' })
      expect(result.connections).toHaveLength(2)
    })

    it('should support pagination', () => {
      const page1 = connectionsManager.getAll({ page: 0, per_page: 2 })
      expect(page1.connections.length).toBeLessThanOrEqual(2)

      const page2 = connectionsManager.getAll({ page: 1, per_page: 2 })
      expect(page2.connections.length).toBeGreaterThanOrEqual(1)
    })

    it('should include totals when requested', () => {
      const result = connectionsManager.getAll({ include_totals: true })
      expect(result.total).toBeDefined()
      expect(result.total).toBeGreaterThanOrEqual(4)
    })
  })

  // ============================================================================
  // CUSTOM DATABASE SCRIPTS
  // ============================================================================

  describe('custom database scripts', () => {
    let mockUserDb: Map<string, { id: string; email: string; password: string }>

    beforeEach(() => {
      mockUserDb = new Map()
      mockUserDb.set('user@example.com', {
        id: 'external_123',
        email: 'user@example.com',
        password: 'hashedpassword',
      })

      connectionsManager.create({
        name: 'custom-db',
        strategy: 'auth0',
        options: {
          customScripts: {
            login: async (email, password): Promise<CustomDatabaseUser> => {
              const user = mockUserDb.get(email)
              if (!user || user.password !== password) {
                throw new Error('Invalid credentials')
              }
              return {
                user_id: user.id,
                email: user.email,
                email_verified: true,
              }
            },
            getUser: async (email): Promise<CustomDatabaseUser | null> => {
              const user = mockUserDb.get(email)
              if (!user) return null
              return {
                user_id: user.id,
                email: user.email,
              }
            },
            create: async (userData): Promise<CustomDatabaseUser> => {
              const id = `external_${Date.now()}`
              if (userData.email) {
                mockUserDb.set(userData.email, {
                  id,
                  email: userData.email,
                  password: userData.password ?? '',
                })
              }
              return {
                user_id: id,
                email: userData.email,
              }
            },
            delete: async (userId): Promise<void> => {
              for (const [email, user] of mockUserDb.entries()) {
                if (user.id === userId) {
                  mockUserDb.delete(email)
                  break
                }
              }
            },
            verify: async (email): Promise<void> => {
              const user = mockUserDb.get(email)
              if (user) {
                // Mark as verified in external db
              }
            },
            changePassword: async (email, newPassword): Promise<void> => {
              const user = mockUserDb.get(email)
              if (user) {
                user.password = newPassword
              }
            },
          },
        },
      })
    })

    describe('executeLogin', () => {
      it('should execute login script successfully', async () => {
        const user = await connectionsManager.executeLogin(
          'custom-db',
          'user@example.com',
          'hashedpassword'
        )

        expect(user.user_id).toBe('external_123')
        expect(user.email).toBe('user@example.com')
      })

      it('should throw on invalid credentials', async () => {
        await expect(
          connectionsManager.executeLogin('custom-db', 'user@example.com', 'wrongpassword')
        ).rejects.toThrow('Invalid credentials')
      })

      it('should throw for non-existent connection', async () => {
        await expect(
          connectionsManager.executeLogin('nonexistent', 'user@example.com', 'password')
        ).rejects.toThrow('not found')
      })

      it('should throw when login script not configured', async () => {
        connectionsManager.create({
          name: 'no-scripts',
          strategy: 'auth0',
        })

        await expect(
          connectionsManager.executeLogin('no-scripts', 'user@example.com', 'password')
        ).rejects.toThrow('Login script not configured')
      })
    })

    describe('executeGetUser', () => {
      it('should get existing user', async () => {
        const user = await connectionsManager.executeGetUser('custom-db', 'user@example.com')

        expect(user).not.toBeNull()
        expect(user?.user_id).toBe('external_123')
      })

      it('should return null for non-existent user', async () => {
        const user = await connectionsManager.executeGetUser('custom-db', 'nobody@example.com')
        expect(user).toBeNull()
      })

      it('should return null when getUser script not configured', async () => {
        connectionsManager.create({
          name: 'no-get-user',
          strategy: 'auth0',
          options: {
            customScripts: {
              login: async () => ({ user_id: 'test', email: 'test@example.com' }),
            },
          },
        })

        const user = await connectionsManager.executeGetUser('no-get-user', 'test@example.com')
        expect(user).toBeNull()
      })
    })

    describe('executeCreate', () => {
      it('should create new user', async () => {
        const user = await connectionsManager.executeCreate('custom-db', {
          email: 'newuser@example.com',
          password: 'NewSecurePass123!',
        })

        expect(user.user_id).toBeDefined()
        expect(user.email).toBe('newuser@example.com')

        // Verify user was added to mock db
        expect(mockUserDb.has('newuser@example.com')).toBe(true)
      })

      it('should throw when create script not configured', async () => {
        connectionsManager.create({
          name: 'no-create',
          strategy: 'auth0',
        })

        await expect(
          connectionsManager.executeCreate('no-create', { email: 'test@example.com' })
        ).rejects.toThrow('Create script not configured')
      })
    })

    describe('executeDelete', () => {
      it('should delete user', async () => {
        await connectionsManager.executeDelete('custom-db', 'external_123')

        // Verify user was removed
        expect(mockUserDb.has('user@example.com')).toBe(false)
      })

      it('should not throw when delete script not configured', async () => {
        connectionsManager.create({
          name: 'no-delete',
          strategy: 'auth0',
        })

        // Should silently succeed
        await expect(
          connectionsManager.executeDelete('no-delete', 'user123')
        ).resolves.not.toThrow()
      })
    })

    describe('executeVerify', () => {
      it('should execute verify script', async () => {
        await expect(
          connectionsManager.executeVerify('custom-db', 'user@example.com')
        ).resolves.not.toThrow()
      })

      it('should not throw when verify script not configured', async () => {
        connectionsManager.create({
          name: 'no-verify',
          strategy: 'auth0',
        })

        await expect(
          connectionsManager.executeVerify('no-verify', 'test@example.com')
        ).resolves.not.toThrow()
      })
    })

    describe('executeChangePassword', () => {
      it('should change password', async () => {
        await connectionsManager.executeChangePassword(
          'custom-db',
          'user@example.com',
          'NewSecurePass456!'
        )

        // Verify password was changed
        const user = mockUserDb.get('user@example.com')
        expect(user?.password).toBe('NewSecurePass456!')
      })

      it('should throw when changePassword script not configured', async () => {
        connectionsManager.create({
          name: 'no-change-pwd',
          strategy: 'auth0',
        })

        await expect(
          connectionsManager.executeChangePassword('no-change-pwd', 'test@example.com', 'newpwd')
        ).rejects.toThrow('Change password script not configured')
      })
    })
  })

  // ============================================================================
  // PASSWORD POLICY
  // ============================================================================

  describe('password policy', () => {
    it('should validate minimum length', () => {
      expect(() => connectionsManager.validatePassword('short')).toThrow('at least')
    })

    it('should validate lowercase requirement', () => {
      expect(() =>
        connectionsManager.validatePassword('ALLUPPERCASE123!')
      ).toThrow('lowercase')
    })

    it('should validate uppercase requirement', () => {
      expect(() =>
        connectionsManager.validatePassword('alllowercase123!')
      ).toThrow('uppercase')
    })

    it('should validate number requirement', () => {
      expect(() =>
        connectionsManager.validatePassword('NoNumbersHere!')
      ).toThrow('number')
    })

    it('should pass valid password', () => {
      expect(() =>
        connectionsManager.validatePassword('ValidPass123!')
      ).not.toThrow()
    })

    it('should use custom password policy from connection', () => {
      const conn = connectionsManager.create({
        name: 'strict-policy',
        strategy: 'auth0',
        options: {
          passwordPolicy: {
            minLength: 12,
            requireSpecialCharacters: true,
          },
        },
      })

      expect(() =>
        connectionsManager.validatePassword('Short1!', conn.options.passwordPolicy)
      ).toThrow('at least 12')

      expect(() =>
        connectionsManager.validatePassword('NoSpecialChars123', conn.options.passwordPolicy)
      ).toThrow('special character')

      expect(() =>
        connectionsManager.validatePassword('ValidLongPass123!', conn.options.passwordPolicy)
      ).not.toThrow()
    })
  })

  // ============================================================================
  // IMPORT MODE
  // ============================================================================

  describe('import mode', () => {
    it('should check if import mode is enabled', () => {
      connectionsManager.create({
        name: 'import-enabled',
        strategy: 'auth0',
        options: { import_mode: true },
      })

      connectionsManager.create({
        name: 'import-disabled',
        strategy: 'auth0',
        options: { import_mode: false },
      })

      expect(connectionsManager.isImportMode('import-enabled')).toBe(true)
      expect(connectionsManager.isImportMode('import-disabled')).toBe(false)
      expect(connectionsManager.isImportMode('nonexistent')).toBe(false)
    })

    it('should check if connection has custom scripts', () => {
      connectionsManager.create({
        name: 'with-scripts',
        strategy: 'auth0',
        options: {
          customScripts: {
            login: async () => ({ user_id: 'test', email: 'test@example.com' }),
          },
        },
      })

      connectionsManager.create({
        name: 'without-scripts',
        strategy: 'auth0',
      })

      expect(connectionsManager.hasCustomScripts('with-scripts')).toBe(true)
      expect(connectionsManager.hasCustomScripts('without-scripts')).toBe(false)
    })
  })

  // ============================================================================
  // CLIENT MANAGEMENT
  // ============================================================================

  describe('client management', () => {
    it('should enable client for connection', () => {
      const conn = connectionsManager.create({
        name: 'client-test',
        strategy: 'auth0',
      })

      const updated = connectionsManager.enableClient(conn.id, 'client_123')

      expect(updated.enabled_clients).toContain('client_123')
    })

    it('should not duplicate enabled clients', () => {
      const conn = connectionsManager.create({
        name: 'no-dup-test',
        strategy: 'auth0',
      })

      connectionsManager.enableClient(conn.id, 'client_123')
      connectionsManager.enableClient(conn.id, 'client_123')

      const retrieved = connectionsManager.get(conn.id)
      expect(retrieved?.enabled_clients.filter((c) => c === 'client_123')).toHaveLength(1)
    })

    it('should disable client for connection', () => {
      const conn = connectionsManager.create({
        name: 'disable-test',
        strategy: 'auth0',
        enabled_clients: ['client_123', 'client_456'],
      })

      const updated = connectionsManager.disableClient(conn.id, 'client_123')

      expect(updated.enabled_clients).not.toContain('client_123')
      expect(updated.enabled_clients).toContain('client_456')
    })

    it('should throw when enabling client for non-existent connection', () => {
      expect(() =>
        connectionsManager.enableClient('con_nonexistent', 'client_123')
      ).toThrow('not found')
    })
  })

  // ============================================================================
  // CONNECTION STRATEGIES
  // ============================================================================

  describe('connection strategies', () => {
    it('should support social connections', () => {
      const google = connectionsManager.create({
        name: 'google',
        strategy: 'google-oauth2',
      })
      const facebook = connectionsManager.create({
        name: 'facebook',
        strategy: 'facebook',
      })
      const github = connectionsManager.create({
        name: 'github',
        strategy: 'github',
      })

      expect(google.strategy).toBe('google-oauth2')
      expect(facebook.strategy).toBe('facebook')
      expect(github.strategy).toBe('github')
    })

    it('should support enterprise connections', () => {
      const saml = connectionsManager.create({
        name: 'okta-saml',
        strategy: 'samlp',
        realms: ['okta.example.com'],
      })
      const oidc = connectionsManager.create({
        name: 'azure-oidc',
        strategy: 'oidc',
      })

      expect(saml.strategy).toBe('samlp')
      expect(saml.realms).toContain('okta.example.com')
      expect(oidc.strategy).toBe('oidc')
    })

    it('should support passwordless connections', () => {
      const sms = connectionsManager.create({
        name: 'sms',
        strategy: 'sms',
      })
      const email = connectionsManager.create({
        name: 'email',
        strategy: 'email',
      })

      expect(sms.strategy).toBe('sms')
      expect(email.strategy).toBe('email')
    })
  })

  // ============================================================================
  // METADATA
  // ============================================================================

  describe('connection metadata', () => {
    it('should store and update metadata', () => {
      const conn = connectionsManager.create({
        name: 'metadata-test',
        strategy: 'auth0',
        metadata: {
          department: 'engineering',
          team: 'platform',
        },
      })

      expect(conn.metadata?.department).toBe('engineering')

      const updated = connectionsManager.update(conn.id, {
        metadata: {
          department: 'engineering',
          team: 'platform',
          priority: 'high',
        },
      })

      expect(updated.metadata?.priority).toBe('high')
    })
  })
})
