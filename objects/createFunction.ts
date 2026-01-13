/**
 * createFunction Factory
 *
 * Creates typed function instances for different execution modes:
 * - CodeFunction: executes TypeScript/JavaScript code
 * - GenerativeFunction: calls LLM for generation
 * - AgenticFunction: orchestrates multi-step AI tasks
 * - HumanFunction: queues tasks for human input
 */

// Use Cloudflare's DurableObjectState type from @cloudflare/workers-types
// No need to redeclare - it's provided by the ambient types

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
// TYPES
// ============================================================================

export interface FunctionContext {
  functionId: string
  invocationId: string
  input: unknown
  env: Record<string, unknown>
  emit: (event: string, data: unknown) => Promise<void>
  log: (message: string, data?: unknown) => void
}

interface AgentStep {
  iteration: number
  thought: string
  action?: string
  observation?: string
}

interface FormField {
  name: string
  type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect'
  label: string
  required?: boolean
  options?: string[]
  validation?: (value: unknown) => boolean | string
}

interface FormDefinition {
  fields: FormField[]
}

// Base function definition
export interface FunctionDefinition {
  name: string
  description?: string
  type: 'code' | 'generative' | 'agentic' | 'human'
  timeout?: number
  retries?: number
  requiredPermission?: string
}

export interface CodeFunctionDefinition extends FunctionDefinition {
  type: 'code'
  handler: (input: unknown, context: FunctionContext) => unknown | Promise<unknown>
  runtime?: 'javascript' | 'typescript'
  sandboxed?: boolean
}

export interface GenerativeFunctionDefinition extends FunctionDefinition {
  type: 'generative'
  model: string
  prompt: string | ((input: unknown) => string)
  temperature?: number
  maxTokens?: number
  stream?: boolean
  schema?: Record<string, unknown>
}

export interface AgenticFunctionDefinition extends FunctionDefinition {
  type: 'agentic'
  agent: string
  tools?: string[]
  maxIterations?: number
  systemPrompt?: string
  onStep?: (step: AgentStep) => void | Promise<void>
}

export interface HumanFunctionDefinition extends FunctionDefinition {
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

type AnyFunctionDefinition =
  | CodeFunctionDefinition
  | GenerativeFunctionDefinition
  | AgenticFunctionDefinition
  | HumanFunctionDefinition

export interface FunctionRegistry {
  register: (fn: FunctionInstance) => Promise<void>
  get: (name: string) => Promise<FunctionInstance | null>
  list: () => Promise<FunctionInstance[]>
  unregister: (name: string) => Promise<boolean>
  has: (name: string) => Promise<boolean>
}

interface InvocationRecord {
  invocationId: string
  functionId: string
  input: unknown
  output?: unknown
  status: 'completed' | 'failed'
  error?: string
  startedAt: Date
  completedAt: Date
  duration: number
}

interface FunctionMetadata {
  id: string
  name: string
  type: string
  createdAt: Date
  invocationCount: number
}

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
  escalation?: { timeout: number; to: string }
  form?: FormDefinition

  // Methods
  execute: (input: unknown) => Promise<unknown>
  register: (registry: FunctionRegistry) => Promise<void>
  unregister: () => Promise<void>
  toJSON: () => Record<string, unknown>
  getMetadata: () => FunctionMetadata
  getInvocationHistory: () => Promise<InvocationRecord[]>

  // Composition methods
  pipe: (next: FunctionInstance) => ComposedFunction
  if: (predicate: (input: unknown) => boolean) => ConditionalFunction
  map: <T, U>(fn: (output: T) => U) => FunctionInstance
  contramap: <T, U>(fn: (input: T) => U) => FunctionInstance
  catch: (handler: (error: Error) => unknown) => FunctionInstance
  finally: (cleanup: () => void | Promise<void>) => FunctionInstance
}

export interface ComposedFunction extends FunctionInstance {
  describe: () => { type: string; steps: Array<{ name: string; type: string }> }
}

interface ConditionalFunction extends FunctionInstance {
  else: (fn: FunctionInstance) => FunctionInstance
}

interface CreateFunctionOptions {
  registry?: FunctionRegistry
  env: {
    AI?: {
      generate: (options: Record<string, unknown>) => Promise<{ text: string }>
      stream: (options: Record<string, unknown>) => AsyncIterable<{ text: string }>
    }
    AGENT_RUNNER?: {
      run: (options: Record<string, unknown>) => Promise<{ result: string }>
    }
    NOTIFICATIONS?: {
      send: (options: Record<string, unknown>) => Promise<void>
      waitForResponse: (options: Record<string, unknown>) => Promise<unknown>
    }
  }
  state?: DurableObjectState
  durableObject?: { registerFunction: (fn: FunctionInstance) => void }
  id?: string
  replace?: boolean
  autoRegister?: boolean
  onEvent?: (event: string, data: Record<string, unknown>) => void
}

