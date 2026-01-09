/**
 * Seed file for integrations.do providers.
 *
 * This file seeds the initial set of integration providers for the platform.
 * All OAuth and webhook configurations use placeholder environment variables
 * that must be configured before deployment.
 *
 * Required Environment Variables:
 * --------------------------------
 * # GitHub
 * GITHUB_CLIENT_ID - GitHub OAuth App Client ID
 * GITHUB_CLIENT_SECRET - GitHub OAuth App Client Secret
 * GITHUB_WEBHOOK_SECRET - Secret for verifying GitHub webhooks
 *
 * # Slack
 * SLACK_CLIENT_ID - Slack App Client ID
 * SLACK_CLIENT_SECRET - Slack App Client Secret
 * SLACK_SIGNING_SECRET - Slack signing secret for request verification
 *
 * # Anthropic
 * ANTHROPIC_API_KEY - Anthropic API key
 *
 * # OpenAI
 * OPENAI_API_KEY - OpenAI API key
 *
 * # OpenRouter
 * OPENROUTER_API_KEY - OpenRouter API key
 *
 * # Stripe
 * STRIPE_API_KEY - Stripe API key (sk_live_* or sk_test_*)
 * STRIPE_WEBHOOK_SECRET - Stripe webhook signing secret (whsec_*)
 *
 * # Google
 * GOOGLE_CLIENT_ID - Google OAuth Client ID
 * GOOGLE_CLIENT_SECRET - Google OAuth Client Secret
 *
 * # Notion
 * NOTION_CLIENT_ID - Notion integration client ID (OAuth)
 * NOTION_CLIENT_SECRET - Notion integration client secret
 *
 * # Linear
 * LINEAR_CLIENT_ID - Linear OAuth App Client ID
 * LINEAR_CLIENT_SECRET - Linear OAuth App Client Secret
 * LINEAR_WEBHOOK_SECRET - Linear webhook signing secret
 *
 * # Discord
 * DISCORD_CLIENT_ID - Discord Application Client ID
 * DISCORD_CLIENT_SECRET - Discord Application Client Secret
 * DISCORD_BOT_TOKEN - Discord Bot Token (for bot functionality)
 *
 * # WorkOS (Enterprise SSO)
 * WORKOS_CLIENT_ID - WorkOS Client ID
 * WORKOS_API_KEY - WorkOS API Key
 *
 * Usage:
 * ------
 * import { seedProviders, seedAccountTypes } from './db/seeds/integrations'
 *
 * // In your migration or setup script:
 * await seedProviders(db)
 * await seedAccountTypes(db)
 *
 * @module db/seeds/integrations
 */

import type {
  NewProvider,
  NewAccountType,
  OAuthConfig,
  WebhookConfig,
  ProviderAction,
  RateLimitConfig,
} from '../integrations'
import { providers, accountTypes } from '../integrations'
import { eq } from 'drizzle-orm'

// ============================================================================
// PROVIDER DEFINITIONS
// ============================================================================

const now = new Date()

/**
 * GitHub - Code hosting, issues, PRs, actions
 */
const github: NewProvider = {
  id: 'github',
  slug: 'github',
  name: 'GitHub',
  type: 'oauth2',
  category: 'devtools',
  icon: 'github',
  description: 'Code hosting, issues, pull requests, and GitHub Actions',
  baseUrl: 'https://api.github.com',
  apiVersion: '2022-11-28',
  docsUrl: 'https://docs.github.com/en/rest',
  enabled: true,
  official: true,
  oauthConfig: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: [
      'repo',
      'user:email',
      'read:user',
      'read:org',
      'workflow',
    ],
    userInfoUrl: 'https://api.github.com/user',
    pkceSupported: false,
    responseType: 'code',
  },
  webhookConfig: {
    signatureHeader: 'X-Hub-Signature-256',
    algorithm: 'hmac-sha256',
    signaturePrefix: 'sha256=',
  },
  actions: [
    {
      name: 'list_repos',
      description: 'List repositories for the authenticated user',
      method: 'GET',
      endpoint: '/user/repos',
      scopes: ['repo'],
    },
    {
      name: 'get_repo',
      description: 'Get a repository by owner and name',
      method: 'GET',
      endpoint: '/repos/{owner}/{repo}',
      scopes: ['repo'],
    },
    {
      name: 'create_issue',
      description: 'Create an issue in a repository',
      method: 'POST',
      endpoint: '/repos/{owner}/{repo}/issues',
      scopes: ['repo'],
    },
    {
      name: 'create_pull_request',
      description: 'Create a pull request',
      method: 'POST',
      endpoint: '/repos/{owner}/{repo}/pulls',
      scopes: ['repo'],
    },
    {
      name: 'list_workflows',
      description: 'List GitHub Actions workflows',
      method: 'GET',
      endpoint: '/repos/{owner}/{repo}/actions/workflows',
      scopes: ['workflow'],
    },
    {
      name: 'trigger_workflow',
      description: 'Trigger a workflow dispatch event',
      method: 'POST',
      endpoint: '/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches',
      scopes: ['workflow'],
    },
  ],
  rateLimit: {
    max: 5000,
    window: 3600,
    type: 'sliding',
  },
  createdAt: now,
  updatedAt: now,
}

