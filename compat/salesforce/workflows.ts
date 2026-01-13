/**
 * @dotdo/salesforce/workflows - Salesforce Workflow and Process Builder Compatibility
 *
 * Drop-in replacement for Salesforce Workflow Rules and Process Builder patterns
 * with edge compatibility. Supports all standard automation patterns:
 * - Workflow Rules (field updates, email alerts, tasks, outbound messages)
 * - Process Builder (multi-step processes with branching)
 * - Field updates (immediate and time-based)
 * - Email alerts and task creation
 *
 * @example
 * ```typescript
 * import { WorkflowRule, ProcessBuilder, WorkflowEngine } from '@dotdo/salesforce/workflows'
 *
 * // Create a Workflow Rule
 * const rule = new WorkflowRule({
 *   name: 'Update Account Rating',
 *   object: 'Account',
 *   evaluationCriteria: 'created',
 *   ruleCriteria: {
 *     field: 'AnnualRevenue',
 *     operator: 'greaterThan',
 *     value: 1000000
 *   },
 *   actions: [
 *     { type: 'fieldUpdate', field: 'Rating', value: 'Hot' },
 *     { type: 'emailAlert', templateId: 'high_value_account' }
 *   ]
 * })
 *
 * // Create a Process Builder process
 * const process = new ProcessBuilder({
 *   name: 'Lead Qualification',
 *   object: 'Lead',
 *   trigger: 'onCreateOrUpdate',
 *   nodes: [
 *     {
 *       id: 'check_status',
 *       type: 'criteria',
 *       criteria: { field: 'Status', operator: 'equals', value: 'Working' },
 *       trueOutcome: 'update_lead',
 *       falseOutcome: 'end'
 *     },
 *     {
 *       id: 'update_lead',
 *       type: 'action',
 *       actions: [
 *         { type: 'fieldUpdate', field: 'IsQualified__c', value: true },
 *         { type: 'createTask', subject: 'Follow up on qualified lead' }
 *       ]
 *     }
 *   ]
 * })
 *
 * // Execute with the engine
 * const engine = new WorkflowEngine()
 * engine.registerRule(rule)
 * engine.registerProcess(process)
 *
 * const result = await engine.evaluate('Account', record, 'create')
 * ```
 *
 * @module @dotdo/salesforce/workflows
 */

import type { SObject, SaveResult } from './types'

// =============================================================================
// TYPES - Core Workflow Types
// =============================================================================

/**
 * Workflow evaluation criteria - when the rule should be evaluated
 */
export type EvaluationCriteria =
  | 'created' // Only when record is created
  | 'createdAndEveryEdit' // On create and every subsequent edit
  | 'createdAndAnyChange' // On create and when criteria change from false to true

/**
 * Process Builder trigger type
 */
export type ProcessTrigger =
  | 'onCreate' // Only when record is created
  | 'onCreateOrUpdate' // On create or update
  | 'onPlatformEvent' // When platform event is received
  | 'onInvoke' // Invocable from Apex/API

/**
 * Comparison operators for rule criteria
 */
export type ComparisonOperator =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'greaterOrEqual'
  | 'lessThan'
  | 'lessOrEqual'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'isNull'
  | 'isNotNull'
  | 'isChanged'
  | 'isBlank'
  | 'isNotBlank'
  | 'includes'
  | 'excludes'

/**
 * Workflow action types
 */
export type WorkflowActionType =
  | 'fieldUpdate'
  | 'emailAlert'
  | 'createTask'
  | 'outboundMessage'
  | 'createRecord'
  | 'updateRecord'
  | 'apex' // Invoke Apex
  | 'quickAction'
  | 'flow' // Launch Flow
  | 'post' // Post to Chatter

/**
 * Time-based action trigger
 */
export type TimeBasedTrigger = {
  type: 'before' | 'after'
  value: number
  unit: 'hours' | 'days'
  field: string // Date/DateTime field to base timing on
}

// =============================================================================
// TYPES - Rule Criteria
// =============================================================================

/**
 * Single rule criterion
 */
export interface RuleCriterion {
  field: string
  operator: ComparisonOperator
  value?: unknown
  formula?: string // Formula-based criterion
}

/**
 * Combined rule criteria
 */
export interface RuleCriteria {
  logic?: 'AND' | 'OR' | string // e.g., "(1 AND 2) OR 3"
  conditions: RuleCriterion[]
}

/**
 * Filter criteria shorthand (single condition)
 */
export type FilterCriteria = RuleCriterion | RuleCriteria

// =============================================================================
// TYPES - Workflow Actions
// =============================================================================

/**
 * Field update action
 */
export interface FieldUpdateAction {
  type: 'fieldUpdate'
  field: string
  value?: unknown
  formula?: string // Formula to calculate value
  reevaluateWorkflowRules?: boolean
  nullifyBlank?: boolean
  lookupValueType?: 'reference' | 'static'
  lookupField?: string
}

/**
 * Email alert action
 */
export interface EmailAlertAction {
  type: 'emailAlert'
  templateId: string
  templateName?: string
  recipients?: EmailRecipient[]
  ccEmails?: string[]
  senderType?: 'defaultWorkflowUser' | 'currentUser' | 'orgWideEmailAddress'
  senderAddress?: string
}

