/**
 * Zapier Action Execution Tests
 *
 * Comprehensive tests for Zapier action functionality:
 * - Action definition structure
 * - perform() function execution
 * - Input field validation
 * - Dynamic field loading
 * - Bundle context (authData, inputData, meta)
 * - Error handling and user-friendly messages
 * - Bulk actions (performBulk)
 * - Search actions (performSearch, performGet)
 *
 * TDD RED Phase - These tests define expected behavior for features
 * that don't exist yet.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  // Core
  App,
  createZObject,
  // Action helpers
  Action,
  createAction,
  ActionBuilder,
  action,
  stringField,
  requiredString,
  numberField,
  integerField,
  booleanField,
  datetimeField,
  fileField,
  passwordField,
  selectField,
  dynamicField,
  searchField,
  listField,
  outputField,
  importantField,
  mergeWithDefaults,
  cleanInputData,
  transformInputData,
  formatOutputData,
  // Types
  type Bundle,
  type ZObject,
  type ActionConfig,
  type InputField,
  // Errors
  ZapierError,
  ExpiredAuthError,
  HaltedError,
  ThrottledError,
  ResponseError,
} from '../index'

describe('Zapier Action Execution', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // ============================================================================
  // ACTION DEFINITION STRUCTURE
  // ============================================================================

  describe('Action Definition Structure', () => {
    it('should require key, noun, display, and operation', () => {
      const config = createAction({
        key: 'create_contact',
        noun: 'Contact',
        display: {
          label: 'Create Contact',
          description: 'Creates a new contact in the system',
        },
        perform: async () => ({ id: '123' }),
      })

      expect(config.key).toBe('create_contact')
      expect(config.noun).toBe('Contact')
      expect(config.display.label).toBe('Create Contact')
      expect(config.display.description).toBe('Creates a new contact in the system')
      expect(config.operation.perform).toBeDefined()
    })

    it('should support hidden actions', () => {
      const config = createAction({
        key: 'internal_action',
        noun: 'Internal',
        display: {
          label: 'Internal Action',
          description: 'Hidden from users',
          hidden: true,
        },
        perform: async () => ({}),
      })

      expect(config.display.hidden).toBe(true)
    })

    it('should support important actions', () => {
      const config = createAction({
        key: 'important_action',
        noun: 'Important',
        display: {
          label: 'Important Action',
          description: 'Highlighted to users',
          important: true,
        },
        perform: async () => ({}),
      })

      expect(config.display.important).toBe(true)
    })

    it('should support directions for setup help', () => {
      const config = createAction({
        key: 'complex_action',
        noun: 'Complex',
        display: {
          label: 'Complex Action',
          description: 'Requires setup',
          directions: 'First, configure your API key in the authentication settings.',
        },
        perform: async () => ({}),
      })

      expect(config.display.directions).toContain('configure your API key')
    })

    it('should support sample data for testing', () => {
      const config = createAction({
        key: 'create_user',
        noun: 'User',
        display: { label: 'Create User', description: 'Creates a user' },
        perform: async () => ({}),
        sample: {
          id: 'user_123',
          email: 'sample@example.com',
          name: 'Sample User',
          created_at: '2024-01-01T00:00:00Z',
        },
      })

      expect(config.operation.sample).toBeDefined()
      expect(config.operation.sample?.id).toBe('user_123')
      expect(config.operation.sample?.email).toBe('sample@example.com')
    })

    it('should support output fields for describing response', () => {
      const config = createAction({
        key: 'create_order',
        noun: 'Order',
        display: { label: 'Create Order', description: 'Creates an order' },
        perform: async () => ({}),
        outputFields: [
          { key: 'id', label: 'Order ID', important: true },
          { key: 'status', label: 'Status' },
          { key: 'total', label: 'Total Amount', type: 'number' },
          { key: 'created_at', label: 'Created At', type: 'datetime' },
        ],
      })

      expect(config.operation.outputFields).toHaveLength(4)
      expect(config.operation.outputFields![0].important).toBe(true)
    })
  })

  // ============================================================================
  // PERFORM FUNCTION EXECUTION
  // ============================================================================

  describe('perform() Function Execution', () => {
    it('should execute perform function with z and bundle', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'created_123', name: 'Test' }), { status: 201 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const config = createAction({
        key: 'create_item',
        noun: 'Item',
        display: { label: 'Create Item', description: 'Creates an item' },
        perform: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/items',
            method: 'POST',
            json: bundle.inputData,
            skipThrowForStatus: true,
          })
          return response.data
        },
      })

      const actionInstance = new Action(config)
      const z = createZObject()
      const bundle: Bundle = {
        inputData: { name: 'Test Item' },
        authData: { access_token: 'token123' },
      }

      const result = await actionInstance.perform(z, bundle)

      expect(result).toEqual({ id: 'created_123', name: 'Test' })
    })

    it('should pass input data to perform function', async () => {
      let capturedInputData: Record<string, unknown> = {}

      const config = createAction({
        key: 'capture_input',
        noun: 'Capture',
        display: { label: 'Capture Input', description: 'Captures input' },
        perform: async (z, bundle) => {
          capturedInputData = bundle.inputData
          return { success: true }
        },
      })

      const actionInstance = new Action(config)
      const z = createZObject()
      const bundle: Bundle = {
        inputData: {
          email: 'test@example.com',
          name: 'John Doe',
          age: 30,
          active: true,
        },
        authData: {},
      }

      await actionInstance.perform(z, bundle)

      expect(capturedInputData.email).toBe('test@example.com')
      expect(capturedInputData.name).toBe('John Doe')
      expect(capturedInputData.age).toBe(30)
      expect(capturedInputData.active).toBe(true)
    })

    it('should return created resource with ID', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          id: 'contact_abc123',
          email: 'new@example.com',
          created_at: '2024-01-15T10:00:00Z',
        }), { status: 201 })
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
        inputData: { email: 'new@example.com' },
        authData: {},
      })

      expect((result as any).id).toBe('contact_abc123')
      expect((result as any).email).toBe('new@example.com')
    })

    it('should handle async operations with retries', async () => {
      let attempts = 0
      const mockFetch = vi.fn().mockImplementation(() => {
        attempts++
        if (attempts < 3) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'Server busy' }), { status: 503 })
          )
        }
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'success' }), { status: 200 })
        )
      })
      vi.stubGlobal('fetch', mockFetch)

      const config = createAction({
        key: 'retry_action',
        noun: 'Retry',
        display: { label: 'Retry Action', description: 'Retries on failure' },
        perform: async (z, bundle) => {
          // Simulating retry logic that would be built into the framework
          const response = await z.request({
            url: 'https://api.example.com/items',
            method: 'POST',
            json: bundle.inputData,
            skipThrowForStatus: true,
          })
          return response.data
        },
      })

      const actionInstance = new Action(config)
      const z = createZObject()
      const bundle: Bundle = { inputData: {}, authData: {} }

      // Execute multiple times to simulate retry
      await actionInstance.perform(z, bundle)
      await actionInstance.perform(z, bundle)
      const result = await actionInstance.perform(z, bundle)

      expect(result).toEqual({ id: 'success' })
      expect(attempts).toBe(3)
    })
  })

  // ============================================================================
  // INPUT FIELD VALIDATION
  // ============================================================================

  describe('Input Field Validation', () => {
    it('should validate required fields', () => {
      const config = createAction({
        key: 'validate_required',
        noun: 'Validate',
        display: { label: 'Validate Required', description: 'Validates required fields' },
        perform: async () => ({}),
        inputFields: [
          { key: 'email', label: 'Email', required: true },
          { key: 'name', label: 'Name', required: true },
          { key: 'phone', label: 'Phone' }, // Optional
        ],
      })

      const actionInstance = new Action(config)

      // Missing both required fields
      const result1 = actionInstance.validateInput({})
      expect(result1.valid).toBe(false)
      expect(result1.errors).toHaveLength(2)

      // Missing one required field
      const result2 = actionInstance.validateInput({ email: 'test@example.com' })
      expect(result2.valid).toBe(false)
      expect(result2.errors).toHaveLength(1)

      // All required fields present
      const result3 = actionInstance.validateInput({
        email: 'test@example.com',
        name: 'John',
      })
      expect(result3.valid).toBe(true)
      expect(result3.errors).toHaveLength(0)
    })

    it('should reject empty strings for required fields', () => {
      const config = createAction({
        key: 'validate_empty',
        noun: 'Validate',
        display: { label: 'Validate Empty', description: 'Validates empty strings' },
        perform: async () => ({}),
        inputFields: [
          { key: 'name', label: 'Name', required: true },
        ],
      })

      const actionInstance = new Action(config)

      const result = actionInstance.validateInput({ name: '' })
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('name')
    })

    it('should validate field types', () => {
      const fields: InputField[] = [
        { key: 'count', label: 'Count', type: 'number', required: true },
        { key: 'quantity', label: 'Quantity', type: 'integer', required: true },
        { key: 'active', label: 'Active', type: 'boolean' },
        { key: 'created', label: 'Created', type: 'datetime' },
      ]

      // Test number validation
      const transformedValid = transformInputData({ count: '42', quantity: '10' }, fields)
      expect(transformedValid.count).toBe(42)
      expect(transformedValid.quantity).toBe(10)

      // Test integer truncation
      const transformedTruncate = transformInputData({ count: '10', quantity: '7.9' }, fields)
      expect(transformedTruncate.quantity).toBe(7)

      // Test boolean transformation
      const transformedBool = transformInputData({ count: '1', quantity: '1', active: 'true' }, fields)
      expect(transformedBool.active).toBe(true)

      const transformedBoolFalse = transformInputData({ count: '1', quantity: '1', active: 'false' }, fields)
      expect(transformedBoolFalse.active).toBe(false)
    })

    it('should validate choices/enum fields', () => {
      const config = createAction({
        key: 'validate_choices',
        noun: 'Validate',
        display: { label: 'Validate Choices', description: 'Validates choice fields' },
        perform: async () => ({}),
        inputFields: [
          selectField('status', 'Status', ['draft', 'published', 'archived'], { required: true }),
          selectField('priority', 'Priority', [
            { value: 'low', label: 'Low Priority' },
            { value: 'medium', label: 'Medium Priority' },
            { value: 'high', label: 'High Priority' },
          ]),
        ],
      })

      const actionInstance = new Action(config)

      // This is a RED test - validateChoices doesn't exist yet
      // The implementation should validate that the value is one of the choices
      expect((actionInstance as any).validateChoices).toBeDefined()

      // Expected behavior:
      // const validResult = actionInstance.validateChoices({ status: 'draft' })
      // expect(validResult.valid).toBe(true)
      // const invalidResult = actionInstance.validateChoices({ status: 'invalid' })
      // expect(invalidResult.valid).toBe(false)
    })

    it('should provide helpful error messages', () => {
      const config = createAction({
        key: 'helpful_errors',
        noun: 'HelpfulError',
        display: { label: 'Helpful Errors', description: 'Provides helpful errors' },
        perform: async () => ({}),
        inputFields: [
          { key: 'email', label: 'Email Address', required: true, helpText: 'Enter a valid email' },
          { key: 'amount', label: 'Amount (USD)', type: 'number', required: true },
        ],
      })

      const actionInstance = new Action(config)
      const result = actionInstance.validateInput({})

      // Errors should include the field label, not just the key
      expect(result.errors.some(e => e.includes('Email Address'))).toBe(true)
      expect(result.errors.some(e => e.includes('Amount (USD)'))).toBe(true)
    })

    it('should validate nested/list fields', () => {
      const config = createAction({
        key: 'validate_list',
        noun: 'ValidateList',
        display: { label: 'Validate List', description: 'Validates list fields' },
        perform: async () => ({}),
        inputFields: [
          listField('items', 'Items', [
            { key: 'name', label: 'Item Name', required: true },
            { key: 'quantity', label: 'Quantity', type: 'integer', required: true },
          ]),
        ],
      })

      const actionInstance = new Action(config)

      // RED test - validateListFields doesn't exist yet
      expect((actionInstance as any).validateListFields).toBeDefined()

      // Expected behavior:
      // const result = actionInstance.validateListFields({
      //   items: [
      //     { name: 'Item 1', quantity: 5 },
      //     { name: '', quantity: 3 }, // Invalid - empty name
      //   ]
      // })
      // expect(result.valid).toBe(false)
      // expect(result.errors[0]).toContain('Item Name')
    })
  })

  // ============================================================================
  // DYNAMIC FIELD LOADING
  // ============================================================================

  describe('Dynamic Field Loading', () => {
    it('should load dynamic fields from API', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([
          { id: 'list_1', name: 'Marketing List' },
          { id: 'list_2', name: 'Sales List' },
          { id: 'list_3', name: 'Support List' },
        ]), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const config = createAction({
        key: 'dynamic_fields',
        noun: 'DynamicFields',
        display: { label: 'Dynamic Fields', description: 'Uses dynamic fields' },
        perform: async () => ({}),
        inputFields: [
          dynamicField('list_id', 'List', 'list.id.name'),
          { key: 'email', label: 'Email', required: true },
        ],
      })

      const actionInstance = new Action(config)
      const z = createZObject()
      const bundle: Bundle = { inputData: {}, authData: {} }

      const resolvedFields = await actionInstance.resolveInputFields(z, bundle)

      // The dynamic field should reference a trigger that loads options
      const dynamicFieldDef = resolvedFields.find(f => f.key === 'list_id')
      expect(dynamicFieldDef).toBeDefined()
      expect(dynamicFieldDef?.dynamic).toBe('list.id.name')
    })

    it('should support dynamic input fields function', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          fields: [
            { key: 'custom_field_1', label: 'Custom Field 1', type: 'string' },
            { key: 'custom_field_2', label: 'Custom Field 2', type: 'number' },
          ]
        }), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const config = createAction({
        key: 'dynamic_input_fields',
        noun: 'DynamicInput',
        display: { label: 'Dynamic Input', description: 'Loads fields dynamically' },
        perform: async () => ({}),
        inputFields: [
          { key: 'object_type', label: 'Object Type', required: true },
          async (z, bundle) => {
            const response = await z.request({
              url: `https://api.example.com/objects/${bundle.inputData.object_type}/fields`,
              skipThrowForStatus: true,
            })
            const data = response.data as { fields: InputField[] }
            return data.fields
          },
        ],
      })

      const actionInstance = new Action(config)
      const z = createZObject()
      const bundle: Bundle = {
        inputData: { object_type: 'contact' },
        authData: {},
      }

      const resolvedFields = await actionInstance.resolveInputFields(z, bundle)

      expect(resolvedFields).toHaveLength(3) // 1 static + 2 dynamic
      expect(resolvedFields.find(f => f.key === 'custom_field_1')).toBeDefined()
      expect(resolvedFields.find(f => f.key === 'custom_field_2')).toBeDefined()
    })

    it('should refresh fields when altersDynamicFields is true', async () => {
      const config = createAction({
        key: 'alters_dynamic',
        noun: 'AltersDynamic',
        display: { label: 'Alters Dynamic', description: 'Field changes trigger refresh' },
        perform: async () => ({}),
        inputFields: [
          {
            key: 'country',
            label: 'Country',
            choices: ['US', 'UK', 'CA'],
            altersDynamicFields: true,
          },
          async (z, bundle) => {
            const country = bundle.inputData.country
            if (country === 'US') {
              return [{ key: 'state', label: 'State', choices: ['CA', 'NY', 'TX'] }]
            } else if (country === 'UK') {
              return [{ key: 'county', label: 'County', type: 'string' }]
            }
            return [{ key: 'province', label: 'Province', type: 'string' }]
          },
        ],
      })

      const actionInstance = new Action(config)
      const z = createZObject()

      // US selected
      const bundleUS: Bundle = { inputData: { country: 'US' }, authData: {} }
      const fieldsUS = await actionInstance.resolveInputFields(z, bundleUS)
      expect(fieldsUS.find(f => f.key === 'state')).toBeDefined()

      // UK selected
      const bundleUK: Bundle = { inputData: { country: 'UK' }, authData: {} }
      const fieldsUK = await actionInstance.resolveInputFields(z, bundleUK)
      expect(fieldsUK.find(f => f.key === 'county')).toBeDefined()
    })

    it('should load search field options', async () => {
      const config = createAction({
        key: 'search_field',
        noun: 'SearchField',
        display: { label: 'Search Field', description: 'Uses search for lookup' },
        perform: async () => ({}),
        inputFields: [
          searchField('contact_id', 'Contact', 'find_contact.id'),
          { key: 'message', label: 'Message', type: 'text' },
        ],
      })

      const actionInstance = new Action(config)
      const z = createZObject()
      const bundle: Bundle = { inputData: {}, authData: {} }

      const resolvedFields = await actionInstance.resolveInputFields(z, bundle)
      const contactField = resolvedFields.find(f => f.key === 'contact_id')

      expect(contactField?.search).toBe('find_contact.id')
    })
  })

  // ============================================================================
  // BUNDLE CONTEXT
  // ============================================================================

  describe('Bundle Context (authData, inputData, meta)', () => {
    it('should provide authData with authentication credentials', async () => {
      let capturedAuthData: Record<string, unknown> = {}

      const config = createAction({
        key: 'auth_context',
        noun: 'AuthContext',
        display: { label: 'Auth Context', description: 'Uses auth data' },
        perform: async (z, bundle) => {
          capturedAuthData = bundle.authData
          return { authenticated: true }
        },
      })

      const actionInstance = new Action(config)
      const z = createZObject()
      const bundle: Bundle = {
        inputData: {},
        authData: {
          access_token: 'oauth_token_123',
          refresh_token: 'refresh_token_456',
          expires_at: Date.now() + 3600000,
          api_key: 'api_key_789',
        },
      }

      await actionInstance.perform(z, bundle)

      expect(capturedAuthData.access_token).toBe('oauth_token_123')
      expect(capturedAuthData.refresh_token).toBe('refresh_token_456')
      expect(capturedAuthData.api_key).toBe('api_key_789')
    })

    it('should provide meta information', async () => {
      let capturedMeta: Bundle['meta'] = {}

      const config = createAction({
        key: 'meta_context',
        noun: 'MetaContext',
        display: { label: 'Meta Context', description: 'Uses meta data' },
        perform: async (z, bundle) => {
          capturedMeta = bundle.meta
          return {}
        },
      })

      const actionInstance = new Action(config)
      const z = createZObject()
      const bundle: Bundle = {
        inputData: {},
        authData: {},
        meta: {
          isLoadingSample: true,
          isFillingDynamicDropdown: false,
          isTestingAuth: false,
          limit: 100,
          page: 1,
          zap: { id: 'zap_123', name: 'My Zap' },
        },
      }

      await actionInstance.perform(z, bundle)

      expect(capturedMeta?.isLoadingSample).toBe(true)
      expect(capturedMeta?.zap?.id).toBe('zap_123')
      expect(capturedMeta?.zap?.name).toBe('My Zap')
    })

    it('should handle isLoadingSample for test data', async () => {
      const config = createAction({
        key: 'sample_loading',
        noun: 'SampleLoading',
        display: { label: 'Sample Loading', description: 'Handles sample loading' },
        perform: async (z, bundle) => {
          if (bundle.meta?.isLoadingSample) {
            // Return sample data without making API call
            return {
              id: 'sample_123',
              email: 'sample@example.com',
              name: 'Sample User',
            }
          }
          // Make actual API call
          const response = await z.request({
            url: 'https://api.example.com/contacts',
            method: 'POST',
            json: bundle.inputData,
          })
          return response.data
        },
        sample: {
          id: 'sample_123',
          email: 'sample@example.com',
          name: 'Sample User',
        },
      })

      const actionInstance = new Action(config)
      const z = createZObject()
      const bundle: Bundle = {
        inputData: {},
        authData: {},
        meta: { isLoadingSample: true },
      }

      const result = await actionInstance.perform(z, bundle)

      expect((result as any).id).toBe('sample_123')
    })

    it('should handle prefill data from meta', async () => {
      const config = createAction({
        key: 'prefill_action',
        noun: 'Prefill',
        display: { label: 'Prefill Action', description: 'Uses prefill data' },
        perform: async (z, bundle) => {
          const prefillData = bundle.meta?.prefill || {}
          const mergedInput = { ...prefillData, ...bundle.inputData }
          return mergedInput
        },
      })

      const actionInstance = new Action(config)
      const z = createZObject()
      const bundle: Bundle = {
        inputData: { name: 'Override Name' },
        authData: {},
        meta: {
          prefill: {
            email: 'prefilled@example.com',
            name: 'Prefilled Name',
            company: 'Prefilled Company',
          },
        },
      }

      const result = await actionInstance.perform(z, bundle)

      expect((result as any).email).toBe('prefilled@example.com')
      expect((result as any).name).toBe('Override Name') // User input overrides prefill
      expect((result as any).company).toBe('Prefilled Company')
    })

    it('should provide inputDataRaw with original unprocessed data', async () => {
      let capturedInputDataRaw: Record<string, unknown> | undefined

      const config = createAction({
        key: 'raw_input',
        noun: 'RawInput',
        display: { label: 'Raw Input', description: 'Uses raw input data' },
        perform: async (z, bundle) => {
          capturedInputDataRaw = bundle.inputDataRaw
          return {}
        },
      })

      const actionInstance = new Action(config)
      const z = createZObject()
      const bundle: Bundle = {
        inputData: { count: 42, active: true }, // Transformed
        authData: {},
        inputDataRaw: { count: '42', active: 'true' }, // Original string values
      }

      await actionInstance.perform(z, bundle)

      expect(capturedInputDataRaw?.count).toBe('42')
      expect(capturedInputDataRaw?.active).toBe('true')
    })
  })

  // ============================================================================
  // ERROR HANDLING AND USER-FRIENDLY MESSAGES
  // ============================================================================

  describe('Error Handling and User-Friendly Messages', () => {
    it('should throw user-friendly errors with z.errors.Error', async () => {
      const config = createAction({
        key: 'error_action',
        noun: 'Error',
        display: { label: 'Error Action', description: 'Throws errors' },
        perform: async (z, bundle) => {
          if (!bundle.inputData.email) {
            throw new z.errors.Error('Please provide an email address to create a contact.')
          }
          return {}
        },
      })

      const actionInstance = new Action(config)
      const z = createZObject()
      const bundle: Bundle = { inputData: {}, authData: {} }

      await expect(actionInstance.perform(z, bundle)).rejects.toThrow(
        'Please provide an email address to create a contact.'
      )
    })

    it('should throw HaltedError to stop Zap execution', async () => {
      const config = createAction({
        key: 'halted_action',
        noun: 'Halted',
        display: { label: 'Halted Action', description: 'Can halt execution' },
        perform: async (z, bundle) => {
          if (bundle.inputData.status === 'cancelled') {
            throw new z.errors.HaltedError('Order was cancelled, stopping Zap.')
          }
          return {}
        },
      })

      const actionInstance = new Action(config)
      const z = createZObject()
      const bundle: Bundle = { inputData: { status: 'cancelled' }, authData: {} }

      await expect(actionInstance.perform(z, bundle)).rejects.toThrow(HaltedError)
    })

    it('should throw ExpiredAuthError for auth refresh', async () => {
      const config = createAction({
        key: 'expired_auth_action',
        noun: 'ExpiredAuth',
        display: { label: 'Expired Auth', description: 'Handles expired auth' },
        perform: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/test',
            skipThrowForStatus: true,
          })
          if (response.status === 401) {
            throw new z.errors.ExpiredAuthError('Your API key has expired. Please reconnect.')
          }
          return response.data
        },
      })

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const actionInstance = new Action(config)
      const z = createZObject()
      const bundle: Bundle = { inputData: {}, authData: {} }

      await expect(actionInstance.perform(z, bundle)).rejects.toThrow(ExpiredAuthError)
    })

    it('should throw ThrottledError with retry delay', async () => {
      const config = createAction({
        key: 'throttled_action',
        noun: 'Throttled',
        display: { label: 'Throttled Action', description: 'Handles rate limiting' },
        perform: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/test',
            skipThrowForStatus: true,
          })
          if (response.status === 429) {
            const retryAfter = parseInt(response.getHeader('Retry-After') || '60', 10)
            throw new z.errors.ThrottledError(
              'Rate limit exceeded. Please wait before retrying.',
              retryAfter * 1000
            )
          }
          return response.data
        },
      })

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Rate limited' }), {
          status: 429,
          headers: { 'Retry-After': '30' },
        })
      )
      vi.stubGlobal('fetch', mockFetch)

      const actionInstance = new Action(config)
      const z = createZObject()
      const bundle: Bundle = { inputData: {}, authData: {} }

      try {
        await actionInstance.perform(z, bundle)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ThrottledError)
        expect((error as ThrottledError).delay).toBe(30000)
      }
    })

    it('should handle HTTP errors with meaningful messages', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          error: 'validation_error',
          message: 'Email address is invalid',
          field: 'email',
        }), { status: 400 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const config = createAction({
        key: 'http_error_action',
        noun: 'HTTPError',
        display: { label: 'HTTP Error Action', description: 'Handles HTTP errors' },
        perform: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/contacts',
            method: 'POST',
            json: bundle.inputData,
            skipThrowForStatus: true,
          })

          if (!response.status.toString().startsWith('2')) {
            const error = response.data as { message?: string }
            throw new z.errors.Error(
              error.message || `Request failed with status ${response.status}`
            )
          }

          return response.data
        },
      })

      const actionInstance = new Action(config)
      const z = createZObject()
      const bundle: Bundle = {
        inputData: { email: 'invalid-email' },
        authData: {},
      }

      await expect(actionInstance.perform(z, bundle)).rejects.toThrow('Email address is invalid')
    })

    it('should wrap unknown errors with context', async () => {
      const config = createAction({
        key: 'unknown_error_action',
        noun: 'UnknownError',
        display: { label: 'Unknown Error', description: 'Handles unknown errors' },
        perform: async (z, bundle) => {
          try {
            // Simulate an unknown error
            throw new Error('Network timeout')
          } catch (error) {
            throw new z.errors.Error(
              `Failed to create contact: ${(error as Error).message}. Please try again.`
            )
          }
        },
      })

      const actionInstance = new Action(config)
      const z = createZObject()
      const bundle: Bundle = { inputData: {}, authData: {} }

      await expect(actionInstance.perform(z, bundle)).rejects.toThrow(
        'Failed to create contact: Network timeout. Please try again.'
      )
    })
  })

  // ============================================================================
  // BULK ACTIONS (performBulk)
  // ============================================================================

  describe('Bulk Actions (performBulk)', () => {
    it('should support performBulk for batch operations', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          results: [
            { id: '1', status: 'created' },
            { id: '2', status: 'created' },
            { id: '3', status: 'created' },
          ]
        }), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      // RED test - performBulk doesn't exist yet
      const config = createAction({
        key: 'bulk_create',
        noun: 'Contact',
        display: { label: 'Bulk Create Contacts', description: 'Creates multiple contacts' },
        perform: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/contacts',
            method: 'POST',
            json: bundle.inputData,
            skipThrowForStatus: true,
          })
          return response.data
        },
      })

      const actionInstance = new Action(config)

      // Expected: performBulk method that handles array of inputs
      expect((actionInstance as any).performBulk).toBeDefined()

      // const z = createZObject()
      // const results = await actionInstance.performBulk(z, [
      //   { inputData: { email: 'user1@example.com' }, authData: {} },
      //   { inputData: { email: 'user2@example.com' }, authData: {} },
      //   { inputData: { email: 'user3@example.com' }, authData: {} },
      // ])
      // expect(results).toHaveLength(3)
    })

    it('should handle partial failures in bulk operations', async () => {
      // RED test - bulk error handling doesn't exist yet
      const config = createAction({
        key: 'bulk_with_errors',
        noun: 'Contact',
        display: { label: 'Bulk Create with Errors', description: 'Handles partial failures' },
        perform: async () => ({}),
      })

      const actionInstance = new Action(config)

      // Expected: performBulk with partial failure handling
      expect((actionInstance as any).performBulkWithErrors).toBeDefined()

      // const results = await actionInstance.performBulkWithErrors(z, [...])
      // expect(results.succeeded).toHaveLength(2)
      // expect(results.failed).toHaveLength(1)
      // expect(results.failed[0].error).toBeDefined()
    })

    it('should respect bulk operation limits', async () => {
      // RED test - bulk limits don't exist yet
      const config = createAction({
        key: 'bulk_limited',
        noun: 'Contact',
        display: { label: 'Bulk Limited', description: 'Has bulk limits' },
        perform: async () => ({}),
      })

      const actionInstance = new Action(config)

      // Expected: getBulkLimit method
      expect((actionInstance as any).getBulkLimit).toBeDefined()

      // const limit = actionInstance.getBulkLimit()
      // expect(limit).toBe(100) // Default limit
    })

    it('should support bulk operation with progress callback', async () => {
      // RED test - progress callback doesn't exist yet
      const config = createAction({
        key: 'bulk_progress',
        noun: 'Contact',
        display: { label: 'Bulk with Progress', description: 'Reports progress' },
        perform: async () => ({}),
      })

      const actionInstance = new Action(config)

      // Expected: performBulk with onProgress callback
      expect((actionInstance as any).performBulkWithProgress).toBeDefined()

      // let progressCalls = 0
      // await actionInstance.performBulkWithProgress(z, bundles, {
      //   onProgress: (completed, total) => {
      //     progressCalls++
      //   }
      // })
      // expect(progressCalls).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // SEARCH ACTIONS (performSearch, performGet)
  // ============================================================================

  describe('Search Actions (performSearch, performGet)', () => {
    it('should support performSearch for finding records', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([
          { id: 'contact_1', email: 'john@example.com', name: 'John' },
          { id: 'contact_2', email: 'jane@example.com', name: 'Jane' },
        ]), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      // RED test - performSearch on Action doesn't exist yet
      const config = createAction({
        key: 'find_contact',
        noun: 'Contact',
        display: { label: 'Find Contact', description: 'Finds contacts' },
        perform: async (z, bundle) => {
          const response = await z.request({
            url: 'https://api.example.com/contacts',
            params: { email: bundle.inputData.email as string },
            skipThrowForStatus: true,
          })
          return response.data
        },
      })

      const actionInstance = new Action(config)

      // Expected: performSearch method that returns array
      expect((actionInstance as any).performSearch).toBeDefined()

      // const z = createZObject()
      // const results = await actionInstance.performSearch(z, {
      //   inputData: { email: 'john@example.com' },
      //   authData: {},
      // })
      // expect(Array.isArray(results)).toBe(true)
      // expect(results[0].email).toBe('john@example.com')
    })

    it('should support performGet for fetching single record by ID', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          id: 'contact_123',
          email: 'john@example.com',
          name: 'John Doe',
          company: 'Acme Inc',
        }), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      // RED test - performGet doesn't exist yet
      const config = createAction({
        key: 'get_contact',
        noun: 'Contact',
        display: { label: 'Get Contact', description: 'Gets a contact by ID' },
        perform: async (z, bundle) => {
          const response = await z.request({
            url: `https://api.example.com/contacts/${bundle.inputData.id}`,
            skipThrowForStatus: true,
          })
          return response.data
        },
      })

      const actionInstance = new Action(config)

      // Expected: performGet method that returns single record
      expect((actionInstance as any).performGet).toBeDefined()

      // const z = createZObject()
      // const result = await actionInstance.performGet(z, {
      //   inputData: { id: 'contact_123' },
      //   authData: {},
      // })
      // expect(result.id).toBe('contact_123')
    })

    it('should support search or create pattern', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify([]), { status: 200 }) // Empty search result
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            id: 'new_contact',
            email: 'new@example.com',
          }), { status: 201 }) // Created
        )
      vi.stubGlobal('fetch', mockFetch)

      // RED test - searchOrCreate doesn't exist yet as a pattern
      const config = createAction({
        key: 'find_or_create_contact',
        noun: 'Contact',
        display: { label: 'Find or Create Contact', description: 'Finds or creates' },
        perform: async () => ({}),
      })

      const actionInstance = new Action(config)

      // Expected: searchOrCreate method
      expect((actionInstance as any).searchOrCreate).toBeDefined()

      // const z = createZObject()
      // const result = await actionInstance.searchOrCreate(z, {
      //   inputData: { email: 'new@example.com' },
      //   authData: {},
      // }, async (z, bundle) => {
      //   // Create function
      //   const response = await z.request({...})
      //   return response.data
      // })
      // expect(result.id).toBe('new_contact')
    })

    it('should support resource operations (get, list, create, update, delete)', async () => {
      // RED test - resource operations don't exist yet
      const config = createAction({
        key: 'contact_resource',
        noun: 'Contact',
        display: { label: 'Contact Resource', description: 'CRUD operations' },
        perform: async () => ({}),
      })

      const actionInstance = new Action(config)

      // Expected: resource operation methods
      expect((actionInstance as any).asResource).toBeDefined()

      // const resource = actionInstance.asResource({
      //   baseUrl: 'https://api.example.com/contacts',
      //   idField: 'id',
      // })
      // expect(resource.get).toBeDefined()
      // expect(resource.list).toBeDefined()
      // expect(resource.create).toBeDefined()
      // expect(resource.update).toBeDefined()
      // expect(resource.delete).toBeDefined()
    })
  })

  // ============================================================================
  // ACTION BUILDER FLUENT API
  // ============================================================================

  describe('Action Builder Fluent API', () => {
    it('should build action with all options', () => {
      const config = action()
        .key('complete_action')
        .noun('Complete')
        .label('Complete Action')
        .description('A complete action with all options')
        .perform(async (z, bundle) => {
          return { id: 'created', data: bundle.inputData }
        })
        .inputField(requiredString('email', 'Email Address'))
        .inputField(stringField('name', 'Full Name'))
        .inputField(numberField('age', 'Age'))
        .inputField(booleanField('active', 'Is Active'))
        .outputField({ key: 'id', label: 'Created ID', important: true })
        .sample({ id: 'sample_1', email: 'sample@example.com' })
        .build()

      expect(config.key).toBe('complete_action')
      expect(config.noun).toBe('Complete')
      expect(config.display.label).toBe('Complete Action')
      expect(config.operation.inputFields).toHaveLength(4)
      expect(config.operation.outputFields).toHaveLength(1)
      expect(config.operation.sample).toBeDefined()
    })

    it('should throw error when required fields are missing', () => {
      expect(() => {
        action().build()
      }).toThrow('Action key is required')

      expect(() => {
        action().key('test').build()
      }).toThrow('Action noun is required')

      expect(() => {
        action().key('test').noun('Test').build()
      }).toThrow('Action display is required')

      expect(() => {
        action().key('test').noun('Test').label('Test').description('Test').build()
      }).toThrow('Action perform function is required')
    })

    it('should support dynamic input fields in builder', () => {
      const config = action()
        .key('dynamic_builder')
        .noun('Dynamic')
        .label('Dynamic Builder')
        .description('Uses dynamic fields')
        .perform(async () => ({}))
        .inputField(requiredString('object_type', 'Object Type'))
        .dynamicInputFields(async (z, bundle) => {
          return [
            { key: 'dynamic_1', label: 'Dynamic Field 1' },
            { key: 'dynamic_2', label: 'Dynamic Field 2' },
          ]
        })
        .build()

      expect(config.operation.inputFields).toHaveLength(2)
      // Second element should be a function
      expect(typeof config.operation.inputFields![1]).toBe('function')
    })
  })

  // ============================================================================
  // INPUT/OUTPUT TRANSFORMATIONS
  // ============================================================================

  describe('Input/Output Transformations', () => {
    it('should merge input with defaults', () => {
      const fields: InputField[] = [
        { key: 'name', label: 'Name', default: 'Default Name' },
        { key: 'count', label: 'Count', type: 'number', default: 10 },
        { key: 'active', label: 'Active', type: 'boolean', default: true },
        { key: 'email', label: 'Email' }, // No default
      ]

      const input = { email: 'test@example.com', name: 'Custom Name' }
      const merged = mergeWithDefaults(input, fields)

      expect(merged.name).toBe('Custom Name') // User value preserved
      expect(merged.count).toBe(10) // Default applied
      expect(merged.active).toBe(true) // Default applied
      expect(merged.email).toBe('test@example.com') // User value preserved
    })

    it('should clean input data by removing null/undefined', () => {
      const input = {
        name: 'Test',
        email: null,
        phone: undefined,
        age: 0,
        active: false,
        empty: '',
      }

      const cleaned = cleanInputData(input)

      expect(cleaned.name).toBe('Test')
      expect(cleaned.age).toBe(0) // Zero preserved
      expect(cleaned.active).toBe(false) // False preserved
      expect(cleaned.empty).toBe('') // Empty string preserved
      expect('email' in cleaned).toBe(false)
      expect('phone' in cleaned).toBe(false)
    })

    it('should transform input data types', () => {
      const fields: InputField[] = [
        { key: 'count', label: 'Count', type: 'number' },
        { key: 'quantity', label: 'Quantity', type: 'integer' },
        { key: 'active', label: 'Active', type: 'boolean' },
        { key: 'created', label: 'Created', type: 'datetime' },
      ]

      const input = {
        count: '42.5',
        quantity: '7.9',
        active: 'true',
        created: '2024-01-15',
      }

      const transformed = transformInputData(input, fields)

      expect(transformed.count).toBe(42.5)
      expect(transformed.quantity).toBe(7) // Truncated to integer
      expect(transformed.active).toBe(true)
      expect(transformed.created).toContain('2024-01-15')
    })

    it('should format output data according to output fields', () => {
      const outputFields = [
        { key: 'id', label: 'ID', important: true },
        { key: 'email', label: 'Email' },
        { key: 'created_at', label: 'Created At' },
      ]

      const data = {
        id: '123',
        email: 'test@example.com',
        created_at: '2024-01-15T10:00:00Z',
        internal_field: 'should be included',
      }

      const formatted = formatOutputData(data, outputFields)

      // All fields should be present (Zapier includes extra fields)
      expect(formatted.id).toBe('123')
      expect(formatted.email).toBe('test@example.com')
      expect(formatted.internal_field).toBe('should be included')
    })
  })

  // ============================================================================
  // FIELD HELPERS
  // ============================================================================

  describe('Field Helpers', () => {
    it('should create all field types', () => {
      expect(stringField('name', 'Name').type).toBe('string')
      expect(requiredString('email', 'Email').required).toBe(true)
      expect(numberField('amount', 'Amount').type).toBe('number')
      expect(integerField('count', 'Count').type).toBe('integer')
      expect(booleanField('active', 'Active').type).toBe('boolean')
      expect(datetimeField('date', 'Date').type).toBe('datetime')
      expect(fileField('attachment', 'Attachment').type).toBe('file')
      expect(passwordField('secret', 'Secret').type).toBe('password')
    })

    it('should create select field with choices', () => {
      const stringChoices = selectField('status', 'Status', ['open', 'closed', 'pending'])
      expect(stringChoices.choices).toEqual(['open', 'closed', 'pending'])

      const objectChoices = selectField('priority', 'Priority', [
        { value: 'low', label: 'Low Priority' },
        { value: 'high', label: 'High Priority' },
      ])
      expect(objectChoices.choices).toHaveLength(2)
    })

    it('should create dynamic field with reference', () => {
      const field = dynamicField('list_id', 'List', 'list_trigger.id.name')
      expect(field.dynamic).toBe('list_trigger.id.name')
    })

    it('should create search field with reference', () => {
      const field = searchField('contact_id', 'Contact', 'find_contact.id')
      expect(field.search).toBe('find_contact.id')
    })

    it('should create list field with children', () => {
      const field = listField('items', 'Line Items', [
        { key: 'product', label: 'Product', required: true },
        { key: 'quantity', label: 'Quantity', type: 'integer', required: true },
        { key: 'price', label: 'Price', type: 'number' },
      ])

      expect(field.list).toBe(true)
      expect(field.children).toHaveLength(3)
    })

    it('should create output fields with importance', () => {
      const regular = outputField('email', 'Email')
      expect(regular.important).toBeUndefined()

      const important = importantField('id', 'Record ID')
      expect(important.important).toBe(true)
    })
  })

  // ============================================================================
  // APP INTEGRATION
  // ============================================================================

  describe('App Integration', () => {
    it('should execute action through app', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'created_123' }), { status: 201 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const app = new App({
        version: '1.0.0',
        platformVersion: '14.0.0',
        triggers: {},
        actions: {
          create_item: createAction({
            key: 'create_item',
            noun: 'Item',
            display: { label: 'Create Item', description: 'Creates an item' },
            perform: async (z, bundle) => {
              const response = await z.request({
                url: 'https://api.example.com/items',
                method: 'POST',
                json: bundle.inputData,
                skipThrowForStatus: true,
              })
              return response.data
            },
            inputFields: [
              requiredString('name', 'Name'),
            ],
          }),
        },
        searches: {},
      })

      const result = await app.executeAction('create_item', {
        inputData: { name: 'Test Item' },
        authData: { access_token: 'token123' },
      })

      expect((result as any).id).toBe('created_123')
    })

    it('should throw error for unknown action', async () => {
      const app = new App({
        version: '1.0.0',
        platformVersion: '14.0.0',
        triggers: {},
        actions: {},
        searches: {},
      })

      await expect(
        app.executeAction('nonexistent', { inputData: {}, authData: {} })
      ).rejects.toThrow('Action "nonexistent" not found')
    })

    it('should get action wrapper from app', () => {
      const app = new App({
        version: '1.0.0',
        platformVersion: '14.0.0',
        triggers: {},
        actions: {
          test_action: createAction({
            key: 'test_action',
            noun: 'Test',
            display: { label: 'Test Action', description: 'A test action' },
            perform: async () => ({}),
          }),
        },
        searches: {},
      })

      const actionWrapper = app.getAction('test_action')
      expect(actionWrapper).toBeDefined()
      expect(actionWrapper?.key).toBe('test_action')

      const notFound = app.getAction('nonexistent')
      expect(notFound).toBeUndefined()
    })

    it('should validate actions during app validation', () => {
      const app = new App({
        version: '1.0.0',
        platformVersion: '14.0.0',
        triggers: {},
        actions: {
          invalid_action: {
            key: '',
            noun: '',
            display: { label: '', description: '' },
            operation: {
              perform: async () => ({}),
            },
          },
        },
        searches: {},
      })

      const validation = app.validate()
      expect(validation.valid).toBe(false)
      expect(validation.errors.some(e => e.includes('missing a key'))).toBe(true)
      expect(validation.errors.some(e => e.includes('missing a noun'))).toBe(true)
    })

    it('should apply beforeRequest middleware to action requests', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const app = new App({
        version: '1.0.0',
        platformVersion: '14.0.0',
        triggers: {},
        actions: {
          middleware_action: createAction({
            key: 'middleware_action',
            noun: 'Middleware',
            display: { label: 'Middleware Action', description: 'Uses middleware' },
            perform: async (z, bundle) => {
              const response = await z.request({
                url: 'https://api.example.com/test',
                skipThrowForStatus: true,
              })
              return response.data
            },
          }),
        },
        searches: {},
        beforeRequest: [
          (request, z, bundle) => ({
            ...request,
            headers: {
              ...request.headers,
              'Authorization': `Bearer ${bundle.authData.access_token}`,
              'X-Custom-Header': 'custom-value',
            },
          }),
        ],
      })

      await app.executeAction('middleware_action', {
        inputData: {},
        authData: { access_token: 'my_token' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer my_token',
            'X-Custom-Header': 'custom-value',
          }),
        })
      )
    })
  })
})
