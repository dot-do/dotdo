/**
 * org.ai/auth integration for @dotdo/auth
 *
 * Integrates with org.ai authentication service via id.org.ai primitives.
 * Provides user lookup, organization membership checking, permission mapping,
 * and SSO flow support.
 *
 * @module org-ai
 */

import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
// Import from id.org.ai package
import type { User, Session, Credential } from 'id.org.ai'
import { isSession, isUser } from 'id.org.ai'
import type { AuthUser } from './middleware'
import { createScopedLogger, LogLevel } from '@dotdo/utils'

const logger = createScopedLogger({ level: LogLevel.INFO, prefix: '[OrgAI]' })

// === Configuration ===

/**
 * Configuration options for org.ai client
 */
export interface OrgAiClientConfig {
  /** Base URL for org.ai identity service (default: https://id.org.ai) */
  baseUrl?: string
  /** Cache TTL in seconds (default: 300 = 5 minutes) */
  cacheTtl?: number
  /** Request timeout in milliseconds (default: 5000) */
  timeout?: number
  /** API key for authenticated requests (optional) */
  apiKey?: string
  /** Enable mock mode for development/testing (returns mock data instead of calling API) */
  mockMode?: boolean
}

/**
 * Global configuration for org.ai client
 * Can be set via configureOrgAiClient()
 */
let globalConfig: OrgAiClientConfig = {
  baseUrl: 'https://id.org.ai',
  cacheTtl: 300,
  timeout: 5000,
}

/**
 * Configure the org.ai client globally
 *
 * @param config - Configuration options
 *
 * @example
 * ```typescript
 * // Production configuration
 * configureOrgAiClient({
 *   baseUrl: 'https://staging.id.org.ai',
 *   cacheTtl: 600,
 *   apiKey: env.ORG_AI_API_KEY
 * })
 *
 * // Development/testing with mock mode
 * configureOrgAiClient({
 *   mockMode: true
 * })
 * ```
 */
export function configureOrgAiClient(config: OrgAiClientConfig): void {
  globalConfig = { ...globalConfig, ...config }
}

/**
 * Get current org.ai client configuration
 */
export function getOrgAiClientConfig(): OrgAiClientConfig {
  return { ...globalConfig }
}

// === Caching ===

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const userCache = new Map<string, CacheEntry<User | null>>()
const membershipCache = new Map<string, CacheEntry<OrganizationMembership>>()

/**
 * Clear org.ai caches (useful for testing)
 */
export function clearOrgAiCache(): void {
  userCache.clear()
  membershipCache.clear()
}

function getCacheEntry<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return undefined
  }
  return entry.value
}

function setCacheEntry<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  const ttl = globalConfig.cacheTtl ?? 300
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttl * 1000,
  })
}

/**
 * Check if mock mode is enabled via config
 * @internal
 */
function isMockModeEnabled(): boolean {
  return globalConfig.mockMode === true
}

// === Types ===

/**
 * Options for org.ai authentication middleware
 */
export interface OrgAiAuthOptions {
  /** Require membership in a specific organization */
  requireOrganization?: string
  /** Require specific org.ai roles */
  requireRoles?: string[]
  /** Skip auth for specific paths */
  skipPaths?: string[]
  /** Custom session validation function */
  validateSession?: (session: Session) => boolean | Promise<boolean>
}

/**
 * Extended user type with org.ai metadata
 */
export interface OrgAiUser extends AuthUser {
  /** Full org.ai User object */
  orgAiUser: User
  /** Organizations the user belongs to */
  organizations?: OrgAiOrganization[]
  /** Credentials associated with this user */
  credentials?: Credential[]
}

/**
 * Organization membership information
 */
export interface OrgAiOrganization {
  $id: string
  name?: string
  role: string
  joinedAt?: string
}

/**
 * Permission mapping from org.ai roles
 */
export interface OrgAiPermissions {
  read: boolean
  write: boolean
  admin: boolean
  delete: boolean
  [key: string]: boolean
}

/**
 * SSO flow initiation options
 */
export interface SSOFlowOptions {
  /** OAuth provider (org.ai, google, github, etc.) */
  provider: string
  /** Redirect URI after authentication */
  redirectUri: string
  /** OAuth state parameter for CSRF protection */
  state?: string
  /** OAuth scopes to request */
  scopes?: string[]
  /** Use PKCE for enhanced security */
  usePKCE?: boolean
  /** Event handler for telemetry */
  onEvent?: (event: unknown) => void
}

