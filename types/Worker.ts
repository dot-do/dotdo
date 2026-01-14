/**
 * @module Worker Interfaces
 * @description Implementation-agnostic interfaces for Worker, Agent, and Human entities
 *
 * These interfaces define the contract for work-performing entities in dotdo,
 * designed to be portable and consumable by external packages (e.g., workers.do)
 * without coupling to Durable Object internals.
 *
 * **Interface Hierarchy:**
 * ```
 * IWorker (base interface)
 *    ├── IAgent (AI-powered worker)
 *    └── IHuman (human-in-the-loop worker)
 * ```
 *
 * @example Implementing IWorker
 * ```typescript
 * import { IWorker, Task, TaskResult, Answer, Decision, ApprovalResult } from 'dotdo/types'
 *
 * class MyWorker implements IWorker {
 *   mode: WorkerMode = 'supervised'
 *
 *   async executeWork(task: Task, context?: WorkerContext): Promise<TaskResult> {
 *     // Implementation
 *   }
 *
 *   async ask(question: string, context?: WorkerContext): Promise<Answer> {
 *     // Implementation
 *   }
 *
 *   // ... other methods
 * }
 * ```
 *
 * @example Using from workers.do
 * ```typescript
 * import { IAgent } from 'dotdo/types'
 * import { DO } from 'dotdo'
 *
 * class Ralph extends DO implements IAgent {
 *   // Ralph-specific implementation
 * }
 * ```
 */

// =============================================================================
// WORKER MODE
// =============================================================================

/**
 * Operation mode for workers.
 *
 * | Mode | Description | Behavior |
 * |------|-------------|----------|
 * | `autonomous` | Fully independent | Executes without human oversight |
 * | `supervised` | Human oversight | May require approval for actions |
 * | `manual` | Human-controlled | Requires human direction |
 */
export type WorkerMode = 'autonomous' | 'supervised' | 'manual'

// =============================================================================
// CORE DATA TYPES
// =============================================================================

/**
 * A task to be executed by a worker.
 *
 * @example
 * ```typescript
 * const task: Task = {
 *   id: 'task_123',
 *   type: 'data-processing',
 *   description: 'Process customer data',
 *   input: { customerId: 'cust_456' },
 *   priority: 1,
 *   deadline: new Date('2024-12-31')
 * }
 * ```
 */
export interface Task {
  /** Unique identifier for the task */
  id: string
  /** Type/category of the task */
  type: string
  /** Human-readable description */
  description: string
  /** Input data for task execution */
  input: Record<string, unknown>
  /** Priority level (lower = higher priority) */
  priority?: number
  /** Deadline for task completion */
  deadline?: Date
}

/**
 * Result of task execution.
 */
export interface TaskResult {
  /** Whether the task completed successfully */
  success: boolean
  /** Output data from the task */
  output?: unknown
  /** Error message if task failed */
  error?: string
  /** Execution duration in milliseconds */
  duration?: number
}

/**
 * Execution context for worker operations.
 *
 * Provides additional metadata for tracking and correlation.
 */
