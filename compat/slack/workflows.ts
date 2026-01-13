/**
 * @dotdo/slack/workflows - Slack Workflows Integration
 *
 * Complete support for Slack Workflows including:
 * - WorkflowBuilder for programmatic workflow definition
 * - Workflow triggers (webhook, scheduled, event-based)
 * - Custom workflow steps with edit/save/execute lifecycle
 * - Workflows API client methods
 *
 * @example WorkflowBuilder
 * ```typescript
 * import { WorkflowBuilder, createWorkflow } from '@dotdo/slack/workflows'
 *
 * const workflow = new WorkflowBuilder('approval_workflow')
 *   .name('Approval Workflow')
 *   .description('Handle approval requests')
 *   .input('request', { type: 'string', title: 'Request', required: true })
 *   .input('approver', { type: 'slack#/types/user_id', title: 'Approver' })
 *   .addStep('slack#/functions/send_message', {
 *     channel_id: '{{inputs.channel}}',
 *     message: 'New request: {{inputs.request}}',
 *   })
 *   .output('message_ts', { type: 'string', value: '{{steps.step_0.outputs.ts}}' })
 *   .build()
 * ```
 *
 * @example Custom Workflow Step
 * ```typescript
 * import { createWorkflowStep } from '@dotdo/slack/workflows'
 *
 * const step = createWorkflowStep('create_ticket', {
 *   edit: async ({ configure }) => {
 *     await configure({ blocks: [...] })
 *   },
 *   save: async ({ view, update }) => {
 *     await update({ inputs: {...}, outputs: [...] })
 *   },
 *   execute: async ({ inputs, complete, fail }) => {
 *     try {
 *       const ticket = await createTicket(inputs)
 *       await complete({ outputs: { ticket_id: ticket.id } })
 *     } catch (error) {
 *       await fail({ error: error.message })
 *     }
 *   },
 * })
 *
 * app.step(step)
 * ```
 *
 * @see https://api.slack.com/workflows
 * @see https://api.slack.com/automation/functions/custom-bolt
 * @module @dotdo/slack/workflows
 */

import type { Block, ViewOutput, ViewState } from './types'

// ============================================================================
// WORKFLOW TYPES
// ============================================================================

/**
 * Input parameter type for workflows
 */
export type WorkflowInputType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'slack#/types/channel_id'
  | 'slack#/types/user_id'
  | 'slack#/types/timestamp'
  | 'slack#/types/rich_text'
  | 'slack#/types/message_ts'
  | 'slack#/types/file_id'
  | string

/**
 * Input parameter definition
 */
export interface WorkflowInput {
  type: WorkflowInputType
  title?: string
  description?: string
  required?: boolean
  default?: unknown
}

/**
 * Output parameter definition
 */
export interface WorkflowOutput {
  type: WorkflowInputType
  title?: string
  value: string
}

/**
 * Step definition in a workflow
 */
export interface WorkflowStepDefinition {
  function_id: string
  name?: string
  inputs: Record<string, unknown>
  type?: 'function' | 'conditional'
  condition?: string
  then?: Omit<WorkflowStepDefinition, 'type' | 'condition' | 'then' | 'else'>
  else?: Omit<WorkflowStepDefinition, 'type' | 'condition' | 'then' | 'else'>
}

/**
 * Complete workflow definition
 */
export interface WorkflowDefinition {
  callback_id: string
  title: string
  description?: string
  input_parameters: Record<string, WorkflowInput>
  output_parameters: Record<string, WorkflowOutput>
  steps: WorkflowStepDefinition[]
}

// ============================================================================
// WORKFLOW BUILDER
// ============================================================================

/**
 * Options for adding a step
 */
export interface AddStepOptions {
  name?: string
}

/**
 * Conditional step configuration
 */
export interface ConditionalStepConfig {
  condition: string
  then: {
    function_id: string
    inputs: Record<string, unknown>
  }
  else?: {
    function_id: string
    inputs: Record<string, unknown>
  }
}

