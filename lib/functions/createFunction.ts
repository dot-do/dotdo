/**
 * createFunction() Factory
 *
 * Creates function instances based on type:
 * - CodeFunction: executes TypeScript/JavaScript code
 * - GenerativeFunction: calls LLM for generation
 * - AgenticFunction: orchestrates multi-step AI tasks
 * - HumanFunction: queues tasks for human input
 *
 * The factory validates definitions, registers with DO, and supports composition.
 */

// ============================================================================
// ERROR CLASSES
// ============================================================================

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class RegistrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RegistrationError'
  }
}

export class ExecutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutionError'
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface FunctionContext {
  functionId: string
  invocationId: string
  input: unknown
  env: Record<string, unknown>
  emit: (event: string, data: unknown) => Promise<void>
  log: (message: string, data?: unknown) => void
}

export interface AgentStep {
  iteration: number
  thought: string
  action?: string
  observation?: string
}

export interface FormFieldDefinition {
  name: string
  type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect'
  label: string
  required?: boolean
  options?: string[]
  validation?: (value: unknown) => boolean | string
}

export interface FormDefinition {
  fields: FormFieldDefinition[]
}

// Base function definition
export interface BaseFunctionDefinition {
  name: string
  description?: string
  timeout?: number
  retries?: number
  requiredPermission?: string
}

// CodeFunction definition
export interface CodeFunctionDefinition extends BaseFunctionDefinition {
  type: 'code'
  handler: (input: unknown, context: FunctionContext) => unknown | Promise<unknown>
  runtime?: 'javascript' | 'typescript'
  sandboxed?: boolean
}

// GenerativeFunction definition
export interface GenerativeFunctionDefinition extends BaseFunctionDefinition {
  type: 'generative'
  model: string
  prompt: string | ((input: unknown) => string)
  temperature?: number
  maxTokens?: number
  stream?: boolean
  schema?: Record<string, unknown>
}

// AgenticFunction definition
export interface AgenticFunctionDefinition extends BaseFunctionDefinition {
  type: 'agentic'
  agent: string
  tools?: string[]
  maxIterations?: number
  systemPrompt?: string
  onStep?: (step: AgentStep) => void | Promise<void>
}

// HumanFunction definition
export interface HumanFunctionDefinition extends BaseFunctionDefinition {
  type: 'human'
  channel: string
  prompt?: string | ((input: unknown) => string)
  timeout: number
  escalation?: {
    timeout: number
    to: string
  }
  form?: FormDefinition
}

export type FunctionDefinition =
  | CodeFunctionDefinition
  | GenerativeFunctionDefinition
  | AgenticFunctionDefinition
  | HumanFunctionDefinition

// Function instance interface
export interface FunctionInstance {
  id: string
  name: string
  type: 'code' | 'generative' | 'agentic' | 'human'
  description?: string
  createdAt: Date
  timeout?: number
  retries?: number
  requiredPermission?: string

  // CodeFunction specific
  handler?: (input: unknown, context: FunctionContext) => unknown | Promise<unknown>
  runtime?: 'javascript' | 'typescript'
  sandboxed?: boolean

  // GenerativeFunction specific
  model?: string
  prompt?: string | ((input: unknown) => string)
  temperature?: number
  maxTokens?: number
  stream?: boolean
  schema?: Record<string, unknown>

  // AgenticFunction specific
  agent?: string
  tools?: string[]
  maxIterations?: number
  systemPrompt?: string
  onStep?: (step: AgentStep) => void | Promise<void>

  // HumanFunction specific
  channel?: string
  escalation?: {
    timeout: number
    to: string
  }
  form?: FormDefinition

  // Methods
  execute: (input: unknown) => Promise<unknown>
  register: (registry: FunctionRegistry) => Promise<void>
  unregister: () => Promise<void>
  toJSON: () => Record<string, unknown>
  getMetadata: () => FunctionMetadata
  getInvocationHistory: () => Promise<InvocationRecord[]>

  // Composition methods
  chain: (next: FunctionInstance) => ComposedFunction
  if: (predicate: (input: unknown) => boolean) => ConditionalFunction
  map: <T, R>(transform: (output: T) => R) => FunctionInstance
  contramap: <T, R>(transform: (input: T) => R) => FunctionInstance
  catch: (handler: (error: Error) => unknown) => FunctionInstance
  finally: (handler: () => void) => FunctionInstance
}

export interface FunctionMetadata {
  id: string
  name: string
  type: 'code' | 'generative' | 'agentic' | 'human'
  createdAt: Date
  invocationCount: number
}

export interface InvocationRecord {
  id: string
  input: unknown
  output: unknown
  status: 'completed' | 'failed'
  startedAt: Date
  completedAt: Date
  duration: number
}

export interface FunctionRegistry {
  register: (fn: FunctionInstance) => Promise<void>
  get: (name: string) => Promise<FunctionInstance | null>
  list: () => Promise<FunctionInstance[]>
  unregister: (name: string) => Promise<boolean>
  has: (name: string) => Promise<boolean>
}

export interface ComposedFunction extends FunctionInstance {
  describe: () => { type: string; steps: Array<{ name: string; type: string }> }
}

export interface ConditionalFunction extends FunctionInstance {
  else: (elseFn: FunctionInstance) => FunctionInstance
}

