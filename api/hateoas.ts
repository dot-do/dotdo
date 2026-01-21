// HATEOAS link generation - self-describing APIs

export interface Link {
  href: string
  rel: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  title?: string
  type?: string
  name?: string
}

// ============================================================================
// URL Validation and Encoding
// ============================================================================

/**
 * Validation errors for HATEOAS links
 */
export class LinkValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: unknown
  ) {
    super(message)
    this.name = 'LinkValidationError'
  }
}

/**
 * Check if a string is a valid URL format.
 * Returns true for absolute URLs (http://, https://) and relative URLs starting with /.
 */
export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false
  }

  // Allow relative URLs starting with /
  if (url.startsWith('/')) {
    // Check for dangerous characters that could indicate XSS
    if (containsDangerousChars(url)) {
      return false
    }
    return true
  }

  // For absolute URLs, validate the full URL
  try {
    const parsed = new URL(url)
    // Only allow http and https protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false
    }
    // Check for dangerous characters in the URL
    if (containsDangerousChars(url)) {
      return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * Check if a string contains characters that could be used for XSS attacks.
 */
function containsDangerousChars(str: string): boolean {
  // Check for javascript: protocol (case insensitive, with potential whitespace/encoding)
  if (/javascript\s*:/i.test(str)) {
    return true
  }
  // Check for data: protocol
  if (/data\s*:/i.test(str)) {
    return true
  }
  // Check for vbscript: protocol
  if (/vbscript\s*:/i.test(str)) {
    return true
  }
  // Check for on* event handlers in URL
  if (/\bon\w+\s*=/i.test(str)) {
    return true
  }
  // Check for script tags
  if (/<script/i.test(str)) {
    return true
  }
  return false
}

/**
 * Encode a URL path segment to prevent XSS and ensure valid URL.
 * This encodes special characters that could be used for attacks.
 */
export function encodePathSegment(segment: string): string {
  if (!segment || typeof segment !== 'string') {
    return ''
  }
  // Use encodeURIComponent but allow certain safe characters
  return encodeURIComponent(segment)
    .replace(/%2F/g, '/') // Allow forward slashes in paths
    .replace(/%40/g, '@') // Allow @ in paths
    .replace(/%3A/g, ':') // Allow : in paths (but not at start which would be protocol)
}

/**
 * Safely build a URL from base and path segments.
 * Ensures proper encoding of path segments to prevent XSS.
 */
export function buildSafeUrl(baseUrl: string, ...pathSegments: string[]): string {
  // Validate base URL
  if (!isValidUrl(baseUrl)) {
    throw new LinkValidationError('Invalid base URL', 'baseUrl', baseUrl)
  }

  // Remove trailing slash from base
  const base = baseUrl.replace(/\/+$/, '')

  // Encode and join path segments
  const encodedSegments = pathSegments
    .filter(segment => segment != null && segment !== '')
    .map(segment => encodePathSegment(String(segment)))

  if (encodedSegments.length === 0) {
    return base
  }

  return `${base}/${encodedSegments.join('/')}`
}

// ============================================================================
// Link Validation
// ============================================================================

/**
 * Required link types for different response types
 */
export const REQUIRED_RESOURCE_LINKS = ['self'] as const
export const REQUIRED_COLLECTION_LINKS = ['self', 'create'] as const
export const REQUIRED_ERROR_LINKS = ['root'] as const

/**
 * Validate that a link object has all required properties.
 */
export function validateLink(link: unknown, name: string): asserts link is Link {
  if (!link || typeof link !== 'object') {
    throw new LinkValidationError(`Link "${name}" must be an object`, name, link)
  }

  const linkObj = link as Record<string, unknown>

  // href is required
  const href = linkObj['href']
  if (!href || typeof href !== 'string') {
    throw new LinkValidationError(`Link "${name}" must have a valid href string`, 'href', href)
  }

  // Validate URL format
  if (!isValidUrl(href)) {
    throw new LinkValidationError(`Link "${name}" has invalid URL format`, 'href', href)
  }

  // rel is required
  const rel = linkObj['rel']
  if (!rel || typeof rel !== 'string') {
    throw new LinkValidationError(`Link "${name}" must have a valid rel string`, 'rel', rel)
  }

  // method is optional but must be valid if present
  const method = linkObj['method']
  if (method !== undefined) {
    const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
    if (!validMethods.includes(method as string)) {
      throw new LinkValidationError(`Link "${name}" has invalid method`, 'method', method)
    }
  }
}

/**
 * Validate that all required link types are present in a links object.
 */
export function validateRequiredLinks(
  links: Record<string, Link>,
  requiredTypes: readonly string[]
): void {
  for (const linkType of requiredTypes) {
    if (!links[linkType]) {
      throw new LinkValidationError(`Missing required link type: ${linkType}`, linkType, undefined)
    }
    validateLink(links[linkType], linkType)
  }
}

/**
 * Validate all links in a links object.
 * Returns an array of validation errors (empty if all valid).
 */
export function validateAllLinks(links: Record<string, Link>): LinkValidationError[] {
  const errors: LinkValidationError[] = []

  for (const [name, link] of Object.entries(links)) {
    try {
      validateLink(link, name)
    } catch (error) {
      if (error instanceof LinkValidationError) {
        errors.push(error)
      } else {
        errors.push(new LinkValidationError(`Unknown error validating link "${name}"`, name, link))
      }
    }
  }

  return errors
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
  // Encode resource and id to prevent XSS
  const safeResource = encodePathSegment(resource)
  const safeId = encodePathSegment(id)
  const base = buildSafeUrl(baseUrl, safeResource)
  const resourceUrl = buildSafeUrl(baseUrl, safeResource, safeId)

  const links: Record<string, Link> = {
    self: {
      href: resourceUrl,
      rel: 'self',
      method: 'GET',
      title: `Get ${resource}`
    },
    update: {
      href: resourceUrl,
      rel: 'edit', // RFC 8288 standard relation
      method: 'PUT',
      title: `Update ${resource}`
    },
    delete: {
      href: resourceUrl,
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

  // Add relation links with proper RFC 8288 relations
  if (config?.relations) {
    for (const [name, rel] of Object.entries(config.relations)) {
      const safeName = encodePathSegment(name)
      // Use 'related' for hasMany, 'item' for hasOne per RFC 8288
      const relType = rel.type === 'hasMany' ? 'related' : 'item'
      links[name] = {
        href: buildSafeUrl(baseUrl, safeResource, safeId, safeName),
        rel: relType,
        method: 'GET',
        title: `Get ${name} for ${resource}`
      }
    }
  }

  // Add custom action links
  if (config?.actions) {
    for (const action of config.actions) {
      const safeAction = encodePathSegment(action)
      links[action] = {
        href: buildSafeUrl(baseUrl, safeResource, safeId, safeAction),
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
  // Encode resource to prevent XSS
  const safeResource = encodePathSegment(resource)
  const base = buildSafeUrl(baseUrl, safeResource)
  const { page = 1, limit = 20, total } = options || {}

  // Validate pagination parameters (prevent negative/invalid values)
  const safePage = Math.max(1, Math.floor(Number(page) || 1))
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 20)))

  const links: Record<string, Link> = {
    self: {
      href: `${base}?page=${safePage}&limit=${safeLimit}`,
      rel: 'self',
      method: 'GET'
    },
    create: {
      href: base,
      rel: 'create-form', // RFC 8288 standard relation
      method: 'POST',
      title: `Create ${resource}`
    }
  }

  // Pagination links
  if (safePage > 1) {
    links['prev'] = {
      href: `${base}?page=${safePage - 1}&limit=${safeLimit}`,
      rel: 'prev',
      method: 'GET'
    }
    links['first'] = {
      href: `${base}?page=1&limit=${safeLimit}`,
      rel: 'first',
      method: 'GET'
    }
  }

  if (total && safePage * safeLimit < total) {
    const lastPage = Math.ceil(total / safeLimit)
    links['next'] = {
      href: `${base}?page=${safePage + 1}&limit=${safeLimit}`,
      rel: 'next',
      method: 'GET'
    }
    links['last'] = {
      href: `${base}?page=${lastPage}&limit=${safeLimit}`,
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

  // Validate base URL
  if (!isValidUrl(baseUrl)) {
    throw new LinkValidationError('Invalid base URL for API root', 'baseUrl', baseUrl)
  }

  // Normalize base URL (remove trailing slash)
  const normalizedBase = baseUrl.replace(/\/+$/, '')

  const links: Record<string, Link> = {
    self: {
      href: `${normalizedBase}/`,
      rel: 'self',
      method: 'GET',
      title: 'API Root'
    }
  }

  // Add health check link
  if (healthPath) {
    const safePath = encodePathSegment(healthPath.replace(/^\//, ''))
    links['health'] = {
      href: `${normalizedBase}/${safePath}`,
      rel: 'health',
      method: 'GET',
      title: 'Health check endpoint'
    }
  }

  // Add OpenAPI specification links
  if (openapi?.json) {
    const safePath = encodePathSegment(openapi.json.replace(/^\//, ''))
    links['describedby'] = {
      href: `${normalizedBase}/${safePath}`,
      rel: 'describedby',
      method: 'GET',
      title: 'OpenAPI specification (JSON)'
    }
  }

  if (openapi?.yaml) {
    const safePath = encodePathSegment(openapi.yaml.replace(/^\//, ''))
    links['describedby-yaml'] = {
      href: `${normalizedBase}/${safePath}`,
      rel: 'describedby',
      method: 'GET',
      title: 'OpenAPI specification (YAML)'
    }
  }

  // Add documentation link
  if (docsPath) {
    const safePath = encodePathSegment(docsPath.replace(/^\//, ''))
    links['help'] = {
      href: `${normalizedBase}/${safePath}`,
      rel: 'help',
      method: 'GET',
      title: 'API documentation'
    }
  }

  // Add resource collection links
  for (const [name, resource] of Object.entries(resources)) {
    const safePath = encodePathSegment(resource.path.replace(/^\//, ''))
    links[name] = {
      href: `${normalizedBase}/${safePath}`,
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
  // Validate base URL
  if (!isValidUrl(baseUrl)) {
    // Return minimal links with just the provided base if validation fails
    return {
      root: {
        href: '/',
        rel: 'up',
        method: 'GET',
        title: 'API Root'
      }
    }
  }

  // Normalize base URL (remove trailing slash)
  const normalizedBase = baseUrl.replace(/\/+$/, '')

  const links: Record<string, Link> = {
    root: {
      href: `${normalizedBase}/`,
      rel: 'up',
      method: 'GET',
      title: 'API Root'
    }
  }

  if (options?.docsPath) {
    const safePath = encodePathSegment(options.docsPath.replace(/^\//, ''))
    links['help'] = {
      href: `${normalizedBase}/${safePath}`,
      rel: 'help',
      method: 'GET',
      title: 'API documentation'
    }
  }

  if (options?.healthPath) {
    const safePath = encodePathSegment(options.healthPath.replace(/^\//, ''))
    links['health'] = {
      href: `${normalizedBase}/${safePath}`,
      rel: 'related',
      method: 'GET',
      title: 'Health check endpoint'
    }
  }

  return links
}

/**
 * Options for creating error responses
 */
export interface ErrorResponseOptions {
  docsPath?: string
  healthPath?: string
  requestId?: string
  details?: Record<string, unknown>
}

/**
 * Error response structure with HATEOAS links
 */
export interface ErrorResponse {
  error: string
  status: number
  requestId?: string
  details?: Record<string, unknown>
  _links?: Record<string, Link>
}

/**
 * Create a standardized error response with HATEOAS links.
 * Allows clients to navigate to useful resources even on error.
 */
export function createErrorResponse(
  message: string,
  status: number,
  baseUrl: string,
  options?: ErrorResponseOptions
): ErrorResponse {
  const response: ErrorResponse = {
    error: message,
    status
  }

  // Add optional fields
  if (options?.requestId) {
    response.requestId = options.requestId
  }

  if (options?.details) {
    response.details = options.details
  }

  // Add HATEOAS links for discoverability
  response._links = generateErrorLinks(baseUrl, {
    docsPath: options?.docsPath,
    healthPath: options?.healthPath
  })

  return response
}