// ============================================================================
// VALIDATION
// ============================================================================

const VALID_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/
const VALID_JSON_SCHEMA_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']
const VALID_FORM_FIELD_TYPES = ['text', 'number', 'boolean', 'select', 'multiselect']

function validateBase(def: FunctionDefinition): void {
  if (!def.name) {
    throw new ValidationError('Function name is required')
  }
  if (def.name === '') {
    throw new ValidationError('Function name cannot be empty')
  }
  if (!VALID_NAME_PATTERN.test(def.name)) {
    throw new ValidationError(`Invalid function name: ${def.name}. Names must start with a letter and contain only alphanumeric characters and underscores.`)
  }
  if (!def.type) {
    throw new ValidationError('Function type is required')
  }
  if (!['code', 'generative', 'agentic', 'human'].includes(def.type)) {
    throw new ValidationError(`Invalid function type: ${def.type}`)
  }
  if (def.timeout !== undefined && def.timeout < 0) {
    throw new ValidationError('Timeout must be non-negative')
  }
  if (def.retries !== undefined && def.retries < 0) {
    throw new ValidationError('Retries must be non-negative')
  }
}

function validateCodeFunction(def: CodeFunctionDefinition): void {
  if (!def.handler) {
    throw new ValidationError('CodeFunction requires a handler')
  }
  if (typeof def.handler !== 'function') {
    throw new ValidationError('Handler must be a function')
  }
  if (def.runtime !== undefined && !['javascript', 'typescript'].includes(def.runtime)) {
    throw new ValidationError(`Invalid runtime: ${def.runtime}. Must be 'javascript' or 'typescript'.`)
  }
}

function validateGenerativeFunction(def: GenerativeFunctionDefinition): void {
  if (!def.model) {
    throw new ValidationError('GenerativeFunction requires a model')
  }
  if (def.model === '') {
    throw new ValidationError('Model cannot be empty')
  }
  if (def.prompt === undefined) {
    throw new ValidationError('GenerativeFunction requires a prompt')
  }
  if (def.temperature !== undefined && (def.temperature < 0 || def.temperature > 2)) {
    throw new ValidationError('Temperature must be between 0 and 2')
  }
  if (def.maxTokens !== undefined && def.maxTokens < 0) {
    throw new ValidationError('maxTokens must be non-negative')
  }
  if (def.schema !== undefined) {
    const schemaType = (def.schema as { type?: string }).type
    if (schemaType && !VALID_JSON_SCHEMA_TYPES.includes(schemaType)) {
      throw new ValidationError(`Invalid JSON Schema type: ${schemaType}`)
    }
  }
}

function validateAgenticFunction(def: AgenticFunctionDefinition): void {
  if (!def.agent) {
    throw new ValidationError('AgenticFunction requires an agent')
  }
  if (def.agent === '') {
    throw new ValidationError('Agent cannot be empty')
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

function validateHumanFunction(def: HumanFunctionDefinition): void {
  if (!def.channel) {
    throw new ValidationError('HumanFunction requires a channel')
  }
  if (def.channel === '') {
    throw new ValidationError('Channel cannot be empty')
  }
  if (def.timeout === undefined) {
    throw new ValidationError('HumanFunction requires a timeout')
  }
  if (def.timeout <= 0) {
    throw new ValidationError('Timeout must be positive')
  }
  if (def.escalation !== undefined && def.escalation.timeout > def.timeout) {
    throw new ValidationError('Escalation timeout cannot exceed main timeout')
  }
  if (def.form !== undefined) {
    for (const field of def.form.fields) {
      if (!field.name) {
        throw new ValidationError('Form field name is required')
      }
      if (!VALID_FORM_FIELD_TYPES.includes(field.type)) {
        throw new ValidationError(`Invalid form field type: ${field.type}`)
      }
    }
  }
}

function validate(def: AnyFunctionDefinition): void {
  validateBase(def)

  switch (def.type) {
    case 'code':
      validateCodeFunction(def as CodeFunctionDefinition)
      break
    case 'generative':
      validateGenerativeFunction(def as GenerativeFunctionDefinition)
      break
    case 'agentic':
      validateAgenticFunction(def as AgenticFunctionDefinition)
      break
    case 'human':
      validateHumanFunction(def as HumanFunctionDefinition)
      break
  }
}

// ============================================================================
// TEMPLATE SUBSTITUTION
// ============================================================================

function substituteTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return String(data[key] ?? '')
  })
}

