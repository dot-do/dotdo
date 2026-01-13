/**
 * Auth Module - Multi-Domain OAuth for DO Platform
 *
 * Supports:
 *   - Same domain paths: crm.headless.ly/acme
 *   - Subdomains: acme.crm.headless.ly
 *   - Custom domains: crm.acme.com
 *
 * Architecture:
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │                    CENTRAL AUTH DOMAIN                              │
 *   │                    (auth.headless.ly)                               │
 *   │                                                                     │
 *   │   OAuth Providers registered here:                                  │
 *   │   ├── Google  → callback: auth.headless.ly/api/auth/callback/google │
 *   │   ├── GitHub  → callback: auth.headless.ly/api/auth/callback/github │
 *   │   └── SSO     → per-org SAML/OIDC                                  │
 *   │                                                                     │
 *   │   Stores:                                                           │
 *   │   ├── users, sessions, accounts                                    │
 *   │   ├── organizations (with tenantNs, region, customDomain)          │
 *   │   └── members, invitations, teams                                  │
 *   └─────────────────────────────────────────────────────────────────────┘
 *                                    │
 *                                    │ After OAuth:
 *                                    │ 1. Create session
 *                                    │ 2. Generate one-time token
 *                                    │ 3. Redirect to tenant domain
 *                                    ▼
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │                    TENANT DOMAIN                                    │
 *   │        (crm.acme.com, acme.crm.headless.ly, etc.)                   │
 *   │                                                                     │
 *   │   Routes:                                                           │
 *   │   ├── /auth/login?provider=google → Redirect to auth domain        │
 *   │   ├── /auth/callback?auth_token=xxx → Exchange token for session   │
 *   │   ├── /auth/session → Get current session (API)                    │
 *   │   └── /auth/logout → Clear session cookie                          │
 *   │                                                                     │
 *   │   Then routes to Tenant DO:                                        │
 *   │   └── organizations[slug].tenantNs → DO namespace                  │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * Flow:
 *
 *   1. User visits crm.acme.com
 *   2. Click "Login with Google" → /auth/login?provider=google
 *   3. Redirect to auth.headless.ly/api/auth/signin/google
 *      with callbackURL=crm.acme.com/auth/callback
 *   4. Google OAuth flow on auth.headless.ly
 *   5. After success: generate one-time token, redirect to
 *      crm.acme.com/auth/callback?auth_token=xxx
 *   6. Tenant domain exchanges token for session cookie
 *   7. User is now authenticated on crm.acme.com
 *
 * Custom Domain Setup:
 *
 *   1. Org admin adds custom domain in settings
 *   2. System generates DNS verification token
 *   3. Admin adds TXT record: _do-verify.crm.acme.com → token
 *   4. System verifies DNS and activates custom domain
 *   5. Custom domain now works for OAuth
 */

export { createAuth, createAuthWithGraph, exchangeCrossDomainToken, registerCustomDomain, verifyCustomDomain, lookupCustomDomain } from './config'
export type { AuthConfig, GraphAuthConfig } from './config'

// Graph adapter for DO-based auth storage
export { graphAuthAdapter, createGraphAuthAdapter } from './adapters'
export type { GraphAuthAdapter, User as AuthUser, Session as AuthSession, Account as AuthAccount } from './adapters'

export { handleAuthRequest, getSessionFromRequest, requireAuth, requireOrgMembership } from './handler'
export type { AuthEnv } from './handler'

export { validateAuthEnv, isAuthEnvValidated, resetValidationState } from './env-validation'
export type { RequiredAuthEnvVar } from './env-validation'

// Migration utilities for Drizzle to Graph migration
export {
  migrateAuthToGraph,
  verifyMigration,
  isMigrationComplete,
  getMigrationStatus,
} from './migration'
export type {
  MigrationConfig,
  MigrationProgress,
  MigrationResult,
  VerificationResult,
} from './migration'
