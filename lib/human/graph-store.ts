/**
 * GraphHumanStore
 *
 * Graph-backed storage implementation for human-in-the-loop requests.
 * Bridges primitives.org.ai/packages/human-in-the-loop with dotdo's Graph Model.
 *
 * ## Architecture
 *
 * Human requests are stored as Things in the graph:
 * - **ApprovalRequest**: Thing with type 'ApprovalRequest'
 * - **TaskRequest**: Thing with type 'TaskRequest'
 * - **DecisionRequest**: Thing with type 'DecisionRequest'
 * - **ReviewRequest**: Thing with type 'ReviewRequest'
 *
 * ## State via Verb Forms
 *
 * Request lifecycle is tracked through verb form state in the data:
 * - `pending` - Initial state when request is created
 * - `completed` - Request has been responded to (approved/rejected/answered)
 * - `escalated` - Request has been escalated to another role/human
 * - `timeout` - Request timed out without response
 *
 * ## Relationships
 *
 * - Request `assignedTo` Human/Role/Team - Who is responsible
 * - Request `escalatesTo` Human/Role - Escalation chain
 * - Human `responded` Request - Response relationship with data
 * - Request `partOf` ApprovalWorkflow - For multi-step workflows
 *
 * @example
 * ```typescript
 * import { GraphHumanStore } from 'lib/human/graph-store'
 * import type { GraphStore } from 'db/graph/types'
 *
 * const graphStore: GraphStore = ... // From DO context
 * const humanStore = new GraphHumanStore(graphStore)
 *
 * // Create an approval request
 * const request = await humanStore.create({
 *   type: 'approval',
 *   title: 'Partnership Approval',
 *   description: 'Approve the partnership with ACME Corp',
 *   assignee: 'ceo',
 *   metadata: { partnerId: 'acme-123' },
 * })
 *
 * // Get request status
 * const status = await humanStore.get(request.id)
 *
 * // Complete the request
 * await humanStore.complete(request.id, {
 *   approved: true,
 *   respondedBy: 'ceo@company.com',
 *   reason: 'Strategic alignment',
 * })
 *
 * // Escalate if needed
 * await humanStore.escalate(request.id, 'board')
 * ```
 *
 * @see dotdo-oz6oj - [GREEN] Integrate primitives.org.ai human-in-the-loop with dotdo graph
 * @see dotdo-z9jo6 - Human-in-the-Loop Graph Integration (parent epic)
 *
 * @module lib/human/graph-store
 */

import type { GraphStore, GraphThing, GraphRelationship } from '../../db/graph/types'
import { HUMAN_REQUEST_TYPE_IDS as CENTRALIZED_HUMAN_REQUEST_TYPE_IDS } from '../../db/graph/constants'
import { logBestEffortError } from '../logging/error-logger'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Human request types supported by the store
 */
export type HumanRequestType = 'approval' | 'task' | 'decision' | 'review' | 'question'

/**
 * Human request status values (verb form states)
 */
export type HumanRequestStatus = 'pending' | 'completed' | 'escalated' | 'timeout' | 'cancelled'

/**
 * Base interface for all human request types
 */
export interface HumanRequest {
  /** Unique identifier for the request */
  id: string
  /** Type of human request */
  type: HumanRequestType
  /** Current status (verb form state) */
  status: HumanRequestStatus
  /** Request title */
  title: string
  /** Detailed description */
  description: string
  /** Assigned human, role, or team */
  assignee?: string
  /** SLA timeout in milliseconds */
  timeout?: number
  /** Channel to deliver notification */
  channel?: string
  /** Priority level */
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  /** Additional metadata */
  metadata?: Record<string, unknown>
  /** When the request was created */
  createdAt: string
  /** When the request expires */
  expiresAt?: string
  /** When the request was last updated */
  updatedAt: string
}

/**
 * Approval request specific fields
 */
