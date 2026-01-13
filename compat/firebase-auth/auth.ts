/**
 * @dotdo/firebase-auth - Firebase Auth Implementation
 *
 * In-memory implementation of Firebase Authentication SDK.
 * Provides full API compatibility for testing and edge deployments.
 *
 * @module
 */

import type {
  Auth,
  AuthConfig,
  AuthCredential,
  AuthProvider,
  AuthSettings,
  User,
  UserCredential,
  UserInfo,
  UserMetadata,
  IdTokenResult,
  ActionCodeInfo,
  ActionCodeSettings,
  ConfirmationResult,
  ApplicationVerifier,
  Persistence,
  MultiFactorUser,
  MultiFactorInfo,
  MultiFactorSession,
  MultiFactorAssertion,
  AdditionalUserInfo,
  StoredUser,
  PasswordResetToken,
  EmailVerificationToken,
  EmailSignInLink,
  PhoneVerification,
  RefreshTokenData,
  IdTokenData,
  OAuthCredential,
} from './types'

import {
  FirebaseAuthError,
  browserLocalPersistence,
} from './types'

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

interface AuthStorage {
  users: Map<string, StoredUser>
  usersByEmail: Map<string, string> // email -> uid
  usersByPhone: Map<string, string> // phone -> uid
  passwordResetTokens: Map<string, PasswordResetToken>
  emailVerificationTokens: Map<string, EmailVerificationToken>
  emailSignInLinks: Map<string, EmailSignInLink>
  phoneVerifications: Map<string, PhoneVerification>
  refreshTokens: Map<string, RefreshTokenData>
  customTokens: Map<string, { uid: string; claims: Record<string, unknown> }>
  oauthStates: Map<string, { providerId: string; redirectUrl: string }>
}

const storage: AuthStorage = {
  users: new Map(),
  usersByEmail: new Map(),
  usersByPhone: new Map(),
  passwordResetTokens: new Map(),
  emailVerificationTokens: new Map(),
  emailSignInLinks: new Map(),
  phoneVerifications: new Map(),
  refreshTokens: new Map(),
  customTokens: new Map(),
  oauthStates: new Map(),
}

// Instance tracking
const authInstances = new Map<string, AuthImpl>()

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function generateId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function generateToken(length = 32): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(36))
    .join('')
    .slice(0, length)
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + 'firebase-auth-salt')
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const inputHash = await hashPassword(password)
  return inputHash === hash
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isWeakPassword(password: string): boolean {
  return password.length < 6
}

function createJWT(payload: IdTokenData): string {
  // Simple base64 JWT (not cryptographically signed for in-memory testing)
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload))
  const signature = btoa('test-signature')
  return `${header}.${body}.${signature}`
}

function parseJWT(token: string): IdTokenData | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    return JSON.parse(atob(parts[1]))
  } catch {
    return null
  }
}

// ============================================================================
// USER IMPLEMENTATION
// ============================================================================

class UserImpl implements User {
  readonly uid: string
  readonly email: string | null
  readonly emailVerified: boolean
  readonly displayName: string | null
  readonly photoURL: string | null
  readonly phoneNumber: string | null
  readonly providerId: string = 'firebase'
  readonly isAnonymous: boolean
  readonly tenantId: string | null
  readonly metadata: UserMetadata
  readonly providerData: UserInfo[]
  readonly refreshToken: string
  readonly multiFactor: MultiFactorUser | null

  private _auth: AuthImpl

  constructor(stored: StoredUser, auth: AuthImpl) {
    this.uid = stored.uid
    this.email = stored.email
    this.emailVerified = stored.emailVerified
    this.displayName = stored.displayName
    this.photoURL = stored.photoURL
    this.phoneNumber = stored.phoneNumber
    this.isAnonymous = stored.isAnonymous
    this.tenantId = stored.tenantId
    this.metadata = stored.metadata
    this.providerData = stored.providerData
    this.refreshToken = generateToken()
    this._auth = auth

    // Set up multi-factor
    if (stored.mfaFactors && stored.mfaFactors.length > 0) {
      this.multiFactor = new MultiFactorUserImpl(this, stored.mfaFactors)
    } else {
      this.multiFactor = null
    }
  }

  async delete(): Promise<void> {
    const stored = storage.users.get(this.uid)
    if (!stored) {
      throw new FirebaseAuthError('auth/user-not-found', 'User not found')
    }

    // Clean up indexes
    if (stored.email) {
      storage.usersByEmail.delete(stored.email.toLowerCase())
    }
    if (stored.phoneNumber) {
      storage.usersByPhone.delete(stored.phoneNumber)
    }

    storage.users.delete(this.uid)

    // Sign out if this is the current user
    if (this._auth.currentUser?.uid === this.uid) {
      this._auth._setCurrentUser(null)
    }
  }

  async getIdToken(forceRefresh?: boolean): Promise<string> {
    const stored = storage.users.get(this.uid)
    if (!stored) {
      throw new FirebaseAuthError('auth/user-not-found', 'User not found')
    }

    const now = Math.floor(Date.now() / 1000)
    const payload: IdTokenData = {
      uid: this.uid,
      email: this.email,
      emailVerified: this.emailVerified,
      displayName: this.displayName,
      photoURL: this.photoURL,
      phoneNumber: this.phoneNumber,
      isAnonymous: this.isAnonymous,
      providerId: this.providerId,
      signInProvider: stored.providerData[0]?.providerId ?? 'password',
      iat: now,
      exp: now + 3600, // 1 hour
      auth_time: now,
      customClaims: stored.customClaims,
    }

    return createJWT(payload)
  }

  async getIdTokenResult(forceRefresh?: boolean): Promise<IdTokenResult> {
    const token = await this.getIdToken(forceRefresh)
    const payload = parseJWT(token)!

    return {
      token,
      expirationTime: new Date(payload.exp * 1000).toISOString(),
      authTime: new Date(payload.auth_time * 1000).toISOString(),
      issuedAtTime: new Date(payload.iat * 1000).toISOString(),
      signInProvider: payload.signInProvider,
      signInSecondFactor: null,
      claims: payload.customClaims ?? {},
    }
  }

