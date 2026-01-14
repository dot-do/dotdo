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

    it('should update a connection', async () => {
      const conn = connectionsManager.create({
        name: 'to-update',
        strategy: 'auth0',
      })

      // Wait to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 2))

      const updated = connectionsManager.update(conn.id, {
        display_name: 'Updated Display Name',
        options: {
          disable_signup: true,
        },
      })

      expect(updated.display_name).toBe('Updated Display Name')
      expect(updated.options.disable_signup).toBe(true)
      expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(conn.updated_at).getTime()
      )
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

  // ============================================================================
  // SCRIPT CONTEXT VALIDATION
  // ============================================================================

  describe('script context', () => {
    it('should pass correct context to login script', async () => {
      let capturedContext: unknown = null

      connectionsManager.create({
        name: 'context-test',
        strategy: 'auth0',
        options: {
          configuration: {
            API_KEY: 'secret-key',
            DB_HOST: 'localhost',
          },
          customScripts: {
            login: async (email, password, context) => {
              capturedContext = context
              return { user_id: 'test', email }
            },
          },
        },
      })

      await connectionsManager.executeLogin('context-test', 'test@example.com', 'pass', 'client_abc')

      expect(capturedContext).toMatchObject({
        domain: 'test.auth0.com',
        clientId: 'client_abc',
        connection: 'context-test',
        configuration: {
          API_KEY: 'secret-key',
          DB_HOST: 'localhost',
        },
      })
    })

    it('should pass correct context to getUser script', async () => {
      let capturedContext: unknown = null

      connectionsManager.create({
        name: 'getuser-context',
        strategy: 'auth0',
        options: {
          configuration: { TENANT: 'acme' },
          customScripts: {
            getUser: async (email, context) => {
              capturedContext = context
              return { user_id: 'found', email }
            },
          },
        },
      })

      await connectionsManager.executeGetUser('getuser-context', 'test@example.com', 'client_xyz')

      expect(capturedContext).toMatchObject({
        domain: 'test.auth0.com',
        clientId: 'client_xyz',
        connection: 'getuser-context',
        configuration: { TENANT: 'acme' },
      })
    })

    it('should pass correct context to create script', async () => {
      let capturedContext: unknown = null
      let capturedUser: unknown = null

      connectionsManager.create({
        name: 'create-context',
        strategy: 'auth0',
        options: {
          customScripts: {
            create: async (user, context) => {
              capturedContext = context
              capturedUser = user
              return { user_id: 'new_id', email: user.email }
            },
          },
        },
      })

      await connectionsManager.executeCreate(
        'create-context',
        {
          email: 'new@example.com',
          password: 'Password123',
          username: 'newuser',
          user_metadata: { locale: 'en-US' },
        },
        'client_123'
      )

      expect(capturedContext).toMatchObject({
        domain: 'test.auth0.com',
        clientId: 'client_123',
        connection: 'create-context',
      })
      expect(capturedUser).toMatchObject({
        email: 'new@example.com',
        password: 'Password123',
        username: 'newuser',
        user_metadata: { locale: 'en-US' },
      })
    })

    it('should pass correct context to delete script', async () => {
      let capturedUserId: string | null = null
      let capturedContext: unknown = null

      connectionsManager.create({
        name: 'delete-context',
        strategy: 'auth0',
        options: {
          customScripts: {
            delete: async (userId, context) => {
              capturedUserId = userId
              capturedContext = context
            },
          },
        },
      })

      await connectionsManager.executeDelete('delete-context', 'user_to_delete', 'client_del')

      expect(capturedUserId).toBe('user_to_delete')
      expect(capturedContext).toMatchObject({
        domain: 'test.auth0.com',
        clientId: 'client_del',
        connection: 'delete-context',
      })
    })

    it('should pass correct context to verify script', async () => {
      let capturedEmail: string | null = null
      let capturedContext: unknown = null

      connectionsManager.create({
        name: 'verify-context',
        strategy: 'auth0',
        options: {
          customScripts: {
            verify: async (email, context) => {
              capturedEmail = email
              capturedContext = context
            },
          },
        },
      })

      await connectionsManager.executeVerify('verify-context', 'verify@example.com', 'client_ver')

      expect(capturedEmail).toBe('verify@example.com')
      expect(capturedContext).toMatchObject({
        domain: 'test.auth0.com',
        clientId: 'client_ver',
        connection: 'verify-context',
      })
    })

    it('should pass correct context to changePassword script', async () => {
      let capturedEmail: string | null = null
      let capturedNewPassword: string | null = null
      let capturedContext: unknown = null

      connectionsManager.create({
        name: 'changepwd-context',
        strategy: 'auth0',
        options: {
          customScripts: {
            changePassword: async (email, newPassword, context) => {
              capturedEmail = email
              capturedNewPassword = newPassword
              capturedContext = context
            },
          },
        },
      })

      await connectionsManager.executeChangePassword(
        'changepwd-context',
        'user@example.com',
        'NewSecure123',
        'client_pwd'
      )

      expect(capturedEmail).toBe('user@example.com')
      expect(capturedNewPassword).toBe('NewSecure123')
      expect(capturedContext).toMatchObject({
        domain: 'test.auth0.com',
        clientId: 'client_pwd',
        connection: 'changepwd-context',
      })
    })
  })

  // ============================================================================
  // TIMEOUT HANDLING
  // ============================================================================

  describe('script timeout handling', () => {
    it('should timeout slow login script', async () => {
      const slowManager = new ConnectionsManager({
        domain: 'test.auth0.com',
        scriptTimeout: 50, // 50ms timeout
      })

      slowManager.create({
        name: 'slow-login',
        strategy: 'auth0',
        options: {
          customScripts: {
            login: async () => {
              // Simulate slow operation
              await new Promise((resolve) => setTimeout(resolve, 200))
              return { user_id: 'test', email: 'test@example.com' }
            },
          },
        },
      })

      await expect(
        slowManager.executeLogin('slow-login', 'test@example.com', 'password')
      ).rejects.toThrow('timeout')
    })

    it('should timeout slow getUser script', async () => {
      const slowManager = new ConnectionsManager({
        domain: 'test.auth0.com',
        scriptTimeout: 50,
      })

      slowManager.create({
        name: 'slow-getuser',
        strategy: 'auth0',
        options: {
          customScripts: {
            getUser: async () => {
              await new Promise((resolve) => setTimeout(resolve, 200))
              return { user_id: 'test', email: 'test@example.com' }
            },
          },
        },
      })

      await expect(
        slowManager.executeGetUser('slow-getuser', 'test@example.com')
      ).rejects.toThrow('timeout')
    })

    it('should timeout slow create script', async () => {
      const slowManager = new ConnectionsManager({
        domain: 'test.auth0.com',
        scriptTimeout: 50,
      })

      slowManager.create({
        name: 'slow-create',
        strategy: 'auth0',
        options: {
          customScripts: {
            create: async () => {
              await new Promise((resolve) => setTimeout(resolve, 200))
              return { user_id: 'test', email: 'test@example.com' }
            },
          },
        },
      })

      await expect(
        slowManager.executeCreate('slow-create', { email: 'test@example.com', password: 'Password123' })
      ).rejects.toThrow('timeout')
    })

    it('should complete fast scripts before timeout', async () => {
      const fastManager = new ConnectionsManager({
        domain: 'test.auth0.com',
        scriptTimeout: 1000,
      })

      fastManager.create({
        name: 'fast-login',
        strategy: 'auth0',
        options: {
          customScripts: {
            login: async (email) => {
              await new Promise((resolve) => setTimeout(resolve, 10))
              return { user_id: 'fast', email }
            },
          },
        },
      })

      const user = await fastManager.executeLogin('fast-login', 'test@example.com', 'password')
      expect(user.user_id).toBe('fast')
    })
  })

  // ============================================================================
  // LAZY MIGRATION (IMPORT MODE)
  // ============================================================================

  describe('lazy migration flow', () => {
    let migratedUsers: Map<string, { id: string; email: string; migrated: boolean }>
    let legacyDb: Map<string, { id: string; email: string; password: string }>
    let migrationManager: ConnectionsManager

    beforeEach(() => {
      // Simulated legacy database
      legacyDb = new Map()
      legacyDb.set('legacy@example.com', {
        id: 'legacy_123',
        email: 'legacy@example.com',
        password: 'legacypassword',
      })
      legacyDb.set('another@example.com', {
        id: 'legacy_456',
        email: 'another@example.com',
        password: 'anotherpassword',
      })

      // Users that have been migrated to Auth0
      migratedUsers = new Map()

      migrationManager = new ConnectionsManager({
        domain: 'migration.auth0.com',
      })

      migrationManager.create({
        name: 'migration-db',
        strategy: 'auth0',
        options: {
          import_mode: true,
          customScripts: {
            login: async (email, password): Promise<CustomDatabaseUser> => {
              const legacyUser = legacyDb.get(email)
              if (!legacyUser || legacyUser.password !== password) {
                throw new Error('Invalid credentials')
              }
              // Mark user as migrated on successful login
              migratedUsers.set(email, {
                id: legacyUser.id,
                email: legacyUser.email,
                migrated: true,
              })
              return {
                user_id: legacyUser.id,
                email: legacyUser.email,
                email_verified: true,
              }
            },
            getUser: async (email): Promise<CustomDatabaseUser | null> => {
              const legacyUser = legacyDb.get(email)
              if (!legacyUser) return null
              return {
                user_id: legacyUser.id,
                email: legacyUser.email,
              }
            },
          },
        },
      })
    })

    it('should be in import mode', () => {
      expect(migrationManager.isImportMode('migration-db')).toBe(true)
    })

    it('should migrate user on first login', async () => {
      expect(migratedUsers.has('legacy@example.com')).toBe(false)

      const user = await migrationManager.executeLogin(
        'migration-db',
        'legacy@example.com',
        'legacypassword'
      )

      expect(user.user_id).toBe('legacy_123')
      expect(migratedUsers.has('legacy@example.com')).toBe(true)
      expect(migratedUsers.get('legacy@example.com')?.migrated).toBe(true)
    })

    it('should find user in legacy database via getUser', async () => {
      const user = await migrationManager.executeGetUser('migration-db', 'legacy@example.com')

      expect(user).not.toBeNull()
      expect(user?.user_id).toBe('legacy_123')
    })

    it('should return null for non-existent legacy user', async () => {
      const user = await migrationManager.executeGetUser('migration-db', 'nonexistent@example.com')
      expect(user).toBeNull()
    })

    it('should reject invalid password from legacy db', async () => {
      await expect(
        migrationManager.executeLogin('migration-db', 'legacy@example.com', 'wrongpassword')
      ).rejects.toThrow('Invalid credentials')

      // User should not be migrated on failed login
      expect(migratedUsers.has('legacy@example.com')).toBe(false)
    })
  })

  // ============================================================================
  // ERROR HANDLING EDGE CASES
  // ============================================================================

  describe('error handling edge cases', () => {
    it('should handle script that throws custom error', async () => {
      connectionsManager.create({
        name: 'error-script',
        strategy: 'auth0',
        options: {
          customScripts: {
            login: async () => {
              throw new Error('Database connection failed')
            },
          },
        },
      })

      await expect(
        connectionsManager.executeLogin('error-script', 'test@example.com', 'password')
      ).rejects.toThrow('Database connection failed')
    })

    it('should handle script that throws non-Error object', async () => {
      connectionsManager.create({
        name: 'throw-string',
        strategy: 'auth0',
        options: {
          customScripts: {
            login: async () => {
              throw 'string error'
            },
          },
        },
      })

      await expect(
        connectionsManager.executeLogin('throw-string', 'test@example.com', 'password')
      ).rejects.toThrow()
    })

    it('should handle script that rejects without error', async () => {
      connectionsManager.create({
        name: 'reject-undefined',
        strategy: 'auth0',
        options: {
          customScripts: {
            login: async () => {
              return Promise.reject()
            },
          },
        },
      })

      await expect(
        connectionsManager.executeLogin('reject-undefined', 'test@example.com', 'password')
      ).rejects.toThrow()
    })

    it('should validate password on create even with weak policy', () => {
      const weakManager = new ConnectionsManager({
        domain: 'test.auth0.com',
        defaultPasswordPolicy: {
          minLength: 4,
          requireLowercase: false,
          requireUppercase: false,
          requireNumbers: false,
        },
      })

      // Should pass with weak password
      expect(() => weakManager.validatePassword('test')).not.toThrow()

      // Should still fail if too short
      expect(() => weakManager.validatePassword('abc')).toThrow('at least 4')
    })

    it('should handle empty configuration object', async () => {
      let capturedConfig: Record<string, string> | undefined

      connectionsManager.create({
        name: 'no-config',
        strategy: 'auth0',
        options: {
          customScripts: {
            login: async (email, password, context) => {
              capturedConfig = context.configuration
              return { user_id: 'test', email }
            },
          },
        },
      })

      await connectionsManager.executeLogin('no-config', 'test@example.com', 'password')

      expect(capturedConfig).toEqual({})
    })
  })

  // ============================================================================
  // USER DATA MAPPING
  // ============================================================================

  describe('user data mapping', () => {
    it('should return full user profile from login script', async () => {
      connectionsManager.create({
        name: 'full-profile',
        strategy: 'auth0',
        options: {
          customScripts: {
            login: async (email): Promise<CustomDatabaseUser> => ({
              user_id: 'full_123',
              email,
              email_verified: true,
              phone_number: '+1234567890',
              phone_verified: false,
              username: 'fulluser',
              given_name: 'Full',
              family_name: 'User',
              name: 'Full User',
              nickname: 'fullie',
              picture: 'https://example.com/avatar.png',
              user_metadata: { theme: 'dark', locale: 'en-US' },
              app_metadata: { roles: ['admin'], plan: 'enterprise' },
            }),
          },
        },
      })

      const user = await connectionsManager.executeLogin('full-profile', 'full@example.com', 'pass')

      expect(user).toMatchObject({
        user_id: 'full_123',
        email: 'full@example.com',
        email_verified: true,
        phone_number: '+1234567890',
        phone_verified: false,
        username: 'fulluser',
        given_name: 'Full',
        family_name: 'User',
        name: 'Full User',
        nickname: 'fullie',
        picture: 'https://example.com/avatar.png',
        user_metadata: { theme: 'dark', locale: 'en-US' },
        app_metadata: { roles: ['admin'], plan: 'enterprise' },
      })
    })

    it('should handle minimal user profile', async () => {
      connectionsManager.create({
        name: 'minimal-profile',
        strategy: 'auth0',
        options: {
          customScripts: {
            login: async (email): Promise<CustomDatabaseUser> => ({
              user_id: 'min_123',
              email,
            }),
          },
        },
      })

      const user = await connectionsManager.executeLogin('minimal-profile', 'min@example.com', 'pass')

      expect(user.user_id).toBe('min_123')
      expect(user.email).toBe('min@example.com')
      expect(user.email_verified).toBeUndefined()
      expect(user.username).toBeUndefined()
    })

    it('should handle user without email (phone-only)', async () => {
      connectionsManager.create({
        name: 'phone-only',
        strategy: 'auth0',
        options: {
          customScripts: {
            login: async (): Promise<CustomDatabaseUser> => ({
              user_id: 'phone_123',
              phone_number: '+1987654321',
              phone_verified: true,
            }),
          },
        },
      })

      const user = await connectionsManager.executeLogin('phone-only', '+1987654321', 'pass')

      expect(user.user_id).toBe('phone_123')
      expect(user.phone_number).toBe('+1987654321')
      expect(user.phone_verified).toBe(true)
      expect(user.email).toBeUndefined()
    })
  })

  // ============================================================================
  // CONNECTION CONFIGURATION UPDATES
  // ============================================================================

  describe('connection configuration updates', () => {
    it('should update custom scripts', async () => {
      const conn = connectionsManager.create({
        name: 'update-scripts',
        strategy: 'auth0',
        options: {
          customScripts: {
            login: async (email): Promise<CustomDatabaseUser> => ({
              user_id: 'original',
              email,
            }),
          },
        },
      })

      // Original script returns 'original'
      let user = await connectionsManager.executeLogin('update-scripts', 'test@example.com', 'pass')
      expect(user.user_id).toBe('original')

      // Update script
      connectionsManager.update(conn.id, {
        options: {
          customScripts: {
            login: async (email): Promise<CustomDatabaseUser> => ({
              user_id: 'updated',
              email,
            }),
          },
        },
      })

      // Updated script returns 'updated'
      user = await connectionsManager.executeLogin('update-scripts', 'test@example.com', 'pass')
      expect(user.user_id).toBe('updated')
    })

    it('should update configuration values', async () => {
      let capturedConfig: Record<string, string> | undefined

      const conn = connectionsManager.create({
        name: 'config-update',
        strategy: 'auth0',
        options: {
          configuration: { API_KEY: 'old_key' },
          customScripts: {
            login: async (email, password, context): Promise<CustomDatabaseUser> => {
              capturedConfig = context.configuration
              return { user_id: 'test', email }
            },
          },
        },
      })

      await connectionsManager.executeLogin('config-update', 'test@example.com', 'pass')
      expect(capturedConfig?.API_KEY).toBe('old_key')

      connectionsManager.update(conn.id, {
        options: {
          configuration: { API_KEY: 'new_key', DB_URL: 'localhost' },
        },
      })

      await connectionsManager.executeLogin('config-update', 'test@example.com', 'pass')
      expect(capturedConfig?.API_KEY).toBe('new_key')
      expect(capturedConfig?.DB_URL).toBe('localhost')
    })

    it('should update password policy', () => {
      const conn = connectionsManager.create({
        name: 'policy-update',
        strategy: 'auth0',
        options: {
          passwordPolicy: {
            minLength: 6,
            requireSpecialCharacters: false,
          },
        },
      })

      // Original policy allows 'Simple1'
      expect(() =>
        connectionsManager.validatePassword('Simple1', conn.options.passwordPolicy)
      ).not.toThrow()

      // Update to require special characters
      const updated = connectionsManager.update(conn.id, {
        options: {
          passwordPolicy: {
            minLength: 8,
            requireSpecialCharacters: true,
          },
        },
      })

      // Updated policy rejects password without special character
      expect(() =>
        connectionsManager.validatePassword('SimplePassword1', updated.options.passwordPolicy)
      ).toThrow('special character')
    })
  })

  // ============================================================================
  // CONNECTION ID GENERATION
  // ============================================================================

  describe('connection ID generation', () => {
    it('should generate unique IDs for each connection', () => {
      const ids = new Set<string>()

      for (let i = 0; i < 10; i++) {
        const conn = connectionsManager.create({
          name: `unique-conn-${i}`,
          strategy: 'auth0',
        })
        expect(conn.id).toMatch(/^con_[a-f0-9]{24}$/)
        expect(ids.has(conn.id)).toBe(false)
        ids.add(conn.id)
      }

      expect(ids.size).toBe(10)
    })

    it('should generate IDs with correct format', () => {
      const conn = connectionsManager.create({
        name: 'id-format-test',
        strategy: 'auth0',
      })

      // con_ prefix followed by 24 hex characters (12 bytes = 24 hex chars)
      expect(conn.id).toMatch(/^con_[a-f0-9]{24}$/)
    })
  })

  // ============================================================================
  // BRUTE FORCE PROTECTION CONFIGURATION
  // ============================================================================

  describe('brute force protection', () => {
    it('should configure brute force protection', () => {
      const conn = connectionsManager.create({
        name: 'brute-force-test',
        strategy: 'auth0',
        options: {
          brute_force_protection: true,
          passwordPolicy: {
            maxAttempts: 5,
            lockoutDuration: 300, // 5 minutes
          },
        },
      })

      expect(conn.options.brute_force_protection).toBe(true)
      expect(conn.options.passwordPolicy?.maxAttempts).toBe(5)
      expect(conn.options.passwordPolicy?.lockoutDuration).toBe(300)
    })

    it('should disable brute force protection', () => {
      const conn = connectionsManager.create({
        name: 'no-brute-force',
        strategy: 'auth0',
        options: {
          brute_force_protection: false,
        },
      })

      expect(conn.options.brute_force_protection).toBe(false)
    })
  })

  // ============================================================================
  // MFA CONFIGURATION
  // ============================================================================

  describe('MFA configuration', () => {
    it('should configure MFA settings', () => {
      const conn = connectionsManager.create({
        name: 'mfa-test',
        strategy: 'auth0',
        options: {
          mfa: {
            active: true,
            return_enroll_settings: true,
          },
        },
      })

      expect(conn.options.mfa?.active).toBe(true)
      expect(conn.options.mfa?.return_enroll_settings).toBe(true)
    })
  })

  // ============================================================================
  // SIGNUP CONFIGURATION
  // ============================================================================

  describe('signup configuration', () => {
    it('should disable signup', () => {
      const conn = connectionsManager.create({
        name: 'no-signup',
        strategy: 'auth0',
        options: {
          disable_signup: true,
        },
      })

      expect(conn.options.disable_signup).toBe(true)
    })

    it('should disable self-service password change', () => {
      const conn = connectionsManager.create({
        name: 'no-self-pwd',
        strategy: 'auth0',
        options: {
          disable_self_service_change_password: true,
        },
      })

      expect(conn.options.disable_self_service_change_password).toBe(true)
    })
  })

  // ============================================================================
  // DOMAIN CONNECTION
  // ============================================================================

  describe('domain connection', () => {
    it('should create domain connection', () => {
      const conn = connectionsManager.create({
        name: 'domain-conn',
        strategy: 'auth0',
        is_domain_connection: true,
      })

      expect(conn.is_domain_connection).toBe(true)
    })

    it('should update domain connection flag', () => {
      const conn = connectionsManager.create({
        name: 'update-domain',
        strategy: 'auth0',
        is_domain_connection: false,
      })

      expect(conn.is_domain_connection).toBe(false)

      const updated = connectionsManager.update(conn.id, {
        is_domain_connection: true,
      })

      expect(updated.is_domain_connection).toBe(true)
    })
  })

  // ============================================================================
  // UPSTREAM PARAMS (SOCIAL CONNECTIONS)
  // ============================================================================

  describe('upstream params', () => {
    it('should configure upstream params for social connections', () => {
      const conn = connectionsManager.create({
        name: 'google-with-params',
        strategy: 'google-oauth2',
        options: {
          upstream_params: {
            hd: 'example.com', // Restrict to domain
            prompt: 'select_account',
          },
        },
      })

      expect(conn.options.upstream_params).toEqual({
        hd: 'example.com',
        prompt: 'select_account',
      })
    })
  })

  // ============================================================================
  // CUSTOM HEADERS
  // ============================================================================

  describe('custom headers', () => {
    it('should configure custom headers', () => {
      const conn = connectionsManager.create({
        name: 'headers-test',
        strategy: 'oidc',
        options: {
          headers: {
            'X-Custom-Header': 'custom-value',
            'X-API-Key': 'api-key-123',
          },
        },
      })

      expect(conn.options.headers).toEqual({
        'X-Custom-Header': 'custom-value',
        'X-API-Key': 'api-key-123',
      })
    })
  })
})
