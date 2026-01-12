/**
 * Workflow() Factory
 *
 * Creates workflow definitions with:
 * - Configuration (name, description)
 * - Steps (.step()) for execution logic
 * - Triggers (.trigger()) for webhooks, cron, events
 * - Event handlers (.on())
 *
 * The factory validates definitions and produces workflow entrypoints
 * compatible with Cloudflare Workflows.
 */

// ============================================================================
// ERROR CLASSES
// ============================================================================

export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowValidationError'
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface StepContext {
  workflowId: string
  instanceId: string
  stepName: string
  input: unknown
  emit: (event: string, data: unknown) => Promise<void>
  log: (message: string, data?: unknown) => void
  sleep: (ms: number) => Promise<void>
  waitForEvent: <T>(eventType: string, options?: { timeout?: number }) => Promise<T>
}

export interface TriggerContext {
  workflowId: string
  type: 'webhook' | 'cron' | 'event'
  payload: unknown
}

export type WorkflowStepHandler = (input: unknown, ctx: StepContext) => unknown | Promise<unknown>

export type WorkflowEventHandler = (event: WorkflowEvent) => void | Promise<void>

export interface WorkflowEvent {
  type: string
  workflowId: string
  instanceId: string
  timestamp: Date
  data?: unknown
}

export interface WorkflowDefinition {
  name: string
  description?: string
  version?: string
  tags?: string[]
}

export interface WorkflowStepDefinition {
  name: string
  type: 'do' | 'sleep' | 'waitForEvent'
  handler?: WorkflowStepHandler
  timeout?: number
  retries?: number
  retryDelay?: number
  duration?: number
  event?: string
}

export interface SleepStepConfig {
  type: 'sleep'
  duration: number
}

export interface WaitForEventStepConfig {
  type: 'waitForEvent'
  event: string
  timeout?: number
}

export type StepConfig = SleepStepConfig | WaitForEventStepConfig

export interface StepOptions {
  timeout?: number
  retries?: number
  retryDelay?: number
}

export interface WebhookTriggerConfig {
  path: string
  method?: string
  headers?: Record<string, string>
  transform?: (req: Request) => unknown
}

export interface CronTriggerConfig {
  schedule: string
  name?: string
  timezone?: string
}

export interface EventTriggerConfig {
  event?: string
  events?: string[]
  filter?: (payload: unknown) => boolean
}

export type WorkflowTriggerConfig = WebhookTriggerConfig | CronTriggerConfig | EventTriggerConfig

export interface WorkflowTrigger {
  type: 'webhook' | 'cron' | 'event'
  config: WorkflowTriggerConfig
}

export interface WorkflowEventHandlerDefinition {
  event: string
  handler: WorkflowEventHandler
}

export interface WorkflowBuilder {
  name: string
  description?: string
  version?: string
  tags?: string[]
  steps: WorkflowStepDefinition[]
  triggers: WorkflowTrigger[]
  eventHandlers: WorkflowEventHandlerDefinition[]

  step(name: string, handler: WorkflowStepHandler, options?: StepOptions): WorkflowBuilder
  step(name: string, config: StepConfig): WorkflowBuilder
  trigger(type: 'webhook', config: WebhookTriggerConfig): WorkflowBuilder
  trigger(type: 'cron', config: CronTriggerConfig): WorkflowBuilder
  trigger(type: 'event', config: EventTriggerConfig): WorkflowBuilder
  on(event: string, handler: WorkflowEventHandler): WorkflowBuilder
  create(): WorkflowEntrypointClass
  toJSON(): WorkflowJSON
  describe(): WorkflowDescription
  getMetadata(): WorkflowMetadata
}

export interface WorkflowJSON {
  name: string
  description?: string
  steps: Array<{ name: string; type: string }>
  triggers: Array<{ type: string; config: Record<string, unknown> }>
  eventHandlers: unknown[]
}

export interface WorkflowDescription {
  name: string
  stepCount: number
  stepNames: string[]
  triggerTypes: string[]
  hasEventHandlers: boolean
}

export interface WorkflowMetadata {
  name: string
  version?: string
  tags?: string[]
  stepCount: number
  triggerCount: number
  eventHandlerCount: number
}

export interface WorkflowEntrypoint {
  run(event: unknown, step: StepContext): Promise<unknown>
  step: {
    do: <T>(name: string, callback: () => T | Promise<T>) => Promise<T>
    sleep: (name: string, duration: number | string) => Promise<void>
    waitForEvent: <T>(name: string, options: { type: string; timeout?: number }) => Promise<T>
  }
}

export interface WorkflowEntrypointClass {
  new (): WorkflowEntrypoint
  workflowName: string
  steps: WorkflowStepDefinition[]
  triggers: WorkflowTrigger[]
  eventHandlers: WorkflowEventHandlerDefinition[]
}

// ============================================================================
// VALIDATION
// ============================================================================