  async reload(): Promise<void> {
    const stored = storage.users.get(this.uid)
    if (!stored) {
      throw new FirebaseAuthError('auth/user-not-found', 'User not found')
    }

    // Update the auth instance with refreshed user
    const refreshedUser = new UserImpl(stored, this._auth)
    this._auth._setCurrentUser(refreshedUser)
  }

  toJSON(): Record<string, unknown> {
    return {
      uid: this.uid,
      email: this.email,
      emailVerified: this.emailVerified,
      displayName: this.displayName,
      photoURL: this.photoURL,
      phoneNumber: this.phoneNumber,
      isAnonymous: this.isAnonymous,
      tenantId: this.tenantId,
      metadata: this.metadata,
      providerData: this.providerData,
    }
  }
}

// ============================================================================
// MULTI-FACTOR IMPLEMENTATION
// ============================================================================

class MultiFactorUserImpl implements MultiFactorUser {
  enrolledFactors: MultiFactorInfo[]
  private _user: UserImpl

  constructor(user: UserImpl, factors: MultiFactorInfo[]) {
    this._user = user
    this.enrolledFactors = factors
  }

  async getSession(): Promise<MultiFactorSession> {
    return { _id: generateId() }
  }

  async enroll(assertion: MultiFactorAssertion, displayName?: string | null): Promise<void> {
    const stored = storage.users.get(this._user.uid)
    if (!stored) {
      throw new FirebaseAuthError('auth/user-not-found', 'User not found')
    }

    const factor: MultiFactorInfo = {
      uid: generateId(),
      displayName: displayName ?? null,
      enrollmentTime: new Date().toISOString(),
      factorId: assertion.factorId,
    }

    stored.mfaFactors = stored.mfaFactors ?? []
    stored.mfaFactors.push(factor)
    this.enrolledFactors.push(factor)
  }

  async unenroll(option: MultiFactorInfo | string): Promise<void> {
    const stored = storage.users.get(this._user.uid)
    if (!stored) {
      throw new FirebaseAuthError('auth/user-not-found', 'User not found')
    }

    const factorUid = typeof option === 'string' ? option : option.uid

    stored.mfaFactors = stored.mfaFactors?.filter((f) => f.uid !== factorUid) ?? []
    this.enrolledFactors = this.enrolledFactors.filter((f) => f.uid !== factorUid)
  }
}

// ============================================================================
// AUTH IMPLEMENTATION
// ============================================================================

class AuthImpl implements Auth {
  readonly app: { name: string; options: AuthConfig }
  private _currentUser: User | null = null
  tenantId: string | null = null
  readonly settings: AuthSettings = { appVerificationDisabledForTesting: false }
  languageCode: string | null = null
  readonly emulatorConfig: { host: string; port: number } | null = null
  readonly name: string

  private _authStateListeners = new Set<(user: User | null) => void>()
  private _idTokenListeners = new Set<(user: User | null) => void>()
  private _beforeAuthStateListeners = new Set<{
    callback: (user: User | null) => void | Promise<void>
    onAbort?: () => void
  }>()
  private _persistence: Persistence = browserLocalPersistence

  constructor(config: AuthConfig, name = '[DEFAULT]') {
    this.app = { name, options: config }
    this.name = name
  }

  get currentUser(): User | null {
    return this._currentUser
  }

  _setCurrentUser(user: User | null): void {
    this._currentUser = user
    this._notifyListeners()
  }

  private _notifyListeners(): void {
    for (const listener of this._authStateListeners) {
      try {
        listener(this._currentUser)
      } catch (e) {
        // Ignore listener errors
      }
    }
    for (const listener of this._idTokenListeners) {
      try {
        listener(this._currentUser)
      } catch (e) {
        // Ignore listener errors
      }
    }
  }

  beforeAuthStateChanged(
    callback: (user: User | null) => void | Promise<void>,
    onAbort?: () => void
  ): () => void {
    const entry = { callback, onAbort }
    this._beforeAuthStateListeners.add(entry)
    return () => {
      this._beforeAuthStateListeners.delete(entry)
    }
  }

  onAuthStateChanged(
    nextOrObserver:
      | ((user: User | null) => void)
      | { next: (user: User | null) => void; error?: (error: Error) => void },
    error?: (error: Error) => void,
    completed?: () => void
  ): () => void {
    const callback = typeof nextOrObserver === 'function' ? nextOrObserver : nextOrObserver.next
    this._authStateListeners.add(callback)

    // Call immediately with current state
    setTimeout(() => callback(this._currentUser), 0)

    return () => {
      this._authStateListeners.delete(callback)
    }
  }

  onIdTokenChanged(
    nextOrObserver:
      | ((user: User | null) => void)
      | { next: (user: User | null) => void; error?: (error: Error) => void },
    error?: (error: Error) => void,
    completed?: () => void
  ): () => void {
    const callback = typeof nextOrObserver === 'function' ? nextOrObserver : nextOrObserver.next
    this._idTokenListeners.add(callback)

    // Call immediately with current state
    setTimeout(() => callback(this._currentUser), 0)

    return () => {
      this._idTokenListeners.delete(callback)
    }
  }

  async setPersistence(persistence: Persistence): Promise<void> {
    this._persistence = persistence
  }

  useDeviceLanguage(): void {
    // In a browser, would use navigator.language
    this.languageCode = 'en'
  }

  async signOut(): Promise<void> {
    this._setCurrentUser(null)
  }

  async updateCurrentUser(user: User | null): Promise<void> {
    if (user) {
      // Verify the user exists
      const stored = storage.users.get(user.uid)
      if (!stored) {
        throw new FirebaseAuthError('auth/user-not-found', 'User not found')
      }
    }
    this._setCurrentUser(user)
  }
}

// ============================================================================
// AUTH FACTORY
// ============================================================================

/**
 * Get the Auth instance for an app
 */
export function getAuth(app?: { name: string; options: AuthConfig }): Auth {
  const name = app?.name ?? '[DEFAULT]'

  if (!authInstances.has(name)) {
    const config = app?.options ?? { apiKey: 'test-api-key' }
    authInstances.set(name, new AuthImpl(config, name))
  }

  return authInstances.get(name)!
}

/**
 * Initialize Auth with dependencies
 */
export function initializeAuth(
  app: { name: string; options: AuthConfig },
  deps?: { persistence?: Persistence[] }
): Auth {
  const auth = getAuth(app)
  if (deps?.persistence?.[0]) {
    auth.setPersistence(deps.persistence[0])
  }
  return auth
}

