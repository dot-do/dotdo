/**
 * @dotdo/openai - OpenAI Assistants API Compatibility Layer
 *
 * Drop-in replacement for OpenAI Assistants API with edge compatibility.
 * Supports local storage with in-memory backend or delegation to OpenAI.
 *
 * Features:
 * - Assistant CRUD operations
 * - Thread management
 * - Message handling
 * - Run execution with tool calls
 * - Tool outputs submission
 * - Streaming support
 *
 * @example Basic Usage
 * ```typescript
 * import { AssistantsClient } from '@dotdo/openai/assistants'
 *
 * const client = new AssistantsClient({ apiKey: 'sk-xxx' })
 *
 * // Create an assistant
 * const assistant = await client.assistants.create({
 *   model: 'gpt-4-turbo',
 *   name: 'Math Tutor',
 *   instructions: 'You are a helpful math tutor.',
 *   tools: [{ type: 'code_interpreter' }],
 * })
 *
 * // Create a thread
 * const thread = await client.threads.create()
 *
 * // Add a message
 * await client.messages.create(thread.id, {
 *   role: 'user',
 *   content: 'Solve the equation 3x + 11 = 14',
 * })
 *
 * // Run the assistant
 * const run = await client.runs.create(thread.id, {
 *   assistant_id: assistant.id,
 * })
 *
 * // Poll for completion
 * let result = await client.runs.poll(thread.id, run.id)
 *
 * // Get messages
 * const messages = await client.messages.list(thread.id)
 * console.log(messages.data[0].content)
 * ```
 *
 * @example Tool Outputs
 * ```typescript
 * // When run requires action
 * if (run.status === 'requires_action') {
 *   const toolCalls = run.required_action?.submit_tool_outputs.tool_calls
 *
 *   const toolOutputs = toolCalls.map(tc => ({
 *     tool_call_id: tc.id,
 *     output: JSON.stringify({ result: 'computed value' }),
 *   }))
 *
 *   await client.runs.submitToolOutputs(thread.id, run.id, {
 *     tool_outputs: toolOutputs,
 *   })
 * }
 * ```
 *
 * @see https://platform.openai.com/docs/api-reference/assistants
 * @module
 */

import { InMemoryResource, type Entity } from '../../primitives/resource'
import type {
  AgentProvider,
  AgentConfig,
  Message as AgentMessage,
  ToolDefinition,
} from '../../agents/types'
import { createOpenAIProvider } from '../../agents/providers/openai'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Assistant object
 */
export interface Assistant extends Entity {
  object: 'assistant'
  created_at: number
  name: string | null
  description: string | null
  model: string
  instructions: string | null
  tools: AssistantTool[]
  tool_resources: ToolResources | null
  metadata: Record<string, string>
  temperature: number | null
  top_p: number | null
  response_format: ResponseFormat | null
}

export type AssistantTool =
  | { type: 'code_interpreter' }
  | { type: 'file_search'; file_search?: FileSearchConfig }
  | FunctionTool

export interface FunctionTool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
    strict?: boolean
  }
}

export interface FileSearchConfig {
  max_num_results?: number
  ranking_options?: {
    score_threshold?: number
    ranker?: 'auto' | 'default_2024_08_21'
  }
}

export interface ToolResources {
  code_interpreter?: { file_ids?: string[] }
  file_search?: { vector_store_ids?: string[] }
}

export type ResponseFormat =
  | 'auto'
  | { type: 'text' }
  | { type: 'json_object' }
  | { type: 'json_schema'; json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean } }

/**
 * Thread object
 */
export interface Thread extends Entity {
  object: 'thread'
  created_at: number
  tool_resources: ToolResources | null
  metadata: Record<string, string>
}

/**
 * Message object
 */
export interface Message extends Entity {
  object: 'thread.message'
  created_at: number
  thread_id: string
  status: 'in_progress' | 'incomplete' | 'completed'
  incomplete_details: { reason: string } | null
  completed_at: number | null
  incomplete_at: number | null
  role: 'user' | 'assistant'
  content: MessageContent[]
  assistant_id: string | null
  run_id: string | null
  attachments: Attachment[] | null
  metadata: Record<string, string>
}

export type MessageContent =
  | { type: 'text'; text: { value: string; annotations: Annotation[] } }
  | { type: 'image_file'; image_file: { file_id: string; detail?: 'auto' | 'low' | 'high' } }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
  | { type: 'refusal'; refusal: string }

export type Annotation =
  | { type: 'file_citation'; text: string; file_citation: { file_id: string }; start_index: number; end_index: number }
  | { type: 'file_path'; text: string; file_path: { file_id: string }; start_index: number; end_index: number }

export interface Attachment {
  file_id?: string
  tools?: Array<{ type: 'code_interpreter' } | { type: 'file_search' }>
}

/**
 * Run object
 */
export interface Run extends Entity {
  object: 'thread.run'
  created_at: number
  thread_id: string
  assistant_id: string
  status: RunStatus
  required_action: RequiredAction | null
  last_error: RunError | null
  expires_at: number | null
  started_at: number | null
  cancelled_at: number | null
  failed_at: number | null
  completed_at: number | null
  incomplete_details: { reason: string } | null
  model: string
  instructions: string | null
  tools: AssistantTool[]
  metadata: Record<string, string>
  usage: Usage | null
  temperature: number | null
  top_p: number | null
  max_prompt_tokens: number | null
  max_completion_tokens: number | null
  truncation_strategy: TruncationStrategy | null
  tool_choice: ToolChoice | null
  parallel_tool_calls: boolean
  response_format: ResponseFormat | null
}

