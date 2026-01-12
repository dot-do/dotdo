/**
 * @dotdo/auth0 - Management API
 *
 * Auth0 Management API compatible implementation.
 * Provides user, connection, role, and client management.
 *
 * @module
 */

import { createTemporalStore, type TemporalStore } from '../../../db/primitives/temporal-store'
import { createUserManager, type UserManager } from '../shared/users'
import { createMFAManager, type MFAManager } from '../shared/mfa'
import type {
  Auth0User,
  Auth0Connection,
  Auth0Role,
  Auth0Permission,
  Auth0Client,
  Auth0ResourceServer,
  CreateUserParams,
  UpdateUserParams,
  CreateConnectionParams,
  CreateRoleParams,
  CreateClientParams,
  CreateResourceServerParams,
  PaginationParams,
  PaginatedResponse,
} from './types'
import { Auth0APIError } from './types'

// ============================================================================
// MANAGEMENT API OPTIONS
// ============================================================================

/**
 * Management API configuration
 */
export interface ManagementAPIOptions {
  /** Domain for the Auth0 tenant */
  domain: string
  /** Client ID for Management API */
  clientId?: string
  /** Client secret for Management API */
  clientSecret?: string
  /** Management API token */
  token?: string
}

// ============================================================================
// MANAGEMENT API
// ============================================================================

/**
 * Auth0 Management API client
 */
export class ManagementClient {
  private options: ManagementAPIOptions
  private userManager: UserManager
  private mfaManager: MFAManager
  private connectionStore: TemporalStore<Auth0Connection>
  private roleStore: TemporalStore<Auth0Role>
  private clientStore: TemporalStore<Auth0Client>
  private resourceServerStore: TemporalStore<Auth0ResourceServer>
  private permissionStore: TemporalStore<Auth0Permission[]>
  private userRoleStore: TemporalStore<string[]> // user_id -> role_ids
  private rolePermissionStore: TemporalStore<Auth0Permission[]> // role_id -> permissions

  constructor(options: ManagementAPIOptions) {
    this.options = options
    this.userManager = createUserManager()
    this.mfaManager = createMFAManager({ totpIssuer: options.domain })
    this.connectionStore = createTemporalStore<Auth0Connection>()
    this.roleStore = createTemporalStore<Auth0Role>()
    this.clientStore = createTemporalStore<Auth0Client>()
    this.resourceServerStore = createTemporalStore<Auth0ResourceServer>()
    this.permissionStore = createTemporalStore<Auth0Permission[]>()
    this.userRoleStore = createTemporalStore<string[]>()
    this.rolePermissionStore = createTemporalStore<Auth0Permission[]>()
  }

  // ============================================================================
  // USERS API
  // ============================================================================

