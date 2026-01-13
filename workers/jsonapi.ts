/**
 * JSON:API Worker
 *
 * Transforms DO responses to JSON:API spec format (jsonapi.org v1.1).
 *
 * Routes:
 * - /{ns}/{collection}/     -> Collection response
 * - /{ns}/{collection}/{id} -> Single resource response
 *
 * Features:
 * - JSON:API v1.1 document structure
 * - Pagination with first/last/prev/next links
 * - Sparse fieldsets via fields[type]=field1,field2
 * - Includes (sideloading) via include=relationship1,relationship2
 * - Proper error responses
 *
 * @module workers/jsonapi
 * @see https://jsonapi.org/format/
 */

import { Hono } from 'hono'
import type { CloudflareEnv } from '../types/CloudflareBindings'

// ============================================================================
// JSON:API TYPES
// ============================================================================

/**
 * JSON:API Resource Identifier
 */
export interface JsonApiResourceIdentifier {
  type: string
  id: string
}

/**
 * JSON:API Relationship object
 */
export interface JsonApiRelationship {
  links?: {
    self?: string
    related?: string
  }
  data?: JsonApiResourceIdentifier | JsonApiResourceIdentifier[] | null
  meta?: Record<string, unknown>
}

/**
 * JSON:API Resource object
 */
export interface JsonApiResource {
  type: string
  id: string
  attributes?: Record<string, unknown>
  relationships?: Record<string, JsonApiRelationship>
  links?: {
    self?: string
  }
  meta?: Record<string, unknown>
}

/**
 * JSON:API Error object
 */
export interface JsonApiError {
  id?: string
  links?: {
    about?: string
    type?: string
  }
  status?: string
  code?: string
  title?: string
  detail?: string
  source?: {
    pointer?: string
    parameter?: string
    header?: string
  }
  meta?: Record<string, unknown>
}

/**
 * JSON:API Links object
 */
export interface JsonApiLinks {
  self?: string
  related?: string
  first?: string | null
  last?: string | null
  prev?: string | null
  next?: string | null
}

/**
 * JSON:API Document
 */
export interface JsonApiDocument {
  jsonapi: { version: string; meta?: Record<string, unknown> }
  data?: JsonApiResource | JsonApiResource[] | null
  errors?: JsonApiError[]
  meta?: Record<string, unknown>
  links?: JsonApiLinks
  included?: JsonApiResource[]
}

// ============================================================================
// DO RESPONSE TYPES
// ============================================================================

interface DoResponse {
  id: string
  type: string
  data: Record<string, unknown>
  relationships?: Record<string, { id: string; type: string }[]>
  meta?: Record<string, unknown>
}

// ============================================================================
// OPTIONS TYPES
// ============================================================================

interface TransformOptions {
  fieldsets?: Record<string, string[]>
  includes?: string[]
  includedResources?: DoResponse[]
  meta?: Record<string, unknown>
}

interface PaginationInfo {
  pageNumber: number
  pageSize: number
  totalPages: number
  totalItems: number
}

interface CollectionOptions extends TransformOptions {
  pagination?: PaginationInfo
}

// ============================================================================
// TRANSFORMATION FUNCTIONS
// ============================================================================

/**
 * Transform a single DO response to a JSON:API Resource
 */
function doResponseToResource(
  response: DoResponse,
  basePath: string,
  fieldsets?: Record<string, string[]>
): JsonApiResource {
  const { id, type, data, relationships, meta } = response

  // Apply sparse fieldsets if specified for this type
  let attributes: Record<string, unknown> = { ...data }
  if (fieldsets && fieldsets[type]) {
    const allowedFields = fieldsets[type]
    attributes = {}
    for (const field of allowedFields) {
      if (field in data) {
        attributes[field] = data[field]
      }
    }
  }

  const resource: JsonApiResource = {
    type,
    id,
    attributes,
    links: {
      self: `${basePath}/${type}/${id}`,
    },
  }

  // Transform relationships
  if (relationships && Object.keys(relationships).length > 0) {
    resource.relationships = {}
    for (const [relName, relData] of Object.entries(relationships)) {
      const relationshipIdentifiers: JsonApiResourceIdentifier[] = relData.map(rel => ({
        type: rel.type,
        id: rel.id,
      }))

      resource.relationships[relName] = {
        links: {
          self: `${basePath}/${type}/${id}/relationships/${relName}`,
          related: `${basePath}/${type}/${id}/${relName}`,
        },
        data: relationshipIdentifiers,
      }
    }
  }

  // Add meta if present
  if (meta) {
    resource.meta = meta
  }

  return resource
}

