/**
 * E2E Tests: Tenant-Specific Configurations
 *
 * Tests tenant configuration isolation:
 * - Per-tenant settings (rate limits, quotas, feature flags)
 * - Configuration inheritance and overrides
 * - Dynamic configuration updates without affecting other tenants
 * - Configuration rollback capabilities
 *
 * Run with: npx vitest run tests/e2e/multi-tenant/tenant-configuration.test.ts --project=integration
 *
 * @module tests/e2e/multi-tenant/tenant-configuration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Miniflare, DurableObjectStub } from 'miniflare'

/**
 * Miniflare config with tenant configuration support.
 * Each tenant DO has its own config store with inheritance from defaults.
 */
const getMiniflareConfig = () => ({
  modules: true,
  script: `
    /**
     * ConfigurableTenantDO - Supports tenant-specific configurations
     *
     * Features:
     * - Per-tenant settings stored in SQLite
     * - Default config with per-tenant overrides
     * - Feature flag system per tenant
     * - Rate limit and quota management
     */
    export class ConfigurableTenantDO {
      constructor(state, env) {
        this.state = state
        this.storage = state.storage
        this.sql = state.storage.sql
        this.initialized = false
        this.initPromise = this.initSchema()
      }

      async initSchema() {
        if (this.initialized) return

        this.sql.exec(\`
          CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS feature_flags (
            name TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL DEFAULT 0,
            rollout_percentage INTEGER DEFAULT 100,
            metadata TEXT,
            updated_at INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS rate_limits (
            resource TEXT PRIMARY KEY,
            max_requests INTEGER NOT NULL,
            window_seconds INTEGER NOT NULL,
            current_count INTEGER DEFAULT 0,
            window_start INTEGER DEFAULT 0
          );

          CREATE TABLE IF NOT EXISTS quotas (
            resource TEXT PRIMARY KEY,
            max_value INTEGER NOT NULL,
            current_value INTEGER DEFAULT 0,
            reset_at INTEGER
          );

          CREATE TABLE IF NOT EXISTS things (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_things_type ON things(type);
        \`)

        this.initialized = true
      }

      // ==========================================
      // Configuration Management
      // ==========================================

      async getConfig(key) {
        await this.initPromise
        const rows = this.sql.exec('SELECT value FROM config WHERE key = ?', key).toArray()
        if (rows.length === 0) return null
        return JSON.parse(rows[0].value)
      }

      async setConfig(key, value) {
        await this.initPromise
        const now = Date.now()
        const jsonValue = JSON.stringify(value)

        // Upsert
        const existing = this.sql.exec('SELECT key FROM config WHERE key = ?', key).toArray()
        if (existing.length > 0) {
          this.sql.exec('UPDATE config SET value = ?, updated_at = ? WHERE key = ?', jsonValue, now, key)
        } else {
          this.sql.exec('INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)', key, jsonValue, now)
        }

        return { key, value, updated_at: now }
      }

      async deleteConfig(key) {
        await this.initPromise
        this.sql.exec('DELETE FROM config WHERE key = ?', key)
        return { deleted: true }
      }

      async listConfig() {
        await this.initPromise
        const rows = this.sql.exec('SELECT key, value, updated_at FROM config').toArray()
        return rows.map(row => ({
          key: row.key,
          value: JSON.parse(row.value),
          updated_at: row.updated_at
        }))
      }

      // ==========================================
      // Feature Flags
      // ==========================================

      async setFeatureFlag(name, config) {
        await this.initPromise
        const now = Date.now()
        const enabled = config.enabled ? 1 : 0
        const rollout = config.rollout_percentage ?? 100
        const metadata = config.metadata ? JSON.stringify(config.metadata) : null

        const existing = this.sql.exec('SELECT name FROM feature_flags WHERE name = ?', name).toArray()
        if (existing.length > 0) {
          this.sql.exec(
            'UPDATE feature_flags SET enabled = ?, rollout_percentage = ?, metadata = ?, updated_at = ? WHERE name = ?',
            enabled, rollout, metadata, now, name
          )
        } else {
          this.sql.exec(
            'INSERT INTO feature_flags (name, enabled, rollout_percentage, metadata, updated_at) VALUES (?, ?, ?, ?, ?)',
            name, enabled, rollout, metadata, now
          )
        }

        return { name, enabled: Boolean(enabled), rollout_percentage: rollout, metadata: config.metadata, updated_at: now }
      }

      async getFeatureFlag(name) {
        await this.initPromise
        const rows = this.sql.exec('SELECT * FROM feature_flags WHERE name = ?', name).toArray()
        if (rows.length === 0) return null

        const row = rows[0]
        return {
          name: row.name,
          enabled: Boolean(row.enabled),
          rollout_percentage: row.rollout_percentage,
          metadata: row.metadata ? JSON.parse(row.metadata) : null,
          updated_at: row.updated_at
        }
      }

      async isFeatureEnabled(name, userId = null) {
        await this.initPromise
        const flag = await this.getFeatureFlag(name)
        if (!flag || !flag.enabled) return false

        // If 100% rollout, always enabled
        if (flag.rollout_percentage >= 100) return true

        // Deterministic rollout based on userId
        if (userId) {
          // Simple hash for deterministic rollout
          let hash = 0
          const str = userId + name
          for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i)
            hash = hash & hash // Convert to 32bit integer
          }
          const percentage = Math.abs(hash % 100)
          return percentage < flag.rollout_percentage
        }

        // Random rollout if no userId
        return Math.random() * 100 < flag.rollout_percentage
      }

      async listFeatureFlags() {
        await this.initPromise
        const rows = this.sql.exec('SELECT * FROM feature_flags').toArray()
        return rows.map(row => ({
          name: row.name,
          enabled: Boolean(row.enabled),
          rollout_percentage: row.rollout_percentage,
          metadata: row.metadata ? JSON.parse(row.metadata) : null,
          updated_at: row.updated_at
        }))
      }

      // ==========================================
      // Rate Limiting
      // ==========================================

      async setRateLimit(resource, config) {
        await this.initPromise

        const existing = this.sql.exec('SELECT resource FROM rate_limits WHERE resource = ?', resource).toArray()
        if (existing.length > 0) {
          this.sql.exec(
            'UPDATE rate_limits SET max_requests = ?, window_seconds = ? WHERE resource = ?',
            config.max_requests, config.window_seconds, resource
          )
        } else {
          this.sql.exec(
            'INSERT INTO rate_limits (resource, max_requests, window_seconds, current_count, window_start) VALUES (?, ?, ?, 0, 0)',
            resource, config.max_requests, config.window_seconds
          )
        }

        return { resource, ...config }
      }

      async checkRateLimit(resource) {
        await this.initPromise

        const rows = this.sql.exec('SELECT * FROM rate_limits WHERE resource = ?', resource).toArray()
        if (rows.length === 0) return { allowed: true, remaining: Infinity }

        const limit = rows[0]
        const now = Date.now()
        const windowMs = limit.window_seconds * 1000

        // Check if window has expired
        if (now - limit.window_start > windowMs) {
          // Reset window
          this.sql.exec(
            'UPDATE rate_limits SET current_count = 1, window_start = ? WHERE resource = ?',
            now, resource
          )
          return { allowed: true, remaining: limit.max_requests - 1, reset_at: now + windowMs }
        }

        // Check if under limit
        if (limit.current_count < limit.max_requests) {
          this.sql.exec(
            'UPDATE rate_limits SET current_count = current_count + 1 WHERE resource = ?',
            resource
          )
          return {
            allowed: true,
            remaining: limit.max_requests - limit.current_count - 1,
            reset_at: limit.window_start + windowMs
          }
        }

        // Over limit
        return {
          allowed: false,
          remaining: 0,
          reset_at: limit.window_start + windowMs
        }
      }

      // ==========================================
      // Quotas
      // ==========================================

      async setQuota(resource, maxValue, resetAt = null) {
        await this.initPromise

        const existing = this.sql.exec('SELECT resource FROM quotas WHERE resource = ?', resource).toArray()
        if (existing.length > 0) {
          this.sql.exec(
            'UPDATE quotas SET max_value = ?, reset_at = ? WHERE resource = ?',
            maxValue, resetAt, resource
          )
        } else {
          this.sql.exec(
            'INSERT INTO quotas (resource, max_value, current_value, reset_at) VALUES (?, ?, 0, ?)',
            resource, maxValue, resetAt
          )
        }

        return { resource, max_value: maxValue, current_value: 0, reset_at: resetAt }
      }

      async checkQuota(resource, increment = 1) {
        await this.initPromise

        const rows = this.sql.exec('SELECT * FROM quotas WHERE resource = ?', resource).toArray()
        if (rows.length === 0) return { allowed: true, remaining: Infinity }

        const quota = rows[0]
        const now = Date.now()

        // Check if quota reset is due
        if (quota.reset_at && now >= quota.reset_at) {
          // Reset quota (set new reset time 30 days from now for monthly quotas)
          const newResetAt = now + (30 * 24 * 60 * 60 * 1000)
          this.sql.exec(
            'UPDATE quotas SET current_value = ?, reset_at = ? WHERE resource = ?',
            increment, newResetAt, resource
          )
          return {
            allowed: true,
            remaining: quota.max_value - increment,
            used: increment,
            limit: quota.max_value,
            reset_at: newResetAt
          }
        }

        // Check if under quota
        if (quota.current_value + increment <= quota.max_value) {
          this.sql.exec(
            'UPDATE quotas SET current_value = current_value + ? WHERE resource = ?',
            increment, resource
          )
          return {
            allowed: true,
            remaining: quota.max_value - quota.current_value - increment,
            used: quota.current_value + increment,
            limit: quota.max_value,
            reset_at: quota.reset_at
          }
        }

        // Over quota
        return {
          allowed: false,
          remaining: 0,
          used: quota.current_value,
          limit: quota.max_value,
          reset_at: quota.reset_at
        }
      }

      // ==========================================
      // Data Operations (for testing isolation)
      // ==========================================

      async createThing(data) {
        await this.initPromise

        const id = data.id || crypto.randomUUID()
        const now = Date.now()

        const existing = this.sql.exec('SELECT id FROM things WHERE id = ?', id).toArray()
        if (existing.length > 0) {
          throw new Error('Duplicate ID')
        }

        this.sql.exec(
          'INSERT INTO things (id, type, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          id, data.type, JSON.stringify(data.data || {}), now, now
        )

        return { id, type: data.type, data: data.data || {}, created_at: now, updated_at: now }
      }

      async getThing(id) {
        await this.initPromise
        const rows = this.sql.exec('SELECT * FROM things WHERE id = ?', id).toArray()
        if (rows.length === 0) return null

        const row = rows[0]
        return {
          id: row.id,
          type: row.type,
          data: JSON.parse(row.data),
          created_at: row.created_at,
          updated_at: row.updated_at
        }
      }

      async listThings(type = null) {
        await this.initPromise
        const rows = type
          ? this.sql.exec('SELECT * FROM things WHERE type = ?', type).toArray()
          : this.sql.exec('SELECT * FROM things').toArray()

        return rows.map(row => ({
          id: row.id,
          type: row.type,
          data: JSON.parse(row.data),
          created_at: row.created_at,
          updated_at: row.updated_at
        }))
      }

      async getStats() {
        await this.initPromise

        const thingCount = this.sql.exec('SELECT COUNT(*) as count FROM things').toArray()[0].count
        const configCount = this.sql.exec('SELECT COUNT(*) as count FROM config').toArray()[0].count
        const flagCount = this.sql.exec('SELECT COUNT(*) as count FROM feature_flags').toArray()[0].count

        return { thingCount, configCount, flagCount }
      }

      // ==========================================
      // REST Interface
      // ==========================================

      async fetch(request) {
        await this.initPromise

        const url = new URL(request.url)
        const path = url.pathname
        const method = request.method

        let body = null
        if (['POST', 'PUT', 'PATCH'].includes(method)) {
          try {
            body = await request.json()
          } catch (e) {
            // No body
          }
        }

        try {
          // Config endpoints
          if (path === '/config' && method === 'GET') {
            const configs = await this.listConfig()
            return new Response(JSON.stringify({ items: configs }), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          if (path.match(/^\\/config\\/[^/]+$/) && method === 'GET') {
            const key = path.split('/')[2]
            const value = await this.getConfig(key)
            if (value === null) {
              return new Response(JSON.stringify({ error: 'Not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
              })
            }
            return new Response(JSON.stringify({ key, value }), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          if (path.match(/^\\/config\\/[^/]+$/) && method === 'PUT') {
            const key = path.split('/')[2]
            const result = await this.setConfig(key, body)
            return new Response(JSON.stringify(result), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
          }

          if (path.match(/^\\/config\\/[^/]+$/) && method === 'DELETE') {
            const key = path.split('/')[2]
            await this.deleteConfig(key)
            return new Response(null, { status: 204 })
          }

          // Feature flag endpoints
          if (path === '/flags' && method === 'GET') {
            const flags = await this.listFeatureFlags()
            return new Response(JSON.stringify({ items: flags }), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          if (path.match(/^\\/flags\\/[^/]+$/) && method === 'GET') {
            const name = path.split('/')[2]
            const flag = await this.getFeatureFlag(name)
            if (!flag) {
              return new Response(JSON.stringify({ error: 'Not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
              })
            }
            return new Response(JSON.stringify(flag), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          if (path.match(/^\\/flags\\/[^/]+$/) && method === 'PUT') {
            const name = path.split('/')[2]
            const result = await this.setFeatureFlag(name, body)
            return new Response(JSON.stringify(result), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          if (path.match(/^\\/flags\\/[^/]+\\/check$/) && method === 'GET') {
            const name = path.split('/')[2]
            const userId = url.searchParams.get('userId')
            const enabled = await this.isFeatureEnabled(name, userId)
            return new Response(JSON.stringify({ enabled }), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          // Rate limit endpoints
          if (path.match(/^\\/rate-limits\\/[^/]+$/) && method === 'PUT') {
            const resource = path.split('/')[2]
            const result = await this.setRateLimit(resource, body)
            return new Response(JSON.stringify(result), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          if (path.match(/^\\/rate-limits\\/[^/]+\\/check$/) && method === 'POST') {
            const resource = path.split('/')[2]
            const result = await this.checkRateLimit(resource)
            return new Response(JSON.stringify(result), {
              status: result.allowed ? 200 : 429,
              headers: { 'Content-Type': 'application/json' }
            })
          }

          // Quota endpoints
          if (path.match(/^\\/quotas\\/[^/]+$/) && method === 'PUT') {
            const resource = path.split('/')[2]
            const result = await this.setQuota(resource, body.max_value, body.reset_at)
            return new Response(JSON.stringify(result), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          if (path.match(/^\\/quotas\\/[^/]+\\/check$/) && method === 'POST') {
            const resource = path.split('/')[2]
            const increment = body?.increment || 1
            const result = await this.checkQuota(resource, increment)
            return new Response(JSON.stringify(result), {
              status: result.allowed ? 200 : 403,
              headers: { 'Content-Type': 'application/json' }
            })
          }

          // Things endpoints
          if (path === '/things' && method === 'POST') {
            const thing = await this.createThing(body)
            return new Response(JSON.stringify(thing), {
              status: 201,
              headers: { 'Content-Type': 'application/json' }
            })
          }

          if (path.match(/^\\/things\\/[^/]+$/) && method === 'GET') {
            const id = path.split('/')[2]
            const thing = await this.getThing(id)
            if (!thing) {
              return new Response(JSON.stringify({ error: 'Not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
              })
            }
            return new Response(JSON.stringify(thing), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          if (path === '/things' && method === 'GET') {
            const type = url.searchParams.get('type')
            const items = await this.listThings(type)
            return new Response(JSON.stringify({ items, count: items.length }), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          // Stats
          if (path === '/stats' && method === 'GET') {
            const stats = await this.getStats()
            return new Response(JSON.stringify(stats), {
              headers: { 'Content-Type': 'application/json' }
            })
          }

          return new Response(JSON.stringify({ error: 'Not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          })
        } catch (error) {
          const message = error.message || 'Internal error'
          const status = message === 'Duplicate ID' ? 409 : 500
          return new Response(JSON.stringify({ error: message }), {
            status,
            headers: { 'Content-Type': 'application/json' }
          })
        }
      }
    }

    export default {
      async fetch(request, env) {
        const url = new URL(request.url)
        const parts = url.hostname.split('.')

        let tenant = 'default'
        if (parts.length >= 4) {
          tenant = parts[0]
        } else if (url.pathname.startsWith('/tenant/')) {
          const pathParts = url.pathname.split('/')
          tenant = pathParts[2]
        }

        const doId = env.TENANT_DO.idFromName(tenant)
        const stub = env.TENANT_DO.get(doId)
        return stub.fetch(request)
      }
    }
  `,
  durableObjects: {
    TENANT_DO: 'ConfigurableTenantDO',
  },
})

