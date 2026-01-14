/**
 * @dotdo/auth0 - Custom Database Connections
 *
 * Auth0 Custom Database Connection support for connecting external user stores.
 * Custom database connections allow you to use your own database for user authentication
 * while still leveraging Auth0's features like Actions and Rules.
 *
 * @example Basic Usage
 * ```typescript
 * import { ConnectionsManager, CustomDatabaseScripts } from '@dotdo/auth0'
 *
 * const connections = new ConnectionsManager()
 *
 * // Create a custom database connection
 * const conn = connections.create({
 *   name: 'my-users-db',
 *   strategy: 'auth0',
 *   is_domain_connection: false,
 *   options: {
 *     customScripts: {
 *       login: async (email, password, context) => {
 *         const user = await myDb.findByEmail(email)
 *         if (!user || !await verifyPassword(password, user.passwordHash)) {
 *           throw new Error('Invalid credentials')
 *         }
 *         return { user_id: user.id, email: user.email }
 *       },
 *       getUser: async (email, context) => {
 *         const user = await myDb.findByEmail(email)
 *         return user ? { user_id: user.id, email: user.email } : null
 *       },
 *       create: async (user, context) => {
 *         return await myDb.create(user)
 *       },
 *     },
 *     import_mode: true,
 *     requires_username: false,
 *   },
 * })
 * ```
 *
 * @see https://auth0.com/docs/authenticate/database-connections/custom-db
 * @module
 */

import { Auth0ManagementError } from './types'

// ============================================================================
// CUSTOM DATABASE SCRIPT TYPES
// ============================================================================

/**
 * Context passed to custom database scripts
 */
export interface CustomDatabaseContext {
  /** Auth0 tenant domain */
  domain: string
  /** Client ID that initiated the request */
  clientId?: string
  /** Connection name */
  connection: string
  /** Request IP address */
  ip?: string
  /** Request user agent */
  userAgent?: string
  /** Additional configuration values */
  configuration: Record<string, string>
}

/**
 * User object returned from custom database scripts
 */
export interface CustomDatabaseUser {
  /** Unique user identifier from your database */
  user_id: string
  /** User's email address */
  email?: string
  /** Whether the email is verified */
  email_verified?: boolean
  /** User's phone number */
  phone_number?: string
  /** Whether the phone is verified */
  phone_verified?: boolean
  /** Username */
  username?: string
  /** User's given name */
  given_name?: string
  /** User's family name */
  family_name?: string
  /** User's full name */
  name?: string
  /** User's nickname */
  nickname?: string
  /** URL to user's picture */
  picture?: string
  /** User metadata */
  user_metadata?: Record<string, unknown>
  /** Application metadata */
  app_metadata?: Record<string, unknown>
}

/**
 * Login script function signature
 * Called when a user attempts to log in
 */
export type LoginScript = (
  email: string,
  password: string,
  context: CustomDatabaseContext
) => Promise<CustomDatabaseUser>

/**
 * Get user script function signature
 * Called to retrieve a user by email (used during password reset, account linking)
 */
export type GetUserScript = (
  email: string,
  context: CustomDatabaseContext
) => Promise<CustomDatabaseUser | null>

/**
 * Create user script function signature
 * Called when a new user signs up
 */
export type CreateScript = (
  user: {
    email?: string
    password?: string
    username?: string
    phone_number?: string
    user_metadata?: Record<string, unknown>
  },
  context: CustomDatabaseContext
) => Promise<CustomDatabaseUser>

/**
 * Delete user script function signature
 * Called when a user is deleted from Auth0
 */
export type DeleteScript = (
  userId: string,
  context: CustomDatabaseContext
) => Promise<void>

/**
 * Verify user script function signature
 * Called when a user's email is verified
 */
export type VerifyScript = (
  email: string,
  context: CustomDatabaseContext
) => Promise<void>

/**
 * Change password script function signature
 * Called when a user changes their password
 */
export type ChangePasswordScript = (
  email: string,
  newPassword: string,
  context: CustomDatabaseContext
) => Promise<void>

/**
 * Custom database scripts configuration
 */
export interface CustomDatabaseScripts {
  /** Login script - authenticates users */
  login?: LoginScript
  /** Get user script - retrieves user by email */
  getUser?: GetUserScript
  /** Create script - creates new users */
  create?: CreateScript
  /** Delete script - deletes users */
  delete?: DeleteScript
  /** Verify script - marks email as verified */
  verify?: VerifyScript
  /** Change password script - updates user password */
  changePassword?: ChangePasswordScript
}