export interface CreateFunctionOptions {
  registry?: FunctionRegistry
  env: Record<string, unknown>
  state?: DurableObjectState
  durableObject?: DurableObject
  id?: string
  autoRegister?: boolean
  replace?: boolean
  onEvent?: (event: string, data: unknown) => void
}

// DurableObject interfaces for type compatibility
interface DurableObjectState {
  id: { toString: () => string }
  storage: {
    get: (key: string) => Promise<unknown>
    put: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<boolean>
    list: (options?: { prefix?: string }) => Promise<Map<string, unknown>>
  }
}

interface DurableObject {
  registerFunction?: (fn: FunctionInstance) => void
}

// ============================================================================
// VALIDATION
// ============================================================================

const VALID_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/
const VALID_JSON_SCHEMA_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']
const VALID_FORM_FIELD_TYPES = ['text', 'number', 'boolean', 'select', 'multiselect']

function validateBaseFunctionDefinition(def: FunctionDefinition): void {
  if (!def.name) {
    throw new ValidationError('Function name is required')
  }

  if (typeof def.name !== 'string' || def.name.trim() === '') {
    throw new ValidationError('Function name must be a non-empty string')
  }

  if (!VALID_NAME_PATTERN.test(def.name)) {
    throw new ValidationError(`Function name "${def.name}" contains invalid characters. Names must start with a letter and contain only letters, numbers, and underscores.`)
  }

  if (!def.type) {
    throw new ValidationError('Function type is required')
  }

  if (!['code', 'generative', 'agentic', 'human'].includes(def.type)) {
    throw new ValidationError(`Invalid function type: ${def.type}. Must be one of: code, generative, agentic, human`)
  }

  if (def.timeout !== undefined && def.timeout < 0) {
    throw new ValidationError('Timeout must be a non-negative number')
  }

  if (def.retries !== undefined && def.retries < 0) {
    throw new ValidationError('Retries must be a non-negative number')
  }
}

function validateCodeFunctionDefinition(def: CodeFunctionDefinition): void {
  validateBaseFunctionDefinition(def)

  if (!def.handler) {
    throw new ValidationError('CodeFunction requires a handler')
  }

  if (typeof def.handler !== 'function') {
    throw new ValidationError('Handler must be a function')
  }

  if (def.runtime !== undefined && !['javascript', 'typescript'].includes(def.runtime)) {
    throw new ValidationError(`Invalid runtime: ${def.runtime}. Must be 'javascript' or 'typescript'`)
  }
}

function validateGenerativeFunctionDefinition(def: GenerativeFunctionDefinition): void {
  validateBaseFunctionDefinition(def)

  if (!def.model) {
    throw new ValidationError('GenerativeFunction requires a model')
  }

  if (typeof def.model !== 'string' || def.model.trim() === '') {
    throw new ValidationError('Model must be a non-empty string')
  }

  if (def.prompt === undefined || def.prompt === null) {
    throw new ValidationError('GenerativeFunction requires a prompt')
  }

  if (def.temperature !== undefined && (def.temperature < 0 || def.temperature > 2)) {
    throw new ValidationError('Temperature must be between 0 and 2')
  }

  if (def.maxTokens !== undefined && def.maxTokens < 0) {
    throw new ValidationError('maxTokens must be a non-negative number')
  }

  if (def.schema !== undefined) {
    const schemaType = (def.schema as { type?: string }).type
    if (schemaType && !VALID_JSON_SCHEMA_TYPES.includes(schemaType)) {
      throw new ValidationError(`Invalid JSON Schema type: ${schemaType}`)
    }
  }
}

function validateAgenticFunctionDefinition(def: AgenticFunctionDefinition): void {
  validateBaseFunctionDefinition(def)

  if (!def.agent) {
    throw new ValidationError('AgenticFunction requires an agent')
  }

  if (typeof def.agent !== 'string' || def.agent.trim() === '') {
    throw new ValidationError('Agent must be a non-empty string')
  }

  if (def.maxIterations !== undefined) {
    if (def.maxIterations < 1) {
      throw new ValidationError('maxIterations must be at least 1')
    }
    if (def.maxIterations > 1000) {
      throw new ValidationError('maxIterations cannot exceed 1000')
    }
  }

  if (def.tools !== undefined) {
    const uniqueTools = new Set(def.tools)
    if (uniqueTools.size !== def.tools.length) {
      throw new ValidationError('Tools array contains duplicates')
    }
  }
}

function validateHumanFunctionDefinition(def: HumanFunctionDefinition): void {
  validateBaseFunctionDefinition(def)

  if (!def.channel) {
    throw new ValidationError('HumanFunction requires a channel')
  }

  if (typeof def.channel !== 'string' || def.channel.trim() === '') {
    throw new ValidationError('Channel must be a non-empty string')
  }

  if (def.timeout === undefined || def.timeout === null) {
    throw new ValidationError('HumanFunction requires a timeout')
  }

  if (def.timeout <= 0) {
    throw new ValidationError('Timeout must be a positive number')
  }

  if (def.escalation) {
    if (def.escalation.timeout > def.timeout) {
      throw new ValidationError('Escalation timeout cannot exceed main timeout')
    }
  }

  if (def.form) {
    for (const field of def.form.fields) {
      if (!field.name) {
        throw new ValidationError('Form field must have a name')
      }
      if (!VALID_FORM_FIELD_TYPES.includes(field.type)) {
        throw new ValidationError(`Invalid form field type: ${field.type}`)
      }
    }
  }
}

