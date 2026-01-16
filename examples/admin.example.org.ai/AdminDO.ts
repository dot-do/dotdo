/**
 * AdminDO - Admin Durable Object for schema and function management
 *
 * This Durable Object exposes:
 * - Schema definitions via $schemas namespace for introspection
 * - Introspection methods via $meta namespace
 * - Function CRUD operations via functions namespace
 * - WebSocket hibernation support for RPC connections (via / or /rpc endpoints)
 *
 * WebSocket Protocol:
 * - Connect to / or /rpc with Upgrade: websocket header
 * - Receive: {"type": "connected", "clientId": "uuid", "timestamp": 123}
 * - Send: {"type": "call", "id": "uuid", "method": "functions.list", "args": []}
 * - Receive: {"type": "return", "id": "uuid", "value": [...]}
 * - Or error: {"type": "error", "id": "uuid", "error": "...", "code": "..."}
 *
 * Methods exposed via $schemas namespace:
 * - $schemas.list() - returns array of all schema names
 * - $schemas.get(name) - returns specific schema by name
 * - $schemas.nouns() - returns noun schema definition
 * - $schemas.verbs() - returns verb schema definition
 * - $schemas.things() - returns thing schema definition
 * - $schemas.events() - returns event schema definition
 * - $schemas.actions() - returns action schema definition
 * - $schemas.relationships() - returns relationship schema definition
 * - $schemas.functions() - returns function schema definition
 * - $schemas.workflows() - returns workflow schema definition
 *
 * Methods exposed via $meta namespace:
 * - $meta.version() - returns AdminDO version string
 * - $meta.schema() - returns full AdminDO schema definition
 * - $meta.methods() - returns array of available method definitions
 * - $meta.capabilities() - returns object with capability flags
 *
 * Methods exposed via functions namespace:
 * - functions.list(options?) - returns array of function definitions
 * - functions.get(id) - returns specific function by ID or null
 * - functions.create(params) - creates new function definition
 * - functions.update(id, params) - updates function
 * - functions.delete(id) - deletes function
 * - functions.execute(id, inputs) - placeholder for future execution
 *
 * @module AdminDO
 * @see do-y9iv: [GREEN] Implement $.functions access
 * @see do-k6f7: admin.example.org.ai - MDXUI Admin Integration (parent epic)
 */

import { DurableObject } from 'cloudflare:workers'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  zodToJson,
  SCHEMA_NAMES,
  SCHEMAS,
  type SchemaName,
  type JsonSchema,
  type JsonSchemaField,
  FunctionTypeSchema,
  type FunctionType,
} from './schemas'
import { DrizzleAdapter, type ListOptions } from './db'
import type {
  Noun,
  NewNoun,
  Verb,
  NewVerb,
  Action,
  NewAction,
  Relationship,
  NewRelationship,
  Function as FunctionRecord,
  NewFunction,
} from './db'
import type {
  ReturnMessage,
  ErrorMessage,
} from '../../rpc/broker-protocol'

// ============================================================================
// CORS Support
// ============================================================================

/**
 * Generate CORS headers for browser clients
 * @param origin - The origin to allow, defaults to '*' (all origins)
 * @returns Headers object with CORS configuration
 */
export function corsHeaders(origin?: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  }
}

/**
 * Create a Response with CORS headers applied
 * @param response - The original response
 * @param origin - Optional origin for CORS header
 * @returns Response with CORS headers added
 */
function withCors(response: Response, origin?: string): Response {
  const headers = new Headers(response.headers)
  const cors = corsHeaders(origin)
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Create a preflight OPTIONS response
 * @param origin - Optional origin for CORS header
 * @returns 204 No Content response with CORS headers
 */
function preflightResponse(origin?: string): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  })
}

// ============================================================================
// Types
// ============================================================================

export interface AdminDOEnv {
  AdminDO: DurableObjectNamespace<AdminDO>
}

/**
 * Input/Output schema definition for functions
 */
interface IOSchema {
  name: string
  type: string
  description?: string
  required?: boolean
}

/**
 * Function definition stored in and returned from DB
 */
export interface FunctionDefinition {
  id: string
  name: string
  description?: string
  type: FunctionType
  inputs: IOSchema[]
  outputs: IOSchema[]
  code?: string
  model?: string
  prompt?: string
  goal?: string
  tools?: string[]
  channel?: string
  actions?: string[]
  temperature?: number
  maxTokens?: number
  maxIterations?: number
  systemPrompt?: string
  timeout?: number
  createdAt?: string
  updatedAt?: string
}

/**
 * Parameters for creating a function
 */
export interface CreateFunctionParams {
  name: string
  description?: string
  type?: FunctionType
  inputs?: IOSchema[]
  outputs?: IOSchema[]
  code?: string
  model?: string
  prompt?: string
  goal?: string
  tools?: string[]
  channel?: string
  actions?: string[]
  temperature?: number
  maxTokens?: number
  maxIterations?: number
  systemPrompt?: string
  timeout?: number
}

/**
 * Options for listing functions
 */
export interface ListFunctionsOptions {
  type?: FunctionType
  limit?: number
  offset?: number
}

// ============================================================================
// WebSocket RPC Types (local to AdminDO, no target routing)
// ============================================================================

/**
 * Local RPC call message (no target - AdminDO handles it locally)
 * Compatible with broker-protocol but without target field
 */
export interface LocalCallMessage {
  /** Unique message ID for request/response correlation */
  id: string
  /** Message type discriminator */
  type: 'call'
  /** Method name to invoke (e.g., "functions.list", "schemas.get") */
  method: string
  /** Arguments to pass to the method */
  args: unknown[]
}

/**
 * Type guard for LocalCallMessage
 */
function isLocalCallMessage(msg: unknown): msg is LocalCallMessage {
  if (typeof msg !== 'object' || msg === null) {
    return false
  }
  const m = msg as Record<string, unknown>
  return (
    m.type === 'call' &&
    typeof m.id === 'string' &&
    typeof m.method === 'string' &&
    Array.isArray(m.args)
  )
}

/**
 * In-flight request tracking entry for hibernation recovery
 */
interface InFlightRequest {
  clientId: string
  method: string
  args: string // JSON-serialized
  startedAt: number
}

// ============================================================================
// Error Sanitization
// ============================================================================