/**
 * Email recipient specification
 */
export interface EmailRecipient {
  type: 'user' | 'owner' | 'role' | 'accountTeam' | 'opportunityTeam' | 'caseTeam' | 'email' | 'relatedContact' | 'createdBy' | 'lastModifiedBy'
  value?: string // User/Role ID, email address, or related contact field
  field?: string // Field containing email address
}

/**
 * Task creation action
 */
export interface CreateTaskAction {
  type: 'createTask'
  subject: string
  status?: string
  priority?: 'High' | 'Normal' | 'Low'
  dueDate?: string | { type: 'relative'; days: number }
  assignedTo?: 'owner' | 'creator' | 'user' | 'role'
  assignedToId?: string
  description?: string
  whatId?: string // Related To
  whoId?: string // Name
  activityDate?: string
  reminderDateTime?: string
  isReminderSet?: boolean
  recurrenceType?: 'RecursDaily' | 'RecursWeekly' | 'RecursMonthly' | 'RecursYearly'
}

/**
 * Outbound message action
 */
export interface OutboundMessageAction {
  type: 'outboundMessage'
  endpointUrl: string
  includeSessionId?: boolean
  fields?: string[]
  useAsyncProcessing?: boolean
}

/**
 * Create record action (Process Builder)
 */
export interface CreateRecordAction {
  type: 'createRecord'
  objectType: string
  recordValues: Record<string, unknown>
  useFieldReference?: Record<string, string> // Map field to source field
}

/**
 * Update record action (Process Builder)
 */
export interface UpdateRecordAction {
  type: 'updateRecord'
  recordType: 'triggering' | 'related' | 'reference'
  relatedField?: string // For related records
  referenceId?: string // For reference type
  objectType?: string
  criteria?: FilterCriteria
  updates: Array<{
    field: string
    value?: unknown
    formula?: string
  }>
}

/**
 * Apex invocation action
 */
export interface ApexAction {
  type: 'apex'
  className: string
  methodName?: string
  inputs?: Record<string, unknown>
}

/**
 * Quick action invocation
 */
export interface QuickActionAction {
  type: 'quickAction'
  actionName: string
  objectType: string
  recordId?: string
  inputs?: Record<string, unknown>
}

/**
 * Flow launch action
 */
export interface FlowAction {
  type: 'flow'
  flowName: string
  inputs?: Record<string, unknown>
  interviewLabel?: string
}

/**
 * Chatter post action
 */
export interface PostAction {
  type: 'post'
  postType: 'user' | 'group' | 'record'
  targetId?: string
  message: string
  mentionUsers?: string[]
  mentionGroups?: string[]
}

/**
 * Union of all action types
 */
export type WorkflowAction =
  | FieldUpdateAction
  | EmailAlertAction
  | CreateTaskAction
  | OutboundMessageAction
  | CreateRecordAction
  | UpdateRecordAction
  | ApexAction
  | QuickActionAction
  | FlowAction
  | PostAction

/**
 * Time-based workflow action wrapper
 */
export interface TimeBasedAction {
  action: WorkflowAction
  trigger: TimeBasedTrigger
}

// =============================================================================
// TYPES - Workflow Rule
// =============================================================================

/**
 * Workflow rule configuration
 */
export interface WorkflowRuleConfig {
  id?: string
  name: string
  description?: string
  object: string
  active?: boolean
  evaluationCriteria: EvaluationCriteria
  ruleCriteria: FilterCriteria
  formula?: string // Formula-based criteria
  actions: WorkflowAction[]
  timeBasedActions?: TimeBasedAction[]
}

/**
 * Workflow rule execution result
 */
export interface WorkflowRuleResult {
  ruleId: string
  ruleName: string
  matched: boolean
  actionsExecuted: ActionResult[]
  error?: string
}

/**
 * Individual action result
 */
export interface ActionResult {
  actionType: WorkflowActionType
  success: boolean
  output?: unknown
  error?: string
  startedAt: string
  completedAt: string
  durationMs: number
}

// =============================================================================
// TYPES - Process Builder
// =============================================================================

/**
 * Process node types
 */
export type ProcessNodeType =
  | 'criteria' // Decision/criteria node
  | 'action' // Action group node
  | 'schedule' // Scheduled action node

/**
 * Process node configuration
 */
export interface ProcessNode {
  id: string
  type: ProcessNodeType
  name?: string
  description?: string
  // For criteria nodes
  criteria?: FilterCriteria
  formula?: string
  trueOutcome?: string // Node ID or 'end'
  falseOutcome?: string // Node ID or 'end'
  // For action nodes
  actions?: WorkflowAction[]
  scheduledActions?: TimeBasedAction[]
  nextNode?: string // Node ID or 'end'
  // For schedule nodes
  scheduleTime?: TimeBasedTrigger
  scheduledNodeId?: string
}

/**
 * Process Builder configuration
 */
export interface ProcessBuilderConfig {
  id?: string
  name: string
  description?: string
  apiName?: string
  object: string
  active?: boolean
  trigger: ProcessTrigger
  triggerField?: string // For isChanged trigger
  recursion?: {
    allow: boolean
    maxDepth?: number
  }
  nodes: ProcessNode[]
  startNode: string // ID of first node
}