function validateFunctionDefinition(def: FunctionDefinition): void {
  switch (def.type) {
    case 'code':
      validateCodeFunctionDefinition(def as CodeFunctionDefinition)
      break
    case 'generative':
      validateGenerativeFunctionDefinition(def as GenerativeFunctionDefinition)
      break
    case 'agentic':
      validateAgenticFunctionDefinition(def as AgenticFunctionDefinition)
      break
    case 'human':
      validateHumanFunctionDefinition(def as HumanFunctionDefinition)
      break
    default:
      throw new ValidationError(`Unknown function type: ${(def as { type: string }).type}`)
  }
}

// ============================================================================
// TEMPLATE SUBSTITUTION
// ============================================================================

function substituteTemplate(template: string, input: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return String(input[key] ?? '')
  })
}

// ============================================================================
// JSON SCHEMA VALIDATION
// ============================================================================

function validateAgainstSchema(data: unknown, schema: Record<string, unknown>): boolean {
  if (schema.type === 'object') {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return false
    }
    const requiredFields = (schema.required as string[]) || []
    for (const field of requiredFields) {
      if (!(field in (data as Record<string, unknown>))) {
        return false
      }
    }
  }
  return true
}

// ============================================================================
// FORM VALIDATION
// ============================================================================

function validateFormResponse(response: Record<string, unknown>, form: FormDefinition): boolean {
  for (const field of form.fields) {
    const value = response[field.name]

    if (field.required && (value === undefined || value === null)) {
      return false
    }

    if (value !== undefined && value !== null) {
      switch (field.type) {
        case 'boolean':
          if (typeof value !== 'boolean') return false
          break
        case 'number':
          if (typeof value !== 'number') return false
          break
        case 'text':
          if (typeof value !== 'string') return false
          break
        case 'select':
          if (field.options && !field.options.includes(String(value))) return false
          break
        case 'multiselect':
          if (!Array.isArray(value)) return false
          if (field.options) {
            for (const v of value) {
              if (!field.options.includes(String(v))) return false
            }
          }
          break
      }
    }

    if (field.validation) {
      const result = field.validation(value)
      if (result !== true && typeof result === 'string') return false
      if (result === false) return false
    }
  }
  return true
}

// ============================================================================
// FUNCTION INSTANCE CREATION
// ============================================================================