// ============================================================================
// JSON SCHEMA VALIDATION
// ============================================================================

function validateAgainstSchema(data: unknown, schema: Record<string, unknown>): boolean {
  const schemaType = schema.type as string

  if (schemaType === 'object') {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return false
    }
    const required = (schema.required as string[]) || []
    for (const key of required) {
      if (!(key in (data as Record<string, unknown>))) {
        return false
      }
    }
  }

  return true
}

// ============================================================================
// FORM VALIDATION
// ============================================================================

function validateFormResponse(response: unknown, form: FormDefinition): boolean {
  if (typeof response !== 'object' || response === null) {
    return false
  }

  const data = response as Record<string, unknown>

  for (const field of form.fields) {
    const value = data[field.name]

    if (field.required && value === undefined) {
      return false
    }

    if (value !== undefined) {
      switch (field.type) {
        case 'boolean':
          if (typeof value !== 'boolean') {
            return false
          }
          break
        case 'number':
          if (typeof value !== 'number') {
            return false
          }
          break
        case 'text':
          if (typeof value !== 'string') {
            return false
          }
          break
      }
    }
  }

  return true
}

// ============================================================================
// EXECUTION HELPERS
// ============================================================================

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new ExecutionError('Execution timeout exceeded')), ms)
  })

  try {
    const result = await Promise.race([promise, timeoutPromise])
    clearTimeout(timeoutId!)
    return result
  } catch (error) {
    clearTimeout(timeoutId!)
    throw error
  }
}

async function withRetries<T>(
  fn: () => Promise<T>,
  retries: number,
): Promise<T> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      if (attempt === retries) {
        throw new ExecutionError(`Execution failed after ${retries + 1} attempts: ${lastError.message}`)
      }
    }
  }
  throw lastError
}

// ============================================================================
// FUNCTION INSTANCE IMPLEMENTATION
// ============================================================================

