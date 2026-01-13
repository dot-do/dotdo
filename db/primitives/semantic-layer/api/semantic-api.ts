/**
 * Semantic Query API - REST + GraphQL endpoints
 *
 * Provides API layer for semantic queries:
 * - REST endpoints (/v1/load, /v1/sql, /v1/meta)
 * - GraphQL schema generated from cube definitions
 * - Streaming results for large datasets
 * - Pagination and cursor-based navigation
 * - OpenAPI spec generation
 *
 * @see dotdo-caxk5
 */

import { Hono, type MiddlewareHandler, type Context } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { HTTPException } from 'hono/http-exception'
import { stream, streamText } from 'hono/streaming'
import {
  SemanticLayer,
  type SemanticQuery,
  type QueryResult,
  type CubeMeta,
  type SchemaMeta,
  CubeNotFoundError,
  InvalidQueryError,
  SemanticLayerError,
  type FilterOperator,
  type Granularity,
  type SQLDialect,
} from '../index'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Load request body
 */
export interface LoadRequest {
  query: SemanticQuery
  pagination?: PaginationOptions
  streaming?: StreamOptions
}

/**
 * Load response
 */
export interface LoadResponse {
  data: Record<string, unknown>[]
  sql: string
  query?: SemanticQuery
  annotation?: {
    measures: Array<{ name: string; type: string }>
    dimensions: Array<{ name: string; type: string }>
  }
  usedPreAggregation?: string
}

/**
 * SQL request body
 */
export interface SqlRequest {
  query: SemanticQuery
  format?: 'inline' | 'parameterized'
  dialect?: SQLDialect
}

/**
 * SQL response
 */
export interface SqlResponse {
  sql: string
  params?: unknown[]
}

/**
 * Meta response
 */
export interface MetaResponse {
  cubes: CubeMeta[]
}

/**
 * Streaming options
 */
export interface StreamOptions {
  batchSize?: number
  includeProgress?: boolean
}

/**
 * Pagination options
 */
export interface PaginationOptions {
  type?: 'offset' | 'cursor'
  page?: number
  pageSize?: number
  cursor?: string
  includeTotal?: boolean
}

/**
 * Cursor information
 */
export interface CursorInfo {
  next?: string
  prev?: string
  hasMore: boolean
}

/**
 * Paginated response
 */
export interface PaginatedResponse extends LoadResponse {
  pagination?: {
    page?: number
    pageSize?: number
    total?: number
  }
  cursor?: CursorInfo
}

/**
 * Semantic API configuration
 */
export interface SemanticApiConfig {
  semanticLayer: SemanticLayer
  basePath?: string
  enableGraphQL?: boolean
  middleware?: MiddlewareHandler[]
}

/**
 * OpenAPI specification structure
 */
export interface OpenAPISpec {
  openapi: string
  info: {
    title: string
    version: string
    description?: string
  }
  paths: Record<string, Record<string, unknown>>
  components?: {
    schemas?: Record<string, unknown>
  }
}

// =============================================================================
// GRAPHQL SCHEMA GENERATION
// =============================================================================

/**
 * Generate GraphQL schema from semantic layer cube definitions
 */