export interface ApprovalRequest extends HumanRequest {
  type: 'approval'
  /** Subject of approval (what is being approved) */
  subject?: string
  /** Response data once completed */
  response?: ApprovalResponse
}

/**
 * Task request specific fields
 */
export interface TaskRequest extends HumanRequest {
  type: 'task'
  /** Task instructions */
  instructions?: string
  /** Available tools */
  tools?: string[]
  /** Estimated effort */
  estimatedEffort?: string
  /** Response data once completed */
  response?: TaskResponse
}

/**
 * Decision request specific fields
 */
export interface DecisionRequest extends HumanRequest {
  type: 'decision'
  /** Available options */
  options?: DecisionOption[]
  /** Decision criteria */
  criteria?: string[]
  /** Response data once completed */
  response?: DecisionResponse
}

/**
 * Review request specific fields
 */
export interface ReviewRequest extends HumanRequest {
  type: 'review'
  /** Content to review */
  content?: string
  /** Review criteria */
  criteria?: string[]
  /** Review type */
  reviewType?: 'code' | 'content' | 'design' | 'other'
  /** Response data once completed */
  response?: ReviewResponse
}

/**
 * Question request specific fields
 */
export interface QuestionRequest extends HumanRequest {
  type: 'question'
  /** The question text */
  question: string
  /** Response data once completed */
  response?: QuestionResponse
}

/**
 * Decision option
 */
export interface DecisionOption {
  value: string
  label: string
  description?: string
}

/**
 * Base response interface
 */
export interface HumanResponse {
  /** Who responded */
  respondedBy: string
  /** When response was received */
  respondedAt: string
  /** Additional comments */
  reason?: string
}

/**
 * Approval response
 */
export interface ApprovalResponse extends HumanResponse {
  approved: boolean
}

/**
 * Task response
 */
export interface TaskResponse extends HumanResponse {
  completed: boolean
  result?: unknown
}

/**
 * Decision response
 */
export interface DecisionResponse extends HumanResponse {
  selectedOption: string
}

/**
 * Review response
 */
export interface ReviewResponse extends HumanResponse {
  approved: boolean
  feedback?: string
  changes?: string[]
}

/**
 * Question response
 */
export interface QuestionResponse extends HumanResponse {
  answer: string
}

/**
 * Input for creating a human request
 */
export interface CreateHumanRequestInput {
  type: HumanRequestType
  title: string
  description: string
  assignee?: string
  timeout?: number
  channel?: string
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  metadata?: Record<string, unknown>
  /** Type-specific fields */
  subject?: string // For approval
  instructions?: string // For task
  tools?: string[] // For task
  estimatedEffort?: string // For task
  options?: DecisionOption[] // For decision
  criteria?: string[] // For decision/review
  content?: string // For review
  reviewType?: 'code' | 'content' | 'design' | 'other' // For review
  question?: string // For question
}

/**
 * Input for completing a human request
 */
export interface CompleteRequestInput {
  /** Who responded */
  respondedBy: string
  /** Additional comments */
  reason?: string
  /** For approvals */
  approved?: boolean
  /** For tasks */
  completed?: boolean
  result?: unknown
  /** For decisions */
  selectedOption?: string
  /** For reviews */
  feedback?: string
  changes?: string[]
  /** For questions */
  answer?: string
}

/**
 * HumanStore interface - compatible with primitives.org.ai human-in-the-loop
 */
export interface HumanStore {
  /**
   * Create a new human request
   */
  create<T extends HumanRequest>(input: CreateHumanRequestInput): Promise<T>

  /**
   * Get a human request by ID
   */
  get<T extends HumanRequest>(id: string): Promise<T | null>

  /**
   * Complete a human request with response
   */
  complete<T extends HumanRequest>(id: string, response: CompleteRequestInput): Promise<T>

  /**
   * Escalate a request to another assignee
   */
  escalate(id: string, to: string): Promise<HumanRequest>

