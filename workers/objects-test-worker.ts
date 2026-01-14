/**
 * Objects Test Worker
 *
 * Test worker that exports DOBase, Entity, and Worker classes for integration
 * tests with real SQLite storage via miniflare.
 *
 * Tests DOBase, Entity, and Worker WITHOUT mocks - uses real DO instances.
 *
 * @module workers/objects-test-worker
 */

import { DO } from '../objects/DOBase'
import { Entity, type EntitySchema, type EntityRecord } from '../objects/Entity'
import {
  Worker as BaseWorker,
  type Task,
  type TaskResult,
  type Context,
  type Answer,
  type Option,
  type Decision,
  type ApprovalRequest,
  type ApprovalResult,
  type Channel,
  type WorkerMode,
} from '../objects/Worker'
import type { Env } from '../objects/DOBase'
import { sql } from 'drizzle-orm'
import type { ThingEntity } from '../db/stores'
import { Hono } from 'hono'

// ============================================================================
// SCHEMA INITIALIZATION SQL
// ============================================================================

const SCHEMA_STATEMENTS = [
  // Nouns table (type registry)
  `CREATE TABLE IF NOT EXISTS nouns (
    noun TEXT PRIMARY KEY,
    plural TEXT,
    description TEXT,
    schema TEXT,
    do_class TEXT
  )`,

  // Things table (entity storage)
  `CREATE TABLE IF NOT EXISTS things (
    id TEXT NOT NULL,
    type INTEGER NOT NULL,
    branch TEXT,
    name TEXT,
    data TEXT,
    deleted INTEGER DEFAULT 0,
    visibility TEXT DEFAULT 'user'
  )`,

  // Indexes for things table
  `CREATE INDEX IF NOT EXISTS things_id_idx ON things(id)`,
  `CREATE INDEX IF NOT EXISTS things_type_idx ON things(type)`,
  `CREATE INDEX IF NOT EXISTS things_branch_idx ON things(branch)`,
  `CREATE INDEX IF NOT EXISTS things_id_branch_idx ON things(id, branch)`,

  // Relationships table
  `CREATE TABLE IF NOT EXISTS relationships (
    id TEXT PRIMARY KEY,
    verb TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    data TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  // Actions table
  `CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    verb TEXT NOT NULL,
    actor TEXT,
    target TEXT NOT NULL,
    input TEXT,
    output TEXT,
    options TEXT,
    durability TEXT DEFAULT 'try',
    status TEXT DEFAULT 'pending',
    error TEXT,
    request_id TEXT,
    session_id TEXT,
    workflow_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    completed_at TEXT,
    duration INTEGER,
    retry_count INTEGER DEFAULT 0
  )`,

  // Events table
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    verb TEXT NOT NULL,
    source TEXT NOT NULL,
    data TEXT,
    action_id TEXT,
    sequence INTEGER,
    streamed INTEGER DEFAULT 0,
    streamed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  // Objects table (DO registry)
  `CREATE TABLE IF NOT EXISTS objects (
    ns TEXT NOT NULL,
    id TEXT NOT NULL,
    class TEXT NOT NULL,
    relation TEXT,
    shard_key TEXT,
    shard_index INTEGER,
    region TEXT,
    is_primary INTEGER,
    cached TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (ns, id)
  )`,
]

// ============================================================================
// TEST DO BASE CLASS
// ============================================================================

/**
 * Test DOBase class for integration testing.
 * Provides full DOBase functionality with real SQLite persistence.
 */
export class TestDOBase extends DO<Env> {
  static readonly $type = 'TestDOBase'

  private schemaInitialized = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize schema during construction
    ctx.blockConcurrencyWhile(async () => {
      await this.initSchema()
      const storedNs = await ctx.storage.get<string>('ns')
      if (storedNs) {
        // @ts-expect-error - Setting readonly ns
        this.ns = storedNs
      } else {
        // @ts-expect-error - Setting readonly ns
        this.ns = ctx.id.toString()
      }
    })
  }

  protected override getRegisteredNouns(): Array<{ noun: string; plural: string }> {
    return [
      { noun: 'Customer', plural: 'customers' },
      { noun: 'Order', plural: 'orders' },
      { noun: 'Product', plural: 'products' },
      { noun: 'TestThing', plural: 'testthings' },
    ]
  }

  private async initSchema(): Promise<void> {
    if (this.schemaInitialized) return

    try {
      for (const statement of SCHEMA_STATEMENTS) {
        try {
          await this.db.run(sql.raw(statement))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('already exists')) {
            console.error('[TestDOBase] Schema statement failed:', err)
          }
        }
      }
      this.schemaInitialized = true
    } catch (error) {
      this.schemaInitialized = true
    }
  }

  // RPC methods for testing

  async createThing(data: Partial<ThingEntity>): Promise<ThingEntity> {
    return this.things.create(data)
  }

  async getThing(id: string): Promise<ThingEntity | null> {
    return this.things.get(id)
  }

  async listThings(options?: { type?: string }): Promise<ThingEntity[]> {
    return this.things.list(options)
  }

  async updateThing(id: string, data: Partial<ThingEntity>): Promise<ThingEntity> {
    return this.things.update(id, data)
  }

  async deleteThing(id: string): Promise<ThingEntity | null> {
    try {
      return await this.things.delete(id)
    } catch {
      return null
    }
  }

  async createRel(data: { verb: string; from: string; to: string; data?: Record<string, unknown> }) {
    return this.rels.create(data)
  }

  async listRels(options?: { from?: string; to?: string; verb?: string }) {
    return this.rels.list(options)
  }

  async logAction(options: { verb: string; target: string; actor?: string }) {
    return this.actions.log(options)
  }

  async emitEvent(options: { verb: string; source: string; data: Record<string, unknown> }) {
    return this.events.emit(options)
  }

  async getHealth() {
    return { status: 'ok', ns: this.ns, type: TestDOBase.$type }
  }

  override async fetch(request: Request): Promise<Response> {
    const headerNs = request.headers.get('X-DO-NS')
    if (headerNs) {
      // @ts-expect-error - Setting readonly ns
      this.ns = headerNs
      await this.ctx.storage.put('ns', headerNs)
    }
    return super.fetch(request)
  }
}

// ============================================================================
// TEST ENTITY CLASS
// ============================================================================

/**
 * Test Entity class for integration testing.
 * Tests schema validation, CRUD operations, and indexing.
 */
export class TestEntity extends Entity {
  static override readonly $type = 'TestEntity'

  private schemaInitialized = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize schema during construction
    ctx.blockConcurrencyWhile(async () => {
      await this.initSchema()
    })
  }

  private async initSchema(): Promise<void> {
    if (this.schemaInitialized) return

    try {
      for (const statement of SCHEMA_STATEMENTS) {
        try {
          await this.db.run(sql.raw(statement))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('already exists')) {
            console.error('[TestEntity] Schema statement failed:', err)
          }
        }
      }
      this.schemaInitialized = true
    } catch (error) {
      this.schemaInitialized = true
    }
  }

  // RPC methods for testing

  async setupSchema(schema: EntitySchema): Promise<void> {
    await this.setSchema(schema)
  }

  async getEntitySchema(): Promise<EntitySchema | null> {
    return this.getSchema()
  }

  async createRecord(data: Record<string, unknown>): Promise<EntityRecord> {
    return this.create(data)
  }

  async getRecord(id: string): Promise<EntityRecord | null> {
    return this.get(id)
  }

  async updateRecord(id: string, data: Partial<Record<string, unknown>>): Promise<EntityRecord | null> {
    return this.update(id, data)
  }

  async deleteRecord(id: string): Promise<boolean> {
    return this.delete(id)
  }

  async listRecords(options?: { limit?: number; offset?: number }): Promise<EntityRecord[]> {
    return this.list(options)
  }

  async findRecords(field: string, value: unknown): Promise<EntityRecord[]> {
    return this.find(field, value)
  }

  async findRecordsWithIndex(field: string, value: unknown): Promise<EntityRecord[]> {
    return this.findWithIndex(field, value)
  }

  async rebuildEntityIndexes(): Promise<{ indexed: number; fields: string[] }> {
    return this.rebuildIndexes()
  }
}

// ============================================================================
// TEST WORKER CLASS
// ============================================================================

/**
 * Test Worker class for integration testing.
 * Tests task execution, question answering, decisions, and approvals.
 */
export class TestWorker extends BaseWorker {
  static override readonly $type = 'TestWorker'

  private schemaInitialized = false
  private lastTask: Task | null = null
  private lastQuestion: string | null = null
  private lastDecision: { question: string; options: Option[] } | null = null
  private lastApproval: ApprovalRequest | null = null
  private notifications: Array<{ message: string; channel: Channel }> = []

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize HTTP routes for Worker-specific endpoints
    this.initHttpRoutes()

    // Initialize schema during construction
    ctx.blockConcurrencyWhile(async () => {
      await this.initSchema()
    })
  }

  /**
   * Initialize HTTP routes for Worker-specific endpoints.
   * These routes handle task execution, Q&A, decisions, approvals, and mode management.
   */
  private initHttpRoutes(): void {
    // Create Hono app if not already created
    if (!this.app) {
      this.app = new Hono()
    }

    // POST /task - Execute a task
    this.app.post('/task', async (c) => {
      try {
        const task = await c.req.json() as Task
        const result = await this.runTask(task)
        return c.json({ ...result, status: result.success ? 'completed' : 'failed' }, 200)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return c.json({ error: message, status: 'failed' }, 500)
      }
    })

    // POST /ask - Ask a question
    this.app.post('/ask', async (c) => {
      try {
        const body = await c.req.json() as { question: string; context?: Context }
        const answer = await this.askQuestion(body.question, body.context)
        return c.json(answer, 200)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return c.json({ error: message }, 500)
      }
    })

    // POST /decide - Make a decision
    this.app.post('/decide', async (c) => {
      try {
        const body = await c.req.json() as { question: string; options: Option[]; context?: Context }
        const decision = await this.makeChoice(body.question, body.options, body.context)
        return c.json(decision, 200)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return c.json({ error: message }, 500)
      }
    })

    // POST /approve - Request approval
    this.app.post('/approve', async (c) => {
      try {
        const request = await c.req.json() as ApprovalRequest
        const result = await this.requestApproval(request)
        return c.json(result, 200)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return c.json({ error: message }, 500)
      }
    })

    // GET /mode - Get current worker mode
    this.app.get('/mode', async (c) => {
      const mode = await this.getCurrentMode()
      return c.json({ mode }, 200)
    })

    // PUT /mode - Set worker mode
    this.app.put('/mode', async (c) => {
      try {
        const body = await c.req.json() as { mode: WorkerMode }
        const newMode = await this.changeMode(body.mode)
        return c.json({ mode: newMode }, 200)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return c.json({ error: message }, 500)
      }
    })
  }

  private async initSchema(): Promise<void> {
    if (this.schemaInitialized) return

    try {
      for (const statement of SCHEMA_STATEMENTS) {
        try {
          await this.db.run(sql.raw(statement))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('already exists')) {
            console.error('[TestWorker] Schema statement failed:', err)
          }
        }
      }
      this.schemaInitialized = true
    } catch (error) {
      this.schemaInitialized = true
    }
  }

  // Override abstract methods with test implementations

  protected override async executeTask(task: Task, context?: Context): Promise<unknown> {
    this.lastTask = task
    // Simulate task execution
    if (task.type === 'fail') {
      throw new Error('Task failed intentionally')
    }
    return { executed: true, taskId: task.id, type: task.type }
  }

  protected override async generateAnswer(question: string, context?: Context): Promise<Answer> {
    this.lastQuestion = question
    return {
      text: `Answer to: ${question}`,
      confidence: 0.95,
      sources: ['test-source'],
    }
  }

  protected override async makeDecision(
    question: string,
    options: Option[],
    context?: Context
  ): Promise<Decision> {
    this.lastDecision = { question, options }
    // Pick the first option as the decision
    return {
      selectedOption: options[0]!,
      reasoning: 'First option selected for testing',
      confidence: 0.9,
    }
  }

  protected override async processApproval(request: ApprovalRequest): Promise<ApprovalResult> {
    this.lastApproval = request
    // Auto-approve for testing
    return {
      approved: request.type !== 'reject',
      approver: this.ctx.id.toString(),
      reason: request.type === 'reject' ? 'Rejected for testing' : 'Approved for testing',
      approvedAt: new Date(),
    }
  }

  protected override async generateOutput<T>(prompt: string, schema?: unknown): Promise<T> {
    // Return a mock generated output
    return { generated: true, prompt } as T
  }

  protected override async sendToChannel(message: string, channel: Channel): Promise<void> {
    this.notifications.push({ message, channel })
  }

  // RPC methods for testing

  async runTask(task: Task, context?: Context): Promise<TaskResult> {
    return this.executeWork(task, context)
  }

  async askQuestion(question: string, context?: Context): Promise<Answer> {
    return this.ask(question, context)
  }

  async makeChoice(question: string, options: Option[], context?: Context): Promise<Decision> {
    return this.decide(question, options, context)
  }

  async requestApproval(request: ApprovalRequest): Promise<ApprovalResult> {
    return this.approve(request)
  }

  async sendNotification(message: string, channels: Channel[]): Promise<void> {
    return this.notify(message, channels)
  }

  async generateStructured<T>(prompt: string, schema?: unknown): Promise<T> {
    return this.generate<T>(prompt, schema)
  }

  async getCurrentMode() {
    return this.getMode()
  }

  async changeMode(mode: 'autonomous' | 'supervised' | 'manual') {
    this.setMode(mode)
    return this.getMode()
  }

  // Test helper methods

  async getLastTask(): Promise<Task | null> {
    return this.lastTask
  }

  async getLastQuestion(): Promise<string | null> {
    return this.lastQuestion
  }

  async getLastDecision(): Promise<{ question: string; options: Option[] } | null> {
    return this.lastDecision
  }

  async getLastApproval(): Promise<ApprovalRequest | null> {
    return this.lastApproval
  }

  async getNotifications(): Promise<Array<{ message: string; channel: Channel }>> {
    return this.notifications
  }

  async clearTestState(): Promise<void> {
    this.lastTask = null
    this.lastQuestion = null
    this.lastDecision = null
    this.lastApproval = null
    this.notifications = []
  }
}

// ============================================================================
// TEST COLLECTION CLASS
// ============================================================================

import { Collection, type CollectionConfig } from '../objects/Collection'
import type { EntitySchema, EntityRecord } from '../objects/Entity'

/**
 * Test Collection class for integration testing.
 * Tests bulk operations, query, and aggregation.
 */
export class TestCollection extends Collection {
  static override readonly $type = 'TestCollection'

  private schemaInitialized = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize schema during construction
    ctx.blockConcurrencyWhile(async () => {
      await this.initSchema()
    })
  }

  private async initSchema(): Promise<void> {
    if (this.schemaInitialized) return

    try {
      for (const statement of SCHEMA_STATEMENTS) {
        try {
          await this.db.run(sql.raw(statement))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('already exists')) {
            console.error('[TestCollection] Schema statement failed:', err)
          }
        }
      }
      this.schemaInitialized = true
    } catch (error) {
      this.schemaInitialized = true
    }
  }

  // RPC methods for testing

  async setupCollectionConfig(config: CollectionConfig): Promise<void> {
    await this.configure(config)
  }

  async getConfig(): Promise<CollectionConfig | null> {
    return this.getCollectionConfig()
  }

  async countRecords(): Promise<number> {
    return this.count()
  }

  async queryRecords(filters: Record<string, unknown>): Promise<EntityRecord[]> {
    return this.query(filters)
  }

  async aggregateRecords(
    groupBy: string,
    aggregations: { field: string; op: 'count' | 'sum' | 'avg' | 'min' | 'max' }[]
  ): Promise<Record<string, Record<string, number>>> {
    return this.aggregate(groupBy, aggregations)
  }

  async bulkCreateRecords(records: Record<string, unknown>[]): Promise<EntityRecord[]> {
    return this.bulkCreate(records)
  }

  async bulkDeleteRecords(ids: string[]): Promise<number> {
    return this.bulkDelete(ids)
  }

  // Also expose Entity methods
  async createRecord(data: Record<string, unknown>): Promise<EntityRecord> {
    return this.create(data)
  }

  async getRecord(id: string): Promise<EntityRecord | null> {
    return this.get(id)
  }

  async listRecords(): Promise<EntityRecord[]> {
    return this.list()
  }

  async deleteRecord(id: string): Promise<boolean> {
    return this.delete(id)
  }
}

// ============================================================================
// TEST AGENT CLASS
// ============================================================================

import { Agent, type Tool, type Goal, type GoalResult } from '../objects/Agent'

/**
 * Test Agent class for integration testing.
 * Tests tool registration, execution, memory, and goal-seeking.
 */
export class TestAgent extends Agent {
  static override readonly $type = 'TestAgent'

  private schemaInitialized = false
  private executedTools: Array<{ name: string; input: unknown; output: unknown }> = []

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize schema during construction
    ctx.blockConcurrencyWhile(async () => {
      await this.initSchema()
      await this.setupDefaultTools()
    })
  }

  private async initSchema(): Promise<void> {
    if (this.schemaInitialized) return

    try {
      for (const statement of SCHEMA_STATEMENTS) {
        try {
          await this.db.run(sql.raw(statement))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('already exists')) {
            console.error('[TestAgent] Schema statement failed:', err)
          }
        }
      }
      this.schemaInitialized = true
    } catch (error) {
      this.schemaInitialized = true
    }
  }

  private async setupDefaultTools(): Promise<void> {
    // Register some test tools
    this.registerTool({
      name: 'echo',
      description: 'Echo the input back',
      parameters: { message: { type: 'string' } },
      handler: async (input) => {
        const { message } = input as { message: string }
        return { echoed: message }
      },
    })

    this.registerTool({
      name: 'calculate',
      description: 'Perform simple math',
      parameters: { a: { type: 'number' }, b: { type: 'number' }, op: { type: 'string' } },
      handler: async (input) => {
        const { a, b, op } = input as { a: number; b: number; op: string }
        switch (op) {
          case 'add': return { result: a + b }
          case 'subtract': return { result: a - b }
          case 'multiply': return { result: a * b }
          case 'divide': return { result: a / b }
          default: throw new Error(`Unknown operation: ${op}`)
        }
      },
    })
  }

  // Override executeTool to track executions
  override async executeTool(name: string, input: unknown): Promise<unknown> {
    const output = await super.executeTool(name, input)
    this.executedTools.push({ name, input, output })
    return output
  }

  // RPC methods for testing

  async addTool(tool: Tool): Promise<void> {
    this.registerTool(tool)
  }

  async listTools(): Promise<Tool[]> {
    return this.getTools()
  }

  async runTool(name: string, input: unknown): Promise<unknown> {
    return this.executeTool(name, input)
  }

  async getToolExecutionHistory(): Promise<Array<{ name: string; input: unknown; output: unknown }>> {
    return this.executedTools
  }

  async clearExecutionHistory(): Promise<void> {
    this.executedTools = []
  }

  async runGoal(goal: Goal): Promise<GoalResult> {
    return this.run(goal)
  }

  async storeMemory(content: string, type: 'short-term' | 'long-term' | 'episodic'): Promise<void> {
    await this.remember(content, type)
  }

  async getRecentMemory(limit: number = 5): Promise<Array<{ id: string; content: string; type: string }>> {
    const memories = await this.getRecentMemories(limit)
    return memories.map(m => ({ id: m.id, content: m.content, type: m.type }))
  }

  async findMemories(query: string): Promise<Array<{ id: string; content: string; type: string }>> {
    const memories = await this.searchMemories(query)
    return memories.map(m => ({ id: m.id, content: m.content, type: m.type }))
  }

  async getCurrentMode(): Promise<'autonomous' | 'supervised' | 'manual'> {
    return this.getMode()
  }

  async changeMode(mode: 'autonomous' | 'supervised' | 'manual'): Promise<void> {
    this.setMode(mode)
  }
}

// ============================================================================
// TEST HUMAN CLASS
// ============================================================================

import { Human, type NotificationChannel, type BlockingApprovalRequest } from '../objects/Human'

/**
 * Test Human class for integration testing.
 * Tests approval flows, notifications, and escalation.
 */
export class TestHuman extends Human {
  static override readonly $type = 'TestHuman'

  private schemaInitialized = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize schema during construction
    ctx.blockConcurrencyWhile(async () => {
      await this.initSchema()
    })
  }

  private async initSchema(): Promise<void> {
    if (this.schemaInitialized) return

    try {
      for (const statement of SCHEMA_STATEMENTS) {
        try {
          await this.db.run(sql.raw(statement))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('already exists')) {
            console.error('[TestHuman] Schema statement failed:', err)
          }
        }
      }
      this.schemaInitialized = true
    } catch (error) {
      this.schemaInitialized = true
    }
  }

  // RPC methods for testing

  async setupChannels(channels: NotificationChannel[]): Promise<void> {
    await this.setChannels(channels)
  }

  async getNotificationChannels(): Promise<NotificationChannel[]> {
    return this.getChannels()
  }

  async submitRequest(request: {
    requestId: string
    role: string
    message: string
    sla?: number
    type: 'approval' | 'question' | 'review'
  }): Promise<BlockingApprovalRequest> {
    return this.submitBlockingRequest(request)
  }

  async checkRequest(requestId: string): Promise<BlockingApprovalRequest | null> {
    return this.getBlockingRequest(requestId)
  }

  async respondToRequest(requestId: string, response: { approved: boolean; reason?: string }): Promise<BlockingApprovalRequest | null> {
    return this.respondToBlockingRequest({
      requestId,
      approved: response.approved,
      reason: response.reason,
    })
  }

  async listPendingRequests(): Promise<BlockingApprovalRequest[]> {
    return this.listBlockingRequests('pending')
  }

  async listAllRequests(): Promise<BlockingApprovalRequest[]> {
    return this.listBlockingRequests()
  }

  async cancelRequest(requestId: string): Promise<boolean> {
    return this.cancelBlockingRequest(requestId)
  }
}

// ============================================================================
// TEST WORKFLOW CLASS
// ============================================================================

import { Workflow, type WorkflowConfig, type WorkflowInstance, type WorkflowStep } from '../objects/Workflow'

/**
 * Test Workflow class for integration testing.
 * Tests workflow definition, execution, and state management.
 */
export class TestWorkflow extends Workflow {
  static override readonly $type = 'TestWorkflow'

  private schemaInitialized = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize schema during construction
    ctx.blockConcurrencyWhile(async () => {
      await this.initSchema()
    })
  }

  private async initSchema(): Promise<void> {
    if (this.schemaInitialized) return

    try {
      for (const statement of SCHEMA_STATEMENTS) {
        try {
          await this.db.run(sql.raw(statement))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('already exists')) {
            console.error('[TestWorkflow] Schema statement failed:', err)
          }
        }
      }
      this.schemaInitialized = true
    } catch (error) {
      this.schemaInitialized = true
    }
  }

  // RPC methods for testing

  async setupWorkflow(config: WorkflowConfig): Promise<void> {
    await this.configure(config)
  }

  async getWorkflowConfig(): Promise<WorkflowConfig | null> {
    return this.getConfig()
  }

  async startWorkflow(input?: Record<string, unknown>): Promise<WorkflowInstance> {
    return this.start(input)
  }

  async getWorkflowInstance(instanceId: string): Promise<WorkflowInstance | null> {
    return this.getInstance(instanceId)
  }

  async listWorkflowInstances(status?: WorkflowInstance['status']): Promise<WorkflowInstance[]> {
    // If status provided, filter by status; otherwise return all instances
    if (status) {
      return this.getInstancesByStatus(status)
    }
    return this.listInstances(100)
  }

  async pauseWorkflow(instanceId: string): Promise<void> {
    await this.pauseInstance(instanceId)
  }

  async resumeWorkflow(instanceId: string): Promise<void> {
    await this.resumeInstance(instanceId)
  }

  async sendWorkflowEvent(instanceId: string, eventName: string, data?: unknown): Promise<void> {
    await this.sendEvent(instanceId, eventName, data)
  }

  async getWorkflowSteps(instanceId: string): Promise<Array<{ step: WorkflowStep; status: string }>> {
    // Get instance and extract step info
    const instance = await this.getInstance(instanceId)
    if (!instance) return []

    // Map instance steps to the expected format
    return instance.steps.map((step) => ({
      step,
      status: step.status,
    }))
  }
}

// ============================================================================
// WORKER ENTRY POINT
// ============================================================================

export interface ObjectsTestEnv extends Env {
  DO_BASE: DurableObjectNamespace
  ENTITY: DurableObjectNamespace
  WORKER: DurableObjectNamespace
  COLLECTION: DurableObjectNamespace
  AGENT: DurableObjectNamespace
  HUMAN: DurableObjectNamespace
  WORKFLOW: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: ObjectsTestEnv): Promise<Response> {
    const url = new URL(request.url)
    const type = url.searchParams.get('type') || 'dobase'
    const ns = request.headers.get('X-DO-NS') || 'test'

    let stub: DurableObjectStub

    switch (type) {
      case 'entity':
        stub = env.ENTITY.get(env.ENTITY.idFromName(ns))
        break
      case 'worker':
        stub = env.WORKER.get(env.WORKER.idFromName(ns))
        break
      default:
        stub = env.DO_BASE.get(env.DO_BASE.idFromName(ns))
    }

    return stub.fetch(request)
  },
}
