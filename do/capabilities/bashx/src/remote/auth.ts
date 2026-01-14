/**
 * Git Authentication
 *
 * Provides authentication utilities for Git HTTP transport:
 * - Bearer token (OAuth, PAT)
 * - Basic auth (username:password)
 * - Environment variable token detection
 * - WWW-Authenticate header parsing
 * - Credential caching
 */

// Type exports
export type AuthMethod = 'bearer' | 'basic'

export interface AuthCredentials {
  method: AuthMethod
  token?: string
  username?: string
  password?: string
}

export interface RateLimitInfo {
  limit: number
  remaining: number
  resetAt: Date
}

export interface WwwAuthenticateInfo {
  scheme: string
  schemes?: string[]
  realm?: string
  error?: string
  errorDescription?: string
}

export type TokenType =
  | 'github-pat'
  | 'github-oauth'
  | 'github-app'
  | 'gitlab-pat'
  | 'gitlab-oauth'
  | 'bitbucket'
  | 'unknown'

/**
 * Create an Authorization header value from credentials
 */
export function createAuthHeader(credentials: AuthCredentials): string {
  if (credentials.method === 'bearer') {
    return `Bearer ${credentials.token}`
  }

  // Basic auth
  const username = credentials.username ?? ''
  const password = credentials.password ?? ''
  const encoded = btoa(`${username}:${password}`)
  return `Basic ${encoded}`
}

/**
 * Get authentication token from environment variables based on host
 */
export function getTokenFromEnv(host: string, envVar?: string): string | undefined {
  // Custom env var takes precedence
  if (envVar && process.env[envVar]) {
    return process.env[envVar]
  }

  const hostLower = host.toLowerCase()

  // GitHub
  if (hostLower.includes('github')) {
    return process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  }

  // GitLab
  if (hostLower.includes('gitlab')) {
    return process.env.GITLAB_TOKEN || process.env.GL_TOKEN
  }

  // Bitbucket
  if (hostLower.includes('bitbucket')) {
    return process.env.BITBUCKET_TOKEN || process.env.BB_TOKEN
  }

  // Generic fallback
  return process.env.GIT_TOKEN
}

/**
 * Parse WWW-Authenticate header from 401 response
 */
export function parseWwwAuthenticate(header: string): WwwAuthenticateInfo {
  const result: WwwAuthenticateInfo = {
    scheme: '',
    schemes: [],
  }

  // Split by comma to handle multiple auth methods, but be careful with quoted strings
  const parts = header.split(/,\s*(?=\w+(?:\s|$|=))/)

  for (const part of parts) {
    const trimmed = part.trim()

    // Extract scheme (first word before space or end)
    const schemeMatch = trimmed.match(/^(\w+)(?:\s|$)/)
    if (schemeMatch) {
      const scheme = schemeMatch[1]
      if (!result.scheme) {
        result.scheme = scheme
      }
      if (!result.schemes!.includes(scheme)) {
        result.schemes!.push(scheme)
      }
    }

    // Extract realm="value"
    const realmMatch = trimmed.match(/realm="([^"]*)"/)
    if (realmMatch) {
      result.realm = realmMatch[1]
    }

    // Extract error="value"
    const errorMatch = trimmed.match(/error="([^"]*)"/)
    if (errorMatch) {
      result.error = errorMatch[1]
    }

    // Extract error_description="value"
    const descMatch = trimmed.match(/error_description="([^"]*)"/)
    if (descMatch) {
      result.errorDescription = descMatch[1]
    }
  }

  return result
}

/**
 * Git authentication manager with caching support
 */
export class GitAuth {
  private static cache = new Map<string, { auth: GitAuth; expiresAt: number }>()

  private token?: string
  private username?: string
  private password?: string

  constructor(options: { token?: string; username?: string; password?: string }) {
    this.token = options.token
    this.username = options.username
    this.password = options.password
  }

  /**
   * Create GitAuth instance from environment variables
   */
  static fromEnv(host: string): GitAuth {
    const token = getTokenFromEnv(host)
    if (token) {
      return new GitAuth({ token })
    }
    return new GitAuth({})
  }

  /**
   * Get cached credentials for a host
   */
  static getCached(host: string): GitAuth | undefined {
    const entry = GitAuth.cache.get(host)
    if (!entry) {
      return undefined
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      GitAuth.cache.delete(host)
      return undefined
    }

    return entry.auth
  }

  /**
   * Check if this instance has credentials
   */
  hasCredentials(): boolean {
    return Boolean(this.token || (this.username && this.password) || this.username)
  }

  /**
   * Get the Authorization header value
   */
  getHeader(): string {
    if (this.token) {
      return `Bearer ${this.token}`
    }

    if (this.username) {
      const password = this.password ?? ''
      return `Basic ${btoa(`${this.username}:${password}`)}`
    }

    return ''
  }

  /**
   * Detect token type from prefix
   */
  getTokenType(): TokenType {
    if (!this.token) {
      return 'unknown'
    }

    // GitHub Personal Access Token (classic or fine-grained)
    if (this.token.startsWith('ghp_')) {
      return 'github-pat'
    }

    // GitHub OAuth token
    if (this.token.startsWith('gho_')) {
      return 'github-oauth'
    }

    // GitHub App token
    if (this.token.startsWith('ghs_') || this.token.startsWith('ghu_')) {
      return 'github-app'
    }

    // GitLab Personal Access Token
    if (this.token.startsWith('glpat-')) {
      return 'gitlab-pat'
    }

    // GitLab OAuth token
    if (this.token.startsWith('gloa-')) {
      return 'gitlab-oauth'
    }

    // Bitbucket app passwords don't have a standard prefix
    // but tokens starting with specific patterns might indicate them

    return 'unknown'
  }

  /**
   * Cache these credentials for a host with TTL
   */
  cacheFor(host: string, ttlSeconds: number): void {
    GitAuth.cache.set(host, {
      auth: this,
      expiresAt: Date.now() + ttlSeconds * 1000,
    })
  }
}