/**
 * Transform a DO response to a JSON:API single resource document
 */
export function toJsonApiResource(
  response: DoResponse | null,
  basePath: string,
  options: TransformOptions = {}
): JsonApiDocument {
  const document: JsonApiDocument = {
    jsonapi: { version: '1.1' },
  }

  if (response === null) {
    document.data = null
    return document
  }

  document.data = doResponseToResource(response, basePath, options.fieldsets)

  // Add included resources if requested
  if (options.includes && options.includes.length > 0 && options.includedResources) {
    // Deduplicate by type+id
    const seen = new Set<string>()
    const included: JsonApiResource[] = []

    for (const incResource of options.includedResources) {
      const key = `${incResource.type}:${incResource.id}`
      if (!seen.has(key)) {
        seen.add(key)
        included.push(doResponseToResource(incResource, basePath, options.fieldsets))
      }
    }

    if (included.length > 0) {
      document.included = included
    }
  }

  return document
}

/**
 * Transform an array of DO responses to a JSON:API collection document
 */
export function toJsonApiCollection(
  responses: DoResponse[],
  basePath: string,
  collectionType: string,
  options: CollectionOptions = {}
): JsonApiDocument {
  const document: JsonApiDocument = {
    jsonapi: { version: '1.1' },
    data: responses.map(r => doResponseToResource(r, basePath, options.fieldsets)),
    links: {
      self: `${basePath}/${collectionType}`,
    },
  }

  // Add pagination links if provided
  if (options.pagination) {
    const { pageNumber, totalPages, totalItems } = options.pagination
    const collectionPath = `${basePath}/${collectionType}`

    document.links!.first = `${collectionPath}?page[number]=1`
    document.links!.last = `${collectionPath}?page[number]=${totalPages}`
    document.links!.prev = pageNumber > 1 ? `${collectionPath}?page[number]=${pageNumber - 1}` : null
    document.links!.next = pageNumber < totalPages ? `${collectionPath}?page[number]=${pageNumber + 1}` : null

    // Add meta with pagination info
    document.meta = {
      ...options.meta,
      totalItems,
      totalPages,
    }
  } else if (options.meta) {
    document.meta = options.meta
  }

  // Add included resources if requested
  if (options.includes && options.includes.length > 0 && options.includedResources) {
    const seen = new Set<string>()
    const included: JsonApiResource[] = []

    for (const incResource of options.includedResources) {
      const key = `${incResource.type}:${incResource.id}`
      if (!seen.has(key)) {
        seen.add(key)
        included.push(doResponseToResource(incResource, basePath, options.fieldsets))
      }
    }

    if (included.length > 0) {
      document.included = included
    }
  }

  return document
}

/**
 * Create a JSON:API error document
 */
export function toJsonApiError(error: {
  status: string
  code?: string
  title: string
  detail: string
  source?: { pointer?: string; parameter?: string }
  meta?: Record<string, unknown>
}): JsonApiDocument {
  const jsonApiError: JsonApiError = {
    status: error.status,
    title: error.title,
    detail: error.detail,
  }

  if (error.code) {
    jsonApiError.code = error.code
  }

  if (error.source) {
    jsonApiError.source = error.source
  }

  if (error.meta) {
    jsonApiError.meta = error.meta
  }

  return {
    jsonapi: { version: '1.1' },
    errors: [jsonApiError],
  }
}

// ============================================================================
// QUERY PARAMETER PARSING
// ============================================================================

/**
 * Parse sparse fieldsets from query parameters
 * Format: fields[Type]=field1,field2
 */