const VALID_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/
const VALID_STEP_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/

// Basic cron validation - checks for 5 or 6 space-separated fields
const CRON_PATTERN = /^(\S+\s+){4,5}\S+$/

function validateWorkflowName(name: string | undefined): void {
  if (!name) {
    throw new WorkflowValidationError('Workflow name is required')
  }

  if (typeof name !== 'string' || name.trim() === '') {
    throw new WorkflowValidationError('Workflow name must be a non-empty string')
  }

  if (!VALID_NAME_PATTERN.test(name)) {
    throw new WorkflowValidationError(
      `Workflow name "${name}" contains invalid characters. Names must start with a letter and contain only letters, numbers, underscores, and hyphens.`
    )
  }
}

function validateStepName(name: string, existingSteps: WorkflowStepDefinition[]): void {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new WorkflowValidationError('Step name is required and must be a non-empty string')
  }

  if (!VALID_STEP_NAME_PATTERN.test(name)) {
    throw new WorkflowValidationError(
      `Step name "${name}" contains invalid characters. Names must start with a letter and contain only letters, numbers, underscores, and hyphens.`
    )
  }

  if (existingSteps.some((s) => s.name === name)) {
    throw new WorkflowValidationError(`Step name "${name}" is already used. Step names must be unique.`)
  }
}

function validateStepHandler(handler: unknown): void {
  if (typeof handler !== 'function') {
    throw new WorkflowValidationError('Step handler must be a function')
  }
}

function validateStepOptions(options: StepOptions | undefined): void {
  if (!options) return

  if (options.timeout !== undefined && options.timeout < 0) {
    throw new WorkflowValidationError('Step timeout must be non-negative')
  }

  if (options.retries !== undefined && options.retries < 0) {
    throw new WorkflowValidationError('Step retries must be non-negative')
  }

  if (options.retryDelay !== undefined && options.retryDelay < 0) {
    throw new WorkflowValidationError('Step retryDelay must be non-negative')
  }
}

function validateWebhookTrigger(config: WebhookTriggerConfig): void {
  if (!config.path || typeof config.path !== 'string') {
    throw new WorkflowValidationError('Webhook trigger requires a path')
  }
}

function validateCronTrigger(config: CronTriggerConfig): void {
  if (!config.schedule || typeof config.schedule !== 'string') {
    throw new WorkflowValidationError('Cron trigger requires a schedule')
  }

  if (!CRON_PATTERN.test(config.schedule)) {
    throw new WorkflowValidationError(
      `Invalid cron schedule: "${config.schedule}". Expected 5 or 6 space-separated fields.`
    )
  }
}

function validateEventTrigger(config: EventTriggerConfig): void {
  if (!config.event && (!config.events || config.events.length === 0)) {
    throw new WorkflowValidationError('Event trigger requires an event name or array of events')
  }
}

function validateEventHandlerName(name: string): void {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new WorkflowValidationError('Event handler event name is required')
  }
}

function validateEventHandlerFunction(handler: unknown): void {
  if (typeof handler !== 'function') {
    throw new WorkflowValidationError('Event handler must be a function')
  }
}

// ============================================================================
// WORKFLOW BUILDER IMPLEMENTATION
// ============================================================================

