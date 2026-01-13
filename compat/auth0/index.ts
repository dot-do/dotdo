/**
 * @dotdo/auth0 - Auth0 SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for the auth0 Node.js SDK that runs on Cloudflare Workers
 * with edge-optimized performance. Implements the Auth0 Management API.
 *
 * @example ManagementClient Usage
 * ```typescript
 * import { ManagementClient } from '@dotdo/auth0'
 *
 * const management = new ManagementClient({
 *   domain: 'tenant.auth0.com',
 *   token: 'your-management-api-token',
 * })
 *
 * // Create a user
 * const user = await management.users.create({
 *   connection: 'Username-Password-Authentication',
 *   email: 'user@example.com',
 *   password: 'SecurePassword123!',
 * })
 *
 * // Get users
 * const { users } = await management.users.getAll({
 *   q: 'email:*@example.com',
 *   search_engine: 'v3',
 * })
 *
 * // Update a user
 * await management.users.update(
 *   { id: user.user_id },
 *   { user_metadata: { theme: 'dark' } }
 * )
 *
 * // Delete a user
 * await management.users.delete({ id: user.user_id })
 * ```
 *
 * @example Password Reset
 * ```typescript
 * const ticket = await management.tickets.changePassword({
 *   user_id: user.user_id,
 *   result_url: 'https://example.com/reset-complete',
 * })
 * console.log('Reset URL:', ticket.ticket)
 * ```
 *
 * @example Email Verification
 * ```typescript
 * // Create ticket
 * const ticket = await management.tickets.verifyEmail({
 *   user_id: user.user_id,
 * })
 *
 * // Or send email
 * await management.jobs.verifyEmail({
 *   user_id: user.user_id,
 * })
 * ```
 *
 * @example Custom Database Connection
 * ```typescript
 * import { ConnectionsManager } from '@dotdo/auth0'
 *
 * const connections = new ConnectionsManager({
 *   domain: 'tenant.auth0.com',
 * })
 *
 * // Create a custom database connection with scripts
 * connections.create({
 *   name: 'my-legacy-db',
 *   strategy: 'auth0',
 *   options: {
 *     import_mode: true, // Enable lazy migration
 *     customScripts: {
 *       login: async (email, password, context) => {
 *         const user = await myDb.findByEmail(email)
 *         if (!user || !await verifyPassword(password, user.hash)) {
 *           throw new Error('Invalid credentials')
 *         }
 *         return { user_id: user.id, email: user.email }
 *       },
 *       getUser: async (email, context) => {
 *         const user = await myDb.findByEmail(email)
 *         return user ? { user_id: user.id, email: user.email } : null
 *       },
 *       create: async (user, context) => {
 *         const newUser = await myDb.create(user)
 *         return { user_id: newUser.id, email: newUser.email }
 *       },
 *       verify: async (email, context) => {
 *         await myDb.markEmailVerified(email)
 *       },
 *       changePassword: async (email, newPassword, context) => {
 *         await myDb.updatePassword(email, newPassword)
 *       },
 *       delete: async (userId, context) => {
 *         await myDb.deleteUser(userId)
 *       },
 *     },
 *   },
 * })
 *
 * // Execute custom scripts
 * const user = await connections.executeLogin('my-legacy-db', 'user@example.com', 'password')
 * ```
 *
 * @see https://auth0.com/docs/api/management/v2
 * @see https://auth0.com/docs/authenticate/database-connections/custom-db
 * @module
 */

// ============================================================================
// MAIN EXPORTS
// ============================================================================

export { ManagementClient } from './management-client'
export { UsersManager } from './users-manager'
export { TicketsManager } from './tickets-manager'
export { JobsManager } from './jobs-manager'
export { RulesEngine } from './rules-engine'
export { ActionsEngine } from './actions-engine'
export { ConnectionsManager } from './custom-database'

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type {
  // Client options
  ManagementClientOptions,

  // User types
  User,
  UserMetadata,
  AppMetadata,
  Identity,
  UserRecord,

  // User management params
  CreateUserParams,
  UpdateUserParams,
  GetUsersParams,
  GetUsersResponse,
  GetUsersByEmailParams,

  // Password management
  ChangePasswordParams,
  ResetPasswordParams,
  PasswordResetTicket,

  // Email verification
  CreateEmailVerificationTicketParams,
  EmailVerificationTicket,
  ResendVerificationEmailParams,

  // MFA
  Enrollment,
  DeleteUserEnrollmentParams,

  // Roles and permissions
  Role,
  Permission,
  AssignRolesParams,
  RemoveRolesParams,
  AssignPermissionsParams,
  RemovePermissionsParams,

  // User blocks
  UserBlock,

  // Logs
  LogEvent,
  GetUserLogsParams,

  // Errors
  ManagementApiError,

  // Rules types
  Rule,
  CreateRuleParams,
  UpdateRuleParams,
  RuleContext,
  RuleRequest,
  RuleCallback,
  RuleFunction,
  RuleExecutionResult,

  // Actions types
  ActionTrigger,
  ActionStatus,
  ActionRuntime,
  Action,
  CreateActionParams,
  UpdateActionParams,
  PostLoginEvent,
  PostLoginApi,
  PreUserRegistrationEvent,
  PreUserRegistrationApi,
  PostUserRegistrationEvent,
  PostUserRegistrationApi,
  PostChangePasswordEvent,
  PostChangePasswordApi,
  ActionExecutionResult,
  ActionCommand,
} from './types'

export { Auth0ManagementError } from './types'

// ============================================================================
// MANAGER TYPES
// ============================================================================

export type { GetUserParams, DeleteUserParams, UserIdParams, UsersManagerOptions } from './users-manager'
export type { ChangePasswordTicketParams, VerifyEmailTicketParams, TicketsManagerOptions } from './tickets-manager'
export type { VerifyEmailJobParams, JobResponse, UsersImportJobParams, UsersExportJobParams, JobsManagerOptions } from './jobs-manager'
export type { RulesEngineOptions, RulesPipelineResult } from './rules-engine'
export type { ActionsEngineOptions, TriggerBinding, FlowExecutionResult } from './actions-engine'
export type {
  // Custom database types
  ConnectionsManagerOptions,
  CustomDatabaseContext,
  CustomDatabaseUser,
  CustomDatabaseScripts,
  LoginScript,
  GetUserScript,
  CreateScript,
  DeleteScript,
  VerifyScript,
  ChangePasswordScript,
  // Connection types
  Connection,
  ConnectionStrategy,
  ConnectionOptions,
  CreateConnectionParams,
  UpdateConnectionParams,
  PasswordPolicy,
} from './custom-database'
