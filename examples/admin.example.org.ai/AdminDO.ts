/**
 * AdminDO - Admin Durable Object for schema and function management
 *
 * This Durable Object exposes:
 * - Schema definitions via $schemas namespace for introspection
 * - Function CRUD operations via functions namespace
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

    // Initialize accessors
    this.schemasAccessor = new SchemasAccessor()
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
    // Health check
    this.app.get('/health', (c) => {
      return c.json({ status: 'healthy', service: 'AdminDO' })
    })

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
        return c.json({ error: `Schema '${name}' not found` }, 404)
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
  }

  // =========================================================================
  // Fetch Handler
  // =========================================================================

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
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
}