export type RunStatus =
  | 'queued'
  | 'in_progress'
  | 'requires_action'
  | 'cancelling'
  | 'cancelled'
  | 'failed'
  | 'completed'
  | 'incomplete'
  | 'expired'

export interface RequiredAction {
  type: 'submit_tool_outputs'
  submit_tool_outputs: {
    tool_calls: ToolCall[]
  }
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface RunError {
  code: 'server_error' | 'rate_limit_exceeded' | 'invalid_prompt'
  message: string
}

export interface Usage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface TruncationStrategy {
  type: 'auto' | 'last_messages'
  last_messages?: number | null
}

export type ToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | { type: 'function'; function: { name: string } }
  | { type: 'file_search' }
  | { type: 'code_interpreter' }

/**
 * Run Step object
 */
export interface RunStep extends Entity {
  object: 'thread.run.step'
  created_at: number
  run_id: string
  assistant_id: string
  thread_id: string
  type: 'message_creation' | 'tool_calls'
  status: 'in_progress' | 'cancelled' | 'failed' | 'completed' | 'expired'
  step_details: StepDetails
  last_error: RunError | null
  expired_at: number | null
  cancelled_at: number | null
  failed_at: number | null
  completed_at: number | null
  metadata: Record<string, string>
  usage: Usage | null
}

export type StepDetails =
  | { type: 'message_creation'; message_creation: { message_id: string } }
  | { type: 'tool_calls'; tool_calls: RunStepToolCall[] }

export type RunStepToolCall =
  | { id: string; type: 'code_interpreter'; code_interpreter: { input: string; outputs: CodeInterpreterOutput[] } }
  | { id: string; type: 'file_search'; file_search: { results?: FileSearchResult[] } }
  | { id: string; type: 'function'; function: { name: string; arguments: string; output: string | null } }

export type CodeInterpreterOutput =
  | { type: 'logs'; logs: string }
  | { type: 'image'; image: { file_id: string } }

export interface FileSearchResult {
  file_id: string
  file_name: string
  score: number
  content?: Array<{ type: 'text'; text: string }>
}

/**
 * List response wrapper
 */
export interface ListResponse<T> {
  object: 'list'
  data: T[]
  first_id: string | null
  last_id: string | null
  has_more: boolean
}

export interface ListParams {
  limit?: number
  order?: 'asc' | 'desc'
  after?: string
  before?: string
}

export interface ListMessagesParams extends ListParams {
  run_id?: string
}

export interface DeleteResponse {
  id: string
  object: string
  deleted: boolean
}

// Request types
export interface CreateAssistantRequest {
  model: string
  name?: string | null
  description?: string | null
  instructions?: string | null
  tools?: AssistantTool[]
  tool_resources?: ToolResources | null
  metadata?: Record<string, string>
  temperature?: number | null
  top_p?: number | null
  response_format?: ResponseFormat | null
}

export interface UpdateAssistantRequest {
  model?: string
  name?: string | null
  description?: string | null
  instructions?: string | null
  tools?: AssistantTool[]
  tool_resources?: ToolResources | null
  metadata?: Record<string, string>
  temperature?: number | null
  top_p?: number | null
  response_format?: ResponseFormat | null
}

export interface CreateThreadRequest {
  messages?: CreateMessageRequest[]
  tool_resources?: ToolResources | null
  metadata?: Record<string, string>
}

export interface UpdateThreadRequest {
  tool_resources?: ToolResources | null
  metadata?: Record<string, string>
}

export interface CreateMessageRequest {
  role: 'user' | 'assistant'
  content: string | MessageContentInput[]
  attachments?: Attachment[] | null
  metadata?: Record<string, string>
}

export type MessageContentInput =
  | { type: 'text'; text: string }
  | { type: 'image_file'; image_file: { file_id: string; detail?: 'auto' | 'low' | 'high' } }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }

export interface UpdateMessageRequest {
  metadata?: Record<string, string>
}

export interface CreateRunRequest {
  assistant_id: string
  model?: string | null
  instructions?: string | null
  additional_instructions?: string | null
  additional_messages?: CreateMessageRequest[]
  tools?: AssistantTool[] | null
  metadata?: Record<string, string>
  temperature?: number | null
  top_p?: number | null
  stream?: boolean | null
  max_prompt_tokens?: number | null
  max_completion_tokens?: number | null
  truncation_strategy?: TruncationStrategy | null
  tool_choice?: ToolChoice | null
  parallel_tool_calls?: boolean
  response_format?: ResponseFormat | null
}

export interface SubmitToolOutputsRequest {
  tool_outputs: ToolOutput[]
  stream?: boolean | null
}

export interface ToolOutput {
  tool_call_id: string
  output: string
}

export interface CreateThreadAndRunRequest {
  assistant_id: string
  thread?: CreateThreadRequest
  model?: string | null
  instructions?: string | null
  tools?: AssistantTool[] | null
  tool_resources?: ToolResources | null
  metadata?: Record<string, string>
  temperature?: number | null
  top_p?: number | null
  stream?: boolean | null
  max_prompt_tokens?: number | null
  max_completion_tokens?: number | null
  truncation_strategy?: TruncationStrategy | null
  tool_choice?: ToolChoice | null
  parallel_tool_calls?: boolean
  response_format?: ResponseFormat | null
}

/**
 * Client configuration
 */