export function parseFieldsets(searchParams: URLSearchParams): Record<string, string[]> {
  const fieldsets: Record<string, string[]> = {}

  for (const [key, value] of searchParams.entries()) {
    const match = key.match(/^fields\[(\w+)\]$/)
    if (match) {
      const type = match[1]
      fieldsets[type] = value.split(',').map(f => f.trim())
    }
  }

  return fieldsets
}

/**
 * Parse include parameter for sideloading
 * Format: include=relationship1,relationship2.nested
 */
export function parseIncludes(searchParams: URLSearchParams): string[] {
  const include = searchParams.get('include')
  if (include === null) {
    return []
  }

  return include.split(',').map(i => i.trim())
}

/**
 * Parse pagination parameters
 * Format: page[number]=1&page[size]=10
 */
function parsePagination(searchParams: URLSearchParams): { pageNumber?: number; pageSize?: number } {
  const pageNumber = searchParams.get('page[number]')
  const pageSize = searchParams.get('page[size]')

  return {
    pageNumber: pageNumber ? parseInt(pageNumber, 10) : undefined,
    pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
  }
}

// ============================================================================
// CONTENT NEGOTIATION
// ============================================================================

const JSON_API_MEDIA_TYPE = 'application/vnd.api+json'

/**
 * Check if the Accept header is valid for JSON:API
 * Returns true if acceptable, false if should return 406
 */
function isAcceptableMediaType(acceptHeader: string | null): boolean {
  if (!acceptHeader) {
    return true // No Accept header is acceptable
  }

  // Check for invalid media type parameters on JSON:API type
  // JSON:API spec says clients MUST NOT include media type parameters
  // in Accept header except for ext and profile
  if (acceptHeader.includes(JSON_API_MEDIA_TYPE)) {
    // Check for invalid extensions
    if (acceptHeader.includes('; ext=') && !acceptHeader.includes('; ext=profile')) {
      return false
    }
  }

  // Accept: application/vnd.api+json, application/json, or */*
  const acceptable = [JSON_API_MEDIA_TYPE, 'application/json', '*/*']
  return acceptable.some(type => acceptHeader.includes(type))
}

// ============================================================================
// HONO APP
// ============================================================================

const app = new Hono<{ Bindings: CloudflareEnv }>()

// JSON:API content type middleware
app.use('*', async (c, next) => {
  // Check Accept header for content negotiation
  const accept = c.req.header('Accept')
  if (!isAcceptableMediaType(accept)) {
    const errorDoc = toJsonApiError({
      status: '406',
      title: 'Not Acceptable',
      detail: 'The requested media type is not supported',
    })
    return c.json(errorDoc, 406, {
      'Content-Type': JSON_API_MEDIA_TYPE,
    })
  }

  await next()

  // Set JSON:API content type on response
  c.header('Content-Type', JSON_API_MEDIA_TYPE)
})

// Collection route: /{ns}/{collection}/
app.get('/:ns/:collection/', async (c) => {
  const { ns, collection } = c.req.param()
  const searchParams = new URL(c.req.url).searchParams

  // Check for DO binding
  if (!c.env.DO) {
    const errorDoc = toJsonApiError({
      status: '500',
      title: 'Internal Server Error',
      detail: 'DO binding not configured',
    })
    return c.json(errorDoc, 500)
  }

  const doNamespace = c.env.DO as {
    idFromName(name: string): unknown
    get(id: unknown): { fetch(request: Request | string, init?: RequestInit): Promise<Response> }
  }

  try {
    // Get DO stub and forward request
    const doId = doNamespace.idFromName(ns)
    const stub = doNamespace.get(doId)

    const doResponse = await stub.fetch(
      new Request(`https://${ns}/${collection}/`, {
        method: 'GET',
        headers: c.req.raw.headers,
      })
    )

    if (!doResponse.ok) {
      const errorDoc = toJsonApiError({
        status: doResponse.status.toString(),
        title: doResponse.status === 404 ? 'Not Found' : 'Error',
        detail: `Failed to fetch collection: ${doResponse.statusText}`,
      })
      return c.json(errorDoc, doResponse.status as 404 | 500)
    }

    const data = await doResponse.json() as DoResponse[]

    // Parse query parameters
    const fieldsets = parseFieldsets(searchParams)
    const includes = parseIncludes(searchParams)
    const pagination = parsePagination(searchParams)

    // TODO: Fetch included resources if includes are specified
    // For now, we'll skip sideloading implementation

    const options: CollectionOptions = { fieldsets, includes }

    // Add pagination if we have total info (would come from DO response headers)
    // For now, simulate based on array length
    if (pagination.pageNumber) {
      const pageSize = pagination.pageSize || 10
      const totalItems = data.length
      const totalPages = Math.ceil(totalItems / pageSize)
      options.pagination = {
        pageNumber: pagination.pageNumber,
        pageSize,
        totalPages,
        totalItems,
      }
    }

    const document = toJsonApiCollection(data, `/${ns}`, collection, options)
    return c.json(document)
  } catch (error) {
    const errorDoc = toJsonApiError({
      status: '500',
      title: 'Internal Server Error',
      detail: error instanceof Error ? error.message : 'Unknown error',
    })
    return c.json(errorDoc, 500)
  }
})

