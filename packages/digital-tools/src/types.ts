import { z } from 'zod'

/**
 * Tool - A tool that humans or agents can use
 *
 * Tools are capabilities or utilities that can be invoked to perform actions.
 * They are used by Workers (Human or Agent) to accomplish tasks. Tools represent
 * the fundamental building blocks that enable AI workers to interact with
 * external systems, perform actions, and access capabilities.
 *
 * @see https://schema.org.ai/Tool
 * @see {@link ToolSchema} - Zod schema for runtime validation
 * @see {@link isTool} - Type guard for checking Tool instances
 * @see {@link createTool} - Factory function for creating Tool objects
 *
 * @example
 * ```typescript
 * const searchTool: Tool = {
 *   $id: 'https://schema.org.ai/tools/web-search',
 *   $type: 'https://schema.org.ai/Tool',
 *   name: 'Web Search',
 *   description: 'Search the web for information',
 *   category: 'search',
 *   version: '1.0.0'
 * }
 * ```
 */
export interface Tool {
  /** Unique identifier for the tool (URI format recommended) */
  $id: string
  /** JSON-LD type identifier - always 'https://schema.org.ai/Tool' */
  $type: 'https://schema.org.ai/Tool'
  /** Human-readable name of the tool */
  name: string
  /** Description of what the tool does and when to use it */
  description: string
  /** Optional category for grouping related tools (e.g., 'search', 'file', 'api') */
  category?: string
  /** Optional semantic version string (e.g., '1.0.0') */
  version?: string
}

/**
 * Zod schema for validating Tool objects at runtime
 *
 * Use this schema for validating untrusted input or API responses.
 *
 * @see {@link Tool} - The TypeScript interface this validates
 * @see {@link isTool} - Convenience type guard using this schema
 *
 * @example
 * ```typescript
 * const result = ToolSchema.safeParse(unknownData)
 * if (result.success) {
 *   const tool: Tool = result.data
 * }
 * ```
 */
export const ToolSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Tool'),
  name: z.string(),
  description: z.string(),
  category: z.string().optional(),
  version: z.string().optional()
})

/**
 * Type guard to check if an object is a valid Tool
 *
 * Uses Zod schema validation internally for comprehensive checking.
 *
 * @param obj - Object to validate
 * @returns True if the object is a valid Tool, with TypeScript type narrowing
 *
 * @see {@link Tool} - The interface being validated
 * @see {@link ToolSchema} - The underlying Zod schema
 *
 * @example
 * ```typescript
 * if (isTool(obj)) {
 *   console.log(obj.name) // TypeScript knows obj is Tool
 *   console.log(obj.description)
 * }
 * ```
 */
export function isTool(obj: unknown): obj is Tool {
  return ToolSchema.safeParse(obj).success
}

/**
 * Factory function to create a new Tool
 *
 * Automatically sets the `$type` field to the correct schema.org.ai URL.
 * This is the recommended way to create Tool objects to ensure type consistency.
 *
 * @param input - Tool data without the $type field
 * @returns A complete Tool object with $type set
 *
 * @see {@link Tool} - The interface being created
 *
 * @example
 * ```typescript
 * const tool = createTool({
 *   $id: 'https://schema.org.ai/tools/code-search',
 *   name: 'Code Search',
 *   description: 'Search code repositories for patterns',
 *   category: 'search'
 * })
 * // tool.$type is automatically 'https://schema.org.ai/Tool'
 * ```
 */
export function createTool(input: Omit<Tool, '$type'>): Tool {
  return { ...input, $type: 'https://schema.org.ai/Tool' }
}

