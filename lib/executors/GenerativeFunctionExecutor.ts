/**
 * GenerativeFunctionExecutor
 *
 * Executor for GenerativeFunction - calls LLM models (Claude, GPT, etc.)
 * with prompt templates, structured output schemas, streaming support,
 * and model configuration options.
 */

// ============================================================================
// ERROR TYPES
// ============================================================================

export class GenerativeModelError extends Error {
  name = 'GenerativeModelError'
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

export class GenerativeValidationError extends Error {
  name = 'GenerativeValidationError'
  code?: string

  constructor(message: string) {
    super(message)
  }
}

export class GenerativeRateLimitError extends Error {
  name = 'GenerativeRateLimitError'
  code = 'rate_limit_exceeded'
  retryAfter?: number

  constructor(message: string, retryAfter?: number) {
    super(message)
    this.retryAfter = retryAfter
  }
}

export class GenerativeTimeoutError extends Error {
  name = 'GenerativeTimeoutError'

  constructor(message: string = 'Generation timed out') {
    super(message)
  }
}

export class GenerativeAbortError extends Error {
  name = 'GenerativeAbortError'

  constructor(message: string = 'Generation was aborted') {
    super(message)
  }
}

export class GenerativeSchemaError extends Error {
  name = 'GenerativeSchemaError'
  validationErrors?: string[]

  constructor(message: string, validationErrors?: string[]) {
    super(message)
    this.validationErrors = validationErrors
  }
}

export class GenerativeToolError extends Error {
  name = 'GenerativeToolError'
  toolName?: string

  constructor(message: string, toolName?: string) {
    super(message)
    this.toolName = toolName
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
}

export interface ModelConfig {
  model: string
  temperature?: number
  maxTokens?: number
  topP?: number
  topK?: number
  stopSequences?: string[]
  presencePenalty?: number
  frequencyPenalty?: number
}

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string | MessageContent[]
}

export interface MessageContent {
  type: 'text' | 'image'
  text?: string
  source?: ImageSource
}

export interface ImageSource {
  type: 'base64' | 'url'
  mediaType?: string
  data?: string
  url?: string
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute?: (input: unknown) => Promise<unknown>
}

export interface ToolCall {
  id: string
  name: string
  input: unknown
}

export interface StreamChunk {
  type: 'text' | 'done' | 'error'
  text?: string
  usage?: TokenUsage
  finishReason?: 'stop' | 'length' | 'tool_use' | 'content_filter'
  error?: Error
}

export interface GenerativeOptions {
  model: string
  prompt?: string | ((input: unknown) => string | Promise<string>)
  messages?: Message[]
  systemPrompt?: string
  variables?: Record<string, unknown>
  input?: Record<string, unknown>
  schema?: JSONSchema
  coerceTypes?: boolean
  lenientParsing?: boolean
  schemaRetries?: number
  temperature?: number
  maxTokens?: number
  topP?: number
  topK?: number
  stopSequences?: string[]
  presencePenalty?: number
  frequencyPenalty?: number
  tools?: ToolDefinition[]
  parallelToolCalls?: boolean
  maxToolIterations?: number
  timeout?: number
  maxRetries?: number
  retryDelay?: number
  retryBackoff?: 'linear' | 'exponential'
  retryOnRateLimit?: boolean
  retryOnTimeout?: boolean
  conversationId?: string
  loadHistory?: boolean
  saveHistory?: boolean
}

export interface JSONSchema {
  type: string
  properties?: Record<string, JSONSchema>
  items?: JSONSchema
  required?: string[]
  enum?: unknown[]
  additionalProperties?: boolean | JSONSchema
}

export interface GenerativeExecutionResult<T = unknown> {
  success: boolean
  result?: T
  error?: GenerativeModelError | GenerativeValidationError | GenerativeSchemaError | GenerativeToolError | GenerativeRateLimitError | GenerativeTimeoutError
  usage: TokenUsage
  duration: number
  model: string
  finishReason?: 'stop' | 'length' | 'tool_use' | 'content_filter'
}

export interface GenerativeExecutionContext {
  state: DurableObjectState
  env: Record<string, unknown>
  aiService: AIService
  onEvent?: EventHandler
}

export interface AIService {
  generate: (options: GenerateOptions) => Promise<GenerateResult>
  stream: (options: GenerateOptions) => AsyncGenerator<StreamChunk>
  generateWithTools: (options: GenerateOptions) => Promise<GenerateWithToolsResult>
}

export interface GenerateOptions {
  model: string
  prompt?: string
  messages?: Message[]
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  topK?: number
  stopSequences?: string[]
  presencePenalty?: number
  frequencyPenalty?: number
  tools?: ToolDefinition[]
}

export interface GenerateResult {
  text: string
  usage: { inputTokens: number; outputTokens: number }
  finishReason: 'stop' | 'length' | 'tool_use' | 'content_filter'
  contentFiltered?: boolean
}

export interface GenerateWithToolsResult extends GenerateResult {
  toolCalls: ToolCall[]
}

export type EventHandler = (event: string, data: unknown) => void

export interface StreamResult extends AsyncIterable<StreamChunk> {
  toText(): Promise<string>
  toJSON<T = unknown>(): Promise<T>
  cancel(): void
  [Symbol.asyncIterator](): AsyncIterator<StreamChunk>
}

// Model limits for validation
const MODEL_LIMITS: Record<string, { maxTokens: number }> = {
  'claude-sonnet-4-20250514': { maxTokens: 8192 },
  'claude-opus-4-20250514': { maxTokens: 8192 },
  'gpt-4o': { maxTokens: 128000 },
  'gpt-3.5-turbo': { maxTokens: 4096 },
}

const DEFAULT_MAX_TOKENS = 100000

// Non-retryable error codes
const NON_RETRYABLE_ERRORS = new Set([
  'authentication_error',
  'invalid_api_key',
  'permission_denied',
  'invalid_request',
])

// ============================================================================
// GENERATIVE FUNCTION EXECUTOR
// ============================================================================

export class GenerativeFunctionExecutor {
  private state: DurableObjectState
  private env: Record<string, unknown>
  private aiService: AIService
  private onEvent?: EventHandler