/**
 * Connect to auth emulator
 */
export function connectAuthEmulator(
  auth: Auth,
  url: string,
  options?: { disableWarnings?: boolean }
): void {
  // In-memory implementation doesn't need emulator
  const urlObj = new URL(url)
  ;(auth as any).emulatorConfig = {
    host: urlObj.hostname,
    port: parseInt(urlObj.port || '9099'),
  }
}

// ============================================================================
// EMAIL/PASSWORD AUTHENTICATION
// ============================================================================

/**
 * Create user with email and password
 */
export async function createUserWithEmailAndPassword(
  auth: Auth,
  email: string,
  password: string
): Promise<UserCredential> {
  // Validate
  if (!email) {
    throw new FirebaseAuthError('auth/missing-email', 'Email is required')
  }
  if (!isValidEmail(email)) {
    throw new FirebaseAuthError('auth/invalid-email', 'Invalid email format')
  }
  if (!password) {
    throw new FirebaseAuthError('auth/missing-password', 'Password is required')
  }
  if (isWeakPassword(password)) {
    throw new FirebaseAuthError('auth/weak-password', 'Password must be at least 6 characters')
  }

  const normalizedEmail = email.toLowerCase()

  // Check if email exists
  if (storage.usersByEmail.has(normalizedEmail)) {
    throw new FirebaseAuthError('auth/email-already-in-use', 'Email already in use')
  }

  // Create user
  const uid = generateId()
  const now = new Date().toISOString()
  const passwordHash = await hashPassword(password)

  const stored: StoredUser = {
    uid,
    email,
    emailVerified: false,
    displayName: null,
    photoURL: null,
    phoneNumber: null,
    isAnonymous: false,
    passwordHash,
    providerData: [
      {
        providerId: 'password',
        uid: email,
        displayName: null,
        email,
        phoneNumber: null,
        photoURL: null,
      },
    ],
    metadata: {
      creationTime: now,
      lastSignInTime: now,
    },
    tenantId: auth.tenantId,
    disabled: false,
  }

  storage.users.set(uid, stored)
  storage.usersByEmail.set(normalizedEmail, uid)

  const user = new UserImpl(stored, auth as AuthImpl)
  ;(auth as AuthImpl)._setCurrentUser(user)

  return {
    user,
    providerId: 'password',
    operationType: 'signIn',
    _additionalUserInfo: {
      isNewUser: true,
      providerId: 'password',
      profile: null,
    },
  }
}

/**
 * Sign in with email and password
 */
export async function signInWithEmailAndPassword(
  auth: Auth,
  email: string,
  password: string
): Promise<UserCredential> {
  if (!email) {
    throw new FirebaseAuthError('auth/missing-email', 'Email is required')
  }
  if (!isValidEmail(email)) {
    throw new FirebaseAuthError('auth/invalid-email', 'Invalid email format')
  }
  if (!password) {
    throw new FirebaseAuthError('auth/missing-password', 'Password is required')
  }

  const normalizedEmail = email.toLowerCase()
  const uid = storage.usersByEmail.get(normalizedEmail)

  if (!uid) {
    throw new FirebaseAuthError('auth/user-not-found', 'User not found')
  }

  const stored = storage.users.get(uid)
  if (!stored) {
    throw new FirebaseAuthError('auth/user-not-found', 'User not found')
  }

  if (stored.disabled) {
    throw new FirebaseAuthError('auth/user-disabled', 'User account is disabled')
  }

  if (!stored.passwordHash) {
    throw new FirebaseAuthError('auth/wrong-password', 'Invalid password')
  }

  const isValid = await verifyPassword(password, stored.passwordHash)
  if (!isValid) {
    throw new FirebaseAuthError('auth/wrong-password', 'Invalid password')
  }

  // Update last sign-in
  stored.metadata.lastSignInTime = new Date().toISOString()

  const user = new UserImpl(stored, auth as AuthImpl)
  ;(auth as AuthImpl)._setCurrentUser(user)

  return {
    user,
    providerId: 'password',
    operationType: 'signIn',
    _additionalUserInfo: {
      isNewUser: false,
      providerId: 'password',
      profile: null,
    },
  }
}

// ============================================================================
// EMAIL LINK AUTHENTICATION
// ============================================================================

/**
 * Send sign-in link to email
 */
export async function sendSignInLinkToEmail(
  auth: Auth,
  email: string,
  actionCodeSettings: ActionCodeSettings
): Promise<void> {
  if (!isValidEmail(email)) {
    throw new FirebaseAuthError('auth/invalid-email', 'Invalid email format')
  }

  const token = generateToken()
  storage.emailSignInLinks.set(token, {
    email,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
  })

  // In real implementation, would send email with link
  // For testing, the token is stored and can be verified
}

/**
 * Check if email link is sign-in link
 */
export function isSignInWithEmailLink(auth: Auth, emailLink: string): boolean {
  // Check if the link contains a valid token
  try {
    const url = new URL(emailLink)
    const token = url.searchParams.get('oobCode')
    if (!token) return false

    const linkData = storage.emailSignInLinks.get(token)
    return linkData !== undefined && linkData.expiresAt > Date.now()
  } catch {
    return false
  }
}

/**
 * Sign in with email link
 */