/**
 * Integration - External service connection (Stripe, Slack, GitHub, etc.)
 *
 * Integrations represent connections to third-party APIs and services,
 * providing standardized access to external platforms like payment processors,
 * code repositories, communication tools, and cloud services.
 *
 * Integrations differ from Tools in that they represent persistent connections
 * to external services that may require authentication and maintain state.
 *
 * @see https://schema.org.ai/Integration
 * @see {@link IntegrationSchema} - Zod schema for runtime validation
 * @see {@link isIntegration} - Type guard for checking Integration instances
 * @see {@link createIntegration} - Factory function for creating Integration objects
 *
 * @example
 * ```typescript
 * const stripeIntegration: Integration = {
 *   $id: 'https://schema.org.ai/integrations/stripe',
 *   $type: 'https://schema.org.ai/Integration',
 *   name: 'Stripe',
 *   description: 'Payment processing integration for subscriptions and charges',
 *   provider: 'stripe',
 *   authType: 'api_key',
 *   baseUrl: 'https://api.stripe.com/v1'
 * }
 * ```
 */
export interface Integration {
  /** Unique identifier for the integration (URI format recommended) */
  $id: string
  /** JSON-LD type identifier - always 'https://schema.org.ai/Integration' */
  $type: 'https://schema.org.ai/Integration'
  /** Human-readable name of the integration */
  name: string
  /** Description of what the integration provides and its use cases */
  description: string
  /** Provider identifier (e.g., 'stripe', 'github', 'slack', 'openai') */
  provider: string
  /** Authentication method required to connect */
  authType: 'oauth' | 'api_key' | 'bearer' | 'none'
  /** Base URL for API requests (optional, may be determined by provider) */
  baseUrl?: string
}

/**
 * Zod schema for validating Integration objects at runtime
 *
 * Use this schema for validating untrusted input or API responses.
 *
 * @see {@link Integration} - The TypeScript interface this validates
 * @see {@link isIntegration} - Convenience type guard using this schema
 *
 * @example
 * ```typescript
 * const result = IntegrationSchema.safeParse(apiResponse)
 * if (result.success) {
 *   const integration: Integration = result.data
 *   console.log(`Provider: ${integration.provider}`)
 * }
 * ```
 */
export const IntegrationSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Integration'),
  name: z.string(),
  description: z.string(),
  provider: z.string(),
  authType: z.enum(['oauth', 'api_key', 'bearer', 'none']),
  baseUrl: z.string().optional()
})

/**
 * Type guard to check if an object is a valid Integration
 *
 * Uses Zod schema validation internally for comprehensive checking.
 *
 * @param obj - Object to validate
 * @returns True if the object is a valid Integration, with TypeScript type narrowing
 *
 * @see {@link Integration} - The interface being validated
 * @see {@link IntegrationSchema} - The underlying Zod schema
 *
 * @example
 * ```typescript
 * if (isIntegration(obj)) {
 *   console.log(obj.provider) // TypeScript knows obj is Integration
 *   console.log(obj.authType)
 * }
 * ```
 */
export function isIntegration(obj: unknown): obj is Integration {
  return IntegrationSchema.safeParse(obj).success
}

/**
 * Factory function to create a new Integration
 *
 * Automatically sets the `$type` field to the correct schema.org.ai URL.
 * This is the recommended way to create Integration objects to ensure type consistency.
 *
 * @param input - Integration data without the $type field
 * @returns A complete Integration object with $type set
 *
 * @see {@link Integration} - The interface being created
 *
 * @example
 * ```typescript
 * const github = createIntegration({
 *   $id: 'https://schema.org.ai/integrations/github',
 *   name: 'GitHub',
 *   description: 'GitHub API integration for repositories and issues',
 *   provider: 'github',
 *   authType: 'oauth',
 *   baseUrl: 'https://api.github.com'
 * })
 * // github.$type is automatically 'https://schema.org.ai/Integration'
 * ```
 */
export function createIntegration(input: Omit<Integration, '$type'>): Integration {
  return { ...input, $type: 'https://schema.org.ai/Integration' }
}