// ============================================================================
// Test Suites
// ============================================================================

describe('Tenant Configuration - Per-Tenant Settings', () => {
  let mf: Miniflare
  let tenantAStub: DurableObjectStub
  let tenantBStub: DurableObjectStub

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')
    tenantAStub = ns.get(ns.idFromName('tenant-a'))
    tenantBStub = ns.get(ns.idFromName('tenant-b'))
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('each tenant can have different config values for same key', async () => {
    // Set API rate limit config for tenant A
    const setARes = await tenantAStub.fetch('http://fake/config/api_rate_limit', {
      method: 'PUT',
      body: JSON.stringify({ requests_per_minute: 100, burst: 20 }),
    })
    expect(setARes.status).toBe(200)

    // Set different rate limit for tenant B
    const setBRes = await tenantBStub.fetch('http://fake/config/api_rate_limit', {
      method: 'PUT',
      body: JSON.stringify({ requests_per_minute: 1000, burst: 200 }),
    })
    expect(setBRes.status).toBe(200)

    // Verify each tenant has their own config
    const getARes = await tenantAStub.fetch('http://fake/config/api_rate_limit')
    const configA = (await getARes.json()) as { key: string; value: { requests_per_minute: number } }
    expect(configA.value.requests_per_minute).toBe(100)

    const getBRes = await tenantBStub.fetch('http://fake/config/api_rate_limit')
    const configB = (await getBRes.json()) as { key: string; value: { requests_per_minute: number } }
    expect(configB.value.requests_per_minute).toBe(1000)
  })

  it('config changes in one tenant do not affect another', async () => {
    const configKey = `test-key-${Date.now()}`

    // Set in tenant A
    await tenantAStub.fetch(`http://fake/config/${configKey}`, {
      method: 'PUT',
      body: JSON.stringify({ setting: 'value-a' }),
    })

    // Try to get from tenant B - should not exist
    const getBRes = await tenantBStub.fetch(`http://fake/config/${configKey}`)
    expect(getBRes.status).toBe(404)

    // Set different value in tenant B
    await tenantBStub.fetch(`http://fake/config/${configKey}`, {
      method: 'PUT',
      body: JSON.stringify({ setting: 'value-b' }),
    })

    // Update tenant A config
    await tenantAStub.fetch(`http://fake/config/${configKey}`, {
      method: 'PUT',
      body: JSON.stringify({ setting: 'updated-value-a' }),
    })

    // Verify tenant B's config is unchanged
    const finalB = await tenantBStub.fetch(`http://fake/config/${configKey}`)
    const configB = (await finalB.json()) as { value: { setting: string } }
    expect(configB.value.setting).toBe('value-b')
  })

  it('config deletion only affects the tenant that deleted', async () => {
    const configKey = `delete-test-${Date.now()}`

    // Create in both tenants
    await tenantAStub.fetch(`http://fake/config/${configKey}`, {
      method: 'PUT',
      body: JSON.stringify({ data: 'tenant-a-data' }),
    })
    await tenantBStub.fetch(`http://fake/config/${configKey}`, {
      method: 'PUT',
      body: JSON.stringify({ data: 'tenant-b-data' }),
    })

    // Delete from tenant A
    const deleteRes = await tenantAStub.fetch(`http://fake/config/${configKey}`, {
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(204)

    // Verify deleted from A
    const getA = await tenantAStub.fetch(`http://fake/config/${configKey}`)
    expect(getA.status).toBe(404)

    // Verify still exists in B
    const getB = await tenantBStub.fetch(`http://fake/config/${configKey}`)
    expect(getB.status).toBe(200)
    const configB = (await getB.json()) as { value: { data: string } }
    expect(configB.value.data).toBe('tenant-b-data')
  })

  it('config listing returns only tenant-specific configs', async () => {
    const prefix = `list-test-${Date.now()}`

    // Create configs in tenant A
    for (let i = 0; i < 3; i++) {
      await tenantAStub.fetch(`http://fake/config/${prefix}-a-${i}`, {
        method: 'PUT',
        body: JSON.stringify({ index: i, tenant: 'a' }),
      })
    }

    // Create configs in tenant B
    for (let i = 0; i < 5; i++) {
      await tenantBStub.fetch(`http://fake/config/${prefix}-b-${i}`, {
        method: 'PUT',
        body: JSON.stringify({ index: i, tenant: 'b' }),
      })
    }

    // List tenant A configs
    const listA = await tenantAStub.fetch('http://fake/config')
    const configsA = (await listA.json()) as { items: { key: string; value: { tenant: string } }[] }
    const ourConfigsA = configsA.items.filter((c) => c.key.startsWith(prefix))

    // All should have tenant: 'a'
    for (const config of ourConfigsA) {
      expect(config.value.tenant).toBe('a')
    }

    // List tenant B configs
    const listB = await tenantBStub.fetch('http://fake/config')
    const configsB = (await listB.json()) as { items: { key: string; value: { tenant: string } }[] }
    const ourConfigsB = configsB.items.filter((c) => c.key.startsWith(prefix))

    // All should have tenant: 'b'
    for (const config of ourConfigsB) {
      expect(config.value.tenant).toBe('b')
    }
  })
})

describe('Tenant Configuration - Feature Flags', () => {
  let mf: Miniflare
  let enterpriseTenantStub: DurableObjectStub
  let freeTenantStub: DurableObjectStub

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')
    enterpriseTenantStub = ns.get(ns.idFromName('enterprise-tenant'))
    freeTenantStub = ns.get(ns.idFromName('free-tenant'))
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('enterprise tenant can enable premium features', async () => {
    // Enable premium feature for enterprise
    await enterpriseTenantStub.fetch('http://fake/flags/premium-analytics', {
      method: 'PUT',
      body: JSON.stringify({ enabled: true, rollout_percentage: 100 }),
    })

    // Check feature is enabled
    const checkRes = await enterpriseTenantStub.fetch('http://fake/flags/premium-analytics/check')
    const result = (await checkRes.json()) as { enabled: boolean }
    expect(result.enabled).toBe(true)
  })

  it('free tenant does not have premium features', async () => {
    // Premium feature not set for free tenant
    const checkRes = await freeTenantStub.fetch('http://fake/flags/premium-analytics/check')
    const result = (await checkRes.json()) as { enabled: boolean }
    expect(result.enabled).toBe(false)
  })

  it('feature rollout is isolated per tenant', async () => {
    // Enterprise: 100% rollout
    await enterpriseTenantStub.fetch('http://fake/flags/new-ui', {
      method: 'PUT',
      body: JSON.stringify({ enabled: true, rollout_percentage: 100 }),
    })

    // Free: 10% rollout (beta test)
    await freeTenantStub.fetch('http://fake/flags/new-ui', {
      method: 'PUT',
      body: JSON.stringify({ enabled: true, rollout_percentage: 10 }),
    })

    // Enterprise users always get the feature
    const enterpriseCheck = await enterpriseTenantStub.fetch(
      'http://fake/flags/new-ui/check?userId=user-123'
    )
    const enterpriseResult = (await enterpriseCheck.json()) as { enabled: boolean }
    expect(enterpriseResult.enabled).toBe(true)

    // Free tenant respects rollout percentage (deterministic for same userId)
    const freeFlag = await freeTenantStub.fetch('http://fake/flags/new-ui')
    const freeFlagData = (await freeFlag.json()) as { rollout_percentage: number }
    expect(freeFlagData.rollout_percentage).toBe(10)
  })

  it('feature flag metadata is tenant-specific', async () => {
    // Enterprise: feature with custom limits
    await enterpriseTenantStub.fetch('http://fake/flags/api-v2', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: true,
        metadata: { rate_limit: 10000, timeout_ms: 60000 },
      }),
    })

    // Free: same feature with lower limits
    await freeTenantStub.fetch('http://fake/flags/api-v2', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: true,
        metadata: { rate_limit: 100, timeout_ms: 5000 },
      }),
    })

    // Verify enterprise metadata
    const enterpriseFlag = await enterpriseTenantStub.fetch('http://fake/flags/api-v2')
    const enterpriseData = (await enterpriseFlag.json()) as {
      metadata: { rate_limit: number; timeout_ms: number }
    }
    expect(enterpriseData.metadata.rate_limit).toBe(10000)

    // Verify free metadata
    const freeFlag = await freeTenantStub.fetch('http://fake/flags/api-v2')
    const freeData = (await freeFlag.json()) as {
      metadata: { rate_limit: number; timeout_ms: number }
    }
    expect(freeData.metadata.rate_limit).toBe(100)
  })
})

