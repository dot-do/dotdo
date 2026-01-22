/**
 * Platform Service Type Definitions for platform.do
 *
 * These interfaces define the typed $ proxy for platform services:
 * - Functions: Serverless function management
 * - Workflows: Durable workflow execution
 * - Agents: AI agent invocation
 * - Database: SQL query execution
 *
 * @module platform.do/types
 */

// ============================================================================
// Function Types
// ============================================================================

/**
 * Definition for creating a new function
 */
export interface FunctionDef {
  /** Function name (unique identifier) */
  name: string
  /** Function description */
  description?: string
  /** Function code as a string */
  code?: string
  /** Runtime environment (e.g., 'javascript', 'typescript') */
  runtime?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Function metadata */
  meta?: Record<string, unknown>
}

/**
 * A deployed function
 */
export interface Function {
  /** Function ID */
  $id: string
  /** Function name */
  name: string
  /** Function description */
  description?: string
  /** Runtime environment */
  runtime?: string
  /** Creation timestamp */
  createdAt: string
  /** Last update timestamp */
  updatedAt: string
  /** Function metadata */
  meta?: Record<string, unknown>
}

/**
 * Service for managing serverless functions
 */
export interface FunctionsService {
  /**
   * Create a new function
   * @param fn - Function definition
   * @returns The created function
   */
  create(fn: FunctionDef): Promise<Function>

  /**
   * Invoke a function by name
   * @param name - Function name
   * @param input - Input data for the function
   * @returns The function result
   */
  invoke(name: string, input: unknown): Promise<unknown>

  /**
   * List all functions
   * @returns Array of functions
   */
  list(): Promise<Function[]>
}

// ============================================================================
// Workflow Types
// ============================================================================

/**
 * Definition for creating a new workflow
 */
export interface WorkflowDef {
  /** Workflow name (unique identifier) */
  name: string
  /** Workflow description */
  description?: string
  /** Workflow steps definition */
  steps?: WorkflowStep[]
  /** Workflow metadata */
  meta?: Record<string, unknown>
}

/**
 * A workflow step definition
 */
export interface WorkflowStep {
  /** Step ID */
  id: string
  /** Step type (e.g., 'function', 'agent', 'wait') */
  type: string
  /** Step configuration */
  config?: Record<string, unknown>
  /** Next step(s) to execute */
  next?: string | string[]
}

/**
 * A deployed workflow
 */
export interface Workflow {
  /** Workflow ID */
  $id: string
  /** Workflow name */
  name: string
  /** Workflow description */
  description?: string
  /** Workflow steps */
  steps?: WorkflowStep[]
  /** Creation timestamp */
  createdAt: string
  /** Last update timestamp */
  updatedAt: string
  /** Workflow metadata */
  meta?: Record<string, unknown>
}

/**
 * A workflow execution run
 */
export interface WorkflowRun {
  /** Run ID */
  $id: string
  /** Workflow ID */
  workflowId: string
  /** Run status */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  /** Input provided to the run */
  input?: unknown
  /** Output from the run */
  output?: unknown
  /** Error if failed */
  error?: string
  /** Start timestamp */
  startedAt: string
  /** Completion timestamp */
  completedAt?: string
  /** Run metadata */
  meta?: Record<string, unknown>
}

/**
 * Service for managing durable workflows
 */
export interface WorkflowsService {
  /**
   * Create a new workflow
   * @param workflow - Workflow definition
   * @returns The created workflow
   */
  create(workflow: WorkflowDef): Promise<Workflow>

  /**
   * Run a workflow by name
   * @param name - Workflow name
   * @param input - Input data for the workflow
   * @returns The workflow run
   */
  run(name: string, input: unknown): Promise<WorkflowRun>

  /**
   * Get a workflow run by ID
   * @param runId - The run ID
   * @returns The workflow run
   */
  get(runId: string): Promise<WorkflowRun>
}

// ============================================================================
// Agent Types
// ============================================================================

/**
 * Definition for creating a new agent
 */
export interface AgentDef {
  /** Agent name (unique identifier) */
  name: string
  /** Agent description */
  description?: string
  /** System prompt for the agent */
  systemPrompt?: string
  /** Model to use (e.g., 'gpt-4', 'claude-3') */
  model?: string
  /** Agent tools/capabilities */
  tools?: string[]
  /** Agent metadata */
  meta?: Record<string, unknown>
}

/**
 * A deployed agent
 */
export interface Agent {
  /** Agent ID */
  $id: string
  /** Agent name */
  name: string
  /** Agent description */
  description?: string
  /** System prompt */
  systemPrompt?: string
  /** Model */
  model?: string
  /** Available tools */
  tools?: string[]
  /** Creation timestamp */
  createdAt: string
  /** Last update timestamp */
  updatedAt: string
  /** Agent metadata */
  meta?: Record<string, unknown>
}

/**
 * Service for managing AI agents
 */
export interface AgentsService {
  /**
   * Create a new agent
   * @param agent - Agent definition
   * @returns The created agent
   */
  create(agent: AgentDef): Promise<Agent>

  /**
   * Invoke an agent by name
   * @param name - Agent name
   * @param input - Input message/prompt
   * @returns The agent's response
   */
  invoke(name: string, input: string): Promise<string>
}

// ============================================================================
// Database Types
// ============================================================================

/**
 * Result from a query operation
 */
export interface QueryResult<T = Record<string, unknown>> {
  /** Array of result rows */
  rows: T[]
  /** Column information */
  columns?: string[]
  /** Row count */
  rowCount: number
}

/**
 * Result from an execute operation
 */
export interface ExecuteResult {
  /** Number of rows affected */
  rowsAffected: number
  /** Last insert ID (if applicable) */
  lastInsertId?: number
}

/**
 * Service for database operations
 */
export interface DatabaseService {
  /**
   * Execute a query and return results
   * @param sql - SQL query string
   * @param params - Query parameters
   * @returns Query results
   */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>

  /**
   * Execute a statement (INSERT, UPDATE, DELETE)
   * @param sql - SQL statement
   * @param params - Statement parameters
   * @returns Execute result with affected rows
   */
  execute(sql: string, params?: unknown[]): Promise<ExecuteResult>
}

// ============================================================================
// Platform Context
// ============================================================================

/**
 * The typed $ platform context providing access to all platform services.
 *
 * @example
 * ```typescript
 * import { $ } from 'platform.do'
 *
 * // Functions
 * const fn = await $.Functions.create({ name: 'hello', code: '...' })
 * const result = await $.Functions.invoke('hello', { name: 'World' })
 *
 * // Workflows
 * const wf = await $.Workflows.create({ name: 'onboarding', steps: [...] })
 * const run = await $.Workflows.run('onboarding', { userId: '123' })
 *
 * // Agents
 * const agent = await $.Agents.create({ name: 'assistant', systemPrompt: '...' })
 * const response = await $.Agents.invoke('assistant', 'Hello!')
 *
 * // Database
 * const { rows } = await $.Database.query('SELECT * FROM users WHERE id = ?', [1])
 * const { rowsAffected } = await $.Database.execute('UPDATE users SET name = ?', ['Alice'])
 * ```
 */
export interface PlatformContext {
  /** Serverless function management */
  Functions: FunctionsService
  /** Durable workflow execution */
  Workflows: WorkflowsService
  /** AI agent invocation */
  Agents: AgentsService
  /** SQL database operations */
  Database: DatabaseService
}