  /**
   * Cancel a pending request
   */
  cancel(id: string, reason?: string): Promise<HumanRequest>

  /**
   * List requests with optional filters
   */
  list(options?: ListRequestsOptions): Promise<HumanRequest[]>
}

/**
 * Options for listing human requests
 */
export interface ListRequestsOptions {
  /** Filter by status */
  status?: HumanRequestStatus
  /** Filter by type */
  type?: HumanRequestType
  /** Filter by assignee */
  assignee?: string
  /** Maximum number of results */
  limit?: number
}

// ============================================================================
// CONSTANTS (from centralized db/graph/constants.ts)
// ============================================================================

/**
 * Type IDs for Human Request Things
 *
 * Re-exported from db/graph/constants.ts for backward compatibility.
 * New code should import directly from db/graph/constants or db/graph.
 *
 * @see db/graph/constants.ts for the canonical definitions
 */
export const HUMAN_REQUEST_TYPE_IDS: Record<HumanRequestType, number> = CENTRALIZED_HUMAN_REQUEST_TYPE_IDS

/**
 * Type names for Human Request Things
 */
export const HUMAN_REQUEST_TYPE_NAMES: Record<HumanRequestType, string> = {
  approval: 'ApprovalRequest',
  task: 'TaskRequest',
  decision: 'DecisionRequest',
  review: 'ReviewRequest',
  question: 'QuestionRequest',
} as const

/**
 * Verbs for Human Request relationships
 */
export const HUMAN_REQUEST_VERBS = {
  assignedTo: 'assignedTo',
  escalatesTo: 'escalatesTo',
  responded: 'responded',
  partOf: 'partOf',
} as const

// ============================================================================
// GRAPHHUMANSTORE IMPLEMENTATION
// ============================================================================

/**
 * GraphHumanStore provides graph-backed storage for human-in-the-loop requests.
 *
 * This implementation stores human requests as Things in the dotdo graph model,
 * enabling rich querying, relationship traversal, and integration with the
 * broader DO ecosystem.
 */
export class GraphHumanStore implements HumanStore {
  constructor(private graphStore: GraphStore) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  /**
   * Create a new human request.
   *
   * Creates a Thing with the appropriate type and sets up initial relationships.
   */
  async create<T extends HumanRequest>(input: CreateHumanRequestInput): Promise<T> {
    const now = new Date().toISOString()
    const id = this.generateRequestId(input.type)

    const typeId = HUMAN_REQUEST_TYPE_IDS[input.type]
    const typeName = HUMAN_REQUEST_TYPE_NAMES[input.type]

    const expiresAt = input.timeout
      ? new Date(Date.now() + input.timeout).toISOString()
      : undefined

    // Build the data payload based on request type
    const data: Record<string, unknown> = {
      status: 'pending' as HumanRequestStatus,
      title: input.title,
      description: input.description,
      assignee: input.assignee,
      timeout: input.timeout,
      channel: input.channel,
      priority: input.priority ?? 'normal',
      metadata: input.metadata,
      createdAt: now,
      expiresAt,
      updatedAt: now,
    }

    // Add type-specific fields
    switch (input.type) {
      case 'approval':
        data.subject = input.subject
        break
      case 'task':
        data.instructions = input.instructions
        data.tools = input.tools
        data.estimatedEffort = input.estimatedEffort
        break
      case 'decision':
        data.options = input.options
        data.criteria = input.criteria
        break
      case 'review':
        data.content = input.content
        data.criteria = input.criteria
        data.reviewType = input.reviewType
        break
      case 'question':
        data.question = input.question
        break
    }

    // Create the Thing
    const thing = await this.graphStore.createThing({
      id,
      typeId,
      typeName,
      data,
    })

    // Create assignedTo relationship if assignee specified
    if (input.assignee) {
      try {
        await this.graphStore.createRelationship({
          id: `rel:${id}:assignedTo:${input.assignee}`,
          verb: HUMAN_REQUEST_VERBS.assignedTo,
          from: id,
          to: input.assignee,
          data: { assignedAt: now },
        })
      } catch (error) {
        // Log non-duplicate errors for debugging
        logBestEffortError(error, {
          operation: 'createAssignedToRelationship',
          source: 'GraphHumanStore.create',
          context: { requestId: id, assignee: input.assignee },
        })
      }
    }

    return this.thingToRequest<T>(thing, input.type)
  }