/**
 * Slack - Team communication and messaging
 */
const slack: NewProvider = {
  id: 'slack',
  slug: 'slack',
  name: 'Slack',
  type: 'oauth2',
  category: 'channel',
  icon: 'slack',
  description: 'Team messaging, channels, and integrations',
  baseUrl: 'https://slack.com/api',
  docsUrl: 'https://api.slack.com/docs',
  enabled: true,
  official: true,
  oauthConfig: {
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: [
      'channels:read',
      'channels:history',
      'chat:write',
      'users:read',
      'users:read.email',
      'team:read',
      'im:write',
      'groups:read',
    ],
    userInfoUrl: 'https://slack.com/api/users.identity',
    revokeUrl: 'https://slack.com/api/auth.revoke',
    pkceSupported: false,
    responseType: 'code',
  },
  webhookConfig: {
    signatureHeader: 'X-Slack-Signature',
    algorithm: 'hmac-sha256',
    signaturePrefix: 'v0=',
    timestampHeader: 'X-Slack-Request-Timestamp',
    timestampMaxAge: 300,
  },
  actions: [
    {
      name: 'send_message',
      description: 'Send a message to a channel or DM',
      method: 'POST',
      endpoint: '/chat.postMessage',
      scopes: ['chat:write'],
    },
    {
      name: 'list_channels',
      description: 'List channels in the workspace',
      method: 'GET',
      endpoint: '/conversations.list',
      scopes: ['channels:read'],
    },
    {
      name: 'get_user',
      description: 'Get user information',
      method: 'GET',
      endpoint: '/users.info',
      scopes: ['users:read'],
    },
    {
      name: 'list_users',
      description: 'List users in the workspace',
      method: 'GET',
      endpoint: '/users.list',
      scopes: ['users:read'],
    },
    {
      name: 'update_message',
      description: 'Update an existing message',
      method: 'POST',
      endpoint: '/chat.update',
      scopes: ['chat:write'],
    },
  ],
  rateLimit: {
    max: 50,
    window: 60,
    type: 'sliding',
  },
  createdAt: now,
  updatedAt: now,
}

/**
 * Anthropic - Claude AI models
 */
const anthropic: NewProvider = {
  id: 'anthropic',
  slug: 'anthropic',
  name: 'Anthropic',
  type: 'api_key',
  category: 'ai',
  icon: 'anthropic',
  description: 'Claude AI models for text generation and analysis',
  baseUrl: 'https://api.anthropic.com',
  apiVersion: '2024-10-01',
  docsUrl: 'https://docs.anthropic.com/en/api',
  enabled: true,
  official: true,
  actions: [
    {
      name: 'create_message',
      description: 'Create a message with Claude',
      method: 'POST',
      endpoint: '/v1/messages',
      scopes: [],
    },
    {
      name: 'count_tokens',
      description: 'Count tokens for a message',
      method: 'POST',
      endpoint: '/v1/messages/count_tokens',
      scopes: [],
    },
  ],
  rateLimit: {
    max: 1000,
    window: 60,
    type: 'sliding',
  },
  metadata: {
    models: [
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-20250514',
      'claude-3-5-haiku-20241022',
    ],
    features: ['streaming', 'vision', 'tool_use', 'extended_thinking'],
  },
  createdAt: now,
  updatedAt: now,
}

