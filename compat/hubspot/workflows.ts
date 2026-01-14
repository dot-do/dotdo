/**
 * @dotdo/hubspot/workflows - HubSpot Workflow Engine Compatibility Layer
 *
 * Drop-in replacement for HubSpot Workflows API with edge compatibility.
 * Implements workflow automation: triggers, actions, branching, scheduling.
 *
 * @example
 * ```typescript
 * import { HubSpotWorkflows } from '@dotdo/hubspot/workflows'
 *
 * const workflows = new HubSpotWorkflows({ accessToken: 'pat-xxx' })
 *
 * // Create a workflow
 * const workflow = await workflows.createWorkflow({
 *   name: 'Welcome Email Flow',
 *   type: 'contact',
 *   enrollmentTriggers: [
 *     { type: 'formSubmission', formId: 'form-123' }
 *   ],
 *   actions: [
 *     { type: 'sendEmail', emailId: 'email-456' },
 *     { type: 'delay', duration: 86400000 }, // 24 hours
 *     { type: 'setProperty', property: 'lifecyclestage', value: 'customer' }
 *   ]
 * })
 *
 * // Enroll a contact
 * await workflows.enrollContact(workflow.id, 'contact-789')
 * ```
 *
 * @module @dotdo/hubspot/workflows
 */

// =============================================================================
// TYPES - Workflow Core
// =============================================================================

export type WorkflowType = 'contact' | 'company' | 'deal' | 'ticket' | 'custom'
export type WorkflowStatus = 'active' | 'inactive' | 'draft' | 'paused'
export type EnrollmentStatus = 'active' | 'completed' | 'failed' | 'unenrolled'

/**
 * Enrollment trigger types
 */
export type EnrollmentTriggerType =
  | 'formSubmission'
  | 'listMembership'
  | 'propertyChange'
  | 'pageView'
  | 'event'
  | 'manual'
  | 'api'

/**
 * Workflow action types
 */
export type WorkflowActionType =
  | 'setProperty'
  | 'sendEmail'
  | 'delay'
  | 'branch'
  | 'webhook'
  | 'createTask'
  | 'notification'
  | 'createRecord'
  | 'updateRecord'
  | 'copyProperty'
  | 'clearProperty'
  | 'incrementProperty'
  | 'rotate'
  | 'randomSplit'
  | 'goalReached'

/**
 * Delay types for workflow actions
 */
export type DelayType = 'fixed' | 'until' | 'businessHours'

/**
 * Branch condition operator
 */
export type ConditionOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'not_contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'is_known'
  | 'is_unknown'
  | 'in_list'
  | 'not_in_list'

// =============================================================================
// TYPES - Enrollment Triggers
// =============================================================================

export interface EnrollmentTrigger {
  id: string
  type: EnrollmentTriggerType
  config: EnrollmentTriggerConfig
}

export interface FormSubmissionTrigger {
  type: 'formSubmission'
  formId: string
  formName?: string
}

export interface ListMembershipTrigger {
  type: 'listMembership'
  listId: string
  listName?: string
  membership: 'added' | 'removed' | 'member'
}

export interface PropertyChangeTrigger {
  type: 'propertyChange'
  property: string
  operator?: ConditionOperator
  value?: unknown
  previousValue?: unknown
}

export interface PageViewTrigger {
  type: 'pageView'
  url?: string
  urlPattern?: string
  pageId?: string
}

export interface EventTrigger {
  type: 'event'
  eventName: string
  eventType?: string
  properties?: Record<string, unknown>
}

export interface ManualTrigger {
  type: 'manual'
}

export interface ApiTrigger {
  type: 'api'
  apiKey?: string
}

export type EnrollmentTriggerConfig =
  | FormSubmissionTrigger
  | ListMembershipTrigger
  | PropertyChangeTrigger
  | PageViewTrigger
  | EventTrigger
  | ManualTrigger
  | ApiTrigger

// =============================================================================
// TYPES - Workflow Actions
// =============================================================================

export interface WorkflowAction {
  id: string
  type: WorkflowActionType
  config: WorkflowActionConfig
  order: number
  parentBranchId?: string
  branchPath?: 'then' | 'else' | string
}

export interface SetPropertyAction {
  type: 'setProperty'
  property: string
  value: unknown
  objectType?: WorkflowType
}

export interface SendEmailAction {
  type: 'sendEmail'
  emailId: string
  emailName?: string
  sendTo?: 'contact' | 'owner' | 'custom'
  customRecipient?: string
}

export interface DelayAction {
  type: 'delay'
  delayType: DelayType
  duration?: number // milliseconds for fixed
  until?: {
    date?: string
    dayOfWeek?: number
    time?: string
    timezone?: string
  }
  businessHours?: {
    timezone: string
    hours: BusinessHours[]
  }
}

export interface BusinessHours {
  dayOfWeek: number // 0-6 (Sunday-Saturday)
  startTime: string // HH:mm
  endTime: string // HH:mm
}

export interface BranchAction {
  type: 'branch'
  branchType: 'if-then' | 'value' | 'random'
  condition?: BranchCondition
  branches?: ValueBranch[]
  splits?: RandomSplit[]
}

export interface BranchCondition {
  property: string
  operator: ConditionOperator
  value?: unknown
  and?: BranchCondition[]
  or?: BranchCondition[]
}

export interface ValueBranch {
  id: string
  value: unknown
  label?: string
}

export interface RandomSplit {
  id: string
  percentage: number
  label?: string
}

export interface WebhookAction {
  type: 'webhook'
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: unknown
  authentication?: {
    type: 'bearer' | 'basic' | 'apiKey'
    token?: string
    username?: string
    password?: string
    apiKey?: string
    headerName?: string
  }
}

export interface CreateTaskAction {
  type: 'createTask'
  title: string
  body?: string
  dueDate?: string
  dueDays?: number
  priority?: 'low' | 'medium' | 'high'
  assignTo?: 'owner' | 'custom'
  customOwnerId?: string
  taskType?: string
}

export interface NotificationAction {
  type: 'notification'
  notificationType: 'email' | 'inApp' | 'sms'
  recipients: string[]
  subject?: string
  message: string
}

export interface CreateRecordAction {
  type: 'createRecord'
  objectType: WorkflowType
  properties: Record<string, unknown>
  associations?: Array<{
    toObjectType: string
    toObjectId: string
    associationType: string
  }>
}

export interface UpdateRecordAction {
  type: 'updateRecord'
  objectType: WorkflowType
  objectId?: string
  properties: Record<string, unknown>
}

export interface CopyPropertyAction {
  type: 'copyProperty'
  sourceProperty: string
  targetProperty: string
  sourceObjectType?: WorkflowType
  targetObjectType?: WorkflowType
}

export interface ClearPropertyAction {
  type: 'clearProperty'
  property: string
  objectType?: WorkflowType
}

export interface IncrementPropertyAction {
  type: 'incrementProperty'
  property: string
  amount: number
  objectType?: WorkflowType
}

export interface RotateAction {
  type: 'rotate'
  property: string
  values: unknown[]
}

export interface RandomSplitAction {
  type: 'randomSplit'
  splits: RandomSplit[]
}

export interface GoalReachedAction {
  type: 'goalReached'
  goalId: string
}

export type WorkflowActionConfig =
  | SetPropertyAction
  | SendEmailAction
  | DelayAction
  | BranchAction
  | WebhookAction
  | CreateTaskAction
  | NotificationAction
  | CreateRecordAction
  | UpdateRecordAction
  | CopyPropertyAction
  | ClearPropertyAction
  | IncrementPropertyAction
  | RotateAction
  | RandomSplitAction
  | GoalReachedAction

// =============================================================================
// TYPES - Workflow Definition
// =============================================================================

export interface Workflow {
  id: string
  name: string
  type: WorkflowType
  status: WorkflowStatus
  description?: string
  enrollmentTriggers: EnrollmentTrigger[]
  actions: WorkflowAction[]
  reenrollmentSettings: ReenrollmentSettings
  goalCriteria?: GoalCriteria
  settings: WorkflowSettings
  createdAt: string
  updatedAt: string
  version: number
}

export interface ReenrollmentSettings {
  allowReenrollment: boolean
  resetDelay?: number // milliseconds
  maxEnrollments?: number
}

export interface GoalCriteria {
  property: string
  operator: ConditionOperator
  value: unknown
}

export interface WorkflowSettings {
  timezone: string
  businessHours?: BusinessHours[]
  suppressionLists?: string[]
  excludeFromReporting?: boolean
  executionPriority?: 'low' | 'normal' | 'high'
}

// =============================================================================
// TYPES - Enrollment & Execution
// =============================================================================

export interface Enrollment {
  id: string
  workflowId: string
  workflowVersion: number
  contactId: string
  status: EnrollmentStatus
  currentActionId?: string
  completedActions: string[]
  branchPath?: Record<string, string>
  enrolledAt: string
  completedAt?: string
  unenrolledAt?: string
  failedAt?: string
  error?: string
  metadata?: Record<string, unknown>
}

export interface EnrollmentEvent {
  id: string
  enrollmentId: string
  actionId: string
  eventType: 'started' | 'completed' | 'failed' | 'skipped'
  timestamp: string
  data?: unknown
  error?: string
}

// =============================================================================
// TYPES - Analytics
// =============================================================================

export interface WorkflowStats {
  workflowId: string
  totalEnrollments: number
  activeEnrollments: number
  completedEnrollments: number
  failedEnrollments: number
  averageCompletionTime: number
  conversionRate: number
  goalReachedCount: number
}

export interface EnrollmentStats {
  period: string
  enrollments: number
  completions: number
  failures: number
  unenrollments: number
  byTrigger: Record<string, number>
}

export interface ActionPerformance {
  actionId: string
  actionType: WorkflowActionType
  executions: number
  successes: number
  failures: number
  averageDuration: number
  errorRate: number
}

// =============================================================================
// TYPES - API Inputs
// =============================================================================

export interface CreateWorkflowInput {
  name: string
  type: WorkflowType
  description?: string
  enrollmentTriggers: Array<Omit<EnrollmentTriggerConfig, 'type'> & { type: EnrollmentTriggerType }>
  actions: Array<Omit<WorkflowActionConfig, 'type'> & { type: WorkflowActionType }>
  reenrollmentSettings?: Partial<ReenrollmentSettings>
  goalCriteria?: GoalCriteria
  settings?: Partial<WorkflowSettings>
}

export interface UpdateWorkflowInput {
  name?: string
  description?: string
  enrollmentTriggers?: Array<Omit<EnrollmentTriggerConfig, 'type'> & { type: EnrollmentTriggerType }>
  actions?: Array<Omit<WorkflowActionConfig, 'type'> & { type: WorkflowActionType }>
  reenrollmentSettings?: Partial<ReenrollmentSettings>
  goalCriteria?: GoalCriteria
  settings?: Partial<WorkflowSettings>
}

