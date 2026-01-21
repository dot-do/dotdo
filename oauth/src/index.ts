/**
 * @dotdo/oauth - OAuth 2.1 + PKCE Core
 *
 * Provides OAuth 2.1 utilities for Cloudflare Workers:
 * - PKCE (Proof Key for Code Exchange) generation and validation
 * - State token generation for CSRF protection
 * - Web Crypto API based (zero Node.js dependencies)
 *
 * @module @dotdo/oauth
 */

// PKCE utilities
export {
  generatePKCE,
  generateVerifier,
  createChallenge,
  validatePKCE,
} from './core/pkce'

// State token utilities
export {
  generateState,
  validateState,
  createStateWithMetadata,
  parseStateMetadata,
  createStateWithExpiry,
  isStateExpired,
} from './core/state'

// Types
export type {
  PKCEMethod,
  PKCEPair,
  StateMetadata,
  AuthorizationRequest,
  TokenRequest,
  TokenResponse,
  OAuthError,
} from './core/types'

// Session storage
export {
  MemorySessionStore,
  KVSessionStore,
  D1SessionStore,
  D1_SESSION_SCHEMA,
} from './storage'

export type {
  SessionData,
  SessionStore,
  SessionStoreOptions,
  KVSessionStoreOptions,
  D1SessionStoreOptions,
} from './storage'

// Provider registry and built-in providers
export {
  ProviderRegistry,
  defaultRegistry,
  createGoogleProvider,
  createGitHubProvider,
  createMicrosoftProvider,
  createCustomProvider,
} from './providers'

export type {
  OAuthProvider,
  OAuthProviderConfig,
  UserInfo,
  GoogleProviderConfig,
  GitHubProviderConfig,
  MicrosoftProviderConfig,
  CustomProviderConfig,
} from './providers'