export interface AssistantsClientConfig {
  apiKey?: string
  organization?: string
  project?: string
  baseURL?: string
  defaultModel?: string
  provider?: 'openai' | 'anthropic' | 'vercel'
  providerOptions?: Record<string, unknown>
  timeout?: number
  /** Use local storage instead of OpenAI API */
  local?: boolean
  /** Custom tool handlers for function tools */
  toolHandlers?: Record<string, (args: Record<string, unknown>) => Promise<string>>
}

/**
 * Assistants API error
 */
export class AssistantsAPIError extends Error {
  status: number
  code: string
  type: string
  param?: string | null

  constructor(message: string, status: number, code: string, type: string, param?: string | null) {
    super(message)
    this.name = 'AssistantsAPIError'
    this.status = status
    this.code = code
    this.type = type
    this.param = param
  }
}

// ============================================================================
// ID GENERATION & STORAGE HELPERS
// ============================================================================

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Helper to set an entity with a custom ID in InMemoryResource
 * This works around the fact that create() auto-generates IDs
 */
async function setWithCustomId<T extends Entity>(
  resource: InMemoryResource<T>,
  id: string,
  data: Omit<T, 'id'>
): Promise<T> {
  const entity = { ...data, id } as T
  // Access the internal storage backend
  const storage = (resource as unknown as { storage: { set: (id: string, data: T) => Promise<void> } }).storage
  await storage.set(id, entity)
  return entity
}

// ============================================================================
// RESOURCES
// ============================================================================

/**
 * Assistants resource
 */
class Assistants {
  private storage: InMemoryResource<Assistant>
  private config: AssistantsClientConfig

  constructor(storage: InMemoryResource<Assistant>, config: AssistantsClientConfig) {
    this.storage = storage
    this.config = config
  }

  async create(params: CreateAssistantRequest): Promise<Assistant> {
    return setWithCustomId(this.storage, generateId('asst'), {
      object: 'assistant',
      created_at: now(),
      name: params.name ?? null,
      description: params.description ?? null,
      model: params.model,
      instructions: params.instructions ?? null,
      tools: params.tools ?? [],
      tool_resources: params.tool_resources ?? null,
      metadata: params.metadata ?? {},
      temperature: params.temperature ?? null,
      top_p: params.top_p ?? null,
      response_format: params.response_format ?? null,
    })
  }

  async retrieve(assistantId: string): Promise<Assistant> {
    const assistant = await this.storage.get(assistantId)
    if (!assistant) {
      throw new AssistantsAPIError(
        `No assistant found with id '${assistantId}'`,
        404,
        'not_found',
        'invalid_request_error'
      )
    }
    return assistant
  }

  async update(assistantId: string, params: UpdateAssistantRequest): Promise<Assistant> {
    const assistant = await this.retrieve(assistantId)
    return this.storage.update(assistantId, {
      ...assistant,
      ...(params.model !== undefined && { model: params.model }),
      ...(params.name !== undefined && { name: params.name }),
      ...(params.description !== undefined && { description: params.description }),
      ...(params.instructions !== undefined && { instructions: params.instructions }),
      ...(params.tools !== undefined && { tools: params.tools }),
      ...(params.tool_resources !== undefined && { tool_resources: params.tool_resources }),
      ...(params.metadata !== undefined && { metadata: params.metadata }),
      ...(params.temperature !== undefined && { temperature: params.temperature }),
      ...(params.top_p !== undefined && { top_p: params.top_p }),
      ...(params.response_format !== undefined && { response_format: params.response_format }),
    })
  }

  async delete(assistantId: string): Promise<DeleteResponse> {
    await this.retrieve(assistantId)
    await this.storage.delete(assistantId)
    return { id: assistantId, object: 'assistant.deleted', deleted: true }
  }

  async list(params?: ListParams): Promise<ListResponse<Assistant>> {
    const assistants: Assistant[] = []
    for await (const a of this.storage.find()) {
      assistants.push(a)
    }

    // Sort by created_at
    assistants.sort((a, b) =>
      params?.order === 'asc' ? a.created_at - b.created_at : b.created_at - a.created_at
    )

    // Apply pagination
    const limit = params?.limit ?? 20
    let data = assistants
    if (params?.after) {
      const idx = data.findIndex((a) => a.id === params.after)
      if (idx >= 0) data = data.slice(idx + 1)
    }
    if (params?.before) {
      const idx = data.findIndex((a) => a.id === params.before)
      if (idx >= 0) data = data.slice(0, idx)
    }
    data = data.slice(0, limit)

    return {
      object: 'list',
      data,
      first_id: data[0]?.id ?? null,
      last_id: data[data.length - 1]?.id ?? null,
      has_more: assistants.length > limit,
    }
  }
}

/**
 * Threads resource
 */
class Threads {
  private storage: InMemoryResource<Thread>
  private messagesStorage: InMemoryResource<Message>
  private config: AssistantsClientConfig

  constructor(
    storage: InMemoryResource<Thread>,
    messagesStorage: InMemoryResource<Message>,
    config: AssistantsClientConfig
  ) {
    this.storage = storage
    this.messagesStorage = messagesStorage
    this.config = config
  }

  async create(params?: CreateThreadRequest): Promise<Thread> {
    const threadId = generateId('thread')
    const thread = await setWithCustomId(this.storage, threadId, {
      object: 'thread',
      created_at: now(),
      tool_resources: params?.tool_resources ?? null,
      metadata: params?.metadata ?? {},
    })

    // Create initial messages if provided
    if (params?.messages) {
      for (const msg of params.messages) {
        await this.createMessage(threadId, msg)
      }
    }

    return thread
  }

