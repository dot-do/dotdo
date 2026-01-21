// HATEOAS link generation - self-describing APIs
// See RFC 8288 (Web Linking) and RFC 5988 for standard link relations

/**
 * Standard link relation types as per IANA registry
 * https://www.iana.org/assignments/link-relations/link-relations.xhtml
 */
export type LinkRelation =
  | 'self'           // The target URI identifies the resource
  | 'collection'     // The target URI identifies a collection
  | 'item'           // The target URI identifies an item in a collection
  | 'create'         // Link to create a new resource (non-standard but common)
  | 'update'         // Link to update a resource (non-standard but common)
  | 'delete'         // Link to delete a resource (non-standard but common)
  | 'describedby'    // The target URI identifies a description document
  | 'describes'      // The resource describes the target
  | 'first'          // First item in a collection
  | 'last'           // Last item in a collection
  | 'next'           // Next item in a collection
  | 'prev'           // Previous item in a collection
  | 'up'             // Parent resource
  | 'related'        // Related resource
  | 'canonical'      // Canonical URI for the resource
  | 'edit'           // Editable version of the resource
  | 'edit-form'      // Form for editing the resource
  | 'create-form'    // Form for creating a new resource
  | 'search'         // Search interface
  | 'help'           // Help documentation
  | 'about'          // About information
  | 'author'         // Author of the resource
  | 'license'        // License information
  | 'alternate'      // Alternative representation
  | string           // Custom relation types

export interface Link {
  href: string
  rel: LinkRelation
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  title?: string
  /** Media type hint for the target resource */
  type?: string
  /** Human-readable name for the link (HAL extension) */
  name?: string
  /** Whether the link is templated (RFC 6570 URI Template) */
  templated?: boolean
  /** Language of the target resource */
  hreflang?: string
  /** Deprecation information */
  deprecation?: string
}

export interface HATEOASResponse<T> {
  data: T
  _links: Record<string, Link>
}

export interface ResourceConfig {
  basePath: string
  actions?: string[]
  relations?: Record<string, { resource: string; type: 'hasOne' | 'hasMany' }>
  /** Include PATCH in addition to PUT for updates */
  supportsPatch?: boolean
  /** Include link to OpenAPI schema */
  schemaPath?: string
  /** Content type for the resource */
  mediaType?: string
}

// Generate links for a single resource
export function generateLinks(
  resource: string,
  id: string,
  baseUrl: string,
  config?: Partial<ResourceConfig>
): Record<string, Link> {
  const base = `${baseUrl}/${resource}`
  const mediaType = config?.mediaType || 'application/json'

  const links: Record<string, Link> = {
    self: {
      href: `${base}/${id}`,
      rel: 'self',
      method: 'GET',
      title: `Get ${resource}`,
      type: mediaType
    },
    update: {
      href: `${base}/${id}`,
      rel: 'edit',
      method: 'PUT',
      title: `Replace ${resource}`,
      type: mediaType
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
      title: `List all ${resource}`,
      type: mediaType
    }
  }

  // Add PATCH support if enabled (partial updates)
  if (config?.supportsPatch !== false) {
    links['patch'] = {
      href: `${base}/${id}`,
      rel: 'edit',
      method: 'PATCH',
      title: `Update ${resource}`,
      type: mediaType
    }
  }

  // Add schema/describedby link if schema path is provided
  if (config?.schemaPath) {
    links['describedby'] = {
      href: config.schemaPath,
      rel: 'describedby',
      method: 'GET',
      title: `Schema for ${resource}`,
      type: 'application/json'
    }
  }

  // Add relation links
  if (config?.relations) {
    for (const [name, rel] of Object.entries(config.relations)) {
      links[name] = {
        href: `${base}/${id}/${name}`,
        rel: rel.type === 'hasMany' ? 'related' : 'item',
        method: 'GET',
        title: `Get ${name} for ${resource}`,
        type: mediaType,
        name
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
        title: `${action} ${resource}`,
        type: mediaType,
        name: action
      }
    }
  }

  return links
}

export interface CollectionLinksOptions {
  page?: number
  limit?: number
  total?: number
  /** Content type for the collection items */
  mediaType?: string
  /** Path to the OpenAPI schema for this collection */
  schemaPath?: string
  /** Search endpoint if available */
  searchPath?: string
}