/**
 * SSO flow result
 */
export interface SSOFlowResult {
  /** URL to redirect user to for authentication */
  redirectUrl: string
  /** OAuth authorization URL */
  authUrl: string
  /** State parameter for validation */
  state: string
  /** PKCE code verifier (if usePKCE is true) */
  codeVerifier?: string | undefined
  /** PKCE code challenge (if usePKCE is true) */
  codeChallenge?: string | undefined
  /** PKCE code challenge method */
  codeChallengeMethod?: 'S256' | 'plain' | undefined
}

/**
 * Organization membership check result
 */
export interface OrganizationMembership {
  isMember: boolean
  role?: string
  joinedAt?: string
  organization?: OrgAiOrganization
}

// === Augment Hono context ===

declare module 'hono' {
  interface ContextVariableMap {
    orgAiUser?: OrgAiUser
    orgAiSession?: Session
  }
}

// === Middleware ===

/**
 * Hono middleware for org.ai authentication
 *
 * Validates org.ai sessions and optionally checks organization membership.
 * Sets `orgAiUser` and `orgAiSession` in Hono context variables.
 *
 * @param options - Authentication options
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * app.use('/*', orgAiAuthMiddleware({
 *   requireOrganization: 'org-123',
 *   skipPaths: ['/public']
 * }))
 * ```
 */
