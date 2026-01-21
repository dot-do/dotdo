// Authentication Patterns Example - Type definitions

/**
 * A user account
 */
export interface User {
  $type: 'User'
  email: string
  passwordHash: string
  name: string
  avatar?: string
  role: 'admin' | 'user' | 'guest'
  emailVerified: boolean
  twoFactorEnabled: boolean
  twoFactorSecret?: string
  createdAt: string
  updatedAt?: string
  lastLoginAt?: string
}

/**
 * A user session
 */
export interface Session {
  $type: 'Session'
  userId: string
  token: string
  refreshToken: string
  expiresAt: string
  createdAt: string
  userAgent?: string
  ipAddress?: string
  lastActiveAt: string
}

/**
 * An API key for programmatic access
 */
export interface ApiKey {
  $type: 'ApiKey'
  userId: string
  name: string
  keyHash: string
  keyPrefix: string
  permissions: string[]
  rateLimit: number
  expiresAt?: string
  createdAt: string
  lastUsedAt?: string
  usageCount: number
}

/**
 * A password reset request
 */
export interface PasswordReset {
  $type: 'PasswordReset'
  userId: string
  email: string
  token: string
  expiresAt: string
  createdAt: string
  usedAt?: string
}

/**
 * An OAuth connection
 */
export interface OAuthConnection {
  $type: 'OAuthConnection'
  userId: string
  provider: 'google' | 'github' | 'microsoft'
  providerUserId: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: string
  createdAt: string
}

/**
 * An audit log entry for security events
 */
export interface SecurityEvent {
  $type: 'SecurityEvent'
  userId?: string
  eventType: 'login' | 'logout' | 'login_failed' | 'password_change' | 'api_key_created' | 'api_key_revoked' | '2fa_enabled' | '2fa_disabled'
  ipAddress?: string
  userAgent?: string
  metadata?: Record<string, unknown>
  createdAt: string
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Registration request
 */
export interface RegisterRequest {
  email: string
  password: string
  name: string
}

/**
 * Login request
 */
export interface LoginRequest {
  email: string
  password: string
  twoFactorCode?: string
}

/**
 * Login response
 */
export interface LoginResponse {
  user: Omit<User, 'passwordHash' | 'twoFactorSecret'>
  accessToken: string
  refreshToken: string
  expiresIn: number
}

/**
 * Token refresh request
 */
export interface RefreshRequest {
  refreshToken: string
}

/**
 * Password change request
 */
export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}

/**
 * Password reset initiation request
 */
export interface ForgotPasswordRequest {
  email: string
}

/**
 * Password reset completion request
 */
export interface ResetPasswordRequest {
  token: string
  newPassword: string
}

/**
 * API key creation request
 */
export interface CreateApiKeyRequest {
  name: string
  permissions?: string[]
  expiresIn?: number // days
}

/**
 * API key creation response
 */
export interface CreateApiKeyResponse {
  id: string
  name: string
  key: string // Only returned once
  permissions: string[]
  expiresAt?: string
}

/**
 * 2FA setup response
 */
export interface Setup2FAResponse {
  secret: string
  qrCodeUrl: string
  backupCodes: string[]
}

/**
 * Decoded JWT payload
 */
export interface JWTPayload {
  sub: string // userId
  email: string
  role: User['role']
  iat: number
  exp: number
  type: 'access' | 'refresh'
}
