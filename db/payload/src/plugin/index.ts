/**
 * dotdo Payload Plugin
 *
 * Integrates dotdo workflows and sync capabilities with Payload CMS.
 */

// Conditional import for peer dependency
// @ts-ignore - payload is a peer dependency
import type { Config, Endpoint } from 'payload'
import type {
  DotdoPluginConfig,
  ResolvedDotdoPluginConfig,
  PayloadPlugin,
} from './types'
import { createEndpoints, type EndpointPluginConfig } from './endpoints'

/**
 * Validates the namespace URL
 * @throws Error if the namespace is not a valid URL
 */
function validateNamespace(namespace: string | undefined): void {
  if (namespace === undefined) return

  try {
    new URL(namespace)
  } catch {
    throw new Error(
      `Invalid namespace URL: "${namespace}". Must be a valid URL (e.g., 'https://example.do')`
    )
  }
}

/**
 * Resolves plugin configuration with defaults
 */
function resolveConfig(config: DotdoPluginConfig): ResolvedDotdoPluginConfig {
  return {
    namespace: config.namespace,
    syncEndpoint: config.syncEndpoint ?? false,
    workflowEndpoint: config.workflowEndpoint ?? false,
    onSync: config.onSync,
    onWorkflow: config.onWorkflow,
  }
}

/**
 * dotdo Payload Plugin
 *
 * Creates a Payload plugin that integrates dotdo sync and workflow capabilities.
 *
 * @example
 * ```typescript
 * import { buildConfig } from 'payload'
 * import { dotdoPlugin } from '@dotdo/payload/plugin'
 *
 * export default buildConfig({
 *   plugins: [
 *     dotdoPlugin({
 *       namespace: 'https://example.do',
 *       syncEndpoint: true,
 *       workflowEndpoint: true,
 *       onSync: ({ collection, operation, doc }) => {
 *         console.log(`Synced ${operation} on ${collection}`)
 *       },
 *     }),
 *   ],
 *   // ... rest of config
 * })
 * ```
 *
 * @param pluginConfig - Configuration options for the plugin
 * @returns A Payload plugin function
 */
export function dotdoPlugin(
  pluginConfig: DotdoPluginConfig & { syncPath?: string; workflowPath?: string }
): PayloadPlugin {
  // Validate configuration upfront
  validateNamespace(pluginConfig.namespace)

  const resolvedConfig = resolveConfig(pluginConfig)

  return (incomingConfig: Config): Config => {
    // Build endpoints array using the endpoints module
    const newEndpoints: Endpoint[] = createEndpoints(
      resolvedConfig,
      pluginConfig as EndpointPluginConfig
    )

    // Merge with existing config
    return {
      ...incomingConfig,
      // Preserve existing collections
      collections: [...(incomingConfig.collections ?? [])],
      // Merge endpoints
      endpoints: [...(incomingConfig.endpoints ?? []), ...newEndpoints],
    }
  }
}

// Re-export types
export type {
  DotdoPluginConfig,
  ResolvedDotdoPluginConfig,
  PayloadPlugin,
  OnSyncCallback,
  OnWorkflowCallback,
} from './types'