export async function signInWithEmailLink(
  auth: Auth,
  email: string,
  emailLink: string
): Promise<UserCredential> {
  if (!isValidEmail(email)) {
    throw new FirebaseAuthError('auth/invalid-email', 'Invalid email format')
  }

  let token: string
  try {
    const url = new URL(emailLink)
    token = url.searchParams.get('oobCode') ?? ''
  } catch {
    throw new FirebaseAuthError('auth/invalid-action-code', 'Invalid email link')
  }

  const linkData = storage.emailSignInLinks.get(token)
  if (!linkData) {
    throw new FirebaseAuthError('auth/invalid-action-code', 'Invalid or expired link')
  }

  if (linkData.expiresAt < Date.now()) {
    storage.emailSignInLinks.delete(token)
    throw new FirebaseAuthError('auth/expired-action-code', 'Link has expired')
  }

  if (linkData.email.toLowerCase() !== email.toLowerCase()) {
    throw new FirebaseAuthError('auth/invalid-email', 'Email does not match')
  }

  // Delete the used token
  storage.emailSignInLinks.delete(token)

  const normalizedEmail = email.toLowerCase()
  let uid = storage.usersByEmail.get(normalizedEmail)
  let isNewUser = false

  if (!uid) {
    // Create new user
    uid = generateId()
    isNewUser = true
    const now = new Date().toISOString()

    const stored: StoredUser = {
      uid,
      email,
      emailVerified: true, // Email link verifies the email
      displayName: null,
      photoURL: null,
      phoneNumber: null,
      isAnonymous: false,
      passwordHash: null,
      providerData: [
        {
          providerId: 'emailLink',
          uid: email,
          displayName: null,
          email,
          phoneNumber: null,
          photoURL: null,
        },
      ],
      metadata: {
        creationTime: now,
        lastSignInTime: now,
      },
      tenantId: auth.tenantId,
      disabled: false,
    }

    storage.users.set(uid, stored)
    storage.usersByEmail.set(normalizedEmail, uid)
  }

  const stored = storage.users.get(uid)!
  stored.emailVerified = true
  stored.metadata.lastSignInTime = new Date().toISOString()

  const user = new UserImpl(stored, auth as AuthImpl)
  ;(auth as AuthImpl)._setCurrentUser(user)

  return {
    user,
    providerId: 'emailLink',
    operationType: 'signIn',
    _additionalUserInfo: {
      isNewUser,
      providerId: 'emailLink',
      profile: null,
    },
  }
}

// ============================================================================
// ANONYMOUS AUTHENTICATION
// ============================================================================

/**
 * Sign in anonymously
 */
export async function signInAnonymously(auth: Auth): Promise<UserCredential> {
  const uid = generateId()
  const now = new Date().toISOString()

  const stored: StoredUser = {
    uid,
    email: null,
    emailVerified: false,
    displayName: null,
    photoURL: null,
    phoneNumber: null,
    isAnonymous: true,
    passwordHash: null,
    providerData: [],
    metadata: {
      creationTime: now,
      lastSignInTime: now,
    },
    tenantId: auth.tenantId,
    disabled: false,
  }

  storage.users.set(uid, stored)

  const user = new UserImpl(stored, auth as AuthImpl)
  ;(auth as AuthImpl)._setCurrentUser(user)

  return {
    user,
    providerId: null,
    operationType: 'signIn',
    _additionalUserInfo: {
      isNewUser: true,
      providerId: null,
      profile: null,
    },
  }
}

// ============================================================================
// PHONE AUTHENTICATION
// ============================================================================

/**
 * Sign in with phone number
 */
export async function signInWithPhoneNumber(
  auth: Auth,
  phoneNumber: string,
  appVerifier: ApplicationVerifier
): Promise<ConfirmationResult> {
  // Verify reCAPTCHA (mock in testing)
  await appVerifier.verify()

  const verificationId = generateToken()
  const code = Math.floor(100000 + Math.random() * 900000).toString()

  storage.phoneVerifications.set(verificationId, {
    phoneNumber,
    code,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  })

  // In real implementation, would send SMS
  // For testing, code is available via _getVerificationCode

  return {
    verificationId,
    async confirm(verificationCode: string): Promise<UserCredential> {
      const verification = storage.phoneVerifications.get(verificationId)
      if (!verification) {
        throw new FirebaseAuthError('auth/invalid-verification-id', 'Invalid verification ID')
      }

      if (verification.expiresAt < Date.now()) {
        storage.phoneVerifications.delete(verificationId)
        throw new FirebaseAuthError('auth/code-expired', 'Verification code expired')
      }

      if (verification.code !== verificationCode) {
        throw new FirebaseAuthError('auth/invalid-verification-code', 'Invalid verification code')
      }

      storage.phoneVerifications.delete(verificationId)

      // Check if user with this phone exists
      let uid = storage.usersByPhone.get(phoneNumber)
      let isNewUser = false

      if (!uid) {
        uid = generateId()
        isNewUser = true
        const now = new Date().toISOString()

        const stored: StoredUser = {
          uid,
          email: null,
          emailVerified: false,
          displayName: null,
          photoURL: null,
          phoneNumber,
          isAnonymous: false,
          passwordHash: null,
          providerData: [
            {
              providerId: 'phone',
              uid: phoneNumber,
              displayName: null,
              email: null,
              phoneNumber,
              photoURL: null,
            },
          ],
          metadata: {
            creationTime: now,
            lastSignInTime: now,
          },
          tenantId: auth.tenantId,
          disabled: false,
        }

        storage.users.set(uid, stored)
        storage.usersByPhone.set(phoneNumber, uid)
      }

      const stored = storage.users.get(uid)!
      stored.metadata.lastSignInTime = new Date().toISOString()

      const user = new UserImpl(stored, auth as AuthImpl)
      ;(auth as AuthImpl)._setCurrentUser(user)

      return {
        user,
        providerId: 'phone',
        operationType: 'signIn',
        _additionalUserInfo: {
          isNewUser,
          providerId: 'phone',
          profile: null,
        },
      }
    },
  }
}

/**
 * Get verification code for testing
 * @internal
 */
export function _getVerificationCode(verificationId: string): string | null {
  const verification = storage.phoneVerifications.get(verificationId)
  return verification?.code ?? null
}

// ============================================================================
// CUSTOM TOKEN AUTHENTICATION
// ============================================================================

/**
 * Sign in with custom token
 */
export async function signInWithCustomToken(auth: Auth, customToken: string): Promise<UserCredential> {
  const tokenData = storage.customTokens.get(customToken)
  if (!tokenData) {
    throw new FirebaseAuthError('auth/invalid-credential', 'Invalid custom token')
  }

  let stored = storage.users.get(tokenData.uid)
  let isNewUser = false

  if (!stored) {
    isNewUser = true
    const now = new Date().toISOString()

    stored = {
      uid: tokenData.uid,
      email: null,
      emailVerified: false,
      displayName: null,
      photoURL: null,
      phoneNumber: null,
      isAnonymous: false,
      passwordHash: null,
      providerData: [],
      metadata: {
        creationTime: now,
        lastSignInTime: now,
      },
      tenantId: auth.tenantId,
      disabled: false,
      customClaims: tokenData.claims,
    }

    storage.users.set(tokenData.uid, stored)
  } else {
    stored.customClaims = tokenData.claims
    stored.metadata.lastSignInTime = new Date().toISOString()
  }

  const user = new UserImpl(stored, auth as AuthImpl)
  ;(auth as AuthImpl)._setCurrentUser(user)

  // Delete used token
  storage.customTokens.delete(customToken)

  return {
    user,
    providerId: 'custom',
    operationType: 'signIn',
    _additionalUserInfo: {
      isNewUser,
      providerId: 'custom',
      profile: null,
    },
  }
}