  constructor(context: GenerativeExecutionContext) {
    this.state = context.state
    this.env = context.env
    this.aiService = context.aiService
    this.onEvent = context.onEvent
  }

  /**
   * Execute a generative function
   */
  async execute<T = string>(options: GenerativeOptions): Promise<GenerativeExecutionResult<T>> {
    const startTime = Date.now()
    const invocationId = crypto.randomUUID()

    this.emit('generation.started', { invocationId })

    try {
      // Validate options
      const validationError = this.validateOptions(options)
      if (validationError) {
        return this.createErrorResult(validationError, options.model, startTime)
      }

      // Resolve prompt
      let prompt: string
      try {
        prompt = await this.resolvePrompt(options)
      } catch (err) {
        const error = err as Error
        return this.createErrorResult(
          new GenerativeValidationError(error.message),
          options.model,
          startTime
        )
      }

      // Validate prompt is not empty
      if (!prompt && !options.messages?.length) {
        return this.createErrorResult(
          new GenerativeValidationError('prompt is empty or required'),
          options.model,
          startTime
        )
      }

      // Resolve system prompt template
      const systemPrompt = options.systemPrompt
        ? this.substituteVariables(options.systemPrompt, options.variables || {})
        : undefined

      // Load conversation history if requested
      let messages = options.messages
      if (options.conversationId && options.loadHistory) {
        const history = await this.loadConversationHistory(options.conversationId)
        if (history) {
          messages = [...history, ...(messages || [])]
          if (prompt) {
            messages.push({ role: 'user', content: prompt })
          }
        }
      }

      // Build messages if using prompt
      if (!messages && prompt) {
        messages = [{ role: 'user', content: prompt }]
      }

      // Validate messages
      if (messages) {
        const messageValidationError = this.validateMessages(messages)
        if (messageValidationError) {
          return this.createErrorResult(messageValidationError, options.model, startTime)
        }
      }

      // Check for tools
      if (options.tools?.length) {
        return this.executeWithTools(options, messages!, systemPrompt, startTime, invocationId)
      }

      // Execute with retries
      const result = await this.executeWithRetries(
        async () => this.aiService.generate({
          model: options.model,
          prompt,
          messages,
          systemPrompt,
          temperature: options.temperature ?? 1.0,
          maxTokens: options.maxTokens,
          topP: options.topP,
          topK: options.topK,
          stopSequences: options.stopSequences,
          presencePenalty: options.presencePenalty,
          frequencyPenalty: options.frequencyPenalty,
        }),
        options
      )

      // Handle content filter
      if (result.finishReason === 'content_filter') {
        this.emit('generation.content_filtered', { invocationId })
      }

      // Track token usage
      const usage: TokenUsage = {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.inputTokens + result.usage.outputTokens,
      }

      this.emit('generation.tokens', usage)

      // Handle schema validation if provided
      let finalResult: T
      if (options.schema) {
        try {
          finalResult = await this.validateAndParseSchema(
            result.text,
            options.schema,
            options.coerceTypes ?? false,
            options.lenientParsing ?? false,
            options.schemaRetries ?? 1,
            options,
            messages!,
            systemPrompt
          ) as T
        } catch (err) {
          const error = err as Error
          return this.createErrorResult(
            error instanceof GenerativeSchemaError ? error : new GenerativeSchemaError(error.message),
            options.model,
            startTime,
            usage,
            result.finishReason
          )
        }
      } else {
        finalResult = result.text as T
      }

      // Save conversation history if requested
      if (options.conversationId && options.saveHistory) {
        await this.saveConversationHistory(options.conversationId, [
          ...(messages || []),
          { role: 'assistant', content: result.text },
        ])
      }

      this.emit('generation.completed', {
        invocationId,
        conversationId: options.conversationId,
      })

      return {
        success: true,
        result: finalResult,
        usage,
        duration: Date.now() - startTime,
        model: options.model,
        finishReason: result.finishReason,
      }

    } catch (err) {
      const error = err as Error
      return this.handleError(error, options.model, startTime)
    }
  }