export function generateGraphQLSchema(semantic: SemanticLayer): string {
  const cubes = semantic.getCubes()
  const schema: string[] = []

  // Add scalar types
  schema.push(`scalar DateTime`)
  schema.push(`scalar JSON`)
  schema.push('')

  // Add time granularity enum
  schema.push(`enum TimeGranularity {
  SECOND
  MINUTE
  HOUR
  DAY
  WEEK
  MONTH
  QUARTER
  YEAR
}`)
  schema.push('')

  // Add filter operator enum
  schema.push(`enum FilterOperator {
  EQUALS
  NOT_EQUALS
  GT
  GTE
  LT
  LTE
  IN
  NOT_IN
  CONTAINS
  NOT_CONTAINS
  BETWEEN
  IS_NULL
  IS_NOT_NULL
}`)
  schema.push('')

  // Generate types for each cube
  for (const cube of cubes) {
    const typeName = toPascalCase(cube.name)

    // Main cube type
    const fields: string[] = []

    // Add measure fields
    for (const [name, def] of Object.entries(cube.measures)) {
      const graphqlType = measureTypeToGraphQL(def.type)
      fields.push(`  ${name}: ${graphqlType}`)
    }

    // Add dimension fields
    for (const [name, def] of Object.entries(cube.dimensions)) {
      const graphqlType = dimensionTypeToGraphQL(def.type)
      fields.push(`  ${name}: ${graphqlType}`)
    }

    schema.push(`type ${typeName} {
${fields.join('\n')}
}`)
    schema.push('')

    // Filter input type
    const filterFields: string[] = []
    for (const [name, def] of Object.entries(cube.dimensions)) {
      const graphqlType = dimensionTypeToGraphQL(def.type)
      filterFields.push(`  ${name}: ${typeName}${toPascalCase(name)}Filter`)
    }

    schema.push(`input ${typeName}Filter {
${filterFields.join('\n')}
}`)
    schema.push('')

    // Individual field filter types
    for (const [name, def] of Object.entries(cube.dimensions)) {
      const graphqlType = dimensionTypeToGraphQL(def.type).replace('!', '')
      schema.push(`input ${typeName}${toPascalCase(name)}Filter {
  equals: ${graphqlType}
  notEquals: ${graphqlType}
  gt: ${graphqlType}
  gte: ${graphqlType}
  lt: ${graphqlType}
  lte: ${graphqlType}
  in: [${graphqlType}]
  notIn: [${graphqlType}]
}`)
      schema.push('')
    }

    // Time dimension input
    schema.push(`input ${typeName}TimeDimension {
  dimension: ${typeName}TimeDimensionField!
  granularity: TimeGranularity
  dateRange: [String]
}`)
    schema.push('')

    // Time dimension field enum
    const timeDimensions = Object.entries(cube.dimensions).filter(
      ([_, def]) => def.type === 'time'
    )
    if (timeDimensions.length > 0) {
      const enumValues = timeDimensions.map(([name]) => `  ${name.toUpperCase()}`).join('\n')
      schema.push(`enum ${typeName}TimeDimensionField {
${enumValues}
}`)
      schema.push('')
    }
  }

  // Generate Query type
  const queryFields: string[] = []
  for (const cube of cubes) {
    const typeName = toPascalCase(cube.name)
    queryFields.push(`  ${cube.name}(
    filter: ${typeName}Filter
    timeDimension: ${typeName}TimeDimension
    limit: Int
    offset: Int
  ): [${typeName}]`)
  }

  schema.push(`type Query {
${queryFields.join('\n\n')}
}`)

  return schema.join('\n')
}

function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

function measureTypeToGraphQL(type: string): string {
  switch (type) {
    case 'count':
    case 'countDistinct':
      return 'Int'
    case 'sum':
    case 'avg':
    case 'min':
    case 'max':
    case 'custom':
      return 'Float'
    default:
      return 'Float'
  }
}

function dimensionTypeToGraphQL(type: string): string {
  switch (type) {
    case 'string':
      return 'String'
    case 'number':
      return 'Float'
    case 'time':
      return 'DateTime'
    case 'boolean':
      return 'Boolean'
    case 'geo':
      return 'JSON'
    default:
      return 'String'
  }
}

// =============================================================================
// OPENAPI SPEC GENERATION
// =============================================================================

/**
 * Generate OpenAPI spec for semantic API
 */