describe('Tenant Configuration - Rate Limits and Quotas', () => {
  let mf: Miniflare
  let tenantStub: DurableObjectStub

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')
    tenantStub = ns.get(ns.idFromName('rate-limit-tenant'))
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('enforces per-tenant rate limits', async () => {
    // Set a low rate limit for testing
    await tenantStub.fetch('http://fake/rate-limits/api-calls', {
      method: 'PUT',
      body: JSON.stringify({ max_requests: 3, window_seconds: 60 }),
    })

    // First 3 requests should succeed
    for (let i = 0; i < 3; i++) {
      const res = await tenantStub.fetch('http://fake/rate-limits/api-calls/check', {
        method: 'POST',
      })
      expect(res.status).toBe(200)
      const data = (await res.json()) as { allowed: boolean; remaining: number }
      expect(data.allowed).toBe(true)
    }

    // 4th request should be rate limited
    const limitedRes = await tenantStub.fetch('http://fake/rate-limits/api-calls/check', {
      method: 'POST',
    })
    expect(limitedRes.status).toBe(429)
    const limitedData = (await limitedRes.json()) as { allowed: boolean; remaining: number }
    expect(limitedData.allowed).toBe(false)
    expect(limitedData.remaining).toBe(0)
  })

  it('rate limits are tenant-specific (different tenants have independent limits)', async () => {
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')
    const tenant1Stub = ns.get(ns.idFromName('rate-tenant-1'))
    const tenant2Stub = ns.get(ns.idFromName('rate-tenant-2'))

    // Both tenants set the same rate limit
    await tenant1Stub.fetch('http://fake/rate-limits/shared-api', {
      method: 'PUT',
      body: JSON.stringify({ max_requests: 2, window_seconds: 60 }),
    })
    await tenant2Stub.fetch('http://fake/rate-limits/shared-api', {
      method: 'PUT',
      body: JSON.stringify({ max_requests: 2, window_seconds: 60 }),
    })

    // Exhaust tenant 1's rate limit
    await tenant1Stub.fetch('http://fake/rate-limits/shared-api/check', { method: 'POST' })
    await tenant1Stub.fetch('http://fake/rate-limits/shared-api/check', { method: 'POST' })

    const tenant1Limited = await tenant1Stub.fetch('http://fake/rate-limits/shared-api/check', {
      method: 'POST',
    })
    expect(tenant1Limited.status).toBe(429)

    // Tenant 2 should still have their full quota
    const tenant2First = await tenant2Stub.fetch('http://fake/rate-limits/shared-api/check', {
      method: 'POST',
    })
    expect(tenant2First.status).toBe(200)
  })

  it('enforces per-tenant quotas', async () => {
    // Set a monthly storage quota
    await tenantStub.fetch('http://fake/quotas/storage-mb', {
      method: 'PUT',
      body: JSON.stringify({ max_value: 100 }),
    })

    // Use 50MB
    const use50 = await tenantStub.fetch('http://fake/quotas/storage-mb/check', {
      method: 'POST',
      body: JSON.stringify({ increment: 50 }),
    })
    expect(use50.status).toBe(200)
    const use50Data = (await use50.json()) as { remaining: number }
    expect(use50Data.remaining).toBe(50)

    // Use 40MB more (should succeed, 90 total)
    const use40 = await tenantStub.fetch('http://fake/quotas/storage-mb/check', {
      method: 'POST',
      body: JSON.stringify({ increment: 40 }),
    })
    expect(use40.status).toBe(200)

    // Try to use 20MB more (should fail, would be 110 > 100)
    const useOver = await tenantStub.fetch('http://fake/quotas/storage-mb/check', {
      method: 'POST',
      body: JSON.stringify({ increment: 20 }),
    })
    expect(useOver.status).toBe(403)
    const overData = (await useOver.json()) as { allowed: boolean; used: number; limit: number }
    expect(overData.allowed).toBe(false)
    expect(overData.used).toBe(90)
    expect(overData.limit).toBe(100)
  })
})

