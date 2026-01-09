/**
 * API Docs Configuration
 *
 * Provides configuration and utilities for the OpenAPI documentation pages.
 * Extracts operation information from the OpenAPI spec for navigation and routing.
 */

import { getOpenAPIDocument } from '../../../api/routes/openapi'

// ============================================================================
// Types
// ============================================================================

export interface APIDocsConfig {
  specUrl: string
  basePath: string
  operations: OperationDoc[]
  securitySchemes: SecuritySchemeDoc[]
}

export interface OperationDoc {
  operationId: string
  method: string
  path: string
  summary: string
  description?: string
  tags: string[]
  docsPath: string
}

export interface SecuritySchemeDoc {
  name: string
  type: string
  description: string
  location?: string
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get the API documentation configuration
 * Extracts operations and security schemes from the OpenAPI spec
 */
export function getAPIDocsConfiguration(): APIDocsConfig {
  const spec = getOpenAPIDocument()

  const operations: OperationDoc[] = []
  const methods = ['get', 'post', 'put', 'delete', 'patch'] as const

  // Extract operations from paths
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const method of methods) {
      const operation = (pathItem as Record<string, unknown>)[method] as {
        operationId?: string
        summary?: string
        description?: string
        tags?: string[]
      } | undefined

      if (operation) {
        const docsPath = pathToDocsPath(path)
        operations.push({
          operationId: operation.operationId || `${method}_${path.replace(/\//g, '_')}`,
          method: method.toUpperCase(),
          path,
          summary: operation.summary || '',
          description: operation.description,
          tags: operation.tags || [],
          docsPath: `/docs/api${docsPath}`,
        })
      }
    }
  }

  // Extract security schemes
  const securitySchemes: SecuritySchemeDoc[] = []
  const schemes = (spec.components as { securitySchemes?: Record<string, unknown> })?.securitySchemes || {}

  for (const [name, scheme] of Object.entries(schemes)) {
    const s = scheme as { type?: string; description?: string; in?: string }
    securitySchemes.push({
      name,
      type: s.type || 'unknown',
      description: s.description || '',
      location: s.in,
    })
  }

  return {
    specUrl: 'https://api.dotdo.dev/api/openapi.json',
    basePath: '/docs/api',
    operations,
    securitySchemes,
  }
}

/**
 * Convert an API path to a docs path
 * /api/things/{id} -> /things-id
 */
function pathToDocsPath(apiPath: string): string {
  return apiPath
    .replace(/^\/api/, '') // Remove /api prefix
    .replace(/\{([^}]+)\}/g, '-$1') // Convert {param} to -param
    .replace(/\/+/g, '/') // Normalize slashes
}

/**
 * Get operation by ID
 */
export function getOperation(operationId: string): OperationDoc | undefined {
  const config = getAPIDocsConfiguration()
  return config.operations.find((op) => op.operationId === operationId)
}

/**
 * Get operations by tag
 */
export function getOperationsByTag(tag: string): OperationDoc[] {
  const config = getAPIDocsConfiguration()
  return config.operations.filter((op) => op.tags.includes(tag))
}

export default { getAPIDocsConfiguration, getOperation, getOperationsByTag }