// Single resource route: /{ns}/{collection}/{id}
app.get('/:ns/:collection/:id', async (c) => {
  const { ns, collection, id } = c.req.param()
  const searchParams = new URL(c.req.url).searchParams

  // Check for DO binding
  if (!c.env.DO) {
    const errorDoc = toJsonApiError({
      status: '500',
      title: 'Internal Server Error',
      detail: 'DO binding not configured',
    })
    return c.json(errorDoc, 500)
  }

  const doNamespace = c.env.DO as {
    idFromName(name: string): unknown
    get(id: unknown): { fetch(request: Request | string, init?: RequestInit): Promise<Response> }
  }

  try {
    // Get DO stub and forward request
    const doId = doNamespace.idFromName(ns)
    const stub = doNamespace.get(doId)

    const doResponse = await stub.fetch(
      new Request(`https://${ns}/${collection}/${id}`, {
        method: 'GET',
        headers: c.req.raw.headers,
      })
    )

    if (!doResponse.ok) {
      const errorDoc = toJsonApiError({
        status: doResponse.status.toString(),
        title: doResponse.status === 404 ? 'Not Found' : 'Error',
        detail: doResponse.status === 404 ? 'Resource not found' : `Failed to fetch resource: ${doResponse.statusText}`,
      })
      return c.json(errorDoc, doResponse.status as 404 | 500)
    }

    const data = await doResponse.json() as DoResponse

    // Parse query parameters
    const fieldsets = parseFieldsets(searchParams)
    const includes = parseIncludes(searchParams)

    const options: TransformOptions = { fieldsets, includes }

    // Fetch included resources if requested
    if (includes.length > 0 && data.relationships) {
      const includedResources: DoResponse[] = []

      for (const includePath of includes) {
        const relName = includePath.split('.')[0] // Handle nested includes later
        const relData = data.relationships[relName]

        if (relData) {
          // Fetch each related resource
          for (const rel of relData) {
            try {
              const relResponse = await stub.fetch(
                new Request(`https://${ns}/${rel.type}/`, {
                  method: 'GET',
                  headers: c.req.raw.headers,
                })
              )

              if (relResponse.ok) {
                const relResources = await relResponse.json() as DoResponse[]
                const found = relResources.find(r => r.id === rel.id)
                if (found) {
                  includedResources.push(found)
                }
              }
            } catch {
              // Skip failed includes
            }
          }
        }
      }

      options.includedResources = includedResources
    }

    const document = toJsonApiResource(data, `/${ns}`, options)
    return c.json(document)
  } catch (error) {
    const errorDoc = toJsonApiError({
      status: '500',
      title: 'Internal Server Error',
      detail: error instanceof Error ? error.message : 'Unknown error',
    })
    return c.json(errorDoc, 500)
  }
})

// ============================================================================
// HANDLER FACTORY
// ============================================================================

/**
 * Create a JSON:API handler function
 */
export function createJsonApiHandler() {
  return async (request: Request, env: Record<string, unknown>): Promise<Response> => {
    return app.fetch(request, env as CloudflareEnv)
  }
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default {
  fetch: app.fetch,
}
