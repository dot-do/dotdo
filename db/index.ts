// Core schema exports
export * from './nouns'
export * from './verbs'
export * from './things'
export * from './relationships'
export * from './objects'
export * from './actions'
export * from './events'
export * from './search'
export * from './branches'
export * from './files'
export * from './git'
export * from './auth'
export * from './exec'
export * from './dlq'

// Linked accounts query helpers and validation
export * from './linked-accounts'

// Integrations - Provider registry for integrations.do
export * from './integrations'

// Re-export all tables as schema object for Drizzle
import { nouns } from './nouns'
import { verbs } from './verbs'
import { things } from './things'
import { relationships } from './relationships'
import { objects } from './objects'
import { actions } from './actions'
import { events } from './events'
import { search } from './search'
import { branches } from './branches'
import { files } from './files'
import { git, gitBranches, gitContent } from './git'
import { exec } from './exec'
import {
  // Core auth
  users,
  sessions,
  accounts,
  verifications,
  // Organization plugin
  organizations,
  members,
  invitations,
  teams,
  teamMembers,
  // API Key plugin
  apiKeys,
  // SSO plugin
  ssoProviders,
  // OAuth Provider plugin
  oauthClients,
  oauthAccessTokens,
  oauthRefreshTokens,
  oauthConsents,
  oauthAuthorizationCodes,
  // Custom domains
  customDomains,
  // Stripe plugin
  subscriptions,
  // Identities (multi-type: human, agent, service)
  identities,
  // Linked accounts (third-party connections)
  linkedAccounts,
} from './auth'
import { providers, accountTypes } from './integrations'
import { dlq } from './dlq'

export const schema = {
  // Core DO tables
  nouns,
  verbs,
  things,
  relationships,
  objects,
  actions,
  events,
  search,
  branches,
  files,

  // Git integration
  git,
  gitBranches,
  gitContent,

  // Exec - Shell command execution tracking
  exec,

  // Auth - Core (better-auth)
  users,
  sessions,
  accounts,
  verifications,

  // Auth - Organization plugin
  organizations,
  members,
  invitations,
  teams,
  teamMembers,

  // Auth - API Key plugin
  apiKeys,

  // Auth - SSO plugin
  ssoProviders,

  // Auth - OAuth Provider plugin
  oauthClients,
  oauthAccessTokens,
  oauthRefreshTokens,
  oauthConsents,
  oauthAuthorizationCodes,

  // Auth - Custom domains
  customDomains,

  // Auth - Stripe plugin
  subscriptions,

  // Auth - Identities (multi-type: human, agent, service)
  identities,

  // Auth - Linked accounts (third-party connections)
  linkedAccounts,

  // Integrations - Provider registry for integrations.do
  providers,
  accountTypes,

  // Dead Letter Queue - Failed events for retry
  dlq,
}
