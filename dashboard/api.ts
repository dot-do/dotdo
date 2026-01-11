/**
 * DO Dashboard API Factory
 *
 * Creates a Hono-compatible request handler that serves the DO Dashboard
 * as a JSON REST API with HATEOAS links.
 *
 * Three outputs from one codebase:
 * - REST API (JSON + HATEOAS links)
 * - CLI Dashboard (terminal UI)
 * - Web Admin (browser UI)
 *
 * @example
 * ```typescript
 * import { API } from 'dotdo/dashboard'
 *
 * // Basic usage
 * export default API()
 *
 * // With configuration
 * export default API({
 *   config: './do.config.ts',
 *   ns: 'my-namespace',
 *   debug: true,
 * })
 * ```
 *
 * @module dashboard/api
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

/**
 * Configuration options for the Dashboard API
 */
export interface APIOptions {
  /**
   * Path to do.config.ts file
   * Defaults to looking in CWD for do.config.ts
   */
  config?: string

  /**
   * Namespace for the dashboard
   * Used for generating links and context
   */
  ns?: string

  /**
   * Enable debug mode
   * Adds additional logging and debug endpoints
   */
  debug?: boolean
}

/**
 * HATEOAS Link object
 */
export interface Link {
  href: string
  rel?: string
  type?: string
  title?: string
  templated?: boolean
}

/**
 * Links collection for HATEOAS responses
 */
export interface Links {
  self: Link
  schema?: Link
  data?: Link
  collection?: Link
  openapi?: Link
  items?: Link[]
  next?: Link
  prev?: Link
  first?: Link
  last?: Link
  [key: string]: Link | Link[] | undefined
}

/**
 * Base HATEOAS response format
 */
export interface HATEOASResponse {
  _links: Links
  [key: string]: unknown
}

/**
 * Root resource response
 */
export interface RootResource extends HATEOASResponse {
  name: string
  version: string
  description?: string
}

/**
 * Schema type definition
 */
export interface SchemaType {
  name: string
  type: 'thing' | 'collection'
  properties: Record<string, PropertySchema>
  actions?: string[]
}

/**
 * Property schema
 */
export interface PropertySchema {
  type: string
  required?: boolean
  description?: string
  format?: string
}

/**
 * Schema collection response
 */
export interface SchemaResponse extends HATEOASResponse {
  types: SchemaType[]
}

/**
 * Single type schema response
 */
export interface TypeSchemaResponse extends HATEOASResponse, SchemaType {}

/**
 * Data collection response
 */
export interface DataCollectionResponse extends HATEOASResponse {
  collections: Array<{
    name: string
    count: number
    _links: Links
  }>
}

/**
 * Items collection response (paginated)
 */
export interface ItemsResponse extends HATEOASResponse {
  items: Array<Record<string, unknown> & { _links: Links }>
  total: number
  limit: number
  offset: number
}

/**
 * Single item response
 */
export interface ItemResponse extends HATEOASResponse {
  [key: string]: unknown
}

/**
 * OpenAPI 3.0 Specification
 */
export interface OpenAPISpec {
  openapi: '3.0.0'
  info: {
    title: string
    version: string
    description?: string
  }
  servers?: Array<{ url: string; description?: string }>
  paths: Record<string, unknown>
  components?: {
    schemas?: Record<string, unknown>
    securitySchemes?: Record<string, unknown>
  }
  security?: Array<Record<string, string[]>>
}

// ============================================================================
// Mock Schema Data (simulates $introspect)
// ============================================================================