export function generateOpenAPISpec(semantic: SemanticLayer): OpenAPISpec {
  const cubes = semantic.getCubes()

  return {
    openapi: '3.1.0',
    info: {
      title: 'Semantic Query API',
      version: '1.0.0',
      description:
        'API for executing semantic queries against cube definitions. Supports REST endpoints and optional GraphQL.',
    },
    paths: {
      '/v1/load': {
        post: {
          operationId: 'load',
          summary: 'Execute semantic query',
          description: 'Execute a semantic query and return results',
          tags: ['Queries'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LoadRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Query results',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/LoadResponse' },
                },
                'application/x-ndjson': {
                  schema: { type: 'string', description: 'Newline-delimited JSON stream' },
                },
                'text/event-stream': {
                  schema: { type: 'string', description: 'Server-Sent Events stream' },
                },
              },
            },
            '400': {
              description: 'Bad request',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '500': {
              description: 'Internal server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/v1/sql': {
        post: {
          operationId: 'sql',
          summary: 'Generate SQL from semantic query',
          description: 'Generate SQL without executing the query',
          tags: ['Queries'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SqlRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Generated SQL',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SqlResponse' },
                },
              },
            },
            '400': {
              description: 'Bad request',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/v1/meta': {
        get: {
          operationId: 'meta',
          summary: 'Get schema metadata',
          description: 'Get cube definitions and metadata',
          tags: ['Schema'],
          parameters: [
            {
              name: 'cube',
              in: 'query',
              description: 'Filter by cube name',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Schema metadata',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/MetaResponse' },
                },
              },
            },
            '404': {
              description: 'Cube not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        LoadRequest: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { $ref: '#/components/schemas/SemanticQuery' },
            pagination: { $ref: '#/components/schemas/PaginationOptions' },
            streaming: { $ref: '#/components/schemas/StreamOptions' },
          },
        },
        LoadResponse: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: { type: 'object' },
            },
            sql: { type: 'string' },
            query: { $ref: '#/components/schemas/SemanticQuery' },
            annotation: {
              type: 'object',
              properties: {
                measures: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      type: { type: 'string' },
                    },
                  },
                },
                dimensions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      type: { type: 'string' },
                    },
                  },
                },
              },
            },
            usedPreAggregation: { type: 'string' },
            pagination: { $ref: '#/components/schemas/PaginationInfo' },
            cursor: { $ref: '#/components/schemas/CursorInfo' },
          },
        },
        SqlRequest: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { $ref: '#/components/schemas/SemanticQuery' },
            format: {
              type: 'string',
              enum: ['inline', 'parameterized'],
            },
            dialect: {
              type: 'string',
              enum: ['postgres', 'clickhouse', 'duckdb', 'sqlite', 'mysql'],
            },
          },
        },
        SqlResponse: {
          type: 'object',
          properties: {
            sql: { type: 'string' },
            params: { type: 'array', items: {} },
          },
        },
        MetaResponse: {
          type: 'object',
          properties: {
            cubes: {
              type: 'array',
              items: { $ref: '#/components/schemas/CubeMeta' },
            },
          },
        },
        SemanticQuery: {
          type: 'object',
          properties: {
            measures: {
              type: 'array',
              items: { type: 'string' },
            },
            dimensions: {
              type: 'array',
              items: { type: 'string' },
            },
            timeDimensions: {
              type: 'array',
              items: { $ref: '#/components/schemas/TimeDimension' },
            },
            filters: {
              type: 'array',
              items: { $ref: '#/components/schemas/QueryFilter' },
            },
            order: {
              type: 'array',
              items: { $ref: '#/components/schemas/OrderSpec' },
            },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
          },
        },
        TimeDimension: {
          type: 'object',
          required: ['dimension'],
          properties: {
            dimension: { type: 'string' },
            granularity: {
              type: 'string',
              enum: ['second', 'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'],
            },
            dateRange: {
              type: 'array',
              items: { type: 'string' },
              minItems: 2,
              maxItems: 2,
            },
          },
        },
        QueryFilter: {
          type: 'object',
          required: ['dimension', 'operator', 'values'],
          properties: {
            dimension: { type: 'string' },
            operator: {
              type: 'string',
              enum: [
                'equals',
                'notEquals',
                'gt',
                'gte',
                'lt',
                'lte',
                'in',
                'notIn',
                'contains',
                'notContains',
                'between',
                'isNull',
                'isNotNull',
              ],
            },
            values: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
        OrderSpec: {
          type: 'object',
          required: ['id', 'desc'],
          properties: {
            id: { type: 'string' },
            desc: { type: 'boolean' },
          },
        },
        PaginationOptions: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['offset', 'cursor'],
            },
            page: { type: 'integer' },
            pageSize: { type: 'integer' },
            cursor: { type: 'string' },
            includeTotal: { type: 'boolean' },
          },
        },
        PaginationInfo: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            pageSize: { type: 'integer' },
            total: { type: 'integer' },
          },
        },
        CursorInfo: {
          type: 'object',
          properties: {
            next: { type: 'string' },
            prev: { type: 'string' },
            hasMore: { type: 'boolean' },
          },
        },
        StreamOptions: {
          type: 'object',
          properties: {
            batchSize: { type: 'integer' },
            includeProgress: { type: 'boolean' },
          },
        },
        CubeMeta: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            measures: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  type: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
            dimensions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  type: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
            joins: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  relationship: { type: 'string' },
                },
              },
            },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }
}

