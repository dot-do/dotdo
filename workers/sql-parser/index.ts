/**
 * @dotdo/workers/sql-parser - SQL Parser RPC Worker
 *
 * Dedicated worker for SQL parsing, offloading heavy parsing operations
 * from the main worker bundle. Supports both node-sql-parser and pgsql-parser
 * adapters with automatic selection based on configuration.
 *
 * Benefits:
 * - Keeps main worker bundle small
 * - Isolates large WASM binaries (pgsql-parser: 1.2MB)
 * - Enables parallel parsing across worker instances
 * - Provides consistent parsing API via RPC
 *
 * @module workers/sql-parser
 */

import { NodeSQLParserAdapter } from '../../lib/sql/adapters/node-sql-parser'
import { PgsqlParserAdapter } from '../../lib/sql/adapters/pgsql-parser'
import type {
  SQLParser,
  ParseResult,
  ParseOptions,
  StringifyOptions,
  ValidationResult,
  AST,
  Dialect,
  SQLParserRPCMethods,
} from '../../lib/sql/types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Worker environment bindings
 */
export interface Env {
  /**
   * Which parser adapter to use
   * - 'node-sql-parser': Lightweight, multi-dialect
   * - 'pgsql-parser': Fast PostgreSQL WASM
   * - 'auto': Use pgsql-parser for PostgreSQL, node-sql-parser for others
   */
  SQL_PARSER_ADAPTER?: 'node-sql-parser' | 'pgsql-parser' | 'auto'

  /**
   * Default dialect when not specified in request
   */
  SQL_PARSER_DEFAULT_DIALECT?: Dialect

  /**
   * Enable debug logging
   */
  SQL_PARSER_DEBUG?: string
}

/**
 * RPC request envelope
 */
interface RPCRequest<T = unknown> {
  id: string
  method: string
  params: T
}

/**
 * RPC response envelope
 */
interface RPCResponse<T = unknown> {
  id: string
  result?: T
  error?: RPCError
}

/**
 * RPC error structure
 */
interface RPCError {
  code: string
  message: string
  data?: unknown
}

// ============================================================================
// PARSER CACHE
// ============================================================================

let nodeSqlParserInstance: NodeSQLParserAdapter | null = null
let pgsqlParserInstance: PgsqlParserAdapter | null = null

/**
 * Get or create node-sql-parser instance
 */
function getNodeSQLParser(): NodeSQLParserAdapter {
  if (!nodeSqlParserInstance) {
    nodeSqlParserInstance = new NodeSQLParserAdapter()
  }
  return nodeSqlParserInstance
}

/**
 * Get or create pgsql-parser instance
 */
function getPgsqlParser(): PgsqlParserAdapter {
  if (!pgsqlParserInstance) {
    pgsqlParserInstance = new PgsqlParserAdapter()
  }
  return pgsqlParserInstance
}

/**
 * Get appropriate parser based on adapter config and dialect
 */
function getParser(env: Env, dialect?: Dialect): SQLParser {
  const adapter = env.SQL_PARSER_ADAPTER || 'auto'
  const effectiveDialect = dialect || env.SQL_PARSER_DEFAULT_DIALECT || 'postgresql'

  switch (adapter) {
    case 'node-sql-parser':
      return getNodeSQLParser()

    case 'pgsql-parser':
      return getPgsqlParser()

    case 'auto':
    default:
      // Use pgsql-parser for PostgreSQL (faster), node-sql-parser for others
      if (effectiveDialect === 'postgresql') {
        return getPgsqlParser()
      }
      return getNodeSQLParser()
  }
}

// ============================================================================
// RPC HANDLERS
// ============================================================================

/**
 * Handle sql.parse RPC method
 */
function handleParse(
  params: SQLParserRPCMethods['sql.parse']['params'],
  env: Env
): ParseResult {
  const dialect = params.options?.dialect || env.SQL_PARSER_DEFAULT_DIALECT || 'postgresql'
  const parser = getParser(env, dialect)

  return parser.parse(params.sql, {
    ...params.options,
    dialect,
  })
}

/**
 * Handle sql.stringify RPC method
 */
function handleStringify(
  params: SQLParserRPCMethods['sql.stringify']['params'],
  env: Env
): { sql: string } {
  const dialect = params.options?.dialect || env.SQL_PARSER_DEFAULT_DIALECT || 'postgresql'
  const parser = getParser(env, dialect)

  const sql = parser.stringify(params.ast, params.options)
  return { sql }
}

/**
 * Handle sql.validate RPC method
 */
function handleValidate(
  params: SQLParserRPCMethods['sql.validate']['params'],
  env: Env
): ValidationResult {
  const dialect = params.dialect || env.SQL_PARSER_DEFAULT_DIALECT || 'postgresql'
  const parser = getParser(env, dialect)

  return parser.validate(params.sql, dialect)
}

/**
 * Handle sql.info RPC method
 */
