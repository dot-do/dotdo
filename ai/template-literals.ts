/**
 * Template Literal API for AI Functions
 *
 * Provides tagged template literal functions for convenient AI operations:
 * - ai`prompt` - general AI completion
 * - write`text` - text generation with structured output
 * - summarize`text` - summarization
 * - list`items` - list generation
 * - extract`data` - data extraction
 *
 * All functions integrate with the AI Gateway and return typed PipelinePromises.
 */

import { AIGatewayClient, AIGatewayEnv, ChatMessage } from '../lib/ai/gateway'
import { AIConfig, AIProvider } from '../types/AI'

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for template literal AI functions
 */
export interface TemplateLiteralConfig {
  /** AI provider configuration */
  provider?: AIProvider
  /** Model to use */
  model?: string
  /** AI Gateway ID */
  gateway?: string
  /** Temperature (0-2) */
  temperature?: number
  /** Max tokens */
  maxTokens?: number
  /** Environment bindings */
  env?: AIGatewayEnv
}

/**
 * Options that can be passed to template literal functions
 */
export interface TemplateLiteralOptions extends TemplateLiteralConfig {
  /** System prompt */
  systemPrompt?: string
  /** Schema for structured output */
  schema?: JSONSchema
}

/**
 * JSON Schema definition
 */
export interface JSONSchema {
  type: string
  properties?: Record<string, JSONSchema>
  items?: JSONSchema
  required?: string[]
  enum?: unknown[]
  description?: string
}

/**
 * Write result with destructurable properties
 */
export interface WriteResult {
  title?: string
  body?: string
  summary?: string
  content?: string
  [key: string]: string | undefined
}

/**
 * Extract result with typed entities
 */
export interface ExtractResult<T = Record<string, unknown>> {
  entities: T[]
  raw: string
}

/**
 * PipelinePromise - Promise with chainable methods for no-await operations
 */
export interface PipelinePromise<T> extends Promise<T> {
  /** Access a property on the resolved value */
  get<K extends keyof T>(key: K): PipelinePromise<T[K]>
  /** Transform the result */
  map<R>(fn: (value: T) => R | Promise<R>): PipelinePromise<R>
  /** Handle errors */
  catch<R = T>(fn: (error: Error) => R | Promise<R>): PipelinePromise<R>
}

// ============================================================================
// PipelinePromise Implementation
// ============================================================================

/**
 * Creates a PipelinePromise from a regular Promise
 */
function createPipelinePromise<T>(promise: Promise<T>): PipelinePromise<T> {
  const pipelinePromise = promise as PipelinePromise<T>

  // Add get method for property access
  pipelinePromise.get = <K extends keyof T>(key: K): PipelinePromise<T[K]> => {
    return createPipelinePromise(promise.then((value) => value[key]))
  }

  // Add map method for transformation
  pipelinePromise.map = <R>(fn: (value: T) => R | Promise<R>): PipelinePromise<R> => {
    return createPipelinePromise(promise.then(fn))
  }

  // Override catch to return PipelinePromise
  const originalCatch = pipelinePromise.catch.bind(pipelinePromise)
  pipelinePromise.catch = <R = T>(fn: (error: Error) => R | Promise<R>): PipelinePromise<R> => {
    return createPipelinePromise(originalCatch(fn) as Promise<R>)
  }

  return pipelinePromise
}

// ============================================================================
// Global Configuration
// ============================================================================

let globalConfig: TemplateLiteralConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.7,
}

/**
 * Configure default settings for template literal functions
 */
export function configure(config: Partial<TemplateLiteralConfig>): void {
  globalConfig = { ...globalConfig, ...config }
}

/**
 * Get current configuration
 */