/**
 * Build options
 */
export interface BuildOptions {
  validate?: boolean
}

/**
 * Fluent builder for creating workflow definitions
 */
export class WorkflowBuilder {
  private _callbackId: string
  private _title: string = ''
  private _description?: string
  private _inputs: Record<string, WorkflowInput> = {}
  private _outputs: Record<string, WorkflowOutput> = {}
  private _steps: WorkflowStepDefinition[] = []
  private _stepCounter = 0

  constructor(callbackId: string) {
    this._callbackId = callbackId
  }

  /**
   * Set workflow name/title
   */
  name(title: string): this {
    this._title = title
    return this
  }

  /**
   * Set workflow description
   */
  description(desc: string): this {
    this._description = desc
    return this
  }

  /**
   * Add an input parameter
   */
  input(name: string, config: WorkflowInput): this {
    this._inputs[name] = config
    return this
  }

  /**
   * Add a workflow step
   */
  addStep(
    functionId: string,
    inputs: Record<string, unknown>,
    options?: AddStepOptions
  ): this {
    const stepName = options?.name ?? `step_${this._stepCounter++}`
    this._steps.push({
      function_id: functionId,
      name: stepName,
      inputs,
      type: 'function',
    })
    return this
  }

  /**
   * Add a conditional step
   */
  addConditionalStep(config: ConditionalStepConfig): this {
    this._steps.push({
      function_id: '',
      type: 'conditional',
      condition: config.condition,
      inputs: {},
      then: {
        function_id: config.then.function_id,
        inputs: config.then.inputs,
      },
      else: config.else ? {
        function_id: config.else.function_id,
        inputs: config.else.inputs,
      } : undefined,
    })
    return this
  }

  /**
   * Add an output parameter
   */
  output(name: string, config: WorkflowOutput): this {
    this._outputs[name] = config
    return this
  }

  /**
   * Build the workflow definition
   */
  build(options?: BuildOptions): WorkflowDefinition {
    if (options?.validate) {
      this._validate()
    }

    return {
      callback_id: this._callbackId,
      title: this._title,
      description: this._description,
      input_parameters: this._inputs,
      output_parameters: this._outputs,
      steps: this._steps,
    }
  }

  /**
   * Validate the workflow definition
   */
  private _validate(): void {
    const inputNames = new Set(Object.keys(this._inputs))

    for (const step of this._steps) {
      this._validateStepInputs(step.inputs, inputNames)
    }
  }

  /**
   * Validate step inputs reference valid workflow inputs
   */
  private _validateStepInputs(
    stepInputs: Record<string, unknown>,
    validInputs: Set<string>
  ): void {
    for (const [, value] of Object.entries(stepInputs)) {
      if (typeof value === 'string') {
        const matches = value.match(/\{\{inputs\.(\w+)\}\}/g)
        if (matches) {
          for (const match of matches) {
            const inputName = match.match(/\{\{inputs\.(\w+)\}\}/)?.[1]
            if (inputName && !validInputs.has(inputName)) {
              throw new Error(`Invalid input reference: ${inputName}`)
            }
          }
        }
      }
    }
  }
}

/**
 * Create a workflow from a config object
 */
export function createWorkflow(
  callbackId: string,
  config: {
    name: string
    description?: string
    inputs?: Record<string, WorkflowInput>
    steps: Array<{
      function_id: string
      inputs: Record<string, unknown>
      name?: string
    }>
    outputs?: Record<string, WorkflowOutput>
  }
): WorkflowDefinition {
  const builder = new WorkflowBuilder(callbackId)
    .name(config.name)

  if (config.description) {
    builder.description(config.description)
  }

  if (config.inputs) {
    for (const [name, input] of Object.entries(config.inputs)) {
      builder.input(name, input)
    }
  }

  for (const step of config.steps) {
    builder.addStep(step.function_id, step.inputs, { name: step.name })
  }

  if (config.outputs) {
    for (const [name, output] of Object.entries(config.outputs)) {
      builder.output(name, output)
    }
  }

  return builder.build()
}