export interface ListWorkflowsOptions {
  type?: WorkflowType
  status?: WorkflowStatus
  limit?: number
  offset?: number
}

export interface EnrollmentFilter {
  property: string
  operator: ConditionOperator
  value: unknown
}

export interface HistoryOptions {
  limit?: number
  offset?: number
  startDate?: string
  endDate?: string
}

export interface StatsOptions {
  period?: 'day' | 'week' | 'month' | 'quarter' | 'year'
  startDate?: string
  endDate?: string
}

// =============================================================================
// TYPES - Branching Helpers
// =============================================================================

export interface IfThenBranchInput {
  condition: BranchCondition
  thenActions: Array<Omit<WorkflowActionConfig, 'type'> & { type: WorkflowActionType }>
  elseActions?: Array<Omit<WorkflowActionConfig, 'type'> & { type: WorkflowActionType }>
}

export interface ValueBranchInput {
  property: string
  branches: Array<{
    value: unknown
    label?: string
    actions: Array<Omit<WorkflowActionConfig, 'type'> & { type: WorkflowActionType }>
  }>
}

export interface RandomBranchInput {
  splits: Array<{
    percentage: number
    label?: string
    actions: Array<Omit<WorkflowActionConfig, 'type'> & { type: WorkflowActionType }>
  }>
}

export interface ScheduleActionInput {
  date?: string
  dayOfWeek?: number
  time?: string
  timezone?: string
}

export interface BusinessHoursInput {
  timezone: string
  hours: BusinessHours[]
}

// =============================================================================
// TYPES - Storage Interface
// =============================================================================

export interface WorkflowStorage {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list<T>(prefix: string): Promise<Map<string, T>>
}

// =============================================================================
// TYPES - Configuration
// =============================================================================

export interface HubSpotWorkflowsConfig {
  accessToken: string
  basePath?: string
  storage?: WorkflowStorage
  fetch?: typeof fetch
  defaultTimezone?: string
}

// =============================================================================
// ERROR CLASS
// =============================================================================

export class HubSpotWorkflowError extends Error {
  code: string
  statusCode: number
  details?: unknown

  constructor(message: string, code: string, statusCode: number = 400, details?: unknown) {
    super(message)
    this.name = 'HubSpotWorkflowError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }
}

// =============================================================================
// IN-MEMORY STORAGE (Default)
// =============================================================================

class InMemoryStorage implements WorkflowStorage {
  private data = new Map<string, unknown>()

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async list<T>(prefix: string): Promise<Map<string, T>> {
    const result = new Map<string, T>()
    for (const [key, value] of this.data.entries()) {
      if (key.startsWith(prefix)) {
        result.set(key, value as T)
      }
    }
    return result
  }
}

// =============================================================================
// HUBSPOT WORKFLOWS CLASS
// =============================================================================

/**
 * HubSpot Workflows compatibility layer
 *
 * Provides a complete workflow automation engine compatible with HubSpot's
 * Workflows API. Supports enrollment triggers, actions, branching, delays,
 * and analytics.
 *
 * @example
 * ```typescript
 * const workflows = new HubSpotWorkflows({ accessToken: 'pat-xxx' })
 *
 * // Create a workflow with form submission trigger
 * const workflow = await workflows.createWorkflow({
 *   name: 'Lead Nurturing',
 *   type: 'contact',
 *   enrollmentTriggers: [
 *     { type: 'formSubmission', formId: 'form-123' }
 *   ],
 *   actions: [
 *     { type: 'sendEmail', emailId: 'welcome-email' },
 *     { type: 'delay', delayType: 'fixed', duration: 86400000 },
 *     { type: 'setProperty', property: 'lifecyclestage', value: 'lead' }
 *   ]
 * })
 *
 * // Activate the workflow
 * await workflows.resumeWorkflow(workflow.id)
 *
 * // Enroll contacts
 * await workflows.enrollContact(workflow.id, 'contact-456')
 * ```
 */
export class HubSpotWorkflows {
  private storage: WorkflowStorage
  private config: HubSpotWorkflowsConfig
  private _fetch: typeof fetch
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private executionQueue: Array<{ enrollmentId: string; actionId: string }> = []
  private processing = false

  constructor(config: HubSpotWorkflowsConfig) {
    if (!config.accessToken) {
      throw new HubSpotWorkflowError('Access token is required', 'INVALID_CONFIG', 400)
    }

    this.config = config
    this.storage = config.storage ?? new InMemoryStorage()
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)
  }

  // ===========================================================================
  // WORKFLOW CRUD
  // ===========================================================================

  /**
   * Create a new workflow
   */
  async createWorkflow(input: CreateWorkflowInput): Promise<Workflow> {
    // Validate required fields
    if (!input.name || input.name.trim() === '') {
      throw new HubSpotWorkflowError('Workflow name is required', 'INVALID_INPUT', 400)
    }

    // Validate workflow type
    const validTypes: WorkflowType[] = ['contact', 'company', 'deal', 'ticket', 'custom']
    if (!validTypes.includes(input.type)) {
      throw new HubSpotWorkflowError(
        `Invalid workflow type: ${input.type}. Must be one of: ${validTypes.join(', ')}`,
        'INVALID_INPUT',
        400
      )
    }

    // Validate at least one enrollment trigger
    if (!input.enrollmentTriggers || input.enrollmentTriggers.length === 0) {
      throw new HubSpotWorkflowError(
        'At least one enrollment trigger is required',
        'INVALID_INPUT',
        400
      )
    }

    // Validate enrollment triggers
    const validTriggerTypes: EnrollmentTriggerType[] = [
      'formSubmission', 'listMembership', 'propertyChange', 'pageView', 'event', 'manual', 'api'
    ]
    for (const trigger of input.enrollmentTriggers) {
      if (!validTriggerTypes.includes(trigger.type)) {
        throw new HubSpotWorkflowError(
          `Invalid trigger type: ${trigger.type}. Must be one of: ${validTriggerTypes.join(', ')}`,
          'INVALID_INPUT',
          400
        )
      }

      // Validate specific trigger requirements
      switch (trigger.type) {
        case 'formSubmission':
          if (!('formId' in trigger) || !trigger.formId) {
            throw new HubSpotWorkflowError(
              'Form submission trigger requires formId',
              'INVALID_INPUT',
              400
            )
          }
          break
        case 'listMembership':
          if (!('listId' in trigger) || !trigger.listId) {
            throw new HubSpotWorkflowError(
              'List membership trigger requires listId',
              'INVALID_INPUT',
              400
            )
          }
          break
        case 'propertyChange':
          if (!('property' in trigger) || !trigger.property) {
            throw new HubSpotWorkflowError(
              'Property change trigger requires property name',
              'INVALID_INPUT',
              400
            )
          }
          break
        case 'event':
          if (!('eventName' in trigger) || !trigger.eventName) {
            throw new HubSpotWorkflowError(
              'Event trigger requires eventName',
              'INVALID_INPUT',
              400
            )
          }
          break
      }
    }

    // Validate actions
    const validActionTypes: WorkflowActionType[] = [
      'setProperty', 'sendEmail', 'delay', 'branch', 'webhook', 'createTask',
      'notification', 'createRecord', 'updateRecord', 'copyProperty', 'clearProperty',
      'incrementProperty', 'rotate', 'randomSplit', 'goalReached'
    ]
    for (const action of input.actions) {
      if (!validActionTypes.includes(action.type)) {
        throw new HubSpotWorkflowError(
          `Invalid action type: ${action.type}. Must be one of: ${validActionTypes.join(', ')}`,
          'INVALID_INPUT',
          400
        )
      }

      // Validate specific action requirements
      switch (action.type) {
        case 'sendEmail':
          if (!('emailId' in action) || !action.emailId) {
            throw new HubSpotWorkflowError(
              'Send email action requires emailId',
              'INVALID_INPUT',
              400
            )
          }
          break
        case 'setProperty':
          if (!('property' in action) || !action.property) {
            throw new HubSpotWorkflowError(
              'Set property action requires property name',
              'INVALID_INPUT',
              400
            )
          }
          break
        case 'webhook':
          if (!('url' in action) || !action.url) {
            throw new HubSpotWorkflowError(
              'Webhook action requires url',
              'INVALID_INPUT',
              400
            )
          }
          break
        case 'createTask':
          if (!('title' in action) || !action.title) {
            throw new HubSpotWorkflowError(
              'Create task action requires title',
              'INVALID_INPUT',
              400
            )
          }
          break
        case 'notification':
          if (!('message' in action) || !action.message) {
            throw new HubSpotWorkflowError(
              'Notification action requires message',
              'INVALID_INPUT',
              400
            )
          }
          break
      }
    }

    const id = `wf-${crypto.randomUUID()}`
    const now = new Date().toISOString()

    // Convert input triggers to full trigger objects
    const enrollmentTriggers: EnrollmentTrigger[] = input.enrollmentTriggers.map((trigger, index) => ({
      id: `trigger-${index}-${crypto.randomUUID().slice(0, 8)}`,
      type: trigger.type,
      config: trigger as EnrollmentTriggerConfig,
    }))

    // Convert input actions to full action objects
    const actions: WorkflowAction[] = input.actions.map((action, index) => ({
      id: `action-${index}-${crypto.randomUUID().slice(0, 8)}`,
      type: action.type,
      config: action as WorkflowActionConfig,
      order: index,
    }))

    const workflow: Workflow = {
      id,
      name: input.name,
      type: input.type,
      status: 'draft',
      description: input.description,
      enrollmentTriggers,
      actions,
      reenrollmentSettings: {
        allowReenrollment: input.reenrollmentSettings?.allowReenrollment ?? false,
        resetDelay: input.reenrollmentSettings?.resetDelay,
        maxEnrollments: input.reenrollmentSettings?.maxEnrollments,
      },
      goalCriteria: input.goalCriteria,
      settings: {
        timezone: input.settings?.timezone ?? this.config.defaultTimezone ?? 'UTC',
        businessHours: input.settings?.businessHours,
        suppressionLists: input.settings?.suppressionLists,
        excludeFromReporting: input.settings?.excludeFromReporting ?? false,
        executionPriority: input.settings?.executionPriority ?? 'normal',
      },
      createdAt: now,
      updatedAt: now,
      version: 1,
    }

    await this.storage.set(`workflow:${id}`, workflow)
    return workflow
  }

  /**
   * Get a workflow by ID
   */
  async getWorkflow(workflowId: string): Promise<Workflow> {
    const workflow = await this.storage.get<Workflow>(`workflow:${workflowId}`)
    if (!workflow) {
      throw new HubSpotWorkflowError(`Workflow not found: ${workflowId}`, 'NOT_FOUND', 404)
    }
    return workflow
  }