function createFunctionInstance(
  def: AnyFunctionDefinition,
  options: CreateFunctionOptions,
): FunctionInstance {
  const id = options.id || crypto.randomUUID()
  const createdAt = new Date()
  let invocationCount = 0
  const invocationHistory: InvocationRecord[] = []

  let registeredRegistry: FunctionRegistry | undefined = undefined

  const createContext = (input: unknown): FunctionContext => {
    return {
      functionId: id,
      invocationId: crypto.randomUUID(),
      input,
      env: options.env as Record<string, unknown>,
      emit: async (event: string, data: unknown) => {
        options.onEvent?.(event, data as Record<string, unknown>)
      },
      log: (message: string, data?: unknown) => {
        console.log(`[${id}] ${message}`, data)
      },
    }
  }

  const executeCode = async (input: unknown): Promise<unknown> => {
    const codeDef = def as CodeFunctionDefinition
    const ctx = createContext(input)
    return codeDef.handler(input, ctx)
  }

  const executeGenerative = async (input: unknown): Promise<unknown> => {
    const genDef = def as GenerativeFunctionDefinition
    const inputObj = input as Record<string, unknown>

    let promptStr: string
    if (typeof genDef.prompt === 'function') {
      promptStr = genDef.prompt(input)
    } else {
      promptStr = substituteTemplate(genDef.prompt, inputObj)
    }

    if (genDef.stream) {
      return options.env.AI!.stream({
        model: genDef.model,
        prompt: promptStr,
        temperature: genDef.temperature ?? 1,
        maxTokens: genDef.maxTokens,
      })
    }

    const response = await options.env.AI!.generate({
      model: genDef.model,
      prompt: promptStr,
      temperature: genDef.temperature ?? 1,
      maxTokens: genDef.maxTokens,
    })

    if (genDef.schema) {
      try {
        const parsed = JSON.parse(response.text)
        if (!validateAgainstSchema(parsed, genDef.schema)) {
          throw new ExecutionError('AI output does not match schema')
        }
        return parsed
      } catch (error) {
        if (error instanceof ExecutionError) throw error
        throw new ExecutionError('Failed to parse AI output as JSON')
      }
    }

    return response
  }

  const executeAgentic = async (input: unknown): Promise<unknown> => {
    const agentDef = def as AgenticFunctionDefinition

    try {
      const result = await options.env.AGENT_RUNNER!.run({
        agent: agentDef.agent,
        input,
        tools: agentDef.tools || [],
        maxIterations: agentDef.maxIterations ?? 10,
        systemPrompt: agentDef.systemPrompt,
        onStep: agentDef.onStep,
      })
      return result
    } catch (error) {
      throw new ExecutionError(`Agent execution failed: ${(error as Error).message}`)
    }
  }

  const executeHuman = async (input: unknown): Promise<unknown> => {
    const humanDef = def as HumanFunctionDefinition
    const inputObj = input as Record<string, unknown>

    let message: string
    if (typeof humanDef.prompt === 'function') {
      message = humanDef.prompt(input)
    } else if (humanDef.prompt) {
      message = substituteTemplate(humanDef.prompt, inputObj)
    } else {
      message = JSON.stringify(input)
    }

    await options.env.NOTIFICATIONS!.send({
      channel: humanDef.channel,
      message,
    })

    try {
      const response = await options.env.NOTIFICATIONS!.waitForResponse({
        timeout: humanDef.timeout,
      })

      if (humanDef.form && !validateFormResponse(response, humanDef.form)) {
        throw new ExecutionError('Human response does not match form schema')
      }

      return response
    } catch (error) {
      if (humanDef.escalation) {
        await options.env.NOTIFICATIONS!.send({
          channel: humanDef.escalation.to,
          message,
        })
        return options.env.NOTIFICATIONS!.waitForResponse({
          timeout: humanDef.escalation.timeout,
        })
      }
      throw new ExecutionError(`Human task timeout: ${(error as Error).message}`)
    }
  }

  const execute = async (input: unknown): Promise<unknown> => {
    const startTime = Date.now()
    const ctx = createContext(input)

    options.onEvent?.('function.invoked', {
      functionId: id,
      invocationId: ctx.invocationId,
      input,
    })

    const doExecute = async (): Promise<unknown> => {
      switch (def.type) {
        case 'code':
          return executeCode(input)
        case 'generative':
          return executeGenerative(input)
        case 'agentic':
          return executeAgentic(input)
        case 'human':
          return executeHuman(input)
      }
    }

    try {
      let result: unknown
      const retries = def.retries ?? 0

      const wrappedExecute = async () => {
        const exec = doExecute()
        if (def.timeout) {
          return withTimeout(exec, def.timeout)
        }
        return exec
      }

      if (retries > 0) {
        result = await withRetries(wrappedExecute, retries)
      } else {
        result = await wrappedExecute()
      }

      const duration = Date.now() - startTime
      invocationCount++

      invocationHistory.push({
        invocationId: ctx.invocationId,
        functionId: id,
        input,
        output: result,
        status: 'completed',
        startedAt: new Date(startTime),
        completedAt: new Date(),
        duration,
      })

      if (options.state) {
        await options.state.storage.put(`invocation:${ctx.invocationId}`, invocationHistory[invocationHistory.length - 1])
      }

      options.onEvent?.('function.completed', {
        functionId: id,
        invocationId: ctx.invocationId,
        result,
        duration,
      })

      return result
    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage = (error as Error).message

      invocationHistory.push({
        invocationId: ctx.invocationId,
        functionId: id,
        input,
        error: errorMessage,
        status: 'failed',
        startedAt: new Date(startTime),
        completedAt: new Date(),
        duration,
      })

      options.onEvent?.('function.failed', {
        functionId: id,
        invocationId: ctx.invocationId,
        error: errorMessage,
        duration,
      })

      if (error instanceof ExecutionError) {
        throw error
      }
      throw new ExecutionError(errorMessage)
    }
  }

  // Track registry reference (set during auto-register or manual register)
  registeredRegistry = options.registry

  const register = async (registry: FunctionRegistry): Promise<void> => {
    registeredRegistry = registry
    await registry.register(instance)
  }

  const unregister = async (): Promise<void> => {
    if (registeredRegistry) {
      await registeredRegistry.unregister(def.name)
    }
    if (options.state) {
      await options.state.storage.delete(`function:${def.name}`)
    }
  }

  const toJSON = (): Record<string, unknown> => {
    const json: Record<string, unknown> = {
      id,
      name: def.name,
      type: def.type,
      description: def.description,
      createdAt: createdAt.toISOString(),
    }

    if (def.type === 'generative') {
      const genDef = def as GenerativeFunctionDefinition
      json.model = genDef.model
      json.temperature = genDef.temperature
      json.maxTokens = genDef.maxTokens
    }

    return json
  }

  const getMetadata = (): FunctionMetadata => ({
    id,
    name: def.name,
    type: def.type,
    createdAt,
    invocationCount,
  })

  const getInvocationHistory = async (): Promise<InvocationRecord[]> => {
    return invocationHistory
  }

  // Composition methods
  const pipe = (next: FunctionInstance): ComposedFunction => {
    return createComposedFunction([instance, next], options)
  }

  const ifMethod = (predicate: (input: unknown) => boolean): ConditionalFunction => {
    return createConditionalFunction(instance, predicate, options)
  }

  const map = <T, U>(fn: (output: T) => U): FunctionInstance => {
    return createMappedFunction(instance, fn, options)
  }

  const contramap = <T, U>(fn: (input: T) => U): FunctionInstance => {
    return createContramappedFunction(instance, fn, options)
  }

  const catchMethod = (handler: (error: Error) => unknown): FunctionInstance => {
    return createCatchFunction(instance, handler, options)
  }

  const finallyMethod = (cleanup: () => void | Promise<void>): FunctionInstance => {
    return createFinallyFunction(instance, cleanup, options)
  }

  const instance: FunctionInstance = {
    id,
    name: def.name,
    type: def.type,
    description: def.description,
    createdAt,
    timeout: def.timeout,
    retries: def.retries,
    requiredPermission: def.requiredPermission,

    // Type-specific properties
    ...(def.type === 'code' && {
      handler: (def as CodeFunctionDefinition).handler,
      runtime: (def as CodeFunctionDefinition).runtime ?? 'javascript',
      sandboxed: (def as CodeFunctionDefinition).sandboxed,
    }),
    ...(def.type === 'generative' && {
      model: (def as GenerativeFunctionDefinition).model,
      prompt: (def as GenerativeFunctionDefinition).prompt,
      temperature: (def as GenerativeFunctionDefinition).temperature ?? 1,
      maxTokens: (def as GenerativeFunctionDefinition).maxTokens,
      stream: (def as GenerativeFunctionDefinition).stream,
      schema: (def as GenerativeFunctionDefinition).schema,
    }),
    ...(def.type === 'agentic' && {
      agent: (def as AgenticFunctionDefinition).agent,
      tools: (def as AgenticFunctionDefinition).tools,
      maxIterations: (def as AgenticFunctionDefinition).maxIterations ?? 10,
      systemPrompt: (def as AgenticFunctionDefinition).systemPrompt,
      onStep: (def as AgenticFunctionDefinition).onStep,
    }),
    ...(def.type === 'human' && {
      channel: (def as HumanFunctionDefinition).channel,
      timeout: (def as HumanFunctionDefinition).timeout,
      prompt: (def as HumanFunctionDefinition).prompt,
      form: (def as HumanFunctionDefinition).form,
      escalation: (def as HumanFunctionDefinition).escalation,
    }),

    execute,
    register,
    unregister,
    toJSON,
    getMetadata,
    getInvocationHistory,
    pipe,
    if: ifMethod,
    map,
    contramap,
    catch: catchMethod,
    finally: finallyMethod,
  }

  return instance
}