// =============================================================================
// ROUTE HANDLERS
// =============================================================================

/**
 * Create semantic API routes
 */
export function semanticApiRoutes(semantic: SemanticLayer): Hono {
  const app = new Hono()

  // POST /v1/load - Execute semantic query
  app.post('/v1/load', async (c) => {
    const startTime = Date.now()
    const requestId = c.req.header('X-Request-ID') || crypto.randomUUID()

    try {
      const body = await c.req.json<LoadRequest>()

      // Validate request
      if (!body.query) {
        return c.json({ error: { code: 'BAD_REQUEST', message: 'Missing query field' } }, 400)
      }

      // Validate query has at least measures or dimensions
      const query = body.query
      if (
        (!query.measures || query.measures.length === 0) &&
        (!query.dimensions || query.dimensions.length === 0) &&
        (!query.timeDimensions || query.timeDimensions.length === 0)
      ) {
        return c.json(
          {
            error: {
              code: 'BAD_REQUEST',
              message: 'Query must have at least one measure, dimension, or time dimension',
            },
          },
          400
        )
      }

      // Check Accept header for streaming
      const accept = c.req.header('Accept') || ''

      if (accept.includes('application/x-ndjson')) {
        // Stream as NDJSON
        c.header('Content-Type', 'application/x-ndjson')
        c.header('X-Request-ID', requestId)

        return stream(c, async (stream) => {
          try {
            // Send metadata first
            if (body.streaming?.includeProgress) {
              await stream.write(JSON.stringify({ type: 'meta', timestamp: new Date().toISOString() }) + '\n')
            }

            // Execute query
            const result = await semantic.query(query)

            // Stream data rows
            for (const row of result.data) {
              await stream.write(JSON.stringify({ type: 'data', row }) + '\n')
            }

            // Send completion
            await stream.write(
              JSON.stringify({
                type: 'complete',
                sql: result.sql,
                rowCount: result.data.length,
              }) + '\n'
            )
          } catch (err) {
            await stream.write(
              JSON.stringify({
                type: 'error',
                error: { code: 'QUERY_ERROR', message: (err as Error).message },
              }) + '\n'
            )
          }
        })
      }

      if (accept.includes('text/event-stream')) {
        // Stream as SSE
        c.header('Content-Type', 'text/event-stream')
        c.header('Cache-Control', 'no-cache')
        c.header('Connection', 'keep-alive')
        c.header('X-Request-ID', requestId)

        return stream(c, async (stream) => {
          try {
            const result = await semantic.query(query)

            // Send meta event
            await stream.write(`event: meta\ndata: ${JSON.stringify({ sql: result.sql })}\n\n`)

            // Send data events
            for (const row of result.data) {
              await stream.write(`event: data\ndata: ${JSON.stringify(row)}\n\n`)
            }

            // Send complete event
            await stream.write(`event: complete\ndata: ${JSON.stringify({ rowCount: result.data.length })}\n\n`)
          } catch (err) {
            await stream.write(
              `event: error\ndata: ${JSON.stringify({ code: 'QUERY_ERROR', message: (err as Error).message })}\n\n`
            )
          }
        })
      }

      // Execute query
      const result = await semantic.query(query)

      // Build annotation
      const annotation = buildAnnotation(semantic, query)

      // Build response
      const response: PaginatedResponse = {
        data: result.data,
        sql: result.sql,
        query,
        annotation,
        usedPreAggregation: result.usedPreAggregation,
      }

      // Handle pagination
      if (body.pagination) {
        const paginationInfo = buildPaginationInfo(body.pagination, result.data)
        response.pagination = paginationInfo.pagination
        response.cursor = paginationInfo.cursor
      }

      // Set headers
      c.header('X-Request-ID', requestId)
      c.header('X-Execution-Time', `${Date.now() - startTime}ms`)

      return c.json(response)
    } catch (err) {
      if (err instanceof CubeNotFoundError || err instanceof InvalidQueryError) {
        return c.json({ error: { code: 'BAD_REQUEST', message: (err as Error).message } }, 400)
      }
      if (err instanceof SyntaxError) {
        return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON' } }, 400)
      }
      throw err
    }
  })

  // POST /v1/sql - Generate SQL from query
  app.post('/v1/sql', async (c) => {
    try {
      const body = await c.req.json<SqlRequest>()

      if (!body.query) {
        return c.json({ error: { code: 'BAD_REQUEST', message: 'Missing query field' } }, 400)
      }

      // Create a temporary semantic layer with the requested dialect
      let layerToUse = semantic
      if (body.dialect) {
        layerToUse = new SemanticLayer({ sqlDialect: body.dialect })
        // Copy cube definitions
        for (const cube of semantic.getCubes()) {
          layerToUse.defineCube({
            name: cube.name,
            sql: cube.sql,
            measures: cube.measures,
            dimensions: cube.dimensions,
            joins: cube.joins,
          })
        }
      }

      const result = await layerToUse.query(body.query)

      const response: SqlResponse = {
        sql: result.sql,
      }

      // If parameterized format requested, extract parameters
      if (body.format === 'parameterized') {
        response.params = []
        // Note: actual parameterization would require modifying the SQL generator
        // For now, return empty params array
      }

      return c.json(response)
    } catch (err) {
      if (err instanceof CubeNotFoundError || err instanceof InvalidQueryError) {
        return c.json({ error: { code: 'BAD_REQUEST', message: (err as Error).message } }, 400)
      }
      if (err instanceof SyntaxError) {
        return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON' } }, 400)
      }
      throw err
    }
  })

  // GET /v1/meta - Get schema metadata
  app.get('/v1/meta', (c) => {
    const cubeFilter = c.req.query('cube')

    const meta = semantic.getMeta()

    if (cubeFilter) {
      const cube = meta.cubes.find((c) => c.name === cubeFilter)
      if (!cube) {
        return c.json({ error: { code: 'NOT_FOUND', message: `Cube '${cubeFilter}' not found` } }, 404)
      }
      return c.json({ cubes: [cube] })
    }

    return c.json(meta)
  })

  // GET /openapi.json - OpenAPI spec
  app.get('/openapi.json', (c) => {
    const spec = generateOpenAPISpec(semantic)
    return c.json(spec)
  })

  return app
}

