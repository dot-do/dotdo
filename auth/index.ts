/**
 * @dotdo/auth - Authentication and Authorization for Hono
 *
 * Provides complete authentication infrastructure:
 * - JWT authentication middleware
 * - API key authentication and management
 * - JWKS validation for asymmetric keys
 * - Session management
 * - Role-based access control (RBAC)
 * - Permission guards
 * - Token revocation
 * - org.ai integration
 *
 * @module @dotdo/auth
 */

// ============================================================================
// Middleware - JWT and API key authentication
// ============================================================================
export {
  authMiddleware,
  apiKeyMiddleware,
} from './middleware'

export type {
  AuthOptions,
  AuthUser,
} from './middleware'

// ============================================================================
// Guards - Permission checking middleware
// ============================================================================
export {
  requireAuth,
  requireRole,
  requireScope,
  requireOwner,
  requireAll,
  requireAny,
} from './guards'

// Guard function type for DO auth integration
export type {
  /** Type for requireOwner callback function */
  GetResourceOwnerIdFn,
} from './guards'

// ============================================================================
// Token - JWT token validation and utilities
// ============================================================================
export {
  extractToken,
  verifyTokenSignature,
  checkTokenExpiration,
  validateToken,
} from './token'

export type {
  TokenPayload,
  TokenValidationOptions,
  TokenExtractionOptions,
  ExpirationCheckResult,
  ExpirationCheckOptions,
} from './token'

// ============================================================================
// JWKS - JSON Web Key Set support
// ============================================================================
export {
  fetchJwks,
  validateJwksUri,
  createJwksClient,
  createJwksClientFromIssuer,
  verifyTokenWithJwks,
  validateTokenWithJwks,
} from './jwks'

export type {
  Jwks,
  JwksClientOptions,
  JwksVerifyOptions,
  JwksValidationOptions,
  JwksClient,
} from './jwks'

// ============================================================================
// API Key - API key management and middleware
// ============================================================================
export {
  ApiKeyManager,
  ApiKeyAuth,
  createApiKeyMiddleware,
} from './apikey'

export type {
  ApiKey,
  ApiKeyCreateOptions,
  ApiKeyValidationResult,
  ApiKeyListOptions,
  RateLimitWindow,
  ApiKeyStore,
  ApiKeyManagerOptions,
} from './apikey'

// ============================================================================
// Session - Session management
// ============================================================================
export {
  createSession,
  getSession,
  invalidateSession,
  refreshSession,
  cleanupExpiredSessions,
  getUserSessions,
  clearAllSessions,
} from './session'

export type {
  Session,
  SessionMetadata,
  SessionOptions,
} from './session'

// ============================================================================
// org.ai - Integration with org.ai authentication
// ============================================================================
export {
  orgAiAuthMiddleware,
  configureOrgAiClient,
  getOrgAiClientConfig,
  clearOrgAiCache,
  lookupUserByOrgAiId,
  checkOrganizationMembership,
  mapOrgAiRolesToPermissions,
  initiateSSOFlow,
} from './org-ai'

export type {
  User,
  Credential,
  OrgAiClientConfig,
  OrgAiAuthOptions,
  OrgAiUser,
  OrgAiOrganization,
  OrgAiPermissions,
  SSOTelemetryEvent,
  SSOFlowOptions,
  SSOFlowResult,
  OrganizationMembership,
} from './org-ai'

// ============================================================================
// Revocation - Token revocation management
// ============================================================================
export {
  tokenRevocationMigration,
  createInMemoryRevocationStore,
  createSQLiteRevocationStore,
  createRevocationChecker,
  checkRevocation,
  createMigration,
} from './revocation'

export type {
  TokenRevocation,
  RevocationQueryOptions,
  TokenRevocationStore,
  TokenRevocationChecker,
  RevocationAwareValidationOptions,
  SqlStorage,
  SqlStorageStatement,
  Migration,
} from './revocation'

// ============================================================================
// Validation - Secret validation utilities
// ============================================================================
export {
  MissingSecretError,
  SecretLengthError,
  validateSecretPresent,
  validateSecretLength,
  getRequiredSecret,
  validateSecret,
  isSecretConfigured,
} from './validation'

export type {
  SecretValue,
} from './validation'

// ============================================================================
// RBAC - Role-based access control
// ============================================================================
export {
  ROLE_HIERARCHY,
  DEFAULT_ROLES,
  isRoleAtLeast,
  getHighestRole,
  userHasAtLeastRole,
  PolicyEngine,
  defaultPolicyEngine,
  rbacMiddleware,
  requirePermission,
  requireResourceOwner,
  requireTenantMatch,
  permission,
  parsePermission,
  matchesPermission,
} from './rbac'

export type {
  BuiltInRole,
  PermissionAction,
  ResourceType,
  Permission,
  PermissionCondition,
  RoleDefinition,
  PolicyDecision,
  ResourceContext,
  UserContext,
  RBACMiddlewareOptions,
} from './rbac'
