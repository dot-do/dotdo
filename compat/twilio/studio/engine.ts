/**
 * @dotdo/twilio/studio - Flow Execution Engine
 *
 * Executes Twilio Studio flow definitions with support for:
 * - Widget execution
 * - State transitions
 * - Template variable resolution
 * - Context management
 */

import type {
  FlowDefinition,
  WidgetState,
  WidgetType,
  FlowTransition,
  ExecutionContext,
  WidgetOutput,
  SplitCondition,
  SplitConditionType,
  Execution,
  ExecutionStep,
  ExecutionStatus,
} from './types'

// =============================================================================
// Template Resolution
// =============================================================================

/**
 * Resolve template variables in a string
 *
 * Supports:
 * - {{flow.variables.name}}
 * - {{widgets.widgetName.property}}
 * - {{contact.channel.address}}
 * - {{trigger.message.Body}}
 *
 * @param template - String with template placeholders
 * @param context - Execution context with variable values
 * @returns Resolved string
 */
export function resolveTemplate(template: string, context: ExecutionContext): string {
  if (!template || typeof template !== 'string') {
    return template
  }

  return template.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const value = getNestedValue(context, path.trim())
    return value !== undefined ? String(value) : ''
  })
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }

  return current
}

/**
 * Resolve all template variables in an object recursively
 */
export function resolveTemplateObject<T>(obj: T, context: ExecutionContext): T {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (typeof obj === 'string') {
    return resolveTemplate(obj, context) as unknown as T
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveTemplateObject(item, context)) as unknown as T
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveTemplateObject(value, context)
    }
    return result as T
  }

  return obj
}

// =============================================================================
// Condition Evaluation
// =============================================================================

/**
 * Evaluate a split condition against an input value
 */
export function evaluateCondition(condition: SplitCondition, inputValue: string): boolean {
  const { type, value, arguments: args } = condition

  // For some conditions, we use the first argument as the value to compare
  const compareValue = args?.[0] ?? inputValue

  switch (type) {
    case 'equal_to':
      return compareValue === value

    case 'not_equal_to':
      return compareValue !== value

    case 'matches_any_of': {
      const values = value.split(',').map((v) => v.trim())
      return values.includes(compareValue)
    }

    case 'does_not_match_any_of': {
      const values = value.split(',').map((v) => v.trim())
      return !values.includes(compareValue)
    }

    case 'is_blank':
      return !compareValue || compareValue.trim() === ''

    case 'is_not_blank':
      return !!compareValue && compareValue.trim() !== ''

    case 'starts_with':
      return compareValue.startsWith(value)

    case 'contains':
      return compareValue.includes(value)

    case 'regex':
      try {
        const regex = new RegExp(value)
        return regex.test(compareValue)
      } catch {
        return false
      }

    case 'less_than': {
      const numInput = parseFloat(compareValue)
      const numValue = parseFloat(value)
      return !isNaN(numInput) && !isNaN(numValue) && numInput < numValue
    }

    case 'greater_than': {
      const numInput = parseFloat(compareValue)
      const numValue = parseFloat(value)
      return !isNaN(numInput) && !isNaN(numValue) && numInput > numValue
    }

    default:
      return false
  }
}

// =============================================================================
// Widget Handlers
// =============================================================================

/**
 * Widget handler function type
 */
export type WidgetHandler = (
  widget: WidgetState,
  context: ExecutionContext,
  engine: StudioFlowEngine
) => Promise<WidgetExecutionResult>

/**
 * Result of executing a widget
 */
export interface WidgetExecutionResult {
  /** Event name for transition lookup */
  event: string
  /** Output data to add to context */
  output: WidgetOutput
  /** Whether execution should continue */
  continue: boolean
}

/**
 * Default widget handlers for all widget types
 */