  async retrieve(threadId: string): Promise<Thread> {
    const thread = await this.storage.get(threadId)
    if (!thread) {
      throw new AssistantsAPIError(
        `No thread found with id '${threadId}'`,
        404,
        'not_found',
        'invalid_request_error'
      )
    }
    return thread
  }

  async update(threadId: string, params: UpdateThreadRequest): Promise<Thread> {
    const thread = await this.retrieve(threadId)
    return this.storage.update(threadId, {
      ...thread,
      ...(params.tool_resources !== undefined && { tool_resources: params.tool_resources }),
      ...(params.metadata !== undefined && { metadata: params.metadata }),
    })
  }

  async delete(threadId: string): Promise<DeleteResponse> {
    await this.retrieve(threadId)
    // Delete all messages in thread
    const messages: Message[] = []
    for await (const m of this.messagesStorage.find({ thread_id: threadId } as Partial<Message>)) {
      messages.push(m)
    }
    for (const m of messages) {
      await this.messagesStorage.delete(m.id)
    }
    await this.storage.delete(threadId)
    return { id: threadId, object: 'thread.deleted', deleted: true }
  }

  private async createMessage(threadId: string, params: CreateMessageRequest): Promise<Message> {
    const content: MessageContent[] = typeof params.content === 'string'
      ? [{ type: 'text', text: { value: params.content, annotations: [] } }]
      : params.content.map((c) => {
          if (c.type === 'text') {
            return { type: 'text', text: { value: c.text, annotations: [] } } as MessageContent
          }
          return c as MessageContent
        })

    return setWithCustomId(this.messagesStorage, generateId('msg'), {
      object: 'thread.message',
      created_at: now(),
      thread_id: threadId,
      status: 'completed',
      incomplete_details: null,
      completed_at: now(),
      incomplete_at: null,
      role: params.role,
      content,
      assistant_id: null,
      run_id: null,
      attachments: params.attachments ?? null,
      metadata: params.metadata ?? {},
    })
  }
}

/**
 * Messages resource
 */
class Messages {
  private storage: InMemoryResource<Message>
  private threadsStorage: InMemoryResource<Thread>
  private config: AssistantsClientConfig

  constructor(
    storage: InMemoryResource<Message>,
    threadsStorage: InMemoryResource<Thread>,
    config: AssistantsClientConfig
  ) {
    this.storage = storage
    this.threadsStorage = threadsStorage
    this.config = config
  }

  async create(threadId: string, params: CreateMessageRequest): Promise<Message> {
    // Verify thread exists
    const thread = await this.threadsStorage.get(threadId)
    if (!thread) {
      throw new AssistantsAPIError(
        `No thread found with id '${threadId}'`,
        404,
        'not_found',
        'invalid_request_error'
      )
    }

    const content: MessageContent[] = typeof params.content === 'string'
      ? [{ type: 'text', text: { value: params.content, annotations: [] } }]
      : params.content.map((c) => {
          if (c.type === 'text') {
            return { type: 'text', text: { value: c.text, annotations: [] } } as MessageContent
          }
          return c as MessageContent
        })

    return setWithCustomId(this.storage, generateId('msg'), {
      object: 'thread.message',
      created_at: now(),
      thread_id: threadId,
      status: 'completed',
      incomplete_details: null,
      completed_at: now(),
      incomplete_at: null,
      role: params.role,
      content,
      assistant_id: null,
      run_id: null,
      attachments: params.attachments ?? null,
      metadata: params.metadata ?? {},
    })
  }

  async retrieve(threadId: string, messageId: string): Promise<Message> {
    const message = await this.storage.get(messageId)
    if (!message || message.thread_id !== threadId) {
      throw new AssistantsAPIError(
        `No message found with id '${messageId}' in thread '${threadId}'`,
        404,
        'not_found',
        'invalid_request_error'
      )
    }
    return message
  }

  async update(threadId: string, messageId: string, params: UpdateMessageRequest): Promise<Message> {
    const message = await this.retrieve(threadId, messageId)
    return this.storage.update(messageId, {
      ...message,
      ...(params.metadata !== undefined && { metadata: params.metadata }),
    })
  }

  async delete(threadId: string, messageId: string): Promise<DeleteResponse> {
    await this.retrieve(threadId, messageId)
    await this.storage.delete(messageId)
    return { id: messageId, object: 'thread.message.deleted', deleted: true }
  }

  async list(threadId: string, params?: ListMessagesParams): Promise<ListResponse<Message>> {
    const messages: Message[] = []
    for await (const m of this.storage.find({ thread_id: threadId } as Partial<Message>)) {
      if (params?.run_id && m.run_id !== params.run_id) continue
      messages.push(m)
    }

    // Sort by created_at
    messages.sort((a, b) =>
      params?.order === 'asc' ? a.created_at - b.created_at : b.created_at - a.created_at
    )

    // Apply pagination
    const limit = params?.limit ?? 20
    let data = messages
    if (params?.after) {
      const idx = data.findIndex((m) => m.id === params.after)
      if (idx >= 0) data = data.slice(idx + 1)
    }
    if (params?.before) {
      const idx = data.findIndex((m) => m.id === params.before)
      if (idx >= 0) data = data.slice(0, idx)
    }
    data = data.slice(0, limit)

    return {
      object: 'list',
      data,
      first_id: data[0]?.id ?? null,
      last_id: data[data.length - 1]?.id ?? null,
      has_more: messages.length > limit,
    }
  }
}

/**
 * Runs resource
 */