// =============================================================================
// GRAPHQL ENDPOINT
// =============================================================================

/**
 * Create GraphQL endpoint
 */
function createGraphQLEndpoint(semantic: SemanticLayer): Hono {
  const app = new Hono()

  app.post('/graphql', async (c) => {
    try {
      const body = await c.req.json<{ query: string; variables?: Record<string, unknown> }>()

      if (!body.query) {
        return c.json({ errors: [{ message: 'Missing query' }] }, 400)
      }

      // Simple GraphQL execution
      // In a real implementation, use a GraphQL library like graphql-yoga
      const result = await executeGraphQL(semantic, body.query, body.variables)
      return c.json(result)
    } catch (err) {
      return c.json({ errors: [{ message: (err as Error).message }] }, 500)
    }
  })

  return app
}

/**
 * Simple GraphQL executor
 * In production, use a proper GraphQL library
 */
async function executeGraphQL(
  semantic: SemanticLayer,
  query: string,
  variables?: Record<string, unknown>
): Promise<{ data?: unknown; errors?: Array<{ message: string }> }> {
  // Handle introspection
  if (query.includes('__schema') || query.includes('__typename')) {
    return {
      data: {
        __schema: {
          types: semantic.getCubes().map((c) => ({
            name: toPascalCase(c.name),
          })),
        },
        __typename: 'Query',
      },
    }
  }

  // Parse simple queries (this is a simplified parser)
  // Format: { cubeName { field1 field2 } }
  const cubeMatch = query.match(/\{\s*(\w+)(?:\([^)]*\))?\s*\{([^}]+)\}/)
  if (!cubeMatch) {
    return { errors: [{ message: 'Invalid query format' }] }
  }

  const [, cubeName, fieldsStr] = cubeMatch
  const cube = semantic.getCube(cubeName!)

  if (!cube) {
    return { errors: [{ message: `Cube '${cubeName}' not found` }] }
  }

  // Parse fields
  const fields = fieldsStr!
    .trim()
    .split(/\s+/)
    .filter((f) => f)

  // Build semantic query
  const measures: string[] = []
  const dimensions: string[] = []

  for (const field of fields) {
    if (cube.getMeasure(field)) {
      measures.push(`${cubeName}.${field}`)
    } else if (cube.getDimension(field)) {
      dimensions.push(`${cubeName}.${field}`)
    }
  }

  // Parse filter argument if present
  const filterMatch = query.match(/filter:\s*\{([^}]+)\}/)
  const filters: SemanticQuery['filters'] = []
  if (filterMatch) {
    // Simple filter parsing: { fieldName: { operator: value } }
    const filterStr = filterMatch[1]
    const fieldMatches = filterStr!.matchAll(/(\w+):\s*\{\s*(\w+):\s*"([^"]+)"\s*\}/g)
    for (const match of fieldMatches) {
      const [, field, op, val] = match
      filters.push({
        dimension: `${cubeName}.${field}`,
        operator: op as FilterOperator,
        values: [val!],
      })
    }
  }

  // Execute query
  try {
    const result = await semantic.query({
      measures,
      dimensions,
      filters: filters.length > 0 ? filters : undefined,
    })

    return {
      data: {
        [cubeName!]: result.data,
      },
    }
  } catch (err) {
    return { errors: [{ message: (err as Error).message }] }
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function buildAnnotation(
  semantic: SemanticLayer,
  query: SemanticQuery
): LoadResponse['annotation'] {
  const measures: Array<{ name: string; type: string }> = []
  const dimensions: Array<{ name: string; type: string }> = []

  if (query.measures) {
    for (const ref of query.measures) {
      const [cubeName, measureName] = ref.split('.')
      const cube = semantic.getCube(cubeName!)
      const measure = cube?.getMeasure(measureName!)
      if (measure) {
        measures.push({ name: measureName!, type: measure.type })
      }
    }
  }

  if (query.dimensions) {
    for (const ref of query.dimensions) {
      const [cubeName, dimName] = ref.split('.')
      const cube = semantic.getCube(cubeName!)
      const dim = cube?.getDimension(dimName!)
      if (dim) {
        dimensions.push({ name: dimName!, type: dim.type })
      }
    }
  }

  if (query.timeDimensions) {
    for (const td of query.timeDimensions) {
      const [cubeName, dimName] = td.dimension.split('.')
      const cube = semantic.getCube(cubeName!)
      const dim = cube?.getDimension(dimName!)
      if (dim) {
        dimensions.push({ name: dimName!, type: dim.type })
      }
    }
  }

  return { measures, dimensions }
}

function buildPaginationInfo(
  options: PaginationOptions,
  data: Record<string, unknown>[]
): { pagination?: PaginatedResponse['pagination']; cursor?: CursorInfo } {
  const result: { pagination?: PaginatedResponse['pagination']; cursor?: CursorInfo } = {}

  if (options.type === 'cursor') {
    // Build cursor-based pagination info
    const hasMore = data.length >= (options.pageSize || 10)
    const lastItem = data[data.length - 1]

    result.cursor = {
      hasMore,
      next: hasMore && lastItem ? btoa(JSON.stringify({ offset: data.length })) : undefined,
    }
  } else {
    // Build offset-based pagination info
    result.pagination = {
      page: options.page || 1,
      pageSize: options.pageSize || data.length,
    }

    if (options.includeTotal) {
      // In a real implementation, run a COUNT query
      result.pagination.total = data.length
    }
  }

  return result
}

// =============================================================================
// API FACTORY
// =============================================================================

/**
 * Create semantic API Hono application
 */
export function createSemanticApi(config: SemanticApiConfig): Hono {
  const app = new Hono()

  // Apply CORS
  app.use('*', cors())

  // Apply custom middleware
  if (config.middleware) {
    for (const mw of config.middleware) {
      app.use('*', mw)
    }
  }

  // Mount routes at base path
  const basePath = config.basePath || ''
  const routes = semanticApiRoutes(config.semanticLayer)

  if (basePath) {
    app.route(basePath, routes)
  } else {
    app.route('/', routes)
  }

  // Mount GraphQL if enabled
  if (config.enableGraphQL) {
    const graphqlApp = createGraphQLEndpoint(config.semanticLayer)
    app.route('/', graphqlApp)
  }

  return app
}

// Export for direct route mounting
export { semanticApiRoutes as routes }