export interface WorkerContext {
  /** Conversation/session identifier */
  conversationId?: string
  /** User identifier */
  userId?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Answer to a question from a worker.
 */
export interface Answer {
  /** The answer text */
  text: string
  /** Confidence score (0-1) */
  confidence?: number
  /** Source references */
  sources?: string[]
}

/**
 * An option for decision making.
 */
export interface Option {
  /** Unique identifier for the option */
  id: string
  /** Display label */
  label: string
  /** Detailed description */
  description?: string
}

/**
 * A decision made by selecting from options.
 */
export interface Decision {
  /** The selected option */
  selectedOption: Option
  /** Reasoning for the decision */
  reasoning?: string
  /** Confidence in the decision (0-1) */
  confidence?: number
}

/**
 * A request for approval from a human.
 */
export interface ApprovalRequest {
  /** Unique identifier */
  id: string
  /** Type of approval (e.g., 'budget', 'refund', 'access') */
  type: string
  /** Description of what needs approval */
  description: string
  /** Who is requesting approval */
  requester: string
  /** Additional data relevant to the approval */
  data: Record<string, unknown>
  /** Deadline for the approval decision */
  deadline?: Date
}

/**
 * Result of an approval request.
 */
export interface ApprovalResult {
  /** Whether the request was approved */
  approved: boolean
  /** Who made the approval decision */
  approver: string
  /** Reason for the decision */
  reason?: string
  /** When the approval was made */
  approvedAt?: Date
}

/**
 * A notification channel for worker communications.
 */
export interface NotificationChannel {
  /** Channel type */
  type: 'email' | 'slack' | 'sms' | 'webhook'
  /** Target address/identifier for the channel */
  target: string
}

// =============================================================================
// IWORKER INTERFACE
// =============================================================================

/**
 * Base interface for all work-performing entities (Agents and Humans).
 *
 * IWorker defines the common contract for task execution, question answering,
 * decision making, and approval workflows. This interface is implementation-agnostic
 * and can be realized by Durable Objects, serverless functions, or other runtimes.
 *
 * **Core Capabilities:**
 * - Task execution with result tracking
 * - Question answering with confidence scores
 * - Decision making from options
 * - Approval request/response workflows
 * - Structured output generation
 * - Multi-channel notifications
 *
 * @example Basic Implementation
 * ```typescript
 * class MyWorker implements IWorker {
 *   mode: WorkerMode = 'supervised'
 *
 *   async executeWork(task: Task): Promise<TaskResult> {
 *     try {
 *       const result = await this.processTask(task)
 *       return { success: true, output: result }
 *     } catch (error) {
 *       return { success: false, error: error.message }
 *     }
 *   }
 *
 *   async ask(question: string): Promise<Answer> {
 *     return { text: 'Response to: ' + question }
 *   }
 *
 *   async decide(question: string, options: Option[]): Promise<Decision> {
 *     return { selectedOption: options[0], reasoning: 'Default selection' }
 *   }
 *
 *   async approve(request: ApprovalRequest): Promise<ApprovalResult> {
 *     return { approved: true, approver: 'system' }
 *   }
 *
 *   async generate<T>(prompt: string, schema?: unknown): Promise<T> {
 *     throw new Error('Not implemented')
 *   }
 *
 *   async notify(message: string, channels: NotificationChannel[]): Promise<void> {
 *     // Send notifications
 *   }
 *
 *   getMode(): WorkerMode { return this.mode }
 *   setMode(mode: WorkerMode): void { this.mode = mode }
 * }
 * ```
 *
 * @see IAgent - AI-powered worker with tools and memory
 * @see IHuman - Human worker with approval flows and escalation
 */
export interface IWorker {
  /**
   * Execute a task and return the result.
   *
   * @param task - The task to execute
   * @param context - Optional execution context
   * @returns Promise resolving to the task result
   *
   * @example
   * ```typescript
   * const result = await worker.executeWork({
   *   id: 'task_123',
   *   type: 'data-processing',
   *   description: 'Process customer data',
   *   input: { customerId: 'cust_456' }
   * })
   *
   * if (result.success) {
   *   console.log('Output:', result.output)
   * } else {
   *   console.error('Error:', result.error)
   * }
   * ```
   */
  executeWork(task: Task, context?: WorkerContext): Promise<TaskResult>

  /**
   * Ask a question and get an answer.
   *
   * @param question - The question to ask
   * @param context - Optional context for the question
   * @returns Promise resolving to the answer
   *
   * @example
   * ```typescript
   * const answer = await worker.ask('What is the customer status?', {
   *   conversationId: 'conv_789',
   *   userId: 'user_123'
   * })
   *
   * console.log('Answer:', answer.text)
   * console.log('Confidence:', answer.confidence)
   * ```
   */
  ask(question: string, context?: WorkerContext): Promise<Answer>

  /**
   * Make a decision by choosing from a set of options.
   *
   * @param question - The decision question
   * @param options - Available options to choose from
   * @param context - Optional decision context
   * @returns Promise resolving to the decision
   *
   * @example
   * ```typescript
   * const decision = await worker.decide(
   *   'Which pricing tier should we recommend?',
   *   [
   *     { id: 'basic', label: 'Basic', description: '$10/mo' },
   *     { id: 'pro', label: 'Pro', description: '$25/mo' },
   *     { id: 'enterprise', label: 'Enterprise', description: 'Custom' }
   *   ]
   * )
   *
   * console.log('Selected:', decision.selectedOption.label)
   * console.log('Reasoning:', decision.reasoning)
   * ```
   */
  decide(question: string, options: Option[], context?: WorkerContext): Promise<Decision>