/**
 * OpenAI - GPT models
 */
const openai: NewProvider = {
  id: 'openai',
  slug: 'openai',
  name: 'OpenAI',
  type: 'api_key',
  category: 'ai',
  icon: 'openai',
  description: 'GPT models for text generation, embeddings, and more',
  baseUrl: 'https://api.openai.com',
  apiVersion: 'v1',
  docsUrl: 'https://platform.openai.com/docs/api-reference',
  enabled: true,
  official: true,
  actions: [
    {
      name: 'create_chat_completion',
      description: 'Create a chat completion',
      method: 'POST',
      endpoint: '/v1/chat/completions',
      scopes: [],
    },
    {
      name: 'create_embedding',
      description: 'Create embeddings for text',
      method: 'POST',
      endpoint: '/v1/embeddings',
      scopes: [],
    },
    {
      name: 'list_models',
      description: 'List available models',
      method: 'GET',
      endpoint: '/v1/models',
      scopes: [],
    },
  ],
  rateLimit: {
    max: 500,
    window: 60,
    type: 'sliding',
  },
  metadata: {
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini'],
    features: ['streaming', 'vision', 'function_calling', 'json_mode'],
  },
  createdAt: now,
  updatedAt: now,
}

/**
 * OpenRouter - AI model router
 */
const openrouter: NewProvider = {
  id: 'openrouter',
  slug: 'openrouter',
  name: 'OpenRouter',
  type: 'api_key',
  category: 'ai',
  icon: 'openrouter',
  description: 'Unified API for multiple AI models',
  baseUrl: 'https://openrouter.ai/api',
  apiVersion: 'v1',
  docsUrl: 'https://openrouter.ai/docs',
  enabled: true,
  official: true,
  actions: [
    {
      name: 'create_chat_completion',
      description: 'Create a chat completion with any supported model',
      method: 'POST',
      endpoint: '/v1/chat/completions',
      scopes: [],
    },
    {
      name: 'list_models',
      description: 'List available models',
      method: 'GET',
      endpoint: '/v1/models',
      scopes: [],
    },
    {
      name: 'get_generation',
      description: 'Get generation details by ID',
      method: 'GET',
      endpoint: '/v1/generation',
      scopes: [],
    },
  ],
  rateLimit: {
    max: 200,
    window: 60,
    type: 'sliding',
  },
  metadata: {
    features: ['streaming', 'model_routing', 'fallback'],
  },
  createdAt: now,
  updatedAt: now,
}

/**
 * Stripe - Payments and billing
 */
const stripe: NewProvider = {
  id: 'stripe',
  slug: 'stripe',
  name: 'Stripe',
  type: 'api_key',
  category: 'finance',
  icon: 'stripe',
  description: 'Payment processing, subscriptions, and billing',
  baseUrl: 'https://api.stripe.com',
  apiVersion: '2024-12-18.acacia',
  docsUrl: 'https://stripe.com/docs/api',
  enabled: true,
  official: true,
  webhookConfig: {
    signatureHeader: 'Stripe-Signature',
    algorithm: 'hmac-sha256',
    timestampHeader: 't',
    timestampMaxAge: 300,
  },
  actions: [
    {
      name: 'create_customer',
      description: 'Create a new customer',
      method: 'POST',
      endpoint: '/v1/customers',
      scopes: [],
    },
    {
      name: 'create_payment_intent',
      description: 'Create a payment intent',
      method: 'POST',
      endpoint: '/v1/payment_intents',
      scopes: [],
    },
    {
      name: 'create_subscription',
      description: 'Create a subscription',
      method: 'POST',
      endpoint: '/v1/subscriptions',
      scopes: [],
    },
    {
      name: 'list_invoices',
      description: 'List invoices',
      method: 'GET',
      endpoint: '/v1/invoices',
      scopes: [],
    },
    {
      name: 'create_checkout_session',
      description: 'Create a checkout session',
      method: 'POST',
      endpoint: '/v1/checkout/sessions',
      scopes: [],
    },
  ],
  rateLimit: {
    max: 100,
    window: 1,
    type: 'sliding',
  },
  metadata: {
    webhookEvents: [
      'checkout.session.completed',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.paid',
      'invoice.payment_failed',
      'payment_intent.succeeded',
      'payment_intent.payment_failed',
    ],
  },
  createdAt: now,
  updatedAt: now,
}