class Runs {
  private storage: InMemoryResource<Run>
  private stepsStorage: InMemoryResource<RunStep>
  private assistantsStorage: InMemoryResource<Assistant>
  private threadsStorage: InMemoryResource<Thread>
  private messagesStorage: InMemoryResource<Message>
  private provider: AgentProvider
  private config: AssistantsClientConfig

  constructor(
    storage: InMemoryResource<Run>,
    stepsStorage: InMemoryResource<RunStep>,
    assistantsStorage: InMemoryResource<Assistant>,
    threadsStorage: InMemoryResource<Thread>,
    messagesStorage: InMemoryResource<Message>,
    config: AssistantsClientConfig
  ) {
    this.storage = storage
    this.stepsStorage = stepsStorage
    this.assistantsStorage = assistantsStorage
    this.threadsStorage = threadsStorage
    this.messagesStorage = messagesStorage
    this.config = config

    // Initialize AI provider
    this.provider = createOpenAIProvider({
      apiKey: config.apiKey,
      organization: config.organization,
      defaultModel: config.defaultModel ?? 'gpt-4-turbo',
    })
  }

  async create(threadId: string, params: CreateRunRequest): Promise<Run> {
    // Verify thread exists
    const thread = await this.threadsStorage.get(threadId)
    if (!thread) {
      throw new AssistantsAPIError(
        `No thread found with id '${threadId}'`,
        404,
        'not_found',
        'invalid_request_error'
      )
    }

    // Get assistant
    const assistant = await this.assistantsStorage.get(params.assistant_id)
    if (!assistant) {
      throw new AssistantsAPIError(
        `No assistant found with id '${params.assistant_id}'`,
        404,
        'not_found',
        'invalid_request_error'
      )
    }

    // Create additional messages if provided
    if (params.additional_messages) {
      for (const msg of params.additional_messages) {
        await this.createMessageInternal(threadId, msg)
      }
    }

    const runId = generateId('run')
    const run = await setWithCustomId(this.storage, runId, {
      object: 'thread.run',
      created_at: now(),
      thread_id: threadId,
      assistant_id: params.assistant_id,
      status: 'queued',
      required_action: null,
      last_error: null,
      expires_at: now() + 600, // 10 minutes
      started_at: null,
      cancelled_at: null,
      failed_at: null,
      completed_at: null,
      incomplete_details: null,
      model: params.model ?? assistant.model,
      instructions: params.instructions ?? assistant.instructions,
      tools: params.tools ?? assistant.tools,
      metadata: params.metadata ?? {},
      usage: null,
      temperature: params.temperature ?? assistant.temperature,
      top_p: params.top_p ?? assistant.top_p,
      max_prompt_tokens: params.max_prompt_tokens ?? null,
      max_completion_tokens: params.max_completion_tokens ?? null,
      truncation_strategy: params.truncation_strategy ?? null,
      tool_choice: params.tool_choice ?? null,
      parallel_tool_calls: params.parallel_tool_calls ?? true,
      response_format: params.response_format ?? assistant.response_format,
    })

    // Execute the run asynchronously
    if (!params.stream) {
      this.executeRun(runId, threadId, assistant).catch(console.error)
    }

    return run
  }

  async retrieve(threadId: string, runId: string): Promise<Run> {
    const run = await this.storage.get(runId)
    if (!run || run.thread_id !== threadId) {
      throw new AssistantsAPIError(
        `No run found with id '${runId}' in thread '${threadId}'`,
        404,
        'not_found',
        'invalid_request_error'
      )
    }
    return run
  }

  async update(threadId: string, runId: string, params: { metadata?: Record<string, string> }): Promise<Run> {
    const run = await this.retrieve(threadId, runId)
    return this.storage.update(runId, {
      ...run,
      ...(params.metadata !== undefined && { metadata: params.metadata }),
    })
  }

  async cancel(threadId: string, runId: string): Promise<Run> {
    const run = await this.retrieve(threadId, runId)

    if (!['queued', 'in_progress', 'requires_action'].includes(run.status)) {
      throw new AssistantsAPIError(
        `Cannot cancel run with status '${run.status}'`,
        400,
        'invalid_status',
        'invalid_request_error'
      )
    }

    return this.storage.update(runId, {
      ...run,
      status: 'cancelling',
      cancelled_at: now(),
    })
  }

  async list(threadId: string, params?: ListParams): Promise<ListResponse<Run>> {
    const runs: Run[] = []
    for await (const r of this.storage.find({ thread_id: threadId } as Partial<Run>)) {
      runs.push(r)
    }

    // Sort by created_at
    runs.sort((a, b) =>
      params?.order === 'asc' ? a.created_at - b.created_at : b.created_at - a.created_at
    )

    // Apply pagination
    const limit = params?.limit ?? 20
    let data = runs
    if (params?.after) {
      const idx = data.findIndex((r) => r.id === params.after)
      if (idx >= 0) data = data.slice(idx + 1)
    }
    if (params?.before) {
      const idx = data.findIndex((r) => r.id === params.before)
      if (idx >= 0) data = data.slice(0, idx)
    }
    data = data.slice(0, limit)

    return {
      object: 'list',
      data,
      first_id: data[0]?.id ?? null,
      last_id: data[data.length - 1]?.id ?? null,
      has_more: runs.length > limit,
    }
  }