export const defaultWidgetHandlers: Record<WidgetType, WidgetHandler> = {
  /**
   * Trigger widget - entry point
   */
  trigger: async (widget, context) => {
    // Determine trigger type from context
    let event = 'incomingRequest'
    if (context.trigger?.message) {
      event = 'incomingMessage'
    } else if (context.trigger?.call) {
      event = 'incomingCall'
    }

    return {
      event,
      output: {
        ...context.trigger,
      },
      continue: true,
    }
  },

  /**
   * Send Message widget
   */
  'send-message': async (widget, context, engine) => {
    const props = widget.properties as Record<string, unknown>
    const body = resolveTemplate(props.body as string, context)
    const to = resolveTemplate((props.to as string) || context.contact?.channel?.address || '', context)
    const from = resolveTemplate((props.from as string) || '', context)
    const mediaUrl = props.media_url ? resolveTemplate(props.media_url as string, context) : undefined

    // Execute send message via callback
    const result = await engine.executeSendMessage({
      to,
      from,
      body,
      mediaUrl,
    })

    return {
      event: result.success ? 'sent' : 'failed',
      output: {
        MessageSid: result.messageSid,
        To: to,
        From: from,
        Body: body,
      },
      continue: true,
    }
  },

  /**
   * Send and Wait for Reply widget
   */
  'send-and-wait-for-reply': async (widget, context, engine) => {
    const props = widget.properties as Record<string, unknown>
    const body = resolveTemplate(props.body as string, context)
    const to = resolveTemplate((props.to as string) || context.contact?.channel?.address || '', context)
    const from = resolveTemplate((props.from as string) || '', context)
    const timeout = (props.timeout as number) || 3600

    // Execute send and wait
    const result = await engine.executeSendAndWaitForReply({
      to,
      from,
      body,
      timeout,
    })

    if (result.timedOut) {
      return {
        event: 'timeout',
        output: {
          MessageSid: result.outboundMessageSid,
        },
        continue: true,
      }
    }

    return {
      event: 'incomingMessage',
      output: {
        MessageSid: result.outboundMessageSid,
        inbound: {
          Body: result.replyBody,
          From: result.replyFrom,
          MessageSid: result.replyMessageSid,
        },
      },
      continue: true,
    }
  },

  /**
   * Say/Play widget
   */
  'say-play': async (widget, context, engine) => {
    const props = widget.properties as Record<string, unknown>
    const say = props.say ? resolveTemplate(props.say as string, context) : undefined
    const play = props.play ? resolveTemplate(props.play as string, context) : undefined

    await engine.executeSayPlay({
      say,
      play,
      voice: props.voice as string,
      language: props.language as string,
      loop: props.loop as number,
      digits: props.digits as string,
    })

    return {
      event: 'audioComplete',
      output: {},
      continue: true,
    }
  },

  /**
   * Gather Input on Call widget
   */
  'gather-input-on-call': async (widget, context, engine) => {
    const props = widget.properties as Record<string, unknown>
    const say = props.say ? resolveTemplate(props.say as string, context) : undefined
    const play = props.play ? resolveTemplate(props.play as string, context) : undefined

    const result = await engine.executeGatherInput({
      input: (props.input as 'dtmf' | 'speech' | 'dtmf speech') || 'dtmf',
      say,
      play,
      voice: props.voice as string,
      language: props.language as string,
      speechTimeout: props.speech_timeout as string,
      speechModel: props.speech_model as string,
      numDigits: props.number_of_digits as number,
      finishOnKey: props.finish_on_key as string,
      timeout: props.timeout as number,
      hints: props.hints as string,
    })

    if (!result.gathered) {
      return {
        event: 'noInput',
        output: {},
        continue: true,
      }
    }

    return {
      event: result.speech ? 'speech' : 'keypress',
      output: {
        Digits: result.digits,
        SpeechResult: result.speechResult,
        Confidence: result.confidence,
      },
      continue: true,
    }
  },

  /**
   * Split Based On widget
   */
  'split-based-on': async (widget, context) => {
    const props = widget.properties as Record<string, unknown>
    const input = resolveTemplate(props.input as string, context)

    // Find matching transition with conditions
    for (const transition of widget.transitions) {
      if (transition.conditions && transition.conditions.length > 0) {
        const allMatch = transition.conditions.every((condition) => evaluateCondition(condition, input))
        if (allMatch) {
          return {
            event: transition.event,
            output: {
              input,
              matched: transition.event,
            },
            continue: true,
          }
        }
      }
    }

    // No match - use noMatch event
    return {
      event: 'noMatch',
      output: {
        input,
        matched: 'noMatch',
      },
      continue: true,
    }
  },

  /**
   * Make Outgoing Call widget
   */
  'make-outgoing-call-v2': async (widget, context, engine) => {
    const props = widget.properties as Record<string, unknown>
    const to = resolveTemplate(props.to as string, context)
    const from = resolveTemplate(props.from as string, context)

    const result = await engine.executeMakeCall({
      to,
      from,
      timeout: props.timeout as number,
      machineDetection: props.machine_detection as string,
      record: props.record as boolean,
      sendDigits: props.send_digits as string,
    })

    if (!result.success) {
      return {
        event: 'failed',
        output: {
          Error: result.error,
        },
        continue: true,
      }
    }

    let event = 'answered'
    if (result.answeredBy === 'machine') {
      event = 'answeredByMachine'
    } else if (result.status === 'busy') {
      event = 'busy'
    } else if (result.status === 'no-answer') {
      event = 'noAnswer'
    }

    return {
      event,
      output: {
        CallSid: result.callSid,
        CallStatus: result.status,
        AnsweredBy: result.answeredBy,
      },
      continue: true,
    }
  },

  /**
   * Connect Call To widget
   */
  'connect-call-to': async (widget, context, engine) => {
    const props = widget.properties as Record<string, unknown>
    const to = resolveTemplate((props.to as string) || '', context)

    const result = await engine.executeConnectCall({
      noun: props.noun as 'number' | 'sip-endpoint' | 'client',
      to,
      callerId: props.caller_id as string,
      timeout: props.timeout as number,
      record: props.record as boolean,
    })

    return {
      event: result.success ? 'callCompleted' : 'hangup',
      output: {
        CallSid: result.callSid,
        DialCallSid: result.dialCallSid,
        DialCallStatus: result.dialCallStatus,
      },
      continue: true,
    }
  },

  /**
   * Record Voicemail widget
   */
  'record-voicemail': async (widget, context, engine) => {
    const props = widget.properties as Record<string, unknown>
    const say = props.say ? resolveTemplate(props.say as string, context) : undefined
    const play = props.play ? resolveTemplate(props.play as string, context) : undefined

    const result = await engine.executeRecordVoicemail({
      say,
      play,
      voice: props.voice as string,
      maxLength: props.max_length as number,
      playBeep: props.play_beep === 'true',
      finishOnKey: props.finish_on_key as string,
      timeout: props.timeout as number,
      transcribe: props.transcribe as boolean,
    })

    if (!result.recorded) {
      return {
        event: 'noRecording',
        output: {},
        continue: true,
      }
    }

    return {
      event: 'recordingComplete',
      output: {
        RecordingUrl: result.recordingUrl,
        RecordingSid: result.recordingSid,
        RecordingDuration: result.duration,
        TranscriptionText: result.transcription,
      },
      continue: true,
    }
  },

  /**
   * Make HTTP Request widget
   */
  'make-http-request': async (widget, context, engine) => {
    const props = widget.properties as Record<string, unknown>
    const url = resolveTemplate(props.url as string, context)
    const method = props.method as string || 'GET'

    // Resolve parameters
    let parameters: Record<string, string> = {}
    if (props.parameters && Array.isArray(props.parameters)) {
      for (const param of props.parameters as Array<{ key: string; value: string }>) {
        parameters[resolveTemplate(param.key, context)] = resolveTemplate(param.value, context)
      }
    }

    // Resolve body
    let body: string | Record<string, string> | undefined
    if (props.body) {
      if (typeof props.body === 'string') {
        body = resolveTemplate(props.body, context)
      } else {
        body = resolveTemplateObject(props.body as Record<string, string>, context)
      }
    }

    const result = await engine.executeHttpRequest({
      method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      url,
      contentType: props.content_type as string,
      body,
      parameters,
    })

    if (!result.success) {
      return {
        event: 'failed',
        output: {
          response: {
            status_code: result.statusCode || 0,
            body: result.error || '',
            parsed: null,
            headers: {},
          },
        },
        continue: true,
      }
    }

    return {
      event: 'success',
      output: {
        response: {
          status_code: result.statusCode,
          body: result.body,
          parsed: result.parsed,
          headers: result.headers,
        },
      },
      continue: true,
    }
  },

  /**
   * Run Function widget
   */
  'run-function': async (widget, context, engine) => {
    const props = widget.properties as Record<string, unknown>

    // Resolve parameters
    let parameters: Record<string, string> = {}
    if (props.parameters && Array.isArray(props.parameters)) {
      for (const param of props.parameters as Array<{ key: string; value: string }>) {
        parameters[resolveTemplate(param.key, context)] = resolveTemplate(param.value, context)
      }
    }

    const result = await engine.executeFunction({
      serviceSid: props.service_sid as string,
      environmentSid: props.environment_sid as string,
      functionSid: props.function_sid as string,
      url: props.url as string,
      parameters,
    })

    if (!result.success) {
      return {
        event: 'fail',
        output: {
          error: result.error,
        },
        continue: true,
      }
    }

    return {
      event: 'success',
      output: {
        parsed: result.response,
      },
      continue: true,
    }
  },

  /**
   * Set Variables widget
   */
  'set-variables': async (widget, context) => {
    const props = widget.properties as Record<string, unknown>
    const variables = props.variables as Array<{ key: string; value: string }> || []

    const output: Record<string, unknown> = {}
    for (const variable of variables) {
      const key = resolveTemplate(variable.key, context)
      const value = resolveTemplate(variable.value, context)
      output[key] = value

      // Also update flow variables in context
      if (context.flow?.variables) {
        context.flow.variables[key] = value
      }
    }

    return {
      event: 'next',
      output,
      continue: true,
    }
  },

  /**
   * Enqueue Call widget
   */
  'enqueue-call': async (widget, context, engine) => {
    const props = widget.properties as Record<string, unknown>

    const result = await engine.executeEnqueueCall({
      queueName: props.queue_name as string,
      workflowSid: props.workflow_sid as string,
      waitUrl: props.wait_url as string,
      taskAttributes: props.task_attributes as Record<string, unknown>,
      priority: props.priority as number,
      timeout: props.timeout as number,
    })

    return {
      event: result.success ? 'callComplete' : 'failedToEnqueue',
      output: {
        QueueSid: result.queueSid,
        QueueTime: result.queueTime,
      },
      continue: true,
    }
  },

  /**
   * Fork Stream widget
   */
  'fork-stream': async (widget, context, engine) => {
    const props = widget.properties as Record<string, unknown>

    await engine.executeForkStream({
      action: props.stream_action as 'start' | 'stop',
      connector: props.stream_connector as string,
      name: props.stream_name as string,
      url: props.stream_url as string,
      track: props.stream_track as string,
    })

    return {
      event: 'next',
      output: {},
      continue: true,
    }
  },

  /**
   * Run Subflow widget
   */
  'run-subflow': async (widget, context, engine) => {
    const props = widget.properties as Record<string, unknown>

    // Resolve parameters
    let parameters: Record<string, unknown> = {}
    if (props.parameters && Array.isArray(props.parameters)) {
      for (const param of props.parameters as Array<{ key: string; value: string }>) {
        parameters[resolveTemplate(param.key, context)] = resolveTemplate(param.value, context)
      }
    }

    const result = await engine.executeSubflow({
      flowSid: props.flow_sid as string,
      parameters,
    })

    if (!result.success) {
      return {
        event: 'failed',
        output: {
          error: result.error,
        },
        continue: true,
      }
    }

    return {
      event: 'completed',
      output: {
        subflow_execution_sid: result.executionSid,
        returned_variables: result.returnedVariables,
      },
      continue: true,
    }
  },

  /**
   * Add TwiML Redirect widget
   */
  'add-twiml-redirect': async (widget, context, engine) => {
    const props = widget.properties as Record<string, unknown>
    const url = resolveTemplate(props.url as string, context)

    await engine.executeTwimlRedirect({
      url,
      method: (props.method as 'GET' | 'POST') || 'POST',
    })

    return {
      event: 'return',
      output: {},
      continue: false, // Ends execution
    }
  },
}

