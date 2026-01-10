/**
 * React-Admin AuthProvider Adapter
 *
 * Creates an AuthProvider that implements react-admin's authentication interface
 * for dotdo backends.
 *
 * @see https://marmelab.com/react-admin/Authentication.html
 *
 * ## Usage
 *
 * ```tsx
 * import { createAuthProvider } from '@dotdo/client/adapters/auth-provider'
 *
 * const authProvider = createAuthProvider('https://api.example.com', {
 *   tokenKey: 'auth_token',
 *   refreshOnExpiry: true,
 * })
 *
 * // Use with react-admin
 * <Admin authProvider={authProvider}>
 *   ...
 * </Admin>
 * ```
 */

export interface AuthProviderOptions {
  /** Storage key for the auth token (default: 'dotdo_auth_token') */
  tokenKey?: string
  /** Storage key for user data (default: 'dotdo_user') */
  userKey?: string
  /** Whether to auto-refresh tokens before expiry (default: true) */
  refreshOnExpiry?: boolean
  /** Token refresh threshold in ms (default: 5 minutes) */
  refreshThreshold?: number
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Custom storage implementation (default: localStorage) */
  storage?: Storage
}

export interface AuthProvider {
  login: (params: { username: string; password: string }) => Promise<void>
  logout: (params?: unknown) => Promise<void | string | false>
  checkAuth: (params?: unknown) => Promise<void>
  checkError: (error: { status?: number; message?: string }) => Promise<void>
  getIdentity: () => Promise<{ id: string; fullName?: string; avatar?: string }>
  getPermissions: (params?: unknown) => Promise<string[] | Record<string, boolean>>
}

interface StoredUser {
  id?: string
  user_id?: string
  name?: string
  full_name?: string
  email?: string
  email_address?: string
  avatar?: string
  profile_picture?: string
  roles?: string[]
  user_roles?: string[]
}

interface LoginResponse {
  token: string
  refreshToken?: string
  expiresAt?: number
  user?: StoredUser
}

interface RefreshResponse {
  token: string
  expiresAt?: number
}

/**
 * Normalize user data from various API field name conventions
 */
function normalizeUser(user: StoredUser): StoredUser {
  return {
    id: user.id || user.user_id,
    name: user.name || user.full_name,
    email: user.email || user.email_address,
    avatar: user.avatar || user.profile_picture,
    roles: user.roles || user.user_roles,
  }
}

/**
 * Configuration for createAuthProvider with object format
 */
export interface AuthProviderConfig {
  /** Auth endpoint URL */
  authUrl: string
  /** Storage key for the auth token (default: 'dotdo_auth_token') */
  tokenKey?: string
  /** Storage key for user data (default: 'dotdo_user') */
  userKey?: string
  /** Whether to auto-refresh tokens before expiry (default: true) */
  refreshOnExpiry?: boolean
  /** Token refresh threshold in ms (default: 5 minutes) */
  refreshThreshold?: number
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Custom storage implementation (default: localStorage) */
  storage?: Storage
}

/**
 * Creates a react-admin AuthProvider for dotdo backends
 *
 * @param config - Configuration object with authUrl
 * @returns AuthProvider instance
 */
export function createAuthProvider(config: AuthProviderConfig): AuthProvider
/**
 * Creates a react-admin AuthProvider for dotdo backends
 *
 * @param doUrl - Base URL of the dotdo backend
 * @param options - Configuration options
 * @returns AuthProvider instance
 */