const mockSchemaTypes: SchemaType[] = [
  {
    name: 'Customer',
    type: 'thing',
    properties: {
      id: { type: 'string', required: true, description: 'Unique identifier' },
      name: { type: 'string', required: true, description: 'Customer name' },
      email: { type: 'string', required: false, description: 'Email address', format: 'email' },
      status: { type: 'string', required: false, description: 'Account status' },
      createdAt: { type: 'string', required: false, description: 'Creation timestamp', format: 'date-time' },
    },
    actions: ['notify', 'deactivate'],
  },
  {
    name: 'Order',
    type: 'thing',
    properties: {
      id: { type: 'string', required: true, description: 'Order ID' },
      customerId: { type: 'string', required: true, description: 'Customer reference' },
      total: { type: 'number', required: true, description: 'Order total' },
      status: { type: 'string', required: false, description: 'Order status' },
    },
    actions: ['fulfill', 'cancel', 'refund'],
  },
]

// Mock data store (simulates DO storage)
const mockDataStore: Record<string, Map<string, Record<string, unknown>>> = {
  customers: new Map([
    ['cust-123', { id: 'cust-123', name: 'Acme Corp', email: 'contact@acme.com', status: 'active', createdAt: '2024-01-01T00:00:00Z' }],
    ['cust-456', { id: 'cust-456', name: 'Widget Inc', email: 'info@widget.com', status: 'active', createdAt: '2024-02-15T00:00:00Z' }],
  ]),
  orders: new Map([
    ['ord-001', { id: 'ord-001', customerId: 'cust-123', total: 999.99, status: 'fulfilled' }],
    ['ord-002', { id: 'ord-002', customerId: 'cust-456', total: 499.50, status: 'pending' }],
  ]),
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validate API options
 */
function validateOptions(options?: APIOptions): void {
  if (!options) return

  const validKeys = ['config', 'ns', 'debug']
  const keys = Object.keys(options)

  for (const key of keys) {
    if (!validKeys.includes(key)) {
      throw new Error(`Unknown option: ${key}`)
    }
  }

  if (options.config !== undefined && typeof options.config !== 'string') {
    throw new Error('config must be a string')
  }

  if (options.ns !== undefined && typeof options.ns !== 'string') {
    throw new Error('ns must be a string')
  }

  if (options.debug !== undefined && typeof options.debug !== 'boolean') {
    throw new Error('debug must be a boolean')
  }
}

/**
 * Pluralize a type name for collection URLs
 */
function pluralize(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('y')) {
    return lower.slice(0, -1) + 'ies'
  }
  if (lower.endsWith('s') || lower.endsWith('x') || lower.endsWith('ch') || lower.endsWith('sh')) {
    return lower + 'es'
  }
  return lower + 's'
}

/**
 * Get type name from collection name
 */
function singularize(collection: string): string {
  const lower = collection.toLowerCase()
  if (lower.endsWith('ies')) {
    return lower.slice(0, -3) + 'y'
  }
  if (lower.endsWith('es')) {
    return lower.slice(0, -2)
  }
  if (lower.endsWith('s')) {
    return lower.slice(0, -1)
  }
  return lower
}

/**
 * Find schema type by name (case-insensitive)
 */
function findSchemaType(name: string): SchemaType | undefined {
  return mockSchemaTypes.find(
    (t) => t.name.toLowerCase() === name.toLowerCase() || pluralize(t.name) === name.toLowerCase()
  )
}

/**
 * Get collection for a type
 */
function getCollection(typeName: string): Map<string, Record<string, unknown>> | undefined {
  const plural = pluralize(typeName)
  return mockDataStore[plural]
}

/**
 * Generate HATEOAS links for a collection item
 */
function generateItemLinks(collection: string, id: string): Links {
  return {
    self: { href: `/data/${collection}/${id}` },
    collection: { href: `/data/${collection}` },
  }
}

/**
 * Generate pagination links
 */