// =============================================================================
// Callback Types for External Integration
// =============================================================================

export interface SendMessageParams {
  to: string
  from: string
  body: string
  mediaUrl?: string
}

export interface SendMessageResult {
  success: boolean
  messageSid?: string
  error?: string
}

export interface SendAndWaitParams {
  to: string
  from: string
  body: string
  timeout: number
}

export interface SendAndWaitResult {
  outboundMessageSid?: string
  timedOut: boolean
  replyBody?: string
  replyFrom?: string
  replyMessageSid?: string
}

export interface SayPlayParams {
  say?: string
  play?: string
  voice?: string
  language?: string
  loop?: number
  digits?: string
}

export interface GatherInputParams {
  input: 'dtmf' | 'speech' | 'dtmf speech'
  say?: string
  play?: string
  voice?: string
  language?: string
  speechTimeout?: string
  speechModel?: string
  numDigits?: number
  finishOnKey?: string
  timeout?: number
  hints?: string
}

export interface GatherInputResult {
  gathered: boolean
  digits?: string
  speech?: boolean
  speechResult?: string
  confidence?: string
}

export interface MakeCallParams {
  to: string
  from: string
  timeout?: number
  machineDetection?: string
  record?: boolean
  sendDigits?: string
}

export interface MakeCallResult {
  success: boolean
  callSid?: string
  status?: string
  answeredBy?: string
  error?: string
}