function createFunctionInstance(
  def: FunctionDefinition,
  options: CreateFunctionOptions,
): FunctionInstance {
  const id = options.id || crypto.randomUUID()
  const createdAt = new Date()
  let invocationCount = 0
  const invocationHistory: InvocationRecord[] = []
  let registeredRegistry: FunctionRegistry | null = options.registry || null

  // Build base instance properties
  const instance: FunctionInstance = {
    id,
    name: def.name,
    type: def.type,
    description: def.description,
    createdAt,
    timeout: def.timeout,
    retries: def.retries,
    requiredPermission: def.requiredPermission,

    // Methods will be defined below
    execute: null as unknown as (input: unknown) => Promise<unknown>,
    register: null as unknown as (registry: FunctionRegistry) => Promise<void>,
    unregister: null as unknown as () => Promise<void>,
    toJSON: null as unknown as () => Record<string, unknown>,
    getMetadata: null as unknown as () => FunctionMetadata,
    getInvocationHistory: null as unknown as () => Promise<InvocationRecord[]>,
    chain: null as unknown as (next: FunctionInstance) => ComposedFunction,
    if: null as unknown as (predicate: (input: unknown) => boolean) => ConditionalFunction,
    map: null as unknown as <T, R>(transform: (output: T) => R) => FunctionInstance,
    contramap: null as unknown as <T, R>(transform: (input: T) => R) => FunctionInstance,
    catch: null as unknown as (handler: (error: Error) => unknown) => FunctionInstance,
    finally: null as unknown as (handler: () => void) => FunctionInstance,
  }

  // Add type-specific properties
  if (def.type === 'code') {
    const codeDef = def as CodeFunctionDefinition
    instance.handler = codeDef.handler
    instance.runtime = codeDef.runtime || 'javascript'
    instance.sandboxed = codeDef.sandboxed
  } else if (def.type === 'generative') {
    const genDef = def as GenerativeFunctionDefinition
    instance.model = genDef.model
    instance.prompt = genDef.prompt
    instance.temperature = genDef.temperature ?? 1
    instance.maxTokens = genDef.maxTokens
    instance.stream = genDef.stream
    instance.schema = genDef.schema
  } else if (def.type === 'agentic') {
    const agentDef = def as AgenticFunctionDefinition
    instance.agent = agentDef.agent
    instance.tools = agentDef.tools
    instance.maxIterations = agentDef.maxIterations ?? 10
    instance.systemPrompt = agentDef.systemPrompt
    instance.onStep = agentDef.onStep
  } else if (def.type === 'human') {
    const humanDef = def as HumanFunctionDefinition
    instance.channel = humanDef.channel
    instance.prompt = humanDef.prompt
    instance.timeout = humanDef.timeout
    instance.escalation = humanDef.escalation
    instance.form = humanDef.form
  }

  // Execute method
  instance.execute = async (input: unknown): Promise<unknown> => {
    const invocationId = crypto.randomUUID()
    const startTime = Date.now()

    // Emit invoked event
    options.onEvent?.('function.invoked', {
      functionId: id,
      invocationId,
      input,
    })

    const context: FunctionContext = {
      functionId: id,
      invocationId,
      input,
      env: options.env,
      emit: async (event: string, data: unknown) => {
        options.onEvent?.(event, data)
      },
      log: (message: string, data?: unknown) => {
        console.log(`[${instance.name}] ${message}`, data)
      },
    }

    try {
      let result: unknown

      if (def.type === 'code') {
        result = await executeCodeFunction(def as CodeFunctionDefinition, input, context, instance)
      } else if (def.type === 'generative') {
        result = await executeGenerativeFunction(def as GenerativeFunctionDefinition, input, options.env)
      } else if (def.type === 'agentic') {
        result = await executeAgenticFunction(def as AgenticFunctionDefinition, input, options.env)
      } else if (def.type === 'human') {
        result = await executeHumanFunction(def as HumanFunctionDefinition, input, options.env)
      }

      const duration = Date.now() - startTime
      invocationCount++

      // Record invocation
      const record: InvocationRecord = {
        id: invocationId,
        input,
        output: result,
        status: 'completed',
        startedAt: new Date(startTime),
        completedAt: new Date(),
        duration,
      }
      invocationHistory.push(record)

      // Store in state if available
      if (options.state) {
        await options.state.storage.put(`invocation:${invocationId}`, record)
      }

      // Emit completed event
      options.onEvent?.('function.completed', {
        functionId: id,
        invocationId,
        result,
        duration,
      })

      return result
    } catch (error) {
      const duration = Date.now() - startTime

      // Record failed invocation
      const record: InvocationRecord = {
        id: invocationId,
        input,
        output: undefined,
        status: 'failed',
        startedAt: new Date(startTime),
        completedAt: new Date(),
        duration,
      }
      invocationHistory.push(record)

      // Emit failed event
      options.onEvent?.('function.failed', {
        functionId: id,
        invocationId,
        error: error instanceof Error ? error.message : String(error),
        duration,
      })

      throw error
    }
  }

  // Register method
  instance.register = async (registry: FunctionRegistry): Promise<void> => {
    await registry.register(instance)
    registeredRegistry = registry
  }

  // Unregister method
  instance.unregister = async (): Promise<void> => {
    if (registeredRegistry) {
      await registeredRegistry.unregister(instance.name)
    }
    if (options.state) {
      await options.state.storage.delete(`function:${instance.name}`)
    }
  }

  // toJSON method
  instance.toJSON = (): Record<string, unknown> => {
    const json: Record<string, unknown> = {
      id,
      name: instance.name,
      type: instance.type,
      description: instance.description,
      createdAt: instance.createdAt.toISOString(),
      timeout: instance.timeout,
      retries: instance.retries,
      requiredPermission: instance.requiredPermission,
    }

    // Add type-specific properties (except handler)
    if (instance.type === 'generative') {
      json.model = instance.model
      json.temperature = instance.temperature
      json.maxTokens = instance.maxTokens
      json.stream = instance.stream
      json.schema = instance.schema
    } else if (instance.type === 'agentic') {
      json.agent = instance.agent
      json.tools = instance.tools
      json.maxIterations = instance.maxIterations
      json.systemPrompt = instance.systemPrompt
    } else if (instance.type === 'human') {
      json.channel = instance.channel
      json.timeout = instance.timeout
      json.escalation = instance.escalation
      json.form = instance.form
    } else if (instance.type === 'code') {
      json.runtime = instance.runtime
      json.sandboxed = instance.sandboxed
    }

    return json
  }

  // getMetadata method
  instance.getMetadata = (): FunctionMetadata => ({
    id,
    name: instance.name,
    type: instance.type,
    createdAt,
    invocationCount,
  })

  // getInvocationHistory method
  instance.getInvocationHistory = async (): Promise<InvocationRecord[]> => {
    return [...invocationHistory]
  }

  // Composition: then
  instance.chain = createChainMethod(instance, (next) => createComposedFunction([instance, next], options))

  // Composition: if
  instance.if = (predicate: (input: unknown) => boolean): ConditionalFunction => {
    return createConditionalFunction(instance, predicate, options)
  }

  // Composition: map
  instance.map = <T, R>(transform: (output: T) => R): FunctionInstance => {
    return createMappedFunction(instance, transform, options)
  }

  // Composition: contramap
  instance.contramap = <T, R>(transform: (input: T) => R): FunctionInstance => {
    return createContramappedFunction(instance, transform, options)
  }

  // Composition: catch
  instance.catch = (handler: (error: Error) => unknown): FunctionInstance => {
    return createCatchFunction(instance, handler, options)
  }

  // Composition: finally
  instance.finally = (handler: () => void): FunctionInstance => {
    return createFinallyFunction(instance, handler, options)
  }

  return instance
}

// ============================================================================
// EXECUTION FUNCTIONS
// ============================================================================