function generatePaginationLinks(
  basePath: string,
  limit: number,
  offset: number,
  total: number,
  otherParams: string = ''
): Partial<Links> {
  const links: Partial<Links> = {
    self: { href: `${basePath}?limit=${limit}&offset=${offset}${otherParams}` },
  }

  // First page link
  links.first = { href: `${basePath}?limit=${limit}&offset=0${otherParams}` }

  // Last page link
  const lastOffset = Math.max(0, Math.floor((total - 1) / limit) * limit)
  links.last = { href: `${basePath}?limit=${limit}&offset=${lastOffset}${otherParams}` }

  // Previous page link (if not on first page)
  if (offset > 0) {
    const prevOffset = Math.max(0, offset - limit)
    links.prev = { href: `${basePath}?limit=${limit}&offset=${prevOffset}${otherParams}` }
  }

  // Next page link (if not on last page)
  if (offset + limit < total) {
    const nextOffset = offset + limit
    links.next = { href: `${basePath}?limit=${limit}&offset=${nextOffset}${otherParams}` }
  }

  return links
}

/**
 * Generate OpenAPI specification from schema
 */
function generateOpenAPISpec(types: SchemaType[], ns?: string): OpenAPISpec {
  const schemas: Record<string, unknown> = {}
  const paths: Record<string, unknown> = {}

  // Generate schemas for each type
  for (const type of types) {
    const properties: Record<string, unknown> = {}
    const required: string[] = []

    for (const [propName, propSchema] of Object.entries(type.properties)) {
      properties[propName] = {
        type: propSchema.type === 'string' ? 'string' : propSchema.type === 'number' ? 'number' : 'string',
        description: propSchema.description,
        format: propSchema.format,
      }
      if (propSchema.required) {
        required.push(propName)
      }
    }

    schemas[type.name] = {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    }
  }

  // Generate standard paths
  paths['/'] = {
    get: {
      summary: 'Root resource',
      description: 'Returns the root resource with HATEOAS navigation links',
      responses: {
        '200': {
          description: 'Root resource',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RootResource' },
            },
          },
        },
      },
    },
  }

  paths['/schema'] = {
    get: {
      summary: 'List all types',
      description: 'Returns all available schema types from $introspect',
      responses: {
        '200': {
          description: 'Schema types',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SchemaResponse' },
            },
          },
        },
      },
    },
  }

  paths['/schema/{type}'] = {
    get: {
      summary: 'Get type definition',
      description: 'Returns the schema definition for a specific type',
      parameters: [
        {
          name: 'type',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: 'Type name',
        },
      ],
      responses: {
        '200': {
          description: 'Type definition',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TypeSchemaResponse' },
            },
          },
        },
        '404': {
          description: 'Type not found',
        },
      },
    },
  }

  paths['/data'] = {
    get: {
      summary: 'List all collections',
      description: 'Returns all available data collections',
      responses: {
        '200': {
          description: 'Data collections',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/DataCollectionResponse' },
            },
          },
        },
      },
    },
  }

  paths['/data/{type}'] = {
    get: {
      summary: 'List items in collection',
      description: 'Returns paginated items from a collection',
      parameters: [
        {
          name: 'type',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', default: 20 },
        },
        {
          name: 'offset',
          in: 'query',
          schema: { type: 'integer', default: 0 },
        },
      ],
      responses: {
        '200': {
          description: 'Items list',
        },
        '404': {
          description: 'Collection not found',
        },
      },
    },
    post: {
      summary: 'Create new item',
      description: 'Creates a new item in the collection',
      parameters: [
        {
          name: 'type',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { type: 'object' },
          },
        },
      },
      responses: {
        '201': {
          description: 'Item created',
        },
        '400': {
          description: 'Invalid request',
        },
      },
    },
  }

  paths['/data/{type}/{id}'] = {
    get: {
      summary: 'Get item by ID',
      description: 'Returns a single item by its ID',
      parameters: [
        { name: 'type', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'Item found' },
        '404': { description: 'Item not found' },
      },
    },
    put: {
      summary: 'Update item',
      description: 'Updates an existing item',
      parameters: [
        { name: 'type', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { type: 'object' },
          },
        },
      },
      responses: {
        '200': { description: 'Item updated' },
        '404': { description: 'Item not found' },
      },
    },
    delete: {
      summary: 'Delete item',
      description: 'Deletes an item by its ID',
      parameters: [
        { name: 'type', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '204': { description: 'Item deleted' },
        '404': { description: 'Item not found' },
      },
    },
  }

  paths['/openapi.json'] = {
    get: {
      summary: 'OpenAPI specification',
      description: 'Returns the OpenAPI 3.0 specification for this API',
      responses: {
        '200': {
          description: 'OpenAPI spec',
          content: {
            'application/json': {
              schema: { type: 'object' },
            },
          },
        },
      },
    },
  }

  // Add response schemas
  schemas['RootResource'] = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      version: { type: 'string' },
      _links: { type: 'object' },
    },
  }

  schemas['SchemaResponse'] = {
    type: 'object',
    properties: {
      types: { type: 'array' },
      _links: { type: 'object' },
    },
  }

  schemas['TypeSchemaResponse'] = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      type: { type: 'string' },
      properties: { type: 'object' },
      _links: { type: 'object' },
    },
  }

  schemas['DataCollectionResponse'] = {
    type: 'object',
    properties: {
      collections: { type: 'array' },
      _links: { type: 'object' },
    },
  }

  return {
    openapi: '3.0.0',
    info: {
      title: ns ? `${ns} Dashboard API` : 'DO Dashboard API',
      version: '1.0.0',
      description: 'Auto-generated API for Durable Objects dashboard',
    },
    servers: [
      { url: '/', description: 'Current server' },
    ],
    paths,
    components: {
      schemas,
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  }
}