  /**
   * Request approval for an action.
   *
   * @param request - The approval request details
   * @returns Promise resolving to the approval result
   *
   * @example
   * ```typescript
   * const approval = await worker.approve({
   *   id: 'approval_123',
   *   type: 'budget',
   *   description: 'Approve $5000 marketing expense',
   *   requester: 'user_456',
   *   data: { amount: 5000, department: 'marketing' },
   *   deadline: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
   * })
   *
   * if (approval.approved) {
   *   console.log('Approved by:', approval.approver)
   * } else {
   *   console.log('Rejected:', approval.reason)
   * }
   * ```
   */
  approve(request: ApprovalRequest): Promise<ApprovalResult>

  /**
   * Generate structured output from a prompt.
   *
   * @template T - The expected output type
   * @param prompt - The generation prompt
   * @param schema - Optional schema for structured output
   * @returns Promise resolving to the generated output
   *
   * @example
   * ```typescript
   * interface ProductDescription {
   *   title: string
   *   summary: string
   *   features: string[]
   * }
   *
   * const description = await worker.generate<ProductDescription>(
   *   'Generate a product description for a smart watch',
   *   {
   *     type: 'object',
   *     properties: {
   *       title: { type: 'string' },
   *       summary: { type: 'string' },
   *       features: { type: 'array', items: { type: 'string' } }
   *     }
   *   }
   * )
   * ```
   */
  generate<T>(prompt: string, schema?: unknown): Promise<T>

  /**
   * Send notifications through specified channels.
   *
   * @param message - The notification message
   * @param channels - Channels to send to
   *
   * @example
   * ```typescript
   * await worker.notify('Task completed successfully', [
   *   { type: 'email', target: 'admin@example.com' },
   *   { type: 'slack', target: '#notifications' },
   *   { type: 'webhook', target: 'https://hook.example.com' }
   * ])
   * ```
   */
  notify(message: string, channels: NotificationChannel[]): Promise<void>

  /**
   * Get the current operation mode.
   *
   * @returns The current worker mode
   */
  getMode(): WorkerMode

