/**
 * @dotdo/lib/tools/provider-adapter.ts - Provider Tool Adapter Interface
 *
 * Common patterns extracted from compat/ providers for reusable tool registration.
 * Provides a unified interface for exposing compat SDKs as Tool Things.
 *
 * @example
 * ```typescript
 * import { createProviderAdapter, ToolCategory } from 'lib/tools/provider-adapter'
 *
 * const sendgridAdapter = createProviderAdapter({
 *   name: 'sendgrid',
 *   category: 'communication',
 *   credentialType: 'api_key',
 *   tools: [
 *     {
 *       id: 'send_email',
 *       name: 'Send Email',
 *       description: 'Send an email via SendGrid',
 *       parameters: sendEmailSchema,
 *       handler: async (params, credentials) => {
 *         const client = new SendGridClient({ apiKey: credentials.apiKey })
 *         return client.send(params)
 *       },
 *     },
 *   ],
 * })
 * ```
 *
 * @see compat/core/errors.ts for unified error handling
 * @see compat/core/retry.ts for retry infrastructure
 */

// =============================================================================
// Tool Categories
// =============================================================================

/**
 * Tool categories for organizing tools by function
 */
export type ToolCategory =
  | 'ai'              // AI/ML providers (OpenAI, Anthropic, Cohere)
  | 'analytics'       // Analytics (Segment, Google Analytics)
  | 'auth'            // Authentication (Auth0, Clerk)
  | 'automation'      // Automation (Zapier, n8n)
  | 'cms'             // Content management (Contentful)
  | 'collaboration'   // Team tools (Slack, Discord)
  | 'commerce'        // E-commerce (Stripe, Shopify)
  | 'communication'   // Email/SMS (SendGrid, Twilio)
  | 'crm'             // CRM (Salesforce, HubSpot)
  | 'database'        // Databases (Postgres, DuckDB)
  | 'devops'          // DevOps (GitHub, Sentry)
  | 'helpdesk'        // Support (Zendesk, Intercom)
  | 'project'         // Project management (Linear, Jira)
  | 'queue'           // Message queues (SQS)
  | 'search'          // Search (Algolia)
  | 'storage'         // Object storage (S3, GCS)

// =============================================================================
// Credential Types
// =============================================================================

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
export interface CredentialConfig {
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

/**
 * Runtime credentials passed to tool handlers
 */
export interface RuntimeCredentials {
  apiKey?: string
  accessToken?: string
  refreshToken?: string
  username?: string
  password?: string
  awsAccessKeyId?: string
  awsSecretAccessKey?: string
  awsSessionToken?: string
  custom?: Record<string, string>
}

// =============================================================================
// Tool Parameter Schema
// =============================================================================

/**
 * JSON Schema type for tool parameters
 */
export type ParameterType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'

/**
 * Parameter definition for a tool
 */
export interface ParameterDefinition {
  name: string
  type: ParameterType
  description?: string
  required?: boolean
  default?: unknown
  enum?: unknown[]
  items?: ParameterDefinition  // For array types
  properties?: Record<string, Omit<ParameterDefinition, 'name'>>  // For object types
}

/**
 * JSON Schema format for tool parameters
 */
export interface ParameterSchema {
  type: 'object'
  properties: Record<string, {
    type: ParameterType
    description?: string
    default?: unknown
    enum?: unknown[]
    items?: { type: ParameterType }
    properties?: Record<string, unknown>
  }>
  required?: string[]
}

// =============================================================================
// Tool Definition
// =============================================================================

/**
 * Handler function type for tool execution
 */
export type ToolHandler<TParams = unknown, TResult = unknown> = (
  params: TParams,
  credentials: RuntimeCredentials,
  context?: ToolContext
) => Promise<TResult>

/**
 * Context passed to tool handlers
 */
export interface ToolContext {
  /** Unique request ID for tracing */
  requestId?: string
  /** Timeout in milliseconds */
  timeout?: number
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Signal for cancellation */
  signal?: AbortSignal
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Tool definition for a single operation
 */
export interface ToolDefinition<TParams = unknown, TResult = unknown> {
  /** Unique tool identifier within the provider */
  id: string
  /** Human-readable tool name */
  name: string
  /** Tool description for AI/documentation */
  description: string
  /** Parameter schema in JSON Schema format */
  parameters: ParameterSchema
  /** Handler function that executes the tool */
  handler: ToolHandler<TParams, TResult>
  /** Optional tags for filtering/grouping */
  tags?: string[]
  /** Whether the tool is deprecated */
  deprecated?: boolean
  /** Deprecation message with migration guidance */
  deprecationMessage?: string
  /** Rate limit tier (requests per minute) */
  rateLimitTier?: 'low' | 'medium' | 'high' | 'unlimited'
  /** Whether the tool requires confirmation before execution */
  requiresConfirmation?: boolean
  /** Example invocations for documentation */
  examples?: ToolExample[]
}

/**
 * Example tool invocation for documentation
 */
export interface ToolExample {
  /** Example name */
  name: string
  /** Input parameters */
  input: Record<string, unknown>
  /** Expected output (for documentation) */
  output?: unknown
  /** Description of what this example demonstrates */
  description?: string
}

// =============================================================================
// Provider Adapter Interface
// =============================================================================

/**
 * Configuration for creating a provider adapter
 */
export interface ProviderAdapterConfig {
  /** Provider name (e.g., 'sendgrid', 'stripe') */
  name: string
  /** Display name for UI */
  displayName?: string
  /** Provider description */
  description?: string
  /** Tool category */
  category: ToolCategory
  /** Credential configuration */
  credential: CredentialConfig
  /** Base URL for API requests (optional) */
  baseUrl?: string
  /** Default timeout in milliseconds */
  timeout?: number
  /** Maximum retries */
  maxRetries?: number
  /** Tool definitions */
  tools: ToolDefinition[]
  /** Provider icon URL */
  iconUrl?: string
  /** Documentation URL */
  docsUrl?: string
  /** Provider version */
  version?: string
}

/**
 * Provider adapter interface for unified tool access
 */
export interface ProviderToolAdapter {
  /** Provider name */
  readonly name: string
  /** Display name */
  readonly displayName: string
  /** Provider description */
  readonly description: string
  /** Tool category */
  readonly category: ToolCategory
  /** Credential configuration */
  readonly credential: CredentialConfig