  // ==========================================================================
  // GET
  // ==========================================================================

  /**
   * Get a human request by ID.
   */
  async get<T extends HumanRequest>(id: string): Promise<T | null> {
    const thing = await this.graphStore.getThing(id)
    if (!thing) {
      return null
    }

    const requestType = this.getRequestTypeFromThing(thing)
    if (!requestType) {
      return null
    }

    const request = this.thingToRequest<T>(thing, requestType)

    // Check if expired and update status if needed
    if (request.status === 'pending' && request.expiresAt) {
      const expiresAt = new Date(request.expiresAt)
      if (expiresAt <= new Date()) {
        // Mark as timeout
        const updated = await this.graphStore.updateThing(id, {
          data: {
            ...thing.data,
            status: 'timeout' as HumanRequestStatus,
            updatedAt: new Date().toISOString(),
          },
        })
        if (updated) {
          return this.thingToRequest<T>(updated, requestType)
        }
      }
    }

    return request
  }

  // ==========================================================================
  // COMPLETE
  // ==========================================================================

  /**
   * Complete a human request with a response.
   */
  async complete<T extends HumanRequest>(id: string, response: CompleteRequestInput): Promise<T> {
    const thing = await this.graphStore.getThing(id)
    if (!thing) {
      throw new Error(`Request not found: ${id}`)
    }

    const requestType = this.getRequestTypeFromThing(thing)
    if (!requestType) {
      throw new Error(`Unknown request type for: ${id}`)
    }

    const currentData = (thing.data ?? {}) as Record<string, unknown>

    if (currentData.status !== 'pending') {
      throw new Error(`Request already ${currentData.status}: ${id}`)
    }

    const now = new Date().toISOString()

    // Build response object based on request type
    const responseData: Record<string, unknown> = {
      respondedBy: response.respondedBy,
      respondedAt: now,
      reason: response.reason,
    }

    switch (requestType) {
      case 'approval':
        responseData.approved = response.approved ?? false
        break
      case 'task':
        responseData.completed = response.completed ?? true
        responseData.result = response.result
        break
      case 'decision':
        responseData.selectedOption = response.selectedOption
        break
      case 'review':
        responseData.approved = response.approved ?? false
        responseData.feedback = response.feedback
        responseData.changes = response.changes
        break
      case 'question':
        responseData.answer = response.answer
        break
    }

    // Update the Thing with completed status and response
    const updated = await this.graphStore.updateThing(id, {
      data: {
        ...currentData,
        status: 'completed' as HumanRequestStatus,
        response: responseData,
        updatedAt: now,
      },
    })

    if (!updated) {
      throw new Error(`Failed to update request: ${id}`)
    }

    // Create responded relationship
    try {
      await this.graphStore.createRelationship({
        id: `rel:${response.respondedBy}:responded:${id}`,
        verb: HUMAN_REQUEST_VERBS.responded,
        from: response.respondedBy,
        to: id,
        data: responseData,
      })
    } catch (error) {
      // Log non-duplicate errors for debugging
      logBestEffortError(error, {
        operation: 'createRespondedRelationship',
        source: 'GraphHumanStore.respond',
        context: { requestId: id, respondedBy: response.respondedBy },
      })
    }

    return this.thingToRequest<T>(updated, requestType)
  }

  // ==========================================================================
  // ESCALATE
  // ==========================================================================