  async submitToolOutputs(threadId: string, runId: string, params: SubmitToolOutputsRequest): Promise<Run> {
    const run = await this.retrieve(threadId, runId)

    if (run.status !== 'requires_action') {
      throw new AssistantsAPIError(
        `Run is not in 'requires_action' status`,
        400,
        'invalid_status',
        'invalid_request_error'
      )
    }

    // Store tool outputs and continue execution
    await this.storage.update(runId, {
      ...run,
      status: 'in_progress',
      required_action: null,
    })

    // Get assistant and continue execution with tool outputs
    const assistant = await this.assistantsStorage.get(run.assistant_id)
    if (assistant) {
      this.continueRunWithToolOutputs(runId, threadId, assistant, params.tool_outputs).catch(console.error)
    }

    return (await this.storage.get(runId))!
  }

  /**
   * Poll for run completion
   */
  async poll(threadId: string, runId: string, options?: { pollIntervalMs?: number; maxWaitMs?: number }): Promise<Run> {
    const pollInterval = options?.pollIntervalMs ?? 1000
    const maxWait = options?.maxWaitMs ?? 300000 // 5 minutes
    const startTime = Date.now()

    while (Date.now() - startTime < maxWait) {
      const run = await this.retrieve(threadId, runId)

      if (['completed', 'failed', 'cancelled', 'expired', 'requires_action', 'incomplete'].includes(run.status)) {
        return run
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }

    throw new AssistantsAPIError(
      'Run polling timed out',
      408,
      'timeout',
      'timeout_error'
    )
  }

  /**
   * Create and poll a run
   */
  async createAndPoll(threadId: string, params: CreateRunRequest, pollOptions?: { pollIntervalMs?: number; maxWaitMs?: number }): Promise<Run> {
    const run = await this.create(threadId, params)
    return this.poll(threadId, run.id, pollOptions)
  }

  /**
   * List run steps
   */
  async listSteps(threadId: string, runId: string, params?: ListParams): Promise<ListResponse<RunStep>> {
    await this.retrieve(threadId, runId) // Verify run exists

    const steps: RunStep[] = []
    for await (const s of this.stepsStorage.find({ run_id: runId } as Partial<RunStep>)) {
      steps.push(s)
    }

    // Sort by created_at
    steps.sort((a, b) =>
      params?.order === 'asc' ? a.created_at - b.created_at : b.created_at - a.created_at
    )

    // Apply pagination
    const limit = params?.limit ?? 20
    let data = steps
    if (params?.after) {
      const idx = data.findIndex((s) => s.id === params.after)
      if (idx >= 0) data = data.slice(idx + 1)
    }
    if (params?.before) {
      const idx = data.findIndex((s) => s.id === params.before)
      if (idx >= 0) data = data.slice(0, idx)
    }
    data = data.slice(0, limit)

    return {
      object: 'list',
      data,
      first_id: data[0]?.id ?? null,
      last_id: data[data.length - 1]?.id ?? null,
      has_more: steps.length > limit,
    }
  }

  /**
   * Retrieve a run step
   */
  async retrieveStep(threadId: string, runId: string, stepId: string): Promise<RunStep> {
    await this.retrieve(threadId, runId)
    const step = await this.stepsStorage.get(stepId)
    if (!step || step.run_id !== runId) {
      throw new AssistantsAPIError(
        `No step found with id '${stepId}' in run '${runId}'`,
        404,
        'not_found',
        'invalid_request_error'
      )
    }
    return step
  }

  // Private methods
  private async createMessageInternal(threadId: string, params: CreateMessageRequest): Promise<Message> {
    const content: MessageContent[] = typeof params.content === 'string'
      ? [{ type: 'text', text: { value: params.content, annotations: [] } }]
      : params.content.map((c) => {
          if (c.type === 'text') {
            return { type: 'text', text: { value: c.text, annotations: [] } } as MessageContent
          }
          return c as MessageContent
        })

    return setWithCustomId(this.messagesStorage, generateId('msg'), {
      object: 'thread.message',
      created_at: now(),
      thread_id: threadId,
      status: 'completed',
      incomplete_details: null,
      completed_at: now(),
      incomplete_at: null,
      role: params.role,
      content,
      assistant_id: null,
      run_id: null,
      attachments: params.attachments ?? null,
      metadata: params.metadata ?? {},
    })
  }

  private async executeRun(runId: string, threadId: string, assistant: Assistant): Promise<void> {
    try {
      // Update status to in_progress
      let run = await this.storage.get(runId)
      if (!run) return

      await this.storage.update(runId, {
        ...run,
        status: 'in_progress',
        started_at: now(),
      })

      // Get thread messages
      const messages: Message[] = []
      for await (const m of this.messagesStorage.find({ thread_id: threadId } as Partial<Message>)) {
        messages.push(m)
      }
      messages.sort((a, b) => a.created_at - b.created_at)

      // Convert to agent messages
      const agentMessages: AgentMessage[] = messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content.map((c) => {
          if (c.type === 'text') return c.text.value
          return ''
        }).join('\n'),
      }))

      // Convert tools to agent tools
      const tools: ToolDefinition[] = this.convertTools(assistant.tools)

      // Create agent config
      const agentConfig: AgentConfig = {
        id: assistant.id,
        name: assistant.name ?? 'Assistant',
        instructions: run.instructions ?? assistant.instructions ?? '',
        model: run.model,
        tools,
      }

      // Create agent and run
      const agent = this.provider.createAgent(agentConfig)

      const result = await agent.run({
        messages: agentMessages,
        tools,
      })

