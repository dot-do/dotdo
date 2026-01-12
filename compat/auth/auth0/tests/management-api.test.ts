/**
 * Auth0 Management API Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ManagementClient, createManagementClient, Auth0APIError } from '../index'

describe('Auth0 Management API', () => {
  let client: ManagementClient

  beforeEach(() => {
    client = createManagementClient({
      domain: 'test.auth0.com',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      audience: 'https://test.auth0.com/api/v2/',
    })
  })

  describe('users', () => {
    it('should create a user', async () => {
      const user = await client.users.create({
        email: 'test@example.com',
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })

      expect(user).toBeDefined()
      expect(user.user_id).toBeDefined()
      expect(user.email).toBe('test@example.com')
    })

    it('should create a user with metadata', async () => {
      const user = await client.users.create({
        email: 'meta@example.com',
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
        user_metadata: { theme: 'dark', language: 'en' },
        app_metadata: { role: 'admin', tier: 'premium' },
      })

      expect(user.user_metadata).toEqual({ theme: 'dark', language: 'en' })
      expect(user.app_metadata).toEqual({ role: 'admin', tier: 'premium' })
    })

    it('should get a user by ID', async () => {
      const created = await client.users.create({
        email: 'get@example.com',
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })

      const user = await client.users.get({ id: created.user_id })

      expect(user.user_id).toBe(created.user_id)
      expect(user.email).toBe('get@example.com')
    })

    it('should throw 404 for non-existent user', async () => {
      await expect(client.users.get({ id: 'auth0|nonexistent' })).rejects.toThrow(Auth0APIError)
    })

    it('should update a user', async () => {
      const created = await client.users.create({
        email: 'update@example.com',
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })

      const updated = await client.users.update(
        { id: created.user_id },
        {
          name: 'Updated Name',
          user_metadata: { updated: true },
        }
      )

      expect(updated.name).toBe('Updated Name')
      expect(updated.user_metadata).toEqual({ updated: true })
    })

    it('should delete a user', async () => {
      const created = await client.users.create({
        email: 'delete@example.com',
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })

      await client.users.delete({ id: created.user_id })

      await expect(client.users.get({ id: created.user_id })).rejects.toThrow(Auth0APIError)
    })

    it('should get users by email', async () => {
      await client.users.create({
        email: 'search@example.com',
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })

      const users = await client.users.getByEmail('search@example.com')

      expect(users).toHaveLength(1)
      expect(users[0].email).toBe('search@example.com')
    })

    it('should update user with app_metadata', async () => {
      const created = await client.users.create({
        email: 'block@example.com',
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })

      // Update app_metadata
      const updated = await client.users.update(
        { id: created.user_id },
        { app_metadata: { blocked: true, role: 'admin' } }
      )

      expect(updated.app_metadata).toEqual({ blocked: true, role: 'admin' })
    })
  })

  describe('roles', () => {
    it('should create a role', async () => {
      const role = await client.roles.create({
        name: 'test-role',
        description: 'Test role description',
      })

      expect(role).toBeDefined()
      expect(role.id).toBeDefined()
      expect(role.name).toBe('test-role')
      expect(role.description).toBe('Test role description')
    })

    it('should get a role by ID', async () => {
      const created = await client.roles.create({
        name: 'get-role',
        description: 'Role to get',
      })

      const role = await client.roles.get({ id: created.id })

      expect(role.id).toBe(created.id)
      expect(role.name).toBe('get-role')
    })

    it('should update a role', async () => {
      const created = await client.roles.create({
        name: 'update-role',
        description: 'Original description',
      })

      const updated = await client.roles.update(
        { id: created.id },
        { description: 'Updated description' }
      )

      expect(updated.description).toBe('Updated description')
    })

    it('should delete a role', async () => {
      const created = await client.roles.create({
        name: 'delete-role',
        description: 'Role to delete',
      })

      await client.roles.delete({ id: created.id })

      await expect(client.roles.get({ id: created.id })).rejects.toThrow(Auth0APIError)
    })

    it('should add permissions to a role', async () => {
      const role = await client.roles.create({
        name: 'perm-role',
        description: 'Role with permissions',
      })

      await client.roles.addPermissions(
        { id: role.id },
        {
          permissions: [
            { permission_name: 'read:users', resource_server_identifier: 'https://api.example.com' },
            { permission_name: 'write:users', resource_server_identifier: 'https://api.example.com' },
          ],
        }
      )

      const permissions = await client.roles.getPermissions({ id: role.id })

      expect(permissions).toHaveLength(2)
      expect(permissions.map((p) => p.permission_name)).toContain('read:users')
      expect(permissions.map((p) => p.permission_name)).toContain('write:users')
    })

    it('should remove permissions from a role', async () => {
      const role = await client.roles.create({
        name: 'remove-perm-role',
        description: 'Role to remove permissions from',
      })

      await client.roles.addPermissions(
        { id: role.id },
        {
          permissions: [
            { permission_name: 'read:users', resource_server_identifier: 'https://api.example.com' },
            { permission_name: 'write:users', resource_server_identifier: 'https://api.example.com' },
          ],
        }
      )

      await client.roles.removePermissions(
        { id: role.id },
        {
          permissions: [
            { permission_name: 'write:users', resource_server_identifier: 'https://api.example.com' },
          ],
        }
      )

      const permissions = await client.roles.getPermissions({ id: role.id })

      expect(permissions).toHaveLength(1)
      expect(permissions[0].permission_name).toBe('read:users')
    })
  })

  describe('user roles', () => {
    it('should assign roles to a user', async () => {
      const user = await client.users.create({
        email: 'roles@example.com',
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })

      const role = await client.roles.create({
        name: 'user-role',
        description: 'Role for user',
      })

      await client.users.assignRoles({ id: user.user_id }, { roles: [role.id] })

      const userRoles = await client.users.getRoles({ id: user.user_id })

      expect(userRoles).toHaveLength(1)
      expect(userRoles[0].id).toBe(role.id)
    })

    it('should remove roles from a user', async () => {
      const user = await client.users.create({
        email: 'remove-roles@example.com',
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })

      const role = await client.roles.create({
        name: 'removable-role',
        description: 'Role to remove',
      })

      await client.users.assignRoles({ id: user.user_id }, { roles: [role.id] })
      await client.users.removeRoles({ id: user.user_id }, { roles: [role.id] })

      const userRoles = await client.users.getRoles({ id: user.user_id })

      expect(userRoles).toHaveLength(0)
    })

    it('should get user permissions', async () => {
      const user = await client.users.create({
        email: 'permissions@example.com',
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })

      const role = await client.roles.create({
        name: 'permission-role',
        description: 'Role with permissions',
      })

      await client.roles.addPermissions(
        { id: role.id },
        {
          permissions: [
            { permission_name: 'read:data', resource_server_identifier: 'https://api.example.com' },
          ],
        }
      )

      await client.users.assignRoles({ id: user.user_id }, { roles: [role.id] })

      const permissions = await client.users.getPermissions({ id: user.user_id })

      expect(permissions).toHaveLength(1)
      expect(permissions[0].permission_name).toBe('read:data')
    })
  })

  describe('connections', () => {
    it('should create a connection', async () => {
      const connection = await client.connections.create({
        name: 'test-connection',
        strategy: 'auth0',
      })

      expect(connection).toBeDefined()
      expect(connection.id).toBeDefined()
      expect(connection.name).toBe('test-connection')
      expect(connection.strategy).toBe('auth0')
    })

    it('should get a connection by ID', async () => {
      const created = await client.connections.create({
        name: 'get-connection',
        strategy: 'auth0',
      })

      const connection = await client.connections.get({ id: created.id })

      expect(connection.id).toBe(created.id)
      expect(connection.name).toBe('get-connection')
    })

    it('should update a connection', async () => {
      const created = await client.connections.create({
        name: 'update-connection',
        strategy: 'auth0',
        options: { brute_force_protection: false },
      })

      const updated = await client.connections.update(
        { id: created.id },
        { options: { brute_force_protection: true } }
      )

      expect(updated.options?.brute_force_protection).toBe(true)
    })

    it('should delete a connection', async () => {
      const created = await client.connections.create({
        name: 'delete-connection',
        strategy: 'auth0',
      })

      await client.connections.delete({ id: created.id })

      await expect(client.connections.get({ id: created.id })).rejects.toThrow(Auth0APIError)
    })
  })

  describe('clients', () => {
    it('should create a client', async () => {
      const auth0Client = await client.clients.create({
        name: 'Test Application',
        app_type: 'spa',
      })

      expect(auth0Client).toBeDefined()
      expect(auth0Client.client_id).toBeDefined()
      expect(auth0Client.name).toBe('Test Application')
      expect(auth0Client.app_type).toBe('spa')
    })

    it('should get a client by ID', async () => {
      const created = await client.clients.create({
        name: 'Get Application',
        app_type: 'regular_web',
      })

      const auth0Client = await client.clients.get({ client_id: created.client_id })

      expect(auth0Client.client_id).toBe(created.client_id)
      expect(auth0Client.name).toBe('Get Application')
    })

    it('should update a client', async () => {
      const created = await client.clients.create({
        name: 'Update Application',
        app_type: 'spa',
      })

      const updated = await client.clients.update(
        { client_id: created.client_id },
        {
          name: 'Updated Application',
          callbacks: ['https://app.example.com/callback'],
        }
      )

      expect(updated.name).toBe('Updated Application')
      expect(updated.callbacks).toContain('https://app.example.com/callback')
    })

    it('should delete a client', async () => {
      const created = await client.clients.create({
        name: 'Delete Application',
        app_type: 'native',
      })

      await client.clients.delete({ client_id: created.client_id })

      await expect(client.clients.get({ client_id: created.client_id })).rejects.toThrow(Auth0APIError)
    })

    it('should rotate client secret', async () => {
      const created = await client.clients.create({
        name: 'Rotate Secret App',
        app_type: 'regular_web',
      })

      const originalSecret = created.client_secret

      const rotated = await client.clients.rotateSecret({ client_id: created.client_id })

      expect(rotated.client_secret).toBeDefined()
      expect(rotated.client_secret).not.toBe(originalSecret)
    })
  })

  describe('resource servers', () => {
    it('should create a resource server', async () => {
      const resourceServer = await client.resourceServers.create({
        name: 'Test API',
        identifier: 'https://api.example.com',
      })

      expect(resourceServer).toBeDefined()
      expect(resourceServer.id).toBeDefined()
      expect(resourceServer.name).toBe('Test API')
      expect(resourceServer.identifier).toBe('https://api.example.com')
    })

    it('should get a resource server by ID', async () => {
      const created = await client.resourceServers.create({
        name: 'Get API',
        identifier: 'https://get-api.example.com',
      })

      const resourceServer = await client.resourceServers.get({ id: created.id })

      expect(resourceServer.id).toBe(created.id)
      expect(resourceServer.name).toBe('Get API')
    })

    it('should update a resource server', async () => {
      const created = await client.resourceServers.create({
        name: 'Update API',
        identifier: 'https://update-api.example.com',
      })

      const updated = await client.resourceServers.update(
        { id: created.id },
        {
          name: 'Updated API',
          scopes: [
            { value: 'read:data', description: 'Read data' },
            { value: 'write:data', description: 'Write data' },
          ],
        }
      )

      expect(updated.name).toBe('Updated API')
      expect(updated.scopes).toHaveLength(2)
    })

    it('should delete a resource server', async () => {
      const created = await client.resourceServers.create({
        name: 'Delete API',
        identifier: 'https://delete-api.example.com',
      })

      await client.resourceServers.delete({ id: created.id })

      await expect(client.resourceServers.get({ id: created.id })).rejects.toThrow(Auth0APIError)
    })
  })
})
