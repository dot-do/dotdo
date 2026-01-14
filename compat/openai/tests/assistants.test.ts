/**
 * @dotdo/openai - OpenAI Assistants API Compatibility Layer Tests
 *
 * Tests for the OpenAI Assistants API v2 compatibility layer including:
 * - Assistant lifecycle (create, get, update, delete, list)
 * - Thread management
 * - Message creation and retrieval
 * - Run execution and polling
 * - Tool outputs and function calling
 * - Streaming responses
 *
 * Following TDD: RED (failing tests) -> GREEN (implementation) -> REFACTOR
 *
 * @see https://platform.openai.com/docs/api-reference/assistants
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpenAI, OpenAIError } from '../index'

// =============================================================================
// Type Definitions for Assistants API v2
// =============================================================================

// These types will eventually be exported from the main module
interface Assistant {
  id: string
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
  response_format: 'auto' | { type: 'text' | 'json_object' }
}

interface AssistantTool {
  type: 'code_interpreter' | 'file_search' | 'function'
  function?: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

interface ToolResources {
  code_interpreter?: {
    file_ids: string[]
  }
  file_search?: {
    vector_store_ids: string[]
  }
}

interface Thread {
  id: string
  object: 'thread'
  created_at: number
  tool_resources: ToolResources | null
  metadata: Record<string, string>
}

interface Message {
  id: string
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
  attachments: MessageAttachment[] | null
  metadata: Record<string, string>
}

interface MessageContent {
  type: 'text' | 'image_file' | 'image_url'
  text?: {
    value: string
    annotations: TextAnnotation[]
  }
  image_file?: {
    file_id: string
    detail?: 'auto' | 'low' | 'high'
  }
  image_url?: {
    url: string
    detail?: 'auto' | 'low' | 'high'
  }
}

interface TextAnnotation {
  type: 'file_citation' | 'file_path'
  text: string
  start_index: number
  end_index: number
  file_citation?: {
    file_id: string
    quote?: string
  }
  file_path?: {
    file_id: string
  }
}

interface MessageAttachment {
  file_id: string
  tools: Array<{ type: 'code_interpreter' | 'file_search' }>
}

interface Run {
  id: string
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
  tool_resources: ToolResources | null
  metadata: Record<string, string>
  usage: RunUsage | null
  temperature: number | null
  top_p: number | null
  max_prompt_tokens: number | null
  max_completion_tokens: number | null
  truncation_strategy: TruncationStrategy
  response_format: 'auto' | { type: 'text' | 'json_object' }
  tool_choice: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } }
  parallel_tool_calls: boolean
}

type RunStatus =
  | 'queued'
  | 'in_progress'
  | 'requires_action'
  | 'cancelling'
  | 'cancelled'
  | 'failed'
  | 'completed'
  | 'incomplete'
  | 'expired'

interface RequiredAction {
  type: 'submit_tool_outputs'
  submit_tool_outputs: {
    tool_calls: ToolCall[]
  }
}

interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

interface RunError {
  code: 'server_error' | 'rate_limit_exceeded' | 'invalid_prompt'
  message: string
}

interface RunUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

interface TruncationStrategy {
  type: 'auto' | 'last_messages'
  last_messages?: number
}

interface RunStep {
  id: string
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
  usage: RunUsage | null
}

type StepDetails =
  | { type: 'message_creation'; message_creation: { message_id: string } }
  | { type: 'tool_calls'; tool_calls: ToolCallDetails[] }

interface ToolCallDetails {
  id: string
  type: 'code_interpreter' | 'file_search' | 'function'
  code_interpreter?: {
    input: string
    outputs: CodeInterpreterOutput[]
  }
  file_search?: {
    ranking_options?: {
      ranker: string
      score_threshold: number
    }
    results?: FileSearchResult[]
  }
  function?: {
    name: string
    arguments: string
    output: string | null
  }
}

interface CodeInterpreterOutput {
  type: 'logs' | 'image'
  logs?: string
  image?: { file_id: string }
}

interface FileSearchResult {
  file_id: string
  file_name: string
  score: number
  content: Array<{ type: 'text'; text: string }>
}

interface ListResponse<T> {
  object: 'list'
  data: T[]
  first_id: string | null
  last_id: string | null
  has_more: boolean
}

// =============================================================================
// Test Helpers
// =============================================================================

function createMockFetch(responses: Map<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const urlObj = new URL(url)
    const method = options?.method ?? 'GET'
    const key = `${method} ${urlObj.pathname}`

    const mockResponse = responses.get(key)
    if (!mockResponse) {
      return {
        ok: false,
        status: 404,
        headers: new Headers({ 'x-request-id': 'req_mock', 'openai-version': '2020-10-01' }),
        json: async () => ({
          error: { type: 'invalid_request_error', message: `No mock for ${key}` },
        }),
      }
    }

    return {
      ok: mockResponse.status >= 200 && mockResponse.status < 300,
      status: mockResponse.status,
      headers: new Headers({ 'x-request-id': 'req_mock', 'openai-version': '2020-10-01' }),
      json: async () => mockResponse.body,
    }
  })
}

function mockAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    id: 'asst_test123',
    object: 'assistant',
    created_at: Math.floor(Date.now() / 1000),
    name: 'Test Assistant',
    description: 'A test assistant',
    model: 'gpt-4-turbo',
    instructions: 'You are a helpful assistant.',
    tools: [],
    tool_resources: null,
    metadata: {},
    temperature: 1.0,
    top_p: 1.0,
    response_format: 'auto',
    ...overrides,
  }
}

function mockThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread_test123',
    object: 'thread',
    created_at: Math.floor(Date.now() / 1000),
    tool_resources: null,
    metadata: {},
    ...overrides,
  }
}

function mockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg_test123',
    object: 'thread.message',
    created_at: Math.floor(Date.now() / 1000),
    thread_id: 'thread_test123',
    status: 'completed',
    incomplete_details: null,
    completed_at: Math.floor(Date.now() / 1000),
    incomplete_at: null,
    role: 'user',
    content: [
      {
        type: 'text',
        text: { value: 'Hello, assistant!', annotations: [] },
      },
    ],
    assistant_id: null,
    run_id: null,
    attachments: null,
    metadata: {},
    ...overrides,
  }
}

function mockRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run_test123',
    object: 'thread.run',
    created_at: Math.floor(Date.now() / 1000),
    thread_id: 'thread_test123',
    assistant_id: 'asst_test123',
    status: 'completed',
    required_action: null,
    last_error: null,
    expires_at: null,
    started_at: Math.floor(Date.now() / 1000),
    cancelled_at: null,
    failed_at: null,
    completed_at: Math.floor(Date.now() / 1000),
    incomplete_details: null,
    model: 'gpt-4-turbo',
    instructions: 'You are a helpful assistant.',
    tools: [],
    tool_resources: null,
    metadata: {},
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    temperature: 1.0,
    top_p: 1.0,
    max_prompt_tokens: null,
    max_completion_tokens: null,
    truncation_strategy: { type: 'auto' },
    response_format: 'auto',
    tool_choice: 'auto',
    parallel_tool_calls: true,
    ...overrides,
  }
}

function mockRunStep(overrides: Partial<RunStep> = {}): RunStep {
  return {
    id: 'step_test123',
    object: 'thread.run.step',
    created_at: Math.floor(Date.now() / 1000),
    run_id: 'run_test123',
    assistant_id: 'asst_test123',
    thread_id: 'thread_test123',
    type: 'message_creation',
    status: 'completed',
    step_details: {
      type: 'message_creation',
      message_creation: { message_id: 'msg_test456' },
    },
    last_error: null,
    expired_at: null,
    cancelled_at: null,
    failed_at: null,
    completed_at: Math.floor(Date.now() / 1000),
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    ...overrides,
  }
}

function mockListResponse<T>(data: T[], hasMore = false): ListResponse<T> {
  return {
    object: 'list',
    data,
    first_id: data.length > 0 ? (data[0] as { id: string }).id : null,
    last_id: data.length > 0 ? (data[data.length - 1] as { id: string }).id : null,
    has_more: hasMore,
  }
}

// =============================================================================
// Assistant Lifecycle Tests
// =============================================================================

describe('@dotdo/openai - Assistants API', () => {
  describe('Assistant Lifecycle', () => {
    describe('create', () => {
      it('should create an assistant with required parameters', async () => {
        const expected = mockAssistant()
        const mockFetch = createMockFetch(
          new Map([['POST /v1/assistants', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const assistant = await client.beta.assistants.create({
          model: 'gpt-4-turbo',
          name: 'Test Assistant',
        })

        expect(assistant.id).toBe('asst_test123')
        expect(assistant.object).toBe('assistant')
        expect(assistant.model).toBe('gpt-4-turbo')
        expect(assistant.name).toBe('Test Assistant')
      })

      it('should create an assistant with instructions', async () => {
        const expected = mockAssistant({ instructions: 'You are a coding expert.' })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/assistants', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const assistant = await client.beta.assistants.create({
          model: 'gpt-4-turbo',
          instructions: 'You are a coding expert.',
        })

        expect(assistant.instructions).toBe('You are a coding expert.')
      })

      it('should create an assistant with tools', async () => {
        const expected = mockAssistant({
          tools: [
            { type: 'code_interpreter' },
            { type: 'file_search' },
          ],
        })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/assistants', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const assistant = await client.beta.assistants.create({
          model: 'gpt-4-turbo',
          tools: [{ type: 'code_interpreter' }, { type: 'file_search' }],
        })

        expect(assistant.tools).toHaveLength(2)
        expect(assistant.tools[0].type).toBe('code_interpreter')
        expect(assistant.tools[1].type).toBe('file_search')
      })

      it('should create an assistant with function tools', async () => {
        const expected = mockAssistant({
          tools: [
            {
              type: 'function',
              function: {
                name: 'get_weather',
                description: 'Get weather for a location',
                parameters: {
                  type: 'object',
                  properties: { location: { type: 'string' } },
                  required: ['location'],
                },
              },
            },
          ],
        })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/assistants', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const assistant = await client.beta.assistants.create({
          model: 'gpt-4-turbo',
          tools: [
            {
              type: 'function',
              function: {
                name: 'get_weather',
                description: 'Get weather for a location',
                parameters: {
                  type: 'object',
                  properties: { location: { type: 'string' } },
                  required: ['location'],
                },
              },
            },
          ],
        })

        expect(assistant.tools[0].type).toBe('function')
        expect(assistant.tools[0].function?.name).toBe('get_weather')
      })

      it('should create an assistant with tool_resources', async () => {
        const expected = mockAssistant({
          tool_resources: {
            code_interpreter: { file_ids: ['file_123', 'file_456'] },
            file_search: { vector_store_ids: ['vs_789'] },
          },
        })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/assistants', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const assistant = await client.beta.assistants.create({
          model: 'gpt-4-turbo',
          tools: [{ type: 'code_interpreter' }, { type: 'file_search' }],
          tool_resources: {
            code_interpreter: { file_ids: ['file_123', 'file_456'] },
            file_search: { vector_store_ids: ['vs_789'] },
          },
        })

        expect(assistant.tool_resources?.code_interpreter?.file_ids).toHaveLength(2)
        expect(assistant.tool_resources?.file_search?.vector_store_ids).toHaveLength(1)
      })

      it('should create an assistant with metadata', async () => {
        const expected = mockAssistant({ metadata: { project: 'test', version: '1.0' } })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/assistants', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const assistant = await client.beta.assistants.create({
          model: 'gpt-4-turbo',
          metadata: { project: 'test', version: '1.0' },
        })

        expect(assistant.metadata.project).toBe('test')
        expect(assistant.metadata.version).toBe('1.0')
      })

      it('should create an assistant with temperature and top_p', async () => {
        const expected = mockAssistant({ temperature: 0.7, top_p: 0.9 })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/assistants', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const assistant = await client.beta.assistants.create({
          model: 'gpt-4-turbo',
          temperature: 0.7,
          top_p: 0.9,
        })

        expect(assistant.temperature).toBe(0.7)
        expect(assistant.top_p).toBe(0.9)
      })

      it('should create an assistant with response_format', async () => {
        const expected = mockAssistant({ response_format: { type: 'json_object' } })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/assistants', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const assistant = await client.beta.assistants.create({
          model: 'gpt-4-turbo',
          response_format: { type: 'json_object' },
        })

        expect(assistant.response_format).toEqual({ type: 'json_object' })
      })
    })

    describe('retrieve', () => {
      it('should retrieve an assistant by ID', async () => {
        const expected = mockAssistant({ id: 'asst_abc123' })
        const mockFetch = createMockFetch(
          new Map([['GET /v1/assistants/asst_abc123', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const assistant = await client.beta.assistants.retrieve('asst_abc123')

        expect(assistant.id).toBe('asst_abc123')
        expect(assistant.object).toBe('assistant')
      })

      it('should throw error for non-existent assistant', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'GET /v1/assistants/asst_nonexistent',
              {
                status: 404,
                body: {
                  error: {
                    type: 'invalid_request_error',
                    message: 'No assistant found with id asst_nonexistent',
                    code: 'assistant_not_found',
                  },
                },
              },
            ],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })

        await expect(client.beta.assistants.retrieve('asst_nonexistent')).rejects.toThrow(OpenAIError)
      })
    })

    describe('update', () => {
      it('should update an assistant', async () => {
        const expected = mockAssistant({ id: 'asst_abc123', name: 'Updated Name' })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/assistants/asst_abc123', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const assistant = await client.beta.assistants.update('asst_abc123', {
          name: 'Updated Name',
        })

        expect(assistant.id).toBe('asst_abc123')
        expect(assistant.name).toBe('Updated Name')
      })

      it('should update assistant instructions', async () => {
        const expected = mockAssistant({ instructions: 'New instructions' })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/assistants/asst_abc123', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const assistant = await client.beta.assistants.update('asst_abc123', {
          instructions: 'New instructions',
        })

        expect(assistant.instructions).toBe('New instructions')
      })

      it('should update assistant tools', async () => {
        const expected = mockAssistant({
          tools: [{ type: 'code_interpreter' }],
        })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/assistants/asst_abc123', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const assistant = await client.beta.assistants.update('asst_abc123', {
          tools: [{ type: 'code_interpreter' }],
        })

        expect(assistant.tools).toHaveLength(1)
      })
    })

    describe('delete', () => {
      it('should delete an assistant', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'DELETE /v1/assistants/asst_abc123',
              {
                status: 200,
                body: { id: 'asst_abc123', object: 'assistant.deleted', deleted: true },
              },
            ],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const result = await client.beta.assistants.del('asst_abc123')

        expect(result.deleted).toBe(true)
        expect(result.id).toBe('asst_abc123')
      })

      it('should throw error when deleting non-existent assistant', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'DELETE /v1/assistants/asst_nonexistent',
              {
                status: 404,
                body: {
                  error: {
                    type: 'invalid_request_error',
                    message: 'No assistant found with id asst_nonexistent',
                  },
                },
              },
            ],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })

        await expect(client.beta.assistants.del('asst_nonexistent')).rejects.toThrow(OpenAIError)
      })
    })

    describe('list', () => {
      it('should list assistants', async () => {
        const expected = mockListResponse([
          mockAssistant({ id: 'asst_1' }),
          mockAssistant({ id: 'asst_2' }),
          mockAssistant({ id: 'asst_3' }),
        ])
        const mockFetch = createMockFetch(
          new Map([['GET /v1/assistants', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const response = await client.beta.assistants.list()

        expect(response.object).toBe('list')
        expect(response.data).toHaveLength(3)
      })

      it('should list assistants with pagination', async () => {
        const expected = mockListResponse(
          [mockAssistant({ id: 'asst_1' }), mockAssistant({ id: 'asst_2' })],
          true
        )
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => expected,
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const response = await client.beta.assistants.list({ limit: 2 })

        expect(response.data).toHaveLength(2)
        expect(response.has_more).toBe(true)

        const [, options] = mockFetch.mock.calls[0]
        // GET is explicit or undefined (both work for fetch default)
        expect(options?.method ?? 'GET').toBe('GET')
      })

      it('should support order parameter', async () => {
        const expected = mockListResponse([mockAssistant()])
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => expected,
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        await client.beta.assistants.list({ order: 'asc' })

        const [url] = mockFetch.mock.calls[0]
        expect(url).toContain('order=asc')
      })

      it('should support after cursor for pagination', async () => {
        const expected = mockListResponse([mockAssistant({ id: 'asst_3' })])
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => expected,
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        await client.beta.assistants.list({ after: 'asst_2' })

        const [url] = mockFetch.mock.calls[0]
        expect(url).toContain('after=asst_2')
      })
    })
  })

  // =============================================================================
  // Thread Management Tests
  // =============================================================================

  describe('Thread Management', () => {
    describe('create', () => {
      it('should create an empty thread', async () => {
        const expected = mockThread()
        const mockFetch = createMockFetch(
          new Map([['POST /v1/threads', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const thread = await client.beta.threads.create()

        expect(thread.id).toBe('thread_test123')
        expect(thread.object).toBe('thread')
      })

      it('should create a thread with initial messages', async () => {
        const expected = mockThread()
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => expected,
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        await client.beta.threads.create({
          messages: [
            { role: 'user', content: 'Hello!' },
            { role: 'user', content: 'How are you?' },
          ],
        })

        const [, options] = mockFetch.mock.calls[0]
        const body = JSON.parse(options?.body as string)
        expect(body.messages).toHaveLength(2)
      })

      it('should create a thread with metadata', async () => {
        const expected = mockThread({ metadata: { customer_id: 'cus_123' } })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/threads', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const thread = await client.beta.threads.create({
          metadata: { customer_id: 'cus_123' },
        })

        expect(thread.metadata.customer_id).toBe('cus_123')
      })

      it('should create a thread with tool_resources', async () => {
        const expected = mockThread({
          tool_resources: {
            file_search: { vector_store_ids: ['vs_123'] },
          },
        })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/threads', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const thread = await client.beta.threads.create({
          tool_resources: {
            file_search: { vector_store_ids: ['vs_123'] },
          },
        })

        expect(thread.tool_resources?.file_search?.vector_store_ids).toContain('vs_123')
      })
    })

    describe('retrieve', () => {
      it('should retrieve a thread by ID', async () => {
        const expected = mockThread({ id: 'thread_abc123' })
        const mockFetch = createMockFetch(
          new Map([['GET /v1/threads/thread_abc123', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const thread = await client.beta.threads.retrieve('thread_abc123')

        expect(thread.id).toBe('thread_abc123')
      })

      it('should throw error for non-existent thread', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'GET /v1/threads/thread_nonexistent',
              {
                status: 404,
                body: {
                  error: {
                    type: 'invalid_request_error',
                    message: 'No thread found with id thread_nonexistent',
                  },
                },
              },
            ],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })

        await expect(client.beta.threads.retrieve('thread_nonexistent')).rejects.toThrow(OpenAIError)
      })
    })

    describe('update', () => {
      it('should update thread metadata', async () => {
        const expected = mockThread({ metadata: { status: 'active' } })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/threads/thread_abc123', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const thread = await client.beta.threads.update('thread_abc123', {
          metadata: { status: 'active' },
        })

        expect(thread.metadata.status).toBe('active')
      })

      it('should update thread tool_resources', async () => {
        const expected = mockThread({
          tool_resources: {
            file_search: { vector_store_ids: ['vs_new'] },
          },
        })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/threads/thread_abc123', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const thread = await client.beta.threads.update('thread_abc123', {
          tool_resources: {
            file_search: { vector_store_ids: ['vs_new'] },
          },
        })

        expect(thread.tool_resources?.file_search?.vector_store_ids).toContain('vs_new')
      })
    })

    describe('delete', () => {
      it('should delete a thread', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'DELETE /v1/threads/thread_abc123',
              {
                status: 200,
                body: { id: 'thread_abc123', object: 'thread.deleted', deleted: true },
              },
            ],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const result = await client.beta.threads.del('thread_abc123')

        expect(result.deleted).toBe(true)
      })
    })
  })

  // =============================================================================
  // Message Creation and Retrieval Tests
  // =============================================================================

  describe('Message Management', () => {
    describe('create', () => {
      it('should create a text message', async () => {
        const expected = mockMessage()
        const mockFetch = createMockFetch(
          new Map([['POST /v1/threads/thread_abc123/messages', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const message = await client.beta.threads.messages.create('thread_abc123', {
          role: 'user',
          content: 'Hello, assistant!',
        })

        expect(message.id).toBe('msg_test123')
        expect(message.role).toBe('user')
        expect(message.content[0].text?.value).toBe('Hello, assistant!')
      })

      it('should create a message with content array', async () => {
        const expected = mockMessage({
          content: [
            { type: 'text', text: { value: 'Check this image:', annotations: [] } },
            { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
          ],
        })
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => expected,
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const message = await client.beta.threads.messages.create('thread_abc123', {
          role: 'user',
          content: [
            { type: 'text', text: 'Check this image:' },
            { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
          ],
        })

        expect(message.content).toHaveLength(2)
      })

      it('should create a message with attachments', async () => {
        const expected = mockMessage({
          attachments: [
            { file_id: 'file_123', tools: [{ type: 'code_interpreter' }] },
          ],
        })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/threads/thread_abc123/messages', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const message = await client.beta.threads.messages.create('thread_abc123', {
          role: 'user',
          content: 'Analyze this file',
          attachments: [
            { file_id: 'file_123', tools: [{ type: 'code_interpreter' }] },
          ],
        })

        expect(message.attachments).toHaveLength(1)
        expect(message.attachments?.[0].file_id).toBe('file_123')
      })

      it('should create a message with metadata', async () => {
        const expected = mockMessage({ metadata: { source: 'web' } })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/threads/thread_abc123/messages', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const message = await client.beta.threads.messages.create('thread_abc123', {
          role: 'user',
          content: 'Hello',
          metadata: { source: 'web' },
        })

        expect(message.metadata.source).toBe('web')
      })
    })

    describe('retrieve', () => {
      it('should retrieve a message by ID', async () => {
        const expected = mockMessage({ id: 'msg_abc123' })
        const mockFetch = createMockFetch(
          new Map([
            ['GET /v1/threads/thread_abc123/messages/msg_abc123', { status: 200, body: expected }],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const message = await client.beta.threads.messages.retrieve('thread_abc123', 'msg_abc123')

        expect(message.id).toBe('msg_abc123')
      })

      it('should retrieve message with annotations', async () => {
        const expected = mockMessage({
          content: [
            {
              type: 'text',
              text: {
                value: 'Based on the file[1], here is the answer.',
                annotations: [
                  {
                    type: 'file_citation',
                    text: '[1]',
                    start_index: 18,
                    end_index: 21,
                    file_citation: { file_id: 'file_123' },
                  },
                ],
              },
            },
          ],
        })
        const mockFetch = createMockFetch(
          new Map([
            ['GET /v1/threads/thread_abc123/messages/msg_abc123', { status: 200, body: expected }],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const message = await client.beta.threads.messages.retrieve('thread_abc123', 'msg_abc123')

        expect(message.content[0].text?.annotations).toHaveLength(1)
        expect(message.content[0].text?.annotations[0].type).toBe('file_citation')
      })
    })

    describe('update', () => {
      it('should update message metadata', async () => {
        const expected = mockMessage({ metadata: { reviewed: 'true' } })
        const mockFetch = createMockFetch(
          new Map([
            ['POST /v1/threads/thread_abc123/messages/msg_abc123', { status: 200, body: expected }],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const message = await client.beta.threads.messages.update('thread_abc123', 'msg_abc123', {
          metadata: { reviewed: 'true' },
        })

        expect(message.metadata.reviewed).toBe('true')
      })
    })

    describe('delete', () => {
      it('should delete a message', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'DELETE /v1/threads/thread_abc123/messages/msg_abc123',
              {
                status: 200,
                body: { id: 'msg_abc123', object: 'thread.message.deleted', deleted: true },
              },
            ],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const result = await client.beta.threads.messages.del('thread_abc123', 'msg_abc123')

        expect(result.deleted).toBe(true)
      })
    })

    describe('list', () => {
      it('should list messages in a thread', async () => {
        const expected = mockListResponse([
          mockMessage({ id: 'msg_1', role: 'user' }),
          mockMessage({ id: 'msg_2', role: 'assistant' }),
          mockMessage({ id: 'msg_3', role: 'user' }),
        ])
        const mockFetch = createMockFetch(
          new Map([['GET /v1/threads/thread_abc123/messages', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const response = await client.beta.threads.messages.list('thread_abc123')

        expect(response.data).toHaveLength(3)
      })

      it('should list messages with run_id filter', async () => {
        const expected = mockListResponse([
          mockMessage({ id: 'msg_1', run_id: 'run_123' }),
        ])
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => expected,
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        await client.beta.threads.messages.list('thread_abc123', { run_id: 'run_123' })

        const [url] = mockFetch.mock.calls[0]
        expect(url).toContain('run_id=run_123')
      })

      it('should support pagination', async () => {
        const expected = mockListResponse([mockMessage()], true)
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => expected,
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const response = await client.beta.threads.messages.list('thread_abc123', {
          limit: 10,
          before: 'msg_xyz',
        })

        expect(response.has_more).toBe(true)
      })
    })
  })

  // =============================================================================
  // Run Execution and Polling Tests
  // =============================================================================

  describe('Run Execution', () => {
    describe('create', () => {
      it('should create a run', async () => {
        const expected = mockRun({ status: 'queued' })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/threads/thread_abc123/runs', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const run = await client.beta.threads.runs.create('thread_abc123', {
          assistant_id: 'asst_abc123',
        })

        expect(run.id).toBe('run_test123')
        expect(run.status).toBe('queued')
        expect(run.thread_id).toBe('thread_test123')
      })

      it('should create a run with override instructions', async () => {
        const expected = mockRun({ instructions: 'Custom instructions for this run' })
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => expected,
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        await client.beta.threads.runs.create('thread_abc123', {
          assistant_id: 'asst_abc123',
          instructions: 'Custom instructions for this run',
        })

        const [, options] = mockFetch.mock.calls[0]
        const body = JSON.parse(options?.body as string)
        expect(body.instructions).toBe('Custom instructions for this run')
      })

      it('should create a run with additional_instructions', async () => {
        const expected = mockRun()
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => expected,
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        await client.beta.threads.runs.create('thread_abc123', {
          assistant_id: 'asst_abc123',
          additional_instructions: 'Also be concise.',
        })

        const [, options] = mockFetch.mock.calls[0]
        const body = JSON.parse(options?.body as string)
        expect(body.additional_instructions).toBe('Also be concise.')
      })

      it('should create a run with tool override', async () => {
        const expected = mockRun({
          tools: [{ type: 'code_interpreter' }],
        })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/threads/thread_abc123/runs', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const run = await client.beta.threads.runs.create('thread_abc123', {
          assistant_id: 'asst_abc123',
          tools: [{ type: 'code_interpreter' }],
        })

        expect(run.tools).toHaveLength(1)
      })

      it('should create a run with max tokens configuration', async () => {
        const expected = mockRun({
          max_prompt_tokens: 1000,
          max_completion_tokens: 500,
        })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/threads/thread_abc123/runs', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const run = await client.beta.threads.runs.create('thread_abc123', {
          assistant_id: 'asst_abc123',
          max_prompt_tokens: 1000,
          max_completion_tokens: 500,
        })

        expect(run.max_prompt_tokens).toBe(1000)
        expect(run.max_completion_tokens).toBe(500)
      })

      it('should create a run with truncation strategy', async () => {
        const expected = mockRun({
          truncation_strategy: { type: 'last_messages', last_messages: 10 },
        })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/threads/thread_abc123/runs', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const run = await client.beta.threads.runs.create('thread_abc123', {
          assistant_id: 'asst_abc123',
          truncation_strategy: { type: 'last_messages', last_messages: 10 },
        })

        expect(run.truncation_strategy.type).toBe('last_messages')
        expect(run.truncation_strategy.last_messages).toBe(10)
      })

      it('should create a run with tool_choice', async () => {
        const expected = mockRun({
          tool_choice: { type: 'function', function: { name: 'get_weather' } },
        })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/threads/thread_abc123/runs', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const run = await client.beta.threads.runs.create('thread_abc123', {
          assistant_id: 'asst_abc123',
          tool_choice: { type: 'function', function: { name: 'get_weather' } },
        })

        expect(run.tool_choice).toEqual({ type: 'function', function: { name: 'get_weather' } })
      })

      it('should create a run with parallel_tool_calls disabled', async () => {
        const expected = mockRun({ parallel_tool_calls: false })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/threads/thread_abc123/runs', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const run = await client.beta.threads.runs.create('thread_abc123', {
          assistant_id: 'asst_abc123',
          parallel_tool_calls: false,
        })

        expect(run.parallel_tool_calls).toBe(false)
      })
    })

    describe('retrieve', () => {
      it('should retrieve a run by ID', async () => {
        const expected = mockRun({ id: 'run_abc123', status: 'in_progress' })
        const mockFetch = createMockFetch(
          new Map([
            ['GET /v1/threads/thread_abc123/runs/run_abc123', { status: 200, body: expected }],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const run = await client.beta.threads.runs.retrieve('thread_abc123', 'run_abc123')

        expect(run.id).toBe('run_abc123')
        expect(run.status).toBe('in_progress')
      })

      it('should return run with requires_action status', async () => {
        const expected = mockRun({
          status: 'requires_action',
          required_action: {
            type: 'submit_tool_outputs',
            submit_tool_outputs: {
              tool_calls: [
                {
                  id: 'call_abc123',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{"location":"SF"}' },
                },
              ],
            },
          },
        })
        const mockFetch = createMockFetch(
          new Map([
            ['GET /v1/threads/thread_abc123/runs/run_abc123', { status: 200, body: expected }],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const run = await client.beta.threads.runs.retrieve('thread_abc123', 'run_abc123')

        expect(run.status).toBe('requires_action')
        expect(run.required_action?.submit_tool_outputs.tool_calls).toHaveLength(1)
      })

      it('should return run with failure details', async () => {
        const expected = mockRun({
          status: 'failed',
          last_error: {
            code: 'server_error',
            message: 'An internal error occurred',
          },
        })
        const mockFetch = createMockFetch(
          new Map([
            ['GET /v1/threads/thread_abc123/runs/run_abc123', { status: 200, body: expected }],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const run = await client.beta.threads.runs.retrieve('thread_abc123', 'run_abc123')

        expect(run.status).toBe('failed')
        expect(run.last_error?.code).toBe('server_error')
      })
    })

    describe('update', () => {
      it('should update run metadata', async () => {
        const expected = mockRun({ metadata: { priority: 'high' } })
        const mockFetch = createMockFetch(
          new Map([
            ['POST /v1/threads/thread_abc123/runs/run_abc123', { status: 200, body: expected }],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const run = await client.beta.threads.runs.update('thread_abc123', 'run_abc123', {
          metadata: { priority: 'high' },
        })

        expect(run.metadata.priority).toBe('high')
      })
    })

    describe('cancel', () => {
      it('should cancel a run', async () => {
        const expected = mockRun({ status: 'cancelling' })
        const mockFetch = createMockFetch(
          new Map([
            ['POST /v1/threads/thread_abc123/runs/run_abc123/cancel', { status: 200, body: expected }],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const run = await client.beta.threads.runs.cancel('thread_abc123', 'run_abc123')

        expect(run.status).toBe('cancelling')
      })

      it('should throw error when cancelling completed run', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'POST /v1/threads/thread_abc123/runs/run_abc123/cancel',
              {
                status: 400,
                body: {
                  error: {
                    type: 'invalid_request_error',
                    message: 'Cannot cancel run with status completed',
                  },
                },
              },
            ],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })

        await expect(
          client.beta.threads.runs.cancel('thread_abc123', 'run_abc123')
        ).rejects.toThrow(OpenAIError)
      })
    })

    describe('list', () => {
      it('should list runs in a thread', async () => {
        const expected = mockListResponse([
          mockRun({ id: 'run_1', status: 'completed' }),
          mockRun({ id: 'run_2', status: 'in_progress' }),
        ])
        const mockFetch = createMockFetch(
          new Map([['GET /v1/threads/thread_abc123/runs', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const response = await client.beta.threads.runs.list('thread_abc123')

        expect(response.data).toHaveLength(2)
      })
    })

    describe('createAndPoll', () => {
      it('should create a run and poll until completion', async () => {
        const queuedRun = mockRun({ status: 'queued' })
        const inProgressRun = mockRun({ status: 'in_progress' })
        const completedRun = mockRun({ status: 'completed' })

        let callCount = 0
        const mockFetch = vi.fn(async (url: string, options?: RequestInit) => {
          const urlObj = new URL(url)
          const method = options?.method ?? 'GET'
          const path = urlObj.pathname

          if (method === 'POST' && path.endsWith('/runs')) {
            return {
              ok: true,
              status: 200,
              headers: new Headers(),
              json: async () => queuedRun,
            }
          }

          if (method === 'GET' && path.includes('/runs/')) {
            callCount++
            const run = callCount < 2 ? inProgressRun : completedRun
            return {
              ok: true,
              status: 200,
              headers: new Headers(),
              json: async () => run,
            }
          }

          return {
            ok: false,
            status: 404,
            headers: new Headers(),
            json: async () => ({ error: { message: 'Not found' } }),
          }
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const run = await client.beta.threads.runs.createAndPoll('thread_abc123', {
          assistant_id: 'asst_abc123',
        })

        expect(run.status).toBe('completed')
        expect(callCount).toBeGreaterThanOrEqual(2)
      })

      it('should poll with configurable interval', async () => {
        const completedRun = mockRun({ status: 'completed' })
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => completedRun,
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })

        const startTime = Date.now()
        await client.beta.threads.runs.createAndPoll('thread_abc123', {
          assistant_id: 'asst_abc123',
        }, { pollIntervalMs: 100 })
        const elapsed = Date.now() - startTime

        expect(elapsed).toBeLessThan(500) // Should complete quickly with mock
      })
    })

    describe('poll', () => {
      it('should poll a run until terminal state', async () => {
        let callCount = 0
        const mockFetch = vi.fn(async () => {
          callCount++
          const status = callCount < 3 ? 'in_progress' : 'completed'
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => mockRun({ status: status as RunStatus }),
          }
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const run = await client.beta.threads.runs.poll('thread_abc123', 'run_abc123')

        expect(run.status).toBe('completed')
        expect(callCount).toBe(3)
      })

      it('should stop polling on requires_action', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () =>
            mockRun({
              status: 'requires_action',
              required_action: {
                type: 'submit_tool_outputs',
                submit_tool_outputs: { tool_calls: [] },
              },
            }),
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const run = await client.beta.threads.runs.poll('thread_abc123', 'run_abc123')

        expect(run.status).toBe('requires_action')
      })

      it('should stop polling on failure', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () =>
            mockRun({
              status: 'failed',
              last_error: { code: 'server_error', message: 'Failed' },
            }),
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const run = await client.beta.threads.runs.poll('thread_abc123', 'run_abc123')

        expect(run.status).toBe('failed')
      })
    })
  })

  // =============================================================================
  // Tool Outputs and Function Calling Tests
  // =============================================================================

  describe('Tool Outputs', () => {
    describe('submitToolOutputs', () => {
      it('should submit tool outputs for a run', async () => {
        const expected = mockRun({ status: 'in_progress' })
        const mockFetch = createMockFetch(
          new Map([
            [
              'POST /v1/threads/thread_abc123/runs/run_abc123/submit_tool_outputs',
              { status: 200, body: expected },
            ],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const run = await client.beta.threads.runs.submitToolOutputs('thread_abc123', 'run_abc123', {
          tool_outputs: [
            { tool_call_id: 'call_abc123', output: '{"temperature": 72, "unit": "F"}' },
          ],
        })

        expect(run.status).toBe('in_progress')
      })

      it('should submit multiple tool outputs', async () => {
        const expected = mockRun({ status: 'in_progress' })
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => expected,
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        await client.beta.threads.runs.submitToolOutputs('thread_abc123', 'run_abc123', {
          tool_outputs: [
            { tool_call_id: 'call_1', output: '{"result": "A"}' },
            { tool_call_id: 'call_2', output: '{"result": "B"}' },
            { tool_call_id: 'call_3', output: '{"result": "C"}' },
          ],
        })

        const [, options] = mockFetch.mock.calls[0]
        const body = JSON.parse(options?.body as string)
        expect(body.tool_outputs).toHaveLength(3)
      })

      it('should throw error if tool_call_id is missing', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'POST /v1/threads/thread_abc123/runs/run_abc123/submit_tool_outputs',
              {
                status: 400,
                body: {
                  error: {
                    type: 'invalid_request_error',
                    message: 'Missing required tool_call_id',
                  },
                },
              },
            ],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })

        await expect(
          client.beta.threads.runs.submitToolOutputs('thread_abc123', 'run_abc123', {
            tool_outputs: [{ tool_call_id: '', output: '{}' }],
          })
        ).rejects.toThrow(OpenAIError)
      })

      it('should throw error if run is not in requires_action state', async () => {
        const mockFetch = createMockFetch(
          new Map([
            [
              'POST /v1/threads/thread_abc123/runs/run_abc123/submit_tool_outputs',
              {
                status: 400,
                body: {
                  error: {
                    type: 'invalid_request_error',
                    message: 'Run is not in requires_action status',
                  },
                },
              },
            ],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })

        await expect(
          client.beta.threads.runs.submitToolOutputs('thread_abc123', 'run_abc123', {
            tool_outputs: [{ tool_call_id: 'call_abc123', output: '{}' }],
          })
        ).rejects.toThrow(OpenAIError)
      })
    })

    describe('submitToolOutputsAndPoll', () => {
      it('should submit tool outputs and poll until completion', async () => {
        let callCount = 0
        const mockFetch = vi.fn(async (url: string, options?: RequestInit) => {
          const urlObj = new URL(url)
          const method = options?.method ?? 'GET'
          const path = urlObj.pathname

          if (method === 'POST' && path.includes('/submit_tool_outputs')) {
            return {
              ok: true,
              status: 200,
              headers: new Headers(),
              json: async () => mockRun({ status: 'in_progress' }),
            }
          }

          if (method === 'GET') {
            callCount++
            const status = callCount < 2 ? 'in_progress' : 'completed'
            return {
              ok: true,
              status: 200,
              headers: new Headers(),
              json: async () => mockRun({ status: status as RunStatus }),
            }
          }

          return {
            ok: false,
            status: 404,
            headers: new Headers(),
            json: async () => ({ error: { message: 'Not found' } }),
          }
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const run = await client.beta.threads.runs.submitToolOutputsAndPoll(
          'thread_abc123',
          'run_abc123',
          { tool_outputs: [{ tool_call_id: 'call_abc123', output: '{}' }] }
        )

        expect(run.status).toBe('completed')
      })
    })
  })

  // =============================================================================
  // Run Steps Tests
  // =============================================================================

  describe('Run Steps', () => {
    describe('retrieve', () => {
      it('should retrieve a run step', async () => {
        const expected = mockRunStep()
        const mockFetch = createMockFetch(
          new Map([
            [
              'GET /v1/threads/thread_abc123/runs/run_abc123/steps/step_abc123',
              { status: 200, body: expected },
            ],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const step = await client.beta.threads.runs.steps.retrieve(
          'thread_abc123',
          'run_abc123',
          'step_abc123'
        )

        expect(step.id).toBe('step_test123')
        expect(step.object).toBe('thread.run.step')
      })

      it('should retrieve a message_creation step', async () => {
        const expected = mockRunStep({
          type: 'message_creation',
          step_details: {
            type: 'message_creation',
            message_creation: { message_id: 'msg_abc123' },
          },
        })
        const mockFetch = createMockFetch(
          new Map([
            [
              'GET /v1/threads/thread_abc123/runs/run_abc123/steps/step_abc123',
              { status: 200, body: expected },
            ],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const step = await client.beta.threads.runs.steps.retrieve(
          'thread_abc123',
          'run_abc123',
          'step_abc123'
        )

        expect(step.type).toBe('message_creation')
        expect((step.step_details as { type: 'message_creation'; message_creation: { message_id: string } }).message_creation.message_id).toBe('msg_abc123')
      })

      it('should retrieve a tool_calls step with code_interpreter', async () => {
        const expected = mockRunStep({
          type: 'tool_calls',
          step_details: {
            type: 'tool_calls',
            tool_calls: [
              {
                id: 'call_abc123',
                type: 'code_interpreter',
                code_interpreter: {
                  input: 'print("Hello, World!")',
                  outputs: [{ type: 'logs', logs: 'Hello, World!\n' }],
                },
              },
            ],
          },
        })
        const mockFetch = createMockFetch(
          new Map([
            [
              'GET /v1/threads/thread_abc123/runs/run_abc123/steps/step_abc123',
              { status: 200, body: expected },
            ],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const step = await client.beta.threads.runs.steps.retrieve(
          'thread_abc123',
          'run_abc123',
          'step_abc123'
        )

        expect(step.type).toBe('tool_calls')
        const toolCalls = (step.step_details as { type: 'tool_calls'; tool_calls: ToolCallDetails[] }).tool_calls
        expect(toolCalls[0].type).toBe('code_interpreter')
        expect(toolCalls[0].code_interpreter?.outputs[0].logs).toBe('Hello, World!\n')
      })

      it('should retrieve a tool_calls step with function call', async () => {
        const expected = mockRunStep({
          type: 'tool_calls',
          step_details: {
            type: 'tool_calls',
            tool_calls: [
              {
                id: 'call_abc123',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location": "SF"}',
                  output: '{"temp": 72}',
                },
              },
            ],
          },
        })
        const mockFetch = createMockFetch(
          new Map([
            [
              'GET /v1/threads/thread_abc123/runs/run_abc123/steps/step_abc123',
              { status: 200, body: expected },
            ],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const step = await client.beta.threads.runs.steps.retrieve(
          'thread_abc123',
          'run_abc123',
          'step_abc123'
        )

        const toolCalls = (step.step_details as { type: 'tool_calls'; tool_calls: ToolCallDetails[] }).tool_calls
        expect(toolCalls[0].function?.name).toBe('get_weather')
        expect(toolCalls[0].function?.output).toBe('{"temp": 72}')
      })
    })

    describe('list', () => {
      it('should list run steps', async () => {
        const expected = mockListResponse([
          mockRunStep({ id: 'step_1' }),
          mockRunStep({ id: 'step_2' }),
        ])
        const mockFetch = createMockFetch(
          new Map([
            [
              'GET /v1/threads/thread_abc123/runs/run_abc123/steps',
              { status: 200, body: expected },
            ],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const response = await client.beta.threads.runs.steps.list('thread_abc123', 'run_abc123')

        expect(response.data).toHaveLength(2)
      })

      it('should support pagination', async () => {
        const expected = mockListResponse([mockRunStep()], true)
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => expected,
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const response = await client.beta.threads.runs.steps.list('thread_abc123', 'run_abc123', {
          limit: 10,
          order: 'desc',
        })

        expect(response.has_more).toBe(true)
      })
    })
  })

  // =============================================================================
  // Streaming Responses Tests
  // =============================================================================

  describe('Streaming', () => {
    function createMockSSEStream(events: Array<{ event: string; data: unknown }>) {
      const encoder = new TextEncoder()
      const lines = events.map(
        (e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`
      )
      lines.push('event: done\ndata: [DONE]\n\n')

      let index = 0
      const stream = new ReadableStream({
        pull(controller) {
          if (index < lines.length) {
            controller.enqueue(encoder.encode(lines[index]))
            index++
          } else {
            controller.close()
          }
        },
      })

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream,
      }
    }

    describe('createAndStream', () => {
      it('should create a run and stream events', async () => {
        const mockEvents = [
          { event: 'thread.run.created', data: mockRun({ status: 'queued' }) },
          { event: 'thread.run.queued', data: mockRun({ status: 'queued' }) },
          { event: 'thread.run.in_progress', data: mockRun({ status: 'in_progress' }) },
          {
            event: 'thread.message.delta',
            data: {
              id: 'msg_123',
              object: 'thread.message.delta',
              delta: { content: [{ index: 0, type: 'text', text: { value: 'Hello' } }] },
            },
          },
          { event: 'thread.run.completed', data: mockRun({ status: 'completed' }) },
        ]

        const mockFetch = vi.fn().mockResolvedValue(createMockSSEStream(mockEvents))

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const stream = await client.beta.threads.runs.stream('thread_abc123', {
          assistant_id: 'asst_abc123',
        })

        const events: Array<{ event: string; data: unknown }> = []
        for await (const event of stream) {
          events.push(event)
        }

        expect(events.length).toBeGreaterThan(0)
        expect(events.some((e) => e.event === 'thread.run.completed')).toBe(true)
      })

      it('should emit text delta events', async () => {
        const mockEvents = [
          { event: 'thread.run.created', data: mockRun({ status: 'queued' }) },
          {
            event: 'thread.message.delta',
            data: {
              id: 'msg_123',
              delta: { content: [{ index: 0, type: 'text', text: { value: 'Hello' } }] },
            },
          },
          {
            event: 'thread.message.delta',
            data: {
              id: 'msg_123',
              delta: { content: [{ index: 0, type: 'text', text: { value: ' World!' } }] },
            },
          },
          { event: 'thread.run.completed', data: mockRun({ status: 'completed' }) },
        ]

        const mockFetch = vi.fn().mockResolvedValue(createMockSSEStream(mockEvents))

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const stream = await client.beta.threads.runs.stream('thread_abc123', {
          assistant_id: 'asst_abc123',
        })

        const textDeltas: string[] = []
        for await (const event of stream) {
          if (event.event === 'thread.message.delta') {
            const delta = event.data as { delta: { content: Array<{ text?: { value: string } }> } }
            const text = delta.delta.content[0]?.text?.value
            if (text) textDeltas.push(text)
          }
        }

        expect(textDeltas.join('')).toBe('Hello World!')
      })

      it('should handle requires_action during streaming', async () => {
        const mockEvents = [
          { event: 'thread.run.created', data: mockRun({ status: 'queued' }) },
          { event: 'thread.run.in_progress', data: mockRun({ status: 'in_progress' }) },
          {
            event: 'thread.run.requires_action',
            data: mockRun({
              status: 'requires_action',
              required_action: {
                type: 'submit_tool_outputs',
                submit_tool_outputs: {
                  tool_calls: [
                    {
                      id: 'call_abc123',
                      type: 'function',
                      function: { name: 'get_weather', arguments: '{"location":"SF"}' },
                    },
                  ],
                },
              },
            }),
          },
        ]

        const mockFetch = vi.fn().mockResolvedValue(createMockSSEStream(mockEvents))

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const stream = await client.beta.threads.runs.stream('thread_abc123', {
          assistant_id: 'asst_abc123',
        })

        let requiresAction = false
        for await (const event of stream) {
          if (event.event === 'thread.run.requires_action') {
            requiresAction = true
            const run = event.data as Run
            expect(run.required_action?.submit_tool_outputs.tool_calls).toHaveLength(1)
          }
        }

        expect(requiresAction).toBe(true)
      })

      it('should emit step events', async () => {
        const mockEvents = [
          { event: 'thread.run.created', data: mockRun({ status: 'queued' }) },
          { event: 'thread.run.step.created', data: mockRunStep({ status: 'in_progress' }) },
          { event: 'thread.run.step.in_progress', data: mockRunStep({ status: 'in_progress' }) },
          { event: 'thread.run.step.completed', data: mockRunStep({ status: 'completed' }) },
          { event: 'thread.run.completed', data: mockRun({ status: 'completed' }) },
        ]

        const mockFetch = vi.fn().mockResolvedValue(createMockSSEStream(mockEvents))

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const stream = await client.beta.threads.runs.stream('thread_abc123', {
          assistant_id: 'asst_abc123',
        })

        const stepEvents: string[] = []
        for await (const event of stream) {
          if (event.event.startsWith('thread.run.step')) {
            stepEvents.push(event.event)
          }
        }

        expect(stepEvents).toContain('thread.run.step.created')
        expect(stepEvents).toContain('thread.run.step.completed')
      })
    })

    describe('submitToolOutputsStream', () => {
      it('should submit tool outputs and stream response', async () => {
        const mockEvents = [
          { event: 'thread.run.in_progress', data: mockRun({ status: 'in_progress' }) },
          {
            event: 'thread.message.delta',
            data: {
              id: 'msg_123',
              delta: { content: [{ index: 0, type: 'text', text: { value: 'The weather is 72F' } }] },
            },
          },
          { event: 'thread.run.completed', data: mockRun({ status: 'completed' }) },
        ]

        const mockFetch = vi.fn().mockResolvedValue(createMockSSEStream(mockEvents))

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const stream = await client.beta.threads.runs.submitToolOutputsStream(
          'thread_abc123',
          'run_abc123',
          { tool_outputs: [{ tool_call_id: 'call_abc123', output: '{"temp": 72}' }] }
        )

        const events: Array<{ event: string }> = []
        for await (const event of stream) {
          events.push(event)
        }

        expect(events.some((e) => e.event === 'thread.run.completed')).toBe(true)
      })
    })
  })

  // =============================================================================
  // Create Thread and Run Tests
  // =============================================================================

  describe('Create Thread and Run', () => {
    describe('createAndRun', () => {
      it('should create thread and run in one call', async () => {
        const expected = mockRun({ status: 'queued' })
        const mockFetch = createMockFetch(
          new Map([['POST /v1/threads/runs', { status: 200, body: expected }]])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const run = await client.beta.threads.createAndRun({
          assistant_id: 'asst_abc123',
        })

        expect(run.id).toBe('run_test123')
        expect(run.status).toBe('queued')
      })

      it('should create thread with messages and run', async () => {
        const expected = mockRun()
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => expected,
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        await client.beta.threads.createAndRun({
          assistant_id: 'asst_abc123',
          thread: {
            messages: [{ role: 'user', content: 'Hello!' }],
          },
        })

        const [, options] = mockFetch.mock.calls[0]
        const body = JSON.parse(options?.body as string)
        expect(body.thread.messages).toHaveLength(1)
      })
    })

    describe('createAndRunPoll', () => {
      it('should create thread and run, then poll until completion', async () => {
        let callCount = 0
        const mockFetch = vi.fn(async (url: string, options?: RequestInit) => {
          const method = options?.method ?? 'GET'

          if (method === 'POST') {
            return {
              ok: true,
              status: 200,
              headers: new Headers(),
              json: async () => mockRun({ status: 'queued' }),
            }
          }

          callCount++
          const status = callCount < 2 ? 'in_progress' : 'completed'
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => mockRun({ status: status as RunStatus }),
          }
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const run = await client.beta.threads.createAndRunPoll({
          assistant_id: 'asst_abc123',
          thread: { messages: [{ role: 'user', content: 'Hello!' }] },
        })

        expect(run.status).toBe('completed')
      })
    })

    describe('createAndRunStream', () => {
      it('should create thread and run with streaming', async () => {
        const mockEvents = [
          { event: 'thread.created', data: mockThread() },
          { event: 'thread.run.created', data: mockRun({ status: 'queued' }) },
          { event: 'thread.run.completed', data: mockRun({ status: 'completed' }) },
        ]

        const encoder = new TextEncoder()
        const lines = mockEvents.map(
          (e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`
        )
        lines.push('event: done\ndata: [DONE]\n\n')

        let index = 0
        const stream = new ReadableStream({
          pull(controller) {
            if (index < lines.length) {
              controller.enqueue(encoder.encode(lines[index]))
              index++
            } else {
              controller.close()
            }
          },
        })

        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/event-stream' }),
          body: stream,
        })

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const eventStream = await client.beta.threads.createAndRunStream({
          assistant_id: 'asst_abc123',
          thread: { messages: [{ role: 'user', content: 'Hello!' }] },
        })

        const events: Array<{ event: string }> = []
        for await (const event of eventStream) {
          events.push(event)
        }

        expect(events.some((e) => e.event === 'thread.created')).toBe(true)
        expect(events.some((e) => e.event === 'thread.run.created')).toBe(true)
      })
    })
  })

  // =============================================================================
  // Error Scenarios Tests
  // =============================================================================

  describe('Error Scenarios', () => {
    it('should handle rate limit errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/assistants',
            {
              status: 429,
              body: {
                error: {
                  type: 'rate_limit_error',
                  message: 'Rate limit exceeded. Please retry after 60 seconds.',
                  code: 'rate_limit_exceeded',
                },
              },
            },
          ],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })

      try {
        await client.beta.assistants.create({ model: 'gpt-4-turbo' })
      } catch (error) {
        expect(error).toBeInstanceOf(OpenAIError)
        expect((error as OpenAIError).status).toBe(429)
      }
    })

    it('should handle invalid model errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/assistants',
            {
              status: 400,
              body: {
                error: {
                  type: 'invalid_request_error',
                  message: 'The model `invalid-model` does not exist or you do not have access to it.',
                  code: 'model_not_found',
                },
              },
            },
          ],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })

      await expect(
        client.beta.assistants.create({ model: 'invalid-model' })
      ).rejects.toThrow(OpenAIError)
    })

    it('should handle server errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/threads/thread_abc123/runs',
            {
              status: 500,
              body: {
                error: {
                  type: 'server_error',
                  message: 'Internal server error',
                },
              },
            },
          ],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })

      try {
        await client.beta.threads.runs.create('thread_abc123', { assistant_id: 'asst_abc123' })
      } catch (error) {
        expect(error).toBeInstanceOf(OpenAIError)
        expect((error as OpenAIError).status).toBe(500)
      }
    })

    it('should handle context length exceeded errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/threads/thread_abc123/runs',
            {
              status: 400,
              body: {
                error: {
                  type: 'invalid_request_error',
                  message: 'This model maximum context length is 128000 tokens. However, your messages resulted in 150000 tokens.',
                  code: 'context_length_exceeded',
                },
              },
            },
          ],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })

      try {
        await client.beta.threads.runs.create('thread_abc123', { assistant_id: 'asst_abc123' })
      } catch (error) {
        expect(error).toBeInstanceOf(OpenAIError)
        const openAIError = error as OpenAIError
        expect(openAIError.code).toBe('context_length_exceeded')
      }
    })

    it('should handle expired run errors when submitting tool outputs', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/threads/thread_abc123/runs/run_abc123/submit_tool_outputs',
            {
              status: 400,
              body: {
                error: {
                  type: 'invalid_request_error',
                  message: 'Run has expired',
                  code: 'run_expired',
                },
              },
            },
          ],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })

      await expect(
        client.beta.threads.runs.submitToolOutputs('thread_abc123', 'run_abc123', {
          tool_outputs: [{ tool_call_id: 'call_abc123', output: '{}' }],
        })
      ).rejects.toThrow(OpenAIError)
    })

    it('should handle authentication errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/assistants',
            {
              status: 401,
              body: {
                error: {
                  type: 'invalid_api_key',
                  message: 'Incorrect API key provided',
                  code: 'invalid_api_key',
                },
              },
            },
          ],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-invalid', fetch: mockFetch })

      try {
        await client.beta.assistants.list()
      } catch (error) {
        expect(error).toBeInstanceOf(OpenAIError)
        expect((error as OpenAIError).status).toBe(401)
      }
    })

    it('should handle permission errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'DELETE /v1/assistants/asst_abc123',
            {
              status: 403,
              body: {
                error: {
                  type: 'permission_error',
                  message: 'You do not have permission to delete this assistant',
                },
              },
            },
          ],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })

      await expect(client.beta.assistants.del('asst_abc123')).rejects.toThrow(OpenAIError)
    })
  })

  // =============================================================================
  // Headers Tests
  // =============================================================================

  describe('Request Headers', () => {
    it('should send OpenAI-Beta header for assistants v2', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockAssistant(),
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      await client.beta.assistants.create({ model: 'gpt-4-turbo' })

      const [, options] = mockFetch.mock.calls[0]
      expect(options?.headers).toHaveProperty('OpenAI-Beta', 'assistants=v2')
    })

    it('should include Authorization header', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockAssistant(),
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      await client.beta.assistants.create({ model: 'gpt-4-turbo' })

      const [, options] = mockFetch.mock.calls[0]
      expect(options?.headers).toHaveProperty('Authorization', 'Bearer sk-test-xxx')
    })
  })
})