/**
 * Google - OAuth for multiple Google services
 */
const google: NewProvider = {
  id: 'google',
  slug: 'google',
  name: 'Google',
  type: 'oauth2',
  category: 'workspace',
  icon: 'google',
  description: 'Google Workspace (Gmail, Drive, Calendar, Docs)',
  baseUrl: 'https://www.googleapis.com',
  docsUrl: 'https://developers.google.com/apis-explorer',
  enabled: true,
  official: true,
  oauthConfig: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    pkceSupported: true,
    responseType: 'code',
  },
  actions: [
    {
      name: 'get_user_info',
      description: 'Get authenticated user information',
      method: 'GET',
      endpoint: '/oauth2/v3/userinfo',
      scopes: ['openid', 'email', 'profile'],
    },
    {
      name: 'list_messages',
      description: 'List Gmail messages',
      method: 'GET',
      endpoint: '/gmail/v1/users/me/messages',
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    },
    {
      name: 'send_email',
      description: 'Send an email via Gmail',
      method: 'POST',
      endpoint: '/gmail/v1/users/me/messages/send',
      scopes: ['https://www.googleapis.com/auth/gmail.send'],
    },
    {
      name: 'list_calendar_events',
      description: 'List calendar events',
      method: 'GET',
      endpoint: '/calendar/v3/calendars/primary/events',
      scopes: ['https://www.googleapis.com/auth/calendar'],
    },
    {
      name: 'list_drive_files',
      description: 'List files in Google Drive',
      method: 'GET',
      endpoint: '/drive/v3/files',
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    },
  ],
  rateLimit: {
    max: 100,
    window: 100,
    type: 'sliding',
  },
  createdAt: now,
  updatedAt: now,
}

/**
 * Notion - Workspace and knowledge management
 */
const notion: NewProvider = {
  id: 'notion',
  slug: 'notion',
  name: 'Notion',
  type: 'oauth2',
  category: 'workspace',
  icon: 'notion',
  description: 'Workspace for notes, docs, wikis, and databases',
  baseUrl: 'https://api.notion.com',
  apiVersion: '2022-06-28',
  docsUrl: 'https://developers.notion.com/docs',
  enabled: true,
  official: true,
  oauthConfig: {
    authUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    scopes: [],  // Notion uses page-based permissions, not scopes
    pkceSupported: false,
    responseType: 'code',
  },
  actions: [
    {
      name: 'search',
      description: 'Search pages and databases',
      method: 'POST',
      endpoint: '/v1/search',
      scopes: [],
    },
    {
      name: 'get_page',
      description: 'Get a page by ID',
      method: 'GET',
      endpoint: '/v1/pages/{page_id}',
      scopes: [],
    },
    {
      name: 'create_page',
      description: 'Create a new page',
      method: 'POST',
      endpoint: '/v1/pages',
      scopes: [],
    },
    {
      name: 'query_database',
      description: 'Query a database',
      method: 'POST',
      endpoint: '/v1/databases/{database_id}/query',
      scopes: [],
    },
    {
      name: 'get_block_children',
      description: 'Get child blocks of a block',
      method: 'GET',
      endpoint: '/v1/blocks/{block_id}/children',
      scopes: [],
    },
  ],
  rateLimit: {
    max: 3,
    window: 1,
    type: 'sliding',
  },
  createdAt: now,
  updatedAt: now,
}

/**
 * Linear - Issue tracking and project management
 */
