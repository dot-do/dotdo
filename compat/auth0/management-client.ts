/**
 * @dotdo/auth0 - Management Client
 *
 * Auth0 Management API client compatible with the auth0 Node.js SDK.
 * Provides a drop-in replacement for the ManagementClient class.
 *
 * @example Basic Usage
 * ```typescript
 * import { ManagementClient } from '@dotdo/auth0'
 *
 * const management = new ManagementClient({
 *   domain: 'tenant.auth0.com',
 *   clientId: 'your-client-id',
 *   clientSecret: 'your-client-secret',
 * })
 *
 * // Create a user
 * const user = await management.users.create({
 *   connection: 'Username-Password-Authentication',
 *   email: 'user@example.com',
 *   password: 'SecurePassword123!',
 * })
 *
 * // Get a user
 * const fetchedUser = await management.users.get({ id: user.user_id })
 *
 * // Update a user
 * const updated = await management.users.update(
 *   { id: user.user_id },
 *   { user_metadata: { theme: 'dark' } }
 * )
 *
 * // Search users
 * const { users } = await management.users.getAll({
 *   q: 'email:*@example.com',
 *   search_engine: 'v3',
 * })
 *
 * // Delete a user
 * await management.users.delete({ id: user.user_id })
 * ```
 *
 * @example Password Reset
 * ```typescript
 * // Create password reset ticket
 * const ticket = await management.tickets.changePassword({
 *   user_id: user.user_id,
 *   result_url: 'https://example.com/reset-complete',
 * })
 * console.log('Reset URL:', ticket.ticket)
 * ```
 *
 * @example Email Verification
 * ```typescript
 * // Create email verification ticket
 * const ticket = await management.tickets.verifyEmail({
 *   user_id: user.user_id,
 *   result_url: 'https://example.com/verified',
 * })
 *
 * // Or send verification email
 * await management.jobs.verifyEmail({
 *   user_id: user.user_id,
 * })
 * ```
 *
 * @see https://auth0.com/docs/api/management/v2
 * @module
 */

import type { ManagementClientOptions, UserRecord } from './types'
import { UsersManager } from './users-manager'
import { TicketsManager } from './tickets-manager'
import { JobsManager } from './jobs-manager'
import { BrandingManager } from './branding-manager'

// ============================================================================
// MANAGEMENT CLIENT
// ============================================================================

/**
 * Auth0 Management Client
 *
 * Provides access to Auth0 Management API operations.
 * Compatible with the auth0 Node.js SDK ManagementClient.
 */
export class ManagementClient {
  private readonly domain: string
  private readonly clientId?: string
  private readonly clientSecret?: string
  private readonly token?: string

  /**
   * Users manager for CRUD operations
   */
  public readonly users: UsersManager

  /**
   * Tickets manager for password reset and email verification
   */
  public readonly tickets: TicketsManager

  /**
   * Jobs manager for async operations
   */
  public readonly jobs: JobsManager

  /**
   * Branding manager for Universal Login customization
   */
  public readonly branding: BrandingManager

  // Internal user store reference for tickets/jobs
  private readonly usersStore: Map<string, UserRecord>

  constructor(options: ManagementClientOptions) {
    this.domain = options.domain
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
    this.token = options.token

    // Validate configuration
    if (!this.token && (!this.clientId || !this.clientSecret)) {
      // In edge environment, we allow creation without credentials for in-memory use
      // throw new Error('Either token or clientId/clientSecret is required')
    }

    // Initialize users manager
    this.users = new UsersManager({
      domain: this.domain,
    })

    // Get internal reference to users store
    // This is a workaround for sharing state between managers
    // In production, would use shared TemporalStore
    this.usersStore = (this.users as unknown as { users: Map<string, UserRecord> }).users

    // Initialize tickets manager
    this.tickets = new TicketsManager({
      domain: this.domain,
      getUser: (userId: string) => this.usersStore.get(userId),
    })

    // Initialize jobs manager
    this.jobs = new JobsManager({
      domain: this.domain,
      getUser: (userId: string) => this.usersStore.get(userId),
    })

    // Initialize branding manager
    this.branding = new BrandingManager({
      domain: this.domain,
    })
  }

  /**
   * Get the configured domain
   */
  getDomain(): string {
    return this.domain
  }

  /**
   * Get access token (for custom API calls)
   *
   * In a real implementation, this would handle token refresh
   * using client credentials grant.
   */
  async getAccessToken(): Promise<string> {
    if (this.token) {
      return this.token
    }

    // In production, would call /oauth/token with client credentials
    throw new Error('Token retrieval with client credentials not implemented in edge mode')
  }
}