// ============================================================================
// CONNECTION TYPES
// ============================================================================

/**
 * Connection strategy types
 */
export type ConnectionStrategy =
  | 'auth0' // Database connection
  | 'google-oauth2'
  | 'facebook'
  | 'github'
  | 'twitter'
  | 'linkedin'
  | 'apple'
  | 'microsoft'
  | 'samlp'
  | 'oidc'
  | 'sms'
  | 'email'
  | 'custom'

/**
 * Password policy options
 */
export interface PasswordPolicy {
  /** Minimum password length */
  minLength?: number
  /** Require lowercase characters */
  requireLowercase?: boolean
  /** Require uppercase characters */
  requireUppercase?: boolean
  /** Require numbers */
  requireNumbers?: boolean
  /** Require special characters */
  requireSpecialCharacters?: boolean
  /** Password history (prevent reuse of N previous passwords) */
  passwordHistory?: number
  /** Maximum attempts before lockout */
  maxAttempts?: number
  /** Lockout duration in seconds */
  lockoutDuration?: number
}

/**
 * Connection options
 */
export interface ConnectionOptions {
  /** Custom database scripts (for auth0 strategy) */
  customScripts?: CustomDatabaseScripts
  /** Import mode - when true, users are migrated lazily on first login */
  import_mode?: boolean
  /** Whether the connection requires a username */
  requires_username?: boolean
  /** Password policy configuration */
  passwordPolicy?: PasswordPolicy
  /** Allowed client IDs that can use this connection */
  enabledClients?: string[]
  /** Brute force protection */
  brute_force_protection?: boolean
  /** MFA required */
  mfa?: {
    active: boolean
    return_enroll_settings: boolean
  }
  /** Disable signup */
  disable_signup?: boolean
  /** Disable self-service signup */
  disable_self_service_change_password?: boolean
  /** Configuration values available to scripts */
  configuration?: Record<string, string>
  /** Upstream parameters for social/enterprise connections */
  upstream_params?: Record<string, unknown>
  /** Custom headers for HTTP-based connections */
  headers?: Record<string, string>
}

/**
 * Connection definition
 */
export interface Connection {
  /** Connection ID */
  id: string
  /** Connection name */
  name: string
  /** Connection strategy */
  strategy: ConnectionStrategy
  /** Display name */
  display_name?: string
  /** Whether this is a domain connection */
  is_domain_connection: boolean
  /** Connection options */
  options: ConnectionOptions
  /** Realms (for enterprise connections) */
  realms?: string[]
  /** Metadata */
  metadata?: Record<string, string>
  /** When created */
  created_at: string
  /** When updated */
  updated_at: string
  /** Provisioning ticket URL (for enterprise setup) */
  provisioning_ticket_url?: string
  /** Enabled clients (application IDs) */
  enabled_clients: string[]
}

/**
 * Parameters for creating a connection
 */
export interface CreateConnectionParams {
  /** Connection name */
  name: string
  /** Connection strategy */
  strategy: ConnectionStrategy
  /** Display name */
  display_name?: string
  /** Whether this is a domain connection */
  is_domain_connection?: boolean
  /** Connection options */
  options?: ConnectionOptions
  /** Realms */
  realms?: string[]
  /** Metadata */
  metadata?: Record<string, string>
  /** Enabled clients */
  enabled_clients?: string[]
}

/**
 * Parameters for updating a connection
 */
export interface UpdateConnectionParams {
  /** Display name */
  display_name?: string
  /** Connection options */
  options?: ConnectionOptions
  /** Realms */
  realms?: string[]
  /** Metadata */
  metadata?: Record<string, string>
  /** Enabled clients */
  enabled_clients?: string[]
  /** Whether this is a domain connection */
  is_domain_connection?: boolean
}

// ============================================================================
// CONNECTIONS MANAGER OPTIONS
// ============================================================================

/**
 * Options for ConnectionsManager
 */
export interface ConnectionsManagerOptions {
  /** Auth0 domain */
  domain: string
  /** Default password policy */
  defaultPasswordPolicy?: PasswordPolicy
  /** Execution timeout for custom scripts (ms) */
  scriptTimeout?: number
}

// ============================================================================
// CONNECTIONS MANAGER
// ============================================================================

/**
 * Auth0 Connections Manager
 *
 * Manages database and social connections including custom database scripts.
 */
export class ConnectionsManager {
  private domain: string
  private defaultPasswordPolicy: PasswordPolicy
  private scriptTimeout: number