const linear: NewProvider = {
  id: 'linear',
  slug: 'linear',
  name: 'Linear',
  type: 'oauth2',
  category: 'devtools',
  icon: 'linear',
  description: 'Issue tracking and project management for software teams',
  baseUrl: 'https://api.linear.app',
  docsUrl: 'https://developers.linear.app/docs',
  enabled: true,
  official: true,
  oauthConfig: {
    authUrl: 'https://linear.app/oauth/authorize',
    tokenUrl: 'https://api.linear.app/oauth/token',
    scopes: [
      'read',
      'write',
      'issues:create',
      'comments:create',
    ],
    revokeUrl: 'https://api.linear.app/oauth/revoke',
    pkceSupported: true,
    responseType: 'code',
  },
  webhookConfig: {
    signatureHeader: 'Linear-Signature',
    algorithm: 'hmac-sha256',
  },
  actions: [
    {
      name: 'list_issues',
      description: 'List issues (via GraphQL)',
      method: 'POST',
      endpoint: '/graphql',
      scopes: ['read'],
    },
    {
      name: 'create_issue',
      description: 'Create an issue (via GraphQL)',
      method: 'POST',
      endpoint: '/graphql',
      scopes: ['write', 'issues:create'],
    },
    {
      name: 'update_issue',
      description: 'Update an issue (via GraphQL)',
      method: 'POST',
      endpoint: '/graphql',
      scopes: ['write'],
    },
    {
      name: 'create_comment',
      description: 'Create a comment on an issue (via GraphQL)',
      method: 'POST',
      endpoint: '/graphql',
      scopes: ['write', 'comments:create'],
    },
  ],
  rateLimit: {
    max: 1500,
    window: 3600,
    type: 'sliding',
  },
  metadata: {
    apiType: 'graphql',
    webhookEvents: [
      'Issue',
      'Comment',
      'IssueLabel',
      'Project',
      'Cycle',
    ],
  },
  createdAt: now,
  updatedAt: now,
}

/**
 * Discord - Community platform with bots
 */
const discord: NewProvider = {
  id: 'discord',
  slug: 'discord',
  name: 'Discord',
  type: 'oauth2',
  category: 'channel',
  icon: 'discord',
  description: 'Community platform with servers, channels, and bots',
  baseUrl: 'https://discord.com/api',
  apiVersion: 'v10',
  docsUrl: 'https://discord.com/developers/docs',
  enabled: true,
  official: true,
  oauthConfig: {
    authUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scopes: [
      'identify',
      'email',
      'guilds',
      'guilds.members.read',
      'bot',
      'messages.read',
    ],
    userInfoUrl: 'https://discord.com/api/users/@me',
    revokeUrl: 'https://discord.com/api/oauth2/token/revoke',
    pkceSupported: false,
    responseType: 'code',
  },
  webhookConfig: {
    signatureHeader: 'X-Signature-Ed25519',
    algorithm: 'sha256',  // Discord uses Ed25519, simplified here
    timestampHeader: 'X-Signature-Timestamp',
  },
  actions: [
    {
      name: 'get_current_user',
      description: 'Get the current authenticated user',
      method: 'GET',
      endpoint: '/users/@me',
      scopes: ['identify'],
    },
    {
      name: 'list_guilds',
      description: 'List guilds the user is a member of',
      method: 'GET',
      endpoint: '/users/@me/guilds',
      scopes: ['guilds'],
    },
    {
      name: 'send_message',
      description: 'Send a message to a channel (bot)',
      method: 'POST',
      endpoint: '/channels/{channel_id}/messages',
      scopes: ['bot'],
    },
    {
      name: 'get_guild_members',
      description: 'Get guild members',
      method: 'GET',
      endpoint: '/guilds/{guild_id}/members',
      scopes: ['guilds.members.read'],
    },
  ],
  rateLimit: {
    max: 50,
    window: 1,
    type: 'sliding',
  },
  metadata: {
    botSupport: true,
    slashCommands: true,
  },
  createdAt: now,
  updatedAt: now,
}

/**
 * WorkOS - Enterprise SSO and directory sync
 */
