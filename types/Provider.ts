/**
 * Provider Thing Type Definitions
 *
 * Issue: dotdo-q900r
 *
 * Type definitions for Provider Things in the tool graph.
 * Providers represent external service integrations (SendGrid, Stripe, Slack, etc.)
 * and link to Tools via 'providedBy' and to Credentials via 'authenticatedBy'.
 *
 * @see db/compat/graph/src/tool-provider-graph.ts for implementation
 * @see lib/tools/provider-bridge.ts for compat/ integration
 */

import type { ThingData } from './Thing'

// ============================================================================
// Provider Status Types
// ============================================================================

/**
 * Provider health status
 */
export type ProviderHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown'

/**
 * Provider operational status
 */
export type ProviderStatus = 'active' | 'inactive' | 'deprecated' | 'maintenance'

// ============================================================================
// Provider Category Types
// ============================================================================

/**
 * Provider categories matching compat/ layer organization
 */
export type ProviderCategory =
  | 'ai'              // AI/ML providers (OpenAI, Anthropic, Cohere, Google AI)
  | 'analytics'       // Analytics (Segment, CubeJS)
  | 'auth'            // Authentication (Auth0, Clerk)
  | 'automation'      // Automation (Zapier, n8n)
  | 'cms'             // Content management (Contentful)
  | 'collaboration'   // Team tools (Slack, Discord)
  | 'commerce'        // E-commerce (Stripe, Shopify, WooCommerce, QuickBooks)
  | 'communication'   // Email/SMS/Calls (SendGrid, Twilio, Emails, Calls)
  | 'crm'             // CRM (Salesforce, HubSpot, Intercom, Klaviyo)
  | 'database'        // Databases (Postgres, DuckDB, Supabase)
  | 'devops'          // DevOps (GitHub, Sentry, Linear, Jira)
  | 'graph'           // Graph databases (Neo4j)
  | 'helpdesk'        // Support (Zendesk)
  | 'project'         // Project management (Linear, Jira)
  | 'queue'           // Message queues (SQS)
  | 'realtime'        // Real-time (Pusher)
  | 'search'          // Search (Algolia)
  | 'secrets'         // Secrets management (Doppler)
  | 'storage'         // Object storage (S3, GCS)
  | 'streaming'       // Stream processing (Flink)

// ============================================================================
// Provider Credential Types
// ============================================================================

/**
 * Credential types supported by providers
 */
export type CredentialType =
  | 'api_key'         // Simple API key in header
  | 'bearer_token'    // OAuth2 bearer token
  | 'basic_auth'      // HTTP Basic authentication
  | 'oauth2'          // Full OAuth2 flow with refresh
  | 'aws_signature'   // AWS Signature v4
  | 'custom'          // Provider-specific authentication

/**
 * Credential configuration for a provider
 */
export interface ProviderCredentialConfig {
  type: CredentialType
  /** Header name for API key (default: Authorization) */
  headerName?: string
  /** Header prefix (e.g., 'Bearer', 'Basic') */
  headerPrefix?: string
  /** Environment variable name for the credential */
  envVar?: string
  /** OAuth2 scopes if applicable */
  scopes?: string[]
  /** Whether the credential is required */
  required?: boolean
}

// ============================================================================
// Provider Thing Data
// ============================================================================

/**
 * Provider Thing data schema
 * Used in graph.create({ $type: 'Provider', data: ProviderThingData })
 */
export interface ProviderThingData {
  /** Provider name (e.g., 'SendGrid', 'Stripe', 'Slack') */
  name: string

  /** Provider category for organization */
  category: ProviderCategory | string

  /** Base URL for API requests */
  apiBaseUrl?: string

  /** Documentation URL */
  docsUrl?: string

  /** Icon URL for UI display */
  iconUrl?: string

  /** Provider description */
  description?: string

  /** Current operational status */
  status?: ProviderStatus

  /** Current health status */
  healthStatus?: ProviderHealthStatus

  /** Timestamp of last health check */
  lastHealthCheck?: number

  /** Priority for failover (lower = higher priority) */
  failoverPriority?: number

  /** Reference to compat/ module (e.g., '@dotdo/sendgrid') */
  compatModule?: string