  /**
   * Update an existing workflow
   */
  async updateWorkflow(workflowId: string, updates: UpdateWorkflowInput): Promise<Workflow> {
    const workflow = await this.getWorkflow(workflowId)

    // Cannot update active workflow actions (must pause first)
    if (workflow.status === 'active' && (updates.actions || updates.enrollmentTriggers)) {
      throw new HubSpotWorkflowError(
        'Cannot modify triggers or actions on active workflow. Pause the workflow first.',
        'WORKFLOW_ACTIVE',
        400
      )
    }

    const updatedWorkflow: Workflow = {
      ...workflow,
      name: updates.name ?? workflow.name,
      description: updates.description ?? workflow.description,
      updatedAt: new Date().toISOString(),
      version: workflow.version + 1,
    }

    // Update enrollment triggers if provided
    if (updates.enrollmentTriggers) {
      updatedWorkflow.enrollmentTriggers = updates.enrollmentTriggers.map((trigger, index) => ({
        id: `trigger-${index}-${crypto.randomUUID().slice(0, 8)}`,
        type: trigger.type,
        config: trigger as EnrollmentTriggerConfig,
      }))
    }

    // Update actions if provided
    if (updates.actions) {
      updatedWorkflow.actions = updates.actions.map((action, index) => ({
        id: `action-${index}-${crypto.randomUUID().slice(0, 8)}`,
        type: action.type,
        config: action as WorkflowActionConfig,
        order: index,
      }))
    }

    // Update reenrollment settings if provided
    if (updates.reenrollmentSettings) {
      updatedWorkflow.reenrollmentSettings = {
        ...workflow.reenrollmentSettings,
        ...updates.reenrollmentSettings,
      }
    }

    // Update goal criteria if provided
    if (updates.goalCriteria) {
      updatedWorkflow.goalCriteria = updates.goalCriteria
    }

    // Update settings if provided
    if (updates.settings) {
      updatedWorkflow.settings = {
        ...workflow.settings,
        ...updates.settings,
      }
    }

    await this.storage.set(`workflow:${workflowId}`, updatedWorkflow)
    return updatedWorkflow
  }

  /**
   * Delete a workflow
   */
  async deleteWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.getWorkflow(workflowId)

    // Cannot delete active workflow
    if (workflow.status === 'active') {
      throw new HubSpotWorkflowError(
        'Cannot delete active workflow. Pause the workflow first.',
        'WORKFLOW_ACTIVE',
        400
      )
    }

    // Cancel all active timers for this workflow
    this.cancelWorkflowTimers(workflowId)

    // Delete workflow
    await this.storage.delete(`workflow:${workflowId}`)

    // Delete all enrollments for this workflow
    const enrollments = await this.storage.list<Enrollment>(`enrollment:${workflowId}:`)
    for (const [key] of enrollments) {
      await this.storage.delete(key)
    }

