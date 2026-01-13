/**
 * @dotdo/firebase-auth - Firebase Auth SDK Types
 *
 * Type definitions for Firebase Authentication API compatibility layer.
 * Matches the official Firebase Auth SDK types for drop-in replacement.
 *
 * @see https://firebase.google.com/docs/reference/js/auth
 */

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Firebase Auth error codes
 */
export type AuthErrorCode =
  | 'auth/email-already-in-use'
  | 'auth/invalid-email'
  | 'auth/invalid-credential'
  | 'auth/operation-not-allowed'
  | 'auth/weak-password'
  | 'auth/user-disabled'
  | 'auth/user-not-found'
  | 'auth/wrong-password'
  | 'auth/invalid-verification-code'
  | 'auth/invalid-verification-id'
  | 'auth/code-expired'
  | 'auth/expired-action-code'
  | 'auth/invalid-action-code'
  | 'auth/missing-email'
  | 'auth/missing-password'
  | 'auth/requires-recent-login'
  | 'auth/too-many-requests'
  | 'auth/unverified-email'
  | 'auth/credential-already-in-use'
  | 'auth/popup-closed-by-user'
  | 'auth/unauthorized-domain'
  | 'auth/account-exists-with-different-credential'
  | 'auth/network-request-failed'
  | 'auth/internal-error'

/**
 * Firebase Auth error
 */
export class FirebaseAuthError extends Error {
  readonly code: AuthErrorCode
  readonly customData?: Record<string, unknown>

  constructor(code: AuthErrorCode, message: string, customData?: Record<string, unknown>) {
    super(message)
    this.name = 'FirebaseAuthError'
    this.code = code
    this.customData = customData
  }
}

// ============================================================================
// USER TYPES
// ============================================================================

/**
 * User metadata
 */
export interface UserMetadata {
  /** Creation time as ISO string */
  creationTime?: string
  /** Last sign-in time as ISO string */
  lastSignInTime?: string
}

/**
 * User info from a provider
 */
export interface UserInfo {
  /** The provider ID */
  providerId: string
  /** The user's unique ID within the provider */
  uid: string
  /** Display name */
  displayName: string | null
  /** Email address */
  email: string | null
  /** Phone number */
  phoneNumber: string | null
  /** Photo URL */
  photoURL: string | null
}

/**
 * Multi-factor info
 */
export interface MultiFactorInfo {
  /** Unique identifier */
  uid: string
  /** Display name */
  displayName: string | null
  /** Enrollment time */
  enrollmentTime: string
  /** Factor ID (e.g., 'phone', 'totp') */
  factorId: string
}

/**
 * Phone multi-factor info
 */
export interface PhoneMultiFactorInfo extends MultiFactorInfo {
  factorId: 'phone'
  phoneNumber: string
}

/**
 * TOTP multi-factor info
 */
export interface TotpMultiFactorInfo extends MultiFactorInfo {
  factorId: 'totp'
}

/**
 * Multi-factor user
 */
export interface MultiFactorUser {
  /** Enrolled factors */
  enrolledFactors: MultiFactorInfo[]
  /** Get the current session */
  getSession(): Promise<MultiFactorSession>
  /** Enroll a new factor */
  enroll(assertion: MultiFactorAssertion, displayName?: string | null): Promise<void>
  /** Unenroll a factor */
  unenroll(option: MultiFactorInfo | string): Promise<void>
}

/**
 * Multi-factor session
 */
export interface MultiFactorSession {
  /** Session identifier (internal) */
  _id: string
}

/**
 * Multi-factor assertion (base)
 */
export interface MultiFactorAssertion {
  factorId: string
}

/**
 * Firebase User
 */
export interface User {
  /** User's unique ID */
  readonly uid: string
  /** Email address */
  readonly email: string | null
  /** Whether email is verified */
  readonly emailVerified: boolean
  /** Display name */
  readonly displayName: string | null
  /** Photo URL */
  readonly photoURL: string | null
  /** Phone number */
  readonly phoneNumber: string | null
  /** Provider ID (firebase) */
  readonly providerId: string
  /** Whether the user is anonymous */
  readonly isAnonymous: boolean
  /** Tenant ID */
  readonly tenantId: string | null
  /** User metadata */
  readonly metadata: UserMetadata
  /** Provider data */
  readonly providerData: UserInfo[]
  /** Refresh token */
  readonly refreshToken: string
  /** Multi-factor user */
  readonly multiFactor: MultiFactorUser | null

