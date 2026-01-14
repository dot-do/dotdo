/**
 * @dotdo/zapier Package Tests
 *
 * RED-GREEN-REFACTOR: These tests verify the Zapier-compatible automation API.
 *
 * Tests cover:
 * - App definition with triggers, actions, searches
 * - Authentication (OAuth2, API Key, session)
 * - Z request client for HTTP operations
 * - Webhook and polling triggers
 * - Dynamic fields and field validation
 * - Hydration for lazy loading
 * - Middleware system
 * - Webhook handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  // Core
  App,
  createZObject,
  // Types
  type Bundle,
  type ZObject,
  type HookTriggerConfig,
  type InputField,
  // Auth
  Authentication,
  createBasicAuthHeader,
  createBearerAuthHeader,
  generateCodeVerifier,
  OAuth2Flow,
  SessionAuthFlow,
  // Triggers
  Trigger,
  createPollingTrigger,
  createHookTrigger,
  PollingTriggerExecutor,
  WebhookTriggerManager,
  TriggerBuilder,
  trigger,
  sortByNewest,
  deduplicateResults,
  // Actions
  Action,
  createAction,
  ActionBuilder,
  action,
  stringField,
  requiredString,
  numberField,
  booleanField,
  selectField,
  dynamicField,
  mergeWithDefaults,
  cleanInputData,
  transformInputData,
  // Searches
  Search,
  createSearch,
  SearchBuilder,
  search,
  createIdSearch,
  filterSearchResults,
  sortSearchResults,
  paginateSearchResults,
  // Webhook
  WebhookHandler,
  WebhookSubscriptionManager,
  generateVerificationToken,
  parseEventType,
  extractWebhookData,
  webhookSuccess,
  webhookError,
  WebhookRetryManager,
  // Fields
  DynamicFieldResolver,
  FieldDependencyGraph,
  validateFieldValues,
  transformFieldValues,
  generateSampleData,
  flattenFields,
  unflattenData,
  // Z Object
  HydrationManager,
  get,
  post,
  withAuth,
  withHeaders,
  addHeaderMiddleware,
  authMiddleware,
  // Errors
  ZapierError,
  ExpiredAuthError,
  ResponseError,
} from '@dotdo/zapier'

describe('@dotdo/zapier', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // ============================================================================
  // APP DEFINITION TESTS
  // ============================================================================

  describe('App', () => {
    it('should create an app with basic configuration', () => {
      const app = new App({
        version: '1.0.0',
        platformVersion: '14.0.0',
        triggers: {},
        actions: {},
        searches: {},
      })

      expect(app.version).toBe('1.0.0')
      expect(app.platformVersion).toBe('14.0.0')
    })

    it('should register triggers', () => {
      const app = new App({
        version: '1.0.0',
        platformVersion: '14.0.0',
        triggers: {
          new_contact: {
            key: 'new_contact',
            noun: 'Contact',
            display: {
              label: 'New Contact',
              description: 'Triggers when a new contact is created',
            },
            operation: {
              type: 'polling',
              perform: async () => [],
            },
          },
        },
        actions: {},
        searches: {},
      })

      expect(app.triggers.new_contact).toBeDefined()
      expect(app.triggers.new_contact.key).toBe('new_contact')
      expect(app.triggers.new_contact.noun).toBe('Contact')
    })

    it('should register actions', () => {
      const app = new App({
        version: '1.0.0',
        platformVersion: '14.0.0',
        triggers: {},
        actions: {
          create_contact: {
            key: 'create_contact',
            noun: 'Contact',
            display: {
              label: 'Create Contact',
              description: 'Creates a new contact',
            },
            operation: {
              perform: async () => ({}),
              inputFields: [{ key: 'email', label: 'Email', required: true }],
            },
          },
        },
        searches: {},
      })

      expect(app.actions.create_contact).toBeDefined()
      expect(app.actions.create_contact.key).toBe('create_contact')
    })

    it('should register searches', () => {
      const app = new App({
        version: '1.0.0',
        platformVersion: '14.0.0',
        triggers: {},
        actions: {},
        searches: {
          find_contact: {
            key: 'find_contact',
            noun: 'Contact',
            display: {
              label: 'Find Contact',
              description: 'Finds a contact by email',
            },
            operation: {
              perform: async () => [],
            },
          },
        },
      })

      expect(app.searches.find_contact).toBeDefined()
    })

    it('should export app for zapier CLI', () => {
      const app = new App({
        version: '1.0.0',
        platformVersion: '14.0.0',
        triggers: {},
        actions: {},
        searches: {},
      })

      const exported = app.toZapierFormat()

      expect(exported.version).toBe('1.0.0')
      expect(exported.platformVersion).toBe('14.0.0')
      expect(exported.triggers).toBeDefined()
      expect(exported.creates).toBeDefined()
      expect(exported.searches).toBeDefined()
    })

    it('should validate app and detect missing version', () => {
      const app = new App({
        version: '',
        platformVersion: '14.0.0',
        triggers: {},
        actions: {},
        searches: {},
      })

      const validation = app.validate()

      expect(validation.valid).toBe(false)
      expect(validation.errors).toContain('App version is required')
    })

    it('should validate triggers have required fields', () => {
      const app = new App({
        version: '1.0.0',
        platformVersion: '14.0.0',
        triggers: {
          bad_trigger: {
            key: '',
            noun: '',
            display: { label: '', description: '' },
            operation: {
              type: 'polling',
              perform: async () => [],
            },
          },
        },
        actions: {},
        searches: {},
      })

      const validation = app.validate()

      expect(validation.valid).toBe(false)
      expect(validation.errors.length).toBeGreaterThan(0)
    })

    it('should list all trigger/action/search keys', () => {
      const app = new App({
        version: '1.0.0',
        platformVersion: '14.0.0',
        triggers: { trigger1: { key: 'trigger1', noun: 'T', display: { label: 'T', description: 'T' }, operation: { type: 'polling', perform: async () => [] } } },
        actions: { action1: { key: 'action1', noun: 'A', display: { label: 'A', description: 'A' }, operation: { perform: async () => ({}) } } },
        searches: { search1: { key: 'search1', noun: 'S', display: { label: 'S', description: 'S' }, operation: { perform: async () => [] } } },
      })

      expect(app.listTriggers()).toEqual(['trigger1'])
      expect(app.listActions()).toEqual(['action1'])
      expect(app.listSearches()).toEqual(['search1'])
    })
  })

  // ============================================================================
  // AUTHENTICATION TESTS
  // ============================================================================

  describe('Authentication', () => {
    describe('OAuth2', () => {
      it('should configure OAuth2 authentication', () => {
        const auth = new Authentication({
          type: 'oauth2',
          oauth2Config: {
            authorizeUrl: 'https://api.example.com/oauth/authorize',
            getAccessToken: async () => ({ access_token: 'token123' }),
          },
          test: async () => ({}),
        })

        expect(auth.type).toBe('oauth2')
      })

      it('should build authorization URL with params', () => {
        const auth = new Authentication({
          type: 'oauth2',
          oauth2Config: {
            authorizeUrl: 'https://api.example.com/oauth/authorize',
            getAccessToken: async () => ({ access_token: 'token' }),
            scope: 'read write',
          },
          test: async () => ({}),
        })

        const url = auth.getAuthorizeUrl({
          client_id: 'my-client-id',
          redirect_uri: 'https://zapier.com/callback',
          state: 'abc123',
        })

        expect(url).toContain('client_id=my-client-id')
        expect(url).toContain('redirect_uri=')
        expect(url).toContain('state=abc123')
        expect(url).toContain('scope=read+write')
      })

      it('should check if token is expired', () => {
        const auth = new Authentication({
          type: 'oauth2',
          oauth2Config: {
            authorizeUrl: 'https://api.example.com/oauth/authorize',
            getAccessToken: async () => ({ access_token: 'token' }),
          },
          test: async () => ({}),
        })

        const expired = auth.isTokenExpired({
          expires_at: Date.now() - 1000,
        })

        expect(expired).toBe(true)
      })
    })

    describe('API Key', () => {
      it('should configure API key authentication', () => {
        const auth = new Authentication({
          type: 'api_key',
          fields: [{ key: 'api_key', label: 'API Key', required: true }],
          test: async () => ({}),
        })

        expect(auth.type).toBe('api_key')
        expect(auth.getFields()).toHaveLength(1)
      })
    })

    describe('Session Auth', () => {
      it('should configure session authentication', () => {
        const auth = new Authentication({
          type: 'session',
          sessionConfig: {
            perform: async () => ({ sessionKey: 'session123' }),
          },
          test: async () => ({}),
        })

        expect(auth.type).toBe('session')
      })
    })

    describe('Auth Helpers', () => {
      it('should create basic auth header', () => {
        const header = createBasicAuthHeader('user', 'pass')
        expect(header).toBe('Basic dXNlcjpwYXNz')
      })

      it('should create bearer auth header', () => {
        const header = createBearerAuthHeader('mytoken')
        expect(header).toBe('Bearer mytoken')
      })

      it('should generate code verifier for PKCE', () => {
        const verifier = generateCodeVerifier()
        expect(verifier.length).toBeGreaterThan(0)
      })
    })
  })

  // ============================================================================
  // Z OBJECT TESTS
  // ============================================================================

  describe('ZObject', () => {
    it('should create a Z object for HTTP requests', () => {
      const z = createZObject()

      expect(z.request).toBeDefined()
      expect(z.console).toBeDefined()
      expect(z.JSON).toBeDefined()
      expect(z.errors).toBeDefined()
      expect(z.cursor).toBeDefined()
    })

    it('should make GET requests', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ users: [{ id: 1 }] }), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const z = createZObject()
      const response = await z.request({
        url: 'https://api.example.com/users',
        method: 'GET',
        skipThrowForStatus: true,
      })

      expect(response.status).toBe(200)
      expect(response.data).toEqual({ users: [{ id: 1 }] })
    })

    it('should make POST requests with body', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 2 }), { status: 201 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const z = createZObject()
      const response = await z.request({
        url: 'https://api.example.com/users',
        method: 'POST',
        json: { name: 'John' },
        skipThrowForStatus: true,
      })

      expect(response.status).toBe(201)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('should support shorthand URL request', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('{}', { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const z = createZObject()
      await z.request('https://api.example.com/simple')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/simple',
        expect.anything()
      )
    })

    it('should support params in URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('{}', { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const z = createZObject()
      await z.request({
        url: 'https://api.example.com/users',
        params: { page: '1', limit: '10' },
        skipThrowForStatus: true,
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users?page=1&limit=10',
        expect.anything()
      )
    })

    it('should provide console logging', () => {
      const z = createZObject()
      const logSpy = vi.spyOn(console, 'log')

      z.console.log('Test message')

      expect(logSpy).toHaveBeenCalled()
    })

    it('should provide JSON utilities', () => {
      const z = createZObject()

      expect(z.JSON.parse('{"a":1}')).toEqual({ a: 1 })
      expect(z.JSON.stringify({ a: 1 })).toBe('{"a":1}')
    })

    it('should support dehydration', () => {
      const z = createZObject()

      const ref = z.dehydrate(async () => ({ data: 'lazy' }), { id: '123' })

      expect(ref).toContain('hydrate')
      expect(typeof ref).toBe('string')
    })

    it('should generate callback URLs', () => {
      const z = createZObject()

      const url = z.generateCallbackUrl()

      expect(url).toContain('hooks.zapier.com')
    })

    it('should hash values', () => {
      const z = createZObject()

      const hash = z.hash('sha256', 'test value')

      expect(hash.length).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // TRIGGER TESTS
  // ============================================================================

  describe('Triggers', () => {
    describe('Polling Triggers', () => {
      it('should create a polling trigger', () => {
        const config = createPollingTrigger({
          key: 'new_order',
          noun: 'Order',
          display: {
            label: 'New Order',
            description: 'Triggers when a new order is placed',
          },
          perform: async () => [],
        })

        expect(config.key).toBe('new_order')
        expect(config.operation.type).toBe('polling')
      })

      it('should support input fields for filtering', () => {
        const config = createPollingTrigger({
          key: 'new_contact',
          noun: 'Contact',
          display: { label: 'New Contact', description: 'Triggers on new contact' },
          perform: async () => [],
          inputFields: [
            { key: 'list_id', label: 'List', dynamic: 'list.id.name' },
            { key: 'status', label: 'Status', choices: ['active', 'inactive'] },
          ],
        })

        expect(config.operation.inputFields).toHaveLength(2)
      })

      it('should support sample data', () => {
        const config = createPollingTrigger({
          key: 'new_contact',
          noun: 'Contact',
          display: { label: 'New Contact', description: 'Triggers on new contact' },
          perform: async () => [],
          sample: { id: 'sample-1', email: 'test@example.com' },
        })

        expect(config.operation.sample).toBeDefined()
        expect(config.operation.sample?.email).toBe('test@example.com')
      })

      it('should execute polling trigger', async () => {
        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), { status: 200 })
        )
        vi.stubGlobal('fetch', mockFetch)

        const app = new App({
          version: '1.0.0',
          platformVersion: '14.0.0',
          triggers: {
            new_order: createPollingTrigger({
              key: 'new_order',
              noun: 'Order',
              display: { label: 'New Order', description: 'Triggers on orders' },
              perform: async (z) => {
                const response = await z.request({ url: 'https://api.example.com/orders', skipThrowForStatus: true })
                return response.data as unknown[]
              },
            }),
          },
          actions: {},
          searches: {},
        })

        const results = await app.executeTrigger('new_order', { inputData: {}, authData: {} })

        expect(results).toHaveLength(2)
      })
    })

    describe('Webhook Triggers', () => {
      it('should create a webhook trigger', () => {
        const config = createHookTrigger({
          key: 'new_payment',
          noun: 'Payment',
          display: { label: 'New Payment', description: 'Triggers on payment' },
          performSubscribe: async () => ({ id: 'hook-123' }),
          performUnsubscribe: async () => ({}),
          perform: async (z, bundle) => [bundle.cleanedRequest],
        })

        expect(config.operation.type).toBe('hook')
        expect(config.operation.performSubscribe).toBeDefined()
        expect(config.operation.performUnsubscribe).toBeDefined()
      })

      it('should handle webhook payload', async () => {
        const config = createHookTrigger({
          key: 'new_event',
          noun: 'Event',
          display: { label: 'New Event', description: 'Webhook trigger' },
          performSubscribe: async () => ({ id: '123' }),
          performUnsubscribe: async () => ({}),
          perform: async (z, bundle) => [bundle.cleanedRequest],
        })

        const triggerObj = new Trigger(config)
        const z = createZObject()
        const bundle: Bundle = {
          inputData: {},
          authData: {},
          cleanedRequest: { id: 'event-456', type: 'order.created' },
        }

        const results = await triggerObj.perform(z, bundle)

        expect(results).toHaveLength(1)
        expect(results[0]).toEqual({ id: 'event-456', type: 'order.created' })
      })
    })

    describe('Trigger Builder', () => {
      it('should build a trigger with fluent API', () => {
        const config = trigger()
          .key('new_item')
          .noun('Item')
          .label('New Item')
          .description('Triggers on new item')
          .polling()
          .perform(async () => [])
          .sample({ id: 1 })
          .build()

        expect(config.key).toBe('new_item')
        expect(config.noun).toBe('Item')
        expect(config.operation.type).toBe('polling')
      })
    })

    describe('Trigger Utilities', () => {
      it('should sort results by newest', () => {
        const items = [
          { id: 1, created_at: '2024-01-01' },
          { id: 2, created_at: '2024-01-03' },
          { id: 3, created_at: '2024-01-02' },
        ]

        const sorted = sortByNewest(items)

        expect(sorted[0].id).toBe(2)
        expect(sorted[1].id).toBe(3)
        expect(sorted[2].id).toBe(1)
      })

      it('should deduplicate results', () => {
        const items = [
          { id: 1, name: 'A' },
          { id: 2, name: 'B' },
          { id: 1, name: 'A duplicate' },
        ]

        const unique = deduplicateResults(items)

        expect(unique).toHaveLength(2)
      })
    })

    describe('PollingTriggerExecutor', () => {
      it('should deduplicate across multiple polls', async () => {
        const config = createPollingTrigger({
          key: 'test',
          noun: 'Test',
          display: { label: 'Test', description: 'Test' },
          perform: async () => [{ id: '1' }, { id: '2' }],
        })

        const triggerObj = new Trigger(config)
        const executor = new PollingTriggerExecutor(triggerObj, 'id')
        const z = createZObject()
        const bundle: Bundle = { inputData: {}, authData: {} }

        // First poll - all items are new
        const results1 = await executor.poll(z, bundle)
        expect(results1).toHaveLength(2)

        // Second poll - same items, should be deduplicated
        const results2 = await executor.poll(z, bundle)
        expect(results2).toHaveLength(0)

        expect(executor.getSeenCount()).toBe(2)
      })
    })
  })

  // ============================================================================
  // ACTION TESTS
  // ============================================================================

  describe('Actions', () => {
    it('should create an action', () => {
      const config = createAction({
        key: 'create_contact',
        noun: 'Contact',
        display: { label: 'Create Contact', description: 'Creates a contact' },
        perform: async () => ({}),
        inputFields: [
          { key: 'email', label: 'Email', required: true },
          { key: 'name', label: 'Name' },
        ],
      })

      expect(config.key).toBe('create_contact')
      expect(config.operation.inputFields).toHaveLength(2)
    })

    it('should execute action', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'new-123' }), { status: 201 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const app = new App({
        version: '1.0.0',
        platformVersion: '14.0.0',
        triggers: {},
        actions: {
          create_contact: createAction({
            key: 'create_contact',
            noun: 'Contact',
            display: { label: 'Create Contact', description: 'Creates a contact' },
            perform: async (z, bundle) => {
              const response = await z.request({
                url: 'https://api.example.com/contacts',
                method: 'POST',
                json: bundle.inputData,
                skipThrowForStatus: true,
              })
              return response.data
            },
          }),
        },
        searches: {},
      })

      const result = await app.executeAction('create_contact', {
        inputData: { email: 'test@example.com' },
        authData: {},
      })

      expect(result).toEqual({ id: 'new-123' })
    })

    it('should build action with fluent API', () => {
      const config = action()
        .key('create_item')
        .noun('Item')
        .label('Create Item')
        .description('Creates an item')
        .perform(async () => ({}))
        .inputField({ key: 'name', label: 'Name', required: true })
        .build()

      expect(config.key).toBe('create_item')
    })

    it('should validate required input', () => {
      const config = createAction({
        key: 'test',
        noun: 'Test',
        display: { label: 'Test', description: 'Test' },
        perform: async () => ({}),
        inputFields: [{ key: 'required_field', label: 'Required', required: true }],
      })

      const actionObj = new Action(config)
      const result = actionObj.validateInput({ other_field: 'value' })

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    describe('Field Helpers', () => {
      it('should create string field', () => {
        const field = stringField('name', 'Name', { helpText: 'Enter name' })
        expect(field.key).toBe('name')
        expect(field.type).toBe('string')
      })

      it('should create required string field', () => {
        const field = requiredString('email', 'Email')
        expect(field.required).toBe(true)
      })

      it('should create number field', () => {
        const field = numberField('amount', 'Amount')
        expect(field.type).toBe('number')
      })

      it('should create boolean field', () => {
        const field = booleanField('active', 'Active')
        expect(field.type).toBe('boolean')
      })

      it('should create select field', () => {
        const field = selectField('status', 'Status', ['open', 'closed'])
        expect(field.choices).toEqual(['open', 'closed'])
      })

      it('should create dynamic field', () => {
        const field = dynamicField('list_id', 'List', 'lists.id.name')
        expect(field.dynamic).toBe('lists.id.name')
      })
    })

    describe('Input Transformations', () => {
      it('should merge with defaults', () => {
        const fields: InputField[] = [
          { key: 'name', label: 'Name', default: 'Default Name' },
          { key: 'count', label: 'Count', type: 'number', default: 10 },
        ]

        const merged = mergeWithDefaults({ name: 'Custom' }, fields)

        expect(merged.name).toBe('Custom')
        expect(merged.count).toBe(10)
      })

      it('should clean input data', () => {
        const cleaned = cleanInputData({
          name: 'Test',
          empty: null,
          missing: undefined,
          zero: 0,
        })

        expect(cleaned.name).toBe('Test')
        expect(cleaned.zero).toBe(0)
        expect('empty' in cleaned).toBe(false)
        expect('missing' in cleaned).toBe(false)
      })

      it('should transform input data types', () => {
        const fields: InputField[] = [
          { key: 'count', label: 'Count', type: 'number' },
          { key: 'active', label: 'Active', type: 'boolean' },
        ]

        const transformed = transformInputData(
          { count: '42', active: 'true' },
          fields
        )

        expect(transformed.count).toBe(42)
        expect(transformed.active).toBe(true)
      })
    })
  })

  // ============================================================================
  // SEARCH TESTS
  // ============================================================================

  describe('Searches', () => {
    it('should create a search', () => {
      const config = createSearch({
        key: 'find_contact',
        noun: 'Contact',
        display: { label: 'Find Contact', description: 'Finds a contact' },
        perform: async () => [],
        inputFields: [{ key: 'email', label: 'Email', required: true }],
      })

      expect(config.key).toBe('find_contact')
    })

    it('should execute search', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{ id: 1, email: 'test@example.com' }]), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const app = new App({
        version: '1.0.0',
        platformVersion: '14.0.0',
        triggers: {},
        actions: {},
        searches: {
          find_contact: createSearch({
            key: 'find_contact',
            noun: 'Contact',
            display: { label: 'Find Contact', description: 'Finds a contact' },
            perform: async (z, bundle) => {
              const response = await z.request({
                url: 'https://api.example.com/contacts',
                params: { email: bundle.inputData.email as string },
                skipThrowForStatus: true,
              })
              return response.data as unknown[]
            },
          }),
        },
      })

      const results = await app.executeSearch('find_contact', {
        inputData: { email: 'test@example.com' },
        authData: {},
      })

      expect(Array.isArray(results)).toBe(true)
      expect(results).toHaveLength(1)
    })

    it('should support search or create', () => {
      const config = createSearch({
        key: 'find_or_create_contact',
        noun: 'Contact',
        display: { label: 'Find or Create', description: 'Finds or creates' },
        perform: async () => [],
        searchOrCreateKey: 'create_contact',
      })

      expect(config.searchOrCreateKey).toBe('create_contact')
    })

    it('should build search with fluent API', () => {
      const config = search()
        .key('find_item')
        .noun('Item')
        .label('Find Item')
        .description('Finds an item')
        .perform(async () => [])
        .searchOrCreateKey('create_item')
        .build()

      expect(config.key).toBe('find_item')
      expect(config.searchOrCreateKey).toBe('create_item')
    })

    it('should create ID search', () => {
      const config = createIdSearch({
        key: 'find_user',
        noun: 'User',
        baseUrl: 'https://api.example.com/users',
      })

      expect(config.key).toBe('find_user')
      expect(config.operation.inputFields![0].key).toBe('id')
    })

    describe('Search Utilities', () => {
      it('should filter search results', () => {
        const results = [
          { id: 1, name: 'Alice', status: 'pending' },
          { id: 2, name: 'Bob', status: 'approved' },
          { id: 3, name: 'Charlie', status: 'pending' },
        ]

        // filterSearchResults uses case-insensitive contains for strings
        const filtered = filterSearchResults(results, { status: 'pending' })

        expect(filtered).toHaveLength(2)
        expect(filtered[0].name).toBe('Alice')
        expect(filtered[1].name).toBe('Charlie')
      })

      it('should sort search results', () => {
        const results = [
          { id: 3, name: 'Charlie' },
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ]

        const sorted = sortSearchResults(results, 'name', 'asc')

        expect(sorted[0].name).toBe('Alice')
        expect(sorted[1].name).toBe('Bob')
        expect(sorted[2].name).toBe('Charlie')
      })

      it('should paginate search results', () => {
        const results = Array.from({ length: 50 }, (_, i) => ({ id: i }))

        const page1 = paginateSearchResults(results, 1, 10)

        expect(page1.items).toHaveLength(10)
        expect(page1.total).toBe(50)
        expect(page1.totalPages).toBe(5)
        expect(page1.page).toBe(1)
      })
    })
  })

  // ============================================================================
  // WEBHOOK TESTS
  // ============================================================================

  describe('Webhook', () => {
    it('should generate verification token', () => {
      const token = generateVerificationToken()
      expect(token.length).toBe(64)
    })

    it('should parse event type from payload', () => {
      expect(parseEventType({ event: 'order.created' })).toBe('order.created')
      expect(parseEventType({ type: 'payment' })).toBe('payment')
      expect(parseEventType({ event_type: 'user.signup' })).toBe('user.signup')
      expect(parseEventType({ action: 'click' })).toBe('click')
    })

    it('should extract webhook data', () => {
      expect(extractWebhookData({ data: { id: 1 } })).toEqual({ id: 1 })
      expect(extractWebhookData({ payload: { id: 2 } })).toEqual({ id: 2 })
      expect(extractWebhookData({ id: 3 })).toEqual({ id: 3 })
    })

    it('should create success response', () => {
      const response = webhookSuccess({ processed: true })

      expect(response.status).toBe(200)
    })

    it('should create error response', () => {
      const response = webhookError(400, 'Invalid payload')

      expect(response.status).toBe(400)
    })

    describe('WebhookRetryManager', () => {
      it('should manage delivery retries', () => {
        const manager = new WebhookRetryManager()

        const delivery = manager.createDelivery('hook-1', { data: 'test' })

        expect(delivery.status).toBe('pending')
        expect(delivery.attempts).toBe(0)

        manager.recordAttempt(delivery.id, false, 500, 'Server error')

        const updated = manager.getDelivery(delivery.id)
        expect(updated?.attempts).toBe(1)
        expect(updated?.status).toBe('pending')
      })

      it('should mark as failed after max attempts', () => {
        const manager = new WebhookRetryManager()
        const delivery = manager.createDelivery('hook-1', { data: 'test' })

        // Simulate 5 failed attempts
        for (let i = 0; i < 5; i++) {
          manager.recordAttempt(delivery.id, false, 500)
        }

        const updated = manager.getDelivery(delivery.id)
        expect(updated?.status).toBe('failed')
      })
    })

    describe('WebhookSubscriptionManager', () => {
      it('should manage subscriptions', async () => {
        const manager = new WebhookSubscriptionManager()

        const triggerConfig: HookTriggerConfig = {
          key: 'test',
          noun: 'Test',
          display: { label: 'Test', description: 'Test' },
          operation: {
            type: 'hook',
            performSubscribe: async () => ({ id: 'sub-123' }),
            performUnsubscribe: async () => ({}),
            perform: async () => [],
          },
        }

        const z = createZObject()
        const bundle: Bundle = {
          inputData: {},
          authData: {},
          targetUrl: 'https://hooks.zapier.com/test',
        }

        const subscription = await manager.subscribe(triggerConfig, z, bundle)

        expect(subscription.id).toBe('sub-123')
        expect(manager.hasSubscription('sub-123')).toBe(true)
      })
    })
  })

  // ============================================================================
  // DYNAMIC FIELDS TESTS
  // ============================================================================

  describe('Dynamic Fields', () => {
    it('should validate field values', () => {
      const fields: InputField[] = [
        { key: 'email', label: 'Email', required: true },
        { key: 'age', label: 'Age', type: 'number' },
      ]

      const result1 = validateFieldValues({ email: 'test@example.com', age: '25' }, fields)
      expect(result1.valid).toBe(true)

      const result2 = validateFieldValues({ age: 'not a number' }, fields)
      expect(result2.valid).toBe(false)
    })

    it('should transform field values', () => {
      const fields: InputField[] = [
        { key: 'count', label: 'Count', type: 'integer' },
        { key: 'active', label: 'Active', type: 'boolean' },
      ]

      const transformed = transformFieldValues(
        { count: '42.7', active: 'true' },
        fields
      )

      expect(transformed.count).toBe(42)
      expect(transformed.active).toBe(true)
    })

    it('should generate sample data', () => {
      const fields: InputField[] = [
        { key: 'name', label: 'Name', type: 'string' },
        { key: 'count', label: 'Count', type: 'number' },
        { key: 'active', label: 'Active', type: 'boolean' },
        { key: 'status', label: 'Status', choices: ['open', 'closed'] },
      ]

      const sample = generateSampleData(fields)

      expect(sample.name).toBeDefined()
      expect(sample.count).toBe(123.45)
      expect(sample.active).toBe(true)
      expect(sample.status).toBe('open')
    })

    it('should flatten fields', () => {
      const fields: InputField[] = [
        { key: 'name', label: 'Name' },
        {
          key: 'address',
          label: 'Address',
          children: [
            { key: 'street', label: 'Street' },
            { key: 'city', label: 'City' },
          ],
        },
      ]

      const flattened = flattenFields(fields)

      expect(flattened.find((f) => f.key === 'address.street')).toBeDefined()
      expect(flattened.find((f) => f.key === 'address.city')).toBeDefined()
    })

    it('should unflatten data', () => {
      const data = {
        name: 'Test',
        'address.street': '123 Main St',
        'address.city': 'Anytown',
      }

      const unflattened = unflattenData(data)

      expect(unflattened.name).toBe('Test')
      expect((unflattened.address as any).street).toBe('123 Main St')
      expect((unflattened.address as any).city).toBe('Anytown')
    })

    describe('FieldDependencyGraph', () => {
      it('should track field dependencies', () => {
        const graph = new FieldDependencyGraph()

        graph.addDependency('city', 'country')
        graph.addDependency('state', 'country')

        expect(graph.getDependents('country')).toContain('city')
        expect(graph.getDependents('country')).toContain('state')
        expect(graph.getDependencies('city')).toContain('country')
      })

      it('should get resolution order', () => {
        const graph = new FieldDependencyGraph()

        graph.addDependency('city', 'state')
        graph.addDependency('state', 'country')

        const order = graph.getResolutionOrder(['city', 'state', 'country'])

        expect(order.indexOf('country')).toBeLessThan(order.indexOf('state'))
        expect(order.indexOf('state')).toBeLessThan(order.indexOf('city'))
      })
    })
  })

  // ============================================================================
  // HYDRATION TESTS
  // ============================================================================

  describe('Hydration', () => {
    it('should support dehydrate/hydrate pattern', () => {
      const z = createZObject()

      const ref = z.dehydrate(
        async (z, bundle) => ({ data: 'fetched', id: bundle.inputData.id }),
        { id: '123' }
      )

      expect(ref).toBeDefined()
      expect(typeof ref).toBe('string')
      expect(ref).toContain('hydrate')
    })

    it('should support file dehydration', () => {
      const z = createZObject()

      const ref = z.dehydrateFile(
        async (z, bundle) => ({ url: bundle.inputData.fileUrl }),
        { fileUrl: 'https://example.com/file.pdf' }
      )

      expect(ref).toContain('hydrate:file')
    })

    describe('HydrationManager', () => {
      it('should manage hydration entries', async () => {
        const manager = new HydrationManager()

        manager.register(
          'test-id',
          async () => ({ data: 'hydrated' }),
          { key: 'value' }
        )

        const z = createZObject()
        const bundle: Bundle = { inputData: {}, authData: {} }

        const result = await manager.hydrate('test-id', z, bundle)

        expect(result).toEqual({ data: 'hydrated' })
      })

      it('should check if value is dehydrated', () => {
        const manager = new HydrationManager()

        expect(manager.isDehydrated('hydrate:123')).toBe(true)
        expect(manager.isDehydrated('regular string')).toBe(false)
        expect(manager.isDehydrated(123)).toBe(false)
      })
    })
  })

  // ============================================================================
  // MIDDLEWARE TESTS
  // ============================================================================

  describe('Middleware', () => {
    it('should add header middleware', () => {
      const middleware = addHeaderMiddleware('X-Custom', 'value')

      const result = middleware(
        { url: 'https://api.example.com', headers: {} },
        createZObject(),
        { inputData: {}, authData: {} }
      )

      expect(result.headers!['X-Custom']).toBe('value')
    })

    it('should add auth middleware for bearer token', () => {
      const middleware = authMiddleware('bearer', { tokenField: 'access_token' })

      const result = middleware(
        { url: 'https://api.example.com', headers: {} },
        createZObject(),
        { inputData: {}, authData: { access_token: 'my-token' } }
      )

      expect(result.headers!['Authorization']).toBe('Bearer my-token')
    })

    it('should add auth middleware for api key', () => {
      const middleware = authMiddleware('api_key', {
        headerName: 'X-API-Key',
        tokenField: 'api_key',
      })

      const result = middleware(
        { url: 'https://api.example.com', headers: {} },
        createZObject(),
        { inputData: {}, authData: { api_key: 'secret-key' } }
      )

      expect(result.headers!['X-API-Key']).toBe('secret-key')
    })
  })

  // ============================================================================
  // REQUEST HELPERS TESTS
  // ============================================================================

  describe('Request Helpers', () => {
    it('should create GET request', () => {
      const request = get('https://api.example.com/users', { page: '1' })

      expect(request.url).toBe('https://api.example.com/users')
      expect(request.method).toBe('GET')
      expect(request.params?.page).toBe('1')
    })

    it('should create POST request', () => {
      const request = post('https://api.example.com/users', { name: 'John' })

      expect(request.method).toBe('POST')
      expect(request.json).toEqual({ name: 'John' })
    })

    it('should add auth to request', () => {
      const request = withAuth(
        get('https://api.example.com'),
        'bearer',
        'my-token'
      )

      expect(request.headers!['Authorization']).toBe('Bearer my-token')
    })

    it('should add headers to request', () => {
      const request = withHeaders(get('https://api.example.com'), {
        'X-Custom': 'value',
      })

      expect(request.headers!['X-Custom']).toBe('value')
    })
  })

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('Error Handling', () => {
    it('should throw custom Zapier errors', () => {
      const z = createZObject()

      expect(() => {
        throw new z.errors.Error('Custom error')
      }).toThrow('Custom error')

      expect(() => {
        throw new z.errors.ExpiredAuthError()
      }).toThrow('Authentication has expired')

      expect(() => {
        throw new z.errors.HaltedError()
      }).toThrow('Zap has been halted')
    })

    it('should throw ResponseError for failed requests', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const z = createZObject()

      await expect(
        z.request({ url: 'https://api.example.com/missing' })
      ).rejects.toThrow()
    })
  })

  // ============================================================================
  // BUNDLE TESTS
  // ============================================================================

  describe('Bundle', () => {
    it('should have inputData property', () => {
      const bundle: Bundle = {
        inputData: { email: 'test@example.com' },
        authData: {},
      }

      expect(bundle.inputData.email).toBe('test@example.com')
    })

    it('should have authData property', () => {
      const bundle: Bundle = {
        inputData: {},
        authData: { access_token: 'token123' },
      }

      expect(bundle.authData.access_token).toBe('token123')
    })

    it('should have meta property', () => {
      const bundle: Bundle = {
        inputData: {},
        authData: {},
        meta: {
          isLoadingSample: true,
          limit: 100,
          page: 1,
        },
      }

      expect(bundle.meta?.isLoadingSample).toBe(true)
      expect(bundle.meta?.limit).toBe(100)
    })

    it('should have targetUrl for webhooks', () => {
      const bundle: Bundle = {
        inputData: {},
        authData: {},
        targetUrl: 'https://hooks.zapier.com/hooks/standard/12345',
      }

      expect(bundle.targetUrl).toContain('hooks.zapier.com')
    })

    it('should have subscribeData for unsubscribe', () => {
      const bundle: Bundle = {
        inputData: {},
        authData: {},
        subscribeData: { id: 'webhook-789', secret: 'webhook-secret' },
      }

      expect(bundle.subscribeData?.id).toBe('webhook-789')
    })

    it('should have cleanedRequest for webhooks', () => {
      const bundle: Bundle = {
        inputData: {},
        authData: {},
        cleanedRequest: { id: 'event-123', type: 'order.created' },
      }

      expect(bundle.cleanedRequest?.type).toBe('order.created')
    })
  })
})