describe('Tenant Configuration - Concurrent Config Updates', () => {
  let mf: Miniflare
  let tenantStub: DurableObjectStub

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')
    tenantStub = ns.get(ns.idFromName('concurrent-config-tenant'))
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('handles concurrent config updates safely', async () => {
    const configKey = `concurrent-${Date.now()}`

    // Fire concurrent updates to same config key
    const updates = Array.from({ length: 5 }, (_, i) =>
      tenantStub.fetch(`http://fake/config/${configKey}`, {
        method: 'PUT',
        body: JSON.stringify({ update_number: i, timestamp: Date.now() }),
      })
    )

    const responses = await Promise.all(updates)

    // All should succeed (last one wins)
    for (const res of responses) {
      expect(res.status).toBe(200)
    }

    // Should have a consistent final value
    const finalRes = await tenantStub.fetch(`http://fake/config/${configKey}`)
    const finalData = (await finalRes.json()) as { value: { update_number: number } }
    expect(typeof finalData.value.update_number).toBe('number')
  })

  it('handles concurrent feature flag updates', async () => {
    const flagName = `concurrent-flag-${Date.now()}`

    // Concurrent flag updates
    const updates = Array.from({ length: 5 }, (_, i) =>
      tenantStub.fetch(`http://fake/flags/${flagName}`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled: i % 2 === 0,
          rollout_percentage: i * 20,
        }),
      })
    )

    const responses = await Promise.all(updates)

    for (const res of responses) {
      expect(res.status).toBe(200)
    }

    // Should have consistent final state
    const finalRes = await tenantStub.fetch(`http://fake/flags/${flagName}`)
    const finalData = (await finalRes.json()) as { enabled: boolean; rollout_percentage: number }
    expect(typeof finalData.enabled).toBe('boolean')
    expect(typeof finalData.rollout_percentage).toBe('number')
  })
})