/**
 * Capability - Permissions and abilities (fsx, gitx, bashx, etc.)
 *
 * Capabilities represent internal system features that provide access to
 * local resources like file systems, git repositories, shell commands,
 * and other system-level operations. They define what actions a worker
 * is permitted to perform and what resources it can access.
 *
 * Capabilities differ from Tools and Integrations in that they represent
 * permission boundaries and internal system access rather than external services.
 *
 * @see https://schema.org.ai/Capability
 * @see {@link CapabilitySchema} - Zod schema for runtime validation
 * @see {@link isCapability} - Type guard for checking Capability instances
 * @see {@link createCapability} - Factory function for creating Capability objects
 *
 * @example
 * ```typescript
 * const fsCapability: Capability = {
 *   $id: 'https://schema.org.ai/capabilities/fsx',
 *   $type: 'https://schema.org.ai/Capability',
 *   name: 'File System Extended',
 *   description: 'Extended file system operations with sandboxing',
 *   permissions: ['read', 'write', 'delete', 'watch'],
 *   requires: ['sandbox']
 * }
 * ```
 */
export interface Capability {
  /** Unique identifier for the capability (URI format recommended) */
  $id: string
  /** JSON-LD type identifier - always 'https://schema.org.ai/Capability' */
  $type: 'https://schema.org.ai/Capability'
  /** Human-readable name of the capability */
  name: string
  /** Description of what the capability provides and its scope */
  description: string
  /** List of permissions granted by this capability (e.g., 'read', 'write', 'execute') */
  permissions: string[]
  /** Optional list of other capability IDs that must be present for this capability */
  requires?: string[]
}

/**
 * Zod schema for validating Capability objects at runtime
 *
 * Use this schema for validating untrusted input or API responses.
 *
 * @see {@link Capability} - The TypeScript interface this validates
 * @see {@link isCapability} - Convenience type guard using this schema
 *
 * @example
 * ```typescript
 * const result = CapabilitySchema.safeParse(config.capability)
 * if (result.success) {
 *   const capability: Capability = result.data
 *   console.log(`Permissions: ${capability.permissions.join(', ')}`)
 * }
 * ```
 */
export const CapabilitySchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Capability'),
  name: z.string(),
  description: z.string(),
  permissions: z.array(z.string()),
  requires: z.array(z.string()).optional()
})

/**
 * Type guard to check if an object is a valid Capability
 *
 * Uses Zod schema validation internally for comprehensive checking.
 *
 * @param obj - Object to validate
 * @returns True if the object is a valid Capability, with TypeScript type narrowing
 *
 * @see {@link Capability} - The interface being validated
 * @see {@link CapabilitySchema} - The underlying Zod schema
 *
 * @example
 * ```typescript
 * if (isCapability(obj)) {
 *   console.log(obj.permissions) // TypeScript knows obj is Capability
 *   if (obj.requires) {
 *     console.log(`Requires: ${obj.requires.join(', ')}`)
 *   }
 * }
 * ```
 */
export function isCapability(obj: unknown): obj is Capability {
  return CapabilitySchema.safeParse(obj).success
}

/**
 * Factory function to create a new Capability
 *
 * Automatically sets the `$type` field to the correct schema.org.ai URL.
 * This is the recommended way to create Capability objects to ensure type consistency.
 *
 * @param input - Capability data without the $type field
 * @returns A complete Capability object with $type set
 *
 * @see {@link Capability} - The interface being created
 *
 * @example
 * ```typescript
 * const gitCapability = createCapability({
 *   $id: 'https://schema.org.ai/capabilities/gitx',
 *   name: 'Git Extended',
 *   description: 'Git operations with safety guards',
 *   permissions: ['clone', 'commit', 'push', 'pull'],
 *   requires: ['fsx']
 * })
 * // gitCapability.$type is automatically 'https://schema.org.ai/Capability'
 * ```
 */
export function createCapability(input: Omit<Capability, '$type'>): Capability {
  return { ...input, $type: 'https://schema.org.ai/Capability' }
}