    // Delete all enrollment events
    const events = await this.storage.list<EnrollmentEvent>(`event:${workflowId}:`)
    for (const [key] of events) {
      await this.storage.delete(key)
    }
  }

  /**
   * List workflows with optional filters
   */
  async listWorkflows(options: ListWorkflowsOptions = {}): Promise<{
    workflows: Workflow[]
    total: number
    limit: number
    offset: number
  }> {
    const allWorkflows = await this.storage.list<Workflow>('workflow:')
    let workflows = Array.from(allWorkflows.values())

    // Apply filters
    if (options.type) {
      workflows = workflows.filter((w) => w.type === options.type)
    }
    if (options.status) {
      workflows = workflows.filter((w) => w.status === options.status)
    }

    // Sort by updatedAt descending
    workflows.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

    const total = workflows.length
    const limit = options.limit ?? 50
    const offset = options.offset ?? 0

    // Apply pagination
    workflows = workflows.slice(offset, offset + limit)

    return { workflows, total, limit, offset }
  }

  /**
   * Clone a workflow
   */
  async cloneWorkflow(workflowId: string, newName: string): Promise<Workflow> {
    const original = await this.getWorkflow(workflowId)

    const cloneInput: CreateWorkflowInput = {
      name: newName,
      type: original.type,
      description: original.description ? `Clone of: ${original.description}` : `Clone of ${original.name}`,
      enrollmentTriggers: original.enrollmentTriggers.map((t) => ({
        ...t.config,
        type: t.type,
      })),
      actions: original.actions.map((a) => ({
        ...a.config,
        type: a.type,
      })),
      reenrollmentSettings: original.reenrollmentSettings,
      goalCriteria: original.goalCriteria,
      settings: original.settings,
    }

    return this.createWorkflow(cloneInput)
  }

  // ===========================================================================
  // ENROLLMENT TRIGGERS
  // ===========================================================================

  /**
   * Set enrollment criteria for a workflow
   */
  async setEnrollmentCriteria(
    workflowId: string,
    criteria: Array<Omit<EnrollmentTriggerConfig, 'type'> & { type: EnrollmentTriggerType }>
  ): Promise<Workflow> {
    return this.updateWorkflow(workflowId, { enrollmentTriggers: criteria })
  }

  /**
   * Add an enrollment filter to a workflow
   */
  async addEnrollmentFilter(
    workflowId: string,
    filter: Omit<EnrollmentTriggerConfig, 'type'> & { type: EnrollmentTriggerType }
  ): Promise<EnrollmentTrigger> {
    const workflow = await this.getWorkflow(workflowId)

    if (workflow.status === 'active') {
      throw new HubSpotWorkflowError(
        'Cannot modify triggers on active workflow. Pause the workflow first.',
        'WORKFLOW_ACTIVE',
        400
      )
    }

    const newTrigger: EnrollmentTrigger = {
      id: `trigger-${workflow.enrollmentTriggers.length}-${crypto.randomUUID().slice(0, 8)}`,
      type: filter.type,
      config: filter as EnrollmentTriggerConfig,
    }

    workflow.enrollmentTriggers.push(newTrigger)
    workflow.updatedAt = new Date().toISOString()
    workflow.version++

    await this.storage.set(`workflow:${workflowId}`, workflow)
    return newTrigger
  }

  /**
   * Remove an enrollment filter from a workflow
   */
  async removeEnrollmentFilter(workflowId: string, filterId: string): Promise<void> {
    const workflow = await this.getWorkflow(workflowId)

    if (workflow.status === 'active') {
      throw new HubSpotWorkflowError(
        'Cannot modify triggers on active workflow. Pause the workflow first.',
        'WORKFLOW_ACTIVE',
        400
      )
    }

    const index = workflow.enrollmentTriggers.findIndex((t) => t.id === filterId)
    if (index === -1) {
      throw new HubSpotWorkflowError(`Trigger not found: ${filterId}`, 'NOT_FOUND', 404)
    }

    workflow.enrollmentTriggers.splice(index, 1)
    workflow.updatedAt = new Date().toISOString()
    workflow.version++

    await this.storage.set(`workflow:${workflowId}`, workflow)
  }

  /**
   * Update reenrollment settings for a workflow
   */
  async reenrollmentSettings(
    workflowId: string,
    settings: Partial<ReenrollmentSettings>
  ): Promise<ReenrollmentSettings> {
    const workflow = await this.getWorkflow(workflowId)

    workflow.reenrollmentSettings = {
      ...workflow.reenrollmentSettings,
      ...settings,
    }
    workflow.updatedAt = new Date().toISOString()
    workflow.version++

    await this.storage.set(`workflow:${workflowId}`, workflow)
    return workflow.reenrollmentSettings
  }

  // ===========================================================================
  // WORKFLOW ACTIONS
  // ===========================================================================

  /**
   * Add an action to a workflow
   */
  async addAction(
    workflowId: string,
    action: Omit<WorkflowActionConfig, 'type'> & { type: WorkflowActionType }
  ): Promise<WorkflowAction> {
    const workflow = await this.getWorkflow(workflowId)

    if (workflow.status === 'active') {
      throw new HubSpotWorkflowError(
        'Cannot modify actions on active workflow. Pause the workflow first.',
        'WORKFLOW_ACTIVE',
        400
      )
    }

    const newAction: WorkflowAction = {
      id: `action-${workflow.actions.length}-${crypto.randomUUID().slice(0, 8)}`,
      type: action.type,
      config: action as WorkflowActionConfig,
      order: workflow.actions.length,
    }

    workflow.actions.push(newAction)
    workflow.updatedAt = new Date().toISOString()
    workflow.version++

    await this.storage.set(`workflow:${workflowId}`, workflow)
    return newAction
  }

  /**
   * Update an action in a workflow
   */
  async updateAction(
    workflowId: string,
    actionId: string,
    updates: Partial<Omit<WorkflowActionConfig, 'type'> & { type: WorkflowActionType }>
  ): Promise<WorkflowAction> {
    const workflow = await this.getWorkflow(workflowId)

    if (workflow.status === 'active') {
      throw new HubSpotWorkflowError(
        'Cannot modify actions on active workflow. Pause the workflow first.',
        'WORKFLOW_ACTIVE',
        400
      )
    }

    const actionIndex = workflow.actions.findIndex((a) => a.id === actionId)
    if (actionIndex === -1) {
      throw new HubSpotWorkflowError(`Action not found: ${actionId}`, 'NOT_FOUND', 404)
    }

    const action = workflow.actions[actionIndex]
    const updatedAction: WorkflowAction = {
      ...action,
      config: { ...action.config, ...updates } as WorkflowActionConfig,
    }

    workflow.actions[actionIndex] = updatedAction
    workflow.updatedAt = new Date().toISOString()
    workflow.version++

    await this.storage.set(`workflow:${workflowId}`, workflow)
    return updatedAction
  }

  /**
   * Remove an action from a workflow
   */
  async removeAction(workflowId: string, actionId: string): Promise<void> {
    const workflow = await this.getWorkflow(workflowId)

    if (workflow.status === 'active') {
      throw new HubSpotWorkflowError(
        'Cannot modify actions on active workflow. Pause the workflow first.',
        'WORKFLOW_ACTIVE',
        400
      )
    }

    const index = workflow.actions.findIndex((a) => a.id === actionId)
    if (index === -1) {
      throw new HubSpotWorkflowError(`Action not found: ${actionId}`, 'NOT_FOUND', 404)
    }

    workflow.actions.splice(index, 1)

    // Reorder remaining actions
    workflow.actions.forEach((action, i) => {
      action.order = i
    })

    workflow.updatedAt = new Date().toISOString()
    workflow.version++

    await this.storage.set(`workflow:${workflowId}`, workflow)
  }

  /**
   * Reorder actions in a workflow
   */
  async reorderActions(workflowId: string, actionIds: string[]): Promise<WorkflowAction[]> {
    const workflow = await this.getWorkflow(workflowId)

    if (workflow.status === 'active') {
      throw new HubSpotWorkflowError(
        'Cannot modify actions on active workflow. Pause the workflow first.',
        'WORKFLOW_ACTIVE',
        400
      )
    }

    // Validate all action IDs exist
    const actionMap = new Map(workflow.actions.map((a) => [a.id, a]))
    for (const id of actionIds) {
      if (!actionMap.has(id)) {
        throw new HubSpotWorkflowError(`Action not found: ${id}`, 'NOT_FOUND', 404)
      }
    }

    // Check for missing actions
    if (actionIds.length !== workflow.actions.length) {
      throw new HubSpotWorkflowError(
        'Action IDs must include all workflow actions',
        'INVALID_INPUT',
        400
      )
    }

    // Reorder actions
    workflow.actions = actionIds.map((id, index) => {
      const action = actionMap.get(id)!
      return { ...action, order: index }
    })

    workflow.updatedAt = new Date().toISOString()
    workflow.version++

    await this.storage.set(`workflow:${workflowId}`, workflow)
    return workflow.actions
  }

  // ===========================================================================
  // BRANCHING LOGIC
  // ===========================================================================

  /**
   * Create an if-then branch action
   */
  createIfThenBranch(input: IfThenBranchInput): {
    branchAction: Omit<BranchAction, 'type'> & { type: 'branch' }
    thenActions: Array<Omit<WorkflowActionConfig, 'type'> & { type: WorkflowActionType }>
    elseActions: Array<Omit<WorkflowActionConfig, 'type'> & { type: WorkflowActionType }>
  } {
    const branchId = `branch-${crypto.randomUUID().slice(0, 8)}`

    const branchAction: Omit<BranchAction, 'type'> & { type: 'branch' } = {
      type: 'branch',
      branchType: 'if-then',
      condition: input.condition,
    }

    // Tag actions with branch info
    const thenActions = input.thenActions.map((action) => ({
      ...action,
      parentBranchId: branchId,
      branchPath: 'then' as const,
    }))

    const elseActions = (input.elseActions ?? []).map((action) => ({
      ...action,
      parentBranchId: branchId,
      branchPath: 'else' as const,
    }))

    return { branchAction, thenActions, elseActions }
  }

  /**
   * Create a value-based branch action
   */
  createValueBranch(input: ValueBranchInput): {
    branchAction: Omit<BranchAction, 'type'> & { type: 'branch' }
    branchActions: Record<string, Array<Omit<WorkflowActionConfig, 'type'> & { type: WorkflowActionType }>>
  } {
    const branchAction: Omit<BranchAction, 'type'> & { type: 'branch' } = {
      type: 'branch',
      branchType: 'value',
      condition: { property: input.property, operator: 'eq', value: null },
      branches: input.branches.map((b) => ({
        id: `vbranch-${crypto.randomUUID().slice(0, 8)}`,
        value: b.value,
        label: b.label,
      })),
    }

    const branchActions: Record<string, Array<Omit<WorkflowActionConfig, 'type'> & { type: WorkflowActionType }>> = {}

    input.branches.forEach((branch, index) => {
      const branchId = branchAction.branches![index].id
      branchActions[branchId] = branch.actions.map((action) => ({
        ...action,
        parentBranchId: branchAction.branches![index].id,
        branchPath: branchId,
      }))
    })

    return { branchAction, branchActions }
  }

  /**
   * Create a random split branch action
   */
  createRandomBranch(input: RandomBranchInput): {
    branchAction: Omit<BranchAction, 'type'> & { type: 'branch' }
    splitActions: Record<string, Array<Omit<WorkflowActionConfig, 'type'> & { type: WorkflowActionType }>>
  } {
    // Validate percentages sum to 100
    const totalPercentage = input.splits.reduce((sum, s) => sum + s.percentage, 0)
    if (Math.abs(totalPercentage - 100) > 0.01) {
      throw new HubSpotWorkflowError(
        'Random split percentages must sum to 100',
        'INVALID_INPUT',
        400
      )
    }

    const branchAction: Omit<BranchAction, 'type'> & { type: 'branch' } = {
      type: 'branch',
      branchType: 'random',
      splits: input.splits.map((s) => ({
        id: `split-${crypto.randomUUID().slice(0, 8)}`,
        percentage: s.percentage,
        label: s.label,
      })),
    }

    const splitActions: Record<string, Array<Omit<WorkflowActionConfig, 'type'> & { type: WorkflowActionType }>> = {}

    input.splits.forEach((split, index) => {
      const splitId = branchAction.splits![index].id
      splitActions[splitId] = split.actions.map((action) => ({
        ...action,
        parentBranchId: branchAction.splits![index].id,
        branchPath: splitId,
      }))
    })

    return { branchAction, splitActions }
  }

  // ===========================================================================
  // DELAYS & SCHEDULING
  // ===========================================================================

  /**
   * Create a delay action
   */
  addDelay(config: {
    type: DelayType
    duration?: number
    until?: ScheduleActionInput
    businessHours?: BusinessHoursInput
  }): Omit<DelayAction, 'type'> & { type: 'delay' } {
    const action: DelayAction = {
      type: 'delay',
      delayType: config.type,
    }

    if (config.type === 'fixed' && config.duration) {
      action.duration = config.duration
    } else if (config.type === 'until' && config.until) {
      action.until = {
        date: config.until.date,
        dayOfWeek: config.until.dayOfWeek,
        time: config.until.time,
        timezone: config.until.timezone ?? this.config.defaultTimezone ?? 'UTC',
      }
    } else if (config.type === 'businessHours' && config.businessHours) {
      action.businessHours = config.businessHours
    }

    return action
  }

  /**
   * Create a scheduled action
   */
  scheduleAction(schedule: ScheduleActionInput): Omit<DelayAction, 'type'> & { type: 'delay' } {
    return this.addDelay({
      type: 'until',
      until: schedule,
    })
  }

  /**
   * Set business hours for a workflow
   */
  async setBusinessHours(workflowId: string, businessHours: BusinessHoursInput): Promise<Workflow> {
    const workflow = await this.getWorkflow(workflowId)

    workflow.settings.businessHours = businessHours.hours
    workflow.settings.timezone = businessHours.timezone
    workflow.updatedAt = new Date().toISOString()
    workflow.version++

    await this.storage.set(`workflow:${workflowId}`, workflow)
    return workflow
  }

  // ===========================================================================
  // WORKFLOW EXECUTION
  // ===========================================================================

  /**
   * Enroll a contact in a workflow
   */
  async enrollContact(workflowId: string, contactId: string, metadata?: Record<string, unknown>): Promise<Enrollment> {
    const workflow = await this.getWorkflow(workflowId)

    // Check workflow is active
    if (workflow.status !== 'active') {
      throw new HubSpotWorkflowError(
        `Cannot enroll in ${workflow.status} workflow`,
        'WORKFLOW_NOT_ACTIVE',
        400
      )
    }

    // Check for existing enrollment
    const existingEnrollment = await this.storage.get<Enrollment>(
      `enrollment:${workflowId}:${contactId}`
    )

    if (existingEnrollment && existingEnrollment.status === 'active') {
      throw new HubSpotWorkflowError(
        'Contact is already enrolled in this workflow',
        'ALREADY_ENROLLED',
        400
      )
    }

    // Check reenrollment settings
    if (existingEnrollment && !workflow.reenrollmentSettings.allowReenrollment) {
      throw new HubSpotWorkflowError(
        'Reenrollment is not allowed for this workflow',
        'REENROLLMENT_DISABLED',
        400
      )
    }

    // Check max enrollments
    if (existingEnrollment && workflow.reenrollmentSettings.maxEnrollments) {
      const enrollmentCount = await this.getEnrollmentCount(workflowId, contactId)
      if (enrollmentCount >= workflow.reenrollmentSettings.maxEnrollments) {
        throw new HubSpotWorkflowError(
          `Maximum enrollments (${workflow.reenrollmentSettings.maxEnrollments}) reached`,
          'MAX_ENROLLMENTS_REACHED',
          400
        )
      }
    }

    // Check reset delay
    if (existingEnrollment && workflow.reenrollmentSettings.resetDelay) {
      const lastCompletedAt = existingEnrollment.completedAt ?? existingEnrollment.unenrolledAt
      if (lastCompletedAt) {
        const elapsed = Date.now() - new Date(lastCompletedAt).getTime()
        if (elapsed < workflow.reenrollmentSettings.resetDelay) {
          throw new HubSpotWorkflowError(
            'Reset delay period has not elapsed',
            'RESET_DELAY_NOT_ELAPSED',
            400
          )
        }
      }
    }

    // Create enrollment
    const enrollment: Enrollment = {
      id: `enroll-${crypto.randomUUID()}`,
      workflowId,
      workflowVersion: workflow.version,
      contactId,
      status: 'active',
      currentActionId: workflow.actions[0]?.id,
      completedActions: [],
      branchPath: {},
      enrolledAt: new Date().toISOString(),
      metadata,
    }

    await this.storage.set(`enrollment:${workflowId}:${contactId}`, enrollment)

    // Increment enrollment count for max enrollments tracking
    await this.incrementEnrollmentCount(workflowId, contactId)

    // Start execution
    if (workflow.actions.length > 0) {
      this.queueActionExecution(enrollment.id, workflow.actions[0].id)
    } else {
      // No actions - mark as completed
      enrollment.status = 'completed'
      enrollment.completedAt = new Date().toISOString()
      await this.storage.set(`enrollment:${workflowId}:${contactId}`, enrollment)
    }

    return enrollment
  }

  /**
   * Unenroll a contact from a workflow
   */
  async unenrollContact(workflowId: string, contactId: string): Promise<void> {
    const enrollment = await this.storage.get<Enrollment>(`enrollment:${workflowId}:${contactId}`)

    if (!enrollment) {
      throw new HubSpotWorkflowError('Enrollment not found', 'NOT_FOUND', 404)
    }

    if (enrollment.status !== 'active') {
      throw new HubSpotWorkflowError(
        `Cannot unenroll - enrollment status is ${enrollment.status}`,
        'INVALID_STATUS',
        400
      )
    }

    // Cancel any pending timers for this enrollment
    this.cancelEnrollmentTimers(enrollment.id)

    enrollment.status = 'unenrolled'
    enrollment.unenrolledAt = new Date().toISOString()

    await this.storage.set(`enrollment:${workflowId}:${contactId}`, enrollment)
  }

  /**
   * Pause a workflow
   */
  async pauseWorkflow(workflowId: string): Promise<Workflow> {
    const workflow = await this.getWorkflow(workflowId)

    if (workflow.status !== 'active') {
      throw new HubSpotWorkflowError(
        `Cannot pause ${workflow.status} workflow`,
        'INVALID_STATUS',
        400
      )
    }

    workflow.status = 'paused'
    workflow.updatedAt = new Date().toISOString()

    // Cancel all timers for this workflow
    this.cancelWorkflowTimers(workflowId)

    await this.storage.set(`workflow:${workflowId}`, workflow)
    return workflow
  }

  /**
   * Resume a workflow
   */
  async resumeWorkflow(workflowId: string): Promise<Workflow> {
    const workflow = await this.getWorkflow(workflowId)

    if (workflow.status !== 'paused' && workflow.status !== 'draft' && workflow.status !== 'inactive') {
      throw new HubSpotWorkflowError(
        `Cannot resume ${workflow.status} workflow`,
        'INVALID_STATUS',
        400
      )
    }

    workflow.status = 'active'
    workflow.updatedAt = new Date().toISOString()

    await this.storage.set(`workflow:${workflowId}`, workflow)

    // Resume active enrollments
    const enrollments = await this.storage.list<Enrollment>(`enrollment:${workflowId}:`)
    for (const [, enrollment] of enrollments) {
      if (enrollment.status === 'active' && enrollment.currentActionId) {
        this.queueActionExecution(enrollment.id, enrollment.currentActionId)
      }
    }

    return workflow
  }

  /**
   * Get workflow execution history
   */
  async getWorkflowHistory(
    workflowId: string,
    options: HistoryOptions = {}
  ): Promise<{
    enrollments: Enrollment[]
    events: EnrollmentEvent[]
    total: number
  }> {
    const workflow = await this.getWorkflow(workflowId)

    // Get enrollments
    const enrollmentMap = await this.storage.list<Enrollment>(`enrollment:${workflowId}:`)
    let enrollments = Array.from(enrollmentMap.values())

    // Apply date filters
    if (options.startDate) {
      const start = new Date(options.startDate).getTime()
      enrollments = enrollments.filter((e) => new Date(e.enrolledAt).getTime() >= start)
    }
    if (options.endDate) {
      const end = new Date(options.endDate).getTime()
      enrollments = enrollments.filter((e) => new Date(e.enrolledAt).getTime() <= end)
    }

    // Sort by enrolledAt descending
    enrollments.sort((a, b) => new Date(b.enrolledAt).getTime() - new Date(a.enrolledAt).getTime())

    const total = enrollments.length

    // Apply pagination
    const limit = options.limit ?? 50
    const offset = options.offset ?? 0
    enrollments = enrollments.slice(offset, offset + limit)

    // Get events for these enrollments
    const events: EnrollmentEvent[] = []
    for (const enrollment of enrollments) {
      const eventMap = await this.storage.list<EnrollmentEvent>(`event:${workflowId}:${enrollment.id}:`)
      events.push(...eventMap.values())
    }

    // Sort events by timestamp
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    return { enrollments, events, total }
  }

  // ===========================================================================
  // WORKFLOW ANALYTICS
  // ===========================================================================

  /**
   * Get workflow statistics
   */
  async getWorkflowStats(workflowId: string): Promise<WorkflowStats> {
    const workflow = await this.getWorkflow(workflowId)

    const enrollmentMap = await this.storage.list<Enrollment>(`enrollment:${workflowId}:`)
    const enrollments = Array.from(enrollmentMap.values())

    const activeEnrollments = enrollments.filter((e) => e.status === 'active').length
    const completedEnrollments = enrollments.filter((e) => e.status === 'completed').length
    const failedEnrollments = enrollments.filter((e) => e.status === 'failed').length

    // Calculate average completion time
    const completedWithTime = enrollments.filter((e) => e.status === 'completed' && e.completedAt)
    const totalCompletionTime = completedWithTime.reduce((sum, e) => {
      return sum + (new Date(e.completedAt!).getTime() - new Date(e.enrolledAt).getTime())
    }, 0)
    const averageCompletionTime = completedWithTime.length > 0
      ? totalCompletionTime / completedWithTime.length
      : 0

    // Calculate conversion rate (goal reached / total completed)
    const goalReached = workflow.goalCriteria
      ? completedEnrollments // Simplified - would need to track goal completion
      : 0
    const conversionRate = enrollments.length > 0
      ? (goalReached / enrollments.length) * 100
      : 0

    return {
      workflowId,
      totalEnrollments: enrollments.length,
      activeEnrollments,
      completedEnrollments,
      failedEnrollments,
      averageCompletionTime,
      conversionRate,
      goalReachedCount: goalReached,
    }
  }

  /**
   * Get enrollment statistics for a period
   */
  async getEnrollmentStats(workflowId: string, options: StatsOptions = {}): Promise<EnrollmentStats> {
    const workflow = await this.getWorkflow(workflowId)

    const enrollmentMap = await this.storage.list<Enrollment>(`enrollment:${workflowId}:`)
    let enrollments = Array.from(enrollmentMap.values())

    // Get period boundaries
    const now = new Date()
    let startDate: Date
    let endDate = now

    switch (options.period ?? 'month') {
      case 'day':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        break
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1)
        break
      case 'quarter':
        const quarter = Math.floor(now.getMonth() / 3)
        startDate = new Date(now.getFullYear(), quarter * 3, 1)
        break
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1)
        break
    }

    // Override with custom dates if provided
    if (options.startDate) startDate = new Date(options.startDate)
    if (options.endDate) endDate = new Date(options.endDate)

    // Filter by period
    enrollments = enrollments.filter((e) => {
      const enrolledAt = new Date(e.enrolledAt).getTime()
      return enrolledAt >= startDate.getTime() && enrolledAt <= endDate.getTime()
    })

    // Count by status
    const completions = enrollments.filter((e) => e.status === 'completed').length
    const failures = enrollments.filter((e) => e.status === 'failed').length
    const unenrollments = enrollments.filter((e) => e.status === 'unenrolled').length

    // Count by trigger type (would need to track this at enrollment time)
    const byTrigger: Record<string, number> = {}
    for (const trigger of workflow.enrollmentTriggers) {
      byTrigger[trigger.type] = enrollments.length // Simplified
    }

    return {
      period: options.period ?? 'month',
      enrollments: enrollments.length,
      completions,
      failures,
      unenrollments,
      byTrigger,
    }
  }

  /**
   * Get action performance metrics
   */
  async getActionPerformance(workflowId: string): Promise<ActionPerformance[]> {
    const workflow = await this.getWorkflow(workflowId)

    const performance: ActionPerformance[] = []

    for (const action of workflow.actions) {
      // Get events for this action
      const eventMap = await this.storage.list<EnrollmentEvent>(`event:${workflowId}:`)
      const events = Array.from(eventMap.values()).filter((e) => e.actionId === action.id)

      const executions = events.filter((e) => e.eventType === 'started').length
      const successes = events.filter((e) => e.eventType === 'completed').length
      const failures = events.filter((e) => e.eventType === 'failed').length

      // Calculate average duration
      const completedEvents = events.filter((e) => e.eventType === 'completed')
      const startedEvents = events.filter((e) => e.eventType === 'started')
      let totalDuration = 0
      let durationCount = 0

      for (const completed of completedEvents) {
        const started = startedEvents.find((s) =>
          s.enrollmentId === completed.enrollmentId &&
          s.actionId === completed.actionId
        )
        if (started) {
          totalDuration += new Date(completed.timestamp).getTime() - new Date(started.timestamp).getTime()
          durationCount++
        }
      }

      const averageDuration = durationCount > 0 ? totalDuration / durationCount : 0
      const errorRate = executions > 0 ? (failures / executions) * 100 : 0

      performance.push({
        actionId: action.id,
        actionType: action.type,
        executions,
        successes,
        failures,
        averageDuration,
        errorRate,
      })
    }

    return performance
  }

  /**
   * Get conversion rate for a workflow
   */
  async getConversionRate(workflowId: string): Promise<{
    rate: number
    total: number
    converted: number
    goalCriteria?: GoalCriteria
  }> {
    const stats = await this.getWorkflowStats(workflowId)
    const workflow = await this.getWorkflow(workflowId)

    return {
      rate: stats.conversionRate,
      total: stats.totalEnrollments,
      converted: stats.goalReachedCount,
      goalCriteria: workflow.goalCriteria,
    }
  }

  // ===========================================================================
  // PRIVATE METHODS - Execution Engine
  // ===========================================================================

  private queueActionExecution(enrollmentId: string, actionId: string): void {
    this.executionQueue.push({ enrollmentId, actionId })
    // Use setTimeout to make queue processing truly async (allows tests to verify intermediate states)
    setTimeout(() => this.processQueue(), 0)
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return
    this.processing = true

    try {
      while (this.executionQueue.length > 0) {
        const item = this.executionQueue.shift()!
        await this.executeAction(item.enrollmentId, item.actionId)
      }
    } finally {
      this.processing = false
    }
  }

  private async executeAction(enrollmentId: string, actionId: string): Promise<void> {
    // Find enrollment
    const allEnrollments = await this.storage.list<Enrollment>('enrollment:')
    let enrollment: Enrollment | undefined
    let enrollmentKey: string | undefined

    for (const [key, e] of allEnrollments) {
      if (e.id === enrollmentId) {
        enrollment = e
        enrollmentKey = key
        break
      }
    }

    if (!enrollment || !enrollmentKey) return
    if (enrollment.status !== 'active') return

    const workflow = await this.storage.get<Workflow>(`workflow:${enrollment.workflowId}`)
    if (!workflow || workflow.status !== 'active') return

    const action = workflow.actions.find((a) => a.id === actionId)
    if (!action) return

    // Record start event
    await this.recordEvent(enrollment, action, 'started')

    try {
      // Execute action based on type
      const result = await this.executeActionByType(enrollment, action, workflow)

      // Record completion event
      await this.recordEvent(enrollment, action, 'completed', result)

      // Update enrollment
      enrollment.completedActions.push(actionId)

      // Determine next action
      const nextAction = await this.getNextAction(workflow, enrollment, action, result)

      if (nextAction) {
        enrollment.currentActionId = nextAction.id
        await this.storage.set(enrollmentKey, enrollment)

        // If it's a delay action, schedule the next execution
        if (action.type === 'delay') {
          const delay = this.calculateDelay(action.config as DelayAction, workflow.settings)
          this.scheduleExecution(enrollmentId, nextAction.id, delay)
        } else {
          // Execute next action immediately
          this.queueActionExecution(enrollmentId, nextAction.id)
        }
      } else {
        // No more actions - mark as completed
        enrollment.status = 'completed'
        enrollment.completedAt = new Date().toISOString()
        enrollment.currentActionId = undefined
        await this.storage.set(enrollmentKey, enrollment)
      }
    } catch (error) {
      // Record failure
      const errorMessage = error instanceof Error ? error.message : String(error)
      await this.recordEvent(enrollment, action, 'failed', undefined, errorMessage)

      enrollment.status = 'failed'
      enrollment.failedAt = new Date().toISOString()
      enrollment.error = errorMessage
      await this.storage.set(enrollmentKey, enrollment)
    }
  }

  private async executeActionByType(
    enrollment: Enrollment,
    action: WorkflowAction,
    workflow: Workflow
  ): Promise<unknown> {
    switch (action.type) {
      case 'setProperty':
        return this.executeSetProperty(enrollment, action.config as SetPropertyAction)

      case 'sendEmail':
        return this.executeSendEmail(enrollment, action.config as SendEmailAction)

      case 'delay':
        // Delay is handled by scheduling, just return
        return { delayed: true }

      case 'branch':
        return this.executeBranch(enrollment, action.config as BranchAction)

      case 'webhook':
        return this.executeWebhook(enrollment, action.config as WebhookAction)

      case 'createTask':
        return this.executeCreateTask(enrollment, action.config as CreateTaskAction)

      case 'notification':
        return this.executeNotification(enrollment, action.config as NotificationAction)

      case 'createRecord':
        return this.executeCreateRecord(enrollment, action.config as CreateRecordAction)

      case 'updateRecord':
        return this.executeUpdateRecord(enrollment, action.config as UpdateRecordAction)

      case 'copyProperty':
        return this.executeCopyProperty(enrollment, action.config as CopyPropertyAction)

      case 'clearProperty':
        return this.executeClearProperty(enrollment, action.config as ClearPropertyAction)

      case 'incrementProperty':
        return this.executeIncrementProperty(enrollment, action.config as IncrementPropertyAction)

      case 'rotate':
        return this.executeRotate(enrollment, action.config as RotateAction)

      case 'randomSplit':
        return this.executeRandomSplit(enrollment, action.config as RandomSplitAction)

      case 'goalReached':
        return this.executeGoalReached(enrollment, action.config as GoalReachedAction)

      default:
        throw new Error(`Unknown action type: ${action.type}`)
    }
  }

  // Action executors
  private async executeSetProperty(
    enrollment: Enrollment,
    config: SetPropertyAction
  ): Promise<{ property: string; value: unknown }> {
    // In a real implementation, this would call the HubSpot API
    // For now, we just return the result
    return {
      property: config.property,
      value: config.value,
    }
  }

  private async executeSendEmail(
    enrollment: Enrollment,
    config: SendEmailAction
  ): Promise<{ emailId: string; sent: boolean }> {
    // In a real implementation, this would call the HubSpot Email API
    return {
      emailId: config.emailId,
      sent: true,
    }
  }

  private async executeBranch(
    enrollment: Enrollment,
    config: BranchAction
  ): Promise<{ branchType: string; selectedBranch: string }> {
    let selectedBranch: string

    switch (config.branchType) {
      case 'if-then':
        // Evaluate condition (simplified - would need actual property values)
        const conditionMet = await this.evaluateCondition(enrollment, config.condition!)
        selectedBranch = conditionMet ? 'then' : 'else'
        break

      case 'value':
        // Select branch based on value (simplified)
        selectedBranch = config.branches?.[0]?.id ?? 'default'
        break

      case 'random':
        // Random selection based on percentages
        const rand = Math.random() * 100
        let cumulative = 0
        selectedBranch = config.splits?.[config.splits.length - 1]?.id ?? 'default'

        for (const split of config.splits ?? []) {
          cumulative += split.percentage
          if (rand <= cumulative) {
            selectedBranch = split.id
            break
          }
        }
        break

      default:
        selectedBranch = 'default'
    }

    // Store branch path in enrollment
    enrollment.branchPath = enrollment.branchPath ?? {}
    enrollment.branchPath[config.branchType] = selectedBranch

    return {
      branchType: config.branchType,
      selectedBranch,
    }
  }

  private async executeWebhook(
    enrollment: Enrollment,
    config: WebhookAction
  ): Promise<{ status: number; response: unknown }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers,
    }

    // Add authentication
    if (config.authentication) {
      switch (config.authentication.type) {
        case 'bearer':
          headers['Authorization'] = `Bearer ${config.authentication.token}`
          break
        case 'basic':
          const encoded = btoa(`${config.authentication.username}:${config.authentication.password}`)
          headers['Authorization'] = `Basic ${encoded}`
          break
        case 'apiKey':
          headers[config.authentication.headerName ?? 'X-API-Key'] = config.authentication.apiKey!
          break
      }
    }

    const response = await this._fetch(config.url, {
      method: config.method,
      headers,
      body: config.body ? JSON.stringify(config.body) : undefined,
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      throw new Error(`Webhook failed with status ${response.status}`)
    }

    return {
      status: response.status,
      response: data,
    }
  }

  private async executeCreateTask(
    enrollment: Enrollment,
    config: CreateTaskAction
  ): Promise<{ taskId: string }> {
    // In a real implementation, this would call the HubSpot Tasks API
    return {
      taskId: `task-${crypto.randomUUID().slice(0, 8)}`,
    }
  }

  private async executeNotification(
    enrollment: Enrollment,
    config: NotificationAction
  ): Promise<{ sent: boolean; recipients: string[] }> {
    // In a real implementation, this would send notifications
    return {
      sent: true,
      recipients: config.recipients,
    }
  }

  private async executeCreateRecord(
    enrollment: Enrollment,
    config: CreateRecordAction
  ): Promise<{ recordId: string; objectType: string }> {
    // In a real implementation, this would call the HubSpot CRM API
    return {
      recordId: `${config.objectType}-${crypto.randomUUID().slice(0, 8)}`,
      objectType: config.objectType,
    }
  }

  private async executeUpdateRecord(
    enrollment: Enrollment,
    config: UpdateRecordAction
  ): Promise<{ updated: boolean }> {
    // In a real implementation, this would call the HubSpot CRM API
    return {
      updated: true,
    }
  }

  private async executeCopyProperty(
    enrollment: Enrollment,
    config: CopyPropertyAction
  ): Promise<{ copied: boolean }> {
    // In a real implementation, this would copy property values
    return {
      copied: true,
    }
  }

  private async executeClearProperty(
    enrollment: Enrollment,
    config: ClearPropertyAction
  ): Promise<{ cleared: boolean }> {
    // In a real implementation, this would clear property values
    return {
      cleared: true,
    }
  }

  private async executeIncrementProperty(
    enrollment: Enrollment,
    config: IncrementPropertyAction
  ): Promise<{ newValue: number }> {
    // In a real implementation, this would increment property values
    return {
      newValue: config.amount,
    }
  }

  private async executeRotate(
    enrollment: Enrollment,
    config: RotateAction
  ): Promise<{ selectedValue: unknown }> {
    // Select next value in rotation
    const index = Math.floor(Math.random() * config.values.length)
    return {
      selectedValue: config.values[index],
    }
  }

  private async executeRandomSplit(
    enrollment: Enrollment,
    config: RandomSplitAction
  ): Promise<{ selectedSplit: string }> {
    const rand = Math.random() * 100
    let cumulative = 0
    let selectedSplit = config.splits[config.splits.length - 1].id

    for (const split of config.splits) {
      cumulative += split.percentage
      if (rand <= cumulative) {
        selectedSplit = split.id
        break
      }
    }

    return { selectedSplit }
  }

  private async executeGoalReached(
    enrollment: Enrollment,
    config: GoalReachedAction
  ): Promise<{ goalId: string; reached: boolean }> {
    // In a real implementation, this would check goal criteria
    return {
      goalId: config.goalId,
      reached: true,
    }
  }

  // Helper methods
  private async evaluateCondition(enrollment: Enrollment, condition: BranchCondition): Promise<boolean> {
    // Simplified condition evaluation
    // In a real implementation, this would fetch actual property values
    return Math.random() > 0.5
  }

  private async getNextAction(
    workflow: Workflow,
    enrollment: Enrollment,
    currentAction: WorkflowAction,
    result: unknown
  ): Promise<WorkflowAction | undefined> {
    const currentIndex = workflow.actions.findIndex((a) => a.id === currentAction.id)
    if (currentIndex === -1 || currentIndex >= workflow.actions.length - 1) {
      return undefined
    }

    // Handle branch actions
    if (currentAction.type === 'branch') {
      const branchResult = result as { selectedBranch: string }
      // Find next action in the selected branch path
      const nextAction = workflow.actions.find(
        (a) => a.parentBranchId === currentAction.id && a.branchPath === branchResult.selectedBranch
      )
      if (nextAction) return nextAction
    }

    // Default: return next action in order
    return workflow.actions[currentIndex + 1]
  }

  private calculateDelay(config: DelayAction, settings: WorkflowSettings): number {
    switch (config.delayType) {
      case 'fixed':
        return config.duration ?? 0

      case 'until':
        if (!config.until) return 0

        const now = new Date()
        let targetDate: Date

        if (config.until.date) {
          targetDate = new Date(config.until.date)
        } else if (config.until.dayOfWeek !== undefined && config.until.time) {
          // Find next occurrence of day/time
          targetDate = this.getNextDayTime(
            config.until.dayOfWeek,
            config.until.time,
            config.until.timezone ?? settings.timezone
          )
        } else if (config.until.time) {
          // Today at specified time
          const [hours, minutes] = config.until.time.split(':').map(Number)
          targetDate = new Date(now)
          targetDate.setHours(hours, minutes, 0, 0)
          if (targetDate <= now) {
            targetDate.setDate(targetDate.getDate() + 1)
          }
        } else {
          return 0
        }

        return Math.max(0, targetDate.getTime() - now.getTime())

      case 'businessHours':
        // Simplified - just return 8 hours if outside business hours
        return 8 * 60 * 60 * 1000

      default:
        return 0
    }
  }

  private getNextDayTime(dayOfWeek: number, time: string, timezone: string): Date {
    const now = new Date()
    const [hours, minutes] = time.split(':').map(Number)

    const targetDate = new Date(now)
    const currentDay = now.getDay()
    let daysUntil = dayOfWeek - currentDay

    if (daysUntil < 0 || (daysUntil === 0 && now.getHours() * 60 + now.getMinutes() >= hours * 60 + minutes)) {
      daysUntil += 7
    }

    targetDate.setDate(targetDate.getDate() + daysUntil)
    targetDate.setHours(hours, minutes, 0, 0)

    return targetDate
  }

  private scheduleExecution(enrollmentId: string, actionId: string, delayMs: number): void {
    const timerId = setTimeout(() => {
      this.timers.delete(`${enrollmentId}:${actionId}`)
      this.queueActionExecution(enrollmentId, actionId)
    }, delayMs)

    this.timers.set(`${enrollmentId}:${actionId}`, timerId)
  }

  private cancelEnrollmentTimers(enrollmentId: string): void {
    for (const [key, timer] of this.timers.entries()) {
      if (key.startsWith(`${enrollmentId}:`)) {
        clearTimeout(timer)
        this.timers.delete(key)
      }
    }
  }

  private cancelWorkflowTimers(workflowId: string): void {
    // Find all enrollment IDs for this workflow and cancel their timers
    // This is a simplified implementation
    for (const [key, timer] of this.timers.entries()) {
      clearTimeout(timer)
    }
    this.timers.clear()
  }

  private async recordEvent(
    enrollment: Enrollment,
    action: WorkflowAction,
    eventType: EnrollmentEvent['eventType'],
    data?: unknown,
    error?: string
  ): Promise<void> {
    const event: EnrollmentEvent = {
      id: `evt-${crypto.randomUUID()}`,
      enrollmentId: enrollment.id,
      actionId: action.id,
      eventType,
      timestamp: new Date().toISOString(),
      data,
      error,
    }

    await this.storage.set(
      `event:${enrollment.workflowId}:${enrollment.id}:${event.id}`,
      event
    )
  }

  private async getEnrollmentCount(workflowId: string, contactId: string): Promise<number> {
    // Get enrollment history count from storage
    const countKey = `enrollment_count:${workflowId}:${contactId}`
    const count = await this.storage.get<number>(countKey)
    return count ?? 0
  }

  private async incrementEnrollmentCount(workflowId: string, contactId: string): Promise<void> {
    const countKey = `enrollment_count:${workflowId}:${contactId}`
    const count = await this.storage.get<number>(countKey) ?? 0
    await this.storage.set(countKey, count + 1)
  }
}

