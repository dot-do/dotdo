/**
 * Tests for Auth0 Management API - Full Surface Coverage
 *
 * TDD RED PHASE: These tests define the complete Management API surface
 * that needs to be implemented for Auth0 compatibility.
 *
 * Covers:
 * - Clients Manager (Applications/OAuth2 clients)
 * - Connections Manager (Identity providers)
 * - Resource Servers Manager (APIs)
 * - Organizations Manager (Enterprise B2B)
 * - Logs Manager (Audit logs)
 * - Device Credentials Manager
 * - Grants Manager (User consents)
 * - Roles Manager (RBAC)
 * - Prompts Manager (Universal Login customization)
 *
 * @see https://auth0.com/docs/api/management/v2
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ManagementClient } from '../management-client'

// ============================================================================
// MOCK SETUP
// ============================================================================

vi.stubGlobal('crypto', {
  randomUUID: () => `test-uuid-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

// ============================================================================
// CLIENTS MANAGER (APPLICATIONS)
// ============================================================================

describe('ClientsManager', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('clients property', () => {
    it('should expose clients manager', () => {
      expect(management.clients).toBeDefined()
      expect(typeof management.clients.create).toBe('function')
      expect(typeof management.clients.get).toBe('function')
      expect(typeof management.clients.getAll).toBe('function')
      expect(typeof management.clients.update).toBe('function')
      expect(typeof management.clients.delete).toBe('function')
    })
  })

  describe('clients.create', () => {
    it('should create a regular web application', async () => {
      const client = await management.clients.create({
        name: 'My Web App',
        app_type: 'regular_web',
        callbacks: ['https://example.com/callback'],
        allowed_logout_urls: ['https://example.com'],
        web_origins: ['https://example.com'],
      })

      expect(client.client_id).toBeDefined()
      expect(client.client_secret).toBeDefined()
      expect(client.name).toBe('My Web App')
      expect(client.app_type).toBe('regular_web')
      expect(client.callbacks).toContain('https://example.com/callback')
    })

    it('should create a single page application', async () => {
      const client = await management.clients.create({
        name: 'My SPA',
        app_type: 'spa',
        callbacks: ['https://spa.example.com/callback'],
        allowed_logout_urls: ['https://spa.example.com'],
        web_origins: ['https://spa.example.com'],
        token_endpoint_auth_method: 'none',
      })

      expect(client.client_id).toBeDefined()
      expect(client.app_type).toBe('spa')
      expect(client.token_endpoint_auth_method).toBe('none')
      // SPA should not have client_secret
      expect(client.client_secret).toBeUndefined()
    })

    it('should create a native application', async () => {
      const client = await management.clients.create({
        name: 'My Mobile App',
        app_type: 'native',
        callbacks: ['myapp://callback'],
        allowed_logout_urls: ['myapp://logout'],
      })

      expect(client.client_id).toBeDefined()
      expect(client.app_type).toBe('native')
    })

    it('should create a machine-to-machine application', async () => {
      const client = await management.clients.create({
        name: 'My M2M App',
        app_type: 'non_interactive',
        grant_types: ['client_credentials'],
      })

      expect(client.client_id).toBeDefined()
      expect(client.client_secret).toBeDefined()
      expect(client.app_type).toBe('non_interactive')
      expect(client.grant_types).toContain('client_credentials')
    })

    it('should create client with custom metadata', async () => {
      const client = await management.clients.create({
        name: 'App with Metadata',
        app_type: 'regular_web',
        client_metadata: {
          environment: 'production',
          team: 'platform',
        },
      })

      expect(client.client_metadata).toEqual({
        environment: 'production',
        team: 'platform',
      })
    })

    it('should create client with JWT configuration', async () => {
      const client = await management.clients.create({
        name: 'JWT App',
        app_type: 'regular_web',
        jwt_configuration: {
          alg: 'RS256',
          lifetime_in_seconds: 36000,
          scopes: { 'https://example.com/api': { description: 'Access to API' } },
        },
      })

      expect(client.jwt_configuration?.alg).toBe('RS256')
      expect(client.jwt_configuration?.lifetime_in_seconds).toBe(36000)
    })

    it('should create client with refresh token configuration', async () => {
      const client = await management.clients.create({
        name: 'Refresh Token App',
        app_type: 'regular_web',
        refresh_token: {
          rotation_type: 'rotating',
          expiration_type: 'expiring',
          token_lifetime: 2592000,
          infinite_token_lifetime: false,
          idle_token_lifetime: 1296000,
          infinite_idle_token_lifetime: false,
        },
      })

      expect(client.refresh_token?.rotation_type).toBe('rotating')
      expect(client.refresh_token?.expiration_type).toBe('expiring')
    })
  })

  describe('clients.get', () => {
    it('should get client by ID', async () => {
      const created = await management.clients.create({
        name: 'Test Client',
        app_type: 'regular_web',
      })

      const client = await management.clients.get({ client_id: created.client_id })

      expect(client).toBeDefined()
      expect(client.client_id).toBe(created.client_id)
      expect(client.name).toBe('Test Client')
    })

    it('should return null for non-existent client', async () => {
      const client = await management.clients.get({ client_id: 'nonexistent' })
      expect(client).toBeNull()
    })

    it('should support fields filter', async () => {
      const created = await management.clients.create({
        name: 'Fields Test',
        app_type: 'regular_web',
      })

      const client = await management.clients.get({
        client_id: created.client_id,
        fields: 'client_id,name',
        include_fields: true,
      })

      expect(client?.client_id).toBeDefined()
      expect(client?.name).toBeDefined()
    })
  })

  describe('clients.getAll', () => {
    beforeEach(async () => {
      await management.clients.create({ name: 'App 1', app_type: 'regular_web' })
      await management.clients.create({ name: 'App 2', app_type: 'spa' })
      await management.clients.create({ name: 'App 3', app_type: 'native' })
    })

    it('should list all clients', async () => {
      const result = await management.clients.getAll()

      expect(result.clients).toBeDefined()
      expect(result.clients.length).toBeGreaterThanOrEqual(3)
    })

    it('should support pagination', async () => {
      const page1 = await management.clients.getAll({
        per_page: 2,
        page: 0,
        include_totals: true,
      })

      expect(page1.clients.length).toBeLessThanOrEqual(2)
      expect(page1.total).toBeGreaterThanOrEqual(3)
    })

    it('should filter by app_type', async () => {
      const result = await management.clients.getAll({
        app_type: ['spa'],
      })

      expect(result.clients.every((c) => c.app_type === 'spa')).toBe(true)
    })

    it('should filter by is_first_party', async () => {
      const result = await management.clients.getAll({
        is_first_party: true,
      })

      expect(result.clients.every((c) => c.is_first_party === true)).toBe(true)
    })
  })

  describe('clients.update', () => {
    it('should update client name', async () => {
      const created = await management.clients.create({
        name: 'Original Name',
        app_type: 'regular_web',
      })

      const updated = await management.clients.update(
        { client_id: created.client_id },
        { name: 'Updated Name' }
      )

      expect(updated.name).toBe('Updated Name')
    })

    it('should update callbacks', async () => {
      const created = await management.clients.create({
        name: 'Callback Test',
        app_type: 'regular_web',
        callbacks: ['https://old.example.com/callback'],
      })

      const updated = await management.clients.update(
        { client_id: created.client_id },
        { callbacks: ['https://new.example.com/callback', 'https://staging.example.com/callback'] }
      )

      expect(updated.callbacks).toContain('https://new.example.com/callback')
      expect(updated.callbacks).toContain('https://staging.example.com/callback')
    })

    it('should update client metadata', async () => {
      const created = await management.clients.create({
        name: 'Metadata Test',
        app_type: 'regular_web',
      })

      const updated = await management.clients.update(
        { client_id: created.client_id },
        { client_metadata: { version: '2.0' } }
      )

      expect(updated.client_metadata?.version).toBe('2.0')
    })

    it('should rotate client secret', async () => {
      const created = await management.clients.create({
        name: 'Secret Rotation Test',
        app_type: 'regular_web',
      })

      const rotated = await management.clients.rotateSecret({
        client_id: created.client_id,
      })

      expect(rotated.client_secret).toBeDefined()
      expect(rotated.client_secret).not.toBe(created.client_secret)
    })
  })

  describe('clients.delete', () => {
    it('should delete client', async () => {
      const created = await management.clients.create({
        name: 'To Delete',
        app_type: 'regular_web',
      })

      await management.clients.delete({ client_id: created.client_id })

      const deleted = await management.clients.get({ client_id: created.client_id })
      expect(deleted).toBeNull()
    })
  })

  describe('clients.getCredentials', () => {
    it('should get client credentials', async () => {
      const created = await management.clients.create({
        name: 'Credentials Test',
        app_type: 'regular_web',
      })

      const credentials = await management.clients.getCredentials({
        client_id: created.client_id,
      })

      expect(credentials).toBeDefined()
      expect(Array.isArray(credentials)).toBe(true)
    })
  })
})

// ============================================================================
// CONNECTIONS MANAGER
// ============================================================================

describe('ConnectionsManager', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('connections property', () => {
    it('should expose connections manager', () => {
      expect(management.connections).toBeDefined()
      expect(typeof management.connections.create).toBe('function')
      expect(typeof management.connections.get).toBe('function')
      expect(typeof management.connections.getAll).toBe('function')
      expect(typeof management.connections.update).toBe('function')
      expect(typeof management.connections.delete).toBe('function')
    })
  })

  describe('connections.create', () => {
    it('should create database connection', async () => {
      const connection = await management.connections.create({
        name: 'my-database',
        strategy: 'auth0',
        options: {
          passwordPolicy: 'good',
          requires_username: false,
          brute_force_protection: true,
        },
      })

      expect(connection.id).toBeDefined()
      expect(connection.name).toBe('my-database')
      expect(connection.strategy).toBe('auth0')
    })

    it('should create social connection (Google)', async () => {
      const connection = await management.connections.create({
        name: 'google-oauth2',
        strategy: 'google-oauth2',
        options: {
          client_id: 'google-client-id',
          client_secret: 'google-client-secret',
          scope: ['email', 'profile'],
        },
      })

      expect(connection.id).toBeDefined()
      expect(connection.strategy).toBe('google-oauth2')
    })

    it('should create social connection (GitHub)', async () => {
      const connection = await management.connections.create({
        name: 'github',
        strategy: 'github',
        options: {
          client_id: 'github-client-id',
          client_secret: 'github-client-secret',
          scope: ['user:email', 'read:user'],
        },
      })

      expect(connection.id).toBeDefined()
      expect(connection.strategy).toBe('github')
    })

    it('should create enterprise connection (SAML)', async () => {
      const connection = await management.connections.create({
        name: 'enterprise-saml',
        strategy: 'samlp',
        options: {
          signInEndpoint: 'https://idp.example.com/saml/login',
          signingCert: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----',
          protocolBinding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
        },
      })

      expect(connection.id).toBeDefined()
      expect(connection.strategy).toBe('samlp')
    })

    it('should create enterprise connection (OIDC)', async () => {
      const connection = await management.connections.create({
        name: 'enterprise-oidc',
        strategy: 'oidc',
        options: {
          client_id: 'oidc-client-id',
          client_secret: 'oidc-client-secret',
          discovery_url: 'https://idp.example.com/.well-known/openid-configuration',
          scope: 'openid profile email',
        },
      })

      expect(connection.id).toBeDefined()
      expect(connection.strategy).toBe('oidc')
    })

    it('should create passwordless connection (email)', async () => {
      const connection = await management.connections.create({
        name: 'email-passwordless',
        strategy: 'email',
        options: {
          from: 'auth@example.com',
          subject: 'Your login code',
          syntax: 'liquid',
          template: 'Your code is: {{ code }}',
        },
      })

      expect(connection.id).toBeDefined()
      expect(connection.strategy).toBe('email')
    })

    it('should create passwordless connection (SMS)', async () => {
      const connection = await management.connections.create({
        name: 'sms-passwordless',
        strategy: 'sms',
        options: {
          from: '+15551234567',
          syntax: 'liquid',
          template: 'Your code is: {{ code }}',
          twilio_sid: 'twilio-account-sid',
          twilio_token: 'twilio-auth-token',
        },
      })

      expect(connection.id).toBeDefined()
      expect(connection.strategy).toBe('sms')
    })

    it('should enable connection for specific clients', async () => {
      // First create a client
      const client = await management.clients.create({
        name: 'Test App',
        app_type: 'regular_web',
      })

      const connection = await management.connections.create({
        name: 'enabled-for-client',
        strategy: 'auth0',
        enabled_clients: [client.client_id],
      })

      expect(connection.enabled_clients).toContain(client.client_id)
    })
  })

  describe('connections.get', () => {
    it('should get connection by ID', async () => {
      const created = await management.connections.create({
        name: 'get-test-connection',
        strategy: 'auth0',
      })

      const connection = await management.connections.get({ id: created.id })

      expect(connection).toBeDefined()
      expect(connection.id).toBe(created.id)
      expect(connection.name).toBe('get-test-connection')
    })

    it('should return null for non-existent connection', async () => {
      const connection = await management.connections.get({ id: 'con_nonexistent' })
      expect(connection).toBeNull()
    })
  })

  describe('connections.getAll', () => {
    it('should list all connections', async () => {
      const result = await management.connections.getAll()

      expect(result.connections).toBeDefined()
      expect(Array.isArray(result.connections)).toBe(true)
    })

    it('should filter by strategy', async () => {
      await management.connections.create({ name: 'db-conn', strategy: 'auth0' })
      await management.connections.create({
        name: 'google-conn',
        strategy: 'google-oauth2',
        options: { client_id: 'test', client_secret: 'test' },
      })

      const result = await management.connections.getAll({
        strategy: ['auth0'],
      })

      expect(result.connections.every((c) => c.strategy === 'auth0')).toBe(true)
    })

    it('should filter by name', async () => {
      await management.connections.create({ name: 'unique-db-name', strategy: 'auth0' })

      const result = await management.connections.getAll({
        name: 'unique-db-name',
      })

      expect(result.connections.length).toBe(1)
      expect(result.connections[0].name).toBe('unique-db-name')
    })

    it('should support pagination', async () => {
      const result = await management.connections.getAll({
        per_page: 5,
        page: 0,
        include_totals: true,
      })

      expect(result.connections.length).toBeLessThanOrEqual(5)
      expect(result.total).toBeDefined()
    })
  })

  describe('connections.update', () => {
    it('should update connection options', async () => {
      const created = await management.connections.create({
        name: 'update-test',
        strategy: 'auth0',
        options: {
          passwordPolicy: 'low',
        },
      })

      const updated = await management.connections.update(
        { id: created.id },
        {
          options: {
            passwordPolicy: 'excellent',
            brute_force_protection: true,
          },
        }
      )

      expect(updated.options?.passwordPolicy).toBe('excellent')
      expect(updated.options?.brute_force_protection).toBe(true)
    })

    it('should update enabled clients', async () => {
      const client1 = await management.clients.create({ name: 'Client 1', app_type: 'spa' })
      const client2 = await management.clients.create({ name: 'Client 2', app_type: 'spa' })

      const created = await management.connections.create({
        name: 'clients-test',
        strategy: 'auth0',
        enabled_clients: [client1.client_id],
      })

      const updated = await management.connections.update(
        { id: created.id },
        {
          enabled_clients: [client1.client_id, client2.client_id],
        }
      )

      expect(updated.enabled_clients).toContain(client1.client_id)
      expect(updated.enabled_clients).toContain(client2.client_id)
    })
  })

  describe('connections.delete', () => {
    it('should delete connection', async () => {
      const created = await management.connections.create({
        name: 'delete-test',
        strategy: 'auth0',
      })

      await management.connections.delete({ id: created.id })

      const deleted = await management.connections.get({ id: created.id })
      expect(deleted).toBeNull()
    })
  })

  describe('connections.getStatus', () => {
    it('should check connection status', async () => {
      const created = await management.connections.create({
        name: 'status-test',
        strategy: 'auth0',
      })

      const status = await management.connections.getStatus({ id: created.id })

      expect(status).toBeDefined()
      expect(status.status).toBeDefined()
    })
  })
})

// ============================================================================
// RESOURCE SERVERS MANAGER (APIs)
// ============================================================================

describe('ResourceServersManager', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('resourceServers property', () => {
    it('should expose resource servers manager', () => {
      expect(management.resourceServers).toBeDefined()
      expect(typeof management.resourceServers.create).toBe('function')
      expect(typeof management.resourceServers.get).toBe('function')
      expect(typeof management.resourceServers.getAll).toBe('function')
      expect(typeof management.resourceServers.update).toBe('function')
      expect(typeof management.resourceServers.delete).toBe('function')
    })
  })

  describe('resourceServers.create', () => {
    it('should create API with scopes', async () => {
      const api = await management.resourceServers.create({
        name: 'My API',
        identifier: 'https://api.example.com',
        scopes: [
          { value: 'read:users', description: 'Read users' },
          { value: 'write:users', description: 'Write users' },
          { value: 'delete:users', description: 'Delete users' },
        ],
      })

      expect(api.id).toBeDefined()
      expect(api.name).toBe('My API')
      expect(api.identifier).toBe('https://api.example.com')
      expect(api.scopes).toHaveLength(3)
    })

    it('should create API with token settings', async () => {
      const api = await management.resourceServers.create({
        name: 'Token Config API',
        identifier: 'https://tokens.example.com',
        token_lifetime: 86400,
        token_lifetime_for_web: 7200,
        signing_alg: 'RS256',
        allow_offline_access: true,
      })

      expect(api.token_lifetime).toBe(86400)
      expect(api.token_lifetime_for_web).toBe(7200)
      expect(api.signing_alg).toBe('RS256')
      expect(api.allow_offline_access).toBe(true)
    })

    it('should create API with RBAC settings', async () => {
      const api = await management.resourceServers.create({
        name: 'RBAC API',
        identifier: 'https://rbac.example.com',
        enforce_policies: true,
        token_dialect: 'access_token_authz',
      })

      expect(api.enforce_policies).toBe(true)
      expect(api.token_dialect).toBe('access_token_authz')
    })
  })

  describe('resourceServers.get', () => {
    it('should get API by ID', async () => {
      const created = await management.resourceServers.create({
        name: 'Get Test API',
        identifier: 'https://get-test.example.com',
      })

      const api = await management.resourceServers.get({ id: created.id })

      expect(api).toBeDefined()
      expect(api.id).toBe(created.id)
    })

    it('should return null for non-existent API', async () => {
      const api = await management.resourceServers.get({ id: 'nonexistent' })
      expect(api).toBeNull()
    })
  })

  describe('resourceServers.getAll', () => {
    it('should list all APIs', async () => {
      await management.resourceServers.create({
        name: 'API 1',
        identifier: 'https://api1.example.com',
      })
      await management.resourceServers.create({
        name: 'API 2',
        identifier: 'https://api2.example.com',
      })

      const result = await management.resourceServers.getAll()

      expect(result.resource_servers).toBeDefined()
      expect(result.resource_servers.length).toBeGreaterThanOrEqual(2)
    })

    it('should support pagination', async () => {
      const result = await management.resourceServers.getAll({
        per_page: 5,
        page: 0,
        include_totals: true,
      })

      expect(result.resource_servers.length).toBeLessThanOrEqual(5)
    })
  })

  describe('resourceServers.update', () => {
    it('should update API name', async () => {
      const created = await management.resourceServers.create({
        name: 'Original API',
        identifier: 'https://update.example.com',
      })

      const updated = await management.resourceServers.update(
        { id: created.id },
        { name: 'Updated API' }
      )

      expect(updated.name).toBe('Updated API')
    })

    it('should update scopes', async () => {
      const created = await management.resourceServers.create({
        name: 'Scopes API',
        identifier: 'https://scopes.example.com',
        scopes: [{ value: 'read', description: 'Read access' }],
      })

      const updated = await management.resourceServers.update(
        { id: created.id },
        {
          scopes: [
            { value: 'read', description: 'Read access' },
            { value: 'write', description: 'Write access' },
          ],
        }
      )

      expect(updated.scopes).toHaveLength(2)
    })
  })

  describe('resourceServers.delete', () => {
    it('should delete API', async () => {
      const created = await management.resourceServers.create({
        name: 'Delete API',
        identifier: 'https://delete.example.com',
      })

      await management.resourceServers.delete({ id: created.id })

      const deleted = await management.resourceServers.get({ id: created.id })
      expect(deleted).toBeNull()
    })
  })
})

// ============================================================================
// ORGANIZATIONS MANAGER
// ============================================================================

describe('OrganizationsManager', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('organizations property', () => {
    it('should expose organizations manager', () => {
      expect(management.organizations).toBeDefined()
      expect(typeof management.organizations.create).toBe('function')
      expect(typeof management.organizations.get).toBe('function')
      expect(typeof management.organizations.getAll).toBe('function')
      expect(typeof management.organizations.getByName).toBe('function')
      expect(typeof management.organizations.update).toBe('function')
      expect(typeof management.organizations.delete).toBe('function')
    })
  })

  describe('organizations.create', () => {
    it('should create organization', async () => {
      const org = await management.organizations.create({
        name: 'acme-corp',
        display_name: 'Acme Corporation',
        metadata: {
          region: 'us-west',
          tier: 'enterprise',
        },
      })

      expect(org.id).toBeDefined()
      expect(org.name).toBe('acme-corp')
      expect(org.display_name).toBe('Acme Corporation')
      expect(org.metadata?.region).toBe('us-west')
    })

    it('should create organization with branding', async () => {
      const org = await management.organizations.create({
        name: 'branded-org',
        display_name: 'Branded Org',
        branding: {
          logo_url: 'https://example.com/logo.png',
          colors: {
            primary: '#FF5733',
            page_background: '#FFFFFF',
          },
        },
      })

      expect(org.branding?.logo_url).toBe('https://example.com/logo.png')
      expect(org.branding?.colors?.primary).toBe('#FF5733')
    })
  })

  describe('organizations.get', () => {
    it('should get organization by ID', async () => {
      const created = await management.organizations.create({
        name: 'get-org-test',
        display_name: 'Get Org Test',
      })

      const org = await management.organizations.get({ id: created.id })

      expect(org).toBeDefined()
      expect(org.id).toBe(created.id)
    })
  })

  describe('organizations.getByName', () => {
    it('should get organization by name', async () => {
      await management.organizations.create({
        name: 'unique-org-name',
        display_name: 'Unique Org',
      })

      const org = await management.organizations.getByName({ name: 'unique-org-name' })

      expect(org).toBeDefined()
      expect(org.name).toBe('unique-org-name')
    })
  })

  describe('organizations.getAll', () => {
    it('should list all organizations', async () => {
      await management.organizations.create({ name: 'org-1', display_name: 'Org 1' })
      await management.organizations.create({ name: 'org-2', display_name: 'Org 2' })

      const result = await management.organizations.getAll()

      expect(result.organizations).toBeDefined()
      expect(result.organizations.length).toBeGreaterThanOrEqual(2)
    })

    it('should support pagination', async () => {
      const result = await management.organizations.getAll({
        per_page: 5,
        page: 0,
        include_totals: true,
      })

      expect(result.organizations.length).toBeLessThanOrEqual(5)
      expect(result.total).toBeDefined()
    })
  })

  describe('organizations.update', () => {
    it('should update organization', async () => {
      const created = await management.organizations.create({
        name: 'update-org',
        display_name: 'Original Name',
      })

      const updated = await management.organizations.update(
        { id: created.id },
        { display_name: 'Updated Name' }
      )

      expect(updated.display_name).toBe('Updated Name')
    })
  })

  describe('organizations.delete', () => {
    it('should delete organization', async () => {
      const created = await management.organizations.create({
        name: 'delete-org',
        display_name: 'Delete Org',
      })

      await management.organizations.delete({ id: created.id })

      const deleted = await management.organizations.get({ id: created.id })
      expect(deleted).toBeNull()
    })
  })

  describe('organizations members', () => {
    it('should add member to organization', async () => {
      const org = await management.organizations.create({
        name: 'members-org',
        display_name: 'Members Org',
      })

      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'member@example.com',
        password: 'SecurePass123!',
      })

      await management.organizations.addMembers(
        { id: org.id },
        { members: [user.user_id] }
      )

      const members = await management.organizations.getMembers({ id: org.id })

      expect(members.members.some((m) => m.user_id === user.user_id)).toBe(true)
    })

    it('should remove member from organization', async () => {
      const org = await management.organizations.create({
        name: 'remove-member-org',
        display_name: 'Remove Member Org',
      })

      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'removemember@example.com',
        password: 'SecurePass123!',
      })

      await management.organizations.addMembers(
        { id: org.id },
        { members: [user.user_id] }
      )

      await management.organizations.removeMembers(
        { id: org.id },
        { members: [user.user_id] }
      )

      const members = await management.organizations.getMembers({ id: org.id })

      expect(members.members.some((m) => m.user_id === user.user_id)).toBe(false)
    })
  })

  describe('organizations connections', () => {
    it('should enable connection for organization', async () => {
      const org = await management.organizations.create({
        name: 'conn-org',
        display_name: 'Connection Org',
      })

      const connection = await management.connections.create({
        name: 'org-connection',
        strategy: 'auth0',
      })

      await management.organizations.addEnabledConnection(
        { id: org.id },
        {
          connection_id: connection.id,
          assign_membership_on_login: true,
        }
      )

      const connections = await management.organizations.getEnabledConnections({ id: org.id })

      expect(connections.enabled_connections.some((c) => c.connection_id === connection.id)).toBe(true)
    })
  })

  describe('organizations invitations', () => {
    it('should create invitation', async () => {
      const org = await management.organizations.create({
        name: 'invite-org',
        display_name: 'Invite Org',
      })

      const client = await management.clients.create({
        name: 'Invite Client',
        app_type: 'regular_web',
      })

      const invitation = await management.organizations.createInvitation(
        { id: org.id },
        {
          inviter: { name: 'Admin User' },
          invitee: { email: 'newmember@example.com' },
          client_id: client.client_id,
          roles: [],
        }
      )

      expect(invitation.id).toBeDefined()
      expect(invitation.invitation_url).toBeDefined()
    })

    it('should list invitations', async () => {
      const org = await management.organizations.create({
        name: 'list-invite-org',
        display_name: 'List Invite Org',
      })

      const invitations = await management.organizations.getInvitations({ id: org.id })

      expect(invitations.invitations).toBeDefined()
      expect(Array.isArray(invitations.invitations)).toBe(true)
    })
  })
})

// ============================================================================
// ROLES MANAGER
// ============================================================================

describe('RolesManager', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('roles property', () => {
    it('should expose roles manager', () => {
      expect(management.roles).toBeDefined()
      expect(typeof management.roles.create).toBe('function')
      expect(typeof management.roles.get).toBe('function')
      expect(typeof management.roles.getAll).toBe('function')
      expect(typeof management.roles.update).toBe('function')
      expect(typeof management.roles.delete).toBe('function')
    })
  })

  describe('roles.create', () => {
    it('should create role', async () => {
      const role = await management.roles.create({
        name: 'Admin',
        description: 'Administrator role with full access',
      })

      expect(role.id).toBeDefined()
      expect(role.name).toBe('Admin')
      expect(role.description).toBe('Administrator role with full access')
    })
  })

  describe('roles.get', () => {
    it('should get role by ID', async () => {
      const created = await management.roles.create({
        name: 'Get Role Test',
        description: 'Test role',
      })

      const role = await management.roles.get({ id: created.id })

      expect(role).toBeDefined()
      expect(role.id).toBe(created.id)
    })
  })

  describe('roles.getAll', () => {
    it('should list all roles', async () => {
      await management.roles.create({ name: 'Role 1', description: 'Role 1 desc' })
      await management.roles.create({ name: 'Role 2', description: 'Role 2 desc' })

      const result = await management.roles.getAll()

      expect(result.roles).toBeDefined()
      expect(result.roles.length).toBeGreaterThanOrEqual(2)
    })

    it('should filter by name', async () => {
      await management.roles.create({ name: 'UniqueRoleName', description: 'Unique' })

      const result = await management.roles.getAll({
        name_filter: 'UniqueRoleName',
      })

      expect(result.roles.length).toBe(1)
      expect(result.roles[0].name).toBe('UniqueRoleName')
    })
  })

  describe('roles.update', () => {
    it('should update role', async () => {
      const created = await management.roles.create({
        name: 'Update Role',
        description: 'Original description',
      })

      const updated = await management.roles.update(
        { id: created.id },
        { description: 'Updated description' }
      )

      expect(updated.description).toBe('Updated description')
    })
  })

  describe('roles.delete', () => {
    it('should delete role', async () => {
      const created = await management.roles.create({
        name: 'Delete Role',
        description: 'To be deleted',
      })

      await management.roles.delete({ id: created.id })

      const deleted = await management.roles.get({ id: created.id })
      expect(deleted).toBeNull()
    })
  })

  describe('roles permissions', () => {
    it('should add permissions to role', async () => {
      const api = await management.resourceServers.create({
        name: 'Permissions API',
        identifier: 'https://permissions.example.com',
        scopes: [
          { value: 'read:data', description: 'Read data' },
          { value: 'write:data', description: 'Write data' },
        ],
      })

      const role = await management.roles.create({
        name: 'Role with Permissions',
        description: 'Has permissions',
      })

      await management.roles.addPermissions(
        { id: role.id },
        {
          permissions: [
            { permission_name: 'read:data', resource_server_identifier: api.identifier },
            { permission_name: 'write:data', resource_server_identifier: api.identifier },
          ],
        }
      )

      const permissions = await management.roles.getPermissions({ id: role.id })

      expect(permissions.permissions.length).toBe(2)
    })

    it('should remove permissions from role', async () => {
      const api = await management.resourceServers.create({
        name: 'Remove Perms API',
        identifier: 'https://remove-perms.example.com',
        scopes: [{ value: 'test:scope', description: 'Test' }],
      })

      const role = await management.roles.create({
        name: 'Role to Remove Perms',
        description: 'Test',
      })

      await management.roles.addPermissions(
        { id: role.id },
        {
          permissions: [
            { permission_name: 'test:scope', resource_server_identifier: api.identifier },
          ],
        }
      )

      await management.roles.removePermissions(
        { id: role.id },
        {
          permissions: [
            { permission_name: 'test:scope', resource_server_identifier: api.identifier },
          ],
        }
      )

      const permissions = await management.roles.getPermissions({ id: role.id })

      expect(permissions.permissions.length).toBe(0)
    })
  })

  describe('roles users', () => {
    it('should assign role to users', async () => {
      const role = await management.roles.create({
        name: 'User Role',
        description: 'Role for users',
      })

      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'roleuser@example.com',
        password: 'SecurePass123!',
      })

      await management.roles.assignUsers(
        { id: role.id },
        { users: [user.user_id] }
      )

      const users = await management.roles.getUsers({ id: role.id })

      expect(users.users.some((u) => u.user_id === user.user_id)).toBe(true)
    })
  })
})

// ============================================================================
// LOGS MANAGER
// ============================================================================

describe('LogsManager', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('logs property', () => {
    it('should expose logs manager', () => {
      expect(management.logs).toBeDefined()
      expect(typeof management.logs.get).toBe('function')
      expect(typeof management.logs.getAll).toBe('function')
    })
  })

  describe('logs.getAll', () => {
    it('should list logs', async () => {
      const result = await management.logs.getAll()

      expect(result.logs).toBeDefined()
      expect(Array.isArray(result.logs)).toBe(true)
    })

    it('should filter by event type', async () => {
      const result = await management.logs.getAll({
        q: 'type:s',  // Successful login
      })

      expect(result.logs).toBeDefined()
    })

    it('should filter by date range', async () => {
      const result = await management.logs.getAll({
        from: new Date(Date.now() - 86400000).toISOString(),
        to: new Date().toISOString(),
      })

      expect(result.logs).toBeDefined()
    })

    it('should filter by user_id', async () => {
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'loguser@example.com',
        password: 'SecurePass123!',
      })

      const result = await management.logs.getAll({
        q: `user_id:"${user.user_id}"`,
      })

      expect(result.logs).toBeDefined()
    })

    it('should support pagination', async () => {
      const result = await management.logs.getAll({
        per_page: 10,
        page: 0,
        include_totals: true,
      })

      expect(result.logs.length).toBeLessThanOrEqual(10)
    })
  })

  describe('logs.get', () => {
    it('should get log entry by ID', async () => {
      // First get some logs to have an ID
      const allLogs = await management.logs.getAll({ per_page: 1 })

      if (allLogs.logs.length > 0) {
        const log = await management.logs.get({ id: allLogs.logs[0].log_id })

        expect(log).toBeDefined()
        expect(log.log_id).toBe(allLogs.logs[0].log_id)
      }
    })
  })
})

// ============================================================================
// DEVICE CREDENTIALS MANAGER
// ============================================================================

describe('DeviceCredentialsManager', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('deviceCredentials property', () => {
    it('should expose device credentials manager', () => {
      expect(management.deviceCredentials).toBeDefined()
      expect(typeof management.deviceCredentials.create).toBe('function')
      expect(typeof management.deviceCredentials.getAll).toBe('function')
      expect(typeof management.deviceCredentials.delete).toBe('function')
    })
  })

  describe('deviceCredentials.create', () => {
    it('should create device credential', async () => {
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'deviceuser@example.com',
        password: 'SecurePass123!',
      })

      const client = await management.clients.create({
        name: 'Device App',
        app_type: 'native',
      })

      const credential = await management.deviceCredentials.create({
        device_name: 'iPhone 15 Pro',
        type: 'public_key',
        value: 'base64-encoded-public-key',
        device_id: 'device-uuid-123',
        user_id: user.user_id,
        client_id: client.client_id,
      })

      expect(credential.id).toBeDefined()
      expect(credential.device_name).toBe('iPhone 15 Pro')
    })
  })

  describe('deviceCredentials.getAll', () => {
    it('should list device credentials', async () => {
      const result = await management.deviceCredentials.getAll()

      expect(result.device_credentials).toBeDefined()
      expect(Array.isArray(result.device_credentials)).toBe(true)
    })

    it('should filter by user_id', async () => {
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'filtereddevice@example.com',
        password: 'SecurePass123!',
      })

      const result = await management.deviceCredentials.getAll({
        user_id: user.user_id,
      })

      expect(result.device_credentials).toBeDefined()
    })

    it('should filter by client_id', async () => {
      const client = await management.clients.create({
        name: 'Device Filter App',
        app_type: 'native',
      })

      const result = await management.deviceCredentials.getAll({
        client_id: client.client_id,
      })

      expect(result.device_credentials).toBeDefined()
    })
  })

  describe('deviceCredentials.delete', () => {
    it('should delete device credential', async () => {
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'deletedevice@example.com',
        password: 'SecurePass123!',
      })

      const client = await management.clients.create({
        name: 'Delete Device App',
        app_type: 'native',
      })

      const credential = await management.deviceCredentials.create({
        device_name: 'Delete Device',
        type: 'public_key',
        value: 'public-key',
        device_id: 'delete-device-id',
        user_id: user.user_id,
        client_id: client.client_id,
      })

      await management.deviceCredentials.delete({ id: credential.id })

      // Verify deleted
      const all = await management.deviceCredentials.getAll({ user_id: user.user_id })
      expect(all.device_credentials.some((d) => d.id === credential.id)).toBe(false)
    })
  })
})

// ============================================================================
// GRANTS MANAGER
// ============================================================================

describe('GrantsManager', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('grants property', () => {
    it('should expose grants manager', () => {
      expect(management.grants).toBeDefined()
      expect(typeof management.grants.getAll).toBe('function')
      expect(typeof management.grants.delete).toBe('function')
    })
  })

  describe('grants.getAll', () => {
    it('should list grants', async () => {
      const result = await management.grants.getAll()

      expect(result.grants).toBeDefined()
      expect(Array.isArray(result.grants)).toBe(true)
    })

    it('should filter by user_id', async () => {
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'grantuser@example.com',
        password: 'SecurePass123!',
      })

      const result = await management.grants.getAll({
        user_id: user.user_id,
      })

      expect(result.grants).toBeDefined()
    })

    it('should filter by client_id', async () => {
      const client = await management.clients.create({
        name: 'Grant App',
        app_type: 'regular_web',
      })

      const result = await management.grants.getAll({
        client_id: client.client_id,
      })

      expect(result.grants).toBeDefined()
    })

    it('should filter by audience', async () => {
      const result = await management.grants.getAll({
        audience: 'https://api.example.com',
      })

      expect(result.grants).toBeDefined()
    })
  })

  describe('grants.delete', () => {
    it('should delete grant by ID', async () => {
      // Get grants first
      const grants = await management.grants.getAll()

      if (grants.grants.length > 0) {
        await expect(
          management.grants.delete({ id: grants.grants[0].id })
        ).resolves.not.toThrow()
      }
    })

    it('should delete grants by user_id', async () => {
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'deletegrant@example.com',
        password: 'SecurePass123!',
      })

      await expect(
        management.grants.deleteByUserId({ user_id: user.user_id })
      ).resolves.not.toThrow()
    })
  })
})

// ============================================================================
// PROMPTS MANAGER
// ============================================================================

describe('PromptsManager', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('prompts property', () => {
    it('should expose prompts manager', () => {
      expect(management.prompts).toBeDefined()
      expect(typeof management.prompts.get).toBe('function')
      expect(typeof management.prompts.update).toBe('function')
      expect(typeof management.prompts.getCustomTextByLanguage).toBe('function')
      expect(typeof management.prompts.updateCustomTextByLanguage).toBe('function')
    })
  })

  describe('prompts.get', () => {
    it('should get prompt settings', async () => {
      const settings = await management.prompts.get()

      expect(settings).toBeDefined()
      expect(settings.universal_login_experience).toBeDefined()
    })
  })

  describe('prompts.update', () => {
    it('should update prompt settings', async () => {
      const updated = await management.prompts.update({
        universal_login_experience: 'new',
        identifier_first: true,
        webauthn_platform_first_factor: false,
      })

      expect(updated.universal_login_experience).toBe('new')
      expect(updated.identifier_first).toBe(true)
    })
  })

  describe('prompts.getCustomTextByLanguage', () => {
    it('should get custom text for login prompt', async () => {
      const text = await management.prompts.getCustomTextByLanguage({
        prompt: 'login',
        language: 'en',
      })

      expect(text).toBeDefined()
    })

    it('should get custom text for signup prompt', async () => {
      const text = await management.prompts.getCustomTextByLanguage({
        prompt: 'signup',
        language: 'en',
      })

      expect(text).toBeDefined()
    })
  })

  describe('prompts.updateCustomTextByLanguage', () => {
    it('should update custom text', async () => {
      await management.prompts.updateCustomTextByLanguage(
        { prompt: 'login', language: 'en' },
        {
          login: {
            title: 'Welcome Back',
            description: 'Sign in to continue',
            buttonText: 'Sign In',
          },
        }
      )

      const text = await management.prompts.getCustomTextByLanguage({
        prompt: 'login',
        language: 'en',
      })

      expect(text.login?.title).toBe('Welcome Back')
    })
  })
})

// ============================================================================
// USER BLOCKS MANAGER (Extension of Users)
// ============================================================================

describe('UserBlocksManager', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('userBlocks property', () => {
    it('should expose user blocks manager', () => {
      expect(management.userBlocks).toBeDefined()
      expect(typeof management.userBlocks.get).toBe('function')
      expect(typeof management.userBlocks.getByIdentifier).toBe('function')
      expect(typeof management.userBlocks.delete).toBe('function')
      expect(typeof management.userBlocks.deleteByIdentifier).toBe('function')
    })
  })

  describe('userBlocks.get', () => {
    it('should get blocks for user', async () => {
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'blockeduser@example.com',
        password: 'SecurePass123!',
      })

      const blocks = await management.userBlocks.get({ id: user.user_id })

      expect(blocks).toBeDefined()
      expect(blocks.blocked_for).toBeDefined()
    })
  })

  describe('userBlocks.getByIdentifier', () => {
    it('should get blocks by identifier (email)', async () => {
      const blocks = await management.userBlocks.getByIdentifier({
        identifier: 'test@example.com',
      })

      expect(blocks).toBeDefined()
    })
  })

  describe('userBlocks.delete', () => {
    it('should unblock user by ID', async () => {
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'unblockuser@example.com',
        password: 'SecurePass123!',
      })

      await expect(
        management.userBlocks.delete({ id: user.user_id })
      ).resolves.not.toThrow()
    })
  })

  describe('userBlocks.deleteByIdentifier', () => {
    it('should unblock by identifier', async () => {
      await expect(
        management.userBlocks.deleteByIdentifier({ identifier: 'test@example.com' })
      ).resolves.not.toThrow()
    })
  })
})

// ============================================================================
// STATS MANAGER
// ============================================================================

describe('StatsManager', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('stats property', () => {
    it('should expose stats manager', () => {
      expect(management.stats).toBeDefined()
      expect(typeof management.stats.getActiveUsersCount).toBe('function')
      expect(typeof management.stats.getDaily).toBe('function')
    })
  })

  describe('stats.getActiveUsersCount', () => {
    it('should get active users count', async () => {
      const count = await management.stats.getActiveUsersCount()

      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(0)
    })
  })

  describe('stats.getDaily', () => {
    it('should get daily stats', async () => {
      const stats = await management.stats.getDaily()

      expect(stats).toBeDefined()
      expect(Array.isArray(stats)).toBe(true)
    })

    it('should filter by date range', async () => {
      const stats = await management.stats.getDaily({
        from: '2024-01-01',
        to: '2024-01-31',
      })

      expect(stats).toBeDefined()
    })
  })
})

// ============================================================================
// TENANTS MANAGER
// ============================================================================

describe('TenantsManager', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('tenants property', () => {
    it('should expose tenants manager', () => {
      expect(management.tenants).toBeDefined()
      expect(typeof management.tenants.getSettings).toBe('function')
      expect(typeof management.tenants.updateSettings).toBe('function')
    })
  })

  describe('tenants.getSettings', () => {
    it('should get tenant settings', async () => {
      const settings = await management.tenants.getSettings()

      expect(settings).toBeDefined()
      expect(settings.friendly_name).toBeDefined()
    })
  })

  describe('tenants.updateSettings', () => {
    it('should update tenant settings', async () => {
      const updated = await management.tenants.updateSettings({
        friendly_name: 'My Tenant',
        picture_url: 'https://example.com/logo.png',
        support_email: 'support@example.com',
        support_url: 'https://support.example.com',
      })

      expect(updated.friendly_name).toBe('My Tenant')
    })

    it('should update session settings', async () => {
      const updated = await management.tenants.updateSettings({
        session_lifetime: 72,
        idle_session_lifetime: 24,
      })

      expect(updated.session_lifetime).toBe(72)
      expect(updated.idle_session_lifetime).toBe(24)
    })

    it('should update security settings', async () => {
      const updated = await management.tenants.updateSettings({
        flags: {
          disable_clickjack_protection_headers: false,
          enable_public_signup_user_exists_error: true,
        },
      })

      expect(updated.flags?.enable_public_signup_user_exists_error).toBe(true)
    })
  })
})

// ============================================================================
// EMAIL TEMPLATES MANAGER
// ============================================================================

describe('EmailTemplatesManager', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('emailTemplates property', () => {
    it('should expose email templates manager', () => {
      expect(management.emailTemplates).toBeDefined()
      expect(typeof management.emailTemplates.get).toBe('function')
      expect(typeof management.emailTemplates.create).toBe('function')
      expect(typeof management.emailTemplates.update).toBe('function')
    })
  })

  describe('emailTemplates.get', () => {
    it('should get verification email template', async () => {
      const template = await management.emailTemplates.get({
        templateName: 'verify_email',
      })

      expect(template).toBeDefined()
      expect(template.template).toBe('verify_email')
    })

    it('should get welcome email template', async () => {
      const template = await management.emailTemplates.get({
        templateName: 'welcome_email',
      })

      expect(template).toBeDefined()
    })

    it('should get reset email template', async () => {
      const template = await management.emailTemplates.get({
        templateName: 'reset_email',
      })

      expect(template).toBeDefined()
    })
  })

  describe('emailTemplates.update', () => {
    it('should update email template', async () => {
      const updated = await management.emailTemplates.update(
        { templateName: 'verify_email' },
        {
          from: 'noreply@example.com',
          subject: 'Verify your email',
          body: '<html><body>Click here to verify: {{ url }}</body></html>',
          syntax: 'liquid',
          enabled: true,
        }
      )

      expect(updated.from).toBe('noreply@example.com')
      expect(updated.enabled).toBe(true)
    })
  })
})

// ============================================================================
// GUARDIAN MANAGER (MFA)
// ============================================================================

describe('GuardianManager', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('guardian property', () => {
    it('should expose guardian manager', () => {
      expect(management.guardian).toBeDefined()
      expect(typeof management.guardian.getFactors).toBe('function')
      expect(typeof management.guardian.updateFactor).toBe('function')
      expect(typeof management.guardian.getEnrollments).toBe('function')
      expect(typeof management.guardian.deleteEnrollment).toBe('function')
    })
  })

  describe('guardian.getFactors', () => {
    it('should get MFA factors', async () => {
      const factors = await management.guardian.getFactors()

      expect(factors).toBeDefined()
      expect(Array.isArray(factors)).toBe(true)
    })
  })

  describe('guardian.updateFactor', () => {
    it('should enable SMS factor', async () => {
      const updated = await management.guardian.updateFactor(
        { name: 'sms' },
        { enabled: true }
      )

      expect(updated.enabled).toBe(true)
    })

    it('should enable OTP factor', async () => {
      const updated = await management.guardian.updateFactor(
        { name: 'otp' },
        { enabled: true }
      )

      expect(updated.enabled).toBe(true)
    })

    it('should enable push notification factor', async () => {
      const updated = await management.guardian.updateFactor(
        { name: 'push-notification' },
        { enabled: true }
      )

      expect(updated.enabled).toBe(true)
    })

    it('should enable WebAuthn Roaming factor', async () => {
      const updated = await management.guardian.updateFactor(
        { name: 'webauthn-roaming' },
        { enabled: true }
      )

      expect(updated.enabled).toBe(true)
    })

    it('should enable WebAuthn Platform factor', async () => {
      const updated = await management.guardian.updateFactor(
        { name: 'webauthn-platform' },
        { enabled: true }
      )

      expect(updated.enabled).toBe(true)
    })
  })

  describe('guardian.getEnrollments', () => {
    it('should get user enrollments', async () => {
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'mfauser@example.com',
        password: 'SecurePass123!',
      })

      const enrollments = await management.guardian.getEnrollments({
        user_id: user.user_id,
      })

      expect(enrollments).toBeDefined()
      expect(Array.isArray(enrollments)).toBe(true)
    })
  })

  describe('guardian.deleteEnrollment', () => {
    it('should delete user enrollment', async () => {
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'deleteenroll@example.com',
        password: 'SecurePass123!',
      })

      // First get enrollments
      const enrollments = await management.guardian.getEnrollments({
        user_id: user.user_id,
      })

      if (enrollments.length > 0) {
        await expect(
          management.guardian.deleteEnrollment({ id: enrollments[0].id })
        ).resolves.not.toThrow()
      }
    })
  })
})

// ============================================================================
// ATTACK PROTECTION MANAGER
// ============================================================================

describe('AttackProtectionManager', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('attackProtection property', () => {
    it('should expose attack protection manager', () => {
      expect(management.attackProtection).toBeDefined()
      expect(typeof management.attackProtection.getBruteForceConfig).toBe('function')
      expect(typeof management.attackProtection.updateBruteForceConfig).toBe('function')
      expect(typeof management.attackProtection.getSuspiciousIpThrottlingConfig).toBe('function')
      expect(typeof management.attackProtection.updateSuspiciousIpThrottlingConfig).toBe('function')
      expect(typeof management.attackProtection.getBreachedPasswordDetectionConfig).toBe('function')
      expect(typeof management.attackProtection.updateBreachedPasswordDetectionConfig).toBe('function')
    })
  })

  describe('attackProtection.getBruteForceConfig', () => {
    it('should get brute force protection config', async () => {
      const config = await management.attackProtection.getBruteForceConfig()

      expect(config).toBeDefined()
      expect(config.enabled).toBeDefined()
    })
  })

  describe('attackProtection.updateBruteForceConfig', () => {
    it('should update brute force protection config', async () => {
      const updated = await management.attackProtection.updateBruteForceConfig({
        enabled: true,
        shields: ['block', 'user_notification'],
        mode: 'count_per_identifier_and_ip',
        allowlist: ['192.168.1.1'],
        max_attempts: 10,
      })

      expect(updated.enabled).toBe(true)
      expect(updated.max_attempts).toBe(10)
    })
  })

  describe('attackProtection.getSuspiciousIpThrottlingConfig', () => {
    it('should get suspicious IP throttling config', async () => {
      const config = await management.attackProtection.getSuspiciousIpThrottlingConfig()

      expect(config).toBeDefined()
      expect(config.enabled).toBeDefined()
    })
  })

  describe('attackProtection.getBreachedPasswordDetectionConfig', () => {
    it('should get breached password detection config', async () => {
      const config = await management.attackProtection.getBreachedPasswordDetectionConfig()

      expect(config).toBeDefined()
      expect(config.enabled).toBeDefined()
    })
  })

  describe('attackProtection.updateBreachedPasswordDetectionConfig', () => {
    it('should update breached password detection config', async () => {
      const updated = await management.attackProtection.updateBreachedPasswordDetectionConfig({
        enabled: true,
        shields: ['block', 'admin_notification'],
        method: 'standard',
      })

      expect(updated.enabled).toBe(true)
    })
  })
})

// ============================================================================
// HOOKS MANAGER (Legacy, but still used)
// ============================================================================

describe('HooksManager', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('hooks property', () => {
    it('should expose hooks manager', () => {
      expect(management.hooks).toBeDefined()
      expect(typeof management.hooks.create).toBe('function')
      expect(typeof management.hooks.get).toBe('function')
      expect(typeof management.hooks.getAll).toBe('function')
      expect(typeof management.hooks.update).toBe('function')
      expect(typeof management.hooks.delete).toBe('function')
    })
  })

  describe('hooks.create', () => {
    it('should create credentials-exchange hook', async () => {
      const hook = await management.hooks.create({
        name: 'My Credentials Exchange Hook',
        triggerId: 'credentials-exchange',
        script: `
          module.exports = function(client, scope, audience, context, cb) {
            cb(null, { scope });
          };
        `,
        enabled: true,
      })

      expect(hook.id).toBeDefined()
      expect(hook.name).toBe('My Credentials Exchange Hook')
      expect(hook.triggerId).toBe('credentials-exchange')
    })

    it('should create pre-user-registration hook', async () => {
      const hook = await management.hooks.create({
        name: 'Pre User Registration',
        triggerId: 'pre-user-registration',
        script: `
          module.exports = function(user, context, cb) {
            cb(null, { user });
          };
        `,
        enabled: true,
      })

      expect(hook.triggerId).toBe('pre-user-registration')
    })

    it('should create post-user-registration hook', async () => {
      const hook = await management.hooks.create({
        name: 'Post User Registration',
        triggerId: 'post-user-registration',
        script: `
          module.exports = function(user, context, cb) {
            cb();
          };
        `,
        enabled: true,
      })

      expect(hook.triggerId).toBe('post-user-registration')
    })

    it('should create post-change-password hook', async () => {
      const hook = await management.hooks.create({
        name: 'Post Change Password',
        triggerId: 'post-change-password',
        script: `
          module.exports = function(user, context, cb) {
            cb();
          };
        `,
        enabled: true,
      })

      expect(hook.triggerId).toBe('post-change-password')
    })

    it('should create send-phone-message hook', async () => {
      const hook = await management.hooks.create({
        name: 'Send Phone Message',
        triggerId: 'send-phone-message',
        script: `
          module.exports = function(recipient, text, context, cb) {
            cb();
          };
        `,
        enabled: true,
      })

      expect(hook.triggerId).toBe('send-phone-message')
    })
  })

  describe('hooks.getAll', () => {
    it('should list all hooks', async () => {
      const result = await management.hooks.getAll()

      expect(result.hooks).toBeDefined()
      expect(Array.isArray(result.hooks)).toBe(true)
    })

    it('should filter by triggerId', async () => {
      const result = await management.hooks.getAll({
        triggerId: 'credentials-exchange',
      })

      expect(result.hooks.every((h) => h.triggerId === 'credentials-exchange')).toBe(true)
    })

    it('should filter by enabled', async () => {
      const result = await management.hooks.getAll({
        enabled: true,
      })

      expect(result.hooks.every((h) => h.enabled === true)).toBe(true)
    })
  })

  describe('hooks.update', () => {
    it('should update hook', async () => {
      const created = await management.hooks.create({
        name: 'Update Test Hook',
        triggerId: 'credentials-exchange',
        script: 'module.exports = function(c,s,a,ctx,cb){cb()};',
        enabled: true,
      })

      const updated = await management.hooks.update(
        { id: created.id },
        { name: 'Updated Hook Name', enabled: false }
      )

      expect(updated.name).toBe('Updated Hook Name')
      expect(updated.enabled).toBe(false)
    })
  })

  describe('hooks.delete', () => {
    it('should delete hook', async () => {
      const created = await management.hooks.create({
        name: 'Delete Test Hook',
        triggerId: 'credentials-exchange',
        script: 'module.exports = function(c,s,a,ctx,cb){cb()};',
        enabled: true,
      })

      await management.hooks.delete({ id: created.id })

      const deleted = await management.hooks.get({ id: created.id })
      expect(deleted).toBeNull()
    })
  })

  describe('hooks.getSecrets', () => {
    it('should get hook secrets', async () => {
      const created = await management.hooks.create({
        name: 'Secrets Test Hook',
        triggerId: 'credentials-exchange',
        script: 'module.exports = function(c,s,a,ctx,cb){cb()};',
        enabled: true,
      })

      const secrets = await management.hooks.getSecrets({ id: created.id })

      expect(secrets).toBeDefined()
    })
  })

  describe('hooks.updateSecrets', () => {
    it('should update hook secrets', async () => {
      const created = await management.hooks.create({
        name: 'Update Secrets Hook',
        triggerId: 'credentials-exchange',
        script: 'module.exports = function(c,s,a,ctx,cb){cb()};',
        enabled: true,
      })

      await management.hooks.updateSecrets(
        { id: created.id },
        { API_KEY: 'secret-api-key', API_SECRET: 'secret-api-secret' }
      )

      const secrets = await management.hooks.getSecrets({ id: created.id })

      expect(secrets.API_KEY).toBeDefined()
    })
  })
})

// ============================================================================
// BLACKLISTED TOKENS MANAGER
// ============================================================================

describe('BlacklistsManager', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('blacklists property', () => {
    it('should expose blacklists manager', () => {
      expect(management.blacklists).toBeDefined()
      expect(typeof management.blacklists.add).toBe('function')
      expect(typeof management.blacklists.getAll).toBe('function')
    })
  })

  describe('blacklists.add', () => {
    it('should add token to blacklist', async () => {
      await expect(
        management.blacklists.add({
          aud: 'https://api.example.com',
          jti: 'token-jti-to-blacklist',
        })
      ).resolves.not.toThrow()
    })
  })

  describe('blacklists.getAll', () => {
    it('should get blacklisted tokens', async () => {
      const result = await management.blacklists.getAll({
        aud: 'https://api.example.com',
      })

      expect(result).toBeDefined()
      expect(Array.isArray(result)).toBe(true)
    })
  })
})

// ============================================================================
// KEYS MANAGER
// ============================================================================

describe('KeysManager', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('keys property', () => {
    it('should expose keys manager', () => {
      expect(management.keys).toBeDefined()
      expect(typeof management.keys.getAll).toBe('function')
      expect(typeof management.keys.get).toBe('function')
      expect(typeof management.keys.rotate).toBe('function')
      expect(typeof management.keys.revoke).toBe('function')
    })
  })

  describe('keys.getAll', () => {
    it('should get signing keys', async () => {
      const keys = await management.keys.getAll()

      expect(keys).toBeDefined()
      expect(Array.isArray(keys)).toBe(true)
    })
  })

  describe('keys.get', () => {
    it('should get key by kid', async () => {
      const allKeys = await management.keys.getAll()

      if (allKeys.length > 0) {
        const key = await management.keys.get({ kid: allKeys[0].kid })

        expect(key).toBeDefined()
        expect(key.kid).toBe(allKeys[0].kid)
      }
    })
  })

  describe('keys.rotate', () => {
    it('should rotate signing key', async () => {
      const newKey = await management.keys.rotate()

      expect(newKey).toBeDefined()
      expect(newKey.kid).toBeDefined()
      expect(newKey.cert).toBeDefined()
    })
  })

  describe('keys.revoke', () => {
    it('should revoke key', async () => {
      const allKeys = await management.keys.getAll()

      // Find a non-current key to revoke
      const keyToRevoke = allKeys.find((k) => !k.current)

      if (keyToRevoke) {
        await expect(
          management.keys.revoke({ kid: keyToRevoke.kid })
        ).resolves.not.toThrow()
      }
    })
  })
})

// ============================================================================
// ENHANCED USER MANAGEMENT TESTS (Block/Unblock, Search)
// ============================================================================

describe('Enhanced UserManagement', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('user CRUD operations', () => {
    it('should create user and return user_id with auth0| prefix', async () => {
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'crud-test@example.com',
        password: 'SecurePass123!',
      })

      expect(user.user_id).toMatch(/^auth0\|/)
    })

    it('should update multiple fields atomically', async () => {
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'atomic-update@example.com',
        password: 'SecurePass123!',
      })

      const updated = await management.users.update(
        { id: user.user_id },
        {
          given_name: 'John',
          family_name: 'Doe',
          nickname: 'johnd',
          user_metadata: { theme: 'dark' },
          app_metadata: { role: 'admin' },
        }
      )

      expect(updated.given_name).toBe('John')
      expect(updated.family_name).toBe('Doe')
      expect(updated.nickname).toBe('johnd')
      expect(updated.user_metadata?.theme).toBe('dark')
      expect(updated.app_metadata?.role).toBe('admin')
    })

    it('should soft delete user (not hard delete)', async () => {
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'soft-delete@example.com',
        password: 'SecurePass123!',
      })

      await management.users.delete({ id: user.user_id })

      // User should no longer be retrievable
      const deleted = await management.users.get({ id: user.user_id })
      expect(deleted).toBeNull()
    })
  })

  describe('advanced user search', () => {
    beforeEach(async () => {
      // Create test users for search
      await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'search1@acme.com',
        password: 'SecurePass123!',
        given_name: 'Alice',
        app_metadata: { company: 'Acme', tier: 'enterprise' },
      })
      await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'search2@acme.com',
        password: 'SecurePass123!',
        given_name: 'Bob',
        app_metadata: { company: 'Acme', tier: 'free' },
      })
      await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'search3@other.com',
        password: 'SecurePass123!',
        given_name: 'Charlie',
        app_metadata: { company: 'Other', tier: 'enterprise' },
      })
    })

    it('should search by email domain using wildcard', async () => {
      const result = await management.users.getAll({
        q: 'email:*@acme.com',
        search_engine: 'v3',
      })

      expect(result.users.length).toBe(2)
      expect(result.users.every((u) => u.email?.endsWith('@acme.com'))).toBe(true)
    })

    it('should search by app_metadata nested field', async () => {
      const result = await management.users.getAll({
        q: 'app_metadata.tier:enterprise',
        search_engine: 'v3',
      })

      expect(result.users.length).toBe(2)
    })

    it('should search with AND operator', async () => {
      const result = await management.users.getAll({
        q: 'app_metadata.company:Acme AND app_metadata.tier:enterprise',
        search_engine: 'v3',
      })

      expect(result.users.length).toBe(1)
      expect(result.users[0].email).toBe('search1@acme.com')
    })

    it('should search with OR operator', async () => {
      const result = await management.users.getAll({
        q: 'given_name:Alice OR given_name:Bob',
        search_engine: 'v3',
      })

      expect(result.users.length).toBe(2)
    })

    it('should search with NOT operator', async () => {
      const result = await management.users.getAll({
        q: 'app_metadata.company:Acme AND NOT app_metadata.tier:free',
        search_engine: 'v3',
      })

      expect(result.users.length).toBe(1)
      expect(result.users[0].given_name).toBe('Alice')
    })

    it('should search with range queries', async () => {
      const result = await management.users.getAll({
        q: 'logins_count:[0 TO 10]',
        search_engine: 'v3',
      })

      expect(result.users).toBeDefined()
    })

    it('should search by created_at date range', async () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString()
      const tomorrow = new Date(Date.now() + 86400000).toISOString()

      const result = await management.users.getAll({
        q: `created_at:[${yesterday} TO ${tomorrow}]`,
        search_engine: 'v3',
      })

      expect(result.users.length).toBeGreaterThan(0)
    })

    it('should return totals with include_totals', async () => {
      const result = await management.users.getAll({
        per_page: 1,
        page: 0,
        include_totals: true,
      })

      expect(result.total).toBeDefined()
      expect(result.total).toBeGreaterThanOrEqual(3)
    })
  })

  describe('user blocking and unblocking', () => {
    it('should block user by user_id', async () => {
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'block-test1@example.com',
        password: 'SecurePass123!',
      })

      const updated = await management.users.update(
        { id: user.user_id },
        { blocked: true }
      )

      expect(updated.blocked).toBe(true)
    })

    it('should unblock user by user_id', async () => {
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'unblock-test1@example.com',
        password: 'SecurePass123!',
        blocked: true,
      })

      const updated = await management.users.update(
        { id: user.user_id },
        { blocked: false }
      )

      expect(updated.blocked).toBe(false)
    })

    it('should get user blocks by identifier (IP-based blocks)', async () => {
      const blocks = await management.userBlocks.getByIdentifier({
        identifier: 'blocked-user@example.com',
      })

      expect(blocks).toBeDefined()
      expect(blocks.blocked_for).toBeDefined()
    })

    it('should unblock by identifier (clear IP blocks)', async () => {
      await expect(
        management.userBlocks.deleteByIdentifier({
          identifier: 'blocked-user@example.com',
        })
      ).resolves.not.toThrow()
    })

    it('should list all blocked users', async () => {
      // Create and block a user
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'list-blocked@example.com',
        password: 'SecurePass123!',
      })

      await management.users.update(
        { id: user.user_id },
        { blocked: true }
      )

      const result = await management.users.getAll({
        q: 'blocked:true',
        search_engine: 'v3',
      })

      expect(result.users.some((u) => u.user_id === user.user_id)).toBe(true)
    })

    it('should preserve user data when blocking', async () => {
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'preserve-data@example.com',
        password: 'SecurePass123!',
        given_name: 'Test',
        user_metadata: { preference: 'value' },
      })

      const blocked = await management.users.update(
        { id: user.user_id },
        { blocked: true }
      )

      expect(blocked.blocked).toBe(true)
      expect(blocked.given_name).toBe('Test')
      expect(blocked.user_metadata?.preference).toBe('value')
    })
  })
})

// ============================================================================
// ENHANCED CONNECTION MANAGEMENT TESTS
// ============================================================================

describe('Enhanced ConnectionManagement', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('database connection configuration', () => {
    it('should create database connection with password policy', async () => {
      const connection = await management.connections.create({
        name: 'db-with-policy',
        strategy: 'auth0',
        options: {
          passwordPolicy: 'excellent',
          password_complexity_options: {
            min_length: 12,
          },
          password_history: {
            enable: true,
            size: 5,
          },
          password_no_personal_info: {
            enable: true,
          },
        },
      })

      expect(connection.options?.passwordPolicy).toBe('excellent')
      expect(connection.options?.password_complexity_options?.min_length).toBe(12)
    })

    it('should create database connection with MFA settings', async () => {
      const connection = await management.connections.create({
        name: 'db-with-mfa',
        strategy: 'auth0',
        options: {
          mfa: {
            active: true,
            return_enroll_settings: true,
          },
        },
      })

      expect(connection.options?.mfa?.active).toBe(true)
    })

    it('should create database connection with import_mode', async () => {
      const connection = await management.connections.create({
        name: 'db-import-mode',
        strategy: 'auth0',
        options: {
          import_mode: true,
        },
      })

      expect(connection.options?.import_mode).toBe(true)
    })

    it('should create custom database connection', async () => {
      const connection = await management.connections.create({
        name: 'custom-db',
        strategy: 'auth0',
        options: {
          customScripts: {
            login: `function login(email, password, callback) {
              callback(null, { user_id: email, email: email });
            }`,
            get_user: `function getUser(email, callback) {
              callback(null, { user_id: email, email: email });
            }`,
          },
        },
      })

      expect(connection.options?.customScripts?.login).toBeDefined()
    })
  })

  describe('social connection configuration', () => {
    it('should create Google connection with extended scopes', async () => {
      const connection = await management.connections.create({
        name: 'google-extended',
        strategy: 'google-oauth2',
        options: {
          client_id: 'google-client-id',
          client_secret: 'google-client-secret',
          scope: ['email', 'profile', 'https://www.googleapis.com/auth/calendar.readonly'],
          allowed_audiences: ['https://example.com'],
        },
      })

      expect(connection.options?.scope).toContain('https://www.googleapis.com/auth/calendar.readonly')
    })

    it('should create GitHub connection with organization restriction', async () => {
      const connection = await management.connections.create({
        name: 'github-org',
        strategy: 'github',
        options: {
          client_id: 'github-client-id',
          client_secret: 'github-client-secret',
          scope: ['user:email', 'read:org'],
          organizations: ['my-org'],
        },
      })

      expect(connection.options?.organizations).toContain('my-org')
    })

    it('should create Apple connection', async () => {
      const connection = await management.connections.create({
        name: 'apple',
        strategy: 'apple',
        options: {
          client_id: 'com.example.app',
          team_id: 'TEAM123',
          key_id: 'KEY123',
          app_secret: 'private-key-content',
          scope: ['name', 'email'],
        },
      })

      expect(connection.strategy).toBe('apple')
    })

    it('should create LinkedIn connection', async () => {
      const connection = await management.connections.create({
        name: 'linkedin',
        strategy: 'linkedin',
        options: {
          client_id: 'linkedin-client-id',
          client_secret: 'linkedin-client-secret',
          scope: ['r_liteprofile', 'r_emailaddress'],
        },
      })

      expect(connection.strategy).toBe('linkedin')
    })

    it('should create Microsoft connection', async () => {
      const connection = await management.connections.create({
        name: 'microsoft',
        strategy: 'windowslive',
        options: {
          client_id: 'ms-client-id',
          client_secret: 'ms-client-secret',
          scope: ['openid', 'profile', 'email'],
        },
      })

      expect(connection.strategy).toBe('windowslive')
    })
  })

  describe('enterprise connection configuration', () => {
    it('should create SAML connection with attribute mapping', async () => {
      const connection = await management.connections.create({
        name: 'saml-enterprise',
        strategy: 'samlp',
        options: {
          signInEndpoint: 'https://idp.enterprise.com/saml/login',
          signingCert: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----',
          protocolBinding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
          fieldsMap: {
            email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
            given_name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
            family_name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
          },
          signatureAlgorithm: 'rsa-sha256',
          digestAlgorithm: 'sha256',
        },
      })

      expect(connection.options?.fieldsMap?.email).toBeDefined()
    })

    it('should create ADFS connection', async () => {
      const connection = await management.connections.create({
        name: 'adfs-enterprise',
        strategy: 'adfs',
        options: {
          adfs_server: 'https://adfs.enterprise.com',
          signInEndpoint: 'https://adfs.enterprise.com/adfs/ls/',
          signingCert: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----',
        },
      })

      expect(connection.strategy).toBe('adfs')
    })

    it('should create Azure AD connection', async () => {
      const connection = await management.connections.create({
        name: 'azure-ad',
        strategy: 'waad',
        options: {
          client_id: 'azure-client-id',
          client_secret: 'azure-client-secret',
          tenant_domain: 'enterprise.onmicrosoft.com',
          domain: 'enterprise.com',
          domain_aliases: ['enterprise.co', 'enterprise.io'],
          use_wsfed: false,
          waad_protocol: 'openid-connect',
          waad_common_endpoint: false,
        },
      })

      expect(connection.strategy).toBe('waad')
    })

    it('should create Okta Workforce connection', async () => {
      const connection = await management.connections.create({
        name: 'okta-workforce',
        strategy: 'okta',
        options: {
          client_id: 'okta-client-id',
          client_secret: 'okta-client-secret',
          domain: 'enterprise.okta.com',
          domain_aliases: ['enterprise.oktapreview.com'],
        },
      })

      expect(connection.strategy).toBe('okta')
    })

    it('should create LDAP connection', async () => {
      const connection = await management.connections.create({
        name: 'ldap-enterprise',
        strategy: 'ad',
        options: {
          ips: ['192.168.1.1', '192.168.1.2'],
          domain: 'ENTERPRISE',
          cert: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----',
        },
      })

      expect(connection.strategy).toBe('ad')
    })
  })

  describe('connection lifecycle', () => {
    it('should disable connection', async () => {
      const connection = await management.connections.create({
        name: 'to-disable',
        strategy: 'auth0',
      })

      const updated = await management.connections.update(
        { id: connection.id },
        { is_domain_connection: false }
      )

      expect(updated).toBeDefined()
    })

    it('should test connection status', async () => {
      const connection = await management.connections.create({
        name: 'status-check',
        strategy: 'auth0',
      })

      const status = await management.connections.getStatus({ id: connection.id })

      expect(status.status).toBeDefined()
    })
  })
})

// ============================================================================
// ENHANCED ROLE AND PERMISSION MANAGEMENT TESTS
// ============================================================================

describe('Enhanced RolePermissionManagement', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('role CRUD operations', () => {
    it('should create role with name and description', async () => {
      const role = await management.roles.create({
        name: 'SuperAdmin',
        description: 'Full access to all resources',
      })

      expect(role.id).toBeDefined()
      expect(role.id).toMatch(/^rol_/)
      expect(role.name).toBe('SuperAdmin')
    })

    it('should get role by ID', async () => {
      const created = await management.roles.create({
        name: 'GetTest',
        description: 'Test role',
      })

      const role = await management.roles.get({ id: created.id })

      expect(role).toBeDefined()
      expect(role.id).toBe(created.id)
    })

    it('should update role name and description', async () => {
      const created = await management.roles.create({
        name: 'UpdateTest',
        description: 'Original description',
      })

      const updated = await management.roles.update(
        { id: created.id },
        {
          name: 'UpdatedName',
          description: 'Updated description',
        }
      )

      expect(updated.name).toBe('UpdatedName')
      expect(updated.description).toBe('Updated description')
    })

    it('should delete role', async () => {
      const created = await management.roles.create({
        name: 'DeleteTest',
        description: 'To be deleted',
      })

      await management.roles.delete({ id: created.id })

      const deleted = await management.roles.get({ id: created.id })
      expect(deleted).toBeNull()
    })

    it('should list all roles with pagination', async () => {
      // Create multiple roles
      await management.roles.create({ name: 'Role1', description: 'Desc 1' })
      await management.roles.create({ name: 'Role2', description: 'Desc 2' })
      await management.roles.create({ name: 'Role3', description: 'Desc 3' })

      const result = await management.roles.getAll({
        per_page: 2,
        page: 0,
        include_totals: true,
      })

      expect(result.roles.length).toBeLessThanOrEqual(2)
      expect(result.total).toBeGreaterThanOrEqual(3)
    })
  })

  describe('role-user assignment', () => {
    it('should assign role to user', async () => {
      const role = await management.roles.create({
        name: 'UserRole1',
        description: 'Role for users',
      })

      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'role-assign1@example.com',
        password: 'SecurePass123!',
      })

      await management.users.assignRoles(
        { id: user.user_id },
        { roles: [role.id] }
      )

      const userRoles = await management.users.getRoles({ id: user.user_id })

      expect(userRoles.roles.some((r) => r.id === role.id)).toBe(true)
    })

    it('should assign multiple roles to user', async () => {
      const role1 = await management.roles.create({
        name: 'MultiRole1',
        description: 'First role',
      })
      const role2 = await management.roles.create({
        name: 'MultiRole2',
        description: 'Second role',
      })

      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'multi-role@example.com',
        password: 'SecurePass123!',
      })

      await management.users.assignRoles(
        { id: user.user_id },
        { roles: [role1.id, role2.id] }
      )

      const userRoles = await management.users.getRoles({ id: user.user_id })

      expect(userRoles.roles.length).toBe(2)
    })

    it('should remove role from user', async () => {
      const role = await management.roles.create({
        name: 'RemoveRole',
        description: 'To be removed',
      })

      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'remove-role@example.com',
        password: 'SecurePass123!',
      })

      await management.users.assignRoles(
        { id: user.user_id },
        { roles: [role.id] }
      )

      await management.users.removeRoles(
        { id: user.user_id },
        { roles: [role.id] }
      )

      const userRoles = await management.users.getRoles({ id: user.user_id })

      expect(userRoles.roles.some((r) => r.id === role.id)).toBe(false)
    })

    it('should list users assigned to a role', async () => {
      const role = await management.roles.create({
        name: 'ListUsersRole',
        description: 'Role with users',
      })

      const user1 = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'role-user1@example.com',
        password: 'SecurePass123!',
      })
      const user2 = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'role-user2@example.com',
        password: 'SecurePass123!',
      })

      await management.roles.assignUsers(
        { id: role.id },
        { users: [user1.user_id, user2.user_id] }
      )

      const roleUsers = await management.roles.getUsers({ id: role.id })

      expect(roleUsers.users.length).toBe(2)
    })
  })

  describe('permission management', () => {
    it('should add permissions to role', async () => {
      const api = await management.resourceServers.create({
        name: 'Permissions Test API',
        identifier: 'https://perms-test.example.com',
        scopes: [
          { value: 'read:items', description: 'Read items' },
          { value: 'write:items', description: 'Write items' },
          { value: 'delete:items', description: 'Delete items' },
        ],
      })

      const role = await management.roles.create({
        name: 'PermissionsRole',
        description: 'Role with permissions',
      })

      await management.roles.addPermissions(
        { id: role.id },
        {
          permissions: [
            { permission_name: 'read:items', resource_server_identifier: api.identifier },
            { permission_name: 'write:items', resource_server_identifier: api.identifier },
          ],
        }
      )

      const permissions = await management.roles.getPermissions({ id: role.id })

      expect(permissions.permissions.length).toBe(2)
      expect(permissions.permissions.some((p) => p.permission_name === 'read:items')).toBe(true)
    })

    it('should remove permissions from role', async () => {
      const api = await management.resourceServers.create({
        name: 'Remove Perms API',
        identifier: 'https://remove-perms-test.example.com',
        scopes: [
          { value: 'test:perm', description: 'Test permission' },
        ],
      })

      const role = await management.roles.create({
        name: 'RemovePermsRole',
        description: 'Role to remove perms from',
      })

      await management.roles.addPermissions(
        { id: role.id },
        {
          permissions: [
            { permission_name: 'test:perm', resource_server_identifier: api.identifier },
          ],
        }
      )

      await management.roles.removePermissions(
        { id: role.id },
        {
          permissions: [
            { permission_name: 'test:perm', resource_server_identifier: api.identifier },
          ],
        }
      )

      const permissions = await management.roles.getPermissions({ id: role.id })

      expect(permissions.permissions.length).toBe(0)
    })

    it('should assign permissions directly to user', async () => {
      const api = await management.resourceServers.create({
        name: 'Direct Perms API',
        identifier: 'https://direct-perms.example.com',
        scopes: [
          { value: 'admin:access', description: 'Admin access' },
        ],
      })

      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'direct-perms@example.com',
        password: 'SecurePass123!',
      })

      await management.users.assignPermissions(
        { id: user.user_id },
        {
          permissions: [
            { permission_name: 'admin:access', resource_server_identifier: api.identifier },
          ],
        }
      )

      const userPerms = await management.users.getPermissions({ id: user.user_id })

      expect(userPerms.permissions.some((p) => p.permission_name === 'admin:access')).toBe(true)
    })

    it('should remove permissions from user', async () => {
      const api = await management.resourceServers.create({
        name: 'User Remove Perms API',
        identifier: 'https://user-remove-perms.example.com',
        scopes: [
          { value: 'temp:access', description: 'Temporary access' },
        ],
      })

      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'user-remove-perms@example.com',
        password: 'SecurePass123!',
      })

      await management.users.assignPermissions(
        { id: user.user_id },
        {
          permissions: [
            { permission_name: 'temp:access', resource_server_identifier: api.identifier },
          ],
        }
      )

      await management.users.removePermissions(
        { id: user.user_id },
        {
          permissions: [
            { permission_name: 'temp:access', resource_server_identifier: api.identifier },
          ],
        }
      )

      const userPerms = await management.users.getPermissions({ id: user.user_id })

      expect(userPerms.permissions.some((p) => p.permission_name === 'temp:access')).toBe(false)
    })

    it('should get effective permissions for user (roles + direct)', async () => {
      const api = await management.resourceServers.create({
        name: 'Effective Perms API',
        identifier: 'https://effective-perms.example.com',
        scopes: [
          { value: 'from:role', description: 'From role' },
          { value: 'from:direct', description: 'Direct assignment' },
        ],
      })

      const role = await management.roles.create({
        name: 'EffectivePermsRole',
        description: 'Role for effective perms test',
      })

      await management.roles.addPermissions(
        { id: role.id },
        {
          permissions: [
            { permission_name: 'from:role', resource_server_identifier: api.identifier },
          ],
        }
      )

      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'effective-perms@example.com',
        password: 'SecurePass123!',
      })

      await management.users.assignRoles(
        { id: user.user_id },
        { roles: [role.id] }
      )

      await management.users.assignPermissions(
        { id: user.user_id },
        {
          permissions: [
            { permission_name: 'from:direct', resource_server_identifier: api.identifier },
          ],
        }
      )

      // Get all permissions (should include both role-based and direct)
      const allPerms = await management.users.getPermissions({ id: user.user_id })

      expect(allPerms.permissions.length).toBe(2)
    })
  })
})

// ============================================================================
// ENHANCED TENANT SETTINGS TESTS
// ============================================================================

describe('Enhanced TenantSettings', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })
  })

  describe('basic tenant settings', () => {
    it('should get tenant settings', async () => {
      const settings = await management.tenants.getSettings()

      expect(settings).toBeDefined()
      expect(settings.friendly_name).toBeDefined()
    })

    it('should update tenant friendly name', async () => {
      const updated = await management.tenants.updateSettings({
        friendly_name: 'My Test Tenant',
      })

      expect(updated.friendly_name).toBe('My Test Tenant')
    })

    it('should update tenant logo', async () => {
      const updated = await management.tenants.updateSettings({
        picture_url: 'https://example.com/logo.png',
      })

      expect(updated.picture_url).toBe('https://example.com/logo.png')
    })

    it('should update support contact information', async () => {
      const updated = await management.tenants.updateSettings({
        support_email: 'support@example.com',
        support_url: 'https://support.example.com',
      })

      expect(updated.support_email).toBe('support@example.com')
      expect(updated.support_url).toBe('https://support.example.com')
    })
  })

  describe('session settings', () => {
    it('should update session lifetime', async () => {
      const updated = await management.tenants.updateSettings({
        session_lifetime: 168, // 1 week in hours
      })

      expect(updated.session_lifetime).toBe(168)
    })

    it('should update idle session lifetime', async () => {
      const updated = await management.tenants.updateSettings({
        idle_session_lifetime: 72, // 3 days in hours
      })

      expect(updated.idle_session_lifetime).toBe(72)
    })

    it('should configure session cookie settings', async () => {
      const updated = await management.tenants.updateSettings({
        session_cookie: {
          mode: 'persistent',
        },
      })

      expect(updated.session_cookie?.mode).toBe('persistent')
    })
  })

  describe('security settings', () => {
    it('should enable/disable clickjack protection', async () => {
      const updated = await management.tenants.updateSettings({
        flags: {
          disable_clickjack_protection_headers: true,
        },
      })

      expect(updated.flags?.disable_clickjack_protection_headers).toBe(true)
    })

    it('should configure public signup user exists error', async () => {
      const updated = await management.tenants.updateSettings({
        flags: {
          enable_public_signup_user_exists_error: false,
        },
      })

      expect(updated.flags?.enable_public_signup_user_exists_error).toBe(false)
    })

    it('should configure allowed logout URLs', async () => {
      const updated = await management.tenants.updateSettings({
        allowed_logout_urls: [
          'https://example.com/logout',
          'https://app.example.com/logout',
        ],
      })

      expect(updated.allowed_logout_urls).toContain('https://example.com/logout')
    })

    it('should configure default audience', async () => {
      const updated = await management.tenants.updateSettings({
        default_audience: 'https://api.example.com',
      })

      expect(updated.default_audience).toBe('https://api.example.com')
    })

    it('should configure default directory (connection)', async () => {
      const updated = await management.tenants.updateSettings({
        default_directory: 'Username-Password-Authentication',
      })

      expect(updated.default_directory).toBe('Username-Password-Authentication')
    })
  })

  describe('advanced tenant settings', () => {
    it('should configure sandbox version', async () => {
      const updated = await management.tenants.updateSettings({
        sandbox_version: '18',
      })

      expect(updated.sandbox_version).toBe('18')
    })

    it('should configure OIDC logout', async () => {
      const updated = await management.tenants.updateSettings({
        flags: {
          enable_sso: true,
        },
      })

      expect(updated.flags?.enable_sso).toBe(true)
    })

    it('should configure error page', async () => {
      const updated = await management.tenants.updateSettings({
        error_page: {
          html: '<html><body>Custom error page</body></html>',
          show_log_link: true,
          url: 'https://example.com/error',
        },
      })

      expect(updated.error_page?.show_log_link).toBe(true)
    })

    it('should configure device flow settings', async () => {
      const updated = await management.tenants.updateSettings({
        device_flow: {
          charset: 'base20',
          mask: '***-***',
        },
      })

      expect(updated.device_flow?.charset).toBe('base20')
    })

    it('should configure mtls settings', async () => {
      const updated = await management.tenants.updateSettings({
        mtls: {
          enable_endpoint_aliases: true,
        },
      })

      expect(updated.mtls?.enable_endpoint_aliases).toBe(true)
    })
  })

  describe('Universal Login settings', () => {
    it('should enable new Universal Login experience', async () => {
      const updated = await management.tenants.updateSettings({
        universal_login: {
          colors: {
            primary: '#FF5733',
            page_background: '#FFFFFF',
          },
        },
      })

      expect(updated.universal_login?.colors?.primary).toBe('#FF5733')
    })

    it('should configure passwordless settings', async () => {
      const updated = await management.tenants.updateSettings({
        flags: {
          enable_legacy_profile: false,
          enable_idtoken_api2: true,
        },
      })

      expect(updated.flags?.enable_idtoken_api2).toBe(true)
    })
  })
})