async function executeCodeFunction(
  def: CodeFunctionDefinition,
  input: unknown,
  context: FunctionContext,
  instance: FunctionInstance,
): Promise<unknown> {
  const timeout = instance.timeout
  const retries = instance.retries ?? 0

  let lastError: Error | null = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (timeout) {
        const result = await Promise.race([
          Promise.resolve(def.handler(input, context)),
          new Promise((_, reject) =>
            setTimeout(() => reject(new ExecutionError('Function execution timeout')), timeout)
          ),
        ])
        return result
      } else {
        return await Promise.resolve(def.handler(input, context))
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt === retries) {
        if (lastError.message.includes('timeout')) {
          throw lastError
        }
        throw new ExecutionError(lastError.message)
      }
    }
  }
  throw new ExecutionError(lastError?.message || 'Unknown error')
}

async function executeGenerativeFunction(
  def: GenerativeFunctionDefinition,
  input: unknown,
  env: Record<string, unknown>,
): Promise<unknown> {
  const ai = env.AI as {
    generate: (params: Record<string, unknown>) => Promise<{ text: string }>
    stream: (params: Record<string, unknown>) => AsyncIterable<{ text: string }>
  }

  // Build prompt
  let promptText: string
  if (typeof def.prompt === 'function') {
    promptText = def.prompt(input)
  } else {
    promptText = substituteTemplate(def.prompt, input as Record<string, unknown>)
  }

  // If streaming, return the stream directly
  if (def.stream) {
    return ai.stream({
      model: def.model,
      prompt: promptText,
      temperature: def.temperature,
      maxTokens: def.maxTokens,
    })
  }

  // Generate response
  const response = await ai.generate({
    model: def.model,
    prompt: promptText,
    temperature: def.temperature,
    maxTokens: def.maxTokens,
  })

  // If schema is defined, parse and validate
  if (def.schema) {
    try {
      const parsed = JSON.parse(response.text)
      if (!validateAgainstSchema(parsed, def.schema)) {
        throw new ExecutionError('AI output does not match schema')
      }
      return parsed
    } catch (error) {
      if (error instanceof ExecutionError) throw error
      throw new ExecutionError('Failed to parse AI output as JSON')
    }
  }

  return response.text
}

async function executeAgenticFunction(
  def: AgenticFunctionDefinition,
  input: unknown,
  env: Record<string, unknown>,
): Promise<unknown> {
  const agentRunner = env.AGENT_RUNNER as {
    run: (params: {
      agent: string
      input: unknown
      tools?: string[]
      maxIterations?: number
      systemPrompt?: string
      onStep?: (step: AgentStep) => void | Promise<void>
    }) => Promise<{ result: string }>
  }

  try {
    const result = await agentRunner.run({
      agent: def.agent,
      input,
      tools: def.tools,
      maxIterations: def.maxIterations ?? 10,
      systemPrompt: def.systemPrompt,
      onStep: def.onStep,
    })
    return result
  } catch (error) {
    throw new ExecutionError(error instanceof Error ? error.message : String(error))
  }
}

async function executeHumanFunction(
  def: HumanFunctionDefinition,
  input: unknown,
  env: Record<string, unknown>,
): Promise<unknown> {
  const notifications = env.NOTIFICATIONS as {
    send: (params: { channel: string; message: string; form?: FormDefinition }) => Promise<void>
    waitForResponse: (params: { timeout: number }) => Promise<Record<string, unknown>>
  }

  // Build message
  let message: string
  if (typeof def.prompt === 'function') {
    message = def.prompt(input)
  } else if (def.prompt) {
    message = substituteTemplate(def.prompt, input as Record<string, unknown>)
  } else {
    message = JSON.stringify(input)
  }

  // Send notification
  await notifications.send({
    channel: def.channel,
    message,
    form: def.form,
  })

  try {
    // Wait for response
    const response = await notifications.waitForResponse({
      timeout: def.timeout,
    })

    // Validate response against form if defined
    if (def.form && !validateFormResponse(response, def.form)) {
      throw new ExecutionError('Response does not match form schema')
    }

    return response
  } catch (error) {
    // Handle timeout with escalation
    if (def.escalation && error instanceof Error && error.message.includes('Timeout')) {
      // Escalate to another channel
      await notifications.send({
        channel: def.escalation.to,
        message,
        form: def.form,
      })

      // Wait for escalated response
      const escalatedResponse = await notifications.waitForResponse({
        timeout: def.escalation.timeout,
      })

      return escalatedResponse
    }

    throw new ExecutionError(error instanceof Error ? error.message : String(error))
  }
}

// ============================================================================
// THENABLE HELPER
// ============================================================================

/**
 * Creates a 'chain' method for composition chaining.
 * This was renamed from 'then' to avoid conflicts with Promise's thenable interface.
 * Use chain() to compose functions together.
 */
function createChainMethod(
  instance: FunctionInstance,
  composeWith: (next: FunctionInstance) => ComposedFunction,
): (next: FunctionInstance) => ComposedFunction {
  return (next: FunctionInstance): ComposedFunction => {
    return composeWith(next)
  }
}

// ============================================================================
// COMPOSITION FUNCTIONS
// ============================================================================