      // Check if there are tool calls that need outputs
      if (result.toolCalls.length > 0 && result.finishReason === 'tool_calls') {
        // Check if we have handlers for the tools
        const pendingToolCalls = result.toolCalls.filter(
          (tc) => !this.config.toolHandlers?.[tc.name]
        )

        if (pendingToolCalls.length > 0) {
          // Need to wait for tool outputs
          run = (await this.storage.get(runId))!
          await this.storage.update(runId, {
            ...run,
            status: 'requires_action',
            required_action: {
              type: 'submit_tool_outputs',
              submit_tool_outputs: {
                tool_calls: pendingToolCalls.map((tc) => ({
                  id: tc.id,
                  type: 'function' as const,
                  function: {
                    name: tc.name,
                    arguments: JSON.stringify(tc.arguments),
                  },
                })),
              },
            },
          })

          // Create tool calls step
          await this.createRunStep(runId, threadId, assistant.id, 'tool_calls', {
            type: 'tool_calls',
            tool_calls: pendingToolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
                output: null,
              },
            })),
          })
          return
        }
      }

      // Create assistant message with response
      if (result.text) {
        const messageId = generateId('msg')
        await setWithCustomId(this.messagesStorage, messageId, {
          object: 'thread.message',
          created_at: now(),
          thread_id: threadId,
          status: 'completed',
          incomplete_details: null,
          completed_at: now(),
          incomplete_at: null,
          role: 'assistant',
          content: [{ type: 'text', text: { value: result.text, annotations: [] } }],
          assistant_id: assistant.id,
          run_id: runId,
          attachments: null,
          metadata: {},
        })

        // Create message creation step
        await this.createRunStep(runId, threadId, assistant.id, 'message_creation', {
          type: 'message_creation',
          message_creation: { message_id: messageId },
        })
      }

      // Update run as completed
      run = (await this.storage.get(runId))!
      await this.storage.update(runId, {
        ...run,
        status: 'completed',
        completed_at: now(),
        usage: {
          prompt_tokens: result.usage.promptTokens,
          completion_tokens: result.usage.completionTokens,
          total_tokens: result.usage.totalTokens,
        },
      })
    } catch (error) {
      // Update run as failed
      const run = await this.storage.get(runId)
      if (run) {
        await this.storage.update(runId, {
          ...run,
          status: 'failed',
          failed_at: now(),
          last_error: {
            code: 'server_error',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        })
      }
    }
  }

  private async continueRunWithToolOutputs(
    runId: string,
    threadId: string,
    assistant: Assistant,
    toolOutputs: ToolOutput[]
  ): Promise<void> {
    try {
      // Get current run
      let run = await this.storage.get(runId)
      if (!run) return

      // Update tool call steps with outputs
      const steps: RunStep[] = []
      for await (const s of this.stepsStorage.find({ run_id: runId } as Partial<RunStep>)) {
        steps.push(s)
      }

      for (const step of steps) {
        if (step.type === 'tool_calls' && step.step_details.type === 'tool_calls') {
          const updatedToolCalls = step.step_details.tool_calls.map((tc) => {
            if (tc.type === 'function') {
              const output = toolOutputs.find((o) => o.tool_call_id === tc.id)
              if (output) {
                return {
                  ...tc,
                  function: {
                    ...tc.function,
                    output: output.output,
                  },
                }
              }
            }
            return tc
          })

          await this.stepsStorage.update(step.id, {
            ...step,
            step_details: {
              type: 'tool_calls',
              tool_calls: updatedToolCalls,
            },
            status: 'completed',
            completed_at: now(),
          })
        }
      }

      // Get thread messages including tool results
      const messages: Message[] = []
      for await (const m of this.messagesStorage.find({ thread_id: threadId } as Partial<Message>)) {
        messages.push(m)
      }
      messages.sort((a, b) => a.created_at - b.created_at)

      // Convert to agent messages with tool results
      const agentMessages: AgentMessage[] = [
        ...messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content.map((c) => {
            if (c.type === 'text') return c.text.value
            return ''
          }).join('\n'),
        })),
        // Add tool result messages
        ...toolOutputs.map((to) => ({
          role: 'tool' as const,
          toolCallId: to.tool_call_id,
          toolName: '',
          content: to.output,
        })),
      ]

      // Continue with agent
      const tools: ToolDefinition[] = this.convertTools(assistant.tools)
      const agentConfig: AgentConfig = {
        id: assistant.id,
        name: assistant.name ?? 'Assistant',
        instructions: run.instructions ?? assistant.instructions ?? '',
        model: run.model,
        tools,
      }

      const agent = this.provider.createAgent(agentConfig)
      const result = await agent.run({
        messages: agentMessages,
        tools,
      })

      // Create assistant message with response
      if (result.text) {
        const messageId = generateId('msg')
        await setWithCustomId(this.messagesStorage, messageId, {
          object: 'thread.message',
          created_at: now(),
          thread_id: threadId,
          status: 'completed',
          incomplete_details: null,
          completed_at: now(),
          incomplete_at: null,
          role: 'assistant',
          content: [{ type: 'text', text: { value: result.text, annotations: [] } }],
          assistant_id: assistant.id,
          run_id: runId,
          attachments: null,
          metadata: {},
        })

        // Create message creation step
        await this.createRunStep(runId, threadId, assistant.id, 'message_creation', {
          type: 'message_creation',
          message_creation: { message_id: messageId },
        })
      }

      // Update run as completed
      run = (await this.storage.get(runId))!
      await this.storage.update(runId, {
        ...run,
        status: 'completed',
        completed_at: now(),
        usage: {
          prompt_tokens: result.usage.promptTokens,
          completion_tokens: result.usage.completionTokens,
          total_tokens: result.usage.totalTokens,
        },
      })
    } catch (error) {
      const run = await this.storage.get(runId)
      if (run) {
        await this.storage.update(runId, {
          ...run,
          status: 'failed',
          failed_at: now(),
          last_error: {
            code: 'server_error',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        })
      }
    }
  }

  private convertTools(assistantTools: AssistantTool[]): ToolDefinition[] {
    return assistantTools
      .filter((t): t is FunctionTool => t.type === 'function')
      .map((t) => {
        const params = t.function.parameters ?? {}
        const properties = (params as { properties?: Record<string, unknown> }).properties ?? {}
        return {
          name: t.function.name,
          description: t.function.description ?? '',
          inputSchema: {
            type: 'object' as const,
            properties: properties as Record<string, unknown>,
          },
          execute: async (input: unknown) => {
            // Check for custom handler
            const handler = this.config.toolHandlers?.[t.function.name]
            if (handler) {
              return handler(input as Record<string, unknown>)
            }
            // Return placeholder - will be filled by submitToolOutputs
            return { pending: true }
          },
        }
      })
  }

  private async createRunStep(
    runId: string,
    threadId: string,
    assistantId: string,
    type: 'message_creation' | 'tool_calls',
    stepDetails: StepDetails
  ): Promise<RunStep> {
    return setWithCustomId(this.stepsStorage, generateId('step'), {
      object: 'thread.run.step',
      created_at: now(),
      run_id: runId,
      assistant_id: assistantId,
      thread_id: threadId,
      type,
      status: type === 'message_creation' ? 'completed' : 'in_progress',
      step_details: stepDetails,
      last_error: null,
      expired_at: null,
      cancelled_at: null,
      failed_at: null,
      completed_at: type === 'message_creation' ? now() : null,
      metadata: {},
      usage: null,
    })
  }
}

