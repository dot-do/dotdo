/**
 * @dotdo/lib/tools - Provider Tool Adapter Infrastructure
 *
 * Common patterns extracted from compat/ providers for reusable tool registration.
 * Provides a unified interface for exposing compat SDKs as Tool Things.
 *
 * @example
 * ```typescript
 * import {
 *   createProviderAdapter,
 *   ProviderRegistry,
 *   globalRegistry,
 * } from 'lib/tools'
 *
 * // Create an adapter
 * const myAdapter = createProviderAdapter({
 *   name: 'myservice',
 *   category: 'communication',
 *   credential: { type: 'api_key', envVar: 'MY_API_KEY' },
 *   tools: [
 *     {
 *       id: 'send',
 *       name: 'Send Message',
 *       description: 'Send a message',
 *       parameters: { type: 'object', properties: {} },
 *       handler: async (params, creds) => { ... },
 *     },
 *   ],
 * })
 *
 * // Register with global registry
 * globalRegistry.register(myAdapter)
 *
 * // Execute a tool
 * const result = await globalRegistry.execute(
 *   'myservice',
 *   'send',
 *   { message: 'Hello' },
 *   { apiKey: 'xxx' }
 * )
 * ```
 *
 * @module lib/tools
 */

// =============================================================================
// Provider Adapter
// =============================================================================

export {
  // Types
  type ToolCategory,
  type CredentialType,
  type CredentialConfig,
  type RuntimeCredentials,
  type ParameterType,
  type ParameterDefinition,
  type ParameterSchema,
  type ToolHandler,
  type ToolContext,
  type ToolDefinition,
  type ToolExample,
  type ProviderAdapterConfig,
  type ProviderToolAdapter,
  type ProviderMetadata,
  type ProviderErrorOptions,
  // Functions
  createProviderAdapter,
  createParameterSchema,
  createToolId,
  parseToolId,
  // Error class
  ProviderError,
  isProviderError,
} from './provider-adapter'

// =============================================================================
// Auto-Registration
// =============================================================================

export {
  // Classes
  ProviderRegistry,
  // Types
  type ProviderFilter,
  type ToolFilter,
  type ToolWithProvider,
  type RegistrationEventType,
  type RegistrationEvent,
  type RegistrationEventListener,
  type RegistryStats,
  type AdapterFactory,
  type LoadResult,
  type ToolThing,
  type ProviderThing,
  // Global instance
  globalRegistry,
  // Functions
  registerAdapterFactory,
  getAdapterFactoryNames,
  loadProvider,
  loadAllProviders,
  registryToThings,
  createTestRegistry,
} from './auto-register'

// =============================================================================
// Permission Enforcement via Graph
// =============================================================================

export {
  // Types
  type PermissionCheckResult,
  // Error class
  PermissionDeniedError,
  // Permission check functions
  checkToolPermission,
  checkSecurityLevel,
  checkFullPermission,
  // Permission management helpers
  grantPermission,
  revokePermission,
  requirePermission,
  getExecutorPermissions,
  getToolPermissions,
} from './permissions'

// Re-export types from types/Permission.ts
export type {
  PermissionType,
  PermissionScope,
  PermissionThingData,
  SecurityLevel,
  ToolThingData,
  ExecutorThingData,
} from '../../types/Permission'

export { SECURITY_LEVELS, getSecurityLevelIndex, canAccessSecurityLevel } from '../../types/Permission'