function createComposedFunction(
  functions: FunctionInstance[],
  options: CreateFunctionOptions,
): ComposedFunction {
  const name = functions.map((f) => f.name).join(' -> ')
  const id = crypto.randomUUID()

  const composed: ComposedFunction = {
    id,
    name,
    type: 'code' as const,
    createdAt: new Date(),

    execute: async (input: unknown): Promise<unknown> => {
      let result = input
      for (const fn of functions) {
        result = await fn.execute(result)
      }
      return result
    },

    register: async (registry: FunctionRegistry): Promise<void> => {
      await registry.register(composed)
    },

    unregister: async (): Promise<void> => {
      // No-op for composed functions
    },

    toJSON: () => ({
      id,
      name,
      type: 'composed',
      steps: functions.map((f) => ({ name: f.name, type: f.type })),
    }),

    getMetadata: () => ({
      id,
      name,
      type: 'code' as const,
      createdAt: new Date(),
      invocationCount: 0,
    }),

    getInvocationHistory: async () => [],

    chain: null as unknown as (next: FunctionInstance) => ComposedFunction,

    if: (predicate: (input: unknown) => boolean): ConditionalFunction => {
      return createConditionalFunction(composed, predicate, options)
    },

    map: <T, R>(transform: (output: T) => R): FunctionInstance => {
      return createMappedFunction(composed, transform, options)
    },

    contramap: <T, R>(transform: (input: T) => R): FunctionInstance => {
      return createContramappedFunction(composed, transform, options)
    },

    catch: (handler: (error: Error) => unknown): FunctionInstance => {
      return createCatchFunction(composed, handler, options)
    },

    finally: (handler: () => void): FunctionInstance => {
      return createFinallyFunction(composed, handler, options)
    },

    describe: () => ({
      type: 'pipeline',
      steps: functions.map((f) => ({ name: f.name, type: f.type })),
    }),
  }

  // Set up the thenable-safe then method
  composed.chain = createChainMethod(composed, (next) => createComposedFunction([...functions, next], options))

  return composed
}

function createConditionalFunction(
  fn: FunctionInstance,
  predicate: (input: unknown) => boolean,
  options: CreateFunctionOptions,
): ConditionalFunction {
  let elseFn: FunctionInstance | null = null

  const conditional: ConditionalFunction = {
    id: crypto.randomUUID(),
    name: `${fn.name} (conditional)`,
    type: fn.type,
    createdAt: new Date(),

    execute: async (input: unknown): Promise<unknown> => {
      if (predicate(input)) {
        return fn.execute(input)
      }
      if (elseFn) {
        return elseFn.execute(input)
      }
      return null
    },

    register: async (registry: FunctionRegistry): Promise<void> => {
      await registry.register(conditional)
    },

    unregister: async (): Promise<void> => {},

    toJSON: () => fn.toJSON(),

    getMetadata: () => fn.getMetadata(),

    getInvocationHistory: async () => fn.getInvocationHistory(),

    chain: null as unknown as (next: FunctionInstance) => ComposedFunction,

    if: (pred: (input: unknown) => boolean): ConditionalFunction => {
      return createConditionalFunction(conditional, pred, options)
    },

    map: <T, R>(transform: (output: T) => R): FunctionInstance => {
      return createMappedFunction(conditional, transform, options)
    },

    contramap: <T, R>(transform: (input: T) => R): FunctionInstance => {
      return createContramappedFunction(conditional, transform, options)
    },

    catch: (handler: (error: Error) => unknown): FunctionInstance => {
      return createCatchFunction(conditional, handler, options)
    },

    finally: (handler: () => void): FunctionInstance => {
      return createFinallyFunction(conditional, handler, options)
    },

    else: (elseFunction: FunctionInstance): FunctionInstance => {
      elseFn = elseFunction
      return conditional
    },
  }

  // Set up thenable-safe then method
  conditional.chain = createChainMethod(conditional, (next) => createComposedFunction([conditional, next], options))

  return conditional
}

function createMappedFunction<T, R>(
  fn: FunctionInstance,
  transform: (output: T) => R,
  options: CreateFunctionOptions,
): FunctionInstance {
  const mapped: FunctionInstance = {
    id: crypto.randomUUID(),
    name: `${fn.name} (mapped)`,
    type: fn.type,
    createdAt: new Date(),

    execute: async (input: unknown): Promise<R> => {
      const result = await fn.execute(input)
      return transform(result as T)
    },

    register: async (registry: FunctionRegistry): Promise<void> => {
      await registry.register(mapped)
    },

    unregister: async (): Promise<void> => {},

    toJSON: () => fn.toJSON(),

    getMetadata: () => fn.getMetadata(),

    getInvocationHistory: async () => fn.getInvocationHistory(),

    chain: null as unknown as (next: FunctionInstance) => ComposedFunction,

    if: (pred: (input: unknown) => boolean): ConditionalFunction => {
      return createConditionalFunction(mapped, pred, options)
    },

    map: <T2, R2>(transform2: (output: T2) => R2): FunctionInstance => {
      return createMappedFunction(mapped, transform2, options)
    },

    contramap: <T2, R2>(transform2: (input: T2) => R2): FunctionInstance => {
      return createContramappedFunction(mapped, transform2, options)
    },

    catch: (handler: (error: Error) => unknown): FunctionInstance => {
      return createCatchFunction(mapped, handler, options)
    },

    finally: (handler: () => void): FunctionInstance => {
      return createFinallyFunction(mapped, handler, options)
    },
  }

  mapped.chain = createChainMethod(mapped, (next) => createComposedFunction([mapped, next], options))

  return mapped
}