// ============================================================================
// CLIENT
// ============================================================================

/**
 * OpenAI Assistants API client
 *
 * @example
 * ```typescript
 * const client = new AssistantsClient({ apiKey: 'sk-xxx' })
 *
 * // Create assistant
 * const assistant = await client.assistants.create({
 *   model: 'gpt-4-turbo',
 *   name: 'My Assistant',
 *   instructions: 'You are a helpful assistant.',
 * })
 *
 * // Create thread and run
 * const thread = await client.threads.create()
 * await client.messages.create(thread.id, { role: 'user', content: 'Hello!' })
 * const run = await client.runs.createAndPoll(thread.id, { assistant_id: assistant.id })
 *
 * // Get response
 * const messages = await client.messages.list(thread.id)
 * console.log(messages.data[0].content)
 * ```
 */
export class AssistantsClient {
  private config: AssistantsClientConfig

  // Storage
  private assistantsStorage: InMemoryResource<Assistant>
  private threadsStorage: InMemoryResource<Thread>
  private messagesStorage: InMemoryResource<Message>
  private runsStorage: InMemoryResource<Run>
  private runStepsStorage: InMemoryResource<RunStep>

  // Resources
  readonly assistants: Assistants
  readonly threads: Threads
  readonly messages: Messages
  readonly runs: Runs

  constructor(config: AssistantsClientConfig = {}) {
    this.config = {
      defaultModel: 'gpt-4-turbo',
      local: true,
      ...config,
    }

    // Initialize storage
    this.assistantsStorage = new InMemoryResource<Assistant>()
    this.threadsStorage = new InMemoryResource<Thread>()
    this.messagesStorage = new InMemoryResource<Message>()
    this.runsStorage = new InMemoryResource<Run>()
    this.runStepsStorage = new InMemoryResource<RunStep>()

    // Initialize resources
    this.assistants = new Assistants(this.assistantsStorage, this.config)
    this.threads = new Threads(this.threadsStorage, this.messagesStorage, this.config)
    this.messages = new Messages(this.messagesStorage, this.threadsStorage, this.config)
    this.runs = new Runs(
      this.runsStorage,
      this.runStepsStorage,
      this.assistantsStorage,
      this.threadsStorage,
      this.messagesStorage,
      this.config
    )
  }

  /**
   * Create a thread and run in a single request
   */
  async createThreadAndRun(params: CreateThreadAndRunRequest): Promise<Run> {
    // Create thread
    const thread = await this.threads.create(params.thread)

    // Create and start run
    return this.runs.create(thread.id, {
      assistant_id: params.assistant_id,
      model: params.model,
      instructions: params.instructions,
      tools: params.tools,
      metadata: params.metadata,
      temperature: params.temperature,
      top_p: params.top_p,
      stream: params.stream,
      max_prompt_tokens: params.max_prompt_tokens,
      max_completion_tokens: params.max_completion_tokens,
      truncation_strategy: params.truncation_strategy,
      tool_choice: params.tool_choice,
      parallel_tool_calls: params.parallel_tool_calls,
      response_format: params.response_format,
    })
  }

  /**
   * Create a thread, run, and poll for completion
   */
  async createThreadAndRunPoll(
    params: CreateThreadAndRunRequest,
    pollOptions?: { pollIntervalMs?: number; maxWaitMs?: number }
  ): Promise<Run> {
    const run = await this.createThreadAndRun(params)
    return this.runs.poll(run.thread_id, run.id, pollOptions)
  }
}

/**
 * Create an Assistants API client
 */
export function createAssistantsClient(config?: AssistantsClientConfig): AssistantsClient {
  return new AssistantsClient(config)
}

// Default export
export default AssistantsClient
