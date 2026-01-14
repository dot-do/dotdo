/**
 * @dotdo/auth0 - Auth0 SDK Compatibility Layer
 *
 * Drop-in replacement for Auth0's Node.js SDK that runs on Cloudflare Workers.
 * Provides both Management API and Authentication API compatibility.
 *
 * @example Basic Usage
 * ```typescript
 * import { ManagementClient, AuthenticationClient } from '@dotdo/auth0'
 *
 * // Management API
 * const management = new ManagementClient({
 *   domain: 'your-tenant.auth0.com',
 *   clientId: 'your-client-id',
 *   clientSecret: 'your-client-secret',
 * })
 *
 * // Create a user
 * const user = await management.users.create({
 *   email: 'user@example.com',
 *   password: 'password123',
 *   connection: 'Username-Password-Authentication',
 * })
 *
 * // Authentication API
 * const auth = new AuthenticationClient({
 *   domain: 'your-tenant.auth0.com',
 *   clientId: 'your-client-id',
 *   jwtSecret: 'your-jwt-secret',
 * })
 *
 * // Sign up
 * const newUser = await auth.database.signUp({
 *   client_id: 'your-client-id',
 *   email: 'user@example.com',
 *   password: 'password123',
 *   connection: 'Username-Password-Authentication',
 * })
 *
 * // Get tokens
 * const tokens = await auth.oauth.token({
 *   grant_type: 'password',
 *   client_id: 'your-client-id',
 *   username: 'user@example.com',
 *   password: 'password123',
 * })
 * ```
 *
 * @example MFA
 * ```typescript
 * import { AuthenticationClient } from '@dotdo/auth0'
 *
 * const auth = new AuthenticationClient({
 *   domain: 'your-tenant.auth0.com',
 *   jwtSecret: 'your-jwt-secret',
 * })
 *
 * // Associate TOTP
 * const enrollment = await auth.mfa.associate({
 *   client_id: 'your-client-id',
 *   access_token: 'user-access-token',
 *   authenticator_types: ['otp'],
 * })
 *
 * // Challenge MFA
 * const challenge = await auth.mfa.challenge({
 *   client_id: 'your-client-id',
 *   mfa_token: 'mfa-token',
 *   challenge_type: 'otp',
 * })
 *
 * // Verify MFA
 * const tokens = await auth.mfa.verify({
 *   client_id: 'your-client-id',
 *   mfa_token: 'mfa-token',
 *   otp: '123456',
 * })
 * ```
 *
 * @example Roles and Permissions
 * ```typescript
 * import { ManagementClient } from '@dotdo/auth0'
 *
 * const management = new ManagementClient({
 *   domain: 'your-tenant.auth0.com',
 *   token: 'management-api-token',
 * })
 *
 * // Create a role
 * const role = await management.roles.create({
 *   name: 'admin',
 *   description: 'Administrator role',
 * })
 *
 * // Add permissions to role
 * await management.roles.addPermissions({ id: role.id }, {
 *   permissions: [
 *     { permission_name: 'read:users', resource_server_identifier: 'https://api.example.com' },
 *     { permission_name: 'write:users', resource_server_identifier: 'https://api.example.com' },
 *   ],
 * })
 *
 * // Assign role to user
 * await management.users.assignRoles({ id: 'user_123' }, {
 *   roles: [role.id],
 * })
 *
 * // Get user's permissions
 * const permissions = await management.users.getPermissions({ id: 'user_123' })
 * ```
 *
 * @see https://auth0.com/docs/api/management/v2
 * @see https://auth0.com/docs/api/authentication
 * @module
 */

// Management API
export { ManagementClient, createManagementClient } from './management-api'
export type { ManagementAPIOptions } from './management-api'

// Authentication API
export { AuthenticationClient, createAuthenticationClient } from './authentication-api'
export type { AuthenticationAPIOptions } from './authentication-api'

// Types
export type {
  // User types
  Auth0User,
  Auth0Identity,
  CreateUserParams,
  UpdateUserParams,
  // Connection types
  Auth0Connection,
  ConnectionOptions,
  CreateConnectionParams,
  // Role types
  Auth0Role,
  Auth0Permission,
  CreateRoleParams,
  // Client types
  Auth0Client,
  CreateClientParams,
  // Resource server types
  Auth0ResourceServer,
  CreateResourceServerParams,
  // Token types
  TokenResponse,
  AuthorizationParams,
  TokenExchangeParams,
  // Auth types
  SignupParams,
  ChangePasswordParams,
  PasswordlessStartParams,
  PasswordlessVerifyParams,
  // MFA types
  Auth0MFAEnrollment,
  Auth0MFAChallenge,
  // Log types
  Auth0Log,
  // Error types
  Auth0Error,
  // Pagination types
  PaginationParams,
  PaginatedResponse,
} from './types'

export { Auth0APIError } from './types'