export interface ConnectCallParams {
  noun: 'number' | 'sip-endpoint' | 'client'
  to: string
  callerId?: string
  timeout?: number
  record?: boolean
}

export interface ConnectCallResult {
  success: boolean
  callSid?: string
  dialCallSid?: string
  dialCallStatus?: string
}

export interface RecordVoicemailParams {
  say?: string
  play?: string
  voice?: string
  maxLength?: number
  playBeep?: boolean
  finishOnKey?: string
  timeout?: number
  transcribe?: boolean
}

export interface RecordVoicemailResult {
  recorded: boolean
  recordingUrl?: string
  recordingSid?: string
  duration?: number
  transcription?: string
}

export interface HttpRequestParams {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  contentType?: string
  body?: string | Record<string, string>
  parameters?: Record<string, string>
}

export interface HttpRequestResult {
  success: boolean
  statusCode: number
  body: string
  parsed?: unknown
  headers: Record<string, string>
  error?: string
}

export interface FunctionParams {
  serviceSid: string
  environmentSid: string
  functionSid: string
  url?: string
  parameters: Record<string, string>
}

export interface FunctionResult {
  success: boolean
  response?: unknown
  error?: string
}

export interface EnqueueCallParams {
  queueName?: string
  workflowSid?: string
  waitUrl?: string
  taskAttributes?: Record<string, unknown>
  priority?: number
  timeout?: number
}