// =============================================================================
// WORKFLOW TEMPLATES
// =============================================================================

/**
 * Template type for common workflow patterns
 */
export type WorkflowTemplateType =
  | 'lead-nurturing'
  | 'welcome-series'
  | 're-engagement'
  | 'deal-stage-automation'
  | 'customer-onboarding'
  | 'abandoned-cart'
  | 'feedback-request'
  | 'subscription-reminder'

/**
 * Template configuration
 */
export interface WorkflowTemplateConfig {
  formId?: string
  listId?: string
  emailIds?: {
    welcome?: string
    followUp?: string
    reminder?: string
    nurture?: string[]
  }
  delays?: {
    initial?: number
    followUp?: number
    reminder?: number
  }
  properties?: Record<string, string>
  customActions?: WorkflowActionConfig[]
}

/**
 * Template action input - more flexible type for template building
 */
type TemplateActionInput = WorkflowActionConfig

/**
 * Template trigger input - more flexible type for template building
 */
type TemplateTriggerInput = EnrollmentTriggerConfig

/**
 * Workflow template factory
 */
export class WorkflowTemplates {
  /**
   * Create a lead nurturing workflow
   *
   * Enrolls contacts after form submission and nurtures them through a series
   * of emails until they become customers.
   */
  static leadNurturing(config: {
    formId: string
    emailIds: string[]
    delayDays?: number
    goalStage?: string
  }): CreateWorkflowInput {
    const delayMs = (config.delayDays ?? 3) * 24 * 60 * 60 * 1000

    const actions: TemplateActionInput[] = []

    for (let i = 0; i < config.emailIds.length; i++) {
      if (i > 0) {
        actions.push({
          type: 'delay',
          delayType: 'fixed',
          duration: delayMs,
        } as DelayAction)
      }
      actions.push({
        type: 'sendEmail',
        emailId: config.emailIds[i],
      } as SendEmailAction)
    }

    // Final action: update lifecycle stage
    actions.push({
      type: 'setProperty',
      property: 'lifecyclestage',
      value: 'marketingqualifiedlead',
    } as SetPropertyAction)

    return {
      name: 'Lead Nurturing Workflow',
      type: 'contact',
      description: `Nurtures leads with ${config.emailIds.length} emails over ${(config.delayDays ?? 3) * config.emailIds.length} days`,
      enrollmentTriggers: [
        { type: 'formSubmission', formId: config.formId } as FormSubmissionTrigger,
      ],
      actions,
      goalCriteria: config.goalStage ? {
        property: 'lifecyclestage',
        operator: 'eq',
        value: config.goalStage,
      } : undefined,
      settings: {
        timezone: 'UTC',
      },
    }
  }

