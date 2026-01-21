// Discovery service - business logic for API discoverability (HATEOAS)
// Separates discovery logic from route handlers (clean architecture)

import { generateAPIRoot, generateErrorLinks, type Link } from '../hateoas'
import { getAllResources } from '../resource'

/**
 * API root response structure
 */
export interface APIRootResponse {
  name: string
  version: string
  description: string
  _links: Record<string, Link>
}

/**
 * Error response with discovery links
 */
export interface ErrorWithLinks {
  error: string
  status: number
  path: string
  requestId: string
  _links: Record<string, Link>
}

/**
 * Discovery service configuration
 */
export interface DiscoveryServiceConfig {
  name?: string
  version?: string
  description?: string
  openapi?: {
    json?: string
    yaml?: string
  }
  docsPath?: string
  healthPath?: string
  readyPath?: string
}

/**
 * DiscoveryService handles API discoverability business logic.
 *
 * Generates self-describing API responses with HATEOAS links.
 * Route handlers call this service and return the response.
 */
export class DiscoveryService {
  private readonly config: Required<Omit<DiscoveryServiceConfig, 'openapi'>> & {
    openapi: { json: string; yaml: string }
  }

  constructor(config: DiscoveryServiceConfig = {}) {
    this.config = {
      name: config.name ?? 'dotdo API',
      version: config.version ?? '1.0.0',
      description: config.description ?? 'Self-describing HATEOAS API',
      openapi: {
        json: config.openapi?.json ?? '/openapi.json',
        yaml: config.openapi?.yaml ?? '/openapi.yaml'
      },
      docsPath: config.docsPath ?? '/docs',
      healthPath: config.healthPath ?? '/health',
      readyPath: config.readyPath ?? '/ready'
    }
  }

  /**
   * Generate API root response with all discovery links.
   * This is the entry point for a fully discoverable API.
   */
  getAPIRoot(baseUrl: string): APIRootResponse {
    // Get all registered resources to make them discoverable
    const registeredResources = getAllResources()
    const resources: Record<string, { path: string; title: string; description?: string }> = {}

    for (const [name, definition] of Object.entries(registeredResources)) {
      resources[name.toLowerCase()] = {
        path: definition.routes?.list?.path || `/${name.toLowerCase()}`,
        title: `${name} collection`,
        description: `CRUD operations for ${name}`
      }
    }

    // Generate fully discoverable API root with HATEOAS links
    const apiRoot = generateAPIRoot({
      name: this.config.name,
      version: this.config.version,
      description: this.config.description,
      baseUrl,
      resources,
      openapi: this.config.openapi,
      docsPath: this.config.docsPath,
      healthPath: this.config.healthPath
    })

    // Add readiness check link (not in standard generateAPIRoot)
    apiRoot._links['ready'] = {
      href: `${baseUrl}${this.config.readyPath}`,
      rel: 'related',
      method: 'GET',
      title: 'Readiness check endpoint',
      type: 'application/json',
      name: 'ready'
    }

    return apiRoot
  }

  /**
   * Generate a 404 error response with discovery links.
   * Even error responses should help users find the right resources.
   */
  getNotFoundError(baseUrl: string, path: string, requestId: string): ErrorWithLinks {
    return {
      error: 'Not Found',
      status: 404,
      path,
      requestId,
      _links: generateErrorLinks(baseUrl, {
        docsPath: this.config.docsPath,
        healthPath: this.config.healthPath
      })
    }
  }

  /**
   * Get the configured paths for linking
   */
  getPaths(): { docsPath: string; healthPath: string; readyPath: string } {
    return {
      docsPath: this.config.docsPath,
      healthPath: this.config.healthPath,
      readyPath: this.config.readyPath
    }
  }
}

// Default singleton instance for simple use cases
let defaultDiscoveryService: DiscoveryService | null = null

/**
 * Get or create the default discovery service instance
 */
export function getDiscoveryService(config?: DiscoveryServiceConfig): DiscoveryService {
  if (!defaultDiscoveryService || config) {
    defaultDiscoveryService = new DiscoveryService(config)
  }
  return defaultDiscoveryService
}

/**
 * Reset the default discovery service (useful for testing)
 */
export function resetDiscoveryService(): void {
  defaultDiscoveryService = null
}