  /**
   * users namespace
   */
  users = {
    /**
     * Create a new user
     */
    create: async (data: CreateUserParams): Promise<Auth0User> => {
      const user = await this.userManager.createUser({
        email: data.email,
        phone: data.phone_number,
        username: data.username,
        password: data.password,
        first_name: data.given_name,
        last_name: data.family_name,
        name: data.name,
        picture: data.picture,
        email_verified: data.email_verified,
        phone_verified: data.phone_verified,
        metadata: data.user_metadata,
        app_metadata: data.app_metadata,
      })

      return this.toAuth0User(user, data.connection)
    },

    /**
     * Get a user by ID
     */
    get: async (params: { id: string }): Promise<Auth0User> => {
      const user = await this.userManager.getUser(params.id)
      if (!user) {
        throw new Auth0APIError(404, 'Not Found', `User not found: ${params.id}`)
      }
      return this.toAuth0User(user)
    },

    /**
     * Update a user
     */
    update: async (params: { id: string }, data: UpdateUserParams): Promise<Auth0User> => {
      const user = await this.userManager.updateUser(params.id, {
        email: data.email,
        phone: data.phone_number,
        username: data.username,
        password: data.password,
        first_name: data.given_name,
        last_name: data.family_name,
        name: data.name,
        picture: data.picture,
        email_verified: data.email_verified,
        phone_verified: data.phone_verified,
        metadata: data.user_metadata,
        app_metadata: data.app_metadata,
      })

      return this.toAuth0User(user, data.connection)
    },

    /**
     * Delete a user
     */
    delete: async (params: { id: string }): Promise<void> => {
      await this.userManager.deleteUser(params.id)
    },

    /**
     * Get all users
     */
    getAll: async (params?: PaginationParams): Promise<Auth0User[] | PaginatedResponse<Auth0User>> => {
      // Simplified implementation - real implementation would use proper pagination
      // This returns an empty array as we'd need to iterate over all users
      if (params?.include_totals) {
        return {
          start: params.page ?? 0,
          limit: params.per_page ?? 50,
          length: 0,
          total: 0,
          users: [],
        }
      }
      return []
    },

    /**
     * Get users by email
     */
    getByEmail: async (email: string): Promise<Auth0User[]> => {
      const user = await this.userManager.getUserByEmail(email)
      if (!user) return []
      return [this.toAuth0User(user)]
    },

    /**
     * Get user roles
     */
    getRoles: async (params: { id: string }): Promise<Auth0Role[]> => {
      const roleIds = (await this.userRoleStore.get(`user_roles:${params.id}`)) ?? []
      const roles: Auth0Role[] = []

      for (const roleId of roleIds) {
        const role = await this.roleStore.get(`role:${roleId}`)
        if (role) roles.push(role)
      }

      return roles
    },

    /**
     * Assign roles to a user
     */
    assignRoles: async (params: { id: string }, data: { roles: string[] }): Promise<void> => {
      const existingRoles = (await this.userRoleStore.get(`user_roles:${params.id}`)) ?? []
      const newRoles = [...new Set([...existingRoles, ...data.roles])]
      await this.userRoleStore.put(`user_roles:${params.id}`, newRoles, Date.now())
    },

    /**
     * Remove roles from a user
     */
    removeRoles: async (params: { id: string }, data: { roles: string[] }): Promise<void> => {
      const existingRoles = (await this.userRoleStore.get(`user_roles:${params.id}`)) ?? []
      const newRoles = existingRoles.filter((r) => !data.roles.includes(r))
      await this.userRoleStore.put(`user_roles:${params.id}`, newRoles, Date.now())
    },

    /**
     * Get user permissions
     */
    getPermissions: async (params: { id: string }): Promise<Auth0Permission[]> => {
      const roles = await this.users.getRoles(params)
      const allPermissions: Auth0Permission[] = []

      for (const role of roles) {
        const permissions = (await this.rolePermissionStore.get(`role_permissions:${role.id}`)) ?? []
        allPermissions.push(...permissions)
      }

      // Deduplicate by permission_name + resource_server_identifier
      const seen = new Set<string>()
      return allPermissions.filter((p) => {
        const key = `${p.permission_name}:${p.resource_server_identifier}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    },

    /**
     * Get user's MFA enrollments
     */
    getEnrollments: async (params: { id: string }) => {
      const factors = await this.mfaManager.listFactors(params.id)
      return factors.map((f) => ({
        id: f.id,
        authenticator_type: f.type === 'totp' ? 'otp' : f.type,
        active: f.status === 'verified',
        name: f.friendly_name,
        phone_number: f.phone_number,
        email: f.email,
        created_at: f.created_at,
        enrolled_at: f.status === 'verified' ? f.updated_at : undefined,
        last_auth: f.last_used_at,
      }))
    },

    /**
     * Delete an MFA enrollment
     */
    deleteEnrollment: async (params: { id: string; enrollmentId: string }): Promise<void> => {
      await this.mfaManager.unenrollFactor(params.enrollmentId)
    },

    /**
     * Link a user identity
     */
    link: async (
      params: { id: string },
      data: { provider: string; user_id: string; connection_id?: string }
    ) => {
      await this.userManager.addIdentity(params.id, {
        id: `${data.provider}|${data.user_id}`,
        provider: data.provider,
        provider_id: data.user_id,
        connection: data.connection_id,
        is_social: true,
      })

      const user = await this.userManager.getUser(params.id)
      return user?.identities ?? []
    },

    /**
     * Unlink a user identity
     */
    unlink: async (params: { id: string; provider: string; user_id: string }) => {
      const identityId = `${params.provider}|${params.user_id}`
      await this.userManager.removeIdentity(params.id, identityId)

      const user = await this.userManager.getUser(params.id)
      return user?.identities ?? []
    },
  }

  // ============================================================================
  // CONNECTIONS API
  // ============================================================================

  /**
   * connections namespace
   */
  connections = {
    /**
     * Create a connection
     */
    create: async (data: CreateConnectionParams): Promise<Auth0Connection> => {
      const id = this.generateId('con')
      const connection: Auth0Connection = {
        id,
        name: data.name,
        strategy: data.strategy,
        options: data.options,
        enabled_clients: data.enabled_clients ?? [],
        realms: data.realms,
        is_domain_connection: data.is_domain_connection ?? false,
        metadata: data.metadata,
      }

      await this.connectionStore.put(`connection:${id}`, connection, Date.now())
      await this.addConnectionIndex(data.name, id)

      return connection
    },

    /**
     * Get a connection
     */
    get: async (params: { id: string }): Promise<Auth0Connection> => {
      const connection = await this.connectionStore.get(`connection:${params.id}`)
      if (!connection) {
        throw new Auth0APIError(404, 'Not Found', `Connection not found: ${params.id}`)
      }
      return connection
    },

    /**
     * Get a connection by name
     */
    getByName: async (name: string): Promise<Auth0Connection | null> => {
      const id = await this.getConnectionIdByName(name)
      if (!id) return null
      return this.connectionStore.get(`connection:${id}`)
    },

    /**
     * Update a connection
     */
    update: async (
      params: { id: string },
      data: Partial<CreateConnectionParams>
    ): Promise<Auth0Connection> => {
      const existing = await this.connections.get(params)

      const updated: Auth0Connection = {
        ...existing,
        ...data,
        id: existing.id,
      }

      await this.connectionStore.put(`connection:${params.id}`, updated, Date.now())

      return updated
    },

    /**
     * Delete a connection
     */
    delete: async (params: { id: string }): Promise<void> => {
      const connection = await this.connectionStore.get(`connection:${params.id}`)
      if (connection) {
        await this.removeConnectionIndex(connection.name)
      }
      await this.connectionStore.put(`connection:${params.id}`, null as unknown as Auth0Connection, Date.now())
    },

    /**
     * Get all connections
     */
    getAll: async (params?: { strategy?: string; name?: string }): Promise<Auth0Connection[]> => {
      // Simplified - would need proper listing
      return []
    },
  }

  // ============================================================================
  // ROLES API
  // ============================================================================

  /**
   * roles namespace
   */
  roles = {
    /**
     * Create a role
     */
    create: async (data: CreateRoleParams): Promise<Auth0Role> => {
      const id = this.generateId('rol')
      const role: Auth0Role = {
        id,
        name: data.name,
        description: data.description,
      }

      await this.roleStore.put(`role:${id}`, role, Date.now())
      await this.addRoleIndex(data.name, id)

      return role
    },

    /**
     * Get a role
     */
    get: async (params: { id: string }): Promise<Auth0Role> => {
      const role = await this.roleStore.get(`role:${params.id}`)
      if (!role) {
        throw new Auth0APIError(404, 'Not Found', `Role not found: ${params.id}`)
      }
      return role
    },

    /**
     * Update a role
     */
    update: async (params: { id: string }, data: Partial<CreateRoleParams>): Promise<Auth0Role> => {
      const existing = await this.roles.get(params)

      const updated: Auth0Role = {
        ...existing,
        ...data,
        id: existing.id,
      }

      await this.roleStore.put(`role:${params.id}`, updated, Date.now())

      return updated
    },

    /**
     * Delete a role
     */
    delete: async (params: { id: string }): Promise<void> => {
      const role = await this.roleStore.get(`role:${params.id}`)
      if (role) {
        await this.removeRoleIndex(role.name)
      }
      await this.roleStore.put(`role:${params.id}`, null as unknown as Auth0Role, Date.now())
    },

    /**
     * Get all roles
     */
    getAll: async (params?: PaginationParams): Promise<Auth0Role[] | PaginatedResponse<Auth0Role>> => {
      if (params?.include_totals) {
        return {
          start: params.page ?? 0,
          limit: params.per_page ?? 50,
          length: 0,
          total: 0,
          roles: [],
        }
      }
      return []
    },

    /**
     * Get role permissions
     */
    getPermissions: async (params: { id: string }): Promise<Auth0Permission[]> => {
      return (await this.rolePermissionStore.get(`role_permissions:${params.id}`)) ?? []
    },

    /**
     * Add permissions to a role
     */
    addPermissions: async (params: { id: string }, data: { permissions: Auth0Permission[] }): Promise<void> => {
      const existing = (await this.rolePermissionStore.get(`role_permissions:${params.id}`)) ?? []
      const newPermissions = [...existing, ...data.permissions]

      // Deduplicate
      const seen = new Set<string>()
      const deduplicated = newPermissions.filter((p) => {
        const key = `${p.permission_name}:${p.resource_server_identifier}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      await this.rolePermissionStore.put(`role_permissions:${params.id}`, deduplicated, Date.now())
    },

    /**
     * Remove permissions from a role
     */
    removePermissions: async (params: { id: string }, data: { permissions: Auth0Permission[] }): Promise<void> => {
      const existing = (await this.rolePermissionStore.get(`role_permissions:${params.id}`)) ?? []
      const toRemove = new Set(data.permissions.map((p) => `${p.permission_name}:${p.resource_server_identifier}`))

      const filtered = existing.filter((p) => !toRemove.has(`${p.permission_name}:${p.resource_server_identifier}`))

      await this.rolePermissionStore.put(`role_permissions:${params.id}`, filtered, Date.now())
    },

    /**
     * Get users assigned to a role
     */
    getUsers: async (params: { id: string }): Promise<Auth0User[]> => {
      // Would need a reverse index - simplified for now
      return []
    },
  }

  // ============================================================================
  // CLIENTS API
  // ============================================================================

  /**
   * clients namespace
   */
  clients = {
    /**
     * Create a client
     */
    create: async (data: CreateClientParams): Promise<Auth0Client> => {
      const clientId = this.generateId('client')
      const clientSecret = this.generateSecret()

      const client: Auth0Client = {
        client_id: clientId,
        client_secret: clientSecret,
        name: data.name,
        description: data.description,
        logo_uri: data.logo_uri,
        callbacks: data.callbacks ?? [],
        allowed_origins: data.allowed_origins ?? [],
        web_origins: data.web_origins ?? [],
        allowed_logout_urls: data.allowed_logout_urls ?? [],
        grant_types: data.grant_types ?? ['authorization_code', 'refresh_token'],
        jwt_configuration: data.jwt_configuration,
        token_endpoint_auth_method: data.token_endpoint_auth_method ?? 'client_secret_basic',
        app_type: data.app_type ?? 'regular_web',
        is_first_party: data.is_first_party ?? true,
        oidc_conformant: data.oidc_conformant ?? true,
      }

      await this.clientStore.put(`client:${clientId}`, client, Date.now())

      return client
    },

    /**
     * Get a client
     */
    get: async (params: { client_id: string }): Promise<Auth0Client> => {
      const client = await this.clientStore.get(`client:${params.client_id}`)
      if (!client) {
        throw new Auth0APIError(404, 'Not Found', `Client not found: ${params.client_id}`)
      }
      return client
    },

    /**
     * Update a client
     */
    update: async (
      params: { client_id: string },
      data: Partial<CreateClientParams>
    ): Promise<Auth0Client> => {
      const existing = await this.clients.get(params)

      const updated: Auth0Client = {
        ...existing,
        ...data,
        client_id: existing.client_id,
        client_secret: existing.client_secret,
      }

      await this.clientStore.put(`client:${params.client_id}`, updated, Date.now())

      return updated
    },

    /**
     * Delete a client
     */
    delete: async (params: { client_id: string }): Promise<void> => {
      await this.clientStore.put(`client:${params.client_id}`, null as unknown as Auth0Client, Date.now())
    },

    /**
     * Get all clients
     */
    getAll: async (params?: PaginationParams): Promise<Auth0Client[] | PaginatedResponse<Auth0Client>> => {
      if (params?.include_totals) {
        return {
          start: params.page ?? 0,
          limit: params.per_page ?? 50,
          length: 0,
          total: 0,
          clients: [],
        }
      }
      return []
    },

    /**
     * Rotate client secret
     */
    rotateSecret: async (params: { client_id: string }): Promise<Auth0Client> => {
      const client = await this.clients.get(params)
      client.client_secret = this.generateSecret()
      await this.clientStore.put(`client:${params.client_id}`, client, Date.now())
      return client
    },
  }

  // ============================================================================
  // RESOURCE SERVERS API
  // ============================================================================

  /**
   * resourceServers namespace
   */
  resourceServers = {
    /**
     * Create a resource server
     */
    create: async (data: CreateResourceServerParams): Promise<Auth0ResourceServer> => {
      const id = this.generateId('rs')

      const resourceServer: Auth0ResourceServer = {
        id,
        name: data.name,
        identifier: data.identifier,
        scopes: data.scopes ?? [],
        signing_alg: data.signing_alg ?? 'RS256',
        signing_secret: data.signing_secret,
        token_lifetime: data.token_lifetime ?? 86400,
        token_lifetime_for_web: data.token_lifetime_for_web ?? 7200,
        skip_consent_for_verifiable_first_party_clients:
          data.skip_consent_for_verifiable_first_party_clients ?? true,
        enforce_policies: data.enforce_policies ?? false,
        token_dialect: data.token_dialect ?? 'access_token',
      }

      await this.resourceServerStore.put(`rs:${id}`, resourceServer, Date.now())
      await this.addResourceServerIndex(data.identifier, id)

      return resourceServer
    },

    /**
     * Get a resource server
     */
    get: async (params: { id: string }): Promise<Auth0ResourceServer> => {
      const rs = await this.resourceServerStore.get(`rs:${params.id}`)
      if (!rs) {
        throw new Auth0APIError(404, 'Not Found', `Resource server not found: ${params.id}`)
      }
      return rs
    },

    /**
     * Update a resource server
     */
    update: async (
      params: { id: string },
      data: Partial<CreateResourceServerParams>
    ): Promise<Auth0ResourceServer> => {
      const existing = await this.resourceServers.get(params)

      const updated: Auth0ResourceServer = {
        ...existing,
        ...data,
        id: existing.id,
        identifier: existing.identifier, // Can't change identifier
      }

      await this.resourceServerStore.put(`rs:${params.id}`, updated, Date.now())

      return updated
    },

    /**
     * Delete a resource server
     */
    delete: async (params: { id: string }): Promise<void> => {
      const rs = await this.resourceServerStore.get(`rs:${params.id}`)
      if (rs) {
        await this.removeResourceServerIndex(rs.identifier)
      }
      await this.resourceServerStore.put(`rs:${params.id}`, null as unknown as Auth0ResourceServer, Date.now())
    },

    /**
     * Get all resource servers
     */
    getAll: async (): Promise<Auth0ResourceServer[]> => {
      return []
    },
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Convert internal user to Auth0 user format
   */
  private toAuth0User(
    user: { id: string; email?: string; email_verified?: boolean; phone?: string; phone_verified?: boolean; username?: string; name?: string; first_name?: string; last_name?: string; picture?: string; created_at: string; updated_at: string; last_sign_in_at?: string; metadata: Record<string, unknown>; app_metadata: Record<string, unknown>; identities?: Array<{ provider: string; provider_id: string; connection?: string; is_social: boolean; access_token?: string; refresh_token?: string }> },
    connection?: string
  ): Auth0User {
    return {
      user_id: user.id,
      email: user.email,
      email_verified: user.email_verified,
      phone_number: user.phone,
      phone_verified: user.phone_verified,
      username: user.username,
      name: user.name,
      given_name: user.first_name,
      family_name: user.last_name,
      picture: user.picture,
      created_at: user.created_at,
      updated_at: user.updated_at,
      last_login: user.last_sign_in_at,
      user_metadata: user.metadata,
      app_metadata: user.app_metadata,
      identities: user.identities?.map((i) => ({
        connection: i.connection ?? connection ?? 'Username-Password-Authentication',
        user_id: i.provider_id,
        provider: i.provider,
        isSocial: i.is_social,
        access_token: i.access_token,
        refresh_token: i.refresh_token,
      })),
    }
  }

  /**
   * Generate a unique ID
   */
  private generateId(prefix: string): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `${prefix}_${hex}`
  }

  /**
   * Generate a client secret
   */
  private generateSecret(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  // Index management helpers (simplified - would use proper indexes in production)
  private async addConnectionIndex(name: string, id: string): Promise<void> {
    await this.connectionStore.put(`connection_name:${name}`, { id } as unknown as Auth0Connection, Date.now())
  }

  private async removeConnectionIndex(name: string): Promise<void> {
    await this.connectionStore.put(`connection_name:${name}`, null as unknown as Auth0Connection, Date.now())
  }

  private async getConnectionIdByName(name: string): Promise<string | null> {
    const data = await this.connectionStore.get(`connection_name:${name}`)
    return (data as unknown as { id: string } | null)?.id ?? null
  }

  private async addRoleIndex(name: string, id: string): Promise<void> {
    await this.roleStore.put(`role_name:${name}`, { id } as unknown as Auth0Role, Date.now())
  }

  private async removeRoleIndex(name: string): Promise<void> {
    await this.roleStore.put(`role_name:${name}`, null as unknown as Auth0Role, Date.now())
  }

  private async addResourceServerIndex(identifier: string, id: string): Promise<void> {
    await this.resourceServerStore.put(`rs_identifier:${identifier}`, { id } as unknown as Auth0ResourceServer, Date.now())
  }

  private async removeResourceServerIndex(identifier: string): Promise<void> {
    await this.resourceServerStore.put(`rs_identifier:${identifier}`, null as unknown as Auth0ResourceServer, Date.now())
  }
}

/**
 * Create a Management API client
 */
export function createManagementClient(options: ManagementAPIOptions): ManagementClient {
  return new ManagementClient(options)
}