  /**
   * Create a welcome series workflow
   *
   * Sends a series of welcome emails to new contacts over time.
   */
  static welcomeSeries(config: {
    triggerType: 'form' | 'list' | 'property'
    triggerId?: string
    triggerProperty?: string
    triggerValue?: string
    welcomeEmailId: string
    followUpEmailIds?: string[]
    delayHours?: number
  }): CreateWorkflowInput {
    const delayMs = (config.delayHours ?? 24) * 60 * 60 * 1000

    const actions: TemplateActionInput[] = [
      { type: 'sendEmail', emailId: config.welcomeEmailId } as SendEmailAction,
    ]

    for (const emailId of config.followUpEmailIds ?? []) {
      actions.push(
        { type: 'delay', delayType: 'fixed', duration: delayMs } as DelayAction,
        { type: 'sendEmail', emailId } as SendEmailAction
      )
    }

    let enrollmentTriggers: TemplateTriggerInput[]

    switch (config.triggerType) {
      case 'form':
        enrollmentTriggers = [{ type: 'formSubmission', formId: config.triggerId ?? '' } as FormSubmissionTrigger]
        break
      case 'list':
        enrollmentTriggers = [{ type: 'listMembership', listId: config.triggerId ?? '', membership: 'added' } as ListMembershipTrigger]
        break
      case 'property':
        enrollmentTriggers = [{
          type: 'propertyChange',
          property: config.triggerProperty ?? 'email',
          operator: 'eq',
          value: config.triggerValue,
        } as PropertyChangeTrigger]
        break
    }

    return {
      name: 'Welcome Series',
      type: 'contact',
      description: `Welcome series with ${1 + (config.followUpEmailIds?.length ?? 0)} emails`,
      enrollmentTriggers,
      actions,
      settings: { timezone: 'UTC' },
    }
  }

