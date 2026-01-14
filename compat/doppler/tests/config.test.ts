/**
 * @dotdo/doppler - Config API Compat Layer Tests
 *
 * Comprehensive tests for the Doppler Config API compatibility layer.
 * Following TDD: These tests are written first and should FAIL initially.
 *
 * Doppler is a secrets management platform. Configs represent different
 * environments/branches within a project (e.g., dev, staging, prod).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Core client
  DopplerClient,
  createClient,

  // Config types
  type Config,
  type ConfigListOptions,
  type ConfigListResponse,
  type ConfigGetOptions,
  type ConfigGetResponse,
  type ConfigCreateOptions,
  type ConfigCreateResponse,
  type ConfigUpdateOptions,
  type ConfigUpdateResponse,
  type ConfigDeleteOptions,
  type ConfigDeleteResponse,
  type ConfigCloneOptions,
  type ConfigCloneResponse,
  type ConfigLockOptions,
  type ConfigLockResponse,
  type ConfigUnlockOptions,
  type ConfigUnlockResponse,

  // Config logs/audit types
  type ConfigLog,
  type ConfigLogListOptions,
  type ConfigLogListResponse,
  type ConfigLogGetOptions,
  type ConfigLogGetResponse,
  type ConfigLogRollbackOptions,
  type ConfigLogRollbackResponse,

  // Test utilities
  createTestClient,
  _clear,
} from '../index'

describe('@dotdo/doppler - Config API Compat Layer', () => {
  beforeEach(() => {
    _clear()
  })

  // ===========================================================================
  // Client Initialization
  // ===========================================================================

  describe('Client Initialization', () => {
    it('should create client with API token', () => {
      const client = createClient({ token: 'dp.st.xxxx' })
      expect(client).toBeDefined()
      expect(client.token).toBe('dp.st.xxxx')
    })

    it('should accept optional base URL', () => {
      const client = createClient({
        token: 'dp.st.xxxx',
        baseUrl: 'https://custom.doppler.com',
      })
      expect(client.baseUrl).toBe('https://custom.doppler.com')
    })

    it('should have default base URL', () => {
      const client = createClient({ token: 'dp.st.xxxx' })
      expect(client.baseUrl).toBe('https://api.doppler.com')
    })

    it('should support API version configuration', () => {
      const client = createClient({
        token: 'dp.st.xxxx',
        apiVersion: 'v3',
      })
      expect(client.apiVersion).toBe('v3')
    })

    it('should default to v3 API', () => {
      const client = createClient({ token: 'dp.st.xxxx' })
      expect(client.apiVersion).toBe('v3')
    })

    it('should support timeout configuration', () => {
      const client = createClient({
        token: 'dp.st.xxxx',
        timeout: 30000,
      })
      expect(client.timeout).toBe(30000)
    })
  })

  // ===========================================================================
  // Config CRUD - List Configs
  // ===========================================================================

  describe('Config List', () => {
    it('should list configs for a project', async () => {
      const client = createTestClient({
        configs: [
          {
            name: 'dev',
            project: 'my-app',
            environment: 'development',
            root: true,
            locked: false,
            created_at: '2024-01-01T00:00:00Z',
          },
          {
            name: 'stg',
            project: 'my-app',
            environment: 'staging',
            root: true,
            locked: false,
            created_at: '2024-01-02T00:00:00Z',
          },
          {
            name: 'prd',
            project: 'my-app',
            environment: 'production',
            root: true,
            locked: true,
            created_at: '2024-01-03T00:00:00Z',
          },
        ],
      })

      const response = await client.configs.list({ project: 'my-app' })

      expect(response.configs).toHaveLength(3)
      expect(response.configs[0]?.name).toBe('dev')
      expect(response.configs[1]?.name).toBe('stg')
      expect(response.configs[2]?.name).toBe('prd')
    })

    it('should filter configs by environment', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
          { name: 'dev_feature', project: 'my-app', environment: 'development', root: false },
          { name: 'prd', project: 'my-app', environment: 'production', root: true },
        ],
      })

      const response = await client.configs.list({
        project: 'my-app',
        environment: 'development',
      })

      expect(response.configs).toHaveLength(2)
      expect(response.configs.every((c) => c.environment === 'development')).toBe(true)
    })

    it('should support pagination', async () => {
      const client = createTestClient({
        configs: Array.from({ length: 50 }, (_, i) => ({
          name: `config-${i}`,
          project: 'my-app',
          environment: 'development',
          root: i === 0,
        })),
      })

      const page1 = await client.configs.list({
        project: 'my-app',
        page: 1,
        per_page: 20,
      })

      expect(page1.configs).toHaveLength(20)
      expect(page1.page).toBe(1)

      const page2 = await client.configs.list({
        project: 'my-app',
        page: 2,
        per_page: 20,
      })

      expect(page2.configs).toHaveLength(20)
      expect(page2.page).toBe(2)
    })

    it('should return empty array for project with no configs', async () => {
      const client = createTestClient({ configs: [] })

      const response = await client.configs.list({ project: 'empty-project' })

      expect(response.configs).toHaveLength(0)
    })

    it('should throw error for missing project', async () => {
      const client = createTestClient()

      await expect(client.configs.list({} as ConfigListOptions)).rejects.toThrow(
        'project is required'
      )
    })
  })

  // ===========================================================================
  // Config CRUD - Get Single Config
  // ===========================================================================

  describe('Config Get', () => {
    it('should get a single config by name', async () => {
      const client = createTestClient({
        configs: [
          {
            name: 'dev',
            project: 'my-app',
            environment: 'development',
            root: true,
            locked: false,
            initial_fetch_at: '2024-01-01T00:00:00Z',
            last_fetch_at: '2024-01-15T12:00:00Z',
            created_at: '2024-01-01T00:00:00Z',
          },
        ],
      })

      const response = await client.configs.get({
        project: 'my-app',
        config: 'dev',
      })

      expect(response.config.name).toBe('dev')
      expect(response.config.project).toBe('my-app')
      expect(response.config.environment).toBe('development')
      expect(response.config.root).toBe(true)
      expect(response.config.locked).toBe(false)
    })

    it('should include fetch timestamps', async () => {
      const client = createTestClient({
        configs: [
          {
            name: 'dev',
            project: 'my-app',
            environment: 'development',
            root: true,
            initial_fetch_at: '2024-01-01T00:00:00Z',
            last_fetch_at: '2024-01-15T12:00:00Z',
          },
        ],
      })

      const response = await client.configs.get({
        project: 'my-app',
        config: 'dev',
      })

      expect(response.config.initial_fetch_at).toBe('2024-01-01T00:00:00Z')
      expect(response.config.last_fetch_at).toBe('2024-01-15T12:00:00Z')
    })

    it('should throw error for non-existent config', async () => {
      const client = createTestClient({ configs: [] })

      await expect(
        client.configs.get({ project: 'my-app', config: 'nonexistent' })
      ).rejects.toThrow('Config not found')
    })

    it('should throw error for missing project', async () => {
      const client = createTestClient()

      await expect(
        client.configs.get({ config: 'dev' } as ConfigGetOptions)
      ).rejects.toThrow('project is required')
    })

    it('should throw error for missing config name', async () => {
      const client = createTestClient()

      await expect(
        client.configs.get({ project: 'my-app' } as ConfigGetOptions)
      ).rejects.toThrow('config is required')
    })
  })

  // ===========================================================================
  // Config CRUD - Create Config
  // ===========================================================================

  describe('Config Create', () => {
    it('should create a new branch config', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
        ],
      })

      const response = await client.configs.create({
        project: 'my-app',
        environment: 'development',
        name: 'dev_feature',
      })

      expect(response.config.name).toBe('dev_feature')
      expect(response.config.project).toBe('my-app')
      expect(response.config.environment).toBe('development')
      expect(response.config.root).toBe(false) // Branch configs are not root
    })

    it('should auto-generate created_at timestamp', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
        ],
      })

      const before = new Date().toISOString()
      const response = await client.configs.create({
        project: 'my-app',
        environment: 'development',
        name: 'dev_feature',
      })
      const after = new Date().toISOString()

      expect(response.config.created_at).toBeDefined()
      expect(response.config.created_at >= before).toBe(true)
      expect(response.config.created_at <= after).toBe(true)
    })

    it('should throw error if config name already exists', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
        ],
      })

      await expect(
        client.configs.create({
          project: 'my-app',
          environment: 'development',
          name: 'dev',
        })
      ).rejects.toThrow('Config already exists')
    })

    it('should throw error for missing project', async () => {
      const client = createTestClient()

      await expect(
        client.configs.create({
          environment: 'development',
          name: 'dev',
        } as ConfigCreateOptions)
      ).rejects.toThrow('project is required')
    })

    it('should throw error for missing environment', async () => {
      const client = createTestClient()

      await expect(
        client.configs.create({
          project: 'my-app',
          name: 'dev',
        } as ConfigCreateOptions)
      ).rejects.toThrow('environment is required')
    })

    it('should throw error for missing name', async () => {
      const client = createTestClient()

      await expect(
        client.configs.create({
          project: 'my-app',
          environment: 'development',
        } as ConfigCreateOptions)
      ).rejects.toThrow('name is required')
    })

    it('should validate config name format', async () => {
      const client = createTestClient()

      await expect(
        client.configs.create({
          project: 'my-app',
          environment: 'development',
          name: 'invalid name with spaces!',
        })
      ).rejects.toThrow('Invalid config name')
    })
  })

  // ===========================================================================
  // Config CRUD - Update Config
  // ===========================================================================

  describe('Config Update', () => {
    it('should rename a config', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev_old', project: 'my-app', environment: 'development', root: false },
        ],
      })

      const response = await client.configs.update({
        project: 'my-app',
        config: 'dev_old',
        name: 'dev_new',
      })

      expect(response.config.name).toBe('dev_new')
    })

    it('should not allow renaming root configs', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
        ],
      })

      await expect(
        client.configs.update({
          project: 'my-app',
          config: 'dev',
          name: 'dev_renamed',
        })
      ).rejects.toThrow('Cannot rename root config')
    })

    it('should throw error for non-existent config', async () => {
      const client = createTestClient({ configs: [] })

      await expect(
        client.configs.update({
          project: 'my-app',
          config: 'nonexistent',
          name: 'new_name',
        })
      ).rejects.toThrow('Config not found')
    })

    it('should throw error if new name already exists', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev_a', project: 'my-app', environment: 'development', root: false },
          { name: 'dev_b', project: 'my-app', environment: 'development', root: false },
        ],
      })

      await expect(
        client.configs.update({
          project: 'my-app',
          config: 'dev_a',
          name: 'dev_b',
        })
      ).rejects.toThrow('Config name already exists')
    })

    it('should throw error for missing project', async () => {
      const client = createTestClient()

      await expect(
        client.configs.update({
          config: 'dev',
          name: 'dev_new',
        } as ConfigUpdateOptions)
      ).rejects.toThrow('project is required')
    })
  })

  // ===========================================================================
  // Config CRUD - Delete Config
  // ===========================================================================

  describe('Config Delete', () => {
    it('should delete a branch config', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
          { name: 'dev_feature', project: 'my-app', environment: 'development', root: false },
        ],
      })

      const response = await client.configs.delete({
        project: 'my-app',
        config: 'dev_feature',
      })

      expect(response.success).toBe(true)

      // Verify config is deleted
      const listResponse = await client.configs.list({ project: 'my-app' })
      expect(listResponse.configs).toHaveLength(1)
      expect(listResponse.configs[0]?.name).toBe('dev')
    })

    it('should not allow deleting root configs', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
        ],
      })

      await expect(
        client.configs.delete({
          project: 'my-app',
          config: 'dev',
        })
      ).rejects.toThrow('Cannot delete root config')
    })

    it('should not allow deleting locked configs', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev_feature', project: 'my-app', environment: 'development', root: false, locked: true },
        ],
      })

      await expect(
        client.configs.delete({
          project: 'my-app',
          config: 'dev_feature',
        })
      ).rejects.toThrow('Cannot delete locked config')
    })

    it('should throw error for non-existent config', async () => {
      const client = createTestClient({ configs: [] })

      await expect(
        client.configs.delete({
          project: 'my-app',
          config: 'nonexistent',
        })
      ).rejects.toThrow('Config not found')
    })

    it('should throw error for missing project', async () => {
      const client = createTestClient()

      await expect(
        client.configs.delete({ config: 'dev' } as ConfigDeleteOptions)
      ).rejects.toThrow('project is required')
    })
  })

  // ===========================================================================
  // Config Cloning
  // ===========================================================================

  describe('Config Clone', () => {
    it('should clone a config with all secrets', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
        ],
        secrets: {
          'my-app:dev': {
            API_KEY: 'secret-123',
            DATABASE_URL: 'postgres://localhost/db',
          },
        },
      })

      const response = await client.configs.clone({
        project: 'my-app',
        config: 'dev',
        name: 'dev_clone',
      })

      expect(response.config.name).toBe('dev_clone')
      expect(response.config.project).toBe('my-app')
      expect(response.config.environment).toBe('development')
      expect(response.config.root).toBe(false)

      // Verify secrets were cloned
      const secrets = await client.secrets.list({
        project: 'my-app',
        config: 'dev_clone',
      })
      expect(secrets.secrets.API_KEY).toBeDefined()
      expect(secrets.secrets.DATABASE_URL).toBeDefined()
    })

    it('should clone a branch config', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
          { name: 'dev_feature', project: 'my-app', environment: 'development', root: false },
        ],
      })

      const response = await client.configs.clone({
        project: 'my-app',
        config: 'dev_feature',
        name: 'dev_feature_clone',
      })

      expect(response.config.name).toBe('dev_feature_clone')
      expect(response.config.root).toBe(false)
    })

    it('should throw error if source config does not exist', async () => {
      const client = createTestClient({ configs: [] })

      await expect(
        client.configs.clone({
          project: 'my-app',
          config: 'nonexistent',
          name: 'clone',
        })
      ).rejects.toThrow('Config not found')
    })

    it('should throw error if target name already exists', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
          { name: 'dev_existing', project: 'my-app', environment: 'development', root: false },
        ],
      })

      await expect(
        client.configs.clone({
          project: 'my-app',
          config: 'dev',
          name: 'dev_existing',
        })
      ).rejects.toThrow('Config already exists')
    })

    it('should throw error for missing project', async () => {
      const client = createTestClient()

      await expect(
        client.configs.clone({
          config: 'dev',
          name: 'clone',
        } as ConfigCloneOptions)
      ).rejects.toThrow('project is required')
    })

    it('should throw error for missing name', async () => {
      const client = createTestClient()

      await expect(
        client.configs.clone({
          project: 'my-app',
          config: 'dev',
        } as ConfigCloneOptions)
      ).rejects.toThrow('name is required')
    })
  })

  // ===========================================================================
  // Config Locking
  // ===========================================================================

  describe('Config Lock', () => {
    it('should lock a config', async () => {
      const client = createTestClient({
        configs: [
          { name: 'prd', project: 'my-app', environment: 'production', root: true, locked: false },
        ],
      })

      const response = await client.configs.lock({
        project: 'my-app',
        config: 'prd',
      })

      expect(response.config.locked).toBe(true)
    })

    it('should prevent secret modifications on locked config', async () => {
      const client = createTestClient({
        configs: [
          { name: 'prd', project: 'my-app', environment: 'production', root: true, locked: true },
        ],
        secrets: {
          'my-app:prd': { API_KEY: 'secret-123' },
        },
      })

      await expect(
        client.secrets.set({
          project: 'my-app',
          config: 'prd',
          secrets: { API_KEY: 'new-value' },
        })
      ).rejects.toThrow('Config is locked')
    })

    it('should be idempotent - locking already locked config succeeds', async () => {
      const client = createTestClient({
        configs: [
          { name: 'prd', project: 'my-app', environment: 'production', root: true, locked: true },
        ],
      })

      const response = await client.configs.lock({
        project: 'my-app',
        config: 'prd',
      })

      expect(response.config.locked).toBe(true)
    })

    it('should throw error for non-existent config', async () => {
      const client = createTestClient({ configs: [] })

      await expect(
        client.configs.lock({
          project: 'my-app',
          config: 'nonexistent',
        })
      ).rejects.toThrow('Config not found')
    })

    it('should throw error for missing project', async () => {
      const client = createTestClient()

      await expect(
        client.configs.lock({ config: 'prd' } as ConfigLockOptions)
      ).rejects.toThrow('project is required')
    })
  })

  // ===========================================================================
  // Config Unlocking
  // ===========================================================================

  describe('Config Unlock', () => {
    it('should unlock a config', async () => {
      const client = createTestClient({
        configs: [
          { name: 'prd', project: 'my-app', environment: 'production', root: true, locked: true },
        ],
      })

      const response = await client.configs.unlock({
        project: 'my-app',
        config: 'prd',
      })

      expect(response.config.locked).toBe(false)
    })

    it('should allow secret modifications after unlock', async () => {
      const client = createTestClient({
        configs: [
          { name: 'prd', project: 'my-app', environment: 'production', root: true, locked: false },
        ],
        secrets: {
          'my-app:prd': { API_KEY: 'secret-123' },
        },
      })

      // Should not throw
      await client.secrets.set({
        project: 'my-app',
        config: 'prd',
        secrets: { API_KEY: 'new-value' },
      })
    })

    it('should be idempotent - unlocking already unlocked config succeeds', async () => {
      const client = createTestClient({
        configs: [
          { name: 'prd', project: 'my-app', environment: 'production', root: true, locked: false },
        ],
      })

      const response = await client.configs.unlock({
        project: 'my-app',
        config: 'prd',
      })

      expect(response.config.locked).toBe(false)
    })

    it('should throw error for non-existent config', async () => {
      const client = createTestClient({ configs: [] })

      await expect(
        client.configs.unlock({
          project: 'my-app',
          config: 'nonexistent',
        })
      ).rejects.toThrow('Config not found')
    })

    it('should throw error for missing project', async () => {
      const client = createTestClient()

      await expect(
        client.configs.unlock({ config: 'prd' } as ConfigUnlockOptions)
      ).rejects.toThrow('project is required')
    })
  })

  // ===========================================================================
  // Branch Configs
  // ===========================================================================

  describe('Branch Configs', () => {
    it('should create branch config inheriting from root', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
        ],
        secrets: {
          'my-app:dev': {
            API_KEY: 'dev-key',
            DATABASE_URL: 'postgres://localhost/dev',
          },
        },
      })

      const response = await client.configs.create({
        project: 'my-app',
        environment: 'development',
        name: 'dev_feature',
      })

      expect(response.config.root).toBe(false)

      // Branch should inherit secrets from root
      const secrets = await client.secrets.list({
        project: 'my-app',
        config: 'dev_feature',
      })
      expect(secrets.secrets.API_KEY).toBe('dev-key')
      expect(secrets.secrets.DATABASE_URL).toBe('postgres://localhost/dev')
    })

    it('should allow overriding inherited secrets', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
          { name: 'dev_feature', project: 'my-app', environment: 'development', root: false },
        ],
        secrets: {
          'my-app:dev': { API_KEY: 'dev-key' },
          'my-app:dev_feature': { API_KEY: 'dev-key' }, // Inherited
        },
      })

      await client.secrets.set({
        project: 'my-app',
        config: 'dev_feature',
        secrets: { API_KEY: 'feature-key' },
      })

      const secrets = await client.secrets.list({
        project: 'my-app',
        config: 'dev_feature',
      })
      expect(secrets.secrets.API_KEY).toBe('feature-key')

      // Root should be unchanged
      const rootSecrets = await client.secrets.list({
        project: 'my-app',
        config: 'dev',
      })
      expect(rootSecrets.secrets.API_KEY).toBe('dev-key')
    })

    it('should list branch configs for environment', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
          { name: 'dev_feature_a', project: 'my-app', environment: 'development', root: false },
          { name: 'dev_feature_b', project: 'my-app', environment: 'development', root: false },
          { name: 'prd', project: 'my-app', environment: 'production', root: true },
        ],
      })

      const response = await client.configs.list({
        project: 'my-app',
        environment: 'development',
        root: false,
      })

      expect(response.configs).toHaveLength(2)
      expect(response.configs.every((c) => c.root === false)).toBe(true)
    })

    it('should identify root configs', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
          { name: 'dev_feature', project: 'my-app', environment: 'development', root: false },
        ],
      })

      const rootResponse = await client.configs.get({
        project: 'my-app',
        config: 'dev',
      })
      expect(rootResponse.config.root).toBe(true)

      const branchResponse = await client.configs.get({
        project: 'my-app',
        config: 'dev_feature',
      })
      expect(branchResponse.config.root).toBe(false)
    })

    it('should delete branch without affecting root', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
          { name: 'dev_feature', project: 'my-app', environment: 'development', root: false },
        ],
        secrets: {
          'my-app:dev': { API_KEY: 'dev-key' },
          'my-app:dev_feature': { API_KEY: 'feature-key' },
        },
      })

      await client.configs.delete({
        project: 'my-app',
        config: 'dev_feature',
      })

      // Root should still exist
      const rootResponse = await client.configs.get({
        project: 'my-app',
        config: 'dev',
      })
      expect(rootResponse.config.name).toBe('dev')

      // Root secrets should be unchanged
      const rootSecrets = await client.secrets.list({
        project: 'my-app',
        config: 'dev',
      })
      expect(rootSecrets.secrets.API_KEY).toBe('dev-key')
    })

    it('should support nested branch inheritance', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
        ],
        secrets: {
          'my-app:dev': {
            API_KEY: 'dev-key',
            DATABASE_URL: 'postgres://localhost/dev',
            LOG_LEVEL: 'debug',
          },
        },
      })

      // Create first level branch
      await client.configs.create({
        project: 'my-app',
        environment: 'development',
        name: 'dev_feature',
      })

      // Override one secret in feature branch
      await client.secrets.set({
        project: 'my-app',
        config: 'dev_feature',
        secrets: { DATABASE_URL: 'postgres://localhost/feature' },
      })

      // Feature branch should have mix of inherited and overridden
      const featureSecrets = await client.secrets.list({
        project: 'my-app',
        config: 'dev_feature',
      })
      expect(featureSecrets.secrets.API_KEY).toBe('dev-key') // Inherited
      expect(featureSecrets.secrets.DATABASE_URL).toBe('postgres://localhost/feature') // Overridden
      expect(featureSecrets.secrets.LOG_LEVEL).toBe('debug') // Inherited
    })
  })

  // ===========================================================================
  // Config History / Audit Log
  // ===========================================================================

  describe('Config Logs (History/Audit)', () => {
    it('should list config change history', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
        ],
        configLogs: [
          {
            id: 'log-1',
            config: 'dev',
            project: 'my-app',
            created_at: '2024-01-01T00:00:00Z',
            user: { name: 'alice@example.com' },
            diff: [
              { name: 'API_KEY', added: 'secret-123' },
            ],
          },
          {
            id: 'log-2',
            config: 'dev',
            project: 'my-app',
            created_at: '2024-01-02T00:00:00Z',
            user: { name: 'bob@example.com' },
            diff: [
              { name: 'API_KEY', removed: 'secret-123', added: 'secret-456' },
            ],
          },
        ],
      })

      const response = await client.configLogs.list({
        project: 'my-app',
        config: 'dev',
      })

      expect(response.logs).toHaveLength(2)
      expect(response.logs[0]?.id).toBe('log-1')
      expect(response.logs[1]?.id).toBe('log-2')
    })

    it('should get specific config log entry', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
        ],
        configLogs: [
          {
            id: 'log-1',
            config: 'dev',
            project: 'my-app',
            created_at: '2024-01-01T00:00:00Z',
            user: { name: 'alice@example.com', email: 'alice@example.com' },
            diff: [
              { name: 'API_KEY', added: 'secret-123' },
            ],
            rollback: true,
          },
        ],
      })

      const response = await client.configLogs.get({
        project: 'my-app',
        config: 'dev',
        log: 'log-1',
      })

      expect(response.log.id).toBe('log-1')
      expect(response.log.user.name).toBe('alice@example.com')
      expect(response.log.diff).toHaveLength(1)
      expect(response.log.diff[0]?.name).toBe('API_KEY')
      expect(response.log.rollback).toBe(true)
    })

    it('should rollback to specific log entry', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
        ],
        secrets: {
          'my-app:dev': { API_KEY: 'current-key' },
        },
        configLogs: [
          {
            id: 'log-1',
            config: 'dev',
            project: 'my-app',
            created_at: '2024-01-01T00:00:00Z',
            secrets: { API_KEY: 'old-key' },
          },
        ],
      })

      const response = await client.configLogs.rollback({
        project: 'my-app',
        config: 'dev',
        log: 'log-1',
      })

      expect(response.success).toBe(true)

      // Verify secrets were rolled back
      const secrets = await client.secrets.list({
        project: 'my-app',
        config: 'dev',
      })
      expect(secrets.secrets.API_KEY).toBe('old-key')
    })

    it('should include diff details in log entry', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
        ],
        configLogs: [
          {
            id: 'log-1',
            config: 'dev',
            project: 'my-app',
            created_at: '2024-01-01T00:00:00Z',
            diff: [
              { name: 'NEW_KEY', added: 'value' },
              { name: 'UPDATED_KEY', removed: 'old', added: 'new' },
              { name: 'DELETED_KEY', removed: 'removed-value' },
            ],
          },
        ],
      })

      const response = await client.configLogs.get({
        project: 'my-app',
        config: 'dev',
        log: 'log-1',
      })

      const newKey = response.log.diff.find((d) => d.name === 'NEW_KEY')
      expect(newKey?.added).toBe('value')
      expect(newKey?.removed).toBeUndefined()

      const updatedKey = response.log.diff.find((d) => d.name === 'UPDATED_KEY')
      expect(updatedKey?.added).toBe('new')
      expect(updatedKey?.removed).toBe('old')

      const deletedKey = response.log.diff.find((d) => d.name === 'DELETED_KEY')
      expect(deletedKey?.added).toBeUndefined()
      expect(deletedKey?.removed).toBe('removed-value')
    })

    it('should paginate config logs', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
        ],
        configLogs: Array.from({ length: 50 }, (_, i) => ({
          id: `log-${i}`,
          config: 'dev',
          project: 'my-app',
          created_at: new Date(2024, 0, i + 1).toISOString(),
          diff: [],
        })),
      })

      const page1 = await client.configLogs.list({
        project: 'my-app',
        config: 'dev',
        page: 1,
        per_page: 20,
      })

      expect(page1.logs).toHaveLength(20)
      expect(page1.page).toBe(1)

      const page2 = await client.configLogs.list({
        project: 'my-app',
        config: 'dev',
        page: 2,
        per_page: 20,
      })

      expect(page2.logs).toHaveLength(20)
      expect(page2.page).toBe(2)
    })

    it('should throw error for non-existent log entry', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
        ],
        configLogs: [],
      })

      await expect(
        client.configLogs.get({
          project: 'my-app',
          config: 'dev',
          log: 'nonexistent',
        })
      ).rejects.toThrow('Log not found')
    })

    it('should not allow rollback on locked config', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true, locked: true },
        ],
        configLogs: [
          {
            id: 'log-1',
            config: 'dev',
            project: 'my-app',
            secrets: { API_KEY: 'old-key' },
          },
        ],
      })

      await expect(
        client.configLogs.rollback({
          project: 'my-app',
          config: 'dev',
          log: 'log-1',
        })
      ).rejects.toThrow('Config is locked')
    })
  })

  // ===========================================================================
  // Config Trusted IPs (Access Control)
  // ===========================================================================

  describe('Config Trusted IPs', () => {
    it('should list trusted IPs for config', async () => {
      const client = createTestClient({
        configs: [
          { name: 'prd', project: 'my-app', environment: 'production', root: true },
        ],
        trustedIps: {
          'my-app:prd': ['10.0.0.0/8', '192.168.1.0/24'],
        },
      })

      const response = await client.configs.listTrustedIps({
        project: 'my-app',
        config: 'prd',
      })

      expect(response.ips).toHaveLength(2)
      expect(response.ips).toContain('10.0.0.0/8')
      expect(response.ips).toContain('192.168.1.0/24')
    })

    it('should add trusted IP', async () => {
      const client = createTestClient({
        configs: [
          { name: 'prd', project: 'my-app', environment: 'production', root: true },
        ],
        trustedIps: {
          'my-app:prd': [],
        },
      })

      const response = await client.configs.addTrustedIp({
        project: 'my-app',
        config: 'prd',
        ip: '10.0.0.0/8',
      })

      expect(response.ips).toContain('10.0.0.0/8')
    })

    it('should remove trusted IP', async () => {
      const client = createTestClient({
        configs: [
          { name: 'prd', project: 'my-app', environment: 'production', root: true },
        ],
        trustedIps: {
          'my-app:prd': ['10.0.0.0/8', '192.168.1.0/24'],
        },
      })

      const response = await client.configs.removeTrustedIp({
        project: 'my-app',
        config: 'prd',
        ip: '10.0.0.0/8',
      })

      expect(response.ips).not.toContain('10.0.0.0/8')
      expect(response.ips).toContain('192.168.1.0/24')
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should handle authentication errors', async () => {
      const client = createClient({ token: 'invalid-token' })

      await expect(
        client.configs.list({ project: 'my-app' })
      ).rejects.toThrow('Unauthorized')
    })

    it('should handle rate limiting', async () => {
      const client = createTestClient({
        rateLimit: true,
      })

      await expect(
        client.configs.list({ project: 'my-app' })
      ).rejects.toThrow('Rate limit exceeded')
    })

    it('should handle network errors gracefully', async () => {
      const client = createTestClient({
        networkError: true,
      })

      await expect(
        client.configs.list({ project: 'my-app' })
      ).rejects.toThrow('Network error')
    })

    it('should include error details in response', async () => {
      const client = createTestClient({ configs: [] })

      try {
        await client.configs.get({ project: 'my-app', config: 'nonexistent' })
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.code).toBeDefined()
        expect(error.message).toBe('Config not found')
      }
    })
  })

  // ===========================================================================
  // Inheritable Secrets
  // ===========================================================================

  describe('Config Inheritable Secrets', () => {
    it('should list inheritable secrets from root', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
          { name: 'dev_feature', project: 'my-app', environment: 'development', root: false },
        ],
        secrets: {
          'my-app:dev': {
            API_KEY: 'dev-key',
            DATABASE_URL: 'postgres://localhost/dev',
          },
        },
      })

      const response = await client.configs.listInheritable({
        project: 'my-app',
        config: 'dev_feature',
      })

      expect(response.secrets).toHaveLength(2)
      expect(response.secrets.map((s) => s.name)).toContain('API_KEY')
      expect(response.secrets.map((s) => s.name)).toContain('DATABASE_URL')
    })

    it('should mark overridden secrets', async () => {
      const client = createTestClient({
        configs: [
          { name: 'dev', project: 'my-app', environment: 'development', root: true },
          { name: 'dev_feature', project: 'my-app', environment: 'development', root: false },
        ],
        secrets: {
          'my-app:dev': {
            API_KEY: 'dev-key',
            DATABASE_URL: 'postgres://localhost/dev',
          },
          'my-app:dev_feature': {
            API_KEY: 'feature-key', // Overridden
          },
        },
      })

      const response = await client.configs.listInheritable({
        project: 'my-app',
        config: 'dev_feature',
      })

      const apiKey = response.secrets.find((s) => s.name === 'API_KEY')
      expect(apiKey?.overridden).toBe(true)

      const dbUrl = response.secrets.find((s) => s.name === 'DATABASE_URL')
      expect(dbUrl?.overridden).toBe(false)
    })
  })
})