/**
 * Process execution result
 */
export interface ProcessResult {
  processId: string
  processName: string
  executed: boolean
  nodesVisited: string[]
  actionsExecuted: ActionResult[]
  scheduledActions: ScheduledActionResult[]
  error?: string
  startedAt: string
  completedAt: string
  durationMs: number
}

/**
 * Scheduled action result
 */
export interface ScheduledActionResult {
  actionId: string
  scheduledFor: string
  status: 'scheduled' | 'cancelled'
}

// =============================================================================
// TYPES - Engine Types
// =============================================================================

/**
 * Record operation type
 */
export type RecordOperation = 'create' | 'update' | 'delete'

/**
 * Record context for evaluation
 */
export interface RecordContext {
  newRecord: SObject
  oldRecord?: SObject
  operation: RecordOperation
  userId?: string
  timestamp?: string
}

/**
 * Engine configuration
 */
export interface WorkflowEngineConfig {
  /** Execute time-based actions immediately (for testing) */
  executeTimeBasedImmediately?: boolean
  /** Custom action handlers */
  actionHandlers?: Map<WorkflowActionType, ActionHandler>
  /** Maximum recursion depth */
  maxRecursionDepth?: number
  /** Callback for scheduled actions */
  onScheduledAction?: (action: TimeBasedAction, executeAt: Date, context: RecordContext) => void
}

/**
 * Custom action handler
 */
