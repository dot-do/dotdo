/**
 * Mock Utilities for External Services
 *
 * Provides mock implementations for external services that cannot be tested
 * directly. These are specifically for external HTTP APIs, not for Durable Objects
 * (which should use real miniflare testing).
 *
 * IMPORTANT: Per CLAUDE.md guidelines, DOs require NO MOCKING - use miniflare.
 * These mocks are ONLY for external APIs that cannot be run locally.
 *
 * @example
 * ```typescript
 * import { mockHttp, mockStripe, mockSendGrid } from 'testing/mocks'
 *
 * // Mock HTTP responses
 * const { intercept, restore } = mockHttp()
 * intercept('GET https://api.example.com/users', { users: [] })
 *
 * // Mock Stripe API
 * const stripe = mockStripe({
 *   customers: [{ id: 'cus_123', email: 'test@example.com' }]
 * })
 * ```
 *
 * @module testing/mocks
 */

import { vi } from 'vitest'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * HTTP mock configuration
 */
export interface HttpMockConfig {
  /** Base URL to intercept */
  baseUrl?: string
  /** Default response delay in ms */
  delay?: number
  /** Whether to passthrough unmatched requests */
  passthrough?: boolean
}

/**
 * Intercepted HTTP request info
 */
export interface InterceptedRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: unknown
  timestamp: number
}

/**
 * HTTP mock response configuration
 */
export interface MockResponse {
  status?: number
  headers?: Record<string, string>
  body?: unknown
  delay?: number
}

/**
 * HTTP mock controller
 */
export interface HttpMock {
  /** Add an intercept rule */
  intercept(pattern: string | RegExp, response: MockResponse | ((req: InterceptedRequest) => MockResponse | Promise<MockResponse>)): void
  /** Get all intercepted requests */
  requests(): InterceptedRequest[]
  /** Clear intercept rules and captured requests */
  clear(): void
  /** Restore original fetch */
  restore(): void
  /** Wait for N requests to be intercepted */
  waitForRequests(count: number, timeout?: number): Promise<InterceptedRequest[]>
}

/**
 * Stripe mock data
 */
export interface StripeMockData {
  customers?: Array<{ id: string; email?: string; [key: string]: unknown }>
  paymentIntents?: Array<{ id: string; amount: number; status: string; [key: string]: unknown }>
  subscriptions?: Array<{ id: string; customer: string; status: string; [key: string]: unknown }>
  invoices?: Array<{ id: string; customer: string; total: number; [key: string]: unknown }>
}

/**
 * Stripe mock client
 */
export interface StripeMock {
  customers: {
    create: ReturnType<typeof vi.fn>
    retrieve: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    del: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
  }
  paymentIntents: {
    create: ReturnType<typeof vi.fn>
    retrieve: ReturnType<typeof vi.fn>
    confirm: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
  }
  subscriptions: {
    create: ReturnType<typeof vi.fn>
    retrieve: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
  }
  invoices: {
    retrieve: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
    pay: ReturnType<typeof vi.fn>
  }
  /** All tracked API calls */
  calls: Array<{ resource: string; method: string; args: unknown[] }>
}

/**
 * SendGrid mock data
 */
export interface SendGridMockData {
  /** Emails that should fail to send */
  failingEmails?: string[]
  /** Custom response status */
  defaultStatus?: number
}

/**
 * SendGrid mock client
 */
export interface SendGridMock {
  send: ReturnType<typeof vi.fn>
  sendMultiple: ReturnType<typeof vi.fn>
  /** All captured emails */
  sentEmails: Array<{
    to: string | string[]
    from: string
    subject: string
    text?: string
    html?: string
    timestamp: number
  }>
  /** Clear sent emails */
  clear(): void
}

/**
 * Twilio mock data
 */
export interface TwilioMockData {
  /** Phone numbers that should fail */
  failingNumbers?: string[]
}

/**
 * Twilio mock client
 */