export interface EnqueueCallResult {
  success: boolean
  queueSid?: string
  queueTime?: number
}

export interface ForkStreamParams {
  action: 'start' | 'stop'
  connector?: string
  name?: string
  url?: string
  track?: string
}

export interface SubflowParams {
  flowSid: string
  parameters: Record<string, unknown>
}

export interface SubflowResult {
  success: boolean
  executionSid?: string
  returnedVariables?: Record<string, unknown>
  error?: string
}

export interface TwimlRedirectParams {
  url: string
  method: 'GET' | 'POST'
}

// =============================================================================
// Studio Flow Engine
// =============================================================================

/**
 * Execution callbacks for integrating with external systems
 */
export interface StudioEngineCallbacks {
  sendMessage?: (params: SendMessageParams) => Promise<SendMessageResult>
  sendAndWaitForReply?: (params: SendAndWaitParams) => Promise<SendAndWaitResult>
  sayPlay?: (params: SayPlayParams) => Promise<void>
  gatherInput?: (params: GatherInputParams) => Promise<GatherInputResult>
  makeCall?: (params: MakeCallParams) => Promise<MakeCallResult>
  connectCall?: (params: ConnectCallParams) => Promise<ConnectCallResult>
  recordVoicemail?: (params: RecordVoicemailParams) => Promise<RecordVoicemailResult>
  httpRequest?: (params: HttpRequestParams) => Promise<HttpRequestResult>
  runFunction?: (params: FunctionParams) => Promise<FunctionResult>
  enqueueCall?: (params: EnqueueCallParams) => Promise<EnqueueCallResult>
  forkStream?: (params: ForkStreamParams) => Promise<void>
  runSubflow?: (params: SubflowParams) => Promise<SubflowResult>
  twimlRedirect?: (params: TwimlRedirectParams) => Promise<void>
}