export type ActionHandler = (
  action: WorkflowAction,
  context: RecordContext
) => Promise<ActionResult>

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `wf_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Set nested value in object using dot notation
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current = obj

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!(part in current)) {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }

  current[parts[parts.length - 1]] = value
}

/**
 * Parse numeric value from various formats
 */
function parseNumeric(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$,]/g, '')
    return parseFloat(cleaned)
  }
  return NaN
}

// =============================================================================
// CRITERIA EVALUATOR
// =============================================================================

/**
 * Evaluates workflow rule criteria against record data
 */
export class CriteriaEvaluator {
  /**
   * Evaluate a single criterion
   */
  evaluateCriterion(
    criterion: RuleCriterion,
    context: RecordContext
  ): boolean {
    const value = getNestedValue(context.newRecord, criterion.field)
    const oldValue = context.oldRecord
      ? getNestedValue(context.oldRecord, criterion.field)
      : undefined

    switch (criterion.operator) {
      case 'equals':
        return this.equals(value, criterion.value)

      case 'notEquals':
        return !this.equals(value, criterion.value)

      case 'greaterThan':
        return this.compare(value, criterion.value) > 0

      case 'greaterOrEqual':
        return this.compare(value, criterion.value) >= 0

      case 'lessThan':
        return this.compare(value, criterion.value) < 0

      case 'lessOrEqual':
        return this.compare(value, criterion.value) <= 0

      case 'contains':
        return this.contains(value, criterion.value)

      case 'notContains':
        return !this.contains(value, criterion.value)

      case 'startsWith':
        return this.startsWith(value, criterion.value)

      case 'isNull':
        return value === null || value === undefined

      case 'isNotNull':
        return value !== null && value !== undefined

      case 'isBlank':
        return this.isBlank(value)

      case 'isNotBlank':
        return !this.isBlank(value)

      case 'isChanged':
        return context.operation === 'update' && !this.equals(value, oldValue)

      case 'includes':
        return this.includesMulti(value, criterion.value)

      case 'excludes':
        return !this.includesMulti(value, criterion.value)

      default:
        return false
    }
  }

  /**
   * Evaluate combined criteria
   */
  evaluateCriteria(
    criteria: FilterCriteria,
    context: RecordContext
  ): boolean {
    // Single criterion
    if ('field' in criteria && 'operator' in criteria) {
      return this.evaluateCriterion(criteria as RuleCriterion, context)
    }

    // Combined criteria
    const combined = criteria as RuleCriteria
    const { logic, conditions } = combined

    if (!conditions || conditions.length === 0) {
      return true
    }

    const results = conditions.map((c) => this.evaluateCriterion(c, context))

    if (logic === 'OR') {
      return results.some((r) => r)
    }

    if (logic === 'AND' || !logic) {
      return results.every((r) => r)
    }

    // Custom logic string like "(1 AND 2) OR 3"
    return this.evaluateCustomLogic(logic, results)
  }

  /**
   * Evaluate custom logic string
   */
  private evaluateCustomLogic(logic: string, results: boolean[]): boolean {
    // Replace condition numbers with actual results
    let expression = logic.toLowerCase()

    for (let i = results.length; i >= 1; i--) {
      const regex = new RegExp(`\\b${i}\\b`, 'g')
      expression = expression.replace(regex, results[i - 1] ? 'true' : 'false')
    }

    // Replace AND/OR with JavaScript operators
    expression = expression
      .replace(/\band\b/gi, '&&')
      .replace(/\bor\b/gi, '||')

    // Evaluate (safely)
    try {
      // Only allow true, false, &&, ||, (, ), and whitespace
      if (!/^[\s()&|truefalse]+$/i.test(expression)) {
        return false
      }
      return new Function(`return ${expression}`)() as boolean
    } catch {
      return false
    }
  }

  private equals(actual: unknown, expected: unknown): boolean {
    // Handle numeric comparison
    const actualNum = parseNumeric(actual)
    const expectedNum = parseNumeric(expected)
    if (!isNaN(actualNum) && !isNaN(expectedNum)) {
      return actualNum === expectedNum
    }

    // Handle string comparison (case-insensitive)
    if (typeof actual === 'string' && typeof expected === 'string') {
      return actual.toLowerCase() === expected.toLowerCase()
    }

    // Handle boolean
    if (typeof actual === 'boolean' || typeof expected === 'boolean') {
      return actual === expected
    }

    // Handle null/undefined
    if (actual === null || actual === undefined) {
      return expected === null || expected === undefined
    }

    return actual === expected
  }

  private compare(actual: unknown, expected: unknown): number {
    const actualNum = parseNumeric(actual)
    const expectedNum = parseNumeric(expected)

    if (isNaN(actualNum) || isNaN(expectedNum)) {
      const actualStr = String(actual ?? '')
      const expectedStr = String(expected ?? '')
      return actualStr.localeCompare(expectedStr)
    }

    return actualNum - expectedNum
  }

  private contains(actual: unknown, expected: unknown): boolean {
    if (Array.isArray(actual)) {
      return actual.some((item) => this.equals(item, expected))
    }
    if (typeof actual === 'string') {
      const expectedStr = String(expected ?? '')
      return actual.toLowerCase().includes(expectedStr.toLowerCase())
    }
    return false
  }

  private startsWith(actual: unknown, expected: unknown): boolean {
    if (typeof actual !== 'string') return false
    const expectedStr = String(expected ?? '')
    return actual.toLowerCase().startsWith(expectedStr.toLowerCase())
  }

  private isBlank(value: unknown): boolean {
    if (value === null || value === undefined) return true
    if (typeof value === 'string') return value.trim() === ''
    if (Array.isArray(value)) return value.length === 0
    return false
  }

  private includesMulti(actual: unknown, expected: unknown): boolean {
    if (!Array.isArray(expected)) return false
    const actualArr = Array.isArray(actual) ? actual : [actual]
    return expected.some((exp) => actualArr.some((act) => this.equals(act, exp)))
  }

  /**
   * Check if evaluation criteria match the operation
   */
  matchesEvaluationCriteria(
    evaluationCriteria: EvaluationCriteria,
    context: RecordContext,
    previouslyMatched?: boolean
  ): boolean {
    switch (evaluationCriteria) {
      case 'created':
        return context.operation === 'create'

      case 'createdAndEveryEdit':
        return context.operation === 'create' || context.operation === 'update'

      case 'createdAndAnyChange':
        // On create, always evaluate
        // On update, only evaluate if previously false and now true
        if (context.operation === 'create') return true
        if (context.operation === 'update') {
          return previouslyMatched === false
        }
        return false

      default:
        return false
    }
  }
}

// =============================================================================
// WORKFLOW RULE
// =============================================================================

/**
 * Salesforce Workflow Rule implementation
 */
export class WorkflowRule {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly object: string
  active: boolean
  readonly evaluationCriteria: EvaluationCriteria
  readonly ruleCriteria: FilterCriteria
  readonly formula?: string
  readonly actions: WorkflowAction[]
  readonly timeBasedActions: TimeBasedAction[]

  private evaluator: CriteriaEvaluator

  constructor(config: WorkflowRuleConfig) {
    this.id = config.id ?? generateId()
    this.name = config.name
    this.description = config.description
    this.object = config.object
    this.active = config.active ?? true
    this.evaluationCriteria = config.evaluationCriteria
    this.ruleCriteria = config.ruleCriteria
    this.formula = config.formula
    this.actions = config.actions
    this.timeBasedActions = config.timeBasedActions ?? []
    this.evaluator = new CriteriaEvaluator()
  }

  /**
   * Check if this rule applies to the given object type
   */
  appliesTo(objectType: string): boolean {
    return this.object.toLowerCase() === objectType.toLowerCase()
  }

  /**
   * Evaluate whether the rule matches the record context
   */
  evaluate(context: RecordContext, previouslyMatched?: boolean): boolean {
    if (!this.active) return false

    // Check evaluation criteria
    if (!this.evaluator.matchesEvaluationCriteria(
      this.evaluationCriteria,
      context,
      previouslyMatched
    )) {
      return false
    }

    // Evaluate rule criteria
    return this.evaluator.evaluateCriteria(this.ruleCriteria, context)
  }

  /**
   * Get immediate actions
   */
  getImmediateActions(): WorkflowAction[] {
    return this.actions
  }

  /**
   * Get time-based actions
   */
  getTimeBasedActions(): TimeBasedAction[] {
    return this.timeBasedActions
  }

  /**
   * Clone with modifications
   */
  clone(overrides?: Partial<WorkflowRuleConfig>): WorkflowRule {
    return new WorkflowRule({
      id: generateId(),
      name: this.name,
      description: this.description,
      object: this.object,
      active: this.active,
      evaluationCriteria: this.evaluationCriteria,
      ruleCriteria: this.ruleCriteria,
      formula: this.formula,
      actions: [...this.actions],
      timeBasedActions: [...this.timeBasedActions],
      ...overrides,
    })
  }

  /**
   * Convert to JSON
   */
  toJSON(): WorkflowRuleConfig {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      object: this.object,
      active: this.active,
      evaluationCriteria: this.evaluationCriteria,
      ruleCriteria: this.ruleCriteria,
      formula: this.formula,
      actions: this.actions,
      timeBasedActions: this.timeBasedActions,
    }
  }
}

// =============================================================================
// PROCESS BUILDER
// =============================================================================

/**
 * Salesforce Process Builder implementation
 */
export class ProcessBuilder {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly apiName?: string
  readonly object: string
  active: boolean
  readonly trigger: ProcessTrigger
  readonly triggerField?: string
  readonly recursion: { allow: boolean; maxDepth: number }
  readonly nodes: Map<string, ProcessNode>
  readonly startNode: string

  private evaluator: CriteriaEvaluator

  constructor(config: ProcessBuilderConfig) {
    this.id = config.id ?? generateId()
    this.name = config.name
    this.description = config.description
    this.apiName = config.apiName
    this.object = config.object
    this.active = config.active ?? true
    this.trigger = config.trigger
    this.triggerField = config.triggerField
    this.recursion = {
      allow: config.recursion?.allow ?? false,
      maxDepth: config.recursion?.maxDepth ?? 5,
    }
    this.startNode = config.startNode
    this.evaluator = new CriteriaEvaluator()

    // Index nodes by ID
    this.nodes = new Map()
    for (const node of config.nodes) {
      this.nodes.set(node.id, node)
    }
  }

  /**
   * Check if this process applies to the given object type
   */
  appliesTo(objectType: string): boolean {
    return this.object.toLowerCase() === objectType.toLowerCase()
  }

  /**
   * Check if trigger matches the operation
   */
  matchesTrigger(context: RecordContext): boolean {
    if (!this.active) return false

    switch (this.trigger) {
      case 'onCreate':
        return context.operation === 'create'

      case 'onCreateOrUpdate':
        return context.operation === 'create' || context.operation === 'update'

      case 'onPlatformEvent':
        // Platform events are handled separately
        return false

      case 'onInvoke':
        // Invocable processes are called directly
        return false

      default:
        return false
    }
  }

  /**
   * Get a node by ID
   */
  getNode(nodeId: string): ProcessNode | undefined {
    return this.nodes.get(nodeId)
  }

  /**
   * Get the starting node
   */
  getStartNode(): ProcessNode | undefined {
    return this.nodes.get(this.startNode)
  }

  /**
   * Evaluate criteria node
   */
  evaluateCriteriaNode(node: ProcessNode, context: RecordContext): boolean {
    if (!node.criteria) return true
    return this.evaluator.evaluateCriteria(node.criteria, context)
  }

  /**
   * Get next node ID based on criteria result
   */
  getNextNodeId(node: ProcessNode, criteriaResult: boolean): string | null {
    if (node.type === 'criteria') {
      const outcome = criteriaResult ? node.trueOutcome : node.falseOutcome
      return outcome === 'end' ? null : (outcome ?? null)
    }

    if (node.type === 'action') {
      return node.nextNode === 'end' ? null : (node.nextNode ?? null)
    }

    return null
  }

  /**
   * Convert to JSON
   */
  toJSON(): ProcessBuilderConfig {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      apiName: this.apiName,
      object: this.object,
      active: this.active,
      trigger: this.trigger,
      triggerField: this.triggerField,
      recursion: this.recursion,
      nodes: Array.from(this.nodes.values()),
      startNode: this.startNode,
    }
  }
}

// =============================================================================
// WORKFLOW ENGINE
// =============================================================================

/**
 * Main workflow execution engine
 */
export class WorkflowEngine {
  private rules: Map<string, WorkflowRule> = new Map()
  private processes: Map<string, ProcessBuilder> = new Map()
  private objectRules: Map<string, Set<string>> = new Map()
  private objectProcesses: Map<string, Set<string>> = new Map()
  private actionHandlers: Map<WorkflowActionType, ActionHandler> = new Map()
  private config: WorkflowEngineConfig

  constructor(config: WorkflowEngineConfig = {}) {
    this.config = {
      executeTimeBasedImmediately: false,
      maxRecursionDepth: 5,
      ...config,
    }

    if (config.actionHandlers) {
      config.actionHandlers.forEach((handler, type) => {
        this.actionHandlers.set(type, handler)
      })
    }

    this.registerBuiltInHandlers()
  }

  /**
   * Register built-in action handlers
   */
  private registerBuiltInHandlers(): void {
    // Field Update
    this.actionHandlers.set('fieldUpdate', async (action, context) => {
      const startedAt = new Date().toISOString()
      const startTime = Date.now()
      const fieldUpdate = action as FieldUpdateAction

      try {
        const value = fieldUpdate.formula
          ? this.evaluateFormula(fieldUpdate.formula, context)
          : fieldUpdate.value

        // Apply field update to record
        setNestedValue(context.newRecord, fieldUpdate.field, value)

        return {
          actionType: 'fieldUpdate',
          success: true,
          output: { field: fieldUpdate.field, value },
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        }
      } catch (error) {
        return {
          actionType: 'fieldUpdate',
          success: false,
          error: error instanceof Error ? error.message : String(error),
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        }
      }
    })

    // Email Alert
    this.actionHandlers.set('emailAlert', async (action, context) => {
      const startedAt = new Date().toISOString()
      const startTime = Date.now()
      const emailAlert = action as EmailAlertAction

      return {
        actionType: 'emailAlert',
        success: true,
        output: {
          templateId: emailAlert.templateId,
          recipients: emailAlert.recipients,
          recordId: context.newRecord.Id,
        },
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      }
    })

    // Create Task
    this.actionHandlers.set('createTask', async (action, context) => {
      const startedAt = new Date().toISOString()
      const startTime = Date.now()
      const createTask = action as CreateTaskAction

      const task: Record<string, unknown> = {
        Subject: createTask.subject,
        Status: createTask.status ?? 'Not Started',
        Priority: createTask.priority ?? 'Normal',
        Description: createTask.description,
        WhatId: createTask.whatId ?? context.newRecord.Id,
        WhoId: createTask.whoId,
        IsReminderSet: createTask.isReminderSet ?? false,
      }

      // Calculate due date
      if (createTask.dueDate) {
        if (typeof createTask.dueDate === 'object' && createTask.dueDate.type === 'relative') {
          const dueDate = new Date()
          dueDate.setDate(dueDate.getDate() + createTask.dueDate.days)
          task.ActivityDate = dueDate.toISOString().split('T')[0]
        } else {
          task.ActivityDate = createTask.dueDate
        }
      }

      return {
        actionType: 'createTask',
        success: true,
        output: { task, taskId: generateId() },
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      }
    })

    // Outbound Message
    this.actionHandlers.set('outboundMessage', async (action, context) => {
      const startedAt = new Date().toISOString()
      const startTime = Date.now()
      const outbound = action as OutboundMessageAction

      const payload: Record<string, unknown> = {
        recordId: context.newRecord.Id,
        objectType: context.newRecord.attributes?.type,
      }

      if (outbound.fields) {
        for (const field of outbound.fields) {
          payload[field] = getNestedValue(context.newRecord, field)
        }
      } else {
        Object.assign(payload, context.newRecord)
      }

      return {
        actionType: 'outboundMessage',
        success: true,
        output: {
          endpointUrl: outbound.endpointUrl,
          payload,
          messageId: generateId(),
        },
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      }
    })

    // Create Record
    this.actionHandlers.set('createRecord', async (action, context) => {
      const startedAt = new Date().toISOString()
      const startTime = Date.now()
      const createRecord = action as CreateRecordAction

      const recordValues = { ...createRecord.recordValues }

      // Resolve field references
      if (createRecord.useFieldReference) {
        for (const [targetField, sourceField] of Object.entries(createRecord.useFieldReference)) {
          recordValues[targetField] = getNestedValue(context.newRecord, sourceField)
        }
      }

      return {
        actionType: 'createRecord',
        success: true,
        output: {
          objectType: createRecord.objectType,
          record: recordValues,
          recordId: generateId(),
        },
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      }
    })

    // Update Record
    this.actionHandlers.set('updateRecord', async (action, context) => {
      const startedAt = new Date().toISOString()
      const startTime = Date.now()
      const updateRecord = action as UpdateRecordAction

      const updates: Record<string, unknown> = {}

      for (const update of updateRecord.updates) {
        const value = update.formula
          ? this.evaluateFormula(update.formula, context)
          : update.value
        updates[update.field] = value
      }

      return {
        actionType: 'updateRecord',
        success: true,
        output: {
          recordType: updateRecord.recordType,
          updates,
          recordId: updateRecord.recordType === 'triggering'
            ? context.newRecord.Id
            : updateRecord.referenceId,
        },
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      }
    })

    // Post to Chatter
    this.actionHandlers.set('post', async (action, context) => {
      const startedAt = new Date().toISOString()
      const startTime = Date.now()
      const postAction = action as PostAction

      return {
        actionType: 'post',
        success: true,
        output: {
          postType: postAction.postType,
          targetId: postAction.targetId ?? context.newRecord.Id,
          message: postAction.message,
          postId: generateId(),
        },
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      }
    })

    // Flow
    this.actionHandlers.set('flow', async (action, context) => {
      const startedAt = new Date().toISOString()
      const startTime = Date.now()
      const flowAction = action as FlowAction

      return {
        actionType: 'flow',
        success: true,
        output: {
          flowName: flowAction.flowName,
          inputs: flowAction.inputs,
          interviewId: generateId(),
        },
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      }
    })

    // Apex
    this.actionHandlers.set('apex', async (action, context) => {
      const startedAt = new Date().toISOString()
      const startTime = Date.now()
      const apexAction = action as ApexAction

      return {
        actionType: 'apex',
        success: true,
        output: {
          className: apexAction.className,
          methodName: apexAction.methodName,
          inputs: apexAction.inputs,
          invocationId: generateId(),
        },
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      }
    })

    // Quick Action
    this.actionHandlers.set('quickAction', async (action, context) => {
      const startedAt = new Date().toISOString()
      const startTime = Date.now()
      const quickAction = action as QuickActionAction

      return {
        actionType: 'quickAction',
        success: true,
        output: {
          actionName: quickAction.actionName,
          objectType: quickAction.objectType,
          recordId: quickAction.recordId ?? context.newRecord.Id,
          inputs: quickAction.inputs,
        },
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      }
    })
  }

  /**
   * Evaluate a simple formula
   */
  private evaluateFormula(formula: string, context: RecordContext): unknown {
    // Simple formula evaluation - supports field references
    const fieldRefRegex = /\{!([^}]+)\}/g
    let result = formula

    let match
    while ((match = fieldRefRegex.exec(formula)) !== null) {
      const fieldPath = match[1]
      const value = getNestedValue(context.newRecord, fieldPath)
      result = result.replace(match[0], String(value ?? ''))
    }

    return result
  }

  /**
   * Register a custom action handler
   */
  registerActionHandler(type: WorkflowActionType, handler: ActionHandler): void {
    this.actionHandlers.set(type, handler)
  }

  /**
   * Register a workflow rule
   */
  registerRule(rule: WorkflowRule): void {
    this.rules.set(rule.id, rule)

    const objectKey = rule.object.toLowerCase()
    if (!this.objectRules.has(objectKey)) {
      this.objectRules.set(objectKey, new Set())
    }
    this.objectRules.get(objectKey)!.add(rule.id)
  }

  /**
   * Unregister a workflow rule
   */
  unregisterRule(ruleId: string): boolean {
    const rule = this.rules.get(ruleId)
    if (!rule) return false

    this.rules.delete(ruleId)

    const objectKey = rule.object.toLowerCase()
    const ruleIds = this.objectRules.get(objectKey)
    if (ruleIds) {
      ruleIds.delete(ruleId)
    }

    return true
  }

  /**
   * Register a Process Builder process
   */
  registerProcess(process: ProcessBuilder): void {
    this.processes.set(process.id, process)

    const objectKey = process.object.toLowerCase()
    if (!this.objectProcesses.has(objectKey)) {
      this.objectProcesses.set(objectKey, new Set())
    }
    this.objectProcesses.get(objectKey)!.add(process.id)
  }

  /**
   * Unregister a Process Builder process
   */
  unregisterProcess(processId: string): boolean {
    const process = this.processes.get(processId)
    if (!process) return false

    this.processes.delete(processId)

    const objectKey = process.object.toLowerCase()
    const processIds = this.objectProcesses.get(objectKey)
    if (processIds) {
      processIds.delete(processId)
    }

    return true
  }

  /**
   * Get a rule by ID
   */
  getRule(ruleId: string): WorkflowRule | undefined {
    return this.rules.get(ruleId)
  }

  /**
   * Get a process by ID
   */
  getProcess(processId: string): ProcessBuilder | undefined {
    return this.processes.get(processId)
  }

  /**
   * List all rules for an object
   */
  listRules(objectType?: string): WorkflowRule[] {
    if (!objectType) {
      return Array.from(this.rules.values())
    }

    const objectKey = objectType.toLowerCase()
    const ruleIds = this.objectRules.get(objectKey)
    if (!ruleIds) return []

    return Array.from(ruleIds)
      .map((id) => this.rules.get(id)!)
      .filter(Boolean)
  }

  /**
   * List all processes for an object
   */
  listProcesses(objectType?: string): ProcessBuilder[] {
    if (!objectType) {
      return Array.from(this.processes.values())
    }

    const objectKey = objectType.toLowerCase()
    const processIds = this.objectProcesses.get(objectKey)
    if (!processIds) return []

    return Array.from(processIds)
      .map((id) => this.processes.get(id)!)
      .filter(Boolean)
  }

  /**
   * Execute an action
   */
  async executeAction(action: WorkflowAction, context: RecordContext): Promise<ActionResult> {
    const handler = this.actionHandlers.get(action.type)
    if (!handler) {
      const startedAt = new Date().toISOString()
      return {
        actionType: action.type,
        success: false,
        error: `No handler registered for action type: ${action.type}`,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: 0,
      }
    }

    return handler(action, context)
  }

  /**
   * Evaluate and execute workflow rules for a record
   */
  async evaluateRules(
    objectType: string,
    context: RecordContext
  ): Promise<WorkflowRuleResult[]> {
    const rules = this.listRules(objectType)
    const results: WorkflowRuleResult[] = []

    for (const rule of rules) {
      const matched = rule.evaluate(context)

      const result: WorkflowRuleResult = {
        ruleId: rule.id,
        ruleName: rule.name,
        matched,
        actionsExecuted: [],
      }

      if (matched) {
        // Execute immediate actions
        for (const action of rule.getImmediateActions()) {
          const actionResult = await this.executeAction(action, context)
          result.actionsExecuted.push(actionResult)
        }

        // Handle time-based actions
        if (this.config.executeTimeBasedImmediately) {
          for (const tba of rule.getTimeBasedActions()) {
            const actionResult = await this.executeAction(tba.action, context)
            result.actionsExecuted.push(actionResult)
          }
        } else if (this.config.onScheduledAction) {
          for (const tba of rule.getTimeBasedActions()) {
            const executeAt = this.calculateExecuteTime(tba.trigger, context)
            this.config.onScheduledAction(tba, executeAt, context)
          }
        }
      }

      results.push(result)
    }

    return results
  }

  /**
   * Execute a Process Builder process for a record
   */
  async executeProcess(
    process: ProcessBuilder,
    context: RecordContext,
    depth: number = 0
  ): Promise<ProcessResult> {
    const startedAt = new Date().toISOString()
    const startTime = Date.now()

    const result: ProcessResult = {
      processId: process.id,
      processName: process.name,
      executed: false,
      nodesVisited: [],
      actionsExecuted: [],
      scheduledActions: [],
      startedAt,
      completedAt: '',
      durationMs: 0,
    }

    // Check recursion depth
    if (depth >= (this.config.maxRecursionDepth ?? 5)) {
      result.error = 'Maximum recursion depth exceeded'
      result.completedAt = new Date().toISOString()
      result.durationMs = Date.now() - startTime
      return result
    }

    // Check trigger
    if (!process.matchesTrigger(context)) {
      result.completedAt = new Date().toISOString()
      result.durationMs = Date.now() - startTime
      return result
    }

    result.executed = true

    // Execute process nodes
    let currentNodeId: string | null = process.startNode

    try {
      while (currentNodeId) {
        const node = process.getNode(currentNodeId)
        if (!node) break

        result.nodesVisited.push(currentNodeId)

        switch (node.type) {
          case 'criteria': {
            const criteriaResult = process.evaluateCriteriaNode(node, context)
            currentNodeId = process.getNextNodeId(node, criteriaResult)
            break
          }

          case 'action': {
            // Execute actions
            if (node.actions) {
              for (const action of node.actions) {
                const actionResult = await this.executeAction(action, context)
                result.actionsExecuted.push(actionResult)
              }
            }

            // Handle scheduled actions
            if (node.scheduledActions) {
              for (const scheduledAction of node.scheduledActions) {
                if (this.config.executeTimeBasedImmediately) {
                  const actionResult = await this.executeAction(scheduledAction.action, context)
                  result.actionsExecuted.push(actionResult)
                } else {
                  const executeAt = this.calculateExecuteTime(scheduledAction.trigger, context)
                  if (this.config.onScheduledAction) {
                    this.config.onScheduledAction(scheduledAction, executeAt, context)
                  }
                  result.scheduledActions.push({
                    actionId: generateId(),
                    scheduledFor: executeAt.toISOString(),
                    status: 'scheduled',
                  })
                }
              }
            }

            currentNodeId = process.getNextNodeId(node, true)
            break
          }

          default:
            currentNodeId = null
        }
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error)
    }

    result.completedAt = new Date().toISOString()
    result.durationMs = Date.now() - startTime
    return result
  }

  /**
   * Evaluate and execute all workflows (rules + processes) for a record
   */
  async evaluate(
    objectType: string,
    record: SObject,
    operation: RecordOperation,
    oldRecord?: SObject
  ): Promise<{
    ruleResults: WorkflowRuleResult[]
    processResults: ProcessResult[]
  }> {
    const context: RecordContext = {
      newRecord: record,
      oldRecord,
      operation,
      timestamp: new Date().toISOString(),
    }

    const ruleResults = await this.evaluateRules(objectType, context)

    const processes = this.listProcesses(objectType)
    const processResults: ProcessResult[] = []

    for (const process of processes) {
      const result = await this.executeProcess(process, context)
      processResults.push(result)
    }

    return { ruleResults, processResults }
  }

  /**
   * Calculate execution time for time-based action
   */
  private calculateExecuteTime(trigger: TimeBasedTrigger, context: RecordContext): Date {
    const baseValue = getNestedValue(context.newRecord, trigger.field)
    const baseDate = baseValue ? new Date(String(baseValue)) : new Date()

    const multiplier = trigger.type === 'before' ? -1 : 1
    const milliseconds = trigger.unit === 'hours'
      ? trigger.value * 60 * 60 * 1000
      : trigger.value * 24 * 60 * 60 * 1000

    return new Date(baseDate.getTime() + (multiplier * milliseconds))
  }

  /**
   * Invoke a process directly (for onInvoke trigger)
   */
  async invokeProcess(
    processId: string,
    inputs: Record<string, unknown>
  ): Promise<ProcessResult> {
    const process = this.processes.get(processId)
    if (!process) {
      throw new Error(`Process not found: ${processId}`)
    }

    const context: RecordContext = {
      newRecord: inputs as SObject,
      operation: 'create',
      timestamp: new Date().toISOString(),
    }

    return this.executeProcess(process, context)
  }

  /**
   * Clear all rules and processes
   */
  clear(): void {
    this.rules.clear()
    this.processes.clear()
    this.objectRules.clear()
    this.objectProcesses.clear()
  }
}

// =============================================================================
// DEFAULT EXPORT
// =============================================================================

export default WorkflowEngine