// ============================================================================
// COMPOSED FUNCTION
// ============================================================================

function createComposedFunction(
  functions: FunctionInstance[],
  options: CreateFunctionOptions,
): ComposedFunction {
  const name = functions.map(f => f.name).join(' -> ')
  const id = crypto.randomUUID()
  const createdAt = new Date()
  let invocationCount = 0

  const execute = async (input: unknown): Promise<unknown> => {
    let result = input
    for (const fn of functions) {
      result = await fn.execute(result)
    }
    invocationCount++
    return result
  }

  const describe = () => ({
    type: 'pipeline',
    steps: functions.map(f => ({ name: f.name, type: f.type })),
  })

  const pipe = (next: FunctionInstance): ComposedFunction => {
    return createComposedFunction([...functions, next], options)
  }

  const instance: ComposedFunction = {
    id,
    name,
    type: 'code',
    createdAt,
    execute,
    describe,
    pipe,
    if: (predicate) => createConditionalFunction(instance, predicate, options),
    map: (fn) => createMappedFunction(instance, fn, options),
    contramap: (fn) => createContramappedFunction(instance, fn, options),
    catch: (handler) => createCatchFunction(instance, handler, options),
    finally: (cleanup) => createFinallyFunction(instance, cleanup, options),
    register: async () => {},
    unregister: async () => {},
    toJSON: () => ({ id, name, type: 'composed' }),
    getMetadata: () => ({ id, name, type: 'composed', createdAt, invocationCount }),
    getInvocationHistory: async () => [],
  }

  return instance
}

