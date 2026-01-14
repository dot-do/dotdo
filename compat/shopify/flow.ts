/**
 * @dotdo/shopify - Shopify Flow Automation
 *
 * Shopify Flow compatible automation system including:
 * - Triggers: Events that start workflows (orders, customers, products, etc.)
 * - Conditions: Evaluation logic for workflow branching
 * - Actions: Operations performed by workflows
 * - Workflow Templates: Pre-built automation configurations
 *
 * @example
 * ```typescript
 * import { FlowEngine, FlowTemplates } from '@dotdo/shopify/flow'
 *
 * const engine = new FlowEngine()
 *
 * // Create workflow from template
 * const workflow = engine.createFromTemplate(
 *   FlowTemplates.TAG_HIGH_VALUE_CUSTOMERS,
 *   { threshold: 1000 }
 * )
 *
 * // Execute workflow manually
 * const execution = await engine.execute(workflow.id, {
 *   customer: { id: 123, total_spent: '1500.00' }
 * })
 *
 * // Or register for automatic trigger
 * engine.registerWorkflow(workflow)
 * engine.onTrigger('customer_created', customerData)
 * ```
 *
 * @module @dotdo/shopify/flow
 */

import type {
  FlowTrigger,
  FlowTriggerType,
  FlowCondition,
  FlowConditionOperator,
  FlowAction,
  FlowActionType,
  FlowWorkflow,
  FlowWorkflowTemplate,
  FlowTemplateCategory,
  FlowTemplateVariable,
  FlowExecution,
  FlowExecutionStatus,
  FlowStepResult,
  FlowExecutionError,
  FlowPropertyType,
} from './types'

