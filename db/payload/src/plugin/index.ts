/**
 * dotdo Payload Plugin
 *
 * Integrates dotdo workflows and sync capabilities with Payload CMS.
 */

import type { Config, Endpoint } from 'payload'
import type {
  DotdoPluginConfig,
  ResolvedDotdoPluginConfig,
  PayloadPlugin,
} from './types'

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
 * Creates the sync endpoint
 */
function createSyncEndpoint(
  resolvedConfig: ResolvedDotdoPluginConfig
): Endpoint {
  return {
    path: '/dotdo/sync',
    method: 'post',
    handler: async (req) => {
      if (resolvedConfig.onSync) {
        const body = await req.json?.()
        await resolvedConfig.onSync({
          collection: body?.collection ?? '',
          operation: body?.operation ?? 'update',
          doc: body?.doc ?? {},
        })
      }
      return Response.json({ success: true })
    },
  }
}

/**
 * Creates the workflow endpoint
 */
function createWorkflowEndpoint(
  resolvedConfig: ResolvedDotdoPluginConfig
): Endpoint {
  return {
    path: '/dotdo/workflow',
    method: 'post',
    handler: async (req) => {
      if (resolvedConfig.onWorkflow) {
        const body = await req.json?.()
        await resolvedConfig.onWorkflow({
          workflow: body?.workflow ?? '',
          step: body?.step ?? '',
          data: body?.data ?? {},
        })
      }
      return Response.json({ success: true })
    },
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
export function dotdoPlugin(pluginConfig: DotdoPluginConfig): PayloadPlugin {
  // Validate configuration upfront
  validateNamespace(pluginConfig.namespace)

  const resolvedConfig = resolveConfig(pluginConfig)

  return (incomingConfig: Config): Config => {
    // Build endpoints array
    const newEndpoints: Endpoint[] = []

    if (resolvedConfig.syncEndpoint) {
      newEndpoints.push(createSyncEndpoint(resolvedConfig))
    }

    if (resolvedConfig.workflowEndpoint) {
      newEndpoints.push(createWorkflowEndpoint(resolvedConfig))
    }

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