export function getConfig(): TemplateLiteralConfig {
  return { ...globalConfig }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Interpolate template literal strings and values
 */
function interpolate(strings: TemplateStringsArray, values: unknown[]): string {
  return strings.reduce((result, str, i) => {
    const value = i < values.length ? String(values[i] ?? '') : ''
    return result + str + value
  }, '')
}

/**
 * Create AI client from configuration
 */
function createClient(config: TemplateLiteralConfig): AIGatewayClient {
  const aiConfig: AIConfig = {
    provider: config.provider ?? globalConfig.provider ?? 'anthropic',
    model: config.model ?? globalConfig.model ?? 'claude-sonnet-4-20250514',
    gateway: config.gateway ?? globalConfig.gateway,
    temperature: config.temperature ?? globalConfig.temperature,
    maxTokens: config.maxTokens ?? globalConfig.maxTokens,
  }

  const env = config.env ?? globalConfig.env ?? {}

  return new AIGatewayClient(aiConfig, env)
}

/**
 * Execute AI chat and return response
 */
async function executeChat(
  prompt: string,
  options: TemplateLiteralOptions = {}
): Promise<string> {
  const client = createClient(options)

  const messages: ChatMessage[] = []

  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt })
  }

  messages.push({ role: 'user', content: prompt })

  const response = await client.chat(messages)
  return response.content
}

/**
 * Parse JSON from AI response, handling code blocks
 */
function parseJSON<T>(text: string): T {
  // Try direct parse
  try {
    return JSON.parse(text)
  } catch {
    // Continue
  }

  // Try extracting from markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim())
    } catch {
      // Continue
    }
  }

  // Try extracting JSON object/array from text
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  if (jsonMatch?.[1]) {
    try {
      return JSON.parse(jsonMatch[1])
    } catch {
      // Continue
    }
  }

  throw new Error('Failed to parse JSON from AI response')
}

// ============================================================================
// Template Literal Functions
// ============================================================================

/**
 * ai`prompt` - General AI completion
 *
 * @example
 * const response = await ai`What is the capital of France?`
 * // => "The capital of France is Paris."
 *
 * @example
 * const response = await ai`Explain ${topic} in simple terms`
 * // => "..." (explanation of the topic)
 */
export function ai(
  strings: TemplateStringsArray,
  ...values: unknown[]
): PipelinePromise<string> {
  const prompt = interpolate(strings, values)
  return createPipelinePromise(executeChat(prompt))
}

/**
 * Create a configured ai function with custom options
 */