// ============================================================================
// WORKFLOW TRIGGER TYPES
// ============================================================================

/**
 * Trigger types
 */
export type TriggerType = 'webhook' | 'scheduled' | 'event'

/**
 * Base trigger configuration
 */
export interface BaseTriggerConfig {
  type: TriggerType
  workflow: string
  name: string
  inputs?: Record<string, { value: string }>
}

/**
 * Webhook trigger configuration
 */
export interface WebhookTrigger extends BaseTriggerConfig {
  type: 'webhook'
}

/**
 * Schedule configuration
 */
export type ScheduleConfig =
  | { type: 'cron'; expression: string; timezone?: string }
  | { type: 'frequency'; frequency: { type: 'hourly' | 'daily' | 'weekly' | 'monthly' }; start_time?: string }
  | { type: 'once'; scheduled_time: string }

/**
 * Scheduled trigger configuration
 */
export interface ScheduledTrigger extends BaseTriggerConfig {
  type: 'scheduled'
  schedule: ScheduleConfig
}

/**
 * Event trigger configuration
 */
export interface EventTrigger extends BaseTriggerConfig {
  type: 'event'
  event_type: string
  channel_ids?: string[]
  filter?: Record<string, unknown>
}

/**
 * Union of all trigger configurations
 */
export type TriggerConfig = WebhookTrigger | ScheduledTrigger | EventTrigger

/**
 * Trigger response
 */
export interface TriggerResponse {
  id: string
  type: TriggerType
  workflow_id?: string
  webhook_url?: string
}

/**
 * Trigger list response
 */
export interface TriggersListResponse {
  ok: boolean
  triggers: TriggerResponse[]
}

/**
 * Trigger update arguments
 */
export interface TriggerUpdateArgs {
  trigger_id: string
  name?: string
  inputs?: Record<string, { value: string }>
}

/**
 * Trigger delete arguments
 */
export interface TriggerDeleteArgs {
  trigger_id: string
}

// ============================================================================
// WORKFLOW STEP TYPES
// ============================================================================

/**
 * Workflow step edit payload
 */
export interface WorkflowStepEditPayload {
  type: 'workflow_step_edit'
  callback_id: string
  trigger_id: string
  workflow_step: {
    workflow_step_edit_id: string
    inputs: Record<string, { value: unknown }>
    outputs: WorkflowStepOutput[]
  }
  user: { id: string }
  team?: { id: string }
}

/**
 * Workflow step save payload
 */
export interface WorkflowStepSavePayload {
  type: 'view_submission'
  view: ViewOutput
  user: { id: string }
  workflow_step?: {
    workflow_step_edit_id: string
  }
}

/**
 * Workflow step execute payload
 */
export interface WorkflowStepExecutePayload {
  type: 'workflow_step_execute'
  callback_id: string
  workflow_step: {
    workflow_step_execute_id: string
    inputs: Record<string, { value: unknown }>
    outputs?: WorkflowStepOutput[]
  }
  event?: {
    type: 'workflow_step_execute'
    callback_id: string
    workflow_step: { workflow_step_execute_id: string }
  }
}

/**
 * Workflow step output definition
 */
export interface WorkflowStepOutput {
  name: string
  type: string
  label: string
}

/**
 * Configure function for step edit
 */
export interface ConfigureFn {
  (config: { blocks: Block[] }): Promise<void>
}

/**
 * Update function for step save
 */
export interface UpdateFn {
  (config: {
    inputs: Record<string, { value: unknown }>
    outputs: WorkflowStepOutput[]
  }): Promise<void>
}

/**
 * Complete function for step execute
 */
export interface CompleteFn {
  (result: { outputs: Record<string, unknown> }): Promise<void>
}