function handleInfo(
  _params: Record<string, never>,
  env: Env
): { adapter: string; version: string; dialects: Dialect[] } {
  const adapter = env.SQL_PARSER_ADAPTER || 'auto'

  // Get supported dialects based on adapter
  let dialects: Dialect[]
  let adapterName: string

  switch (adapter) {
    case 'node-sql-parser':
      adapterName = 'node-sql-parser'
      dialects = getNodeSQLParser().supportedDialects
      break

    case 'pgsql-parser':
      adapterName = 'pgsql-parser'
      dialects = getPgsqlParser().supportedDialects
      break

    case 'auto':
    default:
      adapterName = 'auto (pgsql-parser + node-sql-parser)'
      dialects = ['postgresql', 'mysql', 'sqlite', 'mariadb', 'transactsql', 'bigquery']
      break
  }

  return {
    adapter: adapterName,
    version: '1.0.0',
    dialects,
  }
}

// ============================================================================
// REQUEST HANDLING
// ============================================================================

/**
 * Handle RPC request
 */
function handleRPCRequest(
  request: RPCRequest,
  env: Env
): RPCResponse {
  const debug = env.SQL_PARSER_DEBUG === 'true'

  if (debug) {
    console.log(`[sql-parser] Handling ${request.method}`, request.params)
  }

  try {
    let result: unknown

    switch (request.method) {
      case 'sql.parse':
        result = handleParse(
          request.params as SQLParserRPCMethods['sql.parse']['params'],
          env
        )
        break

      case 'sql.stringify':
        result = handleStringify(
          request.params as SQLParserRPCMethods['sql.stringify']['params'],
          env
        )
        break

      case 'sql.validate':
        result = handleValidate(
          request.params as SQLParserRPCMethods['sql.validate']['params'],
          env
        )
        break

      case 'sql.info':
        result = handleInfo(
          request.params as Record<string, never>,
          env
        )
        break

      default:
        return {
          id: request.id,
          error: {
            code: 'METHOD_NOT_FOUND',
            message: `Unknown method: ${request.method}`,
          },
        }
    }

    if (debug) {
      console.log(`[sql-parser] Result for ${request.method}`, result)
    }

    return {
      id: request.id,
      result,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    if (debug) {
      console.error(`[sql-parser] Error in ${request.method}:`, error)
    }

    return {
      id: request.id,
      error: {
        code: 'INTERNAL_ERROR',
        message: errorMessage,
        data: error instanceof Error ? { name: error.name, stack: error.stack } : undefined,
      },
    }
  }
}

// ============================================================================
// WORKER EXPORT
// ============================================================================

export default {
  /**
   * Handle HTTP requests
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Health check endpoint
    if (url.pathname === '/health' || url.pathname === '/') {
      const info = handleInfo({}, env)
      return Response.json({
        status: 'healthy',
        service: 'sql-parser',
        ...info,
      })
    }

    // RPC endpoint
    if (url.pathname === '/rpc' && request.method === 'POST') {
      try {
        const rpcRequest: RPCRequest = await request.json()
        const response = handleRPCRequest(rpcRequest, env)

        return Response.json(response, {
          headers: {
            'Content-Type': 'application/json',
            'X-Request-ID': rpcRequest.id,
          },
        })
      } catch (error) {
        return Response.json(
          {
            id: 'unknown',
            error: {
              code: 'PARSE_ERROR',
              message: 'Invalid JSON in request body',
            },
          },
          { status: 400 }
        )
      }
    }

    // Quick parse endpoint (for simple usage)
    if (url.pathname === '/parse' && request.method === 'POST') {
      try {
        const body: { sql: string; dialect?: Dialect; options?: ParseOptions } = await request.json()
        const result = handleParse(
          { sql: body.sql, options: { dialect: body.dialect, ...body.options } },
          env
        )
        return Response.json(result)
      } catch (error) {
        return Response.json(
          {
            error: error instanceof Error ? error.message : 'Parse failed',
          },
          { status: 400 }
        )
      }
    }

    // Quick validate endpoint
    if (url.pathname === '/validate' && request.method === 'POST') {
      try {
        const body: { sql: string; dialect?: Dialect } = await request.json()
        const result = handleValidate({ sql: body.sql, dialect: body.dialect }, env)
        return Response.json(result)
      } catch (error) {
        return Response.json(
          {
            error: error instanceof Error ? error.message : 'Validation failed',
          },
          { status: 400 }
        )
      }
    }

    // Not found
    return Response.json(
      {
        error: 'Not found',
        endpoints: [
          { path: '/', method: 'GET', description: 'Health check and info' },
          { path: '/rpc', method: 'POST', description: 'RPC endpoint' },
          { path: '/parse', method: 'POST', description: 'Quick parse endpoint' },
          { path: '/validate', method: 'POST', description: 'Quick validate endpoint' },
        ],
      },
      { status: 404 }
    )
  },
}