export function createAuthProvider(
  doUrl: string,
  options?: AuthProviderOptions
): AuthProvider
export function createAuthProvider(
  configOrUrl: string | AuthProviderConfig,
  options?: AuthProviderOptions
): AuthProvider {
  // Normalize to get the base URL and options
  const baseUrl = typeof configOrUrl === 'string'
    ? configOrUrl.replace(/\/$/, '')
    : configOrUrl.authUrl.replace(/\/$/, '')

  const opts: AuthProviderOptions = typeof configOrUrl === 'string'
    ? (options ?? {})
    : {
        tokenKey: configOrUrl.tokenKey,
        userKey: configOrUrl.userKey,
        refreshOnExpiry: configOrUrl.refreshOnExpiry,
        refreshThreshold: configOrUrl.refreshThreshold,
        fetch: configOrUrl.fetch,
        storage: configOrUrl.storage,
      }

  // Storage keys
  const tokenKey = opts.tokenKey || 'dotdo_auth_token'
  const userKey = opts.userKey || 'dotdo_user'
  const refreshTokenKey = tokenKey.replace('auth_token', 'refresh_token').replace(tokenKey, `${tokenKey.replace(/_token$/, '')}_refresh_token`)
  const expiresKey = tokenKey.replace('auth_token', 'token_expires').replace(tokenKey, `${tokenKey.replace(/_token$/, '')}_token_expires`)

  // Use default storage keys for non-custom tokenKeys
  const getRefreshTokenKey = () => {
    if (tokenKey === 'dotdo_auth_token') return 'dotdo_refresh_token'
    return `${tokenKey.replace(/_token$/, '').replace(/_auth$/, '')}_refresh_token`
  }
  const getExpiresKey = () => {
    if (tokenKey === 'dotdo_auth_token') return 'dotdo_token_expires'
    return `${tokenKey.replace(/_token$/, '').replace(/_auth$/, '')}_token_expires`
  }
  const getUserKey = () => opts.userKey || 'dotdo_user'

  // Options
  const refreshOnExpiry = opts.refreshOnExpiry ?? true
  const refreshThreshold = opts.refreshThreshold ?? 5 * 60 * 1000 // 5 minutes
  const fetchFn = opts.fetch || globalThis.fetch
  const storage = opts.storage

  // In-flight refresh promise for deduplication
  let refreshPromise: Promise<void> | null = null

  // In-flight login promise for queuing
  let loginPromise: Promise<void> | null = null

  /**
   * Safe storage access helpers
   */
  function getStorage(): Storage | null {
    if (storage) return storage
    if (typeof localStorage !== 'undefined') return localStorage
    return null
  }

  function safeGetItem(key: string): string | null {
    try {
      const s = getStorage()
      return s?.getItem(key) ?? null
    } catch {
      return null
    }
  }

  function safeSetItem(key: string, value: string): void {
    try {
      const s = getStorage()
      s?.setItem(key, value)
    } catch {
      // Ignore storage errors
    }
  }

  function safeRemoveItem(key: string): void {
    try {
      const s = getStorage()
      s?.removeItem(key)
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Clear all auth data from storage
   */
  function clearStorage(): void {
    safeRemoveItem(tokenKey)
    safeRemoveItem(getRefreshTokenKey())
    safeRemoveItem(getUserKey())
    safeRemoveItem(getExpiresKey())
  }

  /**
   * Fetch with retries for network errors
   */
  async function fetchWithRetry(
    url: string,
    init?: RequestInit,
    maxRetries = 3
  ): Promise<Response> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fetchFn(url, init)
      } catch (err) {
        lastError = err as Error
        // Only retry on network errors, not on successful responses
        if (attempt < maxRetries - 1) {
          continue
        }
      }
    }

    throw lastError
  }

  /**
   * Refresh the access token using the refresh token
   */
  async function refreshToken(): Promise<void> {
    const refreshTokenValue = safeGetItem(getRefreshTokenKey())
    if (!refreshTokenValue) {
      throw new Error('No refresh token available')
    }

    const response = await fetchFn(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refreshTokenValue }),
    })

    if (!response.ok) {
      clearStorage()
      throw new Error('Token refresh failed')
    }

    const data: RefreshResponse = await response.json()
    safeSetItem(tokenKey, data.token)
    if (data.expiresAt) {
      safeSetItem(getExpiresKey(), String(data.expiresAt))
    }
  }

  /**
   * Check if token needs refresh and refresh if needed
   * Uses promise deduplication to avoid multiple concurrent refresh calls
   */
  async function maybeRefreshToken(): Promise<void> {
    if (!refreshOnExpiry) return

    const refreshTokenValue = safeGetItem(getRefreshTokenKey())
    if (!refreshTokenValue) return

    const expiresAt = safeGetItem(getExpiresKey())
    if (!expiresAt) return

    const expiresAtNum = Number(expiresAt)
    const timeUntilExpiry = expiresAtNum - Date.now()

    if (timeUntilExpiry > refreshThreshold) {
      // Token is not near expiry
      return
    }

    // Deduplicate concurrent refresh requests
    // If a refresh is already in progress, wait for it
    if (refreshPromise) {
      await refreshPromise
      return
    }

    refreshPromise = refreshToken().finally(() => {
      refreshPromise = null
    })

    await refreshPromise
  }

  /**
   * Get user data from storage, parsing JSON safely
   */
  function getStoredUser(): StoredUser | null {
    const userJson = safeGetItem(getUserKey())
    if (!userJson) return null

    try {
      return JSON.parse(userJson)
    } catch {
      return null
    }
  }

  /**
   * Fetch user data from server
   */
  async function fetchUserFromServer(): Promise<StoredUser> {
    const token = safeGetItem(tokenKey)
    if (!token) {
      throw new Error('Not authenticated')
    }

    const response = await fetchFn(`${baseUrl}/auth/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      if (response.status === 401) {
        clearStorage()
      }
      throw new Error('Failed to fetch user')
    }

    const user = await response.json()
    const normalizedUser = normalizeUser(user)
    safeSetItem(getUserKey(), JSON.stringify(normalizedUser))
    return normalizedUser
  }

  // ============================================================================
  // AuthProvider Implementation
  // ============================================================================

  const authProvider: AuthProvider = {
    /**
     * Authenticate with username and password
     */
    async login(params: { username: string; password: string }): Promise<void> {
      const doLogin = async () => {
        const response = await fetchWithRetry(`${baseUrl}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: params.username,
            password: params.password,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || 'Invalid credentials')
        }

        const text = await response.text()
        if (!text) {
          throw new Error('Empty response from server')
        }

        let data: LoginResponse
        try {
          data = JSON.parse(text)
        } catch {
          throw new Error('Invalid response from server')
        }

        if (!data.token) {
          throw new Error('No token in response')
        }

        // Store token
        safeSetItem(tokenKey, data.token)

        // Store refresh token if provided
        if (data.refreshToken) {
          safeSetItem(getRefreshTokenKey(), data.refreshToken)
        }

        // Store expiry time if provided
        if (data.expiresAt) {
          safeSetItem(getExpiresKey(), String(data.expiresAt))
        }

        // Store user data if provided
        if (data.user) {
          const normalizedUser = normalizeUser(data.user)
          safeSetItem(getUserKey(), JSON.stringify(normalizedUser))
        }
      }

      loginPromise = doLogin().finally(() => {
        loginPromise = null
      })

      await loginPromise
    },

    /**
     * End session and clear tokens
     */
    async logout(params?: unknown): Promise<void | string | false> {
      const token = safeGetItem(tokenKey)

      // Always clear local storage first
      clearStorage()

      // Try to notify server (but don't fail if server is unavailable)
      if (token) {
        try {
          await fetchFn(`${baseUrl}/auth/logout`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          })
        } catch {
          // Ignore server errors - local logout still succeeds
        }
      }

      // Return redirect URL if provided
      const p = params as { redirectTo?: string } | undefined
      if (p?.redirectTo) {
        return p.redirectTo
      }
    },

    /**
     * Verify current session is valid
     */
    async checkAuth(params?: unknown): Promise<void> {
      // Wait for any in-progress login
      if (loginPromise) {
        await loginPromise
      }

      const token = safeGetItem(tokenKey)
      if (!token) {
        throw new Error('Not authenticated')
      }

      // Check expiry
      const expiresAt = safeGetItem(getExpiresKey())
      if (expiresAt) {
        const expiresAtNum = Number(expiresAt)
        if (expiresAtNum <= Date.now()) {
          // Token expired - try to refresh if enabled
          if (refreshOnExpiry && safeGetItem(getRefreshTokenKey())) {
            try {
              await refreshToken()
              return // Refresh successful
            } catch {
              clearStorage()
              throw new Error('Session expired')
            }
          }
          clearStorage()
          throw new Error('Session expired')
        }
      }

      // Check if we should auto-refresh before expiry
      try {
        await maybeRefreshToken()
      } catch {
        clearStorage()
        throw new Error('Session expired')
      }

      // Validate on server if requested
      const p = params as { validateOnServer?: boolean } | undefined
      if (p?.validateOnServer) {
        const response = await fetchFn(`${baseUrl}/auth/me`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${safeGetItem(tokenKey)}`,
            'Content-Type': 'application/json',
          },
        })

        if (!response.ok) {
          clearStorage()
          throw new Error('Invalid session')
        }
      }
    },

    /**
     * Handle API errors (401/403)
     */
    async checkError(error: { status?: number; message?: string }): Promise<void> {
      if (error.status === 401 || error.status === 403) {
        // Try to refresh token if we have a refresh token and refreshOnExpiry is enabled
        if (error.status === 401 && refreshOnExpiry) {
          const refreshTokenValue = safeGetItem(getRefreshTokenKey())
          if (refreshTokenValue) {
            try {
              await refreshToken()
              return // Refresh successful, don't throw
            } catch {
              // Refresh failed, clear and throw
            }
          }
        }

        clearStorage()
        throw new Error(error.message || 'Unauthorized')
      }
      // Non-auth errors are OK
    },

    /**
     * Return current user info
     */
    async getIdentity(): Promise<{ id: string; fullName?: string; avatar?: string }> {
      // Wait for any in-progress login
      if (loginPromise) {
        await loginPromise
      }

      const token = safeGetItem(tokenKey)
      if (!token) {
        throw new Error('Not authenticated')
      }

      // Try to get from storage first
      let user = getStoredUser()

      // If not in storage or corrupted, fetch from server
      if (!user || !user.id) {
        try {
          user = await fetchUserFromServer()
        } catch {
          // If server fetch fails, create a minimal identity from the token
          // This handles cases like corrupted storage data when server is unavailable
          return {
            id: token,
            fullName: undefined,
            avatar: undefined,
          }
        }
      }

      return {
        id: user.id!,
        fullName: user.name || user.email,
        avatar: user.avatar,
      }
    },

    /**
     * Return user roles/permissions
     */
    async getPermissions(params?: unknown): Promise<string[] | Record<string, boolean>> {
      const token = safeGetItem(tokenKey)
      if (!token) {
        return []
      }

      const p = params as { fetchFromServer?: boolean } | undefined

      // If requested to fetch from server
      if (p?.fetchFromServer) {
        try {
          const response = await fetchFn(`${baseUrl}/auth/permissions`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          })

          if (response.ok) {
            const data = await response.json()
            return data.permissions || []
          }
        } catch {
          // Fall back to stored permissions
        }
      }

      // Get from stored user data
      const user = getStoredUser()
      return user?.roles || []
    },
  }

  return authProvider
}