  /**
   * Escalate a request to another assignee.
   */
  async escalate(id: string, to: string): Promise<HumanRequest> {
    const thing = await this.graphStore.getThing(id)
    if (!thing) {
      throw new Error(`Request not found: ${id}`)
    }

    const requestType = this.getRequestTypeFromThing(thing)
    if (!requestType) {
      throw new Error(`Unknown request type for: ${id}`)
    }

    const currentData = (thing.data ?? {}) as Record<string, unknown>

    if (currentData.status !== 'pending') {
      throw new Error(`Cannot escalate ${currentData.status} request: ${id}`)
    }

    const now = new Date().toISOString()
    const previousAssignee = currentData.assignee as string | undefined

    // Update the Thing with escalated status and new assignee
    const updated = await this.graphStore.updateThing(id, {
      data: {
        ...currentData,
        status: 'escalated' as HumanRequestStatus,
        assignee: to,
        previousAssignee,
        escalatedAt: now,
        updatedAt: now,
      },
    })

    if (!updated) {
      throw new Error(`Failed to escalate request: ${id}`)
    }

    // Create escalatesTo relationship
    try {
      await this.graphStore.createRelationship({
        id: `rel:${id}:escalatesTo:${to}:${Date.now()}`,
        verb: HUMAN_REQUEST_VERBS.escalatesTo,
        from: id,
        to,
        data: {
          escalatedAt: now,
          previousAssignee,
        },
      })
    } catch (error) {
      // Log non-duplicate errors for debugging
      logBestEffortError(error, {
        operation: 'createEscalatesToRelationship',
        source: 'GraphHumanStore.escalate',
        context: { requestId: id, to, previousAssignee },
      })
    }

    // Also update the assignedTo relationship
    try {
      await this.graphStore.createRelationship({
        id: `rel:${id}:assignedTo:${to}`,
        verb: HUMAN_REQUEST_VERBS.assignedTo,
        from: id,
        to,
        data: { assignedAt: now, viaEscalation: true },
      })
    } catch (error) {
      // Log non-duplicate errors for debugging
      logBestEffortError(error, {
        operation: 'createEscalationAssignedToRelationship',
        source: 'GraphHumanStore.escalate',
        context: { requestId: id, to },
      })
    }

    return this.thingToRequest(updated, requestType)
  }

  // ==========================================================================
  // CANCEL
  // ==========================================================================

  /**
   * Cancel a pending request.
   */
  async cancel(id: string, reason?: string): Promise<HumanRequest> {
    const thing = await this.graphStore.getThing(id)
    if (!thing) {
      throw new Error(`Request not found: ${id}`)
    }

    const requestType = this.getRequestTypeFromThing(thing)
    if (!requestType) {
      throw new Error(`Unknown request type for: ${id}`)
    }

    const currentData = (thing.data ?? {}) as Record<string, unknown>

    if (currentData.status !== 'pending' && currentData.status !== 'escalated') {
      throw new Error(`Cannot cancel ${currentData.status} request: ${id}`)
    }

    const now = new Date().toISOString()

    // Update the Thing with cancelled status
    const updated = await this.graphStore.updateThing(id, {
      data: {
        ...currentData,
        status: 'cancelled' as HumanRequestStatus,
        cancelledAt: now,
        cancellationReason: reason,
        updatedAt: now,
      },
    })

    if (!updated) {
      throw new Error(`Failed to cancel request: ${id}`)
    }

    return this.thingToRequest(updated, requestType)
  }

  // ==========================================================================
  // LIST
  // ==========================================================================