  /**
   * Set the operation mode.
   *
   * @param mode - The new mode to set
   */
  setMode(mode: WorkerMode): void
}

// =============================================================================
// AGENT-SPECIFIC TYPES
// =============================================================================

/**
 * A tool that an agent can use to perform actions.
 *
 * @example
 * ```typescript
 * const searchTool: AgentTool = {
 *   name: 'searchKnowledgeBase',
 *   description: 'Search the knowledge base for relevant articles',
 *   parameters: {
 *     query: { type: 'string', description: 'Search query' },
 *     limit: { type: 'number', description: 'Max results' }
 *   },
 *   handler: async (input) => {
 *     const { query, limit } = input as { query: string; limit?: number }
 *     return await searchArticles(query, limit ?? 10)
 *   }
 * }
 * ```
 */
export interface AgentTool {
  /** Unique name for the tool */
  name: string
  /** Description of what the tool does */
  description: string
  /** Parameter schema (JSON Schema format) */
  parameters: Record<string, unknown>
  /** Handler function to execute the tool */
  handler: (input: unknown) => Promise<unknown>
}

/**
 * A goal for an agent to pursue autonomously.
 */
export interface AgentGoal {
  /** Unique identifier */
  id: string
  /** Description of the goal */
  description: string
  /** Constraints the agent must follow */
  constraints?: string[]
  /** Maximum iterations before giving up */
  maxIterations?: number
}

/**
 * Result of pursuing an agent goal.
 */
export interface AgentGoalResult {
  /** Whether the goal was achieved */
  success: boolean
  /** Final result if successful */
  result?: unknown
  /** Number of iterations taken */
  iterations: number
  /** Actions taken during pursuit */
  actions: string[]
}

/**
 * Memory type for agent memory storage.
 */
export type MemoryType = 'short-term' | 'long-term' | 'episodic'

/**
 * A memory entry stored by an agent.
 */
export interface AgentMemory {
  /** Unique identifier */
  id: string
  /** Type of memory */
  type: MemoryType
  /** Memory content */
  content: string
  /** Vector embedding for semantic search */
  embedding?: number[]
  /** When the memory was created */
  createdAt: Date
}

// =============================================================================
// IAGENT INTERFACE
// =============================================================================

/**
 * Interface for AI-powered autonomous workers with tools and memory.
 *
 * IAgent extends IWorker with capabilities for:
 * - Tool registration and execution
 * - Persistent memory (short-term, long-term, episodic)
 * - Goal-seeking autonomous execution loops
 * - Observation-thinking-action cycles
 *
 * **Agent Loop (observe-think-act):**
 * ```
 * 1. observe() - Gather current state and memories
 * 2. think() - Reason about action to take
 * 3. act() - Execute action using tools
 * 4. Repeat until goal achieved or max iterations
 * ```
 *
 * @example Basic Agent
 * ```typescript
 * class SupportAgent implements IAgent {
 *   private tools = new Map<string, AgentTool>()
 *   mode: WorkerMode = 'autonomous'
 *
 *   registerTool(tool: AgentTool): void {
 *     this.tools.set(tool.name, tool)
 *   }
 *
 *   async executeTool(name: string, input: unknown): Promise<unknown> {
 *     const tool = this.tools.get(name)
 *     if (!tool) throw new Error(`Tool not found: ${name}`)
 *     return tool.handler(input)
 *   }
 *
 *   async run(goal: AgentGoal): Promise<AgentGoalResult> {
 *     // Autonomous goal-seeking loop
 *     const actions: string[] = []
 *     for (let i = 0; i < (goal.maxIterations ?? 10); i++) {
 *       // observe -> think -> act
 *       // ...
 *     }
 *     return { success: true, iterations: actions.length, actions }
 *   }
 *
 *   // ... other IWorker methods
 * }
 * ```
 *
 * @example Named Agent (from agents.do)
 * ```typescript
 * import { priya, ralph, tom } from 'agents.do'
 *
 * // Priya - Product Manager
 * const spec = await priya`define MVP for ${hypothesis}`
 *
 * // Ralph - Engineer
 * const app = await ralph`build ${spec}`
 *
 * // Tom - Tech Lead (review)
 * const approved = await tom.approve(app)
 * ```
 *
 * @see IWorker - Base worker interface
 * @see IHuman - Human worker with approval flows
 */
export interface IAgent extends IWorker {
  /**
   * Register a tool for the agent to use.
   *
   * @param tool - The tool to register
   *
   * @example
   * ```typescript
   * agent.registerTool({
   *   name: 'searchDatabase',
   *   description: 'Search the database',
   *   parameters: { query: { type: 'string' } },
   *   handler: async (input) => searchDB((input as { query: string }).query)
   * })
   * ```
   */
  registerTool(tool: AgentTool): void

  /**
   * Get all registered tools.
   *
   * @returns Array of registered tools
   */
  getTools(): AgentTool[]

  /**
   * Execute a tool by name.
   *
   * @param name - Name of the tool to execute
   * @param input - Input for the tool
   * @returns Promise resolving to the tool output
   *
   * @example
   * ```typescript
   * const results = await agent.executeTool('searchDatabase', {
   *   query: 'customer orders'
   * })
   * ```
   */
  executeTool(name: string, input: unknown): Promise<unknown>

  /**
   * Run an autonomous goal-seeking loop.
   *
   * The agent will observe, think, and act iteratively until the goal
   * is achieved or the maximum iterations are reached.
   *
   * @param goal - The goal to pursue
   * @returns Promise resolving to the goal result
   *
   * @example
   * ```typescript
   * const result = await agent.run({
   *   id: 'resolve-ticket-123',
   *   description: 'Resolve customer complaint about shipping delay',
   *   constraints: [
   *     'Must respond within 4 hours',
   *     'Offer refund if delay > 7 days'
   *   ],
   *   maxIterations: 10
   * })
   *
   * console.log('Success:', result.success)
   * console.log('Iterations:', result.iterations)
   * console.log('Actions taken:', result.actions)
   * ```
   */
  run(goal: AgentGoal): Promise<AgentGoalResult>

