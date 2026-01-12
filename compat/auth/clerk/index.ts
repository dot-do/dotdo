/**
 * @dotdo/clerk - Clerk SDK Compatibility Layer
 *
 * Drop-in replacement for Clerk's Backend SDK that runs on Cloudflare Workers.
 * Provides Users, Sessions, Organizations, and JWT template management.
 *
 * @example Basic Usage
 * ```typescript
 * import { Clerk, createClerkClient } from '@dotdo/clerk'
 *
 * // Create client
 * const clerk = createClerkClient({
 *   secretKey: 'sk_test_...',
 *   publishableKey: 'pk_test_...',
 * })
 *
 * // Create a user
 * const user = await clerk.users.createUser({
 *   email_address: ['user@example.com'],
 *   password: 'password123',
 *   first_name: 'John',
 *   last_name: 'Doe',
 * })
 *
 * // Get user
 * const fetchedUser = await clerk.users.getUser(user.id)
 *
 * // List users
 * const { data: users } = await clerk.users.getUserList({
 *   email_address: ['user@example.com'],
 * })
 * ```
 *
 * @example Sessions
 * ```typescript
 * import { createClerkClient } from '@dotdo/clerk'
 *
 * const clerk = createClerkClient({
 *   secretKey: 'sk_test_...',
 * })
 *
 * // Get session
 * const session = await clerk.sessions.getSession('sess_123')
 *
 * // Get session token
 * const { jwt } = await clerk.sessions.getToken('sess_123')
 *
 * // Verify token
 * const { userId, sessionId, claims } = await clerk.verifyToken(jwt, {
 *   authorizedParties: ['https://myapp.com'],
 * })
 *
 * // Revoke session
 * await clerk.sessions.revokeSession('sess_123')
 * ```
 *
 * @example Organizations
 * ```typescript
 * import { createClerkClient } from '@dotdo/clerk'
 *
 * const clerk = createClerkClient({
 *   secretKey: 'sk_test_...',
 * })
 *
 * // Create organization
 * const org = await clerk.organizations.createOrganization({
 *   name: 'Acme Inc',
 *   created_by: 'user_123',
 * })
 *
 * // Add member
 * const membership = await clerk.organizations.createOrganizationMembership({
 *   organizationId: org.id,
 *   userId: 'user_456',
 *   role: 'member',
 * })
 *
 * // Update member role
 * await clerk.organizations.updateOrganizationMembership({
 *   organizationId: org.id,
 *   userId: 'user_456',
 *   role: 'admin',
 * })
 *
 * // Send invitation
 * const invitation = await clerk.organizations.createOrganizationInvitation(org.id, {
 *   email_address: 'newuser@example.com',
 *   role: 'member',
 *   inviter_user_id: 'user_123',
 * })
 * ```
 *
 * @example JWT Templates
 * ```typescript
 * import { createClerkClient } from '@dotdo/clerk'
 *
 * const clerk = createClerkClient({
 *   secretKey: 'sk_test_...',
 * })
 *
 * // Create JWT template
 * const template = await clerk.jwtTemplates.createJWTTemplate({
 *   name: 'supabase',
 *   claims: {
 *     role: 'authenticated',
 *     aud: 'authenticated',
 *   },
 *   lifetime: 3600,
 * })
 *
 * // Get session token with template
 * const { jwt } = await clerk.sessions.getToken('sess_123', 'supabase')
 * ```
 *
 * @example MFA
 * ```typescript
 * import { createClerkClient } from '@dotdo/clerk'
 *
 * const clerk = createClerkClient({
 *   secretKey: 'sk_test_...',
 * })
 *
 * // Verify TOTP
 * const { verified } = await clerk.users.verifyTOTP({
 *   userId: 'user_123',
 *   code: '123456',
 * })
 *
 * // Disable MFA
 * await clerk.users.disableMFA('user_123')
 * ```
 *
 * @see https://clerk.com/docs/reference/backend-api
 * @module
 */

// Backend API
export { Clerk, createClerkClient } from './backend-api'
export type { ClerkClientOptions } from './backend-api'

// Types
export type {
  // User types
  ClerkUser,
  ClerkEmailAddress,
  ClerkPhoneNumber,
  ClerkWeb3Wallet,
  ClerkExternalAccount,
  ClerkSAMLAccount,
  ClerkVerification,
  ClerkLinkedIdentifier,
  CreateUserParams,
  UpdateUserParams,
  // Session types
  ClerkSession,
  ClerkSessionActor,
  ClerkSessionClaims,
  // Organization types
  ClerkOrganization,
  ClerkOrganizationMembership,
  ClerkOrganizationInvitation,
  ClerkPublicUserData,
  CreateOrganizationParams,
  UpdateOrganizationParams,
  CreateInvitationParams,
  // JWT template types
  ClerkJWTTemplate,
  CreateJWTTemplateParams,
  // Client types
  ClerkClient,
  ClerkSignIn,
  ClerkSignUp,
  ClerkFactor,
  // Webhook types
  ClerkWebhookEvent,
  ClerkWebhookEventType,
  // Response types
  ClerkPaginatedList,
  ClerkDeletedObject,
  // Error types
  ClerkError,
  ClerkErrorDetail,
} from './types'

export { ClerkAPIError } from './types'