  /** SDK version */
  sdkVersion?: string

  /** Provider capabilities (e.g., ['send', 'templates', 'webhooks']) */
  capabilities?: string[]

  /** Credential configuration */
  credential?: ProviderCredentialConfig
}

/**
 * Provider Thing interface
 * Extends ThingData with Provider-specific fields
 */
export interface ProviderThing extends Omit<ThingData, 'data'> {
  $type: 'Provider'
  data: ProviderThingData
}

// ============================================================================
// Tool Thing Data (for reference)
// ============================================================================

/**
 * Tool Thing data schema
 * Used in graph.create({ $type: 'Tool', data: ToolThingData })
 */
export interface ToolThingData {
  /** Unique tool identifier (e.g., 'communication.email.send') */
  id: string

  /** Human-readable tool name */
  name: string

  /** Tool description for AI/documentation */
  description?: string

  /** Tool category for organization */
  category?: string

  /** Reference to compat/ method (e.g., 'send') */
  compatMethod?: string

  /** Capability this tool provides */
  capability?: string

  /** Parameter schema in JSON Schema format */
  parameters?: Record<string, unknown>

  /** Optional tags for filtering/grouping */
  tags?: string[]

  /** Whether the tool is deprecated */
  deprecated?: boolean

  /** Rate limit tier */
  rateLimitTier?: 'low' | 'medium' | 'high' | 'unlimited'
}

/**
 * Tool Thing interface
 */
export interface ToolThing extends Omit<ThingData, 'data'> {
  $type: 'Tool'
  data: ToolThingData
}

// ============================================================================
// Credential Thing Data
// ============================================================================

/**
 * Credential Thing data schema
 * Used in graph.create({ $type: 'Credential', data: CredentialThingData })
 */
export interface CredentialThingData {
  /** Credential type */
  type: CredentialType

  /** Provider name this credential is for */
  provider: string

  /** Reference to secret storage (e.g., 'secrets://sendgrid-api-key') */
  secretRef: string

  /** When the credential was created */
  createdAt: number

  /** When the credential expires (for OAuth) */
  expiresAt?: number

  /** When the credential was last rotated */
  rotatedAt?: number

  /** When the credential was revoked */
  revokedAt?: number

  /** Reason for revocation */
  revocationReason?: string

  /** OAuth scopes granted */
  scopes?: string[]

  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Credential Thing interface
 */
export interface CredentialThing extends Omit<ThingData, 'data'> {
  $type: 'Credential'
  data: CredentialThingData
}

// ============================================================================
// Provider Relationship Types
// ============================================================================

/**
 * Tool -> Provider relationship (providedBy)
 */
export interface ProvidedByRelationship {
  verb: 'providedBy'
  from: string  // Tool $id
  to: string    // Provider $id
  data?: {
    /** Priority for multi-provider tools (lower = primary) */
    priority?: number
    /** Whether this is the primary provider */
    isPrimary?: boolean
    /** Override configuration */
    config?: Record<string, unknown>
  }
}

/**
 * Provider -> Credential relationship (authenticatedBy)
 */
export interface AuthenticatedByRelationship {
  verb: 'authenticatedBy'
  from: string  // Provider $id
  to: string    // Credential $id
  data?: {
    /** Whether this credential is currently active */
    isActive?: boolean
    /** When the credential was activated */
    activatedAt?: number
    /** When the credential was deactivated */
    deactivatedAt?: number
    /** OAuth grant type if applicable */
    grantType?: string
    /** When the credential was revoked */
    revokedAt?: number
    /** Reason for revocation */
    revocationReason?: string
  }
}

/**
 * Credential -> Credential relationship (rotatedFrom)
 */
export interface RotatedFromRelationship {
  verb: 'rotatedFrom'
  from: string  // New credential $id
  to: string    // Old credential $id
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * All provider-related Thing types
 */
export type ProviderRelatedThing = ProviderThing | ToolThing | CredentialThing

/**
 * All provider-related relationship types
 */
export type ProviderRelationship =
  | ProvidedByRelationship
  | AuthenticatedByRelationship
  | RotatedFromRelationship