  /**
   * Store a memory for later retrieval.
   *
   * @param content - The memory content
   * @param type - Type of memory (defaults to 'short-term')
   * @returns Promise resolving to the stored memory
   *
   * @example
   * ```typescript
   * // Store a short-term context memory
   * await agent.remember('User prefers email communication', 'short-term')
   *
   * // Store a long-term preference
   * await agent.remember('Customer is a VIP member', 'long-term')
   * ```
   */
  remember(content: string, type?: MemoryType): Promise<AgentMemory>

  /**
   * Get recent memories.
   *
   * @param limit - Maximum number of memories to return
   * @returns Promise resolving to array of memories
   */
  getRecentMemories(limit?: number): Promise<AgentMemory[]>

  /**
   * Search memories by content.
   *
   * @param query - Search query
   * @returns Promise resolving to matching memories
   *
   * @example
   * ```typescript
   * const memories = await agent.searchMemories('customer preferences')
   * for (const memory of memories) {
   *   console.log(memory.content)
   * }
   * ```
   */
  searchMemories(query: string): Promise<AgentMemory[]>
}

// =============================================================================
// HUMAN-SPECIFIC TYPES
// =============================================================================

/**
 * Priority level for notifications.
 */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent'

/**
 * Extended notification channel with priority.
 */
export interface HumanNotificationChannel extends NotificationChannel {
  /** Priority of notifications on this channel */
  priority: NotificationPriority
}

/**
 * A rule for automatic escalation.
 */
export interface EscalationRule {
  /** Minutes to wait before escalating */
  afterMinutes: number
  /** Who to escalate to */
  escalateTo: string
  /** Channels to notify on escalation */
  notifyChannels: HumanNotificationChannel[]
}

/**
 * Policy for automatic escalation of unresponded requests.
 */
export interface EscalationPolicy {
  /** Escalation rules in order */
  rules: EscalationRule[]
  /** Final escalation target if all rules exhausted */
  finalEscalation?: string
}

/**
 * A pending approval awaiting human response.
 */
export interface PendingApproval {
  /** The approval request */
  request: ApprovalRequest
  /** When the request was received */
  receivedAt: Date
  /** When the last reminder was sent */
  remindedAt?: Date
  /** Who the request was escalated to */
  escalatedTo?: string
}

/**
 * Status of a blocking approval request.
 */
export type BlockingApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

/**
 * A blocking approval request (for template literal pattern).
 */
export interface BlockingApprovalRequest {
  /** Unique request identifier */
  requestId: string
  /** Role of the human */
  role: string
  /** Message describing what needs approval */
  message: string
  /** SLA in milliseconds */
  sla?: number
  /** Notification channel */
  channel?: string
  /** Type of request */
  type: 'approval' | 'question' | 'review'
  /** When the request was created */
  createdAt: string
  /** When the request expires */
  expiresAt?: string
  /** Current status */
  status: BlockingApprovalStatus
  /** Result if resolved */
  result?: {
    approved: boolean
    approver?: string
    reason?: string
    respondedAt?: string
  }
}

// =============================================================================
// IHUMAN INTERFACE
// =============================================================================

/**
 * Interface for human workers with approval flows, notifications, and escalation.
 *
 * IHuman extends IWorker with capabilities for:
 * - Multi-channel notifications (email, Slack, SMS, webhook)
 * - Blocking approval requests with polling or webhooks
 * - SLA-based automatic expiration
 * - Escalation policies with configurable rules
 *
 * **Approval Request States:**
 * | State | Description |
 * |-------|-------------|
 * | `pending` | Awaiting human response |
 * | `approved` | Human approved the request |
 * | `rejected` | Human rejected the request |
 * | `expired` | SLA exceeded without response |
 *
 * @example Template Literal Pattern (from humans.do)
 * ```typescript
 * import { ceo, legal } from 'humans.do'
 *
 * // Blocking approval - waits for human response
 * const approved = await ceo`approve the partnership deal`
 *
 * // Non-blocking - notifies human, continues
 * legal`review contract and respond within 48 hours`
 * ```
 *
 * @example Basic Human Implementation
 * ```typescript
 * class ApprovalManager implements IHuman {
 *   mode: WorkerMode = 'manual'
 *
 *   async setChannels(channels: HumanNotificationChannel[]): Promise<void> {
 *     // Configure notification channels
 *   }
 *
 *   async requestApproval(request: ApprovalRequest): Promise<void> {
 *     // Queue request and notify human
 *   }
 *
 *   async submitApproval(requestId: string, approved: boolean, reason?: string): Promise<ApprovalResult> {
 *     // Process human's decision
 *   }
 *
 *   // ... other methods
 * }
 * ```
 *
 * @example Integration with Agents
 * ```typescript
 * class RefundAgent implements IAgent {
 *   private human: IHuman
 *
 *   async processLargeRefund(amount: number, customerId: string) {
 *     if (amount > 10000) {
 *       const approval = await this.human.approve({
 *         id: `refund-${customerId}`,
 *         type: 'refund',
 *         description: `Refund $${amount} to customer ${customerId}`,
 *         requester: 'RefundAgent',
 *         data: { amount, customerId },
 *         deadline: new Date(Date.now() + 4 * 60 * 60 * 1000)
 *       })
 *
 *       if (!approval.approved) {
 *         throw new Error(`Refund rejected: ${approval.reason}`)
 *       }
 *     }
 *     return this.executeRefund(amount, customerId)
 *   }
 * }
 * ```
 *
 * @see IWorker - Base worker interface
 * @see IAgent - AI-powered worker with tools
 */
export interface IHuman extends IWorker {
  /**
   * Configure notification channels.
   *
   * @param channels - Channels to configure
   *
   * @example
   * ```typescript
   * await human.setChannels([
   *   { type: 'slack', target: '#approvals', priority: 'high' },
   *   { type: 'email', target: 'manager@acme.com', priority: 'normal' },
   *   { type: 'sms', target: '+1-555-0123', priority: 'urgent' }
   * ])
   * ```
   */
  setChannels(channels: HumanNotificationChannel[]): Promise<void>