  /**
   * Execute with streaming
   */
  async executeStreaming(
    options: GenerativeOptions,
    streamOptions?: { signal?: AbortSignal }
  ): Promise<StreamResult> {
    const invocationId = crypto.randomUUID()
    this.emit('generation.stream.start', { invocationId })

    // Validate options
    const validationError = this.validateOptions(options)
    if (validationError) {
      throw validationError
    }

    // Resolve prompt
    const prompt = await this.resolvePrompt(options)
    const systemPrompt = options.systemPrompt
      ? this.substituteVariables(options.systemPrompt, options.variables || {})
      : undefined

    const messages = options.messages || (prompt ? [{ role: 'user' as const, content: prompt }] : undefined)

    const generator = this.aiService.stream({
      model: options.model,
      prompt,
      messages,
      systemPrompt,
      temperature: options.temperature ?? 1.0,
      maxTokens: options.maxTokens,
      topP: options.topP,
      topK: options.topK,
      stopSequences: options.stopSequences,
      presencePenalty: options.presencePenalty,
      frequencyPenalty: options.frequencyPenalty,
    })

    let cancelled = false
    let collectedText = ''
    let finalUsage: TokenUsage | undefined
    const self = this

    const asyncIterator = async function* (): AsyncGenerator<StreamChunk> {
      try {
        for await (const chunk of generator) {
          if (cancelled) {
            self.emit('generation.stream.aborted', { invocationId })
            throw new GenerativeAbortError()
          }

          if (streamOptions?.signal?.aborted) {
            self.emit('generation.stream.aborted', { invocationId })
            throw new GenerativeAbortError()
          }

          if (chunk.type === 'text') {
            collectedText += chunk.text
            self.emit('generation.stream.chunk', { text: chunk.text })
          }

          if (chunk.type === 'done') {
            finalUsage = chunk.usage
            self.emit('generation.stream.end', { invocationId, usage: finalUsage })
          }

          yield chunk
        }
      } catch (err) {
        if (err instanceof GenerativeAbortError) {
          throw err
        }
        throw err
      }
    }

    const iterator = asyncIterator()

    return {
      [Symbol.asyncIterator]() {
        return iterator
      },
      async toText(): Promise<string> {
        for await (const chunk of iterator) {
          if (chunk.type === 'text') {
            // Already collected in the iterator
          }
        }
        return collectedText
      },
      async toJSON<T>(): Promise<T> {
        let text = ''
        for await (const chunk of asyncIterator()) {
          if (chunk.type === 'text') {
            text += chunk.text
          }
        }

        if (options.schema) {
          try {
            const parsed = self.extractJSON(text, options.lenientParsing ?? false)
            self.validateSchema(parsed, options.schema, options.coerceTypes ?? false)
            return parsed as T
          } catch (err) {
            const error = err as Error
            throw new GenerativeSchemaError(error.message)
          }
        }

        return JSON.parse(text) as T
      },
      cancel() {
        cancelled = true
      },
    }
  }