/**
 * Sanitize errors for production responses - removes stack traces and internal paths
 */
function sanitizeError(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    // Check for known error types with code property
    if ('code' in error) {
      return {
        code: (error as { code: string }).code,
        message: error.message
      }
    }
    // Zod validation errors
    if (error.name === 'ZodError') {
      return {
        code: 'VALIDATION_ERROR',
        message: error.message
      }
    }
    return {
      code: 'RPC_ERROR',
      message: error.message
    }
  }
  return {
    code: 'UNKNOWN_ERROR',
    message: String(error)
  }
}

// ============================================================================
// Validation Schemas
// ============================================================================

/**
 * IO Schema validation
 */
const IOSchemaSchema = z.object({
  name: z.string().min(1, 'Input/output name is required'),
  type: z.string().min(1, 'Input/output type is required'),
  description: z.string().optional(),
  required: z.boolean().optional(),
})

/**
 * Create function params validation
 */
const CreateFunctionParamsSchema = z.object({
  name: z.string().min(1, 'name is required'),
  description: z.string().optional(),
  type: FunctionTypeSchema.optional().default('code'),
  inputs: z.array(IOSchemaSchema).optional().default([]),
  outputs: z.array(IOSchemaSchema).optional().default([]),
  code: z.string().optional(),
  model: z.string().optional(),
  prompt: z.string().optional(),
  goal: z.string().optional(),
  tools: z.array(z.string()).optional(),
  channel: z.string().optional(),
  actions: z.array(z.string()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  maxIterations: z.number().int().positive().optional(),
  systemPrompt: z.string().optional(),
  timeout: z.number().int().positive().optional(),
})

/**
 * Update function params validation (all fields optional)
 */
const UpdateFunctionParamsSchema = CreateFunctionParamsSchema.partial()

// ============================================================================
// FunctionsAccessor - RPC-accessible functions API
// ============================================================================

/**
 * FunctionsAccessor provides $.functions API for AdminDO
 *
 * Exposes CRUD methods for function definitions:
 * - list(options?) - List all functions with optional filtering
 * - get(id) - Get a specific function by ID
 * - create(params) - Create a new function
 * - update(id, params) - Update an existing function
 * - delete(id) - Delete a function
 * - execute(id, inputs) - Placeholder for future execution
 */
export class FunctionsAccessor {
  constructor(private sql: SqlStorage) {}

  /**
   * List all function definitions with optional filtering
   */
  async list(options?: ListFunctionsOptions): Promise<FunctionDefinition[]> {
    let query = 'SELECT * FROM functions'
    const params: unknown[] = []
    const conditions: string[] = []

    if (options?.type) {
      conditions.push('type = ?')
      params.push(options.type)
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    query += ' ORDER BY created_at DESC'

    if (options?.limit) {
      query += ' LIMIT ?'
      params.push(options.limit)
    }

    if (options?.offset) {
      query += ' OFFSET ?'
      params.push(options.offset)
    }

    const rows = this.sql.exec(query, ...params).toArray()
    return rows.map((row) => this.rowToFunction(row))
  }

  /**
   * Get a specific function by ID
   */
  async get(id: string): Promise<FunctionDefinition | null> {
    const rows = this.sql.exec('SELECT * FROM functions WHERE id = ?', id).toArray()
    if (rows.length === 0) {
      return null
    }
    return this.rowToFunction(rows[0])
  }

  /**
   * Create a new function definition
   */
  async create(params: CreateFunctionParams): Promise<FunctionDefinition> {
    // Validate input
    const result = CreateFunctionParamsSchema.safeParse(params)
    if (!result.success) {
      const firstError = result.error.errors[0]
      throw new Error(`Validation error: ${firstError.path.join('.')} - ${firstError.message}`)
    }

    const validated = result.data

    // Validate type-specific requirements
    this.validateTypeSpecificFields(validated)

    const id = `fn_${crypto.randomUUID().slice(0, 12)}`
    const now = new Date().toISOString()

    this.sql.exec(
      `INSERT INTO functions (
        id, name, type, description, code, model, prompt, goal, tools,
        channel, actions, temperature, max_tokens, max_iterations,
        system_prompt, timeout, inputs, outputs, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      validated.name,
      validated.type,
      validated.description ?? null,
      validated.code ?? null,
      validated.model ?? null,
      validated.prompt ?? null,
      validated.goal ?? null,
      validated.tools ? JSON.stringify(validated.tools) : null,
      validated.channel ?? null,
      validated.actions ? JSON.stringify(validated.actions) : null,
      validated.temperature ?? null,
      validated.maxTokens ?? null,
      validated.maxIterations ?? null,
      validated.systemPrompt ?? null,
      validated.timeout ?? null,
      JSON.stringify(validated.inputs ?? []),
      JSON.stringify(validated.outputs ?? []),
      now,
      now
    )

    return (await this.get(id))!
  }

  /**
   * Update an existing function
   */
  async update(id: string, params: Partial<CreateFunctionParams>): Promise<FunctionDefinition> {
    // Check if function exists
    const existing = await this.get(id)
    if (!existing) {
      throw new Error(`Function not found: ${id}`)
    }

    // Validate input
    const result = UpdateFunctionParamsSchema.safeParse(params)
    if (!result.success) {
      const firstError = result.error.errors[0]
      throw new Error(`Validation error: ${firstError.path.join('.')} - ${firstError.message}`)
    }

    const validated = result.data
    const now = new Date().toISOString()

    // Build update query dynamically
    const updates: string[] = ['updated_at = ?']
    const updateParams: unknown[] = [now]

    if (validated.name !== undefined) {
      updates.push('name = ?')
      updateParams.push(validated.name)
    }
    if (validated.type !== undefined) {
      // Validate type
      const typeResult = FunctionTypeSchema.safeParse(validated.type)
      if (!typeResult.success) {
        throw new Error(`Invalid type: type must be one of 'code', 'generative', 'agentic', 'human'`)
      }
      updates.push('type = ?')
      updateParams.push(validated.type)
    }
    if (validated.description !== undefined) {
      updates.push('description = ?')
      updateParams.push(validated.description)
    }
    if (validated.code !== undefined) {
      updates.push('code = ?')
      updateParams.push(validated.code)
    }
    if (validated.model !== undefined) {
      updates.push('model = ?')
      updateParams.push(validated.model)
    }
    if (validated.prompt !== undefined) {
      updates.push('prompt = ?')
      updateParams.push(validated.prompt)
    }
    if (validated.goal !== undefined) {
      updates.push('goal = ?')
      updateParams.push(validated.goal)
    }
    if (validated.tools !== undefined) {
      updates.push('tools = ?')
      updateParams.push(JSON.stringify(validated.tools))
    }
    if (validated.channel !== undefined) {
      updates.push('channel = ?')
      updateParams.push(validated.channel)
    }
    if (validated.actions !== undefined) {
      updates.push('actions = ?')
      updateParams.push(JSON.stringify(validated.actions))
    }
    if (validated.temperature !== undefined) {
      updates.push('temperature = ?')
      updateParams.push(validated.temperature)
    }
    if (validated.maxTokens !== undefined) {
      updates.push('max_tokens = ?')
      updateParams.push(validated.maxTokens)
    }
    if (validated.maxIterations !== undefined) {
      updates.push('max_iterations = ?')
      updateParams.push(validated.maxIterations)
    }
    if (validated.systemPrompt !== undefined) {
      updates.push('system_prompt = ?')
      updateParams.push(validated.systemPrompt)
    }
    if (validated.timeout !== undefined) {
      updates.push('timeout = ?')
      updateParams.push(validated.timeout)
    }
    if (validated.inputs !== undefined) {
      updates.push('inputs = ?')
      updateParams.push(JSON.stringify(validated.inputs))
    }
    if (validated.outputs !== undefined) {
      updates.push('outputs = ?')
      updateParams.push(JSON.stringify(validated.outputs))
    }

    updateParams.push(id)

    this.sql.exec(
      `UPDATE functions SET ${updates.join(', ')} WHERE id = ?`,
      ...updateParams
    )

    return (await this.get(id))!
  }

  /**
   * Delete a function
   */
  async delete(id: string): Promise<boolean> {
    const existing = await this.get(id)
    if (!existing) {
      return false
    }

    this.sql.exec('DELETE FROM functions WHERE id = ?', id)
    return true
  }

  /**
   * Execute a function (placeholder for future implementation)
   */
  async execute(id: string, inputs: Record<string, unknown>): Promise<{ status: string; result?: unknown }> {
    const fn = await this.get(id)
    if (!fn) {
      throw new Error(`Function not found: ${id}`)
    }

    // Placeholder - actual execution would depend on function type
    return {
      status: 'not_implemented',
      result: { message: `Execution of ${fn.type} functions not yet implemented` },
    }
  }

  /**
   * Convert database row to FunctionDefinition
   */
  private rowToFunction(row: Record<string, unknown>): FunctionDefinition {
    return {
      id: row.id as string,
      name: row.name as string,
      type: row.type as FunctionType,
      description: row.description as string | undefined,
      code: row.code as string | undefined,
      model: row.model as string | undefined,
      prompt: row.prompt as string | undefined,
      goal: row.goal as string | undefined,
      tools: row.tools ? JSON.parse(row.tools as string) : undefined,
      channel: row.channel as string | undefined,
      actions: row.actions ? JSON.parse(row.actions as string) : undefined,
      temperature: row.temperature as number | undefined,
      maxTokens: row.max_tokens as number | undefined,
      maxIterations: row.max_iterations as number | undefined,
      systemPrompt: row.system_prompt as string | undefined,
      timeout: row.timeout as number | undefined,
      inputs: row.inputs ? JSON.parse(row.inputs as string) : [],
      outputs: row.outputs ? JSON.parse(row.outputs as string) : [],
      createdAt: row.created_at as string | undefined,
      updatedAt: row.updated_at as string | undefined,
    }
  }

  /**
   * Validate type-specific fields
   */
  private validateTypeSpecificFields(params: z.infer<typeof CreateFunctionParamsSchema>): void {
    // Validate type
    const typeResult = FunctionTypeSchema.safeParse(params.type)
    if (!typeResult.success) {
      throw new Error(`Invalid type: type must be one of 'code', 'generative', 'agentic', 'human'`)
    }

    // Type-specific validation could be added here
    // For now, we allow flexible creation with optional fields
  }
}

// ============================================================================
// MetaAccessor - RPC-accessible introspection API
// ============================================================================

/**
 * MetaAccessor provides $meta API for AdminDO introspection
 *
 * Exposes introspection methods:
 * - version() - Get the AdminDO version
 * - schema() - Get the full schema definition
 * - methods() - List all available methods
 * - capabilities() - Get capability flags
 */
export class MetaAccessor {
  /**
   * Get the AdminDO version
   * @returns Version string
   */
  version(): string {
    return '1.0.0'
  }

  /**
   * Get the full schema definition for AdminDO
   * @returns Schema object with name, version, methods, and description
   */
  schema(): object {
    return {
      name: 'AdminDO',
      version: '1.0.0',
      methods: ['ping', '$schemas.*', '$meta.*', 'drizzle.*', 'functions.*'],
      description: 'Admin API for mdxui integration',
    }
  }

  /**
   * List all available methods with descriptions
   * @returns Array of method definitions
   */
  methods(): object[] {
    return [
      { name: 'ping', description: 'Health check' },
      { name: '$schemas.list', description: 'List all schema names' },
      { name: '$schemas.get', description: 'Get schema by name' },
      { name: '$meta.version', description: 'Get AdminDO version' },
      { name: '$meta.schema', description: 'Get full AdminDO schema' },
      { name: '$meta.methods', description: 'List all available methods' },
      { name: '$meta.capabilities', description: 'Get capability flags' },
      { name: 'drizzle.nouns.*', description: 'Noun CRUD operations' },
      { name: 'drizzle.verbs.*', description: 'Verb CRUD operations' },
      { name: 'drizzle.actions.*', description: 'Action CRUD operations' },
      { name: 'drizzle.relationships.*', description: 'Relationship CRUD operations' },
      { name: 'drizzle.functions.*', description: 'Function CRUD operations (via drizzle)' },
      { name: 'functions.*', description: 'Function CRUD operations' },
    ]
  }

  /**
   * Get capability flags indicating what features are available
   * @returns Capability object
   */
  capabilities(): object {
    return {
      schemas: true,
      meta: true,
      drizzle: true,
      functions: true,
      execute: false, // not yet implemented
    }
  }
}

// ============================================================================
// SchemasAccessor
// ============================================================================

/**
 * $schemas RPC interface - exposes schema methods
 *
 * This class is used as an RPC target for schema introspection.
 * Methods return JSON-serializable representations of Zod schemas.
 */
export class SchemasAccessor {
  /**
   * List all available schema names
   * @returns Array of schema names
   */
  list(): readonly string[] {
    return SCHEMA_NAMES
  }

  /**
   * Get a specific schema by name
   * @param name The schema name (e.g., 'Noun', 'Verb', 'Thing')
   * @returns JSON-serializable schema representation, or null if not found
   */
  get(name: string): JsonSchema | JsonSchemaField | null {
    if (!SCHEMA_NAMES.includes(name as SchemaName)) {
      return null
    }
    const schema = SCHEMAS[name as SchemaName]
    return zodToJson(schema, `${name} schema`)
  }

  /**
   * Get the Noun schema definition
   * @returns JSON-serializable Noun schema
   */
  nouns(): JsonSchema | JsonSchemaField {
    return zodToJson(SCHEMAS.Noun, 'Noun schema - Type registry for entity types')
  }

  /**
   * Get the Verb schema definition
   * @returns JSON-serializable Verb schema
   */
  verbs(): JsonSchema | JsonSchemaField {
    return zodToJson(SCHEMAS.Verb, 'Verb schema - Predicate registry for actions')
  }

  /**
   * Get the Thing schema definition
   * @returns JSON-serializable Thing schema
   */
  things(): JsonSchema | JsonSchemaField {
    return zodToJson(SCHEMAS.Thing, 'Thing schema - Versioned entity storage')
  }

  /**
   * Get the Event schema definition
   * @returns JSON-serializable Event schema
   */
  events(): JsonSchema | JsonSchemaField {
    return zodToJson(SCHEMAS.Event, 'Event schema - 5W+H event model')
  }

  /**
   * Get the Action schema definition
   * @returns JSON-serializable Action schema
   */
  actions(): JsonSchema | JsonSchemaField {
    return zodToJson(SCHEMAS.Action, 'Action schema - Command log entries')
  }

  /**
   * Get the Relationship schema definition
   * @returns JSON-serializable Relationship schema
   */
  relationships(): JsonSchema | JsonSchemaField {
    return zodToJson(SCHEMAS.Relationship, 'Relationship schema - Graph edges between entities')
  }

  /**
   * Get the Function schema definition
   * @returns JSON-serializable Function schema
   */
  functions(): JsonSchema | JsonSchemaField {
    return zodToJson(SCHEMAS.Function, 'Function schema - Four implementation types')
  }

  /**
   * Get the Workflow schema definition
   * @returns JSON-serializable Workflow schema
   */
  workflows(): JsonSchema | JsonSchemaField {
    return zodToJson(SCHEMAS.Workflow, 'Workflow schema - Durable execution flows')
  }
}

// ============================================================================
// DrizzleRPC Interface
// ============================================================================

/**
 * RPC-compatible table accessor that wraps the DrizzleAdapter accessors
 */
interface RPCTableAccessor<T, CreateT = Partial<T>> {
  list(options?: ListOptions<T>): T[]
  get(id: string): T | null
  create(data: CreateT): T
  update(id: string, data: Partial<T>): T
  delete(id: string): boolean
  count(where?: Partial<T>): number
}

/**
 * Drizzle RPC interface exposed via $.drizzle
 */
interface DrizzleRPC {
  nouns: RPCTableAccessor<Noun, NewNoun>
  verbs: RPCTableAccessor<Verb, NewVerb>
  actions: RPCTableAccessor<Action, NewAction>
  relationships: RPCTableAccessor<Relationship, NewRelationship>
  functions: RPCTableAccessor<FunctionRecord, NewFunction>
}

// ============================================================================
// AdminDO Class
// ============================================================================

/**
 * AdminDO - Durable Object for admin schema introspection and function management
 *
 * Extends DurableObject to provide:
 * - SQLite storage for admin state and functions
 * - Hono routing for HTTP endpoints
 * - RPC methods via class methods
 * - $schemas namespace for schema introspection
 * - functions namespace for function CRUD operations
 * - drizzle namespace for drizzle-based CRUD operations
 */
export class AdminDO extends DurableObject<AdminDOEnv> {
  private app: Hono
  private schemasAccessor: SchemasAccessor
  private metaAccessor: MetaAccessor
  private functionsAccessor: FunctionsAccessor
  private drizzleAdapter: DrizzleAdapter

  constructor(ctx: DurableObjectState, env: AdminDOEnv) {
    super(ctx, env)

    // Initialize SQLite table for admin state (if needed)
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS admin_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      )
    `)

    // Initialize functions table
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS functions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('code', 'generative', 'agentic', 'human')),
        description TEXT,
        code TEXT,
        model TEXT,
        prompt TEXT,
        goal TEXT,
        tools TEXT,
        channel TEXT,
        actions TEXT,
        temperature REAL,
        max_tokens INTEGER,
        max_iterations INTEGER,
        system_prompt TEXT,
        timeout INTEGER,
        inputs TEXT DEFAULT '[]',
        outputs TEXT DEFAULT '[]',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Create indexes for functions table
    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_functions_type ON functions(type)
    `)
    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_functions_name ON functions(name)
    `)

    // Initialize in-flight requests table for WebSocket hibernation recovery
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS rpc_in_flight (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        method TEXT NOT NULL,
        args TEXT NOT NULL,
        started_at INTEGER NOT NULL
      )
    `)
    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_rpc_in_flight_client ON rpc_in_flight(client_id)
    `)

    // Initialize accessors
    this.schemasAccessor = new SchemasAccessor()
    this.metaAccessor = new MetaAccessor()
    this.functionsAccessor = new FunctionsAccessor(this.ctx.storage.sql)
    this.drizzleAdapter = new DrizzleAdapter(this.ctx.storage.sql)

    // Seed initial data for drizzle tables
    this.seedDrizzleData()

    // Set up Hono router
    this.app = new Hono()
    this.registerRoutes()
  }

  /**
   * Seed initial data for drizzle tables (nouns and verbs)
   */
  private seedDrizzleData(): void {
    // Check if already seeded
    const existingNouns = this.drizzleAdapter.nouns.count()
    if (existingNouns > 0) return

    // Seed common nouns
    const commonNouns: NewNoun[] = [
      { noun: 'Customer', plural: 'Customers', description: 'Customer entity', storage: 'hot' },
      { noun: 'Order', plural: 'Orders', description: 'Order entity', storage: 'hot' },
      { noun: 'Product', plural: 'Products', description: 'Product entity', storage: 'hot' },
      { noun: 'User', plural: 'Users', description: 'User entity', storage: 'hot' },
      { noun: 'Agent', plural: 'Agents', description: 'AI Agent entity', storage: 'hot' },
    ]

    for (const noun of commonNouns) {
      try {
        this.drizzleAdapter.nouns.create(noun)
      } catch {
        // Ignore duplicate errors
      }
    }

    // Seed common verbs
    const commonVerbs: NewVerb[] = [
      { verb: 'creates', action: 'create', activity: 'creating', event: 'created', reverse: 'createdBy', inverse: 'deletes' },
      { verb: 'updates', action: 'update', activity: 'updating', event: 'updated', reverse: 'updatedBy' },
      { verb: 'deletes', action: 'delete', activity: 'deleting', event: 'deleted', reverse: 'deletedBy', inverse: 'creates' },
      { verb: 'owns', action: 'own', activity: 'owning', event: 'owned', reverse: 'ownedBy' },
      { verb: 'manages', action: 'manage', activity: 'managing', event: 'managed', reverse: 'managedBy' },
      { verb: 'belongs', action: 'belong', activity: 'belonging', event: 'belonged', reverse: 'has' },
    ]

    for (const verb of commonVerbs) {
      try {
        this.drizzleAdapter.verbs.create(verb)
      } catch {
        // Ignore duplicate errors
      }
    }
  }

  // =========================================================================
  // $schemas RPC Accessor
  // =========================================================================

  /**
   * RPC accessor for schema introspection
   *
   * Usage via RPC:
   *   const stub = env.AdminDO.get(id)
   *   const schemas = await stub.$schemas.list()
   *   const nounSchema = await stub.$schemas.nouns()
   *   const eventSchema = await stub.$schemas.get('Event')
   */
  get $schemas(): SchemasAccessor {
    return this.schemasAccessor
  }

  // =========================================================================
  // $meta RPC Accessor
  // =========================================================================

  /**
   * RPC accessor for AdminDO introspection
   *
   * Usage via RPC:
   *   const stub = env.AdminDO.get(id)
   *   const version = await stub.$meta.version()
   *   const schema = await stub.$meta.schema()
   *   const methods = await stub.$meta.methods()
   *   const caps = await stub.$meta.capabilities()
   */
  get $meta(): MetaAccessor {
    return this.metaAccessor
  }

  // =========================================================================
  // functions RPC Accessor
  // =========================================================================

  /**
   * RPC accessor for function CRUD operations
   *
   * Usage via RPC:
   *   const stub = env.AdminDO.get(id)
   *   const fns = await stub.functions.list()
   *   const fn = await stub.functions.get('fn_123')
   *   const newFn = await stub.functions.create({ name: 'myFn', type: 'code' })
   *   const updatedFn = await stub.functions.update('fn_123', { description: 'Updated' })
   *   const deleted = await stub.functions.delete('fn_123')
   */
  get functions(): FunctionsAccessor {
    return this.functionsAccessor
  }

  // =========================================================================
  // drizzle RPC Accessor
  // =========================================================================

  /**
   * RPC accessor for drizzle-based CRUD operations
   *
   * Usage via RPC:
   *   const stub = env.AdminDO.get(id)
   *   const nouns = await stub.drizzle.nouns.list()
   *   const verbs = await stub.drizzle.verbs.get('creates')
   *   const actions = await stub.drizzle.actions.create({ verb: 'create', target: 'Customer/1' })
   *   const relationships = await stub.drizzle.relationships.count()
   *   const fns = await stub.drizzle.functions.list()
   */
  get drizzle(): DrizzleRPC {
    return {
      nouns: {
        list: (options?: ListOptions<Noun>) => this.drizzleAdapter.nouns.list(options),
        get: (id: string) => this.drizzleAdapter.nouns.get(id),
        create: (data: NewNoun) => this.drizzleAdapter.nouns.create(data),
        update: (id: string, data: Partial<Noun>) => this.drizzleAdapter.nouns.update(id, data),
        delete: (id: string) => this.drizzleAdapter.nouns.delete(id),
        count: (where?: Partial<Noun>) => this.drizzleAdapter.nouns.count(where),
      },
      verbs: {
        list: (options?: ListOptions<Verb>) => this.drizzleAdapter.verbs.list(options),
        get: (id: string) => this.drizzleAdapter.verbs.get(id),
        create: (data: NewVerb) => this.drizzleAdapter.verbs.create(data),
        update: (id: string, data: Partial<Verb>) => this.drizzleAdapter.verbs.update(id, data),
        delete: (id: string) => this.drizzleAdapter.verbs.delete(id),
        count: (where?: Partial<Verb>) => this.drizzleAdapter.verbs.count(where),
      },
      actions: {
        list: (options?: ListOptions<Action>) => this.drizzleAdapter.actions.list(options),
        get: (id: string) => this.drizzleAdapter.actions.get(id),
        create: (data: NewAction) => this.drizzleAdapter.actions.create(data),
        update: (id: string, data: Partial<Action>) => this.drizzleAdapter.actions.update(id, data),
        delete: (id: string) => this.drizzleAdapter.actions.delete(id),
        count: (where?: Partial<Action>) => this.drizzleAdapter.actions.count(where),
      },
      relationships: {
        list: (options?: ListOptions<Relationship>) => this.drizzleAdapter.relationships.list(options),
        get: (id: string) => this.drizzleAdapter.relationships.get(id),
        create: (data: NewRelationship) => this.drizzleAdapter.relationships.create(data),
        update: (id: string, data: Partial<Relationship>) => this.drizzleAdapter.relationships.update(id, data),
        delete: (id: string) => this.drizzleAdapter.relationships.delete(id),
        count: (where?: Partial<Relationship>) => this.drizzleAdapter.relationships.count(where),
      },
      functions: {
        list: (options?: ListOptions<FunctionRecord>) => this.drizzleAdapter.functions.list(options),
        get: (id: string) => this.drizzleAdapter.functions.get(id),
        create: (data: NewFunction) => this.drizzleAdapter.functions.create(data),
        update: (id: string, data: Partial<FunctionRecord>) => this.drizzleAdapter.functions.update(id, data),
        delete: (id: string) => this.drizzleAdapter.functions.delete(id),
        count: (where?: Partial<FunctionRecord>) => this.drizzleAdapter.functions.count(where),
      },
    }
  }

  // =========================================================================
  // HTTP Routes
  // =========================================================================

  private registerRoutes(): void {
    // Root index - API discovery
    this.app.get('/', (c) => {
      const baseUrl = new URL(c.req.url).origin
      return c.json({
        name: 'AdminDO',
        version: '1.0.0',
        description: 'Admin API for mdxui integration',
        links: {
          self: baseUrl,
          health: `${baseUrl}/health`,
          rpc: `${baseUrl}/rpc`,
          schemas: `${baseUrl}/schemas`,
          nouns: `${baseUrl}/nouns`,
          verbs: `${baseUrl}/verbs`,
          actions: `${baseUrl}/actions`,
          functions: `${baseUrl}/functions`,
        },
        endpoints: {
          rpc: {
            method: 'POST',
            path: '/rpc',
            description: 'RPC endpoint for method calls',
            example: { method: 'schemas.list', args: [] },
          },
          rest: {
            schemas: { GET: '/schemas', description: 'List all schema names' },
            nouns: { GET: '/nouns', POST: '/nouns', description: 'CRUD operations' },
            verbs: { GET: '/verbs', POST: '/verbs', description: 'CRUD operations' },
            actions: { GET: '/actions', POST: '/actions', description: 'CRUD operations' },
            functions: { GET: '/functions', POST: '/functions', description: 'CRUD operations' },
          },
        },
      })
    })

    // Health check
    this.app.get('/health', (c) => {
      return c.json({ status: 'healthy', service: 'AdminDO' })
    })

    // RPC handler function - shared by /rpc and / endpoints
    const rpcHandler = async (c: import('hono').Context): Promise<Response> => {
      let body: { method: string; args?: unknown[] }
      try {
        body = await c.req.json()
      } catch {
        return c.json(
          {
            error: {
              code: 'PARSE_ERROR',
              message: 'Invalid JSON in request body',
            },
          },
          400
        )
      }

      try {
        const { method, args = [] } = body

        if (!method) {
          return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Method is required' } }, 400)
        }

        const result = await this.executeMethod(method, args)
        return c.json({ result })
      } catch (error) {
        // Check if it's a method not found error
        if (error instanceof Error && error.message.includes('not found')) {
          return c.json({ error: sanitizeError(error) }, 404)
        }
        return c.json({ error: sanitizeError(error) }, 500)
      }
    }

    // RPC endpoint - handles method calls via dynamic reflection
    this.app.post('/rpc', rpcHandler)

    // POST / as an alias for /rpc
    this.app.post('/', rpcHandler)

    // List all schemas
    this.app.get('/schemas', (c) => {
      return c.json({
        schemas: this.schemasAccessor.list(),
        count: this.schemasAccessor.list().length,
      })
    })

    // Get specific schema
    this.app.get('/schemas/:name', (c) => {
      const name = c.req.param('name')
      const schema = this.schemasAccessor.get(name)

      if (!schema) {
        return c.json({ error: { code: 'METHOD_NOT_FOUND', message: `Schema '${name}' not found` } }, 404)
      }

      return c.json({ name, schema })
    })

    // Get all schemas at once
    this.app.get('/schemas/all', (c) => {
      const all: Record<string, JsonSchema | JsonSchemaField> = {}
      for (const name of SCHEMA_NAMES) {
        all[name] = zodToJson(SCHEMAS[name], `${name} schema`)
      }
      return c.json(all)
    })

    // =========================================================================
    // REST Endpoints for Collections
    // =========================================================================

    // Nouns REST
    this.app.get('/nouns', async (c) => {
      const result = await this.drizzleAdapter.nouns.list()
      return c.json({ data: result, count: result.length })
    })
    this.app.get('/nouns/:id', async (c) => {
      const result = await this.drizzleAdapter.nouns.get(c.req.param('id'))
      if (!result) return c.json({ error: { code: 'NOT_FOUND', message: 'Noun not found' } }, 404)
      return c.json({ data: result })
    })
    this.app.post('/nouns', async (c) => {
      const body = await c.req.json()
      const result = await this.drizzleAdapter.nouns.create(body)
      return c.json({ data: result }, 201)
    })
    this.app.put('/nouns/:id', async (c) => {
      const body = await c.req.json()
      const result = await this.drizzleAdapter.nouns.update(c.req.param('id'), body)
      if (!result) return c.json({ error: { code: 'NOT_FOUND', message: 'Noun not found' } }, 404)
      return c.json({ data: result })
    })
    this.app.delete('/nouns/:id', async (c) => {
      const result = await this.drizzleAdapter.nouns.delete(c.req.param('id'))
      return c.json({ deleted: result })
    })

    // Verbs REST
    this.app.get('/verbs', async (c) => {
      const result = await this.drizzleAdapter.verbs.list()
      return c.json({ data: result, count: result.length })
    })
    this.app.get('/verbs/:id', async (c) => {
      const result = await this.drizzleAdapter.verbs.get(c.req.param('id'))
      if (!result) return c.json({ error: { code: 'NOT_FOUND', message: 'Verb not found' } }, 404)
      return c.json({ data: result })
    })
    this.app.post('/verbs', async (c) => {
      const body = await c.req.json()
      const result = await this.drizzleAdapter.verbs.create(body)
      return c.json({ data: result }, 201)
    })
    this.app.put('/verbs/:id', async (c) => {
      const body = await c.req.json()
      const result = await this.drizzleAdapter.verbs.update(c.req.param('id'), body)
      if (!result) return c.json({ error: { code: 'NOT_FOUND', message: 'Verb not found' } }, 404)
      return c.json({ data: result })
    })
    this.app.delete('/verbs/:id', async (c) => {
      const result = await this.drizzleAdapter.verbs.delete(c.req.param('id'))
      return c.json({ deleted: result })
    })

    // Actions REST
    this.app.get('/actions', async (c) => {
      const result = await this.drizzleAdapter.actions.list()
      return c.json({ data: result, count: result.length })
    })
    this.app.get('/actions/:id', async (c) => {
      const result = await this.drizzleAdapter.actions.get(c.req.param('id'))
      if (!result) return c.json({ error: { code: 'NOT_FOUND', message: 'Action not found' } }, 404)
      return c.json({ data: result })
    })
    this.app.post('/actions', async (c) => {
      const body = await c.req.json()
      const result = await this.drizzleAdapter.actions.create(body)
      return c.json({ data: result }, 201)
    })
    this.app.delete('/actions/:id', async (c) => {
      const result = await this.drizzleAdapter.actions.delete(c.req.param('id'))
      return c.json({ deleted: result })
    })

    // Functions REST
    this.app.get('/functions', async (c) => {
      const result = await this.functionsAccessor.list()
      return c.json({ data: result, count: result.length })
    })
    this.app.get('/functions/:id', async (c) => {
      const result = await this.functionsAccessor.get(c.req.param('id'))
      if (!result) return c.json({ error: { code: 'NOT_FOUND', message: 'Function not found' } }, 404)
      return c.json({ data: result })
    })
    this.app.post('/functions', async (c) => {
      const body = await c.req.json()
      const result = await this.functionsAccessor.create(body)
      return c.json({ data: result }, 201)
    })
    this.app.put('/functions/:id', async (c) => {
      const body = await c.req.json()
      const result = await this.functionsAccessor.update(c.req.param('id'), body)
      if (!result) return c.json({ error: { code: 'NOT_FOUND', message: 'Function not found' } }, 404)
      return c.json({ data: result })
    })
    this.app.delete('/functions/:id', async (c) => {
      const result = await this.functionsAccessor.delete(c.req.param('id'))
      return c.json({ deleted: result })
    })
  }

  // =========================================================================
  // Fetch Handler
  // =========================================================================

  async fetch(request: Request): Promise<Response> {
    // Extract origin from request for CORS
    const origin = request.headers.get('Origin') || undefined

    // Handle OPTIONS preflight requests
    if (request.method === 'OPTIONS') {
      return preflightResponse(origin)
    }

    // Check for WebSocket upgrade on / or /rpc
    const url = new URL(request.url)
    const upgradeHeader = request.headers.get('Upgrade')

    if (upgradeHeader === 'websocket' && (url.pathname === '/' || url.pathname === '/rpc')) {
      return this.handleWebSocketUpgrade()
    }

    // Process the request through Hono and apply CORS headers to response
    const response = await this.app.fetch(request)
    return withCors(response, origin)
  }

  /**
   * Handle WebSocket upgrade request for RPC connections
   * Uses Cloudflare's hibernatable WebSocket API for cost efficiency
   */
  private handleWebSocketUpgrade(): Response {
    // Create WebSocket pair
    const [client, server] = Object.values(new WebSocketPair())

    // Generate client ID for tracking
    const clientId = crypto.randomUUID()

    // Accept the WebSocket with hibernation support and tag with client ID
    this.ctx.acceptWebSocket(server, [`client:${clientId}`])

    // Send connected acknowledgment
    server.send(
      JSON.stringify({
        type: 'connected',
        clientId,
        timestamp: Date.now(),
      })
    )

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  // =========================================================================
  // WebSocket Hibernation Handlers (called by Cloudflare runtime)
  // =========================================================================

  /**
   * Handle incoming WebSocket messages.
   * Called by Cloudflare runtime for hibernatable WebSockets.
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Parse the message
    let parsed: unknown
    try {
      const messageStr = typeof message === 'string' ? message : new TextDecoder().decode(message)
      parsed = JSON.parse(messageStr)
    } catch {
      this.sendWsError(ws, {
        id: 'parse_error',
        error: 'Failed to parse message as JSON',
        code: 'PARSE_ERROR',
      })
      return
    }

    // Route based on message type
    if (isLocalCallMessage(parsed)) {
      await this.handleWsCallMessage(ws, parsed)
    } else {
      // Unknown message type
      const msg = parsed as { id?: string; type?: string }
      this.sendWsError(ws, {
        id: msg.id ?? 'unknown',
        error: `Unknown or invalid message type: ${msg.type}`,
        code: 'INVALID_MESSAGE_TYPE',
      })
    }
  }

  /**
   * Handle WebSocket close event.
   * Called when a client disconnects.
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    // Get client ID from WebSocket tags
    const clientId = this.getClientIdFromWebSocket(ws)
    if (clientId) {
      // Clean up any in-flight requests for this client
      this.ctx.storage.sql.exec(
        'DELETE FROM rpc_in_flight WHERE client_id = ?',
        clientId
      )
    }
    // Cleanup is handled automatically by Cloudflare runtime
  }

  /**
   * Handle WebSocket error event.
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    // Log error but don't crash
    console.error('[AdminDO] WebSocket error:', error)
  }

  // =========================================================================
  // WebSocket Helper Methods
  // =========================================================================

  /**
   * Handle a single RPC call message from WebSocket
   */
  private async handleWsCallMessage(ws: WebSocket, call: LocalCallMessage): Promise<void> {
    // Get client ID from WebSocket tags for hibernation tracking
    const clientId = this.getClientIdFromWebSocket(ws)

    // Persist in-flight request before processing
    if (clientId) {
      this.persistInFlight(call.id, clientId, call.method, call.args)
    }

    try {
      // Use the existing executeMethod for RPC routing
      const result = await this.executeMethod(call.method, call.args)
      const response: ReturnMessage = {
        id: call.id,
        type: 'return',
        value: result,
      }
      ws.send(JSON.stringify(response))
    } catch (err) {
      const error = sanitizeError(err)
      const response: ErrorMessage = {
        id: call.id,
        type: 'error',
        error: error.message,
        code: error.code,
      }
      ws.send(JSON.stringify(response))
    } finally {
      // Always clear in-flight request after response
      this.clearInFlight(call.id)
    }
  }

  /**
   * Get the client ID from a WebSocket's tags
   */
  private getClientIdFromWebSocket(ws: WebSocket): string | undefined {
    const tags = this.ctx.getTags(ws)
    const clientTag = tags.find((t) => t.startsWith('client:'))
    return clientTag
  }

  /**
   * Persist an in-flight request to SQLite before processing
   */
  private persistInFlight(id: string, clientId: string, method: string, args: unknown[]): void {
    const startedAt = Date.now()
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO rpc_in_flight (id, client_id, method, args, started_at)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      clientId,
      method,
      JSON.stringify(args),
      startedAt
    )
  }

  /**
   * Clear an in-flight request from SQLite after response
   */
  private clearInFlight(id: string): void {
    this.ctx.storage.sql.exec('DELETE FROM rpc_in_flight WHERE id = ?', id)
  }

  /**
   * Send an error message to a WebSocket client
   */
  private sendWsError(ws: WebSocket, error: { id: string; error: string; code: string }): void {
    const errorMsg: ErrorMessage = {
      id: error.id,
      type: 'error',
      error: error.error,
      code: error.code,
    }
    ws.send(JSON.stringify(errorMsg))
  }

  /**
   * Get all connected WebSocket clients
   */
  protected getConnectedClients(tag?: string): WebSocket[] {
    return this.ctx.getWebSockets(tag)
  }

  // =========================================================================
  // RPC Methods - Direct schema access
  // =========================================================================

  /**
   * List all available schema names
   */
  listSchemas(): readonly string[] {
    return this.schemasAccessor.list()
  }

  /**
   * Get a specific schema by name
   */
  getSchema(name: string): JsonSchema | JsonSchemaField | null {
    return this.schemasAccessor.get(name)
  }

  /**
   * Get all schemas at once
   */
  getAllSchemas(): Record<string, JsonSchema | JsonSchemaField> {
    const all: Record<string, JsonSchema | JsonSchemaField> = {}
    for (const name of SCHEMA_NAMES) {
      all[name] = zodToJson(SCHEMAS[name], `${name} schema`)
    }
    return all
  }

  /**
   * Simple ping for health checks
   */
  ping(): string {
    return 'pong'
  }

  // =========================================================================
  // Dynamic Method Resolution
  // =========================================================================

  /**
   * Execute a method by its dot-separated path
   *
   * Supports:
   * - Top-level methods: "ping", "listSchemas", "getSchema", etc.
   * - Accessor methods: "functions.list", "$schemas.get", "$meta.version", etc.
   * - Nested accessors: "drizzle.nouns.list", "drizzle.verbs.count", etc.
   *
   * @param method - Dot-separated method path (e.g., "functions.list", "drizzle.nouns.get")
   * @param args - Arguments to pass to the method
   * @returns The result of the method call
   * @throws Error if method is not found
   */
  async executeMethod(method: string, args: unknown[]): Promise<unknown> {
    const parts = method.split('.')

    // Navigate through the object to find the target
    let target: unknown = this
    for (let i = 0; i < parts.length - 1; i++) {
      const prop = parts[i]

      // Try the property directly, then with $ prefix for accessors like $schemas, $meta
      let value = (target as Record<string, unknown>)[prop]
      if (value === undefined && !prop.startsWith('$')) {
        // Try with $ prefix (e.g., "schemas" -> "$schemas", "meta" -> "$meta")
        value = (target as Record<string, unknown>)[`$${prop}`]
      }

      if (value === undefined) {
        throw new Error(`Property '${parts.slice(0, i + 1).join('.')}' not found`)
      }

      target = value
    }

    // Get the final method
    const methodName = parts[parts.length - 1]
    const fn = (target as Record<string, unknown>)[methodName]

    if (typeof fn !== 'function') {
      throw new Error(`Method '${method}' not found`)
    }

    // Call the method with proper binding
    const result = (fn as (...args: unknown[]) => unknown).apply(target, args)

    // Handle both sync and async methods
    return result instanceof Promise ? await result : result
  }

  /**
   * List all available methods for introspection
   *
   * Returns a structured list of all callable methods on this DO,
   * organized by namespace.
   *
   * @returns Array of method definitions with name and type
   */
  listAvailableMethods(): { namespace: string; methods: string[] }[] {
    const result: { namespace: string; methods: string[] }[] = []

    // Top-level methods on AdminDO
    const topLevelMethods: string[] = []
    const prototype = Object.getPrototypeOf(this)
    const ownProps = Object.getOwnPropertyNames(prototype)
    for (const prop of ownProps) {
      // Skip constructor, private methods, and accessors
      if (prop === 'constructor' || prop.startsWith('_') || prop === 'fetch') continue
      const descriptor = Object.getOwnPropertyDescriptor(prototype, prop)
      if (descriptor && typeof descriptor.value === 'function') {
        topLevelMethods.push(prop)
      }
    }
    if (topLevelMethods.length > 0) {
      result.push({ namespace: '', methods: topLevelMethods.sort() })
    }

    // $schemas accessor methods
    result.push({
      namespace: '$schemas',
      methods: this.getMethodsFromObject(this.$schemas),
    })

    // $meta accessor methods
    result.push({
      namespace: '$meta',
      methods: this.getMethodsFromObject(this.$meta),
    })

    // functions accessor methods
    result.push({
      namespace: 'functions',
      methods: this.getMethodsFromObject(this.functions),
    })

    // drizzle accessor (nested structure)
    const drizzleNamespaces = ['nouns', 'verbs', 'actions', 'relationships', 'functions'] as const
    for (const table of drizzleNamespaces) {
      const accessor = this.drizzle[table]
      result.push({
        namespace: `drizzle.${table}`,
        methods: this.getMethodsFromObject(accessor),
      })
    }

    return result
  }

  /**
   * Helper to extract method names from an object
   */
  private getMethodsFromObject(obj: unknown): string[] {
    if (!obj || typeof obj !== 'object') return []

    const methods: string[] = []

    // Check own properties
    for (const key of Object.keys(obj)) {
      if (typeof (obj as Record<string, unknown>)[key] === 'function') {
        methods.push(key)
      }
    }

    // Check prototype methods
    const prototype = Object.getPrototypeOf(obj)
    if (prototype && prototype !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(prototype)) {
        if (key === 'constructor') continue
        const descriptor = Object.getOwnPropertyDescriptor(prototype, key)
        if (descriptor && typeof descriptor.value === 'function') {
          if (!methods.includes(key)) {
            methods.push(key)
          }
        }
      }
    }

    return methods.filter(m => !m.startsWith('_')).sort()
  }
}