  /**
   * Get configured notification channels.
   *
   * @returns Promise resolving to configured channels
   */
  getChannels(): Promise<HumanNotificationChannel[]>

  /**
   * Configure escalation policy.
   *
   * @param policy - The escalation policy
   *
   * @example
   * ```typescript
   * await human.setEscalationPolicy({
   *   rules: [
   *     {
   *       afterMinutes: 60,
   *       escalateTo: 'team-lead@acme.com',
   *       notifyChannels: [{ type: 'slack', target: '#urgent', priority: 'high' }]
   *     },
   *     {
   *       afterMinutes: 240,
   *       escalateTo: 'director@acme.com',
   *       notifyChannels: [{ type: 'sms', target: '+1-555-0199', priority: 'urgent' }]
   *     }
   *   ],
   *   finalEscalation: 'ceo@acme.com'
   * })
   * ```
   */
  setEscalationPolicy(policy: EscalationPolicy): Promise<void>

  /**
   * Get the current escalation policy.
   *
   * @returns Promise resolving to the policy or null
   */
  getEscalationPolicy(): Promise<EscalationPolicy | null>

  /**
   * Request approval from this human.
   *
   * Queues the request and notifies the human via configured channels.
   *
   * @param request - The approval request
   *
   * @example
   * ```typescript
   * await human.requestApproval({
   *   id: 'approval_123',
   *   type: 'budget',
   *   description: 'Approve $5000 marketing expense',
   *   requester: 'marketing-agent',
   *   data: { amount: 5000, category: 'advertising' },
   *   deadline: new Date(Date.now() + 24 * 60 * 60 * 1000)
   * })
   * ```
   */
  requestApproval(request: ApprovalRequest): Promise<void>

  /**
   * Submit an approval decision.
   *
   * @param requestId - ID of the request
   * @param approved - Whether to approve
   * @param reason - Reason for the decision
   * @returns Promise resolving to the approval result
   *
   * @example
   * ```typescript
   * const result = await human.submitApproval('approval_123', true, 'Budget approved')
   * console.log('Approved by:', result.approver)
   * ```
   */
  submitApproval(requestId: string, approved: boolean, reason?: string): Promise<ApprovalResult>

  /**
   * Get all pending approval requests.
   *
   * @returns Promise resolving to array of pending approvals
   */
  getPendingApprovals(): Promise<PendingApproval[]>