export interface TwilioMock {
  messages: {
    create: ReturnType<typeof vi.fn>
  }
  calls: {
    create: ReturnType<typeof vi.fn>
  }
  /** All sent messages */
  sentMessages: Array<{
    to: string
    from: string
    body: string
    timestamp: number
  }>
  /** All initiated calls */
  initiatedCalls: Array<{
    to: string
    from: string
    url: string
    timestamp: number
  }>
  /** Clear all tracked communications */
  clear(): void
}

/**
 * OpenAI mock data
 */
export interface OpenAIMockData {
  /** Default completion response */
  completionResponse?: string
  /** Embedding vector dimension */
  embeddingDimension?: number
  /** Response delay */
  delay?: number
}

/**
 * OpenAI mock client
 */
export interface OpenAIMock {
  chat: {
    completions: {
      create: ReturnType<typeof vi.fn>
    }
  }
  embeddings: {
    create: ReturnType<typeof vi.fn>
  }
  /** Configure response for specific prompts */
  mockResponse(prompt: string | RegExp, response: string): void
  /** All API calls */
  calls: Array<{
    endpoint: string
    model: string
    input: unknown
    timestamp: number
  }>
  /** Clear mocked responses and calls */
  clear(): void
}

/**
 * Slack mock data
 */
export interface SlackMockData {
  /** Channels to pre-populate */
  channels?: Array<{ id: string; name: string }>
  /** Users to pre-populate */
  users?: Array<{ id: string; name: string }>
}

/**
 * Slack mock client
 */
export interface SlackMock {
  chat: {
    postMessage: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }
  conversations: {
    list: ReturnType<typeof vi.fn>
    info: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
  }
  users: {
    list: ReturnType<typeof vi.fn>
    info: ReturnType<typeof vi.fn>
  }
  /** All posted messages */
  postedMessages: Array<{
    channel: string
    text?: string
    blocks?: unknown[]
    timestamp: number
  }>
  /** Clear tracked messages */
  clear(): void
}

// ============================================================================
// HTTP MOCK
// ============================================================================

/**
 * Create an HTTP mock for intercepting fetch requests
 *
 * @example
 * ```typescript
 * const { intercept, requests, restore } = mockHttp()
 *
 * // Intercept specific endpoint
 * intercept('GET https://api.example.com/users', {
 *   status: 200,
 *   body: { users: [{ id: 1, name: 'Alice' }] }
 * })
 *
 * // Use regex pattern
 * intercept(/api\.example\.com\/users\/\d+/, (req) => ({
 *   body: { id: parseInt(req.url.split('/').pop()!), name: 'User' }
 * }))
 *
 * // After test
 * expect(requests()).toHaveLength(2)
 * restore()
 * ```
 */