/**
 * Fail function for step execute
 */
export interface FailFn {
  (result: { error: string }): Promise<void>
}

/**
 * Arguments for step edit handler
 */
export interface WorkflowEditArgs {
  ack: () => Promise<void>
  configure: ConfigureFn
  step: WorkflowStepEditPayload['workflow_step']
  payload: WorkflowStepEditPayload
  context: Record<string, unknown>
}

/**
 * Arguments for step save handler
 */
export interface WorkflowSaveArgs {
  ack: () => Promise<void>
  update: UpdateFn
  view: ViewOutput & { state: ViewState }
  step?: { workflow_step_edit_id: string }
  payload: WorkflowStepSavePayload
  context: Record<string, unknown>
}

/**
 * Arguments for step execute handler
 */
export interface WorkflowExecuteArgs {
  inputs: Record<string, { value: unknown }>
  step: WorkflowStepExecutePayload['workflow_step']
  complete: CompleteFn
  fail: FailFn
  payload: WorkflowStepExecutePayload
  context: Record<string, unknown>
}

/**
 * Workflow step configuration
 */
export interface WorkflowStepConfig {
  edit: (args: WorkflowEditArgs) => Promise<void>
  save: (args: WorkflowSaveArgs) => Promise<void>
  execute: (args: WorkflowExecuteArgs) => Promise<void>
}

/**
 * Workflow step class
 */
export class WorkflowStep {
  readonly callbackId: string
  readonly config: WorkflowStepConfig

  constructor(callbackId: string, config: WorkflowStepConfig) {
    this.callbackId = callbackId
    this.config = config
  }
}

/**
 * Create a workflow step
 */
export function createWorkflowStep(
  callbackId: string,
  config: WorkflowStepConfig
): WorkflowStep {
  return new WorkflowStep(callbackId, config)
}

// ============================================================================
// WORKFLOW CLIENT
// ============================================================================

/**
 * Step completed arguments
 */
export interface StepCompletedArgs {
  workflow_step_execute_id: string
  outputs: Record<string, unknown>
}

/**
 * Step failed arguments
 */
export interface StepFailedArgs {
  workflow_step_execute_id: string
  error: { message: string }
}

/**
 * Step update arguments
 */
export interface StepUpdateArgs {
  workflow_step_edit_id: string
  inputs: Record<string, { value: unknown }>
  outputs: WorkflowStepOutput[]
}

/**
 * Workflow publish response
 */
export interface WorkflowPublishResponse {
  ok: boolean
  workflow: { id: string }
}

/**
 * Workflow delete response
 */
export interface WorkflowDeleteResponse {
  ok: boolean
}

/**
 * Workflow list response
 */
export interface WorkflowListResponse {
  ok: boolean
  workflows: Array<{ id: string; name: string }>
}

/**
 * Workflow info response
 */
export interface WorkflowInfoResponse {
  ok: boolean
  workflow: { id: string; name: string }
}

/**
 * API response
 */
export interface APIResponse {
  ok: boolean
  error?: string
}

/**
 * Triggers API client
 */
export class TriggersClient {
  constructor(private readonly client: WorkflowClient) {}

  /**
   * Create a trigger
   */
  async create(config: TriggerConfig): Promise<TriggerResponse> {
    const response = await this.client._request<TriggerResponse & { trigger: TriggerResponse }>(
      'workflows.triggers.create',
      config
    )
    return response.trigger
  }

  /**
   * List triggers
   */
  async list(args?: { workflow?: string }): Promise<TriggersListResponse> {
    return this.client._request('workflows.triggers.list', args ?? {})
  }

  /**
   * Update a trigger
   */
  async update(args: TriggerUpdateArgs): Promise<APIResponse> {
    return this.client._request('workflows.triggers.update', args)
  }

  /**
   * Delete a trigger
   */
  async delete(args: TriggerDeleteArgs): Promise<APIResponse> {
    return this.client._request('workflows.triggers.delete', args)
  }
}

