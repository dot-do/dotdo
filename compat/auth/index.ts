/**
 * @dotdo/auth - Authentication & Identity Compatibility Layer
 *
 * Provides drop-in replacements for popular auth providers that run on Cloudflare Workers.
 * Built on shared primitives for consistent behavior across providers.
 *
 * ## Supported Providers
 *
 * - **Auth0**: Management API, Authentication API, RBAC
 * - **Clerk**: Users, Sessions, Organizations, JWT Templates
 *
 * ## Shared Primitives
 *
 * All providers use the same underlying primitives:
 * - JWT: Token creation and verification
 * - Sessions: Session management with sliding windows
 * - Users: User CRUD with idempotent creation
 * - MFA: TOTP, SMS, and Email OTP
 * - OAuth: OAuth 2.0 flows with PKCE
 *
 * @example Auth0 Usage
 * ```typescript
 * import { ManagementClient, AuthenticationClient } from '@dotdo/auth/auth0'
 *
 * // Management API
 * const management = new ManagementClient({
 *   domain: 'your-tenant.auth0.com',
 *   clientId: 'your-client-id',
 *   clientSecret: 'your-client-secret',
 * })
 *
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
 * const tokens = await auth.oauth.token({
 *   grant_type: 'password',
 *   client_id: 'your-client-id',
 *   username: 'user@example.com',
 *   password: 'password123',
 * })
 * ```
 *
 * @example Clerk Usage
 * ```typescript
 * import { createClerkClient } from '@dotdo/auth/clerk'
 *
 * const clerk = createClerkClient({
 *   secretKey: 'sk_test_...',
 * })
 *
 * const user = await clerk.users.createUser({
 *   email_address: ['user@example.com'],
 *   password: 'password123',
 * })
 *
 * const org = await clerk.organizations.createOrganization({
 *   name: 'Acme Inc',
 *   created_by: user.id,
 * })
 * ```
 *
 * @example Using Shared Primitives
 * ```typescript
 * import {
 *   createJWT,
 *   verifyJWT,
 *   createUserManager,
 *   createSessionManager,
 *   createMFAManager,
 *   createOAuthManager,
 * } from '@dotdo/auth/shared'
 *
 * // Create custom JWT
 * const token = await createJWT(
 *   { userId: 'user_123', role: 'admin' },
 *   { secret: 'your-secret', expiresIn: 3600 }
 * )
 *
 * // Verify JWT
 * const result = await verifyJWT(token, { secret: 'your-secret' })
 *
 * // User management
 * const users = createUserManager()
 * const user = await users.createUser({
 *   email: 'user@example.com',
 *   password: 'password123',
 * })
 *
 * // Session management
 * const sessions = createSessionManager({ jwtSecret: 'your-secret' })
 * const session = await sessions.createSession(user.id)
 *
 * // MFA
 * const mfa = createMFAManager({ totpIssuer: 'MyApp' })
 * const enrollment = await mfa.enrollTOTP(user.id, 'user@example.com')
 * ```
 *
 * @module
 */

// ============================================================================
// AUTH0 EXPORTS
// ============================================================================

export {
  ManagementClient,
  createManagementClient,
  AuthenticationClient,
  createAuthenticationClient,
  Auth0APIError,
} from './auth0'

export type {
  ManagementAPIOptions,
  AuthenticationAPIOptions,
  // User types
  Auth0User,
  Auth0Identity,
  CreateUserParams as Auth0CreateUserParams,
  UpdateUserParams as Auth0UpdateUserParams,
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
} from './auth0'

// ============================================================================
// CLERK EXPORTS
// ============================================================================

export { Clerk, createClerkClient, ClerkAPIError } from './clerk'

export type {
  ClerkClientOptions,
  // User types
  ClerkUser,
  ClerkEmailAddress,
  ClerkPhoneNumber,
  ClerkWeb3Wallet,
  ClerkExternalAccount,
  ClerkSAMLAccount,
  ClerkVerification,
  ClerkLinkedIdentifier,
  CreateUserParams as ClerkCreateUserParams,
  UpdateUserParams as ClerkUpdateUserParams,
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
} from './clerk'

// ============================================================================
// SHARED PRIMITIVES EXPORTS
// ============================================================================

export {
  // JWT
  createJWT,
  verifyJWT,
  decodeJWT,
  isTokenExpired,
  getTokenExpiration,
  getTokenTTL,
  getTokenSubject,
  // Sessions
  createSessionManager,
  // Users
  createUserManager,
  // MFA
  createMFAManager,
  // OAuth
  createOAuthManager,
  // Errors
  AuthenticationError,
} from './shared'

export type {
  // JWT types
  JWTClaims,
  JWTVerifyResult,
  JWTCreateOptions,
  JWTVerifyOptions,
  // Session types
  Session,
  SessionManagerOptions,
  CreateSessionOptions,
  SessionValidationResult,
  // User types
  User,
  CreateUserParams,
  UpdateUserParams,
  SearchUsersParams,
  PasswordVerificationResult,
  Identity,
  // MFA types
  MFAFactor,
  TOTPEnrollment,
  MFAChallenge,
  MFAManagerOptions,
  // OAuth types
  OAuthClient,
  OAuthProvider,
  OAuthAuthorizationRequest,
  OAuthTokenRequest,
  OAuthTokenResponse,
  OAuthManagerOptions,
  // Token types
  TokenPair,
  // Organization types
  Organization,
  OrganizationMembership,
  OrganizationInvitation,
  // Role types
  Role,
  Permission,
} from './shared'