// Re-export types
export type {
  FlowTrigger,
  FlowTriggerType,
  FlowCondition,
  FlowConditionOperator,
  FlowAction,
  FlowActionType,
  FlowWorkflow,
  FlowWorkflowTemplate,
  FlowTemplateCategory,
  FlowTemplateVariable,
  FlowExecution,
  FlowExecutionStatus,
  FlowStepResult,
  FlowExecutionError,
  FlowPropertyType,
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `flow_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

/**
 * Get a nested property value from an object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Parse a value to a number, handling money strings
 */
function parseNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    // Remove currency symbols and commas
    const cleaned = value.replace(/[$,]/g, '')
    return parseFloat(cleaned)
  }
  return NaN
}

// =============================================================================
// Condition Evaluator
// =============================================================================

/**
 * Evaluates Flow conditions against data
 */
export class ConditionEvaluator {
  /**
   * Evaluate a single condition
   */
  evaluate(condition: FlowCondition, data: Record<string, unknown>): boolean {
    // Handle nested AND conditions
    if (condition.and && condition.and.length > 0) {
      const mainResult = this.evaluateSingle(condition, data)
      const andResults = condition.and.every((c) => this.evaluate(c, data))
      return mainResult && andResults
    }

    // Handle nested OR conditions
    if (condition.or && condition.or.length > 0) {
      const mainResult = this.evaluateSingle(condition, data)
      const orResults = condition.or.some((c) => this.evaluate(c, data))
      return mainResult || orResults
    }

    return this.evaluateSingle(condition, data)
  }

  /**
   * Evaluate a single condition without nested logic
   */
  private evaluateSingle(condition: FlowCondition, data: Record<string, unknown>): boolean {
    const actualValue = getNestedValue(data, condition.property)
    const expectedValue = condition.value

    switch (condition.operator) {
      case 'equals':
        return this.equals(actualValue, expectedValue)

      case 'not_equals':
        return !this.equals(actualValue, expectedValue)

      case 'greater_than':
        return this.compare(actualValue, expectedValue) > 0

      case 'greater_than_or_equals':
        return this.compare(actualValue, expectedValue) >= 0

      case 'less_than':
        return this.compare(actualValue, expectedValue) < 0

      case 'less_than_or_equals':
        return this.compare(actualValue, expectedValue) <= 0

      case 'contains':
        return this.contains(actualValue, expectedValue)

      case 'not_contains':
        return !this.contains(actualValue, expectedValue)

      case 'starts_with':
        return this.startsWith(actualValue, expectedValue)

      case 'ends_with':
        return this.endsWith(actualValue, expectedValue)

      case 'is_empty':
        return this.isEmpty(actualValue)

      case 'is_not_empty':
        return !this.isEmpty(actualValue)

      case 'in':
        return this.isIn(actualValue, expectedValue)

      case 'not_in':
        return !this.isIn(actualValue, expectedValue)

      case 'matches_regex':
        return this.matchesRegex(actualValue, expectedValue)

      default:
        return false
    }
  }

  private equals(actual: unknown, expected: unknown): boolean {
    // Handle numeric comparison (including money strings)
    const actualNum = parseNumber(actual)
    const expectedNum = parseNumber(expected)
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
    const actualNum = parseNumber(actual)
    const expectedNum = parseNumber(expected)

    if (isNaN(actualNum) || isNaN(expectedNum)) {
      // Fall back to string comparison
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

  private endsWith(actual: unknown, expected: unknown): boolean {
    if (typeof actual !== 'string') return false
    const expectedStr = String(expected ?? '')
    return actual.toLowerCase().endsWith(expectedStr.toLowerCase())
  }

  private isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true
    if (typeof value === 'string') return value.trim() === ''
    if (Array.isArray(value)) return value.length === 0
    if (typeof value === 'object') return Object.keys(value).length === 0
    return false
  }

  private isIn(actual: unknown, expected: unknown): boolean {
    if (!Array.isArray(expected)) return false
    return expected.some((item) => this.equals(actual, item))
  }

  private matchesRegex(actual: unknown, expected: unknown): boolean {
    if (typeof actual !== 'string' || typeof expected !== 'string') return false
    try {
      const regex = new RegExp(expected, 'i')
      return regex.test(actual)
    } catch {
      return false
    }
  }

  /**
   * Evaluate all conditions (AND logic)
   */
  evaluateAll(conditions: FlowCondition[], data: Record<string, unknown>): boolean {
    if (conditions.length === 0) return true
    return conditions.every((condition) => this.evaluate(condition, data))
  }
}

// =============================================================================
// Action Executor
// =============================================================================

/**
 * Action handler function type
 */
export type ActionHandler = (
  input: Record<string, unknown>,
  context: ActionContext
) => Promise<Record<string, unknown>>

/**
 * Context provided to action handlers
 */
export interface ActionContext {
  /** The workflow being executed */
  workflowId: string
  /** The execution ID */
  executionId: string
  /** Trigger event data */
  triggerData: Record<string, unknown>
  /** Results from previous actions */
  previousResults: Record<string, unknown>
  /** All variables in scope */
  variables: Record<string, unknown>
}

/**
 * Executes Flow actions
 */
export class ActionExecutor {
  private handlers: Map<FlowActionType, ActionHandler> = new Map()

  constructor() {
    this.registerBuiltInHandlers()
  }

  /**
   * Register a custom action handler
   */
  registerHandler(actionType: FlowActionType, handler: ActionHandler): void {
    this.handlers.set(actionType, handler)
  }

  /**
   * Execute a single action
   */
  async execute(action: FlowAction, context: ActionContext): Promise<FlowStepResult> {
    const startedAt = new Date().toISOString()
    const startTime = Date.now()

    try {
      // Check action conditions
      if (action.conditions && action.conditions.length > 0) {
        const evaluator = new ConditionEvaluator()
        const conditionsMet = evaluator.evaluateAll(action.conditions, {
          ...context.triggerData,
          ...context.variables,
        })

        if (!conditionsMet) {
          return {
            actionId: action.id,
            status: 'skipped',
            output: { reason: 'Conditions not met' },
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startTime,
          }
        }
      }

      // Resolve input variables
      const resolvedInput = this.resolveInput(action.input, context)

      // Get handler
      const handler = this.handlers.get(action.type)
      if (!handler) {
        throw new Error(`No handler registered for action type: ${action.type}`)
      }

      // Execute action
      const output = await handler(resolvedInput, context)

      // Apply output mapping if configured
      const mappedOutput = action.outputMapping
        ? this.applyOutputMapping(output, action.outputMapping)
        : output

      return {
        actionId: action.id,
        status: 'success',
        output: mappedOutput,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      return {
        actionId: action.id,
        status: 'failed',
        error: errorMessage,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      }
    }
  }

  /**
   * Resolve input variables using context data
   */
  private resolveInput(
    input: Record<string, unknown>,
    context: ActionContext
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {}
    const allData = {
      trigger: context.triggerData,
      results: context.previousResults,
      ...context.variables,
    }

    for (const [key, value] of Object.entries(input)) {
      resolved[key] = this.resolveValue(value, allData)
    }

    return resolved
  }

  /**
   * Resolve a single value, handling template strings
   */
  private resolveValue(value: unknown, data: Record<string, unknown>): unknown {
    if (typeof value !== 'string') return value

    // Check for template syntax: {{path.to.value}}
    const templateRegex = /\{\{([^}]+)\}\}/g
    let match
    let hasTemplates = false
    let result = value

    while ((match = templateRegex.exec(value)) !== null) {
      hasTemplates = true
      const path = match[1].trim()
      const resolved = getNestedValue(data, path)
      result = result.replace(match[0], String(resolved ?? ''))
    }

    // If the entire string was a single template, return the actual value type
    if (hasTemplates && value.match(/^\{\{[^}]+\}\}$/)) {
      const path = value.slice(2, -2).trim()
      return getNestedValue(data, path)
    }

    return result
  }

  /**
   * Apply output mapping to transform action output
   */
  private applyOutputMapping(
    output: Record<string, unknown>,
    mapping: Record<string, string>
  ): Record<string, unknown> {
    const mapped: Record<string, unknown> = {}

    for (const [targetKey, sourcePath] of Object.entries(mapping)) {
      mapped[targetKey] = getNestedValue(output, sourcePath)
    }

    return mapped
  }

  /**
   * Register built-in action handlers
   */
  private registerBuiltInHandlers(): void {
    // Tag actions
    this.handlers.set('add_order_tag', async (input) => {
      return { success: true, tag: input.tag, orderId: input.order_id }
    })

    this.handlers.set('remove_order_tag', async (input) => {
      return { success: true, tag: input.tag, orderId: input.order_id }
    })

    this.handlers.set('add_customer_tag', async (input) => {
      return { success: true, tag: input.tag, customerId: input.customer_id }
    })

    this.handlers.set('remove_customer_tag', async (input) => {
      return { success: true, tag: input.tag, customerId: input.customer_id }
    })

    this.handlers.set('add_product_tag', async (input) => {
      return { success: true, tag: input.tag, productId: input.product_id }
    })

    this.handlers.set('remove_product_tag', async (input) => {
      return { success: true, tag: input.tag, productId: input.product_id }
    })

    // Note/metafield actions
    this.handlers.set('add_order_note', async (input) => {
      return { success: true, note: input.note, orderId: input.order_id }
    })

    this.handlers.set('update_customer_metafield', async (input) => {
      return {
        success: true,
        namespace: input.namespace,
        key: input.key,
        value: input.value,
        customerId: input.customer_id,
      }
    })

    this.handlers.set('update_product_metafield', async (input) => {
      return {
        success: true,
        namespace: input.namespace,
        key: input.key,
        value: input.value,
        productId: input.product_id,
      }
    })

    // Order actions
    this.handlers.set('capture_payment', async (input) => {
      return { success: true, orderId: input.order_id, amount: input.amount }
    })

    this.handlers.set('cancel_order', async (input) => {
      return { success: true, orderId: input.order_id, reason: input.reason }
    })

    this.handlers.set('create_fulfillment', async (input) => {
      return {
        success: true,
        orderId: input.order_id,
        fulfillmentId: generateId(),
        trackingNumber: input.tracking_number,
      }
    })

    // Email actions
    this.handlers.set('send_email', async (input) => {
      return {
        success: true,
        to: input.to,
        subject: input.subject,
        messageId: generateId(),
      }
    })

    this.handlers.set('send_order_email', async (input) => {
      return {
        success: true,
        orderId: input.order_id,
        template: input.template,
        messageId: generateId(),
      }
    })

    this.handlers.set('send_customer_email', async (input) => {
      return {
        success: true,
        customerId: input.customer_id,
        template: input.template,
        messageId: generateId(),
      }
    })

    // Notification actions
    this.handlers.set('send_slack_message', async (input) => {
      return {
        success: true,
        channel: input.channel,
        message: input.message,
        timestamp: new Date().toISOString(),
      }
    })

    this.handlers.set('send_webhook', async (input) => {
      return {
        success: true,
        url: input.url,
        payload: input.payload,
        timestamp: new Date().toISOString(),
      }
    })

    this.handlers.set('send_sms', async (input) => {
      return {
        success: true,
        to: input.to,
        message: input.message,
        messageId: generateId(),
      }
    })

    // Inventory actions
    this.handlers.set('adjust_inventory', async (input) => {
      return {
        success: true,
        inventoryItemId: input.inventory_item_id,
        locationId: input.location_id,
        adjustment: input.adjustment,
      }
    })

    this.handlers.set('set_inventory', async (input) => {
      return {
        success: true,
        inventoryItemId: input.inventory_item_id,
        locationId: input.location_id,
        quantity: input.quantity,
      }
    })

    // Product visibility
    this.handlers.set('hide_product', async (input) => {
      return { success: true, productId: input.product_id, status: 'draft' }
    })

    this.handlers.set('publish_product', async (input) => {
      return { success: true, productId: input.product_id, status: 'active' }
    })

    // Data actions
    this.handlers.set('set_variable', async (input) => {
      return { [String(input.name)]: input.value }
    })

    this.handlers.set('transform_data', async (input) => {
      // Simple transform - in real implementation, this would support more operations
      return { transformed: input.data }
    })

    this.handlers.set('lookup_metafield', async (input) => {
      return {
        namespace: input.namespace,
        key: input.key,
        value: null, // Would be fetched from actual API
      }
    })

    // Control flow
    this.handlers.set('wait', async (input) => {
      const duration = Number(input.duration) || 1000
      await new Promise((resolve) => setTimeout(resolve, Math.min(duration, 5000)))
      return { waited: true, duration }
    })

    this.handlers.set('loop', async (input) => {
      // Loop is handled specially by the engine
      return { items: input.items, index: 0 }
    })

    this.handlers.set('branch', async (input) => {
      // Branch is handled specially by the engine
      return { branch: input.branch }
    })

    // Custom action (passthrough)
    this.handlers.set('custom', async (input) => {
      return { ...input }
    })
  }
}

// =============================================================================
// Flow Engine
// =============================================================================

/**
 * Main Flow automation engine
 */
export class FlowEngine {
  private workflows: Map<string, FlowWorkflow> = new Map()
  private executions: Map<string, FlowExecution> = new Map()
  private triggerWorkflows: Map<FlowTriggerType, Set<string>> = new Map()
  private conditionEvaluator: ConditionEvaluator
  private actionExecutor: ActionExecutor

  constructor() {
    this.conditionEvaluator = new ConditionEvaluator()
    this.actionExecutor = new ActionExecutor()
  }

  /**
   * Register a custom action handler
   */
  registerActionHandler(actionType: FlowActionType, handler: ActionHandler): void {
    this.actionExecutor.registerHandler(actionType, handler)
  }

  /**
   * Create a new workflow
   */
  createWorkflow(input: {
    title: string
    description?: string
    trigger: Omit<FlowTrigger, 'id'>
    conditions?: Omit<FlowCondition, 'id'>[]
    actions: Omit<FlowAction, 'id'>[]
    tags?: string[]
  }): FlowWorkflow {
    const now = new Date().toISOString()

    const workflow: FlowWorkflow = {
      id: generateId(),
      title: input.title,
      description: input.description,
      enabled: true,
      trigger: {
        ...input.trigger,
        id: generateId(),
      },
      conditions: input.conditions?.map((c) => ({ ...c, id: generateId() })),
      actions: input.actions.map((a) => ({ ...a, id: generateId() })),
      createdAt: now,
      updatedAt: now,
      version: 1,
      tags: input.tags,
    }

    return workflow
  }

  /**
   * Create a workflow from a template
   */
  createFromTemplate(
    template: FlowWorkflowTemplate,
    variables?: Record<string, unknown>
  ): FlowWorkflow {
    // Resolve template variables in input
    const resolveVariables = (obj: unknown): unknown => {
      if (typeof obj !== 'object' || obj === null) {
        if (typeof obj === 'string' && obj.startsWith('$')) {
          const varName = obj.slice(1)
          return variables?.[varName] ?? obj
        }
        return obj
      }

      if (Array.isArray(obj)) {
        return obj.map(resolveVariables)
      }

      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj)) {
        result[key] = resolveVariables(value)
      }
      return result
    }

    const resolvedActions = template.actions.map((a) => ({
      ...a,
      input: resolveVariables(a.input) as Record<string, unknown>,
    }))

    // Resolve variables in conditions too
    const resolvedConditions = template.conditions?.map((c) => ({
      ...c,
      value: resolveVariables(c.value),
    }))

    return this.createWorkflow({
      title: template.title,
      description: template.description,
      trigger: template.trigger,
      conditions: resolvedConditions,
      actions: resolvedActions,
      tags: template.tags,
    })
  }

  /**
   * Register a workflow for automatic trigger execution
   */
  registerWorkflow(workflow: FlowWorkflow): void {
    this.workflows.set(workflow.id, workflow)

    // Index by trigger type
    const triggerType = workflow.trigger.type
    if (!this.triggerWorkflows.has(triggerType)) {
      this.triggerWorkflows.set(triggerType, new Set())
    }
    this.triggerWorkflows.get(triggerType)!.add(workflow.id)
  }

  /**
   * Unregister a workflow
   */
  unregisterWorkflow(workflowId: string): boolean {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) return false

    this.workflows.delete(workflowId)

    // Remove from trigger index
    const triggerType = workflow.trigger.type
    const workflowIds = this.triggerWorkflows.get(triggerType)
    if (workflowIds) {
      workflowIds.delete(workflowId)
    }

    return true
  }

  /**
   * Get a workflow by ID
   */
  getWorkflow(workflowId: string): FlowWorkflow | undefined {
    return this.workflows.get(workflowId)
  }

  /**
   * List all registered workflows
   */
  listWorkflows(filter?: { enabled?: boolean; triggerType?: FlowTriggerType }): FlowWorkflow[] {
    let workflows = Array.from(this.workflows.values())

    if (filter?.enabled !== undefined) {
      workflows = workflows.filter((w) => w.enabled === filter.enabled)
    }

    if (filter?.triggerType) {
      workflows = workflows.filter((w) => w.trigger.type === filter.triggerType)
    }

    return workflows
  }

  /**
   * Update a workflow
   */
  updateWorkflow(
    workflowId: string,
    updates: Partial<Pick<FlowWorkflow, 'title' | 'description' | 'enabled' | 'conditions' | 'actions' | 'tags'>>
  ): FlowWorkflow | undefined {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) return undefined

    const updated: FlowWorkflow = {
      ...workflow,
      ...updates,
      updatedAt: new Date().toISOString(),
      version: workflow.version + 1,
    }

    this.workflows.set(workflowId, updated)
    return updated
  }

  /**
   * Handle a trigger event
   */
  async onTrigger(
    triggerType: FlowTriggerType,
    data: Record<string, unknown>
  ): Promise<FlowExecution[]> {
    const workflowIds = this.triggerWorkflows.get(triggerType)
    if (!workflowIds || workflowIds.size === 0) {
      return []
    }

    const executions: FlowExecution[] = []

    for (const workflowId of workflowIds) {
      const workflow = this.workflows.get(workflowId)
      if (!workflow || !workflow.enabled) continue

      const execution = await this.execute(workflowId, data)
      executions.push(execution)
    }

    return executions
  }

  /**
   * Execute a workflow
   */
  async execute(workflowId: string, triggerData: Record<string, unknown>): Promise<FlowExecution> {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    const executionId = generateId()
    const startedAt = new Date().toISOString()

    const execution: FlowExecution = {
      id: executionId,
      workflowId,
      status: 'running',
      triggerEvent: triggerData,
      currentStep: 0,
      stepResults: [],
      startedAt,
    }

    this.executions.set(executionId, execution)

    try {
      // Check workflow conditions
      if (workflow.conditions && workflow.conditions.length > 0) {
        const conditionsMet = this.conditionEvaluator.evaluateAll(workflow.conditions, triggerData)

        if (!conditionsMet) {
          execution.status = 'completed'
          execution.completedAt = new Date().toISOString()
          execution.durationMs = Date.now() - new Date(startedAt).getTime()
          execution.stepResults.push({
            actionId: 'workflow_conditions',
            status: 'skipped',
            output: { reason: 'Workflow conditions not met' },
            startedAt,
            completedAt: execution.completedAt,
            durationMs: execution.durationMs,
          })
          return execution
        }
      }

      // Execute actions in sequence
      const variables: Record<string, unknown> = {}
      const previousResults: Record<string, unknown> = {}

      for (let i = 0; i < workflow.actions.length; i++) {
        const action = workflow.actions[i]
        execution.currentStep = i

        const context: ActionContext = {
          workflowId,
          executionId,
          triggerData,
          previousResults,
          variables,
        }

        const result = await this.actionExecutor.execute(action, context)
        execution.stepResults.push(result)

        // Update context with results
        if (result.output) {
          previousResults[action.id] = result.output
          Object.assign(variables, result.output)
        }

        // Handle errors
        if (result.status === 'failed') {
          const onError = action.onError ?? 'stop'

          if (onError === 'stop') {
            execution.status = 'failed'
            execution.error = {
              message: result.error || 'Action failed',
              actionId: action.id,
              step: i,
              retryable: onError === 'retry',
            }
            break
          } else if (onError === 'retry' && action.maxRetries) {
            // Retry logic
            let retryCount = 0
            while (retryCount < action.maxRetries) {
              if (action.retryDelay) {
                await new Promise((resolve) => setTimeout(resolve, action.retryDelay))
              }

              const retryResult = await this.actionExecutor.execute(action, context)
              retryCount++

              if (retryResult.status === 'success') {
                // Replace the failed result with success
                execution.stepResults[execution.stepResults.length - 1] = retryResult
                if (retryResult.output) {
                  previousResults[action.id] = retryResult.output
                  Object.assign(variables, retryResult.output)
                }
                break
              }

              if (retryCount >= action.maxRetries) {
                execution.status = 'failed'
                execution.error = {
                  message: `Action failed after ${retryCount} retries: ${retryResult.error}`,
                  actionId: action.id,
                  step: i,
                  retryable: false,
                }
              }
            }

            if (execution.status === 'failed') break
          }
          // 'continue' - just proceed to next action
        }
      }

      // Mark as completed if not already failed
      if (execution.status === 'running') {
        execution.status = 'completed'
      }
    } catch (error) {
      execution.status = 'failed'
      execution.error = {
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      }
    }

    execution.completedAt = new Date().toISOString()
    execution.durationMs = Date.now() - new Date(startedAt).getTime()

    return execution
  }

  /**
   * Get an execution by ID
   */
  getExecution(executionId: string): FlowExecution | undefined {
    return this.executions.get(executionId)
  }

  /**
   * List executions for a workflow
   */
  listExecutions(workflowId: string): FlowExecution[] {
    return Array.from(this.executions.values()).filter((e) => e.workflowId === workflowId)
  }

  /**
   * Evaluate conditions without executing a workflow
   */
  evaluateConditions(conditions: FlowCondition[], data: Record<string, unknown>): boolean {
    return this.conditionEvaluator.evaluateAll(conditions, data)
  }
}

// =============================================================================
// Built-in Workflow Templates
// =============================================================================

/**
 * Pre-built workflow templates
 */
export const FlowTemplates = {
  /**
   * Tag high-value customers when their total spend exceeds a threshold
   */
  TAG_HIGH_VALUE_CUSTOMERS: {
    id: 'template_high_value_customers',
    title: 'Tag High-Value Customers',
    description: 'Automatically tag customers when their total spend exceeds a threshold',
    category: 'customers' as FlowTemplateCategory,
    trigger: {
      type: 'order_paid' as FlowTriggerType,
      title: 'When order is paid',
    },
    conditions: [
      {
        property: 'customer.total_spent',
        operator: 'greater_than' as FlowConditionOperator,
        value: '$threshold',
      },
    ],
    actions: [
      {
        type: 'add_customer_tag' as FlowActionType,
        input: {
          customer_id: '{{customer.id}}',
          tag: 'vip',
        },
      },
    ],
    requiredVariables: [
      {
        name: 'threshold',
        type: 'money' as FlowPropertyType,
        description: 'Minimum total spend to be tagged as VIP',
        required: true,
        defaultValue: 1000,
      },
    ],
    setupTimeMinutes: 2,
    tags: ['customers', 'loyalty', 'tags'],
  } as FlowWorkflowTemplate,

  /**
   * Send low stock notification
   */
  LOW_STOCK_ALERT: {
    id: 'template_low_stock_alert',
    title: 'Low Stock Alert',
    description: 'Send notification when inventory drops below threshold',
    category: 'inventory' as FlowTemplateCategory,
    trigger: {
      type: 'inventory_level_updated' as FlowTriggerType,
      title: 'When inventory level changes',
    },
    conditions: [
      {
        property: 'inventory_level.available',
        operator: 'less_than' as FlowConditionOperator,
        value: '$threshold',
      },
    ],
    actions: [
      {
        type: 'send_slack_message' as FlowActionType,
        input: {
          channel: '$channel',
          message: 'Low stock alert: {{product.title}} has only {{inventory_level.available}} units remaining',
        },
      },
    ],
    requiredVariables: [
      {
        name: 'threshold',
        type: 'number' as FlowPropertyType,
        description: 'Inventory level that triggers the alert',
        required: true,
        defaultValue: 10,
      },
      {
        name: 'channel',
        type: 'string' as FlowPropertyType,
        description: 'Slack channel for notifications',
        required: true,
        defaultValue: '#inventory',
      },
    ],
    setupTimeMinutes: 3,
    tags: ['inventory', 'notifications', 'slack'],
  } as FlowWorkflowTemplate,

  /**
   * Tag orders for review based on criteria
   */
  FLAG_HIGH_RISK_ORDERS: {
    id: 'template_high_risk_orders',
    title: 'Flag High-Risk Orders',
    description: 'Tag orders that meet high-risk criteria for manual review',
    category: 'orders' as FlowTemplateCategory,
    trigger: {
      type: 'order_created' as FlowTriggerType,
      title: 'When order is created',
    },
    conditions: [
      {
        property: 'order.total_price',
        operator: 'greater_than' as FlowConditionOperator,
        value: '$amount_threshold',
      },
    ],
    actions: [
      {
        type: 'add_order_tag' as FlowActionType,
        input: {
          order_id: '{{order.id}}',
          tag: 'review-required',
        },
      },
      {
        type: 'add_order_note' as FlowActionType,
        input: {
          order_id: '{{order.id}}',
          note: 'Flagged for review: Order exceeds ${{trigger.amount_threshold}} threshold',
        },
      },
    ],
    requiredVariables: [
      {
        name: 'amount_threshold',
        type: 'money' as FlowPropertyType,
        description: 'Order amount that triggers review',
        required: true,
        defaultValue: 500,
      },
    ],
    setupTimeMinutes: 2,
    tags: ['orders', 'fraud', 'review'],
  } as FlowWorkflowTemplate,

  /**
   * Send fulfillment notification
   */
  FULFILLMENT_NOTIFICATION: {
    id: 'template_fulfillment_notification',
    title: 'Fulfillment Notification',
    description: 'Send customer email when order is fulfilled',
    category: 'fulfillment' as FlowTemplateCategory,
    trigger: {
      type: 'order_fulfilled' as FlowTriggerType,
      title: 'When order is fulfilled',
    },
    actions: [
      {
        type: 'send_order_email' as FlowActionType,
        input: {
          order_id: '{{order.id}}',
          template: 'shipping_confirmation',
        },
      },
    ],
    setupTimeMinutes: 1,
    tags: ['fulfillment', 'email', 'customers'],
  } as FlowWorkflowTemplate,

  /**
   * Auto-tag new customers
   */
  TAG_NEW_CUSTOMERS: {
    id: 'template_tag_new_customers',
    title: 'Tag New Customers',
    description: 'Automatically tag customers when they create their first order',
    category: 'customers' as FlowTemplateCategory,
    trigger: {
      type: 'customer_created' as FlowTriggerType,
      title: 'When customer is created',
    },
    actions: [
      {
        type: 'add_customer_tag' as FlowActionType,
        input: {
          customer_id: '{{customer.id}}',
          tag: 'new-customer',
        },
      },
    ],
    setupTimeMinutes: 1,
    tags: ['customers', 'tags', 'onboarding'],
  } as FlowWorkflowTemplate,

  /**
   * Cancel orders after timeout
   */
  CANCEL_UNPAID_ORDERS: {
    id: 'template_cancel_unpaid_orders',
    title: 'Cancel Unpaid Orders',
    description: 'Automatically cancel orders that remain unpaid',
    category: 'orders' as FlowTemplateCategory,
    trigger: {
      type: 'scheduled' as FlowTriggerType,
      title: 'Daily schedule',
      schedule: '0 0 * * *', // Daily at midnight
    },
    conditions: [
      {
        property: 'order.financial_status',
        operator: 'equals' as FlowConditionOperator,
        value: 'pending',
      },
    ],
    actions: [
      {
        type: 'cancel_order' as FlowActionType,
        input: {
          order_id: '{{order.id}}',
          reason: 'Payment not received within time limit',
        },
      },
    ],
    setupTimeMinutes: 3,
    tags: ['orders', 'automation', 'payments'],
  } as FlowWorkflowTemplate,

  /**
   * Webhook integration template
   */
  WEBHOOK_INTEGRATION: {
    id: 'template_webhook_integration',
    title: 'Webhook Integration',
    description: 'Send order data to external webhook when orders are created',
    category: 'integrations' as FlowTemplateCategory,
    trigger: {
      type: 'order_created' as FlowTriggerType,
      title: 'When order is created',
    },
    actions: [
      {
        type: 'send_webhook' as FlowActionType,
        input: {
          url: '$webhook_url',
          payload: {
            event: 'order_created',
            order_id: '{{order.id}}',
            order_name: '{{order.name}}',
            total: '{{order.total_price}}',
            customer_email: '{{customer.email}}',
          },
        },
        onError: 'retry',
        maxRetries: 3,
        retryDelay: 5000,
      },
    ],
    requiredVariables: [
      {
        name: 'webhook_url',
        type: 'string' as FlowPropertyType,
        description: 'URL to send webhook requests to',
        required: true,
      },
    ],
    setupTimeMinutes: 5,
    tags: ['integrations', 'webhooks', 'external'],
  } as FlowWorkflowTemplate,
}

// =============================================================================
// Default Export
// =============================================================================

export default FlowEngine