function createWorkflowBuilder(definition: WorkflowDefinition): WorkflowBuilder {
  // Validate workflow definition
  validateWorkflowName(definition.name)

  const steps: WorkflowStepDefinition[] = []
  const triggers: WorkflowTrigger[] = []
  const eventHandlers: WorkflowEventHandlerDefinition[] = []

  const builder: WorkflowBuilder = {
    name: definition.name,
    description: definition.description,
    version: definition.version,
    tags: definition.tags,
    steps,
    triggers,
    eventHandlers,

    step(
      name: string,
      handlerOrConfig: WorkflowStepHandler | StepConfig,
      options?: StepOptions
    ): WorkflowBuilder {
      validateStepName(name, steps)

      // Check if it's a config object (sleep or waitForEvent)
      if (typeof handlerOrConfig === 'object' && handlerOrConfig !== null) {
        const config = handlerOrConfig as StepConfig

        if (config.type === 'sleep') {
          const sleepConfig = config as SleepStepConfig
          steps.push({
            name,
            type: 'sleep',
            duration: sleepConfig.duration,
          })
        } else if (config.type === 'waitForEvent') {
          const waitConfig = config as WaitForEventStepConfig
          steps.push({
            name,
            type: 'waitForEvent',
            event: waitConfig.event,
            timeout: waitConfig.timeout,
          })
        }
      } else {
        // It's a handler function
        validateStepHandler(handlerOrConfig)
        validateStepOptions(options)

        steps.push({
          name,
          type: 'do',
          handler: handlerOrConfig as WorkflowStepHandler,
          timeout: options?.timeout,
          retries: options?.retries,
          retryDelay: options?.retryDelay,
        })
      }

      return builder
    },

    trigger(type: 'webhook' | 'cron' | 'event', config: WorkflowTriggerConfig): WorkflowBuilder {
      if (type === 'webhook') {
        validateWebhookTrigger(config as WebhookTriggerConfig)
      } else if (type === 'cron') {
        validateCronTrigger(config as CronTriggerConfig)
      } else if (type === 'event') {
        validateEventTrigger(config as EventTriggerConfig)
      }

      triggers.push({ type, config })
      return builder
    },

    on(event: string, handler: WorkflowEventHandler): WorkflowBuilder {
      validateEventHandlerName(event)
      validateEventHandlerFunction(handler)

      eventHandlers.push({ event, handler })
      return builder
    },

    create(): WorkflowEntrypointClass {
      // Validate that at least one step exists
      if (steps.length === 0) {
        throw new WorkflowValidationError('Workflow must have at least one step')
      }

      // Re-validate the workflow name
      validateWorkflowName(definition.name)

      // Create the entrypoint class
      const workflowSteps = [...steps]
      const workflowTriggers = [...triggers]
      const workflowEventHandlers = [...eventHandlers]
      const workflowName = definition.name

      class WorkflowEntrypointImpl implements WorkflowEntrypoint {
        static workflowName = workflowName
        static steps = workflowSteps
        static triggers = workflowTriggers
        static eventHandlers = workflowEventHandlers

        step = {
          do: async <T>(name: string, callback: () => T | Promise<T>): Promise<T> => {
            // In production, this would integrate with Cloudflare Workflows step.do()
            return callback()
          },
          sleep: async (name: string, duration: number | string): Promise<void> => {
            // In production, this would integrate with Cloudflare Workflows step.sleep()
            const ms = typeof duration === 'string' ? parseDuration(duration) : duration
            await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 100)))
          },
          waitForEvent: async <T>(name: string, options: { type: string; timeout?: number }): Promise<T> => {
            // In production, this would integrate with Cloudflare Workflows step.waitForEvent()
            return {} as T
          },
        }

        async run(event: unknown, step: StepContext): Promise<unknown> {
          let result: unknown = event

          for (const stepDef of workflowSteps) {
            if (stepDef.type === 'do' && stepDef.handler) {
              result = await this.step.do(stepDef.name, async () => {
                const ctx: StepContext = {
                  workflowId: workflowName,
                  instanceId: crypto.randomUUID(),
                  stepName: stepDef.name,
                  input: result,
                  emit: async () => {},
                  log: () => {},
                  sleep: async (ms) => {
                    await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 100)))
                  },
                  waitForEvent: async () => ({} as never),
                }
                return stepDef.handler!(result, ctx)
              })
            } else if (stepDef.type === 'sleep' && stepDef.duration) {
              await this.step.sleep(stepDef.name, stepDef.duration)
            } else if (stepDef.type === 'waitForEvent' && stepDef.event) {
              result = await this.step.waitForEvent(stepDef.name, {
                type: stepDef.event,
                timeout: stepDef.timeout,
              })
            }
          }

          return result
        }
      }

      return WorkflowEntrypointImpl as unknown as WorkflowEntrypointClass
    },

    toJSON(): WorkflowJSON {
      return {
        name: definition.name,
        description: definition.description,
        steps: steps.map((s) => ({ name: s.name, type: s.type })),
        triggers: triggers.map((t) => ({
          type: t.type,
          config: sanitizeTriggerConfig(t.config),
        })),
        eventHandlers: [],
      }
    },

    describe(): WorkflowDescription {
      return {
        name: definition.name,
        stepCount: steps.length,
        stepNames: steps.map((s) => s.name),
        triggerTypes: triggers.map((t) => t.type),
        hasEventHandlers: eventHandlers.length > 0,
      }
    },

    getMetadata(): WorkflowMetadata {
      return {
        name: definition.name,
        version: definition.version,
        tags: definition.tags,
        stepCount: steps.length,
        triggerCount: triggers.length,
        eventHandlerCount: eventHandlers.length,
      }
    },
  }

  return builder
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m|h|d)?$/)
  if (!match) return 0

  const value = parseInt(match[1]!, 10)
  const unit = match[2] || 'ms'

  switch (unit) {
    case 'ms':
      return value
    case 's':
      return value * 1000
    case 'm':
      return value * 60 * 1000
    case 'h':
      return value * 60 * 60 * 1000
    case 'd':
      return value * 24 * 60 * 60 * 1000
    default:
      return value
  }
}

function sanitizeTriggerConfig(config: WorkflowTriggerConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  // Copy only serializable properties
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'function') {
      result[key] = value
    }
  }

  return result
}

// ============================================================================
// MAIN FACTORY FUNCTION
// ============================================================================

export function Workflow(definition: WorkflowDefinition): WorkflowBuilder {
  return createWorkflowBuilder(definition)
}

export default Workflow