  /**
   * List requests with optional filters.
   */
  async list(options: ListRequestsOptions = {}): Promise<HumanRequest[]> {
    const typeNames = options.type
      ? [HUMAN_REQUEST_TYPE_NAMES[options.type]]
      : Object.values(HUMAN_REQUEST_TYPE_NAMES)

    const allRequests: HumanRequest[] = []

    for (const typeName of typeNames) {
      const things = await this.graphStore.getThingsByType({
        typeName,
        limit: options.limit,
      })

      for (const thing of things) {
        const requestType = this.getRequestTypeFromThing(thing)
        if (!requestType) continue

        const request = this.thingToRequest(thing, requestType)

        // Apply filters
        if (options.status && request.status !== options.status) continue
        if (options.assignee && request.assignee !== options.assignee) continue

        allRequests.push(request)
      }
    }

    // Sort by createdAt descending
    allRequests.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )

    // Apply limit if specified
    if (options.limit) {
      return allRequests.slice(0, options.limit)
    }

    return allRequests
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  /**
   * Get request type from a Thing based on typeName
   */
  private getRequestTypeFromThing(thing: GraphThing): HumanRequestType | null {
    const typeMap: Record<string, HumanRequestType> = {
      ApprovalRequest: 'approval',
      TaskRequest: 'task',
      DecisionRequest: 'decision',
      ReviewRequest: 'review',
      QuestionRequest: 'question',
    }
    return typeMap[thing.typeName] ?? null
  }

  /**
   * Convert a GraphThing to a typed HumanRequest
   */
  private thingToRequest<T extends HumanRequest>(
    thing: GraphThing,
    requestType: HumanRequestType
  ): T {
    const data = (thing.data ?? {}) as Record<string, unknown>

    const base: HumanRequest = {
      id: thing.id,
      type: requestType,
      status: (data.status as HumanRequestStatus) ?? 'pending',
      title: (data.title as string) ?? '',
      description: (data.description as string) ?? '',
      assignee: data.assignee as string | undefined,
      timeout: data.timeout as number | undefined,
      channel: data.channel as string | undefined,
      priority: data.priority as 'low' | 'normal' | 'high' | 'urgent' | undefined,
      metadata: data.metadata as Record<string, unknown> | undefined,
      createdAt: (data.createdAt as string) ?? new Date(thing.createdAt).toISOString(),
      expiresAt: data.expiresAt as string | undefined,
      updatedAt: (data.updatedAt as string) ?? new Date(thing.updatedAt).toISOString(),
    }

    // Add type-specific fields
    switch (requestType) {
      case 'approval':
        return {
          ...base,
          subject: data.subject as string | undefined,
          response: data.response as ApprovalResponse | undefined,
        } as T
      case 'task':
        return {
          ...base,
          instructions: data.instructions as string | undefined,
          tools: data.tools as string[] | undefined,
          estimatedEffort: data.estimatedEffort as string | undefined,
          response: data.response as TaskResponse | undefined,
        } as T
      case 'decision':
        return {
          ...base,
          options: data.options as DecisionOption[] | undefined,
          criteria: data.criteria as string[] | undefined,
          response: data.response as DecisionResponse | undefined,
        } as T
      case 'review':
        return {
          ...base,
          content: data.content as string | undefined,
          criteria: data.criteria as string[] | undefined,
          reviewType: data.reviewType as 'code' | 'content' | 'design' | 'other' | undefined,
          response: data.response as ReviewResponse | undefined,
        } as T
      case 'question':
        return {
          ...base,
          question: (data.question as string) ?? '',
          response: data.response as QuestionResponse | undefined,
        } as T
      default:
        return base as T
    }
  }

  /**
   * Generate a unique request ID
   */
  private generateRequestId(type: HumanRequestType): string {
    const prefix = type.substring(0, 3) // 'app', 'tas', 'dec', 'rev', 'que'
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 8)
    return `${prefix}-${timestamp}-${random}`
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new GraphHumanStore instance.
 *
 * @param graphStore - The GraphStore to use for persistence
 * @returns A new GraphHumanStore instance
 */
export function createGraphHumanStore(graphStore: GraphStore): GraphHumanStore {
  return new GraphHumanStore(graphStore)
}

export default GraphHumanStore