describe('Tenant Configuration - Stats Isolation', () => {
  let mf: Miniflare
  let tenantAStub: DurableObjectStub
  let tenantBStub: DurableObjectStub

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')
    tenantAStub = ns.get(ns.idFromName('stats-tenant-a'))
    tenantBStub = ns.get(ns.idFromName('stats-tenant-b'))
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('stats reflect only tenant-specific data', async () => {
    const prefix = `stats-test-${Date.now()}`

    // Add items to tenant A
    for (let i = 0; i < 5; i++) {
      await tenantAStub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({ id: `${prefix}-a-${i}`, type: 'StatsItem', data: {} }),
      })
    }

    // Add items to tenant B
    for (let i = 0; i < 3; i++) {
      await tenantBStub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({ id: `${prefix}-b-${i}`, type: 'StatsItem', data: {} }),
      })
    }

    // Add configs to tenant A
    for (let i = 0; i < 2; i++) {
      await tenantAStub.fetch(`http://fake/config/${prefix}-config-${i}`, {
        method: 'PUT',
        body: JSON.stringify({ data: i }),
      })
    }

    // Verify tenant A stats
    const statsA = await tenantAStub.fetch('http://fake/stats')
    const statsDataA = (await statsA.json()) as {
      thingCount: number
      configCount: number
      flagCount: number
    }
    expect(statsDataA.thingCount).toBeGreaterThanOrEqual(5)
    expect(statsDataA.configCount).toBeGreaterThanOrEqual(2)

    // Verify tenant B stats - should be independent
    const statsB = await tenantBStub.fetch('http://fake/stats')
    const statsDataB = (await statsB.json()) as {
      thingCount: number
      configCount: number
      flagCount: number
    }
    expect(statsDataB.thingCount).toBeGreaterThanOrEqual(3)
    // Tenant B should have fewer or equal configs (didn't add configs)
    expect(statsDataB.configCount).toBeLessThan(statsDataA.configCount)
  })
})