export function mockHttp(config: HttpMockConfig = {}): HttpMock {
  const interceptedRequests: InterceptedRequest[] = []
  const rules: Array<{
    pattern: string | RegExp
    handler: MockResponse | ((req: InterceptedRequest) => MockResponse | Promise<MockResponse>)
  }> = []

  // Store original fetch
  const originalFetch = globalThis.fetch

  // Replace global fetch
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = init?.method ?? 'GET'
    const fullUrl = config.baseUrl && !url.startsWith('http') ? `${config.baseUrl}${url}` : url

    // Parse headers
    const headers: Record<string, string> = {}
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          headers[key] = value
        })
      } else if (Array.isArray(init.headers)) {
        for (const [key, value] of init.headers) {
          headers[key] = value
        }
      } else {
        Object.assign(headers, init.headers)
      }
    }

    // Parse body
    let body: unknown
    if (init?.body) {
      try {
        body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
      } catch {
        body = init.body
      }
    }

    // Record request
    const request: InterceptedRequest = {
      method,
      url: fullUrl,
      headers,
      body,
      timestamp: Date.now(),
    }
    interceptedRequests.push(request)

    // Find matching rule
    for (const rule of rules) {
      const pattern = rule.pattern
      const matchString = `${method} ${fullUrl}`

      let matches = false
      if (typeof pattern === 'string') {
        matches = matchString === pattern || fullUrl === pattern || matchString.includes(pattern)
      } else {
        matches = pattern.test(matchString) || pattern.test(fullUrl)
      }

      if (matches) {
        const response = typeof rule.handler === 'function'
          ? await rule.handler(request)
          : rule.handler

        // Apply delay
        const delay = response.delay ?? config.delay ?? 0
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay))
        }

        return new Response(
          response.body !== undefined ? JSON.stringify(response.body) : null,
          {
            status: response.status ?? 200,
            headers: {
              'Content-Type': 'application/json',
              ...(response.headers ?? {}),
            },
          }
        )
      }
    }

    // No matching rule - passthrough or error
    if (config.passthrough) {
      return originalFetch(input, init)
    }

    return new Response(JSON.stringify({ error: 'Not Found', url: fullUrl }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  return {
    intercept(pattern, handler) {
      rules.push({ pattern, handler })
    },

    requests() {
      return [...interceptedRequests]
    },

    clear() {
      interceptedRequests.length = 0
      rules.length = 0
    },

    restore() {
      globalThis.fetch = originalFetch
    },

    async waitForRequests(count: number, timeout = 5000) {
      const startTime = Date.now()
      while (interceptedRequests.length < count) {
        if (Date.now() - startTime > timeout) {
          throw new Error(`Timeout waiting for ${count} requests, got ${interceptedRequests.length}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      return interceptedRequests.slice(0, count)
    },
  }
}

// ============================================================================
// STRIPE MOCK
// ============================================================================

/**
 * Create a mock Stripe client
 *
 * @example
 * ```typescript
 * const stripe = mockStripe({
 *   customers: [{ id: 'cus_123', email: 'test@example.com' }]
 * })
 *
 * const customer = await stripe.customers.retrieve('cus_123')
 * expect(customer.email).toBe('test@example.com')
 *
 * await stripe.paymentIntents.create({ amount: 1000, currency: 'usd' })
 * expect(stripe.calls).toContainEqual(expect.objectContaining({
 *   resource: 'paymentIntents',
 *   method: 'create'
 * }))
 * ```
 */
export function mockStripe(data: StripeMockData = {}): StripeMock {
  const calls: StripeMock['calls'] = []
  const customers = new Map(data.customers?.map((c) => [c.id, c]))
  const paymentIntents = new Map(data.paymentIntents?.map((p) => [p.id, p]))
  const subscriptions = new Map(data.subscriptions?.map((s) => [s.id, s]))
  const invoices = new Map(data.invoices?.map((i) => [i.id, i]))

  let idCounter = 0
  const generateId = (prefix: string) => `${prefix}_test_${++idCounter}`

  const track = (resource: string, method: string, args: unknown[]) => {
    calls.push({ resource, method, args })
  }

  return {
    calls,

    customers: {
      create: vi.fn(async (params: unknown) => {
        track('customers', 'create', [params])
        const customer = { id: generateId('cus'), ...(params as Record<string, unknown>) }
        customers.set(customer.id, customer)
        return customer
      }),

      retrieve: vi.fn(async (id: string) => {
        track('customers', 'retrieve', [id])
        const customer = customers.get(id)
        if (!customer) throw new Error(`No such customer: ${id}`)
        return customer
      }),

      update: vi.fn(async (id: string, params: unknown) => {
        track('customers', 'update', [id, params])
        const customer = customers.get(id)
        if (!customer) throw new Error(`No such customer: ${id}`)
        const updated = { ...customer, ...(params as Record<string, unknown>) }
        customers.set(id, updated)
        return updated
      }),

      del: vi.fn(async (id: string) => {
        track('customers', 'del', [id])
        customers.delete(id)
        return { id, deleted: true }
      }),

      list: vi.fn(async () => {
        track('customers', 'list', [])
        return { data: Array.from(customers.values()) }
      }),
    },

    paymentIntents: {
      create: vi.fn(async (params: { amount: number; currency: string; [key: string]: unknown }) => {
        track('paymentIntents', 'create', [params])
        const pi = {
          id: generateId('pi'),
          status: 'requires_confirmation',
          ...params,
        }
        paymentIntents.set(pi.id, pi)
        return pi
      }),

      retrieve: vi.fn(async (id: string) => {
        track('paymentIntents', 'retrieve', [id])
        const pi = paymentIntents.get(id)
        if (!pi) throw new Error(`No such payment intent: ${id}`)
        return pi
      }),

      confirm: vi.fn(async (id: string) => {
        track('paymentIntents', 'confirm', [id])
        const pi = paymentIntents.get(id)
        if (!pi) throw new Error(`No such payment intent: ${id}`)
        const confirmed = { ...pi, status: 'succeeded' }
        paymentIntents.set(id, confirmed)
        return confirmed
      }),

      cancel: vi.fn(async (id: string) => {
        track('paymentIntents', 'cancel', [id])
        const pi = paymentIntents.get(id)
        if (!pi) throw new Error(`No such payment intent: ${id}`)
        const cancelled = { ...pi, status: 'canceled' }
        paymentIntents.set(id, cancelled)
        return cancelled
      }),
    },

    subscriptions: {
      create: vi.fn(async (params: { customer: string; [key: string]: unknown }) => {
        track('subscriptions', 'create', [params])
        const sub = {
          id: generateId('sub'),
          status: 'active',
          ...params,
        }
        subscriptions.set(sub.id, sub)
        return sub
      }),

      retrieve: vi.fn(async (id: string) => {
        track('subscriptions', 'retrieve', [id])
        const sub = subscriptions.get(id)
        if (!sub) throw new Error(`No such subscription: ${id}`)
        return sub
      }),

      update: vi.fn(async (id: string, params: unknown) => {
        track('subscriptions', 'update', [id, params])
        const sub = subscriptions.get(id)
        if (!sub) throw new Error(`No such subscription: ${id}`)
        const updated = { ...sub, ...(params as Record<string, unknown>) }
        subscriptions.set(id, updated)
        return updated
      }),

      cancel: vi.fn(async (id: string) => {
        track('subscriptions', 'cancel', [id])
        const sub = subscriptions.get(id)
        if (!sub) throw new Error(`No such subscription: ${id}`)
        const cancelled = { ...sub, status: 'canceled' }
        subscriptions.set(id, cancelled)
        return cancelled
      }),
    },

    invoices: {
      retrieve: vi.fn(async (id: string) => {
        track('invoices', 'retrieve', [id])
        const inv = invoices.get(id)
        if (!inv) throw new Error(`No such invoice: ${id}`)
        return inv
      }),

      list: vi.fn(async () => {
        track('invoices', 'list', [])
        return { data: Array.from(invoices.values()) }
      }),

      pay: vi.fn(async (id: string) => {
        track('invoices', 'pay', [id])
        const inv = invoices.get(id)
        if (!inv) throw new Error(`No such invoice: ${id}`)
        const paid = { ...inv, status: 'paid' }
        invoices.set(id, paid)
        return paid
      }),
    },
  }
}

// ============================================================================
// SENDGRID MOCK
// ============================================================================

/**
 * Create a mock SendGrid client
 *
 * @example
 * ```typescript
 * const sg = mockSendGrid()
 *
 * await sg.send({
 *   to: 'user@example.com',
 *   from: 'noreply@app.com',
 *   subject: 'Welcome!',
 *   text: 'Hello world'
 * })
 *
 * expect(sg.sentEmails).toHaveLength(1)
 * expect(sg.sentEmails[0].to).toBe('user@example.com')
 * ```
 */
export function mockSendGrid(data: SendGridMockData = {}): SendGridMock {
  const sentEmails: SendGridMock['sentEmails'] = []

  const send = vi.fn(async (msg: {
    to: string | string[]
    from: string
    subject: string
    text?: string
    html?: string
  }) => {
    const recipients = Array.isArray(msg.to) ? msg.to : [msg.to]

    for (const to of recipients) {
      if (data.failingEmails?.includes(to)) {
        throw new Error(`Failed to send email to ${to}`)
      }
    }

    sentEmails.push({
      to: msg.to,
      from: msg.from,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      timestamp: Date.now(),
    })

    return { statusCode: data.defaultStatus ?? 202 }
  })

  return {
    send,
    sendMultiple: vi.fn(async (msgs: Parameters<typeof send>[0][]) => {
      for (const msg of msgs) {
        await send(msg)
      }
      return { statusCode: data.defaultStatus ?? 202 }
    }),
    sentEmails,
    clear() {
      sentEmails.length = 0
      send.mockClear()
    },
  }
}

// ============================================================================
// TWILIO MOCK
// ============================================================================

/**
 * Create a mock Twilio client
 *
 * @example
 * ```typescript
 * const twilio = mockTwilio()
 *
 * await twilio.messages.create({
 *   to: '+1234567890',
 *   from: '+0987654321',
 *   body: 'Hello!'
 * })
 *
 * expect(twilio.sentMessages).toHaveLength(1)
 * ```
 */
export function mockTwilio(data: TwilioMockData = {}): TwilioMock {
  const sentMessages: TwilioMock['sentMessages'] = []
  const initiatedCalls: TwilioMock['initiatedCalls'] = []
  let sidCounter = 0

  return {
    messages: {
      create: vi.fn(async (params: { to: string; from: string; body: string }) => {
        if (data.failingNumbers?.includes(params.to)) {
          throw new Error(`Failed to send message to ${params.to}`)
        }

        sentMessages.push({
          to: params.to,
          from: params.from,
          body: params.body,
          timestamp: Date.now(),
        })

        return {
          sid: `SM${++sidCounter}`,
          status: 'queued',
          ...params,
        }
      }),
    },

    calls: {
      create: vi.fn(async (params: { to: string; from: string; url: string }) => {
        if (data.failingNumbers?.includes(params.to)) {
          throw new Error(`Failed to initiate call to ${params.to}`)
        }

        initiatedCalls.push({
          to: params.to,
          from: params.from,
          url: params.url,
          timestamp: Date.now(),
        })

        return {
          sid: `CA${++sidCounter}`,
          status: 'queued',
          ...params,
        }
      }),
    },

    sentMessages,
    initiatedCalls,

    clear() {
      sentMessages.length = 0
      initiatedCalls.length = 0
    },
  }
}

// ============================================================================
// OPENAI MOCK
// ============================================================================

/**
 * Create a mock OpenAI client
 *
 * @example
 * ```typescript
 * const openai = mockOpenAI({ completionResponse: 'Hello!' })
 *
 * openai.mockResponse(/translate/, 'Bonjour!')
 *
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'translate hello to french' }]
 * })
 *
 * expect(response.choices[0].message.content).toBe('Bonjour!')
 * ```
 */
export function mockOpenAI(data: OpenAIMockData = {}): OpenAIMock {
  const calls: OpenAIMock['calls'] = []
  const mockResponses = new Map<string | RegExp, string>()

  const findMockResponse = (input: string): string | undefined => {
    for (const [pattern, response] of mockResponses) {
      if (typeof pattern === 'string' && input.includes(pattern)) {
        return response
      }
      if (pattern instanceof RegExp && pattern.test(input)) {
        return response
      }
    }
    return undefined
  }

  return {
    chat: {
      completions: {
        create: vi.fn(async (params: {
          model: string
          messages: Array<{ role: string; content: string }>
          [key: string]: unknown
        }) => {
          const lastMessage = params.messages[params.messages.length - 1]?.content ?? ''

          calls.push({
            endpoint: 'chat.completions',
            model: params.model,
            input: params.messages,
            timestamp: Date.now(),
          })

          if (data.delay) {
            await new Promise((resolve) => setTimeout(resolve, data.delay))
          }

          const content = findMockResponse(lastMessage) ?? data.completionResponse ?? 'Mock AI response'

          return {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: params.model,
            choices: [{
              index: 0,
              message: { role: 'assistant', content },
              finish_reason: 'stop',
            }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
            },
          }
        }),
      },
    },

    embeddings: {
      create: vi.fn(async (params: { model: string; input: string | string[] }) => {
        const inputs = Array.isArray(params.input) ? params.input : [params.input]

        calls.push({
          endpoint: 'embeddings',
          model: params.model,
          input: params.input,
          timestamp: Date.now(),
        })

        if (data.delay) {
          await new Promise((resolve) => setTimeout(resolve, data.delay))
        }

        const dimension = data.embeddingDimension ?? 1536
        const makeVector = () => Array.from({ length: dimension }, () => Math.random() - 0.5)

        return {
          object: 'list',
          data: inputs.map((_, index) => ({
            object: 'embedding',
            index,
            embedding: makeVector(),
          })),
          model: params.model,
          usage: {
            prompt_tokens: inputs.length * 10,
            total_tokens: inputs.length * 10,
          },
        }
      }),
    },

    mockResponse(prompt, response) {
      mockResponses.set(prompt, response)
    },

    calls,

    clear() {
      mockResponses.clear()
      calls.length = 0
    },
  }
}

// ============================================================================
// SLACK MOCK
// ============================================================================

/**
 * Create a mock Slack client
 *
 * @example
 * ```typescript
 * const slack = mockSlack({
 *   channels: [{ id: 'C123', name: 'general' }]
 * })
 *
 * await slack.chat.postMessage({
 *   channel: 'C123',
 *   text: 'Hello team!'
 * })
 *
 * expect(slack.postedMessages).toHaveLength(1)
 * ```
 */
export function mockSlack(data: SlackMockData = {}): SlackMock {
  const postedMessages: SlackMock['postedMessages'] = []
  const channels = new Map(data.channels?.map((c) => [c.id, c]))
  const users = new Map(data.users?.map((u) => [u.id, u]))

  let tsCounter = 0
  const generateTs = () => `${Date.now()}.${++tsCounter}`

  return {
    chat: {
      postMessage: vi.fn(async (params: { channel: string; text?: string; blocks?: unknown[] }) => {
        postedMessages.push({
          channel: params.channel,
          text: params.text,
          blocks: params.blocks,
          timestamp: Date.now(),
        })

        return { ok: true, ts: generateTs(), channel: params.channel }
      }),

      update: vi.fn(async (params: { channel: string; ts: string; text?: string }) => {
        return { ok: true, ts: params.ts, channel: params.channel }
      }),

      delete: vi.fn(async (params: { channel: string; ts: string }) => {
        return { ok: true, ts: params.ts, channel: params.channel }
      }),
    },

    conversations: {
      list: vi.fn(async () => {
        return { ok: true, channels: Array.from(channels.values()) }
      }),

      info: vi.fn(async (params: { channel: string }) => {
        const channel = channels.get(params.channel)
        if (!channel) return { ok: false, error: 'channel_not_found' }
        return { ok: true, channel }
      }),

      create: vi.fn(async (params: { name: string }) => {
        const id = `C${Date.now()}`
        const channel = { id, name: params.name }
        channels.set(id, channel)
        return { ok: true, channel }
      }),
    },

    users: {
      list: vi.fn(async () => {
        return { ok: true, members: Array.from(users.values()) }
      }),

      info: vi.fn(async (params: { user: string }) => {
        const user = users.get(params.user)
        if (!user) return { ok: false, error: 'user_not_found' }
        return { ok: true, user }
      }),
    },

    postedMessages,

    clear() {
      postedMessages.length = 0
    },
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * All mock utilities
 */
export const mocks = {
  http: mockHttp,
  stripe: mockStripe,
  sendGrid: mockSendGrid,
  twilio: mockTwilio,
  openai: mockOpenAI,
  slack: mockSlack,
}

export default mocks