// Generate links for a collection
export function generateCollectionLinks(
  resource: string,
  baseUrl: string,
  options?: CollectionLinksOptions
): Record<string, Link> {
  const base = `${baseUrl}/${resource}`
  const { page = 1, limit = 20, total, mediaType = 'application/json' } = options || {}

  const links: Record<string, Link> = {
    self: {
      href: `${base}?page=${page}&limit=${limit}`,
      rel: 'self',
      method: 'GET',
      type: mediaType
    },
    create: {
      href: base,
      rel: 'create-form',
      method: 'POST',
      title: `Create ${resource}`,
      type: mediaType
    }
  }

  // Add item link template for HAL-style link templates
  links['item'] = {
    href: `${base}/{id}`,
    rel: 'item',
    method: 'GET',
    title: `Get ${resource} by ID`,
    templated: true,
    type: mediaType
  }

  // Add schema/describedby link if provided
  if (options?.schemaPath) {
    links['describedby'] = {
      href: options.schemaPath,
      rel: 'describedby',
      method: 'GET',
      title: `Schema for ${resource}`,
      type: 'application/json'
    }
  }

  // Add search link if provided
  if (options?.searchPath) {
    links['search'] = {
      href: options.searchPath,
      rel: 'search',
      method: 'GET',
      title: `Search ${resource}`,
      templated: true,
      type: mediaType
    }
  }

  // Pagination links
  if (page > 1) {
    links['prev'] = {
      href: `${base}?page=${page - 1}&limit=${limit}`,
      rel: 'prev',
      method: 'GET',
      type: mediaType
    }
    links['first'] = {
      href: `${base}?page=1&limit=${limit}`,
      rel: 'first',
      method: 'GET',
      type: mediaType
    }
  }

  if (total && page * limit < total) {
    links['next'] = {
      href: `${base}?page=${page + 1}&limit=${limit}`,
      rel: 'next',
      method: 'GET',
      type: mediaType
    }
    links['last'] = {
      href: `${base}?page=${Math.ceil(total / limit)}&limit=${limit}`,
      rel: 'last',
      method: 'GET',
      type: mediaType
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
  options?: CollectionLinksOptions
): HATEOASResponse<Array<T & { _links: Record<string, Link> }>> {
  // Build resource config conditionally to satisfy exactOptionalPropertyTypes
  const resourceConfig: Partial<ResourceConfig> = {}
  if (options?.mediaType !== undefined) {
    resourceConfig.mediaType = options.mediaType
  }
  if (options?.schemaPath !== undefined) {
    resourceConfig.schemaPath = options.schemaPath
  }
  const itemsWithLinks = items.map(item => ({
    ...item,
    _links: generateLinks(resource, getId(item), baseUrl, resourceConfig)
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
 *
 * @example
 * ```typescript
 * const rootLinks = generateAPIRootLinks({
 *   baseUrl: 'https://api.example.com',
 *   resources: {
 *     customers: { path: '/customers', title: 'Customers' },
 *     orders: { path: '/orders', title: 'Orders' }
 *   },
 *   openapi: { json: '/openapi.json', yaml: '/openapi.yaml' },
 *   docsPath: '/docs',
 *   healthPath: '/health'
 * })
 * ```
 */
export function generateAPIRootLinks(config: APIRootConfig): Record<string, Link> {
  const { baseUrl, resources = {}, openapi, docsPath, healthPath } = config

  const links: Record<string, Link> = {
    self: {
      href: `${baseUrl}/`,
      rel: 'self',
      method: 'GET',
      title: 'API Root',
      type: 'application/json'
    }
  }

  // Add health check link
  if (healthPath) {
    links['health'] = {
      href: `${baseUrl}${healthPath}`,
      rel: 'related',
      method: 'GET',
      title: 'Health check endpoint',
      type: 'application/json',
      name: 'health'
    }
  }

  // Add OpenAPI specification links
  if (openapi?.json) {
    links['describedby'] = {
      href: `${baseUrl}${openapi.json}`,
      rel: 'describedby',
      method: 'GET',
      title: 'OpenAPI specification (JSON)',
      type: 'application/json'
    }
  }

  if (openapi?.yaml) {
    links['describedby-yaml'] = {
      href: `${baseUrl}${openapi.yaml}`,
      rel: 'describedby',
      method: 'GET',
      title: 'OpenAPI specification (YAML)',
      type: 'application/x-yaml'
    }
  }

  // Add documentation link
  if (docsPath) {
    links['help'] = {
      href: `${baseUrl}${docsPath}`,
      rel: 'help',
      method: 'GET',
      title: 'API documentation',
      type: 'text/html'
    }
  }

  // Add resource collection links
  for (const [name, resource] of Object.entries(resources)) {
    links[name] = {
      href: `${baseUrl}${resource.path}`,
      rel: 'collection',
      method: 'GET',
      title: resource.title || `${name} collection`,
      type: 'application/json',
      name
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
      title: 'API Root',
      type: 'application/json'
    }
  }

  if (options?.docsPath) {
    links['help'] = {
      href: `${baseUrl}${options.docsPath}`,
      rel: 'help',
      method: 'GET',
      title: 'API documentation',
      type: 'text/html'
    }
  }

  if (options?.healthPath) {
    links['health'] = {
      href: `${baseUrl}${options.healthPath}`,
      rel: 'related',
      method: 'GET',
      title: 'Health check endpoint',
      type: 'application/json',
      name: 'health'
    }
  }

  return links
}

/**
 * Standard error response with HATEOAS links
 */
export interface ErrorResponse {
  error: string
  status: number
  requestId?: string
  details?: unknown
  _links?: Record<string, Link>
}

/**
 * Create an error response with HATEOAS links for discoverability.
 */
export function createErrorResponse(
  error: string,
  status: number,
  baseUrl: string,
  options?: {
    requestId?: string
    details?: unknown
    docsPath?: string
    healthPath?: string
  }
): ErrorResponse {
  return {
    error,
    status,
    requestId: options?.requestId,
    details: options?.details,
    _links: generateErrorLinks(baseUrl, {
      docsPath: options?.docsPath,
      healthPath: options?.healthPath
    })
  }
}