function createContramappedFunction<T, R>(
  fn: FunctionInstance,
  transform: (input: T) => R,
  options: CreateFunctionOptions,
): FunctionInstance {
  const contramapped: FunctionInstance = {
    id: crypto.randomUUID(),
    name: `${fn.name} (contramapped)`,
    type: fn.type,
    createdAt: new Date(),

    execute: async (input: unknown): Promise<unknown> => {
      const transformedInput = transform(input as T)
      return fn.execute(transformedInput)
    },

    register: async (registry: FunctionRegistry): Promise<void> => {
      await registry.register(contramapped)
    },

    unregister: async (): Promise<void> => {},

    toJSON: () => fn.toJSON(),

    getMetadata: () => fn.getMetadata(),

    getInvocationHistory: async () => fn.getInvocationHistory(),

    chain: null as unknown as (next: FunctionInstance) => ComposedFunction,

    if: (pred: (input: unknown) => boolean): ConditionalFunction => {
      return createConditionalFunction(contramapped, pred, options)
    },

    map: <T2, R2>(transform2: (output: T2) => R2): FunctionInstance => {
      return createMappedFunction(contramapped, transform2, options)
    },

    contramap: <T2, R2>(transform2: (input: T2) => R2): FunctionInstance => {
      return createContramappedFunction(contramapped, transform2, options)
    },

    catch: (handler: (error: Error) => unknown): FunctionInstance => {
      return createCatchFunction(contramapped, handler, options)
    },

    finally: (handler: () => void): FunctionInstance => {
      return createFinallyFunction(contramapped, handler, options)
    },
  }

  contramapped.chain = createChainMethod(contramapped, (next) => createComposedFunction([contramapped, next], options))

  return contramapped
}

function createCatchFunction(
  fn: FunctionInstance,
  handler: (error: Error) => unknown,
  options: CreateFunctionOptions,
): FunctionInstance {
  const catchFn: FunctionInstance = {
    id: crypto.randomUUID(),
    name: `${fn.name} (catch)`,
    type: fn.type,
    createdAt: new Date(),

    execute: async (input: unknown): Promise<unknown> => {
      try {
        return await fn.execute(input)
      } catch (error) {
        return handler(error instanceof Error ? error : new Error(String(error)))
      }
    },

    register: async (registry: FunctionRegistry): Promise<void> => {
      await registry.register(catchFn)
    },

    unregister: async (): Promise<void> => {},

    toJSON: () => fn.toJSON(),

    getMetadata: () => fn.getMetadata(),

    getInvocationHistory: async () => fn.getInvocationHistory(),

    chain: null as unknown as (next: FunctionInstance) => ComposedFunction,

    if: (pred: (input: unknown) => boolean): ConditionalFunction => {
      return createConditionalFunction(catchFn, pred, options)
    },

    map: <T, R>(transform: (output: T) => R): FunctionInstance => {
      return createMappedFunction(catchFn, transform, options)
    },

    contramap: <T, R>(transform: (input: T) => R): FunctionInstance => {
      return createContramappedFunction(catchFn, transform, options)
    },

    catch: (h: (error: Error) => unknown): FunctionInstance => {
      return createCatchFunction(catchFn, h, options)
    },

    finally: (h: () => void): FunctionInstance => {
      return createFinallyFunction(catchFn, h, options)
    },
  }

  catchFn.chain = createChainMethod(catchFn, (next) => createComposedFunction([catchFn, next], options))

  return catchFn
}

function createFinallyFunction(
  fn: FunctionInstance,
  handler: () => void,
  options: CreateFunctionOptions,
): FunctionInstance {
  const finallyFn: FunctionInstance = {
    id: crypto.randomUUID(),
    name: `${fn.name} (finally)`,
    type: fn.type,
    createdAt: new Date(),

    execute: async (input: unknown): Promise<unknown> => {
      try {
        return await fn.execute(input)
      } finally {
        handler()
      }
    },

    register: async (registry: FunctionRegistry): Promise<void> => {
      await registry.register(finallyFn)
    },

    unregister: async (): Promise<void> => {},

    toJSON: () => fn.toJSON(),

    getMetadata: () => fn.getMetadata(),

    getInvocationHistory: async () => fn.getInvocationHistory(),

    chain: null as unknown as (next: FunctionInstance) => ComposedFunction,

    if: (pred: (input: unknown) => boolean): ConditionalFunction => {
      return createConditionalFunction(finallyFn, pred, options)
    },

    map: <T, R>(transform: (output: T) => R): FunctionInstance => {
      return createMappedFunction(finallyFn, transform, options)
    },

    contramap: <T, R>(transform: (input: T) => R): FunctionInstance => {
      return createContramappedFunction(finallyFn, transform, options)
    },

    catch: (h: (error: Error) => unknown): FunctionInstance => {
      return createCatchFunction(finallyFn, h, options)
    },

    finally: (h: () => void): FunctionInstance => {
      return createFinallyFunction(finallyFn, h, options)
    },
  }

  finallyFn.chain = createChainMethod(finallyFn, (next) => createComposedFunction([finallyFn, next], options))

  return finallyFn
}

// ============================================================================
// PARALLEL EXECUTION
// ============================================================================