  /**
   * Create a re-engagement workflow
   *
   * Targets contacts who have been inactive for a period of time.
   */
  static reEngagement(config: {
    inactiveDays: number
    emailIds: string[]
    finalAction?: 'unsubscribe' | 'updateProperty'
    finalPropertyValue?: string
  }): CreateWorkflowInput {
    const delayMs = 7 * 24 * 60 * 60 * 1000 // 7 days between emails

    const actions: TemplateActionInput[] = []

    for (let i = 0; i < config.emailIds.length; i++) {
      if (i > 0) {
        actions.push({ type: 'delay', delayType: 'fixed', duration: delayMs } as DelayAction)
      }
      actions.push({ type: 'sendEmail', emailId: config.emailIds[i] } as SendEmailAction)
    }

    // Final action based on config
    if (config.finalAction === 'updateProperty') {
      actions.push({
        type: 'setProperty',
        property: 'hs_lead_status',
        value: config.finalPropertyValue ?? 'UNQUALIFIED',
      } as SetPropertyAction)
    }

    return {
      name: 'Re-engagement Campaign',
      type: 'contact',
      description: `Re-engages contacts inactive for ${config.inactiveDays}+ days`,
      enrollmentTriggers: [
        {
          type: 'propertyChange',
          property: 'hs_last_engagement_date',
          operator: 'lt',
          value: new Date(Date.now() - config.inactiveDays * 24 * 60 * 60 * 1000).toISOString(),
        } as PropertyChangeTrigger,
      ],
      actions,
      settings: { timezone: 'UTC' },
    }
  }

  /**
   * Create a deal stage automation workflow
   *
   * Automates tasks and notifications based on deal stage changes.
   */
  static dealStageAutomation(config: {
    stages: Array<{
      stageId: string
      emailId?: string
      taskTitle?: string
      taskDueDays?: number
      propertyUpdates?: Record<string, string>
      notifyOwner?: boolean
    }>
  }): CreateWorkflowInput {
    const actions: TemplateActionInput[] = []

    // Create branching based on stage
    const branches = config.stages.map((stage) => ({
      value: stage.stageId,
      label: `Stage: ${stage.stageId}`,
    }))

    // Add branch action
    actions.push({
      type: 'branch',
      branchType: 'value',
      condition: { property: 'dealstage', operator: 'eq', value: null },
      branches: branches.map((b, i) => ({
        id: `branch-${i}`,
        value: b.value,
        label: b.label,
      })),
    } as BranchAction)

    // For simplicity in this template, add all stage actions sequentially
    // In practice, these would be branch-specific
    for (const stage of config.stages) {
      if (stage.emailId) {
        actions.push({ type: 'sendEmail', emailId: stage.emailId } as SendEmailAction)
      }
      if (stage.taskTitle) {
        actions.push({
          type: 'createTask',
          title: stage.taskTitle,
          dueDays: stage.taskDueDays ?? 1,
          priority: 'high',
          assignTo: 'owner',
        } as CreateTaskAction)
      }
      if (stage.propertyUpdates) {
        for (const [property, value] of Object.entries(stage.propertyUpdates)) {
          actions.push({ type: 'setProperty', property, value } as SetPropertyAction)
        }
      }
      if (stage.notifyOwner) {
        actions.push({
          type: 'notification',
          notificationType: 'inApp',
          recipients: ['owner'],
          message: `Deal moved to stage: ${stage.stageId}`,
        } as NotificationAction)
      }
    }

    return {
      name: 'Deal Stage Automation',
      type: 'deal',
      description: 'Automates tasks and notifications for deal stage changes',
      enrollmentTriggers: [
        { type: 'propertyChange', property: 'dealstage' } as PropertyChangeTrigger,
      ],
      actions,
      settings: { timezone: 'UTC' },
    }
  }

  /**
   * Create a customer onboarding workflow
   *
   * Guides new customers through onboarding with emails, tasks, and milestones.
   */
  static customerOnboarding(config: {
    welcomeEmailId: string
    checkInEmailIds?: string[]
    milestoneProperty?: string
    taskSequence?: Array<{
      title: string
      dueDays: number
    }>
    completionEmailId?: string
  }): CreateWorkflowInput {
    const actions: TemplateActionInput[] = [
      // Welcome email
      { type: 'sendEmail', emailId: config.welcomeEmailId } as SendEmailAction,

      // Update lifecycle stage
      { type: 'setProperty', property: 'lifecyclestage', value: 'customer' } as SetPropertyAction,
    ]

    // Add task sequence
    for (const task of config.taskSequence ?? []) {
      actions.push({
        type: 'createTask',
        title: task.title,
        dueDays: task.dueDays,
        priority: 'medium',
        assignTo: 'owner',
      } as CreateTaskAction)
    }

    // Add check-in emails with delays
    const delayMs = 7 * 24 * 60 * 60 * 1000 // 1 week
    for (const emailId of config.checkInEmailIds ?? []) {
      actions.push(
        { type: 'delay', delayType: 'fixed', duration: delayMs } as DelayAction,
        { type: 'sendEmail', emailId } as SendEmailAction
      )
    }

    // Completion email
    if (config.completionEmailId) {
      actions.push(
        { type: 'delay', delayType: 'fixed', duration: delayMs } as DelayAction,
        { type: 'sendEmail', emailId: config.completionEmailId } as SendEmailAction,
        {
          type: 'setProperty',
          property: config.milestoneProperty ?? 'onboarding_complete',
          value: 'true',
        } as SetPropertyAction
      )
    }

    return {
      name: 'Customer Onboarding',
      type: 'contact',
      description: 'Guides new customers through onboarding',
      enrollmentTriggers: [
        {
          type: 'propertyChange',
          property: 'lifecyclestage',
          operator: 'eq',
          value: 'customer',
        } as PropertyChangeTrigger,
      ],
      actions,
      goalCriteria: {
        property: config.milestoneProperty ?? 'onboarding_complete',
        operator: 'eq',
        value: 'true',
      },
      settings: { timezone: 'UTC' },
    }
  }