  /** Delete the user */
  delete(): Promise<void>
  /** Get ID token */
  getIdToken(forceRefresh?: boolean): Promise<string>
  /** Get ID token result */
  getIdTokenResult(forceRefresh?: boolean): Promise<IdTokenResult>
  /** Reload user data */
  reload(): Promise<void>
  /** Convert to JSON */
  toJSON(): Record<string, unknown>
}

/**
 * ID token result
 */
export interface IdTokenResult {
  /** The actual token */
  token: string
  /** Token expiration time */
  expirationTime: string
  /** Token auth time */
  authTime: string
  /** Token issued-at time */
  issuedAtTime: string
  /** Sign-in provider */
  signInProvider: string | null
  /** Sign-in second factor */
  signInSecondFactor: string | null
  /** Custom claims */
  claims: Record<string, unknown>
}

// ============================================================================
// CREDENTIAL TYPES
// ============================================================================

/**
 * Auth credential
 */
export interface AuthCredential {
  /** Provider ID */
  readonly providerId: string
  /** Sign-in method */
  readonly signInMethod: string
  /** Convert to JSON */
  toJSON(): Record<string, string>
}

/**
 * OAuth credential
 */
export interface OAuthCredential extends AuthCredential {
  /** Access token */
  readonly accessToken: string | null
  /** ID token */
  readonly idToken: string | null
  /** Secret (for Twitter) */
  readonly secret: string | null
}

/**
 * Email auth credential
 */
export interface EmailAuthCredential extends AuthCredential {
  readonly providerId: 'password'
  readonly signInMethod: 'password' | 'emailLink'
}

/**
 * Phone auth credential
 */
export interface PhoneAuthCredential extends AuthCredential {
  readonly providerId: 'phone'
  readonly signInMethod: 'phone'
}

// ============================================================================
// AUTH PROVIDER TYPES
// ============================================================================

/**
 * Auth provider base
 */
export interface AuthProvider {
  readonly providerId: string
}

/**
 * OAuth provider configuration
 */
export interface OAuthProviderOptions {
  scopes?: string[]
  customParameters?: Record<string, string>
}

/**
 * Additional user info (after sign-in)
 */
export interface AdditionalUserInfo {
  /** Whether this is a new user */
  isNewUser: boolean
  /** Provider ID */
  providerId: string | null
  /** Profile data from provider */
  profile: Record<string, unknown> | null
  /** Username (if available) */
  username?: string | null
}

// ============================================================================
// AUTH RESULT TYPES
// ============================================================================

/**
 * User credential result
 */
export interface UserCredential {
  /** The signed-in user */
  user: User
  /** Provider ID */
  providerId: string | null
  /** Operation type */
  operationType: 'signIn' | 'link' | 'reauthenticate'
  /** Additional info from provider */
  _additionalUserInfo?: AdditionalUserInfo
}

/**
 * Get additional user info from credential
 */
export function getAdditionalUserInfo(userCredential: UserCredential): AdditionalUserInfo | null {
  return userCredential._additionalUserInfo ?? null
}

// ============================================================================
// ACTION CODE TYPES
// ============================================================================

/**
 * Action code operation types
 */
export type ActionCodeOperation =
  | 'PASSWORD_RESET'
  | 'VERIFY_EMAIL'
  | 'RECOVER_EMAIL'
  | 'EMAIL_SIGNIN'
  | 'VERIFY_AND_CHANGE_EMAIL'
  | 'REVERT_SECOND_FACTOR_ADDITION'

/**
 * Action code info
 */
export interface ActionCodeInfo {
  /** Data associated with the action code */
  data: {
    email?: string | null
    multiFactorInfo?: MultiFactorInfo | null
    previousEmail?: string | null
  }
  /** The operation type */
  operation: ActionCodeOperation
}

/**
 * Action code settings
 */
export interface ActionCodeSettings {
  /** URL to redirect to after action */
  url: string
  /** iOS bundle ID */
  iOS?: { bundleId: string }
  /** Android package name */
  android?: { packageName: string; installApp?: boolean; minimumVersion?: string }
  /** Handle code in app */
  handleCodeInApp?: boolean
  /** Dynamic link domain */
  dynamicLinkDomain?: string
}

// ============================================================================
// AUTH SETTINGS
// ============================================================================

/**
 * Auth settings
 */
export interface AuthSettings {
  /** App verification disabled for testing */
  appVerificationDisabledForTesting: boolean
}

/**
 * Persistence types
 */
export type Persistence = {
  readonly type: 'LOCAL' | 'SESSION' | 'NONE'
}

/**
 * Persistence implementations
 */