// ============================================================================
// CONDITIONAL FUNCTION
// ============================================================================

function createConditionalFunction(
  fn: FunctionInstance,
  predicate: (input: unknown) => boolean,
  options: CreateFunctionOptions,
): ConditionalFunction {
  const id = crypto.randomUUID()
  const createdAt = new Date()
  let elseFn: FunctionInstance | undefined

  const execute = async (input: unknown): Promise<unknown> => {
    if (predicate(input)) {
      return fn.execute(input)
    }
    if (elseFn) {
      return elseFn.execute(input)
    }
    return null
  }

  const elseMethod = (alternative: FunctionInstance): FunctionInstance => {
    elseFn = alternative
    return instance
  }

  const instance: ConditionalFunction = {
    id,
    name: `${fn.name} (conditional)`,
    type: fn.type,
    createdAt,
    execute,
    else: elseMethod,
    pipe: (next) => createComposedFunction([instance, next], options),
    if: (pred) => createConditionalFunction(instance, pred, options),
    map: (mapper) => createMappedFunction(instance, mapper, options),
    contramap: (mapper) => createContramappedFunction(instance, mapper, options),
    catch: (handler) => createCatchFunction(instance, handler, options),
    finally: (cleanup) => createFinallyFunction(instance, cleanup, options),
    register: async () => {},
    unregister: async () => {},
    toJSON: () => ({ id, name: instance.name, type: 'conditional' }),
    getMetadata: () => ({ id, name: instance.name, type: 'conditional', createdAt, invocationCount: 0 }),
    getInvocationHistory: async () => [],
  }

  return instance
}

// ============================================================================
// MAPPED FUNCTION
// ============================================================================

function createMappedFunction<T, U>(
  fn: FunctionInstance,
  mapper: (output: T) => U,
  options: CreateFunctionOptions,
): FunctionInstance {
  const id = crypto.randomUUID()
  const createdAt = new Date()

  const execute = async (input: unknown): Promise<U> => {
    const result = await fn.execute(input)
    return mapper(result as T)
  }

  const instance: FunctionInstance = {
    id,
    name: `${fn.name} (mapped)`,
    type: fn.type,
    createdAt,
    execute,
    pipe: (next) => createComposedFunction([instance, next], options),
    if: (pred) => createConditionalFunction(instance, pred, options),
    map: (m) => createMappedFunction(instance, m, options),
    contramap: (m) => createContramappedFunction(instance, m, options),
    catch: (handler) => createCatchFunction(instance, handler, options),
    finally: (cleanup) => createFinallyFunction(instance, cleanup, options),
    register: async () => {},
    unregister: async () => {},
    toJSON: () => ({ id, name: instance.name, type: 'mapped' }),
    getMetadata: () => ({ id, name: instance.name, type: 'mapped', createdAt, invocationCount: 0 }),
    getInvocationHistory: async () => [],
  }

  return instance
}

// ============================================================================
// CONTRAMAPPED FUNCTION
// ============================================================================

function createContramappedFunction<T, U>(
  fn: FunctionInstance,
  mapper: (input: T) => U,
  options: CreateFunctionOptions,
): FunctionInstance {
  const id = crypto.randomUUID()
  const createdAt = new Date()

  const execute = async (input: unknown): Promise<unknown> => {
    const mappedInput = mapper(input as T)
    return fn.execute(mappedInput)
  }

  const instance: FunctionInstance = {
    id,
    name: `${fn.name} (contramapped)`,
    type: fn.type,
    createdAt,
    execute,
    pipe: (next) => createComposedFunction([instance, next], options),
    if: (pred) => createConditionalFunction(instance, pred, options),
    map: (m) => createMappedFunction(instance, m, options),
    contramap: (m) => createContramappedFunction(instance, m, options),
    catch: (handler) => createCatchFunction(instance, handler, options),
    finally: (cleanup) => createFinallyFunction(instance, cleanup, options),
    register: async () => {},
    unregister: async () => {},
    toJSON: () => ({ id, name: instance.name, type: 'contramapped' }),
    getMetadata: () => ({ id, name: instance.name, type: 'contramapped', createdAt, invocationCount: 0 }),
    getInvocationHistory: async () => [],
  }

  return instance
}

// ============================================================================
// CATCH FUNCTION
// ============================================================================