  /**
   * Execute with tools
   */
  private async executeWithTools<T>(
    options: GenerativeOptions,
    messages: Message[],
    systemPrompt: string | undefined,
    startTime: number,
    invocationId: string
  ): Promise<GenerativeExecutionResult<T>> {
    // Validate tools
    const toolValidationError = this.validateTools(options.tools!)
    if (toolValidationError) {
      return this.createErrorResult(toolValidationError, options.model, startTime)
    }

    const maxIterations = options.maxToolIterations ?? 10
    let iterations = 0
    let currentMessages = [...messages]
    let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

    while (iterations < maxIterations) {
      iterations++

      const result = await this.aiService.generateWithTools({
        model: options.model,
        messages: currentMessages,
        systemPrompt,
        temperature: options.temperature ?? 1.0,
        maxTokens: options.maxTokens,
        topP: options.topP,
        topK: options.topK,
        stopSequences: options.stopSequences,
        presencePenalty: options.presencePenalty,
        frequencyPenalty: options.frequencyPenalty,
        tools: options.tools,
      })

      totalUsage.inputTokens += result.usage.inputTokens
      totalUsage.outputTokens += result.usage.outputTokens
      totalUsage.totalTokens = totalUsage.inputTokens + totalUsage.outputTokens

      // No tool calls - we're done
      if (!result.toolCalls?.length || result.finishReason !== 'tool_use') {
        this.emit('generation.tokens', totalUsage)
        this.emit('generation.completed', { invocationId, conversationId: options.conversationId })

        return {
          success: true,
          result: result.text as T,
          usage: totalUsage,
          duration: Date.now() - startTime,
          model: options.model,
          finishReason: result.finishReason,
        }
      }

      // Execute tool calls
      const toolResults = await this.executeToolCalls(
        result.toolCalls,
        options.tools!,
        options.parallelToolCalls ?? false
      )

      // Add assistant message with tool calls and tool results to conversation
      currentMessages.push({
        role: 'assistant',
        content: result.text || `[Tool calls: ${result.toolCalls.map(tc => tc.name).join(', ')}]`,
      })

      // Add tool results as user message
      for (const toolResult of toolResults) {
        currentMessages.push({
          role: 'user',
          content: `Tool result for ${toolResult.name}: ${JSON.stringify(toolResult.result)}`,
        })
      }
    }

    // Max iterations reached
    this.emit('generation.tokens', totalUsage)
    return this.createErrorResult(
      new GenerativeToolError(`Max tool iterations (${maxIterations}) reached`),
      options.model,
      startTime,
      totalUsage
    )
  }