/**
 * Create error response with HATEOAS links
 */
function createErrorResponse(
  error: string,
  status: number,
  path: string
): { body: HATEOASResponse; status: number } {
  return {
    body: {
      error,
      status,
      _links: {
        self: { href: path },
      },
    },
    status,
  }
}

/**
 * Parse and validate query parameters
 */
function parseQueryParams(url: URL): {
  limit: number
  offset: number
  filter: Record<string, string>
  sort?: string
  sortDesc: boolean
  fields?: string[]
  q?: string
  error?: string
} {
  const limitParam = url.searchParams.get('limit')
  const offsetParam = url.searchParams.get('offset')
  const sortParam = url.searchParams.get('sort')
  const fieldsParam = url.searchParams.get('fields')
  const qParam = url.searchParams.get('q')

  // Parse limit
  let limit = 20
  if (limitParam !== null) {
    limit = parseInt(limitParam, 10)
    if (isNaN(limit) || limit < 0) {
      return { limit: 20, offset: 0, filter: {}, sortDesc: false, error: 'Invalid limit parameter' }
    }
  }

  // Parse offset
  let offset = 0
  if (offsetParam !== null) {
    offset = parseInt(offsetParam, 10)
    if (isNaN(offset) || offset < 0) {
      return { limit: 20, offset: 0, filter: {}, sortDesc: false, error: 'Invalid offset parameter' }
    }
  }

  // Parse filters (filter[field]=value)
  const filter: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) {
    const match = key.match(/^filter\[(\w+)\]$/)
    if (match) {
      filter[match[1]] = value
    }
  }

  // Parse sort
  let sort: string | undefined
  let sortDesc = false
  if (sortParam) {
    if (sortParam.startsWith('-')) {
      sort = sortParam.slice(1)
      sortDesc = true
    } else {
      sort = sortParam
    }
  }

  // Parse fields
  const fields = fieldsParam ? fieldsParam.split(',').map((f) => f.trim()) : undefined

  return { limit, offset, filter, sort, sortDesc, fields, q: qParam || undefined }
}

/**
 * Apply filters to items
 */
function applyFilters(
  items: Array<Record<string, unknown>>,
  filter: Record<string, string>,
  q?: string
): Array<Record<string, unknown>> {
  let result = items

  // Apply field filters
  for (const [field, value] of Object.entries(filter)) {
    result = result.filter((item) => {
      const itemValue = item[field]
      if (itemValue === undefined) return false
      return String(itemValue).toLowerCase().includes(value.toLowerCase())
    })
  }

  // Apply full-text search
  if (q) {
    const searchTerm = q.toLowerCase()
    result = result.filter((item) => {
      return Object.values(item).some((value) => {
        if (value === null || value === undefined) return false
        return String(value).toLowerCase().includes(searchTerm)
      })
    })
  }

  return result
}