/**
 * Execution options
 */
export interface ExecuteFlowOptions {
  /** Initial context with trigger data */
  context?: Partial<ExecutionContext>
  /** Execution callbacks */
  callbacks?: StudioEngineCallbacks
  /** Maximum steps to prevent infinite loops */
  maxSteps?: number
  /** Step callback for execution tracking */
  onStep?: (step: ExecutionStepInfo) => void
}

/**
 * Information about an execution step
 */
export interface ExecutionStepInfo {
  stepNumber: number
  widgetName: string
  widgetType: WidgetType
  event: string
  output: WidgetOutput
  transitionedTo?: string
}

/**
 * Flow execution result
 */
export interface FlowExecutionResult {
  /** Execution completed successfully */
  success: boolean
  /** Final execution status */
  status: ExecutionStatus
  /** Final context state */
  context: ExecutionContext
  /** Execution steps taken */
  steps: ExecutionStepInfo[]
  /** Error message if failed */
  error?: string
  /** Widget that caused failure */
  failedWidget?: string
}

/**
 * Studio Flow Execution Engine
 *
 * Executes Twilio Studio flow definitions with full widget support.
 *
 * @example
 * ```typescript
 * const engine = new StudioFlowEngine(flowDefinition)
 *
 * const result = await engine.execute({
 *   context: {
 *     trigger: {
 *       message: {
 *         Body: 'Hello',
 *         From: '+1234567890',
 *         To: '+0987654321',
 *         MessageSid: 'SM123',
 *       },
 *     },
 *   },
 *   callbacks: {
 *     sendMessage: async (params) => {
 *       // Send via Twilio
 *       return { success: true, messageSid: 'SM456' }
 *     },
 *   },
 * })
 * ```
 */
export class StudioFlowEngine {
  private definition: FlowDefinition
  private widgetHandlers: Record<WidgetType, WidgetHandler>
  private callbacks: StudioEngineCallbacks = {}
  private widgetsByName: Map<string, WidgetState>

  constructor(
    definition: FlowDefinition,
    customHandlers?: Partial<Record<WidgetType, WidgetHandler>>
  ) {
    this.definition = definition
    this.widgetHandlers = { ...defaultWidgetHandlers, ...customHandlers }

    // Build widget lookup map
    this.widgetsByName = new Map()
    for (const widget of definition.states) {
      this.widgetsByName.set(widget.name, widget)
    }
  }