  /**
   * Execute tool calls
   */
  private async executeToolCalls(
    toolCalls: ToolCall[],
    toolDefinitions: ToolDefinition[],
    parallel: boolean
  ): Promise<Array<{ name: string; result: unknown; error?: string }>> {
    const toolMap = new Map(toolDefinitions.map(t => [t.name, t]))

    if (parallel) {
      return Promise.all(
        toolCalls.map(async (call) => {
          const tool = toolMap.get(call.name)
          if (!tool?.execute) {
            return { name: call.name, result: null, error: `Tool ${call.name} not found or has no executor` }
          }

          this.emit('generation.tool.called', { toolName: call.name, input: call.input })

          try {
            const result = await tool.execute(call.input)
            this.emit('generation.tool.completed', { toolName: call.name, result })
            return { name: call.name, result }
          } catch (err) {
            const error = err as Error
            this.emit('generation.tool.error', { toolName: call.name, error: error.message })
            return { name: call.name, result: null, error: error.message }
          }
        })
      )
    }

    const results: Array<{ name: string; result: unknown; error?: string }> = []
    for (const call of toolCalls) {
      const tool = toolMap.get(call.name)
      if (!tool?.execute) {
        results.push({ name: call.name, result: null, error: `Tool ${call.name} not found or has no executor` })
        continue
      }

      this.emit('generation.tool.called', { toolName: call.name, input: call.input })

      try {
        const result = await tool.execute(call.input)
        this.emit('generation.tool.completed', { toolName: call.name, result })
        results.push({ name: call.name, result })
      } catch (err) {
        const error = err as Error
        this.emit('generation.tool.error', { toolName: call.name, error: error.message })
        results.push({ name: call.name, result: null, error: error.message })
      }
    }

    return results
  }

  /**
   * Execute with retries
   */
  private async executeWithRetries<R>(
    fn: () => Promise<R>,
    options: GenerativeOptions
  ): Promise<R> {
    // If retryOnRateLimit or retryOnTimeout is set but maxRetries is not specified,
    // default to a reasonable number of retries
    const defaultRetries = (options.retryOnRateLimit || options.retryOnTimeout) ? 3 : 1
    const maxRetries = options.maxRetries ?? defaultRetries
    const retryDelay = options.retryDelay ?? 1000
    const retryBackoff = options.retryBackoff ?? 'exponential'

    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Wrap with timeout if specified
        if (options.timeout) {
          return await this.withTimeout(fn(), options.timeout)
        }
        return await fn()
      } catch (err) {
        const error = err as Error & { code?: string; retryAfter?: number }
        lastError = error

        // Check if error is retryable
        if (error.code && NON_RETRYABLE_ERRORS.has(error.code)) {
          throw error
        }

        // Handle rate limit
        if (error.code === 'rate_limit_exceeded') {
          if (!options.retryOnRateLimit) {
            throw new GenerativeRateLimitError(error.message, error.retryAfter)
          }

          if (attempt < maxRetries - 1) {
            const waitTime = error.retryAfter ? error.retryAfter * 1000 : this.calculateDelay(attempt, retryDelay, retryBackoff)
            this.emit('generation.retry', { attempt: attempt + 1, error: error.message })
            await this.sleep(waitTime)
            continue
          }
          throw new GenerativeRateLimitError(error.message, error.retryAfter)
        }

        // Handle timeout
        if (error instanceof GenerativeTimeoutError) {
          if (!options.retryOnTimeout) {
            throw error
          }

          if (attempt < maxRetries - 1) {
            this.emit('generation.retry', { attempt: attempt + 1, error: error.message })
            await this.sleep(this.calculateDelay(attempt, retryDelay, retryBackoff))
            continue
          }
          throw error
        }

        // Retry on transient errors
        if (attempt < maxRetries - 1) {
          this.emit('generation.retry', { attempt: attempt + 1, error: error.message })
          await this.sleep(this.calculateDelay(attempt, retryDelay, retryBackoff))
          continue
        }

        throw error
      }
    }