const workos: NewProvider = {
  id: 'workos',
  slug: 'workos',
  name: 'WorkOS',
  type: 'oauth2',
  category: 'auth',
  icon: 'workos',
  description: 'Enterprise SSO, directory sync, and admin portal',
  baseUrl: 'https://api.workos.com',
  docsUrl: 'https://workos.com/docs',
  enabled: true,
  official: true,
  oauthConfig: {
    authUrl: 'https://api.workos.com/sso/authorize',
    tokenUrl: 'https://api.workos.com/sso/token',
    scopes: [],  // WorkOS uses connection-based auth
    userInfoUrl: 'https://api.workos.com/sso/profile',
    pkceSupported: true,
    responseType: 'code',
  },
  webhookConfig: {
    signatureHeader: 'WorkOS-Signature',
    algorithm: 'hmac-sha256',
    timestampHeader: 't',
    timestampMaxAge: 300,
  },
  actions: [
    {
      name: 'list_connections',
      description: 'List SSO connections',
      method: 'GET',
      endpoint: '/connections',
      scopes: [],
    },
    {
      name: 'get_profile',
      description: 'Get SSO profile after authentication',
      method: 'GET',
      endpoint: '/sso/profile',
      scopes: [],
    },
    {
      name: 'list_directory_users',
      description: 'List users from directory sync',
      method: 'GET',
      endpoint: '/directory_users',
      scopes: [],
    },
    {
      name: 'list_directory_groups',
      description: 'List groups from directory sync',
      method: 'GET',
      endpoint: '/directory_groups',
      scopes: [],
    },
  ],
  rateLimit: {
    max: 100,
    window: 60,
    type: 'sliding',
  },
  metadata: {
    features: ['sso', 'directory_sync', 'audit_logs', 'admin_portal'],
    supportedProviders: ['okta', 'azure-ad', 'google-workspace', 'onelogin'],
  },
  createdAt: now,
  updatedAt: now,
}

// ============================================================================
// ACCOUNT TYPE DEFINITIONS
// ============================================================================

/**
 * Account type definitions that group providers by category.
 */
const accountTypeDefinitions: NewAccountType[] = [
  {
    id: 'auth',
    slug: 'auth',
    name: 'Identity Providers',
    icon: 'key',
    description: 'Identity and authentication providers for enterprise SSO',
    providers: ['workos'],
    enabled: true,
    displayOrder: 1,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'channel',
    slug: 'channel',
    name: 'Communication',
    icon: 'message-circle',
    description: 'Team communication and messaging platforms',
    providers: ['slack', 'discord'],
    enabled: true,
    displayOrder: 2,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'ai',
    slug: 'ai',
    name: 'AI Providers',
    icon: 'brain',
    description: 'AI and machine learning model providers',
    providers: ['anthropic', 'openai', 'openrouter'],
    enabled: true,
    displayOrder: 3,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'finance',
    slug: 'finance',
    name: 'Payments',
    icon: 'credit-card',
    description: 'Payment processing and billing platforms',
    providers: ['stripe'],
    enabled: true,
    displayOrder: 4,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'devtools',
    slug: 'devtools',
    name: 'Developer Tools',
    icon: 'code',
    description: 'Code hosting, issue tracking, and development tools',
    providers: ['github', 'linear'],
    enabled: true,
    displayOrder: 5,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'workspace',
    slug: 'workspace',
    name: 'Productivity',
    icon: 'briefcase',
    description: 'Workspace and productivity tools',
    providers: ['google', 'notion'],
    enabled: true,
    displayOrder: 6,
    createdAt: now,
    updatedAt: now,
  },
]

// ============================================================================
// ALL PROVIDERS
// ============================================================================

/**
 * All provider definitions for seeding.
 */
export const providerDefinitions: NewProvider[] = [
  github,
  slack,
  anthropic,
  openai,
  openrouter,
  stripe,
  google,
  notion,
  linear,
  discord,
  workos,
]

// ============================================================================
// SEED FUNCTIONS
// ============================================================================

/**
 * Database interface for seeding operations.
 */
interface SeedDb {
  select(): {
    from(table: typeof providers | typeof accountTypes): {
      where(condition: unknown): Promise<unknown[]>
    }
  }
  insert(table: typeof providers | typeof accountTypes): {
    values(values: unknown): {
      onConflictDoUpdate(config: {
        target: unknown
        set: unknown
      }): Promise<unknown[]>
      returning(): Promise<unknown[]>
    }
  }
}

/**
 * Seed all providers into the database.
 *
 * This function is idempotent - it uses ON CONFLICT DO UPDATE
 * to update existing providers rather than failing.
 *
 * @param db - Drizzle database instance
 * @returns Array of seeded provider records
 */