export const browserLocalPersistence: Persistence = { type: 'LOCAL' }
export const browserSessionPersistence: Persistence = { type: 'SESSION' }
export const inMemoryPersistence: Persistence = { type: 'NONE' }

// ============================================================================
// AUTH CONFIG TYPES
// ============================================================================

/**
 * Config for Auth instance
 */
export interface AuthConfig {
  /** API key */
  apiKey: string
  /** Auth domain */
  authDomain?: string
  /** Project ID */
  projectId?: string
  /** Storage bucket */
  storageBucket?: string
  /** Messaging sender ID */
  messagingSenderId?: string
  /** App ID */
  appId?: string
}

/**
 * Dependencies for Auth (internal)
 */
export interface AuthDependencies {
  persistence?: Persistence[]
  popupRedirectResolver?: PopupRedirectResolver
  errorMap?: AuthErrorMap
}

/**
 * Popup redirect resolver (internal)
 */
export interface PopupRedirectResolver {
  _isAvailable: boolean
}

/**
 * Auth error map
 */
export interface AuthErrorMap {
  [key: string]: string
}

// ============================================================================
// RECAPTCHA & VERIFICATION TYPES
// ============================================================================

/**
 * reCAPTCHA verifier interface
 */
export interface ApplicationVerifier {
  readonly type: string
  verify(): Promise<string>
}

/**
 * Confirmation result (for phone auth)
 */
export interface ConfirmationResult {
  /** Verification ID */
  readonly verificationId: string
  /** Confirm with SMS code */
  confirm(verificationCode: string): Promise<UserCredential>
}

// ============================================================================
// AUTH INSTANCE TYPE
// ============================================================================

/**
 * Auth instance
 */
export interface Auth {
  /** The Firebase app */
  readonly app: { name: string; options: AuthConfig }
  /** The current user */
  readonly currentUser: User | null
  /** Tenant ID */
  tenantId: string | null
  /** Auth settings */
  readonly settings: AuthSettings
  /** Language code */
  languageCode: string | null
  /** Auth emulator config (if connected) */
  readonly emulatorConfig: { host: string; port: number } | null
  /** Name of the Auth instance */
  readonly name: string

  /** Before auth state changed */
  beforeAuthStateChanged(
    callback: (user: User | null) => void | Promise<void>,
    onAbort?: () => void
  ): () => void

  /** On auth state changed */
  onAuthStateChanged(
    nextOrObserver: ((user: User | null) => void) | { next: (user: User | null) => void; error?: (error: Error) => void },
    error?: (error: Error) => void,
    completed?: () => void
  ): () => void

  /** On ID token changed */
  onIdTokenChanged(
    nextOrObserver: ((user: User | null) => void) | { next: (user: User | null) => void; error?: (error: Error) => void },
    error?: (error: Error) => void,
    completed?: () => void
  ): () => void

  /** Set persistence */
  setPersistence(persistence: Persistence): Promise<void>

  /** Use device language */
  useDeviceLanguage(): void

  /** Sign out */
  signOut(): Promise<void>

  /** Update current user */
  updateCurrentUser(user: User | null): Promise<void>
}

// ============================================================================
// STORED USER TYPE (INTERNAL)
// ============================================================================

/**
 * Internal stored user data
 */
export interface StoredUser {
  uid: string
  email: string | null
  emailVerified: boolean
  displayName: string | null
  photoURL: string | null
  phoneNumber: string | null
  isAnonymous: boolean
  passwordHash: string | null
  providerData: UserInfo[]
  metadata: UserMetadata
  tenantId: string | null
  disabled: boolean
  customClaims?: Record<string, unknown>
  mfaFactors?: MultiFactorInfo[]
}

/**
 * Password reset token data
 */
export interface PasswordResetToken {
  email: string
  expiresAt: number
}

/**
 * Email verification token data
 */
export interface EmailVerificationToken {
  uid: string
  email: string
  expiresAt: number
}

/**
 * Email sign-in link data
 */
export interface EmailSignInLink {
  email: string
  expiresAt: number
}

/**
 * Phone verification data
 */
export interface PhoneVerification {
  phoneNumber: string
  code: string
  expiresAt: number
}

/**
 * Refresh token data
 */
export interface RefreshTokenData {
  uid: string
  createdAt: number
  expiresAt: number
}

/**
 * ID token data
 */
export interface IdTokenData {
  uid: string
  email: string | null
  emailVerified: boolean
  displayName: string | null
  photoURL: string | null
  phoneNumber: string | null
  isAnonymous: boolean
  providerId: string
  signInProvider: string
  iat: number
  exp: number
  auth_time: number
  customClaims?: Record<string, unknown>
}