ai.configure = (options: TemplateLiteralOptions) => {
  return (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<string> => {
    const prompt = interpolate(strings, values)
    return createPipelinePromise(executeChat(prompt, options))
  }
}

/**
 * write`prompt` - Text generation with structured output
 *
 * Returns an object with destructurable properties like title, body, summary.
 *
 * @example
 * const { title, body } = await write`Write a blog post about ${topic}`
 *
 * @example
 * const result = await write`Create an email about ${subject}`
 * console.log(result.title) // Email subject
 * console.log(result.body) // Email body
 */
export function write(
  strings: TemplateStringsArray,
  ...values: unknown[]
): PipelinePromise<WriteResult> {
  const prompt = interpolate(strings, values)

  const systemPrompt = `You are a writing assistant. Generate structured content with clear sections.
Always respond with a JSON object containing relevant fields like:
- title: A concise title or headline
- body: The main content
- summary: A brief summary (if applicable)
- content: Alternative field for the main content

Respond ONLY with valid JSON, no additional text.`

  const executePromise = async (): Promise<WriteResult> => {
    const response = await executeChat(prompt, { systemPrompt })
    return parseJSON<WriteResult>(response)
  }

  return createPipelinePromise(executePromise())
}

/**
 * Create a configured write function with custom options
 */
write.configure = (options: TemplateLiteralOptions) => {
  return (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<WriteResult> => {
    const prompt = interpolate(strings, values)

    const systemPrompt = options.systemPrompt ?? `You are a writing assistant. Generate structured content with clear sections.
Always respond with a JSON object containing relevant fields like:
- title: A concise title or headline
- body: The main content
- summary: A brief summary (if applicable)
- content: Alternative field for the main content

Respond ONLY with valid JSON, no additional text.`

    const executePromise = async (): Promise<WriteResult> => {
      const response = await executeChat(prompt, { ...options, systemPrompt })
      return parseJSON<WriteResult>(response)
    }

    return createPipelinePromise(executePromise())
  }
}

/**
 * summarize`text` - Summarization
 *
 * @example
 * const summary = await summarize`${longArticle}`
 * // => "This article discusses..."
 *
 * @example
 * const summary = await summarize`Summarize the key points: ${document}`
 */
export function summarize(
  strings: TemplateStringsArray,
  ...values: unknown[]
): PipelinePromise<string> {
  const text = interpolate(strings, values)

  const systemPrompt = `You are a summarization assistant. Provide concise, accurate summaries.
Focus on the key points and main ideas. Keep summaries clear and informative.
Respond with only the summary text, no additional formatting or preamble.`

  const prompt = `Summarize the following:\n\n${text}`

  return createPipelinePromise(executeChat(prompt, { systemPrompt }))
}

/**
 * Create a configured summarize function with custom options
 */
summarize.configure = (options: TemplateLiteralOptions & { length?: 'short' | 'medium' | 'long' }) => {
  return (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<string> => {
    const text = interpolate(strings, values)

    const lengthInstruction = options.length === 'short'
      ? 'Keep the summary to 1-2 sentences.'
      : options.length === 'long'
        ? 'Provide a detailed summary covering all key points.'
        : 'Provide a moderate-length summary.'

    const systemPrompt = options.systemPrompt ?? `You are a summarization assistant. Provide concise, accurate summaries.
Focus on the key points and main ideas. ${lengthInstruction}
Respond with only the summary text, no additional formatting or preamble.`

    const prompt = `Summarize the following:\n\n${text}`

    return createPipelinePromise(executeChat(prompt, { ...options, systemPrompt }))
  }
}

/**
 * list`prompt` - List generation
 *
 * Returns an array of strings extracted from the AI response.
 *
 * @example
 * const items = await list`List 5 programming languages for web development`
 * // => ["JavaScript", "TypeScript", "Python", "Ruby", "Go"]
 *
 * @example
 * const steps = await list`Steps to ${task}`
 */
export function list(
  strings: TemplateStringsArray,
  ...values: unknown[]
): PipelinePromise<string[]> {
  const prompt = interpolate(strings, values)

  const systemPrompt = `You are a list generation assistant. Generate lists as JSON arrays.
Always respond with a JSON array of strings, no additional text.
Example: ["item 1", "item 2", "item 3"]`

  const executePromise = async (): Promise<string[]> => {
    const response = await executeChat(prompt, { systemPrompt })
    return parseJSON<string[]>(response)
  }

  return createPipelinePromise(executePromise())
}

/**
 * Create a configured list function with custom options
 */
list.configure = (options: TemplateLiteralOptions & { count?: number }) => {
  return (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<string[]> => {
    const prompt = interpolate(strings, values)

    const countInstruction = options.count
      ? `Generate exactly ${options.count} items.`
      : ''

    const systemPrompt = options.systemPrompt ?? `You are a list generation assistant. Generate lists as JSON arrays.
${countInstruction}
Always respond with a JSON array of strings, no additional text.
Example: ["item 1", "item 2", "item 3"]`

    const executePromise = async (): Promise<string[]> => {
      const response = await executeChat(prompt, { ...options, systemPrompt })
      return parseJSON<string[]>(response)
    }

    return createPipelinePromise(executePromise())
  }
}

/**
 * extract`data` - Data extraction
 *
 * Extracts structured entities from text.
 *
 * @example
 * const { entities } = await extract`Extract all company names from: ${article}`
 * // => { entities: ["Apple", "Google", "Microsoft"], raw: "..." }
 *
 * @example
 * const data = await extract`Extract dates and locations from: ${text}`
 */
export function extract<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): PipelinePromise<ExtractResult<T>> {
  const prompt = interpolate(strings, values)

  const systemPrompt = `You are a data extraction assistant. Extract structured data from text.
Respond with a JSON object containing:
- entities: An array of extracted items (each can be an object with relevant properties)
- raw: The original text that was analyzed

Example response:
{
  "entities": [{"name": "John", "type": "person"}, {"name": "Acme Corp", "type": "company"}],
  "raw": "original text here"
}`

  const executePromise = async (): Promise<ExtractResult<T>> => {
    const response = await executeChat(prompt, { systemPrompt })
    return parseJSON<ExtractResult<T>>(response)
  }

  return createPipelinePromise(executePromise())
}

/**
 * Create a configured extract function with custom options and schema
 */
extract.configure = <T = Record<string, unknown>>(
  options: TemplateLiteralOptions & { entityType?: string }
) => {
  return (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<ExtractResult<T>> => {
    const prompt = interpolate(strings, values)

    const entityInstruction = options.entityType
      ? `Focus on extracting ${options.entityType} entities.`
      : ''

    const schemaInstruction = options.schema
      ? `Each entity should match this structure: ${JSON.stringify(options.schema)}`
      : ''

    const systemPrompt = options.systemPrompt ?? `You are a data extraction assistant. Extract structured data from text.
${entityInstruction}
${schemaInstruction}
Respond with a JSON object containing:
- entities: An array of extracted items
- raw: The original text that was analyzed`

    const executePromise = async (): Promise<ExtractResult<T>> => {
      const response = await executeChat(prompt, { ...options, systemPrompt })
      return parseJSON<ExtractResult<T>>(response)
    }

    return createPipelinePromise(executePromise())
  }
}

// ============================================================================
// Classification Functions
// ============================================================================

/**
 * Parse boolean from AI response
 * Handles various formats: true/false, yes/no, JSON objects, and natural language
 */
function parseBoolean(text: string): boolean {
  const normalized = text.toLowerCase().trim()

  // Direct boolean values
  if (normalized === 'true' || normalized === 'yes') {
    return true
  }
  if (normalized === 'false' || normalized === 'no') {
    return false
  }

  // Try to parse as JSON
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed === 'boolean') {
      return parsed
    }
    // Look for common result fields
    if (typeof parsed === 'object' && parsed !== null) {
      if ('result' in parsed && typeof parsed.result === 'boolean') {
        return parsed.result
      }
      if ('value' in parsed && typeof parsed.value === 'boolean') {
        return parsed.value
      }
      if ('answer' in parsed && typeof parsed.answer === 'boolean') {
        return parsed.answer
      }
    }
  } catch {
    // Not JSON, continue with text analysis
  }

  // Check for affirmative indicators at the start
  if (normalized.startsWith('yes') || normalized.startsWith('true')) {
    return true
  }
  if (normalized.startsWith('no') || normalized.startsWith('false')) {
    return false
  }

  // Default to false for unclear responses
  return false
}

/**
 * Find matching option in AI response
 * Uses case-insensitive matching and returns first match found
 */
function findOption<T extends string | number>(response: string, options: readonly T[]): T {
  const normalizedResponse = response.toLowerCase()

  // Try to parse as JSON first
  try {
    const parsed = JSON.parse(response)
    if (typeof parsed === 'object' && parsed !== null) {
      // Look for common selection fields
      const value = parsed.choice ?? parsed.selection ?? parsed.option ?? parsed.result ?? parsed.answer
      if (value !== undefined) {
        const valueStr = String(value).toLowerCase()
        for (const option of options) {
          if (String(option).toLowerCase() === valueStr) {
            return option
          }
        }
      }
    } else {
      // Direct value
      const valueStr = String(parsed).toLowerCase()
      for (const option of options) {
        if (String(option).toLowerCase() === valueStr) {
          return option
        }
      }
    }
  } catch {
    // Not JSON, continue with text analysis
  }

  // Search for options in the response text (in order of definition)
  for (const option of options) {
    const optionStr = String(option).toLowerCase()
    if (normalizedResponse.includes(optionStr)) {
      return option
    }
  }

  // Default to first option if no match found
  return options[0] as T
}

/**
 * is`prompt` - Binary classification
 *
 * Returns a boolean based on AI classification of the prompt.
 *
 * @example
 * const isSpam = await is`Is this message spam? ${message}`
 * // => true or false
 *
 * @example
 * const isValid = await is`Is this email address valid? ${email}`
 */
export function is(
  strings: TemplateStringsArray,
  ...values: unknown[]
): PipelinePromise<boolean> {
  const prompt = interpolate(strings, values)

  const systemPrompt = `You are a binary classifier. Analyze the question and respond with only "true" or "false".
Do not include any other text, explanation, or formatting.
If you are uncertain, respond with "false".`

  const executePromise = async (): Promise<boolean> => {
    const response = await executeChat(prompt, { systemPrompt })
    return parseBoolean(response)
  }

  return createPipelinePromise(executePromise())
}

/**
 * Create a configured is function with custom options
 */
is.configure = (options: TemplateLiteralOptions) => {
  return (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<boolean> => {
    const prompt = interpolate(strings, values)

    const systemPrompt = options.systemPrompt ?? `You are a binary classifier. Analyze the question and respond with only "true" or "false".
Do not include any other text, explanation, or formatting.
If you are uncertain, respond with "false".`

    const executePromise = async (): Promise<boolean> => {
      const response = await executeChat(prompt, { ...options, systemPrompt })
      return parseBoolean(response)
    }

    return createPipelinePromise(executePromise())
  }
}

/**
 * decide(options) - Multi-option classification
 *
 * Returns a curried function that classifies into one of the provided options.
 *
 * @example
 * const sentiment = await decide(['positive', 'negative', 'neutral'])`What is the sentiment? ${text}`
 * // => 'positive' | 'negative' | 'neutral'
 *
 * @example
 * const category = await decide(['bug', 'feature', 'task'])`Classify: ${issueText}`
 */
export function decide<T extends string | number>(
  options: readonly T[]
): (strings: TemplateStringsArray, ...values: unknown[]) => PipelinePromise<T> {
  return (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<T> => {
    const prompt = interpolate(strings, values)

    const optionsList = options.map((o) => `"${o}"`).join(', ')
    const systemPrompt = `You are a classifier. Classify the input into exactly one of these options: ${optionsList}
Respond with only the selected option, no other text.
If uncertain, choose the option that best matches.`

    const executePromise = async (): Promise<T> => {
      const response = await executeChat(prompt, { systemPrompt })
      return findOption(response, options)
    }

    return createPipelinePromise(executePromise())
  }
}

/**
 * Create a configured decide function with custom options
 */
decide.configure = (options: TemplateLiteralOptions) => {
  return <T extends string | number>(
    decideOptions: readonly T[]
  ): ((strings: TemplateStringsArray, ...values: unknown[]) => PipelinePromise<T>) => {
    return (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<T> => {
      const prompt = interpolate(strings, values)

      const optionsList = decideOptions.map((o) => `"${o}"`).join(', ')
      const systemPrompt = options.systemPrompt ?? `You are a classifier. Classify the input into exactly one of these options: ${optionsList}
Respond with only the selected option, no other text.
If uncertain, choose the option that best matches.`

      const executePromise = async (): Promise<T> => {
        const response = await executeChat(prompt, { ...options, systemPrompt })
        return findOption(response, decideOptions)
      }

      return createPipelinePromise(executePromise())
    }
  }
}

// ============================================================================
// Human-in-Loop Types
// ============================================================================

/**
 * Options for human-in-loop functions
 */
export interface HumanOptions {
  /** Notification channel (slack, email, in-app) */
  channel?: 'slack' | 'email' | 'in-app' | string
  /** Timeout in milliseconds (default: 24 hours) */
  timeout?: number
  /** Users to notify */
  assignees?: string[]
  /** Priority level */
  priority?: 'low' | 'normal' | 'high' | 'critical'
  /** Custom actions for approval */
  actions?: string[] | Array<{ value: string; label: string; style?: 'primary' | 'danger' | 'default' }>
}

/**
 * Review result with approval status and feedback
 */
export interface ReviewResult {
  approved: boolean
  feedback: string
  reviewer?: string
  timestamp?: Date
}

/**
 * Human task executor interface for dependency injection
 */
export interface HumanTaskExecutor {
  execute(task: {
    prompt: string
    channel: string
    timeout: number
    actions?: Array<{ text: string; value: string; style?: string }>
    channelOptions?: Record<string, unknown>
  }): Promise<{
    success: boolean
    response?: {
      action: string
      userId: string
      timestamp: Date
      data: Record<string, unknown>
    }
    error?: Error
  }>
}

// Default human task executor (mock for now, real impl uses HumanFunctionExecutor)
let humanTaskExecutor: HumanTaskExecutor | null = null

/**
 * Set the human task executor (for integration with HumanFunctionExecutor)
 */
export function setHumanTaskExecutor(executor: HumanTaskExecutor): void {
  humanTaskExecutor = executor
}

/**
 * Get the human task executor
 */
export function getHumanTaskExecutor(): HumanTaskExecutor | null {
  return humanTaskExecutor
}

// ============================================================================
// Human-in-Loop Template Literal Functions
// ============================================================================

/**
 * ask`prompt` - Prompts human for free-form input
 *
 * Pauses workflow execution until a human responds with text input.
 * Integrates with HumanFunctionExecutor for task queuing and notification.
 *
 * @example
 * const answer = await ask`What priority should this bug have? ${bugReport}`
 * // => "High - this is blocking the release"
 *
 * @example
 * const feedback = await ask`Any additional notes for ${customer.name}'s order?`
 * // => "Rush order - ship overnight"
 */
export function ask(
  strings: TemplateStringsArray,
  ...values: unknown[]
): PipelinePromise<string> {
  const prompt = interpolate(strings, values)

  const executePromise = async (): Promise<string> => {
    if (!humanTaskExecutor) {
      // Fallback: Use AI to simulate human response for testing/development
      const systemPrompt = `You are simulating a human response to a question.
Respond naturally as if you were a human being asked this question.
Keep your response concise and relevant.`
      return executeChat(prompt, { systemPrompt })
    }

    const result = await humanTaskExecutor.execute({
      prompt,
      channel: 'in-app',
      timeout: 86400000, // 24 hours default
    })

    if (!result.success || !result.response) {
      throw new Error(result.error?.message || 'No response received')
    }

    // Return the text response from the human
    return (result.response.data?.text as string) ||
           (result.response.data?.answer as string) ||
           (result.response.data?.response as string) ||
           String(result.response.data || '')
  }

  return createPipelinePromise(executePromise())
}

/**
 * Create a configured ask function with custom options
 */
ask.configure = (options: HumanOptions) => {
  return (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<string> => {
    const prompt = interpolate(strings, values)

    const executePromise = async (): Promise<string> => {
      if (!humanTaskExecutor) {
        // Fallback to AI simulation
        const systemPrompt = `You are simulating a human response to a question.
Respond naturally as if you were a human being asked this question.
Keep your response concise and relevant.`
        return executeChat(prompt, { systemPrompt })
      }

      const result = await humanTaskExecutor.execute({
        prompt,
        channel: options.channel || 'in-app',
        timeout: options.timeout || 86400000,
        channelOptions: {
          priority: options.priority,
          mentionUsers: options.assignees,
        },
      })

      if (!result.success || !result.response) {
        throw new Error(result.error?.message || 'No response received')
      }

      return (result.response.data?.text as string) ||
             (result.response.data?.answer as string) ||
             (result.response.data?.response as string) ||
             String(result.response.data || '')
    }

    return createPipelinePromise(executePromise())
  }
}

/**
 * approve`prompt` - Requests human approval (binary yes/no)
 *
 * Pauses workflow execution until a human approves or rejects.
 * Returns true for approval, false for rejection.
 *
 * @example
 * const approved = await approve`Approve expense $${amount} for ${description}?`
 * if (!approved) throw new Error('Expense rejected')
 *
 * @example
 * const canProceed = await approve`Deploy ${service} to production?`
 */
export function approve(
  strings: TemplateStringsArray,
  ...values: unknown[]
): PipelinePromise<boolean> {
  const prompt = interpolate(strings, values)

  const executePromise = async (): Promise<boolean> => {
    if (!humanTaskExecutor) {
      // Fallback: Use AI to simulate approval decision
      const systemPrompt = `You are simulating a human approval decision.
Based on the request, respond with ONLY "true" or "false".
Consider if the request seems reasonable, appropriate, and within normal parameters.
Respond with a single word: true or false`
      const response = await executeChat(prompt, { systemPrompt })
      const normalized = response.trim().toLowerCase()
      return normalized === 'true' || normalized === 'yes' || normalized === 'approved'
    }

    const result = await humanTaskExecutor.execute({
      prompt,
      channel: 'in-app',
      timeout: 86400000,
      actions: [
        { text: 'Approve', value: 'approve', style: 'primary' },
        { text: 'Reject', value: 'reject', style: 'danger' },
      ],
    })

    if (!result.success || !result.response) {
      throw new Error(result.error?.message || 'No response received')
    }

    return result.response.action === 'approve'
  }

  return createPipelinePromise(executePromise())
}

/**
 * Create a configured approve function with custom options
 */
approve.configure = (options: HumanOptions) => {
  return (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<boolean> => {
    const prompt = interpolate(strings, values)

    const executePromise = async (): Promise<boolean> => {
      if (!humanTaskExecutor) {
        // Fallback to AI simulation
        const systemPrompt = `You are simulating a human approval decision.
Based on the request, respond with ONLY "true" or "false".
Consider if the request seems reasonable, appropriate, and within normal parameters.`
        const response = await executeChat(prompt, { systemPrompt })
        const normalized = response.trim().toLowerCase()
        return normalized === 'true' || normalized === 'yes' || normalized === 'approved'
      }

      // Build actions from options or use defaults
      const actions = options.actions
        ? (typeof options.actions[0] === 'string'
            ? (options.actions as string[]).map(a => ({ text: a, value: a.toLowerCase() }))
            : (options.actions as Array<{ value: string; label: string; style?: string }>).map(a => ({
                text: a.label,
                value: a.value,
                style: a.style,
              })))
        : [
            { text: 'Approve', value: 'approve', style: 'primary' },
            { text: 'Reject', value: 'reject', style: 'danger' },
          ]

      const result = await humanTaskExecutor.execute({
        prompt,
        channel: options.channel || 'in-app',
        timeout: options.timeout || 86400000,
        actions,
        channelOptions: {
          priority: options.priority,
          mentionUsers: options.assignees,
        },
      })

      if (!result.success || !result.response) {
        throw new Error(result.error?.message || 'No response received')
      }

      return result.response.action === 'approve'
    }

    return createPipelinePromise(executePromise())
  }
}

/**
 * review`prompt` - Requests human review with feedback
 *
 * Pauses workflow execution until a human reviews content and provides feedback.
 * Returns an object with approval status and detailed feedback.
 *
 * @example
 * const { approved, feedback } = await review`Review PR #${prNumber}: ${diff}`
 * if (!approved) {
 *   await requestChanges(feedback)
 * }
 *
 * @example
 * const result = await review`Evaluate the quality of ${document.title}`
 * console.log(result.feedback) // Detailed review comments
 */
export function review(
  strings: TemplateStringsArray,
  ...values: unknown[]
): PipelinePromise<ReviewResult> {
  const prompt = interpolate(strings, values)

  const executePromise = async (): Promise<ReviewResult> => {
    if (!humanTaskExecutor) {
      // Fallback: Use AI to simulate review
      const systemPrompt = `You are simulating a human reviewer.
Provide a JSON response with the following structure:
{
  "approved": boolean,
  "feedback": "detailed feedback text"
}
Be thorough in your review and provide actionable feedback.
Respond ONLY with valid JSON.`
      const response = await executeChat(prompt, { systemPrompt })
      try {
        return parseJSON<ReviewResult>(response)
      } catch {
        // If JSON parsing fails, try to extract meaningful response
        const isApproved = response.toLowerCase().includes('approve') &&
                          !response.toLowerCase().includes('not approve') &&
                          !response.toLowerCase().includes("don't approve")
        return {
          approved: isApproved,
          feedback: response,
        }
      }
    }

    const result = await humanTaskExecutor.execute({
      prompt,
      channel: 'in-app',
      timeout: 86400000,
      actions: [
        { text: 'Approve', value: 'approve', style: 'primary' },
        { text: 'Request Changes', value: 'request_changes', style: 'danger' },
      ],
    })

    if (!result.success || !result.response) {
      throw new Error(result.error?.message || 'No response received')
    }

    return {
      approved: result.response.action === 'approve',
      feedback: (result.response.data?.feedback as string) ||
                (result.response.data?.comment as string) ||
                (result.response.data?.notes as string) ||
                '',
      reviewer: result.response.userId,
      timestamp: result.response.timestamp,
    }
  }

  return createPipelinePromise(executePromise())
}

/**
 * Create a configured review function with custom options
 */
review.configure = (options: HumanOptions) => {
  return (strings: TemplateStringsArray, ...values: unknown[]): PipelinePromise<ReviewResult> => {
    const prompt = interpolate(strings, values)

    const executePromise = async (): Promise<ReviewResult> => {
      if (!humanTaskExecutor) {
        // Fallback to AI simulation
        const systemPrompt = `You are simulating a human reviewer.
Provide a JSON response with the following structure:
{
  "approved": boolean,
  "feedback": "detailed feedback text"
}
Be thorough in your review and provide actionable feedback.
Respond ONLY with valid JSON.`
        const response = await executeChat(prompt, { systemPrompt })
        try {
          return parseJSON<ReviewResult>(response)
        } catch {
          const isApproved = response.toLowerCase().includes('approve') &&
                            !response.toLowerCase().includes('not approve')
          return {
            approved: isApproved,
            feedback: response,
          }
        }
      }

      // Build actions from options or use defaults
      const actions = options.actions
        ? (typeof options.actions[0] === 'string'
            ? (options.actions as string[]).map(a => ({ text: a, value: a.toLowerCase().replace(/\s+/g, '_') }))
            : (options.actions as Array<{ value: string; label: string; style?: string }>).map(a => ({
                text: a.label,
                value: a.value,
                style: a.style,
              })))
        : [
            { text: 'Approve', value: 'approve', style: 'primary' },
            { text: 'Request Changes', value: 'request_changes', style: 'danger' },
          ]

      const result = await humanTaskExecutor.execute({
        prompt,
        channel: options.channel || 'in-app',
        timeout: options.timeout || 86400000,
        actions,
        channelOptions: {
          priority: options.priority,
          mentionUsers: options.assignees,
        },
      })

      if (!result.success || !result.response) {
        throw new Error(result.error?.message || 'No response received')
      }

      return {
        approved: result.response.action === 'approve',
        feedback: (result.response.data?.feedback as string) ||
                  (result.response.data?.comment as string) ||
                  (result.response.data?.notes as string) ||
                  '',
        reviewer: result.response.userId,
        timestamp: result.response.timestamp,
      }
    }

    return createPipelinePromise(executePromise())
  }
}

// ============================================================================
// Exports
// ============================================================================

export default {
  ai,
  write,
  summarize,
  list,
  extract,
  is,
  decide,
  ask,
  approve,
  review,
  configure,
  getConfig,
  setHumanTaskExecutor,
  getHumanTaskExecutor,
}