/**
 * Create custom token for testing
 * @internal
 */
export function _createCustomToken(uid: string, claims: Record<string, unknown> = {}): string {
  const token = generateToken()
  storage.customTokens.set(token, { uid, claims })
  return token
}

// ============================================================================
// OAUTH AUTHENTICATION
// ============================================================================

/**
 * OAuth provider base
 */
export class OAuthProvider implements AuthProvider {
  readonly providerId: string
  private _scopes: string[] = []
  private _customParameters: Record<string, string> = {}

  constructor(providerId: string) {
    this.providerId = providerId
  }

  addScope(scope: string): OAuthProvider {
    this._scopes.push(scope)
    return this
  }

  setCustomParameters(customParameters: Record<string, string>): OAuthProvider {
    this._customParameters = customParameters
    return this
  }

  static credentialFromResult(userCredential: UserCredential): OAuthCredential | null {
    // In real implementation, would extract OAuth tokens
    return null
  }

  static credentialFromError(error: Error): OAuthCredential | null {
    return null
  }
}

/**
 * Google Auth Provider
 */
export class GoogleAuthProvider extends OAuthProvider {
  static readonly PROVIDER_ID = 'google.com'

  constructor() {
    super('google.com')
  }

  static credential(idToken?: string | null, accessToken?: string | null): AuthCredential {
    return {
      providerId: 'google.com',
      signInMethod: 'google.com',
      toJSON: () => ({ providerId: 'google.com', idToken, accessToken }),
    }
  }
}

/**
 * Facebook Auth Provider
 */
export class FacebookAuthProvider extends OAuthProvider {
  static readonly PROVIDER_ID = 'facebook.com'

  constructor() {
    super('facebook.com')
  }

  static credential(accessToken: string): AuthCredential {
    return {
      providerId: 'facebook.com',
      signInMethod: 'facebook.com',
      toJSON: () => ({ providerId: 'facebook.com', accessToken }),
    }
  }
}

/**
 * Twitter Auth Provider
 */
export class TwitterAuthProvider extends OAuthProvider {
  static readonly PROVIDER_ID = 'twitter.com'

  constructor() {
    super('twitter.com')
  }

  static credential(token: string, secret: string): AuthCredential {
    return {
      providerId: 'twitter.com',
      signInMethod: 'twitter.com',
      toJSON: () => ({ providerId: 'twitter.com', token, secret }),
    }
  }
}

/**
 * GitHub Auth Provider
 */
export class GithubAuthProvider extends OAuthProvider {
  static readonly PROVIDER_ID = 'github.com'

  constructor() {
    super('github.com')
  }

  static credential(accessToken: string): AuthCredential {
    return {
      providerId: 'github.com',
      signInMethod: 'github.com',
      toJSON: () => ({ providerId: 'github.com', accessToken }),
    }
  }
}

/**
 * Sign in with popup (simulated for in-memory)
 */
export async function signInWithPopup(
  auth: Auth,
  provider: AuthProvider
): Promise<UserCredential> {
  // Simulate OAuth sign-in with mock user
  const uid = generateId()
  const now = new Date().toISOString()
  const email = `user-${uid.slice(0, 8)}@${provider.providerId.replace('.com', '')}.example.com`

  const stored: StoredUser = {
    uid,
    email,
    emailVerified: true, // OAuth emails are verified
    displayName: `User from ${provider.providerId}`,
    photoURL: `https://example.com/photos/${uid}`,
    phoneNumber: null,
    isAnonymous: false,
    passwordHash: null,
    providerData: [
      {
        providerId: provider.providerId,
        uid: uid,
        displayName: `User from ${provider.providerId}`,
        email,
        phoneNumber: null,
        photoURL: `https://example.com/photos/${uid}`,
      },
    ],
    metadata: {
      creationTime: now,
      lastSignInTime: now,
    },
    tenantId: auth.tenantId,
    disabled: false,
  }

  storage.users.set(uid, stored)
  storage.usersByEmail.set(email.toLowerCase(), uid)

  const user = new UserImpl(stored, auth as AuthImpl)
  ;(auth as AuthImpl)._setCurrentUser(user)

  return {
    user,
    providerId: provider.providerId,
    operationType: 'signIn',
    _additionalUserInfo: {
      isNewUser: true,
      providerId: provider.providerId,
      profile: { id: uid, name: `User from ${provider.providerId}` },
    },
  }
}

/**
 * Sign in with redirect (simulated)
 */
export async function signInWithRedirect(auth: Auth, provider: AuthProvider): Promise<void> {
  // Store state for redirect
  const state = generateToken()
  storage.oauthStates.set(state, {
    providerId: provider.providerId,
    redirectUrl: typeof window !== 'undefined' ? window.location.href : '',
  })
}

/**
 * Get redirect result
 */
export async function getRedirectResult(auth: Auth): Promise<UserCredential | null> {
  // In browser, would check URL for OAuth callback
  // For in-memory testing, return null (no pending redirect)
  return null
}

/**
 * Sign in with credential
 */
export async function signInWithCredential(
  auth: Auth,
  credential: AuthCredential
): Promise<UserCredential> {
  // Simulate credential sign-in
  const uid = generateId()
  const now = new Date().toISOString()

  const stored: StoredUser = {
    uid,
    email: null,
    emailVerified: false,
    displayName: null,
    photoURL: null,
    phoneNumber: null,
    isAnonymous: false,
    passwordHash: null,
    providerData: [
      {
        providerId: credential.providerId,
        uid,
        displayName: null,
        email: null,
        phoneNumber: null,
        photoURL: null,
      },
    ],
    metadata: {
      creationTime: now,
      lastSignInTime: now,
    },
    tenantId: auth.tenantId,
    disabled: false,
  }

  storage.users.set(uid, stored)

  const user = new UserImpl(stored, auth as AuthImpl)
  ;(auth as AuthImpl)._setCurrentUser(user)

  return {
    user,
    providerId: credential.providerId,
    operationType: 'signIn',
    _additionalUserInfo: {
      isNewUser: true,
      providerId: credential.providerId,
      profile: null,
    },
  }
}