export async function seedProviders(db: SeedDb) {
  const results = []

  for (const provider of providerDefinitions) {
    // Check if provider exists
    const existing = await db
      .select()
      .from(providers)
      .where(eq(providers.id, provider.id))

    if (existing.length > 0) {
      // Update existing provider (preserve createdAt)
      const updated = await db
        .insert(providers)
        .values({
          ...provider,
          createdAt: (existing[0] as { createdAt: Date }).createdAt,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: providers.id,
          set: {
            slug: provider.slug,
            name: provider.name,
            type: provider.type,
            category: provider.category,
            icon: provider.icon,
            description: provider.description,
            baseUrl: provider.baseUrl,
            apiVersion: provider.apiVersion,
            docsUrl: provider.docsUrl,
            enabled: provider.enabled,
            official: provider.official,
            oauthConfig: provider.oauthConfig,
            webhookConfig: provider.webhookConfig,
            actions: provider.actions,
            rateLimit: provider.rateLimit,
            metadata: provider.metadata,
            updatedAt: new Date(),
          },
        })

      results.push(...updated)
      console.log(`Updated provider: ${provider.id}`)
    } else {
      // Insert new provider
      const inserted = await db
        .insert(providers)
        .values(provider)
        .returning()

      results.push(...inserted)
      console.log(`Created provider: ${provider.id}`)
    }
  }

  console.log(`Seeded ${results.length} providers`)
  return results
}

/**
 * Seed all account types into the database.
 *
 * This function is idempotent - it uses ON CONFLICT DO UPDATE
 * to update existing account types rather than failing.
 *
 * @param db - Drizzle database instance
 * @returns Array of seeded account type records
 */
export async function seedAccountTypes(db: SeedDb) {
  const results = []

  for (const accountType of accountTypeDefinitions) {
    // Check if account type exists
    const existing = await db
      .select()
      .from(accountTypes)
      .where(eq(accountTypes.id, accountType.id))

    if (existing.length > 0) {
      // Update existing account type (preserve createdAt)
      const updated = await db
        .insert(accountTypes)
        .values({
          ...accountType,
          createdAt: (existing[0] as { createdAt: Date }).createdAt,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: accountTypes.id,
          set: {
            slug: accountType.slug,
            name: accountType.name,
            icon: accountType.icon,
            description: accountType.description,
            providers: accountType.providers,
            enabled: accountType.enabled,
            displayOrder: accountType.displayOrder,
            updatedAt: new Date(),
          },
        })

      results.push(...updated)
      console.log(`Updated account type: ${accountType.id}`)
    } else {
      // Insert new account type
      const inserted = await db
        .insert(accountTypes)
        .values(accountType)
        .returning()

      results.push(...inserted)
      console.log(`Created account type: ${accountType.id}`)
    }
  }

  console.log(`Seeded ${results.length} account types`)
  return results
}

/**
 * Run all seed functions.
 *
 * @param db - Drizzle database instance
 */
export async function seed(db: SeedDb) {
  console.log('Starting integrations seed...')
  console.log('')

  console.log('Seeding providers...')
  await seedProviders(db)
  console.log('')

  console.log('Seeding account types...')
  await seedAccountTypes(db)
  console.log('')

  console.log('Integrations seed complete!')
}

// ============================================================================
// PROVIDER CONSTANTS FOR TYPE-SAFE ACCESS
// ============================================================================

/**
 * Provider IDs for type-safe access.
 */
export const PROVIDER_IDS = {
  GITHUB: 'github',
  SLACK: 'slack',
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
  OPENROUTER: 'openrouter',
  STRIPE: 'stripe',
  GOOGLE: 'google',
  NOTION: 'notion',
  LINEAR: 'linear',
  DISCORD: 'discord',
  WORKOS: 'workos',
} as const

/**
 * Account type IDs for type-safe access.
 */
export const ACCOUNT_TYPE_IDS = {
  AUTH: 'auth',
  CHANNEL: 'channel',
  AI: 'ai',
  FINANCE: 'finance',
  DEVTOOLS: 'devtools',
  WORKSPACE: 'workspace',
} as const

export type ProviderId = typeof PROVIDER_IDS[keyof typeof PROVIDER_IDS]
export type AccountTypeId = typeof ACCOUNT_TYPE_IDS[keyof typeof ACCOUNT_TYPE_IDS]