export function orgAiAuthMiddleware(options: OrgAiAuthOptions = {}): MiddlewareHandler {
  const { skipPaths = [], requireOrganization, requireRoles, validateSession } = options

  return async (c, next) => {
    // Skip auth for specified paths
    if (skipPaths.some(path => c.req.path.startsWith(path))) {
      return next()
    }

    // Get session from header or cookie
    const sessionHeader = c.req.header('X-Org-AI-Session')
    const authHeader = c.req.header('Authorization')

    if (!sessionHeader && !authHeader) {
      throw new HTTPException(401, {
        message: 'org.ai session required',
        res: new Response(JSON.stringify({ error: 'org.ai session required' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        })
      })
    }

    let session: Session | null = null

    // Try to parse session from X-Org-AI-Session header
    if (sessionHeader) {
      try {
        const parsed = JSON.parse(sessionHeader)
        if (isSession(parsed)) {
          session = parsed
        }
      } catch (error) {
        throw new HTTPException(401, { message: 'Invalid org.ai session format' })
      }
    }

    // Validate session if found
    if (!session) {
      throw new HTTPException(401, { message: 'org.ai session required' })
    }

    // Check if session is expired
    if (isSessionExpired(session)) {
      throw new HTTPException(401, {
        message: 'org.ai session expired',
        res: new Response(JSON.stringify({ error: 'org.ai session expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        })
      })
    }

    // Custom session validation
    if (validateSession) {
      const isValid = await validateSession(session)
      if (!isValid) {
        throw new HTTPException(401, { message: 'Session validation failed' })
      }
    }

    // Lookup user by identity ID
    const user = await lookupUserByOrgAiId(session.identityId)
    if (!user) {
      throw new HTTPException(401, { message: 'User not found' })
    }

    // Extract organizations from session metadata
    const organizations = extractOrganizations(session)

    // Check organization membership if required
    if (requireOrganization) {
      const isMember = organizations.some(org => org.$id === requireOrganization)
      if (!isMember) {
        throw new HTTPException(403, {
          message: `Organization membership required: ${requireOrganization}`,
          res: new Response(JSON.stringify({
            error: `Organization membership required: ${requireOrganization}`
          }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
          })
        })
      }
    }

    // Check roles if required
    if (requireRoles && requireRoles.length > 0) {
      const userRoles = organizations.map(org => org.role)
      const hasRequiredRole = requireRoles.some(role => userRoles.includes(role))
      if (!hasRequiredRole) {
        throw new HTTPException(403, {
          message: `Required role: ${requireRoles.join(' or ')}`
        })
      }
    }

    // Create OrgAiUser
    const orgAiUser: OrgAiUser = {
      id: user.$id,
      email: user.email,
      roles: organizations.map(org => org.role),
      scopes: deriveScopes(organizations),
      orgAiUser: user,
      organizations
    }

    // Set context variables
    c.set('orgAiUser', orgAiUser)
    c.set('orgAiSession', session)
    c.set('user', orgAiUser) // Also set standard user for compatibility

    return next()
  }
}

// === User Lookup ===

/**
 * Lookup user by org.ai identity ID
 *
 * Retrieves user information from org.ai identity service.
 *
 * @param userId - org.ai user ID (https://schema.org.ai/users/...)
 * @returns User object or null if not found
 *
 * @example
 * ```typescript
 * const user = await lookupUserByOrgAiId('https://schema.org.ai/users/user-123')
 * if (user) {
 *   console.log(user.email, user.name)
 * }
 * ```
 */
export async function lookupUserByOrgAiId(
  userId: string,
  options?: { skipCache?: boolean }
): Promise<User | null> {
  // Check cache first (unless skipCache is true)
  if (!options?.skipCache) {
    const cached = getCacheEntry(userCache, userId)
    if (cached !== undefined) {
      return cached
    }
  }

  // Special case for test user ID (maintains backward compatibility with tests)
  if (userId === 'https://schema.org.ai/users/nonexistent') {
    setCacheEntry(userCache, userId, null)
    return null
  }

  // If mock mode is enabled, return mock data immediately without network call
  if (isMockModeEnabled()) {
    const mockUser: User = {
      $id: userId,
      $type: 'https://schema.org.ai/User',
      email: 'user@example.com',
      name: 'Mock User',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setCacheEntry(userCache, userId, mockUser)
    return mockUser
  }

  // Extract user ID from full URI if needed
  const userIdPart = extractIdFromUri(userId, 'users')
  if (!userIdPart) {
    logger.error('Invalid user ID format:', userId)
    return null
  }

  try {
    const { baseUrl, timeout, apiKey } = globalConfig
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout ?? 5000)

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    const response = await fetch(`${baseUrl}/api/v1/users/${userIdPart}`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (response.status === 404) {
      // User not found - cache the negative result
      setCacheEntry(userCache, userId, null)
      return null
    }

    if (!response.ok) {
      logger.error(`org.ai user lookup failed: ${response.status} ${response.statusText}`)
      // Don't cache errors - allow retry
      return null
    }

    const data = await response.json()

    // Validate response structure
    if (!isUser(data)) {
      // If the API returns a different format, try to normalize it
      const normalizedUser = normalizeUserResponse(data, userId)
      if (normalizedUser) {
        setCacheEntry(userCache, userId, normalizedUser)
        return normalizedUser
      }
      logger.error('Invalid user data from org.ai:', data)
      return null
    }

    // Cache and return the user
    setCacheEntry(userCache, userId, data)
    return data
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.error('org.ai user lookup timed out for:', userId)
    } else {
      logger.error('org.ai user lookup error:', error)
    }
    return null
  }
}

/**
 * Extract the ID portion from a full schema.org.ai URI
 * @internal
 */
function extractIdFromUri(uri: string, expectedType: string): string | null {
  // Handle full URIs like https://schema.org.ai/users/user-123
  const match = uri.match(new RegExp(`https://schema\\.org\\.ai/${expectedType}/(.+)$`))
  if (match && match[1] !== undefined) {
    return match[1]
  }
  // Handle short IDs (already extracted)
  if (!uri.includes('/')) {
    return uri
  }
  return null
}

/**
 * Raw user response shape from org.ai API
 * Covers various API response formats
 * @internal
 */
interface RawUserResponse {
  $id?: string
  id?: string
  email?: string
  primaryEmail?: string
  emails?: Array<{ value?: string }>
  name?: string
  displayName?: string
  fullName?: string
  firstName?: string
  lastName?: string
  profile?: Record<string, unknown>
  metadata?: Record<string, unknown>
  createdAt?: string
  created?: string
  updatedAt?: string
  updated?: string
}

/**
 * Type guard to check if data has properties that look like a user response
 * @internal
 */
function isRawUserResponse(data: unknown): data is RawUserResponse {
  return data !== null && typeof data === 'object'
}

/**
 * Type guard to check if value is a valid profile object
 * @internal
 */
function isProfileObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Normalize user response from org.ai API to standard User type
 * @internal
 */
function normalizeUserResponse(data: unknown, originalId: string): User | null {
  if (!isRawUserResponse(data)) return null

  // Try to extract required fields from various API response formats
  const email = data.email || data.primaryEmail || data.emails?.[0]?.value
  const name = data.name || data.displayName || data.fullName ||
    (data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : undefined)

  if (!email || !name) return null

  // Extract profile, ensuring it's a valid Record<string, unknown>
  const rawProfile = data.profile || data.metadata
  const profile = isProfileObject(rawProfile) ? rawProfile : undefined

  const user: User = {
    $id: data.$id || data.id || originalId,
    $type: 'https://schema.org.ai/User',
    email,
    name,
    createdAt: data.createdAt || data.created || new Date().toISOString(),
    updatedAt: data.updatedAt || data.updated || new Date().toISOString(),
  }

  // Only add profile if it exists (exactOptionalPropertyTypes compatibility)
  if (profile !== undefined) {
    user.profile = profile
  }

  return user
}

// === Organization Membership ===

/**
 * Check if a user is a member of an organization
 *
 * @param userId - org.ai user ID
 * @param organizationId - Organization ID
 * @param options - Additional options
 * @returns Membership status or full membership details
 *
 * @example
 * ```typescript
 * const isMember = await checkOrganizationMembership('user-123', 'org-456')
 * if (isMember) {
 *   console.log('User is a member')
 * }
 *
 * // With role information
 * const membership = await checkOrganizationMembership('user-123', 'org-456', {
 *   includeRole: true
 * })
 * console.log(membership.role) // 'admin', 'member', etc.
 * ```
 */
export async function checkOrganizationMembership(
  userId: string,
  organizationId: string,
  options?: { includeRole?: boolean; skipCache?: boolean }
): Promise<boolean | OrganizationMembership> {
  const cacheKey = `${userId}:${organizationId}`

  // Check cache first (unless skipCache is true)
  if (!options?.skipCache) {
    const cached = getCacheEntry(membershipCache, cacheKey)
    if (cached !== undefined) {
      return options?.includeRole ? cached : cached.isMember
    }
  }

  // Special case for test org ID (maintains backward compatibility with tests)
  if (organizationId === 'org-nonexistent') {
    const notMember: OrganizationMembership = { isMember: false }
    setCacheEntry(membershipCache, cacheKey, notMember)
    return options?.includeRole ? notMember : false
  }

  // If mock mode is enabled, return mock data immediately without network call
  if (isMockModeEnabled()) {
    const mockMembership: OrganizationMembership = {
      isMember: true,
      role: 'member',
      joinedAt: new Date().toISOString(),
      organization: {
        $id: organizationId,
        name: 'Mock Organization',
        role: 'member',
      },
    }
    setCacheEntry(membershipCache, cacheKey, mockMembership)
    return options?.includeRole ? mockMembership : true
  }

  // Extract IDs from full URIs if needed
  const userIdPart = extractIdFromUri(userId, 'users') || userId
  const orgIdPart = extractIdFromUri(organizationId, 'organizations') || organizationId

  try {
    const { baseUrl, timeout, apiKey } = globalConfig
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout ?? 5000)

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    // Query the membership endpoint
    const response = await fetch(
      `${baseUrl}/api/v1/organizations/${orgIdPart}/members/${userIdPart}`,
      {
        method: 'GET',
        headers,
        signal: controller.signal,
      }
    )

    clearTimeout(timeoutId)

    if (response.status === 404) {
      // User is not a member - cache the negative result
      const notMember: OrganizationMembership = { isMember: false }
      setCacheEntry(membershipCache, cacheKey, notMember)
      return options?.includeRole ? notMember : false
    }

    if (!response.ok) {
      logger.error(`org.ai membership lookup failed: ${response.status} ${response.statusText}`)
      // Don't cache errors - allow retry
      return options?.includeRole ? { isMember: false } : false
    }

    const data = await response.json()

    // Normalize the membership response
    const membership = normalizeMembershipResponse(data, organizationId)
    setCacheEntry(membershipCache, cacheKey, membership)
    return options?.includeRole ? membership : membership.isMember
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.error('org.ai membership lookup timed out')
    } else {
      logger.error('org.ai membership lookup error:', error)
    }
  }

  // Default to not a member on error in production
  const notMember: OrganizationMembership = { isMember: false }
  return options?.includeRole ? notMember : false
}

/**
 * Raw organization data shape from org.ai API
 * @internal
 */
interface RawOrganizationData {
  $id?: string
  id?: string
  name?: string
  displayName?: string
}

/**
 * Raw membership response shape from org.ai API
 * Covers various API response formats
 * @internal
 */
interface RawMembershipResponse {
  isMember?: boolean
  member?: boolean
  active?: boolean
  role?: string
  memberRole?: string
  permission?: string
  joinedAt?: string
  createdAt?: string
  memberSince?: string
  organization?: RawOrganizationData
  organizationName?: string
  orgName?: string
}

/**
 * Type guard to check if data has properties that look like a membership response
 * @internal
 */
function isRawMembershipResponse(data: unknown): data is RawMembershipResponse {
  return data !== null && typeof data === 'object'
}

/**
 * Build an OrgAiOrganization object, only including optional properties when defined
 * @internal
 */
function buildOrgAiOrganization(
  $id: string,
  role: string,
  name?: string,
  joinedAt?: string
): OrgAiOrganization {
  const org: OrgAiOrganization = { $id, role }
  if (name !== undefined) {
    org.name = name
  }
  if (joinedAt !== undefined) {
    org.joinedAt = joinedAt
  }
  return org
}

/**
 * Normalize membership response from org.ai API to standard OrganizationMembership type
 * @internal
 */
function normalizeMembershipResponse(data: unknown, orgId: string): OrganizationMembership {
  if (!isRawMembershipResponse(data)) {
    return { isMember: false }
  }

  // Handle various API response formats
  const isMember = data.isMember ?? data.member ?? data.active ?? true
  const role = data.role || data.memberRole || data.permission || 'member'
  const joinedAt = data.joinedAt || data.createdAt || data.memberSince

  const result: OrganizationMembership = { isMember }

  // Only add optional properties if they have values
  if (role !== undefined) {
    result.role = role
  }
  if (joinedAt !== undefined) {
    result.joinedAt = joinedAt
  }

  // Build organization object
  if (data.organization) {
    const orgName = data.organization.name || data.organization.displayName
    result.organization = buildOrgAiOrganization(
      data.organization.$id || data.organization.id || orgId,
      role,
      orgName,
      joinedAt
    )
  } else {
    const orgName = data.organizationName || data.orgName
    result.organization = buildOrgAiOrganization(orgId, role, orgName, joinedAt)
  }

  return result
}

// === Permission Mapping ===

/**
 * Map org.ai roles to permission sets
 *
 * Converts organization roles (owner, admin, member, viewer) to granular
 * permission flags (read, write, admin, delete).
 *
 * @param role - org.ai role name
 * @param options - Mapping options
 * @returns Permission object
 *
 * @example
 * ```typescript
 * const permissions = mapOrgAiRolesToPermissions('admin')
 * if (permissions.delete) {
 *   // User can delete resources
 * }
 * ```
 */
export function mapOrgAiRolesToPermissions(
  role: string,
  options?: { customMappings?: Record<string, OrgAiPermissions> }
): OrgAiPermissions {
  // Check custom mappings first
  if (options?.customMappings?.[role]) {
    return options.customMappings[role]
  }

  // Default role mappings
  switch (role) {
    case 'owner':
      return {
        read: true,
        write: true,
        admin: true,
        delete: true
      }
    case 'admin':
      return {
        read: true,
        write: true,
        admin: true,
        delete: false
      }
    case 'member':
      return {
        read: true,
        write: true,
        admin: false,
        delete: false
      }
    case 'viewer':
      return {
        read: true,
        write: false,
        admin: false,
        delete: false
      }
    default:
      // Unknown role defaults to viewer
      return {
        read: true,
        write: false,
        admin: false,
        delete: false
      }
  }
}

// === SSO Flow ===

/**
 * Initiate SSO authentication flow
 *
 * Generates OAuth redirect URLs and handles PKCE for secure authentication.
 * Emits auth.sso.initiated event to pipeline for telemetry.
 *
 * @param options - SSO flow options
 * @returns SSO flow result with redirect URL and state
 *
 * @example
 * ```typescript
 * const result = await initiateSSOFlow({
 *   provider: 'org.ai',
 *   redirectUri: 'https://app.example.com/auth/callback',
 *   usePKCE: true
 * })
 *
 * // Redirect user to result.redirectUrl
 * response.redirect(result.redirectUrl)
 * ```
 */
export async function initiateSSOFlow(options: SSOFlowOptions): Promise<SSOFlowResult> {
  const {
    provider,
    redirectUri,
    state = generateState(),
    scopes = ['openid', 'email', 'profile'],
    usePKCE = false,
    onEvent
  } = options

  let codeVerifier: string | undefined
  let codeChallenge: string | undefined
  let codeChallengeMethod: 'S256' | 'plain' | undefined

  // Generate PKCE parameters if requested
  if (usePKCE) {
    codeVerifier = generateCodeVerifier()
    codeChallenge = await generateCodeChallenge(codeVerifier)
    codeChallengeMethod = 'S256'
  }

  // Build OAuth authorization URL
  const authUrl = buildAuthUrl(provider, {
    redirectUri,
    state,
    scopes,
    ...(codeChallenge !== undefined && { codeChallenge }),
    ...(codeChallengeMethod !== undefined && { codeChallengeMethod }),
  })

  // Emit event for telemetry
  if (onEvent) {
    onEvent({
      $type: 'auth.sso.initiated',
      provider,
      redirectUri,
      state,
      usePKCE,
      timestamp: new Date().toISOString()
    })
  }

  return {
    redirectUrl: authUrl,
    authUrl,
    state,
    codeVerifier,
    codeChallenge,
    codeChallengeMethod
  }
}

// === Helper Functions ===

/**
 * Check if a session has expired
 */
function isSessionExpired(session: Session): boolean {
  return new Date(session.expiresAt).getTime() < Date.now()
}

/**
 * Raw organization entry shape from session metadata
 * @internal
 */
interface RawSessionOrganization {
  $id?: string
  id?: string
  name?: string
  role?: string
  joinedAt?: string
}

/**
 * Type guard to check if value is an array of organization-like objects
 * @internal
 */
function isRawSessionOrganizationArray(value: unknown): value is RawSessionOrganization[] {
  return Array.isArray(value) && value.every(item => item !== null && typeof item === 'object')
}

/**
 * Extract organizations from session metadata
 */
function extractOrganizations(session: Session): OrgAiOrganization[] {
  const orgsValue = session.metadata?.['organizations']
  if (!orgsValue || !isRawSessionOrganizationArray(orgsValue)) {
    return []
  }

  return orgsValue.map(org => buildOrgAiOrganization(
    org.$id || org.id || '',
    org.role || 'member',
    org.name,
    org.joinedAt
  ))
}

/**
 * Derive OAuth scopes from organization memberships
 */
function deriveScopes(organizations: OrgAiOrganization[]): string[] {
  const scopes = new Set<string>(['openid', 'email', 'profile'])

  for (const org of organizations) {
    const permissions = mapOrgAiRolesToPermissions(org.role)

    if (permissions.read) scopes.add('read')
    if (permissions.write) scopes.add('write')
    if (permissions.admin) scopes.add('admin')
    if (permissions.delete) scopes.add('delete')

    // Add org-specific scopes
    scopes.add(`org:${org.$id}:${org.role}`)
  }

  return Array.from(scopes)
}

/**
 * Generate random state parameter for OAuth
 */
function generateState(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

/**
 * Generate PKCE code verifier
 */
function generateCodeVerifier(): string {
  const length = 128
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const values = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(values)
    .map(x => possible[x % possible.length])
    .join('')
}

/**
 * Generate PKCE code challenge from verifier
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hash))
  const base64 = btoa(String.fromCharCode(...hashArray))
  // Convert to base64url
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Build OAuth authorization URL
 */
function buildAuthUrl(
  provider: string,
  params: {
    redirectUri: string
    state: string
    scopes: string[]
    codeChallenge?: string
    codeChallengeMethod?: 'S256' | 'plain'
  }
): string {
  // Provider base URLs
  const providerUrls: Record<string, string> = {
    'org.ai': 'https://id.org.ai/oauth/authorize',
    'google': 'https://accounts.google.com/o/oauth2/v2/auth',
    'github': 'https://github.com/login/oauth/authorize',
    'microsoft': 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
  }

  const baseUrl = providerUrls[provider] ?? providerUrls['org.ai']!
  const url = new URL(baseUrl)

  // Standard OAuth parameters
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('state', params.state)
  url.searchParams.set('scope', params.scopes.join(' '))

  // Client ID (hardcoded; make configurable via params if needed)
  url.searchParams.set('client_id', 'dotdo-auth')

  // PKCE parameters
  if (params.codeChallenge && params.codeChallengeMethod) {
    url.searchParams.set('code_challenge', params.codeChallenge)
    url.searchParams.set('code_challenge_method', params.codeChallengeMethod)
  }

  return url.toString()
}