// ============================================================================
// PASSWORD RESET
// ============================================================================

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  auth: Auth,
  email: string,
  actionCodeSettings?: ActionCodeSettings
): Promise<void> {
  if (!isValidEmail(email)) {
    throw new FirebaseAuthError('auth/invalid-email', 'Invalid email format')
  }

  const normalizedEmail = email.toLowerCase()
  const uid = storage.usersByEmail.get(normalizedEmail)

  if (!uid) {
    // Firebase doesn't reveal if email exists for security
    return
  }

  const token = generateToken()
  storage.passwordResetTokens.set(token, {
    email,
    expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour
  })

  // In real implementation, would send email
}

/**
 * Confirm password reset
 */
export async function confirmPasswordReset(
  auth: Auth,
  oobCode: string,
  newPassword: string
): Promise<void> {
  if (isWeakPassword(newPassword)) {
    throw new FirebaseAuthError('auth/weak-password', 'Password must be at least 6 characters')
  }

  const tokenData = storage.passwordResetTokens.get(oobCode)
  if (!tokenData) {
    throw new FirebaseAuthError('auth/invalid-action-code', 'Invalid or expired code')
  }

  if (tokenData.expiresAt < Date.now()) {
    storage.passwordResetTokens.delete(oobCode)
    throw new FirebaseAuthError('auth/expired-action-code', 'Code has expired')
  }

  const uid = storage.usersByEmail.get(tokenData.email.toLowerCase())
  if (!uid) {
    throw new FirebaseAuthError('auth/user-not-found', 'User not found')
  }

  const stored = storage.users.get(uid)
  if (!stored) {
    throw new FirebaseAuthError('auth/user-not-found', 'User not found')
  }

  stored.passwordHash = await hashPassword(newPassword)
  storage.passwordResetTokens.delete(oobCode)
}

/**
 * Verify password reset code
 */
export async function verifyPasswordResetCode(auth: Auth, oobCode: string): Promise<string> {
  const tokenData = storage.passwordResetTokens.get(oobCode)
  if (!tokenData) {
    throw new FirebaseAuthError('auth/invalid-action-code', 'Invalid or expired code')
  }

  if (tokenData.expiresAt < Date.now()) {
    storage.passwordResetTokens.delete(oobCode)
    throw new FirebaseAuthError('auth/expired-action-code', 'Code has expired')
  }

  return tokenData.email
}

// ============================================================================
// EMAIL VERIFICATION
// ============================================================================

/**
 * Send email verification
 */
export async function sendEmailVerification(
  user: User,
  actionCodeSettings?: ActionCodeSettings
): Promise<void> {
  if (!user.email) {
    throw new FirebaseAuthError('auth/missing-email', 'User has no email')
  }

  const token = generateToken()
  storage.emailVerificationTokens.set(token, {
    uid: user.uid,
    email: user.email,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
  })

  // In real implementation, would send email
}

/**
 * Apply action code (for email verification, etc.)
 */
export async function applyActionCode(auth: Auth, oobCode: string): Promise<void> {
  // Try email verification first
  const verificationData = storage.emailVerificationTokens.get(oobCode)
  if (verificationData) {
    if (verificationData.expiresAt < Date.now()) {
      storage.emailVerificationTokens.delete(oobCode)
      throw new FirebaseAuthError('auth/expired-action-code', 'Code has expired')
    }

    const stored = storage.users.get(verificationData.uid)
    if (stored) {
      stored.emailVerified = true
      storage.emailVerificationTokens.delete(oobCode)
      return
    }
  }

  throw new FirebaseAuthError('auth/invalid-action-code', 'Invalid action code')
}

/**
 * Check action code
 */
export async function checkActionCode(auth: Auth, oobCode: string): Promise<ActionCodeInfo> {
  // Check email verification tokens
  const verificationData = storage.emailVerificationTokens.get(oobCode)
  if (verificationData) {
    if (verificationData.expiresAt < Date.now()) {
      throw new FirebaseAuthError('auth/expired-action-code', 'Code has expired')
    }

    return {
      operation: 'VERIFY_EMAIL',
      data: {
        email: verificationData.email,
      },
    }
  }

  // Check password reset tokens
  const resetData = storage.passwordResetTokens.get(oobCode)
  if (resetData) {
    if (resetData.expiresAt < Date.now()) {
      throw new FirebaseAuthError('auth/expired-action-code', 'Code has expired')
    }

    return {
      operation: 'PASSWORD_RESET',
      data: {
        email: resetData.email,
      },
    }
  }

  throw new FirebaseAuthError('auth/invalid-action-code', 'Invalid action code')
}

// ============================================================================
// USER MANAGEMENT
// ============================================================================

/**
 * Update user profile
 */
export async function updateProfile(
  user: User,
  profile: { displayName?: string | null; photoURL?: string | null }
): Promise<void> {
  const stored = storage.users.get(user.uid)
  if (!stored) {
    throw new FirebaseAuthError('auth/user-not-found', 'User not found')
  }

  if ('displayName' in profile) {
    stored.displayName = profile.displayName ?? null
  }
  if ('photoURL' in profile) {
    stored.photoURL = profile.photoURL ?? null
  }

  // Update provider data
  for (const provider of stored.providerData) {
    if ('displayName' in profile) {
      provider.displayName = stored.displayName
    }
    if ('photoURL' in profile) {
      provider.photoURL = stored.photoURL
    }
  }
}

/**
 * Update user email
 */