/**
 * Apply sorting to items
 */
function applySorting(
  items: Array<Record<string, unknown>>,
  sort?: string,
  desc: boolean = false
): Array<Record<string, unknown>> {
  if (!sort) return items

  return [...items].sort((a, b) => {
    const aVal = a[sort]
    const bVal = b[sort]

    if (aVal === undefined && bVal === undefined) return 0
    if (aVal === undefined) return desc ? -1 : 1
    if (bVal === undefined) return desc ? 1 : -1

    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return desc ? bVal - aVal : aVal - bVal
    }

    const aStr = String(aVal)
    const bStr = String(bVal)
    return desc ? bStr.localeCompare(aStr) : aStr.localeCompare(bStr)
  })
}

/**
 * Apply field selection to items
 */
function applyFieldSelection(
  items: Array<Record<string, unknown>>,
  fields?: string[]
): Array<Record<string, unknown>> {
  if (!fields) return items

  return items.map((item) => {
    const result: Record<string, unknown> = {}
    for (const field of fields) {
      if (item[field] !== undefined) {
        result[field] = item[field]
      }
    }
    // Always include _links if present
    if (item._links) {
      result._links = item._links
    }
    return result
  })
}

// ============================================================================
// API Factory
// ============================================================================

/**
 * Create a DO Dashboard API handler
 *
 * @param options - Configuration options
 * @returns Hono application instance
 */