/**
 * Workflow API client
 */
export class WorkflowClient {
  private readonly token: string
  private readonly baseUrl: string
  private readonly _fetch: typeof fetch

  readonly triggers: TriggersClient

  constructor(token: string, options?: { baseUrl?: string; fetch?: typeof fetch }) {
    this.token = token
    this.baseUrl = options?.baseUrl ?? 'https://slack.com/api'
    this._fetch = options?.fetch ?? globalThis.fetch.bind(globalThis)
    this.triggers = new TriggersClient(this)
  }

  /**
   * Publish a workflow
   */
  async publish(workflow: WorkflowDefinition): Promise<WorkflowPublishResponse> {
    return this._request('workflows.publish', { workflow })
  }

  /**
   * Delete a workflow
   */
  async delete(callbackId: string): Promise<WorkflowDeleteResponse> {
    return this._request('workflows.delete', { callback_id: callbackId })
  }

  /**
   * List workflows
   */
  async list(): Promise<WorkflowListResponse> {
    return this._request('workflows.list', {})
  }

  /**
   * Get workflow info
   */
  async info(workflowId: string): Promise<WorkflowInfoResponse> {
    return this._request('workflows.info', { workflow_id: workflowId })
  }

  /**
   * Mark a step as completed
   */
  async stepCompleted(args: StepCompletedArgs): Promise<APIResponse> {
    return this._request('workflows.stepCompleted', args)
  }

  /**
   * Mark a step as failed
   */
  async stepFailed(args: StepFailedArgs): Promise<APIResponse> {
    return this._request('workflows.stepFailed', args)
  }

  /**
   * Update step configuration
   */
  async updateStep(args: StepUpdateArgs): Promise<APIResponse> {
    return this._request('workflows.updateStep', args)
  }

  /**
   * Make an API request
   * @internal
   */
  async _request<T>(method: string, args: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/${method}`

    const response = await this._fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(args),
    })

    const data = await response.json()

    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`)
    }

    return data as T
  }
}

// ============================================================================
// TRIGGER HELPER CLASS
// ============================================================================

/**
 * Workflow trigger helper
 */
export class WorkflowTrigger {
  /**
   * Create a webhook trigger
   */
  static webhook(workflow: string, name: string, inputs?: Record<string, { value: string }>): WebhookTrigger {
    return {
      type: 'webhook',
      workflow,
      name,
      inputs,
    }
  }

  /**
   * Create a scheduled trigger with cron
   */
  static cron(
    workflow: string,
    name: string,
    expression: string,
    timezone?: string
  ): ScheduledTrigger {
    return {
      type: 'scheduled',
      workflow,
      name,
      schedule: {
        type: 'cron',
        expression,
        timezone,
      },
    }
  }

  /**
   * Create a scheduled trigger with frequency
   */
  static frequency(
    workflow: string,
    name: string,
    frequency: 'hourly' | 'daily' | 'weekly' | 'monthly',
    startTime?: string
  ): ScheduledTrigger {
    return {
      type: 'scheduled',
      workflow,
      name,
      schedule: {
        type: 'frequency',
        frequency: { type: frequency },
        start_time: startTime,
      },
    }
  }

  /**
   * Create a one-time scheduled trigger
   */
  static once(workflow: string, name: string, scheduledTime: string): ScheduledTrigger {
    return {
      type: 'scheduled',
      workflow,
      name,
      schedule: {
        type: 'once',
        scheduled_time: scheduledTime,
      },
    }
  }

  /**
   * Create an event trigger
   */
  static event(
    workflow: string,
    name: string,
    eventType: string,
    options?: { channel_ids?: string[]; filter?: Record<string, unknown> }
  ): EventTrigger {
    return {
      type: 'event',
      workflow,
      name,
      event_type: eventType,
      channel_ids: options?.channel_ids,
      filter: options?.filter,
    }
  }
}