function createCatchFunction(
  fn: FunctionInstance,
  handler: (error: Error) => unknown,
  options: CreateFunctionOptions,
): FunctionInstance {
  const id = crypto.randomUUID()
  const createdAt = new Date()

  const execute = async (input: unknown): Promise<unknown> => {
    try {
      return await fn.execute(input)
    } catch (error) {
      return handler(error as Error)
    }
  }

  const instance: FunctionInstance = {
    id,
    name: `${fn.name} (with catch)`,
    type: fn.type,
    createdAt,
    execute,
    pipe: (next) => createComposedFunction([instance, next], options),
    if: (pred) => createConditionalFunction(instance, pred, options),
    map: (m) => createMappedFunction(instance, m, options),
    contramap: (m) => createContramappedFunction(instance, m, options),
    catch: (h) => createCatchFunction(instance, h, options),
    finally: (cleanup) => createFinallyFunction(instance, cleanup, options),
    register: async () => {},
    unregister: async () => {},
    toJSON: () => ({ id, name: instance.name, type: 'catch' }),
    getMetadata: () => ({ id, name: instance.name, type: 'catch', createdAt, invocationCount: 0 }),
    getInvocationHistory: async () => [],
  }

  return instance
}

// ============================================================================
// FINALLY FUNCTION
// ============================================================================

function createFinallyFunction(
  fn: FunctionInstance,
  cleanup: () => void | Promise<void>,
  options: CreateFunctionOptions,
): FunctionInstance {
  const id = crypto.randomUUID()
  const createdAt = new Date()

  const execute = async (input: unknown): Promise<unknown> => {
    try {
      return await fn.execute(input)
    } finally {
      await cleanup()
    }
  }

  const instance: FunctionInstance = {
    id,
    name: `${fn.name} (with finally)`,
    type: fn.type,
    createdAt,
    execute,
    pipe: (next) => createComposedFunction([instance, next], options),
    if: (pred) => createConditionalFunction(instance, pred, options),
    map: (m) => createMappedFunction(instance, m, options),
    contramap: (m) => createContramappedFunction(instance, m, options),
    catch: (h) => createCatchFunction(instance, h, options),
    finally: (c) => createFinallyFunction(instance, c, options),
    register: async () => {},
    unregister: async () => {},
    toJSON: () => ({ id, name: instance.name, type: 'finally' }),
    getMetadata: () => ({ id, name: instance.name, type: 'finally', createdAt, invocationCount: 0 }),
    getInvocationHistory: async () => [],
  }

  return instance
}

// ============================================================================
// PARALLEL FUNCTIONS
// ============================================================================

function createParallelFunction(
  functions: FunctionInstance[],
  mode: 'all' | 'allSettled',
): FunctionInstance {
  const id = crypto.randomUUID()
  const createdAt = new Date()
  const name = `parallel(${functions.map(f => f.name).join(', ')})`

  const execute = async (input: unknown): Promise<unknown> => {
    const promises = functions.map(fn => fn.execute(input))

    if (mode === 'all') {
      return Promise.all(promises)
    } else {
      const results = await Promise.allSettled(promises)
      return results.map(r =>
        r.status === 'fulfilled'
          ? { status: 'fulfilled', value: r.value }
          : { status: 'rejected', reason: r.reason }
      )
    }
  }

  const instance: FunctionInstance = {
    id,
    name,
    type: 'code',
    createdAt,
    execute,
    pipe: (next) => createComposedFunction([instance, next], {} as CreateFunctionOptions),
    if: (pred) => createConditionalFunction(instance, pred, {} as CreateFunctionOptions),
    map: (m) => createMappedFunction(instance, m, {} as CreateFunctionOptions),
    contramap: (m) => createContramappedFunction(instance, m, {} as CreateFunctionOptions),
    catch: (h) => createCatchFunction(instance, h, {} as CreateFunctionOptions),
    finally: (c) => createFinallyFunction(instance, c, {} as CreateFunctionOptions),
    register: async () => {},
    unregister: async () => {},
    toJSON: () => ({ id, name, type: 'parallel' }),
    getMetadata: () => ({ id, name, type: 'parallel', createdAt, invocationCount: 0 }),
    getInvocationHistory: async () => [],
  }

  return instance
}

// ============================================================================
// MAIN FACTORY FUNCTION
// ============================================================================