export function API(options?: APIOptions): Hono {
  // Validate options
  validateOptions(options)

  const ns = options?.ns
  const debug = options?.debug ?? false
  const configPath = options?.config

  // Check for explicit config file that doesn't exist
  const hasExplicitMissingConfig = configPath && configPath !== './do.config.ts'

  // Create Hono app
  const app = new Hono()

  // CORS middleware
  app.use('*', cors())

  // Debug timing middleware
  if (debug) {
    app.use('*', async (c, next) => {
      const start = Date.now()
      await next()
      const duration = Date.now() - start
      c.header('Server-Timing', `total;dur=${duration}`)
    })
  }

  // Check for missing config and return error for all routes
  if (hasExplicitMissingConfig) {
    app.all('*', (c) => {
      return c.json(
        {
          error: `config file not found: ${configPath}`,
          _links: {
            self: { href: new URL(c.req.url).pathname },
          },
        },
        500
      )
    })
    return app
  }

  // ============================================================================
  // Debug Endpoint
  // ============================================================================

  if (debug) {
    app.get('/_debug', (c) => {
      return c.json({
        _links: {
          self: { href: '/_debug' },
        },
        debug: true,
        namespace: ns,
        config: configPath,
        types: mockSchemaTypes.map((t) => t.name),
        collections: Object.keys(mockDataStore),
      })
    })
  }

  // ============================================================================
  // Root Resource
  // ============================================================================

  app.get('/', (c) => {
    const response: RootResource = {
      name: ns ? `${ns} Dashboard` : 'DO Dashboard',
      version: '1.0.0',
      description: 'Durable Objects Dashboard API',
      _links: {
        self: { href: '/' },
        schema: { href: '/schema' },
        data: { href: '/data' },
        openapi: { href: '/openapi.json' },
      },
    }

    if (ns) {
      (response as Record<string, unknown>).ns = ns
    }

    return c.json(response)
  })

  // ============================================================================
  // Schema Routes
  // ============================================================================

  app.get('/schema', (c) => {
    const response: SchemaResponse = {
      types: mockSchemaTypes,
      _links: {
        self: { href: '/schema' },
      },
    }

    return c.json(response)
  })

  app.get('/schema/:type', (c) => {
    const typeName = c.req.param('type')
    const schemaType = mockSchemaTypes.find(
      (t) => t.name.toLowerCase() === typeName.toLowerCase()
    )

    if (!schemaType) {
      const { body, status } = createErrorResponse(
        `Type not found: ${typeName}`,
        404,
        `/schema/${typeName}`
      )
      return c.json(body, status)
    }

    const response: TypeSchemaResponse = {
      ...schemaType,
      _links: {
        self: { href: `/schema/${typeName}` },
        collection: { href: '/schema' },
      },
    }

    return c.json(response)
  })

  // ============================================================================
  // Data Routes
  // ============================================================================

  app.get('/data', (c) => {
    const collections = mockSchemaTypes.map((type) => {
      const collectionName = pluralize(type.name)
      const store = mockDataStore[collectionName]
      return {
        name: collectionName,
        count: store ? store.size : 0,
        _links: {
          self: { href: `/data/${collectionName}` },
        } as Links,
      }
    })

    const response: DataCollectionResponse = {
      collections,
      _links: {
        self: { href: '/data' },
      },
    }

    return c.json(response)
  })

  // List items in collection
  app.get('/data/:type', (c) => {
    const typeName = c.req.param('type')
    const url = new URL(c.req.url)

    // Parse query params
    const params = parseQueryParams(url)
    if (params.error) {
      const { body, status } = createErrorResponse(params.error, 400, `/data/${typeName}`)
      return c.json(body, status)
    }

    // Find collection
    const store = mockDataStore[typeName.toLowerCase()]
    if (!store) {
      const { body, status } = createErrorResponse(
        `Collection not found: ${typeName}`,
        404,
        `/data/${typeName}`
      )
      return c.json(body, status)
    }

    // Get all items with _links
    let items = Array.from(store.entries()).map(([id, item]) => ({
      ...item,
      _links: generateItemLinks(typeName, id),
    }))

    // Apply filters
    items = applyFilters(items, params.filter, params.q) as typeof items

    // Apply sorting
    items = applySorting(items, params.sort, params.sortDesc) as typeof items

    const total = items.length

    // Apply pagination
    const paginatedItems = items.slice(params.offset, params.offset + params.limit)

    // Apply field selection
    const selectedItems = applyFieldSelection(paginatedItems, params.fields)

    // Generate pagination links
    const paginationLinks = generatePaginationLinks(
      `/data/${typeName}`,
      params.limit,
      params.offset,
      total
    )

    // Generate item links for _links.items
    const itemLinks = paginatedItems.map((item) => ({
      href: `/data/${typeName}/${item.id || (item as Record<string, unknown>)._links?.self?.href?.split('/').pop()}`,
    }))

    const response: ItemsResponse = {
      items: selectedItems as ItemsResponse['items'],
      total,
      limit: params.limit,
      offset: params.offset,
      _links: {
        self: paginationLinks.self!,
        first: paginationLinks.first,
        last: paginationLinks.last,
        next: paginationLinks.next,
        prev: paginationLinks.prev,
        items: itemLinks,
      },
    }

    return c.json(response)
  })

  // Get single item
  app.get('/data/:type/:id', (c) => {
    const typeName = c.req.param('type')
    const id = c.req.param('id')

    const store = mockDataStore[typeName.toLowerCase()]
    if (!store) {
      const { body, status } = createErrorResponse(
        `Collection not found: ${typeName}`,
        404,
        `/data/${typeName}/${id}`
      )
      return c.json(body, status)
    }

    const item = store.get(id)
    if (!item) {
      const { body, status } = createErrorResponse(
        `Item not found: ${id}`,
        404,
        `/data/${typeName}/${id}`
      )
      return c.json(body, status)
    }

    const response: ItemResponse = {
      ...item,
      _links: {
        self: { href: `/data/${typeName}/${id}` },
        collection: { href: `/data/${typeName}` },
      },
    }

    return c.json(response)
  })

  // Create item
  app.post('/data/:type', async (c) => {
    const typeName = c.req.param('type')

    // Parse body
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      const { body: errorBody, status } = createErrorResponse(
        'Invalid JSON body',
        400,
        `/data/${typeName}`
      )
      return c.json(errorBody, status)
    }

    const store = mockDataStore[typeName.toLowerCase()]
    if (!store) {
      const { body: errorBody, status } = createErrorResponse(
        `Collection not found: ${typeName}`,
        404,
        `/data/${typeName}`
      )
      return c.json(errorBody, status)
    }

    // Generate ID
    const id = `${singularize(typeName)}-${Date.now()}`
    const item = { ...body, id }
    store.set(id, item)

    const response: ItemResponse = {
      ...item,
      _links: {
        self: { href: `/data/${typeName}/${id}` },
        collection: { href: `/data/${typeName}` },
      },
    }

    return c.json(response, 201)
  })

  // Update item
  app.put('/data/:type/:id', async (c) => {
    const typeName = c.req.param('type')
    const id = c.req.param('id')

    // Parse body
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      const { body: errorBody, status } = createErrorResponse(
        'Invalid JSON body',
        400,
        `/data/${typeName}/${id}`
      )
      return c.json(errorBody, status)
    }

    const store = mockDataStore[typeName.toLowerCase()]
    if (!store) {
      const { body: errorBody, status } = createErrorResponse(
        `Collection not found: ${typeName}`,
        404,
        `/data/${typeName}/${id}`
      )
      return c.json(errorBody, status)
    }

    const existing = store.get(id)
    if (!existing) {
      const { body: errorBody, status } = createErrorResponse(
        `Item not found: ${id}`,
        404,
        `/data/${typeName}/${id}`
      )
      return c.json(errorBody, status)
    }

    // Update item
    const updated = { ...existing, ...body, id }
    store.set(id, updated)

    const response: ItemResponse = {
      ...updated,
      _links: {
        self: { href: `/data/${typeName}/${id}` },
        collection: { href: `/data/${typeName}` },
      },
    }

    return c.json(response)
  })

  // Delete item
  app.delete('/data/:type/:id', (c) => {
    const typeName = c.req.param('type')
    const id = c.req.param('id')

    const store = mockDataStore[typeName.toLowerCase()]
    if (!store) {
      const { body, status } = createErrorResponse(
        `Collection not found: ${typeName}`,
        404,
        `/data/${typeName}/${id}`
      )
      return c.json(body, status)
    }

    if (!store.has(id)) {
      const { body, status } = createErrorResponse(
        `Item not found: ${id}`,
        404,
        `/data/${typeName}/${id}`
      )
      return c.json(body, status)
    }

    store.delete(id)
    return new Response(null, { status: 204 })
  })

  // Method not allowed for collection DELETE
  app.delete('/data/:type', (c) => {
    return c.json(
      {
        error: 'Method not allowed',
        _links: {
          self: { href: `/data/${c.req.param('type')}` },
        },
      },
      405,
      {
        Allow: 'GET, POST',
      }
    )
  })

  // Method not allowed for item POST
  app.post('/data/:type/:id', (c) => {
    return c.json(
      {
        error: 'Method not allowed',
        _links: {
          self: { href: `/data/${c.req.param('type')}/${c.req.param('id')}` },
        },
      },
      405,
      {
        Allow: 'GET, PUT, DELETE',
      }
    )
  })

  // ============================================================================
  // OpenAPI Spec
  // ============================================================================

  app.get('/openapi.json', (c) => {
    const spec = generateOpenAPISpec(mockSchemaTypes, ns)
    return c.json(spec)
  })

  // ============================================================================
  // OPTIONS Handler for CORS preflight
  // ============================================================================

  app.options('*', (c) => {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  })

  // ============================================================================
  // 404 Handler
  // ============================================================================

  app.all('*', (c) => {
    const path = new URL(c.req.url).pathname
    const { body, status } = createErrorResponse(`Not found: ${path}`, 404, path)
    return c.json(body, status)
  })

  return app
}

// Default export for convenience
export default API