export async function updateEmail(user: User, newEmail: string): Promise<void> {
  if (!isValidEmail(newEmail)) {
    throw new FirebaseAuthError('auth/invalid-email', 'Invalid email format')
  }

  const stored = storage.users.get(user.uid)
  if (!stored) {
    throw new FirebaseAuthError('auth/user-not-found', 'User not found')
  }

  const normalizedNewEmail = newEmail.toLowerCase()

  // Check if new email is already in use
  const existingUid = storage.usersByEmail.get(normalizedNewEmail)
  if (existingUid && existingUid !== user.uid) {
    throw new FirebaseAuthError('auth/email-already-in-use', 'Email already in use')
  }

  // Update indexes
  if (stored.email) {
    storage.usersByEmail.delete(stored.email.toLowerCase())
  }
  storage.usersByEmail.set(normalizedNewEmail, user.uid)

  stored.email = newEmail
  stored.emailVerified = false // New email needs verification

  // Update provider data
  for (const provider of stored.providerData) {
    if (provider.providerId === 'password') {
      provider.email = newEmail
      provider.uid = newEmail
    }
  }
}

/**
 * Verify before update email
 */
export async function verifyBeforeUpdateEmail(
  user: User,
  newEmail: string,
  actionCodeSettings?: ActionCodeSettings
): Promise<void> {
  if (!isValidEmail(newEmail)) {
    throw new FirebaseAuthError('auth/invalid-email', 'Invalid email format')
  }

  const normalizedNewEmail = newEmail.toLowerCase()
  if (storage.usersByEmail.has(normalizedNewEmail)) {
    throw new FirebaseAuthError('auth/email-already-in-use', 'Email already in use')
  }

  // Would send verification email to new address
}

/**
 * Update user password
 */
export async function updatePassword(user: User, newPassword: string): Promise<void> {
  if (isWeakPassword(newPassword)) {
    throw new FirebaseAuthError('auth/weak-password', 'Password must be at least 6 characters')
  }

  const stored = storage.users.get(user.uid)
  if (!stored) {
    throw new FirebaseAuthError('auth/user-not-found', 'User not found')
  }

  stored.passwordHash = await hashPassword(newPassword)
}

/**
 * Reauthenticate with credential
 */
export async function reauthenticateWithCredential(
  user: User,
  credential: AuthCredential
): Promise<UserCredential> {
  const stored = storage.users.get(user.uid)
  if (!stored) {
    throw new FirebaseAuthError('auth/user-not-found', 'User not found')
  }

  // For email/password credential, verify password
  if (credential.providerId === 'password') {
    const credentialData = credential.toJSON() as { password?: string }
    if (credentialData.password && stored.passwordHash) {
      const isValid = await verifyPassword(credentialData.password, stored.passwordHash)
      if (!isValid) {
        throw new FirebaseAuthError('auth/wrong-password', 'Invalid password')
      }
    }
  }

  return {
    user: user,
    providerId: credential.providerId,
    operationType: 'reauthenticate',
  }
}

/**
 * Delete user
 */
export async function deleteUser(user: User): Promise<void> {
  return user.delete()
}

// ============================================================================
// LINK/UNLINK PROVIDERS
// ============================================================================

/**
 * Link with credential
 */
export async function linkWithCredential(
  user: User,
  credential: AuthCredential
): Promise<UserCredential> {
  const stored = storage.users.get(user.uid)
  if (!stored) {
    throw new FirebaseAuthError('auth/user-not-found', 'User not found')
  }

  // Check if provider already linked
  const existingProvider = stored.providerData.find((p) => p.providerId === credential.providerId)
  if (existingProvider) {
    throw new FirebaseAuthError('auth/credential-already-in-use', 'Provider already linked')
  }

  // Add provider
  stored.providerData.push({
    providerId: credential.providerId,
    uid: generateId(),
    displayName: stored.displayName,
    email: stored.email,
    phoneNumber: stored.phoneNumber,
    photoURL: stored.photoURL,
  })

  // If linking email/password, set password
  if (credential.providerId === 'password') {
    const credentialData = credential.toJSON() as { email?: string; password?: string }
    if (credentialData.email) {
      stored.email = credentialData.email
      storage.usersByEmail.set(credentialData.email.toLowerCase(), user.uid)
    }
    if (credentialData.password) {
      stored.passwordHash = await hashPassword(credentialData.password)
    }
  }

  // If user was anonymous, mark as not anonymous
  if (stored.isAnonymous) {
    stored.isAnonymous = false
  }

  return {
    user,
    providerId: credential.providerId,
    operationType: 'link',
  }
}

/**
 * Unlink provider
 */
export async function unlink(user: User, providerId: string): Promise<User> {
  const stored = storage.users.get(user.uid)
  if (!stored) {
    throw new FirebaseAuthError('auth/user-not-found', 'User not found')
  }

  const providerIndex = stored.providerData.findIndex((p) => p.providerId === providerId)
  if (providerIndex === -1) {
    throw new FirebaseAuthError('auth/invalid-credential', 'Provider not linked')
  }

  stored.providerData.splice(providerIndex, 1)

  // If unlinking password provider, clear password
  if (providerId === 'password') {
    stored.passwordHash = null
  }

  // If unlinking phone provider, clear phone
  if (providerId === 'phone') {
    if (stored.phoneNumber) {
      storage.usersByPhone.delete(stored.phoneNumber)
    }
    stored.phoneNumber = null
  }

  return user
}

// ============================================================================
// ID TOKEN VERIFICATION
// ============================================================================

/**
 * Verify ID token (for testing/admin purposes)
 * @internal
 */
export async function _verifyIdToken(token: string): Promise<IdTokenData | null> {
  return parseJWT(token)
}

// ============================================================================
// EMAIL AUTH PROVIDER
// ============================================================================

/**
 * Email auth provider
 */
export class EmailAuthProvider {
  static readonly PROVIDER_ID = 'password'
  static readonly EMAIL_LINK_SIGN_IN_METHOD = 'emailLink'
  static readonly EMAIL_PASSWORD_SIGN_IN_METHOD = 'password'

  static credential(email: string, password: string): AuthCredential {
    return {
      providerId: 'password',
      signInMethod: 'password',
      toJSON: () => ({ providerId: 'password', email, password }),
    }
  }

  static credentialWithLink(email: string, emailLink: string): AuthCredential {
    return {
      providerId: 'password',
      signInMethod: 'emailLink',
      toJSON: () => ({ providerId: 'password', email, emailLink }),
    }
  }
}

// ============================================================================
// PHONE AUTH PROVIDER
// ============================================================================

/**
 * Phone auth provider
 */
export class PhoneAuthProvider {
  static readonly PROVIDER_ID = 'phone'
  static readonly PHONE_SIGN_IN_METHOD = 'phone'