  /**
   * Create an abandoned cart workflow
   *
   * Sends reminder emails to users who abandoned their shopping cart.
   */
  static abandonedCart(config: {
    abandonmentProperty: string
    reminderEmailIds: string[]
    discountEmailId?: string
    discountPercentage?: number
    hoursBetweenEmails?: number
  }): CreateWorkflowInput {
    const delayMs = (config.hoursBetweenEmails ?? 24) * 60 * 60 * 1000

    const actions: TemplateActionInput[] = []

    // First reminder
    actions.push({ type: 'sendEmail', emailId: config.reminderEmailIds[0] } as SendEmailAction)

    // Additional reminders
    for (let i = 1; i < config.reminderEmailIds.length; i++) {
      actions.push(
        { type: 'delay', delayType: 'fixed', duration: delayMs } as DelayAction,
        { type: 'sendEmail', emailId: config.reminderEmailIds[i] } as SendEmailAction
      )
    }

    // Discount email (last resort)
    if (config.discountEmailId) {
      actions.push(
        { type: 'delay', delayType: 'fixed', duration: delayMs } as DelayAction,
        { type: 'sendEmail', emailId: config.discountEmailId } as SendEmailAction
      )
    }

    return {
      name: 'Abandoned Cart Recovery',
      type: 'contact',
      description: `Recovers abandoned carts with ${config.reminderEmailIds.length} reminder emails`,
      enrollmentTriggers: [
        {
          type: 'propertyChange',
          property: config.abandonmentProperty,
          operator: 'eq',
          value: 'true',
        } as PropertyChangeTrigger,
      ],
      actions,
      goalCriteria: {
        property: config.abandonmentProperty,
        operator: 'eq',
        value: 'false',
      },
      reenrollmentSettings: {
        allowReenrollment: true,
        resetDelay: 7 * 24 * 60 * 60 * 1000, // 1 week
      },
      settings: { timezone: 'UTC' },
    }
  }

  /**
   * Create a feedback request workflow
   *
   * Sends feedback/NPS surveys after key events.
   */
  static feedbackRequest(config: {
    triggerEvent: string
    delayDays: number
    surveyEmailId: string
    reminderEmailId?: string
    thankYouEmailId?: string
    npsProperty?: string
  }): CreateWorkflowInput {
    const delayMs = config.delayDays * 24 * 60 * 60 * 1000
    const reminderDelayMs = 3 * 24 * 60 * 60 * 1000 // 3 days

    const actions: TemplateActionInput[] = [
      { type: 'delay', delayType: 'fixed', duration: delayMs } as DelayAction,
      { type: 'sendEmail', emailId: config.surveyEmailId } as SendEmailAction,
    ]

    if (config.reminderEmailId) {
      actions.push(
        { type: 'delay', delayType: 'fixed', duration: reminderDelayMs } as DelayAction,
        { type: 'sendEmail', emailId: config.reminderEmailId } as SendEmailAction
      )
    }

    return {
      name: 'Feedback Request',
      type: 'contact',
      description: `Requests feedback ${config.delayDays} days after ${config.triggerEvent}`,
      enrollmentTriggers: [
        { type: 'event', eventName: config.triggerEvent } as EventTrigger,
      ],
      actions,
      goalCriteria: config.npsProperty ? {
        property: config.npsProperty,
        operator: 'is_known',
        value: undefined,
      } : undefined,
      reenrollmentSettings: {
        allowReenrollment: true,
        resetDelay: 90 * 24 * 60 * 60 * 1000, // 90 days
        maxEnrollments: 4,
      },
      settings: { timezone: 'UTC' },
    }
  }

  /**
   * Create a subscription reminder workflow
   *
   * Sends reminders before subscription expires.
   */
  static subscriptionReminder(config: {
    expirationProperty: string
    daysBefore: number[]
    emailIds: string[]
    renewalUrl?: string
  }): CreateWorkflowInput {
    const actions: TemplateActionInput[] = []

    // Send reminder emails at specified intervals
    for (let i = 0; i < config.daysBefore.length && i < config.emailIds.length; i++) {
      if (i > 0) {
        const prevDays = config.daysBefore[i - 1]
        const currentDays = config.daysBefore[i]
        const delayMs = (prevDays - currentDays) * 24 * 60 * 60 * 1000
        actions.push({ type: 'delay', delayType: 'fixed', duration: delayMs } as DelayAction)
      }
      actions.push({ type: 'sendEmail', emailId: config.emailIds[i] } as SendEmailAction)
    }

    return {
      name: 'Subscription Renewal Reminder',
      type: 'contact',
      description: `Reminds about subscription renewal ${config.daysBefore[0]} days before expiration`,
      enrollmentTriggers: [
        {
          type: 'propertyChange',
          property: config.expirationProperty,
        } as PropertyChangeTrigger,
      ],
      actions,
      reenrollmentSettings: {
        allowReenrollment: true,
      },
      settings: { timezone: 'UTC' },
    }
  }

  /**
   * Create a simple A/B test workflow
   *
   * Splits contacts into groups for testing different email versions.
   */
  static abTest(config: {
    formId: string
    emailA: string
    emailB: string
    splitPercentage?: number
    winnerProperty?: string
  }): CreateWorkflowInput {
    const splitA = config.splitPercentage ?? 50
    const splitB = 100 - splitA

    return {
      name: 'A/B Email Test',
      type: 'contact',
      description: `A/B test with ${splitA}/${splitB} split`,
      enrollmentTriggers: [
        { type: 'formSubmission', formId: config.formId } as FormSubmissionTrigger,
      ],
      actions: [
        {
          type: 'branch',
          branchType: 'random',
          splits: [
            { id: 'group-a', percentage: splitA, label: 'Group A' },
            { id: 'group-b', percentage: splitB, label: 'Group B' },
          ],
        } as BranchAction,
        // In practice, the email sends would be in branch-specific paths
        // This is simplified for the template
        { type: 'sendEmail', emailId: config.emailA } as SendEmailAction,
      ],
      settings: { timezone: 'UTC' },
    }
  }
}

// =============================================================================
// SUPPRESSION LIST MANAGEMENT
// =============================================================================

/**
 * Suppression list for workflow enrollments
 */
export interface SuppressionList {
  id: string
  name: string
  description?: string
  contactIds: Set<string>
  createdAt: string
  updatedAt: string
}

/**
 * Manages suppression lists for workflow enrollment
 */
export class SuppressionListManager {
  private storage: WorkflowStorage
  private readonly PREFIX = 'suppression:'

  constructor(storage: WorkflowStorage) {
    this.storage = storage
  }

  /**
   * Create a new suppression list
   */
  async createList(name: string, description?: string): Promise<SuppressionList> {
    const id = `supp-${crypto.randomUUID().slice(0, 8)}`
    const now = new Date().toISOString()

    const list: SuppressionList = {
      id,
      name,
      description,
      contactIds: new Set(),
      createdAt: now,
      updatedAt: now,
    }

    await this.storage.set(`${this.PREFIX}${id}`, {
      ...list,
      contactIds: Array.from(list.contactIds),
    })

    return list
  }

  /**
   * Get a suppression list
   */
  async getList(listId: string): Promise<SuppressionList | undefined> {
    const stored = await this.storage.get<{
      id: string
      name: string
      description?: string
      contactIds: string[]
      createdAt: string
      updatedAt: string
    }>(`${this.PREFIX}${listId}`)

    if (!stored) return undefined

    return {
      ...stored,
      contactIds: new Set(stored.contactIds),
    }
  }

  /**
   * Add contacts to a suppression list
   */
  async addContacts(listId: string, contactIds: string[]): Promise<void> {
    const list = await this.getList(listId)
    if (!list) {
      throw new HubSpotWorkflowError(`Suppression list not found: ${listId}`, 'NOT_FOUND', 404)
    }

    for (const id of contactIds) {
      list.contactIds.add(id)
    }

    list.updatedAt = new Date().toISOString()

    await this.storage.set(`${this.PREFIX}${listId}`, {
      ...list,
      contactIds: Array.from(list.contactIds),
    })
  }

  /**
   * Remove contacts from a suppression list
   */
  async removeContacts(listId: string, contactIds: string[]): Promise<void> {
    const list = await this.getList(listId)
    if (!list) {
      throw new HubSpotWorkflowError(`Suppression list not found: ${listId}`, 'NOT_FOUND', 404)
    }

    for (const id of contactIds) {
      list.contactIds.delete(id)
    }

    list.updatedAt = new Date().toISOString()

    await this.storage.set(`${this.PREFIX}${listId}`, {
      ...list,
      contactIds: Array.from(list.contactIds),
    })
  }

  /**
   * Check if a contact is in a suppression list
   */
  async isContactSuppressed(listId: string, contactId: string): Promise<boolean> {
    const list = await this.getList(listId)
    if (!list) return false
    return list.contactIds.has(contactId)
  }

  /**
   * Check if a contact is in any of the given suppression lists
   */
  async isContactInAnyList(contactId: string, listIds: string[]): Promise<boolean> {
    for (const listId of listIds) {
      if (await this.isContactSuppressed(listId, contactId)) {
        return true
      }
    }
    return false
  }

  /**
   * List all suppression lists
   */
  async listLists(): Promise<SuppressionList[]> {
    const stored = await this.storage.list<{
      id: string
      name: string
      description?: string
      contactIds: string[]
      createdAt: string
      updatedAt: string
    }>(this.PREFIX)

    const lists: SuppressionList[] = []
    for (const [, value] of stored) {
      lists.push({
        ...value,
        contactIds: new Set(value.contactIds),
      })
    }

    return lists
  }

  /**
   * Delete a suppression list
   */
  async deleteList(listId: string): Promise<void> {
    await this.storage.delete(`${this.PREFIX}${listId}`)
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default HubSpotWorkflows