    throw lastError || new Error('Max retries exceeded')
  }

  /**
   * Execute with timeout
   */
  private async withTimeout<R>(promise: Promise<R>, timeout: number): Promise<R> {
    let timeoutId: ReturnType<typeof setTimeout>

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        this.emit('generation.timeout', {})
        reject(new GenerativeTimeoutError())
      }, timeout)
    })

    try {
      return await Promise.race([promise, timeoutPromise])
    } finally {
      clearTimeout(timeoutId!)
    }
  }

  /**
   * Calculate retry delay
   */
  private calculateDelay(attempt: number, baseDelay: number, backoff: 'linear' | 'exponential'): number {
    if (backoff === 'exponential') {
      return baseDelay * Math.pow(2, attempt)
    }
    return baseDelay * (attempt + 1)
  }

  /**
   * Sleep for specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Resolve prompt from options
   */
  private async resolvePrompt(options: GenerativeOptions): Promise<string> {
    if (!options.prompt) {
      return ''
    }

    // Handle function prompts
    if (typeof options.prompt === 'function') {
      const result = options.prompt(options.input || {})
      return result instanceof Promise ? await result : result
    }

    // Handle template prompts
    return this.substituteVariables(options.prompt, options.variables || {})
  }

  /**
   * Substitute variables in template
   */
  private substituteVariables(template: string, variables: Record<string, unknown>): string {
    // Handle escaped braces
    let result = template.replace(/\\{{/g, '\x00ESCAPED_OPEN\x00')

    // Replace variables
    result = result.replace(/{{([^}]+)}}/g, (match, path) => {
      const value = this.getNestedValue(variables, path.trim())
      if (value === undefined || value === null) {
        return ''
      }
      if (Array.isArray(value)) {
        return value.join(',')
      }
      return String(value)
    })

    // Restore escaped braces
    return result.replace(/\x00ESCAPED_OPEN\x00/g, '{{')
  }

  /**
   * Get nested value from object using dot notation or array indexing
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split(/\.|\[|\]/).filter(Boolean)
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
   * Validate options
   */
  private validateOptions(options: GenerativeOptions): GenerativeValidationError | null {
    if (!options.model) {
      return new GenerativeValidationError('model is required')
    }

    if (!options.prompt && !options.messages?.length) {
      return new GenerativeValidationError('Either prompt or messages is required')
    }

    // Validate temperature
    if (options.temperature !== undefined) {
      if (options.temperature < 0) {
        return new GenerativeValidationError('temperature must be >= 0')
      }
      if (options.temperature > 2) {
        return new GenerativeValidationError('temperature must be <= 2')
      }
    }

    // Validate maxTokens
    if (options.maxTokens !== undefined) {
      if (options.maxTokens <= 0) {
        return new GenerativeValidationError('maxTokens must be > 0')
      }

      // Warn if exceeding model limits
      const modelLimit = MODEL_LIMITS[options.model]?.maxTokens ?? DEFAULT_MAX_TOKENS
      if (options.maxTokens > modelLimit) {
        this.emit('generation.warning', {
          message: `maxTokens (${options.maxTokens}) exceeds model limit (${modelLimit})`,
        })
      }
    }

    // Validate topP
    if (options.topP !== undefined) {
      if (options.topP < 0 || options.topP > 1) {
        return new GenerativeValidationError('topP must be between 0 and 1')
      }
    }

    // Validate topK
    if (options.topK !== undefined && options.topK < 0) {
      return new GenerativeValidationError('topK must be >= 0')
    }

    // Validate penalties
    if (options.presencePenalty !== undefined) {
      if (options.presencePenalty < -2 || options.presencePenalty > 2) {
        return new GenerativeValidationError('presencePenalty must be between -2 and 2')
      }
    }

    if (options.frequencyPenalty !== undefined) {
      if (options.frequencyPenalty < -2 || options.frequencyPenalty > 2) {
        return new GenerativeValidationError('frequencyPenalty must be between -2 and 2')
      }
    }

    // Validate schema
    if (options.schema) {
      const validTypes = ['object', 'array', 'string', 'number', 'boolean', 'null', 'integer']
      if (!validTypes.includes(options.schema.type)) {
        return new GenerativeValidationError(`Invalid schema type: ${options.schema.type}`)
      }
    }

    return null
  }

  /**
   * Validate messages
   */
  private validateMessages(messages: Message[]): GenerativeValidationError | null {
    const validRoles = ['user', 'assistant', 'system']

    for (const message of messages) {
      if (!validRoles.includes(message.role)) {
        return new GenerativeValidationError(`Invalid message role: ${message.role}`)
      }

      const content = Array.isArray(message.content)
        ? message.content.map(c => c.type === 'text' ? c.text : '').join('')
        : message.content

      if (!content || content.trim() === '') {
        return new GenerativeValidationError('Message content cannot be empty')
      }
    }

    return null
  }

  /**
   * Validate tools
   */
  private validateTools(tools: ToolDefinition[]): GenerativeValidationError | null {
    for (const tool of tools) {
      if (!tool.name || tool.name.trim() === '') {
        return new GenerativeValidationError('Tool name is required and cannot be empty')
      }

      if (!tool.inputSchema) {
        return new GenerativeValidationError(`Tool ${tool.name} requires inputSchema`)
      }
    }

    return null
  }

  /**
   * Validate and parse schema with retries
   */
  private async validateAndParseSchema(
    text: string,
    schema: JSONSchema,
    coerceTypes: boolean,
    lenientParsing: boolean,
    maxRetries: number,
    options: GenerativeOptions,
    messages: Message[],
    systemPrompt?: string
  ): Promise<unknown> {
    let lastError: Error | null = null
    let currentText = text

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Extract and parse JSON
        const parsed = this.extractJSON(currentText, lenientParsing)

        // Validate against schema
        const validated = this.validateSchema(parsed, schema, coerceTypes)

        return validated
      } catch (err) {
        const error = err as Error
        lastError = error

        if (attempt < maxRetries - 1) {
          // Retry with validation feedback
          const feedbackPrompt = `Your previous response failed schema validation: ${error.message}. Please generate valid JSON matching the schema with required fields.`

          const retryMessages: Message[] = [
            ...messages,
            { role: 'assistant', content: currentText },
            { role: 'user', content: feedbackPrompt },
          ]

          const retryResult = await this.aiService.generate({
            model: options.model,
            prompt: feedbackPrompt,
            messages: retryMessages,
            systemPrompt,
            temperature: options.temperature ?? 1.0,
            maxTokens: options.maxTokens,
          })

          currentText = retryResult.text
        }
      }
    }

    throw lastError || new GenerativeSchemaError('Schema validation failed')
  }

  /**
   * Extract JSON from text
   */
  private extractJSON(text: string, lenientParsing: boolean): unknown {
    // Try direct parse first
    try {
      return JSON.parse(text)
    } catch {
      // Continue with extraction
    }

    // Try extracting from markdown code blocks
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1]!.trim())
      } catch {
        // Continue
      }
    }

    // Try extracting JSON object/array from text
    const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]!)
      } catch {
        // Continue
      }
    }

    // Try lenient parsing (handle trailing commas, etc.)
    if (lenientParsing) {
      try {
        // Remove trailing commas
        let cleaned = text.replace(/,(\s*[}\]])/g, '$1')
        // Extract JSON again
        const cleanedMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
        if (cleanedMatch) {
          return JSON.parse(cleanedMatch[1]!)
        }
      } catch {
        // Continue
      }
    }

    throw new GenerativeSchemaError('Failed to parse JSON from response')
  }

  /**
   * Validate against JSON schema
   */
  private validateSchema(data: unknown, schema: JSONSchema, coerceTypes: boolean): unknown {
    return this.validateSchemaRecursive(data, schema, coerceTypes, [])
  }

  private validateSchemaRecursive(
    data: unknown,
    schema: JSONSchema,
    coerceTypes: boolean,
    path: string[]
  ): unknown {
    const pathStr = path.join('.')

    // Handle enum validation first (applies to the value itself)
    if (schema.enum) {
      if (!schema.enum.includes(data)) {
        throw new GenerativeSchemaError(
          `Invalid enum value at ${pathStr || 'root'}: ${data}. Expected one of: ${schema.enum.join(', ')}`
        )
      }
    }

    // Handle type validation with optional coercion
    if (schema.type === 'string') {
      if (typeof data === 'string') return data
      if (coerceTypes && data !== null && data !== undefined) return String(data)
      throw new GenerativeSchemaError(`Expected string at ${pathStr || 'root'}, got ${typeof data}`)
    }

    if (schema.type === 'number' || schema.type === 'integer') {
      if (typeof data === 'number') return data
      if (coerceTypes && typeof data === 'string') {
        const num = Number(data)
        if (!isNaN(num)) return num
      }
      throw new GenerativeSchemaError(`Expected number at ${pathStr || 'root'}, got ${typeof data}`)
    }

    if (schema.type === 'boolean') {
      if (typeof data === 'boolean') return data
      if (coerceTypes && typeof data === 'string') {
        if (data === 'true') return true
        if (data === 'false') return false
      }
      throw new GenerativeSchemaError(`Expected boolean at ${pathStr || 'root'}, got ${typeof data}`)
    }

    if (schema.type === 'null') {
      if (data === null) return data
      throw new GenerativeSchemaError(`Expected null at ${pathStr || 'root'}`)
    }

    if (schema.type === 'array') {
      if (!Array.isArray(data)) {
        throw new GenerativeSchemaError(`Expected array at ${pathStr || 'root'}`)
      }
      if (schema.items) {
        return data.map((item, i) =>
          this.validateSchemaRecursive(item, schema.items!, coerceTypes, [...path, String(i)])
        )
      }
      return data
    }

    if (schema.type === 'object') {
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new GenerativeSchemaError(`Expected object at ${pathStr || 'root'}`)
      }

      const obj = data as Record<string, unknown>
      const result: Record<string, unknown> = {}

      // Validate required fields
      if (schema.required) {
        for (const field of schema.required) {
          if (!(field in obj)) {
            throw new GenerativeSchemaError(`Missing required field: ${field}`)
          }
        }
      }

      // Validate properties
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (key in obj) {
            result[key] = this.validateSchemaRecursive(obj[key], propSchema, coerceTypes, [...path, key])
          }
        }
      }

      // Include properties without schema definition
      for (const [key, value] of Object.entries(obj)) {
        if (!(key in result)) {
          result[key] = value
        }
      }

      return result
    }

    return data
  }

  /**
   * Load conversation history
   */
  private async loadConversationHistory(conversationId: string): Promise<Message[] | null> {
    const stored = await this.state.storage.get(`conversation:${conversationId}`)
    if (stored && typeof stored === 'object' && 'messages' in stored) {
      return (stored as { messages: Message[] }).messages
    }
    return null
  }

  /**
   * Save conversation history
   */
  private async saveConversationHistory(conversationId: string, messages: Message[]): Promise<void> {
    await this.state.storage.put(`conversation:${conversationId}`, { messages })
  }

  /**
   * Create error result
   */
  private createErrorResult<T>(
    error: Error,
    model: string,
    startTime: number,
    usage?: TokenUsage,
    finishReason?: 'stop' | 'length' | 'tool_use' | 'content_filter'
  ): GenerativeExecutionResult<T> {
    return {
      success: false,
      error: error as GenerativeExecutionResult['error'],
      usage: usage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      duration: Date.now() - startTime,
      model,
      finishReason,
    }
  }

  /**
   * Handle error and create result
   */
  private handleError<T>(error: Error, model: string, startTime: number): GenerativeExecutionResult<T> {
    const errorWithCode = error as Error & { code?: string; retryAfter?: number }

    this.emit('generation.error', { error: error.message })

    // Preserve specific error types
    if (error instanceof GenerativeTimeoutError) {
      return this.createErrorResult(error, model, startTime)
    }

    if (error instanceof GenerativeRateLimitError) {
      return this.createErrorResult(error, model, startTime)
    }

    if (error instanceof GenerativeSchemaError) {
      return this.createErrorResult(error, model, startTime)
    }

    if (error instanceof GenerativeToolError) {
      return this.createErrorResult(error, model, startTime)
    }

    if (error instanceof GenerativeAbortError) {
      return this.createErrorResult(error, model, startTime)
    }

    // Convert to appropriate error type based on code
    if (errorWithCode.code === 'rate_limit_exceeded') {
      return this.createErrorResult(
        new GenerativeRateLimitError(error.message, errorWithCode.retryAfter),
        model,
        startTime
      )
    }

    return this.createErrorResult(
      new GenerativeModelError(error.message, errorWithCode.code),
      model,
      startTime
    )
  }

  /**
   * Emit event
   */
  private emit(event: string, data: unknown): void {
    this.onEvent?.(event, data)
  }
}