function createParallelFunction(
  functions: FunctionInstance[],
  mode: 'all' | 'allSettled',
): FunctionInstance {
  const parallel: FunctionInstance = {
    id: crypto.randomUUID(),
    name: `parallel(${functions.map((f) => f.name).join(', ')})`,
    type: 'code',
    createdAt: new Date(),

    execute: async (input: unknown): Promise<unknown> => {
      if (mode === 'all') {
        return Promise.all(functions.map((fn) => fn.execute(input)))
      } else {
        const results = await Promise.allSettled(functions.map((fn) => fn.execute(input)))
        return results.map((r) =>
          r.status === 'fulfilled'
            ? { status: 'fulfilled', value: r.value }
            : { status: 'rejected', reason: r.reason }
        )
      }
    },

    register: async (): Promise<void> => {},

    unregister: async (): Promise<void> => {},

    toJSON: () => ({
      id: parallel.id,
      name: parallel.name,
      type: 'parallel',
      mode,
      functions: functions.map((f) => f.name),
    }),

    getMetadata: () => ({
      id: parallel.id,
      name: parallel.name,
      type: 'code' as const,
      createdAt: parallel.createdAt,
      invocationCount: 0,
    }),

    getInvocationHistory: async () => [],

    chain: null as unknown as (next: FunctionInstance) => ComposedFunction,

    if: (pred: (input: unknown) => boolean): ConditionalFunction => {
      return createConditionalFunction(parallel, pred, { env: {} })
    },

    map: <T, R>(transform: (output: T) => R): FunctionInstance => {
      return createMappedFunction(parallel, transform, { env: {} })
    },

    contramap: <T, R>(transform: (input: T) => R): FunctionInstance => {
      return createContramappedFunction(parallel, transform, { env: {} })
    },

    catch: (handler: (error: Error) => unknown): FunctionInstance => {
      return createCatchFunction(parallel, handler, { env: {} })
    },

    finally: (handler: () => void): FunctionInstance => {
      return createFinallyFunction(parallel, handler, { env: {} })
    },
  }

  parallel.chain = createChainMethod(parallel, (next) => createComposedFunction([parallel, next], { env: {} }))

  return parallel
}

// ============================================================================
// MAIN FACTORY FUNCTION
// ============================================================================

export async function createFunction(
  definition: FunctionDefinition,
  options: CreateFunctionOptions,
): Promise<FunctionInstance> {
  // Direct implementation instead of IIFE to avoid thenable issues with FunctionInstance
    // Validate the definition
    validateFunctionDefinition(definition)

    // Check if function already exists in registry
    if (options.registry && options.autoRegister !== false) {
      const existing = await options.registry.get(definition.name)
      if (existing && !options.replace) {
        throw new RegistrationError(`Function "${definition.name}" is already registered`)
      }
    }

    // Create the function instance
    const instance = createFunctionInstance(definition, options)

    // Register with DO if provided
    if (options.durableObject?.registerFunction) {
      options.durableObject.registerFunction(instance)
    }

    // Store in state if provided
    if (options.state) {
      await options.state.storage.put(`function:${instance.name}`, {
        name: instance.name,
        type: instance.type,
        description: instance.description,
        createdAt: instance.createdAt.toISOString(),
      })
    }

    // Auto-register with registry
    if (options.registry && options.autoRegister !== false) {
      if (options.replace) {
        await options.registry.unregister(definition.name)
        options.onEvent?.('function.replaced', {
          name: definition.name,
        })
      }
      await options.registry.register(instance)
      options.onEvent?.('function.registered', {
        name: definition.name,
        type: definition.type,
      })
    }

  return instance
}

// Static methods on createFunction
createFunction.all = (functions: FunctionInstance[]): FunctionInstance => {
  return createParallelFunction(functions, 'all')
}

createFunction.allSettled = (functions: FunctionInstance[]): FunctionInstance => {
  return createParallelFunction(functions, 'allSettled')
}

createFunction.fromStorage = async (
  name: string,
  options: CreateFunctionOptions,
): Promise<FunctionInstance> => {
  if (!options.state) {
    throw new Error('State is required to load from storage')
  }

  const stored = (await options.state.storage.get(`function:${name}`)) as {
    name: string
    type: 'code' | 'generative' | 'agentic' | 'human'
    description?: string
    createdAt: string
  } | undefined

  if (!stored) {
    throw new Error(`Function "${name}" not found in storage`)
  }

  // Create a minimal function instance from stored data
  // Note: handlers cannot be restored from storage
  const definition: FunctionDefinition = {
    name: stored.name,
    type: stored.type,
    description: stored.description,
  } as FunctionDefinition

  // Add minimal required fields based on type
  if (stored.type === 'code') {
    (definition as CodeFunctionDefinition).handler = () => {
      throw new Error('Handler not available - function loaded from storage')
    }
  } else if (stored.type === 'generative') {
    (definition as GenerativeFunctionDefinition).model = 'unknown'
    ;(definition as GenerativeFunctionDefinition).prompt = ''
  } else if (stored.type === 'agentic') {
    (definition as AgenticFunctionDefinition).agent = 'unknown'
  } else if (stored.type === 'human') {
    (definition as HumanFunctionDefinition).channel = 'unknown'
    ;(definition as HumanFunctionDefinition).timeout = 60000
  }

  return createFunction(definition, {
    ...options,
    autoRegister: options.autoRegister ?? true,
  })
}

export default createFunction
