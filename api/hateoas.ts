// HATEOAS link generation - self-describing APIs

export interface Link {
  href: string
  rel: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  title?: string
}

export interface HATEOASResponse<T> {
  data: T
  _links: Record<string, Link>
}

export interface ResourceConfig {
  basePath: string
  actions?: string[]
  relations?: Record<string, { resource: string; type: 'hasOne' | 'hasMany' }>
}

// Generate links for a single resource
export function generateLinks(
  resource: string,
  id: string,
  baseUrl: string,
  config?: Partial<ResourceConfig>
): Record<string, Link> {
  const base = `${baseUrl}/${resource}`
  const links: Record<string, Link> = {
    self: {
      href: `${base}/${id}`,
      rel: 'self',
      method: 'GET',
      title: `Get ${resource}`
    },
    update: {
      href: `${base}/${id}`,
      rel: 'update',
      method: 'PUT',
      title: `Update ${resource}`
    },
    delete: {
      href: `${base}/${id}`,
      rel: 'delete',
      method: 'DELETE',
      title: `Delete ${resource}`
    },
    collection: {
      href: base,
      rel: 'collection',
      method: 'GET',
      title: `List all ${resource}`
    }
  }

  // Add relation links
  if (config?.relations) {
    for (const [name, _rel] of Object.entries(config.relations)) {
      links[name] = {
        href: `${base}/${id}/${name}`,
        rel: name,
        method: 'GET',
        title: `Get ${name} for ${resource}`
      }
    }
  }

  // Add custom action links
  if (config?.actions) {
    for (const action of config.actions) {
      links[action] = {
        href: `${base}/${id}/${action}`,
        rel: action,
        method: 'POST',
        title: `${action} ${resource}`
      }
    }
  }

  return links
}

// Generate links for a collection
export function generateCollectionLinks(
  resource: string,
  baseUrl: string,
  options?: { page?: number; limit?: number; total?: number }
): Record<string, Link> {
  const base = `${baseUrl}/${resource}`
  const { page = 1, limit = 20, total } = options || {}

  const links: Record<string, Link> = {
    self: {
      href: `${base}?page=${page}&limit=${limit}`,
      rel: 'self',
      method: 'GET'
    },
    create: {
      href: base,
      rel: 'create',
      method: 'POST',
      title: `Create ${resource}`
    }
  }

  // Pagination links
  if (page > 1) {
    links['prev'] = {
      href: `${base}?page=${page - 1}&limit=${limit}`,
      rel: 'prev',
      method: 'GET'
    }
    links['first'] = {
      href: `${base}?page=1&limit=${limit}`,
      rel: 'first',
      method: 'GET'
    }
  }

  if (total && page * limit < total) {
    links['next'] = {
      href: `${base}?page=${page + 1}&limit=${limit}`,
      rel: 'next',
      method: 'GET'
    }
    links['last'] = {
      href: `${base}?page=${Math.ceil(total / limit)}&limit=${limit}`,
      rel: 'last',
      method: 'GET'
    }
  }

  return links
}

// Wrap data with HATEOAS links
export function withLinks<T>(
  data: T,
  links: Record<string, Link>
): HATEOASResponse<T> {
  return { data, _links: links }
}

// Wrap collection with HATEOAS links
export function withCollectionLinks<T>(
  items: T[],
  resource: string,
  baseUrl: string,
  getId: (item: T) => string,
  options?: { page?: number; limit?: number; total?: number }
): HATEOASResponse<Array<T & { _links: Record<string, Link> }>> {
  const itemsWithLinks = items.map(item => ({
    ...item,
    _links: generateLinks(resource, getId(item), baseUrl)
  }))

  return {
    data: itemsWithLinks,
    _links: generateCollectionLinks(resource, baseUrl, options)
  }
}

/**
 * Configuration for API root links
 */
export interface APIRootConfig {
  /** API name */
  name?: string
  /** API version */
  version?: string
  /** API description */
  description?: string
  /** Base URL for the API */
  baseUrl: string
  /** Available resources with their paths */
  resources?: Record<string, {
    path: string
    title?: string
    description?: string
  }>
  /** OpenAPI specification paths */
  openapi?: {
    json?: string
    yaml?: string
  }
  /** Documentation URL */
  docsPath?: string
  /** Health check endpoint */
  healthPath?: string
}

/**
 * Generate links for the API root endpoint.
 * This makes the entire API discoverable from a single entry point.
 */
export function generateAPIRootLinks(config: APIRootConfig): Record<string, Link> {
  const { baseUrl, resources = {}, openapi, docsPath, healthPath } = config

  const links: Record<string, Link> = {
    self: {
      href: `${baseUrl}/`,
      rel: 'self',
      method: 'GET',
      title: 'API Root'
    }
  }

  // Add health check link
  if (healthPath) {
    links['health'] = {
      href: `${baseUrl}${healthPath}`,
      rel: 'health',
      method: 'GET',
      title: 'Health check endpoint'
    }
  }

  // Add OpenAPI specification links
  if (openapi?.json) {
    links['describedby'] = {
      href: `${baseUrl}${openapi.json}`,
      rel: 'describedby',
      method: 'GET',
      title: 'OpenAPI specification (JSON)'
    }
  }

  if (openapi?.yaml) {
    links['describedby-yaml'] = {
      href: `${baseUrl}${openapi.yaml}`,
      rel: 'describedby',
      method: 'GET',
      title: 'OpenAPI specification (YAML)'
    }
  }

  // Add documentation link
  if (docsPath) {
    links['help'] = {
      href: `${baseUrl}${docsPath}`,
      rel: 'help',
      method: 'GET',
      title: 'API documentation'
    }
  }

  // Add resource collection links
  for (const [name, resource] of Object.entries(resources)) {
    links[name] = {
      href: `${baseUrl}${resource.path}`,
      rel: 'collection',
      method: 'GET',
      title: resource.title || `${name} collection`
    }
  }

  return links
}

/**
 * Generate a complete API root response with HATEOAS links.
 * This is the entry point for a fully discoverable API.
 */
export function generateAPIRoot(config: APIRootConfig): {
  name: string
  version: string
  description: string
  _links: Record<string, Link>
} {
  return {
    name: config.name || 'API',
    version: config.version || '1.0.0',
    description: config.description || 'Self-describing HATEOAS API',
    _links: generateAPIRootLinks(config)
  }
}

/**
 * Generate error response with HATEOAS links for discoverability.
 * Even error responses should help users find the right resources.
 */
export function generateErrorLinks(
  baseUrl: string,
  options?: {
    docsPath?: string
    healthPath?: string
  }
): Record<string, Link> {
  const links: Record<string, Link> = {
    root: {
      href: `${baseUrl}/`,
      rel: 'up',
      method: 'GET',
      title: 'API Root'
    }
  }

  if (options?.docsPath) {
    links['help'] = {
      href: `${baseUrl}${options.docsPath}`,
      rel: 'help',
      method: 'GET',
      title: 'API documentation'
    }
  }

  if (options?.healthPath) {
    links['health'] = {
      href: `${baseUrl}${options.healthPath}`,
      rel: 'health',
      method: 'GET',
      title: 'Health check endpoint'
    }
  }

  return links
}