  private _auth: Auth

  constructor(auth: Auth) {
    this._auth = auth
  }

  async verifyPhoneNumber(
    phoneNumber: string,
    appVerifier: ApplicationVerifier
  ): Promise<string> {
    await appVerifier.verify()

    const verificationId = generateToken()
    const code = Math.floor(100000 + Math.random() * 900000).toString()

    storage.phoneVerifications.set(verificationId, {
      phoneNumber,
      code,
      expiresAt: Date.now() + 10 * 60 * 1000,
    })

    return verificationId
  }

  static credential(verificationId: string, verificationCode: string): AuthCredential {
    return {
      providerId: 'phone',
      signInMethod: 'phone',
      toJSON: () => ({ providerId: 'phone', verificationId, verificationCode }),
    }
  }
}

// ============================================================================
// RECAPTCHA VERIFIER (MOCK)
// ============================================================================

/**
 * Mock reCAPTCHA verifier for testing
 */
export class RecaptchaVerifier implements ApplicationVerifier {
  readonly type = 'recaptcha'

  constructor(
    container: string | HTMLElement,
    parameters?: Record<string, unknown>,
    auth?: Auth
  ) {
    // In-memory implementation doesn't need actual reCAPTCHA
  }

  async verify(): Promise<string> {
    return 'mock-recaptcha-token'
  }

  clear(): void {
    // No-op
  }

  render(): Promise<number> {
    return Promise.resolve(0)
  }
}

// ============================================================================
// FETCH SIGN-IN METHODS
// ============================================================================

/**
 * Fetch sign-in methods for email
 */
export async function fetchSignInMethodsForEmail(auth: Auth, email: string): Promise<string[]> {
  if (!isValidEmail(email)) {
    throw new FirebaseAuthError('auth/invalid-email', 'Invalid email format')
  }

  const normalizedEmail = email.toLowerCase()
  const uid = storage.usersByEmail.get(normalizedEmail)

  if (!uid) {
    return []
  }

  const stored = storage.users.get(uid)
  if (!stored) {
    return []
  }

  return stored.providerData.map((p) => p.providerId)
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Get additional user info
 */
export { getAdditionalUserInfo } from './types'

/**
 * Parse action code URL
 */
export function parseActionCodeURL(link: string): {
  apiKey: string
  code: string
  operation: string
} | null {
  try {
    const url = new URL(link)
    const code = url.searchParams.get('oobCode')
    const mode = url.searchParams.get('mode')
    const apiKey = url.searchParams.get('apiKey')

    if (!code || !mode) return null

    return {
      apiKey: apiKey ?? '',
      code,
      operation: mode,
    }
  } catch {
    return null
  }
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Reset all auth state (for testing)
 * @internal
 */
export function _resetAuthState(): void {
  storage.users.clear()
  storage.usersByEmail.clear()
  storage.usersByPhone.clear()
  storage.passwordResetTokens.clear()
  storage.emailVerificationTokens.clear()
  storage.emailSignInLinks.clear()
  storage.phoneVerifications.clear()
  storage.refreshTokens.clear()
  storage.customTokens.clear()
  storage.oauthStates.clear()

  for (const auth of authInstances.values()) {
    ;(auth as AuthImpl)._setCurrentUser(null)
  }
}

/**
 * Create user directly (for testing admin operations)
 * @internal
 */
export async function _createUser(data: Partial<StoredUser>): Promise<User> {
  const uid = data.uid ?? generateId()
  const now = new Date().toISOString()

  const stored: StoredUser = {
    uid,
    email: data.email ?? null,
    emailVerified: data.emailVerified ?? false,
    displayName: data.displayName ?? null,
    photoURL: data.photoURL ?? null,
    phoneNumber: data.phoneNumber ?? null,
    isAnonymous: data.isAnonymous ?? false,
    passwordHash: data.passwordHash ?? null,
    providerData: data.providerData ?? [],
    metadata: data.metadata ?? {
      creationTime: now,
      lastSignInTime: now,
    },
    tenantId: data.tenantId ?? null,
    disabled: data.disabled ?? false,
    customClaims: data.customClaims,
    mfaFactors: data.mfaFactors,
  }

  storage.users.set(uid, stored)

  if (stored.email) {
    storage.usersByEmail.set(stored.email.toLowerCase(), uid)
  }
  if (stored.phoneNumber) {
    storage.usersByPhone.set(stored.phoneNumber, uid)
  }

  const defaultAuth = authInstances.get('[DEFAULT]') ?? new AuthImpl({ apiKey: 'test' })
  return new UserImpl(stored, defaultAuth)
}

/**
 * Get stored user (for testing)
 * @internal
 */
export function _getStoredUser(uid: string): StoredUser | undefined {
  return storage.users.get(uid)
}

/**
 * Set custom claims (for testing admin operations)
 * @internal
 */
export async function _setCustomClaims(uid: string, claims: Record<string, unknown>): Promise<void> {
  const stored = storage.users.get(uid)
  if (!stored) {
    throw new FirebaseAuthError('auth/user-not-found', 'User not found')
  }
  stored.customClaims = claims
}

/**
 * Disable/enable user (for testing admin operations)
 * @internal
 */
export async function _setUserDisabled(uid: string, disabled: boolean): Promise<void> {
  const stored = storage.users.get(uid)
  if (!stored) {
    throw new FirebaseAuthError('auth/user-not-found', 'User not found')
  }
  stored.disabled = disabled
}

/**
 * Get password reset token (for testing)
 * @internal
 */
export function _getPasswordResetToken(email: string): string | null {
  for (const [token, data] of storage.passwordResetTokens) {
    if (data.email.toLowerCase() === email.toLowerCase()) {
      return token
    }
  }
  return null
}

/**
 * Get email verification token (for testing)
 * @internal
 */
export function _getEmailVerificationToken(uid: string): string | null {
  for (const [token, data] of storage.emailVerificationTokens) {
    if (data.uid === uid) {
      return token
    }
  }
  return null
}

/**
 * Get email sign-in link token (for testing)
 * @internal
 */
export function _getEmailSignInLinkToken(email: string): string | null {
  for (const [token, data] of storage.emailSignInLinks) {
    if (data.email.toLowerCase() === email.toLowerCase()) {
      return token
    }
  }
  return null
}