  /** Get all tool definitions */
  getTools(): ToolDefinition[]

  /** Get a specific tool by ID */
  getTool(id: string): ToolDefinition | undefined

  /** Execute a tool */
  execute<TResult = unknown>(
    toolId: string,
    params: Record<string, unknown>,
    credentials: RuntimeCredentials,
    context?: ToolContext
  ): Promise<TResult>

  /** Check if credentials are valid (optional pre-flight check) */
  validateCredentials?(credentials: RuntimeCredentials): Promise<boolean>

  /** Get provider metadata */
  getMetadata(): ProviderMetadata
}

/**
 * Provider metadata for registration
 */
export interface ProviderMetadata {
  name: string
  displayName: string
  description: string
  category: ToolCategory
  credential: CredentialConfig
  toolCount: number
  iconUrl?: string
  docsUrl?: string
  version?: string
}

// =============================================================================
// Provider Adapter Implementation
// =============================================================================

/**
 * Create a provider adapter from configuration
 */
export function createProviderAdapter(config: ProviderAdapterConfig): ProviderToolAdapter {
  const {
    name,
    displayName = name.charAt(0).toUpperCase() + name.slice(1),
    description = `${displayName} integration`,
    category,
    credential,
    tools,
    iconUrl,
    docsUrl,
    version = '1.0.0',
  } = config

  // Create a map for quick tool lookup
  const toolMap = new Map<string, ToolDefinition>()
  for (const tool of tools) {
    toolMap.set(tool.id, tool)
  }

  return {
    name,
    displayName,
    description,
    category,
    credential,

    getTools(): ToolDefinition[] {
      return [...tools]
    },

    getTool(id: string): ToolDefinition | undefined {
      return toolMap.get(id)
    },

    async execute<TResult = unknown>(
      toolId: string,
      params: Record<string, unknown>,
      credentials: RuntimeCredentials,
      context?: ToolContext
    ): Promise<TResult> {
      const tool = toolMap.get(toolId)
      if (!tool) {
        throw new ProviderError({
          code: 'TOOL_NOT_FOUND',
          message: `Tool '${toolId}' not found in provider '${name}'`,
          provider: name,
        })
      }

      try {
        return await tool.handler(params, credentials, context) as TResult
      } catch (error) {
        // Wrap errors in ProviderError if not already
        if (error instanceof ProviderError) {
          throw error
        }

        throw new ProviderError({
          code: 'TOOL_EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          provider: name,
          toolId,
          cause: error instanceof Error ? error : undefined,
        })
      }
    },

    getMetadata(): ProviderMetadata {
      return {
        name,
        displayName,
        description,
        category,
        credential,
        toolCount: tools.length,
        iconUrl,
        docsUrl,
        version,
      }
    },
  }
}

// =============================================================================
// Provider Error
// =============================================================================

/**
 * Options for creating a ProviderError
 */
export interface ProviderErrorOptions {
  code: string
  message: string
  provider: string
  toolId?: string
  statusCode?: number
  requestId?: string
  retryable?: boolean
  cause?: Error
  details?: Record<string, unknown>
}

/**
 * Unified error class for provider operations
 */
export class ProviderError extends Error {
  readonly code: string
  readonly provider: string
  readonly toolId?: string
  readonly statusCode: number
  readonly requestId?: string
  readonly retryable: boolean
  readonly details?: Record<string, unknown>

  constructor(options: ProviderErrorOptions) {
    super(options.message)
    this.name = 'ProviderError'
    this.code = options.code
    this.provider = options.provider
    this.toolId = options.toolId
    this.statusCode = options.statusCode ?? 500
    this.requestId = options.requestId
    this.retryable = options.retryable ?? false
    this.details = options.details
    this.cause = options.cause

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ProviderError)
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      provider: this.provider,
      toolId: this.toolId,
      statusCode: this.statusCode,
      requestId: this.requestId,
      retryable: this.retryable,
      details: this.details,
    }
  }
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if an error is a ProviderError
 */
export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create a parameter schema from parameter definitions
 */
export function createParameterSchema(
  parameters: ParameterDefinition[]
): ParameterSchema {
  const properties: ParameterSchema['properties'] = {}
  const required: string[] = []

  for (const param of parameters) {
    properties[param.name] = {
      type: param.type,
      description: param.description,
      default: param.default,
      enum: param.enum,
    }

    if (param.type === 'array' && param.items) {
      properties[param.name].items = { type: param.items.type }
    }

    if (param.type === 'object' && param.properties) {
      properties[param.name].properties = param.properties
    }

    if (param.required) {
      required.push(param.name)
    }
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  }
}

/**
 * Create a fully qualified tool ID
 */
export function createToolId(
  category: ToolCategory,
  provider: string,
  operation: string
): string {
  return `${category}.${provider}.${operation}`
}

/**
 * Parse a fully qualified tool ID
 */
export function parseToolId(toolId: string): {
  category: string
  provider: string
  operation: string
} | null {
  const parts = toolId.split('.')
  if (parts.length !== 3) {
    return null
  }
  return {
    category: parts[0],
    provider: parts[1],
    operation: parts[2],
  }
}