  // Connection storage
  private connections = new Map<string, Connection>()
  private nameIndex = new Map<string, string>() // name -> id

  constructor(options: ConnectionsManagerOptions) {
    this.domain = options.domain
    this.defaultPasswordPolicy = options.defaultPasswordPolicy ?? {
      minLength: 8,
      requireLowercase: true,
      requireUppercase: true,
      requireNumbers: true,
      requireSpecialCharacters: false,
    }
    this.scriptTimeout = options.scriptTimeout ?? 20000

    // Create default database connection
    this.createDefaultConnection()
  }

  /**
   * Create the default Username-Password-Authentication connection
   */
  private createDefaultConnection(): void {
    const now = new Date().toISOString()
    const defaultConn: Connection = {
      id: this.generateId(),
      name: 'Username-Password-Authentication',
      strategy: 'auth0',
      is_domain_connection: false,
      options: {
        passwordPolicy: this.defaultPasswordPolicy,
        brute_force_protection: true,
        import_mode: false,
        requires_username: false,
      },
      enabled_clients: [],
      created_at: now,
      updated_at: now,
    }

    this.connections.set(defaultConn.id, defaultConn)
    this.nameIndex.set(defaultConn.name, defaultConn.id)
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new connection
   */
  create(params: CreateConnectionParams): Connection {
    if (!params.name) {
      throw new Auth0ManagementError('Connection name is required', 400, 'invalid_body')
    }
    if (!params.strategy) {
      throw new Auth0ManagementError('Connection strategy is required', 400, 'invalid_body')
    }

    // Check for duplicate name
    if (this.nameIndex.has(params.name)) {
      throw new Auth0ManagementError(
        'A connection with this name already exists',
        409,
        'connection_conflict'
      )
    }

    const now = new Date().toISOString()
    const id = this.generateId()

    const connection: Connection = {
      id,
      name: params.name,
      strategy: params.strategy,
      display_name: params.display_name,
      is_domain_connection: params.is_domain_connection ?? false,
      options: {
        ...params.options,
        passwordPolicy: params.options?.passwordPolicy ?? this.defaultPasswordPolicy,
      },
      realms: params.realms,
      metadata: params.metadata,
      enabled_clients: params.enabled_clients ?? [],
      created_at: now,
      updated_at: now,
    }

    this.connections.set(id, connection)
    this.nameIndex.set(params.name, id)

    return connection
  }

  /**
   * Get a connection by ID
   */
  get(id: string): Connection | null {
    return this.connections.get(id) ?? null
  }

  /**
   * Get a connection by name
   */
  getByName(name: string): Connection | null {
    const id = this.nameIndex.get(name)
    if (!id) return null
    return this.connections.get(id) ?? null
  }

  /**
   * Get all connections
   */
  getAll(params?: {
    strategy?: ConnectionStrategy
    name?: string
    include_totals?: boolean
    page?: number
    per_page?: number
  }): { connections: Connection[]; total?: number } {
    let connections = Array.from(this.connections.values())

    // Filter by strategy
    if (params?.strategy) {
      connections = connections.filter((c) => c.strategy === params.strategy)
    }

    // Filter by name (partial match)
    if (params?.name) {
      const nameLower = params.name.toLowerCase()
      connections = connections.filter((c) =>
        c.name.toLowerCase().includes(nameLower)
      )
    }

    const total = connections.length

    // Paginate
    if (params?.page !== undefined || params?.per_page !== undefined) {
      const page = params.page ?? 0
      const perPage = Math.min(params.per_page ?? 50, 100)
      const start = page * perPage
      connections = connections.slice(start, start + perPage)
    }

    return {
      connections,
      ...(params?.include_totals ? { total } : {}),
    }
  }

  /**
   * Update a connection
   */
  update(id: string, params: UpdateConnectionParams): Connection {
    const connection = this.connections.get(id)
    if (!connection) {
      throw new Auth0ManagementError('Connection not found', 404, 'inexistent_connection')
    }

    const now = new Date().toISOString()

    const updatedConnection: Connection = {
      ...connection,
      display_name: params.display_name ?? connection.display_name,
      is_domain_connection: params.is_domain_connection ?? connection.is_domain_connection,
      options: params.options
        ? { ...connection.options, ...params.options }
        : connection.options,
      realms: params.realms ?? connection.realms,
      metadata: params.metadata
        ? { ...connection.metadata, ...params.metadata }
        : connection.metadata,
      enabled_clients: params.enabled_clients ?? connection.enabled_clients,
      updated_at: now,
    }

    this.connections.set(id, updatedConnection)
    return updatedConnection
  }

  /**
   * Delete a connection
   */
  delete(id: string): void {
    const connection = this.connections.get(id)
    if (connection) {
      this.nameIndex.delete(connection.name)
    }
    this.connections.delete(id)
  }

  // ============================================================================
  // CUSTOM SCRIPT EXECUTION
  // ============================================================================

  /**
   * Execute the login script for a custom database connection
   */
  async executeLogin(
    connectionName: string,
    email: string,
    password: string,
    clientId?: string
  ): Promise<CustomDatabaseUser> {
    const connection = this.getByName(connectionName)
    if (!connection) {
      throw new Auth0ManagementError('Connection not found', 404, 'inexistent_connection')
    }

    const loginScript = connection.options.customScripts?.login
    if (!loginScript) {
      throw new Auth0ManagementError(
        'Login script not configured for this connection',
        400,
        'script_not_configured'
      )
    }

    const context: CustomDatabaseContext = {
      domain: this.domain,
      clientId,
      connection: connectionName,
      configuration: connection.options.configuration ?? {},
    }

    try {
      return await this.executeWithTimeout(
        () => loginScript(email, password, context),
        this.scriptTimeout
      )
    } catch (error) {
      throw new Auth0ManagementError(
        error instanceof Error ? error.message : 'Login failed',
        401,
        'invalid_credentials'
      )
    }
  }

  /**
   * Execute the getUser script for a custom database connection
   */
  async executeGetUser(
    connectionName: string,
    email: string,
    clientId?: string
  ): Promise<CustomDatabaseUser | null> {
    const connection = this.getByName(connectionName)
    if (!connection) {
      throw new Auth0ManagementError('Connection not found', 404, 'inexistent_connection')
    }

    const getUserScript = connection.options.customScripts?.getUser
    if (!getUserScript) {
      // No getUser script - return null (not an error)
      return null
    }

    const context: CustomDatabaseContext = {
      domain: this.domain,
      clientId,
      connection: connectionName,
      configuration: connection.options.configuration ?? {},
    }

    return await this.executeWithTimeout(
      () => getUserScript(email, context),
      this.scriptTimeout
    )
  }

  /**
   * Execute the create script for a custom database connection
   */
  async executeCreate(
    connectionName: string,
    user: {
      email?: string
      password?: string
      username?: string
      phone_number?: string
      user_metadata?: Record<string, unknown>
    },
    clientId?: string
  ): Promise<CustomDatabaseUser> {
    const connection = this.getByName(connectionName)
    if (!connection) {
      throw new Auth0ManagementError('Connection not found', 404, 'inexistent_connection')
    }

    const createScript = connection.options.customScripts?.create
    if (!createScript) {
      throw new Auth0ManagementError(
        'Create script not configured for this connection',
        400,
        'script_not_configured'
      )
    }

    // Validate password against policy
    if (user.password) {
      this.validatePassword(user.password, connection.options.passwordPolicy)
    }

    const context: CustomDatabaseContext = {
      domain: this.domain,
      clientId,
      connection: connectionName,
      configuration: connection.options.configuration ?? {},
    }

    return await this.executeWithTimeout(
      () => createScript(user, context),
      this.scriptTimeout
    )
  }

  /**
   * Execute the delete script for a custom database connection
   */
  async executeDelete(
    connectionName: string,
    userId: string,
    clientId?: string
  ): Promise<void> {
    const connection = this.getByName(connectionName)
    if (!connection) {
      throw new Auth0ManagementError('Connection not found', 404, 'inexistent_connection')
    }

    const deleteScript = connection.options.customScripts?.delete
    if (!deleteScript) {
      // No delete script - silently succeed
      return
    }

    const context: CustomDatabaseContext = {
      domain: this.domain,
      clientId,
      connection: connectionName,
      configuration: connection.options.configuration ?? {},
    }

    await this.executeWithTimeout(
      () => deleteScript(userId, context),
      this.scriptTimeout
    )
  }

  /**
   * Execute the verify script for a custom database connection
   */
  async executeVerify(
    connectionName: string,
    email: string,
    clientId?: string
  ): Promise<void> {
    const connection = this.getByName(connectionName)
    if (!connection) {
      throw new Auth0ManagementError('Connection not found', 404, 'inexistent_connection')
    }

    const verifyScript = connection.options.customScripts?.verify
    if (!verifyScript) {
      // No verify script - silently succeed
      return
    }

    const context: CustomDatabaseContext = {
      domain: this.domain,
      clientId,
      connection: connectionName,
      configuration: connection.options.configuration ?? {},
    }

    await this.executeWithTimeout(
      () => verifyScript(email, context),
      this.scriptTimeout
    )
  }

  /**
   * Execute the changePassword script for a custom database connection
   */
  async executeChangePassword(
    connectionName: string,
    email: string,
    newPassword: string,
    clientId?: string
  ): Promise<void> {
    const connection = this.getByName(connectionName)
    if (!connection) {
      throw new Auth0ManagementError('Connection not found', 404, 'inexistent_connection')
    }

    const changePasswordScript = connection.options.customScripts?.changePassword
    if (!changePasswordScript) {
      throw new Auth0ManagementError(
        'Change password script not configured for this connection',
        400,
        'script_not_configured'
      )
    }

    // Validate new password against policy
    this.validatePassword(newPassword, connection.options.passwordPolicy)

    const context: CustomDatabaseContext = {
      domain: this.domain,
      clientId,
      connection: connectionName,
      configuration: connection.options.configuration ?? {},
    }

    await this.executeWithTimeout(
      () => changePasswordScript(email, newPassword, context),
      this.scriptTimeout
    )
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Check if a connection has custom database scripts
   */
  hasCustomScripts(connectionName: string): boolean {
    const connection = this.getByName(connectionName)
    if (!connection) return false
    return !!connection.options.customScripts
  }

  /**
   * Check if import mode is enabled for a connection
   */
  isImportMode(connectionName: string): boolean {
    const connection = this.getByName(connectionName)
    if (!connection) return false
    return connection.options.import_mode === true
  }

  /**
   * Validate password against policy
   */
  validatePassword(password: string, policy?: PasswordPolicy): void {
    const effectivePolicy = policy ?? this.defaultPasswordPolicy

    if (effectivePolicy.minLength && password.length < effectivePolicy.minLength) {
      throw new Auth0ManagementError(
        `Password must be at least ${effectivePolicy.minLength} characters`,
        400,
        'password_too_weak'
      )
    }

    if (effectivePolicy.requireLowercase && !/[a-z]/.test(password)) {
      throw new Auth0ManagementError(
        'Password must contain at least one lowercase letter',
        400,
        'password_too_weak'
      )
    }

    if (effectivePolicy.requireUppercase && !/[A-Z]/.test(password)) {
      throw new Auth0ManagementError(
        'Password must contain at least one uppercase letter',
        400,
        'password_too_weak'
      )
    }

    if (effectivePolicy.requireNumbers && !/[0-9]/.test(password)) {
      throw new Auth0ManagementError(
        'Password must contain at least one number',
        400,
        'password_too_weak'
      )
    }

    if (effectivePolicy.requireSpecialCharacters && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      throw new Auth0ManagementError(
        'Password must contain at least one special character',
        400,
        'password_too_weak'
      )
    }
  }

  /**
   * Execute a function with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Auth0ManagementError('Script execution timeout', 504, 'script_timeout'))
      }, timeoutMs)

      fn()
        .then((result) => {
          clearTimeout(timeoutId)
          resolve(result)
        })
        .catch((error) => {
          clearTimeout(timeoutId)
          reject(error)
        })
    })
  }

  /**
   * Generate a connection ID
   */
  private generateId(): string {
    const bytes = new Uint8Array(12)
    crypto.getRandomValues(bytes)
    return 'con_' + Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  // ============================================================================
  // CLIENT MANAGEMENT
  // ============================================================================

  /**
   * Enable a client for a connection
   */
  enableClient(connectionId: string, clientId: string): Connection {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      throw new Auth0ManagementError('Connection not found', 404, 'inexistent_connection')
    }

    if (!connection.enabled_clients.includes(clientId)) {
      connection.enabled_clients.push(clientId)
      connection.updated_at = new Date().toISOString()
      this.connections.set(connectionId, connection)
    }

    return connection
  }

  /**
   * Disable a client for a connection
   */
  disableClient(connectionId: string, clientId: string): Connection {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      throw new Auth0ManagementError('Connection not found', 404, 'inexistent_connection')
    }

    const index = connection.enabled_clients.indexOf(clientId)
    if (index !== -1) {
      connection.enabled_clients.splice(index, 1)
      connection.updated_at = new Date().toISOString()
      this.connections.set(connectionId, connection)
    }

    return connection
  }
}