  /**
   * Check for escalations and process them.
   *
   * Should be called periodically to handle overdue approvals.
   */
  checkEscalations(): Promise<void>

  /**
   * Submit a blocking approval request.
   *
   * Used by template literal pattern (e.g., `ceo\`approve something\``).
   *
   * @param params - Request parameters
   * @returns Promise resolving to the request record
   *
   * @example
   * ```typescript
   * const request = await human.submitBlockingRequest({
   *   requestId: 'req_123',
   *   role: 'ceo',
   *   message: 'Approve $50k marketing budget',
   *   sla: 4 * 60 * 60 * 1000, // 4 hours
   *   type: 'approval'
   * })
   * ```
   */
  submitBlockingRequest(params: {
    requestId: string
    role: string
    message: string
    sla?: number
    channel?: string
    type?: 'approval' | 'question' | 'review'
  }): Promise<BlockingApprovalRequest>

  /**
   * Get a blocking request by ID (for polling).
   *
   * @param requestId - The request ID
   * @returns Promise resolving to the request or null
   *
   * @example
   * ```typescript
   * // Poll until resolved
   * let status = await human.getBlockingRequest('req_123')
   * while (status?.status === 'pending') {
   *   await sleep(30000)
   *   status = await human.getBlockingRequest('req_123')
   * }
   *
   * if (status?.status === 'approved') {
   *   console.log('Approved by:', status.result?.approver)
   * }
   * ```
   */
  getBlockingRequest(requestId: string): Promise<BlockingApprovalRequest | null>

  /**
   * Respond to a blocking approval request.
   *
   * @param params - Response parameters
   * @returns Promise resolving to the updated request
   *
   * @example
   * ```typescript
   * const result = await human.respondToBlockingRequest({
   *   requestId: 'req_123',
   *   approved: true,
   *   approver: 'ceo@acme.com',
   *   reason: 'Approved for Q1 budget'
   * })
   * ```
   */
  respondToBlockingRequest(params: {
    requestId: string
    approved: boolean
    approver?: string
    reason?: string
  }): Promise<BlockingApprovalRequest>

  /**
   * List all blocking requests.
   *
   * @param status - Optional filter by status
   * @returns Promise resolving to array of requests
   */
  listBlockingRequests(status?: BlockingApprovalStatus): Promise<BlockingApprovalRequest[]>
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Check if a value implements IWorker interface.
 */
export function isWorker(value: unknown): value is IWorker {
  if (!value || typeof value !== 'object') return false
  const w = value as Record<string, unknown>
  return (
    typeof w.executeWork === 'function' &&
    typeof w.ask === 'function' &&
    typeof w.decide === 'function' &&
    typeof w.approve === 'function' &&
    typeof w.generate === 'function' &&
    typeof w.notify === 'function' &&
    typeof w.getMode === 'function' &&
    typeof w.setMode === 'function'
  )
}

/**
 * Check if a value implements IAgent interface.
 */
export function isAgent(value: unknown): value is IAgent {
  if (!isWorker(value)) return false
  const a = value as unknown as Record<string, unknown>
  return (
    typeof a.registerTool === 'function' &&
    typeof a.getTools === 'function' &&
    typeof a.executeTool === 'function' &&
    typeof a.run === 'function' &&
    typeof a.remember === 'function' &&
    typeof a.getRecentMemories === 'function' &&
    typeof a.searchMemories === 'function'
  )
}

/**
 * Check if a value implements IHuman interface.
 */
export function isHuman(value: unknown): value is IHuman {
  if (!isWorker(value)) return false
  const h = value as unknown as Record<string, unknown>
  return (
    typeof h.setChannels === 'function' &&
    typeof h.getChannels === 'function' &&
    typeof h.setEscalationPolicy === 'function' &&
    typeof h.getEscalationPolicy === 'function' &&
    typeof h.requestApproval === 'function' &&
    typeof h.submitApproval === 'function' &&
    typeof h.getPendingApprovals === 'function' &&
    typeof h.checkEscalations === 'function' &&
    typeof h.submitBlockingRequest === 'function' &&
    typeof h.getBlockingRequest === 'function' &&
    typeof h.respondToBlockingRequest === 'function' &&
    typeof h.listBlockingRequests === 'function'
  )
}