  /**
   * Execute the flow
   */
  async execute(options: ExecuteFlowOptions = {}): Promise<FlowExecutionResult> {
    this.callbacks = options.callbacks || {}

    // Initialize context
    const context: ExecutionContext = {
      flow: {
        flow_sid: 'FW' + crypto.randomUUID().replace(/-/g, '').slice(0, 32),
        channel: {
          address: options.context?.contact?.channel?.address || '',
        },
        variables: {},
        data: {},
      },
      contact: options.context?.contact || { channel: { address: '' } },
      trigger: options.context?.trigger,
      widgets: {},
      ...options.context,
    }

    const steps: ExecutionStepInfo[] = []
    const maxSteps = options.maxSteps || 100

    // Start with initial state
    let currentWidgetName = this.definition.initial_state
    let stepNumber = 0

    try {
      while (currentWidgetName && stepNumber < maxSteps) {
        stepNumber++

        // Get current widget
        const widget = this.widgetsByName.get(currentWidgetName)
        if (!widget) {
          return {
            success: false,
            status: 'ended',
            context,
            steps,
            error: `Widget not found: ${currentWidgetName}`,
            failedWidget: currentWidgetName,
          }
        }

        // Get handler for this widget type
        const handler = this.widgetHandlers[widget.type]
        if (!handler) {
          return {
            success: false,
            status: 'ended',
            context,
            steps,
            error: `No handler for widget type: ${widget.type}`,
            failedWidget: currentWidgetName,
          }
        }

        // Execute widget
        let result: WidgetExecutionResult
        try {
          result = await handler(widget, context, this)
        } catch (error) {
          return {
            success: false,
            status: 'ended',
            context,
            steps,
            error: error instanceof Error ? error.message : String(error),
            failedWidget: currentWidgetName,
          }
        }

        // Store widget output in context
        context.widgets[widget.name] = result.output

        // Find next state from transitions
        let nextWidgetName: string | undefined
        const transition = widget.transitions.find((t) => t.event === result.event)
        if (transition) {
          nextWidgetName = transition.next
        }

        // Record step info
        const stepInfo: ExecutionStepInfo = {
          stepNumber,
          widgetName: widget.name,
          widgetType: widget.type,
          event: result.event,
          output: result.output,
          transitionedTo: nextWidgetName,
        }
        steps.push(stepInfo)

        // Call step callback
        options.onStep?.(stepInfo)

        // Check if execution should continue
        if (!result.continue) {
          break
        }

        // Move to next widget
        currentWidgetName = nextWidgetName!
      }

      // Check for step limit exceeded
      if (stepNumber >= maxSteps) {
        return {
          success: false,
          status: 'ended',
          context,
          steps,
          error: 'Maximum step limit exceeded',
        }
      }

      return {
        success: true,
        status: 'ended',
        context,
        steps,
      }
    } catch (error) {
      return {
        success: false,
        status: 'ended',
        context,
        steps,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // =============================================================================
  // Callback Execution Methods (called by widget handlers)
  // =============================================================================

  async executeSendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    if (this.callbacks.sendMessage) {
      return this.callbacks.sendMessage(params)
    }
    // Default mock implementation
    return {
      success: true,
      messageSid: 'SM' + crypto.randomUUID().replace(/-/g, '').slice(0, 32),
    }
  }

  async executeSendAndWaitForReply(params: SendAndWaitParams): Promise<SendAndWaitResult> {
    if (this.callbacks.sendAndWaitForReply) {
      return this.callbacks.sendAndWaitForReply(params)
    }
    // Default mock - immediate timeout
    return {
      outboundMessageSid: 'SM' + crypto.randomUUID().replace(/-/g, '').slice(0, 32),
      timedOut: true,
    }
  }

  async executeSayPlay(params: SayPlayParams): Promise<void> {
    if (this.callbacks.sayPlay) {
      await this.callbacks.sayPlay(params)
    }
  }

  async executeGatherInput(params: GatherInputParams): Promise<GatherInputResult> {
    if (this.callbacks.gatherInput) {
      return this.callbacks.gatherInput(params)
    }
    // Default mock - no input
    return { gathered: false }
  }

  async executeMakeCall(params: MakeCallParams): Promise<MakeCallResult> {
    if (this.callbacks.makeCall) {
      return this.callbacks.makeCall(params)
    }
    // Default mock
    return {
      success: true,
      callSid: 'CA' + crypto.randomUUID().replace(/-/g, '').slice(0, 32),
      status: 'completed',
    }
  }

  async executeConnectCall(params: ConnectCallParams): Promise<ConnectCallResult> {
    if (this.callbacks.connectCall) {
      return this.callbacks.connectCall(params)
    }
    // Default mock
    return {
      success: true,
      callSid: 'CA' + crypto.randomUUID().replace(/-/g, '').slice(0, 32),
      dialCallSid: 'CA' + crypto.randomUUID().replace(/-/g, '').slice(0, 32),
      dialCallStatus: 'completed',
    }
  }

  async executeRecordVoicemail(params: RecordVoicemailParams): Promise<RecordVoicemailResult> {
    if (this.callbacks.recordVoicemail) {
      return this.callbacks.recordVoicemail(params)
    }
    // Default mock - no recording
    return { recorded: false }
  }

  async executeHttpRequest(params: HttpRequestParams): Promise<HttpRequestResult> {
    if (this.callbacks.httpRequest) {
      return this.callbacks.httpRequest(params)
    }

    // Default implementation using fetch
    try {
      const url = new URL(params.url)

      // Add query parameters for GET requests
      if (params.method === 'GET' && params.parameters) {
        for (const [key, value] of Object.entries(params.parameters)) {
          url.searchParams.set(key, value)
        }
      }

      const headers: Record<string, string> = {}
      let body: string | undefined

      if (params.body && params.method !== 'GET') {
        if (params.contentType === 'application/json') {
          headers['Content-Type'] = 'application/json'
          body = typeof params.body === 'string' ? params.body : JSON.stringify(params.body)
        } else {
          headers['Content-Type'] = 'application/x-www-form-urlencoded'
          if (typeof params.body === 'object') {
            body = new URLSearchParams(params.body as Record<string, string>).toString()
          } else {
            body = params.body
          }
        }
      }

      const response = await fetch(url.toString(), {
        method: params.method,
        headers,
        body,
      })

      const responseText = await response.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(responseText)
      } catch {
        parsed = responseText
      }

      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      return {
        success: response.ok,
        statusCode: response.status,
        body: responseText,
        parsed,
        headers: responseHeaders,
      }
    } catch (error) {
      return {
        success: false,
        statusCode: 0,
        body: '',
        headers: {},
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async executeFunction(params: FunctionParams): Promise<FunctionResult> {
    if (this.callbacks.runFunction) {
      return this.callbacks.runFunction(params)
    }
    // Default mock
    return { success: true, response: {} }
  }

  async executeEnqueueCall(params: EnqueueCallParams): Promise<EnqueueCallResult> {
    if (this.callbacks.enqueueCall) {
      return this.callbacks.enqueueCall(params)
    }
    // Default mock
    return { success: true }
  }

  async executeForkStream(params: ForkStreamParams): Promise<void> {
    if (this.callbacks.forkStream) {
      await this.callbacks.forkStream(params)
    }
  }

  async executeSubflow(params: SubflowParams): Promise<SubflowResult> {
    if (this.callbacks.runSubflow) {
      return this.callbacks.runSubflow(params)
    }
    // Default mock
    return {
      success: true,
      executionSid: 'FN' + crypto.randomUUID().replace(/-/g, '').slice(0, 32),
    }
  }

  async executeTwimlRedirect(params: TwimlRedirectParams): Promise<void> {
    if (this.callbacks.twimlRedirect) {
      await this.callbacks.twimlRedirect(params)
    }
  }

  // =============================================================================
  // Utility Methods
  // =============================================================================

  /**
   * Get a widget by name
   */
  getWidget(name: string): WidgetState | undefined {
    return this.widgetsByName.get(name)
  }

  /**
   * Get the flow definition
   */
  getDefinition(): FlowDefinition {
    return this.definition
  }

  /**
   * Validate the flow definition
   */
  validate(): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = []
    const warnings: string[] = []

    // Check initial state exists
    if (!this.widgetsByName.has(this.definition.initial_state)) {
      errors.push(`Initial state "${this.definition.initial_state}" not found`)
    }

    // Check all transitions reference valid states
    for (const widget of this.definition.states) {
      for (const transition of widget.transitions) {
        if (transition.next && !this.widgetsByName.has(transition.next)) {
          errors.push(
            `Widget "${widget.name}" has transition to unknown state "${transition.next}"`
          )
        }
      }

      // Check for unreachable states
      const reachable = this.findReachableStates()
      for (const state of this.definition.states) {
        if (state.name !== this.definition.initial_state && !reachable.has(state.name)) {
          warnings.push(`Widget "${state.name}" is unreachable`)
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * Find all reachable states from initial state
   */
  private findReachableStates(): Set<string> {
    const reachable = new Set<string>()
    const queue = [this.definition.initial_state]

    while (queue.length > 0) {
      const current = queue.shift()!
      if (reachable.has(current)) continue
      reachable.add(current)

      const widget = this.widgetsByName.get(current)
      if (widget) {
        for (const transition of widget.transitions) {
          if (transition.next && !reachable.has(transition.next)) {
            queue.push(transition.next)
          }
        }
      }
    }

    return reachable
  }
}