// We use a non-async wrapper function to avoid TypeScript's thenable detection issue
// FunctionInstance has a 'then' method for composition which conflicts with Promise.then
function createFunctionImpl(
  def: AnyFunctionDefinition,
  options: CreateFunctionOptions,
): Promise<FunctionInstance> {
  // Wrap everything to ensure validation errors become Promise rejections
  try {
    // Validate definition (sync)
    validate(def)
  } catch (e) {
    return Promise.reject(e)
  }

  // Create instance (sync)
  const instance = createFunctionInstance(def, options)

  // Register with DO if provided (sync)
  if (options.durableObject) {
    options.durableObject.registerFunction(instance)
  }

  // Build the promise chain for async operations
  let promise: Promise<void> = Promise.resolve()

  // Check for duplicate names if registry provided
  if (options.registry && options.autoRegister !== false) {
    promise = promise.then(async () => {
      const existing = await options.registry!.has(def.name)
      if (existing && !options.replace) {
        throw new RegistrationError(`Function '${def.name}' already exists`)
      }
    })
  }

  // Store in state if provided
  if (options.state) {
    promise = promise.then(() =>
      options.state!.storage.put(`function:${def.name}`, {
        name: def.name,
        type: def.type,
        description: def.description,
        id: instance.id,
        createdAt: instance.createdAt.toISOString(),
      })
    )
  }

  // Auto-register with registry
  if (options.registry && options.autoRegister !== false) {
    promise = promise.then(async () => {
      if (options.replace) {
        await options.registry!.unregister(def.name)
        options.onEvent?.('function.replaced', { name: def.name, id: instance.id })
      }
      await options.registry!.register(instance)
      options.onEvent?.('function.registered', { name: def.name, type: def.type, id: instance.id })
    })
  }

  // We need to explicitly resolve with the instance to avoid the thenable issue
  // where JavaScript would try to call instance.then() since it exists
  return new Promise<FunctionInstance>((resolve, reject) => {
    promise.then(() => resolve(instance)).catch(reject)
  })
}

// Create the main export with static methods
interface CreateFunctionStatic {
  (def: AnyFunctionDefinition, options: CreateFunctionOptions): Promise<FunctionInstance>
  all: (functions: FunctionInstance[]) => FunctionInstance
  allSettled: (functions: FunctionInstance[]) => FunctionInstance
  fromStorage: (name: string, options: CreateFunctionOptions) => Promise<FunctionInstance>
}

// Note: Using type assertion to avoid the thenable conflict with Promise<FunctionInstance>
// The FunctionInstance type has a 'then' method for composition which conflicts with Promise.then
export const createFunction: CreateFunctionStatic = Object.assign(
  (def: AnyFunctionDefinition, options: CreateFunctionOptions) => createFunctionImpl(def, options),
  {
    all: (functions: FunctionInstance[]): FunctionInstance => {
      return createParallelFunction(functions, 'all')
    },
    allSettled: (functions: FunctionInstance[]): FunctionInstance => {
      return createParallelFunction(functions, 'allSettled')
    },
    fromStorage: (
      name: string,
      options: CreateFunctionOptions,
    ): Promise<FunctionInstance> => {
      if (!options.state) {
        return Promise.reject(new Error('State is required to restore from storage'))
      }

      return new Promise<FunctionInstance>((resolve, reject) => {
        options.state!.storage.get(`function:${name}`).then((stored) => {
          const storedData = stored as {
            name: string
            type: 'code' | 'generative' | 'agentic' | 'human'
            description?: string
            id: string
            createdAt: string
          } | undefined

          if (!storedData) {
            reject(new Error(`Function '${name}' not found in storage`))
            return
          }

          // Create a minimal placeholder instance for restoration
          // In real implementation, would need to store and restore full definition
          const id = storedData.id
          const createdAt = new Date(storedData.createdAt)

          const instance: FunctionInstance = {
            id,
            name: storedData.name,
            type: storedData.type,
            description: storedData.description,
            createdAt,
            execute: () => Promise.reject(
              new Error('Function restored from storage cannot be executed without handler')
            ),
            register: (registry: FunctionRegistry) => registry.register(instance),
            unregister: () => Promise.resolve(),
            toJSON: () => ({ id, name: storedData.name, type: storedData.type }),
            getMetadata: () => ({ id, name: storedData.name, type: storedData.type, createdAt, invocationCount: 0 }),
            getInvocationHistory: () => Promise.resolve([]),
            pipe: () => instance as ComposedFunction,
            if: () => instance as ConditionalFunction,
            map: () => instance,
            contramap: () => instance,
            catch: () => instance,
            finally: () => instance,
          }

          resolve(instance)
        }).catch(reject)
      })
    },
  }
)

export default createFunction
