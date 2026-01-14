/**
 * Tool - Base interface for tools that workers can use
 *
 * Tools are the fundamental building blocks that enable AI workers to interact
 * with external systems, perform actions, and access capabilities.
 *
 * @see https://schema.org.ai/Tool
 * @example
 * ```typescript
 * const searchTool = createTool({
 *   $id: 'search-web',
 *   name: 'Web Search',
 *   description: 'Search the web for information'
 * })
 * ```
 */
export interface Tool {
  /** Unique identifier for the tool */
  $id: string
  /** JSON-LD type identifier */
  $type: 'https://schema.org.ai/Tool'
  /** Human-readable name */
  name: string
  /** Description of what the tool does */
  description: string
}

/**
 * Integration - External service integration (Stripe, GitHub, etc.)
 *
 * Integrations connect to third-party APIs and services, providing
 * standardized access to external platforms like payment processors,
 * code repositories, and communication tools.
 *
 * @see https://schema.org.ai/Integration
 * @example
 * ```typescript
 * const stripeIntegration = createIntegration({
 *   $id: 'stripe',
 *   name: 'Stripe',
 *   description: 'Payment processing integration',
 *   provider: 'stripe',
 *   apiVersion: '2024-12-18',
 *   authentication: 'api_key',
 *   baseUrl: 'https://api.stripe.com/v1'
 * })
 * ```
 */
export interface Integration extends Omit<Tool, '$type'> {
  /** JSON-LD type identifier */
  $type: 'https://schema.org.ai/Integration'
  /** Provider name (e.g., 'stripe', 'github', 'slack') */
  provider: string
  /** API version string */
  apiVersion: string
  /** Authentication method required */
  authentication: 'api_key' | 'oauth' | 'bearer' | 'basic'
  /** Base URL for API requests */
  baseUrl: string
}

/**
 * Capability - Internal capability (fsx, gitx, bashx)
 *
 * Capabilities are internal system features that provide access to
 * local resources like file systems, git repositories, shell commands,
 * and other system-level operations.
 *
 * @see https://schema.org.ai/Capability
 * @example
 * ```typescript
 * const fsCapability = createCapability({
 *   $id: 'fsx',
 *   name: 'File System Extended',
 *   description: 'Extended file system operations',
 *   permissions: ['read', 'write', 'delete'],
 *   scope: 'workspace'
 * })
 * ```
 */
export interface Capability extends Omit<Tool, '$type'> {
  /** JSON-LD type identifier */
  $type: 'https://schema.org.ai/Capability'
  /** Required permissions for this capability */
  permissions: string[]
  /** Scope of the capability's access */
  scope: 'workspace' | 'global' | 'user' | 'system'
}

/**
 * Creates a Tool instance with the correct $type
 * @param input - Tool properties without the $type field
 * @returns A complete Tool object
 */
export function createTool(input: Omit<Tool, '$type'>): Tool {
  return { ...input, $type: 'https://schema.org.ai/Tool' }
}

/**
 * Creates an Integration instance with the correct $type
 * @param input - Integration properties without the $type field
 * @returns A complete Integration object
 */
export function createIntegration(input: Omit<Integration, '$type'>): Integration {
  return { ...input, $type: 'https://schema.org.ai/Integration' }
}

/**
 * Creates a Capability instance with the correct $type
 * @param input - Capability properties without the $type field
 * @returns A complete Capability object
 */
export function createCapability(input: Omit<Capability, '$type'>): Capability {
  return { ...input, $type: 'https://schema.org.ai/Capability' }
}
